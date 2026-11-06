/**
 * THE PRESENTATION POLICY — what the shell ADVERTISES (Rebaseline R1).
 *
 * The route registry (`registry.ts`) records which routes EXIST: delivered,
 * reserved or deferred. This module decides which of them the header, the
 * footer and the calls to action PROMOTE, and it decides from evidence rather
 * than from the existence of a route: a destination is advertised only while
 * the platform holds published content for it, or a service is genuinely open
 * (owner direction 2026-11-06 — "real content before empty capability").
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
  /** An approved (not fixture) Quran corpus is active. */
  'quran',
  /** An approved (not fixture) Hadith corpus is active. */
  'hadith',
  /** At least one published Library work, periodical or article. */
  'library',
  /** At least one published video. */
  'watch',
  /** At least one published audio track. */
  'listen',
  /** At least one published course. */
  'learn',
  /** An approved Fatwa service is active and holds a published ruling. */
  'fatwa',
  /** At least one published news item. */
  'news',
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

/** A destination the shell may promote. */
export interface Destination {
  /** Registry key of the route it opens. */
  readonly route: string;
  /** Message key within the `shell` namespace. */
  readonly label: string;
  /** The evidence it requires, or `null` when it is always promoted. */
  readonly requires: PresenceSignal | null;
}

interface PrimaryDestination extends Destination {
  /** Lower keeps its place in the bar first when more than `PRIMARY_LIMIT` qualify. */
  readonly rank: number;
}

/**
 * THE PRIMARY DESTINATIONS, in DISPLAY order.
 *
 * Intent-led and content-led rather than a copy of the legacy sitemap: the
 * religious corpora first (when an approved corpus is active), then the
 * reading, watching and learning surfaces, then the organisation's news and
 * curated archives, and the organisation itself last. Quran and Hadith stay
 * separate top-level domains.
 */
const PRIMARY: readonly PrimaryDestination[] = Object.freeze([
  { route: 'quran', label: 'nav.quran', requires: 'quran', rank: 1 },
  { route: 'hadith', label: 'nav.hadith', requires: 'hadith', rank: 2 },
  { route: 'library', label: 'nav.library', requires: 'library', rank: 3 },
  { route: 'watch', label: 'nav.watch', requires: 'watch', rank: 4 },
  { route: 'learn', label: 'nav.learn', requires: 'learn', rank: 6 },
  { route: 'fatwa', label: 'nav.fatwa', requires: 'fatwa', rank: 7 },
  { route: 'news-events', label: 'nav.news', requires: 'news', rank: 5 },
  { route: 'collections', label: 'nav.collections', requires: 'collections', rank: 8 },
  // The organisation is always present: it needs no published record to exist.
  { route: 'explore', label: 'nav.about', requires: null, rank: 0 },
] satisfies PrimaryDestination[]);

/** At most this many destinations sit in the bar; the rest open under "More". */
export const PRIMARY_LIMIT = 6;

export interface PrimaryNavigation {
  /** The destinations shown directly, in display order. */
  readonly bar: readonly Destination[];
  /** Qualifying destinations beyond the limit, in display order. */
  readonly more: readonly Destination[];
}

function qualifies(snapshot: PresenceSnapshot, destination: Destination): boolean {
  return destination.requires === null || hasSignal(snapshot, destination.requires);
}

/** The header's primary navigation for this snapshot. */
export function primaryNavigation(snapshot: PresenceSnapshot): PrimaryNavigation {
  const qualified = PRIMARY.filter((destination) => qualifies(snapshot, destination));
  const kept = new Set(
    [...qualified]
      .sort((a, b) => a.rank - b.rank)
      .slice(0, PRIMARY_LIMIT)
      .map((destination) => destination.route),
  );
  const strip = ({ route, label, requires }: PrimaryDestination): Destination => ({
    route,
    label,
    requires,
  });
  return {
    bar: qualified.filter((d) => kept.has(d.route)).map(strip),
    more: qualified.filter((d) => !kept.has(d.route)).map(strip),
  };
}

/** Whether Donate may be promoted at all — never while giving is closed. */
export function givingPromoted(snapshot: PresenceSnapshot): boolean {
  return hasSignal(snapshot, 'giving');
}

