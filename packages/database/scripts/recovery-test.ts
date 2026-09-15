import 'server-only';

import { getApplicationPrincipalCredentials } from '../src/config.ts';
import {
  assertBackupSourceDatabase,
  backupArtifactExists,
  backupDatabase,
  newBackupTarget,
  newRestoreDatabaseName,
  restoreDatabaseFromBackup,
} from '../src/lifecycle/backup.ts';
import { openMasterSession } from '../src/lifecycle/disposable-database.ts';
import { appliedMigrationNames, loadMigrations } from '../src/lifecycle/migrations.ts';
import {
  cleanUpRecoveryResources,
  RecoveryCleanupError,
  type CleanupOutcome,
} from '../src/lifecycle/recovery-cleanup.ts';
import {
  newRecoveryMarker,
  verifyRestoredMarker,
  writeRecoveryMarker,
} from '../src/lifecycle/recovery-proof.ts';
import {
  inspectRestoredSecurity,
  verifyRestoredSchema,
} from '../src/lifecycle/restored-state.ts';
import { inspectPrincipalAuthority } from '../src/lifecycle/principal-authority.ts';
import {
  openSession,
  withDatabase,
  type SqlSession,
} from '../src/lifecycle/sql-connection.ts';
import { reportConfiguration, startLocalCommand } from './local-bootstrap.ts';

/**
 * `npm run db:recovery:test` — THE Phase 1 end-to-end recovery gate.
 *
 *   migrated MinhajPlatform
 *     -> write a unique audit marker row
 *     -> REAL BACKUP DATABASE ... WITH CHECKSUM
 *     -> RESTORE VERIFYONLY / HEADERONLY / FILELISTONLY
 *     -> RESTORE into a NEW disposable MinhajPhase1Restore_<hex>
 *     -> verify restored schema, indexes, migration history
 *     -> verify the marker row survived with unchanged values
 *     -> verify restored security posture
 *     -> drop the restore database, delete the artifact, prove both are gone
 *
 * This is a genuine SQL Server backup and a genuine restore. No step copies
 * rows, replays a migration, exports JSON or recreates schema — a rehearsal
 * that did any of those would pass while proving nothing about the artifact,
 * which is the only thing an incident actually depends on
 * (ARCHITECTURE.md §10.4).
 *
 * `MinhajPlatform` is READ from and never restored over. The restore target is
 * always a fresh disposable database whose name this run generated.
 */

function report(step: string, detail: string): void {
  process.stdout.write(`  ${step.padEnd(26)} ${detail}\n`);
}

function fail(message: string): never {
  throw new Error(message);
}

// Resolves docker/.env as the sole authority and proves the approved local
// target: loopback host, the configured local port, MinhajPlatform, and a
// migration principal distinct from the runtime one. A real BACKUP and a real
// RESTORE follow, so nothing below may run on an unproven target.
const command = startLocalCommand('source');
const connection = command.connection;
// Belt and braces: the source-database rule stated where the backup happens.
assertBackupSourceDatabase(connection.database);

const principal = getApplicationPrincipalCredentials(command.environment.values);
const target = newBackupTarget();
const restoreDatabase = newRestoreDatabaseName();
const marker = newRecoveryMarker();

const migrations = await loadMigrations();
if (migrations.length === 0) fail('No migrations found; nothing to prove recoverable.');

// EVERY migration this repository ships that the SOURCE has actually applied.
//
// This used to be `migrations[0]` alone, which asserted the first migration
// and ignored the rest — so a restore that had lost later history passed. The
// expectation is intersected with what the source really holds, because a
// migration authored but not yet deployed to this database is not something
// its backup can be blamed for failing to contain.
const repositoryMigrations = migrations.map((entry) => entry.id);

const master = await openMasterSession(connection);
let source: SqlSession | undefined;
let restored: SqlSession | undefined;

/** The rehearsal's own failure, if any — held so cleanup can still run. */
let recoveryError: unknown;
/**
 * What cleanup managed to do, and what it could not.
 *
 * Assigned in `finally`, which runs on every path out of the block below, so
 * it is always set before it is read.
 */
let cleanupOutcome!: CleanupOutcome;

