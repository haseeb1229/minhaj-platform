import type { RateLimiterPort } from '@minhaj/contracts/platform';

import { IDENTITY_RATE_LIMITS, type IdentityFlow } from '../domain/rate-limits.ts';

/**
 * Spending Identity's rate-limit budgets, in one place.
 *
 * EXTRACTED IN CHUNK 2, not invented by it. The identical function lived
 * inside `createIdentityService`; the privileged-security service needs the
 * same two-dimensional budget for step-up, signed-in TOTP and recovery-code
 * attempts, and a second copy is how two limiters end up disagreeing about
 * what a flow costs (ARCHITECTURE.md §4.5).
 *
 * TWO DIMENSIONS, DELIBERATELY. A per-ACCOUNT budget stops credential stuffing
 * and code guessing against one person; a per-CLIENT budget stops one source
 * spraying many accounts. Either alone leaves the other attack unbounded.
 */

export interface SpendDenial {
  readonly failure: 'rate-limited';
  /** Seconds to wait, where the limiter could say. */
  readonly retryAfter?: number;
}

/**
 * Charges both budgets for a flow.
 *
 * Returns `null` when the caller may proceed, and a denial otherwise.
 */
export type Spender = (
  flow: IdentityFlow,
  input: { readonly clientAddress: string },
  subject: string,
) => Promise<SpendDenial | null>;

export function createSpender(dependencies: {
  readonly limiter: RateLimiterPort;
  /** Derives a storage key for a limiter subject. Injected: Layer 0 owns it. */
  readonly rateLimitKey: (input: {
    readonly purpose: string;
    readonly subject: string;
  }) => string;
}): Spender {
  return async function spend(flow, context, subject) {
    const limits = IDENTITY_RATE_LIMITS[flow];

    // The per-account budget is charged FIRST, so an attacker cannot exhaust a
    // victim's budget cheaply from many addresses without also spending their
    // own per-client budget.
    const account = await dependencies.limiter.consume(
      dependencies.rateLimitKey({ purpose: `${flow}:account`, subject }),
      limits.perAccount,
    );
    if (!account.allowed) {
      return account.retryAfter === null
        ? { failure: 'rate-limited' }
        : { failure: 'rate-limited', retryAfter: account.retryAfter };
    }

    const client = await dependencies.limiter.consume(
      dependencies.rateLimitKey({
        purpose: `${flow}:client`,
        subject: context.clientAddress,
      }),
      limits.perClient,
    );
    if (!client.allowed) {
      return client.retryAfter === null
        ? { failure: 'rate-limited' }
        : { failure: 'rate-limited', retryAfter: client.retryAfter };
    }

    return null;
  };
}
