import 'server-only';

import { Prisma } from '@prisma/client';

import {
  TOPIC_COURSE_PATHS,
  type LearningPublicReaderPort,
  type TopicCourseFacetPage,
  type TopicCourseQuery,
} from '@minhaj/contracts/learning';

import { getDatabaseClient } from '../../client.ts';
import {
  COURSE_LISTING_SELECT,
  PUBLIC_PATH_LISTING_SELECT,
  toCourseListing,
  toPathListing,
} from './records.ts';
import { boundedOffset, PUBLISHED } from './shared.ts';

/**
 * QURAN PART 13 — A TOPIC'S COURSES, for a course hub composed at Layer 4 (the
 * Quran Courses hub names Taxonomy's `quran` Topic; DOMAIN_MODEL.md §13.4).
 *
 * ONE SET, ONE DEFINITION. Every statement below reads `[dbo].[Course] c`
 * under `whereOf`: the public predicate (published), the Topic, and whichever
 * of the query's filters the statement applies — so the page, its total and
 * every count agree about what exists. Every value is a bound parameter; the
 * only SQL text is this module's own.
 *
 * TWO READS, THE SECOND AUTHORITATIVE — as the Quran Books and Research reads:
 * one bounded SQL page of identifiers in the learner's order with the total
 * the query admits, then those Courses loaded as the catalogue's own cards
 * under the public predicate and the Topic again, so an error in the ordering
 * statement could only drop a Course, never admit one.
 *
 * LEARN PART 1 — THE CATALOGUE. Under `scope: 'catalogue'` the set is every
 * published Course and the Topic is one more filter, with a facet of its own;
 * under the default `scope: 'topic'` the Topic is the set's own definition and
 * with none nothing is read. `scopeOf` decides which, once, for every
 * statement.
 *
 * NOTHING PRIVATE IS READ: no Enrolment, Progress, request, class or lesson
 * body — a card is the catalogue's `COURSE_LISTING_SELECT`.
 */

/** Which of the query's filters a statement applies. */
interface Filters {
  readonly topic: boolean;
  readonly format: boolean;
  readonly level: boolean;
  readonly language: boolean;
  readonly teacher: boolean;
}

const ALL_FILTERS: Filters = {
  topic: true,
  format: true,
  level: true,
  language: true,
  teacher: true,
};
const NO_FILTERS: Filters = {
  topic: false,
  format: false,
  level: false,
  language: false,
  teacher: false,
};

/**
 * What a query is over: the Topic that DEFINES a hub's set (applied by every
 * statement, whatever the filters), or the catalogue with an optional Topic
 * FILTER — or `null` when it is a hub's read with no Topic, which reads
 * nothing.
 */
type Scope =
  | { readonly kind: 'topic'; readonly topic: string }
  | { readonly kind: 'catalogue'; readonly topic: string | null };

function scopeOf(q: TopicCourseQuery): Scope | null {
  if (q.scope === 'catalogue') return { kind: 'catalogue', topic: q.topic };
  return q.topic === null ? null : { kind: 'topic', topic: q.topic };
}

/** How many facet rows one facet answers with, at most. */
const FACET_PAGE = 50;

