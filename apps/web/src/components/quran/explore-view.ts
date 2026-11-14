import {
  canonicalPassageOrder,
  type QuranPassage,
  type TimedQuranPassage,
} from '@minhaj/contracts/passage';

import { passageCitation } from './tafsir-layout';

/**
 * THE QURAN PASSAGE PARTS OF THE QURAN BOOKS AND VIDEOS HUBS (Quran Parts 10
 * and 11; separated from the shared topic hubs in Hadith Part 1) — pure, so
 * the Surah chips a card shows and the place a lecture opens at are ONE
 * definition, proved by unit test. Only the Quran's hubs have them: no other
 * subject has a passage model, and none is invented.
 */

/** How many Surah chips a card shows before saying how many more. */
export const SURAH_CHIPS = 3;

export interface SurahChip {
  readonly surah: number;
  /** Every passage the owner carries in this Surah, as citations, in order. */
  readonly citations: readonly string[];
}

/**
 * The Surahs an owner explains, in Quran order, each once with its citations
 * — the chips a card links to each Surah's tafsir by. At most `max`; `more`
 * counts the Surahs left out.
 */
export function surahChips(
  passages: readonly QuranPassage[],
  max = SURAH_CHIPS,
): { readonly chips: readonly SurahChip[]; readonly more: number } {
  const bySurah = new Map<number, string[]>();
  for (const passage of canonicalPassageOrder(passages)) {
    const list = bySurah.get(passage.surah) ?? [];
    list.push(passageCitation(passage));
    bySurah.set(passage.surah, list);
  }
  const all = [...bySurah.entries()].map(([surah, citations]) => ({ surah, citations }));
  return { chips: all.slice(0, max), more: Math.max(0, all.length - max) };
}

/**
 * WHERE TO OPEN A LECTURE: the first passage — in Quran order, within the
 * Surah the visitor chose when one is chosen — whose start the editor
 * recorded (and is past the opening second); `null` when there is none, and
 * the card offers only the video itself.
 */
export function passageStart(
  passages: readonly TimedQuranPassage[],
  surah: number | null,
): TimedQuranPassage | null {
  return (
    canonicalPassageOrder(
      passages.filter((passage) => surah === null || passage.surah === surah),
    ).find((passage) => passage.startSeconds !== null && passage.startSeconds > 0) ?? null
  );
}
