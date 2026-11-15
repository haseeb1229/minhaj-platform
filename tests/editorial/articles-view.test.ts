import { describe, expect, it } from 'vitest';

import {
  ARTICLES_MAX_PAGE,
  ARTICLES_PAGE,
  articlesCanonicalRedirect,
  articlesHref,
  articlesOffset,
  articlesPageCount,
  articlesRange,
  readArticlesPage,
} from '../../apps/web/src/components/editorial/articles-view.ts';

/**
 * Library Part 3 — `/library/articles`, Editorial's one public listing of its
 * Articles at the Library's address: a page per address, the former
 * `?offset=` one redirect to the page holding the Article it began with, and
 * every other spelling one redirect to the canonical address.
 */

describe('the Articles listing’s address', () => {
  it('reads a page, tolerantly', () => {
    expect(readArticlesPage({})).toBe(1);
    expect(readArticlesPage({ page: '3' })).toBe(3);
    for (const page of ['0', '-1', 'x', '1e3', String(ARTICLES_MAX_PAGE + 1)])
      expect(readArticlesPage({ page }), page).toBe(1);
    expect(readArticlesPage({ page: ['2', '3'] })).toBe(1);
  });

  it('turns a former offset into the page holding its first Article', () => {
    expect(readArticlesPage({ offset: '25' })).toBe(2);
    expect(readArticlesPage({ offset: '24' })).toBe(1);
    expect(readArticlesPage({ offset: '50', page: '1' })).toBe(1);
  });

  it('has one address per page and redirects every other spelling once', () => {
    expect(articlesHref('en', 1)).toBe('/library/articles');
    expect(articlesHref('ur', 4)).toBe('/ur/library/articles?page=4');
    expect(articlesCanonicalRedirect('en', {})).toBeNull();
    expect(articlesCanonicalRedirect('en', { page: '2' })).toBeNull();
    expect(articlesCanonicalRedirect('en', { utm_source: 'x' })).toBeNull();
    expect(articlesCanonicalRedirect('en', { offset: '25' })).toBe(
      '/library/articles?page=2',
    );
    expect(articlesCanonicalRedirect('ar', { page: '1' })).toBe('/ar/library/articles');
    expect(articlesCanonicalRedirect('en', { page: 'two' })).toBe('/library/articles');
  });

  it('asks Editorial for the page’s offset, and states its range and page count', () => {
    expect(articlesOffset(1)).toBe(0);
    expect(articlesOffset(3)).toBe(2 * ARTICLES_PAGE);
    // Inside Editorial's own offset bound at the deepest page.
    expect(articlesOffset(ARTICLES_MAX_PAGE)).toBeLessThanOrEqual(10_000_000);
    expect(articlesPageCount(0)).toBe(1);
    expect(articlesPageCount(26)).toBe(2);
    expect(articlesRange(2, 3)).toEqual({ from: 26, to: 28 });
    expect(articlesRange(9, 0)).toBeNull();
  });
});
