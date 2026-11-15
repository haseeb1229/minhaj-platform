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
 *
 * LIBRARY PART 1 — THE WHOLE LIBRARY IS THE SAME LISTING WITHOUT A TOPIC
 * SCOPE (`/library/books`, `LIBRARY_BOOKS`), as Learn Part 1 made the course
 * catalogue. Its view adds the Library's own filters (`library`): a Topic, a
 * publication-year range, readable online and downloadable. Its address
 * keeps every parameter it has always taken (ROUTE_MAP.md §3.6) — `?topic`
 * and `?contributor` identifiers, `?language`, `?from`, `?to`, `?downloads=1`
 * and `?sort` — and adds `?readable=1` and `?page`. Library's tolerant rule
 * stands: a malformed filter is dropped (one redirect to the view without
 * it), an inverted year range is read in order, and a former `?offset=` (25
 * Works a page until Library Part 1) is one redirect to the page holding the
 * Work it began with.
 */

export interface BooksScope {
  /** The listing's locale-free path: `/quran/books`, `/hadith/books`, `/library/books`. */
  readonly path: string;
  /** The Quran passage parts: the shelves, a Surah and the Quran order. */
  readonly passages: boolean;
  /** The whole Library (Library Part 1): the Topic a filter, and the Library's own filters. */
  readonly library?: true;
}

/** The Library's own listing of every book (ROUTE_MAP.md §3.6). */
export const LIBRARY_BOOKS: BooksScope = Object.freeze({
  path: '/library/books',
  passages: false,
  library: true,
});

/** The deepest page an address may name: Library's offset bound, in pages. */
export const BOOKS_MAX_PAGE = Math.floor(25_000 / TOPIC_WORKS_PAGE) + 1;

/** The whole Library's own filters — absent from a subject's hub. */
export interface LibraryBooksFilters {
  /** A Taxonomy Topic identifier. */
  readonly topic: string | null;
  /** The publication-year range, inclusive; `from` never after `to`. */
  readonly from: number | null;
  readonly to: number | null;
  /** An Edition may be read online. */
  readonly readable: boolean;
  /** An Edition may be downloaded. */
  readonly downloadable: boolean;
}

export const NO_LIBRARY_FILTERS: LibraryBooksFilters = Object.freeze({
  topic: null,
  from: null,
  to: null,
  readable: false,
  downloadable: false,
});

export interface BooksQuery {
  readonly shelf: TopicWorksShelf;
  readonly surah: number | null;
  readonly language: string | null;
  readonly contributor: string | null;
  readonly sort: TopicWorksSort;
  /** 1-based. */
  readonly page: number;
  /** The whole Library's own filters; never present on a subject's hub. */
  readonly library?: LibraryBooksFilters;
}

export const DEFAULT_BOOKS_QUERY: BooksQuery = Object.freeze({
  shelf: 'all',
  surah: null,
  language: null,
  contributor: null,
  sort: 'title',
  page: 1,
});

/** The whole Library's unfiltered first page. */
export const DEFAULT_LIBRARY_BOOKS_QUERY: BooksQuery = Object.freeze({
  ...DEFAULT_BOOKS_QUERY,
  library: NO_LIBRARY_FILTERS,
});

/** A year range in order: an inverted one is read the right way round. */
function ordered(filters: LibraryBooksFilters): LibraryBooksFilters {
  return filters.from !== null && filters.to !== null && filters.from > filters.to
    ? { ...filters, from: filters.to, to: filters.from }
    : filters;
}

/**
 * A view as its scope admits it: without the passage parts the shelf is
 * `all`, there is no Surah and no Quran order; and on the general shelf a
 * Surah — which narrows only the books that explain one — is a contradiction
 * the shelf wins. Only the whole Library has its own filters.
 */
function admitted(scope: BooksScope, view: BooksQuery): BooksQuery {
  const shelf = scope.passages ? view.shelf : 'all';
  const base = {
    shelf,
    surah: scope.passages && shelf !== 'general' ? view.surah : null,
    language: view.language,
    contributor: view.contributor,
    sort: !scope.passages && view.sort === 'quran' ? 'title' : view.sort,
    page: view.page,
  } satisfies BooksQuery;
  return scope.library === true
    ? { ...base, library: ordered(view.library ?? NO_LIBRARY_FILTERS) }
    : base;
}

/** The deepest former `?offset=` an address may carry (Library's offset bound). */
const LEGACY_MAX_OFFSET = 25_000;

/**
 * The page a former `?offset=` named — the page holding the first Work it
 * showed — or null when there is none or it is not a plain bounded number.
 */
function legacyPage(query: Query): number | null {
  const text = single(query, 'offset', 6);
  if (text === null || !/^\d{1,6}$/u.test(text)) return null;
  const offset = Number(text);
  return offset <= LEGACY_MAX_OFFSET
    ? Math.min(Math.floor(offset / TOPIC_WORKS_PAGE) + 1, BOOKS_MAX_PAGE)
    : null;
}

