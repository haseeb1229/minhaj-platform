import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';
import {
  RECITATION_AUDIO_MEDIA_TYPES,
  quranIdSchema,
  type QuranAuthorityPort,
  type QuranPersistencePort,
  type QuranPublicReaderPort,
} from '@minhaj/contracts/quran';

/**
 * Quran's authorisation policy for a recitation segment's audio — the BUSINESS
 * half of the two independent allows (DELIVERY_PLAN.md §3, "private asset
 * serving").
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
 *   - the asset is audio of the type a segment accepts, so an asset of any
 *     other type is refused even if something recorded it;
 *   - the asset is the ONE recorded against this exact segment of this exact
 *     Recitation — a clean file of another segment, a replaced file, or an
 *     orphaned upload is refused, so no identifier can be guessed into being
 *     served;
 *   - for PUBLIC serving, the corpus is active and the Recitation publicly
 *     visible NOW, by Quran's own public reader — a draft or archived
 *     Recitation's audio is refused to everyone the moment it is withdrawn;
 *   - for an administrator's PREVIEW, the caller holds `quran.read` right now,
 *     read live — never a role name, a profile, or what the session was issued
 *     with.
 *
 * ANYTHING ELSE IS A DENIAL, and Storage additionally treats a throw or a
 * malformed answer as one. There is no download purpose: hearing a recitation
 * does not imply a right to keep a copy, and no approved download contract
 * exists.
 */

/** The three identifiers a recitation byte route is addressed by. */
export interface RecitationAssetRequest {
  readonly recitationId: string;
  readonly segmentId: string;
  readonly assetId: string;
}

const AUDIO: readonly string[] = RECITATION_AUDIO_MEDIA_TYPES;

/** The checks both policies make before either asks its owner anything. */
function addressed(
  request: RecitationAssetRequest,
  asset: { readonly assetId: string; readonly mediaType: string },
): boolean {
  return (
    quranIdSchema.safeParse(request.recitationId).success &&
    quranIdSchema.safeParse(request.segmentId).success &&
    quranIdSchema.safeParse(request.assetId).success &&
    asset.assetId === request.assetId &&
    AUDIO.includes(asset.mediaType)
  );
}

/** The PUBLIC decision: the recorded asset of a segment that is public now. */
export function createRecitationAssetPolicy(deps: {
  readonly reader: Pick<QuranPublicReaderPort, 'segmentAsset'>;
  readonly request: RecitationAssetRequest;
}): AssetAuthorizationPort {
  const { request } = deps;
  return {
    async decide(asset) {
      if (!addressed(request, asset)) return 'deny';
      const relation = await deps.reader.segmentAsset(
        request.recitationId,
        request.segmentId,
      );
      return relation !== null &&
        relation.publiclyVisible === true &&
        relation.assetId === request.assetId
        ? 'allow'
        : 'deny';
    },
  };
}

/**
 * The PRIVILEGED decision: an administrator hearing a segment's audio before
 * the Recitation is public. It allows exactly the asset ALREADY RECORDED
 * against that exact segment, to a caller holding `quran.read` now.
 */
export function createRecitationPreviewPolicy(deps: {
  readonly persistence: Pick<QuranPersistencePort, 'segmentAssetForPreview'>;
  readonly authority: QuranAuthorityPort;
  readonly accountId: string;
  readonly request: RecitationAssetRequest;
}): AssetAuthorizationPort {
  const { request } = deps;
  return {
    async decide(asset) {
      if (!addressed(request, asset) || deps.accountId === '') return 'deny';
      const recorded = await deps.persistence.segmentAssetForPreview(
        request.recitationId,
        request.segmentId,
      );
      if (recorded !== request.assetId) return 'deny';
      return (await deps.authority.permits(deps.accountId, 'quran.read'))
        ? 'allow'
        : 'deny';
    },
  };
}
