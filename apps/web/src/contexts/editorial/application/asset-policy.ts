import { z } from 'zod';
import {
  editorialIdSchema,
  isEditorialLeadFamily,
  type EditorialLeadFamily,
} from '@minhaj/contracts/editorial';
import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';

/**
 * Editorial's authorisation policy for a LEAD IMAGE's bytes (Phase 30-R) — the
 * business half of the two independent allows; Storage's `open` makes the
 * technical half (clean custody, bytes present) on its own and first.
 *
 * WHAT THIS DECIDES, ALL OF IT, EVERY TIME:
 *
 *   - the family is one that carries a lead image, and the identifiers from the
 *     address are well-formed, and the asset Storage resolved IS the one the
 *     address named;
 *   - the asset is a still image (JPEG or PNG), so nothing else can ever be
 *     served as a lead image whatever recorded it;
 *   - for PUBLIC serving, the record is PUBLISHED and its published revision
 *     names exactly this asset — a draft's image, a replaced image, another
 *     record's image and an orphaned upload are all refused, the moment the
 *     record is withdrawn or revised;
 *   - for an administrator's PREVIEW, the record's CURRENT revision names it,
 *     whatever its state, and the caller holds `content.read` right now, read
 *     live — so a reviewer sees the image before approving it.
 *
 * ANYTHING ELSE IS A DENIAL; Storage treats a throw as one too.
 */

const LEAD_IMAGE_TYPES: readonly string[] = Object.freeze(['image/jpeg', 'image/png']);

const assetIdSchema = z.uuid();

/** One request for a lead image's bytes, exactly as the address names it. */
export interface LeadImageRequest {
  readonly family: string;
  readonly recordId: string;
  readonly assetId: string;
}

/** Editorial's own answer: does that revision name exactly that asset? */
export type LeadImageRelation = (
  family: EditorialLeadFamily,
  recordId: string,
  assetId: string,
) => Promise<boolean>;

export function createLeadImagePolicy(deps: {
  readonly request: LeadImageRequest;
  /** `publishedLeadImage` for the public route; `currentLeadImage` for a preview. */
  readonly relation: LeadImageRelation;
  readonly preview?: {
    readonly accountId: string;
    readonly authority: {
      permits(accountId: string, permission: string): Promise<boolean>;
    };
  };
}): AssetAuthorizationPort {
  const { family, recordId, assetId } = deps.request;
  return {
    async decide(asset) {
      if (
        !isEditorialLeadFamily(family) ||
        !editorialIdSchema.safeParse(recordId).success ||
        !assetIdSchema.safeParse(assetId).success ||
        asset.assetId !== assetId ||
        !LEAD_IMAGE_TYPES.includes(asset.mediaType)
      )
        return 'deny';
      if (!(await deps.relation(family, recordId, assetId))) return 'deny';
      if (deps.preview === undefined) return 'allow';
      return (await deps.preview.authority.permits(
        deps.preview.accountId,
        'content.read',
      ))
        ? 'allow'
        : 'deny';
    },
  };
}
