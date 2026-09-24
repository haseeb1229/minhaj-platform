import 'server-only';

import { localeSchema, type Locale } from '@minhaj/contracts';
import type { ScholarlyKind } from '@minhaj/contracts/library';

import { libraryReadRuntime } from '@/composition/library-read';
import { publicIndexingEnabled } from '@/config/indexing';
import { absoluteUrl } from '@/config/origin';
import { scholarlyPathOf } from '@/components/library/scholarly-presentation';
import type { SitemapEntry, SitemapPartition } from './sitemap';

/**
 * The `research` and `publications` sitemap segments — Phase 9's canonical
 * Library URLs (ROUTE_MAP.md §9.4 names both segments).
 *
 * `research` carries Research and ResearchPaper; `publications` carries
 * Publication, Encyclopedia, Magazine and MagazineIssue — the written works and
 * the periodicals, which is how the route map groups them.
 *
 * THE SAME RULES AS THE `books` SEGMENT: only current canonical URLs of public
 * records, read through Library's own public predicate — never a draft, an
 * archived record, a former slug, a filtered view or an issue of an unpublished
 * Magazine; one URL per locale the record genuinely has descriptive metadata in;
 * and `lastmod` from the record's own modification instant (for an issue, the
 * later of the issue's and its Magazine's, because the issue page renders the
 * Magazine's title). The partition split at 5,000 URLs is the shared merge's.
 *
 * READ ONLY BY THE SITEMAP ROUTE HANDLERS, which are dynamic, so a build needs no
 * database; and nothing is read at all while public indexing is disabled.
 */

const SEGMENTS: readonly {
  readonly segment: string;
  readonly kinds: readonly ScholarlyKind[];
}[] = [
  { segment: 'research', kinds: ['research', 'research-paper'] },
  {
    segment: 'publications',
    kinds: ['publication', 'encyclopedia', 'magazine', 'magazine-issue'],
  },
];

/** A database page, below SQL Server's parameter limit for the label relation. */
const READ_BATCH = 500;

export async function scholarlySitemapPartitions(): Promise<readonly SitemapPartition[]> {
  if (!publicIndexingEnabled()) return [];

  const partitions: SitemapPartition[] = [];

  for (const { segment, kinds } of SEGMENTS) {
    const buckets = new Map<Locale, SitemapEntry[]>(
      localeSchema.options.map((locale) => [locale, []]),
    );

    for (const kind of kinds) {
      for (let offset = 0; ; offset += READ_BATCH) {
        const batch = await libraryReadRuntime().scholarlySitemap(
          kind,
          offset,
          READ_BATCH,
        );
        for (const row of batch) {
          const path = scholarlyPathOf(kind, row.slug, row.magazineSlug);
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

    // Empty partitions are dropped: an empty segment would claim a capability
    // that has nothing to show.
    for (const [locale, urls] of buckets) {
      if (urls.length > 0) partitions.push({ segment, locale, urls });
    }
  }

  return partitions;
}
