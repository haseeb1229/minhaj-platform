import 'server-only';

import {
  STRIPE_ORIGINS,
  createStripePaymentProvider,
  validateStripeConfig,
} from '@minhaj/database';
import type { PaymentProviderPort } from '@minhaj/contracts/donations';

import { serverEnv } from '@/config/server-env';

/**
 * The configured payment provider — Layer 4, and the ONLY place a provider
 * secret meets the Donations context.
 *
 * SANDBOX ENGINEERING ADAPTER — NOT PRODUCTION PROVIDER SELECTION. The Stripe
 * adapter exists so the provider-neutral flow is proven against a real
 * protocol; choosing the organisation's production provider remains an
 * external decision.
 *
 * FAIL CLOSED, NO FALLBACK. No `DONATIONS_PROVIDER` means no provider. A
 * configuration the adapter's validator refuses — a key of the wrong
 * environment, an origin that is not the provider's own, a missing secret —
 * also means no provider, never a guessed or downgraded one: giving reports
 * itself unavailable, and `donationsProviderProblem()` names the category for
 * the operator. Nothing here logs, and no value is ever echoed.
 *
 * LAZY AND CACHED, so a build reads no configuration and opens no connection.
 */

/** Why no provider is configured — a category, never a value. */
export type DonationsProviderProblem = 'not-configured' | 'invalid-configuration';

/** One provider exchange's ceiling. */
const PROVIDER_TIMEOUT_MS = 10_000;

interface Resolved {
  readonly provider: PaymentProviderPort | null;
  readonly problem: DonationsProviderProblem | null;
}

let resolved: Resolved | null = null;

function resolve(): Resolved {
  const environment = serverEnv();
  if (environment.DONATIONS_PROVIDER === undefined)
    return { provider: null, problem: 'not-configured' };
  try {
    const fixture = environment.DONATIONS_PROVIDER_ENVIRONMENT === 'fixture';
    const config = validateStripeConfig({
      environment: environment.DONATIONS_PROVIDER_ENVIRONMENT,
      accountKey: environment.DONATIONS_PROVIDER_ACCOUNT,
      secretKey: environment.DONATIONS_STRIPE_SECRET_KEY,
      webhookSecret: environment.DONATIONS_STRIPE_WEBHOOK_SECRET,
      apiOrigin: fixture
        ? environment.DONATIONS_FIXTURE_PROVIDER_ORIGIN
        : STRIPE_ORIGINS.api,
      checkoutOrigin: fixture
        ? environment.DONATIONS_FIXTURE_PROVIDER_ORIGIN
        : STRIPE_ORIGINS.checkout,
      timeoutMs: PROVIDER_TIMEOUT_MS,
    });
    return { provider: createStripePaymentProvider(config), problem: null };
  } catch {
    return { provider: null, problem: 'invalid-configuration' };
  }
}

/** The provider bound to exactly the configured scope, or `null`. */
export function donationsPaymentProvider(): PaymentProviderPort | null {
  return (resolved ??= resolve()).provider;
}

/** Why `donationsPaymentProvider()` is `null`, for the administration; `null` when it is not. */
export function donationsProviderProblem(): DonationsProviderProblem | null {
  return (resolved ??= resolve()).problem;
}
