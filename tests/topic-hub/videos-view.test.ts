import { describe, expect, it } from 'vitest';

import { TOPIC_VIDEOS_PAGE, topicVideosQuerySchema } from '@minhaj/contracts/media';

import {
  DEFAULT_VIDEOS_QUERY,
  VIDEOS_MAX_PAGE,
  readVideosQuery,
  videosCanonicalRedirect,
  videosFiltered,
  videosHref,
  videosPageCount,
  videosRange,
  videosReadQuery,
  wholeHours,
} from '../../apps/web/src/components/topic-hub/videos-view.ts';
import { QURAN_VIDEOS as QURAN } from '../../apps/web/src/components/quran/hubs.ts';
import { HADITH_VIDEOS as HADITH } from '../../apps/web/src/components/hadith/hubs.ts';

/**
 * Quran Part 11 and Hadith Part 1 — a Videos hub's address rules, with the
 * Quran passage parts (the Quran's scope) and without them (Hadith's): the
 * view a URL names, the address each control and link builds, and the query
 * Media is asked. Tolerant of anything a visitor or a crawler types; never
 * widening.
 */

const PERSON = '5b0e1d2c-3f4a-4b5c-8d6e-7f8091a2b3c4';
const SERIES = '6c1f2e3d-4a5b-4c6d-9e7f-8091a2b3c4d5';
const TOPIC = '0f1e2d3c-4b5a-4968-8776-655443322110';

describe('readVideosQuery', () => {
  it('reads the neutral view from an empty address — newest first', () => {
    expect(readVideosQuery(QURAN, {})).toEqual(DEFAULT_VIDEOS_QUERY);
    expect(DEFAULT_VIDEOS_QUERY.sort).toBe('newest');
    expect(videosFiltered(readVideosQuery(QURAN, {}))).toBe(false);
  });

  it('reads every parameter it knows', () => {
    expect(
      readVideosQuery(QURAN, {
        shelf: 'explains',
        surah: '18',
        language: 'ur',
        speaker: PERSON,
        series: SERIES,
        length: 'long',
        sort: 'quran',
        page: '3',
      }),
    ).toEqual({
      shelf: 'explains',
      surah: 18,
      language: 'ur',
      speaker: PERSON,
      series: SERIES,
      length: 'long',
      sort: 'quran',
      page: 3,
    });
  });

  it('drops what is malformed, out of range or repeated, rather than failing', () => {
    expect(
      readVideosQuery(QURAN, {
        shelf: 'drafts',
        surah: '115',
        language: '<script>',
        speaker: 'not-a-uuid',
        series: "x' OR 1=1 --",
        length: 'endless',
        sort: 'popular',
        page: '0',
      }),
    ).toEqual(DEFAULT_VIDEOS_QUERY);
    expect(readVideosQuery(QURAN, { surah: '0' }).surah).toBeNull();
    expect(readVideosQuery(QURAN, { surah: '2.5' }).surah).toBeNull();
    expect(readVideosQuery(QURAN, { surah: ['1', '2'] }).surah).toBeNull();
    expect(readVideosQuery(QURAN, { length: ['short', 'long'] }).length).toBeNull();
    expect(readVideosQuery(QURAN, { speaker: [PERSON, PERSON] }).speaker).toBeNull();
    expect(readVideosQuery(QURAN, { language: 'x'.repeat(17) }).language).toBeNull();
    expect(readVideosQuery(QURAN, { page: String(VIDEOS_MAX_PAGE + 1) }).page).toBe(1);
    expect(readVideosQuery(QURAN, { page: String(VIDEOS_MAX_PAGE) }).page).toBe(
      VIDEOS_MAX_PAGE,
    );
  });

  it('folds identifiers and keeps a regional language code', () => {
    const view = readVideosQuery(QURAN, {
      speaker: PERSON.toUpperCase(),
      series: SERIES.toUpperCase(),
      language: 'ur-PK',
    });
    expect(view.speaker).toBe(PERSON);
    expect(view.series).toBe(SERIES);
    expect(view.language).toBe('ur-PK');
  });

  it('lets the general shelf win over a Surah, which narrows only videos that explain one', () => {
    const query = readVideosQuery(QURAN, { shelf: 'general', surah: '2' });
    expect(query).toMatchObject({ shelf: 'general', surah: null });
    // What it reads is always a query Media's own schema accepts.
    expect(
      topicVideosQuerySchema.safeParse(videosReadQuery(QURAN, query, TOPIC, 'en'))
        .success,
    ).toBe(true);
  });

  it('never reaches past Media’s own offset bound', () => {
    const query = readVideosQuery(QURAN, { page: String(VIDEOS_MAX_PAGE) });
    expect(
      topicVideosQuerySchema.safeParse(videosReadQuery(QURAN, query, TOPIC, 'ur'))
        .success,
    ).toBe(true);
  });
});

