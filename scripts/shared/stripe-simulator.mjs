/**
 * A deterministic local simulator of the Stripe protocol subset the Donations
 * payment adapter speaks (Phase 27).
 *
 * Shared by the protocol proofs (`tests/donations/`), and the browser suite's
 * server, so there is ONE local stand-in for the provider and it behaves the
 * way the official API reference says Stripe behaves:
 *
 *   POST /v1/checkout/sessions              create (form-encoded, Idempotency-Key)
 *   GET  /v1/checkout/sessions/:id          retrieve (expand[]=payment_intent,
 *                                           expand[]=payment_intent.latest_charge)
 *   POST /v1/checkout/sessions/:id/expire   expire an OPEN session (400 otherwise)
 *   POST /v1/refunds                        refund a PaymentIntent (Idempotency-Key)
 *   GET  /v1/refunds/:id, GET /v1/refunds?payment_intent=…&limit=…
 *   GET  /v1/disputes?payment_intent=…&limit=…
 *   GET  /c/pay/:id                         the hosted page: Pay / Decline / Cancel
 *
 * Protocol fidelity that matters to the adapter: `Authorization: Bearer` with
 * the configured key (401 otherwise); idempotency keys that replay the SAVED
 * response for the same parameters — 5xx included — and answer 400
 * `idempotency_error` for different ones, 409 while the first is in flight,
 * and save nothing for a request that failed validation; Stripe-shaped JSON
 * with `livemode: false`; webhooks signed `t=…,v1=HMAC-SHA256(secret,
 * "t.body")` plus a decoy `v0`, exactly as test-mode deliveries are.
 *
 * DETERMINISTIC BEHAVIOUR, CONTROLLED BY THE TEST. Nothing happens on a timer.
 * Sessions expire when the (offsettable) clock passes `expires_at` and they
 * are next read; webhooks go out in the order events occur, one at a time,
 * unless a test holds, drops, reorders or duplicates them; faults (a status,
 * a hang, an oversized or garbage body, a tampered response) are injected per
 * endpoint and consumed in order.
 *
 * SYNTHETIC CREDENTIALS ONLY. It refuses to start with anything but an
 * `sk_fixture_…` key and a `whsec_fixture_…` secret, listens on 127.0.0.1
 * only, and delivers webhooks to a loopback URL only.
 *
 * Plain ESM JavaScript with no dependencies, so the browser server can start it
 * without a TypeScript loader.
 */

import { createHmac, randomBytes } from 'node:crypto';
import { createServer, request as httpRequest } from 'node:http';
import { setTimeout as pause } from 'node:timers/promises';
import { URLSearchParams } from 'node:url';

/** The version the adapter pins; echoed on every event. */
export const SIMULATOR_API_VERSION = '2026-09-30.endive';

const MAX_REQUEST_BYTES = 1024 * 1024;
const OVERSIZE_BYTES = 2 * 1024 * 1024;
const WEBHOOK_TIMEOUT_MS = 15_000;
const THREE_DECIMAL = new Set(['bhd', 'jod', 'kwd', 'omr', 'tnd']);
const ZERO_DECIMAL = new Set(['jpy', 'krw']);
const LOOPBACK_URL =
  /^http:\/\/(?:127\.0\.0\.1|localhost):[1-9][0-9]{0,4}(?:\/[^\s]*)?$/u;
const SUBMIT_TYPES = new Set(['auto', 'book', 'donate', 'pay', 'subscribe']);
const DISPUTE_STATUSES = new Set([
  'warning_needs_response',
  'warning_under_review',
  'warning_closed',
  'needs_response',
  'under_review',
  'won',
  'lost',
  'prevented',
]);
const DISPUTE_CLOSED = new Set(['won', 'lost', 'warning_closed', 'prevented']);

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomTag(length) {
  return [...randomBytes(length)]
    .map((byte) => ALPHABET[byte % ALPHABET.length])
    .join('');
}

/** A client-side validation failure: 400, and NOT saved under an idempotency key. */
class ValidationFailure extends Error {
  constructor(message, status = 400, code = 'parameter_invalid') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function stripeError(type, message, code = undefined) {
  return { error: { type, message, ...(code === undefined ? {} : { code }) } };
}

/** JSON with `bigint` amounts written as JSON integers (all within twelve digits). */
function toJson(value) {
  return JSON.stringify(value, (key, item) => {
    if (key.startsWith('_')) return undefined;
    if (typeof item === 'bigint') {
      if (item > BigInt(Number.MAX_SAFE_INTEGER))
        throw new RangeError('amount out of range');
      return Number(item);
    }
    return item;
  });
}

function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatAmount(minor, currency) {
  const exponent = ZERO_DECIMAL.has(currency) ? 0 : THREE_DECIMAL.has(currency) ? 3 : 2;
  if (exponent === 0) return `${minor.toString()} ${currency.toUpperCase()}`;
  const scale = 10n ** BigInt(exponent);
  return `${(minor / scale).toString()}.${(minor % scale)
    .toString()
    .padStart(exponent, '0')} ${currency.toUpperCase()}`;
}

function parseAmount(text, field) {
  if (typeof text !== 'string' || !/^[1-9][0-9]{0,11}$/u.test(text)) {
    throw new ValidationFailure(`Invalid integer: ${field}`);
  }
  return BigInt(text);
}

async function readBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) throw new ValidationFailure('Request too large', 413);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Starts a simulator on 127.0.0.1 and a random port.
 *
 * @param {{
 *   webhookUrl?: string | null,
 *   webhookSecret: string,
 *   secretKey: string,
 *   accountKey: string,
 * }} options
 */
