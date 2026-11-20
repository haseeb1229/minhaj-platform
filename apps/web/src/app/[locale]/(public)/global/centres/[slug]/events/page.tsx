import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { globalPaths } from '@minhaj/contracts/global';

import { globalReadRuntime } from '@/composition/global-read';
import { CentreEventsPage } from '@/components/global/centre-activity';
import { centreWords, placeLocales } from '@/components/global/presentation';
import { requireLocale } from '@/config/route-locale';
import {
  centreEventsCanonicalRedirect,
  readCentreEventsView,
} from '@/components/global/global-view';
import { contentMetadata } from '@/seo/metadata';

/**
 * `/{locale}/global/centres/{centreSlug}/events` — the Centre's published
 * Events, upcoming by default and `?when=past` for those held: Editorial's own
 * bounded read by the Centre's identifier, composed here. Not public when the
 * Centre is not; the `when` query is canonical to this address. `?page` (R2),
 * with Phase 16's `?offset=` one redirect; an unknown `when` is refused where
 * it was asked.
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
  const query = await searchParams;
  const canonical = centreEventsCanonicalRedirect(
    globalPaths.centreEvents(locale, record.slug),
    query,
  );
  if (canonical !== null) redirect(canonical);
  return (
    <CentreEventsPage
      locale={locale}
      centre={record}
      view={readCentreEventsView(query)}
    />
  );
}
