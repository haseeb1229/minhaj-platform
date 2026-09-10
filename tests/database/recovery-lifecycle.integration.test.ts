import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getApplicationPrincipalCredentials,
  getDatabaseMigrationUrl,
} from '../../packages/database/src/config.ts';
import {
  backupArtifactExists,
  backupDatabase,
  newBackupTarget,
  newRestoreDatabaseName,
  restoreDatabaseFromBackup,
  type BackupResult,
  type BackupTarget,
} from '../../packages/database/src/lifecycle/backup.ts';
import { openMasterSession } from '../../packages/database/src/lifecycle/disposable-database.ts';
import { loadMigrations } from '../../packages/database/src/lifecycle/migrations.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import { resolveLocalDatabaseEnvironment } from '../../packages/database/src/lifecycle/local-environment.ts';
import {
  cleanUpRecoveryResources,
  RecoveryCleanupError,
} from '../../packages/database/src/lifecycle/recovery-cleanup.ts';
import {
  newRecoveryMarker,
  verifyRestoredMarker,
  writeRecoveryMarker,
  type RecoveryMarker,
} from '../../packages/database/src/lifecycle/recovery-proof.ts';
import {
  EXPECTED_AUDIT_COLUMNS,
  EXPECTED_AUDIT_INDEXES,
  inspectRestoredSecurity,
  verifyRestoredSchema,
} from '../../packages/database/src/lifecycle/restored-state.ts';
import {
  openSession,
  withDatabase,
  type SqlServerConnection,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';

/**
 * Live Phase 1 RECOVERY proof, against real SQL Server.
 *
 * A genuine `BACKUP DATABASE` of `MinhajPlatform`, restored into a fresh
 * `MinhajPhase1Restore_<uuid>` database, with the restored schema, migration
 * history, data and security posture read back out of the restored catalogue.
 * Nothing here copies rows, replays a migration or recreates schema.
 *
 * `MinhajPlatform` is only ever READ from and appended to. The restore target
 * is a database this run creates and drops; the artifact lives inside the
 * container and is deleted at the end.
 *
 * Skipped when no database is configured, so the suite still runs on a machine
 * without the container. It is executed for real by `npm run db:recovery:test`,
 * which is the mandatory local gate.
 */

const configured = (() => {
  try {
    if (!resolveLocalDatabaseEnvironment({ requireLocalFile: false }).localFilePresent) {
      return false;
    }
    getDatabaseMigrationUrl();
    getApplicationPrincipalCredentials();
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!configured)('Phase 1 recovery lifecycle (live SQL Server)', () => {
  const restoreDatabase = newRestoreDatabaseName();
  const marker: RecoveryMarker = newRecoveryMarker();
  const target: BackupTarget = newBackupTarget();

  let connection: SqlServerConnection;
  let master: SqlSession;
  let source: SqlSession;
  let restored: SqlSession;
  let backup: BackupResult;
  let migrationId: string;
  /** Audit rows present in the source at the moment the backup was taken. */
  let sourceRowCount: number;

  beforeAll(async () => {
    const migrationUrl = getDatabaseMigrationUrl();
    connection = assertApprovedLocalTarget(
      migrationUrl,
      localTargetPolicy(process.env, 'source', 'migration'),
    );

    const migrations = await loadMigrations();
    const first = migrations[0];
    if (first === undefined) throw new Error('No migrations to prove recoverable.');
    migrationId = first.id;

    master = await openMasterSession(connection);
    source = await openSession(connection);

    // Proof state, written to the source BEFORE the backup and never to the
    // restore target. Its presence afterwards is what distinguishes a genuine
    // restore from a schema recreation.
    await writeRecoveryMarker(source, marker);

    const [count] = await source.query<{ total: number }>(
      'SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog];',
    );
    sourceRowCount = Number(count?.total ?? 0);

    backup = await backupDatabase(source, connection.database, target);
    await restoreDatabaseFromBackup(master, target.path, restoreDatabase);

    restored = await openSession(withDatabase(connection, restoreDatabase));
  }, 240_000);

  afterAll(async () => {
    if (master === undefined) return;

    const outcome = await cleanUpRecoveryResources({
      master,
      source,
      restored,
      restoreDatabase,
      backupPath: target.path,
    });
    if (outcome.failures.length > 0) throw new RecoveryCleanupError(outcome.failures);
  }, 120_000);

  it('produced a genuine, verified full backup', () => {
    expect(backup.header.databaseName).toBe(connection.database);
    // 1 = full database backup.
    expect(backup.header.backupType).toBe(1);
    expect(backup.header.hasBackupChecksums).toBe(true);
    expect(backup.header.backupSize).toBeGreaterThan(0);
  });

  /**
   * The artifact's own file list, which is why the restore does not guess:
   * these logical names belong to the SOURCE and match no restore target.
   */
  it('reports logical file names that differ from the restore database name', () => {
    const names = backup.files.map((file) => file.logicalName);

    expect(names).toContain('MinhajPlatform');
    expect(names).toContain('MinhajPlatform_log');
    expect(names).not.toContain(restoreDatabase);
    expect(backup.files.some((file) => file.type === 'L')).toBe(true);
  });

  it('restored the audit table, its columns, indexes and migration history', async () => {
    const report = await verifyRestoredSchema(restored, migrationId);

    expect(report.tables).toContain('AuditLog');
    expect(report.tables).toContain('_prisma_migrations');
    expect(report.columns).toEqual(EXPECTED_AUDIT_COLUMNS);
    expect(report.migrations).toContain(migrationId);

    for (const index of EXPECTED_AUDIT_INDEXES) {
      expect(report.indexes).toContain(index);
    }
  });

  it('restored no business-domain schema', async () => {
    const report = await verifyRestoredSchema(restored, migrationId);
    expect(report.tables.toSorted()).toEqual(
      ['AuditLog', '_prisma_migrations'].toSorted(),
    );
  });

  /** The heart of the proof: data written before the backup came back intact. */
  it('restored the proof row with unchanged values', async () => {
    const row = await verifyRestoredMarker(restored, marker);

    expect(row.id.toLowerCase()).toBe(marker.id.toLowerCase());
    expect(row.targetId).toBe(marker.targetId);
    expect(row.action).toBe('phase1.recovery.proof');
    expect(row.authorisingSource).toBe('db:recovery:test');
  });

  it('restored every audit row present when the backup was taken', async () => {
    const [count] = await restored.query<{ total: number }>(
      'SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog];',
    );
    expect(Number(count?.total ?? 0)).toBe(sourceRowCount);
  });

  /**
   * The DATABASE-level security state travels inside the artifact. The
   * SERVER-level login binding does not — it is asserted separately below.
   */
  it('restored the least-privilege posture of the application principal', async () => {
    const login = getApplicationPrincipalCredentials().DATABASE_APP_LOGIN;
    const security = await inspectRestoredSecurity(restored, login);

    expect(security.userPresent).toBe(true);
    expect(security.ownsDatabase).toBe(false);
    expect(security.broadRoles).toEqual([]);

    const granted = security.auditPermissions
      .filter((entry) => entry.state === 'GRANT')
      .map((entry) => entry.permission);
    const denied = security.auditPermissions
      .filter((entry) => entry.state === 'DENY')
      .map((entry) => entry.permission);

    expect(granted).toContain('INSERT');
    expect(granted).toContain('SELECT');
    expect(denied).toContain('UPDATE');
    expect(denied).toContain('DELETE');
  });

  /**
   * Catalogue permissions state the design; this proves the restored database
   * ENFORCES it, using the actual runtime principal and asserting the SQL
   * Server error number so a statement cannot "pass" by being malformed.
   */
  it('denies audit UPDATE and DELETE in the restored database', async () => {
    const principal = getApplicationPrincipalCredentials();
    const security = await inspectRestoredSecurity(
      restored,
      principal.DATABASE_APP_LOGIN,
    );

    // Only meaningful while the server-level login mapping is intact; on this
    // instance the login exists with the same SID, so it is.
    expect(security.loginMapped).toBe(true);

    const app = await openSession({
      ...withDatabase(connection, restoreDatabase),
      user: principal.DATABASE_APP_LOGIN,
      password: principal.DATABASE_APP_PASSWORD,
    });

    try {
      await expect(
        app.query(`UPDATE [dbo].[AuditLog] SET [action] = N'tampered';`),
      ).rejects.toMatchObject({ number: 229 });

      await expect(app.query('DELETE FROM [dbo].[AuditLog];')).rejects.toMatchObject({
        number: 229,
      });

      // SELECT remains permitted, so the denials above are a permission
      // boundary rather than a broken connection.
      const rows = await app.query<{ total: number }>(
        'SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog];',
      );
      expect(Number(rows[0]?.total ?? 0)).toBe(sourceRowCount);
    } finally {
      await app.close();
    }

    // The proof row is exactly as restored after those attempts.
    await verifyRestoredMarker(restored, marker);
  });

  it('leaves the backup artifact on the server until cleanup', async () => {
    expect(await backupArtifactExists(source, target.path)).toBe(true);
  });
});
