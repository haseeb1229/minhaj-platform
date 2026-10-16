import 'server-only';

import { deepStrictEqual } from 'node:assert';
import { randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-23 STATE for the recovery rehearsals.
 *
 * WHAT THE RECOVERY FIXTURE PROVES THAT A SCHEMA CHECK DOES NOT. That live
 * learning came back exactly as it was switched on — the fixture activation
 * and nothing more — that teaching authority is still exactly who Identity
 * says it is, scoped by type to the very Course and assignment it was granted
 * under, and that every booking, class, mark and owed message is still the
 * right person's:
 *
 *   - the owner's fixture activation (authority `fixture`, no evidence);
 *   - two synthetic accounts each holding a synthetic custom role carrying
 *     `teaching.perform`: one whose assignment is LIVE and whose scope on the
 *     Phase-22 published live Course is CURRENT, and one whose assignment was
 *     REVOKED and whose scope on the same Course is ENDED — history that
 *     grants nothing;
 *   - two open windows and one withdrawn window of the live teacher;
 *   - the Phase-22 learner's trial request confirmed into a Booking of a trial
 *     session that holds a synthetic-but-valid `meet.google.com` address and
 *     claims the first open window;
 *   - a regular Course session with a reminder instant, and the learner's
 *     attendance mark on it (the learner is enrolled on that Course);
 *   - two pending communication intents, one per session;
 *   - a cancelled past session, its meeting address NULL and its closure set.
 *
 * NOTHING HERE IS ANYBODY'S DATA. Every name is a `NON_LEARNING_FIXTURE_…`
 * sentinel, every address `@learning-proof.invalid`, every role key a
 * `recovery-teaching-…` sentinel, and the Course, learner and trial request
 * are the Phase-22 fixture's own synthetic rows. Rows are written directly by
 * the owner: the recovery databases are disposable and created by the run that
 * writes them, and the adapters' own write paths are proved by
 * `db:test:permissions` and the integration suites.
 */

const TEXT = {
  teacher: 'NON_LEARNING_FIXTURE_ACCOUNT teacher',
  revoked: 'NON_LEARNING_FIXTURE_ACCOUNT revoked teacher',
  operator: 'NON_LEARNING_FIXTURE_OPERATOR',
  role: 'NON_LEARNING_FIXTURE_ROLE teaching',
} as const;

/** A synthetic-but-valid meeting address, exactly the shape the CHECK admits. */
const MEETING_URL = 'https://meet.google.com/abc-defg-hij';

export interface Phase23Fixture {
  readonly runId: string;
  readonly teacherId: string;
  readonly revokedTeacherId: string;
  readonly teachingRoleId: string;
  readonly revokedRoleId: string;
  readonly teacherAssignmentId: string;
  readonly revokedAssignmentId: string;
  readonly scopeId: string;
  readonly endedScopeId: string;
  readonly openOneId: string;
  readonly openTwoId: string;
  readonly withdrawnId: string;
  readonly trialSessionId: string;
  readonly courseSessionId: string;
  readonly cancelledSessionId: string;
  readonly bookingId: string;
  readonly confirmedIntentId: string;
  readonly reminderIntentId: string;
}

export interface Phase23References {
  /** The Phase-22 published live Course both teachers are scoped to. */
  readonly liveCourseId: string;
  /** The Phase-22 learner, enrolled on that Course, who asked for a trial. */
  readonly learnerId: string;
  /** The Phase-22 trial request the Booking confirms. */
  readonly trialId: string;
}

export function newPhase23Fixture(): Phase23Fixture {
  return {
    runId: randomUUID().replaceAll('-', ''),
    teacherId: randomUUID(),
    revokedTeacherId: randomUUID(),
    teachingRoleId: randomUUID(),
    revokedRoleId: randomUUID(),
    teacherAssignmentId: randomUUID(),
    revokedAssignmentId: randomUUID(),
    scopeId: randomUUID(),
    endedScopeId: randomUUID(),
    openOneId: randomUUID(),
    openTwoId: randomUUID(),
    withdrawnId: randomUUID(),
    trialSessionId: randomUUID(),
    courseSessionId: randomUUID(),
    cancelledSessionId: randomUUID(),
    bookingId: randomUUID(),
    confirmedIntentId: randomUUID(),
    reminderIntentId: randomUUID(),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase23Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId))
    throw new Error('Phase-23 fixture runId does not match the expected pattern.');
  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (!/^[0-9a-f-]{36}$/.test(value))
      throw new Error(`Phase-23 fixture field '${name}' is not a generated identifier.`);
  }
}

