import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { EventGalleryPage, readEvent } from '@/components/editorial/events';
import { translationFor } from '@/components/editorial/presentation';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/events/{slug}/gallery` — the Event's photographs: a navigational
 * view over the Media Galleries it associates, each linking to its own
 * canonical page. `noindex, follow` and no canonical claim: the Galleries are
 * Media's resources, and this page is never a sitemap entry. An Event that
 * associates no Gallery has no gallery view at all (404).
 */
export const dynamic = 'force-dynamic';

interface EventGalleryParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

export async function generateMetadata({
  params,
}: EventGalleryParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await readEvent(slug);
  if (record === null || record.galleryIds.length === 0)
    return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'events' });
  return {
    title: `${t('galleryTitle')} — ${translationFor(record, locale).title}`,
    robots: { index: false, follow: true },
  };
}

export default async function EventGalleryRoute({ params }: EventGalleryParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await readEvent(slug);
  if (record === null || record.galleryIds.length === 0) notFound();
  return <EventGalleryPage locale={locale} record={record} />;
}
