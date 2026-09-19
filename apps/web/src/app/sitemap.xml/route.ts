import { renderSitemapIndex } from '@/seo/sitemap';
import { allSitemapPartitions } from '@/seo/people-sitemap';

/**
 * `/sitemap.xml` — the sitemap index (ROUTE_MAP.md §9.4).
 *
 * UNPREFIXED, which is why it is here rather than under `[locale]`: the machine
 * sitemaps are one of the five non-locale routes ROUTE_MAP.md §10 rule 6 names,
 * and the proxy's matcher already excludes it from locale routing.
 *
 * DYNAMIC SINCE PHASE 5, and the reason is the contract rather than convenience.
 * The index now references a `people` segment whose contents change when an
 * administrator publishes or withdraws a contributor, and §9.4 requires a
 * sitemap to be "regenerated on publication, not on a fixed schedule" — which a
 * file fixed at build time cannot be. Rendering per request is also what keeps
 * `next build` free of any database dependency: nothing is prerendered from
 * contributor rows, so the build needs no connection and no credential.
 *
 * THE INDEXING POSTURE IS STILL BUILD-BOUND. `next.config.ts` substitutes the
 * validated boolean into every server chunk, so this handler reads the same
 * decision the prerendered pages were built with. Making the DOCUMENT dynamic
 * does not make the DECISION dynamic, and the two are separate on purpose.
 *
 * A 404 WHILE INDEXING IS DISABLED, and that is the honest answer rather than
 * an evasion. The pre-adoption posture is "no submitted sitemaps"
 * (ROUTE_MAP.md §9.5); serving an empty `<sitemapindex>` would still be serving
 * a sitemap, and an index with no children is not valid against the schema
 * either. Nothing advertises this path in that state — `robots.txt` emits no
 * `Sitemap` directive — so nothing is broken by its absence.
 *
 * A ROUTE HANDLER rather than Next's `sitemap.ts` convention, because that
 * convention generates a flat URL set at `/sitemap.xml` and, with
 * `generateSitemaps`, children at `/sitemap/{id}.xml`. The accepted contract is
 * an index at `/sitemap.xml` whose children live at
 * `/sitemaps/{segment}-{locale}.xml`, and the URLs in an accepted contract are
 * not negotiable against a framework's default naming.
 */
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const partitions = await allSitemapPartitions();

  if (partitions.length === 0) {
    return new Response(null, { status: 404 });
  }

  return new Response(renderSitemapIndex(partitions), {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      // NOT A PRIVATE SURFACE, and not a stale one either. The document is
      // derived from published content that an administrator changes, so it is
      // re-read per request rather than held; a shared cache keeping it would
      // keep advertising a contributor who has been withdrawn.
      'cache-control': 'no-store',
    },
  });
}
