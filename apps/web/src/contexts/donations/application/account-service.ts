import 'server-only';

import {
  donationAccountIdSchema,
  type DonationAccountsPort,
  type DonationDispositionPort,
} from '@minhaj/contracts/donations';

import { DonationsRefusal, asDonationsRefusal } from '../domain/refusal.ts';

/** How far one disposal got: rows changed, and whether nothing is left to do. */
export interface DonationsDispositionProgress {
  readonly removed: number;
  readonly complete: boolean;
}

/** Rows changed per statement in one disposal batch. */
const DISPOSAL_BATCH = 500;
/** Batches one call may run before it stops and reports the rest pending. */
const DISPOSAL_ROUNDS = 40;
/** Accounts the reconciliation sweep inspects per page, and pages per run. */
const SWEEP_PAGE = 100;
const SWEEP_PAGES = 10;

/**
 * Donations' part of account closure (SECURITY_BASELINE.md §19.1).
 *
 * IDENTITY OWNS CLOSURE. Donations asks Identity, through Layer 4, only which
 * accounts are closed, and then releases its OWN link: the account's owed
 * donation mail is abandoned and removed, and each of its donations becomes
 * anonymous — in bounded, idempotent, resumable batches. It refuses an account
 * Identity does not report closed, so this can never be turned on a living
 * person's records.
 *
 * THE FINANCIAL RECORD IS KEPT. A donation's amount, currency, state,
 * provider references, events and refunds are the organisation's financial
 * record and are retained untouched; only the account link is released.
 */
export function createDonationsAccountService(deps: {
  readonly disposition: DonationDispositionPort;
  readonly accounts: DonationAccountsPort;
}) {
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asDonationsRefusal);

  async function dispose(accountId: string): Promise<DonationsDispositionProgress> {
    let removed = 0;
    for (let round = 0; round < DISPOSAL_ROUNDS; round += 1) {
      const batch = await run(deps.disposition.disposeAccount(accountId, DISPOSAL_BATCH));
      removed += batch;
      if (batch === 0) return { removed, complete: true };
    }
    return { removed, complete: false };
  }

  return {
    /** Releases a CLOSED account's donations and owed mail; refused for any other. Idempotent. */
    async disposeAccount(accountId: string): Promise<DonationsDispositionProgress> {
      if (!donationAccountIdSchema.safeParse(accountId).success)
        throw new DonationsRefusal('invalid');
      const closed = await deps.accounts.closedAccounts([accountId]);
      if (!closed.includes(accountId)) throw new DonationsRefusal('denied');
      return dispose(accountId);
    },

    /**
     * Finishes any closure an interruption left part-done: every account that
     * still holds linked donations or owed intents and that Identity says is
     * closed. Bounded per run; `complete` is false while any may remain.
     */
    async reconcileClosedAccounts(): Promise<DonationsDispositionProgress> {
      let after: string | null = null;
      let removed = 0;
      let complete = true;
      for (let page = 0; page < SWEEP_PAGES; page += 1) {
        const owners: readonly string[] = await run(
          deps.disposition.accountsWithData(after, SWEEP_PAGE),
        );
        if (owners.length === 0) return { removed, complete };
        const closed = await deps.accounts.closedAccounts(owners);
        for (const accountId of closed) {
          const progress = await dispose(accountId);
          removed += progress.removed;
          if (!progress.complete) complete = false;
        }
        after = owners[owners.length - 1] ?? null;
        if (owners.length < SWEEP_PAGE) return { removed, complete };
      }
      return { removed, complete: false };
    },
  };
}

export type DonationsAccountService = ReturnType<typeof createDonationsAccountService>;
