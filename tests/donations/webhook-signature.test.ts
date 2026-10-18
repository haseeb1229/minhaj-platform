import { createHash, createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  createStripePaymentProvider,
  validateStripeConfig,
} from '../../packages/database/src/adapters/donations-stripe/index.ts';

/**
 * A synthetic provider-key-shaped test value, assembled at runtime so that no
 * literal in tracked source matches a secret scanner's provider-key pattern.
 * The value under test is byte-for-byte the joined string.
 */
const syntheticKey = (kind: string, mode: string, body: string): string =>
  [kind, mode, body].join('_');

/**
 * Stripe webhook verification (protocol class B), proven offline.
 *
 * The expected signatures are computed HERE, independently, from the
 * documented scheme — `v1 = HMAC-SHA256(secret, "<t>.<raw body>")` — so the
 * verifier is checked against the specification rather than against itself.
 * Every secret is a synthetic sentinel.
 */

const SECRET = 'whsec_fixture_signature_proof_0001';
const ROTATED = 'whsec_fixture_signature_proof_0002';
const NOW = new Date('2026-10-18T12:00:00Z');
const T = Math.floor(NOW.getTime() / 1000);

function port(
  environment: 'fixture' | 'sandbox' | 'production' = 'fixture',
  secret = SECRET,
) {
  const base =
    environment === 'fixture'
      ? {
          secretKey: 'sk_fixture_signature_proof_01',
          webhookSecret: secret,
          apiOrigin: 'http://127.0.0.1:9',
          checkoutOrigin: 'http://127.0.0.1:9',
        }
      : {
          secretKey:
            environment === 'sandbox'
              ? syntheticKey('sk', 'test', 'SyntheticSignatureSentinel01')
              : syntheticKey('sk', 'live', 'SyntheticSignatureSentinel01'),
          webhookSecret: 'whsec_SyntheticSignatureSentinel01',
          apiOrigin: 'https://api.stripe.com',
          checkoutOrigin: 'https://checkout.stripe.com',
        };
  return createStripePaymentProvider(
    validateStripeConfig({
      environment,
      accountKey: 'acct_signature_proof',
      timeoutMs: 1000,
      ...base,
    }),
  );
}

function v1(body: Uint8Array | string, timestamp: number, secret = SECRET): string {
  return createHmac('sha256', secret).update(`${timestamp}.`).update(body).digest('hex');
}

function header(body: Uint8Array | string, timestamp = T, secret = SECRET): string {
  return `t=${timestamp},v1=${v1(body, timestamp, secret)}`;
}

function event(
  type: string,
  object: Record<string, unknown>,
  livemode = false,
): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      id: 'evt_1SignatureProof0001',
      object: 'event',
      api_version: '2026-09-30.endive',
      created: T - 5,
      data: { object },
      livemode,
      pending_webhooks: 1,
      request: { id: null, idempotency_key: null },
      type,
    }),
  );
}

const COMPLETED = event('checkout.session.completed', {
  id: 'cs_test_SignatureProof0001',
  object: 'checkout.session',
  payment_intent: 'pi_SignatureProof0001',
});

