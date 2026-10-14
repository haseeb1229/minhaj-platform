import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { CourseCataloguePage } from '@/components/learning/catalogue';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/learn/courses` — every published Course,
 * `?topic, level, language, format, teacher` (ROUTE_MAP.md §3.5).
 *
 * A filtered or paged view is canonical to this base listing and never a
 * sitemap entry (ROUTE_MAP.md §2.3), exactly as `/watch/videos` and `/fatwa`
 * are; a filter that does not resolve lists nothing and says why.
 * `force-dynamic` because a cached copy would keep offering a withdrawn Course.
 */
export const dynamic = 'force-dynamic';

interface CatalogueParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: CatalogueParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'learn' });
  return shellMetadata({
    locale,
    route: requireRoute('learn.courses'),
    title: t('sections.courses'),
    description: t('sectionBody.courses'),
  });
}

export default async function CoursesPage({ params, searchParams }: CatalogueParams) {
  const locale = await requireLocale(params);
  return <CourseCataloguePage locale={locale} query={await searchParams} />;
}
