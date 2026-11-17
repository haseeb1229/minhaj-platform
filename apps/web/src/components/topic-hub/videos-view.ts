import {
  TOPIC_VIDEOS_PAGE,
  VIDEO_FORMATS,
  type TopicVideoLength,
  type TopicVideosShelf,
  type TopicVideosSort,
  type VideoFormat,
} from '@minhaj/contracts/media';
import { SURAH_TOTAL } from '@minhaj/contracts/passage';

import { viewOfFormat } from '@/components/media/presentation';

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
 *
 * WATCH PART 1 — THE WHOLE OF MEDIA IS THE SAME LISTING WITHOUT A TOPIC SCOPE
 * (`/watch/videos`, `WATCH_VIDEOS`), as Library Part 1 made the Books
 * listing. Its view adds Watch's own filters (`media`): a Topic, and a
 * curated format — which is not a parameter but THE PATH: each of the five
 * curated views (`/watch/lectures` …) is this listing standing on its format
 * (`watchVideosScope`), so `/watch/videos?format=lecture` is one redirect to
 * `/watch/lectures`, and a format view's tabs and links keep every other
 * filter. Its address keeps every parameter it has always taken (ROUTE_MAP.md
 * §3.7) — `?topic`, `?speaker` and `?series` identifiers and `?language` —
 * and adds `?length`, `?sort` and `?page`; a former `?offset=` (24 a page,
 * as now) is one redirect to the page holding the Video it began with.
 */

export interface VideosScope {
  /**
   * The listing's locale-free path: `/quran/videos`, `/hadith/videos`,
   * `/watch/videos` or a curated Watch view's.
   */
  readonly path: string;
  /** The Quran passage parts: the shelves, a Surah and the Quran order. */
  readonly passages: boolean;
  /** The whole of Media (Watch Part 1), standing on the route's own format. */
  readonly media?: { readonly format: VideoFormat | null };
}

/** The locale-free path of the whole of Media's listing, on a format or none. */
function watchVideosPathOf(format: VideoFormat | null): string {
  return format === null ? '/watch/videos' : `/watch/${viewOfFormat(format)}`;
}

/** The whole of Media's listing standing on one curated format, or on none. */
export function watchVideosScope(format: VideoFormat | null): VideosScope {
  return Object.freeze({
    path: watchVideosPathOf(format),
    passages: false,
    media: Object.freeze({ format }),
  });
}

/** Watch's own listing of every published Video (ROUTE_MAP.md §3.7). */
export const WATCH_VIDEOS: VideosScope = watchVideosScope(null);

/** The deepest page an address may name: Media's offset bound, in pages. */
export const VIDEOS_MAX_PAGE = Math.floor(25_000 / TOPIC_VIDEOS_PAGE) + 1;

/** The whole of Media's own filters — absent from a subject's hub. */
export interface MediaVideosFilters {
  /** A Taxonomy Topic identifier. */
  readonly topic: string | null;
  /** The curated format the view stands on — its path, never a parameter. */
  readonly format: VideoFormat | null;
}

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
  /** The whole of Media's own filters; never present on a subject's hub. */
  readonly media?: MediaVideosFilters;
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
 * contradiction the shelf wins. Only the whole of Media has its own filters,
 * and with none named it stands on the route's format.
 */
function admitted(scope: VideosScope, view: VideosQuery): VideosQuery {
  const shelf = scope.passages ? view.shelf : 'all';
  const { media: own, ...rest } = view;
  const base = {
    ...rest,
    shelf,
    surah: scope.passages && shelf !== 'general' ? view.surah : null,
    sort: !scope.passages && view.sort === 'quran' ? 'newest' : view.sort,
  } satisfies VideosQuery;
  return scope.media === undefined
    ? base
    : { ...base, media: own ?? { topic: null, format: scope.media.format } };
}

/** The deepest former `?offset=` an address may carry (Media's offset bound). */
const LEGACY_MAX_OFFSET = 25_000;

/**
 * The page a former `?offset=` named — the page holding the first Video it
 * showed — or null when there is none or it is not a plain bounded number.
 */
function legacyPage(query: Query): number | null {
  const text = single(query, 'offset', 6);
  if (text === null || !/^\d{1,6}$/u.test(text)) return null;
  const offset = Number(text);
  return offset <= LEGACY_MAX_OFFSET
    ? Math.min(Math.floor(offset / TOPIC_VIDEOS_PAGE) + 1, VIDEOS_MAX_PAGE)
    : null;
}

