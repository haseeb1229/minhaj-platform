import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CHECKOUT_LIFETIME_SECONDS,
  CREATE_REPLAY_WINDOW_SECONDS,
  CURRENCY_EXPONENTS,
  DONATION_COMMUNICATION_PURPOSES,
  DONATION_EXPORT_SCHEMA,
  DONATION_EXPORT_VERSION,
  MONEY_MINOR_MAX,
  OWN_DONATION_HISTORY,
  deriveDonationState,
  formatExactAmount,
  mergeProviderTruth,
  parseExactAmount,
  type CheckoutCreation,
  type DonationActivationRecord,
  type DonationBeginInput,
  type DonationCommunicationIntentRecord,
  type DonationCurrency,
  type DonationFacts,
  type DonationRecord,
  type DonationRefundRecord,
  type PaymentLookup,
  type PaymentObservation,
  type PaymentProviderCapabilities,
  type PaymentProviderPort,
  type PaymentScope,
  type ProviderEventNotice,
  type PublicDonationCampaign,
  type RefundLookup,
  type RefundObservation,
  type RefundSubmission,
  type StaffDonation,
  type WebhookVerification,
} from '../../packages/contracts/src/donations/index.ts';
import type {
  DeliveryRecord,
  RateLimitRule,
  RateLimiterPort,
} from '../../packages/contracts/src/platform/index.ts';
import {
  DONATIONS_RATE_RULES,
  DONATIONS_REFUSAL_REASONS,
  DONATION_CSV_COLUMNS,
  checkoutDestination,
  createDonationsAccountService,
  createDonationsAdminService,
  createDonationsCommunicationService,
  createDonationsDonorService,
  createDonationsLedgerService,
  createDonationsOwnerService,
  createDonationsPublicService,
  csvCell,
  donationsFailure,
  isDonationDeliveryPurpose,
  redactReference,
} from '../../apps/web/src/contexts/donations/index.ts';

/**
 * Phase 27 — the Donations services' rules, over recording fakes.
 *
 * WHAT IS PROVED HERE, CHEAPLY: exact money end to end; the convergence of
 * provider truth over EVERY order of a mixed set of observations; the donor
 * flow's order, budgets, activation gate and deterministic checkout creation
 * (one donation per form, an ambiguous create resolved only under its own
 * key, never re-created past the replay window); the exact redirect
 * allowlist; a cancel that loses to provider success; the administration's
 * permission-before-parse rule, the externally gated refund key and the
 * over-refund mapping; the webhook's order of operations and status codes;
 * reconciliation and its back-off; the account disposition; the relay; and
 * that no token, address or email reaches a port. The database's own
 * re-checks are proved by the persistence integration suites.
 *
 * Every identifier and string is a synthetic sentinel.
 */

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const CAMPAIGN_ID = ID(1);
const DONATION_ID = ID(2);
const REFUND_ID = ID(3);
const OPERATION_ID = ID(4);
const TITLE = 'NON_DONATION_FIXTURE_TITLE';
const BASE_URL = 'https://donations-proof.invalid';
const ORIGIN = 'https://checkout.provider-proof.invalid';
const CLIENT = 'client-proof-address';
const EMAIL = 'donor@donations-proof.invalid';
const NOW = new Date('2026-10-18T12:00:00.000Z');
const SCOPE: PaymentScope = {
  provider: 'stripe',
  environment: 'sandbox',
  accountKey: 'acct_proof',
};
const ACTIVATION: DonationActivationRecord = {
  ...SCOPE,
  authority: 'fixture',
  activatedAt: NOW,
};
const USD = (minor: bigint) => ({ currency: 'USD' as const, minor });
const CHECKOUT_REF = 'cs_proof_checkout_000001';
const PAYMENT_REF = 'pi_proof_payment_000001';
const TOKEN = 'T'.repeat(43);
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

const operator = { accountId: 'proof-operator-1' };
const person = { accountId: 'proof-donor-1' };

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return donationsFailure(error);
  }
  return 'accepted';
}

const dataError = (reason: string) => Object.assign(new Error('data'), { reason });

interface Call {
  readonly method: string;
  readonly args: readonly unknown[];
}

/** A port whose every method is recorded and answered by `answer`. */
function recording<T extends object>(
  calls: Call[],
  answer: (method: string, args: readonly unknown[]) => unknown,
  log?: string[],
  prefix = '',
): T {
  return new Proxy(
    {},
    {
      get:
        (_target, method: string) =>
        async (...args: unknown[]) => {
          calls.push({ method, args });
          log?.push(`${prefix}${method}`);
          return answer(method, args);
        },
    },
  ) as T;
}

/* ===========================================================================
 * Fixtures
 * ========================================================================= */

const CAMPAIGN: PublicDonationCampaign = {
  id: CAMPAIGN_ID,
  primaryLocale: 'en',
  displayOrder: 1,
  translations: [
    {
      locale: 'en',
      title: TITLE,
      summary: 'NON_DONATION_SUMMARY',
      description: 'NON_DONATION_TEXT',
    },
    { locale: 'ar', title: 'NON_DONATION_AR_TITLE', summary: 'S', description: 'D' },
  ],
  currencies: [
    {
      currency: 'USD',
      minimumMinor: 100n,
      maximumMinor: 1_000_000n,
      suggestedMinor: [2500n],
    },
    { currency: 'JPY', minimumMinor: 100n, maximumMinor: 1_000_000n, suggestedMinor: [] },
    {
      currency: 'KWD',
      minimumMinor: 1000n,
      maximumMinor: 1_000_000n,
      suggestedMinor: [],
    },
  ],
};

function record(over: Partial<DonationRecord> = {}): DonationRecord {
  return {
    id: DONATION_ID,
    campaignId: CAMPAIGN_ID,
    locale: 'en',
    checkoutLabel: TITLE,
    state: 'pending',
    expected: USD(2500n),
    linked: false,
    scope: SCOPE,
    createState: 'created',
    checkoutReference: CHECKOUT_REF,
    paymentReference: null,
    capturedMinor: null,
    refundedMinor: 0n,
    refundReservedMinor: 0n,
    dispute: 'none',
    attention: null,
    checkoutExpiresAt: null,
    version: 1,
    createdAt: NOW,
    updatedAt: NOW,
    succeededAt: null,
    ...over,
  };
}

function observation(over: Partial<PaymentObservation> = {}): PaymentObservation {
  return {
    scope: SCOPE,
    checkoutReference: CHECKOUT_REF,
    donationReference: DONATION_ID,
    checkout: 'complete',
    payment: 'succeeded',
    paymentReference: PAYMENT_REF,
    amount: USD(2500n),
    capturedMinor: 2500n,
    refundedMinor: 0n,
    dispute: 'none',
    ...over,
  };
}

function refundObservation(over: Partial<RefundObservation> = {}): RefundObservation {
  return {
    scope: SCOPE,
    refundReference: 're_proof_refund_000001',
    refundId: REFUND_ID,
    paymentReference: PAYMENT_REF,
    state: 'succeeded',
    amount: USD(1000n),
    ...over,
  };
}

const CAPABILITIES: PaymentProviderCapabilities = {
  fullRefund: true,
  partialRefund: true,
  checkoutExpiry: true,
  cancelCheckout: true,
  disputes: true,
  transactionLookup: true,
  idempotentCreate: true,
  currencies: ['USD', 'JPY', 'KWD'],
};

interface ProviderOptions {
  readonly scope?: PaymentScope;
  readonly origin?: string;
  readonly currencies?: readonly DonationCurrency[];
  readonly create?: (
    input: Parameters<PaymentProviderPort['createCheckout']>[0],
  ) => CheckoutCreation;
  readonly resume?: () => Awaited<ReturnType<PaymentProviderPort['resumeCheckout']>>;
  readonly cancel?: () => Awaited<ReturnType<PaymentProviderPort['cancelCheckout']>>;
  readonly observe?: (reference: string) => PaymentLookup;
  readonly verify?: () => WebhookVerification;
  readonly refund?: () => RefundSubmission;
  readonly observeRefund?: () => RefundLookup;
}

const created = (url = `${ORIGIN}/c/pay/${CHECKOUT_REF}#fragment`): CheckoutCreation => ({
  outcome: 'created',
  checkoutReference: CHECKOUT_REF,
  checkoutUrl: url,
  expiresAt: new Date(NOW.getTime() + CHECKOUT_LIFETIME_SECONDS * 1000),
});

function fakeProvider(log: string[], options: ProviderOptions = {}) {
  const calls: Call[] = [];
  const scope = options.scope ?? SCOPE;
  const note = (method: string, args: unknown[]) => {
    calls.push({ method, args });
    log.push(`provider.${method}`);
  };
  const port: PaymentProviderPort = {
    scope: () => scope,
    capabilities: () => ({
      ...CAPABILITIES,
      currencies: options.currencies ?? CAPABILITIES.currencies,
    }),
    checkoutOrigin: () => options.origin ?? ORIGIN,
    async createCheckout(input) {
      note('createCheckout', [input]);
      return options.create ? options.create(input) : created();
    },
    async resumeCheckout(reference) {
      note('resumeCheckout', [reference]);
      return options.resume
        ? options.resume()
        : { outcome: 'open', checkoutUrl: created().checkoutUrl };
    },
    async cancelCheckout(reference) {
      note('cancelCheckout', [reference]);
      return options.cancel ? options.cancel() : 'cancelled';
    },
    async observeCheckout(reference) {
      note('observeCheckout', [reference]);
      return options.observe
        ? options.observe(reference)
        : {
            outcome: 'observed',
            observation: observation({ checkoutReference: reference }),
          };
    },
    verifyWebhook(input) {
      note('verifyWebhook', [input]);
      return options.verify
        ? options.verify()
        : { outcome: 'rejected', reason: 'invalid-signature' };
    },
    async requestRefund(input) {
      note('requestRefund', [input]);
      return options.refund
        ? options.refund()
        : {
            outcome: 'accepted',
            observation: refundObservation({ amount: input.amount }),
          };
    },
    async observeRefund(input) {
      note('observeRefund', [input]);
      return options.observeRefund
        ? options.observeRefund()
        : { outcome: 'observed', observation: refundObservation() };
    },
  };
  return { port, calls };
}

/** A limiter that admits `max` per key, or refuses every key under the named purposes. */
function fakeLimiter(deny: readonly string[] = []) {
  const counts = new Map<string, number>();
  const rules = new Map<string, RateLimitRule>();
  const limiter: RateLimiterPort = {
    async consume(key, rule) {
      const purpose = key.split('|')[0] ?? '';
      rules.set(purpose, rule);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return { allowed: !deny.includes(purpose) && count <= rule.max } as never;
    },
    async purgeExpired() {
      return 0;
    },
  };
  return {
    limiter,
    key: (purpose: string, subject: string) => `${purpose}|${subject}`,
    counts,
    rules,
  };
}

interface Entry {
  record: DonationRecord;
  facts: DonationFacts;
  tokenDigest: string;
}

/**
 * A small in-memory ledger: one store, and the contract's OWN merge and
 * derivation, so a sequence of service calls ends where the adapter would.
 */
