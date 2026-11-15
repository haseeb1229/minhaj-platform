import {
  hubHref,
  pageCount,
  pageRange,
  single,
  unlessCanonical,
  whole,
  type Query,
} from '@/components/topic-hub/address';

/**
 * LIBRARY PART 3 — THE ARTICLES LISTING'S ADDRESS RULES, pure and proved by
 * unit test. `/library/articles` is Editorial's ONE public listing of its
 * Articles, at the Library's address (the `articles` menu link leads here):
 * there is no second articles listing to duplicate. It takes `?page` (25
 * Articles a page, newest by chronology, Editorial's own order); the former
 * `?offset=` is one redirect to the page holding the Article it began with,
 * and any other spelling of a page is one redirect to the canonical one.
 */

export const ARTICLES_PATH = '/library/articles';
/** One page of Editorial's public articles read (`articles(offset)`). */
export const ARTICLES_PAGE = 25;
/** The deepest page an address may name (a five-digit page, inside Editorial's offset bound). */
export const ARTICLES_MAX_PAGE = 99_999;

const KEYS: ReadonlySet<string> = new Set(['page', 'offset']);

/** The page an address names: 1-based, every malformed value the first. */
export function readArticlesPage(query: Query): number {
  const page = whole(single(query, 'page', 5), 1, ARTICLES_MAX_PAGE);
  if (page !== null) return page;
  const offset = whole(single(query, 'offset', 5), 0, 99_999);
  return offset === null
    ? 1
    : Math.min(ARTICLES_MAX_PAGE, Math.floor(offset / ARTICLES_PAGE) + 1);
}

export function articlesHref(locale: string, page: number): string {
  const search = new URLSearchParams();
  if (page > 1) search.set('page', String(page));
  return hubHref(locale, ARTICLES_PATH, search);
}

export function articlesCanonicalRedirect(locale: string, query: Query): string | null {
  return unlessCanonical(
    locale,
    ARTICLES_PATH,
    query,
    KEYS,
    articlesHref(locale, readArticlesPage(query)),
  );
}

export function articlesOffset(page: number): number {
  return (page - 1) * ARTICLES_PAGE;
}

export function articlesPageCount(total: number): number {
  return pageCount(total, ARTICLES_PAGE);
}

export function articlesRange(
  page: number,
  shown: number,
): { readonly from: number; readonly to: number } | null {
  return pageRange(page, shown, ARTICLES_PAGE);
}
