import 'server-only';

import { z } from 'zod';

import {
  attendanceStatusSchema,
  classAdminQuerySchema,
  classIdSchema,
  classVersionSchema,
  learningAccountIdSchema,
  meetingInputSchema,
  normaliseMeeting,
  reminderLeadOf,
  rescheduleInputSchema,
  sessionScheduleInputSchema,
  trialConfirmationSchema,
  type ClassAdminPort,
  type LearningActivationPort,
  type LearningActor,
  type LearningTeacherDirectoryPort,
  type LearningTeachingAuthorityPort,
} from '@minhaj/contracts/learning';
import type { AuditPort } from '@minhaj/contracts/platform';

import { asLearningRefusal, LearningRefusal } from './refusal.ts';
import { reschedule as rescheduleWindow, resolveSchedule } from './scheduling.ts';

type ClassKey = 'learning.classes.read' | 'learning.classes.administer';

/**
 * The class administration (ROUTE_MAP.md §7 `/admin/learning/classes` and the
 * confirmation on `/admin/learning/trials`; DELIVERY_PLAN.md Phase 23).
 *
 * TWO KEYS, RE-CHECKED LIVE. `learning.classes.read` opens the operational
 * state — scopes, requests with WHO asked, bookings, sessions, participants —
 * and `learning.classes.administer` is what every change requires. Phase 22's
 * `learning.read` / `learning.administer` are deliberately NOT widened: they
 * still show counts and never a learner (SECURITY_BASELINE.md §19.1.3).
 *
 * IT GRANTS NO IDENTITY KEY. Scoping a teacher to a Course is admitted only
 * for an account Identity ALREADY reports holding a live `teaching.perform`
 * assignment, and People reports linked to a published Person with an active
 * TeacherProfile; the scope names that exact assignment. Nothing here can
 * create, widen or revoke a RoleAssignment.
 *
 * IDENTITY READS ARE AUDITED. A page of requests or a session's participants
 * names accounts; each such read records who looked, at what — identifiers
 * only (SECURITY_BASELINE.md §13.2 "data access").
 *
 * NOTHING WHILE NOT ACTIVATED, except reading and scoping: an operator may
 * prepare scopes before activation, but no window, session or booking exists
 * until the gate opens.
 */
