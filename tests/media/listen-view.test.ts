import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LECTURES_VIEW,
  LECTURES_MAX_PAGE,
  lecturesCanonicalRedirect,
  lecturesFiltered,
  lecturesHref,
  lecturesReadQuery,
  listenLecturesHref,
  readLecturesView,
} from '../../apps/web/src/components/media/listen-view.ts';

/**
 * Watch Part 3 — the audio lectures listing's address rules: the view a GET
 * address means, the ONE address of each view, the redirect that spells any
 * other address of it that way, and what Media is asked. Pure, so these are
 * the rules the pages, the filter form, the chips, the pages and every link
 * into the listing share.
 */

const TOPIC = '0f1e2d3c-4b5a-4968-8776-655443322110';
const SPEAKER = '1a2b3c4d-5e6f-4a1b-8c2d-3e4f5a6b7c8d';
const SERIES = '9e8d7c6b-5a4f-4e3d-9c2b-1a0f9e8d7c6b';

describe('reading a view from its address', () => {
  it('reads the unfiltered listing from nothing', () => {
    expect(readLecturesView({})).toEqual(DEFAULT_LECTURES_VIEW);
  });

  it('reads every filter, folding identifiers to lower case', () => {
    expect(
      readLecturesView({
        topic: TOPIC.toUpperCase(),
        language: 'ur',
        speaker: SPEAKER,
        series: SERIES,
        length: 'medium',
        sort: 'title',
        page: '3',
      }),
    ).toEqual({
      topic: TOPIC,
      language: 'ur',
      speaker: SPEAKER,
      series: SERIES,
      length: 'medium',
      sort: 'title',
      page: 3,
    });
  });

  it('drops a malformed, repeated or out-of-range value rather than failing', () => {
    expect(
      readLecturesView({
        topic: 'education',
        language: 'Urdu language',
        speaker: [SPEAKER, SPEAKER],
        series: '',
        length: 'epic',
        sort: 'popular',
        page: String(LECTURES_MAX_PAGE + 1),
      }),
    ).toEqual(DEFAULT_LECTURES_VIEW);
    expect(readLecturesView({ page: '0' }).page).toBe(1);
  });

  it('reads a former ?offset= as the page holding the recording it began with', () => {
    expect(readLecturesView({ offset: '0' }).page).toBe(1);
    expect(readLecturesView({ offset: '24' }).page).toBe(2);
    expect(readLecturesView({ offset: '30' }).page).toBe(2);
    expect(readLecturesView({ offset: '25000' }).page).toBe(LECTURES_MAX_PAGE);
    expect(readLecturesView({ offset: '25001' }).page).toBe(1);
    expect(readLecturesView({ offset: '-24' }).page).toBe(1);
    // A page named outright wins over a former offset.
    expect(readLecturesView({ page: '4', offset: '24' }).page).toBe(4);
  });

  it('says a view is filtered by any filter, and never by an order or a page', () => {
    expect(lecturesFiltered(DEFAULT_LECTURES_VIEW)).toBe(false);
    expect(lecturesFiltered({ ...DEFAULT_LECTURES_VIEW, sort: 'title', page: 3 })).toBe(
      false,
    );
    for (const change of [
      { topic: TOPIC },
      { language: 'ar' },
      { speaker: SPEAKER },
      { series: SERIES },
      { length: 'short' as const },
    ])
      expect(lecturesFiltered({ ...DEFAULT_LECTURES_VIEW, ...change })).toBe(true);
  });
});

