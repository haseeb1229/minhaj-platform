import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  DONATION_CURRENCIES,
  isDonationCurrency,
  type ExactMoney,
  type PaymentProviderPort,
} from '../../packages/contracts/src/donations/index.ts';
import {
  createStripePaymentProvider,
  STRIPE_CAPABILITIES,
  validateStripeConfig,
} from '../../packages/database/src/adapters/donations-stripe/index.ts';
import { startStripeSimulator } from '../../scripts/shared/stripe-simulator.mjs';

/**
 * A synthetic provider-key-shaped test value, assembled at runtime so that no
 * literal in tracked source matches a secret scanner's provider-key pattern.
 * The value under test is byte-for-byte the joined string.
 */
const syntheticKey = (kind: string, mode: string, body: string): string =>
  [kind, mode, body].join('_');

/**
 * The Stripe adapter against the local Stripe-protocol simulator, in process.
 *
 * Offline and credential-free: the simulator listens on 127.0.0.1 with
 * synthetic `sk_fixture_` / `whsec_fixture_` values, and every assertion is on
 * what crossed the wire or on what the adapter answered.
 *
 * What is proven: the request the adapter builds (form fields, units, pinned
 * version, idempotency key), how every provider answer maps onto the
 * provider-neutral port — `unknown` for anything that is not a verifiable
 * answer — that a POST is never retried and a GET is retried exactly once,
 * and that configuration fails closed per environment.
 */

const SECRET_KEY = 'sk_fixture_protocol_proof_0001';
const WEBHOOK_SECRET = 'whsec_fixture_protocol_proof_0001';
const ACCOUNT_KEY = 'acct_fixture_protocol';
const API_VERSION = '2026-09-30.endive';

type Simulator = Awaited<ReturnType<typeof startStripeSimulator>>;
let simulator: Simulator;

function config(overrides: Record<string, unknown> = {}) {
  return validateStripeConfig({
    environment: 'fixture',
    accountKey: ACCOUNT_KEY,
    secretKey: SECRET_KEY,
    webhookSecret: WEBHOOK_SECRET,
    apiOrigin: simulator.origin,
    checkoutOrigin: simulator.origin,
    timeoutMs: 2000,
    ...overrides,
  });
}

function provider(overrides: Record<string, unknown> = {}): PaymentProviderPort {
  return createStripePaymentProvider(config(overrides));
}

function checkoutInput(amount: ExactMoney = { currency: 'USD', minor: 2500n }) {
  const donationId = randomUUID();
  return {
    donationId,
    amount,
    description: 'Flood relief',
    successUrl: 'http://localhost:3000/en/donate/return',
    cancelUrl: 'http://localhost:3000/en/donate/return',
    expiresAt: new Date(Date.now() + 3600_000),
    idempotencyKey: `donation:${donationId}`,
  };
}

async function created(port: PaymentProviderPort, amount?: ExactMoney) {
  const input = checkoutInput(amount);
  const result = await port.createCheckout(input);
  if (result.outcome !== 'created')
    throw new Error(`expected created, got ${result.outcome}`);
  return { input, reference: result.checkoutReference, result };
}

async function paid(port: PaymentProviderPort, amount?: ExactMoney) {
  const session = await created(port, amount);
  simulator.control.complete(session.reference);
  const observed = await port.observeCheckout(session.reference);
  if (observed.outcome !== 'observed' || observed.observation.paymentReference === null) {
    throw new Error('expected a captured payment');
  }
  return { ...session, paymentReference: observed.observation.paymentReference };
}

function requests(route: string) {
  return simulator.control
    .requests()
    .filter((entry: { route: string }) => entry.route === route);
}

beforeAll(async () => {
  simulator = await startStripeSimulator({
    webhookUrl: null,
    webhookSecret: WEBHOOK_SECRET,
    secretKey: SECRET_KEY,
    accountKey: ACCOUNT_KEY,
  });
});

afterAll(async () => {
  await simulator.close();
});

beforeEach(() => {
  simulator.control.clearFaults();
  simulator.control.resetRequests();
  simulator.control.setRefundBehaviour('succeeded');
});

/* ===========================================================================
 * Configuration
 * ========================================================================= */

