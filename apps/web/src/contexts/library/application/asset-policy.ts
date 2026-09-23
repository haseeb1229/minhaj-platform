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
