import {
  NEWS_EARLIEST_YEAR,
  NEWS_KINDS,
  NEWS_LIMITS,
  NEWS_LISTING_PAGE,
  NEWS_MAX_OFFSET,
  newsListPathOf,
  type NewsKind,
  type NewsLanguage,
  type NewsListingSort,
} from '@minhaj/contracts/editorial';

import {
  hubHref,
  identifier,
  single,
  unlessCanonical,
  whole,
  type Query,
} from '@/components/topic-hub/address';

/**
 * NEWS & EVENTS PART 1 — THE NEWS LISTINGS' AND THE ARCHIVE'S ADDRESS RULES,
 * pure, so the address a filter form submits, the address a chip, a tab, a
 * page or a link from another News page builds, and the query Editorial is
 * asked are ONE definition, proved by unit test
 * (`tests/editorial/news-view.test.ts`). The tolerant readers and the
 * one-address rule are the topic hubs' shared ones
 * (`@/components/topic-hub/address`), as Watch's and Listen's listings read
 * them.
 *
 * ONE LISTING, FOUR FAMILIES. `/news` (NewsArticles), `/news/press-releases`,
 * `/news/statements` and `/news/media-coverage` take the same parameters:
 * `?topic` (a Taxonomy identifier), `?year` and `?month` (of the record's
 * chronology, a month only with its year), `?language` (en, ur or ar),
 * `?outlet` (media coverage only), `?sort=oldest` and `?page`. Neutral values
 * are omitted, so each unfiltered listing has exactly one address.
 *
 * THE FORMER SPELLINGS ARE ONE REDIRECT EACH: R2's `?lang=` is `?language=`;
 * Phase 13's `?offset=` (20 a page, as now) is the page holding the record it
 * began with; `?sort=latest` is the default order. The archive's former
 * listing parameters (`?type`, `?lang`, `?month`, `?offset`) lead to the
 * family listing they described, or to the archive's year.
 *
 * TOLERANT, NEVER TRUSTING. A malformed or repeated parameter is dropped rather
 * than answered with an error page; what this produces is parsed again by
 * Editorial's read service (`newsListingQuerySchema`), the authoritative
 * boundary, and no parameter can widen what is public.
 */

/** The deepest page an address may name: Editorial's offset bound, in pages. */
export const NEWS_MAX_PAGE = Math.floor(NEWS_MAX_OFFSET / NEWS_LISTING_PAGE) + 1;

export const NEWS_ARCHIVE_PATH = '/news/archive';

const LANGUAGES: readonly NewsLanguage[] = ['en', 'ur', 'ar'];

export interface NewsView {
  /** A Taxonomy Topic identifier, in lower case. */
  readonly topic: string | null;
  readonly year: number | null;
  /** Only with a year. */
  readonly month: number | null;
  readonly language: NewsLanguage | null;
  /** Media coverage only: an outlet's name as its records spell it. */
  readonly outlet: string | null;
  readonly sort: NewsListingSort;
  /** 1-based. */
  readonly page: number;
}

export const DEFAULT_NEWS_VIEW: NewsView = Object.freeze({
  topic: null,
  year: null,
  month: null,
  language: null,
  outlet: null,
  sort: 'newest',
  page: 1,
});

function yearOf(query: Query): number | null {
  const text = single(query, 'year', 4);
  return text !== null && /^\d{4}$/u.test(text)
    ? whole(text, NEWS_EARLIEST_YEAR, 9998)
    : null;
}

function monthOf(query: Query): number | null {
  const text = single(query, 'month', 2);
  return text !== null && /^\d{1,2}$/u.test(text) ? whole(text, 1, 12) : null;
}

function languageOf(query: Query, key: 'language' | 'lang'): NewsLanguage | null {
  const value = single(query, key, 4);
  return LANGUAGES.find((code) => code === value) ?? null;
}

/**
 * An outlet parameter, trimmed as a record stores it (its inner spacing is the
 * record's own, so it is kept); empty or over-long is absent.
 */
function outletOf(query: Query): string | null {
  const value = single(query, 'outlet', NEWS_LIMITS.outlet * 2)?.trim() ?? null;
  return value === null || value === '' || value.length > NEWS_LIMITS.outlet
    ? null
    : value;
}

/**
 * The page a former `?offset=` named — the page holding the first record it
 * showed — or null when there is none or it is not a plain bounded number.
 */
function legacyPage(query: Query): number | null {
  const text = single(query, 'offset', 6);
  if (text === null || !/^\d{1,6}$/u.test(text)) return null;
  const offset = Number(text);
  return offset <= NEWS_MAX_OFFSET
    ? Math.min(Math.floor(offset / NEWS_LISTING_PAGE) + 1, NEWS_MAX_PAGE)
    : null;
}

/** A listing's view from its address — every unknown or malformed value neutral. */
export function readNewsView(kind: NewsKind, query: Query): NewsView {
  const year = yearOf(query);
  return {
    topic: identifier(query, 'topic'),
    year,
    month: year === null ? null : monthOf(query),
    language: languageOf(query, 'language') ?? languageOf(query, 'lang'),
    outlet: kind === 'media-coverage' ? outletOf(query) : null,
    sort: single(query, 'sort', 16) === 'oldest' ? 'oldest' : 'newest',
    page: whole(single(query, 'page', 5), 1, NEWS_MAX_PAGE) ?? legacyPage(query) ?? 1,
  };
}

/** Whether anything narrows the listing. An order is not a narrowing. */
export function newsFiltered(view: NewsView): boolean {
  return (
    view.topic !== null ||
    view.year !== null ||
    view.language !== null ||
    view.outlet !== null
  );
}

