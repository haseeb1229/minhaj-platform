import { z } from 'zod';

import type { Locale } from '@minhaj/contracts';
import {
  isoDuration,
  providerEmbedUrl,
  type MediaLabel,
  type SeriesKind,
  type VideoFormat,
  type VideoQuery,
  type VideoRecord,
} from '@minhaj/contracts/media';

/**
 * Presentation decisions for the Watch and Listen surfaces — PURE and free of
 * React.
 *
 * Which address a record has, which label a page renders, which query a URL
 * means, and what structured data a Video may truthfully claim. Each has one
 * implementation: the pages, the sitemap, the redirect proxy and the search
 * result addresses all call these, so no two can spell a record's address
 * differently.
 */

/* ===========================================================================
 * Addresses
 * ========================================================================= */

/** The five curated views (ROUTE_MAP.md §3.7) and the format each one shows. */
const VIEW_SEGMENTS: Readonly<Record<VideoFormat, string>> = Object.freeze({
  lecture: 'lectures',
  event: 'events',
  highlight: 'highlights',
  interview: 'interviews',
  documentary: 'documentaries',
});

/** Every curated view segment, in the order the Watch landing lists them. */
export const WATCH_VIEWS: readonly string[] = Object.freeze(Object.values(VIEW_SEGMENTS));

export function formatOfView(segment: string): VideoFormat | null {
  const found = (Object.entries(VIEW_SEGMENTS) as [VideoFormat, string][]).find(
    ([, value]) => value === segment,
  );
  return found === undefined ? null : found[0];
}

export function viewOfFormat(format: VideoFormat): string {
  return VIEW_SEGMENTS[format];
}

/** A Series' ONE route family, decided by its kind. */
const SERIES_SEGMENTS: Readonly<Record<SeriesKind, string>> = Object.freeze({
  series: 'series',
  program: 'programs',
});

export function seriesSegment(kind: SeriesKind): string {
  return SERIES_SEGMENTS[kind];
}

const part = (value: string) => encodeURIComponent(value);

/** The LOCALE-FREE canonical path of a Video. */
export function videoPathOf(slug: string): string {
  return `/watch/videos/${part(slug)}`;
}

export function videoPath(locale: string, slug: string): string {
  return `/${locale}${videoPathOf(slug)}`;
}

export function seriesPathOf(kind: SeriesKind, slug: string): string {
  return `/watch/${SERIES_SEGMENTS[kind]}/${part(slug)}`;
}

export function seriesPath(locale: string, kind: SeriesKind, slug: string): string {
  return `/${locale}${seriesPathOf(kind, slug)}`;
}

export function playlistPathOf(slug: string): string {
  return `/watch/playlists/${part(slug)}`;
}

export function playlistPath(locale: string, slug: string): string {
  return `/${locale}${playlistPathOf(slug)}`;
}

/**
 * Phase 11 — an AudioTrack's ONE canonical address, under `/listen/lectures`
 * (ROUTE_MAP.md §3.7), and an AudioSeries' under `/listen/series`. Listen is a
 * sibling of Watch, never a child of it.
 */
export function audioTrackPathOf(slug: string): string {
  return `/listen/lectures/${part(slug)}`;
}

export function audioTrackPath(locale: string, slug: string): string {
  return `/${locale}${audioTrackPathOf(slug)}`;
}

export function audioSeriesPathOf(slug: string): string {
  return `/listen/series/${part(slug)}`;
}

export function audioSeriesPath(locale: string, slug: string): string {
  return `/${locale}${audioSeriesPathOf(slug)}`;
}

/**
 * A track's bytes: first-party, unprefixed, and addressed by BOTH the track and
 * the asset, so a replaced file has a new address and the serving policy can
 * refuse any asset that is not the one recorded against that track.
 */
export function audioAssetPath(trackId: string, assetId: string): string {
  return `/assets/media/audio/${part(trackId)}/${part(assetId)}`;
}

/** The administrator's preview of the same bytes, behind a live permission. */
export function audioPreviewPath(trackId: string, assetId: string): string {
  return `/assets/media/previews/audio/${part(trackId)}/${part(assetId)}`;
}

/* ===========================================================================
 * Labels
 * ========================================================================= */

/**
 * The descriptive label a page renders: the reader's interface locale, then the
 * record's primary locale, then the first label. Presentation, never
 * translation — and the resolved locale travels with it so the element is
 * marked with the language it is actually in (WCAG 3.1.2).
 */
export function mediaLabel(
  record: { readonly labels: readonly MediaLabel[]; readonly primaryLocale: Locale },
  locale: Locale,
): MediaLabel {
  return (
    record.labels.find((label) => label.locale === locale) ??
    record.labels.find((label) => label.locale === record.primaryLocale) ??
    record.labels[0] ?? { locale: record.primaryLocale, title: '', description: '' }
  );
}

