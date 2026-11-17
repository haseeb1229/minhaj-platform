import { describe, expect, it } from 'vitest';

import {
  NEWS_LISTING_PAGE,
  newsListingQuerySchema,
} from '../../packages/contracts/src/editorial/index.ts';
import {
  DEFAULT_NEWS_VIEW,
  NEWS_MAX_PAGE,
  newsArchiveCanonicalRedirect,
  newsArchiveHref,
  newsCanonicalRedirect,
  newsFiltered,
  newsHref,
  newsKindHref,
  newsListingHref,
  newsOpening,
  newsReadQuery,
  readNewsArchiveView,
  readNewsView,
} from '../../apps/web/src/components/editorial/news-view.ts';

/**
 * News & Events Part 1 — the News listings' and the archive's address rules.
 *
 * ONE LISTING, FOUR FAMILIES, ONE ADDRESS PER VIEW: the parameters are read
 * tolerantly (anything malformed, repeated or out of range is simply absent),
 * written back in one canonical order with neutral values omitted, and every
 * other spelling — a form's empty controls, R2's `?lang=`, Phase 13's
 * `?offset=` and `?sort=latest`, the archive's former listing parameters — is
 * ONE redirect to it. What a view asks of Editorial is accepted by Editorial's
 * own schema, the authoritative boundary.
 */

const TOPIC = '3f2b8c1e-9a4d-4c7b-8e2f-1a2b3c4d5e6f';

describe('reading a listing’s view', () => {
  it('reads every parameter, and nothing is the default view', () => {
    expect(readNewsView('news-article', {})).toEqual(DEFAULT_NEWS_VIEW);
    expect(
      readNewsView('media-coverage', {
        topic: TOPIC.toUpperCase(),
        year: '2024',
        month: '3',
        language: 'ur',
        outlet: '  Synthetic Outlet  ',
        sort: 'oldest',
        page: '4',
      }),
    ).toEqual({
      topic: TOPIC,
      year: 2024,
      month: 3,
      language: 'ur',
      outlet: 'Synthetic Outlet',
      sort: 'oldest',
      page: 4,
    });
  });

  it('drops a malformed, repeated or out-of-range value rather than failing', () => {
    for (const query of [
      { topic: 'not-a-uuid' },
      { topic: [TOPIC, TOPIC] },
      { year: '1899' },
      { year: '99999' },
      { year: '20x4' },
      { year: ['2024', '2025'] },
      { month: '3' }, // a month without its year means nothing
      { year: '2024', month: '13' },
      { year: '2024', month: '0' },
      { language: 'fr' },
      { language: 'EN' },
      { language: ['en', 'ur'] },
      { sort: 'title' },
      { page: '0' },
      { page: String(NEWS_MAX_PAGE + 1) },
      { page: '1e3' },
    ]) {
      const view = readNewsView('statement', query);
      const expected =
        'year' in query && query.year === '2024'
          ? { ...DEFAULT_NEWS_VIEW, year: 2024 }
          : DEFAULT_NEWS_VIEW;
      expect(view, JSON.stringify(query)).toEqual(expected);
    }
  });

  it('reads an outlet only for media coverage, trimmed, and never an empty or overlong one', () => {
    expect(readNewsView('statement', { outlet: 'Synthetic Outlet' }).outlet).toBeNull();
    expect(readNewsView('media-coverage', { outlet: '   ' }).outlet).toBeNull();
    expect(readNewsView('media-coverage', { outlet: 'x'.repeat(201) }).outlet).toBeNull();
    expect(readNewsView('media-coverage', { outlet: 'A  B' }).outlet).toBe('A  B');
  });

  it('reads R2’s ?lang= and Phase 13’s ?offset= as the views they named', () => {
    expect(readNewsView('news-article', { lang: 'ar' }).language).toBe('ar');
    // `?language=` wins when both are given.
    expect(readNewsView('news-article', { lang: 'ar', language: 'en' }).language).toBe(
      'en',
    );
    expect(readNewsView('news-article', { offset: '0' }).page).toBe(1);
    expect(readNewsView('news-article', { offset: String(NEWS_LISTING_PAGE) }).page).toBe(
      2,
    );
    expect(readNewsView('news-article', { offset: '45' }).page).toBe(3);
    for (const offset of ['-1', 'x', '25001', '9999999'])
      expect(readNewsView('news-article', { offset }).page, offset).toBe(1);
    // An explicit page wins over a former offset.
    expect(readNewsView('news-article', { page: '2', offset: '200' }).page).toBe(2);
  });

  it('knows a narrowing from an order, and the front door from every other view', () => {
    expect(newsFiltered(DEFAULT_NEWS_VIEW)).toBe(false);
    expect(newsFiltered({ ...DEFAULT_NEWS_VIEW, sort: 'oldest' })).toBe(false);
    for (const change of [
      { topic: TOPIC },
      { year: 2024 },
      { language: 'ur' as const },
      { outlet: 'X' },
    ])
      expect(newsFiltered({ ...DEFAULT_NEWS_VIEW, ...change })).toBe(true);
    expect(newsOpening(DEFAULT_NEWS_VIEW)).toBe(true);
    expect(newsOpening({ ...DEFAULT_NEWS_VIEW, page: 2 })).toBe(false);
    expect(newsOpening({ ...DEFAULT_NEWS_VIEW, sort: 'oldest' })).toBe(false);
    expect(newsOpening({ ...DEFAULT_NEWS_VIEW, year: 2024 })).toBe(false);
  });
});

