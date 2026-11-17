import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { mediaReadRuntime } from '@/composition/media-read';
import { GroupPage, groupMetadataInput } from '@/components/media/groups';
import {
  groupPageCanonicalRedirect,
  readGroupPage,
} from '@/components/media/groups-view';
import { playlistPath } from '@/components/media/presentation';
import { requireLocale } from '@/config/route-locale';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/watch/playlists/{slug}` — one published playlist, its published
 * videos in the curated order, 24 a page (`?page`, Watch Part 2). A former
 * slug answers a single 301 here from the request proxy (DOMAIN_MODEL.md
 * §19.7); a former `?offset=` or a malformed page is one redirect.
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
  const query = await searchParams;
  const canonical = groupPageCanonicalRedirect(playlistPath(locale, record.slug), query);
  if (canonical !== null) redirect(canonical);
  return <GroupPage locale={locale} record={record} page={readGroupPage(query)} />;
}
