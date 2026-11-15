import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { LibraryResourcesPage } from '@/components/library/resources';
import { resourcesRedirect } from '@/components/library/browse-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library/resources` — every kind of record the Library publishes,
 * with its count and what it holds, and the ways to browse them (Library Part
 * 2; ROUTE_MAP.md §3.6). The page is ONE view: a request carrying the route
 * map's `?type, topic, language, contributor, from, to` is one redirect to
 * that kind's own listing with the filters it takes (`resourcesRedirect`).
 *
 * `force-dynamic`, because every figure here is data an administrator
 * changes: a cached copy would keep offering a record since withdrawn. Signed
 * out, always — nothing here reaches Identity or a cookie.
 */
export const dynamic = 'force-dynamic';

interface BrowseParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: BrowseParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'library' });

  return shellMetadata({
    locale,
    route: requireRoute('library.resources'),
    title: t('section.resources'),
    description: t('sectionBody.resources'),
  });
}

export default async function Page({ params, searchParams }: BrowseParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = resourcesRedirect(locale, query);
  if (canonical !== null) redirect(canonical);
  return <LibraryResourcesPage locale={locale} />;
}
