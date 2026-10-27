import { describe, expect, it } from 'vitest';

import {
  asciiDigits,
  checkSegment,
  pageNumbersOf,
  sliceExcluding,
  writtenDateOf,
} from '../../../../scripts/migration/adapters/markup-support.ts';

/** The shared legacy-markup readers (`markup-support.ts`), on their own. */

describe('written dates', () => {
  it('reads the forms these sites print, deterministically', () => {
    expect(writtenDateOf('2026-09-20')).toBe('2026-09-20');
    expect(writtenDateOf('23 October 2026')).toBe('2026-10-23');
    expect(writtenDateOf('October 23, 2026')).toBe('2026-10-23');
    expect(writtenDateOf('Sept 3, 2019')).toBe('2019-09-03');
    expect(writtenDateOf('  04   march  2026 ')).toBe('2026-03-04');
    expect(writtenDateOf('31 دسمبر 2026ء')).toBe('2026-12-31');
    expect(writtenDateOf('۲۴ اکتوبر ۲۰۲۶ء')).toBe('2026-10-24');
    expect(writtenDateOf('25 يناير 2026ء')).toBe('2026-01-25');
    // Arabic kaf in an Urdu month name folds for lookup only.
    expect(writtenDateOf('24 اكتوبر 2026')).toBe('2026-10-24');
  });

  it('never guesses', () => {
    for (const text of [
      undefined,
      '',
      'October 2026',
      '2026-09',
      '31 February 2026',
      '29 February 2025',
      '23 Octember 2026',
      '23/10/2026',
      'Febuary - March 2012',
      '--',
    ])
      expect(writtenDateOf(text)).toBeNull();
    expect(writtenDateOf('29 February 2024')).toBe('2024-02-29');
  });
});

describe('text', () => {
  it('reads Arabic-Indic and Urdu digits as numbers', () => {
    expect(asciiDigits('٠١٢٣٤٥٦٧٨٩ ۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789 0123456789');
  });

  it('accepts a single path segment only', () => {
    expect(checkSegment('listing', 'News-Events')).toBe('News-Events');
    for (const value of ['', '-a', 'a-', 'a/b', 'a.b', '..', 'a b', 'x'.repeat(81)])
      expect(() => checkSegment('listing', value)).toThrow(/listing/);
  });
});

describe('exact slicing', () => {
  it('keeps every source character outside the cuts, overlapping cuts merged', () => {
    const html = '0123456789';
    expect(sliceExcluding(html, { start: 1, end: 9 }, [])).toBe('12345678');
    expect(
      sliceExcluding(html, { start: 1, end: 9 }, [
        { start: 6, end: 8 },
        { start: 2, end: 4 },
        { start: 3, end: 5 },
        { start: 0, end: 2 },
        { start: 8, end: 12 },
      ]),
    ).toBe('5');
  });
});

describe('pagination', () => {
  it('reads page numbers of the listing only', () => {
    const base = new URL('https://www.minhaj.org/');
    expect(
      pageNumbersOf(
        [
          '/english/News-Events/',
          '/english/News-Events/page/2/',
          '/english/News-Events/page/3',
          '#',
          '/english/Articles/page/9/',
          'https://minhaj.net/english/News-Events/page/7/',
          '/english/News-Events/page/x/',
        ],
        'https://www.minhaj.org/english/News-Events/',
        base,
        '/english/News-Events/',
      ),
    ).toEqual([1, 2, 3]);
  });
});
