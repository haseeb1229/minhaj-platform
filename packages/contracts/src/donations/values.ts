import { z } from 'zod';

import { localeSchema, type Locale } from '../env/shared.ts';
import { labelText } from '../exact-text.ts';

import {
  isDonationCurrency,
  MONEY_MINOR_MAX,
  type DonationCurrency,
  type ExactMoney,
} from './money.ts';

/**
 * Donations — DonationCampaign and Donation behind a `PaymentProvider`
 * (DOMAIN_MODEL.md §17.3, DELIVERY_PLAN.md Phase 27).
 *
 * ONE DONATION IS ONE PAYMENT ATTEMPT. Its expected amount and currency are
 * created by the server from the campaign's policy and never change; the
 * client only REQUESTS an amount. Nothing a browser sends — a return URL, a
 * query string, a claimed outcome — moves a donation's state: only provider
 * truth verified server-to-server does (SECURITY_BASELINE.md §14).
 *
 * PROVIDER-NEUTRAL. The states, references and observations below are the
 * domain's own words; a provider's own enums, units and identifiers stay
 * inside its adapter, so changing provider is an adapter change.
 *
 * NO PAYMENT CREDENTIAL, EVER. No card number, security code, expiry, wallet
 * or bank credential, billing address, payer email or provider shopper
 * identity exists in any type here. Checkout is provider-hosted.
 *
 * NOT ECOMMERCE. No cart, order, shipping, inventory, subscription, recurring
 * plan, saved instrument, Gift Aid or tax-receipt concept exists here.
 */

/* ===========================================================================
 * Identifiers
 * ========================================================================= */

export const donationIdSchema = z.uuid();
export const donationCampaignIdSchema = z.uuid();
export const donationRefundIdSchema = z.uuid();

/** A high-entropy idempotency id minted per form render; duplicate submits share it. */
export const donationOperationIdSchema = z.uuid();

/** An account id as Identity issues it — opaque here, never parsed. */
export const donationAccountIdSchema = z.string().min(1).max(36);

export const donationVersionSchema = z.number().int().positive().max(2_147_483_646);

/**
 * The anonymous status token: 32 random bytes, base64url, 43 characters. Only
 * its SHA-256 digest is stored; the token itself is a bearer that reads ONE
 * donation's status and can do nothing else.
 */
export const donationStatusTokenSchema = z
  .string()
  .length(43)
  .regex(/^[A-Za-z0-9_-]{43}$/u);

/* ===========================================================================
 * Provider scope
 * ========================================================================= */

/** The payment providers an adapter exists for. Engineering choice, not production selection. */
export const PAYMENT_PROVIDERS = Object.freeze(['stripe'] as const);
export type PaymentProviderName = (typeof PAYMENT_PROVIDERS)[number];

/**
 * Where a provider identifier lives. `fixture` is the deterministic local
 * simulator used by CI and browser proofs; `sandbox` is a provider's real test
 * environment; `production` is real money and is never activated by this phase.
 */
export const PAYMENT_ENVIRONMENTS = Object.freeze([
  'fixture',
  'sandbox',
  'production',
] as const);
export type PaymentEnvironment = (typeof PAYMENT_ENVIRONMENTS)[number];

/**
 * Every provider transaction, event and refund identifier is SCOPED by these
 * three. The account key is a NON-SECRET identifier of the merchant account
 * (never a key or a secret), so a sandbox identifier can never be mistaken
 * for a production one, nor one account's for another's.
 */
export interface PaymentScope {
  readonly provider: PaymentProviderName;
  readonly environment: PaymentEnvironment;
  readonly accountKey: string;
}

export const paymentAccountKeySchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/u);

export function sameScope(left: PaymentScope, right: PaymentScope): boolean {
  return (
    left.provider === right.provider &&
    left.environment === right.environment &&
    left.accountKey === right.accountKey
  );
}

/* ===========================================================================
 * Activation — fail closed
 * ========================================================================= */

/**
 * `fixture` authorises a NON-production environment for engineering proof.
 * `approved` is the only authority for `production` and requires recorded
 * external evidence; neither the runtime nor any Donations key can write it.
 */
export const DONATION_ACTIVATION_AUTHORITIES = Object.freeze([
  'fixture',
  'approved',
] as const);
export type DonationActivationAuthority =
  (typeof DONATION_ACTIVATION_AUTHORITIES)[number];

