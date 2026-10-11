import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { globalPaths } from '@minhaj/contracts/global';

import { globalReadRuntime } from '@/composition/global-read';
import { CentreEventsPage } from '@/components/global/centre';
import { centreWords, placeLocales } from '@/components/global/presentation';
import { requireLocale } from '@/config/route-locale';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/global/centres/{centreSlug}/events` — the Centre's published
 * Events, upcoming by default and `?when=past` for those held: Editorial's own
 * bounded read by the Centre's identifier, composed here. Not public when the
 * Centre is not; the `when` query is canonical to this address.
 */
export const dynamic = 'force-dynamic';

interface CentreEventsParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({
  params,
}: CentreEventsParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await globalReadRuntime().centre(slug);
  if (record === null) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'global' });
  return contentMetadata({
    locale,
    title: t('centreEvents.title', { centre: centreWords(record, locale)?.name ?? slug }),
    contentLocales: placeLocales(record),
    primaryLocale: record.primaryLocale,
    pathFor: (alternate) => globalPaths.centreEvents(alternate, record.slug),
  });
}

export default async function CentreEventsRoute({
  params,
  searchParams,
}: CentreEventsParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await globalReadRuntime().centre(slug);
  if (record === null) notFound();
  return <CentreEventsPage locale={locale} centre={record} query={await searchParams} />;
}