function world(
  options: {
    readonly provider?: ProviderOptions | null;
    readonly activation?: DonationActivationRecord | null;
    readonly campaigns?: readonly PublicDonationCampaign[];
    readonly deny?: readonly string[];
    readonly clock?: () => Date;
    readonly seed?: readonly DonationRecord[];
  } = {},
) {
  const log: string[] = [];
  const calls: Call[] = [];
  const store = new Map<string, Entry>();
  let clock = options.clock ?? (() => NOW);
  let serial = 100;
  const nextId = () => ID((serial += 1));

  const remember = (donation: DonationRecord, tokenDigest = digest(TOKEN)) =>
    store.set(donation.id, {
      record: donation,
      tokenDigest,
      facts: {
        capturedMinor: donation.capturedMinor,
        refundedMinor: donation.refundedMinor,
        dispute: donation.dispute,
        closure: null,
        cancelRequested: false,
      },
    });
  for (const donation of options.seed ?? []) remember(donation);

  const byOperation = new Map<string, { digest: string; id: string }>();
  const update = (id: string, change: Partial<DonationRecord>): DonationRecord => {
    const entry = store.get(id);
    if (entry === undefined) throw dataError('not-found');
    entry.record = { ...entry.record, ...change, version: entry.record.version + 1 };
    return entry.record;
  };
  const view = (entry: Entry) => ({
    state: entry.record.state,
    expected: entry.record.expected,
    refundedMinor: entry.record.refundedMinor,
    environment: entry.record.scope.environment,
    campaign: { campaignId: CAMPAIGN_ID, primaryLocale: 'en' as const, translations: [] },
    createdAt: entry.record.createdAt,
    updatedAt: entry.record.updatedAt,
    cancellable: entry.record.state === 'pending',
  });
  const note = (method: string, args: unknown[]) => {
    calls.push({ method, args });
    log.push(method);
  };

  const donor = {
    async begin(input: DonationBeginInput) {
      note('donor.begin', [input]);
      const existing = byOperation.get(input.operationId);
      if (existing !== undefined) {
        if (existing.digest !== input.requestDigest)
          throw dataError('operation-conflict');
        return { donation: store.get(existing.id)!.record, created: false };
      }
      const donation = record({
        id: input.id,
        campaignId: input.campaignId,
        locale: input.locale,
        checkoutLabel: input.checkoutLabel,
        expected: input.expected,
        linked: input.donorAccountId !== null,
        scope: input.scope,
        createState: 'pending',
        checkoutReference: null,
        createdAt: clock(),
        updatedAt: clock(),
      });
      byOperation.set(input.operationId, { digest: input.requestDigest, id: input.id });
      remember(donation, input.statusTokenDigest);
      return { donation, created: true };
    },
    async recordCheckout(input: {
      id: string;
      checkoutReference: string;
      expiresAt: Date;
    }) {
      note('donor.recordCheckout', [input]);
      return update(input.id, {
        createState: 'created',
        checkoutReference: input.checkoutReference,
        checkoutExpiresAt: input.expiresAt,
      });
    },
    async recordCreateOutcome(input: { id: string; outcome: 'ambiguous' | 'rejected' }) {
      note(`donor.recordCreateOutcome:${input.outcome}`, [input]);
      return update(input.id, {
        createState: input.outcome,
        ...(input.outcome === 'rejected' ? { state: 'failed' as const } : {}),
      });
    },
    async donationByToken(tokenDigest: string) {
      note('donor.donationByToken', [tokenDigest]);
      return (
        [...store.values()].find((entry) => entry.tokenDigest === tokenDigest)?.record ??
        null
      );
    },
    async statusByToken(tokenDigest: string) {
      note('donor.statusByToken', [tokenDigest]);
      const entry = [...store.values()].find(
        (candidate) => candidate.tokenDigest === tokenDigest,
      );
      return entry === undefined ? null : view(entry);
    },
    async markCancelRequested(input: { id: string }) {
      note('donor.markCancelRequested', [input]);
      const entry = store.get(input.id)!;
      entry.facts = { ...entry.facts, cancelRequested: true };
      return entry.record;
    },
  };

  const ledgerAnswers = {
    locate: { donationId: DONATION_ID, refundId: null as string | null } as {
      donationId: string;
      refundId: string | null;
    } | null,
    admit: 'process' as 'process' | 'already-processed',
    donationClaims: [] as unknown[],
    refundClaims: [] as unknown[],
  };

  const ledger = {
    async locate(input: unknown) {
      note('ledger.locate', [input]);
      return ledgerAnswers.locate;
    },
    async admitEvent(input: unknown) {
      note('ledger.admitEvent', [input]);
      return ledgerAnswers.admit;
    },
    async completeEvent(input: { result: string }) {
      note(`ledger.completeEvent:${input.result}`, [input]);
    },
    async donation(id: string) {
      note('ledger.donation', [id]);
      return store.get(id)?.record ?? null;
    },
    async applyObservation(input: {
      donationId: string;
      observation: PaymentObservation;
      source: string;
      actorId: string | null;
    }) {
      note(`ledger.applyObservation:${input.source}`, [input]);
      const entry = store.get(input.donationId)!;
      const before = entry.record;
      const result = mergeProviderTruth(
        {
          donationId: before.id,
          scope: before.scope,
          checkoutReference: before.checkoutReference,
          expected: before.expected,
          facts: entry.facts,
        },
        input.observation,
      );
      if (result.verdict === 'attention') {
        entry.record = { ...before, attention: result.attention };
        return { donation: entry.record, changed: before.attention !== result.attention };
      }
      const state = deriveDonationState(result.facts);
      const changed =
        JSON.stringify(result.facts, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v)) !==
        JSON.stringify(entry.facts, (_k, v) => (typeof v === 'bigint' ? `${v}n` : v));
      entry.facts = result.facts;
      entry.record = {
        ...before,
        state,
        capturedMinor: result.facts.capturedMinor,
        refundedMinor: result.facts.refundedMinor,
        dispute: result.facts.dispute,
        paymentReference: before.paymentReference ?? result.paymentReference,
        version: before.version + (changed ? 1 : 0),
      };
      return { donation: entry.record, changed };
    },
    async applyRefundObservation(input: {
      refundId: string;
      observation: RefundObservation;
    }) {
      note('ledger.applyRefundObservation', [input]);
      const donation = [...store.values()][0]!.record;
      return {
        refund: refundRecord({ state: input.observation.state }),
        donation,
        changed: true,
      };
    },
    async claimDueDonations(...args: unknown[]) {
      note('ledger.claimDueDonations', args);
      return ledgerAnswers.donationClaims;
    },
    async claimDueRefunds(...args: unknown[]) {
      note('ledger.claimDueRefunds', args);
      return ledgerAnswers.refundClaims;
    },
    async deferDonation(input: unknown) {
      note('ledger.deferDonation', [input]);
    },
    async deferRefund(input: unknown) {
      note('ledger.deferRefund', [input]);
    },
  };

  const provider =
    options.provider === null ? null : fakeProvider(log, options.provider ?? {});
  const limits = fakeLimiter(options.deny);
  const catalogue = {
    async publishedCampaigns() {
      note('catalogue.publishedCampaigns', []);
      return options.campaigns ?? [CAMPAIGN];
    },
  };
  const activation = {
    async activation() {
      return options.activation === undefined ? ACTIVATION : options.activation;
    },
  };

  const donorService = createDonationsDonorService({
    donor: donor as never,
    catalogue,
    activation,
    ledger: ledger as never,
    provider: provider?.port ?? null,
    limiter: limits.limiter,
    key: limits.key,
    baseUrl: BASE_URL,
    ids: nextId,
    clock: () => clock(),
    tokens: () => TOKEN,
  });
  const ledgerService = createDonationsLedgerService({
    ledger: ledger as never,
    donor: donor as never,
    refunds: {
      async recordSubmission(input) {
        note('refunds.recordSubmission', [input]);
        return {} as never;
      },
    },
    provider: provider?.port ?? null,
    baseUrl: BASE_URL,
    clock: () => clock(),
  });

  return {
    log,
    calls,
    store,
    donor,
    ledger,
    ledgerAnswers,
    provider,
    limits,
    donorService,
    ledgerService,
    setClock(next: () => Date) {
      clock = next;
    },
  };
}

function refundRecord(over: Partial<DonationRefundRecord> = {}): DonationRefundRecord {
  return {
    id: REFUND_ID,
    donationId: DONATION_ID,
    amount: USD(1000n),
    state: 'requested',
    refundReference: null,
    requestedAt: NOW,
    completedAt: null,
    version: 1,
    ...over,
  };
}

const startForm = (over: Record<string, unknown> = {}) => ({
  operationId: OPERATION_ID,
  campaignId: CAMPAIGN_ID,
  currency: 'USD',
  amount: '25.00',
  ...over,
});

/** The status tokens each world's start calls handed out, in order. */
const ISSUED = new WeakMap<object, string[]>();
const issuedOf = (w: ReturnType<typeof world>): string[] => {
  const issued = ISSUED.get(w) ?? [];
  ISSUED.set(w, issued);
  return issued;
};

const start = (
  w: ReturnType<typeof world>,
  over: Record<string, unknown> = {},
  extra: { locale?: 'en' | 'ur' | 'ar'; account?: { accountId: string } | null } = {},
) =>
  w.donorService.start({
    form: startForm(over),
    locale: extra.locale ?? 'en',
    clientAddress: CLIENT,
    account: extra.account ?? null,
    issueStatusToken: async (token) => {
      w.log.push('issueStatusToken');
      issuedOf(w).push(token);
    },
  });

/* ===========================================================================
 * Vocabulary and exact money
 * ========================================================================= */

describe('Donations refusal vocabulary', () => {
  it('names exactly the accepted reasons, and maps anything else to unavailable', () => {
    expect([...DONATIONS_REFUSAL_REASONS]).toEqual([
      'denied',
      'not-found',
      'conflict',
      'invalid',
      'invalid-state',
      'incomplete',
      'limit',
      'rate-limited',
      'unavailable',
      'not-activated',
      'campaign-unavailable',
      'amount-refused',
      'operation-conflict',
      'account-closed',
      'over-refund',
      'provider-unavailable',
      'already-submitted',
    ]);
    expect(donationsFailure(dataError('over-refund'))).toBe('over-refund');
    expect(donationsFailure(dataError('P2010'))).toBe('unavailable');
    expect(donationsFailure(new Error('boom'))).toBe('unavailable');
  });
});