function assertReferences(references: Phase23References): void {
  for (const id of [references.liveCourseId, references.learnerId, references.trialId])
    if (!/^[a-z0-9-]{1,36}$/i.test(id))
      throw new Error('Invalid synthetic Phase-23 fixture reference.');
}

const DAY = '2026-10-07';
const instant = (hour: string): string => `'${DAY}T${hour}:00'`;
const local = (hour: string): string => `N'${DAY}T${hour}'`;

/**
 * Writes the populated Phase-23 state into the SOURCE database, before backup,
 * with the MIGRATION principal, so the real keys, CHECKs and triggers are
 * exercised: the activation first, because nothing below it may exist before
 * it; each scope accepted only under a LIVE `teaching.perform` assignment of
 * its own account on a live Course (the revocation follows the scope, as it
 * would in life); each session only on the published live Course under a
 * current scope of it; the Booking only as the request's own learner on a
 * trial session at the teacher's open window's exact times; the mark only for
 * an enrolled learner on an open session.
 */
export async function writePhase23Fixture(
  sql: SqlSession,
  fixture: Phase23Fixture,
  references: Phase23References,
): Promise<void> {
  assertSafe(fixture);
  assertReferences(references);
  const f = fixture;
  const r = references;
  const stem = f.runId.slice(0, 16);
  const account = (id: string, label: string, name: string): string =>
    `(N'${id}', N'${name}', N'${label}-${stem}@learning-proof.invalid', 0, '2026-10-07T06:00:00', '2026-10-07T06:00:00', N'en', N'active', 0)`;

  // ---- the activation, the accounts and their Identity authority ------------------
  await sql.query(`
    INSERT INTO [dbo].[LiveLearningActivation] ([id],[authority],[authorisedBy],[reference],[activatedAt]) VALUES
      (1, N'fixture', N'${TEXT.operator}', NULL, '2026-10-07T06:00:00');
    INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES
      ${account(f.teacherId, 'teacher', TEXT.teacher)},
      ${account(f.revokedTeacherId, 'revoked-teacher', TEXT.revoked)};
    INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system]) VALUES
      (N'${f.teachingRoleId}', N'recovery-teaching-${stem}', N'${TEXT.role}', N'Synthetic recovery role.', 0),
      (N'${f.revokedRoleId}', N'recovery-teaching-revoked-${stem}', N'${TEXT.role} revoked', N'Synthetic recovery role.', 0);
    INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES
      (N'${f.teachingRoleId}', N'teaching.perform'),
      (N'${f.revokedRoleId}', N'teaching.perform');
    INSERT INTO [dbo].[RoleAssignment] ([id],[userId],[roleId],[grantedAt]) VALUES
      (N'${f.teacherAssignmentId}', N'${f.teacherId}', N'${f.teachingRoleId}', '2026-10-07T06:10:00'),
      (N'${f.revokedAssignmentId}', N'${f.revokedTeacherId}', N'${f.revokedRoleId}', '2026-10-07T06:10:00');
  `);

  // ---- the scopes: one current, one ended under an assignment then revoked ------
  await sql.query(`
    INSERT INTO [dbo].[CourseTeachingAssignment] ([id],[courseId],[userId],[roleAssignmentId],[grantedAt],[grantedById],[endedAt],[endedById],[version],[updatedAt]) VALUES
      (N'${f.scopeId}', N'${r.liveCourseId}', N'${f.teacherId}', N'${f.teacherAssignmentId}', '2026-10-07T06:20:00', NULL, NULL, NULL, 1, '2026-10-07T06:20:00'),
      (N'${f.endedScopeId}', N'${r.liveCourseId}', N'${f.revokedTeacherId}', N'${f.revokedAssignmentId}', '2026-10-07T06:20:00', NULL, '2026-10-07T06:30:00', NULL, 2, '2026-10-07T06:30:00');
    UPDATE [dbo].[RoleAssignment] SET [revokedAt]='2026-10-07T06:30:00', [revokedReason]=N'NON_LEARNING_FIXTURE revoked'
      WHERE [id]=N'${f.revokedAssignmentId}';
  `);

  // ---- windows, sessions, the Booking, the mark and the intents ------------------
  const window = (id: string, from: string, to: string, state: string): string =>
    `(N'${id}', N'${f.teacherId}', ${instant(from)}, ${instant(to)}, N'Europe/London', ${local(from)}, ${local(to)}, N'${state}', 1, '2026-10-07T06:40:00', '2026-10-07T06:40:00')`;
  await sql.query(`
    INSERT INTO [dbo].[Availability] ([id],[userId],[startsAt],[endsAt],[timeZone],[startsLocal],[endsLocal],[state],[version],[createdAt],[updatedAt]) VALUES
      ${window(f.openOneId, '09:00', '10:00', 'open')},
      ${window(f.openTwoId, '10:00', '11:00', 'open')},
      ${window(f.withdrawnId, '13:00', '14:00', 'withdrawn')};
    INSERT INTO [dbo].[ClassSession] ([id],[courseId],[kind],[scopeId],[startsAt],[endsAt],[timeZone],[startsLocal],[endsLocal],[state],[meetingProvider],[meetingUrl],[reminderAt],[version],[createdAt],[updatedAt],[closedAt]) VALUES
      (N'${f.trialSessionId}', N'${r.liveCourseId}', N'trial', N'${f.scopeId}', ${instant('09:00')}, ${instant('10:00')}, N'Europe/London', ${local('09:00')}, ${local('10:00')}, N'scheduled', N'google-meet', N'${MEETING_URL}', NULL, 1, '2026-10-07T07:00:00', '2026-10-07T07:00:00', NULL),
      (N'${f.courseSessionId}', N'${r.liveCourseId}', N'course', N'${f.scopeId}', ${instant('11:00')}, ${instant('12:00')}, N'Europe/London', ${local('11:00')}, ${local('12:00')}, N'scheduled', NULL, NULL, ${instant('10:30')}, 1, '2026-10-07T07:00:00', '2026-10-07T07:00:00', NULL),
      (N'${f.cancelledSessionId}', N'${r.liveCourseId}', N'course', N'${f.scopeId}', '2026-10-06T15:00:00', '2026-10-06T16:00:00', N'Europe/London', N'2026-10-06T15:00', N'2026-10-06T16:00', N'cancelled', NULL, NULL, NULL, 2, '2026-10-06T07:00:00', '2026-10-06T14:00:00', '2026-10-06T14:00:00');
    INSERT INTO [dbo].[Booking] ([id],[requestId],[userId],[courseId],[sessionId],[availabilityId],[state],[confirmedAt],[confirmedById],[version],[updatedAt]) VALUES
      (N'${f.bookingId}', N'${r.trialId}', N'${r.learnerId}', N'${r.liveCourseId}', N'${f.trialSessionId}', N'${f.openOneId}', N'confirmed', '2026-10-07T07:10:00', NULL, 1, '2026-10-07T07:10:00');
    INSERT INTO [dbo].[Attendance] ([sessionId],[userId],[status],[markedAt],[markedById]) VALUES
      (N'${f.courseSessionId}', N'${r.learnerId}', N'present', '2026-10-07T12:00:00', N'${f.teacherId}');
    INSERT INTO [dbo].[ClassCommunicationIntent] ([id],[purpose],[sessionId],[userId],[dueAt],[state],[idempotencyKey],[claimedUntil],[relayedAt],[createdAt]) VALUES
      (N'${f.confirmedIntentId}', N'learning.booking-confirmed', N'${f.trialSessionId}', N'${r.learnerId}', '2026-10-07T07:10:00', N'pending', N'recovery-${stem}-booking-confirmed', NULL, NULL, '2026-10-07T07:10:00'),
      (N'${f.reminderIntentId}', N'learning.class-reminder', N'${f.courseSessionId}', N'${r.learnerId}', ${instant('10:30')}, N'pending', N'recovery-${stem}-class-reminder', NULL, NULL, '2026-10-07T07:00:00');
  `);
}

