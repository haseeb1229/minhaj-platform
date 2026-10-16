import 'server-only';

import { randomUUID } from 'node:crypto';

import {
  CLASS_PAGE,
  type ClassAdminPort,
  type TeachingScopeView,
} from '@minhaj/contracts/learning';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import {
  AVAILABILITY_SELECT,
  BOOKING_SELECT,
  BY_START_DESC,
  SCOPE_VIEW_SELECT,
  SESSION_VIEW_SELECT,
  sessionPage,
  toAvailabilityRecord,
  toBookingRecord,
  toScopeView,
  toSessionView,
  type SessionViewRow,
} from './class-records.ts';
import { lockScope, lockTeacher, lockTeachers, LOCKED_TRANSACTION } from './locks.ts';
import { COURSE_LISTING_SELECT, toCourseListing } from './records.ts';
import {
  abandonIntents,
  closeSession,
  commitIntents,
  commitSessionIntents,
  lockedCourse,
  markParticipant,
  meetingAcceptable,
  participantRows,
  requireActivation,
  requireSession,
  rescheduleSession,
  sessionView,
  teacherOverlaps,
  toParticipants,
} from './sessions.ts';
import {
  ACTIVATED,
  boundedOffset,
  LearningDataError,
  refuse,
  type Client,
} from './shared.ts';

/**
 * The operator surface behind `learning.classes.read` and
 * `learning.classes.administer` (DELIVERY_PLAN.md Phase 23) — reached only
 * through the Learning service, which re-checks the key live on every call
 * and audits every read that names a person. It scopes, confirms, schedules,
 * moves, closes, replaces and corrects; it can grant no Identity key, and
 * nothing here reads a RoleAssignment except to insist, with the trigger
 * (51282) as the floor, that a scope names one of the live assignments the
 * service just read from Identity.
 *
 * CONFLICT SAFETY, IN ORDER. Every write that could collide with a teacher's
 * other classes takes that teacher's application lock FIRST, then reads what
 * it must decide on under row locks held to commit, then asks its question —
 * overlap, an open and unbooked window, a published live Course, a current
 * scope — and only then writes. The migration's keys and triggers are the
 * floor beneath each answer, never the first line.
 */

const AUTHORITY = 'learning.classes.administer';

