import 'server-only';

import { failureLabel, isTransientDatabaseFailure } from './failure-label';
import { donationsRuntime } from './donations';
import { appLogger } from './logging';

/**
 * Donations' reconciliation sweep — the server's own schedule for reading
 * provider truth that no webhook delivered: a lost or late webhook, an
 * ambiguous checkout creation, a checkout left pending, an unanswered refund.
 *
 * DERIVED WORK, NEVER A GUESS. Each due donation or refund is leased, read
 * from the provider server-to-server and merged by the one convergent rule;
 * one the provider cannot answer backs off on the ledger's schedule to a
 * person's attention. Nothing is created afresh and nothing is assumed.
 *
 * SAFE WITH MANY INSTANCES. Claiming is a lease, so a second process takes
 * different rows; a crashed process's lease lapses and the row comes due
 * again. A failure is logged by operation and category only — never a
 * reference, an amount or an account (SECURITY_BASELINE.md §19.2).
 */

const SWEEP_MS = 60_000;
/** Donations, and separately refunds, per run. */
const BATCH = 20;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

export async function runDonationsSweep(): Promise<void> {
  try {
    const summary = await donationsRuntime().ledger.reconcileDue(BATCH);
    if (summary.failed > 0)
      appLogger().warn(
        { operation: 'donations-reconcile', failed: summary.failed },
        'Donations reconciliation left items pending.',
      );
  } catch (error) {
    const detail = {
      operation: 'donations-reconcile',
      error: failureLabel(error),
      transient: isTransientDatabaseFailure(error),
    };
    if (detail.transient) appLogger().warn(detail, 'Donations reconciliation failed.');
    else appLogger().error(detail, 'Donations reconciliation failed.');
  }
}

export function startDonationsSweep(): void {
  if (timer !== null) return;
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void runDonationsSweep().finally(() => {
      running = false;
    });
  }, SWEEP_MS);
  timer.unref();
  process.once('SIGTERM', stopDonationsSweep);
  process.once('SIGINT', stopDonationsSweep);
}

function stopDonationsSweep(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  process.removeListener('SIGTERM', stopDonationsSweep);
  process.removeListener('SIGINT', stopDonationsSweep);
}
