import 'server-only';

import type { Prisma } from '@prisma/client';

import {
  CLASS_PAGE,
  type AttendanceStatus,
  type ClassLearnerPort,
  type LearnerClassView,
} from '@minhaj/contracts/learning';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import {
  BOOKING_SELECT,
  BY_START,
  BY_START_DESC,
  SESSION_VIEW_SELECT,
  toBookingRecord,
  toSessionView,
  type BookingRow,
  type SessionViewRow,
} from './class-records.ts';
import { listingsByIds } from './records.ts';
import { closeSession } from './sessions.ts';
import {
  ACTIVATED,
  boundedOffset,
  LearningDataError,
  maybeDate,
  PUBLISHED,
  refuse,
  type Client,
} from './shared.ts';

/**
 * A person's OWN classes (DOMAIN_MODEL.md §13.3): the sessions their current
 * Enrolment admits them to and the trial they themselves booked — nothing
 * else, and nobody else's.
 *
 * THE ACCOUNT IS IN EVERY PREDICATE. Each method takes the account it acts
 * for, and every statement below carries that account in its own WHERE — the
 * primary defence against horizontal escalation (SECURITY_BASELINE.md §3.4
 * rule 4). Somebody else's Booking answers exactly like a missing one.
 *
 * A SESSION ON AN ENDED SCOPE IS STILL LISTED — the class is still the
 * learner's — but its address is NOT disclosed until an operator has named a
 * replacement teacher: the disclosure statement requires the scope current.
 */

/** Teachers one learner's relationship list shows. */
const LEARNER_TEACHERS = 50;

/** The learner's part of a session view: their Booking and their mark only. */
function learnerSelect(userId: string) {
  return {
    ...SESSION_VIEW_SELECT,
    booking: { where: { userId }, select: BOOKING_SELECT },
    attendance: { where: { userId }, select: { status: true } },
  } satisfies Prisma.ClassSessionSelect;
}

interface LearnerSessionRow extends SessionViewRow {
  readonly booking: BookingRow | null;
  readonly attendance: readonly { readonly status: string }[];
}

function toLearnerView(row: LearnerSessionRow): LearnerClassView {
  const view = toSessionView(row);
  return {
    session: view.session,
    course: view.course,
    participation: row.kind === 'trial' ? 'booking' : 'enrolment',
    booking: row.booking === null ? null : toBookingRecord(row.booking),
    attendance: (row.attendance[0]?.status as AttendanceStatus | undefined) ?? null,
  };
}

/** May attend NOW: a confirmed own Booking on a trial, or a current Enrolment on a published Course. */
function upcomingWhere(userId: string, now: Date): Prisma.ClassSessionWhereInput {
  return {
    state: 'scheduled',
    startsAt: { gte: now },
    OR: [
      { kind: 'trial', booking: { userId, state: 'confirmed' } },
      { kind: 'course', course: { ...PUBLISHED, enrolments: { some: { userId } } } },
    ],
  };
}

/** Took part: an own Booking in any state, or a Course session marked or started while enrolled. */
function pastWhere(userId: string, now: Date): Prisma.ClassSessionWhereInput {
  return {
    OR: [
      {
        kind: 'trial',
        booking: { userId },
        OR: [{ state: { not: 'scheduled' } }, { startsAt: { lt: now } }],
      },
      {
        kind: 'course',
        OR: [
          { attendance: { some: { userId } } },
          {
            course: { enrolments: { some: { userId } } },
            OR: [{ state: { not: 'scheduled' } }, { startsAt: { lt: now } }],
          },
        ],
      },
    ],
  };
}

