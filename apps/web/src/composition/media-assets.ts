import 'server-only';

import type { AudioAssetRequest, MediaAssetRelationPort } from '@minhaj/contracts/media';
import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';
import { createMediaAssetRelations } from '@minhaj/database';

import { createAudioAssetPolicy } from '@/contexts/media';
import { storageRuntime } from './storage';

/**
 * The PUBLIC audio serving policy — Media's business half of the two allows
 * (DELIVERY_PLAN.md §3, Phase 11).
 *
 * A COMPOSITION ROOT OF ITS OWN, for the reason Library's `./library-assets.ts`
 * gives: the public byte route's module graph must contain NO Identity, no
 * session service and nothing that could read a cookie. `./media.ts` wires
 * Identity in for the administration; this reaches Media's relation read and
 * Storage, and stops. A signed-in listener receives exactly what an anonymous
 * one does.
 *
 * STORAGE STILL DECIDES INDEPENDENTLY. What this produces is the business
 * decision; `StorageServicePort.open` applies the technical one — clean custody,
 * bytes present — and returns nothing unless both permit.
 */

let relations: MediaAssetRelationPort | null = null;

function relationReader(): MediaAssetRelationPort {
  return (relations ??= createMediaAssetRelations());
}

/** The decision for one public request for a track's bytes. */
export function audioAssetPolicy(request: AudioAssetRequest): AssetAuthorizationPort {
  return createAudioAssetPolicy({ relations: relationReader(), request });
}

/**
 * Would the public byte route serve this track's audio RIGHT NOW?
 *
 * The page asks the SAME two owners the route asks — Media's policy and
 * Storage's `open` — so a player is offered exactly when pressing play can work,
 * and a track whose file is missing after a restore, or never cleared, shows an
 * honest unavailable state instead of a control that fails. Nothing is read:
 * the stream `open` returns is lazy and is dropped unopened.
 *
 * AN OUTAGE IS NOT A CONTENT STATE. Missing or uncleared bytes are an answer —
 * `null`, and the page says the recording is unavailable. Storage being unable
 * to answer at all is an infrastructure failure: it propagates to the public
 * error boundary like any other failed read, and the server records it. It is
 * never swallowed into a guess, and no logger or server environment enters the
 * public graph to do so (ARCHITECTURE.md §8.1).
 */
export async function audioPlayable(request: AudioAssetRequest): Promise<boolean> {
  const storage = await storageRuntime();
  const asset = await storage.open(request.assetId, audioAssetPolicy(request));
  return asset !== null;
}
