import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { AudioSeriesListingPage } from '@/components/media/listen';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/listen/series` — every published AudioSeries (ROUTE_MAP.md §3.7).
 * Not the Watch series: an audio series groups recordings, not videos.
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

export default async function AudioSeriesPage({ params, searchParams }: ListingParams) {
  const locale = await requireLocale(params);
  return <AudioSeriesListingPage locale={locale} query={await searchParams} />;
}
