import 'server-only';

import { Prisma } from '@prisma/client';

import type { Locale } from '@minhaj/contracts';
import type {
  LibraryPublicReaderPort,
  QuranResearchFacetPage,
  QuranResearchItem,
  QuranResearchKind,
  QuranResearchQuery,
} from '@minhaj/contracts/library';
import type { ContributionRole } from '@minhaj/contracts/people';

import { getDatabaseClient } from '../../client.ts';

/**
 * QURAN PART 12 — THE QURAN RESEARCH READ: Library's public Research and
 * ResearchPaper records on the Topic a caller names, for the Quran Research
 * hub composed at Layer 4 (DOMAIN_MODEL.md §10.2).
 *
 * TWO AGGREGATES, ONE SET. Each keeps its own table, its own relation sets and
 * its own public predicate (published); the set is the two read side by side
 * as `UNION ALL`, every row tagged with the aggregate it came from. The table
 * names are this module's own constants — never anything a caller supplies —
 * and every value is a bound parameter.
 *
 * TWO READS, THE SECOND AUTHORITATIVE — as the Quran Books read: one bounded
 * SQL page of (kind, identifier) in the visitor's order with the total the
 * query admits, then those records loaded per aggregate under the public
 * predicate and the Topic again, so an error in the ordering query could only
 * drop a record, never admit one. The readable document is never loaded: the
 * page answers only whether one exists.
 */

interface Tables {
  readonly record: Prisma.Sql;
  readonly label: Prisma.Sql;
  readonly contributor: Prisma.Sql;
  readonly topic: Prisma.Sql;
  /** The foreign-key column each relation set of the aggregate carries. */
  readonly fk: Prisma.Sql;
}

const TABLES: Readonly<Record<QuranResearchKind, Tables>> = Object.freeze({
  research: {
    record: Prisma.raw('[dbo].[Research]'),
    label: Prisma.raw('[dbo].[ResearchLabel]'),
    contributor: Prisma.raw('[dbo].[ResearchContributor]'),
    topic: Prisma.raw('[dbo].[ResearchTopic]'),
    fk: Prisma.raw('[researchId]'),
  },
  'research-paper': {
    record: Prisma.raw('[dbo].[ResearchPaper]'),
    label: Prisma.raw('[dbo].[ResearchPaperLabel]'),
    contributor: Prisma.raw('[dbo].[ResearchPaperContributor]'),
    topic: Prisma.raw('[dbo].[ResearchPaperTopic]'),
    fk: Prisma.raw('[researchPaperId]'),
  },
});

const KINDS: readonly QuranResearchKind[] = ['research', 'research-paper'];

/** Which of the query's filters a statement applies. */
interface Filters {
  readonly kind: boolean;
  readonly language: boolean;
  readonly contributor: boolean;
  readonly decade: boolean;
  readonly fullText: boolean;
}

const ALL_FILTERS: Filters = {
  kind: true,
  language: true,
  contributor: true,
  decade: true,
  fullText: true,
};
const NO_FILTERS: Filters = {
  kind: false,
  language: false,
  contributor: false,
  decade: false,
  fullText: false,
};

/** How many facet rows one facet answers with, at most. */
const FACET_PAGE = 50;
/** How many decades the decade facet answers with, at most. */
const DECADE_CEILING = 100;

const boundedOffset = (value: number) =>
  Math.max(0, Math.min(25_000, Math.trunc(value) || 0));

/** The aggregates a statement reads: one, when the kind filter names one. */
function kindsOf(q: QuranResearchQuery, use: Filters): readonly QuranResearchKind[] {
  return use.kind && q.kind !== 'all' ? [q.kind] : KINDS;
}

/**
 * ONE AGGREGATE'S PART OF THE SET, as SQL over `{record} r`: the public
 * predicate, the Topic, and whichever of the query's filters `use` names.
 */
