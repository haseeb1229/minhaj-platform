import type { Locale } from '../env/shared.ts';

import type { ExactMoney } from './money.ts';
import type { ProviderEventNotice, ProviderEventSubject } from './provider.ts';
import type {
  CampaignCreate,
  CampaignCurrencyPolicy,
  CampaignTranslation,
  DonationActivationRecord,
  DonationCampaignRecord,
  DonationCommunicationIntentRecord,
  DonationCreateState,
  DonationQuery,
  DonationRecord,
  DonationRefundRecord,
  DonationStatusView,
  OwnDonation,
  OwnDonationExportRow,
  PaymentObservation,
  PaymentScope,
  PublicDonationCampaign,
  RefundObservation,
  StaffDonation,
  StaffDonationDetail,
  StaffDonationPage,
} from './values.ts';

/**
 * The ports the Donations context depends on (DOMAIN_MODEL.md §17.3). Each is
 * implemented by Donations' own persistence adapter, hosted in
 * `packages/database`, or — for the Identity answers — composed at Layer 4.
 * The payment provider is a separate port (`./provider.ts`).
 *
 * THE DATABASE IS THE AUTHORITY FOR EVERY MONEY INVARIANT. One donation per
 * operation id, scoped provider-reference uniqueness, captured-set-once,
 * refunded-never-decreases, reserved refunds never above the captured amount,
 * and refund authority are enforced by keys, CHECKs and triggers — the service
 * checks first only to answer helpfully.
 *
 * EVERY OWNER READ IS KEYED BY THE ACCOUNT; every operator act and every
 * financial-detail read commits its audit row, and every owed message its
 * durable intent, IN THE SAME TRANSACTION as the change they describe.
 */

/* ===========================================================================
 * Public — published campaigns and activation, nothing personal
 * ========================================================================= */

export interface DonationCatalogueReaderPort {
  /** Published campaigns in display order, then id, each with its currency policy. */
  publishedCampaigns(): Promise<readonly PublicDonationCampaign[]>;
}

export interface DonationActivationReaderPort {
  /** The single activation row, or null — and null means unavailable. */
  activation(): Promise<DonationActivationRecord | null>;
}

/* ===========================================================================
 * Operator — campaigns, under `donations.administer`
 * ========================================================================= */

export interface DonationCampaignPort {
  /** Every campaign, any state, display order then id. Bounded by `DONATION_LIMITS.campaigns`. */
  campaigns(): Promise<readonly DonationCampaignRecord[]>;
  campaign(id: string): Promise<DonationCampaignRecord | null>;
  /** A new draft. Refused `limit` once `DONATION_LIMITS.campaigns` exist. Audited. */
  createCampaign(input: {
    readonly id: string;
    readonly actorId: string;
    readonly value: CampaignCreate;
  }): Promise<DonationCampaignRecord>;
  reorderCampaign(input: {
    readonly actorId: string;
    readonly id: string;
    readonly expectedVersion: number;
    readonly displayOrder: number;
  }): Promise<DonationCampaignRecord>;
  /** Adds or replaces one locale's words. Version-checked and audited. */
  saveTranslation(input: {
    readonly actorId: string;
    readonly id: string;
    readonly expectedVersion: number;
    readonly translation: CampaignTranslation;
  }): Promise<DonationCampaignRecord>;
  /**
   * Adds or replaces one currency's policy. Refused `limit` beyond
   * `DONATION_LIMITS.currenciesPerCampaign`. Changing a policy never touches an
   * existing donation: each donation's expected money is its own immutable copy.
   */
  saveCurrencyPolicy(input: {
    readonly actorId: string;
    readonly id: string;
    readonly expectedVersion: number;
    readonly policy: CampaignCurrencyPolicy;
  }): Promise<DonationCampaignRecord>;
  /** Removes one currency. A published campaign keeps at least one (`incomplete`). */
  removeCurrencyPolicy(input: {
    readonly actorId: string;
    readonly id: string;
    readonly expectedVersion: number;
    readonly currency: CampaignCurrencyPolicy['currency'];
  }): Promise<DonationCampaignRecord>;
  /**
   * Publishes or archives. Publication needs the primary locale's words and at
   * least one currency (`incomplete`); a campaign that has been public never
   * returns to draft. Serialised with initiation: a donation begun after an
   * archive commits is refused, one begun before it stands.
   */
  transitionCampaign(input: {
    readonly actorId: string;
    readonly id: string;
    readonly expectedVersion: number;
    readonly to: 'published' | 'archived';
  }): Promise<DonationCampaignRecord>;
}

