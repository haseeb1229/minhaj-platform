import type { DonationCurrency, ExactMoney } from './money.ts';
import type { PaymentObservation, PaymentScope, RefundObservation } from './values.ts';

/**
 * The `PaymentProvider` abstraction (ARCHITECTURE.md §4.7, DOMAIN_MODEL.md
 * §17.3).
 *
 * NARROW AND PROVIDER-NEUTRAL. Every method speaks the domain's words, ISO
 * minor units and opaque references. A provider's URL, headers, signature
 * scheme, status enums and unit conventions live INSIDE its adapter; no raw
 * HTTP client, response body or SDK object crosses this boundary.
 *
 * ONE ADAPTER INSTANCE = ONE SCOPE. An adapter is constructed for exactly one
 * provider, environment and non-secret account key, verifies that every object
 * it reads belongs to that scope, and never falls back from one environment to
 * another.
 *
 * `unknown` IS AN ANSWER, NOT A FAILURE TO BE GUESSED AT. A timeout, a 5xx, a
 * truncated body or an unparseable response is `unknown`; the caller records
 * the ambiguity and reconciles. A money-moving call (checkout creation, refund)
 * is NEVER retried by the adapter; it carries the caller's idempotency key, so
 * a later reconciliation that repeats it with the SAME key is answered with
 * the original outcome rather than a second charge or refund.
 */

/** What the selected adapter genuinely supports — the provider capability map. */
export interface PaymentProviderCapabilities {
  readonly fullRefund: boolean;
  readonly partialRefund: boolean;
  /** Hosted checkout sessions expire on their own. */
  readonly checkoutExpiry: boolean;
  /** An open checkout can be ended server-side (donor cancellation). */
  readonly cancelCheckout: boolean;
  /** Disputes / chargebacks are reported and retrievable. */
  readonly disputes: boolean;
  /** Server-to-server lookup of a checkout, payment and refund. */
  readonly transactionLookup: boolean;
  /** Repeating a create with the same idempotency key returns the original. */
  readonly idempotentCreate: boolean;
  /** ISO currencies this adapter can charge (intersection with the domain allowlist). */
  readonly currencies: readonly DonationCurrency[];
}

export type CheckoutCreation =
  | {
      readonly outcome: 'created';
      readonly checkoutReference: string;
      /** An absolute HTTPS URL on `checkoutOrigin()` — re-validated by the caller. */
      readonly checkoutUrl: string;
      readonly expiresAt: Date;
    }
  /** The provider definitively refused (an amount it cannot represent, a bad request). Nothing was created. */
  | {
      readonly outcome: 'rejected';
      readonly reason: 'unsupported-amount' | 'invalid-request';
    }
  /** The outcome is not known. Never treat as created or as not created. */
  | { readonly outcome: 'unknown' };

export type CheckoutResumption =
  | { readonly outcome: 'open'; readonly checkoutUrl: string }
  | { readonly outcome: 'closed' }
  | { readonly outcome: 'unknown' };

export type CheckoutCancellation = 'cancelled' | 'not-open' | 'unknown';

export type PaymentLookup =
  | { readonly outcome: 'observed'; readonly observation: PaymentObservation }
  | { readonly outcome: 'not-found' }
  | { readonly outcome: 'unknown' };

export type RefundSubmission =
  | { readonly outcome: 'accepted'; readonly observation: RefundObservation }
  /** Definitively refused by the provider; nothing was refunded. */
  | { readonly outcome: 'rejected' }
  | { readonly outcome: 'unknown' };

export type RefundLookup =
  | { readonly outcome: 'observed'; readonly observation: RefundObservation }
  | { readonly outcome: 'not-found' }
  | { readonly outcome: 'unknown' };

/** Which domain object a verified provider event is about. Opaque references only. */
export interface ProviderEventSubject {
  readonly checkoutReference: string | null;
  readonly paymentReference: string | null;
  readonly refundReference: string | null;
}

/**
 * A verified, normalised provider event. It is a HINT about which object to
 * re-read, never the truth itself: its body is not trusted for amount,
 * currency or state, and it is never stored.
 */
export interface ProviderEventNotice {
  readonly scope: PaymentScope;
  readonly eventId: string;
  /** The provider's event type string, bounded, for the dedup record only. */
  readonly eventType: string;
  readonly occurredAt: Date;
  /** `ignored` — a signed event this platform does not act on. */
  readonly category: 'payment' | 'refund' | 'dispute' | 'ignored';
  readonly subject: ProviderEventSubject;
  /** SHA-256 hex of the exact verified bytes, for the dedup record. */
  readonly payloadDigest: string;
}

export type WebhookRejection =
  | 'missing-signature'
  | 'invalid-signature'
  | 'stale'
  | 'malformed'
  | 'wrong-environment'
  | 'not-configured';

export type WebhookVerification =
  | { readonly outcome: 'verified'; readonly notice: ProviderEventNotice }
  | { readonly outcome: 'rejected'; readonly reason: WebhookRejection };

export interface PaymentProviderPort {
  /** The non-secret scope this instance is bound to. */
  scope(): PaymentScope;
  capabilities(): PaymentProviderCapabilities;
  /** The exact HTTPS origin hosted checkout lives on; a redirect anywhere else is refused. */
  checkoutOrigin(): string;

  /**
   * Creates a provider-hosted checkout for one donation. `successUrl` and
   * `cancelUrl` are built by the server from its own base URL. The adapter
   * converts ISO minor units to the provider's protocol and answers
   * `rejected: unsupported-amount` rather than rounding.
   */
  createCheckout(input: {
    readonly donationId: string;
    readonly amount: ExactMoney;
    /** Donor-visible line text: the campaign title. Nothing personal. */
    readonly description: string;
    readonly successUrl: string;
    readonly cancelUrl: string;
    readonly expiresAt: Date;
    readonly idempotencyKey: string;
  }): Promise<CheckoutCreation>;

  /** The redirect URL of a still-open checkout, for a duplicate submission. */
  resumeCheckout(checkoutReference: string): Promise<CheckoutResumption>;

  /** Ends an open checkout at the provider (donor cancellation). */
  cancelCheckout(checkoutReference: string): Promise<CheckoutCancellation>;

  /** Current provider truth for one checkout, read server-to-server. */
  observeCheckout(checkoutReference: string): Promise<PaymentLookup>;

  /**
   * Verifies a webhook over its EXACT raw bytes before anything is parsed,
   * with a timing-safe comparison and the provider's documented freshness
   * window, then normalises it. Pure: no network, no persistence.
   */
  verifyWebhook(input: {
    readonly rawBody: Uint8Array;
    readonly signature: string | null;
    readonly now: Date;
  }): WebhookVerification;

  /** Requests a full or partial refund of a captured payment. Idempotency key = refund id. */
  requestRefund(input: {
    readonly refundId: string;
    readonly donationId: string;
    readonly paymentReference: string;
    readonly amount: ExactMoney;
    readonly idempotencyKey: string;
  }): Promise<RefundSubmission>;

  /**
   * Current provider truth for one refund: by its reference when known,
   * otherwise found among the payment's refunds by this platform's refund id.
   */
  observeRefund(input: {
    readonly refundId: string;
    readonly refundReference: string | null;
    readonly paymentReference: string;
  }): Promise<RefundLookup>;
}
