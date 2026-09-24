import 'server-only';

import type {
  AudioAssetRequest,
  MediaAssetRelationPort,
  PhotoAssetRequest,
  PhotoRecord,
} from '@minhaj/contracts/media';
import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';
import { createMediaAssetRelations } from '@minhaj/database';

import { createAudioAssetPolicy, createPhotoAssetPolicy } from '@/contexts/media';
import { storageRuntime } from './storage';

/**
 * The PUBLIC serving policies — Media's business half of the two allows for an
 * AudioTrack's recording (Phase 11) and a Photo's image (Phase 12)
 * (DELIVERY_PLAN.md §3).
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

/** How many assets one servability question names — Storage's own bound. */
const SERVABLE_QUESTION = 100;

/** The decision for one public request for a Photo's image (Phase 12). */
export function photoAssetPolicy(request: PhotoAssetRequest): AssetAuthorizationPort {
  return createPhotoAssetPolicy({ relations: relationReader(), request });
}

/**
 * Which of these Photos' images Storage could serve RIGHT NOW — for a whole
 * page in one bounded question, or a few for a Gallery's editor (Phase 12).
 *
 * The page offers an image only where fetching it can work, so a Photo whose
 * bytes are missing after a restore, or were never cleared, is shown as
 * honestly unavailable rather than as a broken image box. Every Photo passed
 * here comes from an authorised read — Media's public reader, or an
 * administrative read behind `media.read` — so this answers a TECHNICAL
 * question only; the byte route still makes both decisions per request.
 *
 * An outage is not a content state: Storage failing to answer propagates to the
 * page's error boundary, as `audioPlayable` does.
 */
export async function servablePhotos(
  photos: readonly Pick<PhotoRecord, 'id' | 'assetId'>[],
): Promise<ReadonlySet<string>> {
  const assets = [
    ...new Set(
      photos.flatMap((photo) => (photo.assetId === null ? [] : [photo.assetId])),
    ),
  ];
  if (assets.length === 0) return new Set();
  const storage = await storageRuntime();
  // Storage answers at most a hundred at a time; a Gallery's editor asks about
  // its whole membership (at most 240) and one page of candidates.
  const servable = new Set<string>();
  for (let start = 0; start < assets.length; start += SERVABLE_QUESTION) {
    for (const id of await storage.servable(
      assets.slice(start, start + SERVABLE_QUESTION),
    ))
      servable.add(id);
  }
  return new Set(
    photos.flatMap((photo) =>
      photo.assetId !== null && servable.has(photo.assetId) ? [photo.id] : [],
    ),
  );
}