export interface DonationActivationRecord extends PaymentScope {
  readonly authority: DonationActivationAuthority;
  readonly activatedAt: Date;
}

/**
 * Whether real payment initiation is available. No row = no. A row permits
 * only the exact configured provider, environment and account; `production`
 * needs `approved`, and every other environment needs `fixture`.
 */
export function activationPermits(
  activation: DonationActivationRecord | null,
  scope: PaymentScope | null,
): boolean {
  if (activation === null || scope === null) return false;
  if (!sameScope(activation, scope)) return false;
  return scope.environment === 'production'
    ? activation.authority === 'approved'
    : activation.authority === 'fixture';
}

/* ===========================================================================
 * Campaigns
 * ========================================================================= */

export const DONATION_CAMPAIGN_STATES = Object.freeze([
  'draft',
  'published',
  'archived',
] as const);
export type DonationCampaignState = (typeof DONATION_CAMPAIGN_STATES)[number];

/** A campaign that has been public never returns to draft. */
export const DONATION_CAMPAIGN_TRANSITIONS: Readonly<
  Record<DonationCampaignState, readonly DonationCampaignState[]>
> = Object.freeze({
  draft: Object.freeze(['published'] as const),
  published: Object.freeze(['archived'] as const),
  archived: Object.freeze(['published'] as const),
});

export const DONATION_LIMITS = Object.freeze({
  title: 160,
  summary: 600,
  description: 4000,
  displayOrder: 9999,
  campaigns: 50,
  currenciesPerCampaign: 8,
  suggestions: 3,
});

export const DONATION_PAGE = 25;
export const OWN_DONATION_HISTORY = 50;
export const DONATION_EXPORT_ROWS = 5000;

export const donationCurrencySchema = z.custom<DonationCurrency>(isDonationCurrency, {
  message: 'unsupported currency',
});

const minorSchema = z
  .bigint()
  .positive()
  .refine((value) => value <= MONEY_MINOR_MAX, { message: 'amount too large' });

export const campaignTranslationSchema = z
  .object({
    locale: localeSchema,
    title: labelText(DONATION_LIMITS.title),
    summary: labelText(DONATION_LIMITS.summary),
    description: labelText(DONATION_LIMITS.description),
  })
  .strict();
export type CampaignTranslation = z.infer<typeof campaignTranslationSchema>;

/**
 * A campaign's server-owned policy for ONE currency: inclusive exact bounds
 * and up to three suggested exact amounts inside them.
 */
export const campaignCurrencyPolicySchema = z
  .object({
    currency: donationCurrencySchema,
    minimumMinor: minorSchema,
    maximumMinor: minorSchema,
    suggestedMinor: z.array(minorSchema).max(DONATION_LIMITS.suggestions),
  })
  .strict()
  .refine((policy) => policy.minimumMinor <= policy.maximumMinor, {
    message: 'minimum above maximum',
  })
  .refine(
    (policy) =>
      policy.suggestedMinor.every(
        (value) => value >= policy.minimumMinor && value <= policy.maximumMinor,
      ) &&
      new Set(policy.suggestedMinor.map(String)).size === policy.suggestedMinor.length,
    { message: 'suggestions must be distinct and within bounds' },
  );
export type CampaignCurrencyPolicy = z.infer<typeof campaignCurrencyPolicySchema>;

export const campaignCreateSchema = z
  .object({
    primaryLocale: localeSchema,
    displayOrder: z.number().int().min(0).max(DONATION_LIMITS.displayOrder),
  })
  .strict();
export type CampaignCreate = z.infer<typeof campaignCreateSchema>;

export interface PublicDonationCampaign {
  readonly id: string;
  readonly primaryLocale: Locale;
  readonly displayOrder: number;
  readonly translations: readonly CampaignTranslation[];
  readonly currencies: readonly CampaignCurrencyPolicy[];
}

export interface DonationCampaignRecord extends PublicDonationCampaign {
  readonly state: DonationCampaignState;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
  readonly archivedAt: Date | null;
  /** Whether any Donation references it: a referenced campaign is never deleted. */
  readonly referenced: boolean;
}

export type RequestedMoneyVerdict =
  'ok' | 'currency-not-offered' | 'below-minimum' | 'above-maximum';

