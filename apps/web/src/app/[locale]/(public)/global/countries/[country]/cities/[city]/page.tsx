import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { globalPaths } from '@minhaj/contracts/global';

import { globalReadRuntime } from '@/composition/global-read';
import { CityPage } from '@/components/global/directory';
import { placeLocales, placeName } from '@/components/global/presentation';
import { requireLocale } from '@/config/route-locale';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/global/countries/{countrySlug}/cities/{citySlug}` — one public
 * City, addressed under its Country whether or not it has a Region. A former
 * Country or City slug answers ONE 301 from the request proxy.
 */
export const dynamic = 'force-dynamic';

interface CityParams {
  readonly params: Promise<{
    readonly locale: string;
    readonly country: string;
    readonly city: string;
  }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: CityParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { country, city } = await params;
  const record = await globalReadRuntime().city(country, city);
  if (record === null) return { robots: { index: false, follow: false } };
  return contentMetadata({
    locale,
    title: placeName(record, locale).text,
    contentLocales: placeLocales(record),
    primaryLocale: record.primaryLocale,
    pathFor: (alternate) => globalPaths.city(alternate, record.country.slug, record.slug),
  });
}

export default async function CityRoute({ params, searchParams }: CityParams) {
  const locale = await requireLocale(params);
  const { country, city } = await params;
  const record = await globalReadRuntime().city(country, city);
  if (record === null) notFound();
  return <CityPage locale={locale} city={record} query={await searchParams} />;
}
