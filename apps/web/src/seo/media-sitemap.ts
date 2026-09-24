import 'server-only';

import { localeSchema, type Locale } from '@minhaj/contracts';
import type { MediaSitemapRow } from '@minhaj/contracts/media';

import { mediaReadRuntime } from '@/composition/media-read';
import {
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

export async function mediaSitemapPartitions(): Promise<readonly SitemapPartition[]> {
  if (!publicIndexingEnabled()) return [];

  const buckets = new Map<Locale, SitemapEntry[]>(
    localeSchema.options.map((locale) => [locale, []]),
  );

  for (const kind of ['video', 'series', 'playlist'] as const) {
    for (let offset = 0; ; offset += READ_BATCH) {
      const batch = await mediaReadRuntime().sitemap(kind, offset, READ_BATCH);
      for (const row of batch) {
        const path = PATHS[kind](row);
        for (const locale of row.locales) {
          buckets.get(locale as Locale)?.push({
            loc: absoluteUrl(`/${locale}${path}`),
            lastmod: row.updatedAt.toISOString(),
          });
        }
      }
      if (batch.length < READ_BATCH) break;
    }
  }

  // Empty partitions are dropped: an empty segment would advertise nothing.
  const partitions: SitemapPartition[] = [];
  for (const [locale, urls] of buckets) {
    if (urls.length > 0) partitions.push({ segment: SEGMENT, locale, urls });
  }
  return partitions;
}
