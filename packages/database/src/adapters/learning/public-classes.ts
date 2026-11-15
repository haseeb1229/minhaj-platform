import 'server-only';

import { Prisma } from '@prisma/client';

import {
  CLASS_PAGE,
  COURSE_SESSIONS,
  SCHEDULE_FACET_PAGE,
  type ClassPublicReaderPort,
  type PublicScheduleFacets,
  type PublicScheduleQuery,
  type PublicSessionView,
} from '@minhaj/contracts/learning';

import { getDatabaseClient } from '../../client.ts';
import { BY_START } from './class-records.ts';
import { COURSE_LISTING_SELECT, listingsByIds, toCourseListing } from './records.ts';
import { ACTIVATED, activated, boundedOffset, PUBLISHED } from './shared.ts';

/**
 * The public class schedule and teacher directory (ROUTE_MAP.md §3.5), as
 * anybody may see them — only while live learning is activated.
 *
 * NO ACTOR AND NOTHING PRIVATE. No method takes an account; no select names a
 * participant, a Booking, a window or an address. A session is public while
 * scheduled, on a published live Course, under a current scope; a teacher is
 * public while an account holds a current scope on such a Course. The
 * teacher's ACCOUNT identifier is returned for Layer 4 to resolve to a
 * published Person — Learning copies no name.
 */

/**
 * A session is public while scheduled, in the future, on a published live
 * Course, under a current scope — one predicate for the schedule and for a
 * Course's own page.
 */
function upcoming(now: Date) {
  return {
    state: 'scheduled',
    startsAt: { gte: now },
    course: { ...PUBLISHED, format: 'live' },
    scope: { endedAt: null },
  } as const;
}

/** Which of a schedule query's filters a statement applies. */
interface ScheduleFilters {
  readonly course: boolean;
  readonly teacher: boolean;
  readonly language: boolean;
}

const ALL_FILTERS: ScheduleFilters = { course: true, teacher: true, language: true };
const NO_FILTERS: ScheduleFilters = { course: false, teacher: false, language: false };

/**
 * LEARN PART 2 — THE SAME PREDICATE AS SQL, over `[dbo].[ClassSession] x`
 * joined to its Course `c` and its scope `s`: activated, scheduled, not yet
 * started, a published live Course, a current scope — and whichever of the
 * query's filters `use` names. Every value is a bound parameter. The page's
 * identifiers and every facet read this one definition; the page's rows are
 * then loaded under `upcoming(now)` again, so an error here could only drop a
 * class, never admit one.
 */
function scheduleWhere(
  now: Date,
  query: PublicScheduleQuery,
  use: ScheduleFilters,
): Prisma.Sql {
  const conditions = [
    ACTIVATED,
    Prisma.sql`x.[state] = N'scheduled'`,
    Prisma.sql`x.[startsAt] >= ${now}`,
    Prisma.sql`c.[state] = N'published'`,
    Prisma.sql`c.[format] = N'live'`,
    Prisma.sql`s.[endedAt] IS NULL`,
  ];
  if (use.course && query.course !== null)
    conditions.push(Prisma.sql`x.[courseId] = ${query.course}`);
  if (use.teacher && query.teacher !== null)
    conditions.push(Prisma.sql`s.[userId] = ${query.teacher}`);
  if (use.language && query.language !== null)
    conditions.push(Prisma.sql`c.[languageCode] = ${query.language}`);
  return Prisma.join(conditions, ' AND ');
}

/** The schedule's tables — this module's own text, never a caller's. */
const SCHEDULE_FROM = Prisma.sql`[dbo].[ClassSession] x
  JOIN [dbo].[Course] c ON c.[id] = x.[courseId]
  JOIN [dbo].[CourseTeachingAssignment] s ON s.[id] = x.[scopeId]`;

const NO_FACETS: PublicScheduleFacets = {
  upcoming: 0,
  matching: 0,
  courses: [],
  teachers: [],
  languages: [],
};

