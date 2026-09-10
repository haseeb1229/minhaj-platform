import 'server-only';

import { deployMigrations, migrationStatus } from '../src/lifecycle/migrations.ts';
import { reportConfiguration, startLocalCommand } from './local-bootstrap.ts';

/**
 * `npm run db:migrate:deploy` — applies pending migrations to the PERSISTENT
 * local Phase 1 database with the real Prisma CLI.
 *
 * Deliberate and explicit (ARCHITECTURE.md §10.3: migrations are reviewed and
 * applied deliberately, never automatically on deploy). Nothing invokes this
 * as a side effect of another command; it is run when someone means to change
 * a persistent database, and by the CI job that must bring `MinhajPlatform`
 * to the migrated state its recovery proof reads from.
 *
 * ## This is LOCAL lifecycle tooling, not a deployment command
 *
 * Despite the name it inherits from `prisma migrate deploy`, this targets the
 * local Docker SQL Server and nothing else: `startLocalCommand` requires
 * `docker/.env` and proves the target is loopback, on the configured local
 * port, and is `MinhajPlatform` or a disposable database. Deploying schema to a
 * hosted environment is a Phase 28 concern with a pipeline that does not exist
 * yet; when it arrives it will be its own command with its own configuration
 * path, not this one pointed somewhere else.
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
 * The credential recipe no longer emits `#`, and the second parser is gone
 * entirely: `--env-file-if-exists` has been removed from every `db:*` script,
 * so `docker/.env` now has exactly one reader.
 *
 * No migration behaviour is defined here. `deployMigrations()` is the same
 * function the Chunk 2 lifecycle gate uses, so the reviewed path and this one
 * cannot drift apart.
 */

// Fails closed before the CLI is launched on: a missing or unreadable
// `docker/.env`, a non-loopback host, the wrong port, a database this command
// may not migrate, a migration principal that is the runtime principal, or a
// URL without the local TLS posture — the class of defect that produced P1011,
// caught here rather than as an opaque failure several steps later.
const command = startLocalCommand('migration-target');
const { connection, migrationUrl, environment } = command;

process.stdout.write(`Applying migrations to ${connection.database}\n`);

// Safe metadata only: never the password, never the whole URL.
reportConfiguration(command);

// The child receives the RESOLVED environment explicitly, so a stale
// `DATABASE_MIGRATION_URL` in the caller's shell cannot reach the CLI.
const deploy = await deployMigrations(migrationUrl, environment.values);
process.stdout.write(`  ${'migrate deploy'.padEnd(20)} applied by the real Prisma CLI\n`);

const status = await migrationStatus(migrationUrl, environment.values);
if (!status.output.includes('Database schema is up to date!')) {
  throw new Error(
    `prisma migrate status is not healthy after deploy.\n${status.output.trim()}`,
  );
}
process.stdout.write(`  ${'migrate status'.padEnd(20)} database schema is up to date\n`);

// The CLI output is the record of what Prisma actually did; printed last so a
// deploy that applied nothing is visible rather than implied.
process.stdout.write(`\n${deploy.output.trim()}\n`);
