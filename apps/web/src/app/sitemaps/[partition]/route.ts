import { renderSitemapPartition } from '@/seo/sitemap';
import { findSitemapPartition } from '@/seo/people-sitemap';

/**
 * `/sitemaps/{segment}-{locale}.xml` — one child sitemap (ROUTE_MAP.md §9.4).
 *
 * THE SEGMENT IS NOT PARSED OUT OF THE REQUEST. The filename is matched against
 * the partitions the application actually produces, so an arbitrary path cannot
 * name a partition into existence: `/sitemaps/quran-en.xml` is a 404 today
 * because there is no Quran partition, and `/sitemaps/../../etc.xml` is a 404
 * because it matches nothing. Nothing reaches a filesystem, a template or a
 * database from this segment — the contributor read the `people` partition
 * performs is a bounded query for published records, not a lookup of anything
 * the request supplied.
 *
 * DYNAMIC SINCE PHASE 5. Phase 4 prerendered these from `generateStaticParams`,
 * which was right while every partition came from the shell route registry —
 * code, known at build time. The `people` segment comes from contributor rows
 * an administrator changes, so a prerendered copy would keep advertising a
 * withdrawn profile, and enumerating it at build time would put a database
 * connection on the build's critical path. The BUILD-BOUND `pages` partitions
 * are unchanged in content and are still resolved without touching a database:
 * `findSitemapPartition` tries them first and returns before any query.
 *
 * 404 while public indexing is disabled, for the same reason the index is.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ partition: string }> },
): Promise<Response> {
  const { partition } = await params;
  const found = await findSitemapPartition(partition);

  if (found === null) {
    return new Response(null, { status: 404 });
  }

  return new Response(renderSitemapPartition(found), {
    status: 200,
    headers: {
      'content-type': 'application/xml; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}
