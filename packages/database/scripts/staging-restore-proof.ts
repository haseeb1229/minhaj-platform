import 'server-only';

import { createFilesystemStore } from '@minhaj/storage';

import {
  backupArtifactExists,
  backupTargetFor,
  dropRestoreDatabase,
  newRestoreDatabaseName,
  restoreDatabaseFromBackup,
  STAGING_BACKUP_NAMING,
  verifyBackupArtifact,
} from '../src/lifecycle/backup.ts';
import { loadMigrations } from '../src/lifecycle/migrations.ts';
import { assertDatabaseAbsent } from '../src/lifecycle/recovery-cleanup.ts';
import {
  inspectRestoredSecurity,
  verifyRestoredSchema,
} from '../src/lifecycle/restored-state.ts';
import { openSession, type SqlSession } from '../src/lifecycle/sql-connection.ts';
import {
  assertLeastPrivilege,
  assertMigrationsCurrent,
  migrationReport,
  summariseLeastPrivilege,
  untrustedConstraints,
} from '../src/lifecycle/staging-database.ts';
import {
  assertIsolatedRestoreRoot,
  verifyRestoredFixture,
  verifyRestoredStorage,
} from '../src/lifecycle/staging-fixture.ts';
import {
  assertStagingFingerprint,
  STAGING_DATABASE,
} from '../src/lifecycle/staging-target.ts';
import {
  argumentValue,
  openAdminSession,
  openVerifiedMaster,
  runStagingCommand,
  runtimeConnection,
  startStagingCommand,
} from './staging-bootstrap.ts';

/**
 * `npm run staging:db:restore-proof -- --backup <minhaj-staging-<32 hex>.bak>`
 * — the COMBINED staging recovery proof (DELIVERY_PLAN.md Phase 28: "restore
 * verified").
 *
 *   named staging artifact (placed by the host in /var/opt/mssql/backup)
 *     -> VERIFYONLY / HEADERONLY / FILELISTONLY (a full set of MinhajStaging)
 *     -> RESTORE into a NEW MinhajStagingRestore_<32 hex> — never over the live DB
 *     -> the restored DB carries THIS environment's fingerprint (provenance)
 *     -> migration history is exactly this repository's, fully applied
 *     -> schema, Phase tables and audit structure (the Phase 1 verification)
 *     -> every foreign key and CHECK constraint enabled and trusted
 *     -> the runtime principal's least privilege, measured as that principal
 *     -> the seed fixture's Asset row present, clean and exact
 *     -> EVERY durable Asset row's bytes exist under MINHAJ_RESTORE_STORAGE_ROOT
 *        with matching size and SHA-256
 *     -> ALWAYS drop the restore database and prove it is gone
 *
 * The live database is read only for its fingerprint, and live storage is
 * never opened at all: the restore root must exist and be neither the live
 * root nor inside or around it, by spelling or by link.
 *
 * The artifact is the host's: this command neither writes nor deletes it.
 */

