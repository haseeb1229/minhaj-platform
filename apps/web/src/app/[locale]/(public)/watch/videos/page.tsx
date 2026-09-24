import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { VideoListingPage } from '@/components/media/watch';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/watch/videos` — every published Video,
 * `?topic, speaker, series, language` (ROUTE_MAP.md §3.7).
 *
 * A filtered view is canonical to this base listing and never a sitemap entry
 * (ROUTE_MAP.md §2.3); `force-dynamic` because a cached copy would keep offering
 * a withdrawn video.
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
    route: requireRoute('watch.videos'),
    title: t('sections.videos'),
    description: t('sectionBody.videos'),
  });
}

export default async function VideosPage({ params, searchParams }: ListingParams) {
  const locale = await requireLocale(params);
  return <VideoListingPage locale={locale} format={null} query={await searchParams} />;
}