export function createClassAdmin(): ClassAdminPort {
  const db = getDatabaseClient();

  async function scopeOrConflict(tx: Client, id: string): Promise<TeachingScopeView> {
    const row = await tx.courseTeachingAssignment.findFirst({
      where: { id },
      select: SCOPE_VIEW_SELECT,
    });
    if (row === null) throw new LearningDataError('conflict');
    return toScopeView(row);
  }

  /**
   * One session change by an operator, audited by identifiers and state. It
   * hands back the session's ROW, which each method maps to the port's view.
   */
  async function audited(
    actorId: string,
    action: string,
    before: Readonly<Record<string, string>>,
    work: (tx: Client) => Promise<SessionViewRow>,
    extra: (row: SessionViewRow) => Readonly<Record<string, string>> = () => ({}),
  ): Promise<SessionViewRow> {
    try {
      return await db.$transaction(async (tx) => {
        const row = await work(tx);
        await tx.auditLog.create({
          data: auditRow({
            actorType: 'user',
            actorId,
            action,
            targetType: 'class-session',
            targetId: row.id,
            before,
            after: {
              version: String(row.version),
              state: row.state,
              ...extra(row),
            },
            authorisingSource: AUTHORITY,
          }),
        });
        return row;
      }, LOCKED_TRANSACTION);
    } catch (error) {
      refuse(error);
    }
  }

  return {
    /* ---- teaching scopes ---------------------------------------------- */

    async scopes({ courseId, accountId, current, offset }) {
      const rows = await db.courseTeachingAssignment.findMany({
        where: {
          ...(courseId === null ? {} : { courseId }),
          ...(accountId === null ? {} : { userId: accountId }),
          ...(current === true
            ? { endedAt: null }
            : current === false
              ? { endedAt: { not: null } }
              : {}),
        },
        select: SCOPE_VIEW_SELECT,
        orderBy: [{ grantedAt: 'desc' }, { id: 'asc' }],
        skip: boundedOffset(offset),
        take: CLASS_PAGE + 1,
      });
      return {
        items: rows.slice(0, CLASS_PAGE).map(toScopeView),
        hasMore: rows.length > CLASS_PAGE,
      };
    },

    async liveCourses(offset) {
      const rows = await db.course.findMany({
        where: { format: 'live', state: { not: 'archived' } },
        select: COURSE_LISTING_SELECT,
        orderBy: [{ slug: 'asc' }, { id: 'asc' }],
        skip: boundedOffset(offset),
        take: CLASS_PAGE + 1,
      });
      return {
        items: rows.slice(0, CLASS_PAGE).map(toCourseListing),
        hasMore: rows.length > CLASS_PAGE,
      };
    },

    async scope(scopeId) {
      const row = await db.courseTeachingAssignment.findFirst({
        where: { id: scopeId },
        select: SCOPE_VIEW_SELECT,
      });
      return row === null ? null : toScopeView(row);
    },

    /**
     * Under the (Course, account) lock: a live Course, no current scope for
     * the pair, then the insert. The filtered unique key and the trigger
     * (51282: the assignment must be the account's own live `teaching.perform`
     * assignment) are the floor beneath the service's Identity check.
     */
    async grantScope({ actorId, courseId, accountId, roleAssignmentId }) {
      try {
        return await db.$transaction(async (tx) => {
          await lockScope(tx, courseId, accountId);
          const course = await tx.course.findFirst({
            where: { id: courseId },
            select: { format: true },
          });
          if (course?.format !== 'live')
            throw new LearningDataError('course-unavailable');
          const existing = await tx.courseTeachingAssignment.count({
            where: { courseId, userId: accountId, endedAt: null },
          });
          if (existing > 0) throw new LearningDataError('conflict');
          const id = randomUUID();
          const now = new Date();
          await tx.courseTeachingAssignment.create({
            data: {
              id,
              courseId,
              userId: accountId,
              roleAssignmentId,
              grantedAt: now,
              grantedById: actorId,
              updatedAt: now,
            },
          });
          const view = await scopeOrConflict(tx, id);
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'learning.scope.granted',
              targetType: 'teaching-scope',
              targetId: id,
              after: { courseId, accountId, roleAssignmentId },
              authorisingSource: AUTHORITY,
            }),
          });
          return view;
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Ends a scope at its expected version. Nothing is done to its sessions:
     * a scheduled session on an ended scope is replacement-required, which
     * every reading side derives from `endedAt` rather than from a copy.
     */
    async endScope({ actorId, scopeId, expectedVersion }) {
      try {
        return await db.$transaction(async (tx) => {
          const current = await tx.courseTeachingAssignment.findFirst({
            where: { id: scopeId },
            select: { endedAt: true, version: true },
          });
          if (current === null) throw new LearningDataError('not-found');
          if (current.endedAt !== null) return scopeOrConflict(tx, scopeId);
          const now = new Date();
          const claimed = await tx.courseTeachingAssignment.updateMany({
            where: { id: scopeId, version: expectedVersion, endedAt: null },
            data: {
              endedAt: now,
              endedById: actorId,
              version: { increment: 1 },
              updatedAt: now,
            },
          });
          if (claimed.count !== 1) throw new LearningDataError('conflict');
          const view = await scopeOrConflict(tx, scopeId);
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'learning.scope.ended',
              targetType: 'teaching-scope',
              targetId: scopeId,
              before: { version: String(expectedVersion) },
              after: {
                version: String(view.scope.version),
                courseId: view.scope.courseId,
                accountId: view.scope.accountId,
              },
              authorisingSource: AUTHORITY,
            }),
          });
          return view;
        });
      } catch (error) {
        refuse(error);
      }
    },

    /* ---- windows an operator confirms into -------------------------------- */

    async availabilityOwner(availabilityId) {
      const row = await db.availability.findFirst({
        where: { id: availabilityId },
        select: { userId: true },
      });
      return row?.userId ?? null;
    },

    /** Open, unbooked, future windows of accounts CURRENTLY scoped to the Course. */
    async availableWindows(courseId, now, offset) {
      const rows = await db.availability.findMany({
        where: {
          state: 'open',
          startsAt: { gt: now },
          bookings: { none: { state: { not: 'cancelled' } } },
          user: { teachingScopes: { some: { courseId, endedAt: null } } },
        },
        select: AVAILABILITY_SELECT,
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        skip: boundedOffset(offset),
        take: CLASS_PAGE + 1,
      });
      return {
        items: rows.slice(0, CLASS_PAGE).map(toAvailabilityRecord),
        hasMore: rows.length > CLASS_PAGE,
      };
    },

    /* ---- trial requests and bookings ---------------------------------- */

    async trialRequests(courseId, offset) {
      const rows = await db.trialClassRequest.findMany({
        where: courseId === null ? {} : { courseId },
        select: {
          id: true,
          userId: true,
          requestedAt: true,
          course: { select: COURSE_LISTING_SELECT },
          booking: { select: BOOKING_SELECT },
        },
        orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
        skip: boundedOffset(offset),
        take: CLASS_PAGE + 1,
      });
      return {
        items: rows.slice(0, CLASS_PAGE).map((row) => ({
          id: row.id,
          accountId: row.userId,
          course: toCourseListing(row.course),
          requestedAt: row.requestedAt,
          booking: row.booking === null ? null : toBookingRecord(row.booking),
        })),
        hasMore: rows.length > CLASS_PAGE,
      };
    },

    /**
     * ONE TRANSACTION, serialised on the window's teacher, then on the window
     * and the request themselves (UPDLOCK, HOLDLOCK): two confirmations of one
     * request, or two of one window, meet each other's locks and the second
     * sees the first's Booking. The Course is read under the shared lock a
     * withdrawal must wait for; the teacher's CURRENT scope on it is resolved
     * under the assignments Identity reported for that teacher.
     */
    async confirmTrial({
      actorId,
      requestId,
      availabilityId,
      teacherAssignmentIds,
      reminderLeadMinutes,
    }) {
      try {
        return await db.$transaction(async (tx) => {
          await requireActivation(tx);
          if (teacherAssignmentIds.length === 0)
            throw new LearningDataError('not-a-teacher');
          const owner = await tx.availability.findFirst({
            where: { id: availabilityId },
            select: { userId: true },
          });
          if (owner === null) throw new LearningDataError('not-found');
          await lockTeacher(tx, owner.userId);

          const [window] = await tx.$queryRaw<
            {
              id: string;
              userId: string;
              startsAt: Date;
              endsAt: Date;
              timeZone: string;
              startsLocal: string;
              endsLocal: string;
              state: string;
              booked: number;
            }[]
          >`
            SELECT a.[id], a.[userId], a.[startsAt], a.[endsAt], a.[timeZone],
                   a.[startsLocal], a.[endsLocal], a.[state],
              (SELECT COUNT_BIG(*) FROM [dbo].[Booking] b
                WHERE b.[availabilityId] = a.[id] AND b.[state] <> N'cancelled') AS [booked]
            FROM [dbo].[Availability] a WITH (UPDLOCK, HOLDLOCK)
            WHERE a.[id] = ${availabilityId}`;
          if (window === undefined) throw new LearningDataError('not-found');

          const [request] = await tx.$queryRaw<
            { id: string; userId: string; courseId: string; booked: number }[]
          >`
            SELECT t.[id], t.[userId], t.[courseId],
              (SELECT COUNT_BIG(*) FROM [dbo].[Booking] b WHERE b.[requestId] = t.[id]) AS [booked]
            FROM [dbo].[TrialClassRequest] t WITH (UPDLOCK, HOLDLOCK)
            WHERE t.[id] = ${requestId}`;
          if (request === undefined) throw new LearningDataError('not-found');
          if (Number(request.booked) > 0) throw new LearningDataError('booked');

          const course = await lockedCourse(tx, request.courseId);
          if (course?.state !== 'published' || course.format !== 'live')
            throw new LearningDataError('course-unavailable');

          const scope = await tx.courseTeachingAssignment.findFirst({
            where: {
              courseId: request.courseId,
              userId: window.userId,
              endedAt: null,
              roleAssignmentId: { in: [...teacherAssignmentIds] },
            },
            select: { id: true },
          });
          if (scope === null) throw new LearningDataError('not-a-teacher');

          const now = new Date();
          if (window.state !== 'open' || Number(window.booked) > 0)
            throw new LearningDataError('window-unavailable');
          if (window.startsAt.getTime() <= now.getTime())
            throw new LearningDataError('past');
          if (await teacherOverlaps(tx, window.userId, window, null))
            throw new LearningDataError('overlap');

          const sessionId = randomUUID();
          const bookingId = randomUUID();
          const reminderAt =
            reminderLeadMinutes === null || reminderLeadMinutes <= 0
              ? null
              : new Date(window.startsAt.getTime() - reminderLeadMinutes * 60_000);
          await tx.classSession.create({
            data: {
              id: sessionId,
              courseId: request.courseId,
              kind: 'trial',
              scopeId: scope.id,
              startsAt: window.startsAt,
              endsAt: window.endsAt,
              timeZone: window.timeZone,
              startsLocal: window.startsLocal,
              endsLocal: window.endsLocal,
              state: 'scheduled',
              reminderAt,
              createdAt: now,
              updatedAt: now,
            },
          });
          await tx.booking.create({
            data: {
              id: bookingId,
              requestId,
              userId: request.userId,
              courseId: request.courseId,
              sessionId,
              availabilityId,
              state: 'confirmed',
              confirmedAt: now,
              confirmedById: actorId,
              updatedAt: now,
            },
          });

          const recipients = [request.userId, window.userId];
          await commitIntents(tx, {
            purpose: 'learning.booking-confirmed',
            sessionId,
            accountIds: recipients,
            dueAt: now,
            version: 1,
          });
          if (reminderAt !== null)
            await commitIntents(tx, {
              purpose: 'learning.class-reminder',
              sessionId,
              accountIds: recipients,
              dueAt: reminderAt,
              version: 1,
            });

          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'learning.booking.confirmed',
              targetType: 'booking',
              targetId: bookingId,
              after: {
                requestId,
                sessionId,
                availabilityId,
                courseId: request.courseId,
                scopeId: scope.id,
                reminder: String(reminderAt !== null),
              },
              authorisingSource: AUTHORITY,
            }),
          });

          const booking = await tx.booking.findFirst({
            where: { id: bookingId },
            select: BOOKING_SELECT,
          });
          if (booking === null) throw new LearningDataError('conflict');
          return {
            booking: toBookingRecord(booking),
            session: toSessionView(await requireSession(tx, sessionId)),
          };
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    /* ---- sessions ------------------------------------------------------ */

    async sessions(query) {
      const rows = await db.classSession.findMany({
        where: {
          ...(query.state === null ? {} : { state: query.state }),
          ...(query.kind === null ? {} : { kind: query.kind }),
          ...(query.courseId === null ? {} : { courseId: query.courseId }),
        },
        select: SESSION_VIEW_SELECT,
        orderBy: [...BY_START_DESC],
        skip: boundedOffset(query.offset),
        take: CLASS_PAGE + 1,
      });
      return sessionPage(rows);
    },

    async session(sessionId) {
      const row = await sessionView(db, sessionId);
      return row === null ? null : toSessionView(row);
    },

    async participants(sessionId) {
      const row = await sessionView(db, sessionId);
      return row === null ? [] : toParticipants(await participantRows(db, sessionId));
    },

    /** The operator's disclosure operation: scheduled, while activated. */
    async meetingUrl(sessionId) {
      const [row] = await db.$queryRaw<{ meetingUrl: string | null }[]>`
        SELECT [meetingUrl] FROM [dbo].[ClassSession]
        WHERE [id] = ${sessionId} AND [state] = N'scheduled' AND ${ACTIVATED}`;
      return row?.meetingUrl ?? null;
    },

    /**
     * A regular Course session: on a scope that is current under one of the
     * teacher's live assignments, on a published live Course read under the
     * lock its withdrawal must wait for, under the teacher's own lock and free
     * of overlap. Enrolled learners and the teacher are owed its reminder.
     */
    async createSession({ actorId, scopeId, teacherAssignmentIds, schedule, meeting }) {
      if (meeting !== null && !meetingAcceptable(meeting.url))
        throw new LearningDataError('invalid-meeting');
      return toSessionView(
        await audited(
          actorId,
          'learning.session.scheduled',
          { scopeId },
          async (tx) => {
            await requireActivation(tx);
            if (teacherAssignmentIds.length === 0)
              throw new LearningDataError('not-a-teacher');
            const scope = await tx.courseTeachingAssignment.findFirst({
              where: {
                id: scopeId,
                endedAt: null,
                roleAssignmentId: { in: [...teacherAssignmentIds] },
              },
              select: { id: true, courseId: true, userId: true },
            });
            if (scope === null) throw new LearningDataError('not-a-teacher');
            const course = await lockedCourse(tx, scope.courseId);
            if (course?.state !== 'published' || course.format !== 'live')
              throw new LearningDataError('course-unavailable');
            await lockTeacher(tx, scope.userId);
            if (await teacherOverlaps(tx, scope.userId, schedule, null))
              throw new LearningDataError('overlap');

            const now = new Date();
            const sessionId = randomUUID();
            await tx.classSession.create({
              data: {
                id: sessionId,
                courseId: scope.courseId,
                kind: 'course',
                scopeId: scope.id,
                startsAt: schedule.startsAt,
                endsAt: schedule.endsAt,
                timeZone: schedule.timeZone,
                startsLocal: schedule.startsLocal,
                endsLocal: schedule.endsLocal,
                state: 'scheduled',
                meetingProvider: meeting === null ? null : meeting.provider,
                meetingUrl: meeting === null ? null : meeting.url,
                reminderAt: schedule.reminderAt,
                createdAt: now,
                updatedAt: now,
              },
            });
            const created = await requireSession(tx, sessionId);
            if (created.reminderAt !== null)
              await commitSessionIntents(
                tx,
                created,
                'learning.class-reminder',
                created.reminderAt,
                created.version,
              );
            return created;
          },
          (row) => ({ kind: row.kind, courseId: row.courseId }),
        ),
      );
    },

    async reschedule({ actorId, sessionId, expectedVersion, schedule }) {
      return toSessionView(
        await audited(
          actorId,
          'learning.session.rescheduled',
          { version: String(expectedVersion) },
          (tx) =>
            rescheduleSession(tx, {
              sessionId,
              expectedVersion,
              schedule,
              now: new Date(),
            }),
        ),
      );
    },

    /** Closing is always allowed — activated or not — so a class is never stuck open. */
    async cancel({ actorId, sessionId, expectedVersion }) {
      return toSessionView(
        await audited(
          actorId,
          'learning.session.cancelled',
          { version: String(expectedVersion) },
          (tx) =>
            closeSession(tx, {
              sessionId,
              expectedVersion,
              state: 'cancelled',
              actorId,
              now: new Date(),
            }),
        ),
      );
    },

    async complete({ actorId, sessionId, expectedVersion }) {
      return toSessionView(
        await audited(
          actorId,
          'learning.session.completed',
          { version: String(expectedVersion) },
          (tx) =>
            closeSession(tx, {
              sessionId,
              expectedVersion,
              state: 'completed',
              actorId,
              now: new Date(),
            }),
        ),
      );
    },

    /**
     * Moves a FUTURE scheduled session to another CURRENT scope on the same
     * Course, under both teachers' locks in identifier order. The old
     * teacher's pending intents for it are abandoned; the new teacher is owed
     * its reminder under the new version.
     */
    async replaceTeacher({
      actorId,
      sessionId,
      expectedVersion,
      scopeId,
      teacherAssignmentIds,
    }) {
      let previousScopeId = '';
      return toSessionView(
        await audited(
          actorId,
          'learning.session.teacher-replaced',
          { version: String(expectedVersion) },
          async (tx) => {
            await requireActivation(tx);
            if (teacherAssignmentIds.length === 0)
              throw new LearningDataError('not-a-teacher');
            const now = new Date();
            const current = await requireSession(tx, sessionId);
            previousScopeId = current.scopeId;
            if (current.state !== 'scheduled') throw new LearningDataError('terminal');
            if (current.startsAt.getTime() <= now.getTime())
              throw new LearningDataError('past');
            if (current.version !== expectedVersion)
              throw new LearningDataError('conflict');
            const next = await tx.courseTeachingAssignment.findFirst({
              where: {
                id: scopeId,
                courseId: current.courseId,
                endedAt: null,
                roleAssignmentId: { in: [...teacherAssignmentIds] },
              },
              select: { id: true, userId: true },
            });
            if (next === null) throw new LearningDataError('not-a-teacher');
            if (next.id === current.scopeId) return current;

            await lockTeachers(tx, [current.scope.userId, next.userId]);
            if (await teacherOverlaps(tx, next.userId, current, sessionId))
              throw new LearningDataError('overlap');
            const claimed = await tx.classSession.updateMany({
              where: { id: sessionId, version: expectedVersion, state: 'scheduled' },
              data: { scopeId: next.id, version: { increment: 1 }, updatedAt: now },
            });
            if (claimed.count !== 1) throw new LearningDataError('conflict');
            const moved = await requireSession(tx, sessionId);

            if (current.scope.userId !== next.userId)
              await abandonIntents(tx, sessionId, { accountId: current.scope.userId });
            if (moved.reminderAt !== null)
              await commitIntents(tx, {
                purpose: 'learning.class-reminder',
                sessionId,
                accountIds: [next.userId],
                dueAt: moved.reminderAt,
                version: moved.version,
              });
            return moved;
          },
          (row) => ({
            fromScopeId: previousScopeId,
            toScopeId: row.scopeId,
          }),
        ),
      );
    },

    /** A narrow correction of one mark on a session not cancelled — by the operator, audited. */
    async correctAttendance({ actorId, sessionId, accountId, status }) {
      try {
        return await db.$transaction(async (tx) => {
          const participants = await markParticipant(tx, {
            sessionId,
            accountId,
            status,
            markedById: actorId,
            now: new Date(),
          });
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'learning.attendance.corrected',
              targetType: 'class-session',
              targetId: sessionId,
              after: { accountId, status },
              authorisingSource: AUTHORITY,
            }),
          });
          return participants;
        });
      } catch (error) {
        refuse(error);
      }
    },
  };
}
