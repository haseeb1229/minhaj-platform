import { EXPLORE_SECTIONS, exploreSlugsOf, type ExploreSection } from '@/shell/explore';

/**
 * THE shell route registry — Layer 4, and the minimum of it (ROUTE_MAP.md §5.2).
 *
 * ONE SOURCE, SIX CONSUMERS. The header, the Explore mega menu, the mobile
 * navigation, the footer, the human-readable sitemap and the read-only
 * administrative navigation status all describe the same set of routes. Written
 * six times they would disagree — a link removed from the header and left in
 * the footer is exactly the dead navigation ROUTE_MAP.md §5.2 prohibits — so
 * they are derived from this one list instead.
 *
 * WHAT THIS IS NOT. Not a CMS, not a database aggregate, not a feature-flag
 * platform, not a content registry, and not a place where a later domain
 * declares its own routes. It carries a stable key, a message key, a path, a
 * placement, an availability and an indexing eligibility — and no body content
 * of any kind (DELIVERY_PLAN.md, Phase 4).
 *
 * HOW DEAD NAVIGATION IS MADE IMPOSSIBLE. A deferred capability has NO `path`
 * FIELD AT ALL, so there is no string a link could be built from: rendering one
 * as an anchor is a type error rather than a review finding. That is the
 * structural form of "a deferred item is absent" (ROUTE_MAP.md §5.2).
 */

/* ===========================================================================
 * Vocabulary
 * ========================================================================= */

/**
 * How far along a route is.
 *
 *   `delivered` — the route works and carries its own genuine content.
 *   `reserved`  — the route works and carries a clearly non-authoritative
 *                 publication-status state. Its genuine content is a Phase-6
 *                 `Page` record, and this placeholder is REPLACED by it, never
 *                 promoted or migrated (DELIVERY_PLAN.md, Phase 4).
 *   `deferred`  — the capability is committed but has not been built. It has no
 *                 route, and it appears nowhere a visitor can click.
 */
export type Availability = 'delivered' | 'reserved' | 'deferred';

/**
 * Whether a route may appear in a machine sitemap and be indexed, WHEN public
 * indexing is switched on at all.
 *
 * Independent of the pre-adoption posture, which suppresses indexing site-wide
 * regardless (ROUTE_MAP.md §9.5). This field says what a route would be
 * eligible for; `@/config/indexing` decides whether anything is.
 */
export type Indexing = 'eligible' | 'excluded';

/**
 * Whether a route is part of the public site or an authenticated area.
 *
 * `/my` is `delivered` and appears in the primary navigation — it is the
 * account entry point — but everything at and beneath it is private, `no-store`
 * and `noindex` (ROUTE_MAP.md §9.5). Saying so here is what keeps it out of
 * both sitemaps without either of them having to know about `/my` specifically.
 */
export type Visibility = 'public' | 'private';

/** Where a route appears in the shell. */
export type Placement =
  'primary' | 'utility' | 'footer-explore' | 'footer-legal' | 'footer-utility';

interface ShellRouteBase {
  /** Stable key. The vocabulary code, never a display string. */
  readonly key: string;
  /** Message key within the `shell` namespace. */
  readonly label: string;
  /** Where the shell renders it. A route reachable only by URL has none. */
  readonly placements: readonly Placement[];
}

/** A route that exists and can be linked to. */
export interface AvailableRoute extends ShellRouteBase {
  readonly availability: Exclude<Availability, 'deferred'>;
  /**
   * The locale-relative path, ALWAYS starting with `/` and never carrying a
   * locale segment — the locale is applied at the call site, once
   * (ROUTE_MAP.md §1.1). The empty string is the locale root itself.
   */
  readonly path: string;
  readonly visibility: Visibility;
  readonly indexing: Indexing;
}

/** A committed capability with no route yet. Deliberately has no `path`. */
export interface DeferredRoute extends ShellRouteBase {
  readonly availability: Extract<Availability, 'deferred'>;
}

export type ShellRoute = AvailableRoute | DeferredRoute;

/** Can a visitor go there? The one question a link has to ask. */
export function isAvailable(route: ShellRoute): route is AvailableRoute {
  return route.availability !== 'deferred';
}

/**
 * The locale-prefixed path for a route.
 *
 * The ONE place a shell URL is assembled. Nothing else concatenates a locale
 * onto a path, so a route cannot acquire a second spelling.
 */
export function pathFor(locale: string, route: AvailableRoute): string {
  return `/${locale}${route.path}`;
}

