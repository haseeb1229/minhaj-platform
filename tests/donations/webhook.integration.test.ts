import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type {
  DonationAuthorityPort,
  PaymentProviderPort,
  PaymentScope,
} from '../../packages/contracts/src/donations/index.ts';
import {
  createStripePaymentProvider,
  validateStripeConfig,
} from '../../packages/database/src/adapters/donations-stripe/index.ts';
import { startStripeSimulator } from '../../scripts/shared/stripe-simulator.mjs';
import {
  createDonationsAdminService,
  createDonationsDonorService,
  createDonationsLedgerService,
  type DonationsAdminService,
  type DonationsDonorService,
  type DonationsLedgerService,
} from '../../apps/web/src/contexts/donations/index.ts';
import type * as RouteModule from '../../apps/web/src/app/api/webhooks/stripe/route.ts';
import { databaseConfigured } from '../identity/harness.ts';
import {
  account,
  activate,
  count,
  donationColumns,
  dueNow,
  eventRows,
  everyStoredValue,
  intentRows,
  n,
  protocolWorld,
  refundAuthority,
  refundDueNow,
  refundRows,
  sentinel,
  type DonationColumns,
  type ProtocolWorld,
} from './protocol-world.ts';

/**
 * Phase 27 — the payment protocol END TO END: the REAL webhook route handler,
 * the REAL Donations services (donor, ledger, administration), the REAL Stripe
 * adapter, Donations' REAL persistence adapter as the least-privilege runtime
 * principal against a disposable SQL Server database, and the local
 * Stripe-protocol simulator delivering really-signed webhooks over HTTP.
 *
 * WHAT ONLY THIS WIRING CAN PROVE: that nothing a browser does — a return
 * redirect, a duplicate submit — moves a donation, and only provider truth
 * read server-to-server does; that a signed event is applied exactly once
 * however often, late, or out of order it arrives, and an unsigned, stale,
 * tampered, malformed or wrong-environment one writes NOTHING; that a lost
 * webhook, a provider outage, an ambiguous create and an unanswered refund are
 * each closed by reconciliation under the ORIGINAL idempotency key — one
 * checkout, one refund, never a blind retry; that refunds and disputes move a
 * donation only forward, within its captured amount, under authority the
 * database re-checks; that owed mail is committed once per fact; and that no
 * token, secret, signature, checkout URL or payload is ever stored.
 *
 * Only Identity's live answer is a fake (the administration's permission
 * read); the refund trigger still requires the real role, assignment, session
 * and step-up rows. Every key and secret is a synthetic `…_fixture_…` value.
 */

const SECRET_KEY = 'sk_fixture_webhook_integration_0001';
const WEBHOOK_SECRET = 'whsec_fixture_webhook_integration_0001';
const WRONG_SECRET = 'whsec_fixture_webhook_integration_wrong';
const ACCOUNT_KEY = 'acct_fixture_webhook_integration';
const DIGEST_KEY = 'synthetic-donations-webhook-proof-digest-key';
const BASE_URL = 'http://localhost:3000';
const SCOPE: PaymentScope = {
  provider: 'stripe',
  environment: 'fixture',
  accountKey: ACCOUNT_KEY,
};

/* ===========================================================================
 * The route's collaborators: everything real except Identity's composition
 * ========================================================================= */

const wiring = vi.hoisted(() => ({
  ledger: null as DonationsLedgerService | null,
}));

vi.mock('@/composition/donations', () => ({
  donationsRuntime: () => {
    if (wiring.ledger === null) throw new Error('The ledger is not wired yet.');
    return { ledger: wiring.ledger };
  },
}));

vi.mock('@/composition/logging', () => ({
  appLogger: () => ({
    warn: () => undefined,
    error: () => undefined,
    info: () => undefined,
  }),
}));

vi.mock('@/config/server-env', () => ({
  serverEnv: () => ({
    RATE_LIMIT_DIGEST_KEY: 'synthetic-donations-webhook-proof-digest-key',
    RATE_LIMIT_DIGEST_KEY_VERSION: 1,
    TRUST_PROXY_HEADERS: false,
  }),
}));

type Simulator = Awaited<ReturnType<typeof startStripeSimulator>>;
type Route = typeof RouteModule;

interface Services {
  readonly provider: PaymentProviderPort;
  readonly donor: DonationsDonorService;
  readonly ledger: DonationsLedgerService;
  readonly admin: DonationsAdminService;
}

const live = databaseConfigured ? describe : describe.skip;