process.stdout.write(`Phase 1 recovery rehearsal\n`);
reportConfiguration(command, 26);
report('source database', connection.database);
report('restore target', restoreDatabase);

try {
  source = await openSession(connection);

  // ---- the source must be the migrated Phase 1 foundation ------------------
  //
  // Backing up a database that is not in the expected state would produce an
  // artifact whose restore proves nothing.
  const applied = await appliedMigrationNames(source);
  const expectedMigrations = repositoryMigrations.filter((id) => applied.includes(id));

  if (expectedMigrations.length === 0) {
    fail(
      `The source database has applied none of this repository's migrations ` +
        `(${repositoryMigrations.join(', ')}). Its backup would prove nothing.`,
    );
  }

  const unknown = applied.filter((id) => !repositoryMigrations.includes(id));
  if (unknown.length > 0) {
    fail(
      `The source database has migrations this repository does not ship: ${unknown.join(', ')}`,
    );
  }

  const sourceState = await verifyRestoredSchema(source, expectedMigrations);
  report(
    'source verified',
    `AuditLog + _prisma_migrations present, applied: ${expectedMigrations.join(', ')}`,
  );

  if (expectedMigrations.length < repositoryMigrations.length) {
    const pending = repositoryMigrations.filter((id) => !applied.includes(id));
    report(
      'NOT COVERED HERE',
      `${pending.join(', ')} — not deployed to ${connection.database}; ` +
        `populated coverage is \`npm run db:recovery:populated\``,
    );
  }

  // ---- proof state ---------------------------------------------------------
  await writeRecoveryMarker(source, marker);
  report('proof marker written', marker.targetId);

  const [afterMarker] = await source.query<{ total: number }>(
    'SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog];',
  );
  const sourceRowCount = Number(afterMarker?.total ?? 0);
  if (sourceRowCount !== sourceState.auditRowCount + 1) {
    fail(
      `Expected the marker to add exactly one audit row ` +
        `(${sourceState.auditRowCount} -> ${sourceState.auditRowCount + 1}); ` +
        `found ${sourceRowCount}.`,
    );
  }
  report('source audit rows', `${sourceRowCount}`);

  // ---- REAL backup ---------------------------------------------------------
  const backup = await backupDatabase(source, connection.database, target);
  report('BACKUP DATABASE', `${backup.target.path}`);
  report(
    'header verified',
    `database=${backup.header.databaseName} type=full ` +
      `size=${backup.header.backupSize} bytes checksums=${backup.header.hasBackupChecksums}`,
  );
  report(
    'logical files',
    backup.files.map((file) => `${file.logicalName} (${file.type})`).join(', '),
  );

  if (!(await backupArtifactExists(source, target.path))) {
    fail('BACKUP reported success but the artifact does not exist on the server.');
  }
  report('artifact exists', 'confirmed via xp_fileexist');

  // ---- REAL restore into a disposable database -----------------------------
  //
  // Logical file names come from the artifact's own FILELISTONLY, not from the
  // database name: the source's logical names are `MinhajPlatform` and
  // `MinhajPlatform_log`, which match no restore target.
  await restoreDatabaseFromBackup(master, target.path, restoreDatabase);
  report('RESTORE DATABASE', `restored into ${restoreDatabase}`);

  restored = await openSession(withDatabase(connection, restoreDatabase));

  // ---- restored schema, indexes and history --------------------------------
  const restoredState = await verifyRestoredSchema(restored, expectedMigrations);
  report(
    'restored schema',
    `${restoredState.columns.length} AuditLog columns, ` +
      `${restoredState.indexes.length} indexes, tables: ${restoredState.tables.join(', ')}`,
  );
  report('restored history', restoredState.migrations.join(', '));

  if (restoredState.auditRowCount !== sourceRowCount) {
    fail(
      `Restored audit row count is ${restoredState.auditRowCount}, ` +
        `expected the ${sourceRowCount} rows present when the backup was taken.`,
    );
  }
  report('restored audit rows', `${restoredState.auditRowCount}, matching the backup`);

  // ---- restored DATA -------------------------------------------------------
  //
  // The row was written to the SOURCE before the backup and never to the
  // restore target. Finding it here, with every field unchanged, is what
  // separates a genuine restore from a schema recreation.
  const restoredMarker = await verifyRestoredMarker(restored, marker);
  report('restored proof row', `${restoredMarker.targetId} with unchanged values`);
  report('restored row action', restoredMarker.action);

  // ---- restored security posture -------------------------------------------
  const security = await inspectRestoredSecurity(restored, principal.DATABASE_APP_LOGIN);

  if (!security.userPresent) {
    fail(
      `Restored database has no '${principal.DATABASE_APP_LOGIN}' user; the ` +
        `least-privilege principal did not survive the restore.`,
    );
  }
  if (security.ownsDatabase) {
    fail(`'${principal.DATABASE_APP_LOGIN}' owns the restored database.`);
  }
  if (security.broadRoles.length > 0) {
    fail(
      `'${principal.DATABASE_APP_LOGIN}' is a member of broad roles in the ` +
        `restored database: ${security.broadRoles.join(', ')}`,
    );
  }

  const denied = security.auditPermissions
    .filter((entry) => entry.state === 'DENY')
    .map((entry) => entry.permission);
  const granted = security.auditPermissions
    .filter((entry) => entry.state === 'GRANT')
    .map((entry) => entry.permission);

  for (const permission of ['UPDATE', 'DELETE']) {
    if (!denied.includes(permission)) {
      fail(
        `Restored database does not DENY ${permission} on dbo.AuditLog to ` +
          `'${principal.DATABASE_APP_LOGIN}'. Denials: ${denied.join(', ') || '(none)'}`,
      );
    }
  }
  for (const permission of ['INSERT', 'SELECT']) {
    if (!granted.includes(permission)) {
      fail(
        `Restored database does not GRANT ${permission} on dbo.AuditLog to ` +
          `'${principal.DATABASE_APP_LOGIN}'. Grants: ${granted.join(', ') || '(none)'}`,
      );
    }
  }

  report(
    'restored DB permissions',
    `GRANT ${granted.join('/')} · DENY ${denied.join('/')}`,
  );
  report('restored DB owner', `not ${principal.DATABASE_APP_LOGIN}`);
  report('restored broad roles', 'none');

  // The SERVER-LEVEL binding is a separate fact from the DATABASE state above,
  // and is reported as such. Logins live in `master` and are NOT inside the
  // artifact; on this instance the login already exists with the same SID, so
  // the restored user maps straight back to it. On a different instance the
  // user would be orphaned until re-mapped — which is a re-provisioning step,
  // not a property of the restored database.
  report(
    'server-level mapping',
    security.loginMapped
      ? `login '${principal.DATABASE_APP_LOGIN}' resolves by SID — DATABASE STATE ` +
          `RESTORED and SERVER-LEVEL LOGIN MAPPING INTACT (same instance)`
      : `login '${principal.DATABASE_APP_LOGIN}' does NOT resolve — DATABASE STATE ` +
          `RESTORED, SERVER-LEVEL LOGIN MAPPING WOULD NEED REBINDING`,
  );

  // ---- live behaviour in the restored database -----------------------------
  //
  // Catalogue permissions are the design; this proves the RESTORED database
  // enforces them, using the actual runtime principal. Only meaningful while
  // the server-level login mapping is intact.
  if (security.loginMapped) {
    let app: SqlSession | undefined;
    try {
      app = await openSession({
        ...withDatabase(connection, restoreDatabase),
        user: principal.DATABASE_APP_LOGIN,
        password: principal.DATABASE_APP_PASSWORD,
      });

      // Direct catalogue rows do not describe authority inherited through a
      // custom role. Re-run the effective database/schema probes AS the restored
      // runtime principal so a broad inherited grant cannot survive unnoticed.
      const authority = await inspectPrincipalAuthority(app);
      const broadEffective = [
        ...authority.broadRoles,
        ...authority.databasePermissions
          .filter((entry) => entry.held)
          .map((entry) => `DATABASE ${entry.permission}`),
        ...authority.schemaPermissions
          .filter((entry) => entry.held)
          .map((entry) => `SCHEMA dbo ${entry.permission}`),
      ];
      if (broadEffective.length > 0) {
        fail(
          `The restored runtime principal holds broad effective authority: ` +
            broadEffective.join(', '),
        );
      }
      report('restored effective rights', 'no broad database/schema authority');

      const [visible] = await app.query<{ total: number }>(
        'SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog];',
      );
      if (Number(visible?.total ?? 0) !== restoredState.auditRowCount) {
        fail('The runtime principal cannot read the restored audit rows.');
      }
      report('restored audit SELECT', `permitted, ${visible?.total ?? 0} rows visible`);

      for (const [label, statement] of [
        ['UPDATE', `UPDATE [dbo].[AuditLog] SET [action] = N'tampered';`],
        ['DELETE', 'DELETE FROM [dbo].[AuditLog];'],
      ] as const) {
        try {
          await app.query(statement);
          fail(`Restored database PERMITTED audit ${label} to the runtime principal.`);
        } catch (error) {
          const number = (error as { number?: number }).number;
          // 229/230 = permission denied on object; 262 = denied in database.
          if (number === undefined || ![229, 230, 262].includes(number)) {
            fail(
              `Restored audit ${label} was rejected for the WRONG reason ` +
                `(error ${number ?? 'unknown'}): ${(error as Error).message.split('\n')[0]}`,
            );
          }
          report(`restored audit ${label}`, `denied, SQL Server error ${number}`);
        }
      }

      // The marker must be exactly as restored after those attempts.
      await verifyRestoredMarker(restored, marker);
      report('proof row intact', 'unchanged after UPDATE/DELETE attempts');
    } finally {
      await app?.close();
    }
  } else {
    report(
      'restored audit DML',
      'not exercised: server-level login mapping absent (reported, not hidden)',
    );
  }

  process.stdout.write(
    '\nRecovery verified: a real SQL Server backup was taken, restored into a ' +
      'separate\ndisposable database, and the restored schema, migration history, ' +
      'data and\nsecurity posture were checked against actual database state.\n' +
      'Cleanup is verified below; this run passes only if it also succeeds.\n\n',
  );
} catch (error) {
  // The PRIMARY failure. Held rather than rethrown, so cleanup still runs and
  // a cleanup problem cannot replace the reason the rehearsal actually failed.
  recoveryError = error;
} finally {
  // ---- cleanup, in dependency order ----------------------------------------
  //
  // Every step is attempted even after an earlier one fails, each destructive
  // call re-validates its own target, and residue is verified separately from
  // the operation meant to remove it. Failures are collected and returned;
  // they are NOT swallowed here.
  cleanupOutcome = await cleanUpRecoveryResources({
    master,
    source,
    restored,
    restoreDatabase,
    backupPath: target.path,
  });
}