/** Server-side validation of a REQUESTED amount against the campaign's policy. */
export function checkRequestedMoney(
  policies: readonly CampaignCurrencyPolicy[],
  requested: ExactMoney,
): RequestedMoneyVerdict {
  const policy = policies.find((candidate) => candidate.currency === requested.currency);
  if (policy === undefined) return 'currency-not-offered';
  if (requested.minor < policy.minimumMinor) return 'below-minimum';
  if (requested.minor > policy.maximumMinor) return 'above-maximum';
  return 'ok';
}

/* ===========================================================================
 * Donation lifecycle
 * ========================================================================= */

/**
 * The provider-neutral states. `expired` and `cancelled` exist because hosted
 * checkout sessions expire and a donor may abandon one; `partially_refunded`,
 * `refunded`, `disputed` and `charged_back` exist because the selected
 * provider supports refunds and reports disputes (provider capability map).
 */
export const DONATION_STATES = Object.freeze([
  'pending',
  'succeeded',
  'failed',
  'cancelled',
  'expired',
  'partially_refunded',
  'refunded',
  'disputed',
  'charged_back',
] as const);
export type DonationState = (typeof DONATION_STATES)[number];

/** States in which money was verifiably captured. */
export const CAPTURED_DONATION_STATES = Object.freeze([
  'succeeded',
  'partially_refunded',
  'refunded',
  'disputed',
  'charged_back',
] as const satisfies readonly DonationState[]);

export function isCapturedState(state: DonationState): boolean {
  return (CAPTURED_DONATION_STATES as readonly DonationState[]).includes(state);
}

/** Outcomes of an attempt that never captured money. */
export const DONATION_CLOSURES = Object.freeze([
  'failed',
  'expired',
  'cancelled',
] as const);
export type DonationClosure = (typeof DONATION_CLOSURES)[number];

/**
 * Dispute facts are MONOTONIC: `none → open → won | lost`. A closed dispute
 * never reopens and a stale "open" never overwrites "won" or "lost".
 */
export const DONATION_DISPUTES = Object.freeze(['none', 'open', 'won', 'lost'] as const);
export type DonationDispute = (typeof DONATION_DISPUTES)[number];

const DISPUTE_RANK: Readonly<Record<DonationDispute, number>> = Object.freeze({
  none: 0,
  open: 1,
  won: 2,
  lost: 2,
});

/** How the provider checkout session creation stands. */
export const DONATION_CREATE_STATES = Object.freeze([
  'pending',
  'created',
  'ambiguous',
  'rejected',
] as const);
export type DonationCreateState = (typeof DONATION_CREATE_STATES)[number];

/**
 * Why a donation needs a person to look at it. Never resolved by assuming an
 * outcome: an attention flag stops automatic progress on that question only.
 */
export const DONATION_ATTENTION = Object.freeze([
  'amount-mismatch',
  'provider-mismatch',
  'unresolved',
  'external-refund',
] as const);
export type DonationAttention = (typeof DONATION_ATTENTION)[number];

/** The monotonic facts a donation's state is derived from. */
export interface DonationFacts {
  /** Exactly the expected minor amount once capture is verified, else null. Set once. */
  readonly capturedMinor: bigint | null;
  /** Provider-reported total refunded. Never decreases; never exceeds captured. */
  readonly refundedMinor: bigint;
  readonly dispute: DonationDispute;
  /** An unsettled outcome; only meaningful while nothing is captured. */
  readonly closure: DonationClosure | null;
  /** The donor asked to abandon checkout; an expiry that follows reads as `cancelled`. */
  readonly cancelRequested: boolean;
}

/** The single derivation of a donation's state from its facts. */
export function deriveDonationState(facts: DonationFacts): DonationState {
  if (facts.capturedMinor !== null) {
    if (facts.dispute === 'lost') return 'charged_back';
    if (facts.dispute === 'open') return 'disputed';
    if (facts.refundedMinor > 0n && facts.refundedMinor >= facts.capturedMinor)
      return 'refunded';
    if (facts.refundedMinor > 0n) return 'partially_refunded';
    return 'succeeded';
  }
  if (facts.closure === 'expired' && facts.cancelRequested) return 'cancelled';
  return facts.closure ?? 'pending';
}

/* ===========================================================================
 * Provider observations — normalised by the adapter, verified by the domain
 * ========================================================================= */

export const OBSERVED_CHECKOUT_STATES = Object.freeze([
  'open',
  'complete',
  'expired',
] as const);
export type ObservedCheckoutState = (typeof OBSERVED_CHECKOUT_STATES)[number];

