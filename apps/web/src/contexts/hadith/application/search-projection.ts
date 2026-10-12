import {
  hadithIdSchema,
  type HadithPublicReaderPort,
  type HadithSearchRecord,
} from '@minhaj/contracts/hadith';
import {
  SEARCH_SUMMARY_MAX_LENGTH,
  type SearchDocumentSource,
  type SearchScopeSource,
  type SearchTargetResolver,
} from '@minhaj/contracts/search';

/**
 * Hadith's search projection — one scope per PUBLIC CITATION, identified by
 * the citation's own GUID (Phase 19).
 *
 * THE CITATION IS THE RESULT. The record a citation names and each public
 * translation of it are documents of ONE result, one per text language, so
 * another edition's variant, a competing candidate or several translations
 * matching never multiply the result, and a translation's words are never
 * presented as the original:
 *
 *   - the record's original text, in its own text language;
 *   - one document per other language of the record's PUBLIC translations,
 *     their texts in the reader's deterministic order, summarised by the first
 *     of them and carrying that language as its content language.
 *
 * A translation whose language is the original's is matched in the original's
 * body, after the original text, and is never its summary: the one text in
 * that language a result shows is the record's own.
 *
 * WHAT IS NOT HERE. No chain, no grading or grader, no commentary, no conflict
 * evidence and no collection name — none of them is the narration, and a
 * search must never surface a grade or a chain as if it were. Every title is
 * the neutral citation label `"{collection} {number}"`, which no translation
 * or naming convention owns.
 *
 * NOTHING IS NORMALISED. Texts are handed to Search exactly as the public
 * reader returns them; the summary bound cuts by code point and never adds a
 * character. Visibility is the reader's: nothing at all while no collection is
 * activated, and only mapped, verified, unconflicted citations.
 */

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

const idOk = (value: string) => hadithIdSchema.safeParse(value).success;

/** The neutral label of a citation: its collection's slug and its number. */
function citationLabel(record: { collectionSlug: string; number: number }): string {
  return `${record.collectionSlug} ${record.number}`;
}

function documents(record: HadithSearchRecord): SearchDocumentSource[] {
  const topicIds = [...record.topicIds];

  // Grouped by language case-insensitively — the index stores text languages
  // folded, so `en-GB` and `en-gb` would otherwise be two documents in one.
  const byLanguage = new Map<string, { code: string; texts: string[] }>();
  for (const translation of record.translations) {
    const key = translation.languageCode.toLowerCase();
    const group = byLanguage.get(key) ?? { code: translation.languageCode, texts: [] };
    group.texts.push(translation.text);
    byLanguage.set(key, group);
  }

  const originalKey = record.textLanguage.toLowerCase();
  const sameLanguage = byLanguage.get(originalKey)?.texts ?? [];
  byLanguage.delete(originalKey);

  const document = (
    textLanguage: string,
    content: { summary: string; body: string },
  ): SearchDocumentSource => ({
    kind: 'hadith',
    resourceId: record.citationId,
    textLanguage,
    contentLanguage: textLanguage,
    title: citationLabel(record),
    summary: content.summary,
    body: content.body,
    year: null,
    topicIds,
  });

  return [
    document(record.textLanguage, texts(record.text, sameLanguage)),
    ...[...byLanguage.values()].flatMap((group) => {
      const [first, ...rest] = group.texts;
      return first === undefined ? [] : [document(group.code, texts(first, rest))];
    }),
  ];
}

/** `/hadith/{collection}/{number}` — the citation's permanent, locale-free address. */
export function hadithCitationPath(citation: {
  readonly collectionSlug: string;
  readonly number: number;
}): string {
  return `/hadith/${encodeURIComponent(citation.collectionSlug)}/${citation.number}`;
}

export function createHadithSearchProjection(reader: HadithPublicReaderPort): {
  readonly source: SearchScopeSource;
  readonly target: SearchTargetResolver;
} {
  return {
    source: {
      async project(id) {
        if (!idOk(id)) return null;
        const record = await reader.searchCitation(id);
        return record === null
          ? null
          : { stamp: record.stamp, documents: documents(record) };
      },

      async list({ after, limit }) {
        // The cursor is always a citation id this source produced; anything
        // else is a defect, and guessing a position would skip or repeat scopes.
        if (after !== null && !idOk(after))
          throw new Error('Hadith search enumeration cursor is not a citation id.');
        const scopes = await reader.searchCitationScopes(after, limit);
        return scopes.map((scope) => ({ id: scope.id, stamp: scope.stamp }));
      },
    },

    // Hadith's own public predicate answers which citations are public NOW —
    // activated, mapped, unconflicted and verified at the current version — so
    // a stale projection of a withdrawn or conflicted citation is withheld, and
    // an id that is not a citation is simply absent.
    async target(ids) {
      const valid = [...new Set(ids.filter(idOk))];
      if (valid.length === 0) return new Map();
      const visible = await reader.publicCitationTargets(valid);
      return new Map(visible.map((row) => [row.citationId, hadithCitationPath(row)]));
    },
  };
}
