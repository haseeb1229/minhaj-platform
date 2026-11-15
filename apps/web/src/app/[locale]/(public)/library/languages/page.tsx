import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { LibraryLanguagesPage } from '@/components/library/languages';
import { bareRedirect } from '@/components/library/browse-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library/languages` — the Library by CONTENT language (never
 * the interface language): each language named by Taxonomy in its own script,
 * with its public records by kind, each count leading to that kind's listing
 * in the language (Library Part 2; ROUTE_MAP.md §3.6). One view: a former
 * `?offset=` is one redirect to the page.
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
    route: requireRoute('library.languages'),
    title: t('section.languages'),
    description: t('sectionBody.languages'),
  });
}

export default async function Page({ params, searchParams }: BrowseParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = bareRedirect(locale, '/library/languages', query);
  if (canonical !== null) redirect(canonical);
  return <LibraryLanguagesPage locale={locale} />;
}
