import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { NewsArchivePage } from '@/components/editorial/news';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/news/archive` — every published News record by the year and month
 * it was published, `?year=` and `?month=` (ROUTE_MAP.md §3.9). A filtered view
 * is canonical to this base and never a sitemap entry (§2.3, §9.1); there is no
 * year or month path hierarchy.
 */
export const dynamic = 'force-dynamic';

interface ArchiveParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ArchiveParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'news' });
  return shellMetadata({
    locale,
    route: requireRoute('news.archive'),
    title: t('archive'),
    description: t('archiveBody'),
  });
}

export default async function NewsArchiveRoute({ params, searchParams }: ArchiveParams) {
  const locale = await requireLocale(params);
  return <NewsArchivePage locale={locale} query={await searchParams} />;
}
