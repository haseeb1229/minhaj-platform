import { describe, expect, it } from 'vitest';

import type { PublicAyahPlace } from '../../packages/contracts/src/quran/index.ts';
import {
  JUZ_OPENING_WORDS,
  filterJuz,
  hizbStarts,
  juzIndexHref,
  juzWindows,
  openingWords,
  readJuzIndexQuery,
  readJuzWindow,
  windowOf,
  withJuzWindow,
  type JuzIndexRow,
} from '../../apps/web/src/components/quran/juz-layout.ts';
import {
  hizbJuzOf,
  parseQuickJump,
  quickJumpPathOf,
  type JumpSurah,
} from '../../apps/web/src/components/quran/quick-jump.ts';

/**
 * Quran Part 3 — how a Juz is shown and read: the opening words it is known
 * by, the windows it is read in, the index's filter, and "hizb 30" in the
 * quick jump.
 *
 * NOTHING HERE IS THE QURAN. The "Arabic" is neutral test text ("a test
 * text", "an example") carrying the signs a careless cut would damage — the
 * rub' al-hizb mark ۞, a pause mark, combining vowels, a superscript alef, a
 * tatweel — and every citation, hizb and page is synthetic structure chosen
 * to exercise a boundary, not a fact of the Quran.
 */

describe('a Juz is shown by the opening words of its first Ayah, verbatim', () => {
  it('takes the first words exactly as stored — marks, tatweel and all', () => {
    const stored = 'نَصُّ ٱخْتِبَـٰرٍ غَيْرِ قُرْآنِيٍّ لِلْمِثَالِ';
    expect(JUZ_OPENING_WORDS).toBe(3);
    expect(openingWords(stored)).toEqual({
      text: 'نَصُّ ٱخْتِبَـٰرٍ غَيْرِ',
      more: true,
    });
    // A contiguous slice of the stored string: nothing respelled or rejoined.
    expect(stored.startsWith(openingWords(stored).text)).toBe(true);
  });

  it('never counts a sign as a word: a leading ۞ is not shown, a pause mark between words stays', () => {
    const marked = '۞ مِثَالٌ ۚ أَوَّلُ ثَانٍ ثَالِثٌ';
    const opening = openingWords(marked);
    expect(opening).toEqual({ text: 'مِثَالٌ ۚ أَوَّلُ ثَانٍ', more: true });
    expect(marked.includes(opening.text)).toBe(true);
  });

  it('keeps the stored spacing between the words it takes', () => {
    expect(openingWords('كَلِمَةٌ  ثَانِيَةٌ', 2).text).toBe('كَلِمَةٌ  ثَانِيَةٌ');
  });

  it('shows a short Ayah whole, and says it goes on only when it does', () => {
    expect(openingWords('مِثَالٌ')).toEqual({ text: 'مِثَالٌ', more: false });
    expect(openingWords('مِثَالٌ ثَانٍ ثَالِثٌ')).toEqual({
      text: 'مِثَالٌ ثَانٍ ثَالِثٌ',
      more: false,
    });
  });

  it('has nothing to show for a text without a word', () => {
    expect(openingWords('')).toEqual({ text: '', more: false });
    expect(openingWords('۞ ۚ')).toEqual({ text: '', more: false });
    expect(openingWords('مِثَالٌ', 0)).toEqual({ text: '', more: false });
  });
});

/** A synthetic outline: `[surah, ayah, hizb, page]` per Ayah. */
function outline(
  rows: readonly (readonly [number, number, number | null, number | null])[],
): PublicAyahPlace[] {
  return rows.map(([surah, ayah, hizb, page]) => ({ surah, ayah, hizb, page }));
}

/** `count` ayat of one Surah from `from`, in one hizb, `perPage` to a page from `page`. */
function run(
  surah: number,
  from: number,
  count: number,
  hizb: number | null,
  page: number | null,
  perPage: number,
): (readonly [number, number, number | null, number | null])[] {
  return Array.from({ length: count }, (_, index) => [
    surah,
    from + index,
    hizb,
    page === null ? null : page + Math.floor(index / perPage),
  ]);
}

