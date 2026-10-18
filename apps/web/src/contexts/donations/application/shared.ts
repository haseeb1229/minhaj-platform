import 'server-only';

import { createHash } from 'node:crypto';

import type { Locale } from '@minhaj/contracts';
import {
  CHECKOUT_LIFETIME_SECONDS,
  CREATE_REPLAY_WINDOW_SECONDS,
  mergeProviderTruth,
  sameScope,
  type CheckoutCreation,
  type DonationCreateState,
  type DonationDonorPort,
  type DonationLedgerPort,
  type DonationRecord,
  type ExactMoney,
  type PaymentLookup,
  type PaymentObservation,
  type PaymentProviderPort,
  type PaymentScope,
  type RefundObservation,
} from '@minhaj/contracts/donations';
import type { RateLimitRule, RateLimiterPort } from '@minhaj/contracts/platform';

import { DonationsRefusal } from '../domain/refusal.ts';

/**
 * The rules every Donations service shares: the deterministic checkout
 * creation, the redirect allowlist, the one way provider truth is observed
 * and applied, and the rate budgets. Private to the context.
 */

/** A purpose-scoped, digested limiter key, built at Layer 4. */
export type DonationsLimitKey = (purpose: string, subject: string) => string;

/** Who is acting — the account Layer 4 resolved from the session, and nothing else. */
export interface DonationsActor {
  readonly accountId: string;
}

/**
 * Each donor act's own budget. Starting a payment is rare for a person and
 * valuable to a script (card testing), so it is tight per client address and
 * per linked account; reading a status is cheap and generous; asking the
 * provider again is bounded because each check is a provider round-trip.
 */
export const DONATIONS_RATE_RULES: Readonly<
  Record<
    'start-client' | 'start-account' | 'status' | 'check' | 'cancel' | 'export',
    RateLimitRule
  >
> = Object.freeze({
  'start-client': Object.freeze({ window: 3_600, max: 20 }),
  'start-account': Object.freeze({ window: 3_600, max: 20 }),
  status: Object.freeze({ window: 300, max: 60 }),
  check: Object.freeze({ window: 300, max: 10 }),
  cancel: Object.freeze({ window: 3_600, max: 10 }),
  export: Object.freeze({ window: 3_600, max: 10 }),
});

/** The limiter purpose each budget is spent under — one purpose per act. */
const PURPOSES: Readonly<Record<keyof typeof DONATIONS_RATE_RULES, string>> =
  Object.freeze({
    'start-client': 'donation-start',
    'start-account': 'donation-start-account',
    status: 'donation-status',
    check: 'donation-check',
    cancel: 'donation-cancel',
    export: 'donation-export',
  });

