import { localizedPath } from '@minhaj/contracts';
import {
  LIBRARY_DOWNLOADS_PAGE,
  LIBRARY_SALE_POINT_PAGE,
  type LibraryBrowseKind,
} from '@minhaj/contracts/library';
import { CONTRIBUTION_ROLES, type ContributionRole } from '@minhaj/contracts/people';

import {
  hubHref,
  identifier,
  language,
  single,
  unlessCanonical,
  whole,
  type Query,
} from '@/components/topic-hub/address';
import { libraryBooksHref } from '@/components/topic-hub/books-view';
import { scholarlyListPath, scholarlyQueryPath } from './scholarly-presentation';

/**
 * LIBRARY PART 2 — THE BROWSE AND ACCESS PAGES' ADDRESS RULES, pure, so the
 * address a filter form submits, the address a letter, a chip or a page link
 * builds, and the view the page reads are ONE definition, proved by unit test.
 *
 * ONE ADDRESS PER VIEW, by the topic hubs' rules (`@/components/topic-hub/
 * address`): neutral values are omitted, so an unfiltered page has exactly one
 * address; a form's empty controls, another order of the same parameters, a
 * malformed or repeated value (dropped, Library's tolerant rule) and a former
 * `?offset=` are each one redirect to the canonical spelling, built from the
 * parsed view — never from the typed text. Parameters a page does not read are
 * left alone unless a redirect happens anyway. Every value is parsed again by
 * Library's read service, the authoritative boundary.
 */

/* ===========================================================================
 * Where a kind's filtered listing is
 * ========================================================================= */

/**
 * The listing of one Library kind narrowed by a Topic or a content language —
 * the books listing through `libraryBooksHref`, every other kind through its
 * own listing's filters. One function, so the Topic and language browses and
 * the resources directory cannot spell a listing two ways.
 */
export function kindHref(
  locale: string,
  kind: LibraryBrowseKind,
  filter: { readonly topic?: string; readonly language?: string } = {},
): string {
  // An identifier is spelled in lower case, as the listings' canonical
  // addresses spell it, so a link never costs a redirect.
  const topic = filter.topic?.toLowerCase();
  if (kind === 'work')
    return libraryBooksHref(locale, {
      ...(filter.language === undefined ? {} : { language: filter.language }),
      ...(topic === undefined ? {} : { library: { topic } }),
    });
  return scholarlyQueryPath(scholarlyListPath(locale, kind), {
    offset: 0,
    language: filter.language ?? null,
    topic: topic ?? null,
    from: null,
    to: null,
  });
}

/* ===========================================================================
 * The resources directory
 * ========================================================================= */

/** The `?type` values the route map names for `/library/resources`, and their listings. */
const RESOURCE_TYPES: Readonly<Record<string, LibraryBrowseKind | 'article'>> =
  Object.freeze({
    books: 'work',
    articles: 'article',
    research: 'research',
    'research-papers': 'research-paper',
    publications: 'publication',
    encyclopedias: 'encyclopedia',
    magazines: 'magazine',
  });

const RESOURCE_KEYS: ReadonlySet<string> = new Set([
  'type',
  'topic',
  'language',
  'contributor',
  'from',
  'to',
]);

/**
 * `/library/resources` IS THE DIRECTORY, with one address. ROUTE_MAP.md §3.6
 * gives it `?type, topic, language, contributor, from, to`; each such view is
 * one kind's own listing, so a request carrying them is ONE redirect there,
 * keeping the filters that listing takes (a contributor only for books; a
 * Magazine takes a Topic alone; Articles take none). Without a known type, any
 * of them is one redirect to the bare directory. `null` when the request is
 * already the directory.
 */
export function resourcesRedirect(locale: string, query: Query): string | null {
  if (!Object.keys(query).some((key) => RESOURCE_KEYS.has(key))) return null;
  const type = single(query, 'type', 32);
  const kind = type === null ? undefined : RESOURCE_TYPES[type];
  if (kind === undefined) return localizedPath(locale, '/library/resources');
  if (kind === 'article') return localizedPath(locale, '/library/articles');

  const topic = identifier(query, 'topic');
  const code = language(query);
  const from = whole(single(query, 'from', 8), 1, 9999);
  const to = whole(single(query, 'to', 8), 1, 9999);
  if (kind === 'work') {
    const contributor = identifier(query, 'contributor');
    return libraryBooksHref(locale, {
      ...(code === null ? {} : { language: code }),
      ...(contributor === null ? {} : { contributor }),
      library: { topic, from, to },
    });
  }
  const dated = kind !== 'magazine';
  return scholarlyQueryPath(scholarlyListPath(locale, kind), {
    offset: 0,
    language: dated ? code : null,
    topic,
    from: dated && (from === null || to === null || from <= to) ? from : null,
    to: dated && (from === null || to === null || from <= to) ? to : null,
  });
}

/**
 * `/library/topics` and `/library/languages` take no parameter: each is one
 * view. Their former `?offset=` pager (50 a page until Library Part 2) is one
 * redirect to the bare page, which now holds them all.
 */
