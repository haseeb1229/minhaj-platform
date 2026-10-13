import type { FatwaSearchRecord } from '@minhaj/contracts/fatwa';
import { SEARCH_SUMMARY_MAX_LENGTH, type SearchHit } from '@minhaj/contracts/search';

/**
 * How a `fatwa` search result is presented — PURE (Phase 20).
 *
 * The result unit is the published ruling, and what a result SHOWS is read
 * fresh from Fatwa's public reader rather than from the index: the CURRENT
 * published revision's title and the opening of its separately written,
 * anonymised public question. Until the indexer re-projects a corrected ruling,
 * its indexed title and summary are the superseded revision's words; and until
 * it removes a withdrawn ruling, the index still holds it. So:
 *
 *   - a hit whose ruling is public now shows the current title and public
 *     question, in the ruling's own language;
 *   - a hit whose ruling is no longer public is OMITTED.
 *
 * There is no private question anywhere on this path: the record has no field
 * that could carry one.
 */

export interface FatwaHitDisplay {
  readonly title: string;
  /** The current public question's opening, cut to the summary bound. */
  readonly text: string;
  /** The ruling's content language. */
  readonly language: string;
  readonly slug: string;
}

/** The projection's own summary bound, cut by code point so no character is halved. */
function bounded(text: string): string {
  const points = [...text];
  return points.length <= SEARCH_SUMMARY_MAX_LENGTH
    ? text
    : points.slice(0, SEARCH_SUMMARY_MAX_LENGTH).join('');
}

/** What each `fatwa` hit displays, keyed by the ruling id; absent means not public now. */
export function fatwaHitDisplays(
  hits: readonly SearchHit[],
  records: readonly FatwaSearchRecord[],
): ReadonlyMap<string, FatwaHitDisplay> {
  const current = new Map(records.map((record) => [record.fatwaId, record]));
  const displays = new Map<string, FatwaHitDisplay>();
  for (const hit of hits) {
    if (hit.kind !== 'fatwa') continue;
    const record = current.get(hit.resourceId);
    if (record === undefined) continue;
    displays.set(hit.resourceId, {
      title: record.title,
      text: bounded(record.publicQuestion),
      language: record.language,
      slug: record.slug,
    });
  }
  return displays;
}

/** The ruling ids of a page's `fatwa` hits — one batch for the whole page. */
export function fatwaHitIds(hits: readonly SearchHit[]): readonly string[] {
  return [
    ...new Set(hits.filter((hit) => hit.kind === 'fatwa').map((hit) => hit.resourceId)),
  ];
}
