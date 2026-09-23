import 'server-only';

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import {
  SEARCH_DOCUMENTS_PER_SCOPE,
  SEARCH_MAX_TERMS,
  SEARCH_PREFIX_MIN_LENGTH,
  SEARCH_RESULT_CEILING,
  SEARCH_TERM_MAX_LENGTH,
  type IndexDocument,
  type IndexedScopeState,
  type IndexRow,
  type SearchFailureCategory,
  type SearchIndexPort,
  type SearchKind,
  type SearchScopeKind,
  type SearchSettlement,
} from '@minhaj/contracts/search';

import { getDatabaseClient } from '../../client.ts';

/**
 * The SQL Server Full-Text Search adapter behind `SearchIndexPort`.
 *
 * Semantic owner: the Layer-0 `search` concern, declared in this package's
 * manifest. It is infrastructure holding a DERIVED projection, not a bounded
 * context, and it reaches no owner's tables — every document it stores was
 * handed to it by an owner through the Search service (ARCHITECTURE.md §4.3,
 * §8.5).
 *
 * THE ONLY PLACE THE ENGINE IS NAMED. Full-text grammar, word breakers, LCIDs,
 * the catalogue and the ranking functions live in this file and nowhere else. A
 * future engine replaces this module; nothing above the port changes.
 *
 * GRAMMAR IS NEVER BUILT FROM WHAT A VISITOR TYPED. The service hands this
 * adapter folded TERMS, each made only of letters, combining marks and digits;
 * this module re-proves that shape before composing anything, wraps each term in
 * a quoted phrase of its own, and passes the composed condition to SQL Server as
 * a PARAMETER. A quote, an operator word, a wildcard or a bracket in the query
 * box never reaches the grammar, and nothing reaches the SQL text at all.
 */

/* ===========================================================================
 * Word breakers — the measured tokenisation decision (TECH_STACK.md §10)
 * ========================================================================= */

type MatchColumn = 'matchEnglish' | 'matchArabic' | 'matchUrdu' | 'matchOther';

/**
 * Which column — and therefore which word breaker — a document's text language
 * is tokenised by, keyed by primary language subtag.
 *
 * Arabic MUST be tokenised by the Arabic breaker: it is the only one that
 * removes the definite article and attached prepositions and folds ة/ه, so it is
 * the only one under which "مكتبة" finds "المكتبة" and "قراء" finds "للقراء".
 * English is inflected by its own breaker. Urdu uses its own. Every other
 * content language is tokenised on word boundaries by the neutral breaker.
 */
function columnFor(textLanguage: string): MatchColumn {
  switch ((textLanguage.split('-')[0] ?? textLanguage).toLowerCase()) {
    case 'en':
      return 'matchEnglish';
    case 'ar':
      return 'matchArabic';
    case 'ur':
      return 'matchUrdu';
    default:
      return 'matchOther';
  }
}

/** Letters, combining marks and digits — and nothing else, ever. */
const TERM = /^[\p{L}\p{M}\p{N}]+$/u;

/**
 * Refuses a term this adapter must never compose grammar from.
 *
 * The service already guarantees the shape. This is the second lock on the same
 * door: an adapter that trusted its caller about injection would be one refactor
 * away from building grammar out of raw input.
 */
function assertTerms(terms: readonly string[]): void {
  if (terms.length === 0 || terms.length > SEARCH_MAX_TERMS) {
    throw new Error('A search query must carry between one and the maximum terms.');
  }
  for (const term of terms) {
    if (term.length > SEARCH_TERM_MAX_LENGTH || !TERM.test(term)) {
      throw new Error('A search term is outside the accepted shape.');
    }
  }
}

/**
 * The condition for one word breaker.
 *
 * EVERY TERM MUST MATCH (AND), because a visitor adding a word is narrowing
 * what they want. A term long enough to be a meaningful prefix also matches as
 * one ("librar" finds "library"), which is what makes typing part of a word
 * useful; a shorter one matches only whole words, because a two-letter prefix
 * is a scan of most of the vocabulary. English terms additionally match their
 * inflected forms.
 */
function conditionFor(column: MatchColumn, terms: readonly string[]): string {
  return terms
    .map((term) => {
      const exact =
        column === 'matchEnglish' ? `FORMSOF(INFLECTIONAL, "${term}")` : `"${term}"`;
      return term.length >= SEARCH_PREFIX_MIN_LENGTH ? `(${exact} OR "${term}*")` : exact;
    })
    .join(' AND ');
}

