import 'server-only';

import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';
import type { QuranAuthorityPort, QuranPersistencePort } from '@minhaj/contracts/quran';
import {
  createQuranCanonical,
  createQuranPersistence,
  createRateLimiter,
  rateLimitKey,
} from '@minhaj/database';

import {
  createQuranCanonicalService,
  createQuranService,
  createRecitationPreviewPolicy,
  createRecitationUpload,
  type CanonicalLog,
  type RecitationAssetRequest,
} from '@/contexts/quran';
import { serverEnv } from '@/config/server-env';
import { identityRuntime } from './identity';
import { appLogger } from './logging';
import { storageRuntime } from './storage';

/**
 * The ADMINISTRATIVE Quran composition root — Layer 4.
 *
 * The only place that knows both Quran's ports and their adapters
 * (ARCHITECTURE.md §3.1.1). Quran receives interfaces — persistence, the
 * canonical procedures, authority, Storage's narrow service — and can reach
 * neither the Prisma client nor the SQL behind any of them.
 *
 * THE AUTHORITY PORT IS IDENTITY'S, LIVE. `permits` is the same
 * `hasPermission` every administrative runtime uses, so a revoked Quran role
 * denies the next action. `verifyCanonical` is Identity's
 * `verifyPrivilegedActor` for exactly `quran.editCanonical` and the
 * `quran-canonical-edit` step-up purpose: it accepts only the frozen actor
 * Identity minted, with the permission, a complete second-factor posture and a
 * live grant for that purpose still held — and the database procedure checks
 * the grant again before it writes. No profile, no reciter credit and no other
 * context's key is on either path (DOMAIN_MODEL.md §4.5).
 *
 * THE CANONICAL SERVICE LOGS THROUGH A NARROW FACE of the application logger:
 * identifiers, references, counts and offsets. It is never handed text.
 *
 * IT DOES NOT SERVE PUBLIC PAGES. `./quran-read.ts` and `./quran-assets.ts` are
 * the roots for those, and they reach no Identity at all.
 */
const authority: QuranAuthorityPort = {
  permits: (accountId, permission) =>
    identityRuntime().authorization.hasPermission(accountId, permission),
  verifyCanonical: (actor) =>
    identityRuntime().authorization.verifyPrivilegedActor({
      actor,
      permission: 'quran.editCanonical',
      stepUp: 'quran-canonical-edit',
    }),
};

const log: CanonicalLog = {
  info: (detail, message) => appLogger().info(detail, message),
  warn: (detail, message) => appLogger().warn(detail, message),
};

let persistence: QuranPersistencePort | null = null;

function quranPersistence(): QuranPersistencePort {
  return (persistence ??= createQuranPersistence());
}

function buildQuranRuntime() {
  const store = quranPersistence();
  return {
    quran: createQuranService({ persistence: store, authority }),
    canonical: createQuranCanonicalService({
      canonical: createQuranCanonical(),
      persistence: store,
      authority,
      log,
    }),
    upload: createRecitationUpload({
      persistence: store,
      authority,
      storage: storageRuntime,
    }),
  };
}

let runtime: ReturnType<typeof buildQuranRuntime> | null = null;

export function quranRuntime(): ReturnType<typeof buildQuranRuntime> {
  return (runtime ??= buildQuranRuntime());
}

/**
 * The PRIVILEGED serving policy: an administrator hearing a segment's audio
 * before its Recitation is public.
 *
 * WHY IT EXISTS. Without it the only way to check that the right recording was
 * attached would be to publish the Recitation and listen — a review step
 * performed in public. It allows exactly one thing: the asset ALREADY RECORDED
 * against that exact segment, to a caller holding `quran.read` right now,
 * re-read live. An arbitrary asset identifier is refused, and Storage still
 * refuses a quarantined or infected file to an administrator exactly as to
 * anybody else.
 */
export function quranPreviewRecitationPolicy(
  request: RecitationAssetRequest,
  accountId: string,
): AssetAuthorizationPort {
  return createRecitationPreviewPolicy({
    persistence: quranPersistence(),
    authority,
    accountId,
    request,
  });
}

/**
 * The upload budget for one operator — "file upload" is a protected flow
 * (SECURITY_BASELINE.md §15.2).
 *
 * ITS OWN PURPOSE, so recording a recitation's segments neither spends nor is
 * starved by Media's audio budget. PER ACCOUNT, digested by the shared limiter
 * before it is stored. THIRTY IN FIFTEEN MINUTES: a recitation is uploaded a
 * segment at a time, so an operator sends more files in a sitting than for one
 * lecture, each at most 64 MiB and scanned in full — enough for a working
 * session, far below what filling a disk or pinning the scanner would take. A
 * ceiling on abuse, not a workflow control.
 */
const UPLOAD_RULE = { window: 900, max: 30 } as const;

let uploadLimiter: ReturnType<typeof createRateLimiter> | null = null;

export async function consumeRecitationUpload(accountId: string): Promise<boolean> {
  const environment = serverEnv();
  const configuration = {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };
  const limiter = (uploadLimiter ??= createRateLimiter(configuration));
  const decision = await limiter.consume(
    rateLimitKey({
      purpose: 'quran-recitation-upload',
      subject: accountId,
      configuration,
    }),
    UPLOAD_RULE,
  );
  return decision.allowed;
}