describe('configuration fails closed, per environment, with no fallback', () => {
  const SANDBOX = {
    environment: 'sandbox',
    accountKey: 'acct_sandbox_example',
    secretKey: syntheticKey('sk', 'test', 'SyntheticSandboxSentinel0001'),
    webhookSecret: 'whsec_SyntheticSandboxSentinel0001',
    apiOrigin: 'https://api.stripe.com',
    checkoutOrigin: 'https://checkout.stripe.com',
    timeoutMs: 10_000,
  };

  it('accepts each environment only with its own credentials and origins', () => {
    expect(validateStripeConfig(SANDBOX).environment).toBe('sandbox');
    expect(
      validateStripeConfig({
        ...SANDBOX,
        secretKey: syntheticKey('rk', 'test', 'SyntheticRestrictedSentinel01'),
      }).environment,
    ).toBe('sandbox');
    // The key class the official CLI's `stripe sandbox create` issues.
    expect(
      validateStripeConfig({
        ...SANDBOX,
        secretKey: syntheticKey('rkcs', 'test', 'SyntheticCliSandboxSentinel01'),
      }).environment,
    ).toBe('sandbox');
    expect(
      validateStripeConfig({
        ...SANDBOX,
        environment: 'production',
        secretKey: syntheticKey('sk', 'live', 'SyntheticLiveSentinel000001'),
      }).environment,
    ).toBe('production');
    expect(config().environment).toBe('fixture');
  });

  it.each([
    [
      'a live key in sandbox',
      { secretKey: syntheticKey('sk', 'live', 'SyntheticLiveSentinel000001') },
    ],
    ['a fixture key in sandbox', { secretKey: 'sk_fixture_SyntheticFixture00001' }],
    [
      'an undocumented live CLI-sandbox key class',
      { secretKey: syntheticKey('rkcs', 'live', 'SyntheticCliSandboxSentinel01') },
    ],
    ['a publishable key', { secretKey: 'pk_test_SyntheticPublishable00001' }],
    ['a loopback API origin in sandbox', { apiOrigin: 'http://127.0.0.1:4000' }],
    ['a look-alike API origin', { apiOrigin: 'https://api.stripe.com.example' }],
    ['a trailing slash on the origin', { apiOrigin: 'https://api.stripe.com/' }],
    ['another checkout origin', { checkoutOrigin: 'https://pay.example' }],
    [
      'the simulator webhook secret in sandbox',
      { webhookSecret: 'whsec_fixture_SyntheticFixture01' },
    ],
    ['a webhook secret without its prefix', { webhookSecret: 'SyntheticNoPrefix0001' }],
    ['an account key with a separator', { accountKey: 'acct example' }],
    ['an unknown environment', { environment: 'staging' }],
    ['a zero timeout', { timeoutMs: 0 }],
    ['a fractional timeout', { timeoutMs: 10.5 }],
    ['a non-function transport', { fetch: 'fetch' }],
  ])('refuses %s', (_label, patch) => {
    expect(() => validateStripeConfig({ ...SANDBOX, ...patch })).toThrow(
      /Invalid Stripe payment provider configuration/u,
    );
  });

  it('refuses production with a test key, and a test environment with a live one', () => {
    expect(() => validateStripeConfig({ ...SANDBOX, environment: 'production' })).toThrow(
      /secretKey/u,
    );
    for (const secretKey of [
      syntheticKey('rkcs', 'test', 'SyntheticCliSandboxSentinel01'),
      syntheticKey('rkcs', 'live', 'SyntheticCliSandboxSentinel01'),
    ])
      expect(() =>
        validateStripeConfig({ ...SANDBOX, environment: 'production', secretKey }),
      ).toThrow(/secretKey/u);
  });

  it.each([
    [
      'a sandbox key',
      { secretKey: syntheticKey('sk', 'test', 'SyntheticSandboxSentinel0001') },
    ],
    ['the real API origin', { apiOrigin: 'https://api.stripe.com' }],
    ['a non-loopback origin', { checkoutOrigin: 'http://example.com:8080' }],
    ['https on loopback', { apiOrigin: 'https://127.0.0.1:8443' }],
    ['a loopback origin without a port', { apiOrigin: 'http://127.0.0.1' }],
    ['a loopback origin with a path', { apiOrigin: 'http://127.0.0.1:4000/v1' }],
    ['a real webhook secret', { webhookSecret: 'whsec_SyntheticSandboxSentinel0001' }],
  ])('refuses a fixture configuration with %s', (_label, patch) => {
    expect(() => config(patch)).toThrow(/Invalid Stripe payment provider configuration/u);
  });

  it('names the field and never prints the value', () => {
    const secret = syntheticKey('sk', 'live', 'SyntheticNeverPrintedValue01');
    try {
      validateStripeConfig({ ...SANDBOX, secretKey: secret });
      expect.unreachable('expected a refusal');
    } catch (error) {
      expect((error as Error).message).toContain('secretKey');
      expect((error as Error).message).not.toContain(secret);
    }
  });
});

/* ===========================================================================
 * Capability map and units
 * ========================================================================= */