export function createClassLearner(): ClassLearnerPort {
  const db = getDatabaseClient();

  return {
    async upcoming(userId, now) {
      const rows = await db.classSession.findMany({
        where: upcomingWhere(userId, now),
        select: learnerSelect(userId),
        orderBy: [...BY_START],
        take: CLASS_PAGE,
      });
      return rows.map(toLearnerView);
    },

    async past(userId, now, offset) {
      const rows = await db.classSession.findMany({
        where: pastWhere(userId, now),
        select: learnerSelect(userId),
        orderBy: [...BY_START_DESC],
        skip: boundedOffset(offset),
        take: CLASS_PAGE + 1,
      });
      return {
        items: rows.slice(0, CLASS_PAGE).map(toLearnerView),
        hasMore: rows.length > CLASS_PAGE,
      };
    },

    /** One class the account may attend or attended — the same two predicates, by id. */
    async session(userId, sessionId) {
      const now = new Date();
      const row = await db.classSession.findFirst({
        where: {
          id: sessionId,
          OR: [upcomingWhere(userId, now), pastWhere(userId, now)],
        },
        select: learnerSelect(userId),
      });
      return row === null ? null : toLearnerView(row);
    },

    /**
     * THE DISCLOSURE OPERATION, as one statement: activated, scheduled, the
     * scope current, and THIS account a current participant — through its own
     * confirmed Booking or its current Enrolment on the published Course.
     */
    async meetingUrl(userId, sessionId) {
      const [row] = await db.$queryRaw<{ meetingUrl: string | null }[]>`
        SELECT cs.[meetingUrl]
        FROM [dbo].[ClassSession] cs
        JOIN [dbo].[CourseTeachingAssignment] s ON s.[id] = cs.[scopeId]
        WHERE cs.[id] = ${sessionId}
          AND cs.[state] = N'scheduled'
          AND s.[endedAt] IS NULL
          AND ${ACTIVATED}
          AND (
            (cs.[kind] = N'trial' AND EXISTS (
              SELECT 1 FROM [dbo].[Booking] b
              WHERE b.[sessionId] = cs.[id] AND b.[userId] = ${userId} AND b.[state] = N'confirmed'))
            OR (cs.[kind] = N'course' AND EXISTS (
              SELECT 1 FROM [dbo].[Enrolment] e
              JOIN [dbo].[Course] c ON c.[id] = e.[courseId] AND c.[state] = N'published'
              WHERE e.[courseId] = cs.[courseId] AND e.[userId] = ${userId}))
          )`;
      return row?.meetingUrl ?? null;
    },

    /**
     * Cancels the account's OWN confirmed future Booking at its expected
     * version — and, since a trial session has that one participant, the
     * session with it: its address cleared, its intents abandoned, and the
     * teacher and the learner owed a cancellation.
     */
    async cancelBooking({ accountId, bookingId, expectedVersion }) {
      try {
        return await db.$transaction(async (tx: Client) => {
          const now = new Date();
          const [booking] = await tx.$queryRaw<
            { sessionId: string; state: string; version: number; startsAt: Date }[]
          >`
            SELECT b.[sessionId], b.[state], b.[version], cs.[startsAt]
            FROM [dbo].[Booking] b WITH (UPDLOCK, HOLDLOCK)
            JOIN [dbo].[ClassSession] cs ON cs.[id] = b.[sessionId]
            WHERE b.[id] = ${bookingId} AND b.[userId] = ${accountId}`;
          if (booking === undefined) throw new LearningDataError('not-found');
          if (booking.state !== 'confirmed') throw new LearningDataError('terminal');
          if (Number(booking.version) !== expectedVersion)
            throw new LearningDataError('conflict');
          if (booking.startsAt.getTime() <= now.getTime())
            throw new LearningDataError('past');

          await closeSession(tx, {
            sessionId: booking.sessionId,
            expectedVersion: null,
            state: 'cancelled',
            actorId: accountId,
            now,
          });

          const row = await tx.booking.findFirst({
            where: { id: bookingId, userId: accountId },
            select: BOOKING_SELECT,
          });
          if (row === null || row.state !== 'cancelled')
            throw new LearningDataError('conflict');
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId: accountId,
              action: 'learning.booking.cancelled',
              targetType: 'booking',
              targetId: bookingId,
              before: { version: String(expectedVersion), state: 'confirmed' },
              after: {
                version: String(row.version),
                state: row.state,
                sessionId: row.sessionId,
              },
              authorisingSource: 'owner',
            }),
          });
          return toBookingRecord(row);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * The teachers this account has a GENUINE relationship with: whoever
     * taught a class it took part in or is scheduled to attend — by account,
     * with the Courses that class was on. Computed in SQL from the same two
     * predicates the listings use.
     */
    async teachers(userId, now) {
      const rows = await db.$queryRaw<
        {
          teacherId: string;
          courseId: string;
          upcoming: number;
          lastClassAt: Date | string | null;
        }[]
      >`
        WITH [mine] AS (
          SELECT cs.[id], cs.[courseId], cs.[startsAt], cs.[state], s.[userId] AS [teacherId],
            CASE WHEN cs.[state] = N'scheduled' AND cs.[startsAt] >= ${now} AND (
                   (cs.[kind] = N'trial' AND EXISTS (SELECT 1 FROM [dbo].[Booking] b
                      WHERE b.[sessionId] = cs.[id] AND b.[userId] = ${userId} AND b.[state] = N'confirmed'))
                   OR (cs.[kind] = N'course' AND EXISTS (SELECT 1 FROM [dbo].[Enrolment] e
                      JOIN [dbo].[Course] c ON c.[id] = e.[courseId] AND c.[state] = N'published'
                      WHERE e.[courseId] = cs.[courseId] AND e.[userId] = ${userId}))
                 ) THEN 1 ELSE 0 END AS [upcoming]
          FROM [dbo].[ClassSession] cs
          JOIN [dbo].[CourseTeachingAssignment] s ON s.[id] = cs.[scopeId]
          WHERE (cs.[kind] = N'trial' AND EXISTS (
                   SELECT 1 FROM [dbo].[Booking] b WHERE b.[sessionId] = cs.[id] AND b.[userId] = ${userId}))
             OR (cs.[kind] = N'course' AND (
                   EXISTS (SELECT 1 FROM [dbo].[Attendance] a WHERE a.[sessionId] = cs.[id] AND a.[userId] = ${userId})
                   OR EXISTS (SELECT 1 FROM [dbo].[Enrolment] e WHERE e.[courseId] = cs.[courseId] AND e.[userId] = ${userId})))
        )
        SELECT TOP (${LEARNER_TEACHERS * 10}) m.[teacherId], m.[courseId],
               SUM(m.[upcoming]) AS [upcoming],
               MAX(CASE WHEN m.[startsAt] < ${now} THEN m.[startsAt] END) AS [lastClassAt]
        FROM [mine] m
        GROUP BY m.[teacherId], m.[courseId]
        ORDER BY m.[teacherId], m.[courseId]`;
      const teacherIds = [...new Set(rows.map((row) => row.teacherId))].slice(
        0,
        LEARNER_TEACHERS,
      );
      const listings = await listingsByIds(
        db,
        rows.map((row) => row.courseId),
      );
      return teacherIds.map((teacherAccountId) => {
        const own = rows.filter((row) => row.teacherId === teacherAccountId);
        const last = own
          .map((row) => maybeDate(row.lastClassAt))
          .filter((value): value is Date => value !== null)
          .sort((a, b) => b.getTime() - a.getTime())[0];
        return {
          teacherAccountId,
          courses: own.flatMap((row) => {
            const course = listings.get(row.courseId);
            return course === undefined ? [] : [course];
          }),
          upcoming: own.reduce((total, row) => total + Number(row.upcoming), 0),
          lastClassAt: last ?? null,
        };
      });
    },
  };
}
