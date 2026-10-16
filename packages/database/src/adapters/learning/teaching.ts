import 'server-only';

import { randomUUID } from 'node:crypto';

import type { Locale } from '@minhaj/contracts';
import {
  CLASS_LIMITS,
  CLASS_PAGE,
  type AttendanceReportRow,
  type AttendanceStatus,
  type TeacherIdentity,
  type TeacherStudentDetail,
  type TeacherStudentSummary,
  type TeachingPort,
} from '@minhaj/contracts/learning';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import {
  AVAILABILITY_SELECT,
  BY_START,
  SCOPE_VIEW_SELECT,
  SESSION_VIEW_SELECT,
  sessionPage,
  sessionViewsByIds,
  toAvailabilityRecord,
  toScopeView,
  toSessionView,
  type SessionViewRow,
} from './class-records.ts';
import { lockTeacher, LOCKED_TRANSACTION } from './locks.ts';
import {
  COURSE_DETAIL_SELECT,
  COURSE_LISTING_SELECT,
  toCourseDetail,
  toCourseListing,
} from './records.ts';
import {
  closeSession,
  markParticipant,
  meetingAcceptable,
  participantRows,
  requireActivation,
  requireSession,
  rescheduleSession,
  sessionView,
  toParticipants,
  type SessionWhere,
} from './sessions.ts';
import {
  ACTIVATED,
  activated,
  boundedOffset,
  currentScope,
  currentScopeSql,
  LearningDataError,
  refuse,
  type Client,
} from './shared.ts';

/**
 * A teacher's OWN surface (DOMAIN_MODEL.md §13.2; DELIVERY_PLAN.md Phase 23).
 *
 * EVERY QUERY CARRIES THE WHOLE AUTHORITY. A `TeacherIdentity` is the account
 * AND the live `teaching.perform` assignments Identity reported for it on
 * THIS request; every statement below places `scope.userId = account`,
 * `scope.roleAssignmentId IN (those assignments)` and `scope.endedAt IS NULL`
 * in its own WHERE, beside the activation gate for anything that discloses
 * or changes class state. An absent scope is a denial, never global
 * authority: a teacher sees only the Courses an operator scoped to them, the
 * learners enrolled there, and their own sessions, windows and marks. A
 * profile, a Course's public attribution and a revoked assignment each read
 * nothing. An EMPTY assignment list answers without querying at all.
 *
 * THE ADDRESS IS DISCLOSED BY ONE STATEMENT, whose WHERE is the entire rule:
 * activated, scheduled, this teacher's current scope. No list reads it.
 */

/** Courses one teacher may hold at once, and classes one student history shows. */
const TEACHER_COURSES = 100;
const STUDENT_CLASSES = 100;

/** The session narrowing every teaching read and write composes. */
function own(teacher: TeacherIdentity): SessionWhere {
  return { scope: currentScope(teacher) };
}

/** Completed lessons per (account, Course), in ONE statement for a page. */
async function completedByPair(
  db: Client,
  userIds: readonly string[],
  courseIds: readonly string[],
): Promise<ReadonlyMap<string, number>> {
  if (userIds.length === 0 || courseIds.length === 0) return new Map();
  const rows = await db.lessonProgress.groupBy({
    by: ['userId', 'courseId'],
    where: { userId: { in: [...userIds] }, courseId: { in: [...new Set(courseIds)] } },
    _count: { lessonId: true },
  });
  return new Map(
    rows.map((row) => [`${row.userId}:${row.courseId}`, row._count.lessonId]),
  );
}

