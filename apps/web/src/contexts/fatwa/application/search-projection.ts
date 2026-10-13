import {
  fatwaIdSchema,
  type FatwaPublicReaderPort,
  type FatwaSearchRecord,
} from '@minhaj/contracts/fatwa';
import {
  SEARCH_BODY_MAX_LENGTH,
  SEARCH_SUMMARY_MAX_LENGTH,
  type SearchDocumentSource,
  type SearchScopeSource,
  type SearchTargetResolver,
} from '@minhaj/contracts/search';

/**
 * Fatwa's search projection — one scope per ruling, identified by the ruling's
 * own id, holding ONE document: its CURRENT PUBLISHED revision (Phase 20).
 *
 * PUBLIC FIELDS ONLY, AND NOTHING ELSE CAN REACH IT. The reader this projects
 * from returns the published revision's title, the separately written
 * anonymised public question, the ruling and the topics — it has no method
 * that returns a private question, an asker, an assignment, a draft, a review
 * note or a withdrawn ruling, so none of them can be indexed by accident
 * (DELIVERY_PLAN.md Phase 20; SECURITY_BASELINE.md §6).
 *
 * A CORRECTION REPLACES, IT DOES NOT ACCUMULATE. Each publication advances the
 * current revision and owes Search an indexing pass in the same transaction,
 * and the stamp covers the published revision, so reconcile repairs a missed
 * pass; a superseded revision's words are never searchable. A withdrawal owes a
 * pass too, and until it runs the visibility resolver below withholds the
 * stale row.
 *
 * NOTHING IS NORMALISED. Text is handed over exactly as published; the bounds
 * cut by code point and never add a character.
 */

/** Cut by code point so no character is ever halved. */
function bounded(text: string, max: number): string {
  const points = [...text];
  return points.length <= max ? text : points.slice(0, max).join('');
}

const idOk = (value: string) => fatwaIdSchema.safeParse(value).success;

function document(record: FatwaSearchRecord): SearchDocumentSource {
  const summary = bounded(record.publicQuestion, SEARCH_SUMMARY_MAX_LENGTH);
  const body = bounded(
    [
      ...(summary === record.publicQuestion ? [] : [record.publicQuestion]),
      record.ruling,
    ].join('\n\n'),
    SEARCH_BODY_MAX_LENGTH,
  );
  return {
    kind: 'fatwa',
    resourceId: record.fatwaId,
    textLanguage: record.language,
    contentLanguage: record.language,
    title: record.title,
    summary,
    body,
    year: null,
    topicIds: [...record.topicIds],
  };
}

/** `/fatwa/{slug}` — the ruling's permanent, locale-free address. */
export function fatwaPath(target: { readonly slug: string }): string {
  return `/fatwa/${encodeURIComponent(target.slug)}`;
}

export function createFatwaSearchProjection(reader: FatwaPublicReaderPort): {
  readonly source: SearchScopeSource;
  readonly target: SearchTargetResolver;
} {
  return {
    source: {
      async project(id) {
        if (!idOk(id)) return null;
        const record = await reader.searchRecord(id);
        return record === null
          ? null
          : { stamp: record.stamp, documents: [document(record)] };
      },

      async list({ after, limit }) {
        // The cursor is always a ruling id this source produced; anything else
        // is a defect, and guessing a position would skip or repeat scopes.
        if (after !== null && !idOk(after))
          throw new Error('Fatwa search enumeration cursor is not a ruling id.');
        const scopes = await reader.searchScopes(after, limit);
        return scopes.map((scope) => ({ id: scope.id, stamp: scope.stamp }));
      },
    },

    // Fatwa's own public predicate answers which rulings are public NOW —
    // activated, published, not withdrawn — so a stale projection is withheld
    // before it is returned, and an id that is not a ruling is simply absent.
    async target(ids) {
      const valid = [...new Set(ids.filter(idOk))];
      if (valid.length === 0) return new Map();
      const visible = await reader.publicTargets(valid);
      return new Map(visible.map((row) => [row.fatwaId, fatwaPath(row)]));
    },
  };
}
