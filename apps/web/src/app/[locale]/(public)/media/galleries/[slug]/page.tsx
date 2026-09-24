import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { mediaReadRuntime } from '@/composition/media-read';
import { GalleryDetailPage } from '@/components/media/photos';
import { galleryPath, mediaLabel, mediaLocales } from '@/components/media/presentation';
import { requireLocale } from '@/config/route-locale';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/media/galleries/{slug}` — one published Gallery and its public
 * photographs, in its own order. A former slug answers a single 301 here from
 * the request proxy (DOMAIN_MODEL.md §19.7).
 *
 * A Gallery none of whose photographs is public yet still answers — it is
 * published — but claims no language version, so it is `noindex` and carries
 * no structured data until it has something to show.
 */
export const dynamic = 'force-dynamic';

interface GalleryParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: GalleryParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await mediaReadRuntime().gallery(slug);
  if (record === null) return { robots: { index: false, follow: false } };
  const label = mediaLabel(record, locale);
  return contentMetadata({
    locale,
    title: label.title,
    ...(label.description === '' ? {} : { description: label.description.slice(0, 160) }),
    contentLocales: record.photoCount > 0 ? mediaLocales(record) : [],
    primaryLocale: record.primaryLocale,
    pathFor: (alternate) => galleryPath(alternate, record.slug),
  });
}

export default async function GalleryRoute({ params, searchParams }: GalleryParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await mediaReadRuntime().gallery(slug);
  if (record === null) notFound();
  return (
    <GalleryDetailPage locale={locale} gallery={record} query={await searchParams} />
  );
}
