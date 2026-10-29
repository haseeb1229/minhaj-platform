import { z } from 'zod';

import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';

/**
 * People's authorisation policy for a contributor's PORTRAIT bytes (Phase
 * 30-R) — the business half of the two independent allows. Storage decides
 * first and independently: it consults this only for a clean asset whose bytes
 * are present.
 *
 * WHAT THIS DECIDES, ALL OF IT, EVERY TIME:
 *
 *   - both identifiers from the URL are well-formed, and the asset Storage
 *     resolved IS the one the URL named;
 *   - the asset is a still image (JPEG or PNG), whatever recorded it;
 *   - it is the portrait recorded on THIS Person, and that Person is published
 *     — one question to People's reader, both predicates in the query — so a
 *     draft's or an archived contributor's portrait is refused to everyone the
 *     moment it is withdrawn, and no identifier can be guessed into being
 *     served.
 *
 * Anything else is a denial. There is no preview and no download purpose.
 */

const idSchema = z.uuid();

/** The two raster types Storage's image pipeline admits. */
export const PORTRAIT_MEDIA_TYPES: readonly string[] = Object.freeze([
  'image/jpeg',
  'image/png',
]);

/** People's one read the policy needs. */
export interface PortraitRelationPort {
  isPublicPortrait(personId: string, assetId: string): Promise<boolean>;
}

export function createPortraitAssetPolicy(deps: {
  readonly relations: PortraitRelationPort;
  readonly request: { readonly personId: string; readonly assetId: string };
}): AssetAuthorizationPort {
  const { personId, assetId } = deps.request;
  return {
    async decide(asset) {
      if (
        !idSchema.safeParse(personId).success ||
        !idSchema.safeParse(assetId).success ||
        asset.assetId !== assetId ||
        !PORTRAIT_MEDIA_TYPES.includes(asset.mediaType)
      )
        return 'deny';
      return (await deps.relations.isPublicPortrait(personId, assetId))
        ? 'allow'
        : 'deny';
    },
  };
}