export const OBSERVED_PAYMENT_STATES = Object.freeze([
  'none',
  'processing',
  'requires_action',
  'succeeded',
  'failed',
  'canceled',
] as const);
export type ObservedPaymentState = (typeof OBSERVED_PAYMENT_STATES)[number];

/**
 * What the provider says NOW about one checkout, retrieved server-to-server by
 * the adapter configured for exactly one scope, in ISO minor units. Never
 * built from a webhook body or a browser.
 */
export interface PaymentObservation {
  readonly scope: PaymentScope;
  readonly checkoutReference: string;
  /** The donation id the provider holds for this checkout (its client reference). */
  readonly donationReference: string | null;
  readonly checkout: ObservedCheckoutState;
  readonly payment: ObservedPaymentState;
  readonly paymentReference: string | null;
  /** The amount the provider is charging for this attempt. */
  readonly amount: ExactMoney;
  /** Captured / settled amount, when the provider reports a capture. */
  readonly capturedMinor: bigint | null;
  readonly refundedMinor: bigint;
  readonly dispute: DonationDispute;
}

export interface DonationTruthInput {
  readonly donationId: string;
  readonly scope: PaymentScope;
  readonly checkoutReference: string | null;
  readonly expected: ExactMoney;
  readonly facts: DonationFacts;
}

export type DonationTruthResult =
  | {
      readonly verdict: 'apply';
      readonly facts: DonationFacts;
      readonly paymentReference: string | null;
    }
  | { readonly verdict: 'attention'; readonly attention: DonationAttention };

/**
 * Merges verified provider truth into a donation's facts — the ONE rule every
 * path (webhook, reconciliation, return-page check, operator reconcile) uses.
 *
 * CONVERGENT. Captured is set once and never cleared; refunded only grows;
 * disputes only move forward; a closure is only recorded while nothing is
 * captured. So any order of observations ends in the same facts, a late
 * "pending" or "failed" can never regress verified success, and a stale read
 * cannot undo a newer one.
 *
 * NEVER SUCCEEDS ON A MISMATCH. A different scope, checkout, client reference,
 * currency or amount, or a capture other than exactly the expected amount,
 * returns `attention` and changes nothing.
 */
export function mergeProviderTruth(
  current: DonationTruthInput,
  observed: PaymentObservation,
): DonationTruthResult {
  if (!sameScope(current.scope, observed.scope)) {
    return { verdict: 'attention', attention: 'provider-mismatch' };
  }
  if (
    current.checkoutReference === null ||
    observed.checkoutReference !== current.checkoutReference ||
    observed.donationReference !== current.donationId
  ) {
    return { verdict: 'attention', attention: 'provider-mismatch' };
  }
  if (
    observed.amount.currency !== current.expected.currency ||
    observed.amount.minor !== current.expected.minor
  ) {
    return { verdict: 'attention', attention: 'amount-mismatch' };
  }

  const facts = current.facts;
  const paid = observed.payment === 'succeeded' && observed.capturedMinor !== null;
  if (paid && observed.capturedMinor !== current.expected.minor) {
    return { verdict: 'attention', attention: 'amount-mismatch' };
  }
  const capturedMinor = facts.capturedMinor ?? (paid ? current.expected.minor : null);

  if (capturedMinor === null) {
    if (observed.refundedMinor > 0n || observed.dispute !== 'none') {
      return { verdict: 'attention', attention: 'provider-mismatch' };
    }
    const closure: DonationClosure | null =
      facts.closure ??
      (observed.checkout === 'expired'
        ? 'expired'
        : observed.payment === 'failed' || observed.payment === 'canceled'
          ? observed.checkout === 'complete'
            ? 'failed'
            : null
          : null);
    return {
      verdict: 'apply',
      facts: { ...facts, capturedMinor: null, closure },
      paymentReference: observed.paymentReference,
    };
  }

  if (observed.refundedMinor > capturedMinor) {
    return { verdict: 'attention', attention: 'amount-mismatch' };
  }
  const refundedMinor =
    observed.refundedMinor > facts.refundedMinor
      ? observed.refundedMinor
      : facts.refundedMinor;
  const dispute =
    DISPUTE_RANK[observed.dispute] > DISPUTE_RANK[facts.dispute]
      ? observed.dispute
      : facts.dispute;

  return {
    verdict: 'apply',
    facts: { ...facts, capturedMinor, refundedMinor, dispute, closure: null },
    paymentReference: observed.paymentReference,
  };
}

