import 'server-only';

import { z } from 'zod';

import {
  attendanceStatusSchema,
  classIdSchema,
  classVersionSchema,
  classWindowInputSchema,
  learningAccountIdSchema,
  meetingInputSchema,
  normaliseMeeting,
  reminderLeadOf,
  rescheduleInputSchema,
  type LearningActivationPort,
  type LearningActor,
  type LearningTeachingAuthorityPort,
  type TeacherIdentity,
  type TeachingPort,
} from '@minhaj/contracts/learning';
import type {
  AuditPort,
  RateLimitRule,
  RateLimiterPort,
} from '@minhaj/contracts/platform';

import type { LearningLimitKey } from './learner-service.ts';
import { asLearningRefusal, LearningRefusal } from './refusal.ts';
import { reschedule as rescheduleWindow, resolveWindow } from './scheduling.ts';

/** Every teacher write — a window, a meeting address, a move, a mark — per account. */
export const TEACHING_WRITE_RULE: RateLimitRule = Object.freeze({
  window: 3_600,
  max: 240,
});

/** How far a teacher's calendar reads at once. */
const CALENDAR_DAYS = 62;
const DAY = 86_400_000;

/**
 * The Teacher area's service (DELIVERY_PLAN.md Phase 23; DOMAIN_MODEL.md
 * §13.2).
 *
 * WHO A TEACHER IS, ASKED ON EVERY CALL. Not a profile, not a Course's public
 * attribution, not a role name: an account whose Identity RoleAssignments —
 * read live, through Identity's own public interface — carry
 * `teaching.perform` NOW. The identifiers of those assignments travel into the
 * adapter as the `TeacherIdentity`, and every query there also requires a
 * CURRENT typed scope made under one of them on the exact Course. Revocation
 * therefore wins on the next request, and the absence of a scope row is a
 * denial, never global authority.
 *
 * NOTHING WHILE NOT ACTIVATED. Every read and write here first asks the
 * activation gate; with no activation in force the Teacher area is honestly
 * unavailable (`not-activated`), and the triggers beneath refuse any write
 * that slipped past.
 *
 * STUDENT DATA IS AUDITED. Listing or opening a learner records an audit row
 * of identifiers only — who read whose Learning facts, under which key —
 * never a name, a mark or a lesson (SECURITY_BASELINE.md §13.2, §13.4).
 *
 * THE MEETING ADDRESS LEAVES THROUGH ONE DOOR. `meetingUrl` is the only read
 * that returns it; nothing it is listed, logged or audited by carries it.
 */
