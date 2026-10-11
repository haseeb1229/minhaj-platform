import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { CollectionDetailPage, readCollection } from '@/components/editorial/collections';
import { collectionMetadata } from '@/components/editorial/collection-presentation';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/collections/{slug}` — one published Collection at its current
 * slug. A former slug never reaches here: the request proxy answers it with one
 * 301 to the current address (ROUTE_MAP.md §9.7). An unpublished, archived or
 * unknown slug is a 404, signed in or not.
 */
export const dynamic = 'force-dynamic';

interface CollectionParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

export async function generateMetadata({ params }: CollectionParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await readCollection(slug);
  return record === null
    ? { robots: { index: false, follow: false } }
    : collectionMetadata(record, locale);
}

export default async function CollectionRoute({ params }: CollectionParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await readCollection(slug);
  if (record === null) notFound();
  return <CollectionDetailPage locale={locale} record={record} />;
}