/* ===========================================================================
 * Refunds
 * ========================================================================= */

/**
 * `requested` — reserved against the captured amount; the provider's answer
 * is not yet known (a timeout stays here and is reconciled, never retried
 * blind). `pending` — the provider accepted it. `succeeded` / `failed` — final.
 */
export const DONATION_REFUND_STATES = Object.freeze([
  'requested',
  'pending',
  'succeeded',
  'failed',
] as const);
export type DonationRefundState = (typeof DONATION_REFUND_STATES)[number];

export const OBSERVED_REFUND_STATES = Object.freeze([
  'pending',
  'succeeded',
  'failed',
] as const);
export type ObservedRefundState = (typeof OBSERVED_REFUND_STATES)[number];

export interface RefundObservation {
  readonly scope: PaymentScope;
  readonly refundReference: string;
  /** The refund id the provider holds (its metadata). */
  readonly refundId: string | null;
  readonly paymentReference: string;
  readonly state: ObservedRefundState;
  readonly amount: ExactMoney;
}

/** Refund states may only move forward. */
export const DONATION_REFUND_TRANSITIONS: Readonly<
  Record<DonationRefundState, readonly DonationRefundState[]>
> = Object.freeze({
  requested: Object.freeze(['pending', 'succeeded', 'failed'] as const),
  pending: Object.freeze(['succeeded', 'failed'] as const),
  succeeded: Object.freeze([] as const),
  failed: Object.freeze([] as const),
});

/**
 * How long a hosted checkout stays open, in seconds, counted from the
 * donation's own creation instant — so a repeated create computes the same
 * expiry. Inside the provider's documented 30-minute-to-24-hour window.
 */
export const CHECKOUT_LIFETIME_SECONDS = 3600;

/**
 * How long a create may be repeated under its original idempotency key and
 * still be answered with the original outcome — inside the provider's
 * 24-hour retention, with margin. Past it, an unresolved create is a
 * person's question, never a fresh attempt.
 */
export const CREATE_REPLAY_WINDOW_SECONDS = 20 * 3600;

/* ===========================================================================
 * Inputs
 * ========================================================================= */

/** What a donor's browser may send: a REQUEST, never an authoritative amount. */
export const donationStartSchema = z
  .object({
    operationId: donationOperationIdSchema,
    campaignId: donationCampaignIdSchema,
    currency: donationCurrencySchema,
    /** Decimal text, parsed exactly by `parseExactAmount`. */
    amount: z.string().min(1).max(20),
  })
  .strict();
export type DonationStart = z.infer<typeof donationStartSchema>;

export const refundRequestSchema = z
  .object({
    operationId: donationOperationIdSchema,
    donationId: donationIdSchema,
    expectedVersion: donationVersionSchema,
    /** Decimal text in the donation's own currency. */
    amount: z.string().min(1).max(20),
  })
  .strict();
export type RefundRequest = z.infer<typeof refundRequestSchema>;

export const donationQuerySchema = z
  .object({
    state: z.enum(DONATION_STATES).nullable(),
    campaignId: donationCampaignIdSchema.nullable(),
    environment: z.enum(PAYMENT_ENVIRONMENTS).nullable(),
    donor: z.enum(['anonymous', 'linked']).nullable(),
    attention: z.boolean(),
    offset: z.number().int().min(0).max(10_000),
  })
  .strict();
export type DonationQuery = z.infer<typeof donationQuerySchema>;

/* ===========================================================================
 * Views
 * ========================================================================= */

export interface DonationRecord {
  readonly id: string;
  readonly campaignId: string;
  /** The interface locale the donation began in; the provider return URL is built from it. */
  readonly locale: Locale;
  /**
   * The donor-visible line text sent to the provider (the campaign title at
   * initiation), kept so a create repeated under the same idempotency key
   * sends byte-identical parameters.
   */
  readonly checkoutLabel: string;
  readonly state: DonationState;
  readonly expected: ExactMoney;
  readonly linked: boolean;
  readonly scope: PaymentScope;
  readonly createState: DonationCreateState;
  readonly checkoutReference: string | null;
  readonly paymentReference: string | null;
  readonly capturedMinor: bigint | null;
  readonly refundedMinor: bigint;
  /** Sum of this platform's refunds that are requested, pending or succeeded. */
  readonly refundReservedMinor: bigint;
  readonly dispute: DonationDispute;
  readonly attention: DonationAttention | null;
  readonly checkoutExpiresAt: Date | null;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly succeededAt: Date | null;
}

