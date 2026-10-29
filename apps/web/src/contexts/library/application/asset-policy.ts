import {
  libraryIdSchema,
  type LibraryAssetRequest,
  type LibraryPublicReaderPort,
  type LibraryAuthorityPort,
} from '@minhaj/contracts/library';
import type { AssetAuthorizationPort } from '@minhaj/contracts/platform';

/** Purpose is a requested operation, never authority. Both owners must independently allow. */
export function createLibraryAssetPolicy(deps: {
  reader: Pick<LibraryPublicReaderPort, 'assetRelation'>;
  request: LibraryAssetRequest;
  previewAuthority?: { accountId: string; authority: LibraryAuthorityPort };
}): AssetAuthorizationPort {
  return {
    async decide(asset) {
      const { editionId, assetId, purpose } = deps.request;
      if (
        !libraryIdSchema.safeParse(editionId).success ||
        !libraryIdSchema.safeParse(assetId).success ||
        asset.assetId !== assetId
      )
        return 'deny';
      const relation = await deps.reader.assetRelation(editionId);
      if (!relation) return 'deny';
      if (purpose === 'preview') {
        const auth = deps.previewAuthority;
        return auth &&
          [relation.readableAssetId, relation.downloadAssetId].includes(assetId) &&
          (await auth.authority.permits(auth.accountId, 'library.administer'))
          ? 'allow'
          : 'deny';
      }
      if (relation.workState !== 'published' || relation.editionState !== 'published')
        return 'deny';
      if (purpose === 'read')
        return relation.reading === 'allowed' && relation.readableAssetId === assetId
          ? 'allow'
          : 'deny';
      if (purpose === 'download')
        return relation.download === 'allowed' && relation.downloadAssetId === assetId
          ? 'allow'
          : 'deny';
      return 'deny';
    },
  };
}

/** The two raster types Storage's image pipeline admits. */
const COVER_MEDIA_TYPES: readonly string[] = Object.freeze(['image/jpeg', 'image/png']);

/**
 * Phase 30-R — the policy for a COVER's bytes: an Edition's or a
 * MagazineIssue's. The business half of the two independent allows; Storage's
 * custody decision is made first and separately.
 *
 * Allowed only when both identifiers are well-formed, the asset Storage
 * resolved is the one the URL named and a still image, and it IS the cover
 * recorded on that record while the record is public — an Edition published
 * within a published Work, an issue published within a published Magazine.
 * A withdrawn record's cover is refused at once; anything else is a denial.
 */
export function createLibraryCoverPolicy(deps: {
  reader: Pick<LibraryPublicReaderPort, 'assetRelation' | 'issueCoverRelation'>;
  request: {
    readonly owner: 'edition' | 'issue';
    readonly ownerId: string;
    readonly assetId: string;
  };
}): AssetAuthorizationPort {
  return {
    async decide(asset) {
      const { owner, ownerId, assetId } = deps.request;
      if (
        !libraryIdSchema.safeParse(ownerId).success ||
        !libraryIdSchema.safeParse(assetId).success ||
        asset.assetId !== assetId ||
        !COVER_MEDIA_TYPES.includes(asset.mediaType)
      )
        return 'deny';
      if (owner === 'edition') {
        const relation = await deps.reader.assetRelation(ownerId);
        return relation !== null &&
          relation.workState === 'published' &&
          relation.editionState === 'published' &&
          relation.coverAssetId === assetId
          ? 'allow'
          : 'deny';
      }
      const relation = await deps.reader.issueCoverRelation(ownerId);
      return relation !== null &&
        relation.issueState === 'published' &&
        relation.magazineState === 'published' &&
        relation.coverAssetId === assetId
        ? 'allow'
        : 'deny';
    },
  };
}
