import {
  AUDIO_MEDIA_TYPES,
  mediaIdSchema,
  PHOTO_MEDIA_TYPES,
  type AudioAssetRequest,
  type MediaAssetRelationPort,
  type MediaAuthorityPort,
  type MediaState,
  type PhotoAssetRequest,
} from '@minhaj/contracts/media';
import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';

/**
 * Media's authorisation policy for the bytes it records — an AudioTrack's
 * recording (Phase 11) and a Photo's image (Phase 12). The BUSINESS half of the
 * two independent allows (DELIVERY_PLAN.md §3, "private asset serving").
 *
 * STORAGE DECIDES FIRST AND INDEPENDENTLY. `StorageServicePort.open` consults
 * this policy only for an asset that is `clean`, and it still refuses if the
 * bytes are missing on disk. Nothing here can make a quarantined, rejected or
 * failed asset servable, and a clean asset is worth nothing without this.
 *
 * WHAT THIS DECIDES — ALL OF IT, EVERY TIME:
 *
 *   - the identifiers from the URL are well-formed, and the asset Storage
 *     resolved IS the one the URL named;
 *   - the asset is of a type the record's kind accepts — audio for a track, a
 *     still image for a Photo — so an asset of any other type is refused even
 *     if something recorded it;
 *   - the asset is the ONE recorded against this exact record — a clean file of
 *     another record, a replaced file, or an orphaned upload is refused, so no
 *     identifier can be guessed into being served;
 *   - for PUBLIC serving, the record is `published` — a draft or archived
 *     record's file is refused to everyone, the moment it is withdrawn;
 *   - for an administrator's PREVIEW, the caller holds `media.administer` right
 *     now, read live — never a role name, a profile, or what the session was
 *     issued with.
 *
 * ANYTHING ELSE IS A DENIAL, and Storage additionally treats a throw or a
 * malformed answer as one. There is no download purpose: seeing or hearing
 * something does not imply a right to keep a copy, and no approved download
 * contract exists.
 */

interface Preview {
  readonly accountId: string;
  readonly authority: MediaAuthorityPort;
}

/** The one decision both kinds of record share. */
function recordedAssetPolicy(deps: {
  readonly recordId: string;
  readonly assetId: string;
  readonly mediaTypes: readonly string[];
  readonly relation: () => Promise<{
    readonly state: MediaState;
    readonly assetId: string | null;
  } | null>;
  readonly preview: Preview | undefined;
}): AssetAuthorizationPort {
  return {
    async decide(asset) {
      if (
        !mediaIdSchema.safeParse(deps.recordId).success ||
        !mediaIdSchema.safeParse(deps.assetId).success ||
        asset.assetId !== deps.assetId ||
        !deps.mediaTypes.includes(asset.mediaType)
      )
        return 'deny';

      const relation = await deps.relation();
      if (relation === null || relation.assetId !== deps.assetId) return 'deny';

      if (deps.preview !== undefined) {
        return (await deps.preview.authority.permits(
          deps.preview.accountId,
          'media.administer',
        ))
          ? 'allow'
          : 'deny';
      }

      return relation.state === 'published' ? 'allow' : 'deny';
    },
  };
}

/** An AudioTrack's recording (Phase 11). */
export function createAudioAssetPolicy(deps: {
  readonly relations: MediaAssetRelationPort;
  readonly request: AudioAssetRequest;
  readonly preview?: Preview;
}): AssetAuthorizationPort {
  const { trackId, assetId } = deps.request;
  return recordedAssetPolicy({
    recordId: trackId,
    assetId,
    mediaTypes: AUDIO_MEDIA_TYPES,
    relation: () => deps.relations.audioAsset(trackId),
    preview: deps.preview,
  });
}

/** A Photo's image (Phase 12). */
export function createPhotoAssetPolicy(deps: {
  readonly relations: MediaAssetRelationPort;
  readonly request: PhotoAssetRequest;
  readonly preview?: Preview;
}): AssetAuthorizationPort {
  const { photoId, assetId } = deps.request;
  return recordedAssetPolicy({
    recordId: photoId,
    assetId,
    mediaTypes: PHOTO_MEDIA_TYPES,
    relation: () => deps.relations.photoAsset(photoId),
    preview: deps.preview,
  });
}
