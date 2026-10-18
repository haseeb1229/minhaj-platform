import 'server-only';

import {
  DONATION_CURRENCIES,
  type CheckoutCancellation,
  type CheckoutCreation,
  type CheckoutResumption,
  type DonationDispute,
  type ExactMoney,
  type ObservedPaymentState,
  type PaymentLookup,
  type PaymentProviderCapabilities,
  type PaymentProviderPort,
  type PaymentScope,
  type RefundLookup,
  type RefundObservation,
  type RefundSubmission,
} from '@minhaj/contracts/donations';

import type { StripeProviderConfig } from './config.ts';
import { stripeExchange, type StripeExchange } from './http.ts';
import { domainCurrency, stripeAmountText, stripeCurrency } from './units.ts';
import { verifyStripeWebhook } from './webhook.ts';
import {
  CHECKOUT_REFERENCE,
  checkoutSessionSchema,
  disputeListSchema,
  errorSchema,
  PAYMENT_REFERENCE,
  REFUND_REFERENCE,
  refundListSchema,
  refundSchema,
  type StripeCheckoutSession,
  type StripeRefund,
} from './wire.ts';

/**
 * The Stripe `PaymentProvider` adapter.
 *
 * SANDBOX ENGINEERING ADAPTER — NOT PRODUCTION PROVIDER SELECTION. Stripe was
 * chosen because its documented protocol could be verified end to end from
 * official sources (raw-byte HMAC webhook signatures with a timestamp,
 * idempotent creates, a refund API, retrievable disputes) so that the Donations
 * domain could be built and proven against a real sandbox and a local
 * simulator. Which provider, account, currencies and regions real donations
 * use is an external decision this code does not make (OPEN_DECISIONS.md §5.4);
 * a production environment exists in the vocabulary so it can be REFUSED until
 * an approved activation says otherwise.
 *
 * Semantic owner: the Donations bounded context. The adapter is hosted in
 * `packages/database` beside Donations' persistence adapter without that
 * transferring ownership, and it holds no database capability at all.
 *
 * Protocol (official API reference, pinned `Stripe-Version`): hosted Checkout
 * Sessions in `payment` mode, retrieved server-to-server with the
 * PaymentIntent and its latest Charge expanded; the expire endpoint for donor
 * cancellation; the Refunds API keyed by the PaymentIntent; the Disputes list
 * filtered by PaymentIntent. Form-encoded requests, `Authorization: Bearer`,
 * `Idempotency-Key` on every money-moving POST, which is NEVER retried here.
 */

export const STRIPE_CAPABILITIES: PaymentProviderCapabilities = Object.freeze({
  fullRefund: true,
  partialRefund: true,
  checkoutExpiry: true,
  cancelCheckout: true,
  disputes: true,
  transactionLookup: true,
  idempotentCreate: true,
  // Stripe accepts every currency of the domain allowlist as a presentment
  // currency; what an ACCOUNT can settle is a separate, external question.
  currencies: DONATION_CURRENCIES,
});

/** Bounds on what this adapter will put in a request at all. */
const REFERENCE_TEXT = /^[A-Za-z0-9_-]{1,200}$/u;
const IDEMPOTENCY_KEY = /^[\x21-\x7E]{1,255}$/u;
const DESCRIPTION_MAX = 250;

const UNKNOWN: { readonly outcome: 'unknown' } = Object.freeze({ outcome: 'unknown' });

function isResponse(
  exchange: StripeExchange,
): exchange is Extract<StripeExchange, { kind: 'response' }> {
  return exchange.kind === 'response';
}

function errorType(body: unknown): string | null {
  const parsed = errorSchema.safeParse(body);
  return parsed.success ? parsed.data.error.type : null;
}

/** A plain-text line a donor sees on the provider page: printable, bounded, single line. */
function validDescription(value: string): boolean {
  return (
    value.trim().length > 0 &&
    value.length <= DESCRIPTION_MAX &&
    // Control characters (line breaks included) never belong in a line item.
    ![...value].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code < 0x20 || (code >= 0x7f && code < 0xa0);
    })
  );
}

function validReturnUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username === '' &&
      url.password === '' &&
      value.length <= 2048
    );
  } catch {
    return false;
  }
}

/** Whole seconds since the epoch; `null` for an invalid date. */
function epochSeconds(date: Date): number | null {
  const milliseconds = date.getTime();
  return Number.isFinite(milliseconds) && milliseconds > 0
    ? Math.floor(milliseconds / 1000)
    : null;
}

/**
 * The dispute fact of a charge Stripe flags as disputed, from its disputes'
 * statuses. An empty list contradicts the flag and is `null` (unknown), as is
 * any status this adapter does not know.
 *
 * ONLY A DECIDED DISPUTE IS TERMINAL. `won` and `lost` are final facts; an
 * inquiry closed without becoming a chargeback (`warning_closed`) or a dispute
 * prevented from becoming one (`prevented`) records NO dispute, so a later
 * dispute on the same charge can still be recorded rather than being blocked by
 * an earlier terminal "won".
 */
