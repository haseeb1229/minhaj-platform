import {
  partitionNamed,
  partitionPath,
  renderSitemapPartition,
  sitemapPartitions,
} from '@/seo/sitemap';

/**
 * `/sitemaps/{segment}-{locale}.xml` — one child sitemap (ROUTE_MAP.md §9.4).
 *
 * THE SEGMENT IS NOT PARSED OUT OF THE REQUEST. The filename is matched against
 * the partitions the application actually produces, so an arbitrary path cannot
 * name a partition into existence: `/sitemaps/quran-en.xml` is a 404 today
 * because there is no Quran partition, and `/sitemaps/../../etc.xml` is a 404
 * because it matches nothing. Nothing reaches a filesystem, a template or a
 * database from this segment.
 *
 * 404 while public indexing is disabled, for the same reason the index is.
 */
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams(): { partition: string }[] {
  return sitemapPartitions().map((partition) => ({
    partition: partitionPath(partition).slice('/sitemaps/'.length),
  }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ partition: string }> },
): Promise<Response> {
  const { partition } = await params;
  const found = partitionNamed(partition);

  if (found === null) {
    return new Response(null, { status: 404 });
  }

  return new Response(renderSitemapPartition(found), {
    status: 200,
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
}