/* ===========================================================================
 * Donor — initiation, the anonymous status token, cancellation
 * ========================================================================= */

export interface DonationBeginInput {
  readonly id: string;
  readonly operationId: string;
  /** SHA-256 hex of the canonical request (campaign, currency, minor, linked account). */
  readonly requestDigest: string;
  readonly campaignId: string;
  readonly locale: Locale;
  /** The campaign title as the donor saw it; immutable, see `DonationRecord.checkoutLabel`. */
  readonly checkoutLabel: string;
  /** Set only when an authenticated, ACTIVE account starts the donation linked. */
  readonly donorAccountId: string | null;
  readonly expected: ExactMoney;
  /** SHA-256 hex of the opaque status token. The token itself is never stored. */
  readonly statusTokenDigest: string;
  readonly scope: PaymentScope;
}

export interface DonationDonorPort {
  /**
   * A new `pending` donation, `createState: 'pending'`. Under the campaign's
   * lock the campaign must be PUBLISHED and its current policy must admit the
   * money (`campaign-unavailable`, `amount-refused`); an activation row must
   * permit the scope (`not-activated`, also enforced by trigger); a linked
   * account must be active (`account-closed`).
   *
   * IDEMPOTENT BY OPERATION ID: the same operation id with the same request
   * digest answers the existing donation with `created: false`; with a
   * different digest it is refused `operation-conflict`.
   */
  begin(
    input: DonationBeginInput,
  ): Promise<{ readonly donation: DonationRecord; readonly created: boolean }>;
  /** The provider checkout now exists: `pending | ambiguous → created`. Scoped-unique reference. */
  recordCheckout(input: {
    readonly id: string;
    readonly checkoutReference: string;
    readonly expiresAt: Date;
    readonly now: Date;
  }): Promise<DonationRecord>;
  /**
   * The create call's outcome was not `created`. `ambiguous` schedules
   * reconciliation; `rejected` closes the donation `failed` (nothing exists at
   * the provider).
   */
  recordCreateOutcome(input: {
    readonly id: string;
    readonly outcome: Extract<DonationCreateState, 'ambiguous' | 'rejected'>;
    readonly now: Date;
  }): Promise<DonationRecord>;
  /** The donation a status token digest names, for the server's own use. */
  donationByToken(statusTokenDigest: string): Promise<DonationRecord | null>;
  /** What the token holder may read. */
  statusByToken(statusTokenDigest: string): Promise<DonationStatusView | null>;
  /** Records the donor's request to abandon a still-pending checkout. Idempotent. */
  markCancelRequested(input: {
    readonly id: string;
    readonly now: Date;
  }): Promise<DonationRecord>;
}

/* ===========================================================================
 * Ledger — verified provider truth from webhooks and reconciliation
 * ========================================================================= */

/** What one provider event did. Kept with the dedup record; no payload is kept. */
export const DONATION_EVENT_RESULTS = Object.freeze([
  'applied',
  'unchanged',
  'ignored',
  'unmatched',
  'attention',
] as const);
export type DonationEventResult = (typeof DONATION_EVENT_RESULTS)[number];

/**
 * A leased donation. Only its id: the reconciler re-reads the donation itself,
 * so it always acts on the current row rather than on what was true at claim time.
 */
export interface DonationReconcileClaim {
  readonly donationId: string;
}

