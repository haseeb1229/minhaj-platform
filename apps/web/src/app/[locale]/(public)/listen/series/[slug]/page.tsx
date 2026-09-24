import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { mediaReadRuntime } from '@/composition/media-read';
import { AudioSeriesDetailPage, listenMetadataInput } from '@/components/media/listen';
import { audioSeriesPath } from '@/components/media/presentation';
import { requireLocale } from '@/config/route-locale';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/listen/series/{slug}` — one published AudioSeries and its published
 * tracks in series order. A former slug answers a single 301 here from the
 * request proxy (DOMAIN_MODEL.md §19.7).
 */
export const dynamic = 'force-dynamic';

interface DetailParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: DetailParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await mediaReadRuntime().audioSeries(slug);
  if (record === null) return { robots: { index: false, follow: false } };
  return contentMetadata({
    locale,
    ...listenMetadataInput(locale, record, (alternate) =>
      audioSeriesPath(alternate, record.slug),
    ),
  });
}

export default async function AudioSeriesDetailRoute({
  params,
  searchParams,
}: DetailParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await mediaReadRuntime().audioSeries(slug);
  if (record === null) notFound();
  return (
    <AudioSeriesDetailPage locale={locale} record={record} query={await searchParams} />
  );
}