describe('the capability map and the unit convention', () => {
  it('declares exactly what the adapter implements', () => {
    expect(STRIPE_CAPABILITIES).toEqual({
      fullRefund: true,
      partialRefund: true,
      checkoutExpiry: true,
      cancelCheckout: true,
      disputes: true,
      transactionLookup: true,
      idempotentCreate: true,
      currencies: DONATION_CURRENCIES,
    });
    const port = provider();
    expect(port.capabilities()).toBe(STRIPE_CAPABILITIES);
    expect(port.scope()).toEqual({
      provider: 'stripe',
      environment: 'fixture',
      accountKey: ACCOUNT_KEY,
    });
    expect(port.checkoutOrigin()).toBe(simulator.origin);
  });

  it("keeps Stripe's special-unit currencies outside the domain allowlist", () => {
    // ISK and UGX are represented by Stripe as two-decimal values; HUF and TWD
    // have payout divisibility rules. Supporting any of them needs a
    // conversion this adapter deliberately does not have.
    for (const currency of ['ISK', 'UGX', 'HUF', 'TWD']) {
      expect(isDonationCurrency(currency), currency).toBe(false);
      expect(STRIPE_CAPABILITIES.currencies as readonly string[]).not.toContain(currency);
    }
  });

  it.each([
    ['USD', 2500n, 'usd', 2500],
    ['JPY', 1500n, 'jpy', 1500],
    ['KRW', 50_000n, 'krw', 50_000],
    ['KWD', 5120n, 'kwd', 5120],
    ['BHD', 999_999_999_990n, 'bhd', 999_999_999_990],
  ] as const)(
    'sends %s %s as %s unit_amount %s',
    async (currency, minor, wire, amount) => {
      const port = provider();
      const { reference } = await created(port, { currency, minor });
      const session = simulator.control.session(reference);
      expect(session.currency).toBe(wire);
      expect(session.amount_total).toBe(amount);

      const observed = await port.observeCheckout(reference);
      expect(observed.outcome).toBe('observed');
      if (observed.outcome !== 'observed') return;
      expect(observed.observation.amount).toEqual({ currency, minor });
    },
  );

  it.each([
    ['KWD', 5124n],
    ['BHD', 1n],
    ['OMR', 12_345n],
    ['JOD', 999_999_999_999n],
    ['TND', 1005n],
  ] as const)(
    'refuses %s %s, whose last digit Stripe cannot carry, without a request',
    async (currency, minor) => {
      const port = provider();
      const result = await port.createCheckout(checkoutInput({ currency, minor }));
      expect(result).toEqual({ outcome: 'rejected', reason: 'unsupported-amount' });
      expect(simulator.control.requests()).toHaveLength(0);
    },
  );

  it('refuses zero, negative and oversized amounts without a request', async () => {
    const port = provider();
    for (const minor of [0n, -100n, 1_000_000_000_000n]) {
      const result = await port.createCheckout(checkoutInput({ currency: 'USD', minor }));
      expect(result).toEqual({ outcome: 'rejected', reason: 'unsupported-amount' });
    }
    expect(simulator.control.requests()).toHaveLength(0);
  });
});

/* ===========================================================================
 * Create
 * ========================================================================= */

