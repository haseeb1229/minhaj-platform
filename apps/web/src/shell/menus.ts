import { exploreSlugsOf, ownerPathOf, type ExploreSection } from '@/shell/explore';
import {
  LEGAL_DOCUMENTS,
  SHELL_ROUTES,
  isAvailable,
  requireRoute,
  type AvailableRoute,
} from '@/shell/registry';

/**
 * THE GROUPING OF THE SHELL'S NAVIGATION — the mega menus, the mobile drawer
 * and the footer columns (INFORMATION_ARCHITECTURE.md §3, §4).
 *
 * A SEPARATE MODULE FROM THE REGISTRY, deliberately. The registry says which
 * routes exist and where each may be placed; it is frozen in shape and in
 * primary order. HOW those routes are grouped into labelled columns is a
 * presentation decision about the same routes, so it lives here and refers to
 * them BY KEY. Nothing here carries a path: every link is resolved through
 * `requireRoute`, which throws on an unknown key, so a column cannot hold a
 * link the registry does not stand behind, and a typo fails the build rather
 * than rendering a dead link (ROUTE_MAP.md §5.2).
 *
 * WHAT IS ABSENT IS ABSENT. An IA entry with no delivered route — Quran
 * Articles, Hadith Scholars, Training, Regions and Cities as listings, Local
 * News — is simply not listed. Neither is anything whose existence is a RUNTIME
 * fact: `/listen/recitations` exists only while a Quran corpus is active, and a
 * topic's address exists only while that topic does, so neither can be a
 * static link in a prerendered shell. Query views (`/fatwa?sort=latest`) are
 * views of a route already listed, not routes of their own.
 *
 * LABELS ARE MESSAGE KEYS in the `shell` namespace. By default a link uses its
 * registry label; a few registry labels are written to stand alone in the
 * human sitemap ("Quran: Surahs") and read awkwardly under a column heading, so
 * those links carry a shorter `menu.labels.*` key instead.
 */

/** A message key within the `shell` namespace. */
export type ShellMessageKey = string;

export interface MenuLinkSpec {
  /** A registry key. */
  readonly route: string;
  /** Overrides the registry label. */
  readonly label?: ShellMessageKey;
}

export interface MenuColumnSpec {
  /** The column heading. With `route`, the heading is itself a link. */
  readonly heading: { readonly label: ShellMessageKey } | { readonly route: string };
  readonly links: readonly MenuLinkSpec[];
}

/** The nine primary domains INFORMATION_ARCHITECTURE.md §2.2 gives a mega menu. */
export type DomainMenuKey =
  | 'explore'
  | 'quran'
  | 'hadith'
  | 'learn'
  | 'library'
  | 'watch'
  | 'fatwa'
  | 'news-events'
  | 'global';

export interface DomainMenuSpec {
  /** The registry key of the domain's landing, which is also the menu's key. */
  readonly key: DomainMenuKey;
  readonly columns: readonly MenuColumnSpec[];
}

/* ===========================================================================
 * The mega menus — INFORMATION_ARCHITECTURE.md §3
 * ========================================================================= */

const link = (route: string, label?: ShellMessageKey): MenuLinkSpec =>
  label === undefined ? { route } : { route, label };

const column = (
  label: ShellMessageKey,
  links: readonly MenuLinkSpec[],
): MenuColumnSpec => ({
  heading: { label },
  links,
});

/** The registry key of the available route at a locale-relative path. */
function routeKeyAt(path: string): string {
  const route = SHELL_ROUTES.find((entry) => isAvailable(entry) && entry.path === path);
  if (route === undefined) throw new Error(`No shell route is registered at "${path}".`);
  return route.key;
}

/**
 * An Explore section's pages, in the allowlist's own order. An item an owner
 * has since delivered (`ownerPathOf`) links to the owner's route, never to its
 * reserved Explore address, which only redirects there.
 */
const explorePages = (section: ExploreSection): MenuLinkSpec[] =>
  exploreSlugsOf(section).map((slug) => {
    const owner = ownerPathOf(section, slug);
    return link(owner === null ? `explore.${section}.${slug}` : routeKeyAt(owner));
  });

