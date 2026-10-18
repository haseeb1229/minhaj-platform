import 'server-only';

import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ExactMoney, PaymentProviderPort } from '@minhaj/contracts/donations';

import {
  createStripePaymentProvider,
  validateStripeConfig,
  type StripeProviderConfig,
} from '../src/adapters/donations-stripe/index.ts';
import {
  STRIPE_API_ORIGIN,
  STRIPE_API_VERSION,
  STRIPE_CHECKOUT_ORIGIN,
} from '../src/adapters/donations-stripe/config.ts';
import { minorFromStripe } from '../src/adapters/donations-stripe/units.ts';

/**
 * `npm run donations:sandbox:proof` — proves the Stripe adapter against the
 * provider's REAL sandbox. Run by hand; never in CI, which holds no credential.
 *
 * SANDBOX ONLY, AND PROVED SO. It refuses unless
 * `DONATIONS_PROVIDER_ENVIRONMENT=sandbox` and the credentials pass the
 * adapter's own sandbox validation (a `sk_test_`/`rk_test_`/`rkcs_test_` key, a `whsec_`
 * secret, Stripe's own origins). A live key cannot get past that check, so
 * this command cannot move real money.
 *
 * Configuration comes from the ignored `.env.donations-sandbox` at the
 * repository root when it exists, and otherwise from the shell. The FILE wins
 * for every `DONATIONS_*` name it declares, so a stale shell variable cannot
 * redefine the target the file names (the lesson `docker/.env` taught); the
 * command reports which names came from the file — names only.
 *
 * WHAT IT PROVES
 *   1. create a harmless hosted checkout through the adapter; retrieve it and
 *      verify the exact amount and currency; resume it; cancel (expire) it and
 *      observe it expired;
 *   2. only with `DONATIONS_SANDBOX_PAYMENT_PROOF=1`: confirm a PaymentIntent
 *      with Stripe's documented test PaymentMethod `pm_card_visa` (no card
 *      number anywhere), observe the capture, refund part and then the rest
 *      through the adapter, and observe each refund by reference and by this
 *      platform's refund id.
 *
 * WHAT IT PRINTS. Outcomes and the LAST SIX characters of provider ids. Never
 * a key, a secret, a URL, a body or a provider message.
 */

const TIMEOUT_MS = 20_000;
const CHECKOUT_AMOUNT: ExactMoney = { currency: 'USD', minor: 100n };
const PAYMENT_AMOUNT: ExactMoney = { currency: 'USD', minor: 1000n };
const PARTIAL_REFUND = 400n;

function tail(id: string): string {
  return `…${id.slice(-6)}`;
}

function report(step: string, detail: string): void {
  process.stdout.write(`  ${step.padEnd(28)} ${detail}\n`);
}

class ProofFailure extends Error {}

function check(condition: boolean, step: string): asserts condition {
  if (!condition) throw new ProofFailure(step);
}

function refuse(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(2);
}

/** One direct sandbox request, outside the adapter, for the payment fixture only. */
async function stripeDirect(
  secretKey: string,
  method: 'GET' | 'POST',
  path: string,
  form: readonly (readonly [string, string])[] = [],
  idempotencyKey?: string,
): Promise<{ readonly status: number; readonly body: Record<string, unknown> }> {
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const params = new URLSearchParams();
    for (const [name, value] of form) params.append(name, value);
    const response = await fetch(new URL(path, STRIPE_API_ORIGIN), {
      method,
      headers: {
        Authorization: `Bearer ${secretKey}`,
        'Stripe-Version': STRIPE_API_VERSION,
        ...(method === 'POST'
          ? { 'Content-Type': 'application/x-www-form-urlencoded' }
          : {}),
        ...(idempotencyKey === undefined ? {} : { 'Idempotency-Key': idempotencyKey }),
      },
      ...(method === 'POST' ? { body: params.toString() } : {}),
      redirect: 'error',
      signal: controller.signal,
    });
    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, body };
  } finally {
    clearTimeout(deadline);
  }
}

