import 'server-only';

import { localeSchema, type Locale } from '@minhaj/contracts';
import type { MediaSitemapRow } from '@minhaj/contracts/media';

import { mediaReadRuntime } from '@/composition/media-read';
import {
  audioSeriesPathOf,
  audioTrackPathOf,
  galleryPathOf,
  playlistPathOf,
  seriesPathOf,
  videoPathOf,
} from '@/components/media/presentation';
import { publicIndexingEnabled } from '@/config/indexing';
import { absoluteUrl } from '@/config/origin';
import type { SitemapEntry, SitemapPartition } from './sitemap';

/**
 * The `videos` sitemap segment — Phase 10's canonical Watch URLs (ROUTE_MAP.md
 * §9.4 names the segment).
 *
 * ONLY CURRENT CANONICAL URLS OF PUBLISHED RECORDS: each Video at
 * `/watch/videos/{slug}`, each Series at its ONE family — `/watch/series` or
 * `/watch/programs`, by kind — and each Playlist at `/watch/playlists/{slug}`.
 * Never a draft, an archived record, a former slug, a filtered view, the other
 * family's address or a topic view. One URL per locale the record genuinely has
 * descriptive metadata in, and `lastmod` from the record's own modification
 * instant. The 5,000-URL split is the shared merge's.
 *
 * READ ONLY BY THE SITEMAP ROUTE HANDLERS, which are dynamic, so a build needs no
 * database; nothing is read at all while public indexing is disabled.
 */

const SEGMENT = 'videos';

/** A database page, below SQL Server's parameter limit for the label relation. */
const READ_BATCH = 500;

const PATHS: Readonly<
  Record<'video' | 'series' | 'playlist', (row: MediaSitemapRow) => string>
> = {
  video: (row) => videoPathOf(row.slug),
  series: (row) => seriesPathOf(row.seriesKind ?? 'series', row.slug),
  playlist: (row) => playlistPathOf(row.slug),
};

/** Per-locale URL buckets, one for each interface locale. */
function localeBuckets(): Map<Locale, SitemapEntry[]> {
  return new Map<Locale, SitemapEntry[]>(
    localeSchema.options.map((locale) => [locale, []]),
  );
}

/** Adds one record's URL in each locale it genuinely has metadata in. */
function addRow(
  buckets: Map<Locale, SitemapEntry[]>,
  path: string,
  row: MediaSitemapRow,
): void {
  for (const locale of row.locales) {
    buckets.get(locale as Locale)?.push({
      loc: absoluteUrl(`/${locale}${path}`),
      lastmod: row.updatedAt.toISOString(),
    });
  }
}

/** Empty partitions are dropped: an empty segment would advertise nothing. */
function partitionsOf(
  segment: string,
  buckets: Map<Locale, SitemapEntry[]>,
): SitemapPartition[] {
  const partitions: SitemapPartition[] = [];
  for (const [locale, urls] of buckets) {
    if (urls.length > 0) partitions.push({ segment, locale, urls });
  }
  return partitions;
}

export async function mediaSitemapPartitions(): Promise<readonly SitemapPartition[]> {
  if (!publicIndexingEnabled()) return [];

  const buckets = localeBuckets();

  for (const kind of ['video', 'series', 'playlist'] as const) {
    for (let offset = 0; ; offset += READ_BATCH) {
      const batch = await mediaReadRuntime().sitemap(kind, offset, READ_BATCH);
      for (const row of batch) addRow(buckets, PATHS[kind](row), row);
      if (batch.length < READ_BATCH) break;
    }
  }

  return partitionsOf(SEGMENT, buckets);
}

/**
 * The `audio` segment — Phase 11's canonical Listen URLs (ROUTE_MAP.md §9.4
 * names the segment): each published AudioTrack at `/listen/lectures/{slug}` and
 * each published AudioSeries at `/listen/series/{slug}`. Never a draft, an
 * archived record, a former slug, a filtered listing or a byte route.
 */
export async function audioSitemapPartitions(): Promise<readonly SitemapPartition[]> {
  if (!publicIndexingEnabled()) return [];

  const buckets = localeBuckets();
  const paths = {
    track: (row: MediaSitemapRow) => audioTrackPathOf(row.slug),
    series: (row: MediaSitemapRow) => audioSeriesPathOf(row.slug),
  } as const;

  for (const kind of ['track', 'series'] as const) {
    for (let offset = 0; ; offset += READ_BATCH) {
      const batch = await mediaReadRuntime().audioSitemap(kind, offset, READ_BATCH);
      for (const row of batch) addRow(buckets, paths[kind](row), row);
      if (batch.length < READ_BATCH) break;
    }
  }

  return partitionsOf('audio', buckets);
}

/**
 * The `galleries` segment — Phase 12's canonical Gallery URLs (ROUTE_MAP.md
 * §9.4 names the segment): each published Gallery that holds at least one
 * public photograph, at `/media/galleries/{slug}`. Never a draft, an archived
 * or empty Gallery, a former slug, a byte route — and never a Photo, which has
 * no page of its own.
 */
export async function gallerySitemapPartitions(): Promise<readonly SitemapPartition[]> {
  if (!publicIndexingEnabled()) return [];

  const buckets = localeBuckets();
  for (let offset = 0; ; offset += READ_BATCH) {
    const batch = await mediaReadRuntime().gallerySitemap(offset, READ_BATCH);
    for (const row of batch) addRow(buckets, galleryPathOf(row.slug), row);
    if (batch.length < READ_BATCH) break;
  }

  return partitionsOf('galleries', buckets);
}
