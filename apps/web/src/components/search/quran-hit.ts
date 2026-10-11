import type { AyahSearchRecord } from '@minhaj/contracts/quran';
import { SEARCH_SUMMARY_MAX_LENGTH, type SearchHit } from '@minhaj/contracts/search';

/**
 * How a `quran-ayah` search result is presented — PURE (Phase 18 §4).
 *
 * The result unit is the canonical citation. Its canonical Arabic is indexed as
 * the Ayah's `ar` document and nothing else is; each public translation or
 * transliteration language is a SEPARATE document of the same result. So only
 * Arabic is presented as the Arabic text, and every other language is labelled
 * as a translation or transliteration layer in that language — a translation's
 * words are never presented as the Quran's Arabic.
 *
 * The TEXT shown is never the index's summary: it is read fresh from the
 * owner's current records (`quranHitDisplays`).
 */

/** Which layer a Quran result's text is. */
export function quranHitLayer(textLanguage: string): 'arabic' | 'layer' {
  return textLanguage === 'ar' ? 'arabic' : 'layer';
}

/**
 * The citation a Quran result names. The index carries the Ayah's identity as
 * `"{surah}:{ayah}"`; anything else is not a citation and is not presented as
 * one. The numbers are only shape-checked here — the owner decided the result
 * is public, and its address came from the owner.
 */
export function citationOfResource(
  resourceId: string,
): { readonly surah: number; readonly ayah: number } | null {
  const match = /^([1-9][0-9]{0,2}):([1-9][0-9]{0,2})$/.exec(resourceId);
  return match === null ? null : { surah: Number(match[1]), ayah: Number(match[2]) };
}

/* ===========================================================================
 * What a Quran result DISPLAYS — always current, never the index's summary
 * ========================================================================= */

/** What one `quran-ayah` result shows, and as which layer. */
export interface QuranHitDisplay {
  /** `arabic` is the canonical text; `layer` a public translation or transliteration. */
  readonly layer: 'arabic' | 'layer';
  /** The language the text is in: `ar` for the canonical text. */
  readonly language: string;
  readonly text: string;
}

/** Identifies one hit on a page — an Ayah may answer in more than one language. */
export function quranHitKey(hit: Pick<SearchHit, 'resourceId' | 'textLanguage'>): string {
  return `${hit.resourceId}\u0000${hit.textLanguage.toLowerCase()}`;
}

/** The projection's own summary bound, cut by code point so no character is halved. */
function bounded(text: string): string {
  const points = [...text];
  return points.length <= SEARCH_SUMMARY_MAX_LENGTH
    ? text
    : points.slice(0, SEARCH_SUMMARY_MAX_LENGTH).join('');
}

const bySlug = (
  a: AyahSearchRecord['layers'][number],
  b: AyahSearchRecord['layers'][number],
) =>
  (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0) ||
  (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);

/**
 * The text each `quran-ayah` hit DISPLAYS, from the owner's CURRENT public
 * records — never from the index (Phase 18 §4).
 *
 * WHY. Search withholds per RESOURCE: an Ayah stays public when one of its
 * layer documents is withdrawn, so until the indexer re-projects it, a hit can
 * carry an archived translation's words or a superseded canonical text in its
 * indexed summary. The index decides only WHICH Ayat match; what is shown is
 * read fresh:
 *
 *   - an `ar` hit shows the CURRENT canonical text;
 *   - another language shows the first CURRENT public layer text in that
 *     language, in deterministic work-slug order, matched case-insensitively;
 *   - if no public layer in that language remains, the current canonical text,
 *     labelled as the Arabic — never the withdrawn layer's words;
 *   - a hit whose Ayah has no current record is not public now, and is OMITTED.
 *
 * Every text is cut to the projection's summary bound by code point.
 */
export function quranHitDisplays(
  hits: readonly SearchHit[],
  records: readonly AyahSearchRecord[],
): ReadonlyMap<string, QuranHitDisplay> {
  const current = new Map(
    records.map((record) => [`${record.surah}:${record.ayah}`, record]),
  );
  const displays = new Map<string, QuranHitDisplay>();

  for (const hit of hits) {
    if (hit.kind !== 'quran-ayah') continue;
    const ref = citationOfResource(hit.resourceId);
    const record = ref === null ? undefined : current.get(`${ref.surah}:${ref.ayah}`);
    if (record === undefined) continue;

    const canonical: QuranHitDisplay = {
      layer: 'arabic',
      language: 'ar',
      text: bounded(record.text),
    };
    const language = hit.textLanguage.toLowerCase();
    const layer =
      quranHitLayer(language) === 'arabic'
        ? undefined
        : [...record.layers]
            .sort(bySlug)
            .find((entry) => entry.languageCode.toLowerCase() === language);

    displays.set(
      quranHitKey(hit),
      layer === undefined
        ? canonical
        : { layer: 'layer', language: layer.languageCode, text: bounded(layer.text) },
    );
  }
  return displays;
}

/** The citations of a page's `quran-ayah` hits — one batch for the whole page. */
export function quranHitRefs(
  hits: readonly SearchHit[],
): readonly { readonly surah: number; readonly ayah: number }[] {
  const refs = new Map<string, { surah: number; ayah: number }>();
  for (const hit of hits) {
    if (hit.kind !== 'quran-ayah') continue;
    const ref = citationOfResource(hit.resourceId);
    if (ref !== null) refs.set(`${ref.surah}:${ref.ayah}`, ref);
  }
  return [...refs.values()];
}
