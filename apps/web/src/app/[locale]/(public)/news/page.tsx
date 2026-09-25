import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { NewsLandingPage } from '@/components/editorial/news';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/news` — News and Events, the latest NewsArticles first
 * (ROUTE_MAP.md §3.9). `?sort=latest` names the only order that exists, so it
 * is a query on this one resource and canonical to `/news`, never a path of its
 * own (§2.3); neither it nor a later page is a sitemap entry.
 */
export const dynamic = 'force-dynamic';

interface NewsParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: NewsParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'news' });
  return shellMetadata({
    locale,
    route: requireRoute('news-events'),
    title: t('title'),
    description: t('description'),
  });
}

export default async function NewsPage({ params, searchParams }: NewsParams) {
  const locale = await requireLocale(params);
  return <NewsLandingPage locale={locale} query={await searchParams} />;
}