/** The campaign words a donor- or operator-facing view carries. */
export interface CampaignLabel {
  readonly campaignId: string;
  readonly primaryLocale: Locale;
  readonly translations: readonly Pick<CampaignTranslation, 'locale' | 'title'>[];
}

/** What a status-token holder may read. Nothing personal, no provider reference. */
export interface DonationStatusView {
  readonly state: DonationState;
  readonly expected: ExactMoney;
  readonly refundedMinor: bigint;
  readonly environment: PaymentEnvironment;
  readonly campaign: CampaignLabel;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  /** Whether the donor may still ask to abandon the open checkout. */
  readonly cancellable: boolean;
}

export interface OwnDonation {
  readonly id: string;
  readonly state: DonationState;
  readonly expected: ExactMoney;
  readonly refundedMinor: bigint;
  readonly environment: PaymentEnvironment;
  readonly campaign: CampaignLabel;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly succeededAt: Date | null;
}

export interface DonationRefundRecord {
  readonly id: string;
  readonly donationId: string;
  readonly amount: ExactMoney;
  readonly state: DonationRefundState;
  readonly refundReference: string | null;
  readonly requestedAt: Date;
  readonly completedAt: Date | null;
  readonly version: number;
}

export interface StaffDonation extends DonationRecord {
  /** Only for minimal name resolution through Identity; never shown raw. */
  readonly donorAccountId: string | null;
  readonly campaign: CampaignLabel;
  readonly reconcileDueAt: Date | null;
  readonly reconcileAttempts: number;
}

export interface StaffDonationDetail extends StaffDonation {
  readonly refunds: readonly DonationRefundRecord[];
}

export interface StaffDonationPage {
  readonly rows: readonly StaffDonation[];
  readonly total: number;
}

/* ===========================================================================
 * Service communication
 * ========================================================================= */

/**
 * Transactional mail owed to a USER-LINKED donor only. An anonymous donor gets
 * on-site status through their token and no mail: no address is ever collected
 * for a receipt. Payment acknowledgement, never a tax receipt.
 */
export const DONATION_COMMUNICATION_PURPOSES = Object.freeze([
  'donation.succeeded',
  'donation.partially-refunded',
  'donation.refunded',
] as const);
export type DonationCommunicationPurpose =
  (typeof DONATION_COMMUNICATION_PURPOSES)[number];

export const DONATION_INTENT_STATES = Object.freeze([
  'pending',
  'relayed',
  'abandoned',
] as const);
export type DonationIntentState = (typeof DONATION_INTENT_STATES)[number];

/** `donation.succeeded:{donationId}` or `donation.*refunded:{refundId}` — one per fact. */
export function donationIntentKey(
  purpose: DonationCommunicationPurpose,
  recordId: string,
): string {
  return `${purpose}:${recordId}`;
}

export interface DonationCommunicationIntentRecord {
  readonly id: string;
  readonly donationId: string;
  readonly refundId: string | null;
  readonly recipientAccountId: string;
  readonly purpose: DonationCommunicationPurpose;
  readonly dueAt: Date;
  readonly state: DonationIntentState;
  readonly idempotencyKey: string;
}

/* ===========================================================================
 * Export
 * ========================================================================= */

export const DONATION_EXPORT_SCHEMA = 'minhaj.donations.export';
export const DONATION_EXPORT_VERSION = 1;

export interface OwnDonationExportRow {
  readonly id: string;
  readonly campaignId: string;
  readonly currency: DonationCurrency;
  /** Exact decimal text in the currency's ISO unit. */
  readonly amount: string;
  readonly refunded: string;
  readonly state: DonationState;
  readonly environment: PaymentEnvironment;
  readonly createdAt: string;
  readonly succeededAt: string | null;
  readonly updatedAt: string;
}

export interface DonationExport {
  readonly schema: typeof DONATION_EXPORT_SCHEMA;
  readonly version: typeof DONATION_EXPORT_VERSION;
  readonly generatedAt: string;
  readonly donations: readonly OwnDonationExportRow[];
}
