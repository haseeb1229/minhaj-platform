import 'server-only';

import type { PictureReference } from '@minhaj/contracts/platform';

import { getDatabaseClient } from '../../client.ts';

/**
 * Rebaseline R2. One page of the published Photos that hold an image, or
 * Videos that name a first-party poster, by id after `after` — what Storage's
 * derivative backfill enumerates. It decides nothing: each is put to Media's
 * own photo or poster policy before a pixel is read.
 */
export async function publishedMediaPictureReferences(
  kind: 'photo' | 'poster',
  after: string | null,
  limit: number,
): Promise<readonly PictureReference[]> {
  const database = getDatabaseClient();
  const take = Math.min(Math.max(limit, 1), 200);
  const cursor = after === null ? {} : { id: { gt: after } };
  if (kind === 'photo') {
    const rows = await database.photo.findMany({
      where: { state: 'published', assetId: { not: null }, ...cursor },
      select: { id: true, assetId: true },
      orderBy: { id: 'asc' },
      take,
    });
    return rows.flatMap((row) =>
      row.assetId === null ? [] : [{ recordId: row.id, assetId: row.assetId }],
    );
  }
  const rows = await database.video.findMany({
    where: { state: 'published', posterAssetId: { not: null }, ...cursor },
    select: { id: true, posterAssetId: true },
    orderBy: { id: 'asc' },
    take,
  });
  return rows.flatMap((row) =>
    row.posterAssetId === null ? [] : [{ recordId: row.id, assetId: row.posterAssetId }],
  );
}