/** Whether the view is the family's own first page, unfiltered and in its default order. */
export function newsOpening(view: NewsView): boolean {
  return !newsFiltered(view) && view.sort === 'newest' && view.page === 1;
}

/**
 * The address of a view of one family. Changing anything but the page returns
 * to the first page — page 7 of another result set means nothing — and a month
 * goes with its year. Identifiers are written in lower case, as an address
 * reads them, so a link never costs a redirect.
 */
export function newsHref(
  locale: string,
  kind: NewsKind,
  view: NewsView,
  change: Partial<NewsView> = {},
): string {
  const next = { ...view, ...change };
  const page = change.page ?? (Object.keys(change).length === 0 ? view.page : 1);
  const search = new URLSearchParams();
  if (next.topic !== null) search.set('topic', next.topic.toLowerCase());
  if (next.year !== null) search.set('year', String(next.year));
  if (next.year !== null && next.month !== null) search.set('month', String(next.month));
  if (next.language !== null) search.set('language', next.language);
  if (kind === 'media-coverage' && next.outlet !== null)
    search.set('outlet', next.outlet);
  if (next.sort !== 'newest') search.set('sort', next.sort);
  if (page > 1) search.set('page', String(page));
  return hubHref(locale, newsListPathOf(kind), search);
}

/**
 * The address of one family's view from its unfiltered first page — what
 * every News page that links into a listing (a year, a month, a Topic, a
 * language, an outlet) builds, so no two spell one view differently.
 */
export function newsListingHref(
  locale: string,
  kind: NewsKind,
  change: Partial<Omit<NewsView, 'page'>> = {},
): string {
  return newsHref(locale, kind, { ...DEFAULT_NEWS_VIEW, ...change, page: 1 });
}

/**
 * The family tabs: another family's listing keeping this view's Topic, year,
 * month and language (an outlet is media coverage's own) and its order.
 */
export function newsKindHref(locale: string, kind: NewsKind, view: NewsView): string {
  return newsListingHref(locale, kind, {
    topic: view.topic,
    year: view.year,
    month: view.month,
    language: view.language,
    sort: view.sort,
  });
}

/** The parameters a listing is spelled with, and the former ones it answers. */
function listingKeys(kind: NewsKind): ReadonlySet<string> {
  return new Set([
    'topic',
    'year',
    'month',
    'language',
    'lang',
    ...(kind === 'media-coverage' ? ['outlet'] : []),
    'sort',
    'page',
    'offset',
  ]);
}

/**
 * ONE ADDRESS PER VIEW. A filter form submits every control, so choosing a
 * year arrives as `?topic=&year=2024&month=&language=&sort=newest`; a typed or
 * old link may carry a malformed value, `?lang=`, `?offset=`, `?sort=latest`
 * or another order of the same parameters. Each is answered with ONE redirect
 * to the view's canonical address, built from the parsed view — never from
 * the typed text — or `null` when the request already is that address.
 */
export function newsCanonicalRedirect(
  locale: string,
  kind: NewsKind,
  query: Query,
): string | null {
  return unlessCanonical(
    locale,
    newsListPathOf(kind),
    query,
    listingKeys(kind),
    newsHref(locale, kind, readNewsView(kind, query)),
  );
}

/** What Editorial is asked for one view; the reader's language leads the default order. */
export function newsReadQuery(
  kind: NewsKind,
  view: NewsView,
  locale: NewsLanguage,
): Record<string, unknown> {
  return {
    kind,
    topic: view.topic,
    year: view.year,
    month: view.month,
    language: view.language,
    outlet: view.outlet,
    prefer: view.language === null && view.sort === 'newest' ? locale : null,
    sort: view.sort,
    offset: (view.page - 1) * NEWS_LISTING_PAGE,
    limit: NEWS_LISTING_PAGE,
  };
}

/* ===========================================================================
 * /news/archive
 * ========================================================================= */

/** The archive's one view: every year, or the months of one. */
export interface NewsArchiveView {
  readonly year: number | null;
}

export function readNewsArchiveView(query: Query): NewsArchiveView {
  return { year: yearOf(query) };
}

export function newsArchiveHref(locale: string, year: number | null = null): string {
  const search = new URLSearchParams();
  if (year !== null) search.set('year', String(year));
  return hubHref(locale, NEWS_ARCHIVE_PATH, search);
}

const ARCHIVE_KEYS: ReadonlySet<string> = new Set([
  'year',
  'month',
  'type',
  'lang',
  'offset',
]);

/**
 * ONE ADDRESS PER ARCHIVE VIEW. Until this part the archive listed records
 * itself, narrowed by `?type`, `?lang`, `?year`, `?month` and `?offset`; it is
 * now the year and month index of every News family, and each of those views
 * lives in the family listings. So a former `?type=` is ONE redirect to that
 * family's listing for the same year, month and language; without one, the
 * archive's year (or every year) — and any other spelling is one redirect to
 * the canonical one.
 */
export function newsArchiveCanonicalRedirect(
  locale: string,
  query: Query,
): string | null {
  const type = single(query, 'type', 16);
  const kind = NEWS_KINDS.find((entry) => entry === type);
  const year = yearOf(query);
  if (kind !== undefined)
    return newsListingHref(locale, kind, {
      year,
      month: year === null ? null : monthOf(query),
      language: languageOf(query, 'lang'),
    });
  return unlessCanonical(
    locale,
    NEWS_ARCHIVE_PATH,
    query,
    ARCHIVE_KEYS,
    newsArchiveHref(locale, year),
  );
}
