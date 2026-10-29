import { describe, expect, it } from 'vitest';

import {
  asciiDigits,
  checkSegment,
  pageNumbersOf,
  sequenceDiscovery,
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

describe('several listings in turn (Phase 30-R)', () => {
  type Walk = Parameters<typeof sequenceDiscovery>[0][number];
  const fetcher = {
    fetcherKey: 'none',
    fetcherVersion: '1',
    fetch: async (): Promise<never> => {
      throw new Error('the walks are synthetic');
    },
  };
  const item = (key: string) => ({
    externalKey: key,
    originalUrl: key,
    legacyIdentifier: null,
  });
  /** A synthetic walk: two pages, cursor `2:1` between them. */
  const walk =
    (name: string): Walk =>
    async (cursor) => {
      if (cursor === null)
        return {
          kind: 'page',
          items: [item(`https://x.example/${name}/1`)],
          next: '2:1',
        };
      if (cursor === '2:1')
        return { kind: 'page', items: [item(`https://x.example/${name}/2`)], next: null };
      throw new Error('invalid discovery cursor');
    };

  it('walks each listing to its end, in order, under one composite cursor', async () => {
    const discover = sequenceDiscovery([walk('a'), walk('b')]);
    const cursors: (string | null)[] = [];
    let cursor: string | null = null;
    const keys: string[] = [];
    do {
      const page = await discover(cursor, fetcher);
      if (page.kind !== 'page') throw new Error('expected a page');
      keys.push(...page.items.map((entry) => entry.externalKey));
      cursor = page.next;
      cursors.push(cursor);
    } while (cursor !== null);
    expect(cursors).toEqual(['0~2:1', '1~', '1~2:1', null]);
    expect(keys).toEqual([
      'https://x.example/a/1',
      'https://x.example/a/2',
      'https://x.example/b/1',
      'https://x.example/b/2',
    ]);
  });

  it('resumes mid-listing exactly where a cursor says, and refuses one it never issued', async () => {
    const discover = sequenceDiscovery([walk('a'), walk('b')]);
    expect(await discover('1~2:1', fetcher)).toEqual({
      kind: 'page',
      items: [item('https://x.example/b/2')],
      next: null,
    });
    for (const bad of ['2~', '5', '~', 'x~1', '1000~'])
      await expect(discover(bad, fetcher)).rejects.toThrow('cursor');
    // The inner walk's own cursor is validated by the inner walk.
    await expect(discover('0~9:9', fetcher)).rejects.toThrow('cursor');
  });

  it('hands an outcome back as it is, and refuses no listing at all', async () => {
    const outcome = {
      kind: 'outcome' as const,
      outcome: {
        kind: 'failure' as const,
        classification: 'network' as const,
        requestedUrl: 'https://x.example/',
        detail: 'synthetic',
      },
    };
    const discover = sequenceDiscovery([async () => outcome]);
    expect(await discover(null, fetcher)).toBe(outcome);
    expect(() => sequenceDiscovery([])).toThrow();
  });
});