export interface RefundReconcileClaim {
  readonly refundId: string;
  readonly donationId: string;
  readonly refundReference: string | null;
  readonly paymentReference: string;
  readonly amount: ExactMoney;
  /** When the refund was reserved — after the create replay window, "not found" is conclusive. */
  readonly requestedAt: Date;
}

export interface DonationLedgerPort {
  /** The donation (and refund) a verified event's subject names, within the scope. */
  locate(input: {
    readonly scope: PaymentScope;
    readonly subject: ProviderEventSubject;
  }): Promise<{ readonly donationId: string; readonly refundId: string | null } | null>;
  /**
   * Durable dedup, keyed by scope + event id. `process` for a new event AND for
   * one recorded by an attempt that never completed; `already-processed` once
   * completed — so a duplicate delivery has one effect, and a crash between
   * admit and complete is retried rather than lost.
   */
  admitEvent(input: {
    readonly notice: Pick<
      ProviderEventNotice,
      'scope' | 'eventId' | 'eventType' | 'occurredAt' | 'payloadDigest'
    >;
    readonly receivedAt: Date;
  }): Promise<'process' | 'already-processed'>;
  completeEvent(input: {
    readonly scope: PaymentScope;
    readonly eventId: string;
    readonly donationId: string | null;
    readonly result: DonationEventResult;
    readonly now: Date;
  }): Promise<void>;
  donation(id: string): Promise<DonationRecord | null>;
  /**
   * Locks the donation, merges with `mergeProviderTruth`, and writes facts,
   * derived state, payment reference (scoped-unique), attention, reconcile
   * schedule and — on the transition into `succeeded` of a linked donation —
   * its owed intent, all in one transaction. `operator` applications are
   * audited. An attention verdict changes nothing but the attention flag.
   */
  applyObservation(input: {
    readonly donationId: string;
    readonly observation: PaymentObservation;
    readonly source: 'webhook' | 'reconcile' | 'donor-check' | 'operator';
    readonly actorId: string | null;
    readonly now: Date;
  }): Promise<{ readonly donation: DonationRecord; readonly changed: boolean }>;
  /**
   * Locks donation and refund; moves the refund forward only; releases its
   * reservation on `failed`; on `succeeded` raises the donation's refunded total
   * (never above captured) and commits the linked donor's refund intent.
   */
  applyRefundObservation(input: {
    readonly refundId: string;
    readonly observation: RefundObservation;
    readonly now: Date;
  }): Promise<{
    readonly refund: DonationRefundRecord;
    readonly donation: DonationRecord;
    readonly changed: boolean;
  }>;
  /** Leases due pending donations (missing webhook, ambiguous create, stale pending). */
  claimDueDonations(
    now: Date,
    limit: number,
    leaseSeconds: number,
  ): Promise<readonly DonationReconcileClaim[]>;
  /** Leases refunds whose provider outcome is not yet final. */
  claimDueRefunds(
    now: Date,
    limit: number,
    leaseSeconds: number,
  ): Promise<readonly RefundReconcileClaim[]>;
  /** The provider could not answer: bounded backoff; exhaustion sets `attention: unresolved`. */
  deferDonation(input: {
    readonly donationId: string;
    readonly now: Date;
  }): Promise<void>;
  deferRefund(input: { readonly refundId: string; readonly now: Date }): Promise<void>;
}

/* ===========================================================================
 * Refunds — `donations.refund` with a live `donation-refund` step-up
 * ========================================================================= */