describe('videosHref', () => {
  const view = readVideosQuery(QURAN, {
    shelf: 'explains',
    surah: '2',
    language: 'ur',
    speaker: PERSON,
    series: SERIES,
    length: 'medium',
    sort: 'title',
    page: '4',
  });

  it('gives the unfiltered hub exactly one address, in every locale', () => {
    expect(videosHref(QURAN, 'en', DEFAULT_VIDEOS_QUERY)).toBe('/quran/videos');
    expect(videosHref(QURAN, 'ur', DEFAULT_VIDEOS_QUERY)).toBe('/ur/quran/videos');
    expect(videosHref(QURAN, 'ar', DEFAULT_VIDEOS_QUERY)).toBe('/ar/quran/videos');
  });

  it('writes every narrowing value in one fixed order, and the page last', () => {
    expect(videosHref(QURAN, 'en', view)).toBe(
      `/quran/videos?shelf=explains&surah=2&language=ur&speaker=${PERSON}&series=${SERIES}&length=medium&sort=title&page=4`,
    );
  });

  it('returns to the first page whenever anything but the page changes', () => {
    expect(videosHref(QURAN, 'en', view, { length: null })).toBe(
      `/quran/videos?shelf=explains&surah=2&language=ur&speaker=${PERSON}&series=${SERIES}&sort=title`,
    );
    expect(videosHref(QURAN, 'en', view, { page: 5 })).toContain('&page=5');
    expect(videosHref(QURAN, 'en', view, { page: 1 })).not.toContain('page=');
    // Newest is the neutral order and is never written.
    expect(videosHref(QURAN, 'en', view, { sort: 'newest' })).not.toContain('sort=');
  });

  it('drops the Surah when the general shelf is chosen', () => {
    expect(videosHref(QURAN, 'en', view, { shelf: 'general' })).toBe(
      `/quran/videos?shelf=general&language=ur&speaker=${PERSON}&series=${SERIES}&length=medium&sort=title`,
    );
  });

  it('round-trips: the address it builds reads back as the same view', () => {
    const params = Object.fromEntries(
      new URL(videosHref(QURAN, 'en', view), 'https://x.invalid').searchParams,
    );
    expect(readVideosQuery(QURAN, params)).toEqual(view);
  });
});

describe('videosCanonicalRedirect', () => {
  it('leaves a canonical address, and the bare hub, alone', () => {
    expect(videosCanonicalRedirect(QURAN, 'en', {})).toBeNull();
    expect(
      videosCanonicalRedirect(QURAN, 'ur', { shelf: 'explains', surah: '18', page: '2' }),
    ).toBeNull();
    // A parameter the hub does not read — the former related view's offset
    // included — is not its business.
    expect(videosCanonicalRedirect(QURAN, 'en', { utm_source: 'x' })).toBeNull();
    expect(videosCanonicalRedirect(QURAN, 'en', { offset: '24' })).toBeNull();
  });

  it('sends what a filter form submits — every control, empty ones included — to one address', () => {
    expect(
      videosCanonicalRedirect(QURAN, 'en', {
        surah: '',
        language: '',
        speaker: PERSON,
        series: '',
        length: '',
        sort: 'newest',
      }),
    ).toBe(`/quran/videos?speaker=${PERSON}`);
    expect(
      videosCanonicalRedirect(QURAN, 'ar', {
        shelf: 'explains',
        surah: '1',
        sort: 'newest',
      }),
    ).toBe('/ar/quran/videos?shelf=explains&surah=1');
  });

  it('sends another order, a malformed or repeated value, and a contradiction to the parsed view', () => {
    expect(
      videosCanonicalRedirect(QURAN, 'en', { sort: 'quran', shelf: 'explains' }),
    ).toBe('/quran/videos?shelf=explains&sort=quran');
    expect(videosCanonicalRedirect(QURAN, 'en', { surah: '999', page: '-1' })).toBe(
      '/quran/videos',
    );
    expect(videosCanonicalRedirect(QURAN, 'en', { length: ['short', 'long'] })).toBe(
      '/quran/videos',
    );
    expect(videosCanonicalRedirect(QURAN, 'en', { shelf: 'general', surah: '3' })).toBe(
      '/quran/videos?shelf=general',
    );
    expect(videosCanonicalRedirect(QURAN, 'en', { page: '1' })).toBe('/quran/videos');
    // Built from the parsed view, never from the typed text.
    expect(
      videosCanonicalRedirect(QURAN, 'en', { series: 'https://evil.example/' }),
    ).toBe('/quran/videos');
  });

  it('never redirects an address it built itself', () => {
    const view = readVideosQuery(QURAN, {
      shelf: 'explains',
      surah: '2',
      language: 'ur-PK',
      speaker: PERSON,
      series: SERIES,
      length: 'short',
      sort: 'quran',
      page: '7',
    });
    const params = Object.fromEntries(
      new URL(videosHref(QURAN, 'en', view), 'https://x.invalid').searchParams,
    );
    expect(videosCanonicalRedirect(QURAN, 'en', params)).toBeNull();
  });
});

