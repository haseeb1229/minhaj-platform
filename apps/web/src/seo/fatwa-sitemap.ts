import 'server-only';

import { localeSchema, type Locale } from '@minhaj/contracts';

import { fatwaReadRuntime } from '@/composition/fatwa-read';
import { fatwaContentLocales, rulingPathOf } from '@/components/fatwa/presentation';
import { publicIndexingEnabled } from '@/config/indexing';
import { absoluteUrl } from '@/config/origin';
import type { SitemapEntry, SitemapPartition } from './sitemap';

/**
 * The `fatwa` sitemap segment — Phase 20's published rulings (ROUTE_MAP.md §9.4
 * names the segment).
 *
 * ONLY WHILE AN APPROVED ACTIVATION STANDS. An inactive service has nothing to
 * advertise, and a FIXTURE activation is engineering proof text that must
 * never be offered to a search engine — so the segment is empty in both,
 * decided here before anything is enumerated.
 *
 * ONLY CANONICAL RULINGS, IN THEIR OWN LANGUAGE: `/{language}/fatwa/{slug}` for
 * each ruling public now, listed ONLY in the partition of its content language
 * and only when that language is an interface locale — a ruling written in
 * Urdu has one canonical address, and an English or Arabic address that merely
 * frames it is not a language version (ROUTE_MAP.md §9.2, §9.3). Never a
 * withdrawn or unpublished ruling (the reader returns none), never a sorted,
 * filtered or paged view, a category, a topic view or the search page.
 * `lastmod` is the ruling's latest publication, never the build's.
 *
 * READ ONLY BY THE SITEMAP ROUTE HANDLERS, which are dynamic, so a build needs
 * no database; nothing is read at all while public indexing is disabled.
 */

const SEGMENT = 'fatwa';

/** A bounded database page; the reader enumerates to exhaustion in these. */
const READ_BATCH = 1_000;

export async function fatwaSitemapPartitions(): Promise<readonly SitemapPartition[]> {
  // FAIL CLOSED FIRST, and before any query.
  if (!publicIndexingEnabled()) return [];

  const reader = fatwaReadRuntime().reader;
  const availability = await reader.availability();
  if (!availability.active || availability.mode !== 'approved') return [];

  const buckets = new Map<Locale, SitemapEntry[]>(
    localeSchema.options.map((locale) => [locale, []]),
  );
  for (let offset = 0; ; offset += READ_BATCH) {
    const batch = await reader.sitemap(offset, READ_BATCH);
    for (const row of batch)
      for (const locale of fatwaContentLocales(row.language))
        buckets.get(locale)?.push({
          loc: absoluteUrl(`/${locale}${rulingPathOf(row.slug)}`),
          lastmod: row.lastModified.toISOString(),
        });
    if (batch.length < READ_BATCH) break;
  }

  const partitions: SitemapPartition[] = [];
  for (const [locale, urls] of buckets)
    if (urls.length > 0) partitions.push({ segment: SEGMENT, locale, urls });
  return partitions;
}
