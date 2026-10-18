import 'server-only';

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import type {
  PaymentScope,
  ProviderEventNotice,
  ProviderEventSubject,
  WebhookVerification,
} from '@minhaj/contracts/donations';

import type { StripeProviderConfig } from './config.ts';
import {
  CHECKOUT_REFERENCE,
  eventSchema,
  PAYMENT_REFERENCE,
  REFUND_REFERENCE,
  type StripeEvent,
} from './wire.ts';

/**
 * Stripe webhook verification — protocol class B, a machine callback.
 *
 * Implemented from the documented manual-verification procedure
 * (docs.stripe.com/webhooks, "Verify webhook signatures manually"):
 *
 *   `Stripe-Signature: t=<unix seconds>,v1=<hex>[,v1=<hex>…][,v0=<hex>]`
 *   signed_payload = `${t}` + `.` + the EXACT raw request body
 *   expected       = HMAC-SHA256(endpoint secret, signed_payload)
 *
 * and nothing more lenient:
 *   - the signature is checked over the RAW BYTES, BEFORE anything is parsed —
 *     an unsigned body is `invalid-signature` even when it is not JSON;
 *   - only `v1` counts; every other scheme (the test-mode `v0` included) is
 *     ignored, so a downgrade is impossible;
 *   - every `v1` is compared, in constant time, so a rolled secret's two
 *     signatures both verify during the rotation window;
 *   - the timestamp is part of what is signed, and an otherwise valid event
 *     more than 300 seconds from now in EITHER direction is `stale` (the
 *     libraries' documented default tolerance; zero is never used).
 *
 * The verified event is a HINT about which object to re-read, never the truth:
 * nothing in its body is trusted for amount, currency or state, and the body
 * is never kept — only the SHA-256 of the exact bytes, for deduplication.
 */

const STRIPE_WEBHOOK_TOLERANCE_SECONDS = 300;
export const STRIPE_WEBHOOK_MAX_BYTES = 64 * 1024;

/** A header far longer than any real one is refused before it is split. */
const MAX_SIGNATURE_HEADER = 4096;
const MAX_V1_SIGNATURES = 16;

const PAYMENT_EVENTS = new Set([
  'checkout.session.completed',
  'checkout.session.async_payment_succeeded',
  'checkout.session.async_payment_failed',
  'checkout.session.expired',
]);
const PAYMENT_INTENT_EVENTS = new Set([
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.canceled',
]);
const CHARGE_EVENTS = new Set(['charge.succeeded', 'charge.refunded']);
const REFUND_EVENTS = new Set([
  'refund.created',
  'refund.updated',
  'refund.failed',
  'charge.refund.updated',
]);
const DISPUTE_EVENTS = new Set([
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
]);

interface ParsedHeader {
  readonly timestamp: string;
  readonly signatures: readonly Buffer[];
}

/** `null` when the header carries no usable timestamp or no `v1` signature. */
function parseSignatureHeader(header: string): ParsedHeader | null {
  if (header.length > MAX_SIGNATURE_HEADER) return null;

  let timestamp: string | null = null;
  const signatures: Buffer[] = [];

  for (const element of header.split(',')) {
    const separator = element.indexOf('=');
    if (separator <= 0) continue;
    const scheme = element.slice(0, separator).trim();
    const value = element.slice(separator + 1).trim();

    if (scheme === 't') {
      // Exactly one timestamp; a second one is an ambiguity, never a choice.
      if (timestamp !== null || !/^[0-9]{1,12}$/u.test(value)) return null;
      timestamp = value;
    } else if (scheme === 'v1') {
      if (!/^[0-9a-f]{64}$/u.test(value)) continue;
      if (signatures.length >= MAX_V1_SIGNATURES) return null;
      signatures.push(Buffer.from(value, 'hex'));
    }
    // Any other scheme — `v0` included — is ignored by design.
  }

  if (timestamp === null || signatures.length === 0) return null;
  return { timestamp, signatures };
}

