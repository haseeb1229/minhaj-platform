import 'server-only';

import { z } from 'zod';

import { minorFromStripe } from './units.ts';

/**
 * The parts of Stripe's objects this adapter reads — and nothing else.
 *
 * Each schema names ONLY the fields a decision depends on; every other field
 * is ignored (and dropped), so an additive change elsewhere in Stripe's schema
 * cannot reach this platform. A field this adapter DOES depend on that is
 * missing, mistyped or carries a value outside its documented vocabulary fails
 * the parse, and the caller answers `unknown` rather than guessing.
 *
 * Field names and vocabularies follow the API reference for the pinned version
 * (docs.stripe.com/api/checkout/sessions/object, /payment_intents/object,
 * /charges/object, /refunds/object, /disputes/object, /events/object).
 */

export const CHECKOUT_REFERENCE = /^cs_[A-Za-z0-9_]{1,250}$/u;
export const PAYMENT_REFERENCE = /^pi_[A-Za-z0-9_]{1,250}$/u;
/** Refund ids are `re_…`; some payment methods' refunds are `pyr_…`. */
export const REFUND_REFERENCE = /^(?:re|pyr)_[A-Za-z0-9_]{1,250}$/u;
export const EVENT_REFERENCE = /^evt_[A-Za-z0-9_]{1,250}$/u;

const amount = z.number().transform((value, context) => {
  const minor = minorFromStripe(value);
  if (minor === null) {
    context.addIssue({ code: 'custom', message: 'not an exact Stripe amount' });
    return z.NEVER;
  }
  return minor;
});

const currency = z.string().regex(/^[a-z]{3}$/u);
const metadata = z.record(z.string(), z.string()).default({});

export const chargeSchema = z.object({
  id: z.string().regex(/^(?:ch|py)_[A-Za-z0-9_]{1,250}$/u),
  object: z.literal('charge'),
  amount_captured: amount,
  amount_refunded: amount,
  currency,
  disputed: z.boolean(),
  livemode: z.boolean(),
  status: z.enum(['succeeded', 'pending', 'failed']),
});
export type StripeCharge = z.infer<typeof chargeSchema>;

export const paymentIntentSchema = z.object({
  id: z.string().regex(PAYMENT_REFERENCE),
  object: z.literal('payment_intent'),
  status: z.enum([
    'requires_payment_method',
    'requires_confirmation',
    'requires_action',
    'processing',
    'requires_capture',
    'canceled',
    'succeeded',
  ]),
  currency,
  livemode: z.boolean(),
  latest_charge: z.union([z.string(), chargeSchema]).nullable(),
  /** Only its presence is read; its contents (decline detail) never are. */
  last_payment_error: z.unknown().optional(),
});
export type StripePaymentIntent = z.infer<typeof paymentIntentSchema>;

export const checkoutSessionSchema = z.object({
  id: z.string().regex(CHECKOUT_REFERENCE),
  object: z.literal('checkout.session'),
  mode: z.literal('payment'),
  livemode: z.boolean(),
  status: z.enum(['open', 'complete', 'expired']).nullable(),
  amount_total: amount.nullable(),
  currency: currency.nullable(),
  client_reference_id: z.string().max(200).nullable(),
  expires_at: z.number().int().positive(),
  url: z.string().max(4096).nullable(),
  payment_intent: z.union([z.string(), paymentIntentSchema]).nullable(),
});
export type StripeCheckoutSession = z.infer<typeof checkoutSessionSchema>;

export const refundSchema = z.object({
  id: z.string().regex(REFUND_REFERENCE),
  object: z.literal('refund'),
  amount,
  currency,
  payment_intent: z.string().nullable(),
  status: z
    .enum(['pending', 'requires_action', 'succeeded', 'failed', 'canceled'])
    .nullable(),
  metadata,
});
export type StripeRefund = z.infer<typeof refundSchema>;

export const refundListSchema = z.object({
  object: z.literal('list'),
  data: z.array(refundSchema).max(100),
  has_more: z.boolean(),
});

const disputeSchema = z.object({
  id: z.string().regex(/^(?:du|dp)_[A-Za-z0-9_]{1,250}$/u),
  object: z.literal('dispute'),
  status: z.enum([
    'warning_needs_response',
    'warning_under_review',
    'warning_closed',
    'needs_response',
    'under_review',
    'won',
    'lost',
    'prevented',
  ]),
});

export const disputeListSchema = z.object({
  object: z.literal('list'),
  data: z.array(disputeSchema).max(100),
  has_more: z.boolean(),
});

/** Only the error TYPE is read; a provider message can echo the request and is never kept. */
export const errorSchema = z.object({
  error: z.object({ type: z.string().max(64) }),
});

/** The event envelope, parsed only AFTER the signature over the raw bytes verified. */
export const eventSchema = z.object({
  id: z.string().regex(EVENT_REFERENCE),
  object: z.literal('event'),
  type: z
    .string()
    .regex(/^[a-z0-9_]+(?:\.[a-z0-9_]+){1,4}$/u)
    .max(64),
  created: z.number().int().positive(),
  livemode: z.boolean(),
  data: z.object({
    object: z.object({
      id: z.string().max(255).optional(),
      payment_intent: z
        .union([z.string().max(255), z.object({ id: z.string().max(255) })])
        .nullable()
        .optional(),
    }),
  }),
});
export type StripeEvent = z.infer<typeof eventSchema>;
