import 'server-only';

import {
  STRIPE_CAPABILITIES,
  createDonationActivationReader,
  createDonationCatalogueReader,
} from '@minhaj/database';
import {
  PAYMENT_ENVIRONMENTS,
  PAYMENT_PROVIDERS,
  paymentAccountKeySchema,
  type PaymentEnvironment,
  type PaymentProviderName,
  type PaymentScope,
} from '@minhaj/contracts/donations';

import {
  createDonationsPublicService,
  type DonationsPublicService,
} from '@/contexts/donations';

/**
 * The PUBLIC Donations composition root — `/donate` reads through this.
 *
 * A SEPARATE ROOT FROM `./donations.ts`, AND THE SPLIT IS A SECURITY BOUNDARY.
 * The donor runtime wires Identity, the rate limiter and the provider's
 * SECRETS in; importing it would put them into the module graph of an
 * anonymous page. This root reaches the published campaigns and the single
 * activation row, and stops: no Identity, no session, no cookie, no donation,
 * no token — and no secret.
 *
 * THE SCOPE, NOT THE CREDENTIALS. Whether giving is open needs only the
 * NON-SECRET scope (provider, environment, account key) and the adapter's
 * static capability map, so this reads exactly those three variables and
 * nothing else — never the validated server configuration, which carries the
 * secrets (ARCHITECTURE.md §8.1). The server configuration validates the same
 * variables at startup, and the donor runtime refuses a start whose
 * credentials its validator rejects, so a misconfigured secret can never take
 * a payment.
 *
 * LAZY, so constructing it opens no connection and a build needs no database
 * (ARCHITECTURE.md §8.3.1).
 */

const CAPABILITIES = Object.freeze({ stripe: STRIPE_CAPABILITIES });

/** The configured non-secret scope, or `null` when any part is absent or malformed. */
function configuredScope(source: NodeJS.ProcessEnv): PaymentScope | null {
  const provider = source['DONATIONS_PROVIDER'];
  const environment = source['DONATIONS_PROVIDER_ENVIRONMENT'];
  const accountKey = paymentAccountKeySchema.safeParse(
    source['DONATIONS_PROVIDER_ACCOUNT'],
  );
  if (
    !(PAYMENT_PROVIDERS as readonly (string | undefined)[]).includes(provider) ||
    !(PAYMENT_ENVIRONMENTS as readonly (string | undefined)[]).includes(environment) ||
    !accountKey.success
  )
    return null;
  return {
    provider: provider as PaymentProviderName,
    environment: environment as PaymentEnvironment,
    accountKey: accountKey.data,
  };
}

interface DonationsReadRuntime {
  readonly page: DonationsPublicService;
}

let runtime: DonationsReadRuntime | null = null;

export function donationsReadRuntime(): DonationsReadRuntime {
  if (runtime) return runtime;
  const scope = configuredScope(process.env);
  return (runtime = {
    page: createDonationsPublicService({
      catalogue: createDonationCatalogueReader(),
      activation: createDonationActivationReader(),
      scope,
      capabilities: scope === null ? null : CAPABILITIES[scope.provider],
    }),
  });
}
