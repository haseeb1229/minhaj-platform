import 'server-only';

import type { FatwaDispositionPort } from '@minhaj/contracts/fatwa';

/**
 * Fatwa's part of account closure (SECURITY_BASELINE.md §19.1; DOMAIN_MODEL.md
 * §4.6).
 *
 * EVERY OWNER DISPOSES OF ITS OWN DATA. Identity closes the account in its own
 * transaction; Layer 4 then calls this, and Fatwa, in ITS own transaction,
 * erases the private text of that account's questions and closes those not yet
 * answered or declined. No other context's data is touched and no cross-context
 * transaction exists.
 *
 * WHAT SURVIVES, AND WHY. A published ruling never held the question — its
 * public question was written separately and anonymised by a person — so it
 * stays public exactly as it was. The question row survives as a workflow fact
 * with no words in it, and the audit record of the disposal is kept.
 *
 * IDEMPOTENT AND RESUMABLE. Disposing an account twice changes nothing the
 * second time, and the bounded sweep finishes any closure that was interrupted
 * between Identity's commit and this call. The database refuses to dispose of a
 * named account that is not closed.
 */

const SWEEP_BATCH = 100;

export function createFatwaDispositionService(port: FatwaDispositionPort) {
  return {
    async disposeAccount(accountId: string): Promise<number> {
      // An account id is Identity's opaque string; an empty or oversized one names nobody.
      if (accountId.length === 0 || accountId.length > 36) return 0;
      return port.disposeAccount(accountId);
    },
    reconcileClosedAccounts(): Promise<number> {
      return port.disposeClosedAccounts(SWEEP_BATCH);
    },
  };
}

export type FatwaDispositionService = ReturnType<typeof createFatwaDispositionService>;
