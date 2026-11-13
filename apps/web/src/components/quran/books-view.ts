import { localizedPath } from '@minhaj/contracts';
import {
  QURAN_WORKS_PAGE,
  type QuranWorksShelf,
  type QuranWorksSort,
} from '@minhaj/contracts/library';
import {
  SURAH_TOTAL,
  canonicalPassageOrder,
  type QuranPassage,
} from '@minhaj/contracts/passage';

import { passageCitation } from './tafsir-layout';

/**
 * THE QURAN BOOKS HUB'S RULES (Quran Part 10) — pure, so the address a filter
 * form submits, the address a pagination or a "remove" link builds and the
 * query Library is asked are ONE definition, proved by unit test.
 *
 * THE ADDRESS IS THE STATE. Every view of the hub — a shelf, a Surah, a
 * language, a contributor, an order, a page — is a GET address that works
 * without script and can be shared; neutral values are omitted, so the
 * unfiltered hub has exactly one address (`/quran/books`), the canonical one.
 *
 * TOLERANT, NEVER TRUSTING. A malformed or repeated parameter is dropped
 * rather than answered with an error page; what this produces is parsed again
 * by Library's read service (`quranWorksQuerySchema`), the authoritative
 * boundary, and no parameter can widen what is public.
 */

export type Query = Record<string, string | string[] | undefined>;

export const BOOKS_PATH = '/quran/books';

/** The deepest page an address may name: Library's offset bound, in pages. */
export const BOOKS_MAX_PAGE = Math.floor(25_000 / QURAN_WORKS_PAGE) + 1;

export interface BooksQuery {
  readonly shelf: QuranWorksShelf;
  readonly surah: number | null;
  readonly language: string | null;
  readonly contributor: string | null;
  readonly sort: QuranWorksSort;
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
 * THE TOLERANT READERS every Explore hub's address shares (Books here, Videos
 * in `./videos-view`): one value of one parameter, a whole number in range,
 * an identifier, a content-language code — anything else is absent.
 */
export const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
/** Taxonomy's language-code shape (`libraryLanguageCodeSchema`). */
export const LANGUAGE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u;

export function single(query: Query, key: string, max: number): string | null {
  const raw = query[key];
  return typeof raw === 'string' && raw !== '' && raw.length <= max ? raw : null;
}

export function whole(text: string | null, min: number, max: number): number | null {
  if (text === null || !/^\d{1,5}$/u.test(text)) return null;
  const value = Number(text);
  return value >= min && value <= max ? value : null;
}

/** The hub's view from its address — every unknown or malformed value neutral. */
export function readBooksQuery(query: Query): BooksQuery {
  const shelfText = single(query, 'shelf', 16);
  const shelf: QuranWorksShelf =
    shelfText === 'explains' || shelfText === 'general' ? shelfText : 'all';
  const sortText = single(query, 'sort', 16);
  const sort: QuranWorksSort =
    sortText === 'newest' || sortText === 'quran' ? sortText : 'title';
  const language = single(query, 'language', 16);
  const contributor = single(query, 'contributor', 64);
  // A Surah narrows the books that explain one; on the general shelf it is
  // a contradiction, and the shelf the visitor chose wins.
  const surah =
    shelf === 'general' ? null : whole(single(query, 'surah', 3), 1, SURAH_TOTAL);
  return {
    shelf,
    surah,
    language: language !== null && LANGUAGE.test(language) ? language : null,
    contributor:
      contributor !== null && UUID.test(contributor) ? contributor.toLowerCase() : null,
    sort,
    page: whole(single(query, 'page', 5), 1, BOOKS_MAX_PAGE) ?? 1,
  };
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
  locale: string,
  query: BooksQuery,
  change: Partial<BooksQuery> = {},
): string {
  const next = { ...query, ...change };
  const page = change.page ?? (Object.keys(change).length === 0 ? query.page : 1);
  const surah = next.shelf === 'general' ? null : next.surah;
  const search = new URLSearchParams();
  if (next.shelf !== 'all') search.set('shelf', next.shelf);
  if (surah !== null) search.set('surah', String(surah));
  if (next.language !== null) search.set('language', next.language);
  if (next.contributor !== null) search.set('contributor', next.contributor);
  if (next.sort !== 'title') search.set('sort', next.sort);
  if (page > 1) search.set('page', String(page));
  const text = search.toString();
  return localizedPath(locale, `${BOOKS_PATH}${text === '' ? '' : `?${text}`}`);
}

