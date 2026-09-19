import 'server-only';

import { getApplicationPrincipalCredentials } from '../src/config.ts';
import { provisionApplicationPrincipal } from '../src/lifecycle/application-principal.ts';
import {
  backupArtifactExists,
  backupDatabase,
  newBackupTarget,
  newRestoreDatabaseName,
  restoreDatabaseFromBackup,
} from '../src/lifecycle/backup.ts';
import {
  createDisposableDatabase,
  dropDisposableDatabase,
  newDisposableDatabaseName,
  openMasterSession,
} from '../src/lifecycle/disposable-database.ts';
import { deployMigrations, loadMigrations } from '../src/lifecycle/migrations.ts';
import {
  newPhase2Fixture,
  verifyRestoredIntegrity,
  verifyRestoredPhase2,
  writePhase2Fixture,
} from '../src/lifecycle/phase2-fixture.ts';
import {
  newPhase3bFixture,
  verifyRestoredPhase3b,
  verifyRestoredTaxonomyIntegrity,
  writePhase3bFixture,
} from '../src/lifecycle/phase3b-fixture.ts';
import {
  newPhase5Fixture,
  verifyRestoredPeopleIntegrity,
  verifyRestoredPhase5,
  writePhase5Fixture,
} from '../src/lifecycle/phase5-fixture.ts';
import { inspectPrincipalAuthority } from '../src/lifecycle/principal-authority.ts';
import {
  cleanUpRecoveryResources,
  RecoveryCleanupError,
  type CleanupFailure,
  type CleanupOutcome,
} from '../src/lifecycle/recovery-cleanup.ts';
import {
  inspectRestoredSecurity,
  verifyRestoredSchema,
} from '../src/lifecycle/restored-state.ts';
import {
  openSession,
  withDatabase,
  type SqlSession,
} from '../src/lifecycle/sql-connection.ts';
import {
  reportConfiguration,
  retargetAtDisposable,
  startLocalCommand,
} from './local-bootstrap.ts';

/**
 * `npm run db:recovery:populated` — THE POPULATED recovery gate.
 *
 *   create a DISPOSABLE source
 *     -> deploy EVERY migration with the real Prisma CLI
 *     -> provision the least-privilege runtime principal
 *     -> write representative synthetic rows into EVERY Phase-2, Phase-3B
 *        and Phase-5 table
 *     -> REAL BACKUP DATABASE ... WITH CHECKSUM
 *     -> RESTORE into a separate disposable database
 *     -> verify the rows, their relationships and the whole migration history
 *     -> verify the restored permission posture, as the runtime principal
 *     -> drop both databases, delete the artifact, prove all three are gone
 *
 * WHY THIS EXISTS ALONGSIDE `db:recovery:test`.
 *
 * That command rehearses the OPERATIONAL artifact: it backs up the real
 * engineering database and restores it. This one rehearses the CONTENT: it
 * proves that populated Phase-2 state — accounts, credentials, sessions,
 * communication intents, deliveries, suppressions, provider events, limiter
 * windows and audit rows — and populated Phase-3B state — the canonical topic
 * seed, a topic hierarchy, localisations in three scripts, a content language
 * and a tag — and populated Phase-5 People/profile state survive a backup and
 * restore with their values, relationships and enforcing constraints intact.
 *
 * Neither is sufficient alone. The first proved only that an AuditLog marker
 * came back, which a database holding one table would also prove; the second
 * cannot prove anything about the real database's artifact.
 *
 * NOTHING REAL IS TOUCHED. The source is created by this run, and the fixture
 * rows are synthetic and self-identifying. `MinhajPlatform` is never opened.
 */

function report(step: string, detail: string): void {
  process.stdout.write(`  ${step.padEnd(30)} ${detail}\n`);
}

function fail(message: string): never {
  throw new Error(message);
}

// Resolves docker/.env as the sole authority and proves the approved local
// target before anything is created.
//
// The CONFIGURED database is validated under the `source` policy, exactly as
// the live test harness does, and is then retargeted at a disposable name that
// is validated again under the `disposable` policy. Nothing in this run ever
// opens the configured database: it supplies the host, port, port-scoped local
// identity and TLS posture, and the disposable target is what is touched.
const command = startLocalCommand('source');

const sourceDatabase = newDisposableDatabaseName();
const restoreDatabase = newRestoreDatabaseName();
const target = newBackupTarget();
const fixture = newPhase2Fixture();
const taxonomyFixture = newPhase3bFixture();
const peopleFixture = newPhase5Fixture();

// Re-validated rather than assumed: a retarget that silently did nothing must
// fail here, not at the point where CREATE DATABASE runs.
const source = retargetAtDisposable(command, sourceDatabase);
const principal = getApplicationPrincipalCredentials(command.environment.values);

