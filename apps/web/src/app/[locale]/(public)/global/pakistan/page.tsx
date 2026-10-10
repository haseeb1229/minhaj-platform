import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { PAKISTAN_CODE, globalPaths } from '@minhaj/contracts/global';

import { globalReadRuntime } from '@/composition/global-read';
import { PakistanPage } from '@/components/global/directory';
import { publicIndexingEnabled } from '@/config/indexing';
import { absoluteUrl } from '@/config/origin';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/global/pakistan` — the Pakistan structure ENTRY POINT
 * (ROUTE_MAP.md §3.9). It reads the ordinary Pakistan Country (ISO `PK`) and
 * shows its public Regions and Cities as a structure. It is a view of that
 * Country, not a second resource: its canonical link points at the Country's
 * own page — as a domain topic view's points at its hub (§2.2) — and it is
 * never a sitemap entry, so two Pakistan pages never compete. With no public
 * Pakistan record it claims nothing and is not indexable.
 */
export const dynamic = 'force-dynamic';

interface PakistanParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: PakistanParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'global' });
  const country = await globalReadRuntime().countryByCode(PAKISTAN_CODE);
  const title = t('sections.pakistan');
  // A canonical link is a claim; it is made only when indexing is switched on
  // and the Country it points at genuinely exists (ROUTE_MAP.md §9.5).
  if (country === null || !publicIndexingEnabled())
    return { title, robots: { index: false, follow: false } };
  return {
    title,
    description: t('pakistan.intro'),
    robots: { index: true, follow: true },
    alternates: { canonical: absoluteUrl(globalPaths.country(locale, country.slug)) },
  };
}

export default async function PakistanRoute({ params }: PakistanParams) {
  const locale = await requireLocale(params);
  const country = await globalReadRuntime().countryByCode(PAKISTAN_CODE);
  return <PakistanPage locale={locale} country={country} />;
}
