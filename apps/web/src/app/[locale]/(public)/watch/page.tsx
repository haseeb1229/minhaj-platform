import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { readWatchSort } from '@/components/media/presentation';
import { WatchLandingPage } from '@/components/media/watch';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/watch` — the Watch landing, `?sort=featured|latest`
 * (ROUTE_MAP.md §3.7).
 *
 * The sort is a query on one resource, so both views are canonical to `/watch`
 * and neither is a sitemap entry of its own (ROUTE_MAP.md §2.3). Signed out,
 * and `force-dynamic` because the videos on it are published and withdrawn.
 */
export const dynamic = 'force-dynamic';

interface WatchParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: WatchParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'watch' });
  return shellMetadata({
    locale,
    route: requireRoute('watch'),
    title: t('title'),
    description: t('description'),
  });
}

export default async function WatchPage({ params, searchParams }: WatchParams) {
  const locale = await requireLocale(params);
  return <WatchLandingPage locale={locale} sort={readWatchSort(await searchParams)} />;
}
