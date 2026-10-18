import 'server-only';

import {
  createDonationActivationReader,
  createDonationCampaigns,
  createDonationCatalogueReader,
  createDonationCommunication,
  createDonationDisposition,
  createDonationDonor,
  createDonationLedger,
  createDonationOwner,
  createDonationRefunds,
  createDonationStaff,
  createRateLimiter,
  rateLimitKey,
} from '@minhaj/database';

import {
  createDonationsAccountService,
  createDonationsAdminService,
  createDonationsCommunicationService,
  createDonationsDonorService,
  createDonationsLedgerService,
  createDonationsOwnerService,
  type DonationsAccountService,
  type DonationsAdminService,
  type DonationsCommunicationService,
  type DonationsDonorService,
  type DonationsLedgerService,
  type DonationsLimitKey,
  type DonationsOwnerService,
} from '@/contexts/donations';
import { serverEnv } from '@/config/server-env';
import { donationsPaymentProvider } from './donations-provider';
import { identityRuntime } from './identity';

/**
 * The Donations composition root — Layer 4 (Phase 27).
 *
 * The only place that knows both Donations' ports and their adapters, and the
 * only one that hands the context its payment provider
 * (ARCHITECTURE.md §3.1.1). The services that leave it:
 *
 *   - `donor` — starting a donation (anonymous, or linked to the signed-in
 *     account the action resolved), and the status token's read, check and
 *     cancel. Budgets are the platform limiter's, keyed by a digest of the
 *     client address or account under each act's own purpose.
 *   - `owner` — a signed-in person's own donations behind `/my/donations`,
 *     and their Donations export.
 *   - `admin` — campaigns, records, CSV export, reconciliation and refunds,
 *     under a LIVE `hasPermission` read of exactly `donations.read`,
 *     `donations.administer` or `donations.refund` on every call. A refund's
 *     action additionally requires a privileged actor with a live
 *     `donation-refund` step-up.
 *   - `ledger` — the provider webhook and the reconciliation sweep.
 *   - `account` — Donations' part of a closed account's disposition.
 *   - `communication` — a linked donor's payment acknowledgement, relayed by
 *     the dispatcher through the shared email concern; Identity resolves the
 *     recipient at relay and at send.
 *
 * EVERY ANSWER DONATIONS ASKS FOR IS IDENTITY'S, LIVE, through its public
 * interface: a permission, which accounts are closed, and an active account's
 * current address and locale. No profile, role name or other context's record
 * is on any path.
 *
 * IT DOES NOT SERVE THE PUBLIC GIVING PAGE. `./donations-read.ts` is that
 * root, and it reaches no Identity and no provider secret.
 */

interface DonationsRuntime {
  readonly donor: DonationsDonorService;
  readonly owner: DonationsOwnerService;
  readonly admin: DonationsAdminService;
  readonly ledger: DonationsLedgerService;
  readonly account: DonationsAccountService;
  readonly communication: DonationsCommunicationService;
}

let runtime: DonationsRuntime | null = null;

export function donationsRuntime(): DonationsRuntime {
  if (runtime) return runtime;
  const environment = serverEnv();
  const configuration = {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };
  const key: DonationsLimitKey = (purpose, subject) =>
    rateLimitKey({ purpose, subject, configuration });
  const limiter = createRateLimiter(configuration);
  const provider = donationsPaymentProvider();
  const baseUrl = environment.AUTH_BASE_URL;

  const donor = createDonationDonor();
  const ledger = createDonationLedger();
  const refunds = createDonationRefunds();
  const catalogue = createDonationCatalogueReader();
  const activation = createDonationActivationReader();

  return (runtime = {
    donor: createDonationsDonorService({
      donor,
      catalogue,
      activation,
      ledger,
      provider,
      limiter,
      key,
      baseUrl,
    }),
    owner: createDonationsOwnerService({ owner: createDonationOwner(), limiter, key }),
    admin: createDonationsAdminService({
      campaigns: createDonationCampaigns(),
      staff: createDonationStaff(),
      refunds,
      ledger,
      provider,
      authority: {
        permits: (accountId, permission) =>
          identityRuntime().authorization.hasPermission(accountId, permission),
      },
    }),
    ledger: createDonationsLedgerService({ ledger, donor, refunds, provider, baseUrl }),
    account: createDonationsAccountService({
      disposition: createDonationDisposition(),
      // Identity's OWN answer about its own lifecycle, and nothing more.
      accounts: {
        closedAccounts: (ids) => identityRuntime().administration.closedAccounts(ids),
      },
    }),
    communication: createDonationsCommunicationService({
      communication: createDonationCommunication(),
      recipients: {
        recipients: (accountIds) =>
          identityRuntime().administration.serviceRecipients(accountIds),
      },
      ledger,
      enqueue: async (delivery) => {
        await identityRuntime().deliveries.enqueue(delivery);
      },
      baseUrl,
    }),
  });
}
