import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { globalPaths } from '@minhaj/contracts/global';

import { globalReadRuntime } from '@/composition/global-read';
import { CountryPage } from '@/components/global/places';
import { placeLocales, placeName } from '@/components/global/presentation';
import { requireLocale } from '@/config/route-locale';
import { placeCanonicalRedirect, readPlaceView } from '@/components/global/global-view';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/global/countries/{countrySlug}` â€” one public Country. A former
 * slug answers a single 301 from the request proxy (DOMAIN_MODEL.md Â§19.7);
 * its alternates are the languages its name genuinely exists in. `?page` pages
 * its Centres and `?cityPage` its Cities (R2); Phase 16's `?offset=` and
 * `?cities=` are one redirect each.
 */
export const dynamic = 'force-dynamic';

interface CountryParams {
  readonly params: Promise<{ readonly locale: string; readonly country: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: CountryParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { country: slug } = await params;
  const record = await globalReadRuntime().country(slug);
  if (record === null) return { robots: { index: false, follow: false } };
  return contentMetadata({
    locale,
    title: placeName(record, locale).text,
    contentLocales: placeLocales(record),
    primaryLocale: record.primaryLocale,
    pathFor: (alternate) => globalPaths.country(alternate, record.slug),
  });
}

export default async function CountryRoute({ params, searchParams }: CountryParams) {
  const locale = await requireLocale(params);
  const { country: slug } = await params;
  const record = await globalReadRuntime().country(slug);
  if (record === null) notFound();
  const query = await searchParams;
  const canonical = placeCanonicalRedirect(
    globalPaths.country(locale, record.slug),
    query,
    true,
  );
  if (canonical !== null) redirect(canonical);
  return (
    <CountryPage locale={locale} country={record} view={readPlaceView(query, true)} />
  );
}
