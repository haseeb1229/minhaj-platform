import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = readFileSync(
  path.join(repoRoot, '.github', 'workflows', 'ci.yml'),
  'utf8',
);

/**
 * Guards the three fresh-runner defects the first remote CI run exposed.
 *
 * All three passed locally and failed on a clean runner, because a workstation
 * carries state a fresh checkout does not: generated Prisma output, and a
 * `docker/.env` that a developer's shell already resolved. These assertions
 * read the committed workflow, so a future edit cannot quietly restore any of
 * the three conditions.
 *
 * They deliberately check ORDERING and CHARACTER SAFETY rather than re-running
 * CI. What broke was the arrangement of correct steps, not the steps.
 */

/** The `run:` body of a named workflow step. */
function stepBody(name: string): string {
  const escaped = name.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(
    `- name: ${escaped}\\n([\\s\\S]*?)(?=\\n      - name: |\\n  [a-z-]+:\\n)`,
  ).exec(workflow);
  return match?.[1] ?? '';
}

/** Index of a named step within the file, for ordering assertions. */
function stepIndex(name: string): number {
  return workflow.indexOf(`- name: ${name}`);
}

describe('A — the Verify job generates the Prisma client before it is needed', () => {
  /**
   * `node_modules/.prisma` is generated output and is not committed, so on a
   * clean `npm ci` `@prisma/client` re-exports a module that does not exist
   * and `client.ts` fails with TS2305.
   */
  it('runs the generate step after install and before type check', () => {
    const install = stepIndex('Install dependencies');
    const generate = stepIndex('Generate the Prisma client');
    const typecheck = stepIndex('Type check');

    expect(install).toBeGreaterThan(-1);
    expect(generate).toBeGreaterThan(-1);
    expect(typecheck).toBeGreaterThan(-1);

    expect(generate).toBeGreaterThan(install);
    expect(generate).toBeLessThan(typecheck);
  });

  it('also precedes the other steps that compile or run database source', () => {
    const generate = stepIndex('Generate the Prisma client');

    for (const dependent of ['Lint', 'Tests', 'Production build']) {
      expect(stepIndex(dependent)).toBeGreaterThan(generate);
    }
  });

  /** Generation must not need a database — it reads the schema only. */
  it('generates through the schema-only repository command', () => {
    expect(stepBody('Generate the Prisma client')).toContain('npm run db:generate');
  });

  /**
   * The Prisma client is generated, not committed — which is precisely why the
   * generation step above has to exist.
   *
   * This asserts it from the SCHEMA rather than from `.gitignore`. The earlier
   * revision read `.gitignore`, which is version-control metadata that
   * `.dockerignore` deliberately keeps out of the image, so the assertion
   * threw ENOENT inside the Docker test stage — a test failing on where it
   * ran rather than on what it checks. The generator block is the real
   * contract: it emits into `node_modules`, so there is no in-tree output a
   * commit could capture.
   */
  it('generates the Prisma client into node_modules, never into the tree', () => {
    const schema = readFileSync(
      path.join(repoRoot, 'packages', 'database', 'prisma', 'schema.prisma'),
      'utf8',
    );

    const generator = /generator\s+client\s*\{([\s\S]*?)\}/.exec(schema)?.[1] ?? '';
    expect(generator).toContain('prisma-client-js');
    // No `output` override: the default lands in `node_modules/.prisma`.
    expect(generator).not.toMatch(/^\s*output\s*=/m);
  });

  /**
   * `prisma.config.ts` resolves `env('DATABASE_MIGRATION_URL')` when the CONFIG
   * LOADS, before Prisma knows which command was requested — so even
   * `generate`, which touches no database, fails without it on a runner that
   * has no `docker/.env`.
   */
  it('gives the generation step its own synthetic migration URL', () => {
    const body = stepBody('Generate the Prisma client');

    expect(body).toContain('env:');
    expect(body).toMatch(/DATABASE_MIGRATION_URL:\s*sqlserver:\/\//);
  });

  it('scopes that URL to the step rather than the whole job', () => {
    // A job-wide `env:` block would let the live database steps inherit the
    // synthetic target instead of failing closed on missing configuration.
    const verifyJob = workflow.slice(
      workflow.indexOf('  verify:'),
      workflow.indexOf('  container:'),
    );

    // Count real YAML assignments, ignoring comment lines that merely name the
    // variable while explaining why the step needs it.
    const assignments = verifyJob
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .filter((line) => /^\s*DATABASE_MIGRATION_URL:/.test(line));

    expect(assignments.length).toBe(1);

    // And it belongs to the generate step, not to a job-wide `env:` block.
    const generateStep = stepBody('Generate the Prisma client');
    expect(generateStep).toContain('DATABASE_MIGRATION_URL:');

    // A job-level `env:` sits before the first step; the job's own block must
    // carry no database configuration.
    const jobHeader = verifyJob.slice(0, verifyJob.indexOf('    steps:'));
    expect(jobHeader).not.toContain('DATABASE_MIGRATION_URL');
  });

  it('uses an obviously synthetic, non-secret target', () => {
    const url = /DATABASE_MIGRATION_URL:\s*(\S+)/.exec(
      stepBody('Generate the Prisma client'),
    )?.[1];

    expect(url).toBeDefined();
    // Names that exist nowhere: nothing authenticates with this.
    expect(url).toContain('database=PrismaGenerateOnly');
    expect(url).toContain('user=generate_only');
    expect(url).toMatch(/password=GenerateOnly/);
    // Loopback only — it can never reach a deployed database.
    expect(url).toMatch(/^sqlserver:\/\/127\.0\.0\.1:/);
    // Parser-safe, for the same reason the CI credentials are (see B).
    expect(url?.split('password=')[1]?.split(';')[0]).not.toContain('#');
  });

  /**
   * `prisma.config.ts` must stay fail-closed. Making the migration URL
   * optional would satisfy `generate` by weakening the contract for every
   * command that genuinely needs a database.
   */
  it('keeps the migration URL required in the Prisma config', () => {
    const config = readFileSync(
      path.join(repoRoot, 'packages', 'database', 'prisma.config.ts'),
      'utf8',
    );

    expect(config).toContain("env('DATABASE_MIGRATION_URL')");
    expect(config).not.toMatch(/\?\?|process\.argv|fallback|default:/);
  });
});

describe('A (behavioural) — generation on a true clean runner', () => {
  /**
   * The assertions above read YAML; this one runs the thing.
   *
   * Every earlier local proof passed because the workstation had
   * `docker/.env` and previously generated output — exactly the state a fresh
   * GitHub runner lacks, which is why CI failed where the laptop did not. So
   * this spawns a real child process with the database variables stripped and
   * checks the actual outcome.
   *
   * It deliberately does NOT delete `node_modules/.prisma`: the suite must not
   * mutate the working tree it runs in. Removing generated output is what the
   * first proof does by hand; what matters here is that config loading — the
   * step that actually failed — succeeds or fails as expected.
   */
  const CLEAN_ENV = { ...process.env };
  delete CLEAN_ENV['DATABASE_URL'];
  delete CLEAN_ENV['DATABASE_MIGRATION_URL'];
  delete CLEAN_ENV['PRISMA_DATABASE_URL'];

  const syntheticUrl =
    /DATABASE_MIGRATION_URL:\s*(\S+)/.exec(stepBody('Generate the Prisma client'))?.[1] ??
    '';

  function runGenerate(environment: NodeJS.ProcessEnv): {
    status: number | null;
    output: string;
  } {
    const result = spawnSync(
      process.execPath,
      [
        path.join(repoRoot, 'node_modules', 'prisma', 'build', 'index.js'),
        'generate',
        '--config',
        path.join(repoRoot, 'packages', 'database', 'prisma.config.ts'),
      ],
      {
        cwd: repoRoot,
        env: { ...environment, NO_COLOR: '1' },
        encoding: 'utf8',
        timeout: 180_000,
      },
    );

    return {
      status: result.status,
      output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    };
  }

  it('fails without the synthetic URL, naming the unresolved variable', () => {
    const { status, output } = runGenerate(CLEAN_ENV);

    expect(status).not.toBe(0);
    expect(output).toContain('DATABASE_MIGRATION_URL');
    expect(output).toMatch(/Cannot resolve environment variable|PrismaConfigEnvError/);
  });

  it('succeeds with the exact URL the workflow step supplies', () => {
    expect(syntheticUrl).not.toBe('');

    const { status, output } = runGenerate({
      ...CLEAN_ENV,
      DATABASE_MIGRATION_URL: syntheticUrl,
    });

    expect(status).toBe(0);
    expect(output).toContain('Generated Prisma Client');
  });

  /**
   * The synthetic target is unreachable by construction, so a run that
   * succeeds against it cannot have connected to anything. Pointing at a port
   * nothing listens on makes that explicit rather than incidental.
   */
  it('opens no database connection, proven against a dead port', () => {
    const { status, output } = runGenerate({
      ...CLEAN_ENV,
      DATABASE_MIGRATION_URL: syntheticUrl.replace(':14330;', ':59999;'),
    });

    expect(status).toBe(0);
    expect(output).toContain('Generated Prisma Client');
  });
});

describe('B — CI credentials survive every parser that reads docker/.env', () => {
  /**
   * `docker/.env` is read by the repository loader (split at the first `=`)
   * and by Node's `--env-file` (dotenv rules). Characters that mean something
   * to one and not the other make the two disagree about the same file.
   *
   * `#` is what actually broke: dotenv treats it as a comment, so a password
   * containing one truncated `DATABASE_MIGRATION_URL` mid-value and discarded
   * the `encrypt=true;trustServerCertificate=true` that followed — producing
   * P1011 against the container's self-signed certificate.
   */
  const RECIPE = /(?:SA|APP)_PASSWORD="([^"]+)"/g;

  const recipes = [...workflow.matchAll(RECIPE)].map((match) => match[1] ?? '');

  it('defines both ephemeral credentials', () => {
    expect(recipes.length).toBe(2);
  });

  it.each([
    ['#', 'dotenv comment character — truncates the value and its TLS settings'],
    [';', 'connection-string separator'],
    ['=', 'key/value separator'],
    ['{', 'connection-string brace quoting'],
    ['}', 'connection-string brace quoting'],
    ['"', 'quote'],
    ["'", 'quote'],
    ['\\', 'escape'],
    ['$', 'shell and dotenv expansion'],
    ['`', 'shell substitution'],
  ])('never emits %s (%s)', (character) => {
    for (const recipe of recipes) {
      // The literal parts of the recipe: everything outside `$(...)`.
      expect(recipe.replaceAll(/\$\([^)]*\)/g, '')).not.toContain(character);
    }
  });

  /**
   * `openssl rand -hex` emits `[0-9a-f]` only. `-base64` emits `+`, `/` and
   * `=`, which is why the earlier recipe needed a `tr -d` filter and still
   * carried a `#` in its fixed suffix.
   */
  it('draws entropy from a hex alphabet', () => {
    for (const recipe of recipes) {
      expect(recipe).toMatch(/\$\(openssl rand -hex \d+\)/);
      expect(recipe).not.toContain('-base64');
    }
  });

  /** Both parsers must resolve the identical, complete URL. */
  it('produces a URL that keeps its TLS settings under both parsers', () => {
    // A synthetic password shaped exactly like the recipe's output.
    const password = `Ci${'a1b2c3d4'.repeat(6)}!1aZ`;
    const line =
      `DATABASE_MIGRATION_URL=sqlserver://localhost:14330;database=MinhajPlatform;` +
      `user=sa;password=${password};encrypt=true;trustServerCertificate=true`;

    // The repository loader: split at the first `=`, keep the remainder.
    const loaderValue = line.slice(line.indexOf('=') + 1);

    // Node's `--env-file`: an unquoted `#` starts a comment.
    const dotenvValue = (loaderValue.split('#')[0] ?? '').trim();

    expect(loaderValue).toContain('encrypt=true');
    expect(loaderValue).toContain('trustServerCertificate=true');
    expect(dotenvValue).toBe(loaderValue);
    expect(dotenvValue).toContain('trustServerCertificate=true');
  });

  /** The regression itself: the old recipe loses its TLS settings. */
  it('demonstrates why a # in the password broke the migration step', () => {
    const line =
      `DATABASE_MIGRATION_URL=sqlserver://localhost:14330;database=MinhajPlatform;` +
      `user=sa;password=Ciabc#1aZ;encrypt=true;trustServerCertificate=true`;

    const loaderValue = line.slice(line.indexOf('=') + 1);
    const dotenvValue = (loaderValue.split('#')[0] ?? '').trim();

    expect(loaderValue).toContain('trustServerCertificate=true');
    // The parsers disagree — this is the P1011 the remote run hit.
    expect(dotenvValue).not.toContain('trustServerCertificate=true');
  });

  /**
   * One loader, one interpretation. The persistent migration goes through the
   * repository command rather than a raw `--env-file` CLI invocation.
   */
  it('applies persistent migrations through the repository command', () => {
    const body = stepBody('Apply migrations to the Phase 1 database');

    expect(body).toContain('npm run db:migrate:deploy');
    expect(body).not.toContain('--env-file=docker/.env');
  });

  it('masks both generated credentials in the log', () => {
    const body = stepBody('Generate ephemeral database credentials');

    expect(body).toContain('::add-mask::$SA_PASSWORD');
    expect(body).toContain('::add-mask::$APP_PASSWORD');
  });

  it('adds no committed secret and no repository secret', () => {
    expect(workflow).not.toContain('secrets.');
  });
});