/** The interface locales a record genuinely has descriptive metadata in. */
export function mediaLocales(record: {
  readonly labels: readonly MediaLabel[];
}): Locale[] {
  return record.labels.map((label) => label.locale);
}

/* ===========================================================================
 * Queries
 * ========================================================================= */

const uuid = z.uuid();

/**
 * A URL's listing filters — the Watch video listings' and, with the same four
 * filters, the Listen track listing's — TOLERATED and then re-validated by the
 * read service. A mistyped or repeated parameter is the unfiltered listing,
 * never an error page, and nothing here can widen what is public.
 */
export function readMediaQuery(
  query: Record<string, string | string[] | undefined>,
): Omit<VideoQuery, 'format' | 'featured'> {
  const text = (key: string, max: number): string | null => {
    const raw = query[key];
    return typeof raw === 'string' && raw !== '' && raw.length <= max ? raw : null;
  };
  const id = (key: string): string | null => {
    const value = text(key, 64);
    return value !== null && uuid.safeParse(value).success ? value : null;
  };
  const language = text('language', 16);
  return {
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .max(25_000)
      .catch(0)
      .parse(text('offset', 8) ?? 0),
    topic: id('topic'),
    speaker: id('speaker'),
    series: id('series'),
    language:
      language !== null && /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)
        ? language
        : null,
  };
}

export type MediaFilters = ReturnType<typeof readMediaQuery>;

/** The listing address for a set of filters, neutral values omitted. */
export function mediaQueryPath(
  base: string,
  filters: MediaFilters,
  overrides: Partial<MediaFilters> = {},
): string {
  const merged = { ...filters, ...overrides };
  const search = new URLSearchParams();
  if (merged.topic !== null) search.set('topic', merged.topic);
  if (merged.speaker !== null) search.set('speaker', merged.speaker);
  if (merged.series !== null) search.set('series', merged.series);
  if (merged.language !== null) search.set('language', merged.language);
  if (merged.offset > 0) search.set('offset', String(merged.offset));
  const encoded = search.toString();
  return encoded === '' ? base : `${base}?${encoded}`;
}

/** `/watch?sort=featured|latest`. Anything else is the default, `featured`. */
export function readWatchSort(
  query: Record<string, string | string[] | undefined>,
): 'featured' | 'latest' {
  return query['sort'] === 'latest' ? 'latest' : 'featured';
}

/** A plain offset from `?offset=`, bounded, for the grouping pages. */
export function readOffset(query: Record<string, string | string[] | undefined>): number {
  const raw = query['offset'];
  return z.coerce
    .number()
    .int()
    .min(0)
    .max(25_000)
    .catch(0)
    .parse(typeof raw === 'string' && raw.length <= 8 ? raw : 0);
}

/** A grouping page's address at an offset. The first page is the bare address. */
export function offsetPath(path: string, offset: number): string {
  return offset === 0 ? path : `${path}?offset=${String(offset)}`;
}

/* ===========================================================================
 * Structured data
 * ========================================================================= */

/**
 * `VideoObject` — ONLY what is genuinely known, or nothing at all.
 *
 * THE TRUTHFUL MINIMUM. A `VideoObject` is emitted only when the Video has a
 * title, the provider's own thumbnail and the provider's publication date — the
 * three facts a VideoObject cannot honestly omit — and only while the provider is
 * known to serve it, because an `embedUrl` to a removed video is a false claim.
 * Anything missing means NO VideoObject, never an invented thumbnail, date or
 * duration. The description, duration and content language are added only
 * where recorded; no speaker, publisher, rating or interaction count is claimed.
 *
 * The embed address is the privacy-enhanced one the player itself uses. It is a
 * string inside JSON-LD, which a browser never fetches.
 */
export function videoStructuredData(
  record: Pick<
    VideoRecord,
    | 'provider'
    | 'providerVideoId'
    | 'availability'
    | 'thumbnailUrl'
    | 'publishedOn'
    | 'durationSeconds'
    | 'languageCode'
  >,
  label: MediaLabel,
  url: string,
): Record<string, unknown> | null {
  if (
    record.availability !== 'available' ||
    record.thumbnailUrl === null ||
    record.publishedOn === null ||
    label.title === ''
  )
    return null;

  return {
    '@type': 'VideoObject',
    name: label.title,
    ...(label.description === '' ? {} : { description: label.description }),
    thumbnailUrl: record.thumbnailUrl,
    uploadDate: record.publishedOn,
    ...(record.durationSeconds === null
      ? {}
      : { duration: isoDuration(record.durationSeconds) }),
    embedUrl: providerEmbedUrl(record.provider, record.providerVideoId),
    inLanguage: record.languageCode,
    url,
  };
}
