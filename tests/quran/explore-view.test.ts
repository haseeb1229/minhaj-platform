import { describe, expect, it } from 'vitest';

import {
  passageStart,
  surahChips,
} from '../../apps/web/src/components/quran/explore-view.ts';

/**
 * Quran Parts 10 and 11 — the Quran passage parts of the Books and Videos
 * hubs (separated from the shared hubs in Hadith Part 1): the Surah chips a
 * card shows and the place a lecture opens at.
 */

describe('surahChips', () => {
  it('names each Surah once, in Quran order, with every citation in it', () => {
    expect(
      surahChips([
        { surah: 18, ayahFrom: 60, ayahTo: 82 },
        { surah: 2, ayahFrom: 255, ayahTo: 255 },
        { surah: 18, ayahFrom: 1, ayahTo: 10 },
      ]),
    ).toEqual({
      chips: [
        { surah: 2, citations: ['2:255'] },
        { surah: 18, citations: ['18:1–10', '18:60–82'] },
      ],
      more: 0,
    });
  });

  it('shows at most three and counts the rest', () => {
    const passages = [1, 2, 3, 36, 67].map((surah) => ({
      surah,
      ayahFrom: 1,
      ayahTo: 1,
    }));
    const { chips, more } = surahChips(passages);
    expect(chips.map((chip) => chip.surah)).toEqual([1, 2, 3]);
    expect(more).toBe(2);
    expect(surahChips([])).toEqual({ chips: [], more: 0 });
  });
});

describe('passageStart', () => {
  const kahf = { surah: 18, ayahFrom: 1, ayahTo: 10, startSeconds: 754 };
  const kursi = { surah: 2, ayahFrom: 255, ayahTo: 255, startSeconds: null };
  const fatiha = { surah: 1, ayahFrom: 1, ayahTo: 7, startSeconds: 0 };
  const cave = { surah: 18, ayahFrom: 60, ayahTo: 82, startSeconds: 2_400 };

  it('opens at the first passage, in Quran order, whose start was recorded', () => {
    // 1:1–7 starts at the opening second and 2:255 has none: 18:1–10 it is.
    expect(passageStart([cave, kursi, kahf, fatiha], null)).toEqual(kahf);
  });

  it('opens within the Surah the visitor chose', () => {
    expect(passageStart([kahf, cave], 18)).toEqual(kahf);
    expect(passageStart([cave, kursi], 18)).toEqual(cave);
    expect(passageStart([kahf, kursi], 2)).toBeNull();
  });

  it('offers nothing when no start is recorded', () => {
    expect(passageStart([], null)).toBeNull();
    expect(passageStart([kursi, fatiha], null)).toBeNull();
  });
});
