import { spawnSync } from 'node:child_process';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ResolvedSession } from '../../packages/contracts/src/identity/index.ts';
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
  HOST_STEP_UP_TOOL_ENTRY,
  runMigrationTool,
} from '../../packages/database/src/lifecycle/migration-proof-operator.ts';
import { liveCanonicalSession } from '../../packages/database/src/lifecycle/quran-reference.ts';
import {
  openSession,
  parseSqlServerUrl,
  type SqlServerConnection,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import { repoRoot } from '../architecture/architecture-harness.ts';
import { accountWith, count, n, sessionFor } from '../quran/fixture-sql.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from './harness.ts';

/**
 * OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP against a REAL SQL Server:
 * the operations tool, as the least-privilege RUNTIME principal in a child
 * process, issues the browser's grant through Identity's service; the REAL
 * gate then honours it, and the Quran reference import's own lookup finds its
 * session. Every refusal — wrong deployment, indexable build, unknown purpose,
 * missing permission, no live session, a lifetime above the cap, an inactive
 * account, a database that is not an approved target — writes nothing.
 *
 * Synthetic accounts only; no credential anywhere.
 */

const live = databaseConfigured ? describe : describe.skip;

const STAGING_POSTURE = {
  MINHAJ_DEPLOYMENT_ENVIRONMENT: 'staging',
  PUBLIC_INDEXING_ENABLED: 'false',
} as const;

/** The second-factor posture an administrator must hold for the gate. */
async function completePosture(db: DisposableDatabase, accountId: string): Promise<void> {
  await db.admin.query(`
    UPDATE [dbo].[User] SET [twoFactorEnabled] = 1, [emailVerified] = 1 WHERE [id] = ${n(accountId)};
    INSERT INTO [dbo].[TwoFactor] ([secret],[backupCodes],[userId],[verified])
      VALUES (N'not-a-real-secret-host-step-up', N'not-real-codes-host-step-up', ${n(accountId)}, 1);
    INSERT INTO [dbo].[PrivilegedSecurityPosture] ([userId],[secondFactorVerifiedAt],[recoveryCodesIssuedAt],[recoveryCodesConfirmedAt])
      VALUES (${n(accountId)}, SYSUTCDATETIME(), SYSUTCDATETIME(), SYSUTCDATETIME());
  `);
}

live('staging host-issued step-up against real SQL Server', () => {
  let db: DisposableDatabase;
  let runtime: SqlServerConnection;
  let runtimeSource: string;
  let operator: string;
  let session: string;

  const grants = (accountId: string) =>
    count(db.admin, 'StepUpGrant', `[userId] = ${n(accountId)}`);
  const audits = (accountId: string) =>
    count(
      db.admin,
      'AuditLog',
      `[action] = N'identity.security.step-up-granted' AND [targetId] = ${n(accountId)}`,
    );

  function grant(
    accountId: string,
    purpose: string,
    minutes: string,
    environment: Record<string, string | undefined> = {
      ...process.env,
      ...STAGING_POSTURE,
    },
  ) {
    return runMigrationTool({
      runtime,
      entry: HOST_STEP_UP_TOOL_ENTRY,
      args: ['grant', '--account', accountId, '--purpose', purpose, '--minutes', minutes],
      environment,
      label: 'host step-up',
    });
  }

  beforeAll(async () => {
    runtimeSource = getDatabaseRuntimeUrl();
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
    await (await openSession(runtime)).close();

    operator = await accountWith(db.admin, ['quran.editCanonical', 'quran.read']);
    await completePosture(db, operator);
    session = await sessionFor(db.admin, operator);
  }, 600_000);

  afterAll(async () => {
    await db?.close();
  }, 120_000);

  it('issues the grant the real gate honours, bound to the live session, and audits it as host-issued', async () => {
    const result = await grant(operator, 'quran-canonical-edit', '15');
    expect(result['ok']).toBe(true);
    expect(result['sessionId']).toBe(session);
    expect(result['purpose']).toBe('quran-canonical-edit');
    expect(JSON.stringify(result)).not.toMatch(/proof-quran-|password|token/iu);

    const [row] = await db.admin.query<{ sessionId: string; minutes: number }>(`
      SELECT [sessionId], DATEDIFF(second, SYSUTCDATETIME(), [expiresAt]) / 60.0 AS [minutes]
      FROM [dbo].[StepUpGrant] WHERE [userId] = ${n(operator)};
    `);
    expect(row?.sessionId).toBe(session);
    expect(Number(row?.minutes)).toBeGreaterThan(13);
    expect(Number(row?.minutes)).toBeLessThanOrEqual(15);

    const [audit] = await db.admin.query<{
      actorType: string;
      actorId: string | null;
      afterState: string;
      authorisingSource: string;
    }>(`
      SELECT [actorType], [actorId], [afterState], [authorisingSource] FROM [dbo].[AuditLog]
      WHERE [action] = N'identity.security.step-up-granted' AND [targetId] = ${n(operator)};
    `);
    expect(audit?.actorType).toBe('operator');
    expect(audit?.actorId).toBeNull();
    expect(audit?.authorisingSource).toBe(
      'OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP',
    );
    expect(JSON.parse(audit?.afterState ?? '{}')).toEqual({
      purpose: 'quran-canonical-edit',
      issuance: 'staging-host',
      lifetimeSeconds: '900',
    });

    // The REAL gate, unchanged, honours it for exactly that purpose.
    const { createAuthorizationReader } =
      await import('../../packages/database/src/adapters/identity-access/index.ts');
    const { createAuthorizationService } =
      await import('../../packages/server-core/src/authorization/index.ts');
    const gate = createAuthorizationService({ reader: createAuthorizationReader() });
    const now = new Date();
    const resolved: ResolvedSession = {
      sessionId: session,
      sessionCreatedAt: now,
      sessionExpiresAt: now,
      account: {
        id: operator,
        email: '',
        emailVerified: true,
        name: '',
        locale: 'en',
        timezone: null,
        status: 'active',
        accountSetupCompletedAt: null,
        createdAt: now,
      },
    };
    const allowed = await gate.requirePrivilegedAction({
      session: resolved,
      permission: 'quran.editCanonical',
      stepUp: 'quran-canonical-edit',
    });
    expect(allowed.state).toBe('allowed');
    const otherPurpose = await gate.requirePrivilegedAction({
      session: resolved,
      permission: 'quran.editCanonical',
      stepUp: 'hadith-canonical-edit',
    });
    expect(otherPurpose.state).toBe('denied');

    // And the Quran reference import finds the session by itself.
    expect(await liveCanonicalSession(db.admin, operator)).toBe(session);
  }, 600_000);

  const refusals: readonly {
    readonly name: string;
    readonly reason: RegExp;
    readonly prepare: () => Promise<{
      accountId: string;
      purpose?: string;
      minutes?: string;
      environment?: Record<string, string | undefined>;
    }>;
  }[] = [
    {
      name: 'a process that does not declare the staging deployment',
      reason: /not-staging/u,
      prepare: async () => ({
        accountId: operator,
        environment: {
          ...process.env,
          ...STAGING_POSTURE,
          MINHAJ_DEPLOYMENT_ENVIRONMENT: 'production',
        },
      }),
    },
    {
      name: 'an indexable build',
      reason: /not-staging/u,
      prepare: async () => ({
        accountId: operator,
        environment: {
          ...process.env,
          ...STAGING_POSTURE,
          PUBLIC_INDEXING_ENABLED: 'true',
        },
      }),
    },
    {
      name: 'an unknown purpose',
      reason: /unknown-purpose/u,
      prepare: async () => ({ accountId: operator, purpose: 'everything' }),
    },
    {
      name: 'a lifetime above the fifteen-minute cap',
      reason: /invalid-lifetime/u,
      prepare: async () => ({ accountId: operator, minutes: '16' }),
    },
    {
      name: 'an account without the purpose’s permission',
      reason: /no-permission/u,
      prepare: async () => ({ accountId: operator, purpose: 'migration-publication' }),
    },
    {
      name: 'an account with no live session',
      reason: /no-live-session/u,
      prepare: async () => {
        const accountId = await accountWith(db.admin, ['quran.editCanonical']);
        await completePosture(db, accountId);
        const expired = await sessionFor(db.admin, accountId);
        await db.admin.query(
          `UPDATE [dbo].[Session] SET [expiresAt] = DATEADD(minute, -1, SYSUTCDATETIME()) WHERE [id] = ${n(expired)};`,
        );
        return { accountId };
      },
    },
    {
      name: 'an inactive account',
      reason: /account-inactive/u,
      prepare: async () => {
        const accountId = await accountWith(db.admin, ['quran.editCanonical']);
        await completePosture(db, accountId);
        await sessionFor(db.admin, accountId);
        await db.admin.query(
          `UPDATE [dbo].[User] SET [status] = N'suspended' WHERE [id] = ${n(accountId)};`,
        );
        return { accountId };
      },
    },
    {
      name: 'an account without a complete second-factor posture',
      reason: /second-factor-required/u,
      prepare: async () => {
        const accountId = await accountWith(db.admin, ['quran.editCanonical']);
        await sessionFor(db.admin, accountId);
        return { accountId };
      },
    },
  ];

  for (const { name, reason, prepare } of refusals)
    it(`refuses ${name}, writing no grant and no audit record`, async () => {
      const input = await prepare();
      const grantsBefore = await grants(input.accountId);
      const auditsBefore = await audits(input.accountId);
      await expect(
        grant(
          input.accountId,
          input.purpose ?? 'quran-canonical-edit',
          input.minutes ?? '5',
          input.environment,
        ),
      ).rejects.toThrow(reason);
      expect(await grants(input.accountId)).toBe(grantsBefore);
      expect(await audits(input.accountId)).toBe(auditsBefore);
    }, 600_000);

  it('refuses a database that is not an approved target before connecting', () => {
    // The real runtime URL, naming the long-lived local database rather than
    // a disposable one: the tool refuses it outright.
    const url = runtimeSource;
    expect(parseSqlServerUrl(url).database).not.toBe(db.name);
    const outcome = spawnSync(
      process.execPath,
      [
        '--conditions=react-server',
        HOST_STEP_UP_TOOL_ENTRY,
        'grant',
        '--account',
        operator,
        '--purpose',
        'quran-canonical-edit',
        '--minutes',
        '5',
      ],
      {
        cwd: repoRoot,
        env: {
          PATH: process.env['PATH'],
          SystemRoot: process.env['SystemRoot'],
          DATABASE_URL: url,
          ...STAGING_POSTURE,
        },
        encoding: 'utf8',
        timeout: 300_000,
      },
    );
    expect(outcome.status).toBe(1);
    const last = JSON.parse(
      outcome.stdout.trimEnd().split('\n').at(-1) ?? '{}',
    ) as Record<string, unknown>;
    expect(last['ok']).toBe(false);
    expect(String(last['error'])).toMatch(/neither MinhajStaging .* nor a disposable/u);
  }, 600_000);
});

describe('the staging step-up commands, before any database connection', () => {
  it('loads the runtime tool under plain Node and refuses an unapproved database', () => {
    // Runs in every environment, CI's Verify job included: Node strips types
    // only, so this also proves the tool's whole import graph is node-runnable
    // (no parameter properties, enums or bundler aliases anywhere in it).
    const outcome = spawnSync(
      process.execPath,
      [
        '--conditions=react-server',
        HOST_STEP_UP_TOOL_ENTRY,
        'grant',
        '--account',
        'host-step-up-admin-1',
        '--purpose',
        'quran-canonical-edit',
        '--minutes',
        '5',
      ],
      {
        cwd: repoRoot,
        env: {
          PATH: process.env['PATH'],
          SystemRoot: process.env['SystemRoot'],
          // A synthetic sentinel naming a long-lived database; never a credential.
          DATABASE_URL:
            'sqlserver://localhost:1433;database=MinhajPlatform;user=SENTINEL;password={SENTINEL}',
          ...STAGING_POSTURE,
        },
        encoding: 'utf8',
        timeout: 300_000,
      },
    );
    expect(outcome.status).toBe(1);
    const last = JSON.parse(
      outcome.stdout.trimEnd().split('\n').at(-1) ?? '{}',
    ) as Record<string, unknown>;
    expect(last['command']).toBe('host-step-up');
    expect(last['ok']).toBe(false);
    expect(String(last['error'])).toMatch(/neither MinhajStaging .* nor a disposable/u);
    expect(outcome.stdout + outcome.stderr).not.toContain('SENTINEL');
  }, 300_000);

  it('refuses outside the proved staging target, before any connection', () => {
    // Declared staging and non-indexable, but none of the staging guard's
    // configuration: the whole guard refuses.
    const outcome = spawnSync(
      process.execPath,
      [
        '--conditions=react-server',
        'packages/database/scripts/staging-step-up.ts',
        'grant',
        '--account',
        'host-step-up-admin-1',
        '--purpose',
        'quran-canonical-edit',
      ],
      {
        cwd: repoRoot,
        env: {
          PATH: process.env['PATH'],
          SystemRoot: process.env['SystemRoot'],
          ...STAGING_POSTURE,
        },
        encoding: 'utf8',
        timeout: 300_000,
      },
    );
    expect(outcome.status).toBe(1);
    const last = JSON.parse(
      outcome.stdout.trimEnd().split('\n').at(-1) ?? '{}',
    ) as Record<string, unknown>;
    expect(last['command']).toBe('staging:step-up');
    expect(last['ok']).toBe(false);
    expect(String(last['error'])).not.toMatch(/password|sqlserver:\/\//iu);
  }, 300_000);

  it('refuses an indexable or undeclared deployment before reading any configuration', () => {
    for (const posture of [
      { PUBLIC_INDEXING_ENABLED: 'false' },
      { MINHAJ_DEPLOYMENT_ENVIRONMENT: 'staging', PUBLIC_INDEXING_ENABLED: 'true' },
    ]) {
      const outcome = spawnSync(
        process.execPath,
        [
          '--conditions=react-server',
          'packages/database/scripts/staging-step-up.ts',
          'grant',
          '--account',
          'host-step-up-admin-1',
          '--purpose',
          'quran-canonical-edit',
        ],
        {
          cwd: repoRoot,
          env: {
            PATH: process.env['PATH'],
            SystemRoot: process.env['SystemRoot'],
            ...posture,
          },
          encoding: 'utf8',
          timeout: 300_000,
        },
      );
      expect(outcome.status).toBe(1);
      const last = JSON.parse(
        outcome.stdout.trimEnd().split('\n').at(-1) ?? '{}',
      ) as Record<string, unknown>;
      expect(String(last['error'])).toMatch(/staging-only|non-indexable/u);
    }
  }, 300_000);
});