/**
 * §3.1 — About, Shaykh-ul-Islam, Organization, Our Work, Connect. Leadership
 * is a leaf section and sits under About, as the IA places it; Community and
 * the Digital Resources group make up Connect with the contact routes.
 */
const EXPLORE: DomainMenuSpec = {
  key: 'explore',
  columns: [
    {
      heading: { route: 'explore.about' },
      links: [...explorePages('about'), link('explore.leadership')],
    },
    {
      heading: { route: 'explore.shaykh-ul-islam' },
      links: explorePages('shaykh-ul-islam'),
    },
    { heading: { route: 'explore.organization' }, links: explorePages('organization') },
    { heading: { route: 'explore.our-work' }, links: explorePages('our-work') },
    column('menu.columns.connect', [
      link('explore.community'),
      link('membership'),
      link('contact'),
      link('contact-help', 'menu.labels.help'),
      link('feedback'),
      link('explore.digital-resources'),
      ...explorePages('digital-resources'),
    ]),
  ],
};

/** §3.2 — Read, Study, Explore, Learn. Quran Topics, Articles and Teachers have no route. */
const QURAN: DomainMenuSpec = {
  key: 'quran',
  columns: [
    column('menu.columns.read', [
      link('quran.read', 'menu.labels.quranRead'),
      link('quran.surah', 'menu.labels.quranSurah'),
      link('quran.juz', 'menu.labels.quranJuz'),
      link('quran.search'),
      link('quran.recitations'),
    ]),
    column('menu.columns.study', [
      link('quran.translations'),
      link('quran.transliteration'),
      link('quran.tafsir'),
      link('quran.tajweed'),
    ]),
    column('menu.columns.explore', [
      link('quran.books'),
      link('quran.videos'),
      link('quran.research'),
    ]),
    column('menu.columns.learn', [link('quran.courses')]),
  ],
};

/** §3.3 — Browse, Study, Explore, Learn. Books and Chapters are reached through a collection. */
const HADITH: DomainMenuSpec = {
  key: 'hadith',
  columns: [
    column('menu.columns.browse', [
      link('hadith.introduction', 'menu.labels.hadithIntroduction'),
      link('hadith.collections'),
      link('hadith.browse'),
      link('hadith.search'),
    ]),
    column('menu.columns.study', [link('hadith.sciences'), link('hadith.commentary')]),
    column('menu.columns.explore', [
      link('hadith.books'),
      link('hadith.videos'),
      link('hadith.research'),
    ]),
    column('menu.columns.learn', [link('hadith.courses')]),
  ],
};

/**
 * §3.4 — Learning, Topics, Live, People. The curated topic subset is a set of
 * runtime topic addresses, so only All Topics is linked; Training and Resources
 * have no owner contract.
 */
const LEARN: DomainMenuSpec = {
  key: 'learn',
  columns: [
    column('menu.columns.learning', [link('learn.courses'), link('learn.paths')]),
    column('menu.columns.topics', [link('topics')]),
    column('menu.columns.live', [link('learn.live'), link('learn.trial')]),
    column('menu.columns.people', [link('learn.teachers')]),
  ],
};

/** §3.5 — Browse, Written Works, Periodicals, Access. `/library/collections` is absent. */
const LIBRARY: DomainMenuSpec = {
  key: 'library',
  columns: [
    column('menu.columns.browse', [
      link('library.resources'),
      link('library.books'),
      link('library.authors'),
      link('library.topics'),
      link('library.languages'),
    ]),
    column('menu.columns.writtenWorks', [
      link('articles'),
      link('library.research'),
      link('library.research-papers'),
      link('library.publications'),
    ]),
    column('menu.columns.periodicals', [
      link('library.magazines'),
      link('library.encyclopedias'),
    ]),
    column('menu.columns.access', [
      link('library.downloads'),
      link('library.sale-points'),
    ]),
  ],
};

