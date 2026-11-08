/**
 * THE PRESENTATION POLICY — what the shell ADVERTISES (R1, regrouped by R2).
 *
 * The route registry (`registry.ts`) records which routes EXIST: delivered,
 * reserved or deferred. This module decides which of them the header, the
 * footer and the calls to action PROMOTE, and it decides from evidence rather
 * than from the existence of a route: a destination is advertised only while
 * the platform holds published content for it, or a service is genuinely open
 * (owner direction 2026-11-06 — "real content before empty capability").
 *
 * R2 — GROUPED, NOT RANKED. R1 kept the six best-ranked destinations in one bar
 * and hid the rest under "More". The owner found that too thin for the breadth
 * of the organisation, so the header is now six fixed groups — Quran,
 * Knowledge, Watch & Listen, Learn, News & Events, About MQI — each listing
 * only its PRESENT destinations, in a fixed order. A group with nothing present
 * is omitted whole. Nothing is capped, and nothing absent is advertised.
 *
 * NOTHING HERE HIDES A ROUTE. Every route stays reachable by its address, by
 * search and by a link inside content, and an unavailable one still answers
 * with its honest unavailable state. Only promotion is conditional.
 *
 * PURE AND DETERMINISTIC. The evidence arrives as a `PresenceSnapshot` built
 * per request by `@/composition/presence` from each owning context's own public
 * reads; this module reads nothing, so the policy is unit-tested exhaustively
 * and a new destination is one entry below — never another architecture change.
 *
 * FAIL CLOSED. An unknown snapshot (the reads failed, or there is no database at
 * build time) advertises only the destinations that need no evidence.
 */

/** One piece of public evidence the policy may require. */
export const PRESENCE_SIGNALS = Object.freeze([
  /**
   * A Quran corpus a visitor may read is active: an approved one, or — only on
   * a deployment that explicitly admits it — a reference preview. Never a
   * fixture.
   */
  'quran',
  /** The active Quran corpus is a reference preview (it needs attribution). */
  'quranReference',
  /** An approved (not fixture) Hadith corpus is active. */
  'hadith',
  /**
   * At least one public Library work is classified under the Hadith Topic —
   * MQI's own hadith works, which the Hadith landing presents without a corpus.
   */
  'hadithWorks',
  /** At least one published Library work, periodical or article. */
  'library',
  /** At least one published Library work (a book). */
  'books',
  /** At least one published magazine. */
  'magazines',
  /** At least one published research title. */
  'research',
  /** At least one published encyclopedia. */
  'encyclopedias',
  /** At least one published article. */
  'articles',
  /** At least one published video. */
  'watch',
  /** At least one published video series. */
  'series',
  /** At least one published playlist. */
  'playlists',
  /** At least one published audio track. */
  'listen',
  /** At least one published course. */
  'learn',
  /** At least one published learning path. */
  'paths',
  /** Live learning is approved and a class is scheduled. */
  'live',
  /** Live learning is approved and a teacher is listed. */
  'teachers',
  /** An approved Fatwa service is active and holds a published ruling. */
  'fatwa',
  /** At least one published news item. */
  'news',
  /** At least one published press release. */
  'press',
  /** At least one published Event. */
  'events',
  /** At least one published Collection. */
  'collections',
  /** At least one published leadership/contributor profile. */
  'people',
  /** At least one country of presence is published. */
  'presence',
  /** At least one published Centre. */
  'centres',
  /** At least one published help article. */
  'help',
  /** At least one membership type is open for application. */
  'membership',
  /** Online giving is open (provider + activation) and a campaign is published. */
  'giving',
] as const);

export type PresenceSignal = (typeof PRESENCE_SIGNALS)[number];

export interface PresenceSnapshot {
  /** The signals for which evidence was found. */
  readonly signals: ReadonlySet<PresenceSignal>;
  /** The route bindings (`/explore/about/introduction`, `/legal/privacy`) of every published Page. */
  readonly publishedPages: ReadonlySet<string>;
}

/** Nothing is known: only evidence-free destinations are advertised. */
export const UNKNOWN_PRESENCE: PresenceSnapshot = Object.freeze({
  signals: new Set<PresenceSignal>(),
  publishedPages: new Set<string>(),
});

export function hasSignal(snapshot: PresenceSnapshot, signal: PresenceSignal): boolean {
  return snapshot.signals.has(signal);
}

/**
 * A destination the shell may promote: a registry route behind a signal (or
 * none), or a published Page by its route binding. Its words live in the
 * `shell` catalogue under `nav.items.{id}` — `title`, and a one-line
 * `description` for the navigation panels.
 */
export type NavItem =
  | {
      readonly kind: 'route';
      readonly id: string;
      /** Registry key of the route it opens. */
      readonly route: string;
      /** The evidence it requires, or `null` when it is always promoted. */
      readonly requires: PresenceSignal | null;
    }
  | {
      readonly kind: 'page';
      readonly id: string;
      /** The published Page's route binding, which is also its address. */
      readonly binding: string;
    };