export function bareRedirect(locale: string, path: string, query: Query): string | null {
  return unlessCanonical(
    locale,
    path,
    query,
    new Set(['offset']),
    localizedPath(locale, path),
  );
}

/* ===========================================================================
 * The contributor directory (`/library/authors`)
 * ========================================================================= */

export const AUTHORS_PATH = '/library/authors';
/** How many contributors one directory page shows. */
export const AUTHORS_PAGE = 48;
/** The longest name search the directory reads. */
const NAME_QUERY_MAX = 60;

export interface AuthorsView {
  /** One initial (upper case), or `#` for a name that starts with no letter. */
  readonly letter: string | null;
  readonly role: ContributionRole | null;
  /** A name search, its whitespace collapsed. */
  readonly q: string | null;
  /** 1-based. */
  readonly page: number;
}

export const DEFAULT_AUTHORS_VIEW: AuthorsView = Object.freeze({
  letter: null,
  role: null,
  q: null,
  page: 1,
});

const AUTHORS_KEYS: ReadonlySet<string> = new Set([
  'letter',
  'role',
  'q',
  'page',
  'offset',
]);

/** The deepest page any directory address may name. */
const MAX_PAGE = 1000;

/** The initial a name is indexed under: its first letter, upper case, else `#`. */
export function initialOf(name: string, locale: string): string {
  const first = [...name.trim().normalize('NFC')][0];
  if (first === undefined || !/\p{L}/u.test(first)) return '#';
  return first.toLocaleUpperCase(locale);
}

/** A letter parameter as one initial: a single letter (upper-cased) or `#`. */
function readLetter(query: Query, locale: string): string | null {
  const value = single(query, 'letter', 4);
  if (value === null) return null;
  const characters = [...value.normalize('NFC')];
  if (characters.length !== 1) return null;
  if (value === '#') return '#';
  return /^\p{L}$/u.test(value.normalize('NFC')) ? initialOf(value, locale) : null;
}

/** A name search, its whitespace collapsed; empty or over-long is absent. */
function readNameQuery(query: Query): string | null {
  const value = single(query, 'q', 200);
  if (value === null) return null;
  const collapsed = value.replaceAll(/\s+/gu, ' ').trim();
  return collapsed === '' || collapsed.length > NAME_QUERY_MAX ? null : collapsed;
}

export function readAuthorsView(query: Query, locale: string): AuthorsView {
  const role = single(query, 'role', 16);
  return {
    letter: readLetter(query, locale),
    role: CONTRIBUTION_ROLES.find((entry) => entry === role) ?? null,
    q: readNameQuery(query),
    page: whole(single(query, 'page', 5), 1, MAX_PAGE) ?? 1,
  };
}

export function authorsHref(
  locale: string,
  view: AuthorsView,
  change: Partial<AuthorsView> = {},
): string {
  const next = { ...view, ...change };
  const search = new URLSearchParams();
  if (next.letter !== null) search.set('letter', next.letter);
  if (next.role !== null) search.set('role', next.role);
  if (next.q !== null) search.set('q', next.q);
  if (next.page > 1) search.set('page', String(next.page));
  return hubHref(locale, AUTHORS_PATH, search);
}

/** The canonical address of the request's view, or `null` when it already is. */
export function authorsCanonicalRedirect(locale: string, query: Query): string | null {
  return unlessCanonical(
    locale,
    AUTHORS_PATH,
    query,
    AUTHORS_KEYS,
    authorsHref(locale, readAuthorsView(query, locale)),
  );
}

/**
 * A name as a search compares it: decomposed, every combining mark (an accent,
 * a vowel sign, a harakah) and the tatweel removed, lower case, whitespace
 * collapsed — so "Tahir" finds "Ṭāhir" and an unvowelled Arabic search finds a
 * vowelled name.
 */
export function foldName(text: string): string {
  return text
    .normalize('NFKD')
    .replaceAll(/[\p{M}ـ]/gu, '')
    .toLowerCase()
    .replaceAll(/\s+/gu, ' ')
    .trim();
}

/** Whether a name answers a search: every word of it appears in the name. */
export function nameMatches(name: string, q: string): boolean {
  const folded = foldName(name);
  return foldName(q)
    .split(' ')
    .every((word) => folded.includes(word));
}

/* ===========================================================================
 * Downloads (`/library/downloads`)
 * ========================================================================= */

export const DOWNLOADS_PATH = '/library/downloads';

export interface DownloadsView {
  readonly language: string | null;
  /** A Taxonomy Topic identifier. */
  readonly topic: string | null;
  readonly sort: 'title' | 'newest';
  readonly page: number;
}

export const DEFAULT_DOWNLOADS_VIEW: DownloadsView = Object.freeze({
  language: null,
  topic: null,
  sort: 'title',
  page: 1,
});

const DOWNLOADS_KEYS: ReadonlySet<string> = new Set([
  'language',
  'topic',
  'sort',
  'page',
  'offset',
]);

