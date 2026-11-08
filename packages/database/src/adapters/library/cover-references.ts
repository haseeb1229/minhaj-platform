import 'server-only';

import type { PictureReference } from '@minhaj/contracts/platform';

import { getDatabaseClient } from '../../client.ts';

/**
 * Rebaseline R2. One page of the published Editions, or magazine issues, that
 * name a cover, by id after `after` — what Storage's derivative backfill
 * enumerates. It decides nothing: each is put to Library's own cover policy
 * (which also requires the Work, or the Magazine, to be published) before a
 * pixel is read.
 */
export async function publishedCoverReferences(
  owner: 'edition' | 'issue',
  after: string | null,
  limit: number,
): Promise<readonly PictureReference[]> {
  const database = getDatabaseClient();
  const where = {
    state: 'published',
    coverAssetId: { not: null },
    ...(after === null ? {} : { id: { gt: after } }),
  };
  const page = {
    select: { id: true, coverAssetId: true },
    orderBy: { id: 'asc' as const },
    take: Math.min(Math.max(limit, 1), 200),
  };
  const rows =
    owner === 'edition'
      ? await database.edition.findMany({ where, ...page })
      : await database.magazineIssue.findMany({ where, ...page });
  return rows.flatMap((row) =>
    row.coverAssetId === null ? [] : [{ recordId: row.id, assetId: row.coverAssetId }],
  );
}
