import 'server-only';

import { Prisma } from '@prisma/client';

import type { Locale } from '@minhaj/contracts';
import {
  LIBRARY_CONTRIBUTOR_DIRECTORY_MAX,
  LIBRARY_LANGUAGE_HOLDINGS_MAX,
  LIBRARY_SALE_POINT_PAGE,
  LIBRARY_SALE_POINT_WORKS,
  type LibraryBrowseKind,
  type LibraryDownloadsQuery,
  type LibraryKindCount,
  type LibraryPublicReaderPort,
} from '@minhaj/contracts/library';
import { CONTRIBUTION_ROLES } from '@minhaj/contracts/people';

import { getDatabaseClient } from '../../client.ts';

/**
 * LIBRARY PART 2 — THE BROWSE AND ACCESS READS (DOMAIN_MODEL.md §10.1–§10.2):
 * the Library's holdings by kind, by Topic and by content language; the
 * contributor directory; the downloadable Editions and their facets; and the
 * sale-point directory with the books each sells.
 *
 * EVERY AGGREGATE UNDER ITS OWN PUBLIC PREDICATE, the one its listing applies:
 * a Work is public while it is published with a published Edition; a
 * Research, ResearchPaper, Publication, Encyclopedia or Magazine while it is
 * published; an issue while it and its Magazine are; a sale point while it is
 * published. So every count here is what the listing it leads to shows.
 *
 * GROUPED AND BOUNDED, never a corpus load. Table names are this module's own
 * constants — never anything a caller supplies — and every value is a bound
 * parameter. Where a page of records is listed (downloads, sale points), the
 * ordering query returns identifiers with the total, and the records are then
 * loaded under the public predicate again, so an error in the ordering could
 * only drop a record, never admit one.
 */

/** A public Work, as SQL over `[dbo].[Work] w`. */
const PUBLIC_WORK = Prisma.sql`w.[state] = N'published' AND EXISTS (SELECT 1 FROM [dbo].[Edition] pe WHERE pe.[workId] = w.[id] AND pe.[state] = N'published')`;

/** The same predicate as an ORM filter, for the hydrating reads. */
const PUBLIC_WORK_WHERE = {
  state: 'published',
  editions: { some: { state: 'published' } },
} as const;

/** "May be downloaded", as SQL over one `[dbo].[Edition] e`: the asset route's own decision. */
const DOWNLOADABLE = Prisma.sql`e.[state] = N'published' AND e.[download] = N'allowed' AND e.[downloadAssetId] IS NOT NULL`;

/** The dated scholarly aggregates: a table, its Topic junction and its key, each a constant. */
const DATED: readonly {
  readonly kind: Exclude<LibraryBrowseKind, 'work' | 'magazine'>;
  readonly record: Prisma.Sql;
  readonly topic: Prisma.Sql;
  readonly key: Prisma.Sql;
}[] = [
  {
    kind: 'research',
    record: Prisma.raw('[dbo].[Research]'),
    topic: Prisma.raw('[dbo].[ResearchTopic]'),
    key: Prisma.raw('[researchId]'),
  },
  {
    kind: 'research-paper',
    record: Prisma.raw('[dbo].[ResearchPaper]'),
    topic: Prisma.raw('[dbo].[ResearchPaperTopic]'),
    key: Prisma.raw('[researchPaperId]'),
  },
  {
    kind: 'publication',
    record: Prisma.raw('[dbo].[Publication]'),
    topic: Prisma.raw('[dbo].[PublicationTopic]'),
    key: Prisma.raw('[publicationId]'),
  },
  {
    kind: 'encyclopedia',
    record: Prisma.raw('[dbo].[Encyclopedia]'),
    topic: Prisma.raw('[dbo].[EncyclopediaTopic]'),
    key: Prisma.raw('[encyclopediaId]'),
  },
];

const KIND_ORDER: readonly LibraryBrowseKind[] = [
  'work',
  'research',
  'research-paper',
  'publication',
  'encyclopedia',
  'magazine',
];

/** How many facet rows one downloads facet holds before it says there are more. */
const FACET_PAGE = 50;

const boundedOffset = (value: number) =>
  Math.max(0, Math.min(25_000, Math.trunc(value) || 0));

