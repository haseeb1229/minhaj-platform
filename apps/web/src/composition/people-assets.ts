import 'server-only';

import type { PeopleReaderPort } from '@minhaj/contracts/people';
import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';
import { createPeopleReader } from '@minhaj/database';

import { createPortraitAssetPolicy } from '@/contexts/people-contributors';

/**
 * The PUBLIC portrait policy — People's business half of the two allows for a
 * contributor's portrait (Phase 30-R).
 *
 * A COMPOSITION ROOT OF ITS OWN, as Media's and Library's asset roots are: the
 * public byte route's module graph holds People's reader and Storage and
 * nothing else — no Identity, no session service, nothing that could read a
 * cookie — so a signed-in visitor receives exactly what an anonymous one does.
 */

let reader: PeopleReaderPort | null = null;

export function portraitAssetPolicy(request: {
  readonly personId: string;
  readonly assetId: string;
}): AssetAuthorizationPort {
  return createPortraitAssetPolicy({
    relations: (reader ??= createPeopleReader()),
    request,
  });
}