export function createTeaching(): TeachingPort {
  const db = getDatabaseClient();

  /** Each named learner's Enrolments on this teacher's current Courses, as summaries. */
  async function summaries(
    teacher: TeacherIdentity,
    accountIds: readonly string[],
  ): Promise<TeacherStudentSummary[]> {
    if (accountIds.length === 0) return [];
    const rows = await db.enrolment.findMany({
      where: {
        userId: { in: [...accountIds] },
        course: { teachingScopes: { some: currentScope(teacher) } },
      },
      select: {
        userId: true,
        courseId: true,
        enrolledAt: true,
        course: { select: COURSE_LISTING_SELECT },
      },
      orderBy: [{ userId: 'asc' }, { enrolledAt: 'asc' }, { courseId: 'asc' }],
    });
    const completed = await completedByPair(
      db,
      accountIds,
      rows.map((row) => row.courseId),
    );
    return accountIds.map((accountId) => ({
      accountId,
      courses: rows
        .filter((row) => row.userId === accountId)
        .map((row) => ({
          course: toCourseListing(row.course),
          enrolledAt: row.enrolledAt,
          completedLessons: completed.get(`${accountId}:${row.courseId}`) ?? 0,
        })),
    }));
  }

  /**
   * One session change under the teacher's own scope, audited by identifiers.
   * It hands back the session's ROW, which each method maps to the port's
   * view — so what crosses the boundary is always built by a mapper, never a
   * value the transaction produced.
   */
  async function audited(
    teacher: TeacherIdentity,
    action: string,
    before: { readonly version: number; readonly state?: string },
    work: (tx: Client) => Promise<SessionViewRow>,
    options:
      { readonly timeout: number; readonly maxWait: number } | undefined = undefined,
  ): Promise<SessionViewRow> {
    try {
      return await db.$transaction(async (tx) => {
        await requireActivation(tx);
        const row = await work(tx);
        await tx.auditLog.create({
          data: auditRow({
            actorType: 'user',
            actorId: teacher.accountId,
            action,
            targetType: 'class-session',
            targetId: row.id,
            before: {
              version: String(before.version),
              ...(before.state === undefined ? {} : { state: before.state }),
            },
            after: { version: String(row.version), state: row.state },
            authorisingSource: 'teaching.perform',
          }),
        });
        return row;
      }, options);
    } catch (error) {
      refuse(error);
    }
  }

  return {
    async courses(teacher) {
      if (teacher.assignmentIds.length === 0) return [];
      const rows = await db.courseTeachingAssignment.findMany({
        where: currentScope(teacher),
        select: SCOPE_VIEW_SELECT,
        orderBy: [{ grantedAt: 'asc' }, { id: 'asc' }],
        take: TEACHER_COURSES,
      });
      return rows.map(toScopeView);
    },

    async course(teacher, courseId) {
      if (teacher.assignmentIds.length === 0) return null;
      const row = await db.courseTeachingAssignment.findFirst({
        where: { ...currentScope(teacher), courseId },
        select: { course: { select: COURSE_DETAIL_SELECT } },
      });
      return row === null ? null : toCourseDetail(row.course);
    },

    /** The materials a teacher reads: a lesson's body, only on a Course scoped to them NOW. */
    async lesson(teacher, courseId, lessonId) {
      if (teacher.assignmentIds.length === 0) return null;
      const row = await db.lesson.findFirst({
        where: {
          id: lessonId,
          courseId,
          module: { course: { teachingScopes: { some: currentScope(teacher) } } },
        },
        select: {
          id: true,
          courseId: true,
          moduleId: true,
          position: true,
          labels: {
            select: { locale: true, title: true, summary: true, body: true },
            orderBy: { locale: 'asc' },
          },
        },
      });
      return row === null
        ? null
        : {
            ...row,
            labels: row.labels.map((label) => ({
              ...label,
              locale: label.locale as Locale,
            })),
          };
    },

    /**
     * Learners enrolled on this teacher's current Courses — optionally one of
     * them, which must itself be scoped: the EXISTS carries the scope, so an
     * unscoped Course filter is an empty page, never a wider one.
     */
    async students(teacher, courseId, offset) {
      if (teacher.assignmentIds.length === 0) return { items: [], hasMore: false };
      const rows = await db.$queryRaw<{ userId: string }[]>`
        SELECT e.[userId]
        FROM [dbo].[Enrolment] e
        WHERE EXISTS (
            SELECT 1 FROM [dbo].[CourseTeachingAssignment] s
            WHERE s.[courseId] = e.[courseId] AND ${currentScopeSql(teacher)})
          AND (${courseId} IS NULL OR e.[courseId] = ${courseId})
        GROUP BY e.[userId]
        ORDER BY e.[userId]
        OFFSET ${boundedOffset(offset)} ROWS FETCH NEXT ${CLASS_PAGE + 1} ROWS ONLY`;
      const page = rows.slice(0, CLASS_PAGE).map((row) => row.userId);
      return { items: await summaries(teacher, page), hasMore: rows.length > CLASS_PAGE };
    },

    /** One learner with their class history on this teacher's current scopes — or `null` if unrelated. */
    async student(teacher, accountId): Promise<TeacherStudentDetail | null> {
      if (teacher.assignmentIds.length === 0) return null;
      const [summary] = await summaries(teacher, [accountId]);
      if (summary === undefined || summary.courses.length === 0) return null;
      const history = await db.$queryRaw<
        { id: string; participation: string; status: string | null }[]
      >`
        SELECT TOP (${STUDENT_CLASSES}) cs.[id],
               CASE WHEN cs.[kind] = N'trial' THEN N'booking' ELSE N'enrolment' END AS [participation],
               a.[status]
        FROM [dbo].[ClassSession] cs
        JOIN [dbo].[CourseTeachingAssignment] s ON s.[id] = cs.[scopeId]
        LEFT JOIN [dbo].[Attendance] a ON a.[sessionId] = cs.[id] AND a.[userId] = ${accountId}
        WHERE ${currentScopeSql(teacher)}
          AND (
            (cs.[kind] = N'trial' AND EXISTS (
              SELECT 1 FROM [dbo].[Booking] b WHERE b.[sessionId] = cs.[id] AND b.[userId] = ${accountId}))
            OR (cs.[kind] = N'course' AND EXISTS (
              SELECT 1 FROM [dbo].[Enrolment] e WHERE e.[courseId] = cs.[courseId] AND e.[userId] = ${accountId}))
          )
        ORDER BY cs.[startsAt] DESC, cs.[id] ASC`;
      const views = await sessionViewsByIds(
        db,
        history.map((row) => row.id),
      );
      return {
        ...summary,
        classes: history.flatMap((row) => {
          const view = views.get(row.id);
          return view === undefined
            ? []
            : [
                {
                  session: view.session,
                  course: view.course,
                  participation: row.participation as 'enrolment' | 'booking',
                  attendance: row.status as AttendanceStatus | null,
                },
              ];
        }),
      };
    },

    async sessions(teacher, range, offset) {
      if (teacher.assignmentIds.length === 0 || !(await activated(db)))
        return { items: [], hasMore: false };
      const rows = await db.classSession.findMany({
        where: {
          ...own(teacher),
          ...(range.courseId ? { courseId: range.courseId } : {}),
          startsAt: { gte: range.from, lt: range.to },
        },
        select: SESSION_VIEW_SELECT,
        orderBy: [...BY_START],
        skip: boundedOffset(offset),
        take: CLASS_PAGE + 1,
      });
      return sessionPage(rows);
    },

    async session(teacher, sessionId) {
      if (teacher.assignmentIds.length === 0 || !(await activated(db))) return null;
      const row = await sessionView(db, sessionId, own(teacher));
      return row === null ? null : toSessionView(row);
    },

    async participants(teacher, sessionId) {
      if (teacher.assignmentIds.length === 0 || !(await activated(db))) return [];
      const row = await sessionView(db, sessionId, own(teacher));
      return row === null ? [] : toParticipants(await participantRows(db, sessionId));
    },

    /** THE DISCLOSURE OPERATION. The whole rule is the WHERE of this one statement. */
    async meetingUrl(teacher, sessionId) {
      if (teacher.assignmentIds.length === 0) return null;
      const [row] = await db.$queryRaw<{ meetingUrl: string | null }[]>`
        SELECT cs.[meetingUrl]
        FROM [dbo].[ClassSession] cs
        JOIN [dbo].[CourseTeachingAssignment] s ON s.[id] = cs.[scopeId]
        WHERE cs.[id] = ${sessionId}
          AND cs.[state] = N'scheduled'
          AND ${currentScopeSql(teacher)}
          AND ${ACTIVATED}`;
      return row?.meetingUrl ?? null;
    },

    /**
     * The provider and address arrive canonicalised by the service; the
     * adapter still refuses anything that is not an HTTPS `meet.google.com`
     * address, as the floor beneath that (the CHECK is the floor beneath this).
     */
    async setMeeting({ teacher, sessionId, expectedVersion, meeting }) {
      if (teacher.assignmentIds.length === 0) throw new LearningDataError('not-found');
      if (meeting !== null && !meetingAcceptable(meeting.url))
        throw new LearningDataError('invalid-meeting');
      return toSessionView(
        await audited(
          teacher,
          'learning.session.meeting-set',
          { version: expectedVersion },
          async (tx) => {
            const current = await requireSession(tx, sessionId, own(teacher));
            if (current.state !== 'scheduled') throw new LearningDataError('terminal');
            const claimed = await tx.classSession.updateMany({
              where: { id: sessionId, version: expectedVersion, state: 'scheduled' },
              data: {
                meetingProvider: meeting === null ? null : meeting.provider,
                meetingUrl: meeting === null ? null : meeting.url,
                version: { increment: 1 },
                updatedAt: new Date(),
              },
            });
            if (claimed.count !== 1) throw new LearningDataError('conflict');
            return requireSession(tx, sessionId);
          },
        ),
      );
    },

    async reschedule({ teacher, sessionId, expectedVersion, schedule }) {
      if (teacher.assignmentIds.length === 0) throw new LearningDataError('not-found');
      return toSessionView(
        await audited(
          teacher,
          'learning.session.rescheduled',
          { version: expectedVersion },
          (tx) =>
            rescheduleSession(tx, {
              sessionId,
              expectedVersion,
              schedule,
              now: new Date(),
              where: own(teacher),
            }),
          LOCKED_TRANSACTION,
        ),
      );
    },

    async cancel({ teacher, sessionId, expectedVersion }) {
      if (teacher.assignmentIds.length === 0) throw new LearningDataError('not-found');
      return toSessionView(
        await audited(
          teacher,
          'learning.session.cancelled',
          { version: expectedVersion },
          (tx) =>
            closeSession(tx, {
              sessionId,
              expectedVersion,
              state: 'cancelled',
              actorId: teacher.accountId,
              now: new Date(),
              where: own(teacher),
            }),
        ),
      );
    },

    async complete({ teacher, sessionId, expectedVersion }) {
      if (teacher.assignmentIds.length === 0) throw new LearningDataError('not-found');
      return toSessionView(
        await audited(
          teacher,
          'learning.session.completed',
          { version: expectedVersion },
          (tx) =>
            closeSession(tx, {
              sessionId,
              expectedVersion,
              state: 'completed',
              actorId: teacher.accountId,
              now: new Date(),
              where: own(teacher),
            }),
        ),
      );
    },

    async markAttendance({ teacher, sessionId, accountId, status }) {
      if (teacher.assignmentIds.length === 0) throw new LearningDataError('not-found');
      try {
        return await db.$transaction(async (tx) => {
          await requireActivation(tx);
          return markParticipant(tx, {
            sessionId,
            accountId,
            status,
            markedById: teacher.accountId,
            now: new Date(),
            where: own(teacher),
          });
        });
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * This teacher's classes that have started — completed, or scheduled and
     * past — latest first, with the marks counted IN SQL: present, absent, and
     * eligible participants without a row.
     */
    async attendanceReport(teacher, offset) {
      if (teacher.assignmentIds.length === 0 || !(await activated(db)))
        return { items: [], hasMore: false };
      const now = new Date();
      const rows = await db.$queryRaw<
        { id: string; present: number; absent: number; unmarked: number }[]
      >`
        SELECT cs.[id],
          (SELECT COUNT_BIG(*) FROM [dbo].[Attendance] a
            WHERE a.[sessionId] = cs.[id] AND a.[status] = N'present') AS [present],
          (SELECT COUNT_BIG(*) FROM [dbo].[Attendance] a
            WHERE a.[sessionId] = cs.[id] AND a.[status] = N'absent') AS [absent],
          (SELECT COUNT_BIG(*) FROM (
              SELECT b.[userId] FROM [dbo].[Booking] b
              WHERE b.[sessionId] = cs.[id] AND cs.[kind] = N'trial' AND b.[state] <> N'cancelled'
              UNION
              SELECT e.[userId] FROM [dbo].[Enrolment] e
              WHERE e.[courseId] = cs.[courseId] AND cs.[kind] = N'course'
            ) AS p
            WHERE NOT EXISTS (
              SELECT 1 FROM [dbo].[Attendance] a
              WHERE a.[sessionId] = cs.[id] AND a.[userId] = p.[userId])) AS [unmarked]
        FROM [dbo].[ClassSession] cs
        JOIN [dbo].[CourseTeachingAssignment] s ON s.[id] = cs.[scopeId]
        WHERE ${currentScopeSql(teacher)}
          AND cs.[state] IN (N'completed', N'scheduled')
          AND cs.[startsAt] < ${now}
        ORDER BY cs.[startsAt] DESC, cs.[id] ASC
        OFFSET ${boundedOffset(offset)} ROWS FETCH NEXT ${CLASS_PAGE + 1} ROWS ONLY`;
      const page = rows.slice(0, CLASS_PAGE);
      const views = await sessionViewsByIds(
        db,
        page.map((row) => row.id),
      );
      const items: AttendanceReportRow[] = page.flatMap((row) => {
        const view = views.get(row.id);
        return view === undefined
          ? []
          : [
              {
                session: view.session,
                course: view.course,
                present: Number(row.present),
                absent: Number(row.absent),
                unmarked: Number(row.unmarked),
              },
            ];
      });
      return { items, hasMore: rows.length > CLASS_PAGE };
    },

    /** Open windows first, soonest first; then withdrawn ones. */
    async availability(teacher, offset) {
      if (teacher.assignmentIds.length === 0 || !(await activated(db)))
        return { items: [], hasMore: false };
      const rows = await db.availability.findMany({
        where: { userId: teacher.accountId },
        select: AVAILABILITY_SELECT,
        orderBy: [{ state: 'asc' }, { startsAt: 'asc' }, { id: 'asc' }],
        skip: boundedOffset(offset),
        take: CLASS_PAGE + 1,
      });
      return {
        items: rows.slice(0, CLASS_PAGE).map(toAvailabilityRecord),
        hasMore: rows.length > CLASS_PAGE,
      };
    },

    /**
     * Opens one window under the teacher's lock: refused on overlap with
     * another open window of theirs, and beyond the bound on open windows.
     * The trigger (51283, 51284) is the floor beneath both the overlap and the
     * live-assignment question Identity already answered.
     */
    async openAvailability({ teacher, window }) {
      if (teacher.assignmentIds.length === 0)
        throw new LearningDataError('not-a-teacher');
      try {
        return await db.$transaction(async (tx) => {
          await requireActivation(tx);
          await lockTeacher(tx, teacher.accountId);
          const [overlap] = await tx.$queryRaw<{ total: number }[]>`
            SELECT COUNT_BIG(*) AS [total] FROM [dbo].[Availability]
            WHERE [userId] = ${teacher.accountId} AND [state] = N'open'
              AND [startsAt] < ${window.endsAt} AND [endsAt] > ${window.startsAt}`;
          if (Number(overlap?.total ?? 0) > 0) throw new LearningDataError('overlap');
          const open = await tx.availability.count({
            where: { userId: teacher.accountId, state: 'open' },
          });
          if (open >= CLASS_LIMITS.openWindows) throw new LearningDataError('limit');
          const now = new Date();
          const row = await tx.availability.create({
            data: {
              id: randomUUID(),
              userId: teacher.accountId,
              startsAt: window.startsAt,
              endsAt: window.endsAt,
              timeZone: window.timeZone,
              startsLocal: window.startsLocal,
              endsLocal: window.endsLocal,
              state: 'open',
              createdAt: now,
              updatedAt: now,
            },
            select: AVAILABILITY_SELECT,
          });
          return toAvailabilityRecord(row);
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Withdraws an UNBOOKED window of this teacher at its expected version.
     * One already withdrawn is returned as it stands; one a live Booking holds
     * is refused — the learner's trial is cancelled through the Booking, not
     * by pulling its window away.
     */
    async withdrawAvailability({ teacher, availabilityId, expectedVersion }) {
      if (teacher.assignmentIds.length === 0) throw new LearningDataError('not-found');
      try {
        return await db.$transaction(async (tx) => {
          await requireActivation(tx);
          const [locked] = await tx.$queryRaw<
            { state: string; version: number; booked: number }[]
          >`
            SELECT a.[state], a.[version],
              (SELECT COUNT_BIG(*) FROM [dbo].[Booking] b
                WHERE b.[availabilityId] = a.[id] AND b.[state] <> N'cancelled') AS [booked]
            FROM [dbo].[Availability] a WITH (UPDLOCK, HOLDLOCK)
            WHERE a.[id] = ${availabilityId} AND a.[userId] = ${teacher.accountId}`;
          if (locked === undefined) throw new LearningDataError('not-found');
          const read = async () => {
            const row = await tx.availability.findFirst({
              where: { id: availabilityId, userId: teacher.accountId },
              select: AVAILABILITY_SELECT,
            });
            if (row === null) throw new LearningDataError('not-found');
            return toAvailabilityRecord(row);
          };
          if (locked.state === 'withdrawn') return read();
          if (Number(locked.version) !== expectedVersion)
            throw new LearningDataError('conflict');
          if (Number(locked.booked) > 0)
            throw new LearningDataError('window-unavailable');
          const claimed = await tx.availability.updateMany({
            where: {
              id: availabilityId,
              userId: teacher.accountId,
              version: expectedVersion,
              state: 'open',
            },
            data: {
              state: 'withdrawn',
              version: { increment: 1 },
              updatedAt: new Date(),
            },
          });
          if (claimed.count !== 1) throw new LearningDataError('conflict');
          return read();
        });
      } catch (error) {
        refuse(error);
      }
    },
  };
}