describe('exact money', () => {
  it('parses decimal text into exact minor units per currency exponent', () => {
    expect(parseExactAmount('1250', 'JPY')).toBe(1250n);
    expect(parseExactAmount('12.50', 'USD')).toBe(1250n);
    expect(parseExactAmount('12.5', 'USD')).toBe(1250n);
    expect(parseExactAmount('0.01', 'USD')).toBe(1n);
    expect(parseExactAmount('1.250', 'KWD')).toBe(1250n);
    expect(parseExactAmount('0.005', 'KWD')).toBe(5n);
  });

  it('refuses zero, too many decimals, signs, grouping, exponents and locale digits', () => {
    for (const [text, currency] of [
      ['0', 'USD'],
      ['0.00', 'USD'],
      ['0', 'JPY'],
      ['12.5', 'JPY'],
      ['1.005', 'USD'],
      ['1.2505', 'KWD'],
      ['-1', 'USD'],
      ['+1', 'USD'],
      ['1,000', 'USD'],
      ['1e3', 'USD'],
      ['١٢', 'USD'],
      ['۱۲', 'USD'],
      [' 1', 'USD'],
      ['1 ', 'USD'],
      ['.5', 'USD'],
      ['1.', 'USD'],
      ['01', 'USD'],
      ['', 'USD'],
      ['NaN', 'USD'],
      ['Infinity', 'USD'],
    ] as const)
      expect(parseExactAmount(text, currency), `${text} ${currency}`).toBeNull();
  });

  it('holds the maximum bound exactly, with no float rounding at the edge', () => {
    expect(parseExactAmount('999999999999', 'JPY')).toBe(MONEY_MINOR_MAX);
    expect(parseExactAmount('1000000000000', 'JPY')).toBeNull();
    expect(parseExactAmount('9999999999.99', 'USD')).toBe(MONEY_MINOR_MAX);
    expect(parseExactAmount('9999999999.991', 'USD')).toBeNull();
    expect(parseExactAmount('999999999.999', 'KWD')).toBe(MONEY_MINOR_MAX);
    // 0.1 + 0.2 is the classic float failure; exact text never meets a float.
    expect(parseExactAmount('0.30', 'USD')).toBe(30n);
  });

  it('formats exact minor units back to canonical text, and round-trips every currency', () => {
    expect(formatExactAmount(1250n, 'USD')).toBe('12.50');
    expect(formatExactAmount(5n, 'USD')).toBe('0.05');
    expect(formatExactAmount(1250n, 'JPY')).toBe('1250');
    expect(formatExactAmount(1250n, 'KWD')).toBe('1.250');
    expect(formatExactAmount(5n, 'KWD')).toBe('0.005');
    expect(formatExactAmount(MONEY_MINOR_MAX, 'USD')).toBe('9999999999.99');
    expect(() => formatExactAmount(-1n, 'USD')).toThrow(RangeError);
    for (const currency of Object.keys(CURRENCY_EXPONENTS) as DonationCurrency[])
      for (const minor of [1n, 7n, 10n, 999n, 1000n, 123456789n, MONEY_MINOR_MAX])
        expect(
          parseExactAmount(formatExactAmount(minor, currency), currency),
          currency,
        ).toBe(minor);
  });

  it('never uses a floating-point path for money in the context', async () => {
    const root = path.resolve('apps/web/src/contexts/donations');
    const files: string[] = [];
    const walk = async (directory: string) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const child = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(child);
        else if (child.endsWith('.ts')) files.push(child);
      }
    };
    await walk(root);
    expect(files.length).toBeGreaterThan(8);
    for (const file of files) {
      const source = (await readFile(file, 'utf8')).replace(
        /\/\*[\s\S]*?\*\/|\/\/.*$/gmu,
        '',
      );
      expect(source, file).not.toMatch(
        /parseFloat|parseInt|Number\(|toFixed|Math\.round|\* ?100\b/u,
      );
    }
  });
});

/* ===========================================================================
 * Provider truth converges
 * ========================================================================= */

function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [items.slice()];
  const result: T[][] = [];
  items.forEach((item, index) => {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const tail of permutations(rest)) result.push([item, ...tail]);
  });
  return result;
}

const INITIAL: DonationFacts = {
  capturedMinor: null,
  refundedMinor: 0n,
  dispute: 'none',
  closure: null,
  cancelRequested: false,
};

function replay(
  observations: readonly PaymentObservation[],
  facts: DonationFacts = INITIAL,
) {
  let current = facts;
  for (const observed of observations) {
    const result = mergeProviderTruth(
      {
        donationId: DONATION_ID,
        scope: SCOPE,
        checkoutReference: CHECKOUT_REF,
        expected: USD(2500n),
        facts: current,
      },
      observed,
    );
    if (result.verdict === 'apply') current = result.facts;
  }
  return current;
}

describe('mergeProviderTruth converges over every order', () => {
  const MIXED: Record<string, PaymentObservation> = {
    pending: observation({
      checkout: 'open',
      payment: 'none',
      paymentReference: null,
      capturedMinor: null,
    }),
    succeeded: observation(),
    partial: observation({ refundedMinor: 1000n }),
    full: observation({ refundedMinor: 2500n }),
    disputeOpen: observation({ dispute: 'open' }),
    disputeWon: observation({ dispute: 'won' }),
    stalePending: observation({
      checkout: 'complete',
      payment: 'processing',
      capturedMinor: null,
    }),
    wrongAmount: observation({ amount: USD(2600n), capturedMinor: 2600n }),
  };

  it('ends in identical facts for all 40320 orders of a mixed observation set', () => {
    const orders = permutations(Object.values(MIXED));
    expect(orders).toHaveLength(40320);
    const expected: DonationFacts = {
      capturedMinor: 2500n,
      refundedMinor: 2500n,
      dispute: 'won',
      closure: null,
      cancelRequested: false,
    };
    for (const order of orders) expect(replay(order)).toEqual(expected);
    expect(deriveDonationState(expected)).toBe('refunded');
  });

  it('never lets a late pending, failure or expiry regress a verified success', () => {
    const late = [
      MIXED.pending!,
      MIXED.stalePending!,
      observation({ checkout: 'expired', payment: 'canceled', capturedMinor: null }),
      observation({ checkout: 'complete', payment: 'failed', capturedMinor: null }),
    ];
    for (const order of permutations(late)) {
      const facts = replay([MIXED.succeeded!, ...order]);
      expect(deriveDonationState(facts)).toBe('succeeded');
    }
  });

  it('a dispute only moves forward: a stale "open" never overwrites "lost" or "won"', () => {
    for (const end of ['won', 'lost'] as const) {
      const facts = replay([
        MIXED.succeeded!,
        observation({ dispute: end }),
        MIXED.disputeOpen!,
      ]);
      expect(facts.dispute).toBe(end);
    }
    expect(
      deriveDonationState(replay([MIXED.succeeded!, observation({ dispute: 'lost' })])),
    ).toBe('charged_back');
  });

  it('a cancel request followed by expiry reads as cancelled; captured money still wins', () => {
    const cancelled = replay(
      [
        observation({
          checkout: 'expired',
          payment: 'none',
          capturedMinor: null,
          paymentReference: null,
        }),
      ],
      { ...INITIAL, cancelRequested: true },
    );
    expect(deriveDonationState(cancelled)).toBe('cancelled');
    const paid = replay([MIXED.succeeded!], { ...INITIAL, cancelRequested: true });
    expect(deriveDonationState(paid)).toBe('succeeded');
  });

  it('every mismatch is attention and changes nothing, from every reachable state', () => {
    const mismatches: Record<string, [PaymentObservation, string]> = {
      amount: [observation({ amount: USD(2499n) }), 'amount-mismatch'],
      currency: [
        observation({ amount: { currency: 'EUR', minor: 2500n } }),
        'amount-mismatch',
      ],
      capture: [observation({ capturedMinor: 2400n }), 'amount-mismatch'],
      overRefund: [observation({ refundedMinor: 2600n }), 'amount-mismatch'],
      scope: [
        observation({ scope: { ...SCOPE, accountKey: 'acct_other' } }),
        'provider-mismatch',
      ],
      environment: [
        observation({ scope: { ...SCOPE, environment: 'production' } }),
        'provider-mismatch',
      ],
      checkout: [observation({ checkoutReference: 'cs_other' }), 'provider-mismatch'],
      reference: [observation({ donationReference: ID(99) }), 'provider-mismatch'],
      refundWithoutCapture: [
        observation({ payment: 'processing', capturedMinor: null, refundedMinor: 10n }),
        'provider-mismatch',
      ],
    };
    const reachable = [
      INITIAL,
      replay([MIXED.succeeded!]),
      replay([MIXED.succeeded!, MIXED.partial!]),
    ];
    for (const facts of reachable)
      for (const [name, [observed, attention]] of Object.entries(mismatches)) {
        if (name === 'refundWithoutCapture' && facts.capturedMinor !== null) continue;
        const result = mergeProviderTruth(
          {
            donationId: DONATION_ID,
            scope: SCOPE,
            checkoutReference: CHECKOUT_REF,
            expected: USD(2500n),
            facts,
          },
          observed,
        );
        expect(result, name).toEqual({ verdict: 'attention', attention });
      }
  });
});

/* ===========================================================================
 * The redirect allowlist
 * ========================================================================= */

describe('checkout redirect allowlist', () => {
  it('admits only the exact HTTPS checkout origin', () => {
    expect(checkoutDestination(SCOPE, ORIGIN, `${ORIGIN}/c/pay/cs_1#x`)).toBe(
      `${ORIGIN}/c/pay/cs_1#x`,
    );
    for (const candidate of [
      'https://attacker.invalid/c/pay/cs_1',
      'https://checkout.provider-proof.invalid.attacker.invalid/c',
      'https://checkout.provider-proof.invalid@attacker.invalid/c',
      'https://user:pass@checkout.provider-proof.invalid/c',
      'https://user@checkout.provider-proof.invalid/c',
      'http://checkout.provider-proof.invalid/c',
      'https://checkout.provider-proof.invalid:8443/c',
      'javascript:alert(1)',
      '//attacker.invalid/c',
      '/c/pay/cs_1',
      'not a url',
    ])
      expect(checkoutDestination(SCOPE, ORIGIN, candidate), candidate).toBeNull();
  });

  it('admits plain-HTTP loopback for the fixture simulator only', () => {
    const fixture = { ...SCOPE, environment: 'fixture' as const };
    const loopback = 'http://127.0.0.1:4100';
    expect(checkoutDestination(fixture, loopback, `${loopback}/c/pay/cs_1`)).toBe(
      `${loopback}/c/pay/cs_1`,
    );
    expect(checkoutDestination(SCOPE, loopback, `${loopback}/c/pay/cs_1`)).toBeNull();
    expect(
      checkoutDestination(
        fixture,
        'http://attacker.invalid',
        'http://attacker.invalid/c',
      ),
    ).toBeNull();
    // A configured "origin" that is not exactly an origin is refused outright.
    expect(checkoutDestination(SCOPE, `${ORIGIN}/`, `${ORIGIN}/c`)).toBeNull();
  });
});

/* ===========================================================================
 * The donor
 * ========================================================================= */

