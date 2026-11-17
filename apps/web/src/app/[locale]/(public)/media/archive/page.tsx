import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { MediaArchivePage } from '@/components/media/photo-archive';
import {
  mediaArchiveCanonicalRedirect,
  readMediaArchiveView,
} from '@/components/media/photos-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/media/archive` — the historical archive's index: every year and
 * month published photographs were TAKEN, where that is known, each count
 * leading into `/media/photos` for that period (ROUTE_MAP.md §3.9). Only
 * `?year=` is its own (News & Events Part 2); its former `?month=` and
 * `?offset=` are one redirect to the listing for the period they named. Every
 * view is canonical to this base and never a sitemap entry (§2.3, §9.1).
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
  const query = await searchParams;
  const canonical = mediaArchiveCanonicalRedirect(locale, query);
  if (canonical !== null) redirect(canonical);
  return <MediaArchivePage locale={locale} view={readMediaArchiveView(query)} />;
}