for (const step of cleanupOutcome.succeeded) {
  const [name, detail] = step.split(': ');
  report(`cleanup: ${name}`, detail ?? '');
}
for (const failure of cleanupOutcome.failures) {
  report(`CLEANUP FAILED: ${failure.step}`, failure.detail);
}

// ---- exit status -----------------------------------------------------------
//
// A leaked restore database or backup artifact fails the command, exactly as a
// failed restore does. Reporting residue and then exiting 0 is what made the
// earlier revision's cleanup line decorative.
const cleanupError =
  cleanupOutcome.failures.length > 0
    ? new RecoveryCleanupError(cleanupOutcome.failures)
    : undefined;

if (recoveryError !== undefined && cleanupError !== undefined) {
  // Both failed. The primary failure leads, because it is the reason to
  // investigate; the cleanup failures follow, because they are what is still
  // on the server. Neither is allowed to hide the other.
  throw new AggregateError(
    [recoveryError, cleanupError],
    `The recovery rehearsal failed AND cleanup did not complete.\n` +
      `Primary failure: ${(recoveryError as Error).message}\n` +
      `${cleanupError.message}`,
  );
}
if (recoveryError !== undefined) throw recoveryError;
if (cleanupError !== undefined) throw cleanupError;

process.stdout.write('\nCleanup verified: no restore database, no backup artifact.\n');