const migrations = await loadMigrations();
if (migrations.length === 0) fail('No migrations found; nothing to prove recoverable.');
const migrationIds = migrations.map((migration) => migration.id);

const master = await openMasterSession(command.connection);
let admin: SqlSession | undefined;
let restored: SqlSession | undefined;

let recoveryError: unknown;
let cleanupOutcome!: CleanupOutcome;
const sourceFailures: CleanupFailure[] = [];

process.stdout.write(`Populated Phase-2, Phase-3B and Phase-5 recovery rehearsal\n`);
reportConfiguration(command, 30);
report('disposable source', sourceDatabase);
report('restore target', restoreDatabase);

try {
  // ---- a source that actually holds the current foundation -----------------
  await createDisposableDatabase(master, sourceDatabase);
  admin = await openSession(source.connection);

  // The REAL Prisma CLI over the normal encrypted configuration, so what is
  // proved recoverable is what a deployment produces.
  await deployMigrations(source.url);
  report('migrations deployed', migrationIds.join(', '));

  // The least-privilege principal, from the SAME script a deployment runs. Its
  // survival through the restore is one of the things under test.
  await provisionApplicationPrincipal(
    admin,
    principal.DATABASE_APP_LOGIN,
    principal.DATABASE_APP_PASSWORD,
  );
  report('runtime principal', `${principal.DATABASE_APP_LOGIN} provisioned`);

  // ---- populate ------------------------------------------------------------
  await writePhase2Fixture(admin, fixture);
  report('fixture written', `run ${fixture.runId}`);
  report('fixture account', fixture.email);

  // Phase-3B taxonomy, written into a database that ALREADY holds the nineteen
  // canonical topics the migration seeded — so the restore has both foundation
  // data and administered data to bring back, and the assertions can tell the
  // two apart.
  await writePhase3bFixture(admin, taxonomyFixture);
  report('taxonomy fixture', `run ${taxonomyFixture.runId}`);

  // Phase-5 contributors: one holding all four facets and an account link, and
  // one historical contributor with no account at all. Both halves are written
  // BEFORE the backup, so the restore has to reproduce the relationships
  // between them rather than merely the rows.
  await writePhase5Fixture(admin, peopleFixture);
  report('people fixture', `run ${peopleFixture.runId}`);

  // ---- REAL backup ---------------------------------------------------------
  const backup = await backupDatabase(admin, sourceDatabase, target);
  report('BACKUP DATABASE', backup.target.path);
  report(
    'header verified',
    `database=${backup.header.databaseName} size=${backup.header.backupSize} bytes ` +
      `checksums=${backup.header.hasBackupChecksums}`,
  );

  if (!(await backupArtifactExists(admin, target.path))) {
    fail('BACKUP reported success but the artifact does not exist on the server.');
  }
  report('artifact exists', 'confirmed via xp_fileexist');

  // ---- REAL restore --------------------------------------------------------
  await restoreDatabaseFromBackup(master, target.path, restoreDatabase);
  report('RESTORE DATABASE', `restored into ${restoreDatabase}`);

  restored = await openSession(withDatabase(command.connection, restoreDatabase));

  // ---- schema and the WHOLE migration history ------------------------------
  const restoredState = await verifyRestoredSchema(restored, migrationIds);
  report('restored tables', `${restoredState.tables.length} tables`);
  report('restored history', restoredState.migrations.join(', '));

  // EVERY migration, not the first. `verifyRestoredSchema` throws on an
  // absent one; this states what was actually proved.
  for (const id of migrationIds) {
    if (!restoredState.migrations.includes(id)) {
      fail(`Restored history is missing ${id}.`);
    }
  }
  report('history complete', `all ${migrationIds.length} migrations present`);

  // ---- the POPULATED data --------------------------------------------------
  const rows = await verifyRestoredPhase2(restored, fixture);
  for (const row of rows) report(`restored ${row.table}`, row.detail);

  const integrity = await verifyRestoredIntegrity(restored, fixture);
  report('referential integrity', integrity);

  const taxonomyRows = await verifyRestoredPhase3b(restored, taxonomyFixture);
  for (const row of taxonomyRows) report(`restored ${row.table}`, row.detail);

  const taxonomyIntegrity = await verifyRestoredTaxonomyIntegrity(
    restored,
    taxonomyFixture,
  );
  report('taxonomy integrity', taxonomyIntegrity);

  const peopleRows = await verifyRestoredPhase5(restored, peopleFixture);
  for (const row of peopleRows) report(`restored ${row.table}`, row.detail);

  const peopleIntegrity = await verifyRestoredPeopleIntegrity(restored, peopleFixture);
  report('people integrity', peopleIntegrity);

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
    fail(`Broad roles in the restored database: ${security.broadRoles.join(', ')}`);
  }

  const denied = security.auditPermissions
    .filter((entry) => entry.state === 'DENY')
    .map((entry) => entry.permission);
  const granted = security.auditPermissions
    .filter((entry) => entry.state === 'GRANT')
    .map((entry) => entry.permission);

  for (const permission of ['UPDATE', 'DELETE']) {
    if (!denied.includes(permission)) {
      fail(`Restored database does not DENY ${permission} on dbo.AuditLog.`);
    }
  }
  for (const permission of ['INSERT', 'SELECT']) {
    if (!granted.includes(permission)) {
      fail(`Restored database does not GRANT ${permission} on dbo.AuditLog.`);
    }
  }
  report(
    'restored AuditLog rights',
    `GRANT ${granted.join('/')} · DENY ${denied.join('/')}`,
  );

  // SERVER-LEVEL logins live in `master` and are NOT inside the artifact. On
  // this instance the login already exists with the same SID, so the restored
  // user maps straight back. On another instance it would be orphaned until
  // re-mapped — a re-provisioning step, not a property of the artifact. Said
  // plainly rather than claimed as something the backup contains.
  report(
    'server-level mapping',
    security.loginMapped
      ? `login resolves by SID — DATABASE STATE RESTORED and LOGIN MAPPING INTACT`
      : `login does NOT resolve — DATABASE STATE RESTORED, LOGIN NEEDS REBINDING`,
  );

  // ---- live behaviour, AS the restored runtime principal --------------------
  if (security.loginMapped) {
    let app: SqlSession | undefined;
    try {
      app = await openSession({
        ...withDatabase(command.connection, restoreDatabase),
        user: principal.DATABASE_APP_LOGIN,
        password: principal.DATABASE_APP_PASSWORD,
      });

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

      // It can READ its own Phase-2 tables.
      const [visible] = await app.query<{ total: number }>(
        `SELECT COUNT_BIG(*) AS total FROM [dbo].[User] WHERE [id] = N'${fixture.accountId}';`,
      );
      if (Number(visible?.total ?? 0) !== 1) {
        fail('The restored runtime principal cannot read the restored account row.');
      }
      report('restored runtime SELECT', 'permitted on Phase-2 data');

      // It can NOT alter audit history, and it holds NO DDL.
      const forbidden: readonly [string, string][] = [
        ['AuditLog UPDATE', `UPDATE [dbo].[AuditLog] SET [action] = N'tampered';`],
        ['AuditLog DELETE', 'DELETE FROM [dbo].[AuditLog];'],
        [
          'IdentitySecurityOperation DELETE',
          'DELETE FROM [dbo].[IdentitySecurityOperation];',
        ],
        [
          'EmailSuppression UPDATE',
          `UPDATE [dbo].[EmailSuppression] SET [reason] = N'x';`,
        ],
        // Phase 3B. The whole integrity claim of the taxonomy rests on the
        // runtime being unable to DELETE a topic: a later context's typed
        // assignment will hold a real foreign key to one, and a runtime that
        // could remove the row could orphan it or be blocked by it. The denial
        // has to survive a RESTORE, not merely exist in the source.
        ['Topic DELETE', 'DELETE FROM [dbo].[Topic];'],
        ['Language DELETE', 'DELETE FROM [dbo].[Language];'],
        ['Tag DELETE', 'DELETE FROM [dbo].[Tag];'],
        // Phase 5. The same claim for contributors: a later content context's
        // attribution will hold a real foreign key to one of these, so the
        // absence of DELETE has to survive a restore as well as a deploy.
        ['Person DELETE', 'DELETE FROM [dbo].[Person];'],
        ['AuthorProfile DELETE', 'DELETE FROM [dbo].[AuthorProfile];'],
        ['TeacherProfile DELETE', 'DELETE FROM [dbo].[TeacherProfile];'],
        [
          'Person slug UPDATE',
          "UPDATE [dbo].[Person] SET [slug] = N'restored-rename-attempt';",
        ],
        ['DDL', 'CREATE TABLE [dbo].[ShouldNotExist] ([id] INT NOT NULL);'],
      ];

      for (const [label, statement] of forbidden) {
        try {
          await app.query(statement);
          fail(`Restored database PERMITTED ${label} to the runtime principal.`);
        } catch (error) {
          const number = (error as { number?: number }).number;
          // 229/230 = denied on object; 262 = denied in database.
          if (number === undefined || ![229, 230, 262].includes(number)) {
            fail(
              `Restored ${label} was rejected for the WRONG reason ` +
                `(error ${number ?? 'unknown'}): ${(error as Error).message.split('\n')[0]}`,
            );
          }
          report(`restored ${label}`, `denied, SQL Server error ${number}`);
        }
      }

      // The populated state is exactly as restored after those attempts.
      await verifyRestoredPhase2(restored, fixture);
      await verifyRestoredPhase3b(restored, taxonomyFixture);
      await verifyRestoredPhase5(restored, peopleFixture);
      report('fixture intact', 'unchanged after UPDATE/DELETE/DDL attempts');
    } finally {
      await app?.close();
    }
  } else {
    report(
      'restored runtime checks',
      'not exercised: server-level login mapping absent (reported, not hidden)',
    );
  }

  process.stdout.write(
    '\nPopulated recovery verified: representative rows in every Phase-2,\n' +
      'Phase-3B and Phase-5 tables were backed up, restored into a separate\n' +
      'database, and checked value by value — together with referential\n' +
      'integrity, the topic hierarchy, the four distinct contributor profile\n' +
      'aggregates and their independent lifecycles, the optional account link,\n' +
      'non-Latin script, the trusted constraints and their invariant triggers,\n' +
      'the complete migration history and the least-privilege posture of the\n' +
      'restored runtime principal.\n' +
      'Cleanup is verified below; this run passes only if it also succeeds.\n\n',
  );
} catch (error) {
  // Held rather than rethrown, so cleanup still runs and a cleanup problem
  // cannot replace the reason the rehearsal actually failed.
  recoveryError = error;
} finally {
  // ---- cleanup, in dependency order ----------------------------------------
  //
  // The SHARED helper runs first and owns the restore database, the artifact
  // and both sessions. The artifact can only be deleted through a session on
  // the source, so the source session has to still be open when it runs —
  // which is why the source database is not dropped before it.
  cleanupOutcome = await cleanUpRecoveryResources({
    master,
    source: admin,
    restored,
    restoreDatabase,
    backupPath: target.path,
  });

  // The disposable SOURCE is this command's own, and only this command removes
  // it. It needs a session of its own because the helper above closed both of
  // the ones this run had — and a drop attempted on a closed connection would
  // report a failure that says nothing about whether the database is still
  // there. `dropDisposableDatabase` re-validates the name and rolls back stray
  // sessions, so it cannot hang and cannot touch anything else.
  let finalMaster: SqlSession | undefined;

  try {
    finalMaster = await openMasterSession(command.connection);
    await dropDisposableDatabase(finalMaster, sourceDatabase);
    cleanupOutcome.succeeded.push(`source database: dropped ${sourceDatabase}`);

    // Verified INDEPENDENTLY of the drop: a DROP that reported success and
    // left the database in place is exactly what this catches. An inspection
    // that cannot answer is a failure, never a clean result.
    const rows = await finalMaster.query<{ present: number | null }>(
      `SELECT CASE WHEN DB_ID(N'${sourceDatabase}') IS NULL THEN 0 ELSE 1 END AS present;`,
    );
    const present = rows.length === 1 ? rows[0]?.present : undefined;

    if (present === null || present === undefined) {
      sourceFailures.push({
        step: 'source database residue',
        detail: `the residue inspection did not answer; ${sourceDatabase} is in an unknown state`,
      });
    } else if (present !== 0) {
      sourceFailures.push({
        step: 'source database residue',
        detail: `${sourceDatabase} still exists after the drop attempt`,
      });
    } else {
      cleanupOutcome.succeeded.push(
        `source residue: ${sourceDatabase} absent, DB_ID is NULL`,
      );
    }
  } catch (error) {
    sourceFailures.push({
      step: 'source database',
      detail: (error as Error).message.split('\n')[0] ?? 'unknown',
    });
  } finally {
    try {
      await finalMaster?.close();
      cleanupOutcome.succeeded.push('source cleanup session close: closed');
    } catch (error) {
      sourceFailures.push({
        step: 'source cleanup session close',
        detail: (error as Error).message.split('\n')[0] ?? 'unknown',
      });
    }
  }

  cleanupOutcome.failures.push(...sourceFailures);
}

for (const step of cleanupOutcome.succeeded) {
  const [name, detail] = step.split(': ');
  report(`cleanup: ${name}`, detail ?? '');
}
for (const failure of cleanupOutcome.failures) {
  report(`CLEANUP FAILED: ${failure.step}`, failure.detail);
}

const cleanupError =
  cleanupOutcome.failures.length > 0
    ? new RecoveryCleanupError(cleanupOutcome.failures)
    : undefined;

if (recoveryError !== undefined && cleanupError !== undefined) {
  throw new AggregateError(
    [recoveryError, cleanupError],
    `The populated recovery rehearsal failed AND cleanup did not complete.\n` +
      `Primary failure: ${(recoveryError as Error).message}\n` +
      `${cleanupError.message}`,
  );
}
if (recoveryError !== undefined) throw recoveryError;
if (cleanupError !== undefined) throw cleanupError;

process.stdout.write(
  '\nCleanup verified: no source database, no restore database, no backup artifact.\n',
);
