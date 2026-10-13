import 'server-only';

import { Prisma } from '@prisma/client';

import {
  FATWA_PAGE_SIZE,
  FATWA_POPULAR_WINDOW_DAYS,
  FATWA_SEARCH_RECORDS_MAX,
  type FatwaPublicReaderPort,
  type FatwaSearchRecord,
  type PublicFatwaCategory,
  type PublicFatwaHistoryEntry,
} from '@minhaj/contracts/fatwa';

import { getDatabaseClient } from '../../client.ts';
import {
  activeMode,
  bounded,
  boundedOffset,
  CATEGORY_LIST,
  dateOf,
  maybeDate,
  namesOf,
  PUBLIC_NOW,
  stampOf,
  TARGET_BATCH,
  topicUnion,
} from './shared.ts';

/**
 * The Fatwa adapter's PUBLIC half (DOMAIN_MODEL.md §12; DELIVERY_PLAN.md
 * Phase 20). It takes no actor and answers only what is public NOW.
 *
 * NOTHING WHILE THE SERVICE IS INACTIVE. Every read asks for the activation
 * first; without one it returns empty or null and asks nothing else.
 *
 * NEVER A QUESTION. Nothing here reads `FatwaQuestion`: a public ruling is its
 * published revisions — the separately written anonymised public question and
 * the ruling — and the publication facts beside them. A draft, a revision under
 * review, a review note and a withdrawn ruling are absent exactly as an
 * unknown slug is.
 *
 * ONE PUBLIC RULE (`PUBLIC_NOW`) and ONE TOPIC RULE: a ruling is on Topic T when
 * its CURRENT published revision lists T, or that revision's category maps to
 * T. Browsing by topic, the canonical page and Search all read it the same way.
 *
 * NO N+1. A listing page is one bounded query and its count; a batch of search
 * projections is two bounded reads, whatever its size.
 */

/* ===========================================================================
 * Query fragments
 * ========================================================================= */

/**
 * Every public ruling with its current revision `r`, that revision's
 * publication `cp` and its category `c`. Callers append `AND …` filters.
 * The publication join is inner on purpose: a current revision that was never
 * published (which `FatwaIntegrity` forbids) is not public either.
 */
const PUBLIC_RULINGS = Prisma.sql`FROM [dbo].[Fatwa] f
  JOIN [dbo].[FatwaRevision] r ON r.[id] = f.[publishedRevisionId] AND r.[fatwaId] = f.[id]
  JOIN [dbo].[FatwaPublication] cp ON cp.[revisionId] = r.[id]
  JOIN [dbo].[FatwaCategory] c ON c.[id] = r.[categoryId]
  WHERE ${PUBLIC_NOW}`;

/** The instant of the latest publication, when it was a correction. */
const CORRECTED_AT = Prisma.sql`(SELECT TOP (1)
    CASE WHEN p.[sequence] > 1 THEN p.[publishedAt] END
  FROM [dbo].[FatwaPublication] p WHERE p.[fatwaId] = f.[id] ORDER BY p.[sequence] DESC)`;

/**
 * Reads over the trailing `FATWA_POPULAR_WINDOW_DAYS` UTC days, today included.
 * Summed as BIGINT: thirty days of a per-day INT count can exceed an INT.
 */
const RECENT_READS = Prisma.sql`(SELECT ISNULL(SUM(CAST(t.[reads] AS BIGINT)), 0)
  FROM [dbo].[FatwaReadTally] t
  WHERE t.[fatwaId] = f.[id]
    AND t.[day] >= DATEADD(day, ${-(FATWA_POPULAR_WINDOW_DAYS - 1)}, CAST(SYSUTCDATETIME() AS DATE)))`;

/** Rulings Search asks about by id. */
function idsFilter(ids: readonly string[]): Prisma.Sql {
  return Prisma.sql`AND f.[id] IN (${Prisma.join([...ids])})`;
}