const route = (id: string, key: string, requires: PresenceSignal | null): NavItem =>
  Object.freeze({ kind: 'route', id, route: key, requires });
const page = (id: string, binding: string): NavItem =>
  Object.freeze({ kind: 'page', id, binding });

/**
 * EVERY DESTINATION THE SHELL CAN NAME, once. The groups below refer to these
 * by id, so a destination has one rule wherever it appears.
 */
const ITEMS = Object.freeze({
  // Quran — a separate domain, promoted only with a readable corpus.
  quran: route('quran', 'quran', 'quran'),
  surahs: route('surahs', 'quran.surah', 'quran'),
  juz: route('juz', 'quran.juz', 'quran'),
  translations: route('translations', 'quran.translations', 'quran'),
  quranSearch: route('quranSearch', 'quran.search', 'quran'),
  // Knowledge — the Library's catalogue and the religious reference services.
  library: route('library', 'library', 'library'),
  books: route('books', 'library.books', 'books'),
  magazines: route('magazines', 'library.magazines', 'magazines'),
  research: route('research', 'library.research', 'research'),
  encyclopedias: route('encyclopedias', 'library.encyclopedias', 'encyclopedias'),
  articles: route('articles', 'articles', 'articles'),
  hadith: route('hadith', 'hadith', 'hadith'),
  // The same landing, named for what it holds while no corpus is active.
  hadithWorks: route('hadithWorks', 'hadith', 'hadithWorks'),
  fatwa: route('fatwa', 'fatwa', 'fatwa'),
  topics: route('topics', 'topics', null),
  // Watch & Listen.
  watch: route('watch', 'watch', 'watch'),
  series: route('series', 'watch.series', 'series'),
  playlists: route('playlists', 'watch.playlists', 'playlists'),
  listen: route('listen', 'listen', 'listen'),
  // Learn.
  learn: route('learn', 'learn', 'learn'),
  paths: route('paths', 'learn.paths', 'paths'),
  live: route('live', 'learn.live', 'live'),
  teachers: route('teachers', 'learn.teachers', 'teachers'),
  // News & Events.
  news: route('news', 'news-events', 'news'),
  press: route('press', 'news.press-releases', 'press'),
  events: route('events', 'events', 'events'),
  collections: route('collections', 'collections', 'collections'),
  // About MQI — the organisation needs no record to exist; its pages do.
  about: route('about', 'explore', null),
  introduction: page('introduction', '/explore/about/introduction'),
  founder: page('founder', '/explore/shaykh-ul-islam/biography'),
  leadership: route('leadership', 'explore.leadership', 'people'),
  departments: page('departments', '/explore/organization/departments'),
  forums: page('forums', '/explore/organization/forums'),
  history: page('history', '/explore/about/history'),
  global: route('global', 'global', 'presence'),
  centres: route('centres', 'find-a-centre', 'centres'),
  // Taking part.
  help: route('help', 'contact-help', 'help'),
  contact: page('contact', '/contact'),
  myMinhaj: route('myMinhaj', 'my-minhaj', null),
  membership: route('membership', 'membership', 'membership'),
  donate: route('donate', 'donate', 'giving'),
} satisfies Record<string, NavItem>);

type ItemId = keyof typeof ITEMS;

/** The six header groups, in display order. */
export const NAVIGATION_GROUP_IDS = Object.freeze([
  'quran',
  'knowledge',
  'watch',
  'learn',
  'news',
  'about',
] as const);

export type NavigationGroupId = (typeof NAVIGATION_GROUP_IDS)[number];

/**
 * THE HEADER GROUPS. Each group's FIRST item is its landing; the rest are the
 * ways into it a visitor most often wants. Quran and Hadith stay separate
 * destinations: Hadith sits with the reference services in Knowledge because
 * it has no corpus of its own yet, never inside the Quran group.
 */
const GROUPS: Readonly<Record<NavigationGroupId, readonly ItemId[]>> = Object.freeze({
  quran: ['quran', 'surahs', 'juz', 'translations', 'quranSearch'],
  knowledge: [
    'library',
    'books',
    'magazines',
    'research',
    'encyclopedias',
    'articles',
    'hadith',
    'hadithWorks',
    'fatwa',
  ],
  watch: ['watch', 'series', 'playlists', 'listen'],
  learn: ['learn', 'paths', 'live', 'teachers'],
  news: ['news', 'press', 'events', 'collections'],
  about: [
    'about',
    'introduction',
    'founder',
    'leadership',
    'departments',
    'forums',
    'history',
    'global',
    'centres',
  ],
});

/** The thin strip above the header: the organisation and how to reach it. */
const UTILITY: readonly ItemId[] = Object.freeze(['about', 'help', 'contact', 'centres']);

/** The six footer columns, in display order. */
export const FOOTER_GROUP_IDS = Object.freeze([
  'quranKnowledge',
  'library',
  'watchListen',
  'newsEvents',
  'about',
  'participate',
] as const);

export type FooterGroupId = (typeof FOOTER_GROUP_IDS)[number];

/**
 * THE FOOTER — six curated columns, not the legacy sitemap. News has a column
 * of its own and Learn shares one with the other ways to take part, so every
 * header group is reachable from the footer too.
 */
