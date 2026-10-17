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
 *
 * THE DEPLOYED SHAPE, FRONT DOOR INCLUDED (Phase 25). The browser talks to
 * NGINX — the pinned image rendering the repository's template — at the base
 * URL Playwright uses. NGINX proxies `/socket.io/` (WebSocket upgrade) to the
 * REAL realtime process, started from its composition entry against the same
 * disposable database, and everything else to the web server. Web and
 * realtime listen on internal ports, and `AUTH_BASE_URL` is the NGINX origin,
 * so a session cookie, a Server Action's Origin check and the realtime
 * handshake's exact-Origin check all see what a deployment's would.
 */

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BROWSER_REALTIME_PROCESS_FILE,
  freePort,
  frontDoorName,
  realtimeMarker,
  recordedRealtimePid,
  recordRealtimeProcess,
  removeFrontDoor,
  spawnRealtime,
  startFrontDoor,
  stopOwnRealtime,
  upstreamBindAddress,
  waitForStatus,
} from './shared/realtime-harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const webRoot = path.join(repoRoot, 'apps', 'web');

/** Where the specs read the run's configuration from. Git-ignored. */
export const ENVIRONMENT_FILE = path.join(
  repoRoot,
  'test-results',
  'browser-environment.json',
);

/** The browser suite's one harness-only NGINX setting (see the file itself). */
const FORWARDED_CLIENT_CONFIGURATION = path.join(
  repoRoot,
  'tests',
  'browser',
  'front-door-forwarded-client.conf',
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
  NEWSLETTER_TOKEN_KEY: 'synthetic-browser-newsletter-token-0001',
};

/** The FRONT DOOR's port — NGINX, at the base URL the specs use. */
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

  /**
   * INTERNAL ADDRESSES. Web and realtime bind the address the proxy container
   * reaches the host on, at ports chosen now; only NGINX is at the base URL.
   */
  const upstreamHost = upstreamBindAddress();
  const webPort = await freePort(upstreamHost);
  const realtimePort = await freePort(upstreamHost);
  const runSuffix = randomBytes(6).toString('hex');
  const proxyContainer = frontDoorName('browser', runSuffix);
  const marker = realtimeMarker('browser', runSuffix);
  const publicOrigin = `http://127.0.0.1:${String(port)}`;

  /**
   * What BOTH server processes run under: the deployed posture, the run's
   * disposable database and storage, and its synthetic secrets. The realtime
   * process verifies the web's session cookies, so it must share the origin
   * and the secrets exactly.
   */
  const applicationEnvironment = {
    NODE_ENV: 'production',
    DATABASE_URL: databaseUrl,
    DATABASE_MIGRATION_URL: databaseUrl,
    AUTH_BASE_URL: publicOrigin,
    EMAIL_FROM_ADDRESS: 'no-reply@browser-suite.invalid',
    EMAIL_FROM_NAME: 'Minhaj',
    LOG_LEVEL: 'warn',

    // The app is run in its DEPLOYED posture — behind a proxy that sets the
    // forwarding header — because that is the configuration the browser
    // proofs are meant to be about. It is also what lets each spec present
    // itself as a distinct visitor, which the real per-client rate limit
    // otherwise makes impossible after five accounts. NGINX now really is that
    // proxy; the spec's address reaches it the way a trusted balancer's would
    // (`tests/browser/front-door-forwarded-client.conf`).
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
  };

  /** The realtime process's own additions; recorded so a spec can restart it identically. */
  const realtimeEnvironment = {
    ...applicationEnvironment,
    REALTIME_HOST: upstreamHost,
    REALTIME_PORT: String(realtimePort),
  };

  mkdirSync(path.dirname(ENVIRONMENT_FILE), { recursive: true });
  writeFileSync(
    ENVIRONMENT_FILE,
    `${JSON.stringify(
      {
        databaseUrl,
        databaseName,
        port,
        storageRoot,
        webPort,
        proxyContainer,
        realtime: {
          host: upstreamHost,
          port: realtimePort,
          marker,
          environment: realtimeEnvironment,
        },
        ...SECRETS,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  const server = spawn(
    process.execPath,
    [
      path.join(webRoot, 'scripts', 'start.mjs'),
      // Passed through to `next start`: listen where the proxy reaches, only.
      '--hostname',
      upstreamHost,
    ],
    {
      cwd: webRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        ...applicationEnvironment,
        npm_lifecycle_event: 'start',
        PORT: String(webPort),
      },
    },
  );

  const realtime = spawnRealtime({
    marker,
    environment: { ...process.env, ...realtimeEnvironment },
  });
  recordRealtimeProcess(realtime.pid);

  let cleaning = false;

  /**
   * Stops everything this run started, then drops what it created.
   *
   * Each step runs however the one before it ended: a proxy that would not
   * stop must not leave a database behind, and the database is dropped last,
   * after every process that could still be using it is gone.
   */
  const cleanup = async (code) => {
    if (cleaning) return;
    cleaning = true;

    if (server.exitCode === null) server.kill('SIGTERM');

    let failed = false;
    try {
      // A spec may have restarted it: stop whichever process is current, and
      // the one this script started if that is a different one.
      const current = recordedRealtimePid() ?? realtime.pid;
      await stopOwnRealtime(current, marker);
      if (current !== realtime.pid) await stopOwnRealtime(realtime.pid, marker);
    } catch (error) {
      failed = true;
      console.error(error instanceof Error ? error.message : String(error));
    }

    try {
      await removeFrontDoor(proxyContainer);
    } catch (error) {
      failed = true;
      console.error(error instanceof Error ? error.message : String(error));
    }

    try {
      await dropDisposableDatabase(master, databaseName);
    } finally {
      await master.close();
      rmSync(ENVIRONMENT_FILE, { force: true });
      rmSync(BROWSER_REALTIME_PROCESS_FILE, { force: true });
      rmSync(storageRoot, { recursive: true, force: true });
    }

    process.exit(failed && code === 0 ? 1 : code);
  };

  // A stopped run must leave no database behind, however it stopped.
  process.on('SIGTERM', () => void cleanup(0));
  process.on('SIGINT', () => void cleanup(0));
  server.on('exit', (code) => void cleanup(code ?? 0));

  /**
   * THE FRONT DOOR, once both upstreams exist. NGINX resolves its upstreams
   * when it starts, and Playwright's readiness probe arrives through it, so
   * the run is "up" only when the whole chain is.
   */
  // A realtime process that dies while starting fails the run at once, rather
  // than leaving Playwright to time out; one stopped later (by a spec) is not
  // a failure of this script.
  let realtimeReady = false;
  const realtimeDied = new Promise((resolve, reject) => {
    realtime.once('exit', (code) => {
      if (!realtimeReady) {
        reject(
          new Error(`The realtime process exited (${String(code)}) while starting.`),
        );
      }
    });
  });
  realtimeDied.catch(() => undefined);

  try {
    await Promise.race([
      waitForStatus(
        `http://${upstreamHost}:${String(realtimePort)}/readyz`,
        200,
        240_000,
      ),
      realtimeDied,
    ]);
    realtimeReady = true;
    await startFrontDoor({
      name: proxyContainer,
      publicPort: port,
      webPort,
      realtimePort,
      extraConfiguration: FORWARDED_CLIENT_CONFIGURATION,
    });
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    await cleanup(1);
  }
}

await main();