/** The topic rule, as a filter over `r` and `c`. */
function onTopic(topicId: string): Prisma.Sql {
  return Prisma.sql`AND (c.[topicId] = ${topicId} OR EXISTS (SELECT 1
    FROM [dbo].[FatwaRevisionTopic] rt WHERE rt.[revisionId] = r.[id] AND rt.[topicId] = ${topicId}))`;
}

/* ===========================================================================
 * The factory
 * ========================================================================= */

export function createFatwaPublicReader(): FatwaPublicReaderPort {
  const db = getDatabaseClient();

  /** Active categories (optionally one slug), in order, with their public counts. */
  async function publicCategories(slug: string | null): Promise<PublicFatwaCategory[]> {
    const only = slug === null ? Prisma.empty : Prisma.sql`AND pc.[slug] = ${slug}`;
    const rows = await db.$queryRaw<
      {
        id: string;
        slug: string;
        topicId: string;
        position: number;
        publicCount: number;
      }[]
    >`SELECT TOP (${CATEGORY_LIST}) pc.[id], pc.[slug], pc.[topicId], pc.[position],
             (SELECT COUNT(*) ${PUBLIC_RULINGS} AND r.[categoryId] = pc.[id]) AS [publicCount]
      FROM [dbo].[FatwaCategory] pc
      WHERE pc.[status] = N'active' ${only}
      ORDER BY pc.[position], pc.[slug]`;
    if (rows.length === 0) return [];
    const names = await db.fatwaCategoryName.findMany({
      where: { categoryId: { in: rows.map((row) => row.id) } },
      select: { categoryId: true, locale: true, name: true },
      orderBy: [{ categoryId: 'asc' }, { locale: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      topicId: row.topicId,
      position: Number(row.position),
      names: namesOf(names.filter((name) => name.categoryId === row.id)),
      publicCount: Number(row.publicCount),
    }));
  }

  /**
   * The current public projection of a set of rulings — the ONE definition
   * `searchRecord`, `searchRecords` and (without text) `searchScopes` share, so
   * a single record, a results page and the reconciliation sweep cannot
   * disagree. A ruling that is not public now is simply absent.
   */
  async function projection(
    filter: Prisma.Sql,
    limit: number,
    withText: boolean,
  ): Promise<FatwaSearchRecord[]> {
    const rows = await db.$queryRaw<
      {
        fatwaId: string;
        slug: string;
        version: number;
        revisionId: string;
        title: string | null;
        publicQuestion: string | null;
        ruling: string | null;
        language: string;
        categoryTopicId: string;
        publishedAt: Date;
      }[]
    >`SELECT TOP (${limit}) f.[id] AS [fatwaId], f.[slug], f.[version], r.[id] AS [revisionId],
             ${withText ? Prisma.sql`r.[title]` : Prisma.sql`NULL`} AS [title],
             ${withText ? Prisma.sql`r.[publicQuestion]` : Prisma.sql`NULL`} AS [publicQuestion],
             ${withText ? Prisma.sql`r.[ruling]` : Prisma.sql`NULL`} AS [ruling],
             r.[language], c.[topicId] AS [categoryTopicId], cp.[publishedAt]
      ${PUBLIC_RULINGS} ${filter}
      ORDER BY f.[id]`;
    if (rows.length === 0) return [];
    const topics = await db.fatwaRevisionTopic.findMany({
      where: { revisionId: { in: rows.map((row) => row.revisionId) } },
      select: { revisionId: true, topicId: true },
      orderBy: [{ revisionId: 'asc' }, { topicId: 'asc' }],
    });
    return rows.map((row) => {
      const own = topics
        .filter((topic) => topic.revisionId === row.revisionId)
        .map((topic) => topic.topicId);
      return {
        fatwaId: row.fatwaId,
        slug: row.slug,
        title: row.title ?? '',
        publicQuestion: row.publicQuestion ?? '',
        ruling: row.ruling ?? '',
        language: row.language,
        topicIds: topicUnion(own, row.categoryTopicId),
        publishedAt: dateOf(row.publishedAt),
        stamp: stampOf({
          publishedRevisionId: row.revisionId,
          version: Number(row.version),
          categoryTopicId: row.categoryTopicId,
          topicIds: own,
          withdrawn: false,
        }),
      };
    });
  }

  return {
    /** Answered with literal domain values, one per mode — nothing else is handed back. */
    async availability() {
      switch (await activeMode(db)) {
        case 'approved':
          return { active: true, mode: 'approved' };
        case 'fixture':
          return { active: true, mode: 'fixture' };
        case null:
          return { active: false };
      }
    },

    async categories() {
      if ((await activeMode(db)) === null) return [];
      return publicCategories(null);
    },

    async category(slug) {
      if ((await activeMode(db)) === null) return null;
      const [category] = await publicCategories(slug);
      return category ?? null;
    },

    async browse(filter) {
      const offset = boundedOffset(filter.offset);
      if ((await activeMode(db)) === null) return { items: [], total: 0, offset };
      const where = Prisma.sql`${
        filter.categoryId === null
          ? Prisma.empty
          : Prisma.sql`AND r.[categoryId] = ${filter.categoryId}`
      } ${filter.topicId === null ? Prisma.empty : onTopic(filter.topicId)}`;
      const order =
        filter.sort === 'popular'
          ? Prisma.sql`ORDER BY ${RECENT_READS} DESC, f.[firstPublishedAt] DESC, f.[id] ASC`
          : Prisma.sql`ORDER BY f.[firstPublishedAt] DESC, f.[id] ASC`;
      const [counted, rows] = await Promise.all([
        db.$queryRaw<
          { total: number }[]
        >`SELECT COUNT(*) AS [total] ${PUBLIC_RULINGS} ${where}`,
        db.$queryRaw<
          {
            id: string;
            slug: string;
            title: string;
            language: string;
            categoryId: string;
            firstPublishedAt: Date;
            correctedAt: Date | null;
          }[]
        >`SELECT f.[id], f.[slug], r.[title], r.[language], r.[categoryId], f.[firstPublishedAt],
                 ${CORRECTED_AT} AS [correctedAt]
          ${PUBLIC_RULINGS} ${where}
          ${order}
          OFFSET ${offset} ROWS FETCH NEXT ${FATWA_PAGE_SIZE} ROWS ONLY`,
      ]);
      return {
        items: rows.map((row) => ({
          id: row.id,
          slug: row.slug,
          title: row.title,
          language: row.language,
          categoryId: row.categoryId,
          firstPublishedAt: dateOf(row.firstPublishedAt),
          correctedAt: maybeDate(row.correctedAt),
        })),
        total: Number(counted[0]?.total ?? 0),
        offset,
      };
    },

    /**
     * The canonical page: the current revision, every earlier PUBLISHED
     * revision newest first, and the contributor records the current
     * publication recorded. Never a draft, a note, an account or the question.
     */
    async fatwa(slug) {
      if ((await activeMode(db)) === null) return null;
      const [head] = await db.$queryRaw<
        {
          id: string;
          slug: string;
          revisionId: string;
          categoryId: string;
          categoryTopicId: string;
          firstPublishedAt: Date;
        }[]
      >`SELECT f.[id], f.[slug], r.[id] AS [revisionId], r.[categoryId],
               c.[topicId] AS [categoryTopicId], f.[firstPublishedAt]
        ${PUBLIC_RULINGS} AND f.[slug] = ${slug}`;
      if (head === undefined) return null;
      const [history, topics] = await Promise.all([
        db.fatwaPublication.findMany({
          where: { fatwaId: head.id },
          select: {
            sequence: true,
            publishedAt: true,
            publisherPersonId: true,
            authorPersonId: true,
            revision: {
              select: {
                id: true,
                title: true,
                publicQuestion: true,
                ruling: true,
                language: true,
                correctionReason: true,
              },
            },
          },
          orderBy: { sequence: 'desc' },
        }),
        db.fatwaRevisionTopic.findMany({
          where: { revisionId: head.revisionId },
          select: { topicId: true },
          orderBy: { topicId: 'asc' },
        }),
      ]);
      const toEntry = (row: (typeof history)[number]): PublicFatwaHistoryEntry => ({
        sequence: row.sequence,
        revisionId: row.revision.id,
        publishedAt: row.publishedAt,
        title: row.revision.title,
        publicQuestion: row.revision.publicQuestion,
        ruling: row.revision.ruling,
        language: row.revision.language,
        correctionReason: row.revision.correctionReason,
      });
      const current = history.find((row) => row.revision.id === head.revisionId);
      if (current === undefined) return null;
      return {
        id: head.id,
        slug: head.slug,
        categoryId: head.categoryId,
        topicIds: topicUnion(
          topics.map((topic) => topic.topicId),
          head.categoryTopicId,
        ),
        current: toEntry(current),
        previous: history.filter((row) => row !== current).map(toEntry),
        firstPublishedAt: dateOf(head.firstPublishedAt),
        answeredByPersonId: current.authorPersonId,
        publishedByPersonId: current.publisherPersonId,
      };
    },

    async publicId(slug) {
      if ((await activeMode(db)) === null) return null;
      const [row] = await db.$queryRaw<{ id: string }[]>`
        SELECT f.[id] ${PUBLIC_RULINGS} AND f.[slug] = ${slug}`;
      return row?.id ?? null;
    },

    /**
     * An APPROVED service only: a fixture deployment's pages say they are not
     * genuine, and none of them is offered to a crawler.
     */
    async sitemap(offset, limit) {
      if ((await activeMode(db)) !== 'approved') return [];
      const rows = await db.$queryRaw<
        { slug: string; language: string; lastModified: Date }[]
      >`SELECT f.[slug], r.[language],
               (SELECT MAX(p.[publishedAt]) FROM [dbo].[FatwaPublication] p
                 WHERE p.[fatwaId] = f.[id]) AS [lastModified]
        ${PUBLIC_RULINGS}
        ORDER BY f.[firstPublishedAt], f.[id]
        OFFSET ${boundedOffset(offset)} ROWS FETCH NEXT ${bounded(limit, 5000)} ROWS ONLY`;
      return rows.map((row) => ({
        slug: row.slug,
        language: row.language,
        lastModified: dateOf(row.lastModified),
      }));
    },

    /* ---- Search ------------------------------------------------------------ */

    async searchRecord(fatwaId) {
      if ((await activeMode(db)) === null) return null;
      const [record] = await projection(idsFilter([fatwaId]), 1, true);
      return record ?? null;
    },

    async searchScopes(after, limit) {
      if ((await activeMode(db)) === null) return [];
      const records = await projection(
        after === null ? Prisma.empty : Prisma.sql`AND f.[id] > ${after}`,
        bounded(limit, TARGET_BATCH),
        false,
      );
      return records.map((record) => ({ id: record.fatwaId, stamp: record.stamp }));
    },

    async publicTargets(ids) {
      if (ids.length === 0) return [];
      if (ids.length > TARGET_BATCH)
        throw new Error('Fatwa search batch exceeds its bound.');
      if ((await activeMode(db)) === null) return [];
      const rows = await db.$queryRaw<{ fatwaId: string; slug: string }[]>`
        SELECT f.[id] AS [fatwaId], f.[slug]
        ${PUBLIC_RULINGS} ${idsFilter([...new Set(ids)])}
        ORDER BY f.[id]`;
      return rows.map((row) => ({ fatwaId: row.fatwaId, slug: row.slug }));
    },

    async searchRecords(ids) {
      if (ids.length === 0) return [];
      if (ids.length > FATWA_SEARCH_RECORDS_MAX)
        throw new Error('Fatwa search record batch exceeds its bound.');
      if ((await activeMode(db)) === null) return [];
      const distinct = [...new Set(ids)];
      return projection(idsFilter(distinct), distinct.length, true);
    },
  };
}
