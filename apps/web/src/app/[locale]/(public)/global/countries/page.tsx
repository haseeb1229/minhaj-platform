import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { CountriesPage } from '@/components/global/directory';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/** `/{locale}/global/countries` — every public Country, by world region. */
export const dynamic = 'force-dynamic';

interface CountriesParams {
  readonly params: Promise<{ readonly locale: string }>;
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

export default async function CountriesRoute({ params }: CountriesParams) {
  const locale = await requireLocale(params);
  return <CountriesPage locale={locale} />;
}