function whereOf(
  t: Tables,
  topic: string,
  q: QuranResearchQuery,
  use: Filters,
): Prisma.Sql {
  const conditions = [
    Prisma.sql`r.[state] = N'published'`,
    Prisma.sql`EXISTS (SELECT 1 FROM ${t.topic} o WHERE o.${t.fk} = r.[id] AND o.[topicId] = ${topic})`,
  ];
  if (use.language && q.language !== null)
    conditions.push(Prisma.sql`r.[languageCode] = ${q.language}`);
  if (use.contributor && q.contributor !== null)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM ${t.contributor} c WHERE c.${t.fk} = r.[id] AND c.[personId] = ${q.contributor})`,
    );
  if (use.decade && q.decade !== null)
    conditions.push(
      Prisma.sql`r.[publicationYear] >= ${q.decade} AND r.[publicationYear] <= ${q.decade + 9}`,
    );
  if (use.fullText && q.fullText) conditions.push(Prisma.sql`r.[document] IS NOT NULL`);
  return Prisma.join(conditions, ' AND ');
}

/**
 * The set's rows — kind, identifier, content language, year, date and
 * whether the text is on the platform — and, for an order by title, the
 * title a reader of `titleLocale` is shown.
 */
function setOf(
  topic: string,
  q: QuranResearchQuery,
  use: Filters,
  withTitle: boolean,
): Prisma.Sql {
  return Prisma.join(
    kindsOf(q, use).map((kind) => {
      const t = TABLES[kind];
      const title = withTitle
        ? Prisma.sql`, l.[title] AS [title]`
        : Prisma.sql`, CAST(NULL AS nvarchar(240)) AS [title]`;
      const apply = withTitle
        ? Prisma.sql`OUTER APPLY (
            SELECT TOP (1) x.[title] FROM ${t.label} x
            WHERE x.${t.fk} = r.[id]
            ORDER BY CASE WHEN x.[locale] = ${q.titleLocale} THEN 0
                          WHEN x.[locale] = r.[primaryLocale] THEN 1 ELSE 2 END, x.[locale]
          ) l`
        : Prisma.empty;
      return Prisma.sql`SELECT ${kind} AS [kind], r.[id], r.[languageCode], r.[publicationYear], r.[publishedOn],
          CASE WHEN r.[document] IS NULL THEN 0 ELSE 1 END AS [readable]${title}
        FROM ${t.record} r ${apply}
        WHERE ${whereOf(t, topic, q, use)}`;
    }),
    ' UNION ALL ',
  );
}

/** The credited People of the set: one row per (Person, record). */
function creditsOf(topic: string, q: QuranResearchQuery, use: Filters): Prisma.Sql {
  return Prisma.join(
    kindsOf(q, use).map((kind) => {
      const t = TABLES[kind];
      return Prisma.sql`SELECT DISTINCT c.[personId], r.[id]
        FROM ${t.record} r JOIN ${t.contributor} c ON c.${t.fk} = r.[id]
        WHERE ${whereOf(t, topic, q, use)}`;
    }),
    ' UNION ALL ',
  );
}

const ORDERS = {
  newest: Prisma.sql`CASE WHEN s.[publicationYear] IS NULL THEN 1 ELSE 0 END, s.[publicationYear] DESC,
    CASE WHEN s.[publishedOn] IS NULL THEN 1 ELSE 0 END, s.[publishedOn] DESC, s.[title] ASC, s.[kind] ASC, s.[id] ASC`,
  oldest: Prisma.sql`CASE WHEN s.[publicationYear] IS NULL THEN 1 ELSE 0 END, s.[publicationYear] ASC,
    CASE WHEN s.[publishedOn] IS NULL THEN 1 ELSE 0 END, s.[publishedOn] ASC, s.[title] ASC, s.[kind] ASC, s.[id] ASC`,
  title: Prisma.sql`s.[title] ASC, s.[kind] ASC, s.[id] ASC`,
} as const;

/** A SQL `date` read back as the `YYYY-MM-DD` it is — never shifted by a zone. */
function isoDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

const EMPTY_FACETS: QuranResearchFacetPage = { items: [], hasMore: false };

function facetPage(
  rows: readonly { id: string; count: number }[],
): QuranResearchFacetPage {
  return {
    items: rows
      .slice(0, FACET_PAGE)
      .map((row) => ({ id: row.id, records: Number(row.count) })),
    hasMore: rows.length > FACET_PAGE,
  };
}

const LABEL_SELECT = {
  select: { locale: true, title: true, summary: true },
  orderBy: { locale: 'asc' as const },
};
const CONTRIBUTOR_SELECT = {
  select: { personId: true, role: true },
  orderBy: [
    { position: 'asc' as const },
    { personId: 'asc' as const },
    { role: 'asc' as const },
  ],
};

export function createQuranResearchReader(): Pick<
  LibraryPublicReaderPort,
  'quranResearch' | 'quranResearchFacets'
> {
  const db = getDatabaseClient();

  /** Every record of a filtered set, by kind, with the text on the platform. */
  async function counts(topic: string, q: QuranResearchQuery, use: Filters) {
    const [row] = await db.$queryRaw<
      {
        records: number;
        research: number | null;
        papers: number | null;
        readable: number | null;
      }[]
    >`
      WITH s AS (${setOf(topic, q, use, false)})
      SELECT COUNT(*) AS [records],
             SUM(CASE WHEN s.[kind] = N'research' THEN 1 ELSE 0 END) AS [research],
             SUM(CASE WHEN s.[kind] = N'research-paper' THEN 1 ELSE 0 END) AS [papers],
             SUM(s.[readable]) AS [readable]
      FROM s;`;
    return {
      records: Number(row?.records ?? 0),
      research: Number(row?.research ?? 0),
      papers: Number(row?.papers ?? 0),
      readable: Number(row?.readable ?? 0),
    };
  }

  return {
    async quranResearch(q) {
      // With no Topic nothing is "research on the Quran": no record carries a
      // passage, so the set is empty rather than every record.
      if (q.topic === null) return { items: [], total: 0, hasMore: false };
      const topic = q.topic;
      const page = await db.$queryRaw<{ kind: string; id: string; total: number }[]>`
        WITH s AS (${setOf(topic, q, ALL_FILTERS, true)})
        SELECT s.[kind], s.[id], COUNT(*) OVER () AS [total]
        FROM s
        ORDER BY ${ORDERS[q.sort]}
        OFFSET ${boundedOffset(q.offset)} ROWS FETCH NEXT ${q.limit + 1} ROWS ONLY`;

      // Past the end there is no row to carry the total; it is counted alone.
      const total =
        page[0] === undefined
          ? q.offset === 0
            ? 0
            : (await counts(topic, q, ALL_FILTERS)).records
          : Number(page[0].total);
      const rows = page.slice(0, q.limit);
      if (rows.length === 0) return { items: [], total, hasMore: false };

      const idsOf = (kind: QuranResearchKind) =>
        rows.filter((row) => row.kind === kind).map((row) => row.id);
      const researchIds = idsOf('research');
      const paperIds = idsOf('research-paper');
      const membership = { state: 'published', topics: { some: { topicId: topic } } };

      const [research, papers, readable] = await Promise.all([
        researchIds.length === 0
          ? Promise.resolve([])
          : db.research.findMany({
              where: { ...membership, id: { in: researchIds } },
              select: {
                id: true,
                slug: true,
                primaryLocale: true,
                languageCode: true,
                publicationYear: true,
                publishedOn: true,
                institutionalContext: true,
                abstract: true,
                labels: LABEL_SELECT,
                contributors: CONTRIBUTOR_SELECT,
                _count: { select: { citations: true } },
              },
            }),
        paperIds.length === 0
          ? Promise.resolve([])
          : db.researchPaper.findMany({
              where: { ...membership, id: { in: paperIds } },
              select: {
                id: true,
                slug: true,
                primaryLocale: true,
                languageCode: true,
                publicationYear: true,
                publishedOn: true,
                institutionalContext: true,
                abstract: true,
                venue: true,
                doi: true,
                labels: LABEL_SELECT,
                contributors: CONTRIBUTOR_SELECT,
                _count: { select: { citations: true } },
              },
            }),
        // Whether each record's text is on the platform, without reading it.
        Promise.all([
          researchIds.length === 0
            ? Promise.resolve([])
            : db.research.findMany({
                where: { id: { in: researchIds }, document: { not: null } },
                select: { id: true },
              }),
          paperIds.length === 0
            ? Promise.resolve([])
            : db.researchPaper.findMany({
                where: { id: { in: paperIds }, document: { not: null } },
                select: { id: true },
              }),
        ]),
      ]);
      const withText = new Set(readable.flat().map((row) => row.id));

      type Loaded = (typeof research)[number] & {
        readonly venue?: string | null;
        readonly doi?: string | null;
      };
      const toItem = (kind: QuranResearchKind, row: Loaded): QuranResearchItem => ({
        kind,
        id: row.id,
        slug: row.slug,
        primaryLocale: row.primaryLocale as Locale,
        labels: row.labels.map((label) => ({
          locale: label.locale as Locale,
          title: label.title,
          summary: label.summary,
        })),
        contributors: row.contributors.map((entry) => ({
          personId: entry.personId,
          role: entry.role as ContributionRole,
        })),
        languageCode: row.languageCode,
        publicationYear: row.publicationYear,
        publishedOn: isoDate(row.publishedOn),
        institutionalContext: row.institutionalContext,
        abstract: row.abstract,
        venue: row.venue ?? null,
        doi: row.doi ?? null,
        citations: row._count.citations,
        readable: withText.has(row.id),
      });
      const byKey = new Map<string, QuranResearchItem>([
        ...research.map(
          (row) => [`research:${row.id}`, toItem('research', row)] as const,
        ),
        ...papers.map(
          (row) => [`research-paper:${row.id}`, toItem('research-paper', row)] as const,
        ),
      ]);
      const items = rows.flatMap((row) => {
        const item = byKey.get(`${row.kind}:${row.id}`);
        return item === undefined ? [] : [item];
      });
      return { items, total, hasMore: page.length > q.limit };
    },

    /**
     * GROUPED READS, each bounded: a facet's own filter is left out of its
     * own counts, so every option says how many records choosing it would
     * show.
     */
    async quranResearchFacets(q) {
      if (q.topic === null)
        return {
          hub: {
            records: 0,
            research: 0,
            papers: 0,
            readable: 0,
            languages: 0,
            contributors: 0,
            earliest: null,
            latest: null,
          },
          kinds: { all: 0, research: 0, papers: 0 },
          languages: EMPTY_FACETS,
          contributors: EMPTY_FACETS,
          decades: [],
          readable: 0,
        };
      const topic = q.topic;
      const without = (key: keyof Filters): Filters => ({ ...ALL_FILTERS, [key]: false });
      const [hub, spread, kinds, languages, contributors, decades, readable] =
        await Promise.all([
          counts(topic, q, NO_FILTERS),
          db.$queryRaw<
            {
              languages: number;
              contributors: number;
              earliest: number | null;
              latest: number | null;
            }[]
          >`
            WITH s AS (${setOf(topic, q, NO_FILTERS, false)})
            SELECT (SELECT COUNT(DISTINCT s.[languageCode]) FROM s) AS [languages],
                   (SELECT COUNT(DISTINCT p.[personId]) FROM (${creditsOf(topic, q, NO_FILTERS)}) p) AS [contributors],
                   (SELECT MIN(s.[publicationYear]) FROM s) AS [earliest],
                   (SELECT MAX(s.[publicationYear]) FROM s) AS [latest];`,
          counts(topic, q, without('kind')),
          db.$queryRaw<{ id: string; count: number }[]>`
            WITH s AS (${setOf(topic, q, without('language'), false)})
            SELECT TOP (${FACET_PAGE + 1}) s.[languageCode] AS [id], COUNT(*) AS [count]
            FROM s
            GROUP BY s.[languageCode]
            ORDER BY [count] DESC, [id] ASC;`,
          db.$queryRaw<{ id: string; count: number }[]>`
            SELECT TOP (${FACET_PAGE + 1}) p.[personId] AS [id], COUNT(*) AS [count]
            FROM (${creditsOf(topic, q, without('contributor'))}) p
            GROUP BY p.[personId]
            ORDER BY [count] DESC, [id] ASC;`,
          db.$queryRaw<{ decade: number; count: number }[]>`
            WITH s AS (${setOf(topic, q, without('decade'), false)})
            SELECT TOP (${DECADE_CEILING}) (s.[publicationYear] / 10) * 10 AS [decade], COUNT(*) AS [count]
            FROM s
            WHERE s.[publicationYear] IS NOT NULL
            GROUP BY (s.[publicationYear] / 10) * 10
            ORDER BY [decade] DESC;`,
          counts(topic, q, without('fullText')),
        ]);
      const row = spread[0];
      return {
        hub: {
          ...hub,
          languages: Number(row?.languages ?? 0),
          contributors: Number(row?.contributors ?? 0),
          earliest:
            row === undefined || row.earliest === null ? null : Number(row.earliest),
          latest: row === undefined || row.latest === null ? null : Number(row.latest),
        },
        kinds: { all: kinds.records, research: kinds.research, papers: kinds.papers },
        languages: facetPage(languages),
        contributors: facetPage(contributors),
        decades: decades.map((entry) => ({
          decade: Number(entry.decade),
          records: Number(entry.count),
        })),
        readable: readable.readable,
      };
    },
  };
}