describe('starting a donation', () => {
  it('refuses a malformed form before spending any budget or reaching a port', async () => {
    const w = world();
    for (const form of [
      startForm({ amount: undefined }),
      startForm({ extra: 'x' }),
      startForm({ currency: 'XXX' }),
      startForm({ operationId: 'not-a-uuid' }),
    ])
      expect(
        await failure(
          w.donorService.start({
            form,
            locale: 'en',
            clientAddress: CLIENT,
            account: null,
            issueStatusToken: async () => {
              throw new Error('no token is issued for a refused start');
            },
          }),
        ),
      ).toBe('invalid');
    expect(w.limits.counts.size).toBe(0);
    expect(w.calls).toEqual([]);
  });

  it('spends the client budget, and a linked account’s own budget, with the exact rules', async () => {
    expect(DONATIONS_RATE_RULES).toEqual({
      'start-client': { window: 3600, max: 20 },
      'start-account': { window: 3600, max: 20 },
      status: { window: 300, max: 60 },
      check: { window: 300, max: 10 },
      cancel: { window: 3600, max: 10 },
      export: { window: 3600, max: 10 },
    });
    expect(await failure(start(world({ deny: ['donation-start'] })))).toBe(
      'rate-limited',
    );
    const linked = world({ deny: ['donation-start-account'] });
    expect(await failure(start(linked, {}, { account: person }))).toBe('rate-limited');
    expect(linked.calls.map((call) => call.method)).not.toContain('donor.begin');
    const w = world();
    await start(w, {}, { account: person });
    expect([...w.limits.counts.keys()]).toEqual([
      `donation-start|${CLIENT}`,
      `donation-start-account|${person.accountId}`,
    ]);
  });

  it('is refused not-activated without a provider or a permitting activation row', async () => {
    expect(await failure(start(world({ provider: null })))).toBe('not-activated');
    expect(await failure(start(world({ activation: null })))).toBe('not-activated');
    expect(
      await failure(
        start(world({ activation: { ...ACTIVATION, accountKey: 'acct_other' } })),
      ),
    ).toBe('not-activated');
    expect(
      await failure(
        start(
          world({
            provider: { scope: { ...SCOPE, environment: 'production' } },
            activation: {
              ...ACTIVATION,
              environment: 'production',
              authority: 'fixture',
            },
          }),
        ),
      ),
    ).toBe('not-activated');
  });

  it('checks exact money against the campaign policy and the provider capability', async () => {
    expect(await failure(start(world(), { amount: '25.005' }))).toBe('invalid');
    expect(await failure(start(world(), { amount: '0' }))).toBe('invalid');
    expect(await failure(start(world(), { amount: '0.99' }))).toBe('amount-refused');
    expect(await failure(start(world(), { amount: '10000.01' }))).toBe('amount-refused');
    expect(await failure(start(world(), { currency: 'EUR' }))).toBe('amount-refused');
    expect(await failure(start(world({ provider: { currencies: ['JPY'] } })))).toBe(
      'amount-refused',
    );
    expect(await failure(start(world({ campaigns: [] })))).toBe('campaign-unavailable');
  });

  it('creates one donation and its checkout from the row, deterministically', async () => {
    const w = world();
    const result = await start(w, {}, { account: person });
    expect(result).toEqual({
      checkoutUrl: `${ORIGIN}/c/pay/${CHECKOUT_REF}#fragment`,
    });
    expect(issuedOf(w)).toEqual([TOKEN]);
    // The token is handed over once the donation is durable and BEFORE the provider is asked.
    expect(w.log.indexOf('issueStatusToken')).toBeGreaterThan(
      w.log.indexOf('donor.begin'),
    );
    expect(w.log.indexOf('issueStatusToken')).toBeLessThan(
      w.log.indexOf('provider.createCheckout'),
    );

    const begin = w.calls.find((call) => call.method === 'donor.begin')!
      .args[0] as DonationBeginInput;
    expect(begin.expected).toEqual(USD(2500n));
    expect(typeof begin.expected.minor).toBe('bigint');
    expect(begin.statusTokenDigest).toBe(digest(TOKEN));
    expect(begin.requestDigest).toBe(
      digest([CAMPAIGN_ID, 'USD', '2500', person.accountId].join('\n')),
    );
    expect(begin.checkoutLabel).toBe(TITLE);
    expect(begin.donorAccountId).toBe(person.accountId);
    expect(begin.scope).toEqual(SCOPE);

    const create = w.provider!.calls.find((call) => call.method === 'createCheckout')!
      .args[0];
    expect(create).toEqual({
      donationId: begin.id,
      amount: USD(2500n),
      description: TITLE,
      successUrl: `${BASE_URL}/en/donate/return`,
      cancelUrl: `${BASE_URL}/en/donate/return`,
      expiresAt: new Date(NOW.getTime() + CHECKOUT_LIFETIME_SECONDS * 1000),
      idempotencyKey: `donation:${begin.id}`,
    });
    expect(
      w.log.filter((step) => step.startsWith('donor.') || step.startsWith('provider.')),
    ).toEqual(['donor.begin', 'provider.createCheckout', 'donor.recordCheckout']);
  });

  it('labels the checkout in the request locale, falling back to the primary locale', async () => {
    const urdu = world();
    await start(urdu, {}, { locale: 'ur' });
    expect(
      (
        urdu.calls.find((call) => call.method === 'donor.begin')!
          .args[0] as DonationBeginInput
      ).checkoutLabel,
    ).toBe(TITLE);
    const arabic = world();
    await start(arabic, {}, { locale: 'ar' });
    const begin = arabic.calls.find((call) => call.method === 'donor.begin')!
      .args[0] as DonationBeginInput;
    expect(begin.checkoutLabel).toBe('NON_DONATION_AR_TITLE');
    expect(
      (
        arabic.provider!.calls.find((call) => call.method === 'createCheckout')!
          .args[0] as { successUrl: string }
      ).successUrl,
    ).toBe(`${BASE_URL}/ar/donate/return`);
  });

  it('a duplicate submission is the same donation and the same open checkout, with no token', async () => {
    const w = world();
    const first = await start(w);
    const second = await start(w);
    expect(second).toEqual({ checkoutUrl: first.checkoutUrl });
    expect(issuedOf(w)).toHaveLength(1);
    expect(w.store.size).toBe(1);
    expect(
      w.provider!.calls.filter((call) => call.method === 'createCheckout'),
    ).toHaveLength(1);
    expect(w.provider!.calls.map((call) => call.method)).toContain('resumeCheckout');
  });

  it('a duplicate whose checkout closed is already-submitted; a changed request is an operation conflict', async () => {
    const closed = world({ provider: { resume: () => ({ outcome: 'closed' }) } });
    await start(closed);
    expect(await failure(start(closed))).toBe('already-submitted');
    const changed = world();
    await start(changed);
    expect(await failure(start(changed, { amount: '30.00' }))).toBe('operation-conflict');
  });

  it('an ambiguous create is resolved only under the SAME key with byte-identical parameters', async () => {
    let answer: CheckoutCreation = { outcome: 'unknown' };
    const w = world({ provider: { create: () => answer } });
    expect(await failure(start(w))).toBe('provider-unavailable');
    expect(w.log).toContain('donor.recordCreateOutcome:ambiguous');
    // The donor already holds the way back, although the create was ambiguous.
    expect(issuedOf(w)).toEqual([TOKEN]);
    answer = created();
    await start(w);
    expect(issuedOf(w)).toHaveLength(1);
    const creates = w.provider!.calls.filter((call) => call.method === 'createCheckout');
    expect(creates).toHaveLength(2);
    expect(creates[1]!.args[0]).toEqual(creates[0]!.args[0]);
    expect(w.store.size).toBe(1);
    // Recorded ambiguous once, on the way out of `pending` — not again.
    expect(
      w.log.filter((step) => step === 'donor.recordCreateOutcome:ambiguous'),
    ).toHaveLength(1);
  });

  it('never repeats a create past the replay window', async () => {
    const w = world({ provider: { create: () => ({ outcome: 'unknown' }) } });
    await failure(start(w));
    w.setClock(() => new Date(NOW.getTime() + (CREATE_REPLAY_WINDOW_SECONDS + 1) * 1000));
    expect(await failure(start(w))).toBe('provider-unavailable');
    expect(
      w.provider!.calls.filter((call) => call.method === 'createCheckout'),
    ).toHaveLength(1);
  });

  it('a provider refusal closes the donation and reads as amount-refused', async () => {
    const w = world({
      provider: { create: () => ({ outcome: 'rejected', reason: 'unsupported-amount' }) },
    });
    expect(await failure(start(w))).toBe('amount-refused');
    expect(w.log).toContain('donor.recordCreateOutcome:rejected');
  });

  it('never redirects to a foreign, userinfo or plain-HTTP checkout URL', async () => {
    for (const url of [
      'https://attacker.invalid/c/pay/cs_1',
      `https://user@checkout.provider-proof.invalid/c`,
      'http://checkout.provider-proof.invalid/c',
    ]) {
      const w = world({ provider: { create: () => created(url) } });
      expect(await failure(start(w)), url).toBe('provider-unavailable');
      expect(w.log, url).not.toContain('donor.recordCheckout');
      expect(w.log, url).toContain('donor.recordCreateOutcome:ambiguous');
    }
    const resumed = world({
      provider: {
        resume: () => ({ outcome: 'open', checkoutUrl: 'https://attacker.invalid/c' }),
      },
    });
    await start(resumed);
    expect(await failure(start(resumed))).toBe('provider-unavailable');
  });

  it('a provider that throws is unknown, never created', async () => {
    const w = world({
      provider: {
        create: () => {
          throw new Error('network');
        },
      },
    });
    expect(await failure(start(w))).toBe('provider-unavailable');
    expect(w.log).toContain('donor.recordCreateOutcome:ambiguous');
  });
});

describe('the status token', () => {
  it('reads one donation by the digest of a well-formed token; anything else is null', async () => {
    const w = world({ seed: [record()] });
    expect(await w.donorService.status('short', CLIENT)).toBeNull();
    expect(await w.donorService.status(`${'T'.repeat(42)}=`, CLIENT)).toBeNull();
    expect(await w.donorService.status('U'.repeat(43), CLIENT)).toBeNull();
    const view = await w.donorService.status(TOKEN, CLIENT);
    expect(view?.state).toBe('pending');
    // The token itself never reaches a port; only its digest does.
    expect(JSON.stringify(w.calls)).not.toContain(TOKEN);
  });

  it('spends each act’s own budget per client, before the token is looked at', async () => {
    for (const [purpose, act] of [
      ['donation-status', 'status'],
      ['donation-check', 'check'],
      ['donation-cancel', 'cancel'],
    ] as const) {
      const w = world({ seed: [record()], deny: [purpose] });
      expect(await failure(w.donorService[act]('bad', CLIENT)), act).toBe('rate-limited');
      expect(w.calls, act).toEqual([]);
    }
  });

  it('check asks the provider about a pending created checkout, and changes nothing on its own', async () => {
    const pending = world({
      seed: [record()],
      provider: {
        observe: () => ({
          outcome: 'observed',
          observation: observation({
            checkout: 'open',
            payment: 'none',
            capturedMinor: null,
          }),
        }),
      },
    });
    const view = await pending.donorService.check(TOKEN, CLIENT);
    expect(view?.state).toBe('pending');
    expect(pending.log).toContain('ledger.applyObservation:donor-check');

    const paid = world({ seed: [record()] });
    expect((await paid.donorService.check(TOKEN, CLIENT))?.state).toBe('succeeded');

    const settled = world({
      seed: [record({ state: 'succeeded', capturedMinor: 2500n })],
    });
    await settled.donorService.check(TOKEN, CLIENT);
    expect(settled.provider!.calls).toEqual([]);

    const unanswered = world({
      seed: [record()],
      provider: { observe: () => ({ outcome: 'unknown' }) },
    });
    expect((await unanswered.donorService.check(TOKEN, CLIENT))?.state).toBe('pending');
    expect(unanswered.log).not.toContain('ledger.applyObservation:donor-check');
  });

  it('cancel loses to provider success: a payment that completed first stands', async () => {
    const w = world({ seed: [record()], provider: { cancel: () => 'not-open' } });
    const view = await w.donorService.cancel(TOKEN, CLIENT);
    expect(view?.state).toBe('succeeded');
    expect(w.log.filter((step) => !step.startsWith('donor.donationByToken'))).toEqual([
      'donor.markCancelRequested',
      'provider.cancelCheckout',
      'provider.observeCheckout',
      'ledger.applyObservation:donor-check',
      'donor.statusByToken',
    ]);
  });

  it('cancel of an open checkout ends as cancelled once the provider reports it expired', async () => {
    const w = world({
      seed: [record()],
      provider: {
        observe: () => ({
          outcome: 'observed',
          observation: observation({
            checkout: 'expired',
            payment: 'none',
            capturedMinor: null,
            paymentReference: null,
          }),
        }),
      },
    });
    expect((await w.donorService.cancel(TOKEN, CLIENT))?.state).toBe('cancelled');
  });

  it('cancel of a settled donation changes nothing', async () => {
    const w = world({ seed: [record({ state: 'failed' })] });
    expect((await w.donorService.cancel(TOKEN, CLIENT))?.state).toBe('failed');
    expect(w.log).not.toContain('donor.markCancelRequested');
    expect(w.provider!.calls).toEqual([]);
  });
});

