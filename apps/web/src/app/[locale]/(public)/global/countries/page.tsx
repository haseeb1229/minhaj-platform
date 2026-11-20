import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { globalPaths } from '@minhaj/contracts/global';

import { CountriesPage } from '@/components/global/directory';
import {
  countriesCanonicalRedirect,
  readCountriesView,
} from '@/components/global/global-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/global/countries` — every public Country, by world region, with
 * `?region` (a world region) and `?page` (24 a page; R2). A view that means
 * something has ONE address — empty controls, another order, a malformed page
 * and Phase 16's `?offset=` are one redirect each — and an unknown region is
 * refused where it was asked (`countriesCanonicalRedirect`). Every view is
 * canonical to the bare listing and none is a sitemap entry.
 */
export const dynamic = 'force-dynamic';

interface CountriesParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: CountriesParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'global' });
  return shellMetadata({
    locale,
    route: requireRoute('global.countries'),
    title: t('sections.countries'),
    description: t('countriesIntro'),
  });
}

export default async function CountriesRoute({ params, searchParams }: CountriesParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = countriesCanonicalRedirect(globalPaths.countries(locale), query);
  if (canonical !== null) redirect(canonical);
  return <CountriesPage locale={locale} view={readCountriesView(query)} />;
}