/** What a public session shows — no participant, Booking, window or address. */
const PUBLIC_SESSION_SELECT = {
  id: true,
  startsAt: true,
  endsAt: true,
  timeZone: true,
  startsLocal: true,
  endsLocal: true,
  scope: { select: { userId: true } },
  course: { select: COURSE_LISTING_SELECT },
} as const;

function toPublicSession(row: {
  readonly id: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timeZone: string;
  readonly startsLocal: string;
  readonly endsLocal: string;
  readonly scope: { readonly userId: string };
  readonly course: Parameters<typeof toCourseListing>[0];
}): PublicSessionView {
  return {
    id: row.id,
    course: toCourseListing(row.course),
    teacherAccountId: row.scope.userId,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    timeZone: row.timeZone,
    startsLocal: row.startsLocal,
    endsLocal: row.endsLocal,
  };
}

/** Teachers the directory shows at once. */
const TEACHER_DIRECTORY = 200;

export function createClassPublicReader(): ClassPublicReaderPort {
  const db = getDatabaseClient();

  return {
    /**
     * TWO READS, THE SECOND AUTHORITATIVE: one bounded SQL page of
     * identifiers under the schedule's predicate and the query's filters, in
     * start order, then those classes loaded under `upcoming(now)` again.
     */
    async upcomingSessions(now, query) {
      if (!(await activated(db))) return { items: [], hasMore: false };
      const page = await db.$queryRaw<{ id: string }[]>`
        SELECT x.[id]
        FROM ${SCHEDULE_FROM}
        WHERE ${scheduleWhere(now, query, ALL_FILTERS)}
        ORDER BY x.[startsAt] ASC, x.[id] ASC
        OFFSET ${boundedOffset(query.offset)} ROWS FETCH NEXT ${CLASS_PAGE + 1} ROWS ONLY`;
      const ids = page.slice(0, CLASS_PAGE).map((row) => row.id);
      if (ids.length === 0) return { items: [], hasMore: false };
      const rows = await db.classSession.findMany({
        where: { ...upcoming(now), id: { in: ids } },
        select: PUBLIC_SESSION_SELECT,
        orderBy: [...BY_START],
      });
      return {
        items: rows.map(toPublicSession),
        hasMore: page.length > CLASS_PAGE,
      };
    },

    /**
     * GROUPED READS, each bounded: a facet's own filter is left out of its own
     * counts, so every option says how many classes choosing it would show.
     */
    async upcomingFacets(now, query) {
      if (!(await activated(db))) return NO_FACETS;
      const without = (key: keyof ScheduleFilters): ScheduleFilters => ({
        ...ALL_FILTERS,
        [key]: false,
      });
      const [counts, courses, teachers, languages] = await Promise.all([
        db.$queryRaw<{ upcoming: number; matching: number }[]>`
          SELECT (SELECT COUNT(*) FROM ${SCHEDULE_FROM}
                  WHERE ${scheduleWhere(now, query, NO_FILTERS)}) AS [upcoming],
                 (SELECT COUNT(*) FROM ${SCHEDULE_FROM}
                  WHERE ${scheduleWhere(now, query, ALL_FILTERS)}) AS [matching];`,
        db.$queryRaw<{ id: string; count: number }[]>`
          SELECT TOP (${SCHEDULE_FACET_PAGE}) x.[courseId] AS [id], COUNT(*) AS [count]
          FROM ${SCHEDULE_FROM}
          WHERE ${scheduleWhere(now, query, without('course'))}
          GROUP BY x.[courseId]
          ORDER BY [count] DESC, [id] ASC;`,
        db.$queryRaw<{ id: string; count: number }[]>`
          SELECT TOP (${SCHEDULE_FACET_PAGE}) s.[userId] AS [id], COUNT(*) AS [count]
          FROM ${SCHEDULE_FROM}
          WHERE ${scheduleWhere(now, query, without('teacher'))}
          GROUP BY s.[userId]
          ORDER BY [count] DESC, [id] ASC;`,
        db.$queryRaw<{ id: string; count: number }[]>`
          SELECT TOP (${SCHEDULE_FACET_PAGE}) c.[languageCode] AS [id], COUNT(*) AS [count]
          FROM ${SCHEDULE_FROM}
          WHERE ${scheduleWhere(now, query, without('language'))}
          GROUP BY c.[languageCode]
          ORDER BY [count] DESC, [id] ASC;`,
      ]);
      // The Course cards under the public predicate: a Course withdrawn
      // between the statements is dropped, never shown.
      const cards =
        courses.length === 0
          ? []
          : await db.course.findMany({
              where: {
                id: { in: courses.map((row) => row.id) },
                ...PUBLISHED,
                format: 'live',
              },
              select: COURSE_LISTING_SELECT,
            });
      const byId = new Map(cards.map((row) => [row.id, toCourseListing(row)]));
      return {
        upcoming: Number(counts[0]?.upcoming ?? 0),
        matching: Number(counts[0]?.matching ?? 0),
        courses: courses.flatMap((row) => {
          const course = byId.get(row.id);
          return course === undefined ? [] : [{ course, classes: Number(row.count) }];
        }),
        teachers: teachers.map((row) => ({
          accountId: row.id,
          classes: Number(row.count),
        })),
        languages: languages.map((row) => ({ code: row.id, classes: Number(row.count) })),
      };
    },

    /** One published live Course's next classes — the schedule's own predicate. */
    async courseSessions(now, courseId) {
      if (!(await activated(db))) return [];
      const rows = await db.classSession.findMany({
        where: { ...upcoming(now), courseId },
        select: PUBLIC_SESSION_SELECT,
        orderBy: [...BY_START],
        take: COURSE_SESSIONS,
      });
      return rows.map(toPublicSession);
    },

    /**
     * Accounts holding a current scope on a published live Course, with those
     * Courses, and whether at least one future open window of theirs is
     * unbooked — a fact, never the window itself.
     */
    async operationalTeachers(now) {
      if (!(await activated(db))) return [];
      const rows = await db.$queryRaw<
        { userId: string; courseId: string; available: number }[]
      >`
        SELECT TOP (${TEACHER_DIRECTORY * 10}) s.[userId], s.[courseId],
          CASE WHEN EXISTS (
            SELECT 1 FROM [dbo].[Availability] a
            WHERE a.[userId] = s.[userId] AND a.[state] = N'open' AND a.[startsAt] > ${now}
              AND NOT EXISTS (SELECT 1 FROM [dbo].[Booking] b
                WHERE b.[availabilityId] = a.[id] AND b.[state] <> N'cancelled')
          ) THEN 1 ELSE 0 END AS [available]
        FROM [dbo].[CourseTeachingAssignment] s
        JOIN [dbo].[Course] c ON c.[id] = s.[courseId]
          AND c.[state] = N'published' AND c.[format] = N'live'
        WHERE s.[endedAt] IS NULL
        ORDER BY s.[userId], s.[courseId]`;
      const accountIds = [...new Set(rows.map((row) => row.userId))].slice(
        0,
        TEACHER_DIRECTORY,
      );
      const courseIds = [...new Set(rows.map((row) => row.courseId))];
      const [listings, filed] = await Promise.all([
        listingsByIds(db, courseIds),
        // Learn Part 2: the Topics those Courses are filed under — public
        // facts of published Courses — for the directory's subject filter.
        courseIds.length === 0
          ? Promise.resolve([])
          : db.courseTopic.findMany({
              where: { courseId: { in: courseIds } },
              select: { courseId: true, topicId: true },
            }),
      ]);
      return accountIds.map((accountId) => {
        const own = rows.filter((row) => row.userId === accountId);
        const taught = new Set(own.map((row) => row.courseId));
        return {
          accountId,
          courses: own.flatMap((row) => {
            const course = listings.get(row.courseId);
            return course === undefined ? [] : [course];
          }),
          topicIds: [
            ...new Set(
              filed
                .filter((entry) => taught.has(entry.courseId))
                .map((entry) => entry.topicId),
            ),
          ].sort(),
          available: own.some((row) => Number(row.available) === 1),
        };
      });
    },
  };
}