/** Grouped (key, kind, count) rows as each key's kinds, in the kinds' stated order. */
function byKey(
  rows: readonly { key: string; kind: string; count: number }[],
): Map<string, LibraryKindCount[]> {
  const grouped = new Map<string, LibraryKindCount[]>();
  for (const row of rows) {
    const kind = KIND_ORDER.find((entry) => entry === row.kind);
    const count = Number(row.count);
    if (kind === undefined || count <= 0) continue;
    const kinds = grouped.get(row.key) ?? [];
    kinds.push({ kind, count });
    grouped.set(row.key, kinds);
  }
  for (const kinds of grouped.values())
    kinds.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
  return grouped;
}

/** The label a reader of `locale` is shown first: theirs, else the primary, else the first. */
function titleApply(locale: Locale | null): Prisma.Sql {
  return Prisma.sql`OUTER APPLY (
    SELECT TOP (1) l.[title] FROM [dbo].[WorkLabel] l
    WHERE l.[workId] = w.[id]
    ORDER BY CASE WHEN l.[locale] = ${locale} THEN 0
                  WHEN l.[locale] = w.[primaryLocale] THEN 1 ELSE 2 END, l.[locale]
  ) t`;
}

/** A literal LIKE pattern: every wildcard the text carries is escaped. */
function containing(text: string): string {
  return `%${text.replaceAll(/[\\%_[]/g, (character) => `\\${character}`)}%`;
}

