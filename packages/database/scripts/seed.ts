import 'server-only';

import { runSeed } from '../src/lifecycle/seed.ts';
import { openSession } from '../src/lifecycle/sql-connection.ts';
import { reportConfiguration, startLocalCommand } from './local-bootstrap.ts';

/**
 * `npm run db:seed` — runs the Phase 1 seed against the local Phase 1 database.
 *
 * Seeding uses the MIGRATION connection: seeding is an administrative
 * lifecycle action, not application traffic, and later phases will seed tables
 * the least-privilege runtime principal deliberately cannot write.
 *
 * ## What changed here
 *
 * This command used to resolve nothing and prove nothing. It read
 * `process.env` directly — relying on `--env-file-if-exists`, which defers to
 * whatever the shell already carried — and passed the result to
 * `parseSqlServerUrl`, which validates only that a URL is well formed. A stale
 * `DATABASE_MIGRATION_URL` pointing anywhere at all would have been accepted,
 * and this command WRITES ROWS. It now starts where every other local
 * lifecycle command starts.
 */

const command = startLocalCommand('source');
const session = await openSession(command.connection);

process.stdout.write(`Phase 1 seed of ${command.connection.database}\n`);
reportConfiguration(command);

try {
  const result = await runSeed(session);

  process.stdout.write(
    `Seed complete: ${result.seededRecords} record(s) seeded; ` +
      `${result.auditRowCount} existing audit row(s); ` +
      `migrations applied: ${result.appliedMigrations.join(', ')}.\n`,
  );
} finally {
  await session.close();
}
