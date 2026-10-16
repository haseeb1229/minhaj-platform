import 'server-only';

import type {
  LearningDispositionPort,
  LearningExport,
  LearningExportPort,
} from '@minhaj/contracts/learning';

import { getDatabaseClient } from '../../client.ts';
import { closeSession } from './sessions.ts';
import { bounded, dateOf, iso, refuse } from './shared.ts';

/**
 * Learning's part of a person's export and of their closed account's
 * disposition, coordinated at Layer 4.
 *
 * EVERY STATEMENT IS KEYED BY THE ACCOUNT. Nothing here decides whether the
 * account is closed — that is Identity's answer, asked by the caller — and
 * nothing here refuses: it reads or removes exactly the rows the account owns.
 *
 * THE EXPORT IS IDENTIFIERS AND INSTANTS. A Course's words and a lesson's body
 * are the catalogue's — public, or re-readable by the person — so none is
 * copied. Every list is in a fixed, documented order, so two exports of
 * unchanged data are identical apart from `generatedAt`.
 *
 * DISPOSITION IS BOUNDED, IDEMPOTENT AND RESUMABLE. Each call removes at most
 * `limit` rows per table, children before parents — nothing cascades — and
 * reports how many went. An interruption leaves only rows the next call finds:
 * the rows themselves are the pending work (SECURITY_BASELINE.md §19.1).
 *
 * PHASE 23 — WHAT CLOSURE DOES TO A PERSON'S CLASSES. A learner's confirmed
 * FUTURE trial is cancelled (its session with it, the teacher told), their
 * marks and their owed mail are removed, and their Bookings on closed or past
 * classes go — but a ClassSession is NEVER deleted: it is the record other
 * people's marks and intents point at. A teacher's current scopes are ENDED,
 * not deleted (privilege history), their unbooked windows removed and their
 * booked ones withdrawn; their scheduled sessions stay as they are, now on an
 * ended scope and so replacement-required for an operator.
 */

const DISPOSAL_MAX = 1_000;

