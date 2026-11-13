import { describe, expect, it } from 'vitest';

import { QURAN_WORKS_PAGE, quranWorksQuerySchema } from '@minhaj/contracts/library';

import {
  BOOKS_MAX_PAGE,
  DEFAULT_BOOKS_QUERY,
  booksCanonicalRedirect,
  booksFiltered,
  booksHref,
  booksPageCount,
  booksRange,
  booksReadQuery,
  readBooksQuery,
  surahChips,
} from '../../apps/web/src/components/quran/books-view.ts';

/**
 * Quran Part 10 — the Quran Books hub's address rules: the view a URL names,
 * the address each control and link builds, and the query Library is asked.
 * Tolerant of anything a visitor or a crawler types; never widening.
 */

const PERSON = '5b0e1d2c-3f4a-4b5c-8d6e-7f8091a2b3c4';
const TOPIC = '0f1e2d3c-4b5a-4968-8776-655443322110';

describe('readBooksQuery', () => {
  it('reads the neutral view from an empty address', () => {
    expect(readBooksQuery({})).toEqual(DEFAULT_BOOKS_QUERY);
    expect(booksFiltered(readBooksQuery({}))).toBe(false);
  });

  it('reads every parameter it knows', () => {
    expect(
      readBooksQuery({
        shelf: 'explains',
        surah: '18',
        language: 'ur',
        contributor: PERSON,
        sort: 'quran',
        page: '3',
      }),
    ).toEqual({
      shelf: 'explains',
      surah: 18,
      language: 'ur',
      contributor: PERSON,
      sort: 'quran',
      page: 3,
    });
  });

  it('drops what is malformed, out of range or repeated, rather than failing', () => {
    expect(
      readBooksQuery({
        shelf: 'drafts',
        surah: '115',
        language: '<script>',
        contributor: 'not-a-uuid',
        sort: 'random',
        page: '0',
      }),
    ).toEqual(DEFAULT_BOOKS_QUERY);
    expect(readBooksQuery({ surah: '0' }).surah).toBeNull();
    expect(readBooksQuery({ surah: '1.5' }).surah).toBeNull();
    expect(readBooksQuery({ surah: '-2' }).surah).toBeNull();
    expect(readBooksQuery({ surah: ['1', '2'] }).surah).toBeNull();
    expect(readBooksQuery({ language: ['ur', 'en'] }).language).toBeNull();
    expect(readBooksQuery({ language: 'x'.repeat(17) }).language).toBeNull();
    expect(readBooksQuery({ page: String(BOOKS_MAX_PAGE + 1) }).page).toBe(1);
    expect(readBooksQuery({ page: String(BOOKS_MAX_PAGE) }).page).toBe(BOOKS_MAX_PAGE);
    expect(readBooksQuery({ page: '1e3' }).page).toBe(1);
  });

  it('accepts a regional language code and folds a contributor identifier', () => {
    expect(readBooksQuery({ language: 'ur-PK' }).language).toBe('ur-PK');
    expect(readBooksQuery({ contributor: PERSON.toUpperCase() }).contributor).toBe(
      PERSON,
    );
  });

  it('lets the general shelf win over a Surah, which narrows only books that explain one', () => {
    const query = readBooksQuery({ shelf: 'general', surah: '2' });
    expect(query.shelf).toBe('general');
    expect(query.surah).toBeNull();
    // What it reads is always a query Library's own schema accepts.
    expect(
      quranWorksQuerySchema.safeParse(booksReadQuery(query, TOPIC, 'en')).success,
    ).toBe(true);
  });

  it('never reaches past Library’s own offset bound', () => {
    const query = readBooksQuery({ page: String(BOOKS_MAX_PAGE) });
    expect(
      quranWorksQuerySchema.safeParse(booksReadQuery(query, TOPIC, 'en')).success,
    ).toBe(true);
  });
});

