import 'server-only';

import {
  PAYMENT_ENVIRONMENTS,
  paymentAccountKeySchema,
  type PaymentEnvironment,
} from '@minhaj/contracts/donations';

/**
 * Configuration of the Stripe payment adapter — validated, scoped, fail closed.
 *
 * ONE INSTANCE = ONE ENVIRONMENT. Every credential, origin and key prefix is
 * checked against the ONE declared environment, and nothing anywhere falls
 * back from one environment to another: a sandbox key never reaches the
 * production origin, a live key never reaches the simulator, and the
 * simulator's synthetic credentials authenticate nothing real.
 *
 * NO VALUE IS EVER ECHOED. A refusal names the offending FIELD and never its
 * value, because the values are credentials.
 */

/** Stripe's API and hosted-checkout origins (docs.stripe.com/api, Checkout Session `url`). */
export const STRIPE_API_ORIGIN = 'https://api.stripe.com';
export const STRIPE_CHECKOUT_ORIGIN = 'https://checkout.stripe.com';

/** The same two origins, for composition to configure sandbox and production with. */
export const STRIPE_ORIGINS: Readonly<{
  readonly api: string;
  readonly checkout: string;
}> = Object.freeze({ api: STRIPE_API_ORIGIN, checkout: STRIPE_CHECKOUT_ORIGIN });

/**
 * The pinned API version, sent as `Stripe-Version` on every request.
 *
 * The current GA version when this adapter was written and verified against
 * the official API reference (docs.stripe.com/api/versioning, 2026-10-18). A
 * pinned version means the account's dashboard default can never silently
 * change the response shapes this adapter parses.
 */
export const STRIPE_API_VERSION = '2026-09-30.endive';

export interface StripeProviderConfig {
  readonly environment: PaymentEnvironment;
  /** The NON-SECRET merchant account label every reference is scoped by. */
  readonly accountKey: string;
  /** `sk_test_`/`rk_test_`/`rkcs_test_` (sandbox), `sk_live_`/`rk_live_` (production), `sk_fixture_` (simulator). */
  readonly secretKey: string;
  /** `whsec_…`; the simulator's is `whsec_fixture_…`. */
  readonly webhookSecret: string;
  readonly apiOrigin: string;
  readonly checkoutOrigin: string;
  /** Ceiling on one HTTP exchange, headers AND body. */
  readonly timeoutMs: number;
  /** Injection point for the transport; the platform's global `fetch` otherwise. */
  readonly fetch?: typeof fetch;
}

/**
 * The untrusted configuration as composition reads it from the environment:
 * every field may be absent or malformed, and `validateStripeConfig` decides.
 */
export interface StripeConfigInput {
  readonly environment?: string | undefined;
  readonly accountKey?: string | undefined;
  readonly secretKey?: string | undefined;
  readonly webhookSecret?: string | undefined;
  readonly apiOrigin?: string | undefined;
  readonly checkoutOrigin?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly fetch?: typeof fetch | undefined;
}

/**
 * The key classes each environment accepts. A sandbox provisioned by the
 * official CLI's `stripe sandbox create` issues its secret key as
 * `rkcs_test_…` (docs.stripe.com/cli/sandbox, verified 2026-10-19), so the
 * sandbox accepts that test-mode class beside `sk_test_`/`rk_test_`. No live
 * counterpart is documented, so production accepts only `sk_live_`/`rk_live_`.
 */
const SECRET_KEY: Readonly<Record<PaymentEnvironment, RegExp>> = Object.freeze({
  fixture: /^sk_fixture_[A-Za-z0-9_]{8,200}$/u,
  sandbox: /^(?:sk|rk|rkcs)_test_[A-Za-z0-9_]{8,240}$/u,
  production: /^(?:sk|rk)_live_[A-Za-z0-9_]{8,240}$/u,
});