async function checkoutProof(port: PaymentProviderPort): Promise<void> {
  const donationId = randomUUID();
  const creation = await port.createCheckout({
    donationId,
    amount: CHECKOUT_AMOUNT,
    description: 'Sandbox proof — not a real donation',
    successUrl: 'https://example.invalid/donate/return',
    cancelUrl: 'https://example.invalid/donate/return',
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    idempotencyKey: `sandbox-proof:${donationId}`,
  });
  check(creation.outcome === 'created', 'create checkout');
  report('checkout created', tail(creation.checkoutReference));

  const observed = await port.observeCheckout(creation.checkoutReference);
  check(observed.outcome === 'observed', 'observe checkout');
  check(
    observed.observation.amount.currency === CHECKOUT_AMOUNT.currency &&
      observed.observation.amount.minor === CHECKOUT_AMOUNT.minor,
    'exact amount and currency',
  );
  check(observed.observation.donationReference === donationId, 'client reference');
  check(observed.observation.checkout === 'open', 'session open');
  report('amount verified', `${CHECKOUT_AMOUNT.currency} minor ${CHECKOUT_AMOUNT.minor}`);

  const resumed = await port.resumeCheckout(creation.checkoutReference);
  check(resumed.outcome === 'open', 'resume open session');
  report('resume', 'open on the checkout origin');

  const cancelled = await port.cancelCheckout(creation.checkoutReference);
  check(cancelled === 'cancelled', 'expire session');
  const after = await port.observeCheckout(creation.checkoutReference);
  check(
    after.outcome === 'observed' && after.observation.checkout === 'expired',
    'expired',
  );
  check(
    (await port.cancelCheckout(creation.checkoutReference)) === 'not-open',
    'not-open',
  );
  report('cancel', 'expired; a second cancel is not-open');
}

async function paymentProof(port: PaymentProviderPort, secretKey: string): Promise<void> {
  const donationId = randomUUID();
  const intent = await stripeDirect(
    secretKey,
    'POST',
    '/v1/payment_intents',
    [
      ['amount', PAYMENT_AMOUNT.minor.toString()],
      ['currency', PAYMENT_AMOUNT.currency.toLowerCase()],
      ['payment_method', 'pm_card_visa'],
      ['confirm', 'true'],
      ['automatic_payment_methods[enabled]', 'true'],
      ['automatic_payment_methods[allow_redirects]', 'never'],
      ['metadata[donation]', donationId],
    ],
    `sandbox-proof-intent:${donationId}`,
  );
  const intentId = intent.body['id'];
  check(
    intent.status === 200 &&
      typeof intentId === 'string' &&
      intent.body['status'] === 'succeeded' &&
      intent.body['livemode'] === false,
    'confirm test PaymentIntent',
  );
  report('payment captured', tail(intentId));

  const charge = await stripeDirect(
    secretKey,
    'GET',
    `/v1/payment_intents/${encodeURIComponent(intentId)}?expand[]=latest_charge`,
  );
  const latest = charge.body['latest_charge'] as
    Record<string, unknown> | null | undefined;
  check(
    charge.status === 200 &&
      minorFromStripe(latest?.['amount_captured']) === PAYMENT_AMOUNT.minor,
    'captured amount',
  );
  report('capture verified', `${PAYMENT_AMOUNT.currency} minor ${PAYMENT_AMOUNT.minor}`);

  for (const minor of [PARTIAL_REFUND, PAYMENT_AMOUNT.minor - PARTIAL_REFUND]) {
    const refundId = randomUUID();
    const submission = await port.requestRefund({
      refundId,
      donationId,
      paymentReference: intentId,
      amount: { currency: PAYMENT_AMOUNT.currency, minor },
      idempotencyKey: `refund:${refundId}`,
    });
    check(submission.outcome === 'accepted', 'refund accepted');
    const reference = submission.observation.refundReference;
    report(`refund ${minor}`, `${tail(reference)} ${submission.observation.state}`);

    const byReference = await port.observeRefund({
      refundId,
      refundReference: reference,
      paymentReference: intentId,
    });
    const byId = await port.observeRefund({
      refundId,
      refundReference: null,
      paymentReference: intentId,
    });
    check(
      byReference.outcome === 'observed' &&
        byId.outcome === 'observed' &&
        byId.observation.refundReference === reference &&
        byReference.observation.amount.minor === minor,
      'observe refund',
    );
    report('refund observed', 'by reference and by refund id');
  }

  const final = await stripeDirect(
    secretKey,
    'GET',
    `/v1/payment_intents/${encodeURIComponent(intentId)}?expand[]=latest_charge`,
  );
  const settled = final.body['latest_charge'] as
    Record<string, unknown> | null | undefined;
  check(
    final.status === 200 &&
      minorFromStripe(settled?.['amount_refunded']) === PAYMENT_AMOUNT.minor,
    'fully refunded',
  );
  report('refunds total', `${PAYMENT_AMOUNT.currency} minor ${PAYMENT_AMOUNT.minor}`);
}