/* ===========================================================================
 * The registry
 * ========================================================================= */

/**
 * The primary navigation, in the canonical order of
 * INFORMATION_ARCHITECTURE.md §2.2.
 *
 * ALL TWELVE ARE RECORDED, and seven of them are `deferred`. Recording them is
 * not a promise to show them: it states the accepted final order in one place,
 * gives the administrative status surface something true to report, and makes
 * "a deferred domain renders no anchor" a property a test asserts over the
 * whole set rather than something a reviewer checks by eye.
 */
const PRIMARY: readonly ShellRoute[] = Object.freeze([
  Object.freeze({
    key: 'explore',
    label: 'nav.explore',
    path: '/explore',
    placements: Object.freeze(['primary'] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'eligible' as const,
  }),
  Object.freeze({
    key: 'quran',
    label: 'nav.quran',
    placements: Object.freeze(['primary'] as const),
    availability: 'deferred' as const,
  }),
  Object.freeze({
    key: 'hadith',
    label: 'nav.hadith',
    placements: Object.freeze(['primary'] as const),
    availability: 'deferred' as const,
  }),
  Object.freeze({
    key: 'learn',
    label: 'nav.learn',
    placements: Object.freeze(['primary'] as const),
    availability: 'deferred' as const,
  }),
  /**
   * DELIVERED BY PHASE 8. The entry stops being `deferred` because the capability
   * now exists: `/library` is a landing page listing the Library surfaces that are
   * genuinely built, and nothing else (§18 — "parent landing must list only actual
   * delivered capabilities"). Phase 9 added research, research papers,
   * publications, magazines and encyclopedias. `/library/collections` remains
   * absent — see LIBRARY_SURFACES — which is why it has no registry entry at all
   * rather than a `reserved` one.
   */
  Object.freeze({
    key: 'library',
    label: 'nav.library',
    path: '/library',
    placements: Object.freeze(['primary'] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'eligible' as const,
  }),
  /**
   * DELIVERED BY PHASE 10 — Video, Series and Playlist. `/watch` lists only the
   * Watch surfaces that genuinely exist, and links to Listen (Phase 11) and to
   * the photograph surfaces (Phase 12).
   */
  Object.freeze({
    key: 'watch',
    label: 'nav.watch',
    path: '/watch',
    placements: Object.freeze(['primary'] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'eligible' as const,
  }),
  Object.freeze({
    key: 'fatwa',
    label: 'nav.fatwa',
    placements: Object.freeze(['primary'] as const),
    availability: 'deferred' as const,
  }),
  /**
   * DELIVERED BY PHASE 13 — News. `/news` is the News and Events entry point:
   * the latest NewsArticles, the three other News families, the News archive,
   * the photograph surfaces Phase 12 delivered, Events (Phase 14) and
   * Collections (Phase 15). The newsletter is Phase 21's, so it is not linked
   * from it.
   */
  Object.freeze({
    key: 'news-events',
    label: 'nav.newsEvents',
    path: '/news',
    placements: Object.freeze(['primary'] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'eligible' as const,
  }),
  /**
   * DELIVERED BY PHASE 16 — the Global Network. `/global` is the World Network
   * landing: Find a Centre, Countries, Centres and the Pakistan structure, and a
   * plain statement while the directory holds nothing yet. Local News and — since
   * Phase 14 — Local Events are reached on each Centre's own page.
   */
  Object.freeze({
    key: 'global',
    label: 'nav.global',
    path: '/global',
    placements: Object.freeze(['primary'] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'eligible' as const,
  }),
  /**
   * DELIVERED BY PHASE 17. Unified search is a genuine public page in all three
   * locales, and it is `excluded` for good: a results page is a view of a query,
   * not a resource, so it is `noindex` and never a sitemap entry, whatever the
   * indexing posture (ROUTE_MAP.md §9.5).
   */
  Object.freeze({
    key: 'search',
    label: 'nav.search',
    path: '/search',
    placements: Object.freeze(['primary'] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'excluded' as const,
  }),
  /**
   * The ACCOUNT ENTRY POINT, delivered by Phase 2 and linked as a plain route.
   *
   * `excluded` from indexing because everything beneath `/my` is private and
   * `noindex` (ROUTE_MAP.md §9.5), and it is a STATIC link rather than a
   * personalised control: the public header must not know whether anybody is
   * signed in (ARCHITECTURE.md §8.1).
   */
  Object.freeze({
    key: 'my-minhaj',
    label: 'nav.myMinhaj',
    path: '/my',
    placements: Object.freeze(['primary'] as const),
    visibility: 'private' as const,
    availability: 'delivered' as const,
    indexing: 'excluded' as const,
  }),
  Object.freeze({
    key: 'donate',
    label: 'nav.donate',
    placements: Object.freeze(['primary'] as const),
    availability: 'deferred' as const,
  }),
]);

/**
 * Utility navigation (INFORMATION_ARCHITECTURE.md §2.1).
 *
 * The LANGUAGE SWITCHER is not here, because it is not a route: it is a control
 * that rewrites the current one, and the header renders it directly. Other utility routes become visible when their owning phase delivers them.
 */
const UTILITY: readonly ShellRoute[] = Object.freeze([
  /**
   * DELIVERED BY PHASE 16. Find a Centre is a genuine page in all three locales;
   * its `?country=`, `?region=` and `?city=` are queries canonical to it, never
   * entries of their own.
   */
  Object.freeze({
    key: 'find-a-centre',
    label: 'nav.findACentre',
    path: '/global/find-a-centre',
    placements: Object.freeze(['utility'] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'eligible' as const,
  }),
  Object.freeze({
    key: 'membership',
    label: 'nav.membership',
    placements: Object.freeze(['utility'] as const),
    availability: 'deferred' as const,
  }),
  Object.freeze({
    key: 'contact-help',
    label: 'nav.contactHelp',
    path: '/help',
    placements: Object.freeze(['utility'] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'excluded' as const,
  }),
]);

/**
 * The Explore shells, DERIVED from the allowlists rather than restated.
 *
 * Restating them would be a second list that can disagree with the one the
 * routes validate against — and the disagreement shows up as either a menu
 * entry that 404s or a reachable page nothing links to.
 *
 * Every one of them is `reserved` and `excluded`. A reserved shell carries a
 * publication-status notice and no body, so listing it in a sitemap would
 * advertise a page with nothing on it (ROUTE_MAP.md §9.4: only canonical,
 * indexable URLs appear).
 */
function exploreRoutes(): readonly ShellRoute[] {
  return Object.freeze(
    EXPLORE_SECTIONS.flatMap((section: ExploreSection): ShellRoute[] => [
      Object.freeze({
        key: `explore.${section}`,
        label: `explore.${section}.title`,
        path: `/explore/${section}`,
        placements: Object.freeze(['footer-explore'] as const),
        visibility: 'public' as const,
        availability: 'reserved' as const,
        indexing: 'excluded' as const,
      }),
      ...exploreSlugsOf(section).map((slug) =>
        Object.freeze({
          key: `explore.${section}.${slug}`,
          label: `explore.${section}.pages.${slug}`,
          path: `/explore/${section}/${slug}`,
          placements: Object.freeze([] as const),
          visibility: 'public' as const,
          availability: 'reserved' as const,
          indexing: 'excluded' as const,
        }),
      ),
    ]),
  );
}

/** The legal and compliance surfaces (ROUTE_MAP.md §3.10). */
export const LEGAL_DOCUMENTS = Object.freeze([
  'privacy',
  'terms',
  'cookies',
  'accessibility',
] as const);

export type LegalDocument = (typeof LEGAL_DOCUMENTS)[number];

/** Narrows an unvalidated segment to a reserved legal document. */
export function isLegalDocument(value: string): value is LegalDocument {
  return (LEGAL_DOCUMENTS as readonly string[]).includes(value);
}

const LEGAL: readonly ShellRoute[] = Object.freeze(
  LEGAL_DOCUMENTS.map((document) =>
    Object.freeze({
      key: `legal.${document}`,
      label: `legal.${document}`,
      path: `/legal/${document}`,
      placements: Object.freeze(['footer-legal'] as const),
      visibility: 'public' as const,
      availability: 'reserved' as const,
      indexing: 'excluded' as const,
    }),
  ),
);

/**
 * The Library's own surfaces — Phase 8.
 *
 * DERIVED FROM ONE LIST, so a surface cannot appear in the landing page and be
 * missing from the sitemap, or the reverse. Each is a genuine page in all three
 * interface locales, which is what makes `eligible` honest here: the Library
 * chrome is fully translated, and the CONTENT each page lists carries its own
 * language per row (ROUTE_MAP.md §1.5 — "`/ur/library/books` means Urdu UI
 * chrome. It does NOT mean 'only Urdu books'").
 *
 * NO PLACEMENT, deliberately. They are reached from the Library landing page,
 * which is a domain surface; putting eight Library links into the global footer
 * would be the shell taking over a domain's own navigation. `/library` itself is
 * in the primary navigation and is the single entry point.
 *
 * PHASE 9 ADDS FIVE LISTINGS — research, research papers, publications,
 * magazines and encyclopedias — each a genuine page over its own delivered
 * aggregate. A Magazine's issues are reached from the Magazine, so they have no
 * listing of their own here.
 *
 * WHAT IS ABSENT IS ABSENT. `/library/collections` is named by ROUTE_MAP.md §5,
 * and Phase 15 delivered Collections at `/collections` without activating it: a
 * Library view of Collections would have to hold only those whose members
 * Library publishes now, and Editorial cannot apply Library's current public
 * predicate inside its own bounded page — a Layer-4 post-filter would break
 * deterministic paging — so there is no truthful, deterministic filter to list
 * by. It has no entry, so there is no string a link could be built from (§5.2),
 * and `/library/articles` stays exactly where Phase 6 put it — Editorial owns
 * it, and Layer 4 composes it (§10).
 */
const LIBRARY_SURFACES = Object.freeze([
  'books',
  'authors',
  'topics',
  'languages',
  'downloads',
  'sale-points',
  'resources',
  'research',
  'research-papers',
  'publications',
  'magazines',
  'encyclopedias',
] as const);

const LIBRARY: readonly ShellRoute[] = Object.freeze(
  LIBRARY_SURFACES.map((surface) =>
    Object.freeze({
      key: `library.${surface}`,
      // Resolved in the `shell` namespace, like every other registry label, so
      // the human sitemap and the administrative navigation status name each
      // surface rather than printing "Library" twelve times.
      label: `library.${surface}`,
      path: `/library/${surface}`,
      placements: Object.freeze([] as const),
      visibility: 'public' as const,
      availability: 'delivered' as const,
      indexing: 'eligible' as const,
    }),
  ),
);

/**
 * The Watch surfaces — Phase 10 (ROUTE_MAP.md §3.7).
 *
 * The all-videos listing, the five curated views, series, programmes,
 * playlists and the speaker browse: each a genuine page in all three interface
 * locales over delivered data, which is what makes `eligible` honest. NO
 * PLACEMENT — they are reached from `/watch`, the single entry point in the
 * primary navigation. `/watch/topics/{slug}` is a filtered view canonical to
 * the topic hub and has no entry.
 */
const WATCH_SURFACES = Object.freeze([
  'videos',
  'lectures',
  'events',
  'highlights',
  'interviews',
  'documentaries',
  'series',
  'programs',
  'playlists',
  'speakers',
] as const);

const WATCH: readonly ShellRoute[] = Object.freeze(
  WATCH_SURFACES.map((surface) =>
    Object.freeze({
      key: `watch.${surface}`,
      label: `watch.${surface}`,
      path: `/watch/${surface}`,
      placements: Object.freeze([] as const),
      visibility: 'public' as const,
      availability: 'delivered' as const,
      indexing: 'eligible' as const,
    }),
  ),
);

/**
 * The Listen surfaces — Phase 11 (ROUTE_MAP.md §3.7).
 *
 * `/listen` is a SIBLING of `/watch`, not a child: the landing, every published
 * non-Quran track under `/listen/lectures`, and audio series under
 * `/listen/series`. NO PLACEMENT of its own — the primary navigation's "Watch"
 * covers both video and audio (INFORMATION_ARCHITECTURE.md §2.2), and `/watch`
 * links here.
 *
 * `/listen/recitations` HAS NO ENTRY AND NO ROUTE. It is the catalogue
 * projection of Quran-owned recitations, and Quran has not shipped; an
 * AudioTrack never fills it. A deferred capability is absent, never a dead
 * link (ROUTE_MAP.md §5.2).
 */
const LISTEN: readonly ShellRoute[] = Object.freeze([
  Object.freeze({
    key: 'listen',
    label: 'listen.home',
    path: '/listen',
    placements: Object.freeze([] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'eligible' as const,
  }),
  ...(['lectures', 'series'] as const).map((surface) =>
    Object.freeze({
      key: `listen.${surface}`,
      label: `listen.${surface}`,
      path: `/listen/${surface}`,
      placements: Object.freeze([] as const),
      visibility: 'public' as const,
      availability: 'delivered' as const,
      indexing: 'eligible' as const,
    }),
  ),
]);

/**
 * The photograph surfaces — Phase 12 (ROUTE_MAP.md §3.9).
 *
 * Photographs, galleries and the historical archive: each a genuine page in all
 * three interface locales over delivered data. NO PLACEMENT — Media is a content
 * domain, not a primary navigation item (INFORMATION_ARCHITECTURE.md §2.2). Its
 * designed entry points are News & Events — delivered by Phase 13, which links
 * all three from `/news` — and Collections. Phase 15 delivered Collections, but
 * a Photo or Gallery is not one of their member types, so no Collection links
 * here; these are also reached from one another and from the human sitemap.
 *
 * `/media/downloads` HAS NO ENTRY AND NO ROUTE: a download needs a rights
 * decision no phase has made. An Event's gallery view, `/events/{slug}/gallery`
 * (Phase 14), is a per-Event navigational view, `noindex`, with no entry here.
 */
const MEDIA: readonly ShellRoute[] = Object.freeze(
  (['photos', 'galleries', 'archive'] as const).map((surface) =>
    Object.freeze({
      key: `media.${surface}`,
      label: `media.${surface}`,
      path: `/media/${surface}`,
      placements: Object.freeze([] as const),
      visibility: 'public' as const,
      availability: 'delivered' as const,
      indexing: 'eligible' as const,
    }),
  ),
);

/**
 * The News families' listings and the News archive — Phase 13 (ROUTE_MAP.md
 * §3.9). Each is an intentional navigational view the information architecture
 * curates, a genuine page in all three interface locales over delivered data,
 * and so `eligible`. NO PLACEMENT — they are reached from `/news`, the single
 * entry point in the primary navigation. `?sort=latest` and the archive's
 * `?year=` and `?month=` are queries on these, canonical to them, and never
 * entries of their own; there is no `/news/latest`.
 */
const NEWS: readonly ShellRoute[] = Object.freeze(
  (['press-releases', 'statements', 'media-coverage', 'archive'] as const).map(
    (surface) =>
      Object.freeze({
        key: `news.${surface}`,
        label: `news.${surface}`,
        path: `/news/${surface}`,
        placements: Object.freeze([] as const),
        visibility: 'public' as const,
        availability: 'delivered' as const,
        indexing: 'eligible' as const,
      }),
  ),
);

/**
 * The Global Network surfaces — Phase 16 (ROUTE_MAP.md §3.9).
 *
 * Countries and Centres are genuine listings in all three interface locales
 * over delivered data, and so `eligible`. The PAKISTAN STRUCTURE is a view of
 * the ordinary Pakistan Country, canonical to that Country's page, so it is
 * `excluded`: never a sitemap entry, never a second indexable Pakistan page.
 * NO PLACEMENT — they are reached from `/global`, the single entry point in the
 * primary navigation. A Region, a City and a Centre are reached through their
 * Country and the finder, and a Centre's `news` and `events` pages through the
 * Centre.
 */
const GLOBAL: readonly ShellRoute[] = Object.freeze([
  ...(['countries', 'centres'] as const).map((surface) =>
    Object.freeze({
      key: `global.${surface}`,
      label: `global.${surface}`,
      path: `/global/${surface}`,
      placements: Object.freeze([] as const),
      visibility: 'public' as const,
      availability: 'delivered' as const,
      indexing: 'eligible' as const,
    }),
  ),
  Object.freeze({
    key: 'global.pakistan',
    label: 'global.pakistan',
    path: '/global/pakistan',
    placements: Object.freeze([] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'excluded' as const,
  }),
]);

/**
 * Events — Phase 14 (ROUTE_MAP.md §3.9). `/events` is a genuine listing in all
 * three interface locales over delivered data, and so `eligible`. NO PLACEMENT —
 * News & Events is the primary navigation item, and `/news` links here.
 * `?when=`, `?country=`, `?city=` and `?centre=` are queries canonical to it,
 * never entries of their own; there is no `/events/upcoming` or `/events/past`.
 */
const EVENTS: readonly ShellRoute[] = Object.freeze([
  Object.freeze({
    key: 'events',
    label: 'news.events',
    path: '/events',
    placements: Object.freeze([] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'eligible' as const,
  }),
]);

/**
 * Collections — Phase 15 (ROUTE_MAP.md §3.8). `/collections` is a genuine
 * listing in all three interface locales over delivered data, and so
 * `eligible`. NO PLACEMENT — there is no new primary navigation item: `/news`
 * links here, and each topic hub previews its own Collections. `?offset=` is a
 * query canonical to it, never an entry of its own; there is no
 * `/collections/latest`, `popular` or `featured`, and `/library/collections`
 * stays absent (see LIBRARY_SURFACES).
 */
const COLLECTIONS: readonly ShellRoute[] = Object.freeze([
  Object.freeze({
    key: 'collections',
    label: 'news.collections',
    path: '/collections',
    placements: Object.freeze([] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'eligible' as const,
  }),
]);

/** The routes the shell itself delivers. */
const SHELL: readonly ShellRoute[] = Object.freeze([
  Object.freeze({
    key: 'articles',
    label: 'nav.articles',
    path: '/library/articles',
    placements: Object.freeze(['footer-utility'] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'excluded' as const,
  }),
  Object.freeze({
    key: 'contact',
    label: 'nav.contact',
    path: '/contact',
    placements: Object.freeze(['footer-utility'] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'excluded' as const,
  }),
  Object.freeze({
    key: 'feedback',
    label: 'nav.feedback',
    path: '/feedback',
    placements: Object.freeze(['footer-utility'] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'excluded' as const,
  }),
  Object.freeze({
    key: 'volunteer',
    label: 'nav.volunteer',
    path: '/volunteer',
    placements: Object.freeze([] as const),
    visibility: 'public' as const,
    availability: 'reserved' as const,
    indexing: 'excluded' as const,
  }),
  Object.freeze({
    key: 'home',
    label: 'nav.home',
    path: '',
    placements: Object.freeze([] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'eligible' as const,
  }),
  /**
   * The canonical taxonomy browser (ROUTE_MAP.md §3.1), delivered by Phase 17
   * because Topic search results must be navigable into `/topics/{slug}`
   * (DELIVERY_PLAN.md Phase 17) and a result that led nowhere would be the dead
   * navigation §5.2 prohibits. It composes only owners that already exist.
   */
  Object.freeze({
    key: 'topics',
    label: 'nav.topics',
    path: '/topics',
    placements: Object.freeze(['footer-utility'] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'eligible' as const,
  }),
  Object.freeze({
    key: 'sitemap',
    label: 'nav.sitemap',
    path: '/sitemap',
    placements: Object.freeze(['footer-utility'] as const),
    visibility: 'public' as const,
    availability: 'delivered' as const,
    indexing: 'eligible' as const,
  }),
]);

/** THE registry. */
export const SHELL_ROUTES: readonly ShellRoute[] = Object.freeze([
  ...SHELL,
  ...PRIMARY,
  ...UTILITY,
  ...LIBRARY,
  ...WATCH,
  ...LISTEN,
  ...MEDIA,
  ...NEWS,
  ...EVENTS,
  ...COLLECTIONS,
  ...GLOBAL,
  ...exploreRoutes(),
  ...LEGAL,
]);

/* ===========================================================================
 * Views
 * ========================================================================= */

/** Every route in a placement, in registry order. */
export function routesIn(placement: Placement): readonly ShellRoute[] {
  return SHELL_ROUTES.filter((route) => route.placements.includes(placement));
}

/** Every LINKABLE route in a placement. What a navigation renders. */
export function linksIn(placement: Placement): readonly AvailableRoute[] {
  return routesIn(placement).filter(isAvailable);
}

/** One route by key, or `null`. */
export function routeByKey(key: string): ShellRoute | null {
  return SHELL_ROUTES.find((route) => route.key === key) ?? null;
}

/**
 * The AVAILABLE route a page is rendering, by key.
 *
 * Throws rather than returning `null`, because every caller is a route that
 * knows its own registry key: a miss is a typo or a deleted entry, not a
 * runtime condition. Failing here surfaces it as a build error on the page that
 * lost its entry, instead of as a page that quietly stopped emitting a
 * canonical URL.
 */
export function requireRoute(key: string): AvailableRoute {
  const route = routeByKey(key);

  if (route === null) throw new Error(`No shell route is registered for "${key}".`);
  if (!isAvailable(route)) {
    throw new Error(`Shell route "${key}" is deferred and has no path to render.`);
  }

  return route;
}

/**
 * Every route eligible to appear in a machine sitemap.
 *
 * Eligibility alone publishes nothing: the sitemap routes additionally require
 * public indexing to be switched on, which the pre-adoption posture leaves off
 * (ROUTE_MAP.md §9.5).
 */
export function indexableRoutes(): readonly AvailableRoute[] {
  return SHELL_ROUTES.filter(
    (route): route is AvailableRoute =>
      isAvailable(route) && route.indexing === 'eligible',
  );
}
