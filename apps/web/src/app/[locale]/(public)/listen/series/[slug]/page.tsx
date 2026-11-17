import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { mediaReadRuntime } from '@/composition/media-read';
import {
  groupPageCanonicalRedirect,
  readGroupPage,
} from '@/components/media/groups-view';
import { listenMetadataInput } from '@/components/media/listen';
import { AudioSeriesPage } from '@/components/media/listen-series';
import { audioSeriesPath } from '@/components/media/presentation';
import { requireLocale } from '@/config/route-locale';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/listen/series/{slug}` — one published AudioSeries and its
 * published recordings in series order, 24 a page (`?page`; rebuilt in Watch
 * Part 3). A malformed, repeated or first-page `?page` and a former `?offset=`
 * are one redirect; a former slug answers a single 301 here from the request
 * proxy (DOMAIN_MODEL.md §19.7).
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
  const query = await searchParams;
  const canonical = groupPageCanonicalRedirect(
    audioSeriesPath(locale, record.slug),
    query,
  );
  if (canonical !== null) redirect(canonical);
  return <AudioSeriesPage locale={locale} record={record} page={readGroupPage(query)} />;
}