describe('a genuine delivery', () => {
  it('verifies and normalises to a hint about which object to re-read', () => {
    const result = port().verifyWebhook({
      rawBody: COMPLETED,
      signature: header(COMPLETED),
      now: NOW,
    });
    expect(result).toEqual({
      outcome: 'verified',
      notice: {
        scope: {
          provider: 'stripe',
          environment: 'fixture',
          accountKey: 'acct_signature_proof',
        },
        eventId: 'evt_1SignatureProof0001',
        eventType: 'checkout.session.completed',
        occurredAt: new Date((T - 5) * 1000),
        category: 'payment',
        subject: {
          checkoutReference: 'cs_test_SignatureProof0001',
          paymentReference: 'pi_SignatureProof0001',
          refundReference: null,
        },
        payloadDigest: createHash('sha256').update(COMPLETED).digest('hex'),
      },
    });
  });

  it('digests the EXACT bytes: the same event spelled differently digests differently', () => {
    const spaced = new TextEncoder().encode(
      `${new TextDecoder().decode(COMPLETED).replace('{"id"', '{ "id"')}`,
    );
    const first = port().verifyWebhook({
      rawBody: COMPLETED,
      signature: header(COMPLETED),
      now: NOW,
    });
    const second = port().verifyWebhook({
      rawBody: spaced,
      signature: header(spaced),
      now: NOW,
    });
    if (first.outcome !== 'verified' || second.outcome !== 'verified') {
      throw new Error('both deliveries are genuine');
    }
    expect(first.notice.eventId).toBe(second.notice.eventId);
    expect(first.notice.payloadDigest).not.toBe(second.notice.payloadDigest);
    expect(second.notice.payloadDigest).toBe(
      createHash('sha256').update(spaced).digest('hex'),
    );
  });

  it('accepts either signature while a rolled secret has two', () => {
    const signature = `t=${T},v1=${v1(COMPLETED, T, ROTATED)},v1=${v1(COMPLETED, T, SECRET)}`;
    expect(
      port('fixture', SECRET).verifyWebhook({ rawBody: COMPLETED, signature, now: NOW })
        .outcome,
    ).toBe('verified');
    expect(
      port('fixture', ROTATED).verifyWebhook({ rawBody: COMPLETED, signature, now: NOW })
        .outcome,
    ).toBe('verified');
  });

  it('ignores the test-mode v0 decoy beside a valid v1', () => {
    const signature = `${header(COMPLETED)},v0=${'0'.repeat(64)}`;
    expect(
      port().verifyWebhook({ rawBody: COMPLETED, signature, now: NOW }).outcome,
    ).toBe('verified');
  });

  it('accepts the edge of the 300-second window in both directions', () => {
    for (const timestamp of [T - 300, T + 300]) {
      expect(
        port().verifyWebhook({
          rawBody: COMPLETED,
          signature: header(COMPLETED, timestamp),
          now: NOW,
        }).outcome,
      ).toBe('verified');
    }
  });
});

