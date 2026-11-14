import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { CourseCataloguePage } from '@/components/learning/catalogue';
import {
  LEARN_COURSES,
  coursesCanonicalRedirect,
  readCatalogueQuery,
} from '@/components/topic-hub/courses-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/learn/courses` — every published Course,
 * `?format, topic, level, language, teacher, sort, page` (ROUTE_MAP.md §3.5;
 * the shared Courses listing since Learn Part 1).
 *
 * ONE ADDRESS PER VIEW: a form's empty controls, another order of the same
 * filters or a former `?offset=` (24 Courses a page until Learn Part 1) is ONE
 * redirect to the canonical spelling. A malformed filter is NOT redirected
 * away: the view stays where it was asked, lists nothing and says why — it
 * never broadens. A filtered or paged view is canonical to this base listing
 * and never a sitemap entry (ROUTE_MAP.md §2.3). `force-dynamic` because a
 * cached copy would keep offering a withdrawn Course.
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
  const query = await searchParams;
  const canonical = coursesCanonicalRedirect(LEARN_COURSES, locale, query);
  if (canonical !== null) redirect(canonical);
  const read = readCatalogueQuery(query);
  return (
    <CourseCataloguePage locale={locale} query={read.query} invalid={read.invalid} />
  );
}
