import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getApplicationPrincipalCredentials,
  getDatabaseRuntimeUrl,
} from '../../packages/database/src/config.ts';
import { provisionApplicationPrincipal } from '../../packages/database/src/lifecycle/application-principal.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import {
  openSession,
  parseSqlServerUrl,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  courseInputSchema,
  type ClassAdminPort,
  type ClassCommunicationPort,
  type ClassLearnerPort,
  type ClassPublicReaderPort,
  type CourseDetail,
  type LearnerPort,
  type LearningActivationPort,
  type LearningDispositionPort,
  type LearningExportPort,
  type LearningPersistencePort,
  type ResolvedSchedule,
  type ResolvedWindow,
  type TeacherIdentity,
  type TeachingPort,
} from '../../packages/contracts/src/learning/index.ts';
import { localTimeAt } from '../../packages/contracts/src/platform/time.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import {
  account,
  activateLive,
  classRows,
  count,
  freshSlug,
  intentsFor,
  n,
  pastWindow,
  person,
  revokeAssignment,
  scope as rawScope,
  sentinel,
  sessionColumns,
  teacherAccount,
  topic,
  type TeacherFixture,
} from './fixture-sql.ts';

/**
 * Phase 23 — Learning's class adapters over a REAL SQL Server, running as the
 * REAL least-privilege RUNTIME principal.
 *
 * WHAT ONLY THE DATABASE CAN PROVE: that nothing is scheduled, offered or
 * confirmed until the owner activates live learning, and that the activation
 * cannot be rewritten; that a teacher reaches only the Courses an operator
 * scoped to them under an assignment Identity reports live NOW — a profile,
 * a key without a scope and a revoked assignment each read nothing; that two
 * overlapping windows, two overlapping sessions, two confirmations of one
 * request and two of one window each serialise to exactly one outcome; that
 * a meeting address is disclosed only to a current participant or teacher of
 * a scheduled class and is gone the moment the class closes; that a moved
 * class never fires yesterday's reminder; that every learner read and act is
 * keyed by its own account; and that closure cancels, ends and removes
 * exactly what a person owns and nothing anybody else does.
 *
 * TWO CONNECTIONS, TWO ROLES. The owner session writes the activation,
 * accounts, roles and assignments, runs the raw statements that prove the
 * trigger floor, and inspects. EVERYTHING Learning does goes through its
 * adapters, whose Prisma client is bound to the provisioned RUNTIME
 * principal. Nothing here is content or a real address.
 */

const live = databaseConfigured ? describe : describe.skip;

const reasonOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    const reason = (error as { reason?: unknown } | null)?.reason;
    return typeof reason === 'string' ? reason : 'unclassified';
  }
  return 'accepted';
};

const sqlNumber = async (promise: Promise<unknown>): Promise<number | null> => {
  try {
    await promise;
  } catch (error) {
    const number = (error as { number?: unknown } | null)?.number;
    return typeof number === 'number' ? number : null;
  }
  return null;
};

const MEET = 'https://meet.google.com/abc-defg-hij';
const HOUR = 3_600_000;

/** A whole-minute instant `hours` from now — the schema stores minutes. */
function at(hours: number): Date {
  const instant = new Date(Date.now() + hours * HOUR);
  instant.setUTCSeconds(0, 0);
  return instant;
}

/** A resolved window of `minutes` starting `hours` from now, scheduled in UTC. */
function window(hours: number, minutes = 60): ResolvedWindow {
  const startsAt = at(hours);
  const endsAt = new Date(startsAt.getTime() + minutes * 60_000);
  return {
    startsAt,
    endsAt,
    timeZone: 'UTC',
    startsLocal: localTimeAt(startsAt, 'UTC'),
    endsLocal: localTimeAt(endsAt, 'UTC'),
  };
}

function schedule(
  hours: number,
  lead: number | null = null,
  minutes = 60,
): ResolvedSchedule {
  const base = window(hours, minutes);
  return {
    ...base,
    reminderAt: lead === null ? null : new Date(base.startsAt.getTime() - lead * 60_000),
  };
}

const identity = (teacher: TeacherFixture): TeacherIdentity => ({
  accountId: teacher.accountId,
  assignmentIds: [teacher.roleAssignmentId],
});

