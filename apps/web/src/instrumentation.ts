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

  // The outbound-mail retry sweep, started once per server process — this hook
  // is the only thing Next guarantees runs exactly that often.
  //
  // Production only. `next dev` recompiles and re-registers on every change, and
  // a background timer that survives a hot reload is a timer nobody can see or
  // stop. Development still sends: every action that enqueues mail dispatches
  // after its own response, so the first attempt at everything happens there
  // and only RETRIES wait for this.
  if (process.env.NODE_ENV !== 'production') return;

  const { startDispatchSweep } = await import('@/composition/dispatch');

  startDispatchSweep();
  if (process.env['NEXT_PHASE'] !== 'phase-production-build') {
    const { startEditorialSweep } = await import('@/composition/editorial-sweep');
    startEditorialSweep();
    // Derived search work: retries, catch-up, and what the editorial sweep's
    // scheduled publications committed (ARCHITECTURE.md §8.5).
    const { startSearchSweep } = await import('@/composition/search');
    startSearchSweep();
    // Closure reconciliation for every owner, and lapsed newsletter
    // confirmations (SECURITY_BASELINE.md §19.1).
    const { startPersonalDataSweep } = await import('@/composition/personal-data-sweep');
    startPersonalDataSweep();
    // Provider truth no webhook delivered: lost webhooks, ambiguous checkout
    // creations, stale pending checkouts and unanswered refunds.
    const { startDonationsSweep } = await import('@/composition/donations-sweep');
    startDonationsSweep();
  }
}