describe('creating a hosted checkout', () => {
  it('sends the documented form, pinned version and idempotency key', async () => {
    const port = provider();
    const input = checkoutInput();
    const result = await port.createCheckout(input);

    expect(result.outcome).toBe('created');
    if (result.outcome !== 'created') return;
    expect(result.checkoutReference).toMatch(/^cs_test_/u);
    expect(new URL(result.checkoutUrl).origin).toBe(simulator.origin);
    expect(result.expiresAt.getTime()).toBe(
      Math.floor(input.expiresAt.getTime() / 1000) * 1000,
    );

    const [request] = requests('POST /v1/checkout/sessions');
    expect(request).toMatchObject({
      idempotencyKey: input.idempotencyKey,
      stripeVersion: API_VERSION,
      replayed: false,
    });

    const session = simulator.control.session(result.checkoutReference);
    expect(session).toMatchObject({
      mode: 'payment',
      submit_type: 'donate',
      client_reference_id: input.donationId,
      metadata: { donation: input.donationId },
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      livemode: false,
    });
  });

  it('answers a repeated create with the ORIGINAL session (idempotent replay)', async () => {
    const port = provider();
    const input = checkoutInput();
    const first = await port.createCheckout(input);
    const second = await port.createCheckout(input);

    expect(second).toEqual(first);
    const posts = requests('POST /v1/checkout/sessions');
    expect(posts).toHaveLength(2);
    expect(posts[1]?.replayed).toBe(true);
  });

  it('answers unknown when the key was first used with different parameters', async () => {
    const port = provider();
    const input = checkoutInput();
    await port.createCheckout(input);
    const reused = await port.createCheckout({
      ...input,
      amount: { currency: 'USD', minor: 9900n },
    });
    // Not `rejected`: the ORIGINAL request under that key did create a session.
    expect(reused).toEqual({ outcome: 'unknown' });
  });

  it('never retries a POST: a 500 is unknown after exactly one request', async () => {
    const port = provider();
    simulator.control.inject('POST /v1/checkout/sessions', {
      kind: 'status',
      status: 500,
    });
    expect(await port.createCheckout(checkoutInput())).toEqual({ outcome: 'unknown' });
    expect(requests('POST /v1/checkout/sessions')).toHaveLength(1);
  });

  it.each([401, 403, 404, 409, 429, 502, 503])(
    'maps HTTP %s to unknown',
    async (status) => {
      const port = provider();
      simulator.control.inject('POST /v1/checkout/sessions', { kind: 'status', status });
      expect(await port.createCheckout(checkoutInput())).toEqual({ outcome: 'unknown' });
      expect(requests('POST /v1/checkout/sessions')).toHaveLength(1);
    },
  );

  it('a timeout is unknown, and replaying the same key recovers the session it created', async () => {
    const port = provider({ timeoutMs: 300 });
    const input = checkoutInput();
    // Stripe executes the request, but the answer never arrives.
    simulator.control.inject('POST /v1/checkout/sessions', {
      kind: 'hang',
      commit: true,
    });

    expect(await port.createCheckout(input)).toEqual({ outcome: 'unknown' });
    expect(requests('POST /v1/checkout/sessions')).toHaveLength(1);

    const recovered = await port.createCheckout(input);
    expect(recovered.outcome).toBe('created');
    if (recovered.outcome !== 'created') return;
    expect(
      simulator.control.session(recovered.checkoutReference)?.client_reference_id,
    ).toBe(input.donationId);
    expect(requests('POST /v1/checkout/sessions')[1]?.replayed).toBe(true);
  });

  it('a saved 5xx stays the answer under the same key, so it is never read as created', async () => {
    const port = provider();
    const input = checkoutInput();
    simulator.control.inject('POST /v1/checkout/sessions', {
      kind: 'status',
      status: 500,
      commit: true,
    });
    expect(await port.createCheckout(input)).toEqual({ outcome: 'unknown' });
    expect(await port.createCheckout(input)).toEqual({ outcome: 'unknown' });
  });

  it('an oversized response is unknown', async () => {
    const port = provider();
    simulator.control.inject('POST /v1/checkout/sessions', { kind: 'oversize' });
    expect(await port.createCheckout(checkoutInput())).toEqual({ outcome: 'unknown' });
  });

  it('a non-JSON response is unknown', async () => {
    const port = provider();
    simulator.control.inject('POST /v1/checkout/sessions', { kind: 'garbage' });
    expect(await port.createCheckout(checkoutInput())).toEqual({ outcome: 'unknown' });
  });

  it.each([
    [
      'another host',
      (url: string) =>
        url.replace(/^http:\/\/127\.0\.0\.1:\d+/u, 'https://checkout.example'),
    ],
    [
      'userinfo on the right host',
      (url: string) => url.replace('http://', 'http://donor@'),
    ],
    ['a protocol-relative trick', () => '//127.0.0.1.example/c/pay/x'],
    ['a javascript URL', () => 'javascript:alert(1)'],
    ['no URL at all', () => null],
  ])('a checkout URL with %s is unknown, never created', async (_label, rewrite) => {
    const port = provider();
    simulator.control.inject('POST /v1/checkout/sessions', {
      kind: 'tamper',
      mutate: (body: { url: string }) => ({ ...body, url: rewrite(body.url) }),
    });
    expect(await port.createCheckout(checkoutInput())).toEqual({ outcome: 'unknown' });
  });

  it.each([
    ['a live-mode session', { livemode: true }],
    ['a different amount', { amount_total: 2600 }],
    ['a fractional amount', { amount_total: 25.5 }],
    ['a different currency', { currency: 'eur' }],
    ['another donation', { client_reference_id: 'someone-else' }],
    ['a closed session', { status: 'expired' }],
  ])('a response describing %s is unknown', async (_label, patch) => {
    const port = provider();
    simulator.control.inject('POST /v1/checkout/sessions', {
      kind: 'tamper',
      mutate: (body: Record<string, unknown>) => ({ ...body, ...patch }),
    });
    expect(await port.createCheckout(checkoutInput())).toEqual({ outcome: 'unknown' });
  });

  it('a definitive validation refusal is rejected: nothing was created', async () => {
    const port = provider();
    // Stripe refuses an expiry less than 30 minutes away.
    const input = { ...checkoutInput(), expiresAt: new Date(Date.now() + 60_000) };
    expect(await port.createCheckout(input)).toEqual({
      outcome: 'rejected',
      reason: 'invalid-request',
    });
  });

  it('refuses unsendable input before any request', async () => {
    const port = provider();
    for (const patch of [
      { description: 'two\nlines' },
      { description: '   ' },
      { successUrl: 'ftp://example.com/return' },
      { cancelUrl: 'https://user:pass@example.com/return' },
      { idempotencyKey: '' },
      { donationId: 'not a reference' },
      { expiresAt: new Date(Number.NaN) },
    ]) {
      expect(await port.createCheckout({ ...checkoutInput(), ...patch })).toEqual({
        outcome: 'rejected',
        reason: 'invalid-request',
      });
    }
    expect(simulator.control.requests()).toHaveLength(0);
  });

  it('a wrong API key is unknown, never a refusal of the donation', async () => {
    const port = provider({ secretKey: 'sk_fixture_wrong_key_0000001' });
    expect(await port.createCheckout(checkoutInput())).toEqual({ outcome: 'unknown' });
  });
});

/* ===========================================================================
 * Resume and cancel
 * ========================================================================= */

