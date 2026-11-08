/**
 * Where an offset listing stands, in page numbers.
 *
 * Every administrative listing pages by offset, but they know different
 * things about their extent: some count their rows (a `total`), others only
 * ask for one row more than they show (a `more` flag). A counted listing can
 * offer numbered pages; a has-more listing offers previous and next only.
 */
export type AdminPagerExtent = { readonly total: number } | { readonly more: boolean };

export interface AdminPagerState {
  /** The page the offset falls on, from 1. */
  readonly current: number;
  readonly previous: number | null;
  readonly next: number | null;
  /** The number of pages, or `null` when the listing does not know its total. */
  readonly pages: number | null;
}

export function adminPagerState(
  offset: number,
  pageSize: number,
  extent: AdminPagerExtent,
): AdminPagerState {
  const current = Math.floor(Math.max(0, offset) / pageSize) + 1;
  const previous = current > 1 ? current - 1 : null;
  if ('total' in extent) {
    // A page past the end (a stale link, rows deleted since) still counts as
    // a page, so the reader is shown where they are and can step back.
    const pages = Math.max(current, Math.ceil(Math.max(0, extent.total) / pageSize));
    return { current, previous, next: current < pages ? current + 1 : null, pages };
  }
  return { current, previous, next: extent.more ? current + 1 : null, pages: null };
}

/**
 * A page's address that keeps the listing's filters: every non-empty filter,
 * and `page` from the second page on.
 */
export function adminPageHref(
  base: string,
  filters: Readonly<Record<string, string | null>>,
): (page: number) => string {
  return (page) => {
    const search = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== null && value !== '') search.set(key, value);
    }
    if (page > 1) search.set('page', String(page));
    const encoded = search.toString();
    return encoded === '' ? base : `${base}?${encoded}`;
  };
}
