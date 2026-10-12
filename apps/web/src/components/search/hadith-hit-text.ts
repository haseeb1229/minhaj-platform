import 'server-only';

import { HADITH_SEARCH_RECORDS_MAX } from '@minhaj/contracts/hadith';
import type { SearchHit } from '@minhaj/contracts/search';

import { hadithReadRuntime } from '@/composition/hadith-read';
import { hadithHitDisplays, hadithHitIds, type HadithHitDisplay } from './hadith-hit';

/**
 * The CURRENT text of a results page's `hadith` hits — ONE read of Hadith's
 * public reader for the whole page, never one per hit, and none at all when the
 * page holds no Hadith result.
 *
 * A results page renders what this returns and never a `hadith` hit's indexed
 * summary, which can lag a withdrawn translation or a corrected original until
 * the indexer re-projects (`hadithHitDisplays`). A hit missing from the map is
 * not public now and is not rendered.
 */
export async function currentHadithHitText(
  hits: readonly SearchHit[],
): Promise<ReadonlyMap<string, HadithHitDisplay>> {
  const ids = hadithHitIds(hits).slice(0, HADITH_SEARCH_RECORDS_MAX);
  if (ids.length === 0) return new Map();
  const records = await hadithReadRuntime().reader.searchCitationRecords(ids);
  return hadithHitDisplays(hits, records);
}
