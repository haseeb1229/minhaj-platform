import {
  TOPIC_VIDEOS_PAGE,
  type TopicVideoLength,
  type TopicVideosShelf,
  type TopicVideosSort,
} from '@minhaj/contracts/media';
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
 * A VIDEOS HUB'S RULES (Quran Part 11; any subject's since Hadith Part 1) —
 * pure, so the address a filter form submits, the address a pagination or a
 * "remove" link builds and the query Media is asked are ONE definition,
 * proved by unit test. The tolerant readers and the one-address rule are the
 * hubs' shared ones (`./address`).
 *
 * THE ADDRESS IS THE STATE. Every view of a hub — a shelf, a Surah, a
 * language, a speaker, a Series, a length, an order, a page — is a GET
 * address that works without script and can be shared; neutral values are
 * omitted, so the unfiltered hub has exactly one address (its scope's
 * `path`), the canonical one. The shelves, a Surah and the Quran order exist
 * only on a scope with the Quran passage parts.
 *
 * TOLERANT, NEVER TRUSTING. A malformed or repeated parameter is dropped
 * rather than answered with an error page; what this produces is parsed again
 * by Media's read service (`topicVideosQuerySchema`), the authoritative
 * boundary, and no parameter can widen what is public.
 */

export interface VideosScope {
  /** The hub's locale-free path: `/quran/videos`, `/hadith/videos`. */
  readonly path: string;
  /** The Quran passage parts: the shelves, a Surah and the Quran order. */
  readonly passages: boolean;
}

/** The deepest page an address may name: Media's offset bound, in pages. */
export const VIDEOS_MAX_PAGE = Math.floor(25_000 / TOPIC_VIDEOS_PAGE) + 1;

export interface VideosQuery {
  readonly shelf: TopicVideosShelf;
  readonly surah: number | null;
  readonly language: string | null;
  readonly speaker: string | null;
  readonly series: string | null;
  readonly length: TopicVideoLength | null;
  readonly sort: TopicVideosSort;
  /** 1-based. */
  readonly page: number;
}

export const DEFAULT_VIDEOS_QUERY: VideosQuery = Object.freeze({
  shelf: 'all',
  surah: null,
  language: null,
  speaker: null,
  series: null,
  length: null,
  sort: 'newest',
  page: 1,
});

/**
 * A view as its scope admits it: without the passage parts the shelf is
 * `all`, there is no Surah and no Quran order; and on the general shelf a
 * Surah — which narrows only the videos that explain one — is a
 * contradiction the shelf wins.
 */
function admitted(scope: VideosScope, view: VideosQuery): VideosQuery {
  const shelf = scope.passages ? view.shelf : 'all';
  return {
    ...view,
    shelf,
    surah: scope.passages && shelf !== 'general' ? view.surah : null,
    sort: !scope.passages && view.sort === 'quran' ? 'newest' : view.sort,
  };
}

/** The hub's view from its address — every unknown or malformed value neutral. */
export function readVideosQuery(scope: VideosScope, query: Query): VideosQuery {
  const shelfText = single(query, 'shelf', 16);
  const sortText = single(query, 'sort', 16);
  const lengthText = single(query, 'length', 16);
  return admitted(scope, {
    shelf: shelfText === 'explains' || shelfText === 'general' ? shelfText : 'all',
    surah: whole(single(query, 'surah', 3), 1, SURAH_TOTAL),
    language: language(query),
    speaker: identifier(query, 'speaker'),
    series: identifier(query, 'series'),
    length:
      lengthText === 'short' || lengthText === 'medium' || lengthText === 'long'
        ? lengthText
        : null,
    sort: sortText === 'quran' || sortText === 'title' ? sortText : 'newest',
    page: whole(single(query, 'page', 5), 1, VIDEOS_MAX_PAGE) ?? 1,
  });
}

/** Whether anything narrows the hub — a shelf, a Surah, a language, a speaker, a Series or a length. */
export function videosFiltered(query: VideosQuery): boolean {
  return (
    query.shelf !== 'all' ||
    query.surah !== null ||
    query.language !== null ||
    query.speaker !== null ||
    query.series !== null ||
    query.length !== null
  );
}

/**
 * The address of a view. Changing anything but the page returns to the first
 * page — page 7 of another result set means nothing — and choosing the
 * general shelf drops a Surah.
 */
export function videosHref(
  scope: VideosScope,
  locale: string,
  query: VideosQuery,
  change: Partial<VideosQuery> = {},
): string {
  const next = admitted(scope, { ...query, ...change });
  const page = change.page ?? (Object.keys(change).length === 0 ? query.page : 1);
  const search = new URLSearchParams();
  if (next.shelf !== 'all') search.set('shelf', next.shelf);
  if (next.surah !== null) search.set('surah', String(next.surah));
  if (next.language !== null) search.set('language', next.language);
  if (next.speaker !== null) search.set('speaker', next.speaker);
  if (next.series !== null) search.set('series', next.series);
  if (next.length !== null) search.set('length', next.length);
  if (next.sort !== 'newest') search.set('sort', next.sort);
  if (page > 1) search.set('page', String(page));
  return hubHref(locale, scope.path, search);
}

/** The parameters a view of a Videos hub is spelled with. */
const VIEW_KEYS: ReadonlySet<string> = new Set([
  'shelf',
  'surah',
  'language',
  'speaker',
  'series',
  'length',
  'sort',
  'page',
]);

/**
 * ONE ADDRESS PER VIEW. A filter form submits every control, so choosing a
 * speaker arrives as `?surah=&language=&speaker=…&length=&sort=newest`; a
 * typed or old link may carry a malformed value, a part the scope does not
 * have or a different order. Each is answered with ONE redirect to the view's
 * canonical address (`videosHref`), built from the parsed view — never from
 * the typed text — or `null` when the request already is that address.
 * Parameters the hub does not read (such as the former related view's
 * `?offset=`) are left alone unless a redirect happens anyway.
 */
export function videosCanonicalRedirect(
  scope: VideosScope,
  locale: string,
  query: Query,
): string | null {
  return unlessCanonical(
    locale,
    scope.path,
    query,
    VIEW_KEYS,
    videosHref(scope, locale, readVideosQuery(scope, query)),
  );
}

/** What Media is asked for one view (the Topic resolved at Layer 4). */
export function videosReadQuery(
  scope: VideosScope,
  query: VideosQuery,
  topic: string | null,
  titleLocale: string,
): Record<string, unknown> {
  return {
    topic,
    quranPassages: scope.passages,
    shelf: query.shelf,
    surah: query.surah,
    language: query.language,
    speaker: query.speaker,
    series: query.series,
    length: query.length,
    sort: query.sort,
    titleLocale,
    offset: (query.page - 1) * TOPIC_VIDEOS_PAGE,
    limit: TOPIC_VIDEOS_PAGE,
  };
}

/** How many pages a total fills; at least one. */
export function videosPageCount(total: number): number {
  return pageCount(total, TOPIC_VIDEOS_PAGE);
}

/** "25–48" of a page, or null when the page holds nothing. */
export function videosRange(
  page: number,
  shown: number,
): { readonly from: number; readonly to: number } | null {
  return pageRange(page, shown, TOPIC_VIDEOS_PAGE);
}

/** Whole hours in a running time, rounded down — a figure never larger than the truth. */
export function wholeHours(seconds: number): number {
  return Math.floor(Math.max(0, seconds) / 3600);
}