/** Every authoritative Phase-23 row this fixture wrote, in a stable order. */
export async function capturePhase23Fixture(
  sql: SqlSession,
  fixture: Phase23Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const f = fixture;
  const teachers = `N'${f.teacherId}',N'${f.revokedTeacherId}'`;
  const roles = `N'${f.teachingRoleId}',N'${f.revokedRoleId}'`;
  const sessions = `N'${f.trialSessionId}',N'${f.courseSessionId}',N'${f.cancelledSessionId}'`;
  const rows: Record<string, string> = {};

  for (const [name, statement, expected] of [
    ['LiveLearningActivation', 'SELECT * FROM [dbo].[LiveLearningActivation]', 1],
    [
      'User',
      `SELECT * FROM [dbo].[User] WHERE [id] IN (${teachers}) ORDER BY [email]`,
      2,
    ],
    ['Role', `SELECT * FROM [dbo].[Role] WHERE [id] IN (${roles}) ORDER BY [key]`, 2],
    [
      'RolePermission',
      `SELECT * FROM [dbo].[RolePermission] WHERE [roleId] IN (${roles}) ORDER BY [roleId]`,
      2,
    ],
    [
      'RoleAssignment',
      `SELECT * FROM [dbo].[RoleAssignment] WHERE [roleId] IN (${roles}) ORDER BY [id]`,
      2,
    ],
    [
      'CourseTeachingAssignment',
      `SELECT * FROM [dbo].[CourseTeachingAssignment] WHERE [userId] IN (${teachers}) ORDER BY [id]`,
      2,
    ],
    [
      'Availability',
      `SELECT * FROM [dbo].[Availability] WHERE [userId] IN (${teachers}) ORDER BY [startsAt]`,
      3,
    ],
    [
      'ClassSession',
      `SELECT * FROM [dbo].[ClassSession] WHERE [id] IN (${sessions}) ORDER BY [startsAt]`,
      3,
    ],
    ['Booking', `SELECT * FROM [dbo].[Booking] WHERE [id]=N'${f.bookingId}'`, 1],
    [
      'Attendance',
      `SELECT * FROM [dbo].[Attendance] WHERE [sessionId] IN (${sessions}) ORDER BY [sessionId], [userId]`,
      1,
    ],
    [
      'ClassCommunicationIntent',
      `SELECT * FROM [dbo].[ClassCommunicationIntent] WHERE [sessionId] IN (${sessions}) ORDER BY [purpose]`,
      2,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected) {
      throw new Error(
        `Phase-23 recovery expected ${String(expected)} ${name} row(s), found ${String(data.length)}.`,
      );
    }
    rows[name] = JSON.stringify(data);
  }

  return rows;
}

/** The Phase-23 tables whose constraints and triggers must return intact. */
const PHASE23_TABLES = [
  'LiveLearningActivation',
  'CourseTeachingAssignment',
  'Availability',
  'ClassSession',
  'Booking',
  'Attendance',
  'ClassCommunicationIntent',
] as const;

/** Every live-class trigger, exactly. */
const PHASE23_TRIGGERS = [
  'LearningAttendanceIntegrity',
  'LearningAvailabilityIntegrity',
  'LearningBookingIntegrity',
  'LearningIntentIntegrity',
  'LearningLiveActivationImmutable',
  'LearningScopeIntegrity',
  'LearningSessionIntegrity',
].join(',');

/**
 * Verifies the restored live-class state and returns one line of what was
 * proved.
 *
 * BEYOND ROW EQUALITY: every name, address and role key is still an
 * unmistakable sentinel; the activation is the fixture's and nothing more;
 * the live teacher's scope is CURRENT under an unrevoked assignment of a role
 * that still carries `teaching.perform`, and the revoked teacher's is ENDED
 * under a revoked one — through the same joins the adapters authorise by; the
 * Booking still confirms the learner's own request into the trial session at
 * the first open window, which it alone claims; the trial session still holds
 * its meeting address and the cancelled one none; the mark still belongs to
 * an enrolled learner on an open session; both intents are still owed; the
 * two class keys are still bundled and `teaching.perform` is held by exactly
 * the two synthetic roles; and every Phase-23 CHECK, foreign key, trigger and
 * filtered claim is enabled and trusted, with no key cascading at all.
 */
export async function verifyRestoredPhase23(
  sql: SqlSession,
  fixture: Phase23Fixture,
  expected: Readonly<Record<string, string>>,
  references: Phase23References,
): Promise<string> {
  deepStrictEqual(
    await capturePhase23Fixture(sql, fixture),
    expected,
    'Phase-23 live-class authoritative values changed during recovery.',
  );
  assertReferences(references);
  const f = fixture;
  const r = references;
  const teachers = `N'${f.teacherId}',N'${f.revokedTeacherId}'`;
  const roles = `N'${f.teachingRoleId}',N'${f.revokedRoleId}'`;

  const [labelled] = await sql.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[User] WHERE [id] IN (${teachers})
         AND ([name] NOT LIKE N'NON[_]LEARNING[_]FIXTURE[_]%' OR [email] NOT LIKE N'%@learning-proof.invalid')) AS [accounts],
      (SELECT COUNT(*) FROM [dbo].[Role] WHERE [id] IN (${roles})
         AND ([name] NOT LIKE N'NON[_]LEARNING[_]FIXTURE[_]%' OR [key] NOT LIKE N'recovery-teaching-%')) AS [roles],
      (SELECT COUNT(*) FROM [dbo].[LiveLearningActivation]
         WHERE [authorisedBy] NOT LIKE N'NON[_]LEARNING[_]FIXTURE[_]%') AS [activation];
  `);
  if (JSON.stringify(labelled) !== '{"accounts":0,"roles":0,"activation":0}') {
    throw new Error(
      `Restored Phase-23 fixture is no longer unmistakably labelled: ${JSON.stringify(labelled)}.`,
    );
  }

  // Authority, scope, claim, address, mark and owed mail — through the same
  // joins and predicates the adapters read by.
  const [state] = await sql.query<Record<string, number | string | null>>(`
    SELECT
      (SELECT STRING_AGG([authority] + N':' + CASE WHEN [reference] IS NULL THEN N'-' ELSE N'ref' END, N',')
         FROM [dbo].[LiveLearningActivation]) AS [activation],
      (SELECT COUNT(*) FROM [dbo].[CourseTeachingAssignment] s
         JOIN [dbo].[RoleAssignment] ra ON ra.[id]=s.[roleAssignmentId] AND ra.[userId]=s.[userId] AND ra.[revokedAt] IS NULL
         JOIN [dbo].[Role] o ON o.[id]=ra.[roleId] AND o.[deactivatedAt] IS NULL
         JOIN [dbo].[RolePermission] rp ON rp.[roleId]=o.[id] AND rp.[permissionKey]=N'teaching.perform'
         JOIN [dbo].[Course] c ON c.[id]=s.[courseId] AND c.[format]=N'live' AND c.[state]=N'published'
        WHERE s.[id]=N'${f.scopeId}' AND s.[userId]=N'${f.teacherId}' AND s.[endedAt] IS NULL) AS [currentScope],
      (SELECT COUNT(*) FROM [dbo].[CourseTeachingAssignment] s
         JOIN [dbo].[RoleAssignment] ra ON ra.[id]=s.[roleAssignmentId] AND ra.[revokedAt] IS NOT NULL
        WHERE s.[id]=N'${f.endedScopeId}' AND s.[userId]=N'${f.revokedTeacherId}' AND s.[endedAt] IS NOT NULL) AS [endedScope],
      (SELECT COUNT(*) FROM [dbo].[CourseTeachingAssignment] WHERE [courseId]=N'${r.liveCourseId}' AND [endedAt] IS NULL) AS [currentScopes],
      (SELECT COUNT(*) FROM [dbo].[Booking] b
         JOIN [dbo].[TrialClassRequest] t ON t.[id]=b.[requestId] AND t.[userId]=b.[userId] AND t.[courseId]=b.[courseId]
         JOIN [dbo].[ClassSession] cs ON cs.[id]=b.[sessionId] AND cs.[kind]=N'trial' AND cs.[state]=N'scheduled'
         JOIN [dbo].[Availability] a ON a.[id]=b.[availabilityId] AND a.[state]=N'open'
           AND a.[startsAt]=cs.[startsAt] AND a.[endsAt]=cs.[endsAt] AND a.[userId]=N'${f.teacherId}'
        WHERE b.[id]=N'${f.bookingId}' AND b.[userId]=N'${r.learnerId}' AND b.[state]=N'confirmed') AS [booking],
      (SELECT COUNT(*) FROM [dbo].[Booking] WHERE [availabilityId]=N'${f.openOneId}' AND [state]<>N'cancelled') AS [claims],
      (SELECT [meetingUrl] FROM [dbo].[ClassSession] WHERE [id]=N'${f.trialSessionId}') AS [meeting],
      (SELECT COUNT(*) FROM [dbo].[ClassSession] WHERE [id]=N'${f.cancelledSessionId}' AND [state]=N'cancelled'
         AND [meetingUrl] IS NULL AND [meetingProvider] IS NULL AND [closedAt] IS NOT NULL) AS [cancelled],
      (SELECT COUNT(*) FROM [dbo].[ClassSession] WHERE [id]=N'${f.courseSessionId}' AND [reminderAt] IS NOT NULL AND [reminderAt] < [startsAt]) AS [reminder],
      (SELECT STRING_AGG([state], N',') WITHIN GROUP (ORDER BY [startsAt]) FROM [dbo].[Availability] WHERE [userId]=N'${f.teacherId}') AS [windows],
      (SELECT COUNT(*) FROM [dbo].[Attendance] m
         JOIN [dbo].[ClassSession] cs ON cs.[id]=m.[sessionId] AND cs.[state]<>N'cancelled' AND cs.[kind]=N'course'
         JOIN [dbo].[Enrolment] e ON e.[userId]=m.[userId] AND e.[courseId]=cs.[courseId]
        WHERE m.[sessionId]=N'${f.courseSessionId}' AND m.[userId]=N'${r.learnerId}' AND m.[status]=N'present') AS [mark],
      (SELECT STRING_AGG([purpose], N',') WITHIN GROUP (ORDER BY [purpose]) FROM [dbo].[ClassCommunicationIntent]
        WHERE [userId]=N'${r.learnerId}' AND [state]=N'pending' AND [relayedAt] IS NULL) AS [owed],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] o ON o.[id]=rp.[roleId]
        WHERE o.[key]=N'platform-administrator'
          AND rp.[permissionKey] IN (N'learning.classes.read', N'learning.classes.administer')) AS [classesBundled],
      (SELECT STRING_AGG(CASE WHEN rp.[roleId] IN (${roles}) THEN N'synthetic' ELSE rp.[roleId] END, N',')
         FROM [dbo].[RolePermission] rp WHERE rp.[permissionKey]=N'teaching.perform') AS [teachingHeldBy];
  `);
  const expectedState = {
    activation: 'fixture:-',
    currentScope: 1,
    endedScope: 1,
    currentScopes: 1,
    booking: 1,
    claims: 1,
    meeting: MEETING_URL,
    cancelled: 1,
    reminder: 1,
    windows: 'open,open,withdrawn',
    mark: 1,
    owed: 'learning.booking-confirmed,learning.class-reminder',
    classesBundled: 2,
    teachingHeldBy: 'synthetic,synthetic',
  };
  if (JSON.stringify(state) !== JSON.stringify(expectedState)) {
    throw new Error(
      `Restored Phase-23 live-class state is broken: ${JSON.stringify(state)}.`,
    );
  }

  const tables = PHASE23_TABLES.map((table) => `OBJECT_ID(N'${table}')`).join(',');
  const broken = await sql.query<{ name: string }>(
    `SELECT [name] FROM sys.check_constraints
     WHERE parent_object_id IN (${tables}) AND (is_disabled=1 OR is_not_trusted=1)
     UNION ALL
     SELECT [name] FROM sys.foreign_keys
     WHERE parent_object_id IN (${tables})
       AND (is_disabled=1 OR is_not_trusted=1 OR delete_referential_action<>0 OR update_referential_action<>0)
     UNION ALL
     SELECT [name] FROM sys.triggers WHERE parent_id IN (${tables}) AND is_disabled=1;`,
  );
  if (broken.length > 0) {
    throw new Error(
      `Restored Phase-23 constraints or triggers are not intact: ${broken.map((row) => row.name).join(', ')}`,
    );
  }

  const [counts] = await sql.query<{
    checks: number;
    keys: number;
    triggers: string | null;
    filtered: number;
  }>(
    `SELECT
       (SELECT COUNT_BIG(*) FROM sys.check_constraints WHERE parent_object_id IN (${tables})) AS [checks],
       (SELECT COUNT_BIG(*) FROM sys.foreign_keys WHERE parent_object_id IN (${tables})) AS [keys],
       (SELECT STRING_AGG([name], N',') WITHIN GROUP (ORDER BY [name]) FROM sys.triggers
         WHERE parent_id IN (${tables})) AS [triggers],
       (SELECT COUNT_BIG(*) FROM sys.indexes
         WHERE [object_id] IN (${tables}) AND has_filter=1 AND is_unique=1) AS [filtered];`,
  );
  // 9 CHECKs, 15 foreign keys none of which cascades, the 7 triggers and the
  // two filtered claims, exactly as the migration creates them: a restore that
  // silently lost one would otherwise read as "none untrusted".
  if (
    Number(counts?.checks ?? 0) !== 9 ||
    Number(counts?.keys ?? 0) !== 15 ||
    counts?.triggers !== PHASE23_TRIGGERS ||
    Number(counts.filtered) !== 2
  ) {
    throw new Error(
      `Restored Phase-23 objects are incomplete: ${JSON.stringify(counts ?? null)}.`,
    );
  }

  return 'the fixture activation alone, a current typed scope under a live teaching.perform assignment and an ended one under a revoked assignment, two open and one withdrawn window, the learner’s request confirmed into a Booking that alone claims its window, a trial session holding its meeting address and a cancelled one holding none, a reminder before its class, an enrolled learner’s mark, two owed intents, both class keys bundled, teaching.perform held only by the two synthetic roles, and every key, CHECK, trigger and filtered claim trusted with no cascade';
}
