import 'server-only';

import { FATWA_SEARCH_RECORDS_MAX } from '@minhaj/contracts/fatwa';
import type { SearchHit } from '@minhaj/contracts/search';

import { fatwaReadRuntime } from '@/composition/fatwa-read';
import { fatwaHitDisplays, fatwaHitIds, type FatwaHitDisplay } from './fatwa-hit';

/**
 * The CURRENT text of a results page's `fatwa` hits — ONE read of Fatwa's
 * public reader for the whole page, never one per hit, and none at all when the
 * page holds no Fatwa result.
 *
 * A results page renders what this returns and never a `fatwa` hit's indexed
 * title or summary, which can lag a correction or a withdrawal until the
 * indexer re-projects (`fatwaHitDisplays`). A hit missing from the map is not
 * public now and is not rendered.
 */
export async function currentFatwaHitText(
  hits: readonly SearchHit[],
): Promise<ReadonlyMap<string, FatwaHitDisplay>> {
  const ids = fatwaHitIds(hits).slice(0, FATWA_SEARCH_RECORDS_MAX);
  if (ids.length === 0) return new Map();
  const records = await fatwaReadRuntime().reader.searchRecords(ids);
  return fatwaHitDisplays(hits, records);
}