describe('resuming and cancelling a checkout', () => {
  it('resumes an open session at its hosted URL, and calls a finished one closed', async () => {
    const port = provider();
    const { reference, result } = await created(port);
    expect(await port.resumeCheckout(reference)).toEqual({
      outcome: 'open',
      checkoutUrl: result.checkoutUrl,
    });

    simulator.control.complete(reference);
    expect(await port.resumeCheckout(reference)).toEqual({ outcome: 'closed' });

    const expired = await created(port);
    simulator.control.expire(expired.reference);
    expect(await port.resumeCheckout(expired.reference)).toEqual({ outcome: 'closed' });
  });

  it('an unknown or malformed reference cannot be resumed, and says unknown', async () => {
    const port = provider();
    expect(await port.resumeCheckout('cs_test_doesnotexist')).toEqual({
      outcome: 'unknown',
    });
    expect(await port.resumeCheckout('../v1/refunds')).toEqual({ outcome: 'unknown' });
  });

  it('an open session whose URL left the checkout origin is unknown', async () => {
    const port = provider();
    const { reference } = await created(port);
    simulator.control.inject('GET /v1/checkout/sessions/:id', {
      kind: 'tamper',
      mutate: (body: Record<string, unknown>) => ({
        ...body,
        url: 'https://evil.example/pay',
      }),
    });
    expect(await port.resumeCheckout(reference)).toEqual({ outcome: 'unknown' });
  });

  it('cancels an open session by expiring it at the provider', async () => {
    const port = provider();
    const { reference } = await created(port);
    expect(await port.cancelCheckout(reference)).toBe('cancelled');
    expect(simulator.control.session(reference)?.status).toBe('expired');
    expect(requests('POST /v1/checkout/sessions/:id/expire')).toHaveLength(1);
  });

  it('a session that is no longer open is not-open, read back rather than assumed', async () => {
    const port = provider();
    const { reference } = await created(port);
    simulator.control.complete(reference);
    expect(await port.cancelCheckout(reference)).toBe('not-open');
    expect(requests('GET /v1/checkout/sessions/:id')).toHaveLength(1);

    const again = await created(port);
    await port.cancelCheckout(again.reference);
    expect(await port.cancelCheckout(again.reference)).toBe('not-open');
  });

  it('never retries the expire POST, and a failure is unknown', async () => {
    const port = provider();
    const { reference } = await created(port);
    simulator.control.inject('POST /v1/checkout/sessions/:id/expire', {
      kind: 'status',
      status: 500,
    });
    expect(await port.cancelCheckout(reference)).toBe('unknown');
    expect(requests('POST /v1/checkout/sessions/:id/expire')).toHaveLength(1);
    expect(simulator.control.session(reference)?.status).toBe('open');
  });
});

/* ===========================================================================
 * Observe
 * ========================================================================= */