describe('writing a listing’s address', () => {
  const view = {
    topic: TOPIC,
    year: 2024,
    month: 3,
    language: 'ur' as const,
    outlet: 'Synthetic Outlet',
    sort: 'oldest' as const,
    page: 3,
  };

  it('writes each family’s own path, its parameters in one order, neutral ones omitted', () => {
    expect(newsHref('en', 'news-article', DEFAULT_NEWS_VIEW)).toBe('/news');
    expect(newsHref('ur', 'press-release', DEFAULT_NEWS_VIEW)).toBe(
      '/ur/news/press-releases',
    );
    expect(newsHref('ar', 'media-coverage', view)).toBe(
      `/ar/news/media-coverage?topic=${TOPIC}&year=2024&month=3&language=ur&outlet=Synthetic+Outlet&sort=oldest&page=3`,
    );
    // An outlet belongs to media coverage alone.
    expect(newsHref('en', 'statement', view)).toBe(
      `/news/statements?topic=${TOPIC}&year=2024&month=3&language=ur&sort=oldest&page=3`,
    );
  });

  it('returns to the first page whenever anything but the page changes, and drops a month with its year', () => {
    expect(newsHref('en', 'statement', view, { page: 4 })).toContain('page=4');
    expect(newsHref('en', 'statement', view, { language: null })).not.toContain('page=');
    expect(newsHref('en', 'statement', view, { year: null })).toBe(
      `/news/statements?topic=${TOPIC}&language=ur&sort=oldest`,
    );
  });

  it('builds a link into a view from the unfiltered first page, and tabs that keep the view', () => {
    expect(newsListingHref('en', 'press-release', { year: 2020, month: 1 })).toBe(
      '/news/press-releases?year=2020&month=1',
    );
    expect(newsListingHref('ur', 'media-coverage', { outlet: 'A&B' })).toBe(
      '/ur/news/media-coverage?outlet=A%26B',
    );
    // A tab keeps the Topic, period, language and order — never the outlet or page.
    expect(newsKindHref('en', 'news-article', view)).toBe(
      `/news?topic=${TOPIC}&year=2024&month=3&language=ur&sort=oldest`,
    );
  });
});

