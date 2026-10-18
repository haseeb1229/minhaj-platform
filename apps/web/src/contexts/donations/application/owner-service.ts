import 'server-only';

import {
  DONATION_EXPORT_SCHEMA,
  DONATION_EXPORT_VERSION,
  OWN_DONATION_HISTORY,
  donationAccountIdSchema,
  type DonationExport,
  type DonationOwnerPort,
  type OwnDonation,
} from '@minhaj/contracts/donations';
import type { RateLimiterPort } from '@minhaj/contracts/platform';

import { DonationsRefusal, asDonationsRefusal } from '../domain/refusal.ts';
import { spend, type DonationsActor, type DonationsLimitKey } from './shared.ts';

/**
 * A person's OWN donations — the capability behind `/my/donations` and the
 * Donations part of the personal-data export.
 *
 * THE OWNER IS THE SESSION, NEVER A FORM. Every read is keyed by the account
 * Layer 4 resolved, and the adapter carries it in the query's own predicate,
 * so nobody else's donation is reachable here. Only donations started while
 * signed in are linked; an anonymous donation stays anonymous.
 *
 * NO PROVIDER REFERENCE, NO PAYMENT CREDENTIAL. The history and the export
 * carry campaign, exact money, state, environment and instants — nothing the
 * provider would recognise and nothing a card would.
 */
export function createDonationsOwnerService(deps: {
  readonly owner: DonationOwnerPort;
  readonly limiter: RateLimiterPort;
  readonly key: DonationsLimitKey;
  readonly clock?: () => Date;
}) {
  const now = deps.clock ?? (() => new Date());
  const run = <T>(work: Promise<T>): Promise<T> => work.catch(asDonationsRefusal);

  function account(actor: DonationsActor): string {
    const parsed = donationAccountIdSchema.safeParse(actor?.accountId);
    if (!parsed.success) throw new DonationsRefusal('denied');
    return parsed.data;
  }

  return {
    /** The account's own linked donations, newest first, bounded. */
    async history(actor: DonationsActor): Promise<readonly OwnDonation[]> {
      return run(deps.owner.history(account(actor), OWN_DONATION_HISTORY));
    },

    /** Everything Donations links to the account, as one deterministic document. */
    async export(actor: DonationsActor): Promise<DonationExport> {
      const accountId = account(actor);
      await spend(deps.limiter, deps.key, 'export', accountId);
      const donations = await run(deps.owner.exportRows(accountId));
      return {
        schema: DONATION_EXPORT_SCHEMA,
        version: DONATION_EXPORT_VERSION,
        generatedAt: now().toISOString(),
        donations,
      };
    },
  };
}

export type DonationsOwnerService = ReturnType<typeof createDonationsOwnerService>;