function signatureMatches(
  secret: string,
  timestamp: string,
  rawBody: Uint8Array,
  signatures: readonly Buffer[],
): boolean {
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.`, 'utf8')
    .update(rawBody)
    .digest();

  // Every candidate is compared; the result does not depend on which matched.
  let matched = false;
  for (const candidate of signatures) {
    if (candidate.length === expected.length && timingSafeEqual(candidate, expected)) {
      matched = true;
    }
  }
  return matched;
}

function paymentIntentOf(event: StripeEvent): string | null {
  const value = event.data.object.payment_intent;
  const id = typeof value === 'string' ? value : (value?.id ?? null);
  return id !== null && PAYMENT_REFERENCE.test(id) ? id : null;
}

function objectIdOf(event: StripeEvent, pattern: RegExp): string | null {
  const id = event.data.object.id;
  return id !== undefined && pattern.test(id) ? id : null;
}

type Classified =
  | {
      readonly category: ProviderEventNotice['category'];
      readonly subject: ProviderEventSubject;
    }
  | 'malformed';

const NO_SUBJECT: ProviderEventSubject = Object.freeze({
  checkoutReference: null,
  paymentReference: null,
  refundReference: null,
});

function classify(event: StripeEvent): Classified {
  const subject = (patch: Partial<ProviderEventSubject>): ProviderEventSubject => ({
    ...NO_SUBJECT,
    ...patch,
  });

  if (PAYMENT_EVENTS.has(event.type)) {
    const checkoutReference = objectIdOf(event, CHECKOUT_REFERENCE);
    if (checkoutReference === null) return 'malformed';
    return {
      category: 'payment',
      subject: subject({ checkoutReference, paymentReference: paymentIntentOf(event) }),
    };
  }

  if (PAYMENT_INTENT_EVENTS.has(event.type)) {
    const paymentReference = objectIdOf(event, PAYMENT_REFERENCE);
    if (paymentReference === null) return 'malformed';
    return { category: 'payment', subject: subject({ paymentReference }) };
  }

  if (CHARGE_EVENTS.has(event.type) || DISPUTE_EVENTS.has(event.type)) {
    // A charge or dispute with no PaymentIntent was not created by a Checkout
    // Session this platform made; there is nothing of ours to re-read.
    const paymentReference = paymentIntentOf(event);
    if (paymentReference === null) return { category: 'ignored', subject: NO_SUBJECT };
    return {
      category: DISPUTE_EVENTS.has(event.type) ? 'dispute' : 'payment',
      subject: subject({ paymentReference }),
    };
  }

  if (REFUND_EVENTS.has(event.type)) {
    const refundReference = objectIdOf(event, REFUND_REFERENCE);
    if (refundReference === null) return 'malformed';
    return {
      category: 'refund',
      subject: subject({ refundReference, paymentReference: paymentIntentOf(event) }),
    };
  }

  return { category: 'ignored', subject: NO_SUBJECT };
}

/**
 * Verifies and normalises one delivery. Pure: no network, no persistence, no
 * clock but the one passed in.
 */
export function verifyStripeWebhook(
  config: StripeProviderConfig,
  scope: PaymentScope,
  input: {
    readonly rawBody: Uint8Array;
    readonly signature: string | null;
    readonly now: Date;
  },
): WebhookVerification {
  const rejected = (
    reason: Extract<WebhookVerification, { outcome: 'rejected' }>['reason'],
  ) => ({ outcome: 'rejected', reason }) as const;

  if (!(input.rawBody instanceof Uint8Array)) return rejected('malformed');
  // Bounded before any work is spent on it; the route enforces the same cap.
  if (input.rawBody.byteLength > STRIPE_WEBHOOK_MAX_BYTES) return rejected('malformed');

  if (input.signature === null || input.signature.trim() === '') {
    return rejected('missing-signature');
  }

  const header = parseSignatureHeader(input.signature);
  if (header === null) return rejected('invalid-signature');

  if (
    !signatureMatches(
      config.webhookSecret,
      header.timestamp,
      input.rawBody,
      header.signatures,
    )
  ) {
    return rejected('invalid-signature');
  }

  // Freshness is judged only for an AUTHENTIC timestamp, so the answer never
  // tells a forger anything about the clock.
  const nowSeconds = Math.floor(input.now.getTime() / 1000);
  const signedAt = Number.parseInt(header.timestamp, 10);
  if (
    !Number.isFinite(nowSeconds) ||
    Math.abs(nowSeconds - signedAt) > STRIPE_WEBHOOK_TOLERANCE_SECONDS
  ) {
    return rejected('stale');
  }

  // Only now is the body interpreted at all.
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(input.rawBody));
  } catch {
    return rejected('malformed');
  }
  const event = eventSchema.safeParse(parsed);
  if (!event.success) return rejected('malformed');

  // A test-mode event is never production truth, and a live event never
  // reaches a sandbox or fixture instance.
  if (event.data.livemode !== (scope.environment === 'production')) {
    return rejected('wrong-environment');
  }

  const classified = classify(event.data);
  if (classified === 'malformed') return rejected('malformed');

  return {
    outcome: 'verified',
    notice: {
      scope,
      eventId: event.data.id,
      eventType: event.data.type,
      occurredAt: new Date(event.data.created * 1000),
      category: classified.category,
      subject: classified.subject,
      payloadDigest: createHash('sha256').update(input.rawBody).digest('hex'),
    },
  };
}