/* ===========================================================================
 * Public page and owner
 * ========================================================================= */

describe('the public giving page', () => {
  const service = (
    activation: DonationActivationRecord | null,
    scope: PaymentScope | null,
    capabilities: PaymentProviderCapabilities | null = {
      ...CAPABILITIES,
      currencies: ['USD'],
    },
  ) =>
    createDonationsPublicService({
      catalogue: { publishedCampaigns: async () => [CAMPAIGN] },
      activation: { activation: async () => activation },
      scope,
      capabilities,
    });

  it('is available only when the activation row permits the configured scope', async () => {
    expect((await service(ACTIVATION, SCOPE).page()).availability).toEqual({
      available: true,
      environment: 'sandbox',
    });
    for (const [activation, scope] of [
      [null, SCOPE],
      [ACTIVATION, null],
      [{ ...ACTIVATION, accountKey: 'acct_other' }, SCOPE],
    ] as const)
      expect((await service(activation, scope).page()).availability).toEqual({
        available: false,
      });
  });

  it('offers only the provider’s currencies when open, and still lists campaigns when not', async () => {
    const open = await service(ACTIVATION, SCOPE).page();
    expect(open.campaigns[0]!.currencies.map((policy) => policy.currency)).toEqual([
      'USD',
    ]);
    const closed = await service(null, SCOPE).page();
    expect(closed.campaigns).toHaveLength(1);
  });
});

describe('the owner', () => {
  it('reads only the session account’s bounded history, and exports deterministically', async () => {
    const calls: Call[] = [];
    const limits = fakeLimiter();
    const owner = createDonationsOwnerService({
      owner: recording(calls, (method) =>
        method === 'history' ? [] : [{ id: DONATION_ID }],
      ),
      limiter: limits.limiter,
      key: limits.key,
      clock: () => NOW,
    });
    await owner.history(person);
    expect(calls[0]).toEqual({
      method: 'history',
      args: [person.accountId, OWN_DONATION_HISTORY],
    });
    expect(await owner.export(person)).toEqual({
      schema: DONATION_EXPORT_SCHEMA,
      version: DONATION_EXPORT_VERSION,
      generatedAt: NOW.toISOString(),
      donations: [{ id: DONATION_ID }],
    });
    expect(await failure(owner.history({ accountId: '' }))).toBe('denied');
  });

  it('spends the export budget', async () => {
    const limits = fakeLimiter(['donation-export']);
    const owner = createDonationsOwnerService({
      owner: recording([], () => []),
      limiter: limits.limiter,
      key: limits.key,
    });
    expect(await failure(owner.export(person))).toBe('rate-limited');
  });
});

/* ===========================================================================
 * Administration
 * ========================================================================= */

const CHANGES = {
  createCampaign: { primaryLocale: 'en', displayOrder: 1 },
  reorderCampaign: { id: CAMPAIGN_ID, expectedVersion: 1, displayOrder: 2 },
  saveTranslation: {
    id: CAMPAIGN_ID,
    expectedVersion: 1,
    translation: { locale: 'ur', title: 'T', summary: 'S', description: 'D' },
  },
  saveCurrencyPolicy: {
    id: CAMPAIGN_ID,
    expectedVersion: 1,
    currency: 'USD',
    minimum: '1.00',
    maximum: '100',
    suggested: ['5', '', '10.50'],
  },
  removeCurrencyPolicy: { id: CAMPAIGN_ID, expectedVersion: 1, currency: 'USD' },
  transitionCampaign: { id: CAMPAIGN_ID, expectedVersion: 1, to: 'published' },
  reconcile: { id: DONATION_ID, expectedVersion: 1 },
} as const;
type Change = keyof typeof CHANGES;
const CHANGE_NAMES = Object.keys(CHANGES) as Change[];
const QUERY = {
  state: null,
  campaignId: null,
  environment: null,
  donor: null,
  attention: false,
  offset: 0,
};
const REFUND_FORM = {
  operationId: OPERATION_ID,
  donationId: DONATION_ID,
  expectedVersion: 3,
  amount: '10.00',
};

function admin(
  options: {
    readonly permissions?: readonly string[];
    readonly donation?: DonationRecord | null;
    readonly provider?: ProviderOptions | null;
    readonly reserve?: () => unknown;
    readonly rows?: readonly StaffDonation[];
  } = {},
) {
  const w = world({
    provider: options.provider,
    seed:
      options.donation === null
        ? []
        : [
            options.donation ??
              record({
                state: 'succeeded',
                capturedMinor: 2500n,
                paymentReference: PAYMENT_REF,
                version: 3,
              }),
          ],
  });
  const calls: Call[] = [];
  const asked: string[] = [];
  const port = recording<never>(
    calls,
    (method, args) => {
      if (method === 'reserve') {
        if (options.reserve) return options.reserve();
        const input = args[0] as { refundId: string; amount: unknown };
        return {
          refund: refundRecord({ id: input.refundId, amount: input.amount as never }),
          created: true,
        };
      }
      if (method === 'recordSubmission') {
        const input = args[0] as { outcome: string };
        return refundRecord({
          state: input.outcome === 'rejected' ? 'failed' : 'requested',
        });
      }
      if (method === 'exportRows') return options.rows ?? [];
      if (method === 'requestReconcile') return w.store.get(DONATION_ID)?.record ?? null;
      if (method === 'campaigns') return [];
      return { id: CAMPAIGN_ID };
    },
    w.log,
    'port.',
  );
  const service = createDonationsAdminService({
    campaigns: port,
    staff: port,
    refunds: port,
    ledger: w.ledger as never,
    provider: w.provider?.port ?? null,
    authority: {
      async permits(accountId, permission) {
        asked.push(`${accountId}:${permission}`);
        return (options.permissions ?? []).includes(permission);
      },
    },
    ids: () => REFUND_ID,
    clock: () => NOW,
  });
  return { w, calls, asked, service };
}