export async function spend(
  limiter: RateLimiterPort,
  key: DonationsLimitKey,
  operation: keyof typeof DONATIONS_RATE_RULES,
  subject: string,
): Promise<void> {
  const decision = await limiter.consume(
    key(PURPOSES[operation], subject),
    DONATIONS_RATE_RULES[operation],
  );
  if (!decision.allowed) throw new DonationsRefusal('rate-limited');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** How long a reconciliation claim is held. Comfortably longer than one provider round-trip. */
export const RECONCILE_LEASE_SECONDS = 120;

/* ===========================================================================
 * The redirect allowlist
 * ========================================================================= */

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost']);

/**
 * The exact URL a browser may be sent to, or `null`.
 *
 * Only the configured provider's EXACT checkout origin: parsed (never a
 * prefix or substring test), HTTPS — or plain HTTP to a loopback host for the
 * `fixture` simulator alone — and carrying no userinfo, so neither
 * `https://checkout.example@attacker` nor a look-alike host passes.
 */
export function checkoutDestination(
  scope: PaymentScope,
  origin: string,
  candidate: string,
): string | null {
  let expected: URL;
  let url: URL;
  try {
    expected = new URL(origin);
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (expected.origin !== origin) return null;
  const fixtureLoopback =
    scope.environment === 'fixture' &&
    expected.protocol === 'http:' &&
    LOOPBACK_HOSTS.has(expected.hostname);
  if (expected.protocol !== 'https:' && !fixtureLoopback) return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.origin !== expected.origin) return null;
  return url.href;
}

/* ===========================================================================
 * Deterministic checkout creation
 * ========================================================================= */

/** Everything a create is built from — all of it stored on the donation row. */
export interface CheckoutSubject {
  readonly id: string;
  readonly locale: Locale;
  readonly checkoutLabel: string;
  readonly expected: ExactMoney;
  readonly createdAt: Date;
  readonly createState: DonationCreateState;
}

export type CheckoutAttempt =
  | {
      readonly outcome: 'created';
      readonly checkoutUrl: string;
      readonly donation: DonationRecord;
    }
  | { readonly outcome: 'rejected' }
  | { readonly outcome: 'unknown' }
  /** Past the provider's idempotency retention: never repeated, a person's question now. */
  | { readonly outcome: 'window-closed' };

/** The provider's return page — constant per locale, carrying no token and no state. */
export function returnUrl(baseUrl: string, locale: Locale): string {
  return new URL(`/${locale}/donate/return`, baseUrl).toString();
}

/** The idempotency key of a donation's one checkout. */
export function checkoutKey(donationId: string): string {
  return `donation:${donationId}`;
}

/** The idempotency key of one refund. */
export function refundKey(refundId: string): string {
  return `refund:${refundId}`;
}

/**
 * Creates — or, under the SAME idempotency key, re-asks for — a donation's one
 * provider checkout.
 *
 * DETERMINISTIC FROM THE ROW. Amount, description, both return URLs and the
 * expiry are derived only from what the donation stores (its expected money,
 * checkout label, locale and creation instant), so a repeat sends
 * byte-identical parameters and the provider answers with the ORIGINAL session
 * — the protocol's own way to resolve a create whose answer was lost. Never
 * repeated after `CREATE_REPLAY_WINDOW_SECONDS`, when the provider may have
 * forgotten the key and a repeat could become a second checkout.
 *
 * A created checkout whose URL is not on the provider's exact checkout origin
 * is treated as `unknown`: nobody is sent there.
 */
export async function ensureCheckout(
  deps: {
    readonly provider: PaymentProviderPort;
    readonly donor: Pick<DonationDonorPort, 'recordCheckout' | 'recordCreateOutcome'>;
    readonly baseUrl: string;
  },
  subject: CheckoutSubject,
  now: Date,
): Promise<CheckoutAttempt> {
  if (now.getTime() - subject.createdAt.getTime() > CREATE_REPLAY_WINDOW_SECONDS * 1000)
    return { outcome: 'window-closed' };

  const destination = returnUrl(deps.baseUrl, subject.locale);
  let creation: CheckoutCreation;
  try {
    creation = await deps.provider.createCheckout({
      donationId: subject.id,
      amount: subject.expected,
      description: subject.checkoutLabel,
      successUrl: destination,
      cancelUrl: destination,
      expiresAt: new Date(subject.createdAt.getTime() + CHECKOUT_LIFETIME_SECONDS * 1000),
      idempotencyKey: checkoutKey(subject.id),
    });
  } catch {
    creation = { outcome: 'unknown' };
  }

  if (creation.outcome === 'created') {
    const checkoutUrl = checkoutDestination(
      deps.provider.scope(),
      deps.provider.checkoutOrigin(),
      creation.checkoutUrl,
    );
    if (checkoutUrl !== null) {
      const donation = await deps.donor.recordCheckout({
        id: subject.id,
        checkoutReference: creation.checkoutReference,
        expiresAt: creation.expiresAt,
        now,
      });
      return { outcome: 'created', checkoutUrl, donation };
    }
    creation = { outcome: 'unknown' };
  }

  if (creation.outcome === 'rejected') {
    await deps.donor.recordCreateOutcome({ id: subject.id, outcome: 'rejected', now });
    return { outcome: 'rejected' };
  }

  // Recorded once, on the way out of `pending`; an already-ambiguous create
  // keeps the reconciliation schedule it has.
  if (subject.createState === 'pending')
    await deps.donor.recordCreateOutcome({ id: subject.id, outcome: 'ambiguous', now });
  return { outcome: 'unknown' };
}

/* ===========================================================================
 * Observing provider truth
 * ========================================================================= */

export type DonationObservationOutcome =
  | 'applied'
  | 'unchanged'
  /** The provider's answer did not match the donation; only the attention flag moved. */
  | 'attention'
  | 'not-found'
  /** The provider could not be asked, or did not answer. Nothing was assumed. */
  | 'unknown';

/**
 * Whether merging this observation would need a person. Exact for that
 * question: the attention verdicts of `mergeProviderTruth` depend only on the
 * scope, references, money, capture, refunds and dispute, all of which a
 * record carries. Used only to describe what an application did.
 */
export function needsAttention(
  donation: DonationRecord,
  observed: PaymentObservation,
): boolean {
  return (
    mergeProviderTruth(
      {
        donationId: donation.id,
        scope: donation.scope,
        checkoutReference: donation.checkoutReference,
        expected: donation.expected,
        facts: {
          capturedMinor: donation.capturedMinor,
          refundedMinor: donation.refundedMinor,
          dispute: donation.dispute,
          closure: null,
          cancelRequested: false,
        },
      },
      observed,
    ).verdict === 'attention'
  );
}

/**
 * Reads the provider's truth for a donation's checkout server-to-server and
 * applies it through the ledger — the ONE path every caller (webhook,
 * reconciliation, donor check, operator) uses. A donation with no checkout,
 * or held in a scope other than the configured provider's, is not observable.
 */
export async function observeAndApply(
  deps: {
    readonly provider: PaymentProviderPort;
    readonly ledger: Pick<DonationLedgerPort, 'applyObservation'>;
  },
  donation: DonationRecord,
  source: 'webhook' | 'reconcile' | 'donor-check' | 'operator',
  actorId: string | null,
  now: Date,
): Promise<{
  readonly outcome: DonationObservationOutcome;
  readonly donation: DonationRecord;
}> {
  if (
    donation.checkoutReference === null ||
    !sameScope(donation.scope, deps.provider.scope())
  )
    return { outcome: 'unknown', donation };

  let lookup: PaymentLookup;
  try {
    lookup = await deps.provider.observeCheckout(donation.checkoutReference);
  } catch {
    return { outcome: 'unknown', donation };
  }
  if (lookup.outcome === 'not-found') return { outcome: 'not-found', donation };
  if (lookup.outcome !== 'observed') return { outcome: 'unknown', donation };

  const attention = needsAttention(donation, lookup.observation);
  const applied = await deps.ledger.applyObservation({
    donationId: donation.id,
    observation: lookup.observation,
    source,
    actorId,
    now,
  });
  return {
    outcome: attention ? 'attention' : applied.changed ? 'applied' : 'unchanged',
    donation: applied.donation,
  };
}

/**
 * Whether a refund observation is about exactly this platform's refund: the
 * same scope, refund id, payment and currency — and, when known, amount. A
 * refund the provider holds for anything else is never applied to this one.
 */
export function refundMatches(
  observed: RefundObservation,
  expected: {
    readonly scope: PaymentScope;
    readonly refundId: string;
    readonly paymentReference: string;
    readonly currency: ExactMoney['currency'];
    readonly amount: ExactMoney | null;
  },
): boolean {
  return (
    sameScope(observed.scope, expected.scope) &&
    observed.refundId === expected.refundId &&
    observed.paymentReference === expected.paymentReference &&
    observed.amount.currency === expected.currency &&
    (expected.amount === null || observed.amount.minor === expected.amount.minor)
  );
}