/**
 * §3.6 — Watch, Series & Programs, By Topic, Listen. The Listen column keeps
 * audio visible behind a video-shaped label (§2.2); Quran Recitations is a
 * runtime link and is reached through Listen and the Quran menu instead.
 */
const WATCH: DomainMenuSpec = {
  key: 'watch',
  columns: [
    column('menu.columns.watch', [
      link('watch.videos'),
      link('watch.lectures'),
      link('watch.events'),
      link('watch.highlights'),
    ]),
    column('menu.columns.seriesPrograms', [
      link('watch.series'),
      link('watch.programs'),
      link('watch.interviews'),
      link('watch.documentaries'),
      link('watch.playlists'),
    ]),
    column('menu.columns.byTopic', [link('topics'), link('watch.speakers')]),
    column('menu.columns.listen', [
      link('listen'),
      link('listen.lectures'),
      link('listen.series'),
    ]),
  ],
};

/** §3.7 — Find, Browse, Ask, Understand. Latest and Popular are query views of `/fatwa`. */
const FATWA: DomainMenuSpec = {
  key: 'fatwa',
  columns: [
    column('menu.columns.find', [link('fatwa.search')]),
    column('menu.columns.browse', [link('fatwa.categories')]),
    column('menu.columns.ask', [link('fatwa.ask')]),
    column('menu.columns.understand', [link('fatwa.how-it-works')]),
  ],
};

/**
 * §3.8 — News, Events, Media, Archive. Event galleries are reached through
 * their Event; there is no Media Downloads route.
 */
const NEWS_EVENTS: DomainMenuSpec = {
  key: 'news-events',
  columns: [
    column('menu.columns.news', [
      link('news.press-releases'),
      link('news.statements'),
      link('news.media-coverage'),
    ]),
    column('menu.columns.events', [link('events')]),
    column('menu.columns.media', [link('media.galleries'), link('media.photos')]),
    column('menu.columns.archive', [
      link('news.archive'),
      link('media.archive'),
      link('collections'),
      link('newsletter'),
    ]),
  ],
};

/**
 * §3.9 — Find and Structure. Regions, Cities and the Local column are reached
 * through a Country or a Centre, so they have no static entry.
 */
const GLOBAL: DomainMenuSpec = {
  key: 'global',
  columns: [
    column('menu.columns.find', [link('find-a-centre'), link('global.centres')]),
    column('menu.columns.structure', [link('global.countries'), link('global.pakistan')]),
  ],
};

/** Every mega menu, in the primary navigation's own order (§2.2). */
export const DOMAIN_MENUS: readonly DomainMenuSpec[] = Object.freeze([
  EXPLORE,
  QURAN,
  HADITH,
  LEARN,
  LIBRARY,
  WATCH,
  FATWA,
  NEWS_EVENTS,
  GLOBAL,
]);

/* ===========================================================================
 * The footer — INFORMATION_ARCHITECTURE.md §4
 * ========================================================================= */

export interface FooterColumnSpec {
  readonly heading: ShellMessageKey;
  readonly links: readonly MenuLinkSpec[];
}

/**
 * The six columns, "the comprehensive index that the mega menus deliberately
 * are not". Reserved Explore and Volunteer pages are linked: they exist and say
 * honestly that nothing is published yet. Scholars, Training, Resources,
 * Regions, Cities and Hadith by Topic have no static route and are absent.
 */
