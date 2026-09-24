import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { TrackListingPage } from '@/components/media/listen';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/listen/lectures` — every published non-Quran audio track,
 * `?topic, speaker, series, language` (ROUTE_MAP.md §3.7).
 *
 * A filtered view is canonical to this base listing and never a sitemap entry
 * (ROUTE_MAP.md §2.3); `force-dynamic` because a cached copy would keep offering
 * a withdrawn recording.
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
    route: requireRoute('listen.lectures'),
    title: t('sections.lectures'),
    description: t('sectionBody.lectures'),
  });
}

export default async function LecturesPage({ params, searchParams }: ListingParams) {
  const locale = await requireLocale(params);
  return <TrackListingPage locale={locale} query={await searchParams} />;
}
