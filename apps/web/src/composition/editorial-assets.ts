import 'server-only';

import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';
import { createEditorialPublicReader } from '@minhaj/database';

import { createLeadImagePolicy, type LeadImageRequest } from '@/contexts/editorial';

/**
 * The PUBLIC serving policy for an Editorial lead image (Phase 30-R).
 *
 * A COMPOSITION ROOT OF ITS OWN, for the reason Media's `./media-assets.ts`
 * gives: the public byte route's module graph contains NO Identity, no session
 * service and nothing that could read a cookie. It reaches Editorial's public
 * reader and stops, so a signed-in visitor receives exactly what an anonymous
 * one does. Storage still decides its technical half independently.
 */

let reader: ReturnType<typeof createEditorialPublicReader> | null = null;

export function leadImagePolicy(request: LeadImageRequest): AssetAuthorizationPort {
  const read = (reader ??= createEditorialPublicReader());
  return createLeadImagePolicy({
    request,
    relation: (family, recordId, assetId) =>
      read.publishedLeadImage(family, recordId, assetId),
  });
}
