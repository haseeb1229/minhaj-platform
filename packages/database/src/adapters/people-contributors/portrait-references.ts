import 'server-only';

import type { PictureReference } from '@minhaj/contracts/platform';

import { getDatabaseClient } from '../../client.ts';

/**
 * Rebaseline R2. One page of the published People who have a portrait, by id
 * after `after` — what Storage's derivative backfill enumerates. It decides
 * nothing: each is put to People's own portrait policy before a pixel is read.
 */
export async function publishedPortraitReferences(
  after: string | null,
  limit: number,
): Promise<readonly PictureReference[]> {
  const rows = await getDatabaseClient().person.findMany({
    where: {
      status: 'published',
      portraitAssetId: { not: null },
      ...(after === null ? {} : { id: { gt: after } }),
    },
    select: { id: true, portraitAssetId: true },
    orderBy: { id: 'asc' },
    take: Math.min(Math.max(limit, 1), 200),
  });
  return rows.flatMap((row) =>
    row.portraitAssetId === null
      ? []
      : [{ recordId: row.id, assetId: row.portraitAssetId }],
  );
}
