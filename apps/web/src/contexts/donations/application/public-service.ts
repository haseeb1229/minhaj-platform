import 'server-only';

import {
  activationPermits,
  type DonationActivationReaderPort,
  type DonationCatalogueReaderPort,
  type PaymentEnvironment,
  type PaymentProviderCapabilities,
  type PaymentScope,
  type PublicDonationCampaign,
} from '@minhaj/contracts/donations';

import { asDonationsRefusal } from '../domain/refusal.ts';

/** Whether online giving is open, and — when it is — in which provider environment. */
export type DonationAvailability =
  | { readonly available: false }
  | { readonly available: true; readonly environment: PaymentEnvironment };

export interface DonationsPage {
  readonly availability: DonationAvailability;
  readonly campaigns: readonly PublicDonationCampaign[];
}

/**
 * The public `/donate` page's data — published campaigns with their currency
 * policies, and whether giving is open at all.
 *
 * NOTHING PERSONAL, AND NO SESSION. The reader ports return only published
 * campaigns and the single activation row; nothing here can reach a donation,
 * a token or an account however it is called.
 *
 * HONEST AVAILABILITY. Giving is open only when a provider is configured AND
 * the database's activation row permits exactly its scope (`activationPermits`,
 * fail closed). When it is not, the campaigns are still listed — the page says
 * plainly that online giving is not available rather than hiding the cause.
 * When it is, each campaign offers only the currencies the configured provider
 * can actually charge.
 */
export function createDonationsPublicService(deps: {
  readonly catalogue: DonationCatalogueReaderPort;
  readonly activation: DonationActivationReaderPort;
  readonly scope: PaymentScope | null;
  readonly capabilities: PaymentProviderCapabilities | null;
}) {
  return {
    async page(): Promise<DonationsPage> {
      const [campaigns, activation] = await Promise.all([
        deps.catalogue.publishedCampaigns(),
        deps.activation.activation(),
      ]).catch(asDonationsRefusal);

      const { scope, capabilities } = deps;
      if (
        scope === null ||
        capabilities === null ||
        !activationPermits(activation, scope)
      )
        return { availability: { available: false }, campaigns };

      const supported: ReadonlySet<string> = new Set(capabilities.currencies);
      return {
        availability: { available: true, environment: scope.environment },
        campaigns: campaigns.map((campaign) => ({
          ...campaign,
          currencies: campaign.currencies.filter((policy) =>
            supported.has(policy.currency),
          ),
        })),
      };
    },
  };
}

export type DonationsPublicService = ReturnType<typeof createDonationsPublicService>;