describe('Donations administration', () => {
  const ALL = ['donations.read', 'donations.administer', 'donations.refund'];

  it('asks for exactly its own key BEFORE parsing — a caller without it learns nothing', async () => {
    for (const name of CHANGE_NAMES) {
      const { service, calls, asked } = admin({
        permissions: ['donations.read', 'donations.refund'],
      });
      expect(await failure(service[name](operator, { garbage: true })), name).toBe(
        'denied',
      );
      expect(await failure(service[name](operator, CHANGES[name])), name).toBe('denied');
      expect(calls, name).toEqual([]);
      expect(asked, name).toEqual([
        `${operator.accountId}:donations.administer`,
        `${operator.accountId}:donations.administer`,
      ]);
    }
    for (const read of ['campaigns', 'donations', 'exportCsv'] as const) {
      const { service, calls } = admin({
        permissions: ['donations.administer', 'donations.refund'],
      });
      expect(await failure(service[read](operator, { garbage: true })), read).toBe(
        'denied',
      );
      expect(calls, read).toEqual([]);
    }
    const { service } = admin({
      permissions: ['donations.administer', 'donations.refund'],
    });
    expect(await failure(service.donation(operator, DONATION_ID))).toBe('denied');
    expect(await failure(service.campaign(operator, CAMPAIGN_ID))).toBe('denied');
  });

  it('with the key, a malformed input is invalid and reaches no port', async () => {
    for (const name of CHANGE_NAMES) {
      const { service, calls } = admin({ permissions: ALL });
      expect(await failure(service[name](operator, { garbage: true })), name).toBe(
        'invalid',
      );
      expect(calls, name).toEqual([]);
    }
  });

  it('a refund needs donations.refund — read and administer confer nothing', async () => {
    const { service, w, asked } = admin({
      permissions: ['donations.read', 'donations.administer'],
    });
    expect(await failure(service.refund(operator, REFUND_FORM))).toBe('denied');
    expect(await failure(service.refund(operator, { junk: 1 }))).toBe('denied');
    expect(asked.every((entry) => entry.endsWith(':donations.refund'))).toBe(true);
    expect(w.provider!.calls).toEqual([]);
    expect(
      await failure(
        admin({ permissions: ALL }).service.refund({ accountId: '' }, REFUND_FORM),
      ),
    ).toBe('denied');
  });

  it('parses a currency policy exactly in its own currency', async () => {
    const { service, calls } = admin({ permissions: ALL });
    await service.saveCurrencyPolicy(operator, CHANGES.saveCurrencyPolicy);
    expect(calls[0]!.args[0]).toEqual({
      actorId: operator.accountId,
      id: CAMPAIGN_ID,
      expectedVersion: 1,
      policy: {
        currency: 'USD',
        minimumMinor: 100n,
        maximumMinor: 10_000n,
        suggestedMinor: [500n, 1050n],
      },
    });
    const kwd = admin({ permissions: ALL });
    await kwd.service.saveCurrencyPolicy(operator, {
      ...CHANGES.saveCurrencyPolicy,
      currency: 'KWD',
      minimum: '1.250',
      suggested: [],
    });
    expect(
      (kwd.calls[0]!.args[0] as { policy: { minimumMinor: bigint } }).policy.minimumMinor,
    ).toBe(1250n);
    for (const bad of [
      { minimum: '1.005' },
      { currency: 'JPY', minimum: '1.5' },
      { minimum: '0' },
      { minimum: '200', maximum: '100' },
      { suggested: ['500'] },
      { suggested: ['5', '5'] },
      { suggested: ['1', '2', '3', '4'] },
    ]) {
      const { service: each, calls: eachCalls } = admin({ permissions: ALL });
      expect(
        await failure(
          each.saveCurrencyPolicy(operator, { ...CHANGES.saveCurrencyPolicy, ...bad }),
        ),
        JSON.stringify(bad),
      ).toBe('invalid');
      expect(eachCalls).toEqual([]);
    }
  });

  it('refunds: reserve, then request under the refund’s own key, then apply and re-observe the payment', async () => {
    const { service, calls, w } = admin({ permissions: ALL });
    const result = await service.refund(operator, REFUND_FORM);
    expect(result.submission).toBe('accepted');
    expect(calls[0]!.method).toBe('reserve');
    expect(calls[0]!.args[0]).toEqual({
      refundId: REFUND_ID,
      operationId: OPERATION_ID,
      requestDigest: digest([DONATION_ID, 'USD', '1000'].join('\n')),
      donationId: DONATION_ID,
      expectedVersion: 3,
      amount: USD(1000n),
      actorId: operator.accountId,
    });
    expect(
      w.provider!.calls.find((call) => call.method === 'requestRefund')!.args[0],
    ).toEqual({
      refundId: REFUND_ID,
      donationId: DONATION_ID,
      paymentReference: PAYMENT_REF,
      amount: USD(1000n),
      idempotencyKey: `refund:${REFUND_ID}`,
    });
    expect(w.log.filter((step) => !step.startsWith('ledger.donation'))).toEqual([
      'port.reserve',
      'provider.requestRefund',
      'ledger.applyRefundObservation',
      'provider.observeCheckout',
      'ledger.applyObservation:operator',
    ]);
  });

  it('maps over-refund, state, amount and provider refusals', async () => {
    const over = admin({ permissions: ALL });
    expect(
      await failure(over.service.refund(operator, { ...REFUND_FORM, amount: '25.01' })),
    ).toBe('over-refund');
    expect(over.calls).toEqual([]);
    const reserved = admin({
      permissions: ALL,
      donation: record({
        state: 'partially_refunded',
        capturedMinor: 2500n,
        refundedMinor: 2000n,
        refundReservedMinor: 2000n,
        paymentReference: PAYMENT_REF,
      }),
    });
    expect(await failure(reserved.service.refund(operator, REFUND_FORM))).toBe(
      'over-refund',
    );
    const racing = admin({
      permissions: ALL,
      reserve: () => Promise.reject(dataError('over-refund')),
    });
    expect(await failure(racing.service.refund(operator, REFUND_FORM))).toBe(
      'over-refund',
    );
    expect(racing.w.provider!.calls).toEqual([]);
    expect(
      await failure(
        admin({ permissions: ALL }).service.refund(operator, {
          ...REFUND_FORM,
          amount: '1.005',
        }),
      ),
    ).toBe('invalid');
    expect(
      await failure(
        admin({ permissions: ALL, donation: record() }).service.refund(
          operator,
          REFUND_FORM,
        ),
      ),
    ).toBe('invalid-state');
    expect(
      await failure(
        admin({
          permissions: ALL,
          donation: record({
            state: 'charged_back',
            capturedMinor: 2500n,
            dispute: 'lost',
            paymentReference: PAYMENT_REF,
          }),
        }).service.refund(operator, REFUND_FORM),
      ),
    ).toBe('invalid-state');
    expect(
      await failure(
        admin({ permissions: ALL, donation: null }).service.refund(operator, REFUND_FORM),
      ),
    ).toBe('not-found');
    expect(
      await failure(
        admin({ permissions: ALL, provider: null }).service.refund(operator, REFUND_FORM),
      ),
    ).toBe('provider-unavailable');
    const conflict = admin({
      permissions: ALL,
      reserve: () => Promise.reject(dataError('conflict')),
    });
    expect(await failure(conflict.service.refund(operator, REFUND_FORM))).toBe(
      'conflict',
    );
  });

  it('records a refused or unanswered refund, and never trusts an acceptance of something else', async () => {
    for (const [answer, outcome] of [
      [{ outcome: 'rejected' }, 'rejected'],
      [{ outcome: 'unknown' }, 'unknown'],
      [
        { outcome: 'accepted', observation: refundObservation({ amount: USD(999n) }) },
        'unknown',
      ],
      [
        { outcome: 'accepted', observation: refundObservation({ refundId: ID(77) }) },
        'unknown',
      ],
      [
        {
          outcome: 'accepted',
          observation: refundObservation({ paymentReference: 'pi_other' }),
        },
        'unknown',
      ],
    ] as const) {
      const { service, calls, w } = admin({
        permissions: ALL,
        provider: { refund: () => answer as RefundSubmission },
      });
      const result = await service.refund(operator, REFUND_FORM);
      expect(result.submission).toBe(outcome);
      expect(calls.map((call) => call.method)).toEqual(['reserve', 'recordSubmission']);
      expect((calls[1]!.args[0] as { outcome: string }).outcome).toBe(outcome);
      expect(w.log).not.toContain('ledger.applyRefundObservation');
    }
  });

  it('a repeated refund form is re-asked under the same key only while unanswered and inside the window', async () => {
    const replay = admin({
      permissions: ALL,
      reserve: () => ({ refund: refundRecord(), created: false }),
    });
    expect((await replay.service.refund(operator, REFUND_FORM)).submission).toBe(
      'accepted',
    );
    const done = admin({
      permissions: ALL,
      reserve: () => ({ refund: refundRecord({ state: 'pending' }), created: false }),
    });
    expect((await done.service.refund(operator, REFUND_FORM)).submission).toBe(
      'replayed',
    );
    expect(done.w.provider!.calls).toEqual([]);
    const old = admin({
      permissions: ALL,
      reserve: () => ({
        refund: refundRecord({
          requestedAt: new Date(
            NOW.getTime() - (CREATE_REPLAY_WINDOW_SECONDS + 1) * 1000,
          ),
        }),
        created: false,
      }),
    });
    expect((await old.service.refund(operator, REFUND_FORM)).submission).toBe('replayed');
    expect(old.w.provider!.calls).toEqual([]);
  });

  it('reconcile requests, then reads and applies provider truth as the operator', async () => {
    const { service, w, calls } = admin({ permissions: ALL, donation: record() });
    const result = await service.reconcile(operator, CHANGES.reconcile);
    expect(calls[0]).toEqual({
      method: 'requestReconcile',
      args: [
        { actorId: operator.accountId, id: DONATION_ID, expectedVersion: 1, now: NOW },
      ],
    });
    expect(result.outcome).toBe('applied');
    expect(result.donation.state).toBe('succeeded');
    const applied = w.calls.find(
      (call) => call.method === 'ledger.applyObservation:operator',
    )!;
    expect((applied.args[0] as { actorId: string }).actorId).toBe(operator.accountId);
    expect(
      await failure(
        admin({ permissions: ALL, provider: null }).service.reconcile(
          operator,
          CHANGES.reconcile,
        ),
      ),
    ).toBe('provider-unavailable');
  });

  it('exports CSV with fixed columns, exact amounts, redacted references and inert formulas', async () => {
    const row: StaffDonation = {
      ...record({
        state: 'partially_refunded',
        expected: { currency: 'KWD', minor: 1250n },
        capturedMinor: 1250n,
        refundedMinor: 250n,
        refundReservedMinor: 250n,
        paymentReference: PAYMENT_REF,
        linked: true,
        succeededAt: NOW,
      }),
      donorAccountId: 'proof-donor-secret-id',
      campaign: {
        campaignId: CAMPAIGN_ID,
        primaryLocale: 'en',
        translations: [
          { locale: 'en', title: '=HYPERLINK("https://attacker.invalid","x")' },
        ],
      },
      reconcileDueAt: null,
      reconcileAttempts: 0,
    };
    const { service } = admin({ permissions: ALL, rows: [row] });
    const csv = await service.exportCsv(operator, {
      state: null,
      campaignId: null,
      environment: null,
      donor: null,
      attention: false,
    });
    const [header, line, end] = csv.split('\r\n');
    expect(end).toBe('');
    expect(header).toBe(DONATION_CSV_COLUMNS.map((column) => `"${column}"`).join(','));
    expect(line).toContain(`"'=HYPERLINK(""https://attacker.invalid"",""x"")"`);
    expect(line).toContain('"1.250","1.250","0.250","0.250"');
    expect(line).toContain(`"…${CHECKOUT_REF.slice(-6)}"`);
    expect(line).toContain(`"…${PAYMENT_REF.slice(-6)}"`);
    expect(line).toContain('"linked"');
    expect(csv).not.toContain('proof-donor-secret-id');
    expect(csv).not.toContain(CHECKOUT_REF);
    expect(csv).not.toContain(PAYMENT_REF);
    expect(await failure(service.exportCsv(operator, QUERY))).toBe('invalid');
  });

  it('neutralises every spreadsheet formula lead-in', () => {
    for (const lead of ['=', '+', '-', '@', '\t', '\r'])
      expect(csvCell(`${lead}1+1`), JSON.stringify(lead)).toBe(`"'${lead}1+1"`);
    expect(csvCell('plain "quoted"')).toBe('"plain ""quoted"""');
    expect(csvCell('')).toBe('""');
    expect(redactReference(null)).toBe('');
    expect(redactReference('cs_test_abcdefghij')).toBe('…efghij');
  });
});

/* ===========================================================================
 * Webhooks and reconciliation
 * ========================================================================= */

function notice(over: Partial<ProviderEventNotice> = {}): ProviderEventNotice {
  return {
    scope: SCOPE,
    eventId: 'evt_proof_000001',
    eventType: 'checkout.session.completed',
    occurredAt: NOW,
    category: 'payment',
    subject: {
      checkoutReference: CHECKOUT_REF,
      paymentReference: null,
      refundReference: null,
    },
    payloadDigest: 'a'.repeat(64),
    ...over,
  };
}

const RAW = new TextEncoder().encode('{"id":"evt_proof_000001"}');
const verified =
  (over: Partial<ProviderEventNotice> = {}) =>
  (): WebhookVerification => ({
    outcome: 'verified',
    notice: notice(over),
  });