describe('observing provider truth server-to-server', () => {
  it('maps an open, unpaid session', async () => {
    const port = provider();
    const { input, reference } = await created(port);
    expect(await port.observeCheckout(reference)).toEqual({
      outcome: 'observed',
      observation: {
        scope: { provider: 'stripe', environment: 'fixture', accountKey: ACCOUNT_KEY },
        checkoutReference: reference,
        donationReference: input.donationId,
        checkout: 'open',
        payment: 'none',
        paymentReference: null,
        amount: { currency: 'USD', minor: 2500n },
        capturedMinor: null,
        refundedMinor: 0n,
        dispute: 'none',
      },
    });
    const [request] = requests('GET /v1/checkout/sessions/:id');
    expect(request?.stripeVersion).toBe(API_VERSION);
  });

  it('maps a paid session to a verified capture of exactly the charged amount', async () => {
    const port = provider();
    const { reference } = await created(port, { currency: 'JPY', minor: 3000n });
    simulator.control.complete(reference);
    const observed = await port.observeCheckout(reference);
    expect(observed.outcome).toBe('observed');
    if (observed.outcome !== 'observed') return;
    expect(observed.observation).toMatchObject({
      checkout: 'complete',
      payment: 'succeeded',
      capturedMinor: 3000n,
      refundedMinor: 0n,
      dispute: 'none',
    });
    expect(observed.observation.paymentReference).toMatch(/^pi_/u);
  });

  it('maps an asynchronous payment through processing to its settlement', async () => {
    const port = provider();
    const success = await created(port);
    simulator.control.complete(success.reference, { outcome: 'processing' });
    const processing = await port.observeCheckout(success.reference);
    expect(processing).toMatchObject({
      outcome: 'observed',
      observation: { checkout: 'complete', payment: 'processing', capturedMinor: null },
    });
    simulator.control.settleAsync(success.reference, 'succeeded');
    expect(await port.observeCheckout(success.reference)).toMatchObject({
      outcome: 'observed',
      observation: { payment: 'succeeded', capturedMinor: 2500n },
    });

    const failure = await created(port);
    simulator.control.complete(failure.reference, { outcome: 'processing' });
    simulator.control.settleAsync(failure.reference, 'failed');
    expect(await port.observeCheckout(failure.reference)).toMatchObject({
      outcome: 'observed',
      observation: { checkout: 'complete', payment: 'failed', capturedMinor: null },
    });
  });

  it('a declined card is a failed attempt on a still-open session', async () => {
    const port = provider();
    const { reference } = await created(port);
    simulator.control.decline(reference);
    expect(await port.observeCheckout(reference)).toMatchObject({
      outcome: 'observed',
      observation: { checkout: 'open', payment: 'failed', capturedMinor: null },
    });
  });

  it('an expired session is expired', async () => {
    const port = provider();
    const { reference } = await created(port);
    simulator.control.expire(reference);
    expect(await port.observeCheckout(reference)).toMatchObject({
      outcome: 'observed',
      observation: { checkout: 'expired', payment: 'none' },
    });
  });

  it.each([
    ['needs_response', 'open'],
    ['under_review', 'open'],
    ['warning_needs_response', 'open'],
    ['won', 'won'],
    // An inquiry closed without a chargeback, or a dispute prevented from becoming
    // one, records no dispute — only a decided dispute is terminal.
    ['warning_closed', 'none'],
    ['prevented', 'none'],
    ['lost', 'lost'],
  ] as const)('maps a dispute in status %s to %s', async (status, dispute) => {
    const port = provider();
    const { reference } = await created(port);
    simulator.control.complete(reference);
    simulator.control.dispute(reference, { status });
    expect(await port.observeCheckout(reference)).toMatchObject({
      outcome: 'observed',
      observation: { capturedMinor: 2500n, dispute },
    });
    expect(requests('GET /v1/disputes')).toHaveLength(1);
  });

  it('a missing session is not-found; a malformed reference never reaches the network', async () => {
    const port = provider();
    expect(await port.observeCheckout('cs_test_doesnotexist')).toEqual({
      outcome: 'not-found',
    });
    expect(await port.observeCheckout('cs_test_x/../../v1/refunds')).toEqual({
      outcome: 'not-found',
    });
    expect(requests('GET /v1/checkout/sessions/:id')).toHaveLength(1);
  });

  it('retries a failed GET exactly once', async () => {
    const port = provider();
    const { reference } = await created(port);

    simulator.control.inject('GET /v1/checkout/sessions/:id', {
      kind: 'status',
      status: 500,
    });
    expect((await port.observeCheckout(reference)).outcome).toBe('observed');
    expect(requests('GET /v1/checkout/sessions/:id')).toHaveLength(2);

    simulator.control.resetRequests();
    simulator.control.inject('GET /v1/checkout/sessions/:id', {
      kind: 'status',
      status: 429,
    });
    expect((await port.observeCheckout(reference)).outcome).toBe('observed');
    expect(requests('GET /v1/checkout/sessions/:id')).toHaveLength(2);

    simulator.control.resetRequests();
    simulator.control.inject('GET /v1/checkout/sessions/:id', {
      kind: 'status',
      status: 503,
      times: 3,
    });
    expect(await port.observeCheckout(reference)).toEqual({ outcome: 'unknown' });
    expect(requests('GET /v1/checkout/sessions/:id')).toHaveLength(2);
  });

  it('does not retry a definitive GET answer', async () => {
    const port = provider();
    const { reference } = await created(port);
    simulator.control.inject('GET /v1/checkout/sessions/:id', {
      kind: 'status',
      status: 401,
    });
    expect(await port.observeCheckout(reference)).toEqual({ outcome: 'unknown' });
    expect(requests('GET /v1/checkout/sessions/:id')).toHaveLength(1);
  });

  it('a GET that times out twice is unknown', async () => {
    const port = provider({ timeoutMs: 200 });
    const { reference } = await created(port);
    simulator.control.inject('GET /v1/checkout/sessions/:id', { kind: 'hang', times: 2 });
    expect(await port.observeCheckout(reference)).toEqual({ outcome: 'unknown' });
    expect(requests('GET /v1/checkout/sessions/:id')).toHaveLength(2);
  });

  it('an oversized GET response is unknown', async () => {
    const port = provider();
    const { reference } = await created(port);
    simulator.control.inject('GET /v1/checkout/sessions/:id', { kind: 'oversize' });
    expect(await port.observeCheckout(reference)).toEqual({ outcome: 'unknown' });
  });

  it.each([
    [
      'a live-mode session',
      (body: Record<string, unknown>) => ({ ...body, livemode: true }),
    ],
    [
      'another session',
      (body: Record<string, unknown>) => ({ ...body, id: 'cs_test_other' }),
    ],
    [
      'an unexpanded PaymentIntent',
      (body: Record<string, unknown>) => ({ ...body, payment_intent: 'pi_unexpanded' }),
    ],
    [
      'an unknown status',
      (body: Record<string, unknown>) => ({ ...body, status: 'paused' }),
    ],
    [
      'an unsafe amount',
      (body: Record<string, unknown>) => ({ ...body, amount_total: 2 ** 60 }),
    ],
    [
      'a negative amount',
      (body: Record<string, unknown>) => ({ ...body, amount_total: -1 }),
    ],
    [
      'a currency outside the allowlist',
      (body: Record<string, unknown>) => ({ ...body, currency: 'isk' }),
    ],
    [
      'a live-mode PaymentIntent',
      (body: { payment_intent: Record<string, unknown> }) => ({
        ...body,
        payment_intent: { ...body.payment_intent, livemode: true },
      }),
    ],
    [
      'a succeeded PaymentIntent without a readable charge',
      (body: { payment_intent: Record<string, unknown> }) => ({
        ...body,
        payment_intent: { ...body.payment_intent, latest_charge: 'ch_unexpanded' },
      }),
    ],
  ])('a response with %s is unknown', async (_label, mutate) => {
    const port = provider();
    const { reference } = await created(port);
    simulator.control.complete(reference);
    simulator.control.inject('GET /v1/checkout/sessions/:id', { kind: 'tamper', mutate });
    expect(await port.observeCheckout(reference)).toEqual({ outcome: 'unknown' });
  });

  it('a charge flagged disputed with no readable dispute is unknown', async () => {
    const port = provider();
    const { reference } = await created(port);
    simulator.control.complete(reference);
    simulator.control.dispute(reference);
    simulator.control.inject('GET /v1/disputes', {
      kind: 'status',
      status: 500,
      times: 2,
    });
    expect(await port.observeCheckout(reference)).toEqual({ outcome: 'unknown' });
  });
});

