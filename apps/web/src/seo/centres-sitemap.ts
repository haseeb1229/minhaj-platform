import 'server-only';

import { localeSchema, type Locale } from '@minhaj/contracts';
import { globalPaths } from '@minhaj/contracts/global';

import { globalReadRuntime } from '@/composition/global-read';
import { publicIndexingEnabled } from '@/config/indexing';
import { absoluteUrl } from '@/config/origin';
import type { SitemapEntry, SitemapPartition } from './sitemap';

/**
 * The `centres` sitemap segment — Phase 16's canonical Centre URLs (ROUTE_MAP.md
 * §9.4 names the segment).
 *
 * ONLY CURRENT CANONICAL URLS OF PUBLIC CENTRES: a Centre that is published and
 * under no withheld Country, Region or City, at `/global/centres/{slug}`, once
 * per locale its name genuinely exists in, `lastmod` from its own modification
 * instant. Never a draft or archived Centre, a former slug, a finder query, a
 * Centre's `news` or `contact` page, a Country, Region or City page — those are
 * reached by links, and §9.4 names no segment for them — and never a Centre
 * Events address, which does not exist.
 *
 * READ ONLY BY THE SITEMAP ROUTE HANDLERS, which are dynamic, so a build needs no
 * database; nothing is read at all while public indexing is disabled.
 */

const SEGMENT = 'centres';

/** One database page at a time. */
const READ_BATCH = 500;

export async function centreSitemapPartitions(): Promise<readonly SitemapPartition[]> {
  if (!publicIndexingEnabled()) return [];
  const buckets = new Map<Locale, SitemapEntry[]>(
    localeSchema.options.map((locale) => [locale, []]),
  );
  for (let offset = 0; ; offset += READ_BATCH) {
    const batch = await globalReadRuntime().centreSitemap(offset, READ_BATCH);
    for (const row of batch)
      for (const locale of row.languages)
        buckets.get(locale)?.push({
          loc: absoluteUrl(globalPaths.centre(locale, row.slug)),
          lastmod: row.updatedAt.toISOString(),
        });
    if (batch.length < READ_BATCH) break;
  }
  const partitions: SitemapPartition[] = [];
  for (const [locale, urls] of buckets)
    if (urls.length > 0) partitions.push({ segment: SEGMENT, locale, urls });
  return partitions;
}
