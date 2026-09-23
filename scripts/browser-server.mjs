#!/usr/bin/env node
/**
 * The application under test, for the browser suite.
 *
 * Playwright starts this; it creates a disposable database, deploys the real
 * migrations into it, starts the PRODUCTION build against it, and drops it
 * again on the way out.
 *
 * WHY THE PRODUCTION BUILD. `next dev` recompiles per request and behaves
 * differently around caching, cookies and Server Actions, so a browser proof
 * that ran against it would be proving something the deployment does not do.
 *
 * WHY A DISPOSABLE DATABASE. The same rule the rest of the suite follows: a
 * proof run never touches `MinhajPlatform`, the system databases, or the
 * unrelated host SQLEXPRESS instance, and the target is POSITIVELY proved
 * before anything is created rather than checked against a blocklist
 * (SECURITY_BASELINE.md §18.2).
 *
 * WHAT IT DOES NOT DO. It stands up no mail outbox and no token endpoint.
 * Production keeps auth bearer material in Better Auth's `Verification`
 * record and nowhere else, and a "just for the browser tests" outbox holding
 * rendered links would be the second durable bearer store the architecture
 * exists to prevent. The specs re-materialise the token the same way a
 * delivery retry does — through the adapter's own narrow, server-only
 * operation (ARCHITECTURE.md §4.6.1).
 */

import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const webRoot = path.join(repoRoot, 'apps', 'web');

/** Where the specs read the run's configuration from. Git-ignored. */
export const ENVIRONMENT_FILE = path.join(
  repoRoot,
  'test-results',
  'browser-environment.json',
);

/**
 * Synthetic sentinels, never real credentials.
 *
 * `NODE_ENV=production` makes the environment schema reject the repository's
 * development defaults (SECURITY_BASELINE.md §18.1), which is the guard
 * working — so the run supplies its own, and they are recognisably not
 * credentials.
 */
const SECRETS = {
  AUTH_SECRETS: '1:synthetic-browser-suite-secret-0001',
  RATE_LIMIT_DIGEST_KEY: 'synthetic-browser-rate-limit-0001',
  EMAIL_DIGEST_KEY: 'synthetic-browser-email-digest-0001',
};

const port = Number(process.argv[2] ?? 3100);

async function main() {
  // The ignored local `docker/.env`, applied through the SAME loader every
  // `db:*` command and the Vitest setup use — so a browser run and a
  // `db:migrate:test` run cannot resolve different configuration and end up
  // pointed at different databases.
  const { loadLocalDatabaseEnvironment } =
    await import('../packages/database/src/lifecycle/local-environment.ts');
  loadLocalDatabaseEnvironment(process.env, { requireLocalFile: false });

  const { getDatabaseMigrationUrl } = await import('../packages/database/src/config.ts');
  const {
    createDisposableDatabase,
    dropDisposableDatabase,
    newDisposableDatabaseName,
    openMasterSession,
  } = await import('../packages/database/src/lifecycle/disposable-database.ts');
  const { deployMigrations } =
    await import('../packages/database/src/lifecycle/migrations.ts');
  const { assertApprovedLocalTarget, localTargetPolicy } =
    await import('../packages/database/src/lifecycle/local-target.ts');

  const migrationUrl = getDatabaseMigrationUrl();
  const connection = assertApprovedLocalTarget(
    migrationUrl,
    localTargetPolicy(process.env, 'source', 'migration'),
  );

  const databaseName = newDisposableDatabaseName();
  const databaseUrl = migrationUrl.replace(
    `database=${connection.database}`,
    `database=${databaseName}`,
  );

  assertApprovedLocalTarget(
    databaseUrl,
    localTargetPolicy(process.env, 'disposable', 'migration'),
  );

  const master = await openMasterSession(connection);
  await createDisposableDatabase(master, databaseName);
  await deployMigrations(databaseUrl);

  /**
   * A DISPOSABLE STORAGE ROOT, beside the disposable database (Phase 8).
   *
   * The Library serves Edition files through Storage, and Storage refuses to
   * start without an absolute root. The run gets its own temporary directory, the
   * specs may place synthetic files in it at generated keys, and cleanup removes it
   * with the database — so no byte a proof wrote outlives the run, and no proof
   * ever touches the persistent `minhaj-platform-storage-data` volume.
   */
  const storageRoot = mkdtempSync(path.join(tmpdir(), 'minhaj-browser-storage-'));

  mkdirSync(path.dirname(ENVIRONMENT_FILE), { recursive: true });
  writeFileSync(
    ENVIRONMENT_FILE,
    `${JSON.stringify({ databaseUrl, databaseName, port, storageRoot, ...SECRETS }, null, 2)}\n`,
    'utf8',
  );

  const server = spawn(process.execPath, [path.join(webRoot, 'scripts', 'start.mjs')], {
    cwd: webRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      NODE_ENV: 'production',
      npm_lifecycle_event: 'start',
      PORT: String(port),
      DATABASE_URL: databaseUrl,
      DATABASE_MIGRATION_URL: databaseUrl,
      AUTH_BASE_URL: `http://127.0.0.1:${port}`,
      EMAIL_FROM_ADDRESS: 'no-reply@browser-suite.invalid',
      EMAIL_FROM_NAME: 'Minhaj',
      LOG_LEVEL: 'warn',

      // The app is run in its DEPLOYED posture — behind a proxy that sets the
      // forwarding header — because that is the configuration the browser
      // proofs are meant to be about. It is also what lets each spec present
      // itself as a distinct visitor, which the real per-client rate limit
      // otherwise makes impossible after five accounts.
      TRUST_PROXY_HEADERS: 'true',
      // Synthetic disposable correspondence fixtures only; not a production policy.
      CORRESPONDENCE_RETENTION_DAYS: '30',

      // Phase 8. The run's own disposable storage root, and a scanner address
      // that is DELIBERATELY UNREACHABLE. The browser proofs never need a scan to
      // succeed: they serve files already recorded as clean, and they prove that
      // an upload whose scan cannot complete is refused rather than attached. An
      // unreachable scanner makes that outcome identical on a workstation running
      // ClamAV and on a CI runner that is not — and the real scanner is proved
      // where it belongs, in the Database foundation job.
      STORAGE_ROOT: storageRoot,
      CLAMAV_HOST: '127.0.0.1',
      CLAMAV_PORT: '9',
      CLAMAV_TIMEOUT_MS: '1000',

      // DELIBERATELY ABSENT: `RESEND_API_KEY` and `RESEND_WEBHOOK_SECRET`. No
      // real provider is contacted, the adapter reports itself unavailable and
      // refuses to send rather than pretending to, and the specs obtain their
      // links the way a retry does.
      ...SECRETS,
    },
  });

  let cleaning = false;

  const cleanup = async (code) => {
    if (cleaning) return;
    cleaning = true;

    if (server.exitCode === null) server.kill('SIGTERM');

    try {
      await dropDisposableDatabase(master, databaseName);
    } finally {
      await master.close();
      rmSync(ENVIRONMENT_FILE, { force: true });
      rmSync(storageRoot, { recursive: true, force: true });
    }

    process.exit(code);
  };

  // A stopped run must leave no database behind, however it stopped.
  process.on('SIGTERM', () => void cleanup(0));
  process.on('SIGINT', () => void cleanup(0));
  server.on('exit', (code) => void cleanup(code ?? 0));
}

await main();
