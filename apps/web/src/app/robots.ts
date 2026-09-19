import type { MetadataRoute } from 'next';

import { localeSchema } from '@minhaj/contracts';

import { absoluteUrl } from '@/config/origin';
import { publicIndexingEnabled } from '@/config/indexing';
import { sitemapPartitions } from '@/seo/sitemap';

/**
 * `/robots.txt` (ROUTE_MAP.md §9.5).
 *
 * TWO POSTURES, AND THE DEFAULT IS THE RESTRICTIVE ONE.
 *
 * While public indexing is disabled — which is every pre-adoption deployment,
 * and the default for any deployment that configures nothing — the whole site
 * is disallowed and NO sitemap is advertised. That is the environment and
 * launch-state safeguard that keeps a developer-controlled origin from
 * competing with, or appearing to impersonate, the official organisation site.
 *
 * IT LEAKS NO CONFIGURATION. The disabled form says `Disallow: /` and nothing
 * else: not which variable produced it, not which environment this is, not
 * which paths exist. A `robots.txt` is the most reliably fetched file on any
 * site, and a list of interesting paths is exactly what it must not become.
 *
 * WHEN INDEXING IS ENABLED, the disallow list covers the API and the two
 * authenticated areas, per locale and by exact prefix rather than by wildcard —
 * a pattern like `/*\/my` would also block a future `/en/mystery`, and a robots
 * rule that blocks more than it names is a rule nobody can reason about.
 *
 * THE AUTHENTICATION ROUTES ARE DELIBERATELY NOT DISALLOWED. They carry
 * `noindex, nofollow`, and a crawler has to be allowed to fetch a page to see
 * that it says `noindex`. Disallowing them would leave them indexable by
 * reference while forbidding the fetch that proves they must not be.
 */
export default function robots(): MetadataRoute.Robots {
  if (!publicIndexingEnabled()) {
    return { rules: [{ userAgent: '*', disallow: '/' }] };
  }

  const privateAreas = localeSchema.options.flatMap((locale) => [
    `/${locale}/my`,
    `/${locale}/admin`,
  ]);

  // THE BUILD-BOUND PARTITIONS ARE THE RIGHT QUESTION HERE, and deliberately
  // not the whole index. This file is generated with the artifact; asking for
  // the contributor partitions would put a database read on the build's
  // critical path to answer a question their contents cannot change. While
  // indexing is enabled the shell always contributes at least one URL, so an
  // index always exists — the `people` segment adds to it rather than deciding
  // whether it is there (ROUTE_MAP.md §9.4).
  const partitions = sitemapPartitions();

  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/api/', ...privateAreas] }],
    ...(partitions.length === 0 ? {} : { sitemap: absoluteUrl('/sitemap.xml') }),
  };
}
