import 'server-only';

import { getDatabaseMigrationUrl } from '../src/config.ts';
import { runSeed } from '../src/lifecycle/seed.ts';
import { openSession, parseSqlServerUrl } from '../src/lifecycle/sql-connection.ts';

/**
 * `npm run db:seed` — runs the Phase 1 seed against the configured database.
 *
 * Seeding uses the MIGRATION connection: seeding is an administrative
 * lifecycle action, not application traffic, and later phases will seed tables
 * the least-privilege runtime principal deliberately cannot write.
 */

const session = await openSession(parseSqlServerUrl(getDatabaseMigrationUrl()));

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
