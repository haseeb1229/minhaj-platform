import 'server-only';

import { localeSchema, type Locale } from '@minhaj/contracts';
import { eventPathOf } from '@minhaj/contracts/editorial';

import { editorialReadRuntime } from '@/composition/editorial-read';
import { publicIndexingEnabled } from '@/config/indexing';
import { absoluteUrl } from '@/config/origin';
import type { SitemapEntry, SitemapPartition } from './sitemap';

/**
 * The `events` sitemap segment — Phase 14's canonical Event URLs (ROUTE_MAP.md
 * §9.4 names the segment).
 *
 * ONLY CURRENT CANONICAL URLS OF PUBLISHED EVENTS, at `/events/{slug}`, once per
 * locale the Event genuinely has a translation in, `lastmod` from its own
 * modification instant. Never a draft, an Event in review, a scheduled or
 * archived Event, a former slug, a `?when=` or geography query, an Event's
 * `noindex` gallery view or a Centre's Events page. Past Events stay listed:
 * an Event that has been held is still a published record. The 5,000-URL split
 * is the shared merge's.
 *
 * READ ONLY BY THE SITEMAP ROUTE HANDLERS, which are dynamic, so a build needs no
 * database; nothing is read at all while public indexing is disabled.
 */

const SEGMENT = 'events';

/** A database page, below SQL Server's parameter limit for the translation relation. */
const READ_BATCH = 500;

export async function eventSitemapPartitions(): Promise<readonly SitemapPartition[]> {
  if (!publicIndexingEnabled()) return [];
  const buckets = new Map<Locale, SitemapEntry[]>(
    localeSchema.options.map((locale) => [locale, []]),
  );
  for (let offset = 0; ; offset += READ_BATCH) {
    const batch = await editorialReadRuntime().eventSitemap(offset, READ_BATCH);
    for (const row of batch)
      for (const locale of row.languages)
        buckets.get(locale)?.push({
          loc: absoluteUrl(`/${locale}${eventPathOf(row.slug)}`),
          lastmod: row.updatedAt.toISOString(),
        });
    if (batch.length < READ_BATCH) break;
  }
  const partitions: SitemapPartition[] = [];
  for (const [locale, urls] of buckets)
    if (urls.length > 0) partitions.push({ segment: SEGMENT, locale, urls });
  return partitions;
}
