import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { ArchivePage } from '@/components/media/photos';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/media/archive` — the historical archive: published photographs
 * whose date is KNOWN, latest first, `?year=` and `?month=` (ROUTE_MAP.md
 * §3.9). A filtered view is canonical to this base and never a sitemap entry
 * (§2.3, §9.1).
 */
export const dynamic = 'force-dynamic';

interface ArchiveParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ArchiveParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'photos' });
  return shellMetadata({
    locale,
    route: requireRoute('media.archive'),
    title: t('sections.archive'),
    description: t('sectionBody.archive'),
  });
}

export default async function ArchiveRoute({ params, searchParams }: ArchiveParams) {
  const locale = await requireLocale(params);
  return <ArchivePage locale={locale} query={await searchParams} />;
}