/** A curated format named by a parameter, or null. */
function formatOf(query: Query): VideoFormat | null {
  const text = single(query, 'format', 16);
  return (VIDEO_FORMATS as readonly string[]).includes(text ?? '')
    ? (text as VideoFormat)
    : null;
}

/** The hub's view from its address — every unknown or malformed value neutral. */
export function readVideosQuery(scope: VideosScope, query: Query): VideosQuery {
  const shelfText = single(query, 'shelf', 16);
  const sortText = single(query, 'sort', 16);
  const lengthText = single(query, 'length', 16);
  const page = whole(single(query, 'page', 5), 1, VIDEOS_MAX_PAGE);
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
    page: page ?? (scope.media === undefined ? null : legacyPage(query)) ?? 1,
    ...(scope.media === undefined
      ? {}
      : {
          media: {
            topic: identifier(query, 'topic'),
            format: formatOf(query) ?? scope.media.format,
          },
        }),
  });
}

/**
 * Whether anything narrows the hub — a shelf, a Surah, a language, a speaker,
 * a Series or a length, and in the whole of Media a Topic. A curated format is
 * the view itself, never a narrowing of it.
 */
export function videosFiltered(query: VideosQuery): boolean {
  return (
    query.shelf !== 'all' ||
    query.surah !== null ||
    query.language !== null ||
    query.speaker !== null ||
    query.series !== null ||
    query.length !== null ||
    (query.media !== undefined && query.media.topic !== null)
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
  const own = next.media;
  if (next.shelf !== 'all') search.set('shelf', next.shelf);
  if (next.surah !== null) search.set('surah', String(next.surah));
  if (own !== undefined && own.topic !== null) search.set('topic', own.topic);
  if (next.language !== null) search.set('language', next.language);
  if (next.speaker !== null) search.set('speaker', next.speaker);
  if (next.series !== null) search.set('series', next.series);
  if (next.length !== null) search.set('length', next.length);
  if (next.sort !== 'newest') search.set('sort', next.sort);
  if (page > 1) search.set('page', String(page));
  return hubHref(
    locale,
    own === undefined ? scope.path : watchVideosPathOf(own.format),
    search,
  );
}

/**
 * The address of one view of the whole of Media, from its unfiltered first
 * page — what every Watch page that links into the listing (a Topic, a
 * speaker, a Series, a language, a format) builds, so no two spell one view
 * differently. Identifiers are written in lower case, as an address reads
 * them, so a link never costs a redirect.
 */
export function watchVideosHref(
  locale: string,
  change: {
    readonly topic?: string;
    readonly format?: VideoFormat;
    readonly language?: string;
    readonly speaker?: string;
    readonly series?: string;
    readonly length?: TopicVideoLength;
    readonly sort?: TopicVideosSort;
  } = {},
): string {
  return videosHref(WATCH_VIDEOS, locale, {
    ...DEFAULT_VIDEOS_QUERY,
    language: change.language ?? null,
    speaker: change.speaker?.toLowerCase() ?? null,
    series: change.series?.toLowerCase() ?? null,
    length: change.length ?? null,
    sort: change.sort ?? 'newest',
    media: { topic: change.topic?.toLowerCase() ?? null, format: change.format ?? null },
  });
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

/** …and of the whole of Media, which also reads its own filters and its former offset. */
const MEDIA_KEYS: ReadonlySet<string> = new Set([
  ...VIEW_KEYS,
  'topic',
  'format',
  'offset',
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
    scope.media === undefined ? VIEW_KEYS : MEDIA_KEYS,
    videosHref(scope, locale, readVideosQuery(scope, query)),
  );
}

/**
 * What Media is asked for one view: on a hub its Topic (resolved at Layer 4);
 * in the whole of Media the view's own Topic filter, if any, and its format,
 * under `scope: 'media'`.
 */
export function videosReadQuery(
  scope: VideosScope,
  query: VideosQuery,
  topic: string | null,
  titleLocale: string,
): Record<string, unknown> {
  const read = {
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
  if (scope.media === undefined) return read;
  const own = query.media ?? { topic: null, format: scope.media.format };
  return { ...read, scope: 'media', topic: own.topic, format: own.format };
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
