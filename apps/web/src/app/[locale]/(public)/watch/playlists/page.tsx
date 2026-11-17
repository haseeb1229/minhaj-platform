import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { GroupDirectoryPage } from '@/components/media/groups';
import { groupsCanonicalRedirect, readGroupsView } from '@/components/media/groups-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/watch/playlists` — published playlists (ROUTE_MAP.md §3.7): the
 * directory, `?q, language, speaker, topic, sort, page` (Watch Part 2), one
 * address per view. Signed out; `force-dynamic` because a cached copy would
 * keep a withdrawn one.
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
  const query = await searchParams;
  const canonical = groupsCanonicalRedirect('playlist', locale, query);
  if (canonical !== null) redirect(canonical);
  return (
    <GroupDirectoryPage locale={locale} kind="playlist" view={readGroupsView(query)} />
  );
}
