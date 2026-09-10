import 'server-only';

import {
  assertBackupSourceDatabase,
  backupDatabase,
  newBackupTarget,
} from '../src/lifecycle/backup.ts';
import { openSession } from '../src/lifecycle/sql-connection.ts';
import { reportConfiguration, startLocalCommand } from './local-bootstrap.ts';

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

// Resolves docker/.env, validates the migration URL out of that resolved
// record, and proves the target is the approved local SQL Server: loopback
// host, the configured local port, MinhajPlatform, and a migration principal
// distinct from the runtime one. Nothing below runs if any of that fails.
const command = startLocalCommand('source');
const connection = command.connection;

// Belt and braces: the source-database rule stated where the backup happens.
assertBackupSourceDatabase(connection.database);

const target = newBackupTarget();
const admin = await openSession(connection);

process.stdout.write(`Phase 1 backup of ${connection.database}\n`);
reportConfiguration(command);

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
