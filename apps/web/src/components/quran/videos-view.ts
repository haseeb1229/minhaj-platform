import { localizedPath } from '@minhaj/contracts';
import {
  QURAN_VIDEOS_PAGE,
  type QuranVideoLength,
  type QuranVideosShelf,
  type QuranVideosSort,
} from '@minhaj/contracts/media';
import {
  SURAH_TOTAL,
  canonicalPassageOrder,
  type TimedQuranPassage,
} from '@minhaj/contracts/passage';

import {
  LANGUAGE,
  UUID,
  pageCount,
  pageRange,
  single,
  unlessCanonical,
  whole,
  type Query,
} from './books-view';

/**
 * THE QURAN VIDEOS HUB'S RULES (Quran Part 11) — pure, so the address a filter
 * form submits, the address a pagination or a "remove" link builds and the
 * query Media is asked are ONE definition, proved by unit test. The tolerant
 * readers and the one-address rule are the Books hub's (`./books-view`).
 *
 * THE ADDRESS IS THE STATE. Every view of the hub — a shelf, a Surah, a
 * language, a speaker, a Series, a length, an order, a page — is a GET address
 * that works without script and can be shared; neutral values are omitted, so
 * the unfiltered hub has exactly one address (`/quran/videos`), the canonical
 * one.
 *
 * TOLERANT, NEVER TRUSTING. A malformed or repeated parameter is dropped
 * rather than answered with an error page; what this produces is parsed again
 * by Media's read service (`quranVideosQuerySchema`), the authoritative
 * boundary, and no parameter can widen what is public.
 */

export const VIDEOS_PATH = '/quran/videos';

/** The deepest page an address may name: Media's offset bound, in pages. */
export const VIDEOS_MAX_PAGE = Math.floor(25_000 / QURAN_VIDEOS_PAGE) + 1;

export interface VideosQuery {
  readonly shelf: QuranVideosShelf;
  readonly surah: number | null;
  readonly language: string | null;
  readonly speaker: string | null;
  readonly series: string | null;
  readonly length: QuranVideoLength | null;
  readonly sort: QuranVideosSort;
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

function identifier(query: Query, key: string): string | null {
  const value = single(query, key, 64);
  return value !== null && UUID.test(value) ? value.toLowerCase() : null;
}

/** The hub's view from its address — every unknown or malformed value neutral. */
export function readVideosQuery(query: Query): VideosQuery {
  const shelfText = single(query, 'shelf', 16);
  const shelf: QuranVideosShelf =
    shelfText === 'explains' || shelfText === 'general' ? shelfText : 'all';
  const sortText = single(query, 'sort', 16);
  const sort: QuranVideosSort =
    sortText === 'quran' || sortText === 'title' ? sortText : 'newest';
  const lengthText = single(query, 'length', 16);
  const language = single(query, 'language', 16);
  // A Surah narrows the videos that explain one; on the general shelf it is
  // a contradiction, and the shelf the visitor chose wins.
  const surah =
    shelf === 'general' ? null : whole(single(query, 'surah', 3), 1, SURAH_TOTAL);
  return {
    shelf,
    surah,
    language: language !== null && LANGUAGE.test(language) ? language : null,
    speaker: identifier(query, 'speaker'),
    series: identifier(query, 'series'),
    length:
      lengthText === 'short' || lengthText === 'medium' || lengthText === 'long'
        ? lengthText
        : null,
    sort,
    page: whole(single(query, 'page', 5), 1, VIDEOS_MAX_PAGE) ?? 1,
  };
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
  locale: string,
  query: VideosQuery,
  change: Partial<VideosQuery> = {},
): string {
  const next = { ...query, ...change };
  const page = change.page ?? (Object.keys(change).length === 0 ? query.page : 1);
  const surah = next.shelf === 'general' ? null : next.surah;
  const search = new URLSearchParams();
  if (next.shelf !== 'all') search.set('shelf', next.shelf);
  if (surah !== null) search.set('surah', String(surah));
  if (next.language !== null) search.set('language', next.language);
  if (next.speaker !== null) search.set('speaker', next.speaker);
  if (next.series !== null) search.set('series', next.series);
  if (next.length !== null) search.set('length', next.length);
  if (next.sort !== 'newest') search.set('sort', next.sort);
  if (page > 1) search.set('page', String(page));
  const text = search.toString();
  return localizedPath(locale, `${VIDEOS_PATH}${text === '' ? '' : `?${text}`}`);
}

/** The parameters a view of the hub is spelled with. */
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
 * typed or old link may carry a malformed value or a different order. Each is
 * answered with ONE redirect to the view's canonical address (`videosHref`),
 * built from the parsed view — never from the typed text — or `null` when the
 * request already is that address. Parameters the hub does not read (such as
 * the related view's former `?offset=`) are left alone unless a redirect
 * happens anyway.
 */
export function videosCanonicalRedirect(locale: string, query: Query): string | null {
  return unlessCanonical(
    locale,
    VIDEOS_PATH,
    query,
    VIEW_KEYS,
    videosHref(locale, readVideosQuery(query)),
  );
}

/** What Media is asked for one view (the Topic resolved at Layer 4). */
export function videosReadQuery(
  query: VideosQuery,
  topic: string | null,
  titleLocale: string,
): Record<string, unknown> {
  return {
    topic,
    shelf: query.shelf,
    surah: query.surah,
    language: query.language,
    speaker: query.speaker,
    series: query.series,
    length: query.length,
    sort: query.sort,
    titleLocale,
    offset: (query.page - 1) * QURAN_VIDEOS_PAGE,
    limit: QURAN_VIDEOS_PAGE,
  };
}

/** How many pages a total fills; at least one. */
export function videosPageCount(total: number): number {
  return pageCount(total, QURAN_VIDEOS_PAGE);
}

/** "25–48" of a page, or null when the page holds nothing. */
export function videosRange(
  page: number,
  shown: number,
): { readonly from: number; readonly to: number } | null {
  return pageRange(page, shown, QURAN_VIDEOS_PAGE);
}

/**
 * WHERE TO OPEN A LECTURE: the first passage — in Quran order, within the
 * Surah the visitor chose when one is chosen — whose start the editor
 * recorded (and is past the opening second); `null` when there is none, and
 * the card offers only the video itself.
 */
export function passageStart(
  passages: readonly TimedQuranPassage[],
  surah: number | null,
): TimedQuranPassage | null {
  return (
    canonicalPassageOrder(
      passages.filter((passage) => surah === null || passage.surah === surah),
    ).find((passage) => passage.startSeconds !== null && passage.startSeconds > 0) ?? null
  );
}

/** Whole hours in a running time, rounded down — a figure never larger than the truth. */
export function wholeHours(seconds: number): number {
  return Math.floor(Math.max(0, seconds) / 3600);
}
