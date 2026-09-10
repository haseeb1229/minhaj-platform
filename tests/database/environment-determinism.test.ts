import { spawn } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { getDatabaseMigrationUrl } from '../../packages/database/src/config.ts';
import {
  describeConnection,
  formatConnectionMetadata,
  resolveLocalDatabaseEnvironment,
} from '../../packages/database/src/lifecycle/local-environment.ts';
import {
  assertApprovedLocalTarget,
  DEFAULT_LOCAL_SQL_PORT,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import { buildPrismaChildEnvironment } from '../../packages/database/src/lifecycle/migrations.ts';
import { repoRoot } from '../architecture/architecture-harness.ts';

/**
 * Cross-shell determinism for the local database lifecycle.
 *
 * `docker/.env` was read by two parsers with different rules and the wrong
 * precedence: Node's `--env-file-if-exists` fills only variables that are NOT
 * already set, so a `DATABASE_MIGRATION_URL` left in one terminal silently
 * outranked the file. Two shells then ran the same repository command against
 * different databases with different TLS settings, and one saw the Prisma CLI
 * fail with P1011 while another saw it pass.
 *
 * The flag is gone. These tests run FRESH CHILD PROCESSES with deliberately
 * contaminated environments, because an in-process assertion cannot prove what
 * a new shell would do — and they spawn them WITHOUT the flag, so they exercise
 * what `npm run db:*` actually does now.
 */

/** A synthetic URL: wrong TLS, wrong database, never a real credential. */
const CONTAMINATED_URL =
  'sqlserver://localhost:14330;database=WrongDatabase;user=sa;' +
  'password=SYNTHETIC_DETERMINISM_MARKER;encrypt=true';

const configured = (() => {
  try {
    getDatabaseMigrationUrl(
      resolveLocalDatabaseEnvironment({ requireLocalFile: false }).values,
    );
    return true;
  } catch {
    return false;
  }
})();

interface RunResult {
  exitCode: number;
  output: string;
}

/**
 * Runs a Node script in a fresh process with an explicit environment.
 *
 * No `--env-file-if-exists`: the repository loader is the only thing that reads
 * `docker/.env`, and a test that kept the flag would be proving the behaviour
 * of a command line no `db:*` script uses.
 */
async function runFresh(
  script: string,
  environment: NodeJS.ProcessEnv,
): Promise<RunResult> {
  const child = spawn(process.execPath, ['--conditions=react-server', '-e', script], {
    cwd: repoRoot,
    env: { ...process.env, ...environment, NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

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
 * Prints safe connection metadata from a fresh process, resolved exactly as a
 * `db:*` command resolves it.
 */
const REPORT_METADATA_SCRIPT = `
  const { resolveLocalDatabaseEnvironment, describeConnection, formatConnectionMetadata } =
    await import('./packages/database/src/lifecycle/local-environment.ts');
  const { getDatabaseMigrationUrl } = await import('./packages/database/src/config.ts');
  const { assertApprovedLocalTarget, localTargetPolicy } =
    await import('./packages/database/src/lifecycle/local-target.ts');

  const environment = resolveLocalDatabaseEnvironment({ requireLocalFile: true });
  const connection = assertApprovedLocalTarget(
    getDatabaseMigrationUrl(environment.values),
    localTargetPolicy(environment.values, 'source', 'migration'),
  );
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
    const environment = resolveLocalDatabaseEnvironment({ requireLocalFile: true });
    const intended = getDatabaseMigrationUrl(environment.values);

    // The base is the RESOLVED record, not `process.env`: the child's
    // configuration is data this caller holds, not a side effect it hopes
    // happened first.
    const childEnvironment = buildPrismaChildEnvironment(intended, {
      ...environment.values,
      DATABASE_MIGRATION_URL: CONTAMINATED_URL,
    });

    expect(childEnvironment['DATABASE_MIGRATION_URL']).toBe(intended);
    // Competing sources are cleared, not merely outranked.
    expect(childEnvironment['DATABASE_URL']).toBeUndefined();
    expect(childEnvironment['PRISMA_DATABASE_URL']).toBeUndefined();
  });

  it('reports docker/.env displacing a conflicting shell value', () => {
    const resolved = resolveLocalDatabaseEnvironment({
      requireLocalFile: true,
      processEnvironment: { DATABASE_MIGRATION_URL: CONTAMINATED_URL },
    });

    expect(resolved.localFilePresent).toBe(true);
    expect(resolved.overridden).toContain('DATABASE_MIGRATION_URL');
    expect(resolved.values['DATABASE_MIGRATION_URL']).not.toBe(CONTAMINATED_URL);
  });

  it('leaves externally supplied configuration the file does not mention alone', () => {
    // A deployed context has no docker/.env at all; here the point is narrower:
    // keys the file does not supply survive untouched.
    const externallySupplied = 'sqlserver://prod-host:1433;database=D;user=u;pwd=v';

    const resolved = resolveLocalDatabaseEnvironment({
      requireLocalFile: true,
      processEnvironment: { SOME_UNRELATED_KEY: externallySupplied },
    });

    expect(resolved.values['SOME_UNRELATED_KEY']).toBe(externallySupplied);
  });
});

describe('local migration configuration fails closed', () => {
  const policy = localTargetPolicy(
    {
      MINHAJ_SQLSERVER_PORT: String(DEFAULT_LOCAL_SQL_PORT),
      DATABASE_APP_LOGIN: 'minhaj_app',
    },
    'source',
    'migration',
  );

  it('rejects an unencrypted migration URL', () => {
    expect(() =>
      assertApprovedLocalTarget(
        'sqlserver://localhost:14330;database=MinhajPlatform;user=sa;' +
          'password=SYNTHETIC_DETERMINISM_MARKER;encrypt=false',
        policy,
      ),
    ).toThrow(/not encrypted/);
  });

  it('rejects a URL missing the local certificate accommodation', () => {
    // This exact shape is what produced P1011 across sessions.
    let thrown: unknown;
    try {
      assertApprovedLocalTarget(
        'sqlserver://localhost:14330;database=MinhajPlatform;user=sa;' +
          'password=SYNTHETIC_DETERMINISM_MARKER;encrypt=true',
        policy,
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
    const connection = assertApprovedLocalTarget(
      'sqlserver://localhost:14330;database=MinhajPlatform;user=sa;' +
        'password=SYNTHETIC_DETERMINISM_MARKER;encrypt=true;trustServerCertificate=true',
      policy,
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

describe('the lifecycle command runs in a fresh process', () => {
  it('fails closed when the resolved local configuration is invalid', async () => {
    const script = `
      const { assertApprovedLocalTarget, localTargetPolicy } =
        await import('./packages/database/src/lifecycle/local-target.ts');
      assertApprovedLocalTarget(
        process.env.PROBE_URL,
        localTargetPolicy({ DATABASE_APP_LOGIN: 'minhaj_app' }, 'source', 'migration'),
      );
    `;

    const { exitCode, output } = await runFresh(script, {
      PROBE_URL:
        'sqlserver://localhost:14330;database=MinhajPlatform;user=sa;' +
        'password=SYNTHETIC_DETERMINISM_MARKER;encrypt=false',
    });

    expect(exitCode).not.toBe(0);
    expect(output).toMatch(/not encrypted/);
    expect(output).not.toContain('SYNTHETIC_DETERMINISM_MARKER');
  }, 120_000);

  it('refuses a non-local target in a fresh process, before anything runs', async () => {
    // The F5 case, end to end: a URL that satisfied the old guard completely.
    const script = `
      const { assertApprovedLocalTarget, localTargetPolicy } =
        await import('./packages/database/src/lifecycle/local-target.ts');
      assertApprovedLocalTarget(
        process.env.PROBE_URL,
        localTargetPolicy({ DATABASE_APP_LOGIN: 'minhaj_app' }, 'source', 'migration'),
      );
      process.stdout.write('THE GUARD LET THIS THROUGH');
    `;

    const { exitCode, output } = await runFresh(script, {
      PROBE_URL:
        'sqlserver://nonlocal.invalid:14330;database=MinhajPlatform;user=sa;' +
        'password=SYNTHETIC_DETERMINISM_MARKER;encrypt=true;trustServerCertificate=true',
    });

    expect(exitCode).not.toBe(0);
    expect(output).not.toContain('THE GUARD LET THIS THROUGH');
    expect(output).toMatch(/not the loopback interface/);
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