export async function startStripeSimulator(options) {
  const { webhookUrl = null, webhookSecret, secretKey, accountKey } = options ?? {};
  if (
    typeof secretKey !== 'string' ||
    !/^sk_fixture_[A-Za-z0-9_]{8,200}$/u.test(secretKey)
  ) {
    throw new Error('The Stripe simulator takes a synthetic sk_fixture_ key only.');
  }
  if (
    typeof webhookSecret !== 'string' ||
    !/^whsec_fixture_[A-Za-z0-9_]{8,200}$/u.test(webhookSecret)
  ) {
    throw new Error('The Stripe simulator takes a synthetic whsec_fixture_ secret only.');
  }
  if (typeof accountKey !== 'string' || !/^[A-Za-z0-9_-]{3,64}$/u.test(accountKey)) {
    throw new Error('The Stripe simulator needs a non-secret account key.');
  }
  if (
    webhookUrl !== null &&
    (typeof webhookUrl !== 'string' || !LOOPBACK_URL.test(webhookUrl))
  ) {
    throw new Error('The Stripe simulator delivers webhooks to a loopback URL only.');
  }

  const run = randomTag(8);
  let sequence = 0;
  const newId = (prefix) =>
    `${prefix}_${run}${String((sequence += 1)).padStart(16, '0')}`;

  let clockOffsetSeconds = 0;
  const now = () => Math.floor(Date.now() / 1000) + clockOffsetSeconds;

  const sessions = new Map();
  const intents = new Map();
  const charges = new Map();
  const refunds = new Map();
  const disputes = new Map();
  const idempotency = new Map();
  const faults = new Map();
  const requestLog = [];
  const events = [];
  const deliveries = [];
  const held = [];
  const sockets = new Set();

  let webhookMode = 'deliver';
  let webhookDelayMs = 0;
  let refundBehaviour = 'succeeded';
  let deliveryChain = Promise.resolve();

  /* ------------------------------------------------------------------ webhooks */

  function sign(body, timestamp, secret = webhookSecret) {
    const bytes =
      typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
    const v1 = createHmac('sha256', secret)
      .update(`${timestamp}.`, 'utf8')
      .update(bytes)
      .digest('hex');
    // Test-mode deliveries carry a decoy `v0`, which a correct verifier ignores.
    const v0 = createHmac('sha256', 'v0-decoy-not-a-signature')
      .update(`${timestamp}.`, 'utf8')
      .update(bytes)
      .digest('hex');
    return `t=${timestamp},v1=${v1},v0=${v0}`;
  }

  function post(body, signature) {
    return new Promise((resolve) => {
      const target = new URL(webhookUrl);
      const outgoing = httpRequest(
        {
          hostname: target.hostname,
          port: target.port,
          path: `${target.pathname}${target.search}`,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Content-Length': Buffer.byteLength(body),
            'Stripe-Signature': signature,
            'User-Agent':
              'Stripe/1.0 (+https://stripe.com/docs/webhooks) fixture-simulator',
          },
          timeout: WEBHOOK_TIMEOUT_MS,
        },
        (response) => {
          response.resume();
          response.on('end', () => resolve(response.statusCode ?? 0));
        },
      );
      outgoing.on('timeout', () => outgoing.destroy(new Error('timeout')));
      outgoing.on('error', () => resolve('error'));
      outgoing.end(body);
    });
  }

  async function deliverNow(event) {
    if (webhookUrl === null) {
      deliveries.push({ eventId: event.id, type: event.type, status: 'no-endpoint' });
      return 'no-endpoint';
    }
    if (webhookDelayMs > 0) await pause(webhookDelayMs);
    const body = toJson(event);
    const status = await post(body, sign(body, Math.floor(Date.now() / 1000)));
    deliveries.push({ eventId: event.id, type: event.type, status });
    return status;
  }

  function enqueue(event) {
    if (webhookMode === 'hold') {
      held.push(event);
      return;
    }
    if (webhookMode === 'drop') {
      deliveries.push({ eventId: event.id, type: event.type, status: 'dropped' });
      return;
    }
    deliveryChain = deliveryChain
      .then(() => deliverNow(event))
      .then(
        () => undefined,
        () => undefined,
      );
  }

  /** Records an event whose `data.object` is a snapshot of the object NOW. */
  function emit(type, object) {
    const event = {
      id: newId('evt'),
      object: 'event',
      api_version: SIMULATOR_API_VERSION,
      created: now(),
      data: { object: JSON.parse(toJson(object)) },
      livemode: false,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type,
    };
    events.push(event);
    enqueue(event);
    return event;
  }

  /* --------------------------------------------------------------- the objects */

  function expireIfDue(session) {
    if (session.status === 'open' && now() >= session.expires_at) {
      expireSession(session);
    }
  }

  function findSession(id) {
    const session = sessions.get(id);
    if (session !== undefined) expireIfDue(session);
    return session;
  }

  function requireSession(id) {
    const session = findSession(id);
    if (session === undefined) throw new Error(`No such checkout session: ${id}`);
    return session;
  }

  function expireSession(session) {
    session.status = 'expired';
    session.url = null;
    const intent =
      session.payment_intent === null ? undefined : intents.get(session.payment_intent);
    if (intent !== undefined && intent.status !== 'succeeded') intent.status = 'canceled';
    emit('checkout.session.expired', session);
  }

  function intentFor(session) {
    if (session.payment_intent !== null) return intents.get(session.payment_intent);
    const intent = {
      id: newId('pi'),
      object: 'payment_intent',
      amount: session.amount_total,
      amount_received: 0n,
      currency: session.currency,
      created: now(),
      latest_charge: null,
      last_payment_error: null,
      livemode: false,
      metadata: { ...session._intentMetadata },
      status: 'requires_payment_method',
    };
    intents.set(intent.id, intent);
    session.payment_intent = intent.id;
    return intent;
  }

  function newCharge(intent, status) {
    const charge = {
      id: newId('ch'),
      object: 'charge',
      amount: intent.amount,
      amount_captured: status === 'succeeded' ? intent.amount : 0n,
      amount_refunded: 0n,
      captured: status === 'succeeded',
      created: now(),
      currency: intent.currency,
      disputed: false,
      livemode: false,
      payment_intent: intent.id,
      refunded: false,
      status,
    };
    charges.set(charge.id, charge);
    intent.latest_charge = charge.id;
    return charge;
  }

  function succeed(session, intent) {
    intent.status = 'succeeded';
    intent.amount_received = intent.amount;
    intent.last_payment_error = null;
    const existing =
      intent.latest_charge === null ? undefined : charges.get(intent.latest_charge);
    const charge =
      existing !== undefined && existing.status === 'pending'
        ? existing
        : newCharge(intent, 'succeeded');
    charge.status = 'succeeded';
    charge.captured = true;
    charge.amount_captured = intent.amount;
    session.payment_status = 'paid';
    return charge;
  }

  function complete(sessionId, { outcome = 'paid' } = {}) {
    const session = requireSession(sessionId);
    if (session.status !== 'open')
      throw new Error('Only an open checkout session can complete.');
    const intent = intentFor(session);
    session.status = 'complete';
    session.url = null;

    if (outcome === 'processing') {
      intent.status = 'processing';
      newCharge(intent, 'pending');
      emit('checkout.session.completed', session);
      return session.id;
    }
    if (outcome !== 'paid') throw new Error(`Unknown completion outcome: ${outcome}`);

    const charge = succeed(session, intent);
    emit('checkout.session.completed', session);
    emit('payment_intent.succeeded', intent);
    emit('charge.succeeded', charge);
    return session.id;
  }

  function settleAsync(sessionId, result) {
    const session = requireSession(sessionId);
    const intent =
      session.payment_intent === null ? undefined : intents.get(session.payment_intent);
    if (
      session.status !== 'complete' ||
      intent === undefined ||
      intent.status !== 'processing'
    ) {
      throw new Error('Only a processing payment can settle.');
    }
    if (result === 'succeeded') {
      const charge = succeed(session, intent);
      emit('checkout.session.async_payment_succeeded', session);
      emit('payment_intent.succeeded', intent);
      emit('charge.succeeded', charge);
      return;
    }
    if (result !== 'failed') throw new Error(`Unknown settlement: ${result}`);
    intent.status = 'requires_payment_method';
    intent.last_payment_error = { type: 'card_error', code: 'payment_failed' };
    const charge = charges.get(intent.latest_charge);
    if (charge !== undefined) charge.status = 'failed';
    emit('checkout.session.async_payment_failed', session);
    emit('payment_intent.payment_failed', intent);
  }

  function decline(sessionId) {
    const session = requireSession(sessionId);
    if (session.status !== 'open')
      throw new Error('Only an open checkout session can decline.');
    const intent = intentFor(session);
    intent.status = 'requires_payment_method';
    intent.last_payment_error = { type: 'card_error', code: 'card_declined' };
    newCharge(intent, 'failed');
    emit('payment_intent.payment_failed', intent);
  }

  function succeededChargeOf(intentId) {
    const intent = intents.get(intentId);
    if (intent === undefined || intent.status !== 'succeeded') return undefined;
    return charges.get(intent.latest_charge);
  }

  function chargeOfSession(sessionId) {
    const session = requireSession(sessionId);
    const charge =
      session.payment_intent === null
        ? undefined
        : succeededChargeOf(session.payment_intent);
    if (charge === undefined) throw new Error('The session has no captured charge.');
    return charge;
  }

  function createRefund(intentId, amount, metadata, status) {
    const charge = succeededChargeOf(intentId);
    if (charge === undefined) {
      throw new ValidationFailure('This PaymentIntent has no captured charge to refund.');
    }
    const remaining = charge.amount_captured - charge.amount_refunded;
    const value = amount ?? remaining;
    if (value <= 0n || value > remaining) {
      throw new ValidationFailure(
        'Refund amount is greater than the unrefunded amount on the charge.',
        400,
        'amount_too_large',
      );
    }
    if (THREE_DECIMAL.has(charge.currency) && value % 10n !== 0n) {
      throw new ValidationFailure('Three-decimal amounts must end in 0.');
    }
    const refund = {
      id: newId('re'),
      object: 'refund',
      amount: value,
      charge: charge.id,
      created: now(),
      currency: charge.currency,
      metadata,
      payment_intent: intentId,
      reason: null,
      status,
    };
    refunds.set(refund.id, refund);
    charge.amount_refunded += value;
    charge.refunded = charge.amount_refunded === charge.amount_captured;
    emit('refund.created', refund);
    emit('charge.refunded', charge);
    return refund;
  }

  function settleRefund(refundId, result) {
    const refund = refunds.get(refundId);
    if (refund === undefined || refund.status !== 'pending') {
      throw new Error('Only a pending refund can settle.');
    }
    if (result === 'succeeded') {
      refund.status = 'succeeded';
      emit('refund.updated', refund);
      return;
    }
    if (result !== 'failed') throw new Error(`Unknown refund settlement: ${result}`);
    refund.status = 'failed';
    const charge = charges.get(refund.charge);
    charge.amount_refunded -= refund.amount;
    charge.refunded = false;
    emit('refund.updated', refund);
    emit('refund.failed', refund);
  }

  function dispute(sessionId, { status = 'needs_response' } = {}) {
    if (!DISPUTE_STATUSES.has(status))
      throw new Error(`Unknown dispute status: ${status}`);
    const charge = chargeOfSession(sessionId);
    const record = {
      id: newId('du'),
      object: 'dispute',
      amount: charge.amount_captured,
      charge: charge.id,
      created: now(),
      currency: charge.currency,
      livemode: false,
      payment_intent: charge.payment_intent,
      status,
    };
    disputes.set(record.id, record);
    charge.disputed = true;
    emit('charge.dispute.created', record);
    return record.id;
  }

  function updateDispute(disputeId, status) {
    const record = disputes.get(disputeId);
    if (record === undefined) throw new Error(`No such dispute: ${disputeId}`);
    if (!DISPUTE_STATUSES.has(status))
      throw new Error(`Unknown dispute status: ${status}`);
    record.status = status;
    if (status === 'lost') emit('charge.dispute.funds_withdrawn', record);
    emit(
      DISPUTE_CLOSED.has(status) ? 'charge.dispute.closed' : 'charge.dispute.updated',
      record,
    );
  }

  /* -------------------------------------------------------------- the API */

  function expanded(session, expand) {
    const wire = JSON.parse(toJson(session));
    if (!expand.includes('payment_intent') || session.payment_intent === null)
      return wire;
    const intent = JSON.parse(toJson(intents.get(session.payment_intent)));
    if (
      expand.includes('payment_intent.latest_charge') &&
      intent.latest_charge !== null
    ) {
      intent.latest_charge = JSON.parse(toJson(charges.get(intent.latest_charge)));
    }
    wire.payment_intent = intent;
    return wire;
  }

  function notFound(kind, id) {
    return {
      status: 404,
      body: stripeError(
        'invalid_request_error',
        `No such ${kind}: '${id}'`,
        'resource_missing',
      ),
    };
  }

  function list(data, limit, url) {
    const bounded = Math.min(Math.max(Number.parseInt(limit ?? '10', 10) || 10, 1), 100);
    return {
      status: 200,
      body: {
        object: 'list',
        data: data.slice(0, bounded),
        has_more: data.length > bounded,
        url,
      },
    };
  }

  function createSession(params) {
    if (params.get('mode') !== 'payment') throw new ValidationFailure('Invalid mode');
    if (params.get('line_items[0][quantity]') !== '1') {
      throw new ValidationFailure('Invalid line_items[0][quantity]');
    }
    const currency = params.get('line_items[0][price_data][currency]');
    if (currency === null || !/^[a-z]{3}$/u.test(currency)) {
      throw new ValidationFailure('Invalid currency');
    }
    const unitAmount = parseAmount(
      params.get('line_items[0][price_data][unit_amount]'),
      'line_items[0][price_data][unit_amount]',
    );
    if (THREE_DECIMAL.has(currency) && unitAmount % 10n !== 0n) {
      throw new ValidationFailure('Three-decimal amounts must end in 0.');
    }
    const name = params.get('line_items[0][price_data][product_data][name]');
    if (name === null || name.trim() === '')
      throw new ValidationFailure('Missing product name');
    const successUrl = params.get('success_url');
    const cancelUrl = params.get('cancel_url');
    for (const [field, value] of [
      ['success_url', successUrl],
      ['cancel_url', cancelUrl],
    ]) {
      if (value === null) {
        if (field === 'success_url') throw new ValidationFailure('Missing success_url');
        continue;
      }
      let parsed;
      try {
        parsed = new URL(value);
      } catch {
        throw new ValidationFailure(`Invalid URL: ${field}`);
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new ValidationFailure(`Invalid URL: ${field}`);
      }
    }
    const created = now();
    const expiresText = params.get('expires_at');
    const expiresAt =
      expiresText === null ? created + 86_400 : Number.parseInt(expiresText, 10);
    if (
      (expiresText !== null && !/^[0-9]{1,12}$/u.test(expiresText)) ||
      expiresAt < created + 1800 ||
      expiresAt > created + 86_400
    ) {
      throw new ValidationFailure(
        'The `expires_at` timestamp must be between 30 minutes and 24 hours from now.',
      );
    }
    const clientReference = params.get('client_reference_id');
    if (clientReference !== null && clientReference.length > 200) {
      throw new ValidationFailure('client_reference_id is too long');
    }
    const submitType = params.get('submit_type');
    if (submitType !== null && !SUBMIT_TYPES.has(submitType)) {
      throw new ValidationFailure('Invalid submit_type');
    }

    const metadata = {};
    const intentMetadata = {};
    for (const [key, value] of params) {
      const own = /^metadata\[([^[\]]{1,40})\]$/u.exec(key);
      if (own !== null) metadata[own[1]] = value;
      const forIntent = /^payment_intent_data\[metadata\]\[([^[\]]{1,40})\]$/u.exec(key);
      if (forIntent !== null) intentMetadata[forIntent[1]] = value;
    }

    const id = `cs_test_${run}${String((sequence += 1)).padStart(16, '0')}`;
    const session = {
      id,
      object: 'checkout.session',
      amount_subtotal: unitAmount,
      amount_total: unitAmount,
      cancel_url: cancelUrl,
      client_reference_id: clientReference,
      created,
      currency,
      expires_at: expiresAt,
      livemode: false,
      metadata,
      mode: 'payment',
      payment_intent: null,
      payment_status: 'unpaid',
      status: 'open',
      submit_type: submitType,
      success_url: successUrl,
      ui_mode: 'hosted_page',
      url: `${origin}/c/pay/${id}`,
      _productName: name,
      _intentMetadata: intentMetadata,
    };
    sessions.set(id, session);
    return { status: 200, body: JSON.parse(toJson(session)) };
  }

  function routeOf(method, pathname) {
    const parts = pathname.split('/').filter((part) => part !== '');
    if (parts[0] === 'v1') {
      if (parts[1] === 'checkout' && parts[2] === 'sessions') {
        if (parts.length === 3 && method === 'POST')
          return { route: 'POST /v1/checkout/sessions' };
        if (parts.length === 4 && method === 'GET') {
          return { route: 'GET /v1/checkout/sessions/:id', id: parts[3] };
        }
        if (parts.length === 5 && parts[4] === 'expire' && method === 'POST') {
          return { route: 'POST /v1/checkout/sessions/:id/expire', id: parts[3] };
        }
      }
      if (parts[1] === 'refunds') {
        if (parts.length === 2 && method === 'POST') return { route: 'POST /v1/refunds' };
        if (parts.length === 2 && method === 'GET') return { route: 'GET /v1/refunds' };
        if (parts.length === 3 && method === 'GET')
          return { route: 'GET /v1/refunds/:id', id: parts[2] };
      }
      if (parts[1] === 'disputes' && parts.length === 2 && method === 'GET') {
        return { route: 'GET /v1/disputes' };
      }
      return { route: 'unknown-api' };
    }
    if (
      parts[0] === 'c' &&
      parts[1] === 'pay' &&
      parts.length === 3 &&
      method === 'GET'
    ) {
      return { route: 'GET /c/pay/:id', id: parts[2] };
    }
    if (
      parts[0] === 'c' &&
      parts[1] === 'pay' &&
      parts.length === 4 &&
      method === 'POST'
    ) {
      return { route: `POST /c/pay/:id/${parts[3]}`, id: parts[2], action: parts[3] };
    }
    return { route: 'unknown' };
  }

  function perform(route, id, params, query) {
    switch (route) {
      case 'POST /v1/checkout/sessions':
        return createSession(params);
      case 'GET /v1/checkout/sessions/:id': {
        const session = findSession(id);
        if (session === undefined) return notFound('checkout.session', id);
        return { status: 200, body: expanded(session, query.getAll('expand[]')) };
      }
      case 'POST /v1/checkout/sessions/:id/expire': {
        const session = findSession(id);
        if (session === undefined) return notFound('checkout.session', id);
        if (session.status !== 'open') {
          throw new ValidationFailure(
            'Only Checkout Sessions with a status in ["open"] can be expired.',
            400,
            'checkout_session_not_open',
          );
        }
        expireSession(session);
        return { status: 200, body: JSON.parse(toJson(session)) };
      }
      case 'POST /v1/refunds': {
        const intentId = params.get('payment_intent');
        if (intentId === null || !intents.has(intentId)) {
          throw new ValidationFailure(
            `No such payment_intent: '${intentId}'`,
            400,
            'resource_missing',
          );
        }
        const amountText = params.get('amount');
        const amount = amountText === null ? null : parseAmount(amountText, 'amount');
        const metadata = {};
        for (const [key, value] of params) {
          const match = /^metadata\[([^[\]]{1,40})\]$/u.exec(key);
          if (match !== null) metadata[match[1]] = value;
        }
        const refund = createRefund(intentId, amount, metadata, refundBehaviour);
        return { status: 200, body: JSON.parse(toJson(refund)) };
      }
      case 'GET /v1/refunds/:id': {
        const refund = refunds.get(id);
        if (refund === undefined) return notFound('refund', id);
        return { status: 200, body: JSON.parse(toJson(refund)) };
      }
      case 'GET /v1/refunds': {
        const intentId = query.get('payment_intent');
        const data = [...refunds.values()]
          .filter((refund) => intentId === null || refund.payment_intent === intentId)
          .reverse()
          .map((refund) => JSON.parse(toJson(refund)));
        return list(data, query.get('limit'), '/v1/refunds');
      }
      case 'GET /v1/disputes': {
        const intentId = query.get('payment_intent');
        const data = [...disputes.values()]
          .filter((record) => intentId === null || record.payment_intent === intentId)
          .reverse()
          .map((record) => JSON.parse(toJson(record)));
        return list(data, query.get('limit'), '/v1/disputes');
      }
      default:
        return notFound('route', route);
    }
  }

  function canonical(route, params) {
    return `${route}\n${[...params.entries()]
      .map(([key, value]) => `${key}=${value}`)
      .sort()
      .join('&')}`;
  }

  function send(response, status, body, contentType = 'application/json') {
    if (response.writableEnded || response.destroyed) return;
    const payload = typeof body === 'string' ? body : toJson(body);
    response.writeHead(status, {
      'Content-Type': contentType,
      'Content-Length': Buffer.byteLength(payload),
      'Cache-Control': 'no-store',
    });
    response.end(payload);
  }

  function takeFault(route) {
    const queue = faults.get(route);
    if (queue === undefined || queue.length === 0) return null;
    const fault = queue[0];
    fault.remaining -= 1;
    if (fault.remaining <= 0) queue.shift();
    return fault;
  }

  async function handleApi(request, response, url, routed) {
    const authorization = request.headers['authorization'];
    if (authorization !== `Bearer ${secretKey}`) {
      send(
        response,
        401,
        stripeError('invalid_request_error', 'Invalid API Key provided'),
      );
      return;
    }

    const raw = request.method === 'POST' ? await readBody(request) : '';
    const params = new URLSearchParams(raw);
    const idempotencyKey =
      request.method === 'POST' ? (request.headers['idempotency-key'] ?? null) : null;
    const logEntry = {
      method: request.method,
      route: routed.route,
      idempotencyKey,
      stripeVersion: request.headers['stripe-version'] ?? null,
      replayed: false,
    };
    requestLog.push(logEntry);

    const fault = takeFault(routed.route);
    if (fault?.kind === 'hang' && fault.commit !== true) return; // never answered, never performed
    if (fault?.kind === 'status' && fault.commit !== true) {
      send(
        response,
        fault.status,
        stripeError('api_error', 'Simulated provider failure'),
      );
      return;
    }
    if (fault?.kind === 'oversize') {
      send(response, 200, `{"padding":"${'x'.repeat(OVERSIZE_BYTES)}"}`);
      return;
    }
    if (fault?.kind === 'garbage') {
      send(response, 200, '<html>not json</html>', 'text/html');
      return;
    }

    let entry = null;
    if (idempotencyKey !== null) {
      const fingerprint = canonical(routed.route, params);
      const existing = idempotency.get(idempotencyKey);
      if (existing !== undefined) {
        if (existing.fingerprint !== fingerprint) {
          send(
            response,
            400,
            stripeError(
              'idempotency_error',
              'Keys for idempotent requests can only be used with the same parameters they were first used with.',
            ),
          );
          return;
        }
        if (existing.saved === null) {
          send(
            response,
            409,
            stripeError(
              'idempotency_error',
              'There is currently another in-progress request using this Idempotent Key.',
            ),
          );
          return;
        }
        logEntry.replayed = true;
        send(response, existing.saved.status, existing.saved.body);
        return;
      }
      entry = { fingerprint, saved: null };
      idempotency.set(idempotencyKey, entry);
    }

    // A slow provider: the key is already in flight, so a concurrent request
    // under it meets the 409 conflict Stripe documents.
    if (fault?.kind === 'delay') await pause(fault.ms ?? 0);

    let result;
    try {
      result = perform(routed.route, routed.id, params, url.searchParams);
    } catch (error) {
      // A request that failed validation never began executing; nothing is saved.
      if (idempotencyKey !== null) idempotency.delete(idempotencyKey);
      if (!(error instanceof ValidationFailure)) throw error;
      send(
        response,
        error.status,
        stripeError('invalid_request_error', error.message, error.code),
      );
      return;
    }

    const status = fault?.kind === 'status' ? fault.status : result.status;
    const body =
      fault?.kind === 'status'
        ? stripeError('api_error', 'Simulated provider failure')
        : result.body;
    // Stripe saves the outcome once execution began — a 5xx included.
    if (entry !== null) entry.saved = { status, body: toJson(body) };

    if (fault?.kind === 'hang') return; // performed, saved, never answered
    if (fault?.kind === 'tamper') {
      send(response, status, fault.mutate(JSON.parse(toJson(body))));
      return;
    }
    send(response, status, body);
  }

  function hostedPage(session, notice = '') {
    const open = session.status === 'open';
    const action = (name) => `/c/pay/${encodeURIComponent(session.id)}/${name}`;
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Fixture checkout</title>
</head>
<body>
<main>
<p><strong>Simulated payment page.</strong> No real payment is taken here.</p>
<h1>Fixture checkout</h1>
<p data-testid="product">${escapeHtml(session._productName)}</p>
<p data-testid="amount">${escapeHtml(formatAmount(session.amount_total, session.currency))}</p>
<p data-testid="status">Status: ${escapeHtml(session.status)}</p>
${notice === '' ? '' : `<p role="alert">${escapeHtml(notice)}</p>`}
${
  open
    ? `<form method="post" action="${action('pay')}"><button type="submit">Pay</button></form>
<form method="post" action="${action('decline')}"><button type="submit">Decline</button></form>
<form method="post" action="${action('cancel')}"><button type="submit">Cancel and return</button></form>`
    : '<p>This checkout is no longer open.</p>'
}
</main>
</body>
</html>`;
  }

  function redirect(response, location) {
    response.writeHead(303, { Location: location, 'Cache-Control': 'no-store' });
    response.end();
  }

  async function handleHosted(request, response, routed) {
    if (request.method === 'POST') await readBody(request);
    const session = findSession(routed.id);
    if (session === undefined) {
      send(
        response,
        404,
        '<!doctype html><title>Not found</title><p>No such checkout.</p>',
        'text/html; charset=utf-8',
      );
      return;
    }
    if (routed.route === 'GET /c/pay/:id') {
      send(response, 200, hostedPage(session), 'text/html; charset=utf-8');
      return;
    }
    if (session.status !== 'open') {
      send(response, 409, hostedPage(session), 'text/html; charset=utf-8');
      return;
    }
    if (routed.action === 'pay') {
      complete(session.id, { outcome: 'paid' });
      // The redirect follows delivery, so a proof sees a deterministic order.
      await deliveryChain;
      redirect(response, session.success_url);
      return;
    }
    if (routed.action === 'decline') {
      decline(session.id);
      await deliveryChain;
      send(
        response,
        200,
        hostedPage(session, 'Your card was declined. No payment was taken.'),
        'text/html; charset=utf-8',
      );
      return;
    }
    if (routed.action === 'cancel') {
      redirect(response, session.cancel_url ?? session.success_url);
      return;
    }
    send(
      response,
      404,
      '<!doctype html><title>Not found</title>',
      'text/html; charset=utf-8',
    );
  }

  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const routed = routeOf(request.method ?? 'GET', url.pathname);
    const handler =
      routed.route.startsWith('GET /c/') || routed.route.startsWith('POST /c/')
        ? handleHosted(request, response, routed)
        : routed.route === 'unknown'
          ? Promise.resolve(
              send(
                response,
                404,
                stripeError('invalid_request_error', 'Unrecognized request URL'),
              ),
            )
          : handleApi(request, response, url, routed);
    handler.catch((error) => {
      const status = error instanceof ValidationFailure ? error.status : 500;
      send(response, status, stripeError('api_error', 'Simulator failure'));
    });
  });
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  /* -------------------------------------------------------------- controls */

  const snapshot = (map, id) => {
    const value = map.get(id);
    return value === undefined ? undefined : JSON.parse(toJson(value));
  };

  const control = Object.freeze({
    accountKey,
    /** Completes an open session as the hosted page's Pay does (`paid`) or asynchronously (`processing`). */
    complete: (sessionId, completion) => complete(sessionId, completion),
    /** Settles an asynchronous payment: `succeeded` | `failed`. */
    settleAsync,
    /** A declined card: the session stays open; the PaymentIntent records the failure. */
    decline,
    /** Expires an open session as time passing would. */
    expire: (sessionId) => {
      const session = requireSession(sessionId);
      if (session.status !== 'open') throw new Error('Only an open session can expire.');
      expireSession(session);
    },
    /** Opens a dispute on a session's captured charge; returns its id. */
    dispute,
    updateDispute,
    /** How the API answers a new refund: `succeeded` (Stripe's usual card answer) or `pending`. */
    setRefundBehaviour: (behaviour) => {
      if (behaviour !== 'succeeded' && behaviour !== 'pending')
        throw new Error('Unknown behaviour');
      refundBehaviour = behaviour;
    },
    settleRefund,
    /** A refund made outside the platform (dashboard): no metadata. */
    refundExternally: (sessionId, amountMinor) => {
      const charge = chargeOfSession(sessionId);
      return createRefund(charge.payment_intent, BigInt(amountMinor), {}, 'succeeded').id;
    },
    /** Moves the simulator's object clock (expiry), never the webhook signing time. */
    advanceClock: (seconds) => {
      clockOffsetSeconds += seconds;
    },
    /**
     * Injects a fault into the next `times` requests of one route, e.g.
     * `'POST /v1/checkout/sessions'`. Kinds: `status` (with `status`, and
     * `commit` to perform the operation first), `hang` (with `commit`),
     * `oversize`, `garbage`, `delay` (with `ms`), `tamper` (with `mutate`).
     */
    inject: (route, fault) => {
      const queue = faults.get(route) ?? [];
      queue.push({ ...fault, remaining: fault.times ?? 1 });
      faults.set(route, queue);
    },
    clearFaults: () => faults.clear(),
    /** `deliver` (default), `hold` (queue for release) or `drop`. */
    setWebhookMode: (mode) => {
      if (!['deliver', 'hold', 'drop'].includes(mode))
        throw new Error('Unknown webhook mode');
      webhookMode = mode;
    },
    setWebhookDelay: (ms) => {
      webhookDelayMs = ms;
    },
    held: () => held.map((event) => ({ id: event.id, type: event.type })),
    /** Delivers held events — in order, or reversed — and resolves with their statuses. */
    releaseHeld: async ({ reverse = false } = {}) => {
      const batch = held.splice(0, held.length);
      if (reverse) batch.reverse();
      const statuses = [];
      for (const event of batch) statuses.push(await deliverNow(event));
      return statuses;
    },
    /** Delivers an already-sent event again, freshly signed (a duplicate). */
    redeliver: async (eventId) => {
      const event = events.find((candidate) => candidate.id === eventId);
      if (event === undefined) throw new Error(`No such event: ${eventId}`);
      return deliverNow(event);
    },
    /** Resolves once every queued delivery has been attempted. */
    flush: () => deliveryChain,
    events: () =>
      events.map((event) => ({
        id: event.id,
        type: event.type,
        objectId: event.data.object.id,
      })),
    eventBody: (eventId) => {
      const event = events.find((candidate) => candidate.id === eventId);
      return event === undefined ? undefined : toJson(event);
    },
    deliveries: () => deliveries.map((delivery) => ({ ...delivery })),
    requests: () => requestLog.map((entry) => ({ ...entry })),
    resetRequests: () => {
      requestLog.length = 0;
    },
    session: (id) => snapshot(sessions, id),
    paymentIntent: (id) => snapshot(intents, id),
    charge: (id) => snapshot(charges, id),
    refund: (id) => snapshot(refunds, id),
    /** The `Stripe-Signature` header for arbitrary bytes at an arbitrary time. */
    sign: (body, timestamp, secret) => sign(body, timestamp, secret),
  });

  async function close() {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(() => resolve()));
  }

  return { origin, close, control };
}
