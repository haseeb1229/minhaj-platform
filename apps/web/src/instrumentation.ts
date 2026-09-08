/**
 * Next.js instrumentation hook — defence in depth only.
 *
 * `register()` runs once per server process, but AFTER the server has bound its
 * port. That makes it unsuitable as the fail-fast mechanism: a throw here
 * leaves a listening process answering every request with 500, which passes a
 * port health check and hides the fault.
 *
 * Process-level fail-fast is therefore owned by `apps/web/scripts/start.mjs`,
 * which validates BEFORE `next start` runs and exits non-zero without ever
 * starting a listener (SECURITY_BASELINE.md §18.1).
 *
 * This hook remains as a second line of defence for entry points that do not
 * pass through the wrapper — `next dev`, most notably — so a developer sees the
 * same clear error rather than a confusing downstream failure.
 */
export async function register(): Promise<void> {
  // Only the Node.js server runtime validates server configuration. The edge
  // runtime has no access to the same environment.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { assertServerEnv } = await import('@/config/server-env');

  assertServerEnv();
}
