import 'server-only';

import type { HadithAuthorityPort } from '@minhaj/contracts/hadith';
import { createHadithCanonical, createHadithPersistence } from '@minhaj/database';

import {
  createHadithCanonicalService,
  createHadithService,
  type HadithCanonicalLog,
  type HadithCanonicalService,
  type HadithService,
} from '@/contexts/hadith';
import { identityRuntime } from './identity';
import { appLogger } from './logging';

/**
 * The ADMINISTRATIVE Hadith composition root — Layer 4.
 *
 * The only place that knows both Hadith's ports and their adapters
 * (ARCHITECTURE.md §3.1.1). Hadith receives interfaces — persistence, the
 * canonical procedures and authority — and can reach neither the Prisma client
 * nor the SQL behind any of them.
 *
 * THE AUTHORITY PORT IS IDENTITY'S, LIVE. `permits` is the same
 * `hasPermission` every administrative runtime uses, so a revoked Hadith role
 * denies the next action. `verifyCanonical` is Identity's
 * `verifyPrivilegedActor` for exactly `hadith.editCanonical` and the
 * `hadith-canonical-edit` step-up purpose: it accepts only the frozen actor
 * Identity minted, with the permission, a complete second-factor posture and a
 * live grant for that purpose still held — and every database procedure checks
 * the grant again before it writes. No profile, no contributor credit and no
 * other context's key — the Quran's included — is on either path
 * (DOMAIN_MODEL.md §4.5).
 *
 * THE CANONICAL SERVICE LOGS THROUGH A NARROW FACE of the application logger:
 * identifiers, citation numbers, versions and counts. It is never handed text.
 *
 * IT DOES NOT SERVE PUBLIC PAGES. `./hadith-read.ts` is the root for those, and
 * it reaches no Identity at all.
 */
const authority: HadithAuthorityPort = {
  permits: (accountId, permission) =>
    identityRuntime().authorization.hasPermission(accountId, permission),
  verifyCanonical: (actor) =>
    identityRuntime().authorization.verifyPrivilegedActor({
      actor,
      permission: 'hadith.editCanonical',
      stepUp: 'hadith-canonical-edit',
    }),
};

const log: HadithCanonicalLog = {
  info: (detail, message) => appLogger().info(detail, message),
  warn: (detail, message) => appLogger().warn(detail, message),
};

interface HadithRuntime {
  readonly hadith: HadithService;
  readonly canonical: HadithCanonicalService;
}

let runtime: HadithRuntime | null = null;

export function hadithRuntime(): HadithRuntime {
  return (runtime ??= {
    hadith: createHadithService({ persistence: createHadithPersistence(), authority }),
    canonical: createHadithCanonicalService({
      canonical: createHadithCanonical(),
      authority,
      log,
    }),
  });
}
