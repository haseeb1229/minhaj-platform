import 'server-only';

import type { MediaAssetRelationPort, MediaState } from '@minhaj/contracts/media';

import { getDatabaseClient } from '../../client.ts';

/**
 * The serving policies' relation read — which asset a track or a Photo records,
 * and its lifecycle state, for ANY record, draft included.
 *
 * ITS OWN FACTORY, typed by its own narrow port, so no public page's module
 * graph holds a read that answers for drafts (`MediaAssetRelationPort`). Its
 * only consumers are the byte routes' policies, which check the state in the
 * same breath. Phase 11 gave it the audio question; Phase 12 adds the same
 * question for a Photo's image.
 */
export function createMediaAssetRelations(): MediaAssetRelationPort {
  const db = getDatabaseClient();
  return {
    async audioAsset(trackId) {
      const row = await db.audioTrack.findUnique({
        where: { id: trackId },
        select: { state: true, assetId: true },
      });
      return row === null
        ? null
        : { state: row.state as MediaState, assetId: row.assetId };
    },

    async photoAsset(photoId) {
      const row = await db.photo.findUnique({
        where: { id: photoId },
        select: { state: true, assetId: true },
      });
      return row === null
        ? null
        : { state: row.state as MediaState, assetId: row.assetId };
    },

    async videoPoster(videoId) {
      const row = await db.video.findUnique({
        where: { id: videoId },
        select: { state: true, posterAssetId: true },
      });
      return row === null
        ? null
        : { state: row.state as MediaState, assetId: row.posterAssetId };
    },
  };
}