describe('videosReadQuery and paging', () => {
  it('asks Media for one page by offset, with the Topic and the reader’s title locale', () => {
    expect(
      videosReadQuery(QURAN, readVideosQuery(QURAN, { page: '3' }), TOPIC, 'ur'),
    ).toEqual({
      topic: TOPIC,
      quranPassages: true,
      shelf: 'all',
      surah: null,
      language: null,
      speaker: null,
      series: null,
      length: null,
      sort: 'newest',
      titleLocale: 'ur',
      offset: 2 * TOPIC_VIDEOS_PAGE,
      limit: TOPIC_VIDEOS_PAGE,
    });
    expect(videosReadQuery(QURAN, DEFAULT_VIDEOS_QUERY, null, 'en').topic).toBeNull();
  });

  it('counts pages and states the range a page shows', () => {
    expect(videosPageCount(0)).toBe(1);
    expect(videosPageCount(TOPIC_VIDEOS_PAGE)).toBe(1);
    expect(videosPageCount(TOPIC_VIDEOS_PAGE + 1)).toBe(2);
    expect(videosRange(1, 0)).toBeNull();
    expect(videosRange(2, 3)).toEqual({
      from: TOPIC_VIDEOS_PAGE + 1,
      to: TOPIC_VIDEOS_PAGE + 3,
    });
  });
});

describe('wholeHours', () => {
  it('never states more hours than were recorded', () => {
    expect(wholeHours(0)).toBe(0);
    expect(wholeHours(3_599)).toBe(0);
    expect(wholeHours(3_600)).toBe(1);
    expect(wholeHours(7 * 3_600 + 3_599)).toBe(7);
  });
});

describe('a Videos hub without the Quran passage parts (Hadith)', () => {
  it('reads no shelf, no Surah and no Quran order — they are not its parts', () => {
    expect(
      readVideosQuery(HADITH, { shelf: 'general', surah: '18', sort: 'quran' }),
    ).toEqual(DEFAULT_VIDEOS_QUERY);
    expect(readVideosQuery(HADITH, { length: 'long', sort: 'title' })).toEqual({
      ...DEFAULT_VIDEOS_QUERY,
      length: 'long',
      sort: 'title',
    });
  });

  it('gives the hub one address in every locale, and never writes a passage part', () => {
    expect(videosHref(HADITH, 'en', DEFAULT_VIDEOS_QUERY)).toBe('/hadith/videos');
    expect(videosHref(HADITH, 'ur', DEFAULT_VIDEOS_QUERY)).toBe('/ur/hadith/videos');
    expect(
      videosHref(HADITH, 'en', DEFAULT_VIDEOS_QUERY, {
        shelf: 'explains',
        surah: 2,
        sort: 'quran',
      }),
    ).toBe('/hadith/videos');
    expect(
      videosHref(HADITH, 'ar', DEFAULT_VIDEOS_QUERY, {
        speaker: PERSON,
        length: 'short',
      }),
    ).toBe(`/ar/hadith/videos?speaker=${PERSON}&length=short`);
  });

  it('redirects a passage part, another order or a form submission to one address', () => {
    expect(videosCanonicalRedirect(HADITH, 'en', {})).toBeNull();
    expect(videosCanonicalRedirect(HADITH, 'en', { shelf: 'explains' })).toBe(
      '/hadith/videos',
    );
    expect(videosCanonicalRedirect(HADITH, 'en', { sort: 'quran' })).toBe(
      '/hadith/videos',
    );
    expect(
      videosCanonicalRedirect(HADITH, 'en', {
        sort: 'title',
        language: 'ur',
        series: '',
      }),
    ).toBe('/hadith/videos?language=ur&sort=title');
  });

  it('asks Media for the Topic alone — and always a query its schema accepts', () => {
    const read = videosReadQuery(
      HADITH,
      readVideosQuery(HADITH, { shelf: 'explains', surah: '1', page: '2' }),
      TOPIC,
      'en',
    );
    expect(read).toMatchObject({
      topic: TOPIC,
      quranPassages: false,
      shelf: 'all',
      surah: null,
      sort: 'newest',
      offset: TOPIC_VIDEOS_PAGE,
    });
    expect(topicVideosQuerySchema.safeParse(read).success).toBe(true);
  });
});
