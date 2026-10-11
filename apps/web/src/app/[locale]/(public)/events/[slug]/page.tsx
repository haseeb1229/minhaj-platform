import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { EventDetailPage, readEvent } from '@/components/editorial/events';
import { eventMetadata } from '@/components/editorial/event-presentation';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/events/{slug}` — one published Event at its current slug. A former
 * slug never reaches here: the request proxy answers it with one 301 to the
 * current address (ROUTE_MAP.md §9.7). An unpublished, archived or unknown slug
 * is a 404, signed in or not.
 */
export const dynamic = 'force-dynamic';

interface EventParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

export async function generateMetadata({ params }: EventParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await readEvent(slug);
  return record === null
    ? { robots: { index: false, follow: false } }
    : eventMetadata(record, locale);
}

export default async function EventRoute({ params }: EventParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await readEvent(slug);
  if (record === null) notFound();
  return <EventDetailPage locale={locale} record={record} />;
}
