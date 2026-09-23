import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { FacetBrowse } from '@/components/library/facet-browse';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library/languages` — Library Works grouped by the CONTENT language of their Editions.
 *
 * A THIN ROUTE OVER ONE SHARED BROWSE. The three facet browses differ only in
 * which aggregate they read and where a row links, so they share an
 * implementation rather than repeating one three times (see
 * `@/components/library/facet-browse`).
 *
 * `force-dynamic`, because the facet counts are data an administrator changes.
 * A cached copy would keep offering a heading whose only Works have since been
 * withdrawn.
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

  return <FacetBrowse locale={locale} kind="languages" query={await searchParams} />;
}
