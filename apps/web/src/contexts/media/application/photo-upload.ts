import 'server-only';

import {
  mediaIdSchema,
  mediaVersionSchema,
  PHOTO_IMAGE_LIMITS,
  PHOTO_MEDIA_TYPES,
  PHOTO_UPLOAD_MAX_BYTES,
  type MediaActor,
  type MediaAuthorityPort,
  type MediaPersistencePort,
  type PhotoRecord,
} from '@minhaj/contracts/media';
import type { StorageServicePort } from '@minhaj/contracts/platform';

import { MediaRefusal, storageRefusal } from './refusal.ts';

/**
 * Uploading a Photo's image — Media's half of a two-owner operation
 * (DELIVERY_PLAN.md Phase 12: "asset handling via Phase 7"), built exactly as
 * the Phase-11 audio upload is.
 *
 * STORAGE HOLDS THE BYTES; MEDIA RECORDS WHICH BYTES A PHOTO IS. The image is
 * streamed straight into `StorageServicePort.store` under an IMAGE policy, so
 * Storage alone generates the key, validates the JPEG or PNG structure as it
 * arrives, refuses a header that asks for too many pixels, removes the hidden
 * metadata (location, device, owner, embedded thumbnails), measures, hashes,
 * sniffs, quarantines and scans. Only a `clean` answer — which then carries the
 * displayed dimensions Storage read — is recorded against the Photo, under the
 * version the operator uploaded against.
 *
 * FILESYSTEM AND SQL ARE NOT ONE TRANSACTION, and every crash window leaves a
 * state that serves nothing:
 *
 *   - before the relation is written, a stored image is referenced by no Photo,
 *     and the serving policy allows only the asset RECORDED against a Photo —
 *     a wasted file, never an exposure;
 *   - the relation is written only after a `clean` answer, so a Photo never
 *     names bytes that were not stored, validated, scanned and cleared;
 *   - a replacement writes the new relation in one conditional update and
 *     leaves the previous asset untouched, so a failed replacement never costs
 *     the last good image.
 *
 * Orphaned bytes are the deliberate price: deleting on a failure path risks
 * deleting the wrong authoritative image, and Storage's own bounded
 * reconciliation owns Storage's resources.
 *
 * NOT A DOOR AROUND AUTHORISATION. `media.administer` is re-read LIVE before a
 * byte is accepted, the Photo and its version are checked BEFORE a byte is
 * stored, and the attachment re-checks the version inside its own transaction.
 */

export interface PhotoFileDescription {
  /** What the browser SAID the type was. It can only refuse, never admit. */
  readonly declaredMediaType: string | null;
  /** The original filename, for display only. It never reaches a path. */
  readonly displayName: string | null;
}

export function createPhotoUpload(deps: {
  readonly persistence: MediaPersistencePort;
  readonly authority: MediaAuthorityPort;
  readonly storage: () => Promise<StorageServicePort>;
}) {
  return {
    async uploadPhoto(
      actor: MediaActor,
      photoId: string,
      expectedVersion: number,
      bytes: AsyncIterable<Uint8Array>,
      file: PhotoFileDescription,
    ): Promise<PhotoRecord> {
      if (
        !actor?.accountId ||
        !(await deps.authority.permits(actor.accountId, 'media.administer'))
      )
        throw new MediaRefusal('denied');

      const id = mediaIdSchema.parse(photoId);
      const version = mediaVersionSchema.parse(expectedVersion);

      const current = await deps.persistence.photo(id);
      if (current === null) throw new MediaRefusal('not-found');
      if (current.version !== version) throw new MediaRefusal('conflict');

      const storage = await deps.storage();
      const stored = await storage.store(bytes, {
        allowedMediaTypes: [...PHOTO_MEDIA_TYPES],
        maxBytes: PHOTO_UPLOAD_MAX_BYTES,
        image: PHOTO_IMAGE_LIMITS,
        declaredMediaType: file.declaredMediaType,
        displayName: file.displayName,
      });

      if (stored.state === 'rejected')
        throw new MediaRefusal(storageRefusal(stored.rejection));

      // ONLY A CLEAN, MEASURED IMAGE IS ATTACHED. One still in quarantine — the
      // scanner unreachable, or not yet done — is not an image this Photo has.
      if (stored.state !== 'clean' || stored.image === undefined)
        throw new MediaRefusal('not-cleared');

      return deps.persistence.attachPhotoAsset({
        actorId: actor.accountId,
        photoId: id,
        expectedVersion: version,
        assetId: stored.id,
        width: stored.image.width,
        height: stored.image.height,
      });
    },
  };
}
