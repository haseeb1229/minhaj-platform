import 'server-only';

import { CLASS_PAGE, type ClassPublicReaderPort } from '@minhaj/contracts/learning';

import { getDatabaseClient } from '../../client.ts';
import { BY_START } from './class-records.ts';
import { COURSE_LISTING_SELECT, listingsByIds, toCourseListing } from './records.ts';
import { activated, boundedOffset, PUBLISHED } from './shared.ts';

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

/** Teachers the directory shows at once. */
const TEACHER_DIRECTORY = 200;

export function createClassPublicReader(): ClassPublicReaderPort {
  const db = getDatabaseClient();

  return {
    async upcomingSessions(now, offset) {
      if (!(await activated(db))) return { items: [], hasMore: false };
      const rows = await db.classSession.findMany({
        where: {
          state: 'scheduled',
          startsAt: { gte: now },
          course: { ...PUBLISHED, format: 'live' },
          scope: { endedAt: null },
        },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          timeZone: true,
          startsLocal: true,
          endsLocal: true,
          scope: { select: { userId: true } },
          course: { select: COURSE_LISTING_SELECT },
        },
        orderBy: [...BY_START],
        skip: boundedOffset(offset),
        take: CLASS_PAGE + 1,
      });
      return {
        items: rows.slice(0, CLASS_PAGE).map((row) => ({
          id: row.id,
          course: toCourseListing(row.course),
          teacherAccountId: row.scope.userId,
          startsAt: row.startsAt,
          endsAt: row.endsAt,
          timeZone: row.timeZone,
          startsLocal: row.startsLocal,
          endsLocal: row.endsLocal,
        })),
        hasMore: rows.length > CLASS_PAGE,
      };
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
      const listings = await listingsByIds(
        db,
        rows.map((row) => row.courseId),
      );
      return accountIds.map((accountId) => {
        const own = rows.filter((row) => row.userId === accountId);
        return {
          accountId,
          courses: own.flatMap((row) => {
            const course = listings.get(row.courseId);
            return course === undefined ? [] : [course];
          }),
          available: own.some((row) => Number(row.available) === 1),
        };
      });
    },
  };
}
