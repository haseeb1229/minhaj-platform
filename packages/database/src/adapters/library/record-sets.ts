import 'server-only';

import { Prisma } from '@prisma/client';

import type {
  TopicResearchFacetPage,
  TopicResearchScope,
  TopicResearchSort,
} from '@minhaj/contracts/library';

import type { getDatabaseClient } from '../../client.ts';

/**
 * THE LIBRARY'S RECORD SETS (Quran Part 12; generalised in Library Part 3) —
 * the SQL a listing of public scholarly records is made of, shared by the
 * research read (`./topic-research.ts`: Research and ResearchPaper) and the
 * published-records read (`./published-records.ts`: Publication and
 * Encyclopedia).
 *
 * AGGREGATES STAY APART. Each kind keeps its own table, its own relation sets
 * and its own public predicate (published); a set of several is the kinds read
 * side by side as `UNION ALL`, every row tagged with the aggregate it came
 * from. The table names are this module's own constants — never anything a
 * caller supplies — and every value is a bound parameter.
 *
 * TWO SCOPES. `topic`: membership is the named Topic (with none, the set is
 * empty — the caller answers that before any read); `library`: every public
 * record, the Topic one more narrowing filter with a facet of its own.
 */

export type SetKind = 'research' | 'research-paper' | 'publication' | 'encyclopedia';

interface Tables {
  readonly record: Prisma.Sql;
  readonly label: Prisma.Sql;
  readonly contributor: Prisma.Sql;
  readonly topic: Prisma.Sql;
  /** The foreign-key column each relation set of the aggregate carries. */
  readonly fk: Prisma.Sql;
}

export const TABLES: Readonly<Record<SetKind, Tables>> = Object.freeze({
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
  publication: {
    record: Prisma.raw('[dbo].[Publication]'),
    label: Prisma.raw('[dbo].[PublicationLabel]'),
    contributor: Prisma.raw('[dbo].[PublicationContributor]'),
    topic: Prisma.raw('[dbo].[PublicationTopic]'),
    fk: Prisma.raw('[publicationId]'),
  },
  encyclopedia: {
    record: Prisma.raw('[dbo].[Encyclopedia]'),
    label: Prisma.raw('[dbo].[EncyclopediaLabel]'),
    contributor: Prisma.raw('[dbo].[EncyclopediaContributor]'),
    topic: Prisma.raw('[dbo].[EncyclopediaTopic]'),
    fk: Prisma.raw('[encyclopediaId]'),
  },
});

/** One read of a set: which aggregates, which scope, and the view's filters. */
export interface SetQuery {
  /** The aggregates the set is made of. */
  readonly kinds: readonly SetKind[];
  readonly scope: TopicResearchScope;
  readonly topic: string | null;
  /** One of `kinds`, or every one. */
  readonly kind: 'all' | SetKind;
  readonly language: string | null;
  readonly contributor: string | null;
  readonly decade: number | null;
  readonly fullText: boolean;
  readonly sort: TopicResearchSort;
  readonly titleLocale: string | null;
  readonly offset: number;
  readonly limit: number;
}

/** Which of the query's filters a statement applies. */
export interface Filters {
  readonly kind: boolean;
  /** The Topic — a filter in the whole Library only; a hub's Topic always applies. */
  readonly topic: boolean;
  readonly language: boolean;
  readonly contributor: boolean;
  readonly decade: boolean;
  readonly fullText: boolean;
}

export const ALL_FILTERS: Filters = {
  kind: true,
  topic: true,
  language: true,
  contributor: true,
  decade: true,
  fullText: true,
};
export const NO_FILTERS: Filters = {
  kind: false,
  topic: false,
  language: false,
  contributor: false,
  decade: false,
  fullText: false,
};

/** Every filter but the named one. */
export const without = (key: keyof Filters): Filters => ({
  ...ALL_FILTERS,
  [key]: false,
});

/** How many facet rows one facet answers with, at most. */
export const FACET_PAGE = 50;
/** How many decades the decade facet answers with, at most. */
const DECADE_CEILING = 100;

export const boundedOffset = (value: number) =>
  Math.max(0, Math.min(25_000, Math.trunc(value) || 0));

/** Whether a read has a set at all: a hub without its Topic has none. */
export function hasSet(q: Pick<SetQuery, 'scope' | 'topic'>): boolean {
  return q.scope === 'library' || q.topic !== null;
}

