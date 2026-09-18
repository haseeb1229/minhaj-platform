import { defineConfig, devices } from '@playwright/test';

/**
 * Browser coverage for Phase 2.
 *
 * WHY A SECOND RUNNER AT ALL. Vitest proves the services, the adapters and the
 * database behaviour, and it proves them well. What it cannot prove is the
 * part that only exists in a browser: that a GET on an emailed link consumes
 * nothing when a real client fetches it, that a session cookie survives a
 * navigation and dies on sign-out, that a form works with the keyboard, and
 * that Urdu and Arabic actually render right-to-left. Those are the Phase-2
 * claims a headless assertion cannot make.
 *
 * DELIBERATELY SEPARATE FROM `npm run verify`. The container image the verify
 * job builds is intentionally browserless, and adding browser binaries to it
 * to satisfy a test would change what the production image contains. This runs
 * as its own command and its own CI job (`npm run test:browser`).
 *
 * ONE BROWSER. Chromium only, and that is a deliberate limit rather than an
 * omission: the claims above are about this application's behaviour, not about
 * rendering differences between engines. Cross-browser presentation belongs
 * with the design phase that has a presentation to check.
 */

/** Where the application under test listens. */
const PORT = Number(process.env['PLAYWRIGHT_PORT'] ?? 3100);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.spec.ts',
  globalTeardown: './tests/browser/global-teardown.ts',

  // Each spec creates its own accounts and never reads another's, and each
  // presents its OWN client address (see `tests/browser/support.ts`), so the
  // real per-client rate limit does not couple them together. They are
  // therefore safe to run in parallel.
  //
  // The worker count is modest rather than maximal: every worker drives the
  // same SQL Server instance and the same single application process, so past
  // a point more workers buy contention rather than speed.
  fullyParallel: true,
  workers: 3,

  // A retry hides a flake rather than fixing it, and a flaky security proof is
  // a security proof nobody should believe. CI gets ONE retry only to absorb
  // runner-level noise — a port that was slow to bind, a container still
  // warming — and any test that needs it locally is a test to fix.
  retries: process.env['CI'] === undefined ? 0 : 1,

  // A test that hangs must fail rather than occupy a runner.
  timeout: 60_000,
  expect: { timeout: 10_000 },

  // Fail the run rather than pass it, if somebody leaves a `test.only` behind.
  forbidOnly: process.env['CI'] !== undefined,

  reporter: process.env['CI'] === undefined ? [['list']] : [['list'], ['github']],

  use: {
    baseURL: BASE_URL,

    // Evidence for a failure, and nothing kept for a pass — a trace of an
    // authentication flow contains session cookies.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  /**
   * The application under test is the PRODUCTION BUILD.
   *
   * `next dev` recompiles per request and behaves differently around caching,
   * cookies and server actions. A browser proof that ran against it would be
   * proving something the deployment does not do.
   *
   * The environment is supplied by `scripts/browser-server.mjs`, which stands
   * the app up against a DISPOSABLE database — the same discipline the Vitest
   * suites follow, for the same reason. No real provider credential is
   * supplied and none is needed: the specs obtain their links the way a
   * delivery retry does, through the adapter's own narrow operation, because a
   * "just for the browser tests" outbox holding rendered links would be the
   * second durable bearer store the architecture exists to prevent.
   */
  webServer: {
    // `--conditions=react-server` for the same reason every `db:*` command
    // carries it: the lifecycle modules the script imports are guarded by the
    // `server-only` marker, which resolves to an empty module under that
    // condition and throws under any other.
    command: `node --conditions=react-server scripts/browser-server.mjs ${PORT}`,
    url: `${BASE_URL}/en`,
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