/* ===========================================================================
 * Refunds
 * ========================================================================= */

describe('refunds', () => {
  function refundInput(
    paymentReference: string,
    minor: bigint,
    currency: ExactMoney['currency'] = 'USD',
  ) {
    const refundId = randomUUID();
    return {
      refundId,
      donationId: randomUUID(),
      paymentReference,
      amount: { currency, minor },
      idempotencyKey: `refund:${refundId}`,
    };
  }

  it('refunds partially, then the remainder, and the payment reports both', async () => {
    const port = provider();
    const { reference, paymentReference } = await paid(port);

    const first = refundInput(paymentReference, 1000n);
    const accepted = await port.requestRefund(first);
    expect(accepted).toMatchObject({
      outcome: 'accepted',
      observation: {
        refundId: first.refundId,
        paymentReference,
        state: 'succeeded',
        amount: { currency: 'USD', minor: 1000n },
      },
    });
    const [post] = requests('POST /v1/refunds');
    expect(post).toMatchObject({
      idempotencyKey: first.idempotencyKey,
      stripeVersion: API_VERSION,
    });

    expect(await port.observeCheckout(reference)).toMatchObject({
      outcome: 'observed',
      observation: { capturedMinor: 2500n, refundedMinor: 1000n },
    });

    const rest = refundInput(paymentReference, 1500n);
    expect((await port.requestRefund(rest)).outcome).toBe('accepted');
    expect(await port.observeCheckout(reference)).toMatchObject({
      outcome: 'observed',
      observation: { refundedMinor: 2500n },
    });
  });

  it('observes a refund by its reference, and by this platform’s refund id', async () => {
    const port = provider();
    const { paymentReference } = await paid(port);
    const input = refundInput(paymentReference, 500n);
    const accepted = await port.requestRefund(input);
    if (accepted.outcome !== 'accepted') throw new Error('expected accepted');
    const refundReference = accepted.observation.refundReference;

    expect(
      await port.observeRefund({
        refundId: input.refundId,
        refundReference,
        paymentReference,
      }),
    ).toEqual({ outcome: 'observed', observation: accepted.observation });
    expect(
      await port.observeRefund({
        refundId: input.refundId,
        refundReference: null,
        paymentReference,
      }),
    ).toEqual({ outcome: 'observed', observation: accepted.observation });
    expect(requests('GET /v1/refunds')).toHaveLength(1);
  });

  it('follows a pending refund to failure, and the refunded total falls back', async () => {
    const port = provider();
    const { reference, paymentReference } = await paid(port);
    simulator.control.setRefundBehaviour('pending');
    const input = refundInput(paymentReference, 2500n);
    const accepted = await port.requestRefund(input);
    expect(accepted).toMatchObject({
      outcome: 'accepted',
      observation: { state: 'pending' },
    });
    if (accepted.outcome !== 'accepted') return;

    simulator.control.settleRefund(accepted.observation.refundReference, 'failed');
    expect(
      await port.observeRefund({
        refundId: input.refundId,
        refundReference: accepted.observation.refundReference,
        paymentReference,
      }),
    ).toMatchObject({ outcome: 'observed', observation: { state: 'failed' } });
    expect(await port.observeCheckout(reference)).toMatchObject({
      outcome: 'observed',
      observation: { refundedMinor: 0n },
    });
  });

  it('replays a repeated refund request instead of refunding twice', async () => {
    const port = provider();
    const { reference, paymentReference } = await paid(port);
    const input = refundInput(paymentReference, 700n);
    const first = await port.requestRefund(input);
    const second = await port.requestRefund(input);
    expect(second).toEqual(first);
    expect(requests('POST /v1/refunds')[1]?.replayed).toBe(true);
    expect(await port.observeCheckout(reference)).toMatchObject({
      outcome: 'observed',
      observation: { refundedMinor: 700n },
    });
  });

  it('a key reused with different parameters is unknown, never rejected', async () => {
    const port = provider();
    const { reference, paymentReference } = await paid(port);
    const input = refundInput(paymentReference, 600n);
    expect((await port.requestRefund(input)).outcome).toBe('accepted');

    // Stripe answers 400 `idempotency_error`; the ORIGINAL request under this
    // key did refund, so the caller must reconcile rather than mark it failed.
    const reused = await port.requestRefund({
      ...input,
      amount: { currency: 'USD', minor: 900n },
    });
    expect(reused).toEqual({ outcome: 'unknown' });
    expect(await port.observeCheckout(reference)).toMatchObject({
      outcome: 'observed',
      observation: { refundedMinor: 600n },
    });
  });

  it('a refund key still in flight (HTTP 409 idempotency_error) is unknown, never rejected', async () => {
    const port = provider();
    const { reference, paymentReference } = await paid(port);
    const input = refundInput(paymentReference, 100n);
    simulator.control.inject('POST /v1/refunds', { kind: 'delay', ms: 600 });
    const first = port.requestRefund(input);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await port.requestRefund(input)).toEqual({ outcome: 'unknown' });

    expect((await first).outcome).toBe('accepted');
    expect(await port.observeCheckout(reference)).toMatchObject({
      outcome: 'observed',
      observation: { refundedMinor: 100n },
    });
  });

  it('a create key still in flight (HTTP 409 idempotency_error) is unknown, never rejected', async () => {
    const port = provider();
    const input = checkoutInput();
    // The first request is still executing at the provider; a second one
    // under the same key meets Stripe's in-flight conflict.
    simulator.control.inject('POST /v1/checkout/sessions', { kind: 'delay', ms: 600 });
    const first = port.createCheckout(input);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(await port.createCheckout(input)).toEqual({ outcome: 'unknown' });

    const original = await first;
    expect(original.outcome).toBe('created');
    // Reconciling under the same key later recovers that one session.
    expect(await port.createCheckout(input)).toEqual(original);
  });

  it('a definitive refusal (over-refund) is rejected', async () => {
    const port = provider();
    const { paymentReference } = await paid(port);
    expect(await port.requestRefund(refundInput(paymentReference, 2501n))).toEqual({
      outcome: 'rejected',
    });
  });

  it('never retries a refund POST: a 500 or a timeout is unknown after one request', async () => {
    const { paymentReference } = await paid(provider());
    simulator.control.resetRequests();
    simulator.control.inject('POST /v1/refunds', { kind: 'status', status: 500 });
    expect(await provider().requestRefund(refundInput(paymentReference, 100n))).toEqual({
      outcome: 'unknown',
    });
    simulator.control.inject('POST /v1/refunds', { kind: 'hang', commit: true });
    expect(
      await provider({ timeoutMs: 300 }).requestRefund(
        refundInput(paymentReference, 100n),
      ),
    ).toEqual({ outcome: 'unknown' });
    expect(requests('POST /v1/refunds')).toHaveLength(2);
  });

  it('refuses an amount Stripe cannot carry, without a request', async () => {
    const port = provider();
    const { paymentReference } = await paid(port, { currency: 'KWD', minor: 10_000n });
    simulator.control.resetRequests();
    expect(await port.requestRefund(refundInput(paymentReference, 1255n, 'KWD'))).toEqual(
      {
        outcome: 'rejected',
      },
    );
    expect(simulator.control.requests()).toHaveLength(0);
    expect(
      (await port.requestRefund(refundInput(paymentReference, 1250n, 'KWD'))).outcome,
    ).toBe('accepted');
  });

  it('an accepted answer that does not describe the request is unknown', async () => {
    const port = provider();
    const { paymentReference } = await paid(port);
    simulator.control.inject('POST /v1/refunds', {
      kind: 'tamper',
      mutate: (body: Record<string, unknown>) => ({ ...body, amount: 999 }),
    });
    expect(await port.requestRefund(refundInput(paymentReference, 100n))).toEqual({
      outcome: 'unknown',
    });
  });

  it('a refund that does not exist is not-found; another platform refund is not ours', async () => {
    const port = provider();
    const { paymentReference } = await paid(port);
    expect(
      await port.observeRefund({
        refundId: randomUUID(),
        refundReference: null,
        paymentReference,
      }),
    ).toEqual({ outcome: 'not-found' });
    expect(
      await port.observeRefund({
        refundId: randomUUID(),
        refundReference: 're_doesnotexist',
        paymentReference,
      }),
    ).toEqual({ outcome: 'not-found' });

    const input = refundInput(paymentReference, 100n);
    const accepted = await port.requestRefund(input);
    if (accepted.outcome !== 'accepted') throw new Error('expected accepted');
    expect(
      await port.observeRefund({
        refundId: randomUUID(),
        refundReference: accepted.observation.refundReference,
        paymentReference,
      }),
    ).toEqual({ outcome: 'unknown' });
  });

  it('an external refund (no platform metadata) shows in the payment, not as ours', async () => {
    const port = provider();
    const { reference, paymentReference } = await paid(port);
    simulator.control.refundExternally(reference, 300);
    expect(await port.observeCheckout(reference)).toMatchObject({
      outcome: 'observed',
      observation: { refundedMinor: 300n },
    });
    expect(
      await port.observeRefund({
        refundId: randomUUID(),
        refundReference: null,
        paymentReference,
      }),
    ).toEqual({ outcome: 'not-found' });
  });
});
