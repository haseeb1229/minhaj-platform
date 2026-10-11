import 'server-only';

import type { SearchHit } from '@minhaj/contracts/search';

import { quranReadRuntime } from '@/composition/quran-read';
import { quranHitDisplays, quranHitRefs, type QuranHitDisplay } from './quran-hit';

/**
 * The CURRENT text of a results page's `quran-ayah` hits — ONE read of Quran's
 * public reader for the whole page, never one per hit, and none at all when the
 * page holds no Quran result.
 *
 * A results page renders what this returns and never a `quran-ayah` hit's
 * indexed summary, which can lag a withdrawn translation or a corrected
 * canonical text until the indexer re-projects (`quranHitDisplays`). A hit
 * missing from the map is not public now and is not rendered.
 */
export async function currentQuranHitText(
  hits: readonly SearchHit[],
): Promise<ReadonlyMap<string, QuranHitDisplay>> {
  const refs = quranHitRefs(hits);
  if (refs.length === 0) return new Map();
  const records = await quranReadRuntime().reader.searchAyahRecords(refs);
  return quranHitDisplays(hits, records);
}
