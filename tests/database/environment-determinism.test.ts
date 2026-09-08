import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { getDatabaseMigrationUrl } from '../../packages/database/src/config.ts';
import {
  assertLocalMigrationConnection,
  describeConnection,
  formatConnectionMetadata,
  loadLocalDatabaseEnvironment,
} from '../../packages/database/src/lifecycle/local-environment.ts';
import { buildPrismaChildEnvironment } from '../../packages/database/src/lifecycle/migrations.ts';
import { repoRoot } from '../architecture/architecture-harness.ts';

/**
 * Cross-shell determinism for the local database lifecycle.
 *
 * Node's `--env-file-if-exists` only fills variables that are NOT already set,
 * so a `DATABASE_MIGRATION_URL` left in one terminal silently outranked
 * `docker/.env`. Two shells then ran the same repository command against
 * different TLS settings, and one saw the Prisma CLI fail with P1011 while
 * another saw it pass.
 *
 * These tests run FRESH CHILD PROCESSES with deliberately contaminated
 * environments, because an in-process assertion cannot prove what a new shell
 * would do.
 */

/** A synthetic URL: wrong TLS, wrong database, never a real credential. */
const CONTAMINATED_URL =
  'sqlserver://localhost:14330;database=WrongDatabase;user=sa;' +
  'password=SYNTHETIC_DETERMINISM_MARKER;encrypt=true';

const configured = (() => {
  try {
    getDatabaseMigrationUrl();
    return true;
  } catch {
    return false;
  }
})();

interface RunResult {
  exitCode: number;
  output: string;
}

/** Runs a Node script in a fresh process with an explicit environment. */
async function runFresh(
  script: string,
  environment: NodeJS.ProcessEnv,
): Promise<RunResult> {
  const child = spawn(
    process.execPath,
    ['--env-file-if-exists=docker/.env', '--conditions=react-server', '-e', script],
    {
      cwd: repoRoot,
      env: { ...process.env, ...environment, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let output = '';
  child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));

  const exitCode = await new Promise<number>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });

  return { exitCode, output };
}

/**
 * Prints safe connection metadata from a fresh process, so the assertions
 * observe what a new shell actually resolves.
 */
const REPORT_METADATA_SCRIPT = `
  const { loadLocalDatabaseEnvironment, describeConnection, formatConnectionMetadata } =
    await import('./packages/database/src/lifecycle/local-environment.ts');
  loadLocalDatabaseEnvironment();
  const { getDatabaseMigrationUrl } = await import('./packages/database/src/config.ts');
  const { parseSqlServerUrl } = await import('./packages/database/src/lifecycle/sql-connection.ts');
  const connection = parseSqlServerUrl(getDatabaseMigrationUrl());
  process.stdout.write(formatConnectionMetadata(describeConnection(connection, 'docker/.env')));
`;

describe.skipIf(!configured)('local database configuration is deterministic', () => {
  it('resolves docker/.env over a stale shell variable in a fresh process', async () => {
    const clean = await runFresh(REPORT_METADATA_SCRIPT, {});
    const contaminated = await runFresh(REPORT_METADATA_SCRIPT, {
      DATABASE_MIGRATION_URL: CONTAMINATED_URL,
    });

    expect(clean.exitCode, clean.output).toBe(0);
    expect(contaminated.exitCode, contaminated.output).toBe(0);

    // The whole point: a contaminated shell resolves IDENTICALLY to a clean one.
    expect(contaminated.output).toBe(clean.output);

    // And it did not adopt the stale values.
    expect(contaminated.output).not.toContain('WrongDatabase');
    expect(contaminated.output).toContain('trustServerCertificate=true');
    expect(contaminated.output).toContain('encrypt=true');
  }, 120_000);

  it('reports only safe metadata, never the password or the URL', async () => {
    const { output } = await runFresh(REPORT_METADATA_SCRIPT, {
      DATABASE_MIGRATION_URL: CONTAMINATED_URL,
    });

    expect(output).toMatch(/host=\S+:\d+/);
    expect(output).toMatch(/database=\S+/);
    expect(output).toMatch(/user=\S+/);
    expect(output).toContain('encrypt=true');

    expect(output).not.toContain('SYNTHETIC_DETERMINISM_MARKER');
    expect(output).not.toContain('password');
    expect(output).not.toContain('sqlserver://');
  }, 120_000);

  it('hands the Prisma CLI child an environment it cannot mis-resolve', () => {
    const intended = getDatabaseMigrationUrl();
    const environment = buildPrismaChildEnvironment(intended);

    expect(environment['DATABASE_MIGRATION_URL']).toBe(intended);
    // Competing sources are cleared, not merely outranked.
    expect(environment['DATABASE_URL']).toBeUndefined();
    expect(environment['PRISMA_DATABASE_URL']).toBeUndefined();
  });

  it('reports docker/.env displacing a conflicting shell value', () => {
    const target: NodeJS.ProcessEnv = { DATABASE_MIGRATION_URL: CONTAMINATED_URL };
    const result = loadLocalDatabaseEnvironment(target);

    expect(result.localFilePresent).toBe(true);
    expect(result.overridden).toContain('DATABASE_MIGRATION_URL');
    expect(target['DATABASE_MIGRATION_URL']).not.toBe(CONTAMINATED_URL);
  });

  it('leaves the shell alone when the local file supplies nothing', () => {
    // A deployed context has no docker/.env; externally supplied configuration
    // must survive untouched.
    const externallySupplied = 'sqlserver://prod-host:1433;database=D;user=u;pwd=v';
    const target: NodeJS.ProcessEnv = { SOME_UNRELATED_KEY: externallySupplied };

    loadLocalDatabaseEnvironment(target);

    expect(target['SOME_UNRELATED_KEY']).toBe(externallySupplied);
  });
});