export const FOOTER_COLUMNS: readonly FooterColumnSpec[] = Object.freeze([
  {
    heading: 'footer.columns.about',
    links: [
      link('explore.about'),
      ...explorePages('about'),
      link('explore.leadership'),
      link('explore.shaykh-ul-islam'),
      link('explore.organization'),
      ...explorePages('organization'),
    ],
  },
  {
    heading: 'footer.columns.knowledge',
    links: [
      link('quran.read', 'menu.labels.quranRead'),
      link('quran.surah', 'menu.labels.quranSurah'),
      link('quran.juz', 'menu.labels.quranJuz'),
      link('quran.tafsir'),
      link('quran.tajweed'),
      link('quran.recitations'),
      link('hadith.collections'),
      link('hadith.sciences'),
      link('fatwa'),
      link('fatwa.ask'),
      link('topics'),
    ],
  },
  {
    heading: 'footer.columns.libraryMedia',
    links: [
      link('library.resources'),
      link('library.books'),
      link('library.authors'),
      link('library.research'),
      link('library.research-papers'),
      link('library.publications'),
      link('library.encyclopedias'),
      link('library.magazines'),
      link('articles'),
      link('library.downloads'),
      link('library.sale-points'),
      link('watch.videos'),
      link('listen.lectures'),
      link('watch.playlists'),
      link('media.galleries'),
      link('collections'),
    ],
  },
  {
    heading: 'footer.columns.learnParticipate',
    links: [
      link('learn.courses'),
      link('learn.paths'),
      link('learn.live'),
      link('learn.trial'),
      link('learn.teachers'),
      link('membership'),
      link('volunteer'),
      link('donate'),
    ],
  },
  {
    heading: 'footer.columns.ourWork',
    links: [
      link('explore.our-work'),
      ...explorePages('our-work'),
      link('explore.community'),
    ],
  },
  {
    heading: 'footer.columns.globalContact',
    links: [
      link('global'),
      link('find-a-centre'),
      link('global.countries'),
      link('global.pakistan'),
      link('contact'),
      link('contact-help', 'menu.labels.help'),
      link('feedback'),
      link('newsletter'),
      link('explore.digital-resources'),
      ...explorePages('digital-resources').filter(
        (entry) => entry.route !== 'newsletter',
      ),
    ],
  },
]);

/** The footer's utility bar: the legal documents, then the human sitemap. */
export const FOOTER_UTILITY: readonly MenuLinkSpec[] = Object.freeze([
  ...LEGAL_DOCUMENTS.map((document) => link(`legal.${document}`)),
  link('sitemap'),
]);

/* ===========================================================================
 * Resolution
 * ========================================================================= */

export interface MenuLink {
  readonly key: string;
  readonly route: AvailableRoute;
  readonly label: ShellMessageKey;
}

export interface MenuColumn {
  readonly key: string;
  readonly heading:
    | { readonly label: ShellMessageKey; readonly route: null }
    | { readonly label: ShellMessageKey; readonly route: AvailableRoute };
  readonly links: readonly MenuLink[];
}

export interface DomainMenu {
  readonly key: DomainMenuKey;
  /** The domain's landing — the top-level link and every panel's overview. */
  readonly landing: AvailableRoute;
  readonly columns: readonly MenuColumn[];
}

/** One link, resolved through the registry. Throws on an unknown key. */
export function resolveLink(spec: MenuLinkSpec): MenuLink {
  const route = requireRoute(spec.route);
  return { key: spec.route, route, label: spec.label ?? route.label };
}

function resolveColumn(spec: MenuColumnSpec): MenuColumn {
  if ('route' in spec.heading) {
    const route = requireRoute(spec.heading.route);
    return {
      key: spec.heading.route,
      heading: { label: route.label, route },
      links: spec.links.map(resolveLink),
    };
  }
  return {
    key: spec.heading.label,
    heading: { label: spec.heading.label, route: null },
    links: spec.links.map(resolveLink),
  };
}

/** Every mega menu, resolved — what the header renders. */
export function domainMenus(): readonly DomainMenu[] {
  return DOMAIN_MENUS.map((menu) => ({
    key: menu.key,
    landing: requireRoute(menu.key),
    columns: menu.columns.map(resolveColumn),
  }));
}

/** The footer columns, resolved. */
export function footerColumns(): readonly {
  readonly heading: ShellMessageKey;
  readonly links: readonly MenuLink[];
}[] {
  return FOOTER_COLUMNS.map((entry) => ({
    heading: entry.heading,
    links: entry.links.map(resolveLink),
  }));
}

/** The footer utility links, resolved. */
export function footerUtility(): readonly MenuLink[] {
  return FOOTER_UTILITY.map(resolveLink);
}
