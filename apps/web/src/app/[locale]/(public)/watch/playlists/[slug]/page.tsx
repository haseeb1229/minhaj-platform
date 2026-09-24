import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { mediaReadRuntime } from '@/composition/media-read';
import { playlistPath } from '@/components/media/presentation';
import { groupMetadataInput, PlaylistDetailPage } from '@/components/media/watch';
import { requireLocale } from '@/config/route-locale';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/watch/playlists/{slug}` — one published playlist, its published
 * videos in the curated order. A former slug answers a single 301 here from the
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
  const record = await mediaReadRuntime().playlist(slug);
  if (record === null) return { robots: { index: false, follow: false } };
  return contentMetadata({
    locale,
    ...groupMetadataInput(locale, record, (alternate) =>
      playlistPath(alternate, record.slug),
    ),
  });
}

export default async function PlaylistPage({ params, searchParams }: DetailParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await mediaReadRuntime().playlist(slug);
  if (record === null) notFound();
  return (
    <PlaylistDetailPage locale={locale} record={record} query={await searchParams} />
  );
}