export const DOWNLOADS_MAX_PAGE = Math.floor(25_000 / LIBRARY_DOWNLOADS_PAGE) + 1;

export function readDownloadsView(query: Query): DownloadsView {
  return {
    language: language(query),
    topic: identifier(query, 'topic'),
    sort: single(query, 'sort', 8) === 'newest' ? 'newest' : 'title',
    page: whole(single(query, 'page', 5), 1, DOWNLOADS_MAX_PAGE) ?? 1,
  };
}

export function downloadsHref(
  locale: string,
  view: DownloadsView,
  change: Partial<DownloadsView> = {},
): string {
  const next = { ...view, ...change };
  const search = new URLSearchParams();
  if (next.language !== null) search.set('language', next.language);
  if (next.topic !== null) search.set('topic', next.topic);
  if (next.sort !== 'title') search.set('sort', next.sort);
  if (next.page > 1) search.set('page', String(next.page));
  return hubHref(locale, DOWNLOADS_PATH, search);
}

/**
 * The canonical address of the request's view, or `null`. The former
 * `?offset=` paged WORKS (25 a page until Library Part 2); the listing now
 * pages Editions, so no page of it corresponds and it is simply dropped.
 */
export function downloadsCanonicalRedirect(locale: string, query: Query): string | null {
  return unlessCanonical(
    locale,
    DOWNLOADS_PATH,
    query,
    DOWNLOADS_KEYS,
    downloadsHref(locale, readDownloadsView(query)),
  );
}

/** What a file is, as a reader names it: "PDF" for `application/pdf`. */
export function fileFormat(mediaType: string): string {
  if (mediaType === 'application/pdf') return 'PDF';
  if (mediaType === 'application/epub+zip') return 'EPUB';
  const subtype = mediaType.split('/')[1] ?? mediaType;
  return subtype.replace(/^x-/u, '').toUpperCase().slice(0, 12);
}

/** A file's size in the reader's locale: "2.4 MB", "830 kB", in decimal units. */
export function fileSize(bytes: number, locale: string): string {
  const [value, unit] =
    bytes >= 1_000_000
      ? [bytes / 1_000_000, 'megabyte']
      : bytes >= 1_000
        ? [bytes / 1_000, 'kilobyte']
        : [bytes, 'byte'];
  return new Intl.NumberFormat(locale, {
    style: 'unit',
    unit,
    unitDisplay: 'short',
    maximumFractionDigits: 1,
  }).format(value);
}

/* ===========================================================================
 * Sale points (`/library/sale-points`)
 * ========================================================================= */

export const SALE_POINTS_PATH = '/library/sale-points';
/** The longest place or name search the directory reads (the read's own bound). */
const PLACE_QUERY_MAX = 80;

export interface SalePointsView {
  /** A name or place search, its whitespace collapsed. */
  readonly q: string | null;
  readonly page: number;
}

export const DEFAULT_SALE_POINTS_VIEW: SalePointsView = Object.freeze({
  q: null,
  page: 1,
});

const SALE_POINTS_KEYS: ReadonlySet<string> = new Set(['q', 'page', 'offset']);

export const SALE_POINTS_MAX_PAGE = Math.floor(25_000 / LIBRARY_SALE_POINT_PAGE) + 1;

/** The page holding the sale point a former offset began with. */
function formerPage(query: Query): number | null {
  const offset = whole(single(query, 'offset', 8), 0, 25_000);
  return offset === null ? null : Math.floor(offset / LIBRARY_SALE_POINT_PAGE) + 1;
}

export function readSalePointsView(query: Query): SalePointsView {
  const raw = single(query, 'q', 200);
  const collapsed = raw === null ? '' : raw.replaceAll(/\s+/gu, ' ').trim();
  const page =
    whole(single(query, 'page', 5), 1, SALE_POINTS_MAX_PAGE) ?? formerPage(query) ?? 1;
  return {
    q: collapsed === '' || collapsed.length > PLACE_QUERY_MAX ? null : collapsed,
    page: Math.min(page, SALE_POINTS_MAX_PAGE),
  };
}

export function salePointsHref(
  locale: string,
  view: SalePointsView,
  change: Partial<SalePointsView> = {},
): string {
  const next = { ...view, ...change };
  const search = new URLSearchParams();
  if (next.q !== null) search.set('q', next.q);
  if (next.page > 1) search.set('page', String(next.page));
  return hubHref(locale, SALE_POINTS_PATH, search);
}

/**
 * The canonical address of the request's view, or `null`. A former `?offset=`
 * (25 a page, A–Z, until Library Part 2) is one redirect to the page holding
 * the sale point it began with.
 */
export function salePointsCanonicalRedirect(locale: string, query: Query): string | null {
  return unlessCanonical(
    locale,
    SALE_POINTS_PATH,
    query,
    SALE_POINTS_KEYS,
    salePointsHref(locale, readSalePointsView(query)),
  );
}
