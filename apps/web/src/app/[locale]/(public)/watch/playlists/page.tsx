import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PlaylistListingPage } from '@/components/media/watch';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/watch/playlists` — published playlists (ROUTE_MAP.md §3.7).
 * Signed out; `force-dynamic` because a cached copy would keep a withdrawn one.
 */
export const dynamic = 'force-dynamic';

interface ListingParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ListingParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'watch' });
  return shellMetadata({
    locale,
    route: requireRoute('watch.playlists'),
    title: t('sections.playlists'),
    description: t('sectionBody.playlists'),
  });
}

export default async function PlaylistsPage({ params, searchParams }: ListingParams) {
  const locale = await requireLocale(params);
  return <PlaylistListingPage locale={locale} query={await searchParams} />;
}