export function createLearningExport(): LearningExportPort {
  const db = getDatabaseClient();

  return {
    async collect(userId) {
      try {
        const [
          enrolments,
          progress,
          trialRequests,
          bookings,
          classes,
          attendance,
          availability,
          teachingScopes,
        ] = await Promise.all([
          db.enrolment.findMany({
            where: { userId },
            select: {
              courseId: true,
              enrolledAt: true,
              course: { select: { slug: true } },
            },
            orderBy: [{ enrolledAt: 'asc' }, { courseId: 'asc' }],
          }),
          db.lessonProgress.findMany({
            where: { userId },
            select: { courseId: true, lessonId: true, completedAt: true },
            orderBy: [{ courseId: 'asc' }, { lessonId: 'asc' }],
          }),
          db.trialClassRequest.findMany({
            where: { userId },
            select: { id: true, courseId: true, requestedAt: true },
            orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
          }),
          db.booking.findMany({
            where: { userId },
            select: {
              id: true,
              requestId: true,
              courseId: true,
              sessionId: true,
              state: true,
              confirmedAt: true,
              cancelledAt: true,
            },
            orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }],
          }),
          // The sessions the person took part in, as a learner (through an own
          // Booking or a current Enrolment) or as the teacher — never another
          // participant, and never an address.
          db.$queryRaw<
            {
              sessionId: string;
              courseId: string;
              kind: string;
              startsAt: Date;
              endsAt: Date;
              timeZone: string;
              state: string;
              participation: string;
            }[]
          >`
            SELECT cs.[id] AS [sessionId], cs.[courseId], cs.[kind], cs.[startsAt], cs.[endsAt],
                   cs.[timeZone], cs.[state],
                   CASE WHEN s.[userId] = ${userId} THEN N'teacher'
                        WHEN cs.[kind] = N'trial' THEN N'booking' ELSE N'enrolment' END AS [participation]
            FROM [dbo].[ClassSession] cs
            JOIN [dbo].[CourseTeachingAssignment] s ON s.[id] = cs.[scopeId]
            WHERE s.[userId] = ${userId}
               OR (cs.[kind] = N'trial' AND EXISTS (
                    SELECT 1 FROM [dbo].[Booking] b WHERE b.[sessionId] = cs.[id] AND b.[userId] = ${userId}))
               OR (cs.[kind] = N'course' AND (
                    EXISTS (SELECT 1 FROM [dbo].[Attendance] a WHERE a.[sessionId] = cs.[id] AND a.[userId] = ${userId})
                    OR EXISTS (SELECT 1 FROM [dbo].[Enrolment] e WHERE e.[courseId] = cs.[courseId] AND e.[userId] = ${userId})))
            ORDER BY cs.[startsAt] ASC, cs.[id] ASC`,
          db.attendance.findMany({
            where: { userId },
            select: { sessionId: true, status: true, markedAt: true },
            orderBy: [{ markedAt: 'asc' }, { sessionId: 'asc' }],
          }),
          db.availability.findMany({
            where: { userId },
            select: {
              id: true,
              startsAt: true,
              endsAt: true,
              timeZone: true,
              state: true,
            },
            orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
          }),
          db.courseTeachingAssignment.findMany({
            where: { userId },
            select: { id: true, courseId: true, grantedAt: true, endedAt: true },
            orderBy: [{ grantedAt: 'asc' }, { id: 'asc' }],
          }),
        ]);
        return {
          enrolments: enrolments.map((row) => ({
            courseId: row.courseId,
            // The CURRENT slug, so the export names an address that resolves.
            courseSlug: row.course.slug,
            enrolledAt: iso(row.enrolledAt),
          })),
          progress: progress.map((row) => ({
            courseId: row.courseId,
            lessonId: row.lessonId,
            completedAt: iso(row.completedAt),
          })),
          trialRequests: trialRequests.map((row) => ({
            id: row.id,
            courseId: row.courseId,
            requestedAt: iso(row.requestedAt),
          })),
          bookings: bookings.map((row) => ({
            id: row.id,
            requestId: row.requestId,
            courseId: row.courseId,
            sessionId: row.sessionId,
            state: row.state as LearningExport['bookings'][number]['state'],
            confirmedAt: iso(row.confirmedAt),
            cancelledAt: row.cancelledAt === null ? null : iso(row.cancelledAt),
          })),
          classes: classes.map((row) => ({
            sessionId: row.sessionId,
            courseId: row.courseId,
            kind: row.kind as LearningExport['classes'][number]['kind'],
            startsAt: iso(dateOf(row.startsAt)),
            endsAt: iso(dateOf(row.endsAt)),
            timeZone: row.timeZone,
            state: row.state as LearningExport['classes'][number]['state'],
            participation:
              row.participation as LearningExport['classes'][number]['participation'],
          })),
          attendance: attendance.map((row) => ({
            sessionId: row.sessionId,
            status: row.status as LearningExport['attendance'][number]['status'],
            markedAt: iso(row.markedAt),
          })),
          availability: availability.map((row) => ({
            id: row.id,
            startsAt: iso(row.startsAt),
            endsAt: iso(row.endsAt),
            timeZone: row.timeZone,
            state: row.state as LearningExport['availability'][number]['state'],
          })),
          teachingScopes: teachingScopes.map((row) => ({
            id: row.id,
            courseId: row.courseId,
            grantedAt: iso(row.grantedAt),
            endedAt: row.endedAt === null ? null : iso(row.endedAt),
          })),
        };
      } catch (error) {
        refuse(error);
      }
    },
  };
}

