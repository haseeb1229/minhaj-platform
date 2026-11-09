import { describe, expect, it } from 'vitest';

import type { PublicJuz } from '../../packages/contracts/src/quran/index.ts';
import {
  surahMeaning,
  surahName,
} from '../../apps/web/src/components/quran/presentation.ts';
import { parseQuickJump } from '../../apps/web/src/components/quran/quick-jump.ts';
import {
  SURAH_SORTS,
  arrangeSurahs,
  filterSurahs,
  foldRows,
  juzSpans,
  readSurahIndexQuery,
  surahIndexHref,
  type SurahIndexRow,
} from '../../apps/web/src/components/quran/surah-index.ts';

/**
 * Quran Part 2 — THE SURAH INDEX's own decisions: what a filter keeps, how an
 * order arranges the rows, which Juz each Surah spans, how the address is read
 * and written, and which display name and meaning each interface shows.
 *
 * NOTHING HERE IS THE QURAN. The rows are synthetic: made-up numbers, counts
 * and `NON_QURAN_FIXTURE` names; the transliterations only imitate the
 * spelling habits (a doubled vowel, an apostrophe) a filter has to meet.
 */

function row(
  number: number,
  ayahCount: number,
  revelation: SurahIndexRow['revelation'],
  terms: readonly string[],
): SurahIndexRow {
  return {
    number,
    href: `/quran/surah/${String(number)}`,
    name: null,
    meaning: null,
    nameArabic: null,
    ayahCount,
    revelation,
    facts: '',
    terms,
  };
}

const ROWS: readonly SurahIndexRow[] = [
  row(1, 7, 'meccan', ['NON_QURAN_FIXTURE Al-Faatixa', 'Fixture Opening', 'الفكسچر']),
  row(2, 286, 'medinan', ['NON_QURAN_FIXTURE Al-Baqfix', 'Fixture Heifer']),
  row(18, 110, 'meccan', ["NON_QURAN_FIXTURE Al-Ka'fix", 'Fixture Cave', 'الكهفكس']),
  row(19, 98, 'meccan', ['NON_QURAN_FIXTURE Maryfix']),
  row(110, 3, 'medinan', ['NON_QURAN_FIXTURE An-Nasfix']),
  row(111, 5, null, []),
  row(112, 4, 'meccan', ['NON_QURAN_FIXTURE Al-Ikhfix']),
];

const FOLDED = foldRows(ROWS);
const numbers = (rows: readonly SurahIndexRow[]) => rows.map((entry) => entry.number);
const filter = (q: string) => numbers(filterSurahs(FOLDED, q));

describe('the Surah index filter', () => {
  it('keeps everything for an empty filter, in the given order', () => {
    expect(filter('')).toEqual([1, 2, 18, 19, 110, 111, 112]);
    expect(filter('   ')).toEqual([1, 2, 18, 19, 110, 111, 112]);
  });

  it('narrows by number digit by digit, in any digits, with or without "Surah"', () => {
    expect(filter('1')).toEqual([1, 18, 19, 110, 111, 112]);
    expect(filter('11')).toEqual([110, 111, 112]);
    expect(filter('112')).toEqual([112]);
    expect(filter('١٨')).toEqual([18]);
    expect(filter('۱۹')).toEqual([19]);
    expect(filter('Surah 18')).toEqual([18]);
    expect(filter('سورة 2')).toEqual([2]);
    expect(filter('3')).toEqual([]);
  });

  it('finds a name in any script, a meaning, and a spelling that differs only in folding', () => {
    expect(filter('cave')).toEqual([18]);
    expect(filter('FIXTURE HEIFER')).toEqual([2]);
    // The doubled vowel and the apostrophe are not part of what is matched.
    expect(filter('fatixa')).toEqual([1]);
    expect(filter('al-faatixa')).toEqual([1]);
    expect(filter('kafix')).toEqual([18]);
    // A leading article is optional on either side.
    expect(filter('al kafix')).toEqual([18]);
    expect(filter('ikhfix')).toEqual([112]);
    // Arabic, with and without its article and marks.
    expect(filter('الكهفكس')).toEqual([18]);
    expect(filter('كهفكس')).toEqual([18]);
    expect(filter('الْكَهْفكس')).toEqual([18]);
  });

  it('matches nothing it would have to guess, and keeps nothing for noise', () => {
    expect(filter('nothing-recorded')).toEqual([]);
    expect(filter('---')).toEqual([]);
    expect(filter('<script>')).toEqual([]);
    // A Surah with no recorded name is reachable by its number alone.
    expect(filter('111')).toEqual([111]);
  });
});

describe('the Surah index order', () => {
  it('lists the four orders, number first', () => {
    expect(SURAH_SORTS).toEqual(['number', 'revelation', 'longest', 'shortest']);
  });

  it('orders by number, by length either way, ties by number', () => {
    const shuffled = [...ROWS].reverse();
    expect(arrangeSurahs(shuffled, 'number').map((g) => numbers(g.rows))).toEqual([
      [1, 2, 18, 19, 110, 111, 112],
    ]);
    expect(numbers(arrangeSurahs(shuffled, 'longest')[0]?.rows ?? [])).toEqual([
      2, 18, 19, 1, 111, 112, 110,
    ]);
    expect(numbers(arrangeSurahs(shuffled, 'shortest')[0]?.rows ?? [])).toEqual([
      110, 112, 111, 1, 19, 18, 2,
    ]);
    const tied = [row(5, 10, null, []), row(3, 10, null, [])];
    expect(numbers(arrangeSurahs(tied, 'longest')[0]?.rows ?? [])).toEqual([3, 5]);
  });

  it('groups by place of revelation — Meccan, Medinan, then unrecorded — each by number', () => {
    const groups = arrangeSurahs([...ROWS].reverse(), 'revelation');
    expect(groups.map((group) => [group.key, numbers(group.rows)])).toEqual([
      ['meccan', [1, 18, 19, 112]],
      ['medinan', [2, 110]],
      ['unrecorded', [111]],
    ]);
    // An empty group is omitted, and filtering composes with grouping.
    expect(
      arrangeSurahs(filterSurahs(FOLDED, 'cave'), 'revelation').map((g) => g.key),
    ).toEqual(['meccan']);
  });
});

