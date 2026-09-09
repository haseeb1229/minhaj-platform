import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getApplicationPrincipalCredentials,
  getDatabaseMigrationUrl,
} from '../../packages/database/src/config.ts';
import { provisionApplicationPrincipal } from '../../packages/database/src/lifecycle/application-principal.ts';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  newDisposableDatabaseName,
  openMasterSession,
} from '../../packages/database/src/lifecycle/disposable-database.ts';
import {
  appliedMigrationNames,
  deployMigrations,
  loadMigrations,
  migrationStatus,
  rollbackMigration,
  runPrismaCli,
  type Migration,
} from '../../packages/database/src/lifecycle/migrations.ts';
import { runSeed } from '../../packages/database/src/lifecycle/seed.ts';
import {
  openSession,
  parseSqlServerUrl,
  withDatabase,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';

/**
 * Live Phase 1 lifecycle proof, against real SQL Server.
 *
 * Each stage inspects `sys.tables`, `sys.columns` and `sys.database_permissions`
 * rather than trusting a command's exit code, and every prohibition asserts the
 * SQL Server error number so a statement cannot "pass" by being malformed.
 *
 * Runs against a disposable `MinhajPhase1Test_<uuid>` database created and
 * dropped here. It never touches `MinhajPlatform`, the system databases, or the
 * unrelated host SQLEXPRESS instance.
 *
 * Skipped when no database is configured, so the suite still runs on a machine
 * without the container. It is executed for real by `npm run db:migrate:test`
 * and `npm run db:test:permissions`.
 */

const configured = (() => {
  try {
    getDatabaseMigrationUrl();
    getApplicationPrincipalCredentials();
    return true;
  } catch {
    return false;
  }
})();

const PERMISSION_DENIED = new Set([229, 230, 262, 1088, 3701]);

interface SqlError extends Error {
  number?: number;
}

async function denialErrorNumber(
  session: SqlSession,
  statement: string,
): Promise<number | undefined> {
  try {
    await session.query(statement);
    return undefined;
  } catch (error) {
    return (error as SqlError).number;
  }
}

describe.skipIf(!configured)('Phase 1 database lifecycle (live SQL Server)', () => {
  const databaseName = newDisposableDatabaseName();
  let master: SqlSession;
  let admin: SqlSession;
  let app: SqlSession;
  let migration: Migration;
  /** The normal encrypted migration URL, retargeted at the disposable database. */
  let disposableUrl: string;

  beforeAll(async () => {
    const migrationUrl = getDatabaseMigrationUrl();
    const connection = parseSqlServerUrl(migrationUrl);
    const principal = getApplicationPrincipalCredentials();

    disposableUrl = migrationUrl.replace(
      `database=${connection.database}`,
      `database=${databaseName}`,
    );

    const migrations = await loadMigrations();
    const first = migrations[0];
    if (first === undefined) throw new Error('No migrations to test.');
    migration = first;

    master = await openMasterSession(connection);
    await createDisposableDatabase(master, databaseName);
    admin = await openSession(withDatabase(connection, databaseName));

    // The REAL Prisma CLI over the normal encrypted configuration.
    await deployMigrations(disposableUrl);
    await provisionApplicationPrincipal(
      admin,
      principal.DATABASE_APP_LOGIN,
      principal.DATABASE_APP_PASSWORD,
    );

    app = await openSession({
      ...withDatabase(connection, databaseName),
      user: principal.DATABASE_APP_LOGIN,
      password: principal.DATABASE_APP_PASSWORD,
    });
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await admin?.close();
    if (master !== undefined) {
      await dropDisposableDatabase(master, databaseName);
      await master.close();
    }
  }, 120_000);

  it('creates the audit table with the expected shape', async () => {
    const columns = await admin.query<{ name: string }>(`
      SELECT c.name FROM sys.columns c
      WHERE c.object_id = OBJECT_ID(N'[dbo].[AuditLog]') ORDER BY c.name;
    `);

    expect(columns.map((column) => column.name)).toEqual([
      'action',
      'actorId',
      'actorType',
      'afterState',
      'authorisingSource',
      'beforeState',
      'id',
      'ipAddress',
      'occurredAt',
      'targetId',
      'targetType',
    ]);
  });

  it('creates no business-domain table', async () => {
    const tables = await admin.query<{ name: string }>(`
      SELECT t.name FROM sys.tables t
      JOIN sys.schemas s ON s.schema_id = t.schema_id
      WHERE s.name = 'dbo' ORDER BY t.name;
    `);

    expect(tables.map((table) => table.name).sort()).toEqual([
      'AuditLog',
      '_prisma_migrations',
    ]);
  });

  it('runs the application as a principal that is neither sa nor an owner', async () => {
    const [identity] = await app.query<{
      login: string;
      isSysadmin: number;
      isDbOwner: number;
      ownsDatabase: number;
    }>(`
      SELECT
        SUSER_SNAME()                AS login,
        IS_SRVROLEMEMBER('sysadmin') AS isSysadmin,
        IS_ROLEMEMBER('db_owner')    AS isDbOwner,
        CASE WHEN EXISTS (
          SELECT 1 FROM sys.databases d
          WHERE d.name = DB_NAME() AND d.owner_sid = SUSER_SID()
        ) THEN 1 ELSE 0 END          AS ownsDatabase;
    `);

    expect(identity?.login).not.toBe('sa');
    expect(Number(identity?.isSysadmin)).toBe(0);
    expect(Number(identity?.isDbOwner)).toBe(0);
    expect(Number(identity?.ownsDatabase)).toBe(0);
  });

  it('permits the application to insert and read audit rows', async () => {
    await app.query(`
      INSERT INTO [dbo].[AuditLog]
        ([id], [actorType], [action], [targetType], [targetId], [authorisingSource], [ipAddress])
      VALUES
        (NEWID(), N'system', N'phase1.lifecycle.probe', N'Database', N'test',
         N'vitest', N'127.0.0.1');
    `);

    const [row] = await app.query<{ total: number }>(
      'SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog];',
    );
    expect(Number(row?.total)).toBe(1);
  });

  it('denies the application UPDATE and DELETE on audit rows', async () => {
    const updateError = await denialErrorNumber(
      app,
      `UPDATE [dbo].[AuditLog] SET [action] = N'tampered';`,
    );
    const deleteError = await denialErrorNumber(app, 'DELETE FROM [dbo].[AuditLog];');

    expect(updateError, 'UPDATE must be denied').toBeDefined();
    expect(deleteError, 'DELETE must be denied').toBeDefined();
    expect(PERMISSION_DENIED.has(updateError ?? 0)).toBe(true);
    expect(PERMISSION_DENIED.has(deleteError ?? 0)).toBe(true);

    // The row is intact — the denial protected data, it did not merely error.
    const [row] = await admin.query<{ total: number; action: string }>(
      'SELECT COUNT_BIG(*) AS total, MIN([action]) AS action FROM [dbo].[AuditLog];',
    );
    expect(Number(row?.total)).toBe(1);
    expect(row?.action).toBe('phase1.lifecycle.probe');
  });

  it('denies the application every form of schema-changing DDL', async () => {
    // The DDL refusals name the object as possibly missing, so visibility is
    // established first: denial plus visibility is a permission boundary.
    const [visible] = await app.query<{ objectId: number | null }>(
      `SELECT OBJECT_ID(N'[dbo].[AuditLog]') AS objectId;`,
    );
    expect(visible?.objectId).not.toBeNull();

    for (const statement of [
      'CREATE TABLE [dbo].[RuntimeShouldNotCreateThis] ([id] INT NOT NULL);',
      'ALTER TABLE [dbo].[AuditLog] ADD [injectedColumn] NVARCHAR(16) NULL;',
      'DROP TABLE [dbo].[AuditLog];',
      'TRUNCATE TABLE [dbo].[AuditLog];',
    ]) {
      const number = await denialErrorNumber(app, statement);
      expect(number, `${statement} must be denied`).toBeDefined();
      expect(
        PERMISSION_DENIED.has(number ?? 0),
        `${statement} was rejected with error ${number}, not a permission denial`,
      ).toBe(true);
    }

    // Nothing was created despite the attempt.
    const created = await admin.query<{ name: string }>(`
      SELECT name FROM sys.tables WHERE name = N'RuntimeShouldNotCreateThis';
    `);
    expect(created).toHaveLength(0);
  });

  it('holds no UPDATE or DELETE grant on the audit table', async () => {
    const grants = await admin.query<{ permission: string; state: string }>(`
      SELECT p.permission_name AS permission, p.state_desc AS state
      FROM sys.database_permissions p
      JOIN sys.database_principals u ON u.principal_id = p.grantee_principal_id
      WHERE p.major_id = OBJECT_ID(N'[dbo].[AuditLog]')
        AND u.name = N'${getApplicationPrincipalCredentials().DATABASE_APP_LOGIN}';
    `);

    const granted = grants
      .filter((grant) => grant.state === 'GRANT')
      .map((grant) => grant.permission.trim())
      .sort();

    expect(granted).toEqual(['INSERT', 'SELECT']);
    expect(granted).not.toContain('UPDATE');
    expect(granted).not.toContain('DELETE');
  });

  it('seeds idempotently', async () => {
    const first = await runSeed(admin);
    const second = await runSeed(admin);

    expect(second).toEqual(first);
    expect(first.seededRecords).toBe(0);
  });

  it('uses the encrypted migration URL, with no plaintext fallback', () => {
    expect(disposableUrl).toMatch(/encrypt=true/i);
    expect(disposableUrl).not.toMatch(/encrypt=false/i);
    expect(disposableUrl).toContain(databaseName);
  });

  it('reports a healthy prisma migrate status after deploy', async () => {
    const status = await migrationStatus(disposableUrl);

    expect(status.exitCode).toBe(0);
    expect(status.output).toContain('Database schema is up to date!');
    expect(status.output).not.toMatch(/not yet been applied|failed/i);
  }, 120_000);

  it('fails loudly when the Prisma CLI cannot connect, rather than falling back', async () => {
    // P1011 or any other CLI failure must surface as a thrown error. If this
    // resolved, the gate could go green without the real workflow running.
    const unreachable = disposableUrl.replace(':14330;', ':14399;');

    await expect(migrationStatus(unreachable)).rejects.toThrow(
      /failed with exit code|no fallback path/i,
    );
  }, 120_000);

  it('rolls back and re-deploys through the real CLI, ending in the same schema', async () => {
    // A second, unrelated history row proves the rollback removes ONLY its own.
    const decoyId = 'MinhajPhase1TestDecoy_do_not_remove';
    await admin.query(`
      INSERT INTO [dbo].[_prisma_migrations]
        ([id], [checksum], [finished_at], [migration_name], [started_at], [applied_steps_count])
      VALUES
        (NEWID(), 'decoy', SYSUTCDATETIME(), N'${decoyId}', SYSUTCDATETIME(), 1);
    `);

    await rollbackMigration(admin, migration);

    const afterRollback = await admin.query<{ name: string }>(
      `SELECT name FROM sys.tables WHERE name = N'AuditLog';`,
    );
    expect(afterRollback).toHaveLength(0);

    const historyAfterRollback = await appliedMigrationNames(admin);
    expect(historyAfterRollback).not.toContain(migration.id);
    // Only the exact matching row was removed.
    expect(historyAfterRollback).toContain(decoyId);

    // REAL `prisma migrate deploy` again — it must genuinely re-apply, which it
    // can only do because the rollback removed the history row.
    const redeploy = await deployMigrations(disposableUrl);
    expect(redeploy.exitCode).toBe(0);
    expect(redeploy.output).toContain(migration.id);

    const afterReapply = await admin.query<{ name: string }>(
      `SELECT name FROM sys.tables WHERE name = N'AuditLog';`,
    );
    expect(afterReapply).toHaveLength(1);
    expect(await appliedMigrationNames(admin)).toContain(migration.id);
    expect(await appliedMigrationNames(admin)).toContain(decoyId);

    const status = await migrationStatus(disposableUrl);
    expect(status.output).toContain('Database schema is up to date!');

    await admin.query(
      `DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name] = N'${decoyId}';`,
    );
  }, 180_000);

  it('runs the CLI without exposing the connection URL on the command line', async () => {
    // The URL travels in the child environment, not argv, so it never reaches
    // the process table where any local user could read it.
    const result = await runPrismaCli(['migrate', 'status'], disposableUrl);

    expect(result.exitCode).toBe(0);
    expect(result.command).not.toContain(disposableUrl);
    expect(result.command).not.toMatch(/password/i);
  }, 120_000);
});