describe('C — compose validation keeps its fail-closed guard', () => {
  const compose = readFileSync(path.join(repoRoot, 'docker', 'compose.yaml'), 'utf8');

  /**
   * The `:?` form makes the stack refuse to start without a password rather
   * than defaulting `sa` to an empty one. CI needed a value to render the
   * file; the fix supplies a synthetic one to that step instead of removing
   * the guard.
   */
  it('still requires MSSQL_SA_PASSWORD', () => {
    expect(compose).toMatch(/\$\{MSSQL_SA_PASSWORD:\?/);
  });

  it('hard-codes no password in the compose file', () => {
    expect(compose).not.toMatch(/MSSQL_SA_PASSWORD:\s*['"]?[A-Za-z0-9!@#$%^&*]{6,}/);
  });

  it('supplies a config-only value to the validation step', () => {
    const index = stepIndex('Validate the compose stack');
    expect(index).toBeGreaterThan(-1);

    // The `env:` block sits between the step name and its `run:`.
    const body = workflow.slice(index, index + 400);
    expect(body).toContain('MSSQL_SA_PASSWORD:');
    expect(body).toContain('docker compose -f docker/compose.yaml config');
  });

  /** The value must never be mistaken for a real credential. */
  it('names the value as configuration-only', () => {
    const index = stepIndex('Validate the compose stack');
    const body = workflow.slice(index, index + 400);
    expect(body).toMatch(/MSSQL_SA_PASSWORD:\s*ComposeConfigOnly/);
  });
});