describe('the provider webhook', () => {
  it('without a provider is 401 and touches nothing', async () => {
    const w = world({ provider: null });
    expect(
      await w.ledgerService.receiveWebhook({ rawBody: RAW, signature: 't=1,v1=x' }),
    ).toEqual({
      status: 401,
      reason: 'not-configured',
    });
    expect(w.calls).toEqual([]);
  });

  it('maps every rejection to its status before the ledger is reached', async () => {
    for (const [reason, status] of [
      ['missing-signature', 401],
      ['invalid-signature', 401],
      ['stale', 401],
      ['wrong-environment', 401],
      ['not-configured', 401],
      ['malformed', 400],
    ] as const) {
      const w = world({ provider: { verify: () => ({ outcome: 'rejected', reason }) } });
      expect(
        await w.ledgerService.receiveWebhook({ rawBody: RAW, signature: null }),
      ).toEqual({
        status,
        reason,
      });
      expect(w.calls, reason).toEqual([]);
    }
    const foreign = world({
      provider: { verify: verified({ scope: { ...SCOPE, accountKey: 'acct_other' } }) },
    });
    expect(
      (await foreign.ledgerService.receiveWebhook({ rawBody: RAW, signature: 'x' }))
        .status,
    ).toBe(401);
    expect(foreign.calls).toEqual([]);
  });

  it('runs verify → admit → locate → observe → apply → complete, and answers 200', async () => {
    const w = world({ seed: [record()], provider: { verify: verified() } });
    const signature = 't=1,v1=abc';
    expect(await w.ledgerService.receiveWebhook({ rawBody: RAW, signature })).toEqual({
      status: 200,
      reason: 'processed',
    });
    expect(w.log).toEqual([
      'provider.verifyWebhook',
      'ledger.admitEvent',
      'ledger.locate',
      'ledger.donation',
      'provider.observeCheckout',
      'ledger.applyObservation:webhook',
      'ledger.completeEvent:applied',
    ]);
    const verifyCall = w.provider!.calls[0]!.args[0] as {
      rawBody: Uint8Array;
      signature: string;
      now: Date;
    };
    expect(verifyCall.rawBody).toBe(RAW);
    expect(verifyCall.signature).toBe(signature);
    expect(verifyCall.now).toEqual(NOW);
    expect(w.store.get(DONATION_ID)!.record.state).toBe('succeeded');
  });

  it('a duplicate delivery has one effect', async () => {
    const w = world({ seed: [record()], provider: { verify: verified() } });
    w.ledgerAnswers.admit = 'already-processed';
    expect(
      await w.ledgerService.receiveWebhook({ rawBody: RAW, signature: 'x' }),
    ).toEqual({
      status: 200,
      reason: 'duplicate',
    });
    expect(w.log).toEqual(['provider.verifyWebhook', 'ledger.admitEvent']);
  });

  it('an ignored or unmatched event is completed as such', async () => {
    const ignored = world({ provider: { verify: verified({ category: 'ignored' }) } });
    expect(
      (await ignored.ledgerService.receiveWebhook({ rawBody: RAW, signature: 'x' }))
        .status,
    ).toBe(200);
    expect(ignored.log).toEqual([
      'provider.verifyWebhook',
      'ledger.admitEvent',
      'ledger.completeEvent:ignored',
    ]);
    const unmatched = world({ provider: { verify: verified() } });
    unmatched.ledgerAnswers.locate = null;
    expect(
      (await unmatched.ledgerService.receiveWebhook({ rawBody: RAW, signature: 'x' }))
        .status,
    ).toBe(200);
    expect(unmatched.log).toEqual([
      'provider.verifyWebhook',
      'ledger.admitEvent',
      'ledger.locate',
      'ledger.completeEvent:unmatched',
    ]);
  });

  it('a provider that cannot answer defers the donation and answers 500, leaving the event unprocessed', async () => {
    const w = world({
      seed: [record()],
      provider: { verify: verified(), observe: () => ({ outcome: 'unknown' }) },
    });
    expect(
      await w.ledgerService.receiveWebhook({ rawBody: RAW, signature: 'x' }),
    ).toEqual({
      status: 500,
      reason: 'deferred',
    });
    expect(w.log).toContain('ledger.deferDonation');
    expect(w.log.some((step) => step.startsWith('ledger.completeEvent'))).toBe(false);
    expect(w.log.some((step) => step.startsWith('ledger.applyObservation'))).toBe(false);
  });

  it('a mismatched observation is completed as attention', async () => {
    const w = world({
      seed: [record()],
      provider: {
        verify: verified(),
        observe: () => ({
          outcome: 'observed',
          observation: observation({ amount: USD(1n) }),
        }),
      },
    });
    expect(
      (await w.ledgerService.receiveWebhook({ rawBody: RAW, signature: 'x' })).status,
    ).toBe(200);
    expect(w.log).toContain('ledger.completeEvent:attention');
    expect(w.store.get(DONATION_ID)!.record.attention).toBe('amount-mismatch');
  });

  it('a refund event reads the refund, applies it, and re-reads the payment when it settled', async () => {
    const w = world({
      seed: [
        record({
          state: 'succeeded',
          capturedMinor: 2500n,
          paymentReference: PAYMENT_REF,
        }),
      ],
      provider: {
        verify: verified({
          category: 'refund',
          subject: {
            checkoutReference: null,
            paymentReference: PAYMENT_REF,
            refundReference: 're_proof_refund_000001',
          },
        }),
      },
    });
    w.ledgerAnswers.locate = { donationId: DONATION_ID, refundId: REFUND_ID };
    expect(
      (await w.ledgerService.receiveWebhook({ rawBody: RAW, signature: 'x' })).status,
    ).toBe(200);
    expect(w.log.slice(2)).toEqual([
      'ledger.locate',
      'ledger.donation',
      'provider.observeRefund',
      'ledger.applyRefundObservation',
      'provider.observeCheckout',
      'ledger.applyObservation:webhook',
      'ledger.completeEvent:applied',
    ]);
    expect(
      w.provider!.calls.find((call) => call.method === 'observeRefund')!.args[0],
    ).toEqual({
      refundId: REFUND_ID,
      refundReference: 're_proof_refund_000001',
      paymentReference: PAYMENT_REF,
    });
  });

  it('a refund the provider cannot answer for is deferred with a 500', async () => {
    const w = world({
      seed: [
        record({
          state: 'succeeded',
          capturedMinor: 2500n,
          paymentReference: PAYMENT_REF,
        }),
      ],
      provider: {
        verify: verified({ category: 'refund' }),
        observeRefund: () => ({ outcome: 'unknown' }),
      },
    });
    w.ledgerAnswers.locate = { donationId: DONATION_ID, refundId: REFUND_ID };
    expect(
      (await w.ledgerService.receiveWebhook({ rawBody: RAW, signature: 'x' })).status,
    ).toBe(500);
    expect(w.log).toContain('ledger.deferRefund');
    expect(w.log).not.toContain('ledger.deferDonation');
  });

  it('an outage after admission answers 500 so the provider delivers again', async () => {
    const w = world({ provider: { verify: verified() } });
    w.ledger.locate = async () => {
      throw new Error('database down');
    };
    expect(
      await w.ledgerService.receiveWebhook({ rawBody: RAW, signature: 'x' }),
    ).toEqual({
      status: 500,
      reason: 'failure',
    });
  });

  it('a verifier that throws is a 400, never an exception', async () => {
    const w = world({
      provider: {
        verify: () => {
          throw new Error('bug');
        },
      },
    });
    expect(
      (await w.ledgerService.receiveWebhook({ rawBody: RAW, signature: 'x' })).status,
    ).toBe(400);
  });
});

const claim = (over: Record<string, unknown> = {}) => ({
  donationId: DONATION_ID,
  checkoutReference: CHECKOUT_REF,
  createState: 'created',
  expected: USD(2500n),
  locale: 'en',
  checkoutLabel: TITLE,
  attempts: 0,
  createdAt: NOW,
  ...over,
});

describe('reconciliation', () => {
  it('reads a created checkout and applies it as reconciliation, under a lease', async () => {
    const w = world({ seed: [record()] });
    w.ledgerAnswers.donationClaims = [claim()];
    expect(await w.ledgerService.reconcileDue(20)).toEqual({
      donations: 1,
      refunds: 0,
      failed: 0,
    });
    expect(
      w.calls.find((call) => call.method === 'ledger.claimDueDonations')!.args,
    ).toEqual([NOW, 20, 120]);
    expect(w.log).toContain('ledger.applyObservation:reconcile');
    expect(w.store.get(DONATION_ID)!.record.state).toBe('succeeded');
  });

  it('backs off whenever the provider cannot answer, or cannot find the checkout', async () => {
    for (const answer of [{ outcome: 'unknown' }, { outcome: 'not-found' }] as const) {
      const w = world({ seed: [record()], provider: { observe: () => answer } });
      w.ledgerAnswers.donationClaims = [claim()];
      await w.ledgerService.reconcileDue(20);
      expect(w.log, answer.outcome).toContain('ledger.deferDonation');
      expect(w.log.some((step) => step.startsWith('ledger.applyObservation'))).toBe(
        false,
      );
    }
    const foreign = world({
      seed: [record({ scope: { ...SCOPE, accountKey: 'acct_other' } })],
    });
    foreign.ledgerAnswers.donationClaims = [claim()];
    await foreign.ledgerService.reconcileDue(20);
    expect(foreign.log).toContain('ledger.deferDonation');
    expect(foreign.provider!.calls).toEqual([]);
  });

  it('resolves an ambiguous create under its original key and parameters, then observes', async () => {
    const w = world({
      seed: [record({ createState: 'ambiguous', checkoutReference: null })],
    });
    w.ledgerAnswers.donationClaims = [
      claim({ createState: 'ambiguous', checkoutReference: null }),
    ];
    w.setClock(() => new Date(NOW.getTime() + 3600_000));
    await w.ledgerService.reconcileDue(20);
    const create = w.provider!.calls.find((call) => call.method === 'createCheckout')!
      .args[0];
    expect(create).toEqual({
      donationId: DONATION_ID,
      amount: USD(2500n),
      description: TITLE,
      successUrl: `${BASE_URL}/en/donate/return`,
      cancelUrl: `${BASE_URL}/en/donate/return`,
      expiresAt: new Date(NOW.getTime() + CHECKOUT_LIFETIME_SECONDS * 1000),
      idempotencyKey: `donation:${DONATION_ID}`,
    });
    expect(w.log.filter((step) => step !== 'ledger.donation').slice(1, 5)).toEqual([
      'provider.createCheckout',
      'donor.recordCheckout',
      'provider.observeCheckout',
      'ledger.applyObservation:reconcile',
    ]);
  });

  it('an ambiguous create still unanswered backs off; past the replay window it is never created afresh', async () => {
    const unanswered = world({
      seed: [record({ createState: 'ambiguous', checkoutReference: null })],
      provider: { create: () => ({ outcome: 'unknown' }) },
    });
    unanswered.ledgerAnswers.donationClaims = [claim({ createState: 'ambiguous' })];
    await unanswered.ledgerService.reconcileDue(20);
    expect(unanswered.log).toContain('ledger.deferDonation');
    expect(unanswered.log).not.toContain('donor.recordCreateOutcome:ambiguous');

    const late = world({
      seed: [record({ createState: 'ambiguous', checkoutReference: null })],
    });
    late.ledgerAnswers.donationClaims = [claim({ createState: 'ambiguous' })];
    late.setClock(
      () => new Date(NOW.getTime() + (CREATE_REPLAY_WINDOW_SECONDS + 60) * 1000),
    );
    await late.ledgerService.reconcileDue(20);
    expect(late.provider!.calls).toEqual([]);
    expect(late.log).toContain('ledger.deferDonation');
  });

  it('reads a due refund, applies it only when it is exactly this refund, and otherwise backs off', async () => {
    const refundClaim = {
      refundId: REFUND_ID,
      donationId: DONATION_ID,
      refundReference: null,
      paymentReference: PAYMENT_REF,
      amount: USD(1000n),
      attempts: 0,
      requestedAt: NOW,
    };
    const seed = [
      record({ state: 'succeeded', capturedMinor: 2500n, paymentReference: PAYMENT_REF }),
    ];
    const good = world({ seed });
    good.ledgerAnswers.refundClaims = [refundClaim];
    expect(await good.ledgerService.reconcileDue(20)).toEqual({
      donations: 0,
      refunds: 1,
      failed: 0,
    });
    expect(good.log).toContain('ledger.applyRefundObservation');

    for (const answer of [
      { outcome: 'unknown' },
      { outcome: 'not-found' },
      { outcome: 'observed', observation: refundObservation({ amount: USD(999n) }) },
      { outcome: 'observed', observation: refundObservation({ refundId: ID(55) }) },
      {
        outcome: 'observed',
        observation: refundObservation({
          scope: { ...SCOPE, environment: 'production' },
        }),
      },
    ] as const) {
      const w = world({
        seed,
        provider: { observeRefund: () => answer as RefundLookup },
      });
      w.ledgerAnswers.refundClaims = [refundClaim];
      await w.ledgerService.reconcileDue(20);
      expect(w.log, JSON.stringify(answer.outcome)).toContain('ledger.deferRefund');
      expect(w.log).not.toContain('ledger.applyRefundObservation');
      // A refund the provider never received is never re-submitted from here.
      expect(w.provider!.calls.map((call) => call.method)).not.toContain('requestRefund');
      expect(w.log).not.toContain('refunds.recordSubmission');
    }
  });

  it('fails a refund the provider still does not hold only after the replay window, and never re-submits it', async () => {
    const seed = [
      record({ state: 'succeeded', capturedMinor: 2500n, paymentReference: PAYMENT_REF }),
    ];
    const lost = {
      refundId: REFUND_ID,
      donationId: DONATION_ID,
      refundReference: null,
      paymentReference: PAYMENT_REF,
      amount: USD(1000n),
      attempts: 3,
      requestedAt: NOW,
    };
    const later = world({
      seed,
      provider: { observeRefund: () => ({ outcome: 'not-found' }) },
    });
    later.ledgerAnswers.refundClaims = [lost];
    later.setClock(
      () => new Date(NOW.getTime() + (CREATE_REPLAY_WINDOW_SECONDS + 1) * 1000),
    );
    await later.ledgerService.reconcileDue(20);
    expect(later.log).toContain('refunds.recordSubmission');
    expect(later.log).not.toContain('ledger.deferRefund');
    expect(later.provider!.calls.map((call) => call.method)).not.toContain(
      'requestRefund',
    );

    // With its provider reference known, "not found" is never conclusive.
    const referenced = world({
      seed,
      provider: { observeRefund: () => ({ outcome: 'not-found' }) },
    });
    referenced.ledgerAnswers.refundClaims = [{ ...lost, refundReference: 're_known' }];
    referenced.setClock(
      () => new Date(NOW.getTime() + (CREATE_REPLAY_WINDOW_SECONDS + 1) * 1000),
    );
    await referenced.ledgerService.reconcileDue(20);
    expect(referenced.log).not.toContain('refunds.recordSubmission');
    expect(referenced.log).toContain('ledger.deferRefund');
  });

  it('one failing item does not stop the others', async () => {
    const w = world({ seed: [record()] });
    w.ledgerAnswers.donationClaims = [claim({ donationId: ID(66) }), claim()];
    const original = w.ledger.donation;
    w.ledger.donation = async (id: string) => {
      if (id === ID(66)) throw new Error('database down');
      return original(id);
    };
    expect(await w.ledgerService.reconcileDue(20)).toEqual({
      donations: 2,
      refunds: 0,
      failed: 1,
    });
    expect(w.store.get(DONATION_ID)!.record.state).toBe('succeeded');
  });

  it('without a provider does nothing', async () => {
    const w = world({ provider: null });
    expect(await w.ledgerService.reconcileDue(20)).toEqual({
      donations: 0,
      refunds: 0,
      failed: 0,
    });
    expect(w.calls).toEqual([]);
  });
});

