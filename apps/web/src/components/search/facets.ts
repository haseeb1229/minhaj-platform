import { SEARCH_KINDS, type SearchKind } from '@minhaj/contracts/search';

import type { PresenceSignal } from '@/shell/presence';

/**
 * THE RESULT-TYPE FACETS ON THE SEARCH PAGE (R2).
 *
 * The kinds a visitor most often narrows to, in reading order — scripture,
 * then knowledge, then media, then people and pages — each offered ONLY while
 * its domain has published content (the shell's presence evidence), so no
 * facet leads to a type that cannot have a result. The kind already chosen is
 * always offered, whatever the evidence, so the current choice stays visible.
 * Every other kind remains in the form's full type list.
 *
 * NO INVENTED COUNTS. The index reports one total for the query as asked, so
 * the CURRENT facet carries that figure and the others carry none.
 */
const FACETS: readonly {
  readonly kind: SearchKind;
  readonly requires: PresenceSignal | null;
}[] = [
  { kind: 'quran-ayah', requires: 'quran' },
  { kind: 'hadith', requires: 'hadith' },
  { kind: 'fatwa', requires: 'fatwa' },
  { kind: 'work', requires: 'books' },
  { kind: 'magazine-issue', requires: 'magazines' },
  { kind: 'article', requires: 'articles' },
  { kind: 'news-article', requires: 'news' },
  { kind: 'video', requires: 'watch' },
  { kind: 'audio', requires: 'listen' },
  { kind: 'course', requires: 'learn' },
  { kind: 'person', requires: null },
  { kind: 'page', requires: null },
];

/** The facet kinds to offer, given the presence evidence and the chosen type. */
export function facetKinds(
  signals: ReadonlySet<PresenceSignal>,
  current: string,
): readonly SearchKind[] {
  const offered = FACETS.filter(
    (facet) => facet.requires === null || signals.has(facet.requires),
  ).map((facet) => facet.kind);
  const chosen = SEARCH_KINDS.find((kind) => kind === current);
  return chosen === undefined || offered.includes(chosen)
    ? offered
    : [...offered, chosen];
}

/**
 * The figure the current facet carries: the total, or the ceiling with a plus
 * when more matched than any visitor may page to — in the interface's numerals.
 */
export function facetCount(
  results: { readonly total: number; readonly capped: boolean },
  ceiling: number,
  locale: string,
): string {
  const format = new Intl.NumberFormat(locale);
  return results.capped ? `${format.format(ceiling)}+` : format.format(results.total);
}