live(
  'Phase 23 Learning classes against real SQL Server, as the runtime principal',
  () => {
    let db: DisposableDatabase;
    let app: SqlSession;

    let catalogue: LearningPersistencePort;
    let learner: LearnerPort;
    let exporter: LearningExportPort;
    let disposition: LearningDispositionPort;
    let activation: LearningActivationPort;
    let teaching: TeachingPort;
    let admin: ClassAdminPort;
    let classes: ClassLearnerPort;
    let reader: ClassPublicReaderPort;
    let mail: ClassCommunicationPort;

    let actor: string;
    let topicId: string;
    let personId: string;

    beforeAll(async () => {
      const runtimeSource = getDatabaseRuntimeUrl();
      db = await createProofDatabase();
      const runtimeTarget = parseSqlServerUrl(runtimeSource);
      const runtimeUrl = runtimeSource.replace(
        `database=${runtimeTarget.database}`,
        `database=${db.name}`,
      );
      if (runtimeUrl === runtimeSource)
        throw new Error(
          'The runtime URL could not be repointed at the disposable database.',
        );
      const connection = assertApprovedLocalTarget(
        runtimeUrl,
        localTargetPolicy(process.env, 'disposable', 'runtime'),
      );

      const principal = getApplicationPrincipalCredentials();
      await provisionApplicationPrincipal(
        db.admin,
        principal.DATABASE_APP_LOGIN,
        principal.DATABASE_APP_PASSWORD,
      );
      app = await openSession(connection);
      process.env['DATABASE_URL'] = runtimeUrl;

      const database = await import('../../packages/database/src/index.ts');
      catalogue = database.createLearningPersistence();
      learner = database.createLearner();
      exporter = database.createLearningExport();
      disposition = database.createLearningDisposition();
      activation = database.createLearningActivation();
      teaching = database.createTeaching();
      admin = database.createClassAdmin();
      classes = database.createClassLearner();
      reader = database.createClassPublicReader();
      mail = database.createClassCommunication();

      actor = await account(db.admin);
      topicId = await topic(db.admin);
      personId = await person(db.admin);
    }, 300_000);

    afterAll(async () => {
      await app?.close();
      await db?.close();
    });

    /* ---- fixtures through the adapters ------------------------------------ */

    async function course(
      options: {
        readonly format?: 'self-paced' | 'live';
        readonly publish?: boolean;
      } = {},
    ): Promise<CourseDetail> {
      const slug = freshSlug();
      let detail = await catalogue.saveCourse({
        actorId: actor,
        id: null,
        expectedVersion: null,
        value: courseInputSchema.parse({
          slug,
          primaryLocale: 'en',
          level: 'beginner',
          format: options.format ?? 'live',
          languageCode: 'en',
          labels: [
            {
              locale: 'en',
              title: sentinel('COURSE_TITLE', slug),
              summary: sentinel('COURSE_SUMMARY', slug),
              description: sentinel('COURSE_DESCRIPTION', slug),
            },
          ],
          topicIds: [topicId],
          teacherIds: [personId],
        }),
      });
      detail = await catalogue.changeModule({
        actorId: actor,
        courseId: detail.id,
        expectedVersion: detail.version,
        change: {
          op: 'add',
          labels: [{ locale: 'en', title: sentinel('MODULE', slug), summary: '' }],
        },
      });
      detail = await catalogue.changeLesson({
        actorId: actor,
        courseId: detail.id,
        expectedVersion: detail.version,
        change: {
          op: 'add',
          moduleId: detail.outline[0]?.id ?? '',
          labels: [
            {
              locale: 'en',
              title: sentinel('LESSON', slug),
              summary: '',
              body: sentinel('LESSON_BODY', slug),
            },
          ],
        },
      });
      if (options.publish === false) return detail;
      return catalogue.transitionCourse({
        actorId: actor,
        id: detail.id,
        expectedVersion: detail.version,
        state: 'published',
      });
    }

    /** A teacher scoped to a Course through the operator surface. */
    async function scoped(courseId: string, teacher?: TeacherFixture) {
      const who = teacher ?? (await teacherAccount(db.admin));
      const view = await admin.grantScope({
        actorId: actor,
        courseId,
        accountId: who.accountId,
        roleAssignmentId: who.roleAssignmentId,
      });
      return { teacher: who, scopeId: view.scope.id, scope: view.scope };
    }

    const createSession = (
      scopeId: string,
      teacher: TeacherFixture,
      plan: ResolvedSchedule,
      meeting: { provider: 'google-meet'; url: string } | null = {
        provider: 'google-meet',
        url: MEET,
      },
    ) =>
      admin.createSession({
        actorId: actor,
        scopeId,
        teacherAssignmentIds: [teacher.roleAssignmentId],
        schedule: plan,
        meeting,
      });

    /** A learner's confirmed trial: request, window, confirmation. */
    async function trial(
      courseId: string,
      teacher: TeacherFixture,
      hours: number,
      lead: number | null = null,
    ) {
      const alice = await account(db.admin);
      expect(await learner.requestTrial(alice, courseId)).toBe(true);
      const [request] = await db.admin.query<{ id: string }>(
        `SELECT [id] FROM [dbo].[TrialClassRequest] WHERE [userId] = ${n(alice)} AND [courseId] = ${n(courseId)};`,
      );
      const opened = await teaching.openAvailability({
        teacher: identity(teacher),
        window: window(hours),
      });
      const confirmed = await admin.confirmTrial({
        actorId: actor,
        requestId: request?.id ?? '',
        availabilityId: opened.id,
        teacherAssignmentIds: [teacher.roleAssignmentId],
        reminderLeadMinutes: lead,
      });
      return { alice, requestId: request?.id ?? '', window: opened, ...confirmed };
    }

    /* ======================================================================
     * Activation — fail closed
     * ==================================================================== */

    describe('nothing is offered, scheduled or confirmed until the owner activates', () => {
      it('refuses every write, discloses nothing publicly, then activates once and for ever', async () => {
        expect(await activation.activeMode()).toBeNull();
        const live = await course();
        const { teacher, scopeId } = await scoped(live.id);

        expect(
          await reasonOf(
            teaching.openAvailability({ teacher: identity(teacher), window: window(24) }),
          ),
        ).toBe('not-activated');
        expect(await reasonOf(createSession(scopeId, teacher, schedule(24)))).toBe(
          'not-activated',
        );
        expect(
          await reasonOf(
            admin.confirmTrial({
              actorId: actor,
              requestId: '00000000-0000-4000-8000-000000000000',
              availabilityId: '00000000-0000-4000-8000-000000000000',
              teacherAssignmentIds: [teacher.roleAssignmentId],
              reminderLeadMinutes: null,
            }),
          ),
        ).toBe('not-activated');
        expect((await reader.upcomingSessions(new Date(), 0)).items).toEqual([]);
        expect(await reader.operationalTeachers(new Date())).toEqual([]);
        expect(await teaching.availability(identity(teacher), 0)).toEqual({
          items: [],
          hasMore: false,
        });

        // THE FLOOR: an insert that skips the adapter meets the same gate.
        expect(
          await sqlNumber(
            db.admin.query(`
            INSERT INTO [dbo].[Availability] ([id],[userId],[startsAt],[endsAt],[timeZone],[startsLocal],[endsLocal],[state])
            VALUES (NEWID(), ${n(teacher.accountId)}, DATEADD(day, 1, SYSUTCDATETIME()), DATEADD(day, 1, DATEADD(hour, 1, SYSUTCDATETIME())),
                    N'UTC', N'2026-01-01T00:00', N'2026-01-01T01:00', N'open');`),
          ),
        ).toBe(51281);

        await activateLive(db.admin, 'fixture');
        expect(await activation.activeMode()).toBe('fixture');
        expect(
          await sqlNumber(
            db.admin.query(
              `UPDATE [dbo].[LiveLearningActivation] SET [authority] = N'approved', [reference] = N'x' WHERE [id] = 1;`,
            ),
          ),
        ).toBe(51280);
        expect(
          await sqlNumber(db.admin.query(`DELETE FROM [dbo].[LiveLearningActivation];`)),
        ).toBe(51280);
        expect(await activation.activeMode()).toBe('fixture');
      });
    });

    /* ======================================================================
     * Scopes — typed, live, one per pair
     * ==================================================================== */

    describe('a teaching scope is typed and live when made', () => {
      it('refuses a self-paced Course, a stranger’s or revoked assignment, and a second current scope', async () => {
        const paced = await course({ format: 'self-paced' });
        const live = await course();
        const teacher = await teacherAccount(db.admin);
        const other = await teacherAccount(db.admin);

        expect(
          await reasonOf(
            admin.grantScope({
              actorId: actor,
              courseId: paced.id,
              accountId: teacher.accountId,
              roleAssignmentId: teacher.roleAssignmentId,
            }),
          ),
        ).toBe('course-unavailable');
        // Another account's assignment: the trigger (51282) is the floor.
        expect(
          await reasonOf(
            admin.grantScope({
              actorId: actor,
              courseId: live.id,
              accountId: teacher.accountId,
              roleAssignmentId: other.roleAssignmentId,
            }),
          ),
        ).toBe('not-a-teacher');
        expect(
          await sqlNumber(
            rawScope(db.admin, live.id, {
              ...teacher,
              roleAssignmentId: other.roleAssignmentId,
            }),
          ),
        ).toBe(51282);

        const revoked = await teacherAccount(db.admin);
        await revokeAssignment(db.admin, revoked.roleAssignmentId);
        expect(
          await reasonOf(
            admin.grantScope({
              actorId: actor,
              courseId: live.id,
              accountId: revoked.accountId,
              roleAssignmentId: revoked.roleAssignmentId,
            }),
          ),
        ).toBe('not-a-teacher');
        expect(await sqlNumber(rawScope(db.admin, live.id, revoked))).toBe(51282);
        // A key without `teaching.perform` is not a teaching assignment.
        const reader = await teacherAccount(db.admin, ['learning.read']);
        expect(await sqlNumber(rawScope(db.admin, live.id, reader))).toBe(51282);

        const granted = await scoped(live.id, teacher);
        expect(granted.scope).toMatchObject({
          courseId: live.id,
          accountId: teacher.accountId,
          roleAssignmentId: teacher.roleAssignmentId,
          endedAt: null,
          version: 1,
        });
        expect(await reasonOf(scoped(live.id, teacher))).toBe('conflict');
        expect(
          await count(
            db.admin,
            'CourseTeachingAssignment',
            `[userId] = ${n(teacher.accountId)} AND [courseId] = ${n(live.id)}`,
          ),
        ).toBe(1);
        expect((await admin.scope(granted.scopeId))?.course.id).toBe(live.id);
        expect(
          (
            await admin.scopes({
              courseId: live.id,
              accountId: null,
              current: true,
              offset: 0,
            })
          ).items.map((item) => item.scope.id),
        ).toEqual([granted.scopeId]);

        // Ended at its version; a stale version conflicts; ending twice is the first.
        expect(
          await reasonOf(
            admin.endScope({
              actorId: actor,
              scopeId: granted.scopeId,
              expectedVersion: 9,
            }),
          ),
        ).toBe('conflict');
        const ended = await admin.endScope({
          actorId: actor,
          scopeId: granted.scopeId,
          expectedVersion: 1,
        });
        expect(ended.scope.endedAt).not.toBeNull();
        expect(
          (
            await admin.endScope({
              actorId: actor,
              scopeId: granted.scopeId,
              expectedVersion: 2,
            })
          ).scope.version,
        ).toBe(2);
        // And the same pair may be scoped again — the key is on CURRENT scopes.
        const again = await scoped(live.id, teacher);
        expect(again.scope.endedAt).toBeNull();
        // The list filters exactly: current only, ended only, or every scope.
        const listed = async (current: boolean | null) =>
          (
            await admin.scopes({
              courseId: live.id,
              accountId: teacher.accountId,
              current,
              offset: 0,
            })
          ).items.map((item) => item.scope.id);
        expect(await listed(true)).toEqual([again.scope.id]);
        expect(await listed(false)).toEqual([granted.scopeId]);
        expect((await listed(null)).sort()).toEqual(
          [again.scope.id, granted.scopeId].sort(),
        );
        // A scope may be made on a live-format Course that is not archived;
        // the class keys list exactly those, never a self-paced one.
        const choices = (await admin.liveCourses(0)).items;
        expect(
          choices.every(
            (course) => course.format === 'live' && course.state !== 'archived',
          ),
        ).toBe(true);
        expect(choices.some((course) => course.id === live.id)).toBe(true);
        expect(choices.some((course) => course.id === paced.id)).toBe(false);
        expect(
          (
            await db.admin.query<{ action: string }>(
              `SELECT [action] FROM [dbo].[AuditLog] WHERE [targetId] = ${n(granted.scopeId)} ORDER BY [occurredAt];`,
            )
          ).map((row) => row.action),
        ).toEqual(['learning.scope.granted', 'learning.scope.ended']);
      });
    });

    /* ======================================================================
     * The teaching surface — every query carries the whole authority
     * ==================================================================== */

    describe('a teacher reaches only what is scoped to them under a live assignment', () => {
      it('answers nothing to a profile alone, a key without a scope, or a revoked assignment', async () => {
        const live = await course();
        const { teacher, scopeId } = await scoped(live.id);
        const session = await createSession(scopeId, teacher, schedule(30));
        const alice = await account(db.admin);
        await learner.enrol(alice, live.id);

        const nobody: TeacherIdentity = {
          accountId: teacher.accountId,
          assignmentIds: [],
        };
        const unscoped = identity(await teacherAccount(db.admin));
        const wrongAssignment: TeacherIdentity = {
          accountId: teacher.accountId,
          assignmentIds: ['00000000-0000-4000-8000-000000000000'],
        };
        for (const who of [nobody, unscoped, wrongAssignment]) {
          expect(await teaching.courses(who)).toEqual([]);
          expect(await teaching.course(who, live.id)).toBeNull();
          expect(
            await teaching.lesson(who, live.id, live.outline[0]?.lessons[0]?.id ?? ''),
          ).toBeNull();
          expect((await teaching.students(who, null, 0)).items).toEqual([]);
          expect(await teaching.student(who, alice)).toBeNull();
          expect(
            (await teaching.sessions(who, { from: at(-1), to: at(100) }, 0)).items,
          ).toEqual([]);
          expect(await teaching.session(who, session.session.id)).toBeNull();
          expect(await teaching.participants(who, session.session.id)).toEqual([]);
          expect(await teaching.meetingUrl(who, session.session.id)).toBeNull();
          expect((await teaching.attendanceReport(who, 0)).items).toEqual([]);
          expect(
            await reasonOf(
              teaching.setMeeting({
                teacher: who,
                sessionId: session.session.id,
                expectedVersion: session.session.version,
                meeting: null,
              }),
            ),
          ).toBe('not-found');
          expect(
            await reasonOf(
              teaching.cancel({
                teacher: who,
                sessionId: session.session.id,
                expectedVersion: session.session.version,
              }),
            ),
          ).toBe('not-found');
          expect(
            await reasonOf(
              teaching.markAttendance({
                teacher: who,
                sessionId: session.session.id,
                accountId: alice,
                status: 'present',
              }),
            ).then((reason) => (reason === 'not-found' ? 'not-found' : reason)),
          ).toBe('not-found');
        }

        const me = identity(teacher);
        expect((await teaching.courses(me)).map((entry) => entry.course.id)).toEqual([
          live.id,
        ]);
        expect((await teaching.course(me, live.id))?.id).toBe(live.id);
        expect(
          (await teaching.lesson(me, live.id, live.outline[0]?.lessons[0]?.id ?? ''))
            ?.labels[0]?.body,
        ).toBe(sentinel('LESSON_BODY', live.slug));
        expect(
          (await teaching.students(me, null, 0)).items.map((s) => s.accountId),
        ).toEqual([alice]);
        expect((await teaching.students(me, live.id, 0)).items).toHaveLength(1);
        expect(
          (await teaching.student(me, alice))?.classes.map((c) => c.participation),
        ).toEqual(['enrolment']);
        expect(
          (await teaching.session(me, session.session.id))?.session.hasMeetingUrl,
        ).toBe(true);
        expect(await teaching.meetingUrl(me, session.session.id)).toBe(MEET);
        expect(await teaching.participants(me, session.session.id)).toEqual([
          { accountId: alice, participation: 'enrolment', attendance: null },
        ]);
        // Nothing a teacher lists carries the address.
        expect(
          JSON.stringify(await teaching.sessions(me, { from: at(-1), to: at(100) }, 0)),
        ).not.toContain('meet.google.com');

        // Revoked between two requests: Identity stops reporting the assignment,
        // and the very next query answers nothing — the scope row is untouched.
        await revokeAssignment(db.admin, teacher.roleAssignmentId);
        expect(await teaching.courses({ ...me, assignmentIds: [] })).toEqual([]);
        expect(
          await count(
            db.admin,
            'CourseTeachingAssignment',
            `[id] = ${n(scopeId)} AND [endedAt] IS NULL`,
          ),
        ).toBe(1);
      });

      it('never shows teacher A what is teacher B’s', async () => {
        const courseA = await course();
        const courseB = await course();
        const a = await scoped(courseA.id);
        const b = await scoped(courseB.id);
        const bob = await account(db.admin);
        await learner.enrol(bob, courseB.id);
        const sessionB = await createSession(b.scopeId, b.teacher, schedule(40));
        const windowB = await teaching.openAvailability({
          teacher: identity(b.teacher),
          window: window(45),
        });

        const me = identity(a.teacher);
        expect(await teaching.course(me, courseB.id)).toBeNull();
        expect((await teaching.students(me, null, 0)).items).toEqual([]);
        expect((await teaching.students(me, courseB.id, 0)).items).toEqual([]);
        expect(await teaching.student(me, bob)).toBeNull();
        expect(await teaching.session(me, sessionB.session.id)).toBeNull();
        expect(await teaching.meetingUrl(me, sessionB.session.id)).toBeNull();
        expect((await teaching.availability(me, 0)).items).toEqual([]);
        expect(
          await reasonOf(
            teaching.withdrawAvailability({
              teacher: me,
              availabilityId: windowB.id,
              expectedVersion: windowB.version,
            }),
          ),
        ).toBe('not-found');
        expect(
          await reasonOf(
            teaching.reschedule({
              teacher: me,
              sessionId: sessionB.session.id,
              expectedVersion: sessionB.session.version,
              schedule: schedule(50),
            }),
          ),
        ).toBe('not-found');
        expect(
          (await teaching.availability(identity(b.teacher), 0)).items.map((w) => w.id),
        ).toEqual([windowB.id]);
      });
    });

    /* ======================================================================
     * Windows
     * ==================================================================== */

    describe('a teacher’s open windows never overlap and a booked one stays', () => {
      it('refuses an overlapping window, serialises two concurrent ones, and keeps a booked one', async () => {
        const live = await course();
        const { teacher } = await scoped(live.id);
        const me = identity(teacher);

        const first = await teaching.openAvailability({
          teacher: me,
          window: window(60),
        });
        expect(first).toMatchObject({
          accountId: teacher.accountId,
          state: 'open',
          booked: false,
        });
        expect(
          await reasonOf(
            teaching.openAvailability({ teacher: me, window: window(60.5) }),
          ),
        ).toBe('overlap');
        const outcomes = await Promise.all([
          reasonOf(teaching.openAvailability({ teacher: me, window: window(70) })),
          reasonOf(teaching.openAvailability({ teacher: me, window: window(70.25) })),
        ]);
        expect(outcomes.sort()).toEqual(['accepted', 'overlap']);
        expect(
          await count(
            db.admin,
            'Availability',
            `[userId] = ${n(teacher.accountId)} AND [state] = N'open'`,
          ),
        ).toBe(2);
        // THE FLOOR beneath the adapter's question.
        expect(
          await sqlNumber(
            db.admin.query(`
            INSERT INTO [dbo].[Availability] ([id],[userId],[startsAt],[endsAt],[timeZone],[startsLocal],[endsLocal],[state])
            VALUES (NEWID(), ${n(teacher.accountId)}, '${first.startsAt.toISOString()}', '${first.endsAt.toISOString()}',
                    N'UTC', N'2026-01-01T00:00', N'2026-01-01T01:00', N'open');`),
          ),
        ).toBe(51283);
        // And nobody without live `teaching.perform` offers one.
        expect(
          await sqlNumber(
            db.admin.query(`
            INSERT INTO [dbo].[Availability] ([id],[userId],[startsAt],[endsAt],[timeZone],[startsLocal],[endsLocal],[state])
            VALUES (NEWID(), ${n(actor)}, DATEADD(day, 9, SYSUTCDATETIME()), DATEADD(day, 9, DATEADD(hour, 1, SYSUTCDATETIME())),
                    N'UTC', N'2026-01-01T00:00', N'2026-01-01T01:00', N'open');`),
          ),
        ).toBe(51284);

        // A withdrawn window is listed after the open ones and may be overlapped.
        expect(
          await reasonOf(
            teaching.withdrawAvailability({
              teacher: me,
              availabilityId: first.id,
              expectedVersion: 7,
            }),
          ),
        ).toBe('conflict');
        const withdrawn = await teaching.withdrawAvailability({
          teacher: me,
          availabilityId: first.id,
          expectedVersion: first.version,
        });
        expect(withdrawn.state).toBe('withdrawn');
        expect(
          (
            await teaching.withdrawAvailability({
              teacher: me,
              availabilityId: first.id,
              expectedVersion: 1,
            })
          ).version,
        ).toBe(withdrawn.version);
        expect(
          (await teaching.openAvailability({ teacher: me, window: window(60.5) })).state,
        ).toBe('open');
        const listed = await teaching.availability(me, 0);
        expect(listed.items.map((w) => w.state)).toEqual(['open', 'open', 'withdrawn']);

        // A booked window cannot be withdrawn: the trial is cancelled through its Booking.
        const booked = await trial(live.id, teacher, 80);
        expect(
          await reasonOf(
            teaching.withdrawAvailability({
              teacher: me,
              availabilityId: booked.window.id,
              expectedVersion: booked.window.version,
            }),
          ),
        ).toBe('window-unavailable');
        expect(
          (await teaching.availability(me, 0)).items.find(
            (w) => w.id === booked.window.id,
          )?.booked,
        ).toBe(true);
      });
    });

    /* ======================================================================
     * Confirmation — one request, one window, one Booking
     * ==================================================================== */

    describe('confirming a trial is conflict-safe and typed', () => {
      it('confirms one request into one Booking, one trial session and the window’s claim, with its mail', async () => {
        const live = await course();
        const { teacher, scopeId } = await scoped(live.id);
        const confirmed = await trial(live.id, teacher, 90, 60);

        expect(confirmed.booking).toMatchObject({
          accountId: confirmed.alice,
          courseId: live.id,
          requestId: confirmed.requestId,
          availabilityId: confirmed.window.id,
          state: 'confirmed',
          version: 1,
        });
        expect(confirmed.session.session).toMatchObject({
          kind: 'trial',
          state: 'scheduled',
          teachingScopeId: scopeId,
          teacherAccountId: teacher.accountId,
          startsAt: confirmed.window.startsAt,
          endsAt: confirmed.window.endsAt,
          hasMeetingUrl: false,
        });
        expect(confirmed.session.session.reminderAt?.getTime()).toBe(
          confirmed.window.startsAt.getTime() - HOUR,
        );
        // No Enrolment follows a Booking: the two lifecycles are distinct.
        expect(
          await count(db.admin, 'Enrolment', `[userId] = ${n(confirmed.alice)}`),
        ).toBe(0);
        const owed = await intentsFor(db.admin, confirmed.session.session.id);
        expect(owed.map((row) => [row.purpose, row.state])).toEqual([
          ['learning.booking-confirmed', 'pending'],
          ['learning.booking-confirmed', 'pending'],
          ['learning.class-reminder', 'pending'],
          ['learning.class-reminder', 'pending'],
        ]);
        expect(new Set(owed.map((row) => row.userId))).toEqual(
          new Set([confirmed.alice, teacher.accountId]),
        );
        expect(
          (await admin.trialRequests(live.id, 0)).items.map((r) => [
            r.accountId,
            r.booking?.id,
          ]),
        ).toEqual([[confirmed.alice, confirmed.booking.id]]);

        // The learner's own trial list now says the request was confirmed and
        // names the class — and no other account's list does.
        const [ownRequest] = await learner.trials(confirmed.alice);
        expect(ownRequest?.booking).toEqual({
          id: confirmed.booking.id,
          sessionId: confirmed.booking.sessionId,
          state: 'confirmed',
        });

        // The request is now withdrawn through the Booking, never by deletion.
        expect(await reasonOf(learner.withdrawTrial(confirmed.alice, live.id))).toBe(
          'booked',
        );
        expect(
          await count(db.admin, 'TrialClassRequest', `[id] = ${n(confirmed.requestId)}`),
        ).toBe(1);
        // A second confirmation of the same request, on another window, is refused.
        const spare = await teaching.openAvailability({
          teacher: identity(teacher),
          window: window(95),
        });
        expect(
          await reasonOf(
            admin.confirmTrial({
              actorId: actor,
              requestId: confirmed.requestId,
              availabilityId: spare.id,
              teacherAssignmentIds: [teacher.roleAssignmentId],
              reminderLeadMinutes: null,
            }),
          ),
        ).toBe('booked');
        expect(
          (
            await db.admin.query<{ action: string }>(
              `SELECT [action] FROM [dbo].[AuditLog] WHERE [targetId] = ${n(confirmed.booking.id)};`,
            )
          ).map((row) => row.action),
        ).toEqual(['learning.booking.confirmed']);
      });

      it('lets exactly one of two concurrent confirmations of one request, and of one window, succeed', async () => {
        const live = await course();
        const { teacher } = await scoped(live.id);
        const me = identity(teacher);
        const alice = await account(db.admin);
        const bob = await account(db.admin);
        await learner.requestTrial(alice, live.id);
        await learner.requestTrial(bob, live.id);
        const requests = Object.fromEntries(
          (
            await db.admin.query<{ id: string; userId: string }>(
              `SELECT [id], [userId] FROM [dbo].[TrialClassRequest] WHERE [courseId] = ${n(live.id)};`,
            )
          ).map((row) => [row.userId, row.id]),
        );
        const one = await teaching.openAvailability({ teacher: me, window: window(100) });
        const two = await teaching.openAvailability({ teacher: me, window: window(102) });
        const confirm = (requestId: string, availabilityId: string) =>
          reasonOf(
            admin.confirmTrial({
              actorId: actor,
              requestId,
              availabilityId,
              teacherAssignmentIds: [teacher.roleAssignmentId],
              reminderLeadMinutes: null,
            }),
          );

        // The same request on two windows at once.
        const sameRequest = await Promise.all([
          confirm(requests[alice] ?? '', one.id),
          confirm(requests[alice] ?? '', two.id),
        ]);
        expect(sameRequest.sort()).toEqual(['accepted', 'booked']);
        expect(
          await count(db.admin, 'Booking', `[requestId] = ${n(requests[alice] ?? '')}`),
        ).toBe(1);

        // Two requests on the one remaining window at once.
        const [free] = await db.admin.query<{ id: string }>(
          `SELECT a.[id] FROM [dbo].[Availability] a WHERE a.[id] IN (${n(one.id)}, ${n(two.id)})
           AND NOT EXISTS (SELECT 1 FROM [dbo].[Booking] b WHERE b.[availabilityId] = a.[id]);`,
        );
        const carol = await account(db.admin);
        await learner.requestTrial(carol, live.id);
        const [carolRequest] = await db.admin.query<{ id: string }>(
          `SELECT [id] FROM [dbo].[TrialClassRequest] WHERE [userId] = ${n(carol)};`,
        );
        const sameWindow = await Promise.all([
          confirm(requests[bob] ?? '', free?.id ?? ''),
          confirm(carolRequest?.id ?? '', free?.id ?? ''),
        ]);
        expect(sameWindow.sort()).toEqual(['accepted', 'window-unavailable']);
        expect(
          await count(
            db.admin,
            'Booking',
            `[availabilityId] = ${n(free?.id ?? '')} AND [state] <> N'cancelled'`,
          ),
        ).toBe(1);
        expect(await count(db.admin, 'ClassSession', `[courseId] = ${n(live.id)}`)).toBe(
          2,
        );
      });

      it('refuses a withdrawn, past or unscoped window, a revoked teacher, a draft Course and a window of another teacher', async () => {
        const live = await course();
        const { teacher } = await scoped(live.id);
        const me = identity(teacher);
        const alice = await account(db.admin);
        await learner.requestTrial(alice, live.id);
        const [request] = await db.admin.query<{ id: string }>(
          `SELECT [id] FROM [dbo].[TrialClassRequest] WHERE [userId] = ${n(alice)};`,
        );
        const requestId = request?.id ?? '';
        const confirm = (
          availabilityId: string,
          assignments = [teacher.roleAssignmentId],
        ) =>
          reasonOf(
            admin.confirmTrial({
              actorId: actor,
              requestId,
              availabilityId,
              teacherAssignmentIds: assignments,
              reminderLeadMinutes: null,
            }),
          );

        const withdrawn = await teaching.openAvailability({
          teacher: me,
          window: window(110),
        });
        await teaching.withdrawAvailability({
          teacher: me,
          availabilityId: withdrawn.id,
          expectedVersion: 1,
        });
        expect(await confirm(withdrawn.id)).toBe('window-unavailable');
        expect(await confirm(await pastWindow(db.admin, teacher.accountId))).toBe('past');

        // A window of a teacher NOT scoped to the request's Course.
        const stranger = await scoped((await course()).id);
        const foreign = await teaching.openAvailability({
          teacher: identity(stranger.teacher),
          window: window(112),
        });
        expect(await confirm(foreign.id, [stranger.teacher.roleAssignmentId])).toBe(
          'not-a-teacher',
        );

        // Identity stopped reporting the assignment between the read and the confirm.
        const open = await teaching.openAvailability({
          teacher: me,
          window: window(114),
        });
        expect(await confirm(open.id, [])).toBe('not-a-teacher');
        expect(await confirm(open.id, ['00000000-0000-4000-8000-000000000000'])).toBe(
          'not-a-teacher',
        );
        expect(await confirm('00000000-0000-4000-8000-000000000000')).toBe('not-found');
        expect(await count(db.admin, 'Booking', `[requestId] = ${n(requestId)}`)).toBe(0);

        // THE FLOOR: a Booking that does not fit its window is refused by the trigger.
        const session = await createSession(
          stranger.scopeId,
          stranger.teacher,
          schedule(116),
        );
        expect(
          await sqlNumber(
            db.admin.query(`
            INSERT INTO [dbo].[Booking] ([id],[requestId],[userId],[courseId],[sessionId],[availabilityId],[state],[confirmedAt])
            VALUES (NEWID(), ${n(requestId)}, ${n(alice)}, ${n(live.id)}, ${n(session.session.id)}, ${n(open.id)}, N'confirmed', SYSUTCDATETIME());`),
          ),
        ).toBe(51288);

        // Available windows for the Course are those of its CURRENT teachers only.
        expect(
          (await admin.availableWindows(live.id, new Date(), 0)).items.map((w) => w.id),
        ).toEqual([open.id]);
        expect(await admin.availabilityOwner(open.id)).toBe(teacher.accountId);
        expect(
          await admin.availabilityOwner('00000000-0000-4000-8000-000000000000'),
        ).toBeNull();
      });
    });

    /* ======================================================================
     * Sessions
     * ==================================================================== */

    describe('a session is scheduled on a published live Course under a current scope and never overlaps', () => {
      it('refuses a draft Course, an overlap (sequentially and concurrently) and a stale version', async () => {
        const draft = await course({ publish: false });
        const live = await course();
        const { teacher, scopeId } = await scoped(live.id);
        const draftScope = await scoped(draft.id, teacher);

        expect(
          await reasonOf(createSession(draftScope.scopeId, teacher, schedule(120))),
        ).toBe('course-unavailable');
        expect(
          await reasonOf(
            createSession(scopeId, teacher, schedule(120), {
              provider: 'google-meet',
              url: 'http://meet.google.com/abc-defg-hij',
            }),
          ),
        ).toBe('invalid-meeting');
        expect(
          await reasonOf(
            admin.createSession({
              actorId: actor,
              scopeId,
              teacherAssignmentIds: [],
              schedule: schedule(120),
              meeting: null,
            }),
          ),
        ).toBe('not-a-teacher');

        const first = await createSession(scopeId, teacher, schedule(120));
        expect(first.session).toMatchObject({
          kind: 'course',
          state: 'scheduled',
          version: 1,
        });
        expect(await reasonOf(createSession(scopeId, teacher, schedule(120.5)))).toBe(
          'overlap',
        );
        const outcomes = await Promise.all([
          reasonOf(createSession(scopeId, teacher, schedule(130))),
          reasonOf(createSession(scopeId, teacher, schedule(130.25))),
        ]);
        expect(outcomes.sort()).toEqual(['accepted', 'overlap']);
        expect(await count(db.admin, 'ClassSession', `[courseId] = ${n(live.id)}`)).toBe(
          2,
        );
        // THE FLOOR beneath the overlap question, and beneath the draft-Course one.
        expect(
          await sqlNumber(
            db.admin.query(`
            INSERT INTO [dbo].[ClassSession] ([id],[courseId],[kind],[scopeId],[startsAt],[endsAt],[timeZone],[startsLocal],[endsLocal],[state])
            VALUES (NEWID(), ${n(live.id)}, N'course', ${n(scopeId)}, '${first.session.startsAt.toISOString()}', '${first.session.endsAt.toISOString()}', N'UTC', N'2026-01-01T00:00', N'2026-01-01T01:00', N'scheduled');`),
          ),
        ).toBe(51287);
        expect(
          await sqlNumber(
            db.admin.query(`
            INSERT INTO [dbo].[ClassSession] ([id],[courseId],[kind],[scopeId],[startsAt],[endsAt],[timeZone],[startsLocal],[endsLocal],[state])
            VALUES (NEWID(), ${n(draft.id)}, N'course', ${n(draftScope.scopeId)}, DATEADD(day, 20, SYSUTCDATETIME()), DATEADD(day, 20, DATEADD(hour, 1, SYSUTCDATETIME())), N'UTC', N'2026-01-01T00:00', N'2026-01-01T01:00', N'scheduled');`),
          ),
        ).toBe(51285);

        const me = identity(teacher);
        expect(
          await reasonOf(
            teaching.reschedule({
              teacher: me,
              sessionId: first.session.id,
              expectedVersion: 5,
              schedule: schedule(140),
            }),
          ),
        ).toBe('conflict');
        expect(
          await reasonOf(
            admin.cancel({
              actorId: actor,
              sessionId: first.session.id,
              expectedVersion: 5,
            }),
          ),
        ).toBe('conflict');
        expect(
          await reasonOf(
            teaching.setMeeting({
              teacher: me,
              sessionId: first.session.id,
              expectedVersion: 5,
              meeting: null,
            }),
          ),
        ).toBe('conflict');
        expect(
          (
            await admin.sessions({
              offset: 0,
              state: 'scheduled',
              kind: 'course',
              courseId: live.id,
            })
          ).items,
        ).toHaveLength(2);
        // A published Course with a scheduled future class cannot leave publication.
        const current = await catalogue.course(live.id);
        expect(
          await reasonOf(
            catalogue.transitionCourse({
              actorId: actor,
              id: live.id,
              expectedVersion: current?.version ?? 0,
              state: 'draft',
            }),
          ),
        ).toBe('has-classes');
      });

      it('closes once, idempotently, clearing the address; a closed session never moves', async () => {
        const live = await course();
        const { teacher, scopeId } = await scoped(live.id);
        const me = identity(teacher);
        const alice = await account(db.admin);
        await learner.enrol(alice, live.id);
        const session = await createSession(scopeId, teacher, schedule(150, 60));
        expect(
          (await intentsFor(db.admin, session.session.id)).map((r) => r.purpose),
        ).toEqual(['learning.class-reminder', 'learning.class-reminder']);
        expect((await sessionColumns(db.admin, session.session.id))?.meetingUrl).toBe(
          MEET,
        );

        const cancelled = await teaching.cancel({
          teacher: me,
          sessionId: session.session.id,
          expectedVersion: 1,
        });
        expect(cancelled.session).toMatchObject({
          state: 'cancelled',
          version: 2,
          hasMeetingUrl: false,
          meetingProvider: null,
          reminderAt: null,
        });
        expect(cancelled.session.closedAt).not.toBeNull();
        expect(
          (await sessionColumns(db.admin, session.session.id))?.meetingUrl,
        ).toBeNull();
        expect(await teaching.meetingUrl(me, session.session.id)).toBeNull();
        expect(await admin.meetingUrl(session.session.id)).toBeNull();
        const owed = await intentsFor(db.admin, session.session.id);
        expect(
          owed.filter((r) => r.purpose === 'learning.class-reminder').map((r) => r.state),
        ).toEqual(['abandoned', 'abandoned']);
        expect(
          new Set(
            owed
              .filter((r) => r.purpose === 'learning.session-cancelled')
              .map((r) => r.userId),
          ),
        ).toEqual(new Set([alice, teacher.accountId]));

        // Again: the same answer, nothing changed; the other terminal state: refused.
        expect(
          (
            await teaching.cancel({
              teacher: me,
              sessionId: session.session.id,
              expectedVersion: 2,
            })
          ).session.version,
        ).toBe(2);
        expect(
          (
            await admin.cancel({
              actorId: actor,
              sessionId: session.session.id,
              expectedVersion: 1,
            })
          ).session.version,
        ).toBe(2);
        expect(
          await reasonOf(
            teaching.complete({
              teacher: me,
              sessionId: session.session.id,
              expectedVersion: 2,
            }),
          ),
        ).toBe('terminal');
        expect(
          await reasonOf(
            teaching.reschedule({
              teacher: me,
              sessionId: session.session.id,
              expectedVersion: 2,
              schedule: schedule(160),
            }),
          ),
        ).toBe('terminal');
        expect(
          await reasonOf(
            teaching.setMeeting({
              teacher: me,
              sessionId: session.session.id,
              expectedVersion: 2,
              meeting: { provider: 'google-meet', url: MEET },
            }),
          ),
        ).toBe('terminal');
        // THE FLOOR: a terminal session never changes, by trigger and by CHECK.
        expect(
          await sqlNumber(
            db.admin.query(
              `UPDATE [dbo].[ClassSession] SET [state] = N'scheduled', [closedAt] = NULL WHERE [id] = ${n(session.session.id)};`,
            ),
          ),
        ).toBe(51286);
        expect(
          await sqlNumber(
            db.admin.query(
              `UPDATE [dbo].[ClassSession] SET [meetingProvider] = N'google-meet', [meetingUrl] = ${n(MEET)} WHERE [id] = ${n(session.session.id)};`,
            ),
          ),
          // The CHECK speaks first: a terminal session holds no address.
        ).toBe(547);

        // Completion of a trial completes its Booking.
        const booked = await trial(live.id, teacher, 170);
        const completed = await admin.complete({
          actorId: actor,
          sessionId: booked.session.session.id,
          expectedVersion: 1,
        });
        expect(completed.session.state).toBe('completed');
        expect(
          await count(
            db.admin,
            'Booking',
            `[id] = ${n(booked.booking.id)} AND [state] = N'completed'`,
          ),
        ).toBe(1);
        // A completed Booking is final.
        expect(
          await sqlNumber(
            db.admin.query(
              `UPDATE [dbo].[Booking] SET [state] = N'confirmed' WHERE [id] = ${n(booked.booking.id)};`,
            ),
          ),
        ).toBe(51288);
      });

      it('reschedules under the version, abandoning the old reminder and owing a new one under the new key', async () => {
        const live = await course();
        const { teacher, scopeId } = await scoped(live.id);
        const me = identity(teacher);
        const alice = await account(db.admin);
        await learner.enrol(alice, live.id);
        const session = await createSession(scopeId, teacher, schedule(180, 60));
        const before = await intentsFor(db.admin, session.session.id);
        expect(before).toHaveLength(2);

        const next = schedule(200, 180);
        const moved = await teaching.reschedule({
          teacher: me,
          sessionId: session.session.id,
          expectedVersion: 1,
          schedule: next,
        });
        expect(moved.session).toMatchObject({
          version: 2,
          startsAt: next.startsAt,
          endsAt: next.endsAt,
          reminderAt: next.reminderAt,
          hasMeetingUrl: true,
        });
        const after = await intentsFor(db.admin, session.session.id);
        const reminders = after.filter((r) => r.purpose === 'learning.class-reminder');
        expect(reminders.filter((r) => r.state === 'abandoned')).toHaveLength(2);
        const fresh = reminders.filter((r) => r.state === 'pending');
        expect(fresh).toHaveLength(2);
        expect(fresh.every((r) => r.dueAt.getTime() === next.reminderAt?.getTime())).toBe(
          true,
        );
        expect(
          after.filter((r) => r.purpose === 'learning.session-rescheduled'),
        ).toHaveLength(2);
        const keys = await db.admin.query<{ idempotencyKey: string }>(
          `SELECT [idempotencyKey] FROM [dbo].[ClassCommunicationIntent] WHERE [sessionId] = ${n(session.session.id)} AND [state] = N'pending' AND [purpose] = N'learning.class-reminder';`,
        );
        expect(keys.every((row) => row.idempotencyKey.endsWith(':2'))).toBe(true);

        // The old reminder is never claimable, even once its instant has passed.
        const claimed = await mail.claimDue(at(400), 100, 60);
        const mine = claimed.filter((intent) => intent.sessionId === session.session.id);
        expect(
          mine
            .filter((intent) => intent.purpose === 'learning.class-reminder')
            .map((i) => i.dueAt.getTime()),
        ).toEqual([next.reminderAt?.getTime(), next.reminderAt?.getTime()]);
        // Besides the new reminders, only the two notices of the move are due.
        expect(mine.map((i) => i.purpose).sort()).toEqual([
          'learning.class-reminder',
          'learning.class-reminder',
          'learning.session-rescheduled',
          'learning.session-rescheduled',
        ]);
        // Moving a session onto its teacher's other class is refused.
        await createSession(scopeId, teacher, schedule(210));
        expect(
          await reasonOf(
            teaching.reschedule({
              teacher: me,
              sessionId: session.session.id,
              expectedVersion: 2,
              schedule: schedule(210.5),
            }),
          ),
        ).toBe('overlap');
      });

      it('replaces the teacher of a future session with another current scope on the same Course', async () => {
        const live = await course();
        const other = await course();
        const a = await scoped(live.id);
        const b = await scoped(live.id);
        const elsewhere = await scoped(other.id);
        const session = await createSession(a.scopeId, a.teacher, schedule(220, 60));
        const replace = (scopeId: string, assignments: string[], expectedVersion = 1) =>
          admin.replaceTeacher({
            actorId: actor,
            sessionId: session.session.id,
            expectedVersion,
            scopeId,
            teacherAssignmentIds: assignments,
          });

        expect(
          await reasonOf(
            replace(elsewhere.scopeId, [elsewhere.teacher.roleAssignmentId]),
          ),
        ).toBe('not-a-teacher');
        expect(await reasonOf(replace(b.scopeId, []))).toBe('not-a-teacher');
        expect(await reasonOf(replace(b.scopeId, [b.teacher.roleAssignmentId], 4))).toBe(
          'conflict',
        );
        // B is busy then.
        const busy = await createSession(b.scopeId, b.teacher, schedule(220.25));
        expect(await reasonOf(replace(b.scopeId, [b.teacher.roleAssignmentId]))).toBe(
          'overlap',
        );
        await admin.cancel({
          actorId: actor,
          sessionId: busy.session.id,
          expectedVersion: 1,
        });

        const moved = await replace(b.scopeId, [b.teacher.roleAssignmentId]);
        expect(moved.session).toMatchObject({
          teachingScopeId: b.scopeId,
          teacherAccountId: b.teacher.accountId,
          version: 2,
        });
        expect((await sessionColumns(db.admin, session.session.id))?.scopeId).toBe(
          b.scopeId,
        );
        expect(
          await teaching.session(identity(a.teacher), session.session.id),
        ).toBeNull();
        expect(
          (await teaching.session(identity(b.teacher), session.session.id))?.session.id,
        ).toBe(session.session.id);
        expect(
          await teaching.meetingUrl(identity(a.teacher), session.session.id),
        ).toBeNull();
        expect(await teaching.meetingUrl(identity(b.teacher), session.session.id)).toBe(
          MEET,
        );
        const owed = await intentsFor(db.admin, session.session.id);
        expect(owed.find((r) => r.userId === a.teacher.accountId)?.state).toBe(
          'abandoned',
        );
        expect(
          owed.find((r) => r.userId === b.teacher.accountId && r.state === 'pending')
            ?.purpose,
        ).toBe('learning.class-reminder');
        expect(
          (
            await db.admin.query<{ afterState: string }>(
              `SELECT [afterState] FROM [dbo].[AuditLog] WHERE [action] = N'learning.session.teacher-replaced' AND [targetId] = ${n(session.session.id)};`,
            )
          )[0]?.afterState,
        ).toContain(`"fromScopeId":"${a.scopeId}"`);

        // An ended scope leaves its session listed but undisclosed: replacement-required.
        await admin.endScope({ actorId: actor, scopeId: b.scopeId, expectedVersion: 1 });
        expect(
          await teaching.session(identity(b.teacher), session.session.id),
        ).toBeNull();
        expect((await admin.session(session.session.id))?.session.teachingScopeId).toBe(
          b.scopeId,
        );
        expect(await reasonOf(replace(b.scopeId, [b.teacher.roleAssignmentId], 2))).toBe(
          'not-a-teacher',
        );
        // THE FLOOR: no write re-assigns a session onto an ENDED scope.
        await admin.endScope({ actorId: actor, scopeId: a.scopeId, expectedVersion: 1 });
        expect(
          await sqlNumber(
            db.admin.query(
              `UPDATE [dbo].[ClassSession] SET [scopeId] = ${n(a.scopeId)}, [version] = [version] + 1 WHERE [id] = ${n(session.session.id)};`,
            ),
          ),
        ).toBe(51285);
      });
    });

    /* ======================================================================
     * Attendance
     * ==================================================================== */

    describe('attendance is marked by the session’s teacher for an eligible participant', () => {
      it('marks, re-marks deterministically, and refuses a stranger, a non-participant and a cancelled session', async () => {
        const live = await course();
        const { teacher, scopeId } = await scoped(live.id);
        const me = identity(teacher);
        const other = identity((await scoped((await course()).id)).teacher);
        const alice = await account(db.admin);
        const bob = await account(db.admin);
        await learner.enrol(alice, live.id);
        // A class that has started: marks are taken as it ends.
        const session = await createSession(scopeId, teacher, schedule(-2));
        const mark = (
          who: TeacherIdentity,
          accountId: string,
          status: 'present' | 'absent',
        ) =>
          teaching.markAttendance({
            teacher: who,
            sessionId: session.session.id,
            accountId,
            status,
          });

        expect(await reasonOf(mark(other, alice, 'present'))).toBe('not-found');
        expect(await reasonOf(mark(me, bob, 'present'))).toBe('not-participant');
        expect(
          await sqlNumber(
            db.admin.query(
              `INSERT INTO [dbo].[Attendance] ([sessionId],[userId],[status],[markedAt]) VALUES (${n(session.session.id)}, ${n(bob)}, N'present', SYSUTCDATETIME());`,
            ),
          ),
        ).toBe(51289);

        expect(await mark(me, alice, 'absent')).toEqual([
          { accountId: alice, participation: 'enrolment', attendance: 'absent' },
        ]);
        expect(await mark(me, alice, 'present')).toEqual([
          { accountId: alice, participation: 'enrolment', attendance: 'present' },
        ]);
        expect(
          await count(db.admin, 'Attendance', `[sessionId] = ${n(session.session.id)}`),
        ).toBe(1);
        expect(
          await admin.correctAttendance({
            actorId: actor,
            sessionId: session.session.id,
            accountId: alice,
            status: 'absent',
          }),
        ).toEqual([
          { accountId: alice, participation: 'enrolment', attendance: 'absent' },
        ]);
        expect(
          await reasonOf(
            admin.correctAttendance({
              actorId: actor,
              sessionId: session.session.id,
              accountId: bob,
              status: 'absent',
            }),
          ),
        ).toBe('not-participant');

        const report = await teaching.attendanceReport(me, 0);
        expect(
          report.items.map((row) => [
            row.session.id,
            row.present,
            row.absent,
            row.unmarked,
          ]),
        ).toEqual([[session.session.id, 0, 1, 0]]);
        await learner.enrol(bob, live.id);
        expect((await teaching.attendanceReport(me, 0)).items[0]?.unmarked).toBe(1);
        expect((await teaching.student(me, alice))?.classes[0]?.attendance).toBe(
          'absent',
        );

        const cancelled = await createSession(scopeId, teacher, schedule(230));
        await teaching.cancel({
          teacher: me,
          sessionId: cancelled.session.id,
          expectedVersion: 1,
        });
        expect(
          await reasonOf(
            teaching.markAttendance({
              teacher: me,
              sessionId: cancelled.session.id,
              accountId: alice,
              status: 'present',
            }),
          ),
        ).toBe('terminal');
        expect(
          await sqlNumber(
            db.admin.query(
              `INSERT INTO [dbo].[Attendance] ([sessionId],[userId],[status],[markedAt]) VALUES (${n(cancelled.session.id)}, ${n(alice)}, N'present', SYSUTCDATETIME());`,
            ),
          ),
        ).toBe(51289);
      });
    });

    /* ======================================================================
     * A learner's own classes
     * ==================================================================== */

    describe('a learner sees and reaches only their own classes', () => {
      it('keys every read and act by the account, and cancels only an own confirmed future Booking', async () => {
        const live = await course();
        const { teacher, scopeId } = await scoped(live.id);
        const me = identity(teacher);
        const booked = await trial(live.id, teacher, 240, 60);
        const alice = booked.alice;
        const bob = await account(db.admin);
        const carol = await account(db.admin);
        await learner.enrol(carol, live.id);
        const lesson = await createSession(scopeId, teacher, schedule(250));
        const now = new Date();

        // Alice: her trial. Carol: the Course session. Bob: nothing.
        expect(
          (await classes.upcoming(alice, now)).map((v) => [
            v.session.id,
            v.participation,
            v.booking?.id,
          ]),
        ).toEqual([[booked.session.session.id, 'booking', booked.booking.id]]);
        expect(
          (await classes.upcoming(carol, now)).map((v) => [
            v.session.id,
            v.participation,
          ]),
        ).toEqual([[lesson.session.id, 'enrolment']]);
        expect(await classes.upcoming(bob, now)).toEqual([]);
        expect(await classes.session(bob, booked.session.session.id)).toBeNull();
        expect(await classes.session(carol, booked.session.session.id)).toBeNull();
        expect(await classes.session(alice, lesson.session.id)).toBeNull();
        expect(await classes.meetingUrl(bob, lesson.session.id)).toBeNull();
        expect(await classes.meetingUrl(alice, lesson.session.id)).toBeNull();
        expect(await classes.meetingUrl(carol, lesson.session.id)).toBe(MEET);
        // A trial without an address yet discloses nothing; once set, only to its learner.
        expect(await classes.meetingUrl(alice, booked.session.session.id)).toBeNull();
        await teaching.setMeeting({
          teacher: me,
          sessionId: booked.session.session.id,
          expectedVersion: 1,
          meeting: { provider: 'google-meet', url: MEET },
        });
        expect(await classes.meetingUrl(alice, booked.session.session.id)).toBe(MEET);
        expect(await classes.meetingUrl(carol, booked.session.session.id)).toBeNull();
        expect(JSON.stringify(await classes.upcoming(alice, now))).not.toContain(
          'meet.google.com',
        );
        expect(
          (await classes.teachers(alice, now)).map((t) => [
            t.teacherAccountId,
            t.upcoming,
            t.courses.map((c) => c.id),
          ]),
        ).toEqual([[teacher.accountId, 1, [live.id]]]);
        expect(await classes.teachers(bob, now)).toEqual([]);

        // Bob cannot cancel Alice's Booking; Alice cannot at a stale version; then she can, once.
        expect(
          await reasonOf(
            classes.cancelBooking({
              accountId: bob,
              bookingId: booked.booking.id,
              expectedVersion: 1,
            }),
          ),
        ).toBe('not-found');
        expect(
          await reasonOf(
            classes.cancelBooking({
              accountId: alice,
              bookingId: booked.booking.id,
              expectedVersion: 3,
            }),
          ),
        ).toBe('conflict');
        const cancelled = await classes.cancelBooking({
          accountId: alice,
          bookingId: booked.booking.id,
          expectedVersion: 1,
        });
        expect(cancelled).toMatchObject({ state: 'cancelled', version: 2 });
        expect(cancelled.cancelledAt).not.toBeNull();
        expect(await sessionColumns(db.admin, booked.session.session.id)).toMatchObject({
          state: 'cancelled',
          meetingUrl: null,
        });
        expect(await classes.meetingUrl(alice, booked.session.session.id)).toBeNull();
        expect(await classes.upcoming(alice, now)).toEqual([]);
        expect(
          (await classes.past(alice, now, 0)).items.map((v) => [
            v.session.state,
            v.booking?.state,
          ]),
        ).toEqual([['cancelled', 'cancelled']]);
        const owed = await intentsFor(db.admin, booked.session.session.id);
        expect(owed.filter((r) => r.state === 'pending').map((r) => r.purpose)).toEqual([
          'learning.session-cancelled',
          'learning.session-cancelled',
        ]);
        expect(
          await reasonOf(
            classes.cancelBooking({
              accountId: alice,
              bookingId: booked.booking.id,
              expectedVersion: 2,
            }),
          ),
        ).toBe('terminal');
        // The window is free again for another learner.
        expect(
          (await teaching.availability(me, 0)).items.find(
            (w) => w.id === booked.window.id,
          )?.booked,
        ).toBe(false);
        // A Course session is attended through an Enrolment and has no Booking to cancel: it is never a learner's to close.
        expect((await classes.session(carol, lesson.session.id))?.booking).toBeNull();
        // Leaving the Course ends access to its class.
        await learner.leave(carol, live.id);
        expect(await classes.upcoming(carol, now)).toEqual([]);
        expect(await classes.meetingUrl(carol, lesson.session.id)).toBeNull();
        // An ended scope keeps the class listed but withholds the address until a replacement.
        await learner.enrol(carol, live.id);
        await admin.endScope({ actorId: actor, scopeId, expectedVersion: 1 });
        expect((await classes.upcoming(carol, now)).map((v) => v.session.id)).toEqual([
          lesson.session.id,
        ]);
        expect(await classes.meetingUrl(carol, lesson.session.id)).toBeNull();
      });
    });

    /* ======================================================================
     * The public schedule
     * ==================================================================== */

    describe('the public reader shows scheduled classes on published live Courses under current scopes, and nothing private', () => {
      it('lists only what is public and carries no address, participant or window', async () => {
        const live = await course();
        const { teacher, scopeId } = await scoped(live.id);
        const me = identity(teacher);
        const shown = await createSession(scopeId, teacher, schedule(260));
        const cancelled = await createSession(scopeId, teacher, schedule(262));
        await teaching.cancel({
          teacher: me,
          sessionId: cancelled.session.id,
          expectedVersion: 1,
        });
        const started = await createSession(scopeId, teacher, schedule(-1));
        const trialled = await trial(live.id, teacher, 264);
        const endedScope = await scoped(live.id);
        const orphan = await createSession(
          endedScope.scopeId,
          endedScope.teacher,
          schedule(266),
        );
        await admin.endScope({
          actorId: actor,
          scopeId: endedScope.scopeId,
          expectedVersion: 1,
        });
        const now = new Date();

        const page = await reader.upcomingSessions(now, 0);
        const mine = page.items.filter((item) => item.course.id === live.id);
        expect(mine.map((item) => item.id).sort()).toEqual(
          [shown.session.id, trialled.session.session.id].sort(),
        );
        expect(mine.map((item) => item.id)).not.toContain(cancelled.session.id);
        expect(mine.map((item) => item.id)).not.toContain(started.session.id);
        expect(mine.map((item) => item.id)).not.toContain(orphan.session.id);
        expect(Object.keys(mine[0] ?? {}).sort()).toEqual([
          'course',
          'endsAt',
          'endsLocal',
          'id',
          'startsAt',
          'startsLocal',
          'teacherAccountId',
          'timeZone',
        ]);
        const text = JSON.stringify(page);
        expect(text).not.toContain('meet.google.com');
        expect(text).not.toContain(trialled.alice);
        expect(mine[0]?.teacherAccountId).toBe(teacher.accountId);

        const teachers = await reader.operationalTeachers(now);
        const listed = teachers.find((entry) => entry.accountId === teacher.accountId);
        expect(listed?.courses.map((c) => c.id)).toEqual([live.id]);
        expect(listed?.available).toBe(false);
        expect(teachers.map((entry) => entry.accountId)).not.toContain(
          endedScope.teacher.accountId,
        );
        await teaching.openAvailability({ teacher: me, window: window(270) });
        expect(
          (await reader.operationalTeachers(now)).find(
            (entry) => entry.accountId === teacher.accountId,
          )?.available,
        ).toBe(true);
        expect(JSON.stringify(await reader.operationalTeachers(now))).not.toContain(
          'startsLocal',
        );
      });
    });

    /* ======================================================================
     * Communication intents
     * ==================================================================== */

    describe('class mail is owed only while what it describes still stands', () => {
      it('claims due intents under a lease, relays once, and answers owed=false after a cancellation, a withdrawal or a revocation', async () => {
        const live = await course();
        const { teacher } = await scoped(live.id);
        const me = identity(teacher);
        const booked = await trial(live.id, teacher, 280, 60);
        const now = new Date(Date.now() + 1_000);

        const claimed = (await mail.claimDue(now, 100, 120)).filter(
          (i) => i.sessionId === booked.session.session.id,
        );
        expect(claimed.map((i) => i.purpose)).toEqual([
          'learning.booking-confirmed',
          'learning.booking-confirmed',
        ]);
        // Under a lease: a second tick sees nothing until it expires.
        expect(
          (await mail.claimDue(now, 100, 120)).filter(
            (i) => i.sessionId === booked.session.session.id,
          ),
        ).toEqual([]);
        expect(
          (await mail.claimDue(new Date(now.getTime() + 121_000), 100, 120)).filter(
            (i) => i.sessionId === booked.session.session.id,
          ),
        ).toHaveLength(2);

        const toLearner = claimed.find((i) => i.accountId === booked.alice);
        const toTeacher = claimed.find((i) => i.accountId === teacher.accountId);
        const learnerSource = await mail.deliverySource(toLearner?.id ?? '');
        expect(learnerSource).toMatchObject({ recipientRole: 'learner', owed: true });
        expect(JSON.stringify(learnerSource)).not.toContain('meet.google.com');
        expect(await mail.deliverySource(toTeacher?.id ?? '')).toMatchObject({
          recipientRole: 'teacher',
          owed: true,
        });
        await mail.markRelayed(toLearner?.id ?? '');
        expect((await mail.deliverySource(toLearner?.id ?? ''))?.owed).toBe(false);
        expect((await mail.deliverySource(toLearner?.id ?? ''))?.intent.state).toBe(
          'relayed',
        );
        expect(
          await sqlNumber(
            db.admin.query(
              `UPDATE [dbo].[ClassCommunicationIntent] SET [state] = N'pending' WHERE [id] = ${n(toLearner?.id ?? '')};`,
            ),
          ),
        ).toBe(51292);
        expect(
          await mail.deliverySource('00000000-0000-4000-8000-000000000000'),
        ).toBeNull();

        // The teacher's reminder: owed until the assignment is revoked.
        const reminder = (await intentsFor(db.admin, booked.session.session.id)).find(
          (r) =>
            r.purpose === 'learning.class-reminder' && r.userId === teacher.accountId,
        );
        const [reminderRow] = await db.admin.query<{ id: string }>(
          `SELECT [id] FROM [dbo].[ClassCommunicationIntent] WHERE [sessionId] = ${n(booked.session.session.id)} AND [userId] = ${n(teacher.accountId)} AND [purpose] = N'learning.class-reminder';`,
        );
        expect(reminder?.state).toBe('pending');
        expect((await mail.deliverySource(reminderRow?.id ?? ''))?.owed).toBe(true);
        await revokeAssignment(db.admin, teacher.roleAssignmentId);
        expect((await mail.deliverySource(reminderRow?.id ?? ''))?.owed).toBe(false);

        // The learner's reminder: owed until the Booking is withdrawn — then the cancellation is owed instead.
        const [learnerReminder] = await db.admin.query<{ id: string }>(
          `SELECT [id] FROM [dbo].[ClassCommunicationIntent] WHERE [sessionId] = ${n(booked.session.session.id)} AND [userId] = ${n(booked.alice)} AND [purpose] = N'learning.class-reminder';`,
        );
        expect((await mail.deliverySource(learnerReminder?.id ?? ''))?.owed).toBe(true);
        await classes.cancelBooking({
          accountId: booked.alice,
          bookingId: booked.booking.id,
          expectedVersion: 1,
        });
        expect((await mail.deliverySource(learnerReminder?.id ?? ''))?.owed).toBe(false);
        const [cancellation] = await db.admin.query<{ id: string }>(
          `SELECT [id] FROM [dbo].[ClassCommunicationIntent] WHERE [sessionId] = ${n(booked.session.session.id)} AND [userId] = ${n(booked.alice)} AND [purpose] = N'learning.session-cancelled';`,
        );
        expect((await mail.deliverySource(cancellation?.id ?? ''))?.owed).toBe(true);
        await mail.markAbandoned(cancellation?.id ?? '');
        expect((await mail.deliverySource(cancellation?.id ?? ''))?.owed).toBe(false);

        // A Course session's reminder to a learner who left is owed no longer.
        const carol = await account(db.admin);
        await learner.enrol(carol, live.id);
        const fresh = await scoped(live.id);
        const lesson = await createSession(
          fresh.scopeId,
          fresh.teacher,
          schedule(290, 60),
        );
        const [carolReminder] = await db.admin.query<{ id: string }>(
          `SELECT [id] FROM [dbo].[ClassCommunicationIntent] WHERE [sessionId] = ${n(lesson.session.id)} AND [userId] = ${n(carol)};`,
        );
        expect((await mail.deliverySource(carolReminder?.id ?? ''))?.owed).toBe(true);
        await learner.leave(carol, live.id);
        expect((await mail.deliverySource(carolReminder?.id ?? ''))?.owed).toBe(false);
        expect(me.accountId).toBe(teacher.accountId);

        const summary = await mail.summarise();
        expect(summary.map((row) => row.purpose)).toEqual([
          'learning.booking-confirmed',
          'learning.session-rescheduled',
          'learning.session-cancelled',
          'learning.class-reminder',
        ]);
        expect(
          summary.find((row) => row.purpose === 'learning.session-cancelled')?.abandoned,
        ).toBeGreaterThan(0);
      });
    });

    /* ======================================================================
     * Export and closure
     * ==================================================================== */

    describe("a person's export and their closed account's disposition", () => {
      it('exports own rows only, then cancels, ends and removes exactly what the person owns', async () => {
        const live = await course();
        const { teacher, scopeId } = await scoped(live.id);
        const me = identity(teacher);
        const booked = await trial(live.id, teacher, 300, 60);
        const alice = booked.alice;
        const bob = await account(db.admin);
        await learner.enrol(alice, live.id);
        await learner.enrol(bob, live.id);
        const past = await createSession(scopeId, teacher, schedule(-3));
        await teaching.markAttendance({
          teacher: me,
          sessionId: past.session.id,
          accountId: alice,
          status: 'present',
        });
        await teaching.markAttendance({
          teacher: me,
          sessionId: past.session.id,
          accountId: bob,
          status: 'present',
        });
        const future = await createSession(scopeId, teacher, schedule(310, 60));
        const spare = await teaching.openAvailability({
          teacher: me,
          window: window(320),
        });
        // Another learner's trial with the same teacher, which closure must not touch.
        const other = await trial(live.id, teacher, 330);

        const mine = await exporter.collect(alice);
        expect(mine.bookings.map((b) => [b.id, b.state])).toEqual([
          [booked.booking.id, 'confirmed'],
        ]);
        expect(mine.classes.map((c) => [c.sessionId, c.participation]).sort()).toEqual(
          [
            [booked.session.session.id, 'booking'],
            [past.session.id, 'enrolment'],
            [future.session.id, 'enrolment'],
          ].sort(),
        );
        expect(mine.attendance).toEqual([
          { sessionId: past.session.id, status: 'present', markedAt: expect.any(String) },
        ]);
        expect(mine.availability).toEqual([]);
        expect(mine.teachingScopes).toEqual([]);
        expect(JSON.stringify(mine)).not.toContain(bob);
        expect(JSON.stringify(mine)).not.toContain('meet.google.com');
        expect(await exporter.collect(alice)).toEqual(mine);

        const theirs = await exporter.collect(teacher.accountId);
        expect(theirs.teachingScopes.map((s) => s.id)).toEqual([scopeId]);
        expect(theirs.availability.map((w) => w.id).sort()).toEqual(
          [booked.window.id, spare.id, other.window.id].sort(),
        );
        expect(theirs.classes.every((c) => c.participation === 'teacher')).toBe(true);
        expect(theirs.classes).toHaveLength(4);
        expect(JSON.stringify(theirs)).not.toContain(alice);

        expect(await disposition.accountsWithData(null, 1000)).toEqual(
          expect.arrayContaining([alice, bob, teacher.accountId]),
        );

        // The learner: her future trial cancelled (the teacher told), her mark and
        // mail removed, her Bookings gone; the sessions stay.
        const aliceBefore = await classRows(db.admin, alice);
        expect(aliceBefore).toBeGreaterThan(0);
        expect(await disposition.disposeAccount(alice, 1000)).toBeGreaterThan(0);
        expect(await sessionColumns(db.admin, booked.session.session.id)).toMatchObject({
          state: 'cancelled',
        });
        expect(await classRows(db.admin, alice)).toBe(0);
        expect(await count(db.admin, 'Enrolment', `[userId] = ${n(alice)}`)).toBe(0);
        expect(await count(db.admin, 'TrialClassRequest', `[userId] = ${n(alice)}`)).toBe(
          0,
        );
        expect(await count(db.admin, 'ClassSession', `[courseId] = ${n(live.id)}`)).toBe(
          4,
        );
        expect(await count(db.admin, 'Attendance', `[userId] = ${n(bob)}`)).toBe(1);
        expect(
          (await intentsFor(db.admin, booked.session.session.id))
            .filter((r) => r.state === 'pending')
            .map((r) => r.userId),
        ).toEqual([teacher.accountId]);
        expect(await disposition.disposeAccount(alice, 1000)).toBe(0);
        expect(await disposition.accountsWithData(null, 1000)).not.toContain(alice);

        // The teacher: scopes ended, unbooked windows removed, the booked one
        // withdrawn and kept, sessions untouched — now replacement-required.
        expect(await disposition.disposeAccount(teacher.accountId, 1000)).toBeGreaterThan(
          0,
        );
        expect(
          await count(
            db.admin,
            'CourseTeachingAssignment',
            `[id] = ${n(scopeId)} AND [endedAt] IS NOT NULL`,
          ),
        ).toBe(1);
        expect(await count(db.admin, 'Availability', `[id] = ${n(spare.id)}`)).toBe(0);
        // Alice's Booking went with her, so her window had nothing naming it.
        expect(
          await count(db.admin, 'Availability', `[id] = ${n(booked.window.id)}`),
        ).toBe(0);
        expect(
          await count(
            db.admin,
            'Availability',
            `[id] = ${n(other.window.id)} AND [state] = N'withdrawn'`,
          ),
        ).toBe(1);
        expect(
          await count(
            db.admin,
            'Booking',
            `[id] = ${n(other.booking.id)} AND [state] = N'confirmed'`,
          ),
        ).toBe(1);
        expect(await sessionColumns(db.admin, future.session.id)).toMatchObject({
          state: 'scheduled',
          scopeId,
        });
        expect(await sessionColumns(db.admin, other.session.session.id)).toMatchObject({
          state: 'scheduled',
          scopeId,
        });
        expect(
          await count(
            db.admin,
            'ClassCommunicationIntent',
            `[userId] = ${n(teacher.accountId)}`,
          ),
        ).toBe(0);
        expect(
          await count(db.admin, 'Attendance', `[userId] = ${n(teacher.accountId)}`),
        ).toBe(0);
        expect(
          await count(
            db.admin,
            'CourseTeachingAssignment',
            `[userId] = ${n(teacher.accountId)} AND [endedAt] IS NULL`,
          ),
        ).toBe(0);
        // The one row left is the withdrawn window the other learner's Booking names.
        expect(await classRows(db.admin, teacher.accountId)).toBe(1);
        expect(await disposition.disposeAccount(teacher.accountId, 1000)).toBe(0);
        expect(await disposition.accountsWithData(null, 1000)).not.toContain(
          teacher.accountId,
        );
        expect((await admin.session(future.session.id))?.session.teachingScopeId).toBe(
          scopeId,
        );
        expect(await classes.meetingUrl(bob, future.session.id)).toBeNull();
      });
    });
  },
);
