import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

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
  MIGRATION_PROOF_ENTRY,
  assertMigrationProofDatabase,
  createMigrationProofOperator,
  removeMigrationProofOperator,
  runMigrationFixtureProof,
} from '../../packages/database/src/lifecycle/migration-proof-operator.ts';
import {
  parseSqlServerUrl,
  type SqlServerConnection,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { createProofAccount } from '../people/harness.ts';

/**
 * Phase 29 — the migration FIXTURE PROOF, run locally against a disposable
 * `MinhajPhase1Test_<32 hex>` database exactly as the staging command runs it
 * against `MinhajStaging`: the synthetic operator written by the owner
 * session through the lifecycle helper, the proof in a CHILD PROCESS as the
 * provisioned RUNTIME principal (its environment carries the runtime URL and
 * nothing else of the database), and the operator's authority removed and
 * proven gone afterwards.
 *
 * The proof starts the loopback fixture server itself and talks to no other
 * host. Acquired fixture assets go to a temporary storage root through the
 * real Storage service and the local ClamAV.
 */

const live = databaseConfigured ? describe : describe.skip;

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const RUN_FIXTURE = path.join('scripts', 'migration', 'run-fixture.ts');
const PROMOTE = path.join('scripts', 'migration', 'promote.ts');

/** Starts one tooling entry directly, with exactly the environment given. */
function runEntry(
  environment: Record<string, string>,
  args: readonly string[],
  entry: string = MIGRATION_PROOF_ENTRY,
) {
  const child = spawn(process.execPath, ['--conditions=react-server', entry, ...args], {
    cwd: repoRoot,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString('utf8')));
  child.stderr.resume();
  return new Promise<{ code: number; last: Record<string, unknown> }>(
    (resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) =>
        resolve({
          code: code ?? 1,
          last: JSON.parse(output.trimEnd().split('\n').at(-1) ?? '{}') as Record<
            string,
            unknown
          >,
        }),
      );
    },
  );
}

const BASE_ENVIRONMENT = (): Record<string, string> => {
  const keep: Record<string, string> = {};
  for (const key of [
    'PATH',
    'Path',
    'SystemRoot',
    'TEMP',
    'TMP',
    'HOME',
    'USERPROFILE',
  ]) {
    const value = process.env[key];
    if (value !== undefined) keep[key] = value;
  }
  return keep;
};

describe('Phase 29 migration proof target guard', () => {
  it('admits MinhajStaging and a disposable database, and nothing else', () => {
    expect(assertMigrationProofDatabase('MinhajStaging')).toBe('staging');
    expect(
      assertMigrationProofDatabase('MinhajPhase1Test_0123456789abcdef0123456789abcdef'),
    ).toBe('disposable');
    for (const name of [
      'MinhajPlatform',
      'master',
      'MinhajStagingRestore_0123456789abcdef0123456789abcdef',
      'MinhajPhase1Test_short',
      'minhajstaging',
      '',
    ])
      expect(() => assertMigrationProofDatabase(name), name).toThrow(/Refusing/);
  });

  it('the proof process refuses any database URL that is not an approved target, before connecting', async () => {
    const operator = '00000000-0000-4000-8000-000000000001';
    for (const url of [
      'sqlserver://localhost:14330;database=MinhajPlatform;user=x;password={y};encrypt=true',
      'sqlserver://db.example.invalid:1433;database=MinhajStaging;user=x;password={y};encrypt=true',
      'sqlserver://sqlserver:1433;database=MinhajPhase1Test_0123456789abcdef0123456789abcdef;user=x;password={y}',
      'sqlserver://localhost:14330;database=MinhajStaging;user=x;password={y}',
      'postgres://localhost/MinhajStaging',
    ]) {
      const { code, last } = await runEntry(
        { ...BASE_ENVIRONMENT(), DATABASE_URL: url },
        ['--operator', operator, '--session', operator],
      );
      expect(code, url).toBe(1);
      expect(last['ok'], url).toBe(false);
      expect(String(last['error']), url).toMatch(/refusing/);
      // The refusal never echoes the URL or its password.
      expect(JSON.stringify(last), url).not.toContain('password');
    }
  }, 120_000);
});

