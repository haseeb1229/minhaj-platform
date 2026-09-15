import type { RateLimitRule } from '@minhaj/contracts/platform';

/**
 * THE rate-limit policy for Identity's flows.
 *
 * Identity owns these numbers, not the limiter. The limiter counts; what a
 * budget should be for signing in versus for asking to reset a password is a
 * security decision about this platform's threat model (ARCHITECTURE.md §4.5,
 * SECURITY_BASELINE.md §15.2).
 *
 * Two dimensions, deliberately. A per-ACCOUNT budget stops credential stuffing
 * and mail bombing against one person; a per-CLIENT budget stops one source
 * spraying many accounts. Either alone leaves the other attack unbounded.
 */

export interface IdentityRateLimit {
  /** Keyed by canonical address — protects one account. */
  readonly perAccount: RateLimitRule;
  /** Keyed by client address — protects everyone else from one source. */
  readonly perClient: RateLimitRule;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;

/**
 * Budgets per flow.
 *
 * The mail-sending flows are the tightest, because their abuse lands in
 * someone else's inbox: verification resend and forgot-password are the
 * classic email-bombing vectors (SECURITY_BASELINE.md §1.2).
 */
export const IDENTITY_RATE_LIMITS = {
  'sign-in': {
    perAccount: { window: 15 * MINUTE, max: 5 },
    perClient: { window: 15 * MINUTE, max: 20 },
  },
  'sign-up': {
    perAccount: { window: HOUR, max: 3 },
    perClient: { window: HOUR, max: 5 },
  },
  'verification-resend': {
    perAccount: { window: HOUR, max: 3 },
    perClient: { window: HOUR, max: 10 },
  },
  'verification-confirm': {
    perAccount: { window: 15 * MINUTE, max: 10 },
    perClient: { window: 15 * MINUTE, max: 30 },
  },
  'password-reset-request': {
    perAccount: { window: HOUR, max: 3 },
    perClient: { window: HOUR, max: 10 },
  },
  'password-reset-confirm': {
    perAccount: { window: 15 * MINUTE, max: 5 },
    perClient: { window: 15 * MINUTE, max: 20 },
  },
  'password-change': {
    perAccount: { window: HOUR, max: 5 },
    perClient: { window: HOUR, max: 20 },
  },
  'email-change-request': {
    perAccount: { window: HOUR, max: 3 },
    perClient: { window: HOUR, max: 10 },
  },
  'email-change-confirm': {
    perAccount: { window: 15 * MINUTE, max: 5 },
    perClient: { window: 15 * MINUTE, max: 20 },
  },
  'account-closure': {
    perAccount: { window: HOUR, max: 3 },
    perClient: { window: HOUR, max: 10 },
  },
} as const satisfies Record<string, IdentityRateLimit>;

export type IdentityFlow = keyof typeof IDENTITY_RATE_LIMITS;
