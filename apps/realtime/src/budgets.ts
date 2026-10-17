import 'server-only';

import { REALTIME_LIMITS } from '@minhaj/contracts/messaging';

/**
 * Per-connection event budgets (SECURITY_BASELINE.md §12.4).
 *
 * TRANSPORT HYGIENE, NOT A BUSINESS RULE. These bound how fast ONE connection
 * may make the server work; they decide nothing about who may do what. The
 * Messaging service still applies its own per-account send limit behind them,
 * on the single-instance limiter, so a person cannot escape it by opening more
 * sockets — this budget only stops one socket hammering the process.
 *
 * A token bucket per kind: `max` tokens, refilled continuously at
 * `max / windowMs`, so a burst up to `max` is admitted and a sustained rate
 * above the window's average is not. Memory is fixed — five buckets per
 * connection, created up front — so no client input grows it.
 */

export type BudgetKind = keyof typeof REALTIME_LIMITS.budgets;

export interface ConnectionBudget {
  /** Spend one token of `kind`; `false` when the bucket is empty. */
  take(kind: BudgetKind): boolean;
}

interface Bucket {
  tokens: number;
  at: number;
}

export function createConnectionBudget(now: () => number): ConnectionBudget {
  const started = now();
  const buckets = new Map<BudgetKind, Bucket>();
  for (const kind of Object.keys(REALTIME_LIMITS.budgets) as BudgetKind[]) {
    buckets.set(kind, { tokens: REALTIME_LIMITS.budgets[kind].max, at: started });
  }

  return {
    take(kind) {
      const bucket = buckets.get(kind);
      if (bucket === undefined) return false;
      const { max, windowMs } = REALTIME_LIMITS.budgets[kind];
      const current = now();
      // A clock that steps backwards refills nothing rather than going negative.
      const elapsed = Math.max(0, current - bucket.at);
      bucket.tokens = Math.min(max, bucket.tokens + (elapsed * max) / windowMs);
      bucket.at = current;
      if (bucket.tokens < 1) return false;
      bucket.tokens -= 1;
      return true;
    },
  };
}