export interface DonationRefundPort {
  /**
   * Reserves a refund against a captured donation, under its lock: the
   * donation's version must match (`conflict`), its state must be captured and
   * not charged back (`invalid-state`), the currency must be the donation's,
   * the amount positive and within what remains refundable (`over-refund`).
   * The actor must hold `donations.refund` with a live `donation-refund`
   * step-up — enforced by trigger, not only by the caller. Idempotent by
   * operation id; audited.
   */
  reserve(input: {
    readonly refundId: string;
    readonly operationId: string;
    readonly requestDigest: string;
    readonly donationId: string;
    readonly expectedVersion: number;
    readonly amount: ExactMoney;
    readonly actorId: string;
  }): Promise<{ readonly refund: DonationRefundRecord; readonly created: boolean }>;
  /**
   * The provider's answer to the refund request was not `accepted`:
   * `rejected` fails the refund and releases its reservation; `unknown` keeps
   * it `requested` and schedules reconciliation — never a blind retry.
   */
  recordSubmission(input: {
    readonly refundId: string;
    readonly outcome: 'rejected' | 'unknown';
    readonly now: Date;
  }): Promise<DonationRefundRecord>;
}

/* ===========================================================================
 * Operator — records, reconciliation and export, under `donations.read` /
 * `donations.administer`
 * ========================================================================= */

export interface DonationStaffPort {
  /** Filtered, bounded listing. Audited. */
  donations(actorId: string, query: DonationQuery): Promise<StaffDonationPage>;
  /** One donation with its refunds. Audited as a financial-detail access. */
  donation(actorId: string, id: string): Promise<StaffDonationDetail | null>;
  /** Deterministic, bounded by `DONATION_EXPORT_ROWS`, newest first. Audited. */
  exportRows(
    actorId: string,
    query: Omit<DonationQuery, 'offset'>,
  ): Promise<readonly StaffDonation[]>;
  /** Makes the donation due for reconciliation now. Version-checked and audited. */
  requestReconcile(input: {
    readonly actorId: string;
    readonly id: string;
    readonly expectedVersion: number;
    readonly now: Date;
  }): Promise<DonationRecord>;
}

/* ===========================================================================
 * Owner — `/my/donations`, keyed by the account
 * ========================================================================= */

export interface DonationOwnerPort {
  /** The account's own linked donations, newest first, bounded. */
  history(accountId: string, limit: number): Promise<readonly OwnDonation[]>;
  exportRows(accountId: string): Promise<readonly OwnDonationExportRow[]>;
}

/* ===========================================================================
 * Service communication
 * ========================================================================= */

export interface DonationDeliverySource {
  readonly intent: DonationCommunicationIntentRecord;
  /** Whether the fact the intent announces still holds for the same linked donor. */
  readonly owed: boolean;
  readonly expected: ExactMoney;
  readonly refundAmount: ExactMoney | null;
  readonly campaign: DonationStatusView['campaign'];
}

export interface DonationCommunicationPort {
  claimDue(
    now: Date,
    limit: number,
    leaseSeconds: number,
  ): Promise<readonly DonationCommunicationIntentRecord[]>;
  markRelayed(intentId: string, now: Date): Promise<void>;
  markAbandoned(intentId: string, now: Date): Promise<void>;
  deliverySource(intentId: string): Promise<DonationDeliverySource | null>;
}

/* ===========================================================================
 * Account closure — financial history retained, the link released
 * ========================================================================= */

export interface DonationDispositionPort {
  /**
   * For a CLOSED account: abandons and removes its owed intents, and releases
   * the account link of its donations (the donation becomes anonymous; amounts,
   * states, events and refunds are retained untouched). Bounded; returns rows
   * changed.
   */
  disposeAccount(accountId: string, limit: number): Promise<number>;
  /** Accounts that still have linked donations or intents, ascending id, after a cursor. */
  accountsWithData(after: string | null, limit: number): Promise<readonly string[]>;
}

/* ===========================================================================
 * Answered by Identity at Layer 4
 * ========================================================================= */

export interface DonationAuthorityPort {
  permits(accountId: string, permission: string): Promise<boolean>;
}

export interface DonationAccountsPort {
  closedAccounts(accountIds: readonly string[]): Promise<readonly string[]>;
}

export interface DonationRecipientPort {
  recipients(accountIds: readonly string[]): Promise<
    readonly {
      readonly accountId: string;
      readonly email: string;
      readonly locale: string;
    }[]
  >;
}