/** The whole Library's own filters from its address. */
function readLibraryFilters(query: Query): LibraryBooksFilters {
  const year = (key: string) => whole(single(query, key, 4), 1, 9999);
  return {
    topic: identifier(query, 'topic'),
    from: year('from'),
    to: year('to'),
    readable: single(query, 'readable', 1) === '1',
    downloadable: single(query, 'downloads', 1) === '1',
  };
}

/** The hub's view from its address — every unknown or malformed value neutral. */
export function readBooksQuery(scope: BooksScope, query: Query): BooksQuery {
  const shelfText = single(query, 'shelf', 16);
  const sortText = single(query, 'sort', 16);
  const page = whole(single(query, 'page', 5), 1, BOOKS_MAX_PAGE);
  return admitted(scope, {
    shelf: shelfText === 'explains' || shelfText === 'general' ? shelfText : 'all',
    surah: whole(single(query, 'surah', 3), 1, SURAH_TOTAL),
    language: language(query),
    contributor: identifier(query, 'contributor'),
    sort: sortText === 'newest' || sortText === 'quran' ? sortText : 'title',
    page: page ?? (scope.library === true ? legacyPage(query) : null) ?? 1,
    ...(scope.library === true ? { library: readLibraryFilters(query) } : {}),
  });
}

/** Whether the whole Library's own filters narrow anything. */
function libraryFiltered(filters: LibraryBooksFilters | undefined): boolean {
  return (
    filters !== undefined &&
    (filters.topic !== null ||
      filters.from !== null ||
      filters.to !== null ||
      filters.readable ||
      filters.downloadable)
  );
}

/**
 * Whether anything narrows the hub — a shelf, a Surah, a language or a
 * contributor, and in the whole Library a Topic, a year or an availability.
 */
export function booksFiltered(query: BooksQuery): boolean {
  return (
    query.shelf !== 'all' ||
    query.surah !== null ||
    query.language !== null ||
    query.contributor !== null ||
    libraryFiltered(query.library)
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
  const library = next.library;
  if (next.shelf !== 'all') search.set('shelf', next.shelf);
  if (next.surah !== null) search.set('surah', String(next.surah));
  if (library !== undefined && library.topic !== null) search.set('topic', library.topic);
  if (next.language !== null) search.set('language', next.language);
  if (next.contributor !== null) search.set('contributor', next.contributor);
  if (library !== undefined) {
    if (library.from !== null) search.set('from', String(library.from));
    if (library.to !== null) search.set('to', String(library.to));
    if (library.readable) search.set('readable', '1');
    if (library.downloadable) search.set('downloads', '1');
  }
  if (next.sort !== 'title') search.set('sort', next.sort);
  if (page > 1) search.set('page', String(page));
  return hubHref(locale, scope.path, search);
}

/**
 * The address of one view of the whole Library, from its unfiltered first
 * page — what every Library page that links into the listing (a Topic chip, a
 * language, a contributor, a related shelf) builds, so no two spell one view
 * differently.
 */
export function libraryBooksHref(
  locale: string,
  change: {
    readonly language?: string;
    readonly contributor?: string;
    readonly sort?: TopicWorksSort;
    readonly library?: Partial<LibraryBooksFilters>;
  } = {},
): string {
  return booksHref(LIBRARY_BOOKS, locale, {
    ...DEFAULT_LIBRARY_BOOKS_QUERY,
    ...(change.language === undefined ? {} : { language: change.language }),
    ...(change.contributor === undefined ? {} : { contributor: change.contributor }),
    ...(change.sort === undefined ? {} : { sort: change.sort }),
    library: { ...NO_LIBRARY_FILTERS, ...change.library },
  });
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

/** …and of the whole Library, which also reads its own filters and its former offset. */
const LIBRARY_KEYS: ReadonlySet<string> = new Set([
  ...VIEW_KEYS,
  'topic',
  'from',
  'to',
  'readable',
  'downloads',
  'offset',
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
    scope.library === true ? LIBRARY_KEYS : VIEW_KEYS,
    booksHref(scope, locale, readBooksQuery(scope, query)),
  );
}

/**
 * What Library is asked for one view: on a hub its Topic (resolved at Layer
 * 4); in the whole Library the view's own Topic filter, if any, and its own
 * filters, under `scope: 'library'`.
 */
export function booksReadQuery(
  scope: BooksScope,
  query: BooksQuery,
  topic: string | null,
  titleLocale: string,
): Record<string, unknown> {
  const read = {
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
  if (scope.library !== true) return read;
  const library = query.library ?? NO_LIBRARY_FILTERS;
  return {
    ...read,
    scope: 'library',
    topic: library.topic,
    from: library.from,
    to: library.to,
    readable: library.readable,
    downloadable: library.downloadable,
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
