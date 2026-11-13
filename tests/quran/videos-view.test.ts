import { describe, expect, it } from 'vitest';

import { QURAN_VIDEOS_PAGE, quranVideosQuerySchema } from '@minhaj/contracts/media';

import {
  DEFAULT_VIDEOS_QUERY,
  VIDEOS_MAX_PAGE,
  passageStart,
  readVideosQuery,
  videosCanonicalRedirect,
  videosFiltered,
  videosHref,
  videosPageCount,
  videosRange,
  videosReadQuery,
  wholeHours,
} from '../../apps/web/src/components/quran/videos-view.ts';

/**
 * Quran Part 11 — the Quran Videos hub's address rules: the view a URL names,
 * the address each control and link builds, the query Media is asked, and
 * where a lecture card opens its video. Tolerant of anything a visitor or a
 * crawler types; never widening.
 */

const PERSON = '5b0e1d2c-3f4a-4b5c-8d6e-7f8091a2b3c4';
const SERIES = '6c1f2e3d-4a5b-4c6d-9e7f-8091a2b3c4d5';
const TOPIC = '0f1e2d3c-4b5a-4968-8776-655443322110';

describe('readVideosQuery', () => {
  it('reads the neutral view from an empty address — newest first', () => {
    expect(readVideosQuery({})).toEqual(DEFAULT_VIDEOS_QUERY);
    expect(DEFAULT_VIDEOS_QUERY.sort).toBe('newest');
    expect(videosFiltered(readVideosQuery({}))).toBe(false);
  });

  it('reads every parameter it knows', () => {
    expect(
      readVideosQuery({
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
      readVideosQuery({
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
    expect(readVideosQuery({ surah: '0' }).surah).toBeNull();
    expect(readVideosQuery({ surah: '2.5' }).surah).toBeNull();
    expect(readVideosQuery({ surah: ['1', '2'] }).surah).toBeNull();
    expect(readVideosQuery({ length: ['short', 'long'] }).length).toBeNull();
    expect(readVideosQuery({ speaker: [PERSON, PERSON] }).speaker).toBeNull();
    expect(readVideosQuery({ language: 'x'.repeat(17) }).language).toBeNull();
    expect(readVideosQuery({ page: String(VIDEOS_MAX_PAGE + 1) }).page).toBe(1);
    expect(readVideosQuery({ page: String(VIDEOS_MAX_PAGE) }).page).toBe(VIDEOS_MAX_PAGE);
  });

  it('folds identifiers and keeps a regional language code', () => {
    const view = readVideosQuery({
      speaker: PERSON.toUpperCase(),
      series: SERIES.toUpperCase(),
      language: 'ur-PK',
    });
    expect(view.speaker).toBe(PERSON);
    expect(view.series).toBe(SERIES);
    expect(view.language).toBe('ur-PK');
  });

  it('lets the general shelf win over a Surah, which narrows only videos that explain one', () => {
    const query = readVideosQuery({ shelf: 'general', surah: '2' });
    expect(query).toMatchObject({ shelf: 'general', surah: null });
    // What it reads is always a query Media's own schema accepts.
    expect(
      quranVideosQuerySchema.safeParse(videosReadQuery(query, TOPIC, 'en')).success,
    ).toBe(true);
  });

  it('never reaches past Media’s own offset bound', () => {
    const query = readVideosQuery({ page: String(VIDEOS_MAX_PAGE) });
    expect(
      quranVideosQuerySchema.safeParse(videosReadQuery(query, TOPIC, 'ur')).success,
    ).toBe(true);
  });
});

describe('videosHref', () => {
  const view = readVideosQuery({
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
    expect(videosHref('en', DEFAULT_VIDEOS_QUERY)).toBe('/quran/videos');
    expect(videosHref('ur', DEFAULT_VIDEOS_QUERY)).toBe('/ur/quran/videos');
    expect(videosHref('ar', DEFAULT_VIDEOS_QUERY)).toBe('/ar/quran/videos');
  });

  it('writes every narrowing value in one fixed order, and the page last', () => {
    expect(videosHref('en', view)).toBe(
      `/quran/videos?shelf=explains&surah=2&language=ur&speaker=${PERSON}&series=${SERIES}&length=medium&sort=title&page=4`,
    );
  });

  it('returns to the first page whenever anything but the page changes', () => {
    expect(videosHref('en', view, { length: null })).toBe(
      `/quran/videos?shelf=explains&surah=2&language=ur&speaker=${PERSON}&series=${SERIES}&sort=title`,
    );
    expect(videosHref('en', view, { page: 5 })).toContain('&page=5');
    expect(videosHref('en', view, { page: 1 })).not.toContain('page=');
    // Newest is the neutral order and is never written.
    expect(videosHref('en', view, { sort: 'newest' })).not.toContain('sort=');
  });

  it('drops the Surah when the general shelf is chosen', () => {
    expect(videosHref('en', view, { shelf: 'general' })).toBe(
      `/quran/videos?shelf=general&language=ur&speaker=${PERSON}&series=${SERIES}&length=medium&sort=title`,
    );
  });

  it('round-trips: the address it builds reads back as the same view', () => {
    const params = Object.fromEntries(
      new URL(videosHref('en', view), 'https://x.invalid').searchParams,
    );
    expect(readVideosQuery(params)).toEqual(view);
  });
});

describe('videosCanonicalRedirect', () => {
  it('leaves a canonical address, and the bare hub, alone', () => {
    expect(videosCanonicalRedirect('en', {})).toBeNull();
    expect(
      videosCanonicalRedirect('ur', { shelf: 'explains', surah: '18', page: '2' }),
    ).toBeNull();
    // A parameter the hub does not read — the former related view's offset
    // included — is not its business.
    expect(videosCanonicalRedirect('en', { utm_source: 'x' })).toBeNull();
    expect(videosCanonicalRedirect('en', { offset: '24' })).toBeNull();
  });

  it('sends what a filter form submits — every control, empty ones included — to one address', () => {
    expect(
      videosCanonicalRedirect('en', {
        surah: '',
        language: '',
        speaker: PERSON,
        series: '',
        length: '',
        sort: 'newest',
      }),
    ).toBe(`/quran/videos?speaker=${PERSON}`);
    expect(
      videosCanonicalRedirect('ar', { shelf: 'explains', surah: '1', sort: 'newest' }),
    ).toBe('/ar/quran/videos?shelf=explains&surah=1');
  });

  it('sends another order, a malformed or repeated value, and a contradiction to the parsed view', () => {
    expect(videosCanonicalRedirect('en', { sort: 'quran', shelf: 'explains' })).toBe(
      '/quran/videos?shelf=explains&sort=quran',
    );
    expect(videosCanonicalRedirect('en', { surah: '999', page: '-1' })).toBe(
      '/quran/videos',
    );
    expect(videosCanonicalRedirect('en', { length: ['short', 'long'] })).toBe(
      '/quran/videos',
    );
    expect(videosCanonicalRedirect('en', { shelf: 'general', surah: '3' })).toBe(
      '/quran/videos?shelf=general',
    );
    expect(videosCanonicalRedirect('en', { page: '1' })).toBe('/quran/videos');
    // Built from the parsed view, never from the typed text.
    expect(videosCanonicalRedirect('en', { series: 'https://evil.example/' })).toBe(
      '/quran/videos',
    );
  });

  it('never redirects an address it built itself', () => {
    const view = readVideosQuery({
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
      new URL(videosHref('en', view), 'https://x.invalid').searchParams,
    );
    expect(videosCanonicalRedirect('en', params)).toBeNull();
  });
});

describe('videosReadQuery and paging', () => {
  it('asks Media for one page by offset, with the Topic and the reader’s title locale', () => {
    expect(videosReadQuery(readVideosQuery({ page: '3' }), TOPIC, 'ur')).toEqual({
      topic: TOPIC,
      shelf: 'all',
      surah: null,
      language: null,
      speaker: null,
      series: null,
      length: null,
      sort: 'newest',
      titleLocale: 'ur',
      offset: 2 * QURAN_VIDEOS_PAGE,
      limit: QURAN_VIDEOS_PAGE,
    });
    expect(videosReadQuery(DEFAULT_VIDEOS_QUERY, null, 'en').topic).toBeNull();
  });

  it('counts pages and states the range a page shows', () => {
    expect(videosPageCount(0)).toBe(1);
    expect(videosPageCount(QURAN_VIDEOS_PAGE)).toBe(1);
    expect(videosPageCount(QURAN_VIDEOS_PAGE + 1)).toBe(2);
    expect(videosRange(1, 0)).toBeNull();
    expect(videosRange(2, 3)).toEqual({
      from: QURAN_VIDEOS_PAGE + 1,
      to: QURAN_VIDEOS_PAGE + 3,
    });
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

describe('wholeHours', () => {
  it('never states more hours than were recorded', () => {
    expect(wholeHours(0)).toBe(0);
    expect(wholeHours(3_599)).toBe(0);
    expect(wholeHours(3_600)).toBe(1);
    expect(wholeHours(7 * 3_600 + 3_599)).toBe(7);
  });
});