/** A footer link: a registry route, or a published Page by its binding. */
export type FooterLink =
  | (Destination & { readonly kind: 'route' })
  | { readonly kind: 'page'; readonly binding: string; readonly label: string };

export interface FooterGroup {
  /** Message key of the group heading within the `shell` namespace. */
  readonly heading: string;
  readonly links: readonly FooterLink[];
}

const route = (
  r: string,
  label: string,
  requires: PresenceSignal | null,
): FooterLink => ({
  kind: 'route',
  route: r,
  label,
  requires,
});
const page = (binding: string, label: string): FooterLink => ({
  kind: 'page',
  binding,
  label,
});

/**
 * THE FOOTER — deliberate groups, not the legacy sitemap. Every link obeys the
 * same rule as the header: a route needs its evidence, a Page must be
 * published. An emptied group is dropped whole.
 */
const FOOTER: readonly FooterGroup[] = Object.freeze([
  {
    heading: 'footer.groups.discover',
    links: [
      route('quran', 'nav.quran', 'quran'),
      route('hadith', 'nav.hadith', 'hadith'),
      route('library', 'nav.library', 'library'),
      route('watch', 'nav.watch', 'watch'),
      route('listen', 'nav.listen', 'listen'),
      route('fatwa', 'nav.fatwa', 'fatwa'),
      route('news-events', 'nav.news', 'news'),
      route('events', 'nav.events', 'events'),
      route('collections', 'nav.collections', 'collections'),
      route('topics', 'nav.topics', null),
    ],
  },
  {
    heading: 'footer.groups.organisation',
    links: [
      route('explore', 'nav.about', null),
      page('/explore/about/introduction', 'explore.about.pages.introduction'),
      route('explore.leadership', 'explore.leadership.title', 'people'),
      route('global', 'nav.presence', 'presence'),
      route('find-a-centre', 'nav.findACentre', 'centres'),
    ],
  },
  {
    heading: 'footer.groups.participate',
    links: [
      route('learn', 'nav.learn', 'learn'),
      route('donate', 'nav.donate', 'giving'),
      route('my-minhaj', 'nav.myMinhaj', null),
      route('contact-help', 'nav.help', 'help'),
    ],
  },
] satisfies FooterGroup[]);

/** The published legal documents, in their fixed order. */
const LEGAL: readonly FooterLink[] = Object.freeze([
  page('/legal/privacy', 'legal.privacy'),
  page('/legal/terms', 'legal.terms'),
  page('/legal/cookies', 'legal.cookies'),
  page('/legal/accessibility', 'legal.accessibility'),
]);

function shown(snapshot: PresenceSnapshot, link: FooterLink): boolean {
  return link.kind === 'page'
    ? snapshot.publishedPages.has(link.binding)
    : qualifies(snapshot, link);
}

/** The footer groups for this snapshot, each with at least one link. */
export function footerGroups(snapshot: PresenceSnapshot): readonly FooterGroup[] {
  return FOOTER.map((group) => ({
    heading: group.heading,
    links: group.links.filter((link) => shown(snapshot, link)),
  })).filter((group) => group.links.length > 0);
}

/** The legal documents that are actually published. */
export function legalLinks(snapshot: PresenceSnapshot): readonly FooterLink[] {
  return LEGAL.filter((link) => shown(snapshot, link));
}

/** Every route key and page binding this policy can emit, for the registry test. */
export function policyRouteKeys(): readonly string[] {
  return [
    ...PRIMARY.map((d) => d.route),
    ...FOOTER.flatMap((g) => g.links).flatMap((l) =>
      l.kind === 'route' ? [l.route] : [],
    ),
  ];
}

/**
 * The promotion rule for a registry route: `null` when the policy always
 * promotes it, the signal it waits for, or `undefined` when the shell never
 * promotes it (it is still reachable by its address). For the read-only
 * administration view of the effective navigation.
 */
export function promotionRuleOf(routeKey: string): PresenceSignal | null | undefined {
  const primary = PRIMARY.find((destination) => destination.route === routeKey);
  if (primary !== undefined) return primary.requires;
  for (const group of FOOTER)
    for (const link of group.links)
      if (link.kind === 'route' && link.route === routeKey) return link.requires;
  return undefined;
}