/* ===========================================================================
 * Account closure and communication
 * ========================================================================= */

describe('account disposition', () => {
  it('refuses a living account and releases a closed one in bounded rounds', async () => {
    const calls: Call[] = [];
    let remaining = 3;
    const service = createDonationsAccountService({
      disposition: recording(calls, (method) => {
        if (method === 'disposeAccount') return remaining-- > 0 ? 500 : 0;
        return [];
      }),
      accounts: { closedAccounts: async (ids) => ids.filter((id) => id === 'closed-1') },
    });
    expect(await failure(service.disposeAccount('living-1'))).toBe('denied');
    expect(calls).toEqual([]);
    expect(await failure(service.disposeAccount(''))).toBe('invalid');
    expect(await service.disposeAccount('closed-1')).toEqual({
      removed: 1500,
      complete: true,
    });

    const endless = createDonationsAccountService({
      disposition: recording([], (method) => (method === 'disposeAccount' ? 500 : [])),
      accounts: { closedAccounts: async (ids) => ids },
    });
    expect(await endless.disposeAccount('closed-1')).toEqual({
      removed: 20_000,
      complete: false,
    });
  });

  it('the sweep pages through accounts with data and disposes only the closed ones', async () => {
    const calls: Call[] = [];
    const service = createDonationsAccountService({
      disposition: recording(calls, (method, args) => {
        if (method === 'accountsWithData') return args[0] === null ? ['a-1', 'a-2'] : [];
        return 0;
      }),
      accounts: { closedAccounts: async () => ['a-2'] },
    });
    expect(await service.reconcileClosedAccounts()).toEqual({
      removed: 0,
      complete: true,
    });
    expect(
      calls
        .filter((call) => call.method === 'disposeAccount')
        .map((call) => call.args[0]),
    ).toEqual(['a-2']);
  });
});

describe('the payment acknowledgement relay', () => {
  const intent = (
    over: Partial<DonationCommunicationIntentRecord> = {},
  ): DonationCommunicationIntentRecord => ({
    id: ID(40),
    donationId: DONATION_ID,
    refundId: null,
    recipientAccountId: person.accountId,
    purpose: 'donation.succeeded',
    dueAt: NOW,
    state: 'pending',
    idempotencyKey: `donation.succeeded:${DONATION_ID}`,
    ...over,
  });

  function relay(
    options: {
      owed?: boolean;
      recipients?: boolean;
      source?: unknown;
      intents?: unknown[];
    } = {},
  ) {
    const log: string[] = [];
    const enqueued: unknown[] = [];
    const calls: Call[] = [];
    const service = createDonationsCommunicationService({
      communication: recording(
        calls,
        (method) => {
          if (method === 'claimDue') return options.intents ?? [intent()];
          if (method === 'deliverySource')
            return options.source === undefined
              ? {
                  intent: intent({ state: 'relayed' }),
                  owed: options.owed ?? true,
                  expected: USD(2500n),
                  refundAmount: null,
                  campaign: {
                    campaignId: CAMPAIGN_ID,
                    primaryLocale: 'en',
                    translations: [{ locale: 'en', title: TITLE }],
                  },
                }
              : options.source;
          return undefined;
        },
        log,
      ),
      recipients: {
        recipients: async () =>
          options.recipients === false
            ? []
            : [{ accountId: person.accountId, email: EMAIL, locale: 'ur' }],
      },
      ledger: {
        donation: async () => record({ state: 'succeeded', capturedMinor: 2500n }),
      },
      enqueue: async (delivery) => {
        log.push('enqueue');
        enqueued.push(delivery);
      },
      baseUrl: BASE_URL,
      clock: () => NOW,
    });
    return { service, log, enqueued, calls };
  }

  const delivery = (over: Partial<DeliveryRecord> = {}): DeliveryRecord => ({
    id: ID(50),
    purpose: 'donation.succeeded',
    sourceReference: `donation:${ID(40)}`,
    idempotencyKey: `donation.succeeded:${DONATION_ID}`,
    status: 'sending',
    attemptCount: 1,
    ...over,
  });

  it('claims, re-checks, resolves, enqueues under the intent’s own key, then marks relayed', async () => {
    const { service, log, enqueued, calls } = relay();
    expect(await service.relayPendingIntents(20)).toBe(1);
    expect(log).toEqual(['claimDue', 'deliverySource', 'enqueue', 'markRelayed']);
    expect(calls[0]!.args).toEqual([NOW, 20, 120]);
    expect(enqueued).toEqual([
      {
        purpose: 'donation.succeeded',
        recipient: EMAIL,
        sourceReference: `donation:${ID(40)}`,
        idempotencyKey: `donation.succeeded:${DONATION_ID}`,
      },
    ]);
  });

  it('abandons what is no longer owed or has no recipient', async () => {
    for (const options of [{ owed: false }, { recipients: false }, { source: null }]) {
      const { service, log } = relay(options);
      expect(await service.relayPendingIntents(20)).toBe(0);
      expect(log).toContain('markAbandoned');
      expect(log).not.toContain('enqueue');
    }
  });

  it('renders at send time in the recipient’s locale, linking only the private page', async () => {
    const { service } = relay();
    const resolution = await service.resolveDelivery(delivery());
    expect(resolution.outcome).toBe('send');
    if (resolution.outcome !== 'send') return;
    expect(resolution.message.recipient).toBe(EMAIL);
    expect(resolution.message.html).toContain('<html lang="ur" dir="rtl">');
    expect(resolution.message.html).toContain(`href="${BASE_URL}/ur/my/donations"`);
    expect(resolution.message.text).toContain('25.00 USD');
    expect(resolution.message.subject).toMatch(/^\[آزمائشی\]/u);
  });

  it('owes nothing for a stale, foreign or malformed delivery', async () => {
    expect(
      (await relay({ owed: false }).service.resolveDelivery(delivery())).outcome,
    ).toBe('nothing-owed');
    expect(
      (await relay().service.resolveDelivery(delivery({ purpose: 'membership.closed' })))
        .outcome,
    ).toBe('nothing-owed');
    expect(
      (
        await relay().service.resolveDelivery(
          delivery({ sourceReference: 'membership:x' }),
        )
      ).outcome,
    ).toBe('nothing-owed');
    expect(
      (await relay().service.resolveDelivery(delivery({ purpose: 'donation.refunded' })))
        .outcome,
    ).toBe('nothing-owed');
    expect(
      (await relay({ recipients: false }).service.resolveDelivery(delivery())).outcome,
    ).toBe('nothing-owed');
  });

  it('recognises exactly its own purposes', () => {
    for (const purpose of DONATION_COMMUNICATION_PURPOSES)
      expect(isDonationDeliveryPurpose(purpose)).toBe(true);
    expect(isDonationDeliveryPurpose('membership.closed')).toBe(false);
    expect(isDonationDeliveryPurpose('newsletter.confirmation')).toBe(false);
  });
});

/* ===========================================================================
 * Nothing personal reaches a port
 * ========================================================================= */

describe('no token, address or email reaches a port', () => {
  it('a full linked start, status, check and cancel pass only digests and identifiers', async () => {
    const w = world();
    await start(w, {}, { account: person });
    await w.donorService.status(TOKEN, CLIENT);
    await w.donorService.check(TOKEN, CLIENT);
    await w.donorService.cancel(TOKEN, CLIENT);
    const recorded = JSON.stringify([w.calls, w.provider!.calls], (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    expect(recorded).not.toContain(TOKEN);
    expect(recorded).not.toContain(CLIENT);
    expect(recorded).not.toContain(EMAIL);
  });
});
