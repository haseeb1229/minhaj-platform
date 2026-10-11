import {
  citationOf,
  parseCitation,
  type AyahSearchRecord,
  type QuranPublicReaderPort,
  type QuranRef,
} from '@minhaj/contracts/quran';
import {
  SEARCH_SUMMARY_MAX_LENGTH,
  type SearchDocumentSource,
  type SearchScopeSource,
  type SearchTargetResolver,
} from '@minhaj/contracts/search';

/**
 * Quran's search projection — one scope per public Ayah, identified by its
 * canonical citation `"{surah}:{ayah}"` (Phase 18 §4).
 *
 * THE CITATION IS THE RESULT. An Ayah's canonical Arabic and each public
 * translation or transliteration of it are documents of ONE result, one per
 * text language, so several layered works matching never multiply the
 * canonical result and a translation's words are never presented as the
 * Arabic:
 *
 *   - `ar` — the canonical text, with `ar` as its content language;
 *   - one document per other language of the Ayah's PUBLIC layer texts, their
 *     texts in the reader's deterministic work-slug order, summarised by the
 *     first of them and carrying that language as its content language.
 *
 * A layer whose own language is Arabic is matched in the `ar` document's body,
 * after the canonical text, and is never its summary: the one Arabic a result
 * shows is the canonical text.
 *
 * WHAT IS NOT HERE. No Tafsir body — commentary is navigated from the Ayah, not
 * matched as if it were the Ayah — no Surah name, no work name and no audio.
 * Every title is the citation itself, which is the only label an Ayah has that
 * no translation or naming convention owns.
 *
 * NOTHING IS NORMALISED. Texts are handed to Search exactly as the public
 * reader returns them; the summary bound cuts by code point and never adds a
 * character. Visibility is the reader's: nothing at all while the corpus is
 * inactive, and only published layers with a registered source.
 */

const CANONICAL_LANGUAGE = 'ar';

/** The summary bound, cut by code point so no character is ever halved. */
function bounded(text: string): string {
  const points = [...text];
  return points.length <= SEARCH_SUMMARY_MAX_LENGTH
    ? text
    : points.slice(0, SEARCH_SUMMARY_MAX_LENGTH).join('');
}

/** Summary from the first text; the body carries whatever the summary does not. */
function texts(first: string, rest: readonly string[]) {
  const summary = bounded(first);
  const body = [...(summary === first ? [] : [first]), ...rest].join('\n\n');
  return { summary, body };
}

function documents(record: AyahSearchRecord): SearchDocumentSource[] {
  const ref = { surah: record.surah, ayah: record.ayah };
  const resourceId = citationOf(ref);
  const topicIds = [...record.topicIds];

  const layers = [...record.layers].sort(
    (a, b) =>
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0) ||
      (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0),
  );

  // Grouped by language case-insensitively — the index stores text languages
  // folded, so `en-GB` and `en-gb` would otherwise be two documents in one.
  const byLanguage = new Map<string, { code: string; texts: string[] }>();
  for (const layer of layers) {
    const key = layer.languageCode.toLowerCase();
    const group = byLanguage.get(key) ?? { code: layer.languageCode, texts: [] };
    group.texts.push(layer.text);
    byLanguage.set(key, group);
  }

  const arabicLayers = byLanguage.get(CANONICAL_LANGUAGE)?.texts ?? [];
  byLanguage.delete(CANONICAL_LANGUAGE);

  const document = (
    textLanguage: string,
    content: { summary: string; body: string },
  ): SearchDocumentSource => ({
    kind: 'quran-ayah',
    resourceId,
    textLanguage,
    contentLanguage: textLanguage,
    title: resourceId,
    summary: content.summary,
    body: content.body,
    year: null,
    topicIds,
  });

  return [
    document(CANONICAL_LANGUAGE, texts(record.text, arabicLayers)),
    ...[...byLanguage.values()].flatMap((group) => {
      const [first, ...rest] = group.texts;
      return first === undefined ? [] : [document(group.code, texts(first, rest))];
    }),
  ];
}

/** `/quran/surah/{surah}/{ayah}` — the Ayah's permanent, locale-free address. */
export function ayahPath(ref: QuranRef): string {
  return `/quran/surah/${ref.surah}/${ref.ayah}`;
}

export function createQuranSearchProjection(reader: QuranPublicReaderPort): {
  readonly source: SearchScopeSource;
  readonly target: SearchTargetResolver;
} {
  return {
    source: {
      async project(id) {
        const ref = parseCitation(id);
        if (ref === null) return null;
        const record = await reader.searchAyah(ref);
        return record === null
          ? null
          : { stamp: record.stamp, documents: documents(record) };
      },

      async list({ after, limit }) {
        const from = after === null ? null : parseCitation(after);
        // The cursor is always a citation this source produced; anything else
        // is a defect, and guessing a position would skip or repeat scopes.
        if (after !== null && from === null)
          throw new Error('Quran search enumeration cursor is not a citation.');
        const scopes = await reader.searchAyahScopes(from, limit);
        return scopes.map((scope) => ({ id: citationOf(scope.ref), stamp: scope.stamp }));
      },
    },

    // Quran's own public predicate answers which Ayat are public NOW — the
    // corpus active and the Ayah present — so a stale projection of a corpus
    // that is no longer public is withheld, and an id that is not a citation
    // is simply absent.
    async target(ids) {
      const refs = new Map<string, QuranRef>();
      for (const id of ids) {
        const ref = parseCitation(id);
        if (ref !== null) refs.set(citationOf(ref), ref);
      }
      if (refs.size === 0) return new Map();
      const visible = await reader.publicAyahTargets([...refs.values()]);
      return new Map(visible.map((ref) => [citationOf(ref), ayahPath(ref)]));
    },
  };
}