/** The conditions a download query narrows by, over `e` and `w`. */
function downloadWhere(
  q: LibraryDownloadsQuery,
  use: { readonly language: boolean; readonly topic: boolean },
): Prisma.Sql {
  const conditions = [DOWNLOADABLE, Prisma.sql`w.[state] = N'published'`];
  if (use.language && q.language !== null)
    conditions.push(Prisma.sql`e.[languageCode] = ${q.language}`);
  if (use.topic && q.topic !== null)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[WorkTopic] o WHERE o.[workId] = w.[id] AND o.[topicId] = ${q.topic})`,
    );
  return Prisma.join(conditions, ' AND ');
}

const WORK_REFERENCE_SELECT = {
  id: true,
  slug: true,
  primaryLocale: true,
  labels: { select: { locale: true, title: true }, orderBy: { locale: 'asc' as const } },
} satisfies Prisma.WorkSelect;

/** A Work reference row as the contract states it. */
function reference(row: {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: string;
  readonly labels: readonly { readonly locale: string; readonly title: string }[];
}) {
  return {
    id: row.id,
    slug: row.slug,
    primaryLocale: row.primaryLocale as Locale,
    labels: row.labels.map((label) => ({
      locale: label.locale as Locale,
      title: label.title,
    })),
  };
}

export function createLibraryBrowseReader(): Pick<
  LibraryPublicReaderPort,
  | 'holdings'
  | 'topicHoldings'
  | 'languageHoldings'
  | 'contributorDirectory'
  | 'downloads'
  | 'downloadFacets'
  | 'salePointDirectory'
> {
  const db = getDatabaseClient();

  return {
    /** ONE statement: every kind's public count, and the distinct facets. */
    async holdings() {
      const topicUnion = Prisma.join(
        [
          Prisma.sql`SELECT o.[topicId] AS [topic] FROM [dbo].[WorkTopic] o JOIN [dbo].[Work] w ON w.[id] = o.[workId] WHERE ${PUBLIC_WORK}`,
          ...DATED.map(
            (family) =>
              Prisma.sql`SELECT j.[topicId] FROM ${family.topic} j JOIN ${family.record} r ON r.[id] = j.${family.key} WHERE r.[state] = N'published'`,
          ),
          Prisma.sql`SELECT j.[topicId] FROM [dbo].[MagazineTopic] j JOIN [dbo].[Magazine] r ON r.[id] = j.[magazineId] WHERE r.[state] = N'published'`,
        ],
        ' UNION ',
      );
      const languageUnion = Prisma.join(
        [
          Prisma.sql`SELECT e.[languageCode] AS [language] FROM [dbo].[Edition] e JOIN [dbo].[Work] w ON w.[id] = e.[workId] WHERE e.[state] = N'published' AND w.[state] = N'published'`,
          ...DATED.map(
            (family) =>
              Prisma.sql`SELECT r.[languageCode] FROM ${family.record} r WHERE r.[state] = N'published'`,
          ),
        ],
        ' UNION ',
      );
      const counted = (family: (typeof DATED)[number]) =>
        Prisma.sql`(SELECT COUNT(*) FROM ${family.record} r WHERE r.[state] = N'published')`;
      const [research, papers, publications, encyclopedias] = DATED.map(counted);
      const [row] = await db.$queryRaw<Record<string, number | null>[]>`
        SELECT
          (SELECT COUNT(*) FROM [dbo].[Work] w WHERE ${PUBLIC_WORK}) AS [works],
          (SELECT COUNT(*) FROM [dbo].[Work] w WHERE w.[state] = N'published'
             AND EXISTS (SELECT 1 FROM [dbo].[Edition] e WHERE e.[workId] = w.[id]
                         AND e.[state] = N'published' AND e.[reading] = N'allowed')) AS [readableWorks],
          (SELECT COUNT(*) FROM [dbo].[Work] w WHERE w.[state] = N'published'
             AND EXISTS (SELECT 1 FROM [dbo].[Edition] e WHERE e.[workId] = w.[id] AND ${DOWNLOADABLE})) AS [downloadableWorks],
          (SELECT COUNT(*) FROM [dbo].[Edition] e JOIN [dbo].[Work] w ON w.[id] = e.[workId]
             WHERE e.[state] = N'published' AND w.[state] = N'published') AS [editions],
          (SELECT COUNT(*) FROM [dbo].[Edition] e JOIN [dbo].[Work] w ON w.[id] = e.[workId]
             WHERE ${DOWNLOADABLE} AND w.[state] = N'published') AS [downloadableEditions],
          ${research} AS [research],
          ${papers} AS [researchPapers],
          ${publications} AS [publications],
          ${encyclopedias} AS [encyclopedias],
          (SELECT COUNT(*) FROM [dbo].[Magazine] r WHERE r.[state] = N'published') AS [magazines],
          (SELECT COUNT(*) FROM [dbo].[MagazineIssue] i JOIN [dbo].[Magazine] m ON m.[id] = i.[magazineId]
             WHERE i.[state] = N'published' AND m.[state] = N'published') AS [magazineIssues],
          (SELECT COUNT(*) FROM [dbo].[SalePoint] s WHERE s.[state] = N'published') AS [salePoints],
          (SELECT COUNT(*) FROM (${topicUnion}) x) AS [topics],
          (SELECT COUNT(*) FROM (${languageUnion}) x) AS [languages],
          (SELECT COUNT(DISTINCT c.[personId]) FROM [dbo].[WorkContributor] c
             JOIN [dbo].[Work] w ON w.[id] = c.[workId] WHERE ${PUBLIC_WORK}) AS [contributors];`;
      const value = (key: string) => Number(row?.[key] ?? 0);
      return {
        works: value('works'),
        readableWorks: value('readableWorks'),
        downloadableWorks: value('downloadableWorks'),
        editions: value('editions'),
        downloadableEditions: value('downloadableEditions'),
        research: value('research'),
        researchPapers: value('researchPapers'),
        publications: value('publications'),
        encyclopedias: value('encyclopedias'),
        magazines: value('magazines'),
        magazineIssues: value('magazineIssues'),
        salePoints: value('salePoints'),
        topics: value('topics'),
        languages: value('languages'),
        contributors: value('contributors'),
      };
    },

    /** ONE grouped statement over the asked Topics only. */
    async topicHoldings(topics) {
      if (topics.length === 0) return [];
      const asked = Prisma.join([...topics]);
      const branches = [
        Prisma.sql`SELECT o.[topicId] AS [key], N'work' AS [kind] FROM [dbo].[WorkTopic] o
                   JOIN [dbo].[Work] w ON w.[id] = o.[workId]
                   WHERE o.[topicId] IN (${asked}) AND ${PUBLIC_WORK}`,
        ...DATED.map(
          (family) =>
            Prisma.sql`SELECT j.[topicId], ${family.kind} FROM ${family.topic} j
                       JOIN ${family.record} r ON r.[id] = j.${family.key}
                       WHERE j.[topicId] IN (${asked}) AND r.[state] = N'published'`,
        ),
        Prisma.sql`SELECT j.[topicId], N'magazine' FROM [dbo].[MagazineTopic] j
                   JOIN [dbo].[Magazine] r ON r.[id] = j.[magazineId]
                   WHERE j.[topicId] IN (${asked}) AND r.[state] = N'published'`,
      ];
      const rows = await db.$queryRaw<{ key: string; kind: string; count: number }[]>`
        SELECT k.[key], k.[kind], COUNT(*) AS [count]
        FROM (${Prisma.join(branches, ' UNION ALL ')}) k
        GROUP BY k.[key], k.[kind]
        ORDER BY k.[key], k.[kind];`;
      return [...byKey(rows)].map(([topic, kinds]) => ({ topic, kinds }));
    },

    /**
     * ONE grouped statement: a Work once per content language one of its
     * published Editions is in — what the books listing's language filter
     * counts — and each dated record in its own language.
     */
    async languageHoldings() {
      const branches = [
        Prisma.sql`SELECT DISTINCT e.[languageCode] AS [key], e.[workId] AS [id], N'work' AS [kind]
                   FROM [dbo].[Edition] e JOIN [dbo].[Work] w ON w.[id] = e.[workId]
                   WHERE e.[state] = N'published' AND w.[state] = N'published'`,
        ...DATED.map(
          (family) =>
            Prisma.sql`SELECT r.[languageCode], r.[id], ${family.kind} FROM ${family.record} r
                       WHERE r.[state] = N'published'`,
        ),
      ];
      const rows = await db.$queryRaw<{ key: string; kind: string; count: number }[]>`
        SELECT TOP (${LIBRARY_LANGUAGE_HOLDINGS_MAX}) k.[key], k.[kind], COUNT(*) AS [count]
        FROM (${Prisma.join(branches, ' UNION ALL ')}) k
        GROUP BY k.[key], k.[kind]
        ORDER BY k.[key], k.[kind];`;
      return [...byKey(rows)].map(([language, kinds]) => ({ language, kinds }));
    },

    /**
     * ONE grouped statement: per Person credited on a public Work, the
     * distinct Works and the Works per role — most-credited first, then by
     * identifier, so the bound is deterministic.
     */
    async contributorDirectory() {
      const roles = CONTRIBUTION_ROLES.map(
        (role, index) =>
          Prisma.sql`COUNT(DISTINCT CASE WHEN c.[role] = ${role} THEN c.[workId] END) AS ${Prisma.raw(`[r${String(index)}]`)}`,
      );
      const rows = await db.$queryRaw<Record<string, string | number | null>[]>`
        SELECT TOP (${LIBRARY_CONTRIBUTOR_DIRECTORY_MAX + 1})
               c.[personId] AS [id], COUNT(DISTINCT c.[workId]) AS [works], ${Prisma.join(roles)}
        FROM [dbo].[WorkContributor] c
        JOIN [dbo].[Work] w ON w.[id] = c.[workId]
        WHERE ${PUBLIC_WORK}
        GROUP BY c.[personId]
        ORDER BY [works] DESC, [id] ASC;`;
      return {
        items: rows.slice(0, LIBRARY_CONTRIBUTOR_DIRECTORY_MAX).map((row) => ({
          personId: String(row['id']),
          works: Number(row['works'] ?? 0),
          roles: CONTRIBUTION_ROLES.flatMap((role, index) => {
            const works = Number(row[`r${String(index)}`] ?? 0);
            return works > 0 ? [{ role, works }] : [];
          }),
        })),
        hasMore: rows.length > LIBRARY_CONTRIBUTOR_DIRECTORY_MAX,
      };
    },

    async downloads(q) {
      const order =
        q.sort === 'newest'
          ? Prisma.sql`CASE WHEN e.[publicationYear] IS NULL THEN 1 ELSE 0 END, e.[publicationYear] DESC, t.[title] ASC, e.[label] ASC, e.[id] ASC`
          : Prisma.sql`t.[title] ASC, e.[label] ASC, e.[id] ASC`;
      const where = downloadWhere(q, { language: true, topic: true });
      const page = await db.$queryRaw<{ id: string; total: number }[]>`
        SELECT e.[id], COUNT(*) OVER () AS [total]
        FROM [dbo].[Edition] e
        JOIN [dbo].[Work] w ON w.[id] = e.[workId]
        ${titleApply(q.titleLocale)}
        WHERE ${where}
        ORDER BY ${order}
        OFFSET ${boundedOffset(q.offset)} ROWS FETCH NEXT ${q.limit + 1} ROWS ONLY;`;

      // Past the end there is no row to carry the total; it is counted alone.
      const total =
        page[0] !== undefined
          ? Number(page[0].total)
          : q.offset === 0
            ? 0
            : Number(
                (
                  await db.$queryRaw<{ total: number }[]>`
                    SELECT COUNT(*) AS [total] FROM [dbo].[Edition] e
                    JOIN [dbo].[Work] w ON w.[id] = e.[workId] WHERE ${where};`
                )[0]?.total ?? 0,
              );
      const ids = page.slice(0, q.limit).map((row) => row.id);
      if (ids.length === 0) return { items: [], total, hasMore: false };

      const rows = await db.edition.findMany({
        where: {
          id: { in: ids },
          state: 'published',
          download: 'allowed',
          downloadAssetId: { not: null },
          work: PUBLIC_WORK_WHERE,
        },
        select: {
          id: true,
          label: true,
          languageCode: true,
          publisher: true,
          publicationYear: true,
          pageCount: true,
          downloadAssetId: true,
          coverAssetId: true,
          coverWidth: true,
          coverHeight: true,
          work: { select: WORK_REFERENCE_SELECT },
        },
      });
      const byId = new Map(rows.map((row) => [row.id, row]));
      return {
        items: ids.flatMap((id) => {
          const row = byId.get(id);
          if (row === undefined || row.downloadAssetId === null) return [];
          return [
            {
              editionId: row.id,
              assetId: row.downloadAssetId,
              label: row.label,
              languageCode: row.languageCode,
              publisher: row.publisher === '' ? null : row.publisher,
              publicationYear: row.publicationYear,
              pageCount: row.pageCount,
              cover:
                row.coverAssetId === null ||
                row.coverWidth === null ||
                row.coverHeight === null
                  ? null
                  : {
                      assetId: row.coverAssetId,
                      width: row.coverWidth,
                      height: row.coverHeight,
                    },
              work: reference(row.work),
            },
          ];
        }),
        total,
        hasMore: page.length > q.limit,
      };
    },

    /** Each facet counts Editions under the query's OTHER filter, never its own. */
    async downloadFacets(q) {
      const all = downloadWhere(q, { language: false, topic: false });
      const [figures, languages, topics] = await Promise.all([
        db.$queryRaw<{ editions: number; works: number; languages: number }[]>`
          SELECT COUNT(*) AS [editions], COUNT(DISTINCT e.[workId]) AS [works],
                 COUNT(DISTINCT e.[languageCode]) AS [languages]
          FROM [dbo].[Edition] e JOIN [dbo].[Work] w ON w.[id] = e.[workId]
          WHERE ${all};`,
        db.$queryRaw<{ id: string; count: number }[]>`
          SELECT TOP (${FACET_PAGE + 1}) e.[languageCode] AS [id], COUNT(*) AS [count]
          FROM [dbo].[Edition] e JOIN [dbo].[Work] w ON w.[id] = e.[workId]
          WHERE ${downloadWhere(q, { language: false, topic: true })}
          GROUP BY e.[languageCode]
          ORDER BY [count] DESC, [id] ASC;`,
        db.$queryRaw<{ id: string; count: number }[]>`
          SELECT TOP (${FACET_PAGE + 1}) o.[topicId] AS [id], COUNT(DISTINCT e.[id]) AS [count]
          FROM [dbo].[Edition] e
          JOIN [dbo].[Work] w ON w.[id] = e.[workId]
          JOIN [dbo].[WorkTopic] o ON o.[workId] = w.[id]
          WHERE ${downloadWhere(q, { language: true, topic: false })}
          GROUP BY o.[topicId]
          ORDER BY [count] DESC, [id] ASC;`,
      ]);
      const facet = (rows: readonly { id: string; count: number }[]) => ({
        items: rows
          .slice(0, FACET_PAGE)
          .map((row) => ({ id: row.id, editions: Number(row.count) })),
        hasMore: rows.length > FACET_PAGE,
      });
      return {
        editions: Number(figures[0]?.editions ?? 0),
        works: Number(figures[0]?.works ?? 0),
        languageCount: Number(figures[0]?.languages ?? 0),
        languages: facet(languages),
        topics: facet(topics),
      };
    },

    async salePointDirectory(q) {
      const conditions = [Prisma.sql`s.[state] = N'published'`];
      if (q.text !== null) {
        const pattern = containing(q.text);
        conditions.push(
          Prisma.sql`(s.[name] LIKE ${pattern} ESCAPE N'\\' OR s.[address] LIKE ${pattern} ESCAPE N'\\')`,
        );
      }
      const where = Prisma.join(conditions, ' AND ');
      const [page, everything] = await Promise.all([
        db.$queryRaw<{ id: string; total: number }[]>`
          SELECT s.[id], COUNT(*) OVER () AS [total]
          FROM [dbo].[SalePoint] s
          WHERE ${where}
          ORDER BY s.[name] ASC, s.[id] ASC
          OFFSET ${boundedOffset(q.offset)} ROWS FETCH NEXT ${LIBRARY_SALE_POINT_PAGE + 1} ROWS ONLY;`,
        db.$queryRaw<{ salePoints: number; works: number }[]>`
          SELECT
            (SELECT COUNT(*) FROM [dbo].[SalePoint] s WHERE s.[state] = N'published') AS [salePoints],
            (SELECT COUNT(DISTINCT ws.[workId]) FROM [dbo].[WorkSalePoint] ws
               JOIN [dbo].[SalePoint] s ON s.[id] = ws.[salePointId]
               JOIN [dbo].[Work] w ON w.[id] = ws.[workId]
               WHERE s.[state] = N'published' AND ${PUBLIC_WORK}) AS [works];`,
      ]);
      const all = {
        salePoints: Number(everything[0]?.salePoints ?? 0),
        works: Number(everything[0]?.works ?? 0),
      };
      const total =
        page[0] !== undefined
          ? Number(page[0].total)
          : q.offset === 0
            ? 0
            : Number(
                (
                  await db.$queryRaw<{ total: number }[]>`
                    SELECT COUNT(*) AS [total] FROM [dbo].[SalePoint] s WHERE ${where};`
                )[0]?.total ?? 0,
              );
      const ids = page.slice(0, LIBRARY_SALE_POINT_PAGE).map((row) => row.id);
      if (ids.length === 0) return { items: [], total, hasMore: false, all };

      const asked = Prisma.join(ids);
      const [points, counts, firsts] = await Promise.all([
        db.salePoint.findMany({
          where: { id: { in: ids }, state: 'published' },
          select: { id: true, name: true, address: true, contact: true, url: true },
        }),
        db.$queryRaw<{ id: string; count: number }[]>`
          SELECT ws.[salePointId] AS [id], COUNT(*) AS [count]
          FROM [dbo].[WorkSalePoint] ws JOIN [dbo].[Work] w ON w.[id] = ws.[workId]
          WHERE ws.[salePointId] IN (${asked}) AND ${PUBLIC_WORK}
          GROUP BY ws.[salePointId];`,
        db.$queryRaw<{ point: string; work: string }[]>`
          SELECT x.[point], x.[work] FROM (
            SELECT ws.[salePointId] AS [point], w.[id] AS [work],
                   ROW_NUMBER() OVER (PARTITION BY ws.[salePointId] ORDER BY t.[title] ASC, w.[id] ASC) AS [n]
            FROM [dbo].[WorkSalePoint] ws
            JOIN [dbo].[Work] w ON w.[id] = ws.[workId]
            ${titleApply(q.titleLocale)}
            WHERE ws.[salePointId] IN (${asked}) AND ${PUBLIC_WORK}
          ) x
          WHERE x.[n] <= ${LIBRARY_SALE_POINT_WORKS}
          ORDER BY x.[point], x.[n];`,
      ]);
      const workIds = [...new Set(firsts.map((row) => row.work))];
      const works =
        workIds.length === 0
          ? []
          : await db.work.findMany({
              where: { id: { in: workIds }, ...PUBLIC_WORK_WHERE },
              select: WORK_REFERENCE_SELECT,
            });
      const workById = new Map(works.map((row) => [row.id, reference(row)]));
      const countOf = new Map(counts.map((row) => [row.id, Number(row.count)]));
      const pointById = new Map(points.map((row) => [row.id, row]));
      return {
        items: ids.flatMap((id) => {
          const point = pointById.get(id);
          if (point === undefined) return [];
          return [
            {
              id: point.id,
              name: point.name,
              address: point.address,
              contact: point.contact,
              url: point.url,
              works: {
                total: countOf.get(id) ?? 0,
                items: firsts.flatMap((row) => {
                  if (row.point !== id) return [];
                  const work = workById.get(row.work);
                  return work === undefined ? [] : [work];
                }),
              },
            },
          ];
        }),
        total,
        hasMore: page.length > LIBRARY_SALE_POINT_PAGE,
        all,
      };
    },
  };
}