describe('local migration configuration fails closed', () => {
  it('rejects an unencrypted migration URL', () => {
    expect(() =>
      assertLocalMigrationConnection(
        'sqlserver://localhost:14330;database=D;user=sa;' +
          'password=SYNTHETIC_DETERMINISM_MARKER;encrypt=false',
      ),
    ).toThrow(/encrypt=true/);
  });

  it('rejects a URL missing the local certificate accommodation', () => {
    // This exact shape is what produced P1011 across sessions.
    let thrown: unknown;
    try {
      assertLocalMigrationConnection(
        'sqlserver://localhost:14330;database=D;user=sa;' +
          'password=SYNTHETIC_DETERMINISM_MARKER;encrypt=true',
      );
    } catch (error) {
      thrown = error;
    }

    expect(String(thrown)).toMatch(/trustServerCertificate=true/);
    expect(String(thrown)).toMatch(/P1011/);
    // Diagnostics never carry the secret.
    expect(String(thrown)).not.toContain('SYNTHETIC_DETERMINISM_MARKER');
  });

  it('accepts the approved local shape and exposes only safe metadata', () => {
    const connection = assertLocalMigrationConnection(
      'sqlserver://localhost:14330;database=MinhajPlatform;user=sa;' +
        'password=SYNTHETIC_DETERMINISM_MARKER;encrypt=true;trustServerCertificate=true',
    );

    const rendered = formatConnectionMetadata(
      describeConnection(connection, 'docker/.env'),
    );

    expect(rendered).toContain('host=localhost:14330');
    expect(rendered).toContain('database=MinhajPlatform');
    expect(rendered).toContain('encrypt=true');
    expect(rendered).toContain('trustServerCertificate=true');
    expect(rendered).not.toContain('SYNTHETIC_DETERMINISM_MARKER');
  });
});

describe.skipIf(!configured)('the lifecycle command runs in a fresh process', () => {
  it('fails closed when the resolved local configuration is invalid', async () => {
    // No docker/.env available to the child, and a deliberately broken URL:
    // the command must refuse rather than silently proceeding.
    const script = `
      const { assertLocalMigrationConnection } =
        await import('./packages/database/src/lifecycle/local-environment.ts');
      assertLocalMigrationConnection(process.env.PROBE_URL);
    `;

    const { exitCode, output } = await runFresh(script, {
      PROBE_URL:
        'sqlserver://localhost:14330;database=D;user=sa;' +
        'password=SYNTHETIC_DETERMINISM_MARKER;encrypt=false',
    });

    expect(exitCode).not.toBe(0);
    expect(output).toMatch(/encrypt=true/);
    expect(output).not.toContain('SYNTHETIC_DETERMINISM_MARKER');
  }, 120_000);

  it('uses no plaintext or direct-SQL forward fallback', async () => {
    const { readFile } = await import('node:fs/promises');

    const script = await readFile(
      path.join(repoRoot, 'packages', 'database', 'scripts', 'migrate-test.ts'),
      'utf8',
    );

    // The forward direction is the CLI, and only the CLI.
    expect(script).toContain('deployMigrations');
    expect(script).toContain('migrationStatus');
    expect(script).not.toMatch(/runScript\(\s*migration\.forwardSql/);
    expect(script).not.toMatch(/INSERT INTO \[dbo\]\.\[_prisma_migrations\]/);
    expect(script).not.toMatch(/encrypt=false/i);
  });
});