describe('refusals', () => {
  const rejected = (reason: string) => ({ outcome: 'rejected', reason });

  it('a missing signature', () => {
    expect(
      port().verifyWebhook({ rawBody: COMPLETED, signature: null, now: NOW }),
    ).toEqual(rejected('missing-signature'));
    expect(
      port().verifyWebhook({ rawBody: COMPLETED, signature: '  ', now: NOW }),
    ).toEqual(rejected('missing-signature'));
  });

  it('a forged signature', () => {
    const signature = `t=${T},v1=${'a'.repeat(64)}`;
    expect(port().verifyWebhook({ rawBody: COMPLETED, signature, now: NOW })).toEqual(
      rejected('invalid-signature'),
    );
  });

  it('a signature made with another secret', () => {
    const signature = header(COMPLETED, T, ROTATED);
    expect(port().verifyWebhook({ rawBody: COMPLETED, signature, now: NOW })).toEqual(
      rejected('invalid-signature'),
    );
  });

  it('a body changed after signing, by one byte', () => {
    const tampered = Uint8Array.from(COMPLETED);
    tampered[tampered.length - 2] = 0x20;
    expect(
      port().verifyWebhook({ rawBody: tampered, signature: header(COMPLETED), now: NOW }),
    ).toEqual(rejected('invalid-signature'));
  });

  it('a signature changed after signing, by one digit', () => {
    const genuine = v1(COMPLETED, T);
    const flipped = `${genuine.slice(0, -1)}${genuine.endsWith('0') ? '1' : '0'}`;
    expect(
      port().verifyWebhook({
        rawBody: COMPLETED,
        signature: `t=${T},v1=${flipped}`,
        now: NOW,
      }),
    ).toEqual(rejected('invalid-signature'));
  });

  it('a timestamp changed after signing', () => {
    const signature = `t=${T + 1},v1=${v1(COMPLETED, T)}`;
    expect(port().verifyWebhook({ rawBody: COMPLETED, signature, now: NOW })).toEqual(
      rejected('invalid-signature'),
    );
  });

  it('a genuine delivery older or newer than 300 seconds', () => {
    for (const timestamp of [T - 301, T + 301, T - 86_400]) {
      expect(
        port().verifyWebhook({
          rawBody: COMPLETED,
          signature: header(COMPLETED, timestamp),
          now: NOW,
        }),
      ).toEqual(rejected('stale'));
    }
  });

  it('a stale timestamp on a FORGED signature says nothing about the clock', () => {
    const signature = `t=${T - 10_000},v1=${'b'.repeat(64)}`;
    expect(port().verifyWebhook({ rawBody: COMPLETED, signature, now: NOW })).toEqual(
      rejected('invalid-signature'),
    );
  });

  it('a v0-only header: a downgrade is never accepted', () => {
    const signature = `t=${T},v0=${v1(COMPLETED, T)}`;
    expect(port().verifyWebhook({ rawBody: COMPLETED, signature, now: NOW })).toEqual(
      rejected('invalid-signature'),
    );
  });

  it.each([
    ['no timestamp', () => `v1=${v1(COMPLETED, T)}`],
    ['two timestamps', () => `t=${T},t=${T},v1=${v1(COMPLETED, T)}`],
    ['an uppercase-hex signature', () => `t=${T},v1=${v1(COMPLETED, T).toUpperCase()}`],
    ['a truncated signature', () => `t=${T},v1=${v1(COMPLETED, T).slice(0, 63)}`],
    ['a non-numeric timestamp', () => `t=now,v1=${v1(COMPLETED, T)}`],
    ['an enormous header', () => `t=${T},${'x=y,'.repeat(2000)}v1=${v1(COMPLETED, T)}`],
  ])('a malformed header: %s', (_label, build) => {
    expect(
      port().verifyWebhook({ rawBody: COMPLETED, signature: build(), now: NOW }),
    ).toEqual(rejected('invalid-signature'));
  });

  it('verifies BEFORE parsing: unsigned non-JSON is invalid-signature, not malformed', () => {
    const garbage = new TextEncoder().encode('{ this is not json');
    expect(
      port().verifyWebhook({
        rawBody: garbage,
        signature: `t=${T},v1=${'c'.repeat(64)}`,
        now: NOW,
      }),
    ).toEqual(rejected('invalid-signature'));
    // The same bytes, genuinely signed, are only then judged as malformed.
    expect(
      port().verifyWebhook({ rawBody: garbage, signature: header(garbage), now: NOW }),
    ).toEqual(rejected('malformed'));
  });

  it.each([
    ['not an event', { hello: 'world' }],
    [
      'an event without an id',
      { object: 'event', type: 'x.y', created: T, livemode: false, data: { object: {} } },
    ],
    [
      'a checkout event without a session id',
      {
        id: 'evt_1Malformed',
        object: 'event',
        type: 'checkout.session.completed',
        created: T,
        livemode: false,
        data: { object: { id: 'pi_notasession' } },
      },
    ],
    [
      'a refund event without a refund id',
      {
        id: 'evt_1Malformed',
        object: 'event',
        type: 'refund.updated',
        created: T,
        livemode: false,
        data: { object: {} },
      },
    ],
  ])('signed JSON that is %s is malformed', (_label, value) => {
    const body = new TextEncoder().encode(JSON.stringify(value));
    expect(
      port().verifyWebhook({ rawBody: body, signature: header(body), now: NOW }),
    ).toEqual(rejected('malformed'));
  });

  it('signed bytes that are not UTF-8 are malformed', () => {
    const body = Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d]);
    expect(
      port().verifyWebhook({ rawBody: body, signature: header(body), now: NOW }),
    ).toEqual(rejected('malformed'));
  });

  it('an oversized body is refused before any signature work', () => {
    const body = new Uint8Array(64 * 1024 + 1).fill(0x20);
    expect(
      port().verifyWebhook({ rawBody: body, signature: header(body), now: NOW }),
    ).toEqual(rejected('malformed'));
  });

  it('a live event never reaches a test instance, and a test event never reaches production', () => {
    const live = event(
      'checkout.session.completed',
      { id: 'cs_live_SignatureProof0001' },
      true,
    );
    expect(
      port().verifyWebhook({ rawBody: live, signature: header(live), now: NOW }),
    ).toEqual(rejected('wrong-environment'));

    const production = port('production');
    const signedForProduction = header(
      COMPLETED,
      T,
      'whsec_SyntheticSignatureSentinel01',
    );
    expect(
      production.verifyWebhook({
        rawBody: COMPLETED,
        signature: signedForProduction,
        now: NOW,
      }),
    ).toEqual(rejected('wrong-environment'));

    const sandbox = port('sandbox');
    expect(
      sandbox.verifyWebhook({
        rawBody: COMPLETED,
        signature: signedForProduction,
        now: NOW,
      }).outcome,
    ).toBe('verified');
  });
});

