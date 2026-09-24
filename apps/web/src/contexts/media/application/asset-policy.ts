import {
  AUDIO_MEDIA_TYPES,
  mediaIdSchema,
  type AudioAssetRequest,
  type MediaAssetRelationPort,
  type MediaAuthorityPort,
} from '@minhaj/contracts/media';
import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';

/**
 * Media's authorisation policy for an AudioTrack's bytes — the BUSINESS half of
 * the two independent allows (DELIVERY_PLAN.md §3, "private asset serving";
 * Phase 11).
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
 *   - the asset is audio: Media serves only the formats it accepts, so an asset
 *     of any other type is refused even if something recorded it;
 *   - the asset is the ONE recorded against this exact track — a clean file
 *     belonging to another track, a replaced file, or an orphaned upload is
 *     refused, so no identifier can be guessed into playing;
 *   - for PUBLIC playback, the track is `published` — a draft or archived
 *     track's file is refused to everyone;
 *   - for an administrator's PREVIEW, the caller holds `media.administer` right
 *     now, read live — never a role name, a profile, or what the session was
 *     issued with.
 *
 * ANYTHING ELSE IS A DENIAL, and Storage additionally treats a throw or a
 * malformed answer as one. There is no download purpose: playback does not
 * imply a right to keep a copy, and no approved download contract exists.
 */
export function createAudioAssetPolicy(deps: {
  readonly relations: MediaAssetRelationPort;
  readonly request: AudioAssetRequest;
  readonly preview?: {
    readonly accountId: string;
    readonly authority: MediaAuthorityPort;
  };
}): AssetAuthorizationPort {
  return {
    async decide(asset) {
      const { trackId, assetId } = deps.request;
      if (
        !mediaIdSchema.safeParse(trackId).success ||
        !mediaIdSchema.safeParse(assetId).success ||
        asset.assetId !== assetId ||
        !(AUDIO_MEDIA_TYPES as readonly string[]).includes(asset.mediaType)
      )
        return 'deny';

      const relation = await deps.relations.audioAsset(trackId);
      if (relation === null || relation.assetId !== assetId) return 'deny';

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