/** The aggregates a statement reads: one, when the kind filter names one. */
function kindsOf(q: SetQuery, use: Filters): readonly SetKind[] {
  return use.kind && q.kind !== 'all' ? [q.kind] : q.kinds;
}

/**
 * ONE AGGREGATE'S PART OF THE SET, as SQL over `{record} r`: the public
 * predicate, membership, and whichever of the query's filters `use` names.
 */
function whereOf(t: Tables, q: SetQuery, use: Filters): Prisma.Sql {
  const conditions = [Prisma.sql`r.[state] = N'published'`];
  const onTopic =
    q.topic === null
      ? null
      : Prisma.sql`EXISTS (SELECT 1 FROM ${t.topic} o WHERE o.${t.fk} = r.[id] AND o.[topicId] = ${q.topic})`;
  // A hub's Topic is its membership; the whole Library's is a filter.
  if (onTopic !== null && (q.scope === 'topic' || use.topic)) conditions.push(onTopic);
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
export function setOf(q: SetQuery, use: Filters, withTitle: boolean): Prisma.Sql {
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
        WHERE ${whereOf(t, q, use)}`;
    }),
    ' UNION ALL ',
  );
}

/** The credited People of the set: one row per (Person, record). */
function creditsOf(q: SetQuery, use: Filters): Prisma.Sql {
  return Prisma.join(
    kindsOf(q, use).map((kind) => {
      const t = TABLES[kind];
      return Prisma.sql`SELECT DISTINCT c.[personId], r.[id]
        FROM ${t.record} r JOIN ${t.contributor} c ON c.${t.fk} = r.[id]
        WHERE ${whereOf(t, q, use)}`;
    }),
    ' UNION ALL ',
  );
}

/** The Topics of the set: one row per (Topic, record). */
function topicsOf(q: SetQuery, use: Filters): Prisma.Sql {
  return Prisma.join(
    kindsOf(q, use).map((kind) => {
      const t = TABLES[kind];
      return Prisma.sql`SELECT o.[topicId], r.[id]
        FROM ${t.record} r JOIN ${t.topic} o ON o.${t.fk} = r.[id]
        WHERE ${whereOf(t, q, use)}`;
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
export function isoDate(value: Date | null): string | null {
  return value === null ? null : value.toISOString().slice(0, 10);
}

export const EMPTY_FACETS: TopicResearchFacetPage = { items: [], hasMore: false };

function facetPage(
  rows: readonly { id: string; count: number }[],
): TopicResearchFacetPage {
  return {
    items: rows
      .slice(0, FACET_PAGE)
      .map((row) => ({ id: row.id, records: Number(row.count) })),
    hasMore: rows.length > FACET_PAGE,
  };
}

/** Every record of a filtered set, by kind, with the text on the platform. */
export interface SetCounts {
  readonly records: number;
  readonly byKind: ReadonlyMap<SetKind, number>;
  readonly readable: number;
}

export type Db = ReturnType<typeof getDatabaseClient>;

export async function countsOf(db: Db, q: SetQuery, use: Filters): Promise<SetCounts> {
  const rows = await db.$queryRaw<{ kind: SetKind; records: number; readable: number }[]>`
    WITH s AS (${setOf(q, use, false)})
    SELECT s.[kind], COUNT(*) AS [records], SUM(s.[readable]) AS [readable]
    FROM s
    GROUP BY s.[kind];`;
  return {
    records: rows.reduce((sum, row) => sum + Number(row.records), 0),
    byKind: new Map(rows.map((row) => [row.kind, Number(row.records)])),
    readable: rows.reduce((sum, row) => sum + Number(row.readable ?? 0), 0),
  };
}

/**
 * ONE BOUNDED PAGE of (kind, identifier) in the visitor's order, with the
 * total the query admits. The caller loads those records again under the
 * public predicate, so an error here could only drop a record, never admit
 * one.
 */
export async function pageOf(
  db: Db,
  q: SetQuery,
): Promise<{
  readonly rows: readonly { kind: SetKind; id: string }[];
  readonly total: number;
  readonly hasMore: boolean;
}> {
  const page = await db.$queryRaw<{ kind: SetKind; id: string; total: number }[]>`
    WITH s AS (${setOf(q, ALL_FILTERS, true)})
    SELECT s.[kind], s.[id], COUNT(*) OVER () AS [total]
    FROM s
    ORDER BY ${ORDERS[q.sort]}
    OFFSET ${boundedOffset(q.offset)} ROWS FETCH NEXT ${q.limit + 1} ROWS ONLY`;

  // Past the end there is no row to carry the total; it is counted alone.
  const total =
    page[0] === undefined
      ? q.offset === 0
        ? 0
        : (await countsOf(db, q, ALL_FILTERS)).records
      : Number(page[0].total);
  return {
    rows: page.slice(0, q.limit).map((row) => ({ kind: row.kind, id: row.id })),
    total,
    hasMore: page.length > q.limit,
  };
}

/**
 * The set's GROUPED READS, each bounded: the unfiltered spread (content
 * languages, credited People, earliest and latest year), and the languages,
 * contributors, decades, Topics (whole Library only) and full-text count,
 * each counted without its own filter, so every option says how many
 * records choosing it would show.
 */
export async function facetsOf(db: Db, q: SetQuery, base: Filters = NO_FILTERS) {
  const [spread, languages, contributors, decades, topics, readable] = await Promise.all([
    db.$queryRaw<
      {
        languages: number;
        contributors: number;
        earliest: number | null;
        latest: number | null;
      }[]
    >`
      WITH s AS (${setOf(q, base, false)})
      SELECT (SELECT COUNT(DISTINCT s.[languageCode]) FROM s) AS [languages],
             (SELECT COUNT(DISTINCT p.[personId]) FROM (${creditsOf(q, base)}) p) AS [contributors],
             (SELECT MIN(s.[publicationYear]) FROM s) AS [earliest],
             (SELECT MAX(s.[publicationYear]) FROM s) AS [latest];`,
    db.$queryRaw<{ id: string; count: number }[]>`
      WITH s AS (${setOf(q, without('language'), false)})
      SELECT TOP (${FACET_PAGE + 1}) s.[languageCode] AS [id], COUNT(*) AS [count]
      FROM s
      GROUP BY s.[languageCode]
      ORDER BY [count] DESC, [id] ASC;`,
    db.$queryRaw<{ id: string; count: number }[]>`
      SELECT TOP (${FACET_PAGE + 1}) p.[personId] AS [id], COUNT(*) AS [count]
      FROM (${creditsOf(q, without('contributor'))}) p
      GROUP BY p.[personId]
      ORDER BY [count] DESC, [id] ASC;`,
    db.$queryRaw<{ decade: number; count: number }[]>`
      WITH s AS (${setOf(q, without('decade'), false)})
      SELECT TOP (${DECADE_CEILING}) (s.[publicationYear] / 10) * 10 AS [decade], COUNT(*) AS [count]
      FROM s
      WHERE s.[publicationYear] IS NOT NULL
      GROUP BY (s.[publicationYear] / 10) * 10
      ORDER BY [decade] DESC;`,
    // A hub has one Topic: only the whole Library is browsed by Topic.
    q.scope === 'library'
      ? db.$queryRaw<{ id: string; count: number }[]>`
        SELECT TOP (${FACET_PAGE + 1}) p.[topicId] AS [id], COUNT(*) AS [count]
        FROM (${topicsOf(q, without('topic'))}) p
        GROUP BY p.[topicId]
        ORDER BY [count] DESC, [id] ASC;`
      : Promise.resolve([]),
    countsOf(db, q, without('fullText')),
  ]);
  const row = spread[0];
  return {
    languages: Number(row?.languages ?? 0),
    contributors: Number(row?.contributors ?? 0),
    earliest: row === undefined || row.earliest === null ? null : Number(row.earliest),
    latest: row === undefined || row.latest === null ? null : Number(row.latest),
    languageFacet: facetPage(languages),
    contributorFacet: facetPage(contributors),
    decades: decades.map((entry) => ({
      decade: Number(entry.decade),
      records: Number(entry.count),
    })),
    topicFacet: topics.length === 0 ? EMPTY_FACETS : facetPage(topics),
    readable: readable.readable,
  };
}

/**
 * MEMBERSHIP AS AN ORM FILTER, re-applied by the hydrating read: the public
 * predicate, and the Topic where it applies.
 */
export function membershipOf(q: Pick<SetQuery, 'scope' | 'topic'>) {
  return {
    state: 'published',
    ...(q.topic === null ? {} : { topics: { some: { topicId: q.topic } } }),
  };
}

export const LABEL_SELECT = {
  select: { locale: true, title: true, summary: true },
  orderBy: { locale: 'asc' as const },
};
export const CONTRIBUTOR_SELECT = {
  select: { personId: true, role: true },
  orderBy: [
    { position: 'asc' as const },
    { personId: 'asc' as const },
    { role: 'asc' as const },
  ],
};