live('Phase 27 payment protocol end to end (real route, services, adapters, SQL)', () => {
  let world: ProtocolWorld;
  let simulator: Simulator;
  let receiver: Server;
  let receiverUrl: string;
  let route: Route;
  let services: Services;
  /** The same services over a provider that gives up after one second. */
  let impatient: Services;
  let build: (provider: PaymentProviderPort) => Services;
  let operator: string;
  let campaignId: string;
  let clients = 0;

  /** Every Stripe-Signature header the route received, and every delivered body by event id. */
  const seenSignatures: string[] = [];
  const delivered = new Map<
    string,
    { readonly body: Buffer; readonly signature: string }
  >();
  /** Every status token issued in this run, for the storage scan. */
  const tokens: string[] = [];

  const permitted = new Set<string>();
  const authority: DonationAuthorityPort = {
    permits: async (accountId) => permitted.has(accountId),
  };

  const address = () => `proof-client-${(clients += 1)}`;
  const control = () => simulator.control;
  const admin = () => world.admin;

  function provider(timeoutMs: number, accountKey = ACCOUNT_KEY): PaymentProviderPort {
    return createStripePaymentProvider(
      validateStripeConfig({
        environment: 'fixture',
        accountKey,
        secretKey: SECRET_KEY,
        webhookSecret: WEBHOOK_SECRET,
        apiOrigin: simulator.origin,
        checkoutOrigin: simulator.origin,
        timeoutMs,
      }),
    );
  }

  beforeAll(async () => {
    receiver = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks);
        const headers = new Headers();
        for (const [name, value] of Object.entries(request.headers)) {
          if (['host', 'connection', 'keep-alive', 'transfer-encoding'].includes(name))
            continue;
          if (typeof value === 'string') headers.set(name, value);
        }
        const signature = headers.get('stripe-signature');
        if (signature !== null) {
          seenSignatures.push(signature);
          try {
            const parsed = JSON.parse(body.toString('utf8')) as { id?: unknown };
            if (typeof parsed.id === 'string' && !delivered.has(parsed.id))
              delivered.set(parsed.id, { body, signature });
          } catch {
            // A deliberately malformed body names no event.
          }
        }
        void route
          .POST(
            new Request(`http://127.0.0.1${request.url ?? '/'}`, {
              method: request.method ?? 'POST',
              headers,
              body: body.byteLength === 0 ? null : body,
            }),
          )
          .then(
            (answer) => {
              response.writeHead(answer.status);
              response.end();
            },
            () => {
              response.writeHead(599);
              response.end();
            },
          );
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
    const port = (receiver.address() as { port: number }).port;
    receiverUrl = `http://127.0.0.1:${port}/api/webhooks/stripe`;

    simulator = await startStripeSimulator({
      webhookUrl: receiverUrl,
      webhookSecret: WEBHOOK_SECRET,
      secretKey: SECRET_KEY,
      accountKey: ACCOUNT_KEY,
    });

    world = await protocolWorld();
    route = await import('../../apps/web/src/app/api/webhooks/stripe/route.ts');

    const database = world.database;
    const configuration = { digestKey: DIGEST_KEY, digestKeyVersion: 1 };
    const limiter = database.createRateLimiter(configuration);
    const key = (purpose: string, subject: string) =>
      database.rateLimitKey({ purpose, subject, configuration });
    const donor = database.createDonationDonor();
    const ledger = database.createDonationLedger();
    const refunds = database.createDonationRefunds();
    const catalogue = database.createDonationCatalogueReader();
    const activation = database.createDonationActivationReader();
    const campaigns = database.createDonationCampaigns();
    const staff = database.createDonationStaff();

    build = (port) => ({
      provider: port,
      donor: createDonationsDonorService({
        donor,
        catalogue,
        activation,
        ledger,
        provider: port,
        limiter,
        key,
        baseUrl: BASE_URL,
      }),
      ledger: createDonationsLedgerService({
        ledger,
        donor,
        refunds,
        provider: port,
        baseUrl: BASE_URL,
      }),
      admin: createDonationsAdminService({
        campaigns,
        staff,
        refunds,
        ledger,
        provider: port,
        authority,
      }),
    });
    services = build(provider(10_000));
    impatient = build(provider(1_000));
    wiring.ledger = services.ledger;

    operator = await account(admin());
    permitted.add(operator);

    // A published campaign offering a zero-, a two- and a three-decimal
    // currency, built through the administration service itself.
    const actor = { accountId: operator };
    let campaign = await services.admin.createCampaign(actor, {
      primaryLocale: 'en',
      displayOrder: 1,
    });
    campaignId = campaign.id;
    campaign = await services.admin.saveTranslation(actor, {
      id: campaignId,
      expectedVersion: campaign.version,
      translation: {
        locale: 'en',
        title: sentinel('TITLE', 'en'),
        summary: sentinel('SUMMARY', 'en'),
        description: sentinel('DESCRIPTION', 'en'),
      },
    });
    for (const [currency, minimum, maximum] of [
      ['JPY', '100', '1000000'],
      ['USD', '1.00', '10000.00'],
      ['KWD', '0.500', '5000.000'],
    ] as const)
      campaign = await services.admin.saveCurrencyPolicy(actor, {
        id: campaignId,
        expectedVersion: campaign.version,
        currency,
        minimum,
        maximum,
        suggested: [],
      });
    await services.admin.transitionCampaign(actor, {
      id: campaignId,
      expectedVersion: campaign.version,
      to: 'published',
    });
  }, 300_000);

  afterEach(async () => {
    simulator?.control.clearFaults();
    // A test that failed while holding events must not leak them into the next.
    if (simulator !== undefined && simulator.control.held().length > 0)
      await simulator.control.releaseHeld();
    simulator?.control.setWebhookMode('deliver');
    simulator?.control.setRefundBehaviour('succeeded');
    if (services !== undefined) wiring.ledger = services.ledger;
  });

  afterAll(async () => {
    try {
      await simulator?.close();
      if (receiver !== undefined) {
        receiver.closeAllConnections();
        await new Promise<void>((resolve) => receiver.close(() => resolve()));
      }
    } finally {
      await world?.close();
    }
  }, 120_000);

  /* ---- helpers ------------------------------------------------------------ */

  async function refusal(work: Promise<unknown>): Promise<string> {
    try {
      await work;
    } catch (error) {
      const named = error as { name?: unknown; reason?: unknown } | null;
      return named?.name === 'DonationsRefusal' && typeof named.reason === 'string'
        ? named.reason
        : `unclassified: ${String(error)}`;
    }
    return 'accepted';
  }

  interface Started {
    readonly operationId: string;
    readonly token: string | null;
    readonly checkoutUrl: string;
    readonly id: string;
    readonly session: string;
  }

  async function start(
    input: {
      readonly currency?: 'JPY' | 'USD' | 'KWD';
      readonly amount?: string;
      readonly locale?: 'en' | 'ur' | 'ar';
      readonly accountId?: string | null;
      readonly operationId?: string;
      readonly via?: Services;
    } = {},
  ): Promise<Started> {
    const operationId = input.operationId ?? randomUUID();
    let token: string | null = null;
    const result = await (input.via ?? services).donor.start({
      form: {
        operationId,
        campaignId,
        currency: input.currency ?? 'USD',
        amount: input.amount ?? '40.00',
      },
      locale: input.locale ?? 'en',
      clientAddress: address(),
      account: input.accountId ? { accountId: input.accountId } : null,
      issueStatusToken: async (issued) => {
        token = issued;
        tokens.push(issued);
      },
    });
    const row = await columns(`[operationId] = ${n(operationId)}`);
    return {
      operationId,
      token,
      checkoutUrl: result.checkoutUrl,
      id: row.id,
      session: row.checkoutReference ?? '',
    };
  }

  async function columns(where: string): Promise<DonationColumns> {
    const row = await donationColumns(admin(), where);
    if (row === undefined) throw new Error(`No donation where ${where}`);
    return row;
  }
  const donation = (id: string) => columns(`[id] = ${n(id)}`);

  /** The donor presses Pay on the hosted page; resolves after the simulator's deliveries. */
  async function pay(started: Started): Promise<Response> {
    return fetch(`${started.checkoutUrl}/pay`, { method: 'POST', redirect: 'manual' });
  }

  async function paid(input: Parameters<typeof start>[0] = {}): Promise<Started> {
    const started = await start(input);
    const answer = await pay(started);
    expect(answer.status).toBe(303);
    expect((await donation(started.id)).state).toBe('succeeded');
    return started;
  }

  function apiRequests(route: string, idempotencyKey?: string) {
    return control()
      .requests()
      .filter(
        (entry: { route: string; idempotencyKey: string | null }) =>
          entry.route === route &&
          (idempotencyKey === undefined || entry.idempotencyKey === idempotencyKey),
      ) as { route: string; idempotencyKey: string | null; replayed: boolean }[];
  }

  function eventsOf(objectId: string, type?: string) {
    return (
      control().events() as { id: string; type: string; objectId: string }[]
    ).filter(
      (event) =>
        event.objectId === objectId && (type === undefined || event.type === type),
    );
  }

  /** POSTs bytes to the route exactly as a provider would. */
  async function deliver(
    body: string | Buffer,
    signature: string | null,
  ): Promise<number> {
    const answer = await fetch(receiverUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        ...(signature === null ? {} : { 'stripe-signature': signature }),
      },
      body,
    });
    return answer.status;
  }

  const nowSeconds = () => Math.floor(Date.now() / 1000);
  const eventId = () => `evt_proof${randomUUID().replaceAll('-', '')}`;

  function event(
    type: string,
    object: Record<string, unknown>,
    overrides: Record<string, unknown> = {},
  ): string {
    return JSON.stringify({
      id: eventId(),
      object: 'event',
      api_version: '2026-09-30.endive',
      created: nowSeconds(),
      livemode: false,
      pending_webhooks: 1,
      data: { object },
      type,
      ...overrides,
    });
  }

  /** Everything the ledger could have written, for "nothing was written" proofs. */
  async function ledgerFootprint(id: string): Promise<string> {
    return JSON.stringify({
      donation: await donation(id),
      events: await count(admin(), 'DonationProviderEvent'),
      intents: await count(admin(), 'DonationCommunicationIntent'),
      audit: await count(admin(), 'AuditLog'),
    });
  }

  /* ===========================================================================
   * Activation fails closed
   * ========================================================================= */

  it('refuses to start anything while no activation row permits the scope', async () => {
    const before = apiRequests('POST /v1/checkout/sessions').length;
    let issued = false;
    const attempt = (via: Services) =>
      via.donor.start({
        form: { operationId: randomUUID(), campaignId, currency: 'USD', amount: '40.00' },
        locale: 'en',
        clientAddress: address(),
        account: null,
        issueStatusToken: async () => {
          issued = true;
        },
      });
    expect(await refusal(attempt(services))).toBe('not-activated');

    await activate(admin(), SCOPE);

    // A provider bound to another account is still not activated.
    expect(
      await refusal(attempt(build(provider(10_000, 'acct_fixture_other_account')))),
    ).toBe('not-activated');
    expect(issued).toBe(false);
    expect(await count(admin(), 'Donation')).toBe(0);
    expect(apiRequests('POST /v1/checkout/sessions')).toHaveLength(before);
  });

  /* ===========================================================================
   * Initiation: exact money, one donation, one checkout, a tokenless return
   * ========================================================================= */

  it('creates one donation and one provider checkout with the exact amount in 0-, 2- and 3-decimal currencies', async () => {
    for (const [currency, amount, minor, locale] of [
      ['JPY', '1500', '1500', 'en'],
      ['USD', '12.34', '1234', 'ur'],
      ['KWD', '1.250', '1250', 'ar'],
    ] as const) {
      const started = await start({ currency, amount, locale });
      const row = await donation(started.id);
      expect(row).toMatchObject({
        currency,
        expectedMinor: minor,
        provider: 'stripe',
        environment: 'fixture',
        accountKey: ACCOUNT_KEY,
        createState: 'created',
        state: 'pending',
        capturedMinor: null,
        locale,
      });
      expect(row.currencyExponent).toBe({ JPY: 0, USD: 2, KWD: 3 }[currency]);

      // Exactly one create, under the donation's own key, for exactly that money.
      expect(
        apiRequests('POST /v1/checkout/sessions', `donation:${started.id}`),
      ).toHaveLength(1);
      const session = control().session(started.session) as Record<string, unknown>;
      expect(session).toMatchObject({
        amount_total: Number(minor),
        currency: currency.toLowerCase(),
        client_reference_id: started.id,
        mode: 'payment',
        submit_type: 'donate',
        status: 'open',
      });

      // The provider is sent back to a constant page that carries NO token and no query.
      const destination = `${BASE_URL}/${locale}/donate/return`;
      expect(session['success_url']).toBe(destination);
      expect(session['cancel_url']).toBe(destination);
      expect(started.checkoutUrl).toBe(`${simulator.origin}/c/pay/${started.session}`);

      // The status token is issued once, and only its digest is stored.
      expect(started.token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
      expect(row.statusTokenDigest).toBe(
        createHash('sha256').update(started.token!, 'utf8').digest('hex'),
      );
      expect(JSON.stringify(session)).not.toContain(started.token!);
    }
  });

  it('refuses money the provider cannot represent and money the form over-specifies, creating no checkout', async () => {
    const before = apiRequests('POST /v1/checkout/sessions').length;
    // 1.255 KWD is exact in ISO units but Stripe needs the last of three digits to be 0.
    const operationId = randomUUID();
    expect(await refusal(start({ currency: 'KWD', amount: '1.255', operationId }))).toBe(
      'amount-refused',
    );
    expect(await columns(`[operationId] = ${n(operationId)}`)).toMatchObject({
      createState: 'rejected',
      state: 'failed',
      closure: 'failed',
      checkoutReference: null,
    });
    // More decimals than the currency has is never rounded.
    for (const [currency, amount] of [
      ['JPY', '1.5'],
      ['USD', '1.005'],
    ] as const) {
      const id = randomUUID();
      expect(await refusal(start({ currency, amount, operationId: id }))).toBe('invalid');
      expect(await count(admin(), 'Donation', `[operationId] = ${n(id)}`)).toBe(0);
    }
    expect(apiRequests('POST /v1/checkout/sessions')).toHaveLength(before);
  });

  it('answers a duplicate submit with the same donation and the same checkout, and a changed one with a conflict', async () => {
    const first = await start({ amount: '25.00' });
    const second = await start({ amount: '25.00', operationId: first.operationId });
    expect(second.id).toBe(first.id);
    expect(second.checkoutUrl).toBe(first.checkoutUrl);
    // No second token: the browser already holds the first.
    expect(second.token).toBeNull();
    expect(
      await count(admin(), 'Donation', `[operationId] = ${n(first.operationId)}`),
    ).toBe(1);
    expect(
      apiRequests('POST /v1/checkout/sessions', `donation:${first.id}`),
    ).toHaveLength(1);

    expect(
      await refusal(start({ amount: '26.00', operationId: first.operationId })),
    ).toBe('operation-conflict');
    expect((await donation(first.id)).expectedMinor).toBe('2500');
  });

  /* ===========================================================================
   * Nothing a browser does moves a donation; provider truth does
   * ========================================================================= */

  it('changes nothing on a successful redirect alone; a donor check or reconciliation then reads provider truth', async () => {
    control().setWebhookMode('drop');
    const checked = await start({ amount: '15.00' });
    const reconciled = await start({ amount: '16.00' });
    for (const started of [checked, reconciled]) {
      const before = await ledgerFootprint(started.id);
      const answer = await pay(started);
      expect(answer.status).toBe(303);
      // The provider sends the browser back to the constant, tokenless page.
      expect(answer.headers.get('location')).toBe(`${BASE_URL}/en/donate/return`);
      expect(await ledgerFootprint(started.id)).toBe(before);
    }
    const view = await services.donor.status(checked.token, address());
    expect(view?.state).toBe('pending');

    // The donor's own "check again" asks the provider, and only that moves it.
    expect((await services.donor.check(checked.token, address()))?.state).toBe(
      'succeeded',
    );

    // The lost webhook is closed by reconciliation once the donation comes due.
    expect((await donation(reconciled.id)).state).toBe('pending');
    await dueNow(admin(), reconciled.id);
    const summary = await services.ledger.reconcileDue(100);
    expect(summary.donations).toBeGreaterThanOrEqual(1);
    const after = await donation(reconciled.id);
    expect(after).toMatchObject({
      state: 'succeeded',
      capturedMinor: '1600',
      reconcileDueAt: null,
    });
    expect(after.paymentReference).toMatch(/^pi_/u);
    expect(after.succeededAt).not.toBeNull();
  });

  it('applies a signed payment webhook exactly once: one success, one intent for a linked donor, none for an anonymous one', async () => {
    const donor = await account(admin());
    const linked = await paid({ accountId: donor, amount: '50.00' });
    const anonymous = await paid({ amount: '51.00' });

    for (const started of [linked, anonymous]) {
      const row = await donation(started.id);
      expect(row).toMatchObject({
        state: 'succeeded',
        capturedMinor: row.expectedMinor,
        refundedMinor: '0',
        dispute: 'none',
        attention: null,
      });
      // The three signed events, each recorded once and completed.
      const events = await eventRows(admin(), `[donationId] = ${n(started.id)}`);
      expect(events.map((entry) => entry.eventType).sort()).toEqual([
        'charge.succeeded',
        'checkout.session.completed',
        'payment_intent.succeeded',
      ]);
      expect(events.every((entry) => entry.processedAt !== null)).toBe(true);
      expect(events.map((entry) => entry.result).sort()).toEqual([
        'applied',
        'unchanged',
        'unchanged',
      ]);
    }
    expect(await intentRows(admin(), linked.id)).toEqual([
      {
        purpose: 'donation.succeeded',
        refundId: null,
        recipientUserId: donor,
        idempotencyKey: `donation.succeeded:${linked.id}`,
      },
    ]);
    expect(await intentRows(admin(), anonymous.id)).toEqual([]);
  });

  it('gives a duplicate delivery and a byte-identical replay no second effect, and refuses a stale replay', async () => {
    const donor = await account(admin());
    const started = await paid({ accountId: donor, amount: '52.00' });
    const [completed] = eventsOf(started.session, 'checkout.session.completed');
    const before = await ledgerFootprint(started.id);

    // The provider delivers the same event again, freshly signed.
    expect(await control().redeliver(completed!.id)).toBe(200);
    // An attacker replays the captured request byte for byte.
    const captured = delivered.get(completed!.id)!;
    expect(await deliver(captured.body, captured.signature)).toBe(200);
    expect(await ledgerFootprint(started.id)).toBe(before);
    expect(
      await count(admin(), 'DonationProviderEvent', `[eventId] = ${n(completed!.id)}`),
    ).toBe(1);

    // The same bytes re-signed beyond the five-minute window are refused.
    const stale = control().sign(captured.body, nowSeconds() - 400);
    expect(await deliver(captured.body, stale)).toBe(401);
    expect(await ledgerFootprint(started.id)).toBe(before);
    expect(await intentRows(admin(), started.id)).toHaveLength(1);
  });

  it('refuses every unauthentic, stale, malformed or wrong-environment webhook and writes nothing', async () => {
    const started = await start({ amount: '17.00' });
    // The provider really did complete it, so an accepted event WOULD change something.
    control().setWebhookMode('hold');
    control().complete(started.session);
    const before = await ledgerFootprint(started.id);
    const object = { id: started.session, object: 'checkout.session' };
    const body = event('checkout.session.completed', object);
    const t = nowSeconds();
    const valid = control().sign(body, t) as string;
    const forgedHex = randomBytes(32).toString('hex');
    const malformed = '{"id": "evt_broken", ';
    const liveMode = event('checkout.session.completed', object, { livemode: true });

    const cases: [string, string | Buffer, string | null, number][] = [
      ['missing signature', body, null, 401],
      ['empty signature', body, '', 401],
      ['forged signature', body, `t=${t},v1=${forgedHex}`, 401],
      ['wrong secret', body, control().sign(body, t, WRONG_SECRET), 401],
      [
        'tampered body',
        body.replace('"livemode":false', '"livemode":false '),
        valid,
        401,
      ],
      [
        'tampered signature',
        body,
        valid.replace(/v1=([0-9a-f])/u, (_m, c: string) => `v1=${c === 'a' ? 'b' : 'a'}`),
        401,
      ],
      ['v0 only', body, valid.replace(/v1=[0-9a-f]{64},?/u, ''), 401],
      ['stale', body, control().sign(body, t - 330), 401],
      ['from the future', body, control().sign(body, t + 330), 401],
      ['malformed signed JSON', malformed, control().sign(malformed, t), 400],
      ['wrong environment', liveMode, control().sign(liveMode, t), 401],
    ];
    for (const [name, payload, signature, status] of cases) {
      expect(await deliver(payload, signature), name).toBe(status);
      expect(await ledgerFootprint(started.id), name).toBe(before);
    }

    // An oversized body is refused by the route before a byte is verified.
    expect(await deliver(Buffer.alloc(64 * 1024 + 1, 0x20), valid)).toBe(413);
    expect(await ledgerFootprint(started.id)).toBe(before);

    // The genuine deliveries still apply.
    expect(
      (await control().releaseHeld()).every((status: unknown) => status === 200),
    ).toBe(true);
    expect((await donation(started.id)).state).toBe('succeeded');
  });

  it('records a verified event for an unknown subject as unmatched and an unhandled type as ignored', async () => {
    const unknown = event('checkout.session.completed', {
      id: `cs_test_proofunknown${randomUUID().replaceAll('-', '')}`,
      object: 'checkout.session',
    });
    const ignored = event('customer.created', {
      id: 'cus_proof0001',
      object: 'customer',
    });
    for (const [body, result] of [
      [unknown, 'unmatched'],
      [ignored, 'ignored'],
    ] as const) {
      expect(await deliver(body, control().sign(body, nowSeconds()))).toBe(200);
      const id = (JSON.parse(body) as { id: string }).id;
      const [row] = await eventRows(admin(), `[eventId] = ${n(id)}`);
      expect(row).toMatchObject({ result, donationId: null });
      expect(row?.processedAt).not.toBeNull();
      expect(row?.payloadDigest).toBe(
        createHash('sha256').update(body, 'utf8').digest('hex'),
      );
    }
  });

  /* ===========================================================================
   * Order, staleness and mismatch
   * ========================================================================= */

  it('converges to the same final state whether refund and dispute events arrive in order or reversed', async () => {
    const forward = await paid({ amount: '40.00' });
    const reversed = await paid({ amount: '40.00' });
    for (const [started, reverse] of [
      [reversed, true],
      [forward, false],
    ] as const) {
      control().setWebhookMode('hold');
      control().refundExternally(started.session, 1000);
      const disputeId = control().dispute(started.session) as string;
      control().updateDispute(disputeId, 'won');
      expect(control().held()).toHaveLength(4);
      control().setWebhookMode('deliver');
      const statuses = await control().releaseHeld({ reverse });
      expect(statuses).toEqual([200, 200, 200, 200]);
    }
    const final = (row: DonationColumns) => ({
      state: row.state,
      capturedMinor: row.capturedMinor,
      refundedMinor: row.refundedMinor,
      dispute: row.dispute,
      attention: row.attention,
    });
    expect(final(await donation(reversed.id))).toEqual(final(await donation(forward.id)));
    expect(final(await donation(forward.id))).toEqual({
      state: 'partially_refunded',
      capturedMinor: '4000',
      refundedMinor: '1000',
      dispute: 'won',
      // A refund this platform never requested is flagged, never hidden.
      attention: 'external-refund',
    });
  });

  it('never regresses a success on a late expiry event or a stale provider read', async () => {
    const donor = await account(admin());
    const started = await paid({ accountId: donor, amount: '53.00' });
    const before = await donation(started.id);

    // A genuinely signed but late "expired" event: the provider is re-read and wins.
    const expired = event('checkout.session.expired', {
      id: started.session,
      object: 'checkout.session',
    });
    expect(await deliver(expired, control().sign(expired, nowSeconds()))).toBe(200);

    // Stale reads: the provider's answer itself lags behind (still open, or expired).
    for (const status of ['open', 'expired'] as const) {
      control().inject('GET /v1/checkout/sessions/:id', {
        kind: 'tamper',
        times: 2,
        mutate: (session: Record<string, unknown>) => {
          const intent = session['payment_intent'] as Record<string, unknown>;
          return {
            ...session,
            status,
            payment_status: 'unpaid',
            url: null,
            payment_intent: {
              ...intent,
              status: status === 'open' ? 'requires_payment_method' : 'canceled',
              latest_charge: null,
            },
          };
        },
      });
      const late = event('checkout.session.completed', {
        id: started.session,
        object: 'checkout.session',
      });
      expect(await deliver(late, control().sign(late, nowSeconds()))).toBe(200);
      control().clearFaults();
    }
    const after = await donation(started.id);
    expect(after).toMatchObject({
      state: 'succeeded',
      capturedMinor: '5300',
      closure: null,
      version: before.version,
      succeededAt: before.succeededAt,
    });
    expect(await intentRows(admin(), started.id)).toHaveLength(1);
  });

  it('flags an amount the provider reports differently and never succeeds on it', async () => {
    const donor = await account(admin());
    const started = await start({ accountId: donor, amount: '12.00' });
    control().inject('GET /v1/checkout/sessions/:id', {
      kind: 'tamper',
      times: 6,
      mutate: (session: Record<string, unknown>) => ({
        ...session,
        amount_total: Number(session['amount_total']) + 1,
      }),
    });
    expect((await pay(started)).status).toBe(303);
    control().clearFaults();
    const row = await donation(started.id);
    expect(row).toMatchObject({
      state: 'pending',
      capturedMinor: null,
      attention: 'amount-mismatch',
      reconcileDueAt: null,
    });
    expect(await intentRows(admin(), started.id)).toEqual([]);
    const [completed] = eventsOf(started.session, 'checkout.session.completed');
    const [record] = await eventRows(admin(), `[eventId] = ${n(completed!.id)}`);
    expect(record?.result).toBe('attention');
  });

  /* ===========================================================================
   * Provider faults: the event stays unprocessed and the retry completes once
   * ========================================================================= */

  for (const fault of ['500', 'hang'] as const)
    it(`answers 500 while the provider ${fault === '500' ? 'fails' : 'hangs'}, keeps the event unprocessed, and completes it once on redelivery`, async () => {
      const donor = await account(admin());
      const started = await start({ accountId: donor, amount: '18.00' });
      if (fault === 'hang') wiring.ledger = impatient.ledger;
      control().setWebhookMode('hold');
      control().complete(started.session);
      // Two: the adapter retries an idempotent GET exactly once.
      control().inject(
        'GET /v1/checkout/sessions/:id',
        fault === '500'
          ? { kind: 'status', status: 500, times: 2 }
          : { kind: 'hang', times: 2 },
      );
      const [completed] = eventsOf(started.session, 'checkout.session.completed');
      const statuses = await control().releaseHeld();
      expect(statuses[0]).toBe(500);

      const [record] = await eventRows(admin(), `[eventId] = ${n(completed!.id)}`);
      expect(record).toMatchObject({ result: null, processedAt: null });
      const deferred = await donation(started.id);
      expect(deferred).toMatchObject({ state: 'pending', capturedMinor: null });
      expect(deferred.reconcileAttempts).toBe(1);
      expect(await intentRows(admin(), started.id)).toEqual([]);

      control().clearFaults();
      wiring.ledger = services.ledger;
      expect(await control().redeliver(completed!.id)).toBe(200);
      expect(
        await count(admin(), 'DonationProviderEvent', `[eventId] = ${n(completed!.id)}`),
      ).toBe(1);
      const [done] = await eventRows(admin(), `[eventId] = ${n(completed!.id)}`);
      expect(done).toMatchObject({ result: 'applied', donationId: started.id });
      expect((await donation(started.id)).state).toBe('succeeded');
      expect(await intentRows(admin(), started.id)).toHaveLength(1);
      // A further duplicate does nothing.
      expect(await control().redeliver(completed!.id)).toBe(200);
      expect(await intentRows(admin(), started.id)).toHaveLength(1);
    });

  /* ===========================================================================
   * An ambiguous create resolves to the SAME checkout under the same key
   * ========================================================================= */

  it('resolves an ambiguous create through a duplicate submit to the one session the provider made', async () => {
    control().inject('POST /v1/checkout/sessions', { kind: 'hang', commit: true });
    const operationId = randomUUID();
    let token: string | null = null;
    expect(
      await refusal(
        impatient.donor.start({
          form: { operationId, campaignId, currency: 'USD', amount: '19.00' },
          locale: 'en',
          clientAddress: address(),
          account: null,
          issueStatusToken: async (issued) => {
            token = issued;
            tokens.push(issued);
          },
        }),
      ),
    ).toBe('provider-unavailable');
    // The token was issued before the provider was asked: the way back exists.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const ambiguous = await columns(`[operationId] = ${n(operationId)}`);
    expect(ambiguous).toMatchObject({
      createState: 'ambiguous',
      checkoutReference: null,
      state: 'pending',
    });
    const key = `donation:${ambiguous.id}`;
    expect(apiRequests('POST /v1/checkout/sessions', key)).toHaveLength(1);

    const again = await start({ amount: '19.00', operationId });
    expect(again.id).toBe(ambiguous.id);
    const creates = apiRequests('POST /v1/checkout/sessions', key);
    expect(creates.map((entry) => entry.replayed)).toEqual([false, true]);
    expect(await donation(ambiguous.id)).toMatchObject({
      createState: 'created',
      checkoutReference: again.session,
    });
    expect(again.checkoutUrl).toBe(`${simulator.origin}/c/pay/${again.session}`);
  });

  it('resolves an ambiguous create through reconciliation to the one session, never a second', async () => {
    control().inject('POST /v1/checkout/sessions', { kind: 'hang', commit: true });
    const operationId = randomUUID();
    expect(await refusal(start({ amount: '21.00', operationId, via: impatient }))).toBe(
      'provider-unavailable',
    );
    const ambiguous = await columns(`[operationId] = ${n(operationId)}`);
    expect(ambiguous.createState).toBe('ambiguous');

    await dueNow(admin(), ambiguous.id);
    await services.ledger.reconcileDue(100);
    const resolved = await donation(ambiguous.id);
    expect(resolved).toMatchObject({ createState: 'created', state: 'pending' });
    expect(resolved.checkoutReference).toMatch(/^cs_/u);
    expect(
      apiRequests('POST /v1/checkout/sessions', `donation:${ambiguous.id}`).map(
        (entry) => entry.replayed,
      ),
    ).toEqual([false, true]);
    expect(control().session(resolved.checkoutReference!)).toMatchObject({
      client_reference_id: ambiguous.id,
      amount_total: 2100,
    });
  });

  /* ===========================================================================
   * Cancellation follows provider truth
   * ========================================================================= */

  it('cancels an open checkout, and loses to a payment that completed first', async () => {
    const abandoned = await start({ amount: '22.00' });
    expect((await services.donor.cancel(abandoned.token, address()))?.state).toBe(
      'cancelled',
    );
    expect(await donation(abandoned.id)).toMatchObject({
      state: 'cancelled',
      closure: 'expired',
      capturedMinor: null,
    });
    expect(control().session(abandoned.session)).toMatchObject({ status: 'expired' });

    const raced = await start({ amount: '23.00' });
    control().setWebhookMode('hold');
    control().complete(raced.session);
    const view = await services.donor.cancel(raced.token, address());
    expect(view?.state).toBe('succeeded');
    const row = await donation(raced.id);
    expect(row).toMatchObject({
      state: 'succeeded',
      capturedMinor: '2300',
      closure: null,
    });
    expect(row.cancelRequestedAt).not.toBeNull();
    const version = row.version;
    expect(
      (await control().releaseHeld()).every((status: unknown) => status === 200),
    ).toBe(true);
    expect((await donation(raced.id)).version).toBe(version);
  });

  /* ===========================================================================
   * Refunds: within the captured amount, under database-checked authority
   * ========================================================================= */

  it('refunds partially, again, refuses an over-refund, survives a lost answer, and refunds the rest — once per fact', async () => {
    const donor = await account(admin());
    const started = await paid({ accountId: donor, amount: '100.00' });
    await refundAuthority(admin(), operator);
    const actor = { accountId: operator };
    const refundsBefore = () => apiRequests('POST /v1/refunds').length;
    const form = async (amount: string, operationId = randomUUID()) => ({
      operationId,
      donationId: started.id,
      expectedVersion: (await donation(started.id)).version,
      amount,
    });

    // The key without a live step-up: the DATABASE refuses, whatever the caller claims.
    const unstepped = await account(admin());
    await refundAuthority(admin(), unstepped, { stepUp: false });
    permitted.add(unstepped);
    const posted = refundsBefore();
    expect(
      await refusal(services.admin.refund({ accountId: unstepped }, await form('1.00'))),
    ).toBe('denied');
    expect(await refundRows(admin(), started.id)).toEqual([]);
    expect(refundsBefore()).toBe(posted);

    control().setWebhookMode('hold');

    // First partial: accepted and settled at once.
    const first = await services.admin.refund(actor, await form('25.00'));
    expect(first.submission).toBe('accepted');
    expect(first.refund.state).toBe('succeeded');
    expect(await donation(started.id)).toMatchObject({
      state: 'partially_refunded',
      refundedMinor: '2500',
      refundReservedMinor: '2500',
    });

    // Second partial: accepted but pending at the provider.
    control().setRefundBehaviour('pending');
    const second = await services.admin.refund(actor, await form('30.00'));
    expect(second.refund.state).toBe('pending');
    expect((await donation(second.refund.donationId)).refundReservedMinor).toBe('5500');

    // Their webhooks arrive late and reversed: provider truth, no regression.
    const statuses = await control().releaseHeld({ reverse: true });
    expect(statuses).toEqual([200, 200, 200, 200]);
    expect(await donation(started.id)).toMatchObject({
      state: 'partially_refunded',
      refundedMinor: '5500',
      attention: null,
    });

    // The pending refund settles; its webhook completes it.
    control().setWebhookMode('deliver');
    control().settleRefund(second.refund.refundReference!, 'succeeded');
    await control().flush();
    expect((await refundRows(admin(), started.id))[1]).toMatchObject({
      state: 'succeeded',
    });

    // Beyond what remains: refused before anything is reserved or sent.
    const remaining = refundsBefore();
    expect(await refusal(services.admin.refund(actor, await form('45.01')))).toBe(
      'over-refund',
    );
    expect(refundsBefore()).toBe(remaining);

    // A refund whose answer is lost stays requested and is never re-sent blind.
    control().setRefundBehaviour('succeeded');
    control().setWebhookMode('hold');
    control().inject('POST /v1/refunds', { kind: 'hang', commit: true });
    const lost = await impatient.admin.refund(actor, await form('10.00'));
    expect(lost.submission).toBe('unknown');
    expect(lost.refund.state).toBe('requested');
    expect(lost.refund.refundReference).toBeNull();
    expect(apiRequests('POST /v1/refunds', `refund:${lost.refund.id}`)).toHaveLength(1);
    expect((await donation(started.id)).refundReservedMinor).toBe('6500');

    // Reconciliation finds it at the provider by this platform's refund id.
    await refundDueNow(admin(), lost.refund.id);
    const summary = await services.ledger.reconcileDue(100);
    expect(summary.refunds).toBeGreaterThanOrEqual(1);
    expect(apiRequests('POST /v1/refunds', `refund:${lost.refund.id}`)).toHaveLength(1);
    const reconciled = (await refundRows(admin(), started.id)).find(
      (row) => row.id === lost.refund.id,
    );
    expect(reconciled).toMatchObject({ state: 'succeeded', reconcileDueAt: null });
    expect(reconciled?.refundReference).toMatch(/^re_/u);
    expect((await donation(started.id)).refundedMinor).toBe('6500');
    expect(
      (await control().releaseHeld()).every((status: unknown) => status === 200),
    ).toBe(true);

    // The rest, exactly.
    control().setWebhookMode('deliver');
    const rest = await services.admin.refund(actor, await form('35.00'));
    expect(rest.refund.state).toBe('succeeded');
    await control().flush();
    const refunded = await donation(started.id);
    expect(refunded).toMatchObject({
      state: 'refunded',
      capturedMinor: '10000',
      refundedMinor: '10000',
      refundReservedMinor: '10000',
      attention: null,
    });
    expect(await refusal(services.admin.refund(actor, await form('0.01')))).toBe(
      'over-refund',
    );

    // Four refunds at the provider, four rows here, one acknowledgement per fact.
    const rows = await refundRows(admin(), started.id);
    expect(rows.map((row) => [row.amountMinor, row.state])).toEqual([
      ['2500', 'succeeded'],
      ['3000', 'succeeded'],
      ['1000', 'succeeded'],
      ['3500', 'succeeded'],
    ]);
    expect(
      (
        control().requests() as {
          route: string;
          idempotencyKey: string | null;
          replayed: boolean;
        }[]
      )
        .filter((entry) => entry.route === 'POST /v1/refunds' && !entry.replayed)
        .filter((entry) =>
          rows.some((row) => entry.idempotencyKey === `refund:${row.id}`),
        ),
    ).toHaveLength(4);
    const intents = await intentRows(admin(), started.id);
    expect(intents.map((intent) => intent.idempotencyKey).sort()).toEqual(
      [
        `donation.partially-refunded:${rows[0]!.id}`,
        `donation.partially-refunded:${rows[1]!.id}`,
        `donation.partially-refunded:${rows[2]!.id}`,
        `donation.refunded:${rows[3]!.id}`,
        `donation.succeeded:${started.id}`,
      ].sort(),
    );
    expect(intents.every((intent) => intent.recipientUserId === donor)).toBe(true);
    expect(
      await count(
        admin(),
        'AuditLog',
        `[action] = N'donations.refund.completed' AND [targetId] IN (${rows.map((row) => n(row.id)).join(',')})`,
      ),
    ).toBe(4);
  });

  /* ===========================================================================
   * Disputes
   * ========================================================================= */

  it('moves a disputed donation to disputed, back to captured when won, and to charged back when lost', async () => {
    const donor = await account(admin());
    const won = await paid({ accountId: donor, amount: '60.00' });
    const disputeWon = control().dispute(won.session) as string;
    await control().flush();
    expect(await donation(won.id)).toMatchObject({ state: 'disputed', dispute: 'open' });
    control().updateDispute(disputeWon, 'won');
    await control().flush();
    expect(await donation(won.id)).toMatchObject({
      state: 'succeeded',
      dispute: 'won',
      capturedMinor: '6000',
    });

    const lost = await paid({ accountId: donor, amount: '61.00' });
    const disputeLost = control().dispute(lost.session) as string;
    control().updateDispute(disputeLost, 'lost');
    await control().flush();
    const charged = await donation(lost.id);
    expect(charged).toMatchObject({ state: 'charged_back', dispute: 'lost' });

    // A charged-back donation is never refunded.
    await refundAuthority(admin(), operator);
    expect(
      await refusal(
        services.admin.refund(
          { accountId: operator },
          {
            operationId: randomUUID(),
            donationId: lost.id,
            expectedVersion: charged.version,
            amount: '1.00',
          },
        ),
      ),
    ).toBe('invalid-state');
    // Disputes owe no message; the success owed exactly one each.
    for (const started of [won, lost])
      expect(
        (await intentRows(admin(), started.id)).map((intent) => intent.purpose),
      ).toEqual(['donation.succeeded']);
  });

  /* ===========================================================================
   * Nothing secret is ever stored
   * ========================================================================= */

  it('stores no status token, secret, signature, checkout URL or webhook payload anywhere', async () => {
    const stored = await everyStoredValue(admin());
    expect(stored.length).toBeGreaterThan(1000);
    expect(tokens.length).toBeGreaterThan(5);
    expect(seenSignatures.length).toBeGreaterThan(20);
    for (const token of tokens) expect(stored).not.toContain(token);
    for (const secret of [SECRET_KEY, WEBHOOK_SECRET, 'sk_fixture_', 'whsec_'])
      expect(stored).not.toContain(secret);
    for (const signature of seenSignatures)
      for (const part of signature.split(','))
        if (part.startsWith('v1=') || part.startsWith('v0='))
          expect(stored).not.toContain(part.slice(3));
    expect(stored).not.toContain('/c/pay/');
    expect(stored).not.toContain(simulator.origin);
    for (const fragment of [
      '"object":"event"',
      '"data":{"object"',
      'pending_webhooks',
      'livemode',
    ])
      expect(stored).not.toContain(fragment);
  });
});