async function accountProof(secretKey: string, accountKey: string): Promise<void> {
  const account = await stripeDirect(secretKey, 'GET', '/v1/account');
  const id = account.body['id'];
  if (account.status !== 200 || typeof id !== 'string') {
    report('account', 'not readable with this key (restricted keys may lack it)');
    return;
  }
  check(id === accountKey, 'DONATIONS_PROVIDER_ACCOUNT names the key’s account');
  report('account', `matches ${tail(id)}`);
}

const SANDBOX_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '.env.donations-sandbox',
);

/** `DONATIONS_*` assignments from the ignored file; any other line is refused. */
function readSandboxFile(): Record<string, string> {
  if (!existsSync(SANDBOX_FILE)) return {};
  const values: Record<string, string> = {};
  const lines = readFileSync(SANDBOX_FILE, 'utf8').split(/\r?\n/u);
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;
    const match = /^(DONATIONS_[A-Z_]+)=(.*)$/u.exec(trimmed);
    if (match === null) {
      refuse(
        `Refused: .env.donations-sandbox line ${index + 1} is not a DONATIONS_ assignment.`,
      );
    }
    const name = match[1] ?? '';
    const value = (match[2] ?? '').trim();
    values[name] = /^(["']).*\1$/u.test(value) ? value.slice(1, -1) : value;
  });
  return values;
}

const fromFile = readSandboxFile();
const environment: Record<string, string | undefined> = { ...process.env, ...fromFile };
const fileNames = Object.keys(fromFile).sort();
if (fileNames.length > 0)
  report('configuration', `.env.donations-sandbox: ${fileNames.join(', ')}`);
if (environment['DONATIONS_PROVIDER_ENVIRONMENT'] !== 'sandbox') {
  refuse(
    'Refused: set DONATIONS_PROVIDER_ENVIRONMENT=sandbox, with DONATIONS_PROVIDER_ACCOUNT, ' +
      'DONATIONS_STRIPE_SECRET_KEY and DONATIONS_STRIPE_WEBHOOK_SECRET, in the ignored ' +
      '.env.donations-sandbox at the repository root or in the shell. This proof runs ' +
      'against the sandbox only.',
  );
}

let config: StripeProviderConfig;
try {
  config = validateStripeConfig({
    environment: 'sandbox',
    accountKey: environment['DONATIONS_PROVIDER_ACCOUNT'],
    secretKey: environment['DONATIONS_STRIPE_SECRET_KEY'],
    webhookSecret: environment['DONATIONS_STRIPE_WEBHOOK_SECRET'],
    apiOrigin: STRIPE_API_ORIGIN,
    checkoutOrigin: STRIPE_CHECKOUT_ORIGIN,
    timeoutMs: TIMEOUT_MS,
  });
} catch (error) {
  // The validator's message names the field and never its value.
  refuse(`Refused: ${(error as Error).message}`);
}

const port = createStripePaymentProvider(config);
process.stdout.write(`Stripe sandbox proof (API ${STRIPE_API_VERSION})\n`);

try {
  await accountProof(config.secretKey, config.accountKey);
  await checkoutProof(port);
  if (environment['DONATIONS_SANDBOX_PAYMENT_PROOF'] === '1') {
    await paymentProof(port, config.secretKey);
  } else {
    report('payment proof', 'skipped (set DONATIONS_SANDBOX_PAYMENT_PROOF=1 to run it)');
  }
  process.stdout.write('Sandbox proof passed.\n');
} catch (error) {
  process.stderr.write(
    error instanceof ProofFailure
      ? `Sandbox proof FAILED at: ${error.message}\n`
      : `Sandbox proof FAILED: ${error instanceof Error ? error.name : 'unknown error'}\n`,
  );
  process.exitCode = 1;
}