/** The parameters a view of the hub is spelled with. */
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
 * old link may carry a malformed value or a different order. Each is answered
 * with ONE redirect to the view's canonical address (`booksHref`), built from
 * the parsed view — never from the typed text — or `null` when the request
 * already is that address. Parameters the hub does not read are left alone
 * unless a redirect happens anyway.
 */
export function booksCanonicalRedirect(locale: string, query: Query): string | null {
  return unlessCanonical(
    locale,
    BOOKS_PATH,
    query,
    VIEW_KEYS,
    booksHref(locale, readBooksQuery(query)),
  );
}

/**
 * The canonical address, or `null` when the request already spells it: the
 * hub's own parameters as the request carried them — in its own order, so
 * another order is caught — against the address built from the parsed view.
 */
export function unlessCanonical(
  locale: string,
  path: string,
  query: Query,
  keys: ReadonlySet<string>,
  canonical: string,
): string | null {
  const requested = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (!keys.has(key)) continue;
    if (typeof value === 'string') requested.append(key, value);
    else if (Array.isArray(value))
      for (const entry of value) requested.append(key, entry);
  }
  const text = requested.toString();
  const spelled = localizedPath(locale, `${path}${text === '' ? '' : `?${text}`}`);
  return spelled === canonical ? null : canonical;
}

/** What Library is asked for one view (the Topic resolved at Layer 4). */
export function booksReadQuery(
  query: BooksQuery,
  topic: string | null,
  titleLocale: string,
): Record<string, unknown> {
  return {
    topic,
    shelf: query.shelf,
    surah: query.surah,
    language: query.language,
    contributor: query.contributor,
    sort: query.sort,
    titleLocale,
    offset: (query.page - 1) * QURAN_WORKS_PAGE,
    limit: QURAN_WORKS_PAGE,
  };
}

/** How many pages of `size` a total fills; at least one. */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

/** "25–48" of a page of `size`, or null when the page holds nothing. */
export function pageRange(
  page: number,
  shown: number,
  size: number,
): { readonly from: number; readonly to: number } | null {
  if (shown === 0) return null;
  const from = (page - 1) * size + 1;
  return { from, to: from + shown - 1 };
}

export function booksPageCount(total: number): number {
  return pageCount(total, QURAN_WORKS_PAGE);
}

export function booksRange(
  page: number,
  shown: number,
): { readonly from: number; readonly to: number } | null {
  return pageRange(page, shown, QURAN_WORKS_PAGE);
}

/** How many Surah chips a card shows before saying how many more. */
export const SURAH_CHIPS = 3;

export interface SurahChip {
  readonly surah: number;
  /** Every passage the owner carries in this Surah, as citations, in order. */
  readonly citations: readonly string[];
}

/**
 * The Surahs an owner explains, in Quran order, each once with its citations
 * — the chips a card links to each Surah's tafsir by. At most `max`; `more`
 * counts the Surahs left out.
 */
export function surahChips(
  passages: readonly QuranPassage[],
  max = SURAH_CHIPS,
): { readonly chips: readonly SurahChip[]; readonly more: number } {
  const bySurah = new Map<number, string[]>();
  for (const passage of canonicalPassageOrder(passages)) {
    const list = bySurah.get(passage.surah) ?? [];
    list.push(passageCitation(passage));
    bySurah.set(passage.surah, list);
  }
  const all = [...bySurah.entries()].map(([surah, citations]) => ({ surah, citations }));
  return { chips: all.slice(0, max), more: Math.max(0, all.length - max) };
}
