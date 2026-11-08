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
  DEMO_TOOL_ENTRY,
  runMigrationTool,
} from '../../packages/database/src/lifecycle/migration-proof-operator.ts';
import {
  openSession,
  parseSqlServerUrl,
  type SqlServerConnection,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  DEMO_COURSE_SLUGS,
  DEMO_ROLE_KEY,
  ensureActivations,
  ensurePersonas,
  inspectDemo,
  livePersonas,
  liveStepUpSession,
  type DemoAccounts,
  type DemoPasswords,
} from '../../packages/database/src/lifecycle/staging-demo.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { accountWith, count, grantFor, n, sessionFor } from '../quran/fixture-sql.ts';

/**
 * Rebaseline R2 — the staging demo against a REAL SQL Server: the owner half
 * writes personas and `fixture` activations, the runtime half (a child process
 * as the least-privilege RUNTIME principal) seeds through the services, a
 * second seed changes nothing, and reset retires ONLY the demo through the
 * platform's own closed-account dispositions.
 *
 * Synthetic sentinels only: no password here is a credential anywhere.
 */

const live = databaseConfigured ? describe : describe.skip;

const PASSWORDS: DemoPasswords = Object.freeze({
  student: 'SENTINELstudentAAAAAAAAAAAAAAAAA',
  teacher: 'SENTINELteacherBBBBBBBBBBBBBBBBB',
  member: 'SENTINELmemberCCCCCCCCCCCCCCCCCC',
});

/** Every key the operator — a staging administrator — uses for the demo. */
const OPERATOR_KEYS = [
  'roles.administer',
  'permissions.grant',
  'people.administer',
  'learning.read',
  'learning.administer',
  'learning.classes.read',
  'learning.classes.administer',
  'membership.read',
  'membership.administer',
  'donations.read',
  'donations.administer',
] as const;

