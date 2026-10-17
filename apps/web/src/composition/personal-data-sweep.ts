import 'server-only';

import { fatwaRuntime } from './fatwa';
import { learningRuntime } from './learning';
import { appLogger } from './logging';
import { messagingRuntime } from './messaging';
import { peopleRuntime } from './people';
import { personalisationRuntime } from './personalisation';

/**
 * Personal-data upkeep that must happen even when nobody submits a form.
 *
 * CLOSURE, FINISHED. Account closure is coordinated across owners at Layer 4,
 * each in its own transaction (SECURITY_BASELINE.md §19.1). An interruption
 * leaves rows only an owner's own reconciliation removes — People's live link,
 * Fatwa's question text, Personalisation's records, Learning's enrolments,
 * progress and trial requests, Messaging's participation, read positions,
 * blocks and messages — so each owner's bounded,
 * idempotent reconciliation runs here on a timer, not only inside the next
 * closure somebody else happens to make.
 *
 * UNSENT UPLOADS, RELEASED. A message attachment uploaded but never sent, or
 * one whose release was interrupted, is released by Messaging's own bounded
 * sweep once it is older than Messaging's bound.
 *
 * NEWSLETTER, MINIMISED. A confirmation window that lapsed leaves an address
 * with no purpose; the newsletter's own sweep drops it.
 *
 * Every step is the owner's public service; this file reaches no table. A
 * failure is logged by operation name only, and the rows stay pending for the
 * next run.
 */

const SWEEP_MS = 5 * 60_000;

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

async function step(operation: string, work: () => Promise<unknown>): Promise<void> {
  try {
    await work();
  } catch {
    appLogger().warn(
      { operation },
      'Personal-data sweep step failed; the work stays pending.',
    );
  }
}

export async function runPersonalDataSweep(): Promise<void> {
  await step('newsletter-expiry', () =>
    personalisationRuntime().newsletter.expireLapsed(),
  );
  await step('closure-people', () =>
    peopleRuntime().people.reconcileClosedAccountLinks(),
  );
  await step('closure-fatwa', () => fatwaRuntime().disposition.reconcileClosedAccounts());
  await step('closure-personalisation', () =>
    personalisationRuntime().account.reconcileClosedAccounts(),
  );
  await step('closure-learning', () =>
    learningRuntime().account.reconcileClosedAccounts(),
  );
  await step('closure-messaging', () =>
    messagingRuntime().service.reconcileClosedAccounts(),
  );
  await step('messaging-attachments', () =>
    messagingRuntime().service.sweepAttachments(),
  );
}

export function startPersonalDataSweep(): void {
  if (timer !== null) return;
  // Single web instance, like the editorial sweep. Every step is idempotent,
  // so a second instance running it concurrently does no harm.
  timer = setInterval(() => {
    if (running) return;
    running = true;
    void runPersonalDataSweep().finally(() => {
      running = false;
    });
  }, SWEEP_MS);
  timer.unref();
  process.once('SIGTERM', stopPersonalDataSweep);
  process.once('SIGINT', stopPersonalDataSweep);
}

function stopPersonalDataSweep(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
  process.removeListener('SIGTERM', stopPersonalDataSweep);
  process.removeListener('SIGINT', stopPersonalDataSweep);
}