export function createClassAdminService(deps: {
  readonly admin: ClassAdminPort;
  readonly authority: LearningTeachingAuthorityPort;
  readonly activation: LearningActivationPort;
  readonly directory: LearningTeacherDirectoryPort;
  readonly audit: AuditPort;
  readonly clock?: () => Date;
}) {
  const store = deps.admin;
  const now = deps.clock ?? (() => new Date());
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asLearningRefusal);

  async function permit(actor: LearningActor, key: ClassKey): Promise<string> {
    const parsed = learningAccountIdSchema.safeParse(actor?.accountId);
    if (!parsed.success || !(await deps.authority.permits(parsed.data, key)))
      throw new LearningRefusal('denied');
    return parsed.data;
  }

  async function activated(): Promise<void> {
    if ((await deps.activation.activeMode()) === null)
      throw new LearningRefusal('not-activated');
  }

  async function accessAudited(
    actorId: string,
    action: string,
    targetType: string,
    targetId: string,
  ): Promise<void> {
    await deps.audit.record({
      actorType: 'user',
      actorId,
      action,
      targetType,
      targetId,
      authorisingSource: 'learning.classes.read',
    });
  }

  /** Identity's live `teaching.perform` assignments for an account — or a refusal. */
  async function teacherAssignments(accountId: string): Promise<readonly string[]> {
    const ids = await deps.authority.liveTeachingAssignments(accountId);
    if (ids.length === 0) throw new LearningRefusal('not-a-teacher');
    return ids;
  }

  const offset = (value: number) =>
    Number.isInteger(value) && value >= 0 && value <= 25_000 ? value : 0;

  return {
    /** The live-learning authority in force, for the operator's own honesty banner. */
    async activation(actor: LearningActor) {
      await permit(actor, 'learning.classes.read');
      return deps.activation.activeMode();
    },

    /* ---- Teaching scopes ----------------------------------------------- */

    async scopes(
      actor: LearningActor,
      filter: {
        readonly courseId?: string | null;
        readonly accountId?: string | null;
        readonly current?: boolean | null;
      } = {},
      start = 0,
    ) {
      await permit(actor, 'learning.classes.read');
      return run(
        store.scopes({
          courseId: filter.courseId ? classIdSchema.parse(filter.courseId) : null,
          accountId: filter.accountId
            ? learningAccountIdSchema.parse(filter.accountId)
            : null,
          current: filter.current === undefined ? true : filter.current,
          offset: offset(start),
        }),
      );
    },

    /** Live-format Courses a scope may be made on — under the class keys alone. */
    async liveCourses(actor: LearningActor, start = 0) {
      await permit(actor, 'learning.classes.read');
      return run(store.liveCourses(offset(start)));
    },

    async scope(actor: LearningActor, scopeId: string) {
      await permit(actor, 'learning.classes.read');
      const id = classIdSchema.safeParse(scopeId);
      return id.success ? run(store.scope(id.data)) : null;
    },

    /**
     * Scopes a CURRENT teacher to a live Course. Identity must report a live
     * `teaching.perform` assignment for the account (the earliest is named),
     * and People a published TeacherProfile — neither is granted here.
     */
    async grantScope(actor: LearningActor, courseId: string, accountId: string) {
      const actorId = await permit(actor, 'learning.classes.administer');
      const course = classIdSchema.parse(courseId);
      const account = learningAccountIdSchema.parse(accountId);
      const [assignment] = await teacherAssignments(account);
      if (assignment === undefined) throw new LearningRefusal('not-a-teacher');
      const listed = await deps.directory.teacherAccounts([account]);
      if (!listed.includes(account)) throw new LearningRefusal('not-a-teacher');
      return run(
        store.grantScope({
          actorId,
          courseId: course,
          accountId: account,
          roleAssignmentId: assignment,
        }),
      );
    },

    async endScope(actor: LearningActor, scopeId: string, expectedVersion: number) {
      const actorId = await permit(actor, 'learning.classes.administer');
      return run(
        store.endScope({
          actorId,
          scopeId: classIdSchema.parse(scopeId),
          expectedVersion: classVersionSchema.parse(expectedVersion),
        }),
      );
    },

    /* ---- Trial requests and confirmation --------------------------------- */

    /** Requests with who asked — an identity read, audited per page. */
    async trialRequests(actor: LearningActor, courseId: string | null, start = 0) {
      const actorId = await permit(actor, 'learning.classes.read');
      const course = courseId === null ? null : classIdSchema.parse(courseId);
      const page = await run(store.trialRequests(course, offset(start)));
      if (page.items.length > 0)
        await accessAudited(
          actorId,
          'learning.trial-requests.accessed',
          'course',
          course ?? 'all',
        );
      return page;
    },

    /** Windows an operator may confirm a request on that Course into. */
    async availableWindows(actor: LearningActor, courseId: string, start = 0) {
      await permit(actor, 'learning.classes.read');
      return run(
        store.availableWindows(classIdSchema.parse(courseId), now(), offset(start)),
      );
    },

    /**
     * Confirms a request into a Booking and a trial session on the chosen
     * window. The window's teacher must hold a live grant NOW (Identity is
     * asked here, and the adapter requires a current scope made under one of
     * those assignments); the adapter serialises the slot.
     */
    async confirmTrial(actor: LearningActor, raw: unknown) {
      const actorId = await permit(actor, 'learning.classes.administer');
      await activated();
      const input = trialConfirmationSchema.parse(raw);
      const owner = await run(store.availabilityOwner(input.availabilityId));
      if (owner === null) throw new LearningRefusal('window-unavailable');
      const teacherAssignmentIds = await teacherAssignments(owner);
      return run(
        store.confirmTrial({
          actorId,
          requestId: input.requestId,
          availabilityId: input.availabilityId,
          teacherAssignmentIds,
          reminderLeadMinutes: input.reminderLeadMinutes,
        }),
      );
    },

    /* ---- Sessions -------------------------------------------------------- */

    async sessions(actor: LearningActor, raw: unknown = {}) {
      await permit(actor, 'learning.classes.read');
      return run(store.sessions(classAdminQuerySchema.parse(raw)));
    },

    async session(actor: LearningActor, sessionId: string) {
      await permit(actor, 'learning.classes.read');
      const id = classIdSchema.safeParse(sessionId);
      return id.success ? run(store.session(id.data)) : null;
    },

    /** A session's participants — an identity read, audited. */
    async participants(actor: LearningActor, sessionId: string) {
      const actorId = await permit(actor, 'learning.classes.read');
      const id = classIdSchema.safeParse(sessionId);
      if (!id.success) return [];
      const participants = await run(store.participants(id.data));
      if (participants.length > 0)
        await accessAudited(
          actorId,
          'learning.participants.accessed',
          'class-session',
          id.data,
        );
      return participants;
    },

    /** The disclosure read for an operator: a scheduled session's meeting address. */
    async meetingUrl(actor: LearningActor, sessionId: string) {
      await permit(actor, 'learning.classes.read');
      const id = classIdSchema.safeParse(sessionId);
      return id.success ? run(store.meetingUrl(id.data)) : null;
    },

    /** A regular Course session on a current scope, with an optional validated meeting address. */
    async createSession(actor: LearningActor, scopeId: string, raw: unknown) {
      const actorId = await permit(actor, 'learning.classes.administer');
      await activated();
      const scope = await run(store.scope(classIdSchema.parse(scopeId)));
      if (scope === null) throw new LearningRefusal('not-found');
      if (scope.scope.endedAt !== null) throw new LearningRefusal('not-a-teacher');
      const teacherAssignmentIds = await teacherAssignments(scope.scope.accountId);
      const parsed = createSessionSchema.parse(raw);
      const meeting =
        parsed.meeting === null
          ? null
          : (() => {
              const canonical = normaliseMeeting(parsed.meeting);
              if (canonical === null) throw new LearningRefusal('invalid-meeting');
              return canonical;
            })();
      return run(
        store.createSession({
          actorId,
          scopeId: scope.scope.id,
          teacherAssignmentIds,
          schedule: resolveSchedule(parsed.schedule, now()),
          meeting,
        }),
      );
    },

    async reschedule(
      actor: LearningActor,
      sessionId: string,
      expectedVersion: number,
      raw: unknown,
    ) {
      const actorId = await permit(actor, 'learning.classes.administer');
      await activated();
      const id = classIdSchema.parse(sessionId);
      const current = await run(store.session(id));
      if (current === null) throw new LearningRefusal('not-found');
      const schedule = rescheduleWindow(
        rescheduleInputSchema.parse(raw),
        reminderLeadOf(current.session.startsAt, current.session.reminderAt),
        now(),
      );
      return run(
        store.reschedule({
          actorId,
          sessionId: id,
          expectedVersion: classVersionSchema.parse(expectedVersion),
          schedule,
        }),
      );
    },

    async cancel(actor: LearningActor, sessionId: string, expectedVersion: number) {
      const actorId = await permit(actor, 'learning.classes.administer');
      return run(
        store.cancel({
          actorId,
          sessionId: classIdSchema.parse(sessionId),
          expectedVersion: classVersionSchema.parse(expectedVersion),
        }),
      );
    },

    async complete(actor: LearningActor, sessionId: string, expectedVersion: number) {
      const actorId = await permit(actor, 'learning.classes.administer');
      return run(
        store.complete({
          actorId,
          sessionId: classIdSchema.parse(sessionId),
          expectedVersion: classVersionSchema.parse(expectedVersion),
        }),
      );
    },

    /** Moves a future session to another current scope of the same Course. */
    async replaceTeacher(
      actor: LearningActor,
      sessionId: string,
      expectedVersion: number,
      scopeId: string,
    ) {
      const actorId = await permit(actor, 'learning.classes.administer');
      await activated();
      const scope = await run(store.scope(classIdSchema.parse(scopeId)));
      if (scope === null) throw new LearningRefusal('not-found');
      if (scope.scope.endedAt !== null) throw new LearningRefusal('not-a-teacher');
      const teacherAssignmentIds = await teacherAssignments(scope.scope.accountId);
      return run(
        store.replaceTeacher({
          actorId,
          sessionId: classIdSchema.parse(sessionId),
          expectedVersion: classVersionSchema.parse(expectedVersion),
          scopeId: scope.scope.id,
          teacherAssignmentIds,
        }),
      );
    },

    /** A narrow correction of one mark, under the administer key. */
    async correctAttendance(
      actor: LearningActor,
      sessionId: string,
      accountId: string,
      status: unknown,
    ) {
      const actorId = await permit(actor, 'learning.classes.administer');
      return run(
        store.correctAttendance({
          actorId,
          sessionId: classIdSchema.parse(sessionId),
          accountId: learningAccountIdSchema.parse(accountId),
          status: attendanceStatusSchema.parse(status),
        }),
      );
    },
  };
}

export type ClassAdminService = ReturnType<typeof createClassAdminService>;

/** What a new regular session names: its schedule and, optionally, a meeting address. */
export const createSessionSchema = z
  .object({
    schedule: sessionScheduleInputSchema,
    meeting: meetingInputSchema.nullable().default(null),
  })
  .strict();
