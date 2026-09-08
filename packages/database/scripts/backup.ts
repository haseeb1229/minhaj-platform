import 'server-only';

// Applied BEFORE any configuration is read: `docker/.env` is authoritative for
// local lifecycle tooling, so a stale shell variable cannot decide which
// database this run backs up.
import { loadLocalDatabaseEnvironment } from '../src/lifecycle/local-environment.ts';

const localEnvironment = loadLocalDatabaseEnvironment();

const { getDatabaseMigrationUrl } = await import('../src/config.ts');
import {
  assertBackupSourceDatabase,
  backupDatabase,
  newBackupTarget,
} from '../src/lifecycle/backup.ts';
import {
  assertLocalMigrationConnection,
  describeConnection,
  formatConnectionMetadata,
} from '../src/lifecycle/local-environment.ts';
import { openSession } from '../src/lifecycle/sql-connection.ts';

/**
 * `npm run db:backup` — takes one REAL, verified SQL Server backup of the
 * Phase 1 source database and leaves it in place.
 *
 * This is the backup procedure on its own. It does NOT restore, and it does
 * NOT delete what it wrote: the artifact is left for a developer who wants a
 * restore point before a risky local change. The end-to-end rehearsal that
 * proves recoverability and cleans up after itself is `npm run db:recovery:test`.
 *
 * Runs as the MIGRATION principal — `BACKUP DATABASE` requires backup
 * authority, which the least-privilege runtime principal does not hold and
 * must never be granted (SECURITY_BASELINE.md §18.2).
 *
 * Everything printed is safe metadata: host, port, database, user and the
 * artifact path. No password and no connection URL (§18.1).
 */

const migrationUrl = getDatabaseMigrationUrl();
// Fails closed on an unencrypted or otherwise unusable local configuration.
const connection = assertLocalMigrationConnection(migrationUrl);

// Fails closed before a session is even opened if the configured database is
// not the one Phase 1 backs up — a system database, or an unexpected name.
assertBackupSourceDatabase(connection.database);

const target = newBackupTarget();
const admin = await openSession(connection);

process.stdout.write(`Phase 1 backup of ${connection.database}\n`);
process.stdout.write(
  `  ${'configuration'.padEnd(20)} ` +
    `${formatConnectionMetadata(describeConnection(connection, 'docker/.env'))}\n`,
);
if (localEnvironment.overridden.length > 0) {
  process.stdout.write(
    `  ${'shell override'.padEnd(20)} ` +
      `docker/.env took precedence over ${localEnvironment.overridden.join(', ')}\n`,
  );
}

try {
  const result = await backupDatabase(admin, connection.database, target);

  process.stdout.write(`  ${'artifact'.padEnd(20)} ${result.target.path}\n`);
  process.stdout.write(
    `  ${'header'.padEnd(20)} database=${result.header.databaseName} ` +
      `type=full size=${result.header.backupSize} bytes ` +
      `checksums=${result.header.hasBackupChecksums}\n`,
  );
  process.stdout.write(
    `  ${'logical files'.padEnd(20)} ` +
      `${result.files.map((file) => `${file.logicalName} (${file.type})`).join(', ')}\n`,
  );
  process.stdout.write(
    `  ${'verified'.padEnd(20)} RESTORE VERIFYONLY ... WITH CHECKSUM succeeded\n`,
  );

  process.stdout.write(
    `\nBackup written inside the SQL Server container and verified.\n` +
      `It is NOT on the host and is never part of the working tree.\n` +
      `Remove it with: docker exec minhaj-sqlserver-2022 rm -f ${result.target.path}\n`,
  );
} finally {
  await admin.close();
}
