import { describe, expect, it } from 'vitest';

import {
  MAGAZINE_ISSUE_PAGE,
  magazineIssuesQuerySchema,
} from '../../packages/contracts/src/library/index.ts';
import {
  DEFAULT_MAGAZINE_VIEW,
  MAGAZINE_MAX_PAGE,
  magazineCanonicalRedirect,
  magazineHref,
  magazineIssuesRead,
  magazinePageCount,
  magazinesCanonicalRedirect,
  magazinesHref,
  readMagazinesTopic,
  readMagazineView,
} from '../../apps/web/src/components/library/magazine-view.ts';

/**
 * Library Part 3 — the periodicals' address rules: the directory's Topic and
 * a Magazine page's year, undated view and page. One address per view;
 * anything else — a malformed value, another order, a former parameter — is
 * one redirect to the canonical spelling, built from the parsed view; and
 * every view asks Library for a query its own schema accepts.
 */

const TOPIC = '0f1e2d3c-4b5a-4968-8776-655443322110';
const MAGAZINE = '5b0e1d2c-3f4a-4b5c-8d6e-7f8091a2b3c4';

describe('the periodicals directory', () => {
  it('reads a Topic, in lower case, and nothing else', () => {
    expect(readMagazinesTopic({})).toBeNull();
    expect(readMagazinesTopic({ topic: TOPIC.toUpperCase() })).toBe(TOPIC);
    expect(readMagazinesTopic({ topic: 'quran' })).toBeNull();
    expect(readMagazinesTopic({ topic: [TOPIC, TOPIC] })).toBeNull();
  });

  it('has one address per view, and drops the former Phase-9 parameters', () => {
    expect(magazinesHref('en', null)).toBe('/library/magazines');
    expect(magazinesHref('ur', TOPIC.toUpperCase())).toBe(
      `/ur/library/magazines?topic=${TOPIC}`,
    );
    expect(magazinesCanonicalRedirect('en', {})).toBeNull();
    expect(magazinesCanonicalRedirect('en', { topic: TOPIC })).toBeNull();
    expect(magazinesCanonicalRedirect('en', { utm_source: 'x' })).toBeNull();
    for (const former of [
      { offset: '25' },
      { language: 'ur' },
      { from: '1990', to: '1999' },
    ])
      expect(magazinesCanonicalRedirect('ar', former)).toBe('/ar/library/magazines');
    expect(magazinesCanonicalRedirect('en', { topic: TOPIC.toUpperCase() })).toBe(
      `/library/magazines?topic=${TOPIC}`,
    );
    expect(magazinesCanonicalRedirect('en', { topic: '' })).toBe('/library/magazines');
  });
});

describe('a Magazine’s page', () => {
  it('reads a year, the undated view and a page — never a year and "undated" at once', () => {
    expect(readMagazineView({})).toEqual(DEFAULT_MAGAZINE_VIEW);
    expect(readMagazineView({ year: '2021', page: '2' })).toEqual({
      year: 2021,
      undated: false,
      page: 2,
    });
    expect(readMagazineView({ undated: '1' })).toEqual({
      year: null,
      undated: true,
      page: 1,
    });
    expect(readMagazineView({ year: '2021', undated: '1' })).toEqual({
      year: 2021,
      undated: false,
      page: 1,
    });
    for (const year of ['0', '10000', '20.5', 'abc'])
      expect(readMagazineView({ year }).year, year).toBeNull();
    expect(readMagazineView({ undated: 'yes' }).undated).toBe(false);
    expect(readMagazineView({ page: String(MAGAZINE_MAX_PAGE + 1) }).page).toBe(1);
  });

  it('turns the former `?offset=` (25 a page) into the page holding its first issue', () => {
    expect(readMagazineView({ offset: '25' }).page).toBe(2);
    expect(readMagazineView({ offset: '0' }).page).toBe(1);
    expect(readMagazineView({ offset: '48', page: '1' }).page).toBe(1);
  });

  it('builds every view’s one address, returning to the first page on a new year', () => {
    const view = readMagazineView({ year: '2021', page: '3' });
    expect(magazineHref('en', 'monthly', view)).toBe(
      '/library/magazines/monthly?year=2021&page=3',
    );
    expect(magazineHref('ur', 'monthly', view, { year: 2019 })).toBe(
      '/ur/library/magazines/monthly?year=2019',
    );
    expect(magazineHref('en', 'monthly', view, { year: null, undated: true })).toBe(
      '/library/magazines/monthly?undated=1',
    );
    expect(magazineHref('en', 'monthly', view, { year: null, undated: false })).toBe(
      '/library/magazines/monthly',
    );
    expect(magazineHref('en', 'monthly', view, { page: 4 })).toBe(
      '/library/magazines/monthly?year=2021&page=4',
    );
  });

  it('redirects any other spelling once, and leaves the canonical one alone', () => {
    expect(magazineCanonicalRedirect('en', 'monthly', {})).toBeNull();
    expect(
      magazineCanonicalRedirect('en', 'monthly', { year: '2021', page: '2' }),
    ).toBeNull();
    expect(magazineCanonicalRedirect('en', 'monthly', { page: '2', year: '2021' })).toBe(
      '/library/magazines/monthly?year=2021&page=2',
    );
    expect(magazineCanonicalRedirect('en', 'monthly', { offset: '50' })).toBe(
      '/library/magazines/monthly?page=3',
    );
    expect(magazineCanonicalRedirect('ar', 'monthly', { year: 'x', page: '1' })).toBe(
      '/ar/library/magazines/monthly',
    );
    expect(magazineCanonicalRedirect('en', 'monthly', { utm_source: 'x' })).toBeNull();
  });

  it('asks Library for a query its schema accepts, up to the deepest page', () => {
    for (const view of [
      DEFAULT_MAGAZINE_VIEW,
      readMagazineView({ year: '2021', page: '2' }),
      readMagazineView({ undated: '1' }),
      readMagazineView({ page: String(MAGAZINE_MAX_PAGE) }),
    ])
      expect(
        magazineIssuesQuerySchema.safeParse(magazineIssuesRead(MAGAZINE, view)).success,
      ).toBe(true);
    expect(magazineIssuesRead(MAGAZINE, readMagazineView({ page: '2' }))).toEqual({
      magazineId: MAGAZINE,
      year: null,
      undated: false,
      offset: MAGAZINE_ISSUE_PAGE,
      limit: MAGAZINE_ISSUE_PAGE,
    });
    expect(magazinePageCount(0)).toBe(1);
    expect(magazinePageCount(MAGAZINE_ISSUE_PAGE + 1)).toBe(2);
  });
});