const WEBHOOK_SECRET = /^whsec_[A-Za-z0-9_+/=]{8,240}$/u;
const FIXTURE_WEBHOOK_SECRET = /^whsec_fixture_[A-Za-z0-9_]{8,200}$/u;

/** `http://127.0.0.1:<port>` or `http://localhost:<port>`, written exactly as an origin. */
const LOOPBACK_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost):([1-9][0-9]{0,4})$/u;

const STRIPE_TIMEOUT_BOUNDS = Object.freeze({ min: 50, max: 30_000 });

function refuse(field: string): never {
  throw new Error(
    `Invalid Stripe payment provider configuration: ${field}. Values are never printed.`,
  );
}

function isLoopbackOrigin(value: string): boolean {
  const match = LOOPBACK_ORIGIN.exec(value);
  if (match === null) return false;
  const port = Number.parseInt(match[1] ?? '', 10);
  return port >= 1 && port <= 65_535;
}

/**
 * Validates an untrusted configuration record into a `StripeProviderConfig`.
 *
 * THROWS on anything outside the accepted shape for the declared environment —
 * there is no partial, defaulted or downgraded result. Composition catches the
 * refusal and leaves Donations unavailable rather than guessing.
 */
export function validateStripeConfig(input: StripeConfigInput): StripeProviderConfig {
  if (typeof input !== 'object' || input === null) refuse('configuration');
  // Re-read as untyped: every field is checked at runtime, whatever a caller's types claimed.
  const record: Readonly<Record<string, unknown>> = { ...input };

  const environment = record['environment'];
  if (
    typeof environment !== 'string' ||
    !(PAYMENT_ENVIRONMENTS as readonly string[]).includes(environment)
  ) {
    refuse('environment');
  }
  const scope = environment as PaymentEnvironment;

  const accountKey = paymentAccountKeySchema.safeParse(record['accountKey']);
  if (!accountKey.success) refuse('accountKey');

  const secretKey = record['secretKey'];
  if (typeof secretKey !== 'string' || !SECRET_KEY[scope].test(secretKey)) {
    refuse('secretKey');
  }

  const webhookSecret = record['webhookSecret'];
  if (
    typeof webhookSecret !== 'string' ||
    !WEBHOOK_SECRET.test(webhookSecret) ||
    // The simulator's synthetic secret authenticates the simulator only, and a
    // real secret is never handed to the simulator.
    FIXTURE_WEBHOOK_SECRET.test(webhookSecret) !== (scope === 'fixture')
  ) {
    refuse('webhookSecret');
  }

  const apiOrigin = record['apiOrigin'];
  const checkoutOrigin = record['checkoutOrigin'];
  if (scope === 'fixture') {
    if (typeof apiOrigin !== 'string' || !isLoopbackOrigin(apiOrigin))
      refuse('apiOrigin');
    if (typeof checkoutOrigin !== 'string' || !isLoopbackOrigin(checkoutOrigin)) {
      refuse('checkoutOrigin');
    }
  } else {
    if (apiOrigin !== STRIPE_API_ORIGIN) refuse('apiOrigin');
    if (checkoutOrigin !== STRIPE_CHECKOUT_ORIGIN) refuse('checkoutOrigin');
  }

  const timeoutMs = record['timeoutMs'];
  if (
    typeof timeoutMs !== 'number' ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < STRIPE_TIMEOUT_BOUNDS.min ||
    timeoutMs > STRIPE_TIMEOUT_BOUNDS.max
  ) {
    refuse('timeoutMs');
  }

  const transport = record['fetch'];
  if (transport !== undefined && typeof transport !== 'function') refuse('fetch');

  return Object.freeze({
    environment: scope,
    accountKey: accountKey.data,
    secretKey: secretKey as string,
    webhookSecret: webhookSecret as string,
    apiOrigin: apiOrigin as string,
    checkoutOrigin: checkoutOrigin as string,
    timeoutMs,
    ...(transport === undefined ? {} : { fetch: transport as typeof fetch }),
  });
}
