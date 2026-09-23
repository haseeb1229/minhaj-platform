import 'server-only';

import { localeSchema, type Locale } from '@minhaj/contracts';

import { libraryReadRuntime } from '@/composition/library-read';
import { publicIndexingEnabled } from '@/config/indexing';
import { absoluteUrl } from '@/config/origin';
import { workPath } from '@/components/library/presentation';
import type { SitemapEntry, SitemapPartition } from './sitemap';

/**
 * The `books` sitemap segment — Phase 8's canonical Work URLs
 * (ROUTE_MAP.md §9.4, and this phase's §35).
 *
 * `books` IS THE ROUTE MAP'S OWN NAME for this segment, which is why it is not
 * `works` or `library`.
 *
 * A CONTENT SEGMENT, SO IT LIVES IN ITS OWN MODULE. `./sitemap.ts` is imported by
 * `robots.txt`, which is generated with the build artifact; this file reaches the
 * database and is imported only by the two sitemap ROUTE HANDLERS, both
 * `force-dynamic`. Keeping the halves apart is what lets a build that "runs in CI
 * and on developer machines that hold no production credential" still succeed
 * (ARCHITECTURE.md §8.3.1).
 *
 * WHAT IS IN IT: canonical Work URLs, one per locale the Work genuinely has
 * descriptive metadata in.
 *
 * WHAT IS DELIBERATELY NOT IN IT (§35):
 *
 *   - FILTERED VIEWS. `/library/books?language=ur` is "indexable but canonical to
 *     the base, and excluded from sitemaps" (ROUTE_MAP.md §2.3). Nothing here
 *     constructs a query string at all, so a filter combination cannot leak in —
 *     and the combinatorial explosion of language × topic × contributor × range
 *     never gets a chance to exist.
 *   - OLD SLUGS. They are redirect sources, and "only canonical, indexable URLs
 *     appear … never filtered views, `noindex` pages, authenticated routes or
 *     redirect sources" (§9.4). The reader returns current slugs only.
 *   - EDITION ADDRESSES. There are none: an Edition is selected by query parameter
 *     on the Work page, and the canonical identity is the Work (§47).
 *   - DRAFT, ARCHIVED, AND EDITION-LESS WORKS. The reader's public predicate
 *     excludes them, and it is not re-applied here — so a change to what "public"
 *     means cannot be missed by this module.
 *   - PHASE-9 RESOURCES. Research, publications, magazines and encyclopedias do
 *     not exist, so they are absent rather than listed as empty promises.
 *
 * A LOCALE VERSION IS LISTED ONLY WHERE IT GENUINELY EXISTS. A Work described only
 * in Urdu contributes a `ur` URL and no `en` one: "untranslated content is never
 * listed as an alternate", and a sitemap entry for a URL that merely falls back to
 * another language is the same false signal in a different file (§9.2, §9.4).
 *
 * `lastmod` IS THE WORK'S OWN MODIFICATION INSTANT, never build or deploy time.
 * `Work.updatedAt` is moved by every mutation that changes what the page renders —
 * including the ones that write a child row, an Edition or a sale-point link —
 * because a `lastmod` that changes on every deploy trains crawlers to ignore it
 * (§9.4).
 */

/** ROUTE_MAP.md §9.4's own name for the segment. */
const BOOKS_SEGMENT = 'books';

/**
 * How many Work URLs one child partition may cover.
 *
 * A ceiling rather than a guess: §9.4 requires large segments to split numerically,
 * preserving the accepted first filename and adding `-2`, `-3` … only when the bound
 * is crossed. Reads continue to exhaustion; this is never a corpus limit.
 */
const BOOKS_PARTITION_LIMIT = 5_000;

/**
 * A deliberately smaller DATABASE page.
 *
 * Prisma's SQL Server relation loading parameterises parent identifiers, so a
 * 5,000-row read that also loads each Work's labels can exceed SQL Server's
 * 2,100-parameter statement limit even though the XML partition would be valid.
 * Paging and XML partitioning are separate bounds, for the reason the `people`
 * segment already documents.
 */
const BOOKS_READ_BATCH = 500;

export async function librarySitemapPartitions(): Promise<readonly SitemapPartition[]> {
  // FAIL CLOSED FIRST, and before any query. While indexing is disabled there is
  // nothing to advertise, so there is nothing to read either.
  if (!publicIndexingEnabled()) return [];

  const buckets = new Map<Locale, SitemapEntry[]>(
    localeSchema.options.map((locale) => [locale, []]),
  );

  let offset = 0;
  for (;;) {
    const batch = await libraryReadRuntime().sitemap(offset, BOOKS_READ_BATCH);

    for (const row of batch) {
      for (const locale of row.locales) {
        buckets.get(locale as Locale)?.push({
          loc: absoluteUrl(workPath(locale, row.slug)),
          lastmod: row.updatedAt.toISOString(),
        });
      }
    }

    if (batch.length < BOOKS_READ_BATCH) break;
    offset += batch.length;
  }

  const partitions: SitemapPartition[] = [];

  for (const [locale, urls] of buckets) {
    // Empty partitions are dropped: a segment advertising nothing is worse than
    // an absent segment, because it claims the capability exists and is empty.
    for (let start = 0; start < urls.length; start += BOOKS_PARTITION_LIMIT) {
      const part = start / BOOKS_PARTITION_LIMIT + 1;
      partitions.push({
        segment: BOOKS_SEGMENT,
        locale,
        ...(part === 1 ? {} : { part }),
        urls: urls.slice(start, start + BOOKS_PARTITION_LIMIT),
      });
    }
  }

  return partitions;
}
