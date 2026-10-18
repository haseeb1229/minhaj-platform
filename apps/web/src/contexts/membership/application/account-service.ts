import 'server-only';

import {
  membershipAccountIdSchema,
  type MembershipAccountsPort,
  type MembershipDispositionPort,
} from '@minhaj/contracts/membership';

import { MembershipRefusal, asMembershipRefusal } from '../domain/refusal.ts';

/** How far one disposal got: rows changed, and whether nothing is left to do. */
export interface MembershipDispositionProgress {
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
 * Membership's part of account closure (SECURITY_BASELINE.md §19.1).
 *
 * IDENTITY OWNS CLOSURE. Membership asks Identity, through Layer 4, only which
 * accounts are closed, and then disposes of its OWN rows: an open application
 * is withdrawn as `account-closure` (owing no message — the account has no
 * address any more), and the account's durable mail intents are abandoned and
 * removed, in bounded, idempotent, resumable batches. It refuses an account
 * Identity does not report closed, so this can never be turned on a living
 * person's application.
 *
 * CLOSING THE LOGIN ACCOUNT IS NOT RESIGNING THE MEMBERSHIP. An active
 * Membership is an organisational relationship and is left exactly as it is;
 * no type, and nothing of another context, is touched (DOMAIN_MODEL.md §17.2).
 */
export function createMembershipAccountService(deps: {
  readonly disposition: MembershipDispositionPort;
  readonly accounts: MembershipAccountsPort;
}) {
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asMembershipRefusal);

  async function dispose(accountId: string): Promise<MembershipDispositionProgress> {
    let removed = 0;
    for (let round = 0; round < DISPOSAL_ROUNDS; round += 1) {
      const batch = await run(deps.disposition.disposeAccount(accountId, DISPOSAL_BATCH));
      removed += batch;
      if (batch === 0) return { removed, complete: true };
    }
    return { removed, complete: false };
  }

  return {
    /** Disposes of a CLOSED account's Membership rows; refused for any other. Idempotent. */
    async disposeAccount(accountId: string): Promise<MembershipDispositionProgress> {
      if (!membershipAccountIdSchema.safeParse(accountId).success)
        throw new MembershipRefusal('invalid');
      const closed = await deps.accounts.closedAccounts([accountId]);
      if (!closed.includes(accountId)) throw new MembershipRefusal('denied');
      return dispose(accountId);
    },

    /**
     * Finishes any closure an interruption left part-done: every account that
     * still holds disposable Membership rows and that Identity says is closed.
     * Bounded per run; `complete` is false while any such account may remain.
     */
    async reconcileClosedAccounts(): Promise<MembershipDispositionProgress> {
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

export type MembershipAccountService = ReturnType<typeof createMembershipAccountService>;