function disputeFromList(statuses: readonly string[]): DonationDispute | null {
  if (statuses.length === 0) return null;
  if (statuses.includes('lost')) return 'lost';
  const open = statuses.some((status) =>
    [
      'needs_response',
      'under_review',
      'warning_needs_response',
      'warning_under_review',
    ].includes(status),
  );
  if (open) return 'open';
  if (statuses.includes('won')) return 'won';
  if (statuses.every((status) => status === 'warning_closed' || status === 'prevented'))
    return 'none';
  return null;
}

export function createStripePaymentProvider(
  config: StripeProviderConfig,
): PaymentProviderPort {
  const scope: PaymentScope = Object.freeze({
    provider: 'stripe',
    environment: config.environment,
    accountKey: config.accountKey,
  });
  const livemode = config.environment === 'production';

  /** A hosted-checkout URL exactly on the configured checkout origin, or `null`. */
  function checkoutUrlOf(value: string | null): string | null {
    if (value === null) return null;
    try {
      const url = new URL(value);
      if (url.origin !== config.checkoutOrigin) return null;
      if (url.username !== '' || url.password !== '') return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  async function retrieveSession(
    checkoutReference: string,
    expand: boolean,
  ): Promise<{ readonly found: StripeCheckoutSession } | 'not-found' | 'unknown'> {
    const exchange = await stripeExchange(config, {
      method: 'GET',
      path: `/v1/checkout/sessions/${encodeURIComponent(checkoutReference)}`,
      query: expand
        ? [
            ['expand[]', 'payment_intent'],
            ['expand[]', 'payment_intent.latest_charge'],
          ]
        : [],
    });
    if (!isResponse(exchange)) return 'unknown';
    if (exchange.status === 404) return 'not-found';
    if (exchange.status !== 200) return 'unknown';

    const session = checkoutSessionSchema.safeParse(exchange.body);
    if (!session.success) return 'unknown';
    // An object from the other mode, or another session, is not this scope's truth.
    if (session.data.livemode !== livemode || session.data.id !== checkoutReference) {
      return 'unknown';
    }
    return { found: session.data };
  }

  async function disputeOf(paymentReference: string): Promise<DonationDispute | null> {
    const exchange = await stripeExchange(config, {
      method: 'GET',
      path: '/v1/disputes',
      query: [
        ['payment_intent', paymentReference],
        ['limit', '100'],
      ],
    });
    if (!isResponse(exchange) || exchange.status !== 200) return null;
    const list = disputeListSchema.safeParse(exchange.body);
    if (!list.success || list.data.has_more) return null;
    return disputeFromList(list.data.data.map((dispute) => dispute.status));
  }

  function refundObservation(
    refund: StripeRefund,
    paymentReference: string,
  ): RefundObservation | null {
    const currency = domainCurrency(refund.currency);
    if (currency === null || refund.payment_intent !== paymentReference) return null;
    if (refund.status === null) return null;
    const state =
      refund.status === 'succeeded'
        ? 'succeeded'
        : refund.status === 'failed' || refund.status === 'canceled'
          ? 'failed'
          : 'pending';
    return {
      scope,
      refundReference: refund.id,
      refundId: refund.metadata['refund'] ?? null,
      paymentReference,
      state,
      amount: { currency, minor: refund.amount },
    };
  }

  return {
    scope: () => scope,
    capabilities: () => STRIPE_CAPABILITIES,
    checkoutOrigin: () => config.checkoutOrigin,

    async createCheckout(input): Promise<CheckoutCreation> {
      const unitAmount = stripeAmountText(input.amount);
      if (unitAmount === null)
        return { outcome: 'rejected', reason: 'unsupported-amount' };

      const expiresAt = epochSeconds(input.expiresAt);
      if (
        !REFERENCE_TEXT.test(input.donationId) ||
        !IDEMPOTENCY_KEY.test(input.idempotencyKey) ||
        !validDescription(input.description) ||
        !validReturnUrl(input.successUrl) ||
        !validReturnUrl(input.cancelUrl) ||
        expiresAt === null
      ) {
        // Refused before anything was sent: nothing can have been created.
        return { outcome: 'rejected', reason: 'invalid-request' };
      }

      const exchange = await stripeExchange(config, {
        method: 'POST',
        path: '/v1/checkout/sessions',
        idempotencyKey: input.idempotencyKey,
        form: [
          ['mode', 'payment'],
          ['submit_type', 'donate'],
          ['client_reference_id', input.donationId],
          ['line_items[0][quantity]', '1'],
          ['line_items[0][price_data][currency]', stripeCurrency(input.amount.currency)],
          ['line_items[0][price_data][unit_amount]', unitAmount],
          ['line_items[0][price_data][product_data][name]', input.description],
          ['success_url', input.successUrl],
          ['cancel_url', input.cancelUrl],
          ['expires_at', String(expiresAt)],
          ['metadata[donation]', input.donationId],
          ['payment_intent_data[metadata][donation]', input.donationId],
        ],
      });

      if (!isResponse(exchange)) return UNKNOWN;
      if (exchange.status === 400 || exchange.status === 402) {
        // A key reused with different parameters is NOT a refusal of the
        // original request, which may well have created a session.
        return errorType(exchange.body) === 'idempotency_error'
          ? UNKNOWN
          : { outcome: 'rejected', reason: 'invalid-request' };
      }
      if (exchange.status !== 200) return UNKNOWN;

      const session = checkoutSessionSchema.safeParse(exchange.body);
      if (!session.success) return UNKNOWN;
      const created = session.data;
      const checkoutUrl = checkoutUrlOf(created.url);
      if (
        created.livemode !== livemode ||
        created.status !== 'open' ||
        checkoutUrl === null ||
        created.client_reference_id !== input.donationId ||
        created.currency !== stripeCurrency(input.amount.currency) ||
        created.amount_total?.toString() !== unitAmount
      ) {
        // Something answered, but not with the session this request describes
        // on the origin it must live on: never treat it as created.
        return UNKNOWN;
      }

      return {
        outcome: 'created',
        checkoutReference: created.id,
        checkoutUrl,
        expiresAt: new Date(created.expires_at * 1000),
      };
    },

    async resumeCheckout(checkoutReference): Promise<CheckoutResumption> {
      if (!CHECKOUT_REFERENCE.test(checkoutReference)) return UNKNOWN;
      const retrieved = await retrieveSession(checkoutReference, false);
      if (typeof retrieved === 'string') return UNKNOWN;

      const session = retrieved.found;
      if (session.status === 'complete' || session.status === 'expired') {
        return { outcome: 'closed' };
      }
      if (session.status !== 'open') return UNKNOWN;
      const checkoutUrl = checkoutUrlOf(session.url);
      return checkoutUrl === null ? UNKNOWN : { outcome: 'open', checkoutUrl };
    },

    async cancelCheckout(checkoutReference): Promise<CheckoutCancellation> {
      if (!CHECKOUT_REFERENCE.test(checkoutReference)) return 'unknown';

      const exchange = await stripeExchange(config, {
        method: 'POST',
        path: `/v1/checkout/sessions/${encodeURIComponent(checkoutReference)}/expire`,
      });
      if (!isResponse(exchange)) return 'unknown';

      if (exchange.status === 200) {
        const session = checkoutSessionSchema.safeParse(exchange.body);
        return session.success &&
          session.data.id === checkoutReference &&
          session.data.livemode === livemode &&
          session.data.status === 'expired'
          ? 'cancelled'
          : 'unknown';
      }

      if (exchange.status === 400) {
        // Stripe refuses to expire a session that is not open. Whether that is
        // what happened is read back, never assumed from the refusal.
        const retrieved = await retrieveSession(checkoutReference, false);
        if (typeof retrieved === 'string') return 'unknown';
        const status = retrieved.found.status;
        return status === 'complete' || status === 'expired' ? 'not-open' : 'unknown';
      }
      return 'unknown';
    },

    async observeCheckout(checkoutReference): Promise<PaymentLookup> {
      if (!CHECKOUT_REFERENCE.test(checkoutReference)) return { outcome: 'not-found' };
      const retrieved = await retrieveSession(checkoutReference, true);
      if (retrieved === 'not-found') return { outcome: 'not-found' };
      if (retrieved === 'unknown') return UNKNOWN;

      const session = retrieved.found;
      const currency = domainCurrency(session.currency);
      if (session.status === null || currency === null || session.amount_total === null) {
        return UNKNOWN;
      }
      const amount: ExactMoney = { currency, minor: session.amount_total };

      let payment: ObservedPaymentState = 'none';
      let paymentReference: string | null = null;
      let capturedMinor: bigint | null = null;
      let refundedMinor = 0n;
      let dispute: DonationDispute = 'none';

      const intent = session.payment_intent;
      if (typeof intent === 'string') return UNKNOWN; // asked for expansion, did not get it
      if (intent !== null) {
        if (intent.livemode !== livemode || intent.currency !== session.currency)
          return UNKNOWN;
        paymentReference = intent.id;

        payment =
          intent.status === 'succeeded'
            ? 'succeeded'
            : intent.status === 'processing' || intent.status === 'requires_capture'
              ? 'processing'
              : intent.status === 'requires_action'
                ? 'requires_action'
                : intent.status === 'canceled'
                  ? 'canceled'
                  : intent.status === 'requires_payment_method' &&
                      intent.last_payment_error !== undefined &&
                      intent.last_payment_error !== null
                    ? 'failed'
                    : 'none';

        const charge = intent.latest_charge;
        if (typeof charge === 'string') return UNKNOWN;
        if (charge !== null) {
          if (charge.livemode !== livemode || charge.currency !== session.currency)
            return UNKNOWN;
          refundedMinor = charge.amount_refunded;
          if (charge.disputed) {
            const listed = await disputeOf(intent.id);
            if (listed === null) return UNKNOWN;
            dispute = listed;
          }
        }

        if (payment === 'succeeded') {
          // A succeeded PaymentIntent whose captured charge cannot be read is
          // not a capture anyone can verify.
          if (charge === null || charge.status !== 'succeeded') return UNKNOWN;
          capturedMinor = charge.amount_captured;
        }
      }

      return {
        outcome: 'observed',
        observation: {
          scope,
          checkoutReference: session.id,
          donationReference: session.client_reference_id,
          checkout: session.status,
          payment,
          paymentReference,
          amount,
          capturedMinor,
          refundedMinor,
          dispute,
        },
      };
    },

    verifyWebhook(input) {
      return verifyStripeWebhook(config, scope, input);
    },

    async requestRefund(input): Promise<RefundSubmission> {
      const amountText = stripeAmountText(input.amount);
      if (
        amountText === null ||
        !PAYMENT_REFERENCE.test(input.paymentReference) ||
        !REFERENCE_TEXT.test(input.refundId) ||
        !REFERENCE_TEXT.test(input.donationId) ||
        !IDEMPOTENCY_KEY.test(input.idempotencyKey)
      ) {
        // Refused before anything was sent: nothing can have been refunded.
        return { outcome: 'rejected' };
      }

      const exchange = await stripeExchange(config, {
        method: 'POST',
        path: '/v1/refunds',
        idempotencyKey: input.idempotencyKey,
        form: [
          ['payment_intent', input.paymentReference],
          ['amount', amountText],
          ['metadata[refund]', input.refundId],
          ['metadata[donation]', input.donationId],
        ],
      });

      if (!isResponse(exchange)) return UNKNOWN;
      if (exchange.status === 400 || exchange.status === 402) {
        return errorType(exchange.body) === 'idempotency_error'
          ? UNKNOWN
          : { outcome: 'rejected' };
      }
      if (exchange.status !== 200) return UNKNOWN;

      const refund = refundSchema.safeParse(exchange.body);
      if (!refund.success) return UNKNOWN;
      const observation = refundObservation(refund.data, input.paymentReference);
      if (
        observation === null ||
        observation.refundId !== input.refundId ||
        observation.amount.currency !== input.amount.currency ||
        observation.amount.minor !== input.amount.minor
      ) {
        return UNKNOWN;
      }
      return { outcome: 'accepted', observation };
    },

    async observeRefund(input): Promise<RefundLookup> {
      if (!PAYMENT_REFERENCE.test(input.paymentReference))
        return { outcome: 'not-found' };

      if (input.refundReference !== null) {
        if (!REFUND_REFERENCE.test(input.refundReference))
          return { outcome: 'not-found' };
        const exchange = await stripeExchange(config, {
          method: 'GET',
          path: `/v1/refunds/${encodeURIComponent(input.refundReference)}`,
        });
        if (!isResponse(exchange)) return UNKNOWN;
        if (exchange.status === 404) return { outcome: 'not-found' };
        if (exchange.status !== 200) return UNKNOWN;

        const refund = refundSchema.safeParse(exchange.body);
        if (!refund.success || refund.data.id !== input.refundReference) return UNKNOWN;
        const observation = refundObservation(refund.data, input.paymentReference);
        if (observation === null || observation.refundId !== input.refundId)
          return UNKNOWN;
        return { outcome: 'observed', observation };
      }

      const exchange = await stripeExchange(config, {
        method: 'GET',
        path: '/v1/refunds',
        query: [
          ['payment_intent', input.paymentReference],
          ['limit', '100'],
        ],
      });
      if (!isResponse(exchange) || exchange.status !== 200) return UNKNOWN;
      const list = refundListSchema.safeParse(exchange.body);
      if (!list.success) return UNKNOWN;

      const ours = list.data.data.filter(
        (refund) => refund.metadata['refund'] === input.refundId,
      );
      if (ours.length > 1) return UNKNOWN;
      const [found] = ours;
      if (found === undefined) {
        // Absence is only an answer when the whole list was seen.
        return list.data.has_more ? UNKNOWN : { outcome: 'not-found' };
      }
      const observation = refundObservation(found, input.paymentReference);
      return observation === null ? UNKNOWN : { outcome: 'observed', observation };
    },
  };
}
