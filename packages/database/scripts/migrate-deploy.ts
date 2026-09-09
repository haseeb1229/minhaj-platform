import 'server-only';

// Applied BEFORE any configuration is read: `docker/.env` is authoritative for
// local lifecycle tooling, so a stale shell variable cannot decide which
// database this deploy targets.
import { loadLocalDatabaseEnvironment } from '../src/lifecycle/local-environment.ts';

const localEnvironment = loadLocalDatabaseEnvironment();

const { getDatabaseMigrationUrl } = await import('../src/config.ts');
import {
  assertLocalMigrationConnection,
  describeConnection,
  formatConnectionMetadata,
} from '../src/lifecycle/local-environment.ts';
import { deployMigrations, migrationStatus } from '../src/lifecycle/migrations.ts';

/**
 * `npm run db:migrate:deploy` — applies pending migrations to the PERSISTENT
 * configured database with the real Prisma CLI.
 *
 * Deliberate and explicit (ARCHITECTURE.md §10.3: migrations are reviewed and
 * applied deliberately, never automatically on deploy). Nothing invokes this
 * as a side effect of another command; it is run when someone means to change
 * a persistent database, and by the CI job that must bring `MinhajPlatform`
 * to the migrated state its recovery proof reads from.
 *
 * ## Why this exists rather than a raw CLI invocation
 *
 * CI previously ran the Prisma CLI directly under `node --env-file=docker/.env`.
 * That put a SECOND parser on the same file: the repository loader splits each
 * line at the first `=`, while Node's `--env-file` follows dotenv rules and
 * treats an unquoted `#` as a comment. A generated CI password containing `#`
 * was therefore truncated mid-URL, silently discarding the
 * `encrypt=true;trustServerCertificate=true` that followed it, and Prisma met
 * the container's self-signed certificate without the accommodation and failed
 * with P1011 — while every command routed through the repository loader passed
 * in the very same run.
 *
 * The credential recipe no longer emits `#`, but two parsers disagreeing about
 * one file is the defect underneath that symptom. This script closes it: every
 * database command now resolves configuration through
 * `loadLocalDatabaseEnvironment()` and hands the URL to the Prisma child
 * explicitly, exactly as `db:migrate:test` does.
 *
 * No migration behaviour is defined here. `deployMigrations()` is the same
 * function the Chunk 2 lifecycle gate uses, so the reviewed path and this one
 * cannot drift apart.
 */

const migrationUrl = getDatabaseMigrationUrl();
// Fails closed on a URL that is unencrypted, missing the local certificate
// accommodation, or lacking a migration principal — the class of defect that
// produced P1011, caught before the CLI is launched rather than as an opaque
// failure several steps later.
const connection = assertLocalMigrationConnection(migrationUrl);

process.stdout.write(`Applying migrations to ${connection.database}\n`);

// Safe metadata only: never the password, never the whole URL.
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

const deploy = await deployMigrations(migrationUrl);
process.stdout.write(`  ${'migrate deploy'.padEnd(20)} applied by the real Prisma CLI\n`);

const status = await migrationStatus(migrationUrl);
if (!status.output.includes('Database schema is up to date!')) {
  throw new Error(
    `prisma migrate status is not healthy after deploy.\n${status.output.trim()}`,
  );
}
process.stdout.write(`  ${'migrate status'.padEnd(20)} database schema is up to date\n`);

// The CLI output is the record of what Prisma actually did; printed last so a
// deploy that applied nothing is visible rather than implied.
process.stdout.write(`\n${deploy.output.trim()}\n`);
