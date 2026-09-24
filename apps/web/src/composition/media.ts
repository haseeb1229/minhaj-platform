import 'server-only';

import type { AudioAssetRequest, MediaAssetRelationPort } from '@minhaj/contracts/media';
import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';
import {
  createMediaAssetRelations,
  createMediaPersistence,
  createRateLimiter,
  rateLimitKey,
} from '@minhaj/database';

import {
  createAudioAssetPolicy,
  createAudioUpload,
  createMediaService,
} from '@/contexts/media';
import { serverEnv } from '@/config/server-env';
import { identityRuntime } from './identity';
import { ownerReferences } from './owner-references';
import { storageRuntime } from './storage';

/**
 * The ADMINISTRATIVE Media composition root — Layer 4.
 *
 * The only place that knows both Media's ports and their adapters
 * (ARCHITECTURE.md §3.1.1). Media receives three interfaces — persistence,
 * authority, references — and can reach neither the Prisma client nor the SQL
 * behind any of them.
 *
 * THE AUTHORITY PORT IS A LIVE READ, the same `hasPermission` every other
 * administrative runtime uses, so a revoked Media role denies the next action.
 * No profile and no speaker credit is on this path: a profile alone grants
 * nothing (DOMAIN_MODEL.md §4.5).
 *
 * REFERENCES ARE ANSWERED BY THEIR OWNERS' PUBLIC READS — People for speakers,
 * Taxonomy for topics and content languages — through the one implementation
 * the Library shares (`./owner-references.ts`).
 *
 * PHASE 11 — THE AUDIO UPLOAD is handed Storage's narrow service and nothing
 * else of Storage: no root, no path, no Asset table.
 *
 * IT DOES NOT SERVE PUBLIC PAGES. `./media-read.ts` and `./media-assets.ts` are
 * the roots for those, and they reach no Identity at all.
 */
const authority = {
  permits: (accountId: string, permission: string) =>
    identityRuntime().authorization.hasPermission(accountId, permission),
};

function buildMediaRuntime() {
  const persistence = createMediaPersistence();
  return {
    media: createMediaService({
      persistence,
      authority,
      references: ownerReferences,
    }),
    audioUpload: createAudioUpload({ persistence, authority, storage: storageRuntime }),
  };
}

let runtime: ReturnType<typeof buildMediaRuntime> | null = null;

export function mediaRuntime(): ReturnType<typeof buildMediaRuntime> {
  return (runtime ??= buildMediaRuntime());
}

let previewRelations: MediaAssetRelationPort | null = null;

/**
 * The PRIVILEGED serving policy: an administrator listening to a track's file
 * before it is public.
 *
 * WHY IT EXISTS. Without it the only way to check that the right recording was
 * attached would be to publish the track and listen — a review step performed
 * in public. It allows exactly one thing: the asset ALREADY RECORDED against
 * that exact track, to a caller holding `media.administer` right now, re-read
 * live. An arbitrary asset identifier is refused, and Storage still refuses a
 * quarantined or infected file to an administrator exactly as to anybody else.
 */
export function mediaPreviewAudioPolicy(
  request: AudioAssetRequest,
  accountId: string,
): AssetAuthorizationPort {
  return createAudioAssetPolicy({
    relations: (previewRelations ??= createMediaAssetRelations()),
    request,
    preview: { accountId, authority },
  });
}

/**
 * The state of a track's attached file, as the administration shows it.
 *
 * Answered by STORAGE through the preview decision — never by reading the Asset
 * table — so an operator is told the truth the preview route would act on: the
 * file plays, or it cannot be served right now. The stream is lazy and dropped
 * unopened; only the technical facts Storage already returns are kept.
 */
export async function audioAssetStatus(
  request: AudioAssetRequest,
  accountId: string,
): Promise<{ readonly mediaType: string; readonly byteSize: number } | null> {
  const storage = await storageRuntime();
  const asset = await storage.open(
    request.assetId,
    mediaPreviewAudioPolicy(request, accountId),
  );
  return asset === null ? null : { mediaType: asset.mediaType, byteSize: asset.byteSize };
}

/**
 * The upload budget for one operator — "file upload" is a protected flow
 * (SECURITY_BASELINE.md §15.2).
 *
 * PER ACCOUNT, digested by the shared limiter before it is stored. TEN IN
 * FIFTEEN MINUTES: an audio file is up to 64 MiB and is scanned in full, so the
 * budget is half the Library's, far above what cataloguing a series of talks
 * needs and far below what filling a disk or pinning the scanner would take. It
 * is a ceiling on abuse, not a workflow control.
 */
const UPLOAD_RULE = { window: 900, max: 10 } as const;

let uploadLimiter: ReturnType<typeof createRateLimiter> | null = null;

export async function consumeMediaUpload(accountId: string): Promise<boolean> {
  const environment = serverEnv();
  const configuration = {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };
  const limiter = (uploadLimiter ??= createRateLimiter(configuration));
  const decision = await limiter.consume(
    rateLimitKey({ purpose: 'media-upload', subject: accountId, configuration }),
    UPLOAD_RULE,
  );
  return decision.allowed;
}
