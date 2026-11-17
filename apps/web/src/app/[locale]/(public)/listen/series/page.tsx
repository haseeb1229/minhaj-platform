import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { groupsCanonicalRedirect, readGroupsView } from '@/components/media/groups-view';
import { AudioSeriesDirectoryPage } from '@/components/media/listen-series';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/listen/series` — every published AudioSeries, `?q, language,
 * speaker, topic, sort, page` (ROUTE_MAP.md §3.7; rebuilt in Watch Part 3 on
 * Watch Part 2's directory rules, kind `audio`). Not the Watch series: an
 * audio series groups recordings, not videos.
 *
 * ONE ADDRESS PER VIEW: a form's empty controls, another order, a malformed or
 * repeated value and the former `?offset=` pager are each one redirect.
 */
export const dynamic = 'force-dynamic';

interface ListingParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ListingParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'listen' });
  return shellMetadata({
    locale,
    route: requireRoute('listen.series'),
    title: t('sections.series'),
    description: t('sectionBody.series'),
  });
}

export default async function AudioSeriesRoute({ params, searchParams }: ListingParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = groupsCanonicalRedirect('audio', locale, query);
  if (canonical !== null) redirect(canonical);
  return (
    <AudioSeriesDirectoryPage locale={locale} view={readGroupsView(query, 'audio')} />
  );
}
