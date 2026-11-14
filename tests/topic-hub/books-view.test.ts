import { describe, expect, it } from 'vitest';

import { TOPIC_WORKS_PAGE, topicWorksQuerySchema } from '@minhaj/contracts/library';

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
} from '../../apps/web/src/components/topic-hub/books-view.ts';
import { QURAN_BOOKS as QURAN } from '../../apps/web/src/components/quran/hubs.ts';
import { HADITH_BOOKS as HADITH } from '../../apps/web/src/components/hadith/hubs.ts';

/**
 * Quran Part 10 and Hadith Part 1 — a Books hub's address rules, with the
 * Quran passage parts (the Quran's scope) and without them (Hadith's): the view a URL names,
 * the address each control and link builds, and the query Library is asked.
 * Tolerant of anything a visitor or a crawler types; never widening.
 */

const PERSON = '5b0e1d2c-3f4a-4b5c-8d6e-7f8091a2b3c4';
const TOPIC = '0f1e2d3c-4b5a-4968-8776-655443322110';

describe('readBooksQuery', () => {
  it('reads the neutral view from an empty address', () => {
    expect(readBooksQuery(QURAN, {})).toEqual(DEFAULT_BOOKS_QUERY);
    expect(booksFiltered(readBooksQuery(QURAN, {}))).toBe(false);
  });

  it('reads every parameter it knows', () => {
    expect(
      readBooksQuery(QURAN, {
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
      readBooksQuery(QURAN, {
        shelf: 'drafts',
        surah: '115',
        language: '<script>',
        contributor: 'not-a-uuid',
        sort: 'random',
        page: '0',
      }),
    ).toEqual(DEFAULT_BOOKS_QUERY);
    expect(readBooksQuery(QURAN, { surah: '0' }).surah).toBeNull();
    expect(readBooksQuery(QURAN, { surah: '1.5' }).surah).toBeNull();
    expect(readBooksQuery(QURAN, { surah: '-2' }).surah).toBeNull();
    expect(readBooksQuery(QURAN, { surah: ['1', '2'] }).surah).toBeNull();
    expect(readBooksQuery(QURAN, { language: ['ur', 'en'] }).language).toBeNull();
    expect(readBooksQuery(QURAN, { language: 'x'.repeat(17) }).language).toBeNull();
    expect(readBooksQuery(QURAN, { page: String(BOOKS_MAX_PAGE + 1) }).page).toBe(1);
    expect(readBooksQuery(QURAN, { page: String(BOOKS_MAX_PAGE) }).page).toBe(
      BOOKS_MAX_PAGE,
    );
    expect(readBooksQuery(QURAN, { page: '1e3' }).page).toBe(1);
  });

  it('accepts a regional language code and folds a contributor identifier', () => {
    expect(readBooksQuery(QURAN, { language: 'ur-PK' }).language).toBe('ur-PK');
    expect(readBooksQuery(QURAN, { contributor: PERSON.toUpperCase() }).contributor).toBe(
      PERSON,
    );
  });

  it('lets the general shelf win over a Surah, which narrows only books that explain one', () => {
    const query = readBooksQuery(QURAN, { shelf: 'general', surah: '2' });
    expect(query.shelf).toBe('general');
    expect(query.surah).toBeNull();
    // What it reads is always a query Library's own schema accepts.
    expect(
      topicWorksQuerySchema.safeParse(booksReadQuery(QURAN, query, TOPIC, 'en')).success,
    ).toBe(true);
  });

  it('never reaches past Library’s own offset bound', () => {
    const query = readBooksQuery(QURAN, { page: String(BOOKS_MAX_PAGE) });
    expect(
      topicWorksQuerySchema.safeParse(booksReadQuery(QURAN, query, TOPIC, 'en')).success,
    ).toBe(true);
  });
});

describe('booksHref', () => {
  const view = readBooksQuery(QURAN, {
    shelf: 'explains',
    surah: '2',
    language: 'ur',
    contributor: PERSON,
    sort: 'newest',
    page: '4',
  });

  it('gives the unfiltered hub exactly one address, in every locale', () => {
    expect(booksHref(QURAN, 'en', DEFAULT_BOOKS_QUERY)).toBe('/quran/books');
    expect(booksHref(QURAN, 'ur', DEFAULT_BOOKS_QUERY)).toBe('/ur/quran/books');
    expect(booksHref(QURAN, 'ar', DEFAULT_BOOKS_QUERY)).toBe('/ar/quran/books');
  });

  it('writes every narrowing value in one fixed order, and the page last', () => {
    expect(booksHref(QURAN, 'en', view)).toBe(
      `/quran/books?shelf=explains&surah=2&language=ur&contributor=${PERSON}&sort=newest&page=4`,
    );
  });

  it('returns to the first page whenever anything but the page changes', () => {
    expect(booksHref(QURAN, 'en', view, { language: null })).toBe(
      `/quran/books?shelf=explains&surah=2&contributor=${PERSON}&sort=newest`,
    );
    expect(booksHref(QURAN, 'en', view, { page: 5 })).toContain('&page=5');
    expect(booksHref(QURAN, 'en', view, { page: 1 })).not.toContain('page=');
  });

  it('drops the Surah when the general shelf is chosen', () => {
    expect(booksHref(QURAN, 'en', view, { shelf: 'general' })).toBe(
      `/quran/books?shelf=general&language=ur&contributor=${PERSON}&sort=newest`,
    );
  });

  it('round-trips: the address it builds reads back as the same view', () => {
    const href = booksHref(QURAN, 'en', view);
    const params = Object.fromEntries(new URL(href, 'https://x.invalid').searchParams);
    expect(readBooksQuery(QURAN, params)).toEqual(view);
  });
});

describe('booksCanonicalRedirect', () => {
  it('leaves a canonical address, and the bare hub, alone', () => {
    expect(booksCanonicalRedirect(QURAN, 'en', {})).toBeNull();
    expect(
      booksCanonicalRedirect(QURAN, 'ur', { shelf: 'explains', surah: '18', page: '2' }),
    ).toBeNull();
    // A parameter the hub does not read is not its business.
    expect(booksCanonicalRedirect(QURAN, 'en', { utm_source: 'x' })).toBeNull();
  });

  it('sends what a filter form submits — every control, empty ones included — to one address', () => {
    expect(
      booksCanonicalRedirect(QURAN, 'en', {
        surah: '',
        language: '',
        contributor: PERSON,
        sort: 'title',
      }),
    ).toBe(`/quran/books?contributor=${PERSON}`);
    expect(
      booksCanonicalRedirect(QURAN, 'ar', {
        shelf: 'explains',
        surah: '1',
        sort: 'title',
      }),
    ).toBe('/ar/quran/books?shelf=explains&surah=1');
  });

  it('sends another order, a malformed or repeated value, and a contradiction to the parsed view', () => {
    expect(
      booksCanonicalRedirect(QURAN, 'en', { sort: 'newest', shelf: 'general' }),
    ).toBe('/quran/books?shelf=general&sort=newest');
    expect(booksCanonicalRedirect(QURAN, 'en', { surah: '999', page: '-1' })).toBe(
      '/quran/books',
    );
    expect(booksCanonicalRedirect(QURAN, 'en', { language: ['ur', 'en'] })).toBe(
      '/quran/books',
    );
    expect(booksCanonicalRedirect(QURAN, 'en', { shelf: 'general', surah: '3' })).toBe(
      '/quran/books?shelf=general',
    );
    expect(booksCanonicalRedirect(QURAN, 'en', { page: '1' })).toBe('/quran/books');
    // Built from the parsed view, never from the typed text.
    expect(
      booksCanonicalRedirect(QURAN, 'en', { language: 'https://evil.example/' }),
    ).toBe('/quran/books');
  });

  it('never redirects an address it built itself', () => {
    const view = readBooksQuery(QURAN, {
      shelf: 'explains',
      surah: '2',
      language: 'ur-PK',
      contributor: PERSON,
      sort: 'quran',
      page: '7',
    });
    const href = booksHref(QURAN, 'en', view);
    const params = Object.fromEntries(new URL(href, 'https://x.invalid').searchParams);
    expect(booksCanonicalRedirect(QURAN, 'en', params)).toBeNull();
  });
});

describe('booksReadQuery and paging', () => {
  it('asks Library for one page by offset, with the Topic and the reader’s title locale', () => {
    expect(
      booksReadQuery(QURAN, readBooksQuery(QURAN, { page: '3' }), TOPIC, 'ur'),
    ).toEqual({
      topic: TOPIC,
      quranPassages: true,
      shelf: 'all',
      surah: null,
      language: null,
      contributor: null,
      sort: 'title',
      titleLocale: 'ur',
      offset: 2 * TOPIC_WORKS_PAGE,
      limit: TOPIC_WORKS_PAGE,
    });
    expect(booksReadQuery(QURAN, DEFAULT_BOOKS_QUERY, null, 'en').topic).toBeNull();
  });

  it('counts pages and states the range a page shows', () => {
    expect(booksPageCount(0)).toBe(1);
    expect(booksPageCount(TOPIC_WORKS_PAGE)).toBe(1);
    expect(booksPageCount(TOPIC_WORKS_PAGE + 1)).toBe(2);
    expect(booksRange(1, 0)).toBeNull();
    expect(booksRange(1, 5)).toEqual({ from: 1, to: 5 });
    expect(booksRange(2, 3)).toEqual({
      from: TOPIC_WORKS_PAGE + 1,
      to: TOPIC_WORKS_PAGE + 3,
    });
  });
});

describe('a Books hub without the Quran passage parts (Hadith)', () => {
  it('reads no shelf, no Surah and no Quran order — they are not its parts', () => {
    expect(
      readBooksQuery(HADITH, { shelf: 'explains', surah: '18', sort: 'quran' }),
    ).toEqual(DEFAULT_BOOKS_QUERY);
    expect(
      readBooksQuery(HADITH, {
        language: 'ar',
        contributor: PERSON,
        sort: 'newest',
        page: '2',
      }),
    ).toEqual({
      ...DEFAULT_BOOKS_QUERY,
      language: 'ar',
      contributor: PERSON,
      sort: 'newest',
      page: 2,
    });
  });

  it('gives the hub one address in every locale, and never writes a passage part', () => {
    expect(booksHref(HADITH, 'en', DEFAULT_BOOKS_QUERY)).toBe('/hadith/books');
    expect(booksHref(HADITH, 'ur', DEFAULT_BOOKS_QUERY)).toBe('/ur/hadith/books');
    expect(booksHref(HADITH, 'ar', DEFAULT_BOOKS_QUERY)).toBe('/ar/hadith/books');
    expect(
      booksHref(HADITH, 'en', DEFAULT_BOOKS_QUERY, {
        shelf: 'explains',
        surah: 2,
        sort: 'quran',
      }),
    ).toBe('/hadith/books');
    expect(
      booksHref(HADITH, 'en', DEFAULT_BOOKS_QUERY, {
        language: 'ur',
        contributor: PERSON,
      }),
    ).toBe(`/hadith/books?language=ur&contributor=${PERSON}`);
  });

  it('redirects a passage part, another order or a form submission to one address', () => {
    expect(booksCanonicalRedirect(HADITH, 'en', {})).toBeNull();
    expect(
      booksCanonicalRedirect(HADITH, 'ur', { language: 'ur', page: '2' }),
    ).toBeNull();
    expect(booksCanonicalRedirect(HADITH, 'en', { shelf: 'explains' })).toBe(
      '/hadith/books',
    );
    expect(booksCanonicalRedirect(HADITH, 'en', { surah: '2', sort: 'quran' })).toBe(
      '/hadith/books',
    );
    expect(
      booksCanonicalRedirect(HADITH, 'ar', {
        sort: 'newest',
        language: 'ur',
        contributor: '',
      }),
    ).toBe('/ar/hadith/books?language=ur&sort=newest');
  });

  it('asks Library for the Topic alone — and always a query its schema accepts', () => {
    const read = booksReadQuery(
      HADITH,
      readBooksQuery(HADITH, { shelf: 'general', surah: '3', sort: 'quran', page: '2' }),
      TOPIC,
      'ar',
    );
    expect(read).toEqual({
      topic: TOPIC,
      quranPassages: false,
      shelf: 'all',
      surah: null,
      language: null,
      contributor: null,
      sort: 'title',
      titleLocale: 'ar',
      offset: TOPIC_WORKS_PAGE,
      limit: TOPIC_WORKS_PAGE,
    });
    expect(topicWorksQuerySchema.safeParse(read).success).toBe(true);
  });
});