await runStagingCommand('staging:db:restore-proof', async () => {
  const command = startStagingCommand();

  // Validated against the staging artifact grammar before it is joined to a
  // path, so an operator-typed value cannot carry a directory or a quote.
  const target = backupTargetFor(argumentValue('--backup') ?? '', STAGING_BACKUP_NAMING);

  const roots = await assertIsolatedRestoreRoot(
    process.env['STORAGE_ROOT'],
    process.env['MINHAJ_RESTORE_STORAGE_ROOT'],
  );

  const { master } = await openVerifiedMaster(command, { requireFingerprint: true });
  const restoreDatabase = newRestoreDatabaseName(STAGING_BACKUP_NAMING);

  let restored: SqlSession | undefined;
  let proof: Record<string, unknown> | undefined;
  let primary: unknown;
  const cleanup: Record<string, string> = {};

  try {
    if (!(await backupArtifactExists(master, target.path, STAGING_BACKUP_NAMING))) {
      throw new Error(
        `The server cannot see ${target.path}; place the artifact there first.`,
      );
    }
    const artifact = await verifyBackupArtifact(
      master,
      STAGING_DATABASE,
      target,
      STAGING_BACKUP_NAMING,
    );

    await restoreDatabaseFromBackup(
      master,
      target.path,
      restoreDatabase,
      STAGING_BACKUP_NAMING,
    );
    restored = await openAdminSession(command, restoreDatabase, 'restore');

    // Provenance: the artifact came from THIS staging environment's database.
    await assertStagingFingerprint(master, restoreDatabase, command.environmentId);

    const repository = (await loadMigrations()).map((migration) => migration.id);
    const migrations = await migrationReport(restored);
    assertMigrationsCurrent(migrations);
    const schema = await verifyRestoredSchema(restored, repository);

    const untrusted = await untrustedConstraints(restored);
    if (untrusted.length > 0) {
      throw new Error(
        `Restored constraints are disabled or untrusted: ${untrusted.join(', ')}`,
      );
    }

    const security = await inspectRestoredSecurity(restored, command.runtimeLogin);
    if (!security.userPresent) {
      throw new Error(`The restored database has no '${command.runtimeLogin}' user.`);
    }
    if (security.ownsDatabase) {
      throw new Error(`'${command.runtimeLogin}' owns the restored database.`);
    }
    if (security.broadRoles.length > 0) {
      throw new Error(
        `'${command.runtimeLogin}' holds broad roles in the restored database: ` +
          security.broadRoles.join(', '),
      );
    }
    if (!security.loginMapped) {
      throw new Error(
        `The restored '${command.runtimeLogin}' user does not map to a server login, ` +
          `so its effective authority cannot be measured. Provision the runtime ` +
          `principal on this server first.`,
      );
    }

    const app = await openSession(runtimeConnection(command, restoreDatabase, 'restore'));
    let leastPrivilege;
    try {
      leastPrivilege = await summariseLeastPrivilege(
        app,
        restored,
        command.runtimeLogin,
        {
          checkObjectInventory: true,
        },
      );
    } finally {
      await app.close();
    }
    assertLeastPrivilege(leastPrivilege);

    await verifyRestoredFixture(restored);

    const files = await createFilesystemStore(roots.restore);
    const storage = await verifyRestoredStorage(restored, files);
    if (storage.failures.length > 0) {
      throw new Error(
        `${storage.failures.length} of ${storage.durableAssets} restored assets do not ` +
          `match their bytes: ` +
          storage.failures
            .slice(0, 10)
            .map((failure) => `${failure.assetId} (${failure.reason})`)
            .join(', '),
      );
    }

    proof = {
      environmentId: command.environmentId,
      backup: {
        fileName: target.fileName,
        database: artifact.header.databaseName,
        sizeBytes: artifact.header.backupSize,
        backupFinishDate: artifact.header.backupFinishDate,
        checksums: artifact.header.hasBackupChecksums,
      },
      restoreDatabase,
      fingerprintOk: true,
      migrations: { count: migrations.appliedCount, latest: migrations.latest },
      schema: { tables: schema.tables.length, auditRows: schema.auditRowCount },
      constraintsTrusted: true,
      runtimeLeastPrivilege: {
        login: leastPrivilege.login,
        roles: leastPrivilege.roles,
        broadRoles: leastPrivilege.broadRoles,
        loginMapped: security.loginMapped,
      },
      fixture: 'present, clean, exact',
      storage: {
        restoreRoot: roots.restore,
        durableAssets: storage.durableAssets,
        verified: storage.verified,
      },
    };
  } catch (error) {
    primary = error;
  } finally {
    // ALWAYS: close the restored session, drop the restore database, and
    // prove it is gone — on success and on every failure path alike.
    if (restored !== undefined) {
      await restored.close().catch(() => undefined);
    }
    try {
      await dropRestoreDatabase(master, restoreDatabase, STAGING_BACKUP_NAMING);
      await assertDatabaseAbsent(master, restoreDatabase);
      cleanup['restoreDatabase'] = `${restoreDatabase} dropped; DB_ID is NULL`;
    } catch (error) {
      cleanup['restoreDatabase'] = `CLEANUP FAILED: ${(error as Error).message}`;
    }
    await master.close().catch(() => undefined);
  }

  const cleanupFailed = cleanup['restoreDatabase']?.startsWith('CLEANUP FAILED') === true;
  if (primary !== undefined) {
    const message = (primary as Error).message;
    throw new Error(
      cleanupFailed
        ? `${message.split('\n')[0] ?? ''} AND ${cleanup['restoreDatabase'] ?? ''}`
        : `${message.split('\n')[0] ?? ''} (restore database cleaned up)`,
    );
  }
  if (cleanupFailed) throw new Error(cleanup['restoreDatabase']);

  return { ...proof, cleanup, liveDatabaseTouched: false, liveStorageTouched: false };
});