describe('a Juz is read one window per hizb', () => {
  it('opens one window per recorded hizb, each with its range, offset and pages', () => {
    const windows = juzWindows(
      outline([
        ...run(2, 3, 2, 3, 3, 10),
        ...run(3, 1, 19, 3, 4, 10),
        ...run(3, 20, 26, 4, 6, 10),
      ]),
    );
    expect(windows).toEqual([
      {
        hizb: 3,
        part: 1,
        parts: 1,
        start: { surah: 2, ayah: 3 },
        end: { surah: 3, ayah: 19 },
        offset: 0,
        count: 21,
        pages: { start: 3, end: 5 },
      },
      {
        hizb: 4,
        part: 1,
        parts: 1,
        start: { surah: 3, ayah: 20 },
        end: { surah: 3, ayah: 45 },
        offset: 21,
        count: 26,
        pages: { start: 6, end: 8 },
      },
    ]);
  });

  it('reads a long hizb in parts that break only between pages, never above the bound, as even as the pages allow', () => {
    // 288 ayat at 24 to a page: twelve pages.
    const windows = juzWindows(outline(run(78, 1, 288, 60, 582, 24)), 100);
    expect(windows.map((window) => window.count)).toEqual([96, 96, 96]);
    expect(windows.map((window) => [window.part, window.parts])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(windows.map((window) => window.pages)).toEqual([
      { start: 582, end: 585 },
      { start: 586, end: 589 },
      { start: 590, end: 593 },
    ]);
    // No page is split between two windows.
    for (const [index, window] of windows.entries()) {
      const nextWindow = windows[index + 1];
      if (nextWindow !== undefined)
        expect(nextWindow.pages?.start).toBe((window.pages?.end ?? 0) + 1);
    }
  });

  it('balances a hizb just over the bound rather than leaving a scrap', () => {
    // 105 ayat, 7 to a page: fifteen pages.
    const counts = juzWindows(outline(run(4, 1, 105, 41, 100, 7)), 100).map(
      (window) => window.count,
    );
    expect(counts).toEqual([56, 49]);
  });

  it('cuts at the bound where the source recorded no pages, and keeps unrecorded hizb as one run', () => {
    const windows = juzWindows(outline(run(1, 1, 250, null, null, 1)), 100);
    expect(windows.map((window) => [window.hizb, window.part, window.parts])).toEqual([
      [null, 1, 3],
      [null, 2, 3],
      [null, 3, 3],
    ]);
    expect(windows.every((window) => window.count <= 100)).toBe(true);
    expect(windows.reduce((sum, window) => sum + window.count, 0)).toBe(250);
    expect(windows.every((window) => window.pages === null)).toBe(true);
  });

  it('cuts a single page longer than the bound (never in a real mushaf) at the bound', () => {
    const counts = juzWindows(outline(run(1, 1, 130, 1, 1, 200)), 100).map(
      (window) => window.count,
    );
    expect(counts).toEqual([100, 30]);
  });

  it('gives the same windows for the same outline, and none for an empty Juz', () => {
    const rows = outline([...run(2, 1, 150, 1, 1, 15), ...run(2, 151, 80, 2, 11, 15)]);
    expect(juzWindows(rows)).toEqual(juzWindows(rows));
    expect(juzWindows([])).toEqual([]);
  });
});

describe('a window has one address', () => {
  const windows = juzWindows(
    outline([...run(2, 1, 60, 3, 1, 10), ...run(2, 61, 150, 4, 7, 10)]),
    100,
  );

  it('is the bare address for the first window, and names hizb and part for the rest', () => {
    expect(windows.map((window) => [window.hizb, window.part])).toEqual([
      [3, 1],
      [4, 1],
      [4, 2],
    ]);
    expect(withJuzWindow('/quran/juz/2', windows, 0)).toBe('/quran/juz/2');
    expect(withJuzWindow('/quran/juz/2', windows, 1)).toBe('/quran/juz/2?hizb=4');
    expect(withJuzWindow('/quran/juz/2', windows, 2)).toBe('/quran/juz/2?hizb=4&part=2');
    expect(withJuzWindow('/quran/juz/2?size=large#ayah-2-70', windows, 1)).toBe(
      '/quran/juz/2?size=large&hizb=4#ayah-2-70',
    );
    expect(withJuzWindow('/quran/juz/2', windows, 9)).toBe('/quran/juz/2');
  });

  it('reads back to the same window, and anything unknown is the first', () => {
    expect(readJuzWindow({}, windows)).toBe(0);
    expect(readJuzWindow({ hizb: '4' }, windows)).toBe(1);
    expect(readJuzWindow({ hizb: '4', part: '2' }, windows)).toBe(2);
    expect(readJuzWindow({ hizb: '3' }, windows)).toBe(0);
    for (const query of [
      { hizb: '5' },
      { hizb: '4', part: '3' },
      { hizb: '04' },
      { hizb: '4.0' },
      { hizb: ['4', '3'] },
      { part: '2' },
      { offset: '100' },
      { hizb: '-1' },
    ])
      expect(readJuzWindow(query, windows), JSON.stringify(query)).toBe(0);
  });

  it('round-trips a window without a recorded hizb by its part', () => {
    const unrecorded = juzWindows(outline(run(1, 1, 150, null, null, 1)), 100);
    const href = withJuzWindow('/quran/juz/1', unrecorded, 1);
    expect(href).toBe('/quran/juz/1?part=2');
    expect(readJuzWindow({ part: '2' }, unrecorded)).toBe(1);
  });

  it('finds the window an Ayah is read in, and each hizb’s first window', () => {
    expect(windowOf(windows, { surah: 2, ayah: 1 })).toBe(0);
    expect(windowOf(windows, { surah: 2, ayah: 61 })).toBe(1);
    expect(windowOf(windows, { surah: 2, ayah: 210 })).toBe(2);
    expect(windowOf(windows, { surah: 9, ayah: 1 })).toBe(0);
    expect(hizbStarts(windows)).toEqual([0, 1]);
  });
});

describe('the Juz index filters by number', () => {
  const row = (number: number, hizbs: readonly number[]): JuzIndexRow => ({
    number,
    href: `/quran/juz/${String(number)}`,
    opening: { text: '', more: false },
    range: '',
    facts: '',
    surahs: [],
    surahCount: null,
    hizbs,
  });
  const rows = Array.from({ length: 30 }, (_, index) =>
    row(index + 1, [index * 2 + 1, index * 2 + 2]),
  );
  const numbers = (q: string) => filterJuz(rows, q).map((each) => each.number);

  it('keeps every Juz for an empty filter, and narrows digit by digit', () => {
    expect(numbers('')).toHaveLength(30);
    expect(numbers('  ')).toHaveLength(30);
    expect(numbers('1')).toEqual([1, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
    expect(numbers('15')).toEqual([15]);
    expect(numbers('۱۵')).toEqual([15]);
    expect(numbers('Juz 15')).toEqual([15]);
    expect(numbers('para 3')).toEqual([3, 30]);
    expect(numbers('پارہ 15')).toEqual([15]);
    expect(numbers('الجزء 2')).toEqual([2, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
  });

  it('finds the Juz that holds a hizb, and nothing for a hizb no Juz records', () => {
    expect(numbers('hizb 30')).toEqual([15]);
    expect(numbers('Hizb 1')).toEqual([1]);
    expect(numbers('حزب ۶۰')).toEqual([30]);
    expect(numbers('hizb 61')).toEqual([]);
  });

  it('keeps nothing for anything that is not a number', () => {
    expect(numbers('baqarah')).toEqual([]);
    expect(numbers('31')).toEqual([]);
    expect(numbers('123')).toEqual([]);
  });

  it('reads `?q=` tolerantly and writes the bare index for no filter', () => {
    expect(readJuzIndexQuery({})).toBe('');
    expect(readJuzIndexQuery({ q: ['15', '16'] })).toBe('15');
    expect(readJuzIndexQuery({ q: 'x'.repeat(200) })).toHaveLength(60);
    expect(juzIndexHref('/quran/juz', '')).toBe('/quran/juz');
    expect(juzIndexHref('/ur/quran/juz', 'hizb 30')).toBe('/ur/quran/juz?q=hizb+30');
  });
});

describe('the quick jump opens a hizb in its Juz', () => {
  const INDEX: readonly JumpSurah[] = [
    { number: 1, ayahCount: 7, names: ['Al-Fixture'] },
  ];
  const hizbs = hizbJuzOf([
    { number: 2, hizbs: [3, 4] },
    { number: 1, hizbs: [1, 2] },
    // A hizb recorded across two Juz opens where it starts.
    { number: 3, hizbs: [4, 5] },
  ]);

  it('maps each recorded hizb to the Juz it begins in', () => {
    expect([...hizbs].sort((a, b) => a[0] - b[0])).toEqual([
      [1, 1],
      [2, 1],
      [3, 2],
      [4, 2],
      [5, 3],
    ]);
  });

  it('accepts "hizb 3" in the three interface languages, only for a recorded hizb', () => {
    expect(parseQuickJump('hizb 3', INDEX, 0, hizbs)).toEqual({
      kind: 'hizb',
      hizb: 3,
      juz: 2,
    });
    expect(parseQuickJump('Hizb5', INDEX, 0, hizbs)).toEqual({
      kind: 'hizb',
      hizb: 5,
      juz: 3,
    });
    expect(parseQuickJump('حزب ۴', INDEX, 0, hizbs)).toMatchObject({ hizb: 4, juz: 2 });
    expect(parseQuickJump('الحزب 1', INDEX, 0, hizbs)).toMatchObject({ hizb: 1, juz: 1 });
    expect(parseQuickJump('hizb 6', INDEX, 0, hizbs)).toEqual({ kind: 'unknown' });
    // A corpus that records no hizb opens none.
    expect(parseQuickJump('hizb 3', INDEX)).toEqual({ kind: 'unknown' });
  });

  it('opens the hizb’s window of its Juz, built from the confirmed numbers', () => {
    expect(quickJumpPathOf({ kind: 'hizb', hizb: 3, juz: 2 })).toBe(
      '/quran/juz/2?hizb=3',
    );
  });
});
