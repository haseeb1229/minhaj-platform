import 'server-only';

import {
  createMembershipApplicant,
  createMembershipCatalogue,
  createMembershipCommunication,
  createMembershipDisposition,
  createMembershipExport,
  createMembershipStaff,
  createRateLimiter,
  rateLimitKey,
} from '@minhaj/database';
import type { MembershipAccountsPort } from '@minhaj/contracts/membership';

import {
  createMembershipAccountService,
  createMembershipAdminService,
  createMembershipApplicantService,
  createMembershipCommunicationService,
  type MembershipAccountService,
  type MembershipAdminService,
  type MembershipApplicantService,
  type MembershipCommunicationService,
  type MembershipLimitKey,
} from '@/contexts/membership';
import { serverEnv } from '@/config/server-env';
import { identityRuntime } from './identity';

/**
 * The AUTHENTICATED Membership composition root — Layer 4 (Phase 26).
 *
 * The only place that knows both Membership's ports and their adapters
 * (ARCHITECTURE.md §3.1.1). The services that leave it:
 *
 *   - `applicant` — a signed-in person's own applications and Memberships
 *     behind `/my/membership`, and their Membership export. The actor is the
 *     session's account; no key is asked or conferred.
 *   - `admin` — the type catalogue, the application queue and its decisions,
 *     and the members list, under a LIVE `hasPermission` read of exactly
 *     `membership.read` or `membership.administer` on every call.
 *   - `account` — Membership's part of a closed account's disposition.
 *   - `communication` — Membership's durable service-mail intent, relayed by
 *     the dispatcher through the shared email concern; Identity resolves the
 *     recipient at relay and at send.
 *
 * EVERY ANSWER MEMBERSHIP ASKS FOR IS IDENTITY'S, LIVE, through its public
 * interface: a permission, which accounts are closed, and an active account's
 * current address and locale. No profile, role name, person, centre or other
 * context's record is on any path (DOMAIN_MODEL.md §17.2).
 *
 * THE APPLICANT'S LIMITER IS THE PLATFORM'S, keyed by a digest of the account
 * id under a purpose of each act's own — never by anything a form says.
 *
 * IT DOES NOT SERVE PUBLIC PAGES. `./membership-read.ts` is the root for the
 * public catalogue, and it reaches no Identity at all.
 */

interface MembershipRuntime {
  readonly applicant: MembershipApplicantService;
  readonly admin: MembershipAdminService;
  readonly account: MembershipAccountService;
  readonly communication: MembershipCommunicationService;
}

let runtime: MembershipRuntime | null = null;

export function membershipRuntime(): MembershipRuntime {
  if (runtime) return runtime;
  const environment = serverEnv();
  const configuration = {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };
  const key: MembershipLimitKey = (purpose, subject) =>
    rateLimitKey({ purpose, subject, configuration });

  // Identity's OWN answer about its own lifecycle, and nothing more.
  const accounts: MembershipAccountsPort = {
    closedAccounts: (ids) => identityRuntime().administration.closedAccounts(ids),
  };

  return (runtime = {
    applicant: createMembershipApplicantService({
      applicant: createMembershipApplicant(),
      exporter: createMembershipExport(),
      limiter: createRateLimiter(configuration),
      key,
    }),
    admin: createMembershipAdminService({
      catalogue: createMembershipCatalogue(),
      staff: createMembershipStaff(),
      authority: {
        permits: (accountId, permission) =>
          identityRuntime().authorization.hasPermission(accountId, permission),
      },
      accounts,
    }),
    account: createMembershipAccountService({
      disposition: createMembershipDisposition(),
      accounts,
    }),
    communication: createMembershipCommunicationService({
      communication: createMembershipCommunication(),
      recipients: {
        recipients: (accountIds) =>
          identityRuntime().administration.serviceRecipients(accountIds),
      },
      enqueue: async (delivery) => {
        await identityRuntime().deliveries.enqueue(delivery);
      },
      baseUrl: environment.AUTH_BASE_URL,
    }),
  });
}