describe('the Surah index address', () => {
  it('reads ?q and ?sort tolerantly', () => {
    expect(readSurahIndexQuery({})).toEqual({ q: '', sort: 'number' });
    expect(readSurahIndexQuery({ q: 'cave', sort: 'longest' })).toEqual({
      q: 'cave',
      sort: 'longest',
    });
    expect(readSurahIndexQuery({ q: ['a', 'b'], sort: 'nonsense' })).toEqual({
      q: 'a',
      sort: 'number',
    });
    expect(readSurahIndexQuery({ q: 'x'.repeat(500) }).q).toHaveLength(60);
  });

  it('writes the plain address for the default request', () => {
    expect(surahIndexHref('/quran/surah', { q: '', sort: 'number' })).toBe(
      '/quran/surah',
    );
    expect(surahIndexHref('/quran/surah', { q: '  ', sort: 'number' })).toBe(
      '/quran/surah',
    );
    expect(surahIndexHref('/ur/quran/surah', { q: 'al kahf', sort: 'revelation' })).toBe(
      '/ur/quran/surah?q=al+kahf&sort=revelation',
    );
  });
});

describe('the Juz each Surah spans', () => {
  const juz = (number: number, start: [number, number], end: [number, number]) =>
    ({
      number,
      start: { surah: start[0], ayah: start[1] },
      end: { surah: end[0], ayah: end[1] },
      ayahCount: 1,
      pages: null,
      hizbs: [],
      startText: '',
    }) satisfies PublicJuz;

  it('derives each span from the reader’s own Juz ranges', () => {
    const spans = juzSpans([
      juz(1, [1, 1], [2, 3]),
      juz(2, [2, 4], [2, 9]),
      juz(3, [2, 10], [4, 2]),
    ]);
    expect(spans.get(1)).toEqual({ first: 1, last: 1 });
    expect(spans.get(2)).toEqual({ first: 1, last: 3 });
    expect(spans.get(3)).toEqual({ first: 3, last: 3 });
    expect(spans.get(4)).toEqual({ first: 3, last: 3 });
    expect(spans.get(5)).toBeUndefined();
    expect(juzSpans([]).size).toBe(0);
  });
});

describe('the display name and its meaning', () => {
  const surah = {
    names: { en: 'NON_QURAN_FIXTURE Al-Faatixa' },
    meanings: { en: 'Fixture Opening' },
    nameArabic: 'الفكسچر',
  };

  it('shows English readers the recorded name and its meaning', () => {
    const name = surahName(surah, 'en');
    expect(name).toEqual({ text: 'NON_QURAN_FIXTURE Al-Faatixa', locale: 'en' });
    expect(surahMeaning(surah, name)).toEqual({ text: 'Fixture Opening', locale: 'en' });
  });

  it('shows Urdu and Arabic readers the source’s Arabic name, marked Arabic, with no English meaning', () => {
    for (const locale of ['ur', 'ar'] as const) {
      const name = surahName(surah, locale);
      expect(name, locale).toEqual({ text: 'الفكسچر', locale: 'ar' });
      expect(surahMeaning(surah, name), locale).toBeNull();
    }
  });

  it('prefers a name an operator recorded in the reader’s own language', () => {
    const named = { ...surah, names: { ...surah.names, ur: 'فکسچر نام' } };
    expect(surahName(named, 'ur')).toEqual({ text: 'فکسچر نام', locale: 'ur' });
  });

  it('omits a meaning that only repeats the name, and one never recorded', () => {
    const same = {
      names: { en: 'Fixture' },
      meanings: { en: 'Fixture' },
      nameArabic: null,
    };
    expect(surahMeaning(same, surahName(same, 'en'))).toBeNull();
    const bare = { names: { en: 'Fixture' }, meanings: {}, nameArabic: null };
    expect(surahMeaning(bare, surahName(bare, 'en'))).toBeNull();
    expect(surahMeaning(bare, null)).toBeNull();
  });
});

describe('the quick jump meets the recorded names', () => {
  const index = [
    {
      number: 18,
      ayahCount: 110,
      names: ["NON_QURAN_FIXTURE Al-Ka'fix", 'Fixture Cave', 'الكهفكس'],
    },
    { number: 1, ayahCount: 7, names: ['Al-Faatixa', 'Fixture Opening'] },
  ];

  it('opens a Surah by its transliteration in a simpler spelling, or by its meaning', () => {
    expect(parseQuickJump('fatixa', index)).toEqual({ kind: 'surah', surah: 1 });
    expect(parseQuickJump('Al-Faatixa', index)).toEqual({ kind: 'surah', surah: 1 });
    expect(parseQuickJump('fixture cave', index)).toEqual({ kind: 'surah', surah: 18 });
  });
});