live('Phase 29 migration fixture proof against a disposable database', () => {
  let db: DisposableDatabase;
  let runtime: SqlServerConnection;
  let runtimeUrl: string;
  let storageRoot: string;

  beforeAll(async () => {
    const runtimeSource = getDatabaseRuntimeUrl();
    db = await createProofDatabase();
    const runtimeTarget = parseSqlServerUrl(runtimeSource);
    runtimeUrl = runtimeSource.replace(
      `database=${runtimeTarget.database}`,
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
    storageRoot = await mkdtemp(
      path.join(os.tmpdir(), 'minhaj-migration-proof-storage-'),
    );
  }, 300_000);

  afterAll(async () => {
    await db?.close();
    if (storageRoot !== undefined)
      await rm(storageRoot, { recursive: true, force: true });
  }, 120_000);

  it('runs the whole proof as the runtime principal and removes the operator afterwards', async () => {
    const operator = await createMigrationProofOperator(db.admin);
    let summary: Record<string, unknown>;
    try {
      summary = await runMigrationFixtureProof({
        runtime,
        operator,
        environment: {
          ...process.env,
          STORAGE_ROOT: storageRoot,
          CLAMAV_HOST: process.env['CLAMAV_HOST'] || '127.0.0.1',
          CLAMAV_PORT: process.env['CLAMAV_PORT'] || '3310',
        },
      });
    } finally {
      const removal = await removeMigrationProofOperator(db.admin, operator.accountId);
      expect(removal).toEqual({
        assignmentsRevoked: 1,
        sessionsDeleted: 1,
        grantsDeleted: 1,
      });
    }

    expect(summary).toMatchObject({
      command: 'migration:staging-fixture-proof',
      ok: true,
      target: 'disposable',
      discovered: 12,
      publicAfterRollback: 0,
      deniedWithoutPrivilegedActor: 3,
      withdrawnPromotion: {
        promotedBeforeWithdrawal: 1,
        afterWithdrawal: 'approval-withdrawn',
      },
    });
    const published = Number(summary['published']);
    expect(published).toBeGreaterThanOrEqual(2);
    expect(summary['rolledBack']).toBe(published);
    expect(summary['legacyMappingsActivated']).toBe(published);
    expect(summary['legacyMappingsDisabled']).toBe(published);
    expect(summary['processed']).toEqual([5, 7]);

    // What the owner sees afterwards: every migrated Video archived, nothing
    // published; every legacy mapping disabled, none deleted; the operator's
    // acts audited; and its authority gone.
    const [state] = await db.admin.query<Record<string, number>>(`
      SELECT
        (SELECT COUNT(*) FROM [dbo].[Video] WHERE [state] = N'archived') AS [archived],
        (SELECT COUNT(*) FROM [dbo].[Video] WHERE [state] <> N'archived') AS [other],
        (SELECT COUNT(*) FROM [dbo].[MigrationLegacyMapping] WHERE [state] = N'disabled') AS [disabled],
        (SELECT COUNT(*) FROM [dbo].[MigrationLegacyMapping] WHERE [state] = N'active') AS [active],
        (SELECT COUNT(*) FROM [dbo].[AuditLog] WHERE [actorId] = N'${operator.accountId}' AND [action] LIKE N'migration.%') AS [audited],
        (SELECT COUNT(*) FROM [dbo].[RoleAssignment] WHERE [userId] = N'${operator.accountId}' AND [revokedAt] IS NULL) AS [assignments],
        (SELECT COUNT(*) FROM [dbo].[StepUpGrant] WHERE [userId] = N'${operator.accountId}') AS [grants];
    `);
    expect(state).toMatchObject({
      archived: published,
      other: 0,
      disabled: published,
      active: 0,
      assignments: 0,
      grants: 0,
    });
    expect(Number(state?.['audited'])).toBeGreaterThan(published);

    // Removal is idempotent, and it refuses an account that is not a proof operator.
    expect(await removeMigrationProofOperator(db.admin, operator.accountId)).toEqual({
      assignmentsRevoked: 0,
      sessionsDeleted: 0,
      grantsDeleted: 0,
    });
    const stranger = await createProofAccount(db.admin);
    await expect(removeMigrationProofOperator(db.admin, stranger)).rejects.toThrow(
      /not a generated identifier|not a migration proof operator/,
    );
  }, 900_000);

  it('runs, interrupts and resumes an export source through the fixture CLI, and refuses an unknown promotion', async () => {
    const operator = await createMigrationProofOperator(db.admin);
    try {
      // The source is registered through the same runner composition the CLI
      // loads, in this process, as the runtime principal.
      process.env['DATABASE_URL'] = runtimeUrl;
      const { composeMigrationRunner } =
        await import('../../apps/web/src/composition/migration-runner.ts');
      const runner = composeMigrationRunner();
      const key = `fixture-cli-${operator.accountId.slice(0, 8)}`;
      await runner.sources.createFixture(
        { accountId: operator.accountId },
        {
          key,
          name: 'FIXTURE CLI export',
          contentKind: 'media.video',
          accessMethod: 'export',
          baseUrl: null,
          hosts: [],
          defaultLanguageCode: null,
          policy: {
            minIntervalMs: 0,
            maxConcurrency: 1,
            maxAttempts: 3,
            timeoutMs: 5000,
            maxBodyBytes: 1024 * 1024,
            maxRedirects: 2,
          },
          licensingEvidence: null,
          policyNotes: null,
        },
      );
      const environment = { ...BASE_ENVIRONMENT(), DATABASE_URL: runtimeUrl };
      const args = ['--source', key, '--operator', operator.accountId];

      const first = await runEntry(
        environment,
        [...args, '--max-items', '3'],
        RUN_FIXTURE,
      );
      expect(first.code).toBe(0);
      expect(first.last).toMatchObject({
        command: 'migration:run-fixture',
        ok: true,
        source: key,
        resumed: false,
        state: 'interrupted',
        processed: 3,
      });
      const second = await runEntry(environment, args, RUN_FIXTURE);
      expect(second.code).toBe(0);
      expect(second.last).toMatchObject({
        ok: true,
        runId: first.last['runId'],
        resumed: true,
        state: 'completed',
        balanced: true,
      });
      const counts = second.last['counts'] as { discovered: number };
      expect(counts.discovered).toBe(3 + Number(second.last['processed']));

      // An unknown source and an unknown promotion are refusals, exit 1.
      const unknown = await runEntry(
        environment,
        ['--source', 'fixture-cli-none', '--operator', operator.accountId],
        RUN_FIXTURE,
      );
      expect(unknown.code).toBe(1);
      expect(unknown.last).toMatchObject({ ok: false });
      const promotion = await runEntry(
        environment,
        [
          '--promotion',
          '00000000-0000-4000-8000-0000000000ff',
          '--operator',
          operator.accountId,
          '--out',
          path.join(storageRoot, 'bundle'),
        ],
        PROMOTE,
      );
      expect(promotion.code).toBe(1);
      expect(promotion.last).toEqual({
        command: 'migration:promote',
        ok: false,
        refusal: 'not-found',
      });
    } finally {
      await removeMigrationProofOperator(db.admin, operator.accountId);
    }
  }, 600_000);
});