const FOOTER: Readonly<Record<FooterGroupId, readonly ItemId[]>> = Object.freeze({
  quranKnowledge: ['quran', 'surahs', 'hadith', 'hadithWorks', 'fatwa', 'topics'],
  library: ['library', 'books', 'magazines', 'research', 'encyclopedias', 'articles'],
  watchListen: ['watch', 'series', 'playlists', 'listen'],
  newsEvents: ['news', 'press', 'events', 'collections'],
  about: [
    'about',
    'introduction',
    'founder',
    'leadership',
    'departments',
    'global',
    'centres',
  ],
  participate: [
    'learn',
    'paths',
    'live',
    'teachers',
    'myMinhaj',
    'membership',
    'donate',
    'help',
    'contact',
  ],
});

/** The published legal documents, in their fixed order. */
const LEGAL: readonly NavItem[] = Object.freeze([
  page('privacy', '/legal/privacy'),
  page('terms', '/legal/terms'),
  page('cookies', '/legal/cookies'),
  page('accessibility', '/legal/accessibility'),
]);

/** Whether this snapshot lets the shell promote an item. */
export function shows(snapshot: PresenceSnapshot, item: NavItem): boolean {
  if (item.kind === 'page') return snapshot.publishedPages.has(item.binding);
  return item.requires === null || hasSignal(snapshot, item.requires);
}

/**
 * The present items of a list, in its order — each ADDRESS once. Two items may
 * name one destination under different evidence (Hadith with its corpus,
 * "Hadith works" without one); where both are present the first is kept.
 */
function present(snapshot: PresenceSnapshot, ids: readonly ItemId[]): NavItem[] {
  const seen = new Set<string>();
  return ids
    .map((id) => ITEMS[id])
    .filter((item) => {
      if (!shows(snapshot, item)) return false;
      const target = item.kind === 'route' ? item.route : item.binding;
      if (seen.has(target)) return false;
      seen.add(target);
      return true;
    });
}

export interface NavigationGroup<Id extends string = NavigationGroupId> {
  /** Message key suffix: `nav.groups.{id}` (header) or `footer.groups.{id}`. */
  readonly id: Id;
  /** The present destinations, in the group's fixed order; never empty. */
  readonly items: readonly NavItem[];
}

/** The header's groups for this snapshot; a group with nothing present is omitted. */
export function navigationGroups(snapshot: PresenceSnapshot): readonly NavigationGroup[] {
  return NAVIGATION_GROUP_IDS.map((id) => ({
    id,
    items: present(snapshot, GROUPS[id]),
  })).filter((group) => group.items.length > 0);
}

/** The utility strip's links for this snapshot. */
export function utilityLinks(snapshot: PresenceSnapshot): readonly NavItem[] {
  return present(snapshot, UTILITY);
}

/** Whether Donate may be promoted at all — never while giving is closed. */
export function givingPromoted(snapshot: PresenceSnapshot): boolean {
  return hasSignal(snapshot, 'giving');
}

/** The footer columns for this snapshot, each with at least one link. */
export function footerGroups(
  snapshot: PresenceSnapshot,
): readonly NavigationGroup<FooterGroupId>[] {
  return FOOTER_GROUP_IDS.map((id) => ({
    id,
    items: present(snapshot, FOOTER[id]),
  })).filter((group) => group.items.length > 0);
}

/** The legal documents that are actually published. Labelled `legal.{id}`. */
export function legalLinks(snapshot: PresenceSnapshot): readonly NavItem[] {
  return LEGAL.filter((link) => shows(snapshot, link));
}

/** Every route key this policy can emit, for the registry test. */
export function policyRouteKeys(): readonly string[] {
  return Object.values(ITEMS).flatMap((item: NavItem) =>
    item.kind === 'route' ? [item.route] : [],
  );
}

/** Every Page binding this policy can emit, for the registry test. */
export function policyPageBindings(): readonly string[] {
  return [...Object.values(ITEMS), ...LEGAL].flatMap((item: NavItem) =>
    item.kind === 'page' ? [item.binding] : [],
  );
}

/** Why the shell promotes a route, for the read-only administration view. */
export type PromotionRule =
  | { readonly kind: 'always' }
  | { readonly kind: 'signal'; readonly signal: PresenceSignal }
  | { readonly kind: 'page'; readonly binding: string };

/**
 * The promotion rule for a registry route — by its key, or by its address when
 * the shell names it as a published Page — or `undefined` when the shell never
 * promotes it (it is still reachable by its address).
 */
export function promotionRuleOf(
  routeKey: string,
  path?: string,
): PromotionRule | undefined {
  for (const item of [...Object.values(ITEMS), ...LEGAL] as NavItem[]) {
    if (item.kind === 'route' && item.route === routeKey)
      return item.requires === null
        ? { kind: 'always' }
        : { kind: 'signal', signal: item.requires };
    if (item.kind === 'page' && path !== undefined && item.binding === path)
      return { kind: 'page', binding: item.binding };
  }
  return undefined;
}