describe('one address per view', () => {
  it('spells the unfiltered listing bare, in each locale', () => {
    expect(lecturesHref('en', DEFAULT_LECTURES_VIEW)).toBe('/listen/lectures');
    expect(lecturesHref('ur', DEFAULT_LECTURES_VIEW)).toBe('/ur/listen/lectures');
    expect(lecturesHref('ar', DEFAULT_LECTURES_VIEW)).toBe('/ar/listen/lectures');
  });

  it('spells a view in one order, neutral values omitted, identifiers in lower case', () => {
    expect(
      lecturesHref('en', {
        topic: TOPIC.toUpperCase(),
        language: 'ur',
        speaker: SPEAKER,
        series: SERIES,
        length: 'long',
        sort: 'title',
        page: 2,
      }),
    ).toBe(
      `/listen/lectures?topic=${TOPIC}&language=ur&speaker=${SPEAKER}&series=${SERIES}&length=long&sort=title&page=2`,
    );
  });

  it('returns to the first page whenever anything but the page changes', () => {
    const view = { ...DEFAULT_LECTURES_VIEW, language: 'ur', page: 5 };
    expect(lecturesHref('en', view)).toBe('/listen/lectures?language=ur&page=5');
    expect(lecturesHref('en', view, { length: 'short' })).toBe(
      '/listen/lectures?language=ur&length=short',
    );
    expect(lecturesHref('en', view, { page: 6 })).toBe(
      '/listen/lectures?language=ur&page=6',
    );
    expect(lecturesHref('en', view, { language: null })).toBe('/listen/lectures');
  });

  it('builds every link into the listing from its unfiltered first page', () => {
    expect(listenLecturesHref('en')).toBe('/listen/lectures');
    expect(listenLecturesHref('ur', { speaker: SPEAKER.toUpperCase() })).toBe(
      `/ur/listen/lectures?speaker=${SPEAKER}`,
    );
    expect(listenLecturesHref('ar', { topic: TOPIC, sort: 'title' })).toBe(
      `/ar/listen/lectures?topic=${TOPIC}&sort=title`,
    );
  });

  it('answers the canonical address with no redirect', () => {
    expect(lecturesCanonicalRedirect('en', {})).toBeNull();
    expect(
      lecturesCanonicalRedirect('ur', { language: 'ur', length: 'long', page: '2' }),
    ).toBeNull();
    // A parameter the listing does not read is left alone.
    expect(lecturesCanonicalRedirect('en', { utm_source: 'x' })).toBeNull();
  });

  it('answers every other spelling of a view with ONE redirect to its canonical one', () => {
    for (const [query, canonical] of [
      // A form's empty controls and its default order.
      [
        {
          topic: '',
          language: 'ur',
          speaker: '',
          series: '',
          length: '',
          sort: 'newest',
        },
        '/listen/lectures?language=ur',
      ],
      // Another order of the same parameters.
      [{ length: 'long', language: 'ur' }, '/listen/lectures?language=ur&length=long'],
      // A malformed or repeated value, an identifier in upper case.
      [{ topic: 'education' }, '/listen/lectures'],
      [{ speaker: [SPEAKER, SPEAKER] }, '/listen/lectures'],
      [{ series: SERIES.toUpperCase() }, `/listen/lectures?series=${SERIES}`],
      // The first page named, and the former pager.
      [{ page: '1' }, '/listen/lectures'],
      [{ offset: '48' }, '/listen/lectures?page=3'],
      [{ offset: '0' }, '/listen/lectures'],
    ] as const)
      expect(lecturesCanonicalRedirect('en', query), JSON.stringify(query)).toBe(
        canonical,
      );
  });
});

describe('what Media is asked', () => {
  it('asks for one page of the view, its titles in the reader’s language', () => {
    expect(lecturesReadQuery(DEFAULT_LECTURES_VIEW, 'ur')).toEqual({
      topic: null,
      language: null,
      speaker: null,
      series: null,
      length: null,
      sort: 'newest',
      titleLocale: 'ur',
      offset: 0,
      limit: 24,
    });
    expect(
      lecturesReadQuery(
        { ...DEFAULT_LECTURES_VIEW, speaker: SPEAKER, sort: 'title', page: 3 },
        'en',
      ),
    ).toMatchObject({ speaker: SPEAKER, sort: 'title', offset: 48, limit: 24 });
  });
});
