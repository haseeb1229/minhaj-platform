import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { NewsArchivePage } from '@/components/editorial/news-archive';
import {
  newsArchiveCanonicalRedirect,
  readNewsArchiveView,
} from '@/components/editorial/news-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/news/archive` — every published News record by the year and month
 * of its chronology, `?year=` (ROUTE_MAP.md §3.9). An index into the family
 * listings since News & Events Part 1: its former listing parameters
 * (`?type`, `?lang`, `?month`, `?offset`) are one redirect each — to that
 * family's listing for the period, or to the archive's year. A year view is
 * canonical to this base and never a sitemap entry (§2.3, §9.1); there is no
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
  const query = await searchParams;
  const canonical = newsArchiveCanonicalRedirect(locale, query);
  if (canonical !== null) redirect(canonical);
  return <NewsArchivePage locale={locale} view={readNewsArchiveView(query)} />;
}
