import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { globalPaths } from '@minhaj/contracts/global';

import { globalReadRuntime } from '@/composition/global-read';
import { RegionPage } from '@/components/global/places';
import { placeLocales, placeName } from '@/components/global/presentation';
import { requireLocale } from '@/config/route-locale';
import { placeCanonicalRedirect, readPlaceView } from '@/components/global/global-view';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/global/countries/{countrySlug}/regions/{regionSlug}` â€” one public
 * Region of a public Country. A former Country or Region slug, or both,
 * answers ONE 301 to the current address from the request proxy. `?page`
 * pages its Centres and `?cityPage` its Cities (R2).
 */
export const dynamic = 'force-dynamic';

interface RegionParams {
  readonly params: Promise<{
    readonly locale: string;
    readonly country: string;
    readonly region: string;
  }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: RegionParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { country, region } = await params;
  const record = await globalReadRuntime().region(country, region);
  if (record === null) return { robots: { index: false, follow: false } };
  return contentMetadata({
    locale,
    title: placeName(record, locale).text,
    contentLocales: placeLocales(record),
    primaryLocale: record.primaryLocale,
    pathFor: (alternate) =>
      globalPaths.region(alternate, record.country.slug, record.slug),
  });
}

export default async function RegionRoute({ params, searchParams }: RegionParams) {
  const locale = await requireLocale(params);
  const { country, region } = await params;
  const record = await globalReadRuntime().region(country, region);
  if (record === null) notFound();
  const query = await searchParams;
  const canonical = placeCanonicalRedirect(
    globalPaths.region(locale, record.country.slug, record.slug),
    query,
    true,
  );
  if (canonical !== null) redirect(canonical);
  return <RegionPage locale={locale} region={record} view={readPlaceView(query, true)} />;
}
