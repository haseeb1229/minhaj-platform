import 'server-only';

/**
 * THE indexing posture, in one place.
 *
 * ROUTE_MAP.md §9.5 gives the pre-adoption origin one row: entire site
 * `noindex` plus `Disallow`, no submitted sitemaps, and no canonical URL
 * pointing at the official origin — until the approved launch transition
 * (DELIVERY_PLAN.md, Phase 35).
 *
 * Every surface that could leak an indexing signal asks THIS function rather
 * than reading the environment itself: the metadata helper, `robots.txt`, the
 * sitemap index and the sitemap partitions. One reader means the posture cannot
 * be on in one place and off in another, which is the failure mode that would
 * matter — a site that says `noindex` in its head while advertising a sitemap
 * full of the same URLs.
 */

/**
 * May this deployment be indexed at all?
 *
 * FAIL CLOSED. The environment variable defaults to `false` and is rejected
 * unless it is exactly `true` or `false`, so a typo, an empty value or an unset
 * variable all produce a non-indexable deployment.
 */
export function publicIndexingEnabled(): boolean {
  return process.env.MINHAJ_BUILD_PUBLIC_INDEXING_ENABLED === 'true';
}
