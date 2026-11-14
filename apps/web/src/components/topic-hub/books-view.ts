import {
  TOPIC_WORKS_PAGE,
  type TopicWorksShelf,
  type TopicWorksSort,
} from '@minhaj/contracts/library';
import { SURAH_TOTAL } from '@minhaj/contracts/passage';

import {
  hubHref,
  identifier,
  language,
  pageCount,
  pageRange,
  single,
  unlessCanonical,
  whole,
  type Query,
} from './address';

/**
 * A BOOKS HUB'S RULES (Quran Part 10; any subject's since Hadith Part 1) —
 * pure, so the address a filter form submits, the address a pagination or a
 * "remove" link builds and the query Library is asked are ONE definition,
 * proved by unit test.
 *
 * THE ADDRESS IS THE STATE. Every view of a hub — a shelf, a Surah, a
 * language, a contributor, an order, a page — is a GET address that works
 * without script and can be shared; neutral values are omitted, so the
 * unfiltered hub has exactly one address (its scope's `path`), the canonical
 * one.
 *
 * THE SCOPE says where the hub stands and whether it has the Quran passage
 * parts: the shelves, a Surah and the Quran order exist only on a hub with
 * them (the Quran's); elsewhere such a parameter is not read, never written,
 * and redirected away like any other unknown spelling.
 *
 * TOLERANT, NEVER TRUSTING. A malformed or repeated parameter is dropped
 * rather than answered with an error page; what this produces is parsed again
 * by Library's read service (`topicWorksQuerySchema`), the authoritative
 * boundary, and no parameter can widen what is public.
 */

export interface BooksScope {
  /** The hub's locale-free path: `/quran/books`, `/hadith/books`. */
  readonly path: string;
  /** The Quran passage parts: the shelves, a Surah and the Quran order. */
  readonly passages: boolean;
}

/** The deepest page an address may name: Library's offset bound, in pages. */
export const BOOKS_MAX_PAGE = Math.floor(25_000 / TOPIC_WORKS_PAGE) + 1;

export interface BooksQuery {
  readonly shelf: TopicWorksShelf;
  readonly surah: number | null;
  readonly language: string | null;
  readonly contributor: string | null;
  readonly sort: TopicWorksSort;
  /** 1-based. */
  readonly page: number;
}

export const DEFAULT_BOOKS_QUERY: BooksQuery = Object.freeze({
  shelf: 'all',
  surah: null,
  language: null,
  contributor: null,
  sort: 'title',
  page: 1,
});

/**
 * A view as its scope admits it: without the passage parts the shelf is
 * `all`, there is no Surah and no Quran order; and on the general shelf a
 * Surah — which narrows only the books that explain one — is a contradiction
 * the shelf wins.
 */
function admitted(scope: BooksScope, view: BooksQuery): BooksQuery {
  const shelf = scope.passages ? view.shelf : 'all';
  return {
    ...view,
    shelf,
    surah: scope.passages && shelf !== 'general' ? view.surah : null,
    sort: !scope.passages && view.sort === 'quran' ? 'title' : view.sort,
  };
}

/** The hub's view from its address — every unknown or malformed value neutral. */
export function readBooksQuery(scope: BooksScope, query: Query): BooksQuery {
  const shelfText = single(query, 'shelf', 16);
  const sortText = single(query, 'sort', 16);
  return admitted(scope, {
    shelf: shelfText === 'explains' || shelfText === 'general' ? shelfText : 'all',
    surah: whole(single(query, 'surah', 3), 1, SURAH_TOTAL),
    language: language(query),
    contributor: identifier(query, 'contributor'),
    sort: sortText === 'newest' || sortText === 'quran' ? sortText : 'title',
    page: whole(single(query, 'page', 5), 1, BOOKS_MAX_PAGE) ?? 1,
  });
}

/** Whether anything narrows the hub — a shelf, a Surah, a language or a contributor. */
export function booksFiltered(query: BooksQuery): boolean {
  return (
    query.shelf !== 'all' ||
    query.surah !== null ||
    query.language !== null ||
    query.contributor !== null
  );
}

/**
 * The address of a view. Changing anything but the page returns to the first
 * page — page 7 of another result set means nothing — and choosing the
 * general shelf drops a Surah.
 */
export function booksHref(
  scope: BooksScope,
  locale: string,
  query: BooksQuery,
  change: Partial<BooksQuery> = {},
): string {
  const next = admitted(scope, { ...query, ...change });
  const page = change.page ?? (Object.keys(change).length === 0 ? query.page : 1);
  const search = new URLSearchParams();
  if (next.shelf !== 'all') search.set('shelf', next.shelf);
  if (next.surah !== null) search.set('surah', String(next.surah));
  if (next.language !== null) search.set('language', next.language);
  if (next.contributor !== null) search.set('contributor', next.contributor);
  if (next.sort !== 'title') search.set('sort', next.sort);
  if (page > 1) search.set('page', String(page));
  return hubHref(locale, scope.path, search);
}

/** The parameters a view of a Books hub is spelled with. */
const VIEW_KEYS: ReadonlySet<string> = new Set([
  'shelf',
  'surah',
  'language',
  'contributor',
  'sort',
  'page',
]);

/**
 * ONE ADDRESS PER VIEW. A filter form submits every control, so choosing an
 * author arrives as `?surah=&language=&contributor=…&sort=title`; a typed or
 * old link may carry a malformed value, a part the scope does not have or a
 * different order. Each is answered with ONE redirect to the view's
 * canonical address (`booksHref`), built from the parsed view — never from
 * the typed text — or `null` when the request already is that address.
 */
export function booksCanonicalRedirect(
  scope: BooksScope,
  locale: string,
  query: Query,
): string | null {
  return unlessCanonical(
    locale,
    scope.path,
    query,
    VIEW_KEYS,
    booksHref(scope, locale, readBooksQuery(scope, query)),
  );
}

/** What Library is asked for one view (the Topic resolved at Layer 4). */
export function booksReadQuery(
  scope: BooksScope,
  query: BooksQuery,
  topic: string | null,
  titleLocale: string,
): Record<string, unknown> {
  return {
    topic,
    quranPassages: scope.passages,
    shelf: query.shelf,
    surah: query.surah,
    language: query.language,
    contributor: query.contributor,
    sort: query.sort,
    titleLocale,
    offset: (query.page - 1) * TOPIC_WORKS_PAGE,
    limit: TOPIC_WORKS_PAGE,
  };
}

export function booksPageCount(total: number): number {
  return pageCount(total, TOPIC_WORKS_PAGE);
}

export function booksRange(
  page: number,
  shown: number,
): { readonly from: number; readonly to: number } | null {
  return pageRange(page, shown, TOPIC_WORKS_PAGE);
}
