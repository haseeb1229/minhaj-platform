import 'server-only';

import { cache } from 'react';

import type { QuranPassageWork } from '@minhaj/contracts/library';
import type { QuranPassageVideo } from '@minhaj/contracts/media';
import { PASSAGE_READ_MAX } from '@minhaj/contracts/passage';
import type { PublicLayerWork } from '@minhaj/contracts/quran';

import { libraryReadRuntime } from '@/composition/library-read';
import { mediaReadRuntime } from '@/composition/media-read';
import { quranReadRuntime } from '@/composition/quran-read';
import type { TafsirResources, TafsirTextEntry } from './tafsir-layout';

/**
 * THE TAFSIR HUB'S READS (Quran Part 8) — Layer-4 composition of three owners'
 * PUBLIC reads, never a context importing another (DOMAIN_MODEL.md §3.1, §8.8):
 *
 *   - Quran's public reader: the public Tafsir works and their entries;
 *   - Library's public read: the public Works whose passages overlap a range;
 *   - Media's public read: the published Videos whose passages overlap it.
 *
 * Library and Media answer by CITATION VALUE — a Surah number and an ayah
 * range — and know nothing of Quran; Quran knows nothing of either. Every read
 * is bounded and anonymous: no session, no identity, nothing personal.
 */

export type HubBook = QuranPassageWork;
export type HubLecture = QuranPassageVideo;
export type HubResources = TafsirResources<HubBook, HubLecture>;

/** The public Tafsir works, once per request. */
export const readTafsirWorks = cache(() => quranReadRuntime().reader.tafsirs());

/**
 * Everything that explains a range of one Surah — every public Tafsir's
 * entries overlapping it, and the books and lectures whose passages do. One
 * read per public Tafsir work (there are few) and one per owner.
 */
export const readTafsirResources = cache(
  async (surah: number, from: number, to: number): Promise<HubResources> => {
    const reader = quranReadRuntime().reader;
    const works = await readTafsirWorks();
    const [entries, books, lectures] = await Promise.all([
      Promise.all(works.map((work) => reader.tafsirEntries(work.id, surah, from, to))),
      libraryReadRuntime().quranPassageWorks({
        surah,
        ayahFrom: from,
        ayahTo: to,
        limit: PASSAGE_READ_MAX,
      }),
      mediaReadRuntime().quranPassageVideos({
        surah,
        ayahFrom: from,
        ayahTo: to,
        limit: PASSAGE_READ_MAX,
      }),
    ]);
    const texts: TafsirTextEntry[] = works.flatMap((work, index) =>
      (entries[index] ?? []).map((entry) => ({ workId: work.id, entry })),
    );
    return { texts, books, lectures };
  },
);

/** The hub's whole picture: works, their coverage, every book and lecture, counts. */
export const readTafsirHub = cache(async () => {
  const reader = quranReadRuntime().reader;
  const works = await readTafsirWorks();
  const [coverage, books, lectures, bookCounts, lectureCounts] = await Promise.all([
    reader.tafsirCoverage(works.map((work) => work.id)),
    libraryReadRuntime().quranPassageWorks({ surah: null, limit: PASSAGE_READ_MAX }),
    mediaReadRuntime().quranPassageVideos({ surah: null, limit: PASSAGE_READ_MAX }),
    libraryReadRuntime().quranPassageCounts(),
    mediaReadRuntime().quranPassageCounts(),
  ]);
  const texts = new Map<number, number>();
  for (const work of coverage)
    for (const row of work.surahs)
      texts.set(row.surah, (texts.get(row.surah) ?? 0) + row.entries);
  return { works, coverage, books, lectures, bookCounts, lectureCounts, texts };
});

/** The name, language and direction of each public Tafsir work by identifier. */
export function worksById(
  works: readonly PublicLayerWork[],
): ReadonlyMap<string, PublicLayerWork> {
  return new Map(works.map((work) => [work.id, work]));
}