live('R2 staging demo against real SQL Server', () => {
  let db: DisposableDatabase;
  let runtime: SqlServerConnection;
  let operator: string;
  let session: string;
  let realAccount: string;

  const status = () =>
    inspectDemo(db.admin, { roleKey: DEMO_ROLE_KEY, courseSlugs: DEMO_COURSE_SLUGS });

  async function seed(accounts: DemoAccounts, withSession: boolean) {
    return runMigrationTool({
      runtime,
      entry: DEMO_TOOL_ENTRY,
      args: [
        'seed',
        '--operator',
        operator,
        '--student',
        accounts.student,
        '--teacher',
        accounts.teacher,
        '--member',
        accounts.member,
        '--base-url',
        'http://127.0.0.1',
        '--donations',
        'yes',
        ...(withSession ? ['--session', session] : []),
      ],
      environment: process.env,
      label: 'staging demo seed',
    });
  }

  async function personaIds(): Promise<DemoAccounts> {
    const outcome = await ensurePersonas(db.admin, PASSWORDS);
    return {
      student: outcome.student.accountId,
      teacher: outcome.teacher.accountId,
      member: outcome.member.accountId,
    };
  }

  beforeAll(async () => {
    const runtimeSource = getDatabaseRuntimeUrl();
    db = await createProofDatabase();
    const target = parseSqlServerUrl(runtimeSource);
    const runtimeUrl = runtimeSource.replace(
      `database=${target.database}`,
      `database=${db.name}`,
    );
    if (runtimeUrl === runtimeSource)
      throw new Error(
        'The runtime URL could not be repointed at the disposable database.',
      );
    runtime = assertApprovedLocalTarget(
      runtimeUrl,
      localTargetPolicy(process.env, 'disposable', 'runtime'),
    );
    const principal = getApplicationPrincipalCredentials();
    await provisionApplicationPrincipal(
      db.admin,
      principal.DATABASE_APP_LOGIN,
      principal.DATABASE_APP_PASSWORD,
    );
    // Reachability of the runtime principal, before any child relies on it.
    await (await openSession(runtime)).close();

    operator = await accountWith(db.admin, OPERATOR_KEYS);
    await db.admin.query(`
      UPDATE [dbo].[User] SET [twoFactorEnabled] = 1, [emailVerified] = 1 WHERE [id] = ${n(operator)};
      INSERT INTO [dbo].[TwoFactor] ([secret],[backupCodes],[userId],[verified])
        VALUES (N'not-a-real-secret-demo', N'not-real-codes-demo', ${n(operator)}, 1);
      INSERT INTO [dbo].[PrivilegedSecurityPosture] ([userId],[secondFactorVerifiedAt],[recoveryCodesIssuedAt],[recoveryCodesConfirmedAt])
        VALUES (${n(operator)}, SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME());
    `);
    session = await sessionFor(db.admin, operator);
    realAccount = await accountWith(db.admin, []);
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  }, 120_000);

  it('refuses the privileged step without a live step-up, granting nothing', async () => {
    await expect(
      liveStepUpSession(db.admin, operator, 'privilege-administration'),
    ).rejects.toThrow(/no live privilege-administration step-up/u);
    const accounts = await personaIds();
    await ensureActivations(db.admin, operator);
    await expect(seed(accounts, false)).rejects.toThrow(/privilege-administration/u);
    expect(await count(db.admin, 'Role', `[key] = ${n(DEMO_ROLE_KEY)}`)).toBe(0);
    expect(await count(db.admin, 'Enrolment')).toBe(0);
  }, 600_000);

  it('seeds through the services, with fixture activations only and no password anywhere', async () => {
    await grantFor(db.admin, operator, session, 'privilege-administration');
    expect(await liveStepUpSession(db.admin, operator, 'privilege-administration')).toBe(
      session,
    );
    const accounts = await personaIds();
    const activations = await ensureActivations(db.admin, operator);
    // Written by the first test; kept, never rewritten.
    expect(activations).toEqual({
      liveLearning: 'present',
      support: 'present',
      teacherStudent: 'present',
      donations: 'present',
    });

    const result = await seed(accounts, true);
    const printed = JSON.stringify(result);
    for (const secret of Object.values(PASSWORDS)) expect(printed).not.toContain(secret);
    expect(printed).not.toMatch(/scrypt|\$2[aby]\$|[0-9a-f]{32}:[0-9a-f]{64}/u);
    expect(result['role']).toBe('granted');

    const after = await status();
    expect(after.personas).toEqual(accounts);
    expect(after.teachingRole).toBe('present');
    expect(after.teachingGrant).toBe('live');
    expect(after.activations).toEqual({
      liveLearning: 'fixture',
      support: 'fixture',
      teacherStudent: 'fixture',
      studentStudent: null,
      donations: 'fixture',
    });
    expect(after.courses).toEqual({
      'staging-demo-quranic-arabic': 'published',
      'staging-demo-study-skills': 'published',
    });
    expect(after.records).toMatchObject({
      enrolments: 2,
      lessonsCompleted: 3,
      attendance: 2,
      conversations: 2,
      membershipApplications: 2,
      donations: 2,
    });
    // Past classes held, upcoming ones scheduled with no meeting address.
    expect(
      await count(
        db.admin,
        'ClassSession',
        `[state] = N'completed' AND [startsAt] < SYSUTCDATETIME()`,
      ),
    ).toBe(2);
    expect(
      await count(
        db.admin,
        'ClassSession',
        `[state] = N'scheduled' AND [startsAt] > SYSUTCDATETIME() AND [meetingUrl] IS NULL`,
      ),
    ).toBe(2);
    // Money never moved: every donation is in the fixture environment.
    expect(await count(db.admin, 'Donation', `[environment] <> N'fixture'`)).toBe(0);
    expect(await count(db.admin, 'Donation', `[state] = N'succeeded'`)).toBe(2);
    // The member's application is approved into a Membership; the student's waits.
    expect(
      await count(db.admin, 'Membership', `[memberUserId] = ${n(accounts.member)}`),
    ).toBe(1);
    expect(
      await count(
        db.admin,
        'MembershipApplication',
        `[applicantUserId] = ${n(accounts.student)} AND [status] = N'under_review'`,
      ),
    ).toBe(1);
    // The privilege was granted by the OPERATOR, audited — never self-granted.
    expect(
      await count(
        db.admin,
        'AuditLog',
        `[action] = N'identity.assignment.granted' AND [actorId] = ${n(operator)}`,
      ),
    ).toBe(1);
  }, 900_000);

  it('is idempotent: a second seed changes nothing', async () => {
    const before = await status();
    const sessions = await count(db.admin, 'ClassSession');
    const messages = await count(db.admin, 'Message');
    const accounts = await personaIds();
    expect(accounts).toEqual(before.personas);
    const result = await seed(accounts, false);
    expect(result['role']).toBe('kept');
    expect(await status()).toEqual(before);
    expect(await count(db.admin, 'ClassSession')).toBe(sessions);
    expect(await count(db.admin, 'Message')).toBe(messages);
  }, 900_000);

  it('resets ONLY the demo: personas closed and disposed, catalogue archived, the rest untouched', async () => {
    const accounts = await livePersonas(db.admin);
    // A real person's enrolment on a demo course survives the reset.
    const [course] = await db.admin.query<{ id: string }>(
      `SELECT [id] FROM [dbo].[Course] WHERE [slug] = N'staging-demo-study-skills';`,
    );
    await db.admin.query(
      `INSERT INTO [dbo].[Enrolment] ([userId],[courseId],[enrolledAt]) VALUES (${n(realAccount)}, ${n(course?.id ?? '')}, SYSUTCDATETIME());`,
    );
    const others = await count(
      db.admin,
      'User',
      `[status] = N'active' AND [id] NOT LIKE N'staging-demo-%'`,
    );

    const result = await runMigrationTool({
      runtime,
      entry: DEMO_TOOL_ENTRY,
      args: [
        'reset',
        '--operator',
        operator,
        '--student',
        accounts.student ?? '',
        '--teacher',
        accounts.teacher ?? '',
        '--member',
        accounts.member ?? '',
      ],
      environment: process.env,
      label: 'staging demo reset',
    });
    expect(result['closed']).toBe(3);

    const after = await status();
    expect(after.personas).toEqual({ student: null, teacher: null, member: null });
    expect(after.retiredPersonas).toBe(3);
    expect(after.courses).toEqual({
      'staging-demo-quranic-arabic': 'archived',
      'staging-demo-study-skills': 'archived',
    });
    const ids = Object.values(accounts)
      .map((id) => n(id ?? ''))
      .join(', ');
    for (const [table, column] of [
      ['Enrolment', 'userId'],
      ['LessonProgress', 'userId'],
      ['SavedItem', 'userId'],
      ['PrivateCollection', 'userId'],
      ['ConversationParticipant', 'userId'],
      ['Session', 'userId'],
      ['Account', 'userId'],
    ] as const)
      expect(await count(db.admin, table, `[${column}] IN (${ids})`), table).toBe(0);
    // Financial records stay, released from the person, as the product requires.
    expect(await count(db.admin, 'Donation', `[donorUserId] IN (${ids})`)).toBe(0);
    // Untouched: the real person, their enrolment, the operator.
    expect(await count(db.admin, 'Enrolment', `[userId] = ${n(realAccount)}`)).toBe(1);
    expect(
      await count(
        db.admin,
        'User',
        `[status] = N'active' AND [id] NOT LIKE N'staging-demo-%'`,
      ),
    ).toBe(others);
  }, 900_000);

  it('seeds a NEW generation after a reset; closed personas are never reopened', async () => {
    await grantFor(db.admin, operator, session, 'privilege-administration');
    const accounts = await personaIds();
    expect(accounts.student).toBe('staging-demo-student-2');
    await seed(accounts, true);
    const after = await status();
    expect(after.personas).toEqual(accounts);
    expect(after.retiredPersonas).toBe(3);
    expect(after.courses).toEqual({
      'staging-demo-quranic-arabic': 'published',
      'staging-demo-study-skills': 'published',
    });
  }, 900_000);
});