export function createTeachingService(deps: {
  readonly teaching: TeachingPort;
  readonly authority: LearningTeachingAuthorityPort;
  readonly activation: LearningActivationPort;
  readonly audit: AuditPort;
  readonly limiter: RateLimiterPort;
  readonly key: LearningLimitKey;
  readonly clock?: () => Date;
}) {
  const store = deps.teaching;
  const now = deps.clock ?? (() => new Date());
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asLearningRefusal);

  /** The session's account and its live teaching assignments — or a refusal. */
  async function identify(actor: LearningActor): Promise<TeacherIdentity> {
    const parsed = learningAccountIdSchema.safeParse(actor?.accountId);
    if (!parsed.success) throw new LearningRefusal('denied');
    if ((await deps.activation.activeMode()) === null)
      throw new LearningRefusal('not-activated');
    const assignmentIds = await deps.authority.liveTeachingAssignments(parsed.data);
    if (assignmentIds.length === 0) throw new LearningRefusal('not-a-teacher');
    return { accountId: parsed.data, assignmentIds };
  }

  async function spend(accountId: string): Promise<void> {
    const decision = await deps.limiter.consume(
      deps.key('learning-teach', accountId),
      TEACHING_WRITE_RULE,
    );
    if (!decision.allowed) throw new LearningRefusal('rate-limited');
  }

  const offset = (value: number) =>
    Number.isInteger(value) && value >= 0 && value <= 25_000 ? value : 0;

  async function audited(
    teacher: TeacherIdentity,
    action: string,
    targetType: string,
    targetId: string,
  ): Promise<void> {
    await deps.audit.record({
      actorType: 'user',
      actorId: teacher.accountId,
      action,
      targetType,
      targetId,
      authorisingSource: 'teaching.perform',
    });
  }

  return {
    /** Whether the signed-in account may enter the Teacher area at all, and why not. */
    async access(
      actor: LearningActor,
    ): Promise<'teacher' | 'not-activated' | 'not-a-teacher'> {
      try {
        await identify(actor);
        return 'teacher';
      } catch (error) {
        const reason = (error as { reason?: unknown } | null)?.reason;
        return reason === 'not-activated' ? 'not-activated' : 'not-a-teacher';
      }
    },

    /* ---- Courses and materials ----------------------------------------- */

    async courses(actor: LearningActor) {
      const teacher = await identify(actor);
      return run(store.courses(teacher));
    },

    async course(actor: LearningActor, courseId: string) {
      const teacher = await identify(actor);
      const id = classIdSchema.safeParse(courseId);
      return id.success ? run(store.course(teacher, id.data)) : null;
    },

    /** One lesson's body of an assigned Course: the materials a teacher reads. */
    async lesson(actor: LearningActor, courseId: string, lessonId: string) {
      const teacher = await identify(actor);
      const course = classIdSchema.safeParse(courseId);
      const lesson = classIdSchema.safeParse(lessonId);
      if (!course.success || !lesson.success) return null;
      return run(store.lesson(teacher, course.data, lesson.data));
    },

    /* ---- Students --------------------------------------------------------- */

    async students(actor: LearningActor, courseId: string | null, start = 0) {
      const teacher = await identify(actor);
      const course = courseId === null ? null : classIdSchema.parse(courseId);
      const page = await run(store.students(teacher, course, offset(start)));
      if (page.items.length > 0)
        await audited(
          teacher,
          'learning.students.listed',
          course === null ? 'teacher-scope' : 'course',
          course ?? teacher.accountId,
        );
      return page;
    },

    async student(actor: LearningActor, accountId: string) {
      const teacher = await identify(actor);
      const id = learningAccountIdSchema.safeParse(accountId);
      if (!id.success) return null;
      const detail = await run(store.student(teacher, id.data));
      if (detail !== null)
        await audited(teacher, 'learning.student.accessed', 'account', id.data);
      return detail;
    },

    /* ---- Calendar and sessions ------------------------------------------ */

    /** Sessions from `from` (default now) for a bounded calendar span. */
    async calendar(
      actor: LearningActor,
      from: Date | null,
      start = 0,
      courseId: string | null = null,
    ) {
      const teacher = await identify(actor);
      const begin = from ?? now();
      const course = courseId === null ? null : classIdSchema.parse(courseId);
      return run(
        store.sessions(
          teacher,
          {
            from: begin,
            to: new Date(begin.getTime() + CALENDAR_DAYS * DAY),
            courseId: course,
          },
          offset(start),
        ),
      );
    },

    /** Today's sessions in the teacher's scheduling view: a UTC day around now. */
    async today(actor: LearningActor, dayStart: Date, dayEnd: Date) {
      const teacher = await identify(actor);
      return run(store.sessions(teacher, { from: dayStart, to: dayEnd }, 0));
    },

    /** Past sessions, latest first. */
    async history(actor: LearningActor, start = 0) {
      const teacher = await identify(actor);
      const end = now();
      return run(
        store.sessions(
          teacher,
          { from: new Date(end.getTime() - 366 * DAY), to: end },
          offset(start),
        ),
      );
    },

    async session(actor: LearningActor, sessionId: string) {
      const teacher = await identify(actor);
      const id = classIdSchema.safeParse(sessionId);
      return id.success ? run(store.session(teacher, id.data)) : null;
    },

    async participants(actor: LearningActor, sessionId: string) {
      const teacher = await identify(actor);
      const id = classIdSchema.safeParse(sessionId);
      if (!id.success) return [];
      const participants = await run(store.participants(teacher, id.data));
      if (participants.length > 0)
        await audited(teacher, 'learning.participants.listed', 'class-session', id.data);
      return participants;
    },

    /** THE disclosure read: the meeting address of the teacher's own scheduled session. */
    async meetingUrl(actor: LearningActor, sessionId: string) {
      const teacher = await identify(actor);
      const id = classIdSchema.safeParse(sessionId);
      return id.success ? run(store.meetingUrl(teacher, id.data)) : null;
    },

    /** Sets, replaces or clears the validated meeting address of an own scheduled session. */
    async setMeeting(
      actor: LearningActor,
      sessionId: string,
      expectedVersion: number,
      raw: unknown,
    ) {
      const teacher = await identify(actor);
      await spend(teacher.accountId);
      const meeting =
        raw === null
          ? null
          : (() => {
              const parsed = meetingInputSchema.safeParse(raw);
              if (!parsed.success) throw new LearningRefusal('invalid-meeting');
              const canonical = normaliseMeeting(parsed.data);
              if (canonical === null) throw new LearningRefusal('invalid-meeting');
              return canonical;
            })();
      return run(
        store.setMeeting({
          teacher,
          sessionId: classIdSchema.parse(sessionId),
          expectedVersion: classVersionSchema.parse(expectedVersion),
          meeting,
        }),
      );
    },

    /**
     * Moves an own scheduled session. The lead is kept unless the form names
     * one; the old reminder intent is abandoned and a new one committed by the
     * adapter, so the moved class never fires the old reminder (§19.5).
     */
    async reschedule(
      actor: LearningActor,
      sessionId: string,
      expectedVersion: number,
      raw: unknown,
    ) {
      const teacher = await identify(actor);
      await spend(teacher.accountId);
      const id = classIdSchema.parse(sessionId);
      const current = await run(store.session(teacher, id));
      if (current === null) throw new LearningRefusal('not-found');
      const input = rescheduleInputSchema.parse(raw);
      const schedule = rescheduleWindow(
        input,
        reminderLeadOf(current.session.startsAt, current.session.reminderAt),
        now(),
      );
      return run(
        store.reschedule({
          teacher,
          sessionId: id,
          expectedVersion: classVersionSchema.parse(expectedVersion),
          schedule,
        }),
      );
    },

    async cancel(actor: LearningActor, sessionId: string, expectedVersion: number) {
      const teacher = await identify(actor);
      await spend(teacher.accountId);
      return run(
        store.cancel({
          teacher,
          sessionId: classIdSchema.parse(sessionId),
          expectedVersion: classVersionSchema.parse(expectedVersion),
        }),
      );
    },

    async complete(actor: LearningActor, sessionId: string, expectedVersion: number) {
      const teacher = await identify(actor);
      await spend(teacher.accountId);
      return run(
        store.complete({
          teacher,
          sessionId: classIdSchema.parse(sessionId),
          expectedVersion: classVersionSchema.parse(expectedVersion),
        }),
      );
    },

    /* ---- Attendance ------------------------------------------------------- */

    async markAttendance(
      actor: LearningActor,
      sessionId: string,
      accountId: string,
      status: unknown,
    ) {
      const teacher = await identify(actor);
      await spend(teacher.accountId);
      return run(
        store.markAttendance({
          teacher,
          sessionId: classIdSchema.parse(sessionId),
          accountId: learningAccountIdSchema.parse(accountId),
          status: attendanceStatusSchema.parse(status),
        }),
      );
    },

    async attendanceReport(actor: LearningActor, start = 0) {
      const teacher = await identify(actor);
      return run(store.attendanceReport(teacher, offset(start)));
    },

    /* ---- Availability ----------------------------------------------------- */

    async availability(actor: LearningActor, start = 0) {
      const teacher = await identify(actor);
      return run(store.availability(teacher, offset(start)));
    },

    async openAvailability(actor: LearningActor, raw: unknown) {
      const teacher = await identify(actor);
      await spend(teacher.accountId);
      const window = resolveWindow(classWindowInputSchema.parse(raw), now());
      return run(store.openAvailability({ teacher, window }));
    },

    async withdrawAvailability(
      actor: LearningActor,
      availabilityId: string,
      expectedVersion: number,
    ) {
      const teacher = await identify(actor);
      await spend(teacher.accountId);
      return run(
        store.withdrawAvailability({
          teacher,
          availabilityId: classIdSchema.parse(availabilityId),
          expectedVersion: classVersionSchema.parse(expectedVersion),
        }),
      );
    },
  };
}

export type TeachingService = ReturnType<typeof createTeachingService>;

/** The identifiers a teacher's attendance form names, validated before anything reads them. */
export const attendanceMarkSchema = z
  .object({
    sessionId: classIdSchema,
    accountId: learningAccountIdSchema,
    status: attendanceStatusSchema,
  })
  .strict();