/** The set, as SQL over `[dbo].[Course] c`. */
function whereOf(scope: Scope, q: TopicCourseQuery, use: Filters): Prisma.Sql {
  const conditions = [Prisma.sql`c.[state] = N'published'`];
  // A hub's Topic is its set; the catalogue's narrows only while it is a filter.
  const topic = scope.kind === 'topic' ? scope.topic : use.topic ? scope.topic : null;
  if (topic !== null)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[CourseTopic] o WHERE o.[courseId] = c.[id] AND o.[topicId] = ${topic})`,
    );
  if (use.format && q.format !== null)
    conditions.push(Prisma.sql`c.[format] = ${q.format}`);
  if (use.level && q.level !== null) conditions.push(Prisma.sql`c.[level] = ${q.level}`);
  if (use.language && q.language !== null)
    conditions.push(Prisma.sql`c.[languageCode] = ${q.language}`);
  if (use.teacher && q.teacher !== null)
    conditions.push(
      Prisma.sql`EXISTS (SELECT 1 FROM [dbo].[CourseTeacher] t WHERE t.[courseId] = c.[id] AND t.[personId] = ${q.teacher})`,
    );
  return Prisma.join(conditions, ' AND ');
}

const ORDERS = {
  level: Prisma.sql`CASE c.[level] WHEN N'beginner' THEN 0 WHEN N'intermediate' THEN 1
    WHEN N'advanced' THEN 2 ELSE 3 END, c.[publishedAt] DESC, c.[slug] ASC, c.[id] ASC`,
  newest: Prisma.sql`c.[publishedAt] DESC, c.[slug] ASC, c.[id] ASC`,
  title: Prisma.sql`l.[title] ASC, c.[slug] ASC, c.[id] ASC`,
} as const;

const EMPTY_FACETS: TopicCourseFacetPage = { items: [], hasMore: false };

function facetPage(rows: readonly { id: string; count: number }[]): TopicCourseFacetPage {
  return {
    items: rows
      .slice(0, FACET_PAGE)
      .map((row) => ({ id: row.id, courses: Number(row.count) })),
    hasMore: rows.length > FACET_PAGE,
  };
}

export function createTopicCourseReader(): Pick<
  LearningPublicReaderPort,
  'topicCourses' | 'topicCourseFacets' | 'topicCoursePaths' | 'topicCourseTotals'
> {
  const db = getDatabaseClient();

  /** How many Courses a filtered set holds, and how many of each format. */
  async function counts(scope: Scope, q: TopicCourseQuery, use: Filters) {
    const [row] = await db.$queryRaw<
      { courses: number; live: number | null; selfPaced: number | null }[]
    >`
      SELECT COUNT(*) AS [courses],
             SUM(CASE WHEN c.[format] = N'live' THEN 1 ELSE 0 END) AS [live],
             SUM(CASE WHEN c.[format] = N'self-paced' THEN 1 ELSE 0 END) AS [selfPaced]
      FROM [dbo].[Course] c
      WHERE ${whereOf(scope, q, use)};`;
    return {
      courses: Number(row?.courses ?? 0),
      live: Number(row?.live ?? 0),
      selfPaced: Number(row?.selfPaced ?? 0),
    };
  }

  return {
    async topicCourses(q) {
      // A hub with no Topic has no "course on the Topic": empty, never every Course.
      const scope = scopeOf(q);
      if (scope === null) return { items: [], total: 0, hasMore: false };
      const page = await db.$queryRaw<{ id: string; total: number }[]>`
        SELECT c.[id], COUNT(*) OVER () AS [total]
        FROM [dbo].[Course] c
        OUTER APPLY (
          SELECT TOP (1) x.[title] FROM [dbo].[CourseLabel] x
          WHERE x.[courseId] = c.[id]
          ORDER BY CASE WHEN x.[locale] = ${q.titleLocale} THEN 0
                        WHEN x.[locale] = c.[primaryLocale] THEN 1 ELSE 2 END, x.[locale]
        ) l
        WHERE ${whereOf(scope, q, ALL_FILTERS)}
        ORDER BY ${ORDERS[q.sort]}
        OFFSET ${boundedOffset(q.offset)} ROWS FETCH NEXT ${q.limit + 1} ROWS ONLY`;

      // Past the end there is no row to carry the total; it is counted alone.
      const total =
        page[0] === undefined
          ? q.offset === 0
            ? 0
            : (await counts(scope, q, ALL_FILTERS)).courses
          : Number(page[0].total);
      const ids = page.slice(0, q.limit).map((row) => row.id);
      if (ids.length === 0) return { items: [], total, hasMore: false };

      const topic = scope.kind === 'topic' ? scope.topic : q.topic;
      const rows = await db.course.findMany({
        where: {
          id: { in: ids },
          ...PUBLISHED,
          ...(topic === null ? {} : { topics: { some: { topicId: topic } } }),
        },
        select: COURSE_LISTING_SELECT,
      });
      const byId = new Map(rows.map((row) => [row.id, toCourseListing(row)]));
      const items = ids.flatMap((id) => {
        const item = byId.get(id);
        return item === undefined ? [] : [item];
      });
      return { items, total, hasMore: page.length > q.limit };
    },

    /**
     * GROUPED READS, each bounded: a facet's own filter is left out of its
     * own counts, so every option says how many Courses choosing it would
     * show.
     */
    async topicCourseFacets(q) {
      const scope = scopeOf(q);
      if (scope === null)
        return {
          hub: {
            courses: 0,
            live: 0,
            selfPaced: 0,
            lessons: 0,
            teachers: 0,
            languages: 0,
          },
          formats: { all: 0, live: 0, selfPaced: 0 },
          levels: { beginner: 0, intermediate: 0, advanced: 0 },
          languages: EMPTY_FACETS,
          teachers: EMPTY_FACETS,
          topics: EMPTY_FACETS,
        };
      const without = (key: keyof Filters): Filters => ({ ...ALL_FILTERS, [key]: false });
      const whole = whereOf(scope, q, NO_FILTERS);
      const [hub, spread, formats, levels, languages, teachers, topics] =
        await Promise.all([
          counts(scope, q, NO_FILTERS),
          db.$queryRaw<{ lessons: number; teachers: number; languages: number }[]>`
          SELECT (SELECT COUNT(*) FROM [dbo].[Lesson] x
                  WHERE x.[courseId] IN (SELECT c.[id] FROM [dbo].[Course] c WHERE ${whole})) AS [lessons],
                 (SELECT COUNT(DISTINCT t.[personId]) FROM [dbo].[CourseTeacher] t
                  WHERE t.[courseId] IN (SELECT c.[id] FROM [dbo].[Course] c WHERE ${whole})) AS [teachers],
                 (SELECT COUNT(DISTINCT c.[languageCode]) FROM [dbo].[Course] c WHERE ${whole}) AS [languages];`,
          counts(scope, q, without('format')),
          db.$queryRaw<{ id: string; count: number }[]>`
          SELECT c.[level] AS [id], COUNT(*) AS [count]
          FROM [dbo].[Course] c
          WHERE ${whereOf(scope, q, without('level'))} AND c.[level] IS NOT NULL
          GROUP BY c.[level];`,
          db.$queryRaw<{ id: string; count: number }[]>`
          SELECT TOP (${FACET_PAGE + 1}) c.[languageCode] AS [id], COUNT(*) AS [count]
          FROM [dbo].[Course] c
          WHERE ${whereOf(scope, q, without('language'))}
          GROUP BY c.[languageCode]
          ORDER BY [count] DESC, [id] ASC;`,
          db.$queryRaw<{ id: string; count: number }[]>`
          SELECT TOP (${FACET_PAGE + 1}) t.[personId] AS [id], COUNT(*) AS [count]
          FROM [dbo].[CourseTeacher] t
          JOIN [dbo].[Course] c ON c.[id] = t.[courseId]
          WHERE ${whereOf(scope, q, without('teacher'))}
          GROUP BY t.[personId]
          ORDER BY [count] DESC, [id] ASC;`,
          // A hub has one Topic; only the catalogue is navigated by Topic.
          scope.kind === 'topic'
            ? Promise.resolve([])
            : db.$queryRaw<{ id: string; count: number }[]>`
          SELECT TOP (${FACET_PAGE + 1}) o.[topicId] AS [id], COUNT(*) AS [count]
          FROM [dbo].[CourseTopic] o
          JOIN [dbo].[Course] c ON c.[id] = o.[courseId]
          WHERE ${whereOf(scope, q, without('topic'))}
          GROUP BY o.[topicId]
          ORDER BY [count] DESC, [id] ASC;`,
        ]);
      const row = spread[0];
      const level = (name: string) =>
        Number(levels.find((entry) => entry.id === name)?.count ?? 0);
      return {
        hub: {
          ...hub,
          lessons: Number(row?.lessons ?? 0),
          teachers: Number(row?.teachers ?? 0),
          languages: Number(row?.languages ?? 0),
        },
        formats: {
          all: formats.courses,
          live: formats.live,
          selfPaced: formats.selfPaced,
        },
        levels: {
          beginner: level('beginner'),
          intermediate: level('intermediate'),
          advanced: level('advanced'),
        },
        languages: facetPage(languages),
        teachers: facetPage(teachers),
        topics: facetPage(topics),
      };
    },

    /**
     * LEARN PART 2 — THE TOPIC INDEX: ONE grouped statement, the hub's own
     * set (published, filed under the Topic) counted per asked Topic. Only the
     * Topics named are read, each a bound parameter.
     */
    async topicCourseTotals(topics) {
      if (topics.length === 0) return [];
      const rows = await db.$queryRaw<{ topic: string; count: number }[]>`
        SELECT o.[topicId] AS [topic], COUNT(*) AS [count]
        FROM [dbo].[CourseTopic] o
        JOIN [dbo].[Course] c ON c.[id] = o.[courseId]
        WHERE c.[state] = N'published' AND o.[topicId] IN (${Prisma.join([...topics])})
        GROUP BY o.[topicId]
        ORDER BY o.[topicId];`;
      return rows.map((row) => ({ topic: row.topic, count: Number(row.count) }));
    },

    async topicCoursePaths(topic) {
      if (topic === null) return [];
      const rows = await db.learningPath.findMany({
        where: {
          ...PUBLISHED,
          courses: {
            some: { course: { ...PUBLISHED, topics: { some: { topicId: topic } } } },
          },
        },
        select: PUBLIC_PATH_LISTING_SELECT,
        orderBy: [{ publishedAt: 'desc' }, { slug: 'asc' }, { id: 'asc' }],
        take: TOPIC_COURSE_PATHS,
      });
      return rows.map(toPathListing);
    },
  };
}
