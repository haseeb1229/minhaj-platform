/**
 * THE PUBLIC PRESENCE SNAPSHOT — which areas hold published content, or an
 * open service, right now.
 *
 * The evidence is built per request by `@/composition/presence` from each
 * owning context's own public reads; this module only names the signals and
 * reads the snapshot, so it is pure and imports nothing.
 *
 * WHAT IT DECIDES, AND WHAT IT NO LONGER DOES. Pages use it to offer only what
 * can answer — the search page's result-type facets and its "browse instead"
 * links, the Quran text's licence attribution in the footer, and the
 * administration dashboard's status. It does NOT decide the header or footer
 * navigation as a whole: from Rebaseline R1 until the owner's direction of
 * 2026-11-08 it did, and hid every area without published content; the
 * navigation is now unconditional (`@/shell/menus`, INFORMATION_ARCHITECTURE.md
 * §2.2) — with ONE named exception below.
 *
 * HIDDEN UNTIL PUBLISHED (owner decision 2026-11-09, OPEN_DECISIONS.md §1.2
 * item 3). The Quran's Transliteration and word-by-word works are built but no
 * lawful source of either is recorded, so their routes are offered by the
 * menus and the footer only while a work of each is public (`ROUTE_SIGNALS`,
 * `routeOffered`) — the prerendered human sitemap never lists them — and the
 * routes themselves answer 404 until then. Every other route stays reachable by its address and answers
 * with its own honest state.
 *
 * FAIL CLOSED. A read that fails, or no database at all, contributes no
 * signal.
 */

/** One piece of public evidence a page may require. */
export const PRESENCE_SIGNALS = Object.freeze([
  /**
   * A Quran corpus a visitor may read is active: an approved one, or — only on
   * a deployment that explicitly admits it — a reference preview. Never a
   * fixture.
   */
  'quran',
  /** The active Quran corpus is a reference preview (it needs attribution). */
  'quranReference',
  /** At least one Quran Transliteration work is public (Quran Part 7). */
  'quranTransliteration',
  /** At least one Quran word-by-word work is public (Quran Part 7). */
  'quranWordByWord',
  /** An approved (not fixture) Hadith corpus is active. */
  'hadith',
  /** At least one published Library work, periodical or article. */
  'library',
  /** At least one published Library work (a book). */
  'books',
  /** At least one published magazine. */
  'magazines',
  /** At least one published article. */
  'articles',
  /** At least one published video. */
  'watch',
  /** At least one published audio track. */
  'listen',
  /** At least one published course. */
  'learn',
  /** Live learning is approved and a class is scheduled. */
  'live',
  /** An approved Fatwa service is active and holds a published ruling. */
  'fatwa',
  /** At least one published news item. */
  'news',
  /** At least one membership type is open for application. */
  'membership',
  /** Online giving is open (provider + activation) and a campaign is published. */
  'giving',
] as const);

export type PresenceSignal = (typeof PRESENCE_SIGNALS)[number];

export interface PresenceSnapshot {
  /** The signals for which evidence was found. */
  readonly signals: ReadonlySet<PresenceSignal>;
}

export function hasSignal(snapshot: PresenceSnapshot, signal: PresenceSignal): boolean {
  return snapshot.signals.has(signal);
}

/**
 * The registry routes offered ONLY while a signal holds — the hidden-until-
 * published study layers, and nothing else. A route absent here is offered
 * always.
 */
export const ROUTE_SIGNALS: Readonly<Record<string, PresenceSignal>> = Object.freeze({
  'quran.transliteration': 'quranTransliteration',
  'quran.word-by-word': 'quranWordByWord',
});

/** May the shell offer this registry route now? */
export function routeOffered(snapshot: PresenceSnapshot, routeKey: string): boolean {
  const signal = ROUTE_SIGNALS[routeKey];
  return signal === undefined || hasSignal(snapshot, signal);
}
