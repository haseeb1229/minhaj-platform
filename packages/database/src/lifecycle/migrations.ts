import 'server-only';

import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { SqlSession } from './sql-connection.ts';

/**
 * The forward-migration and rollback convention (SECURITY_BASELINE.md §18.2).
 *
 * Forward:  packages/database/prisma/migrations/<id>_<name>/migration.sql
 * Rollback: packages/database/sql/rollback/<id>_<name>.rollback.sql
 *
 * The identifier is the pairing key. `loadMigrations` fails when a forward
 * migration has no rollback of the same identifier, so the pair cannot drift
 * apart unnoticed — the failure mode that makes a rollback artifact worthless
 * exactly when it is needed.
 */

export const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
);

const repoRoot = path.resolve(packageRoot, '..', '..');

export const migrationsDirectory = path.join(packageRoot, 'prisma', 'migrations');
export const rollbackDirectory = path.join(packageRoot, 'sql', 'rollback');

export interface Migration {
  id: string;
  forwardSql: string;
  rollbackSql: string;
}

export async function loadMigrations(): Promise<Migration[]> {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  const ids = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  if (ids.length === 0) {
    throw new Error(`No migrations found in ${migrationsDirectory}`);
  }

  const migrations: Migration[] = [];
  for (const id of ids) {
    const forwardSql = await readFile(
      path.join(migrationsDirectory, id, 'migration.sql'),
      'utf8',
    );

    const rollbackPath = path.join(rollbackDirectory, `${id}.rollback.sql`);
    let rollbackSql: string;
    try {
      rollbackSql = await readFile(rollbackPath, 'utf8');
    } catch {
      throw new Error(
        `Migration '${id}' has no rollback artifact at ${path.relative(packageRoot, rollbackPath)}. ` +
          `Every forward migration must ship the reviewed rollback that reverses it.`,
      );
    }

    // Prisma computes and stores its own checksum when `migrate deploy` runs;
    // this module must not carry a second, competing notion of it.
    migrations.push({ id, forwardSql, rollbackSql });
  }

  return migrations;
}

export async function appliedMigrationNames(session: SqlSession): Promise<string[]> {
  // The table exists only because Prisma created it. Querying it directly (and
  // failing when it is absent) is deliberate: this must observe what the CLI
  // actually did, never create or repair that state itself.
  const rows = await session.query<{ migration_name: string }>(`
    SELECT [migration_name] FROM [dbo].[_prisma_migrations]
    WHERE [finished_at] IS NOT NULL AND [rolled_back_at] IS NULL
    ORDER BY [migration_name];
  `);
  return rows.map((row) => row.migration_name);
}

/** Result of one real Prisma CLI invocation. */
export interface PrismaCliResult {
  command: string;
  exitCode: number;
  output: string;
}

/**
 * Builds the EXACT environment the Prisma CLI child receives.
 *
 * The caller's `DATABASE_MIGRATION_URL` is replaced, never merely defaulted,
 * and the other places Prisma looks for a connection are cleared. Otherwise a
 * variable left in one terminal decides which database the CLI touches, and
 * two shells running the same command disagree — the cross-session P1011.
 */
export function buildPrismaChildEnvironment(
  databaseUrl: string | undefined,
  baseEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...baseEnvironment,
    // Prisma colourises for a TTY; plain text keeps assertions legible.
    NO_COLOR: '1',
  };

  // Competing sources Prisma would otherwise consult. Removed so the resolved
  // URL is the only connection the child can resolve.
  delete environment['DATABASE_URL'];
  delete environment['PRISMA_DATABASE_URL'];

  if (databaseUrl !== undefined) {
    environment['DATABASE_MIGRATION_URL'] = databaseUrl;
  }

  return environment;
}

/**
 * Runs the Prisma CLI against `databaseUrl`, and throws unless it exits 0.
 *
 * The forward migration path is `prisma migrate deploy` — the documented,
 * production-like workflow (SECURITY_BASELINE.md §18.2). An earlier revision
 * executed `migration.sql` directly and hand-wrote the `_prisma_migrations`
 * row, which made the lifecycle test green while never exercising the CLI at
 * all: a TLS or schema-engine failure in the real path could not have been
 * detected by it. That substitute is gone.
 *
 * The URL is passed through the environment rather than the command line so it
 * does not reach the process table, and no failure message here reproduces it.
 */
export interface PrismaCliOptions {
  /** Replaces `DATABASE_MIGRATION_URL` in the child. Omitted for offline commands. */
  databaseUrl?: string;
  /**
   * The RESOLVED environment the child starts from.
   *
   * Passed explicitly so the child's configuration is data this caller holds,
   * not a consequence of some module having mutated `process.env` first.
   */
  baseEnvironment?: NodeJS.ProcessEnv | undefined;
  /** Stream the CLI's own output instead of capturing it. */
  streamOutput?: boolean;
}

export async function runPrismaCli(
  args: readonly string[],
  options: PrismaCliOptions = {},
): Promise<PrismaCliResult> {
  const command = `prisma ${args.join(' ')}`;
  const stream = options.streamOutput === true;

  const child = spawn(
    process.execPath,
    [
      path.join(repoRoot, 'node_modules', 'prisma', 'build', 'index.js'),
      ...args,
      '--config',
      path.join(packageRoot, 'prisma.config.ts'),
    ],
    {
      cwd: repoRoot,
      env: buildPrismaChildEnvironment(options.databaseUrl, options.baseEnvironment),
      stdio: stream ? ['ignore', 'inherit', 'inherit'] : ['ignore', 'pipe', 'pipe'],
    },
  );

  let output = '';
  if (!stream) {
    child.stdout?.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr?.on('data', (chunk: Buffer) => (output += chunk.toString()));
  }

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });

  if (exitCode !== 0) {
    // P1011 (TLS) and every other CLI failure must fail the gate loudly rather
    // than fall back to direct SQL.
    throw new Error(
      `\`${command}\` failed with exit code ${exitCode}.\n` +
        `${output.trim()}\n` +
        `The real Prisma migration workflow must succeed; there is no fallback path.`,
    );
  }

  return { command, exitCode, output };
}

/**
 * Applies pending migrations with the REAL `prisma migrate deploy`.
 *
 * Returns the CLI output so a caller can assert on what Prisma reported, not
 * merely that it exited 0.
 */
export async function deployMigrations(
  databaseUrl: string,
  baseEnvironment?: NodeJS.ProcessEnv,
): Promise<PrismaCliResult> {
  return runPrismaCli(['migrate', 'deploy'], { databaseUrl, baseEnvironment });
}

/** Runs the REAL `prisma migrate status`. */
export async function migrationStatus(
  databaseUrl: string,
  baseEnvironment?: NodeJS.ProcessEnv,
): Promise<PrismaCliResult> {
  return runPrismaCli(['migrate', 'status'], { databaseUrl, baseEnvironment });
}

/**
 * Applies the reviewed rollback artifact. The artifact itself removes the
 * history row, so history and schema move together.
 */
export async function rollbackMigration(
  session: SqlSession,
  migration: Migration,
): Promise<void> {
  await session.runScript(migration.rollbackSql);
}
