import { describe, expect, it } from 'vitest';

import {
  adminPageHref,
  adminPagerState,
} from '../../apps/web/src/app/[locale]/admin/paging.ts';

/**
 * R2 — THE ADMINISTRATIVE PAGER'S PAGE MATH.
 *
 * Every administrative listing renders the shared `Pager` through one adapter.
 * What the adapter decides is which pages exist: a counted listing gets a
 * numbered window and never links past its last page, a has-more listing gets
 * previous and next only, and a page's address keeps the listing's filters.
 */
describe('the administrative pager', () => {
  it('numbers a counted listing and links only pages that exist', () => {
    expect(adminPagerState(0, 25, { total: 0 })).toEqual({
      current: 1,
      previous: null,
      next: null,
      pages: 1,
    });
    expect(adminPagerState(0, 25, { total: 25 })).toEqual({
      current: 1,
      previous: null,
      next: null,
      pages: 1,
    });
    expect(adminPagerState(0, 25, { total: 26 })).toEqual({
      current: 1,
      previous: null,
      next: 2,
      pages: 2,
    });
    expect(adminPagerState(50, 25, { total: 120 })).toEqual({
      current: 3,
      previous: 2,
      next: 4,
      pages: 5,
    });
    expect(adminPagerState(100, 25, { total: 120 })).toEqual({
      current: 5,
      previous: 4,
      next: null,
      pages: 5,
    });
  });

  it('keeps a page past the end addressable, so the reader can step back', () => {
    expect(adminPagerState(250, 25, { total: 30 })).toEqual({
      current: 11,
      previous: 10,
      next: null,
      pages: 11,
    });
  });

  it('offers previous and next only when the listing knows no total', () => {
    expect(adminPagerState(0, 24, { more: false })).toEqual({
      current: 1,
      previous: null,
      next: null,
      pages: null,
    });
    expect(adminPagerState(0, 24, { more: true })).toEqual({
      current: 1,
      previous: null,
      next: 2,
      pages: null,
    });
    expect(adminPagerState(48, 24, { more: false })).toEqual({
      current: 3,
      previous: 2,
      next: null,
      pages: null,
    });
  });

  it('treats a negative offset as the first page', () => {
    expect(adminPagerState(-25, 25, { more: true }).current).toBe(1);
  });

  it('keeps the filters in every page address and omits page 1', () => {
    const href = adminPageHref('/ur/admin/identity/users', {
      q: 'amin & co',
      status: 'active',
      empty: '',
      absent: null,
    });
    expect(href(1)).toBe('/ur/admin/identity/users?q=amin+%26+co&status=active');
    expect(href(3)).toBe('/ur/admin/identity/users?q=amin+%26+co&status=active&page=3');
    expect(adminPageHref('/admin/communications/delivery', { status: null })(1)).toBe(
      '/admin/communications/delivery',
    );
    expect(adminPageHref('/admin/communications/delivery', { status: null })(2)).toBe(
      '/admin/communications/delivery?page=2',
    );
  });
});