/* ===========================================================================
 * The adapter
 * ========================================================================= */

interface MatchedRow {
  kind: string;
  resourceId: string;
  textLanguage: string;
  contentLanguage: string | null;
  title: string;
  summary: string;
  year: number | null;
  total: number;
}

export function createSearchIndex(): SearchIndexPort {
  const database = getDatabaseClient();

  return {
    async request(scopes) {
      if (scopes.length === 0) return;
      if (scopes.length > 500) throw new Error('Search request batch exceeds its bound.');

      await database.searchIndexRequest.createMany({
        data: scopes.map((scope) => ({ scopeKind: scope.kind, scopeId: scope.id })),
      });
    },

    /**
     * Consumes the oldest requests and folds them into per-scope work.
     *
     * ONE TRANSACTION, so a request is never deleted without its scope being
     * marked pending, and never marked pending twice. READPAST lets two relays
     * run at once without taking the same requests; HOLDLOCK on the MERGE makes
     * the insert-or-update of a scope row race-safe between them.
     */
    async relay(limit) {
      const bounded = Math.max(1, Math.min(500, Math.trunc(limit) || 1));

      return database.$transaction(async (tx) => {
        const moved = await tx.$queryRaw<
          { scopeKind: string; scopeId: string; requestedAt: Date }[]
        >`
          WITH oldest AS (
            SELECT TOP (${bounded}) [scopeKind], [scopeId], [requestedAt]
            FROM [dbo].[SearchIndexRequest] WITH (UPDLOCK, READPAST, ROWLOCK)
            ORDER BY [id]
          )
          DELETE FROM oldest
          OUTPUT deleted.[scopeKind], deleted.[scopeId], deleted.[requestedAt];
        `;

        if (moved.length === 0) return 0;

        // One row per scope, carrying the EARLIEST request, so the lag the
        // operator sees is measured from the first unprocessed change.
        const earliest = new Map<string, { kind: string; id: string; at: Date }>();
        for (const row of moved) {
          const key = `${row.scopeKind}\u0000${row.scopeId}`;
          const seen = earliest.get(key);
          if (seen === undefined || row.requestedAt < seen.at) {
            earliest.set(key, {
              kind: row.scopeKind,
              id: row.scopeId,
              at: row.requestedAt,
            });
          }
        }

        const values = Prisma.join(
          [...earliest.values()].map(
            (scope) => Prisma.sql`(${scope.kind}, ${scope.id}, ${scope.at})`,
          ),
        );

        await tx.$executeRaw`
          MERGE [dbo].[SearchIndexScope] WITH (HOLDLOCK) AS target
          USING (VALUES ${values}) AS source ([scopeKind], [scopeId], [requestedAt])
            ON target.[scopeKind] = source.[scopeKind] AND target.[scopeId] = source.[scopeId]
          WHEN MATCHED THEN UPDATE SET
            [generation] = target.[generation] + 1,
            [status] = N'pending',
            [attempts] = 0,
            [dueAt] = SYSUTCDATETIME(),
            [requestedAt] = CASE
              WHEN target.[requestedAt] IS NOT NULL AND target.[requestedAt] < source.[requestedAt]
                THEN target.[requestedAt]
              ELSE source.[requestedAt] END,
            [failureCategory] = NULL,
            [failedAt] = NULL
          WHEN NOT MATCHED THEN INSERT
            ([scopeKind], [scopeId], [status], [generation], [attempts], [dueAt], [requestedAt])
            VALUES (source.[scopeKind], source.[scopeId], N'pending', 1, 0, SYSUTCDATETIME(), source.[requestedAt]);
        `;

        return moved.length;
      });
    },

    /**
     * Leases due work, oldest first.
     *
     * A LEASE, NOT A LOCK HELD ACROSS THE WORK. The owner's projection is read
     * outside any transaction here, and a worker that crashes mid-scope simply
     * lets its lease expire so the scope becomes due again. The attempt is
     * counted at the claim, so a scope that crashes its worker every time still
     * exhausts its retries instead of looping.
     */
    async claim({ limit, leaseSeconds }) {
      const bounded = Math.max(1, Math.min(100, Math.trunc(limit) || 1));
      const lease = Math.max(10, Math.min(600, Math.trunc(leaseSeconds) || 60));
      const token = randomUUID();

      const rows = await database.$queryRaw<
        { scopeKind: string; scopeId: string; generation: number; attempts: number }[]
      >`
        WITH due AS (
          SELECT TOP (${bounded}) *
          FROM [dbo].[SearchIndexScope] WITH (UPDLOCK, READPAST, ROWLOCK)
          WHERE [status] = N'pending'
            AND [dueAt] <= SYSUTCDATETIME()
            AND ([leaseUntil] IS NULL OR [leaseUntil] < SYSUTCDATETIME())
          ORDER BY [dueAt], [scopeKind], [scopeId]
        )
        UPDATE due SET
          [leaseToken] = ${token},
          [leaseUntil] = DATEADD(SECOND, ${lease}, SYSUTCDATETIME()),
          [attempts] = [attempts] + 1
        OUTPUT inserted.[scopeKind], inserted.[scopeId], inserted.[generation], inserted.[attempts];
      `;

      return rows
        .map((row) => ({
          kind: row.scopeKind as SearchScopeKind,
          id: row.scopeId,
          generation: row.generation,
          attempts: row.attempts,
          leaseToken: token,
        }))
        .sort((a, b) =>
          a.kind === b.kind ? (a.id < b.id ? -1 : 1) : a.kind < b.kind ? -1 : 1,
        );
    },

    /**
     * Replaces a scope's documents and settles its claim, atomically.
     *
     * THE LEASE IS RE-PROVED UNDER A ROW LOCK before anything is written, so a
     * worker whose lease expired and was re-claimed cannot overwrite a fresher
     * projection with its stale one. THE GENERATION DECIDES THE OUTCOME: if a
     * request was relayed while this projection was being built, the documents
     * are still written — they are at least as fresh as the claim — but the scope
     * stays pending so the newer change is projected too.
     *
     * UNCHANGED DOCUMENTS ARE NOT REWRITTEN. Every rewrite is full-text
     * population work, and a Work re-projected because one Edition changed
     * should not repopulate its other forty-nine.
     */
    async apply(claim, projection) {
      if (projection.documents.length > SEARCH_DOCUMENTS_PER_SCOPE) {
        throw new Error('A search projection exceeds its per-scope bound.');
      }

      return database.$transaction(async (tx): Promise<SearchSettlement> => {
        const held = await tx.$queryRaw<{ generation: number }[]>`
          SELECT [generation]
          FROM [dbo].[SearchIndexScope] WITH (UPDLOCK, ROWLOCK)
          WHERE [scopeKind] = ${claim.kind} AND [scopeId] = ${claim.id}
            AND [leaseToken] = ${claim.leaseToken};
        `;
        const current = held[0];
        if (current === undefined) return 'lost';

        const existing = await tx.searchDocument.findMany({
          where: { scopeKind: claim.kind, scopeId: claim.id },
          select: {
            id: true,
            kind: true,
            resourceId: true,
            textLanguage: true,
            checksum: true,
          },
        });

        const identity = (row: {
          kind: string;
          resourceId: string;
          textLanguage: string;
        }) => `${row.kind}\u0000${row.resourceId}\u0000${row.textLanguage}`;

        const wanted = new Map(projection.documents.map((doc) => [identity(doc), doc]));
        const now = new Date();

        for (const row of existing) {
          const next = wanted.get(identity(row));
          if (next === undefined) {
            await tx.searchDocument.delete({ where: { id: row.id } });
          } else if (next.checksum !== row.checksum) {
            await tx.searchDocumentTopic.deleteMany({ where: { documentId: row.id } });
            await tx.searchDocument.update({
              where: { id: row.id },
              data: { ...documentColumns(next), indexedAt: now },
            });
            await writeTopics(tx, row.id, next.topicIds);
          }
          wanted.delete(identity(row));
        }

        for (const doc of wanted.values()) {
          const created = await tx.searchDocument.create({
            data: {
              scopeKind: claim.kind,
              scopeId: claim.id,
              kind: doc.kind,
              resourceId: doc.resourceId,
              textLanguage: doc.textLanguage,
              ...documentColumns(doc),
              indexedAt: now,
            },
            select: { id: true },
          });
          await writeTopics(tx, created.id, doc.topicIds);
        }

        if (current.generation !== claim.generation) {
          await tx.searchIndexScope.update({
            where: { scopeKind_scopeId: { scopeKind: claim.kind, scopeId: claim.id } },
            data: { leaseToken: null, leaseUntil: null, dueAt: now },
          });
          return 'superseded';
        }

        await tx.searchIndexScope.update({
          where: { scopeKind_scopeId: { scopeKind: claim.kind, scopeId: claim.id } },
          data: {
            status: 'current',
            attempts: 0,
            indexedAt: now,
            indexedStamp: projection.stamp,
            requestedAt: null,
            failureCategory: null,
            failedAt: null,
            leaseToken: null,
            leaseUntil: null,
          },
        });
        return 'current';
      });
    },

    /**
     * Records a failure, with bounded automatic retry.
     *
     * A scope whose generation moved while it was failing is NOT exhausted: the
     * owner has changed it since, and the new change deserves its own attempts.
     */
    async fail(claim, { category, maxAttempts, retryAfterSeconds }) {
      const retry = Math.max(1, Math.min(86_400, Math.trunc(retryAfterSeconds) || 1));
      const cap = Math.max(1, Math.trunc(maxAttempts) || 1);

      const rows = await database.$queryRaw<{ status: string; generation: number }[]>`
        UPDATE [dbo].[SearchIndexScope] SET
          [status] = CASE
            WHEN [generation] = ${claim.generation} AND [attempts] >= ${cap} THEN N'failed'
            ELSE N'pending' END,
          [dueAt] = CASE
            WHEN [generation] = ${claim.generation} THEN DATEADD(SECOND, ${retry}, SYSUTCDATETIME())
            ELSE SYSUTCDATETIME() END,
          [failureCategory] = ${category},
          [failedAt] = SYSUTCDATETIME(),
          [leaseToken] = NULL,
          [leaseUntil] = NULL
        OUTPUT inserted.[status], inserted.[generation]
        WHERE [scopeKind] = ${claim.kind} AND [scopeId] = ${claim.id}
          AND [leaseToken] = ${claim.leaseToken};
      `;

      const row = rows[0];
      if (row === undefined) return 'lost';
      if (row.generation !== claim.generation) return 'superseded';
      return row.status === 'failed' ? 'failed' : 'retrying';
    },

    /**
     * Ranks, filters, de-duplicates and pages one query.
     *
     * ONE `CONTAINSTABLE` PER WORD BREAKER, because the query language is fixed
     * per call and each column is tokenised by its own breaker; a document has
     * exactly one populated column, so it can match through at most one of them.
     * Each call is capped at the ranking ceiling — the engine never ranks more
     * than any visitor could page to.
     *
     * ONE RESULT PER RESOURCE. A Topic named in three languages is one Topic. It
     * is RANKED by its best-matching variant, and SHOWN in the reader's own
     * interface language whenever that variant matched too — otherwise in the
     * best-matching one. Without that preference a shorter Urdu record would
     * out-rank the English one and an English reader would see a name they did
     * not type.
     *
     * DETERMINISTIC ORDER: relevance, then genuine publication year (newest
     * first, undated last), then kind and identifier as the total tie-breaker,
     * so a page boundary can neither repeat nor skip a result.
     */
    async query(query) {
      assertTerms(query.terms);

      const english = conditionFor('matchEnglish', query.terms);
      const arabic = conditionFor('matchArabic', query.terms);
      const urdu = conditionFor('matchUrdu', query.terms);
      const other = conditionFor('matchOther', query.terms);

      const kinds =
        query.kinds === null || query.kinds.length === 0
          ? Prisma.sql`1 = 1`
          : Prisma.sql`d.[kind] IN (${Prisma.join([...query.kinds])})`;
      const offset = Math.max(0, Math.trunc(query.offset));
      const limit = Math.max(1, Math.min(100, Math.trunc(query.limit)));

      const rows = await database.$queryRaw<MatchedRow[]>`
        WITH matched AS (
          SELECT [KEY] AS [id], [RANK] AS [rank]
            FROM CONTAINSTABLE([dbo].[SearchDocument], [matchEnglish], ${english}, LANGUAGE 1033, ${SEARCH_RESULT_CEILING})
          UNION ALL
          SELECT [KEY], [RANK]
            FROM CONTAINSTABLE([dbo].[SearchDocument], [matchArabic], ${arabic}, LANGUAGE 1025, ${SEARCH_RESULT_CEILING})
          UNION ALL
          SELECT [KEY], [RANK]
            FROM CONTAINSTABLE([dbo].[SearchDocument], [matchUrdu], ${urdu}, LANGUAGE 1056, ${SEARCH_RESULT_CEILING})
          UNION ALL
          SELECT [KEY], [RANK]
            FROM CONTAINSTABLE([dbo].[SearchDocument], [matchOther], ${other}, LANGUAGE 0, ${SEARCH_RESULT_CEILING})
        ),
        filtered AS (
          SELECT d.[kind], d.[resourceId], d.[textLanguage], d.[contentLanguage],
                 d.[title], d.[summary], d.[year],
                 MAX(m.[rank]) OVER (PARTITION BY d.[kind], d.[resourceId]) AS [rank],
                 ROW_NUMBER() OVER (
                   PARTITION BY d.[kind], d.[resourceId]
                   ORDER BY CASE WHEN d.[textLanguage] = ${query.preferredLanguage} THEN 0 ELSE 1 END,
                            m.[rank] DESC,
                            d.[textLanguage]
                 ) AS [variant]
          FROM matched m
          JOIN [dbo].[SearchDocument] d ON d.[id] = m.[id]
          WHERE ${kinds}
            AND (${query.topicId} IS NULL OR EXISTS (
                  SELECT 1 FROM [dbo].[SearchDocumentTopic] t
                  WHERE t.[documentId] = d.[id] AND t.[topicId] = ${query.topicId}))
            AND (${query.contentLanguage} IS NULL OR d.[contentLanguage] = ${query.contentLanguage})
            AND (${query.fromYear} IS NULL OR d.[year] >= ${query.fromYear})
            AND (${query.toYear} IS NULL OR d.[year] <= ${query.toYear})
        ),
        ranked AS (
          SELECT TOP (${SEARCH_RESULT_CEILING}) *
          FROM filtered
          WHERE [variant] = 1
          ORDER BY [rank] DESC, [year] DESC, [kind], [resourceId]
        )
        SELECT [kind], [resourceId], [textLanguage], [contentLanguage], [title],
               [summary], CAST([year] AS INT) AS [year],
               CAST(COUNT(*) OVER () AS INT) AS [total]
        FROM ranked
        ORDER BY [rank] DESC, [year] DESC, [kind], [resourceId]
        OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY;
      `;

      return {
        total: rows[0]?.total ?? 0,
        rows: rows.map((row): IndexRow => ({
          kind: row.kind as SearchKind,
          resourceId: row.resourceId,
          textLanguage: row.textLanguage,
          contentLanguage: row.contentLanguage,
          title: row.title,
          summary: row.summary,
          year: row.year,
        })),
      };
    },

    async scopeStates(kind, ids) {
      if (ids.length === 0) return new Map();
      if (ids.length > 500) throw new Error('Search scope batch exceeds its bound.');

      const rows = await database.$queryRaw<
        { scopeId: string; status: string; stamp: string | null; documents: number }[]
      >`
        SELECT s.[scopeId], s.[status], s.[indexedStamp] AS [stamp],
               CAST((SELECT COUNT(*) FROM [dbo].[SearchDocument] d
                     WHERE d.[scopeKind] = s.[scopeKind] AND d.[scopeId] = s.[scopeId]) AS INT) AS [documents]
        FROM [dbo].[SearchIndexScope] s
        WHERE s.[scopeKind] = ${kind} AND s.[scopeId] IN (${Prisma.join([...ids])});
      `;

      return new Map(
        rows.map((row): [string, IndexedScopeState] => [
          row.scopeId,
          {
            documents: row.documents,
            stamp: row.stamp,
            settled: row.status === 'current',
          },
        ]),
      );
    },

    async indexedScopes({ kind, after, limit }) {
      const bounded = Math.max(1, Math.min(500, Math.trunc(limit) || 1));
      const rows = await database.$queryRaw<{ scopeId: string }[]>`
        SELECT DISTINCT TOP (${bounded}) [scopeId]
        FROM [dbo].[SearchDocument]
        WHERE [scopeKind] = ${kind} AND (${after} IS NULL OR [scopeId] > ${after})
        ORDER BY [scopeId];
      `;
      return rows.map((row) => row.scopeId);
    },

    async retryFailed() {
      const changed = await database.searchIndexScope.updateMany({
        where: { status: 'failed' },
        data: { status: 'pending', attempts: 0, dueAt: new Date() },
      });
      return changed.count;
    },

    /**
     * The operator's view. Counts, times and categories — never content.
     */
    async status({ failureLimit }) {
      const bounded = Math.max(1, Math.min(100, Math.trunc(failureLimit) || 1));

      const [summary] = await database.$queryRaw<
        {
          pending: number;
          failed: number;
          retrying: number;
          oldestPendingAt: Date | null;
          lastIndexedAt: Date | null;
          documents: number;
          enginePending: number | null;
        }[]
      >`
        SELECT
          CAST((SELECT COUNT(*) FROM (
                  SELECT [scopeKind], [scopeId] FROM [dbo].[SearchIndexScope] WHERE [status] = N'pending'
                  UNION
                  SELECT [scopeKind], [scopeId] FROM [dbo].[SearchIndexRequest]) outstanding) AS INT) AS [pending],
          CAST((SELECT COUNT(*) FROM [dbo].[SearchIndexScope] WHERE [status] = N'failed') AS INT) AS [failed],
          CAST((SELECT COUNT(*) FROM [dbo].[SearchIndexScope]
                WHERE [status] = N'pending' AND [failureCategory] IS NOT NULL) AS INT) AS [retrying],
          (SELECT MIN([at]) FROM (
             SELECT [requestedAt] AS [at] FROM [dbo].[SearchIndexScope]
             WHERE [status] IN (N'pending', N'failed')
             UNION ALL
             SELECT [requestedAt] FROM [dbo].[SearchIndexRequest]) waiting) AS [oldestPendingAt],
          (SELECT MAX([indexedAt]) FROM [dbo].[SearchIndexScope]) AS [lastIndexedAt],
          CAST((SELECT COUNT(*) FROM [dbo].[SearchDocument]) AS INT) AS [documents],
          CAST(OBJECTPROPERTYEX(OBJECT_ID(N'[dbo].[SearchDocument]'), 'TableFulltextPendingChanges') AS INT)
            AS [enginePending];
      `;

      const failures = await database.searchIndexScope.findMany({
        where: { failureCategory: { not: null } },
        orderBy: [{ failedAt: 'desc' }, { scopeKind: 'asc' }, { scopeId: 'asc' }],
        take: bounded,
        select: {
          scopeKind: true,
          scopeId: true,
          status: true,
          attempts: true,
          failureCategory: true,
          failedAt: true,
        },
      });

      return {
        pending: summary?.pending ?? 0,
        failed: summary?.failed ?? 0,
        retrying: summary?.retrying ?? 0,
        oldestPendingAt: summary?.oldestPendingAt ?? null,
        lastIndexedAt: summary?.lastIndexedAt ?? null,
        documents: summary?.documents ?? 0,
        enginePending: summary?.enginePending ?? 0,
        failures: failures.flatMap((row) =>
          row.failureCategory === null || row.failedAt === null
            ? []
            : [
                {
                  kind: row.scopeKind as SearchScopeKind,
                  id: row.scopeId,
                  category: row.failureCategory as SearchFailureCategory,
                  attempts: row.attempts,
                  failedAt: row.failedAt,
                  exhausted: row.status === 'failed',
                },
              ],
        ),
      };
    },
  };
}

/** The columns one normalised document writes, with its text in ONE breaker. */
function documentColumns(doc: IndexDocument) {
  const column = columnFor(doc.textLanguage);
  return {
    contentLanguage: doc.contentLanguage,
    title: doc.title,
    summary: doc.summary,
    matchEnglish: column === 'matchEnglish' ? doc.matchText : null,
    matchArabic: column === 'matchArabic' ? doc.matchText : null,
    matchUrdu: column === 'matchUrdu' ? doc.matchText : null,
    matchOther: column === 'matchOther' ? doc.matchText : null,
    year: doc.year,
    checksum: doc.checksum,
  };
}

async function writeTopics(
  tx: Prisma.TransactionClient,
  documentId: number,
  topicIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(topicIds)];
  if (unique.length === 0) return;
  await tx.searchDocumentTopic.createMany({
    data: unique.map((topicId) => ({ documentId, topicId })),
  });
}