describe('one address per view', () => {
  it('lets the canonical address through and redirects every other spelling once', () => {
    expect(newsCanonicalRedirect('en', 'news-article', {})).toBeNull();
    expect(
      newsCanonicalRedirect('ur', 'statement', { year: '2024', page: '2' }),
    ).toBeNull();
    // Unknown parameters are left alone unless a redirect happens anyway.
    expect(newsCanonicalRedirect('en', 'news-article', { utm: 'x' })).toBeNull();
    for (const [query, target] of [
      // A form's empty controls.
      [
        { topic: '', year: '2024', month: '', language: '', sort: 'newest' },
        '/news?year=2024',
      ],
      // Another order of the same parameters.
      [{ language: 'ur', year: '2024' }, '/news?year=2024&language=ur'],
      // R2's language parameter, Phase 13's offset and order.
      [{ lang: 'ur' }, '/news?language=ur'],
      [{ offset: '40' }, '/news?page=3'],
      [{ sort: 'latest' }, '/news'],
      // An identifier in upper case is written in lower case.
      [{ topic: TOPIC.toUpperCase() }, `/news?topic=${TOPIC}`],
      // A malformed or repeated value.
      [{ year: 'abc', month: '99' }, '/news'],
      [{ page: ['2', '3'] }, '/news'],
      [{ page: '1' }, '/news'],
    ] as const)
      expect(
        newsCanonicalRedirect('en', 'news-article', query),
        JSON.stringify(query),
      ).toBe(target);
    // An outlet is a parameter of media coverage alone; elsewhere it is left alone.
    expect(newsCanonicalRedirect('en', 'statement', { outlet: 'X' })).toBeNull();
    expect(newsCanonicalRedirect('en', 'media-coverage', { outlet: ' X ' })).toBe(
      '/news/media-coverage?outlet=X',
    );
  });

  it('asks Editorial for exactly the view, in a shape its own schema accepts', () => {
    const asked = newsReadQuery(
      'media-coverage',
      { ...DEFAULT_NEWS_VIEW, topic: TOPIC, year: 2024, month: 3, outlet: 'X', page: 3 },
      'ur',
    );
    expect(asked).toEqual({
      kind: 'media-coverage',
      topic: TOPIC,
      year: 2024,
      month: 3,
      language: null,
      outlet: 'X',
      // The reader's language leads the default order of a view no language narrows.
      prefer: 'ur',
      sort: 'newest',
      offset: 2 * NEWS_LISTING_PAGE,
      limit: NEWS_LISTING_PAGE,
    });
    expect(newsListingQuerySchema.parse(asked)).toEqual(asked);
    expect(
      newsReadQuery('statement', { ...DEFAULT_NEWS_VIEW, language: 'en' }, 'ur').prefer,
    ).toBeNull();
    expect(
      newsReadQuery('statement', { ...DEFAULT_NEWS_VIEW, sort: 'oldest' }, 'ur').prefer,
    ).toBeNull();
    // The deepest page an address can name is still inside Editorial's bound.
    expect(() =>
      newsListingQuerySchema.parse(
        newsReadQuery('statement', { ...DEFAULT_NEWS_VIEW, page: NEWS_MAX_PAGE }, 'en'),
      ),
    ).not.toThrow();
  });
});

describe('the archive’s address', () => {
  it('reads only its year, tolerantly', () => {
    expect(readNewsArchiveView({})).toEqual({ year: null });
    expect(readNewsArchiveView({ year: '2034' })).toEqual({ year: 2034 });
    for (const year of ['1899', 'abc', '20345'])
      expect(readNewsArchiveView({ year }), year).toEqual({ year: null });
    expect(readNewsArchiveView({ year: ['2034', '2035'] })).toEqual({ year: null });
    expect(newsArchiveHref('en')).toBe('/news/archive');
    expect(newsArchiveHref('ur', 2034)).toBe('/ur/news/archive?year=2034');
  });

  it('sends each former listing view into its family listing, or to the year, once', () => {
    expect(newsArchiveCanonicalRedirect('en', {})).toBeNull();
    expect(newsArchiveCanonicalRedirect('en', { year: '2034' })).toBeNull();
    expect(
      newsArchiveCanonicalRedirect('ur', {
        type: 'press-release',
        lang: 'en',
        year: '2034',
        month: '2',
        offset: '20',
      }),
    ).toBe('/ur/news/press-releases?year=2034&month=2&language=en');
    expect(newsArchiveCanonicalRedirect('en', { type: 'statement' })).toBe(
      '/news/statements',
    );
    // A family that is not one is not a family: the archive's own view.
    expect(newsArchiveCanonicalRedirect('en', { type: 'event', year: '2034' })).toBe(
      '/news/archive?year=2034',
    );
    for (const [query, target] of [
      [{ year: '2034', month: '2' }, '/news/archive?year=2034'],
      [{ lang: 'ur' }, '/news/archive'],
      [{ offset: '20' }, '/news/archive'],
      [{ year: 'abc', month: '99' }, '/news/archive'],
    ] as const)
      expect(newsArchiveCanonicalRedirect('en', query), JSON.stringify(query)).toBe(
        target,
      );
  });
});