describe('event classification', () => {
  it.each([
    [
      'checkout.session.async_payment_succeeded',
      { id: 'cs_test_A1' },
      'payment',
      { checkoutReference: 'cs_test_A1' },
    ],
    [
      'checkout.session.async_payment_failed',
      { id: 'cs_test_A1' },
      'payment',
      { checkoutReference: 'cs_test_A1' },
    ],
    [
      'checkout.session.expired',
      { id: 'cs_test_A1', payment_intent: null },
      'payment',
      { checkoutReference: 'cs_test_A1' },
    ],
    [
      'payment_intent.succeeded',
      { id: 'pi_A1' },
      'payment',
      { paymentReference: 'pi_A1' },
    ],
    [
      'payment_intent.payment_failed',
      { id: 'pi_A1' },
      'payment',
      { paymentReference: 'pi_A1' },
    ],
    [
      'payment_intent.canceled',
      { id: 'pi_A1' },
      'payment',
      { paymentReference: 'pi_A1' },
    ],
    [
      'charge.succeeded',
      { id: 'ch_A1', payment_intent: 'pi_A1' },
      'payment',
      { paymentReference: 'pi_A1' },
    ],
    [
      'charge.refunded',
      { id: 'ch_A1', payment_intent: 'pi_A1' },
      'payment',
      { paymentReference: 'pi_A1' },
    ],
    [
      'refund.created',
      { id: 're_A1', payment_intent: 'pi_A1' },
      'refund',
      { refundReference: 're_A1', paymentReference: 'pi_A1' },
    ],
    [
      'refund.updated',
      { id: 're_A1', payment_intent: 'pi_A1' },
      'refund',
      { refundReference: 're_A1', paymentReference: 'pi_A1' },
    ],
    [
      'refund.failed',
      { id: 're_A1', payment_intent: 'pi_A1' },
      'refund',
      { refundReference: 're_A1', paymentReference: 'pi_A1' },
    ],
    [
      'charge.refund.updated',
      { id: 're_A1', payment_intent: 'pi_A1' },
      'refund',
      { refundReference: 're_A1', paymentReference: 'pi_A1' },
    ],
    [
      'charge.dispute.created',
      { id: 'du_A1', payment_intent: 'pi_A1' },
      'dispute',
      { paymentReference: 'pi_A1' },
    ],
    [
      'charge.dispute.updated',
      { id: 'du_A1', payment_intent: 'pi_A1' },
      'dispute',
      { paymentReference: 'pi_A1' },
    ],
    [
      'charge.dispute.closed',
      { id: 'du_A1', payment_intent: 'pi_A1' },
      'dispute',
      { paymentReference: 'pi_A1' },
    ],
    [
      'charge.dispute.funds_withdrawn',
      { id: 'du_A1', payment_intent: 'pi_A1' },
      'dispute',
      { paymentReference: 'pi_A1' },
    ],
    [
      'charge.dispute.funds_reinstated',
      { id: 'du_A1', payment_intent: 'pi_A1' },
      'dispute',
      { paymentReference: 'pi_A1' },
    ],
    ['charge.dispute.created', { id: 'du_A1', payment_intent: null }, 'ignored', {}],
    ['customer.created', { id: 'cus_A1' }, 'ignored', {}],
    ['invoice.paid', { id: 'in_A1' }, 'ignored', {}],
  ] as const)('%s → %s', (type, object, category, subject) => {
    const body = event(type, object);
    const result = port().verifyWebhook({
      rawBody: body,
      signature: header(body),
      now: NOW,
    });
    expect(result).toMatchObject({
      outcome: 'verified',
      notice: {
        eventType: type,
        category,
        subject: {
          checkoutReference: null,
          paymentReference: null,
          refundReference: null,
          ...subject,
        },
      },
    });
  });
});