export function createLearningDisposition(): LearningDispositionPort {
  const db = getDatabaseClient();

  return {
    async disposeAccount(userId, limit) {
      try {
        const size = bounded(limit, DISPOSAL_MAX);
        return await db.$transaction(async (tx) => {
          const now = new Date();
          let removed = 0;

          // A confirmed FUTURE trial is cancelled through its session, exactly
          // as the person would have cancelled it themselves: the teacher is
          // told, the address and the reminders go. Bounded like every step.
          const future = await tx.booking.findMany({
            where: {
              userId,
              state: 'confirmed',
              session: { state: 'scheduled', startsAt: { gt: now } },
            },
            select: { sessionId: true },
            orderBy: { id: 'asc' },
            take: size,
          });
          for (const booking of future) {
            await closeSession(tx, {
              sessionId: booking.sessionId,
              expectedVersion: null,
              state: 'cancelled',
              actorId: null,
              now,
            });
            removed += 1;
          }

          // What was owed to the person is owed no longer: abandoned (so a
          // dispatcher holding a claim relays nothing) and then removed.
          await tx.$executeRaw`
            UPDATE [dbo].[ClassCommunicationIntent] SET [state] = N'abandoned', [claimedUntil] = NULL
            WHERE [userId] = ${userId} AND [state] = N'pending'`;
          removed += await tx.$executeRaw`
            DELETE TOP (${size}) FROM [dbo].[ClassCommunicationIntent] WHERE [userId] = ${userId}`;
          removed += await tx.$executeRaw`
            DELETE TOP (${size}) FROM [dbo].[Attendance] WHERE [userId] = ${userId}`;

          // A window nobody booked goes; one a Booking names stays as the
          // record that Booking points at, withdrawn so it can never be
          // booked again.
          removed += await tx.$executeRaw`
            UPDATE [dbo].[Availability]
            SET [state] = N'withdrawn', [version] = [version] + 1, [updatedAt] = ${now}
            WHERE [userId] = ${userId} AND [state] = N'open'
              AND EXISTS (SELECT 1 FROM [dbo].[Booking] b WHERE b.[availabilityId] = [Availability].[id])`;
          removed += await tx.$executeRaw`
            DELETE TOP (${size}) FROM [dbo].[Availability]
            WHERE [userId] = ${userId}
              AND NOT EXISTS (SELECT 1 FROM [dbo].[Booking] b WHERE b.[availabilityId] = [Availability].[id])`;

          // A scope is ENDED, never deleted: what was taught stays readable,
          // and its scheduled sessions become replacement-required.
          removed += await tx.$executeRaw`
            UPDATE [dbo].[CourseTeachingAssignment]
            SET [endedAt] = ${now}, [version] = [version] + 1, [updatedAt] = ${now}
            WHERE [userId] = ${userId} AND [endedAt] IS NULL`;

          // Bookings on classes that are over — closed, or started — go; the
          // session each named stays.
          removed += await tx.$executeRaw`
            DELETE TOP (${size}) b FROM [dbo].[Booking] b
            JOIN [dbo].[ClassSession] cs ON cs.[id] = b.[sessionId]
            WHERE b.[userId] = ${userId}
              AND (cs.[state] <> N'scheduled' OR cs.[startsAt] <= ${now})`;

          removed += await tx.$executeRaw`
            DELETE TOP (${size}) FROM [dbo].[LessonProgress] WHERE [userId] = ${userId}`;
          // An Enrolment goes only once its Progress has: a batch that stopped
          // part-way through a Course's Progress leaves that Enrolment for the
          // next call rather than meeting the foreign key.
          removed += await tx.$executeRaw`
            DELETE TOP (${size}) FROM [dbo].[Enrolment]
            WHERE [userId] = ${userId}
              AND NOT EXISTS (
                SELECT 1 FROM [dbo].[LessonProgress] p
                WHERE p.[userId] = [Enrolment].[userId] AND p.[courseId] = [Enrolment].[courseId]
              )`;
          // A request goes only once its Booking has: the key refuses it before.
          removed += await tx.$executeRaw`
            DELETE TOP (${size}) FROM [dbo].[TrialClassRequest]
            WHERE [userId] = ${userId}
              AND NOT EXISTS (SELECT 1 FROM [dbo].[Booking] b WHERE b.[requestId] = [TrialClassRequest].[id])`;
          return removed;
        });
      } catch (error) {
        refuse(error);
      }
    },

    async accountsWithData(after, limit) {
      try {
        const size = bounded(limit, DISPOSAL_MAX);
        const rows = await db.$queryRaw<{ userId: string }[]>`
          SELECT TOP (${size}) [userId] FROM (
            SELECT [userId] FROM [dbo].[Enrolment]
            UNION SELECT [userId] FROM [dbo].[LessonProgress]
            UNION SELECT [userId] FROM [dbo].[TrialClassRequest]
            UNION SELECT [userId] FROM [dbo].[Booking]
            UNION SELECT [userId] FROM [dbo].[Attendance]
            UNION SELECT [userId] FROM [dbo].[ClassCommunicationIntent]
            UNION SELECT [userId] FROM [dbo].[CourseTeachingAssignment] WHERE [endedAt] IS NULL
            UNION SELECT a.[userId] FROM [dbo].[Availability] a
              WHERE a.[state] = N'open'
                 OR NOT EXISTS (SELECT 1 FROM [dbo].[Booking] b WHERE b.[availabilityId] = a.[id])
          ) AS [owners]
          WHERE ${after} IS NULL OR [userId] > ${after}
          ORDER BY [userId]`;
        return rows.map((row) => row.userId);
      } catch (error) {
        refuse(error);
      }
    },
  };
}
