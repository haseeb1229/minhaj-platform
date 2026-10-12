import type { HadithSearchRecord } from '@minhaj/contracts/hadith';
import { SEARCH_SUMMARY_MAX_LENGTH, type SearchHit } from '@minhaj/contracts/search';

/**
 * How a `hadith` search result is presented — PURE (Phase 19).
 *
 * The result unit is the public citation. Its original text is indexed in its
 * own language, and each public translation language is a SEPARATE document of
 * the same result. So only the original is presented as the original text, and
 * every other language is labelled as a translation in that language — a
 * translation's words are never presented as the Hadith's original.
 *
 * The TEXT shown is never the index's summary: it is read fresh from the
 * owner's current public records (`hadithHitDisplays`).
 */

/** What one `hadith` result shows, and as which layer. */
export interface HadithHitDisplay {
  /** `original` is the sourced text; `translation` a public translation. */
  readonly layer: 'original' | 'translation';
  /** The language the text is in. */
  readonly language: string;
  readonly text: string;
  /** The citation the result names, from the CURRENT record. */
  readonly collectionSlug: string;
  readonly number: number;
}

/** Identifies one hit on a page — a citation may answer in more than one language. */
export function hadithHitKey(
  hit: Pick<SearchHit, 'resourceId' | 'textLanguage'>,
): string {
  return `${hit.resourceId}\u0000${hit.textLanguage.toLowerCase()}`;
}

/** The projection's own summary bound, cut by code point so no character is halved. */
function bounded(text: string): string {
  const points = [...text];
  return points.length <= SEARCH_SUMMARY_MAX_LENGTH
    ? text
    : points.slice(0, SEARCH_SUMMARY_MAX_LENGTH).join('');
}

/**
 * The text each `hadith` hit DISPLAYS, from the owner's CURRENT public records
 * — never from the index.
 *
 * WHY. Until the indexer re-projects a citation, its indexed summary can carry
 * a withdrawn translation's words or a superseded original. The index decides
 * only WHICH citations match; what is shown is read fresh:
 *
 *   - a hit in the original's language shows the CURRENT original text;
 *   - another language shows the first CURRENT public translation in that
 *     language, matched case-insensitively;
 *   - if no public translation in that language remains, the current original,
 *     labelled as the original — never the withdrawn translation's words;
 *   - a hit whose citation has no current public record is OMITTED.
 *
 * Every text is cut to the projection's summary bound by code point.
 */
export function hadithHitDisplays(
  hits: readonly SearchHit[],
  records: readonly HadithSearchRecord[],
): ReadonlyMap<string, HadithHitDisplay> {
  const current = new Map(records.map((record) => [record.citationId, record]));
  const displays = new Map<string, HadithHitDisplay>();

  for (const hit of hits) {
    if (hit.kind !== 'hadith') continue;
    const record = current.get(hit.resourceId);
    if (record === undefined) continue;

    const citation = { collectionSlug: record.collectionSlug, number: record.number };
    const original: HadithHitDisplay = {
      layer: 'original',
      language: record.textLanguage,
      text: bounded(record.text),
      ...citation,
    };
    const language = hit.textLanguage.toLowerCase();
    const translation =
      language === record.textLanguage.toLowerCase()
        ? undefined
        : record.translations.find(
            (entry) => entry.languageCode.toLowerCase() === language,
          );

    displays.set(
      hadithHitKey(hit),
      translation === undefined
        ? original
        : {
            layer: 'translation',
            language: translation.languageCode,
            text: bounded(translation.text),
            ...citation,
          },
    );
  }
  return displays;
}

/** The citation ids of a page's `hadith` hits — one batch for the whole page. */
export function hadithHitIds(hits: readonly SearchHit[]): readonly string[] {
  return [
    ...new Set(hits.filter((hit) => hit.kind === 'hadith').map((hit) => hit.resourceId)),
  ];
}
