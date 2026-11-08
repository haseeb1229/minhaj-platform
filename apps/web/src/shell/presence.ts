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
 * navigation: from Rebaseline R1 until the owner's direction of 2026-11-08 it
 * did, and hid every area without published content; the navigation is now
 * unconditional (`@/shell/menus`, INFORMATION_ARCHITECTURE.md §2.2).
 *
 * NOTHING HERE HIDES A ROUTE. Every route stays reachable by its address and
 * answers with its own honest state.
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