describe('booksHref', () => {
  const view = readBooksQuery({
    shelf: 'explains',
    surah: '2',
    language: 'ur',
    contributor: PERSON,
    sort: 'newest',
    page: '4',
  });

  it('gives the unfiltered hub exactly one address, in every locale', () => {
    expect(booksHref('en', DEFAULT_BOOKS_QUERY)).toBe('/quran/books');
    expect(booksHref('ur', DEFAULT_BOOKS_QUERY)).toBe('/ur/quran/books');
    expect(booksHref('ar', DEFAULT_BOOKS_QUERY)).toBe('/ar/quran/books');
  });

  it('writes every narrowing value in one fixed order, and the page last', () => {
    expect(booksHref('en', view)).toBe(
      `/quran/books?shelf=explains&surah=2&language=ur&contributor=${PERSON}&sort=newest&page=4`,
    );
  });

  it('returns to the first page whenever anything but the page changes', () => {
    expect(booksHref('en', view, { language: null })).toBe(
      `/quran/books?shelf=explains&surah=2&contributor=${PERSON}&sort=newest`,
    );
    expect(booksHref('en', view, { page: 5 })).toContain('&page=5');
    expect(booksHref('en', view, { page: 1 })).not.toContain('page=');
  });

  it('drops the Surah when the general shelf is chosen', () => {
    expect(booksHref('en', view, { shelf: 'general' })).toBe(
      `/quran/books?shelf=general&language=ur&contributor=${PERSON}&sort=newest`,
    );
  });

  it('round-trips: the address it builds reads back as the same view', () => {
    const href = booksHref('en', view);
    const params = Object.fromEntries(new URL(href, 'https://x.invalid').searchParams);
    expect(readBooksQuery(params)).toEqual(view);
  });
});

describe('booksCanonicalRedirect', () => {
  it('leaves a canonical address, and the bare hub, alone', () => {
    expect(booksCanonicalRedirect('en', {})).toBeNull();
    expect(
      booksCanonicalRedirect('ur', { shelf: 'explains', surah: '18', page: '2' }),
    ).toBeNull();
    // A parameter the hub does not read is not its business.
    expect(booksCanonicalRedirect('en', { utm_source: 'x' })).toBeNull();
  });

  it('sends what a filter form submits — every control, empty ones included — to one address', () => {
    expect(
      booksCanonicalRedirect('en', {
        surah: '',
        language: '',
        contributor: PERSON,
        sort: 'title',
      }),
    ).toBe(`/quran/books?contributor=${PERSON}`);
    expect(
      booksCanonicalRedirect('ar', { shelf: 'explains', surah: '1', sort: 'title' }),
    ).toBe('/ar/quran/books?shelf=explains&surah=1');
  });

  it('sends another order, a malformed or repeated value, and a contradiction to the parsed view', () => {
    expect(booksCanonicalRedirect('en', { sort: 'newest', shelf: 'general' })).toBe(
      '/quran/books?shelf=general&sort=newest',
    );
    expect(booksCanonicalRedirect('en', { surah: '999', page: '-1' })).toBe(
      '/quran/books',
    );
    expect(booksCanonicalRedirect('en', { language: ['ur', 'en'] })).toBe('/quran/books');
    expect(booksCanonicalRedirect('en', { shelf: 'general', surah: '3' })).toBe(
      '/quran/books?shelf=general',
    );
    expect(booksCanonicalRedirect('en', { page: '1' })).toBe('/quran/books');
    // Built from the parsed view, never from the typed text.
    expect(booksCanonicalRedirect('en', { language: 'https://evil.example/' })).toBe(
      '/quran/books',
    );
  });

  it('never redirects an address it built itself', () => {
    const view = readBooksQuery({
      shelf: 'explains',
      surah: '2',
      language: 'ur-PK',
      contributor: PERSON,
      sort: 'quran',
      page: '7',
    });
    const href = booksHref('en', view);
    const params = Object.fromEntries(new URL(href, 'https://x.invalid').searchParams);
    expect(booksCanonicalRedirect('en', params)).toBeNull();
  });
});

describe('booksReadQuery and paging', () => {
  it('asks Library for one page by offset, with the Topic and the reader’s title locale', () => {
    expect(booksReadQuery(readBooksQuery({ page: '3' }), TOPIC, 'ur')).toEqual({
      topic: TOPIC,
      shelf: 'all',
      surah: null,
      language: null,
      contributor: null,
      sort: 'title',
      titleLocale: 'ur',
      offset: 2 * QURAN_WORKS_PAGE,
      limit: QURAN_WORKS_PAGE,
    });
    expect(booksReadQuery(DEFAULT_BOOKS_QUERY, null, 'en').topic).toBeNull();
  });

  it('counts pages and states the range a page shows', () => {
    expect(booksPageCount(0)).toBe(1);
    expect(booksPageCount(QURAN_WORKS_PAGE)).toBe(1);
    expect(booksPageCount(QURAN_WORKS_PAGE + 1)).toBe(2);
    expect(booksRange(1, 0)).toBeNull();
    expect(booksRange(1, 5)).toEqual({ from: 1, to: 5 });
    expect(booksRange(2, 3)).toEqual({
      from: QURAN_WORKS_PAGE + 1,
      to: QURAN_WORKS_PAGE + 3,
    });
  });
});

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
