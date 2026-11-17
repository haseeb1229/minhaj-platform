import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';

import { CollectionDetailPage, readCollection } from '@/components/editorial/collections';
import { collectionMetadata } from '@/components/editorial/collection-presentation';
import { collectionOrderRedirect } from '@/components/editorial/collections-view';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/collections/{slug}` — one published Collection at its current
 * slug. A former slug never reaches here: the request proxy answers it with one
 * 301 to the current address (ROUTE_MAP.md §9.7). An unpublished, archived or
 * unknown slug is a 404, signed in or not. `?order=newest|oldest` reads its
 * members by date (R2); every order is canonical to the bare address, and any
 * other spelling of an order (`?order=curated`, an unknown or repeated one) is
 * ONE redirect to the view's own address (News & Events Part 2).
 */
export const dynamic = 'force-dynamic';

interface CollectionParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: CollectionParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await readCollection(slug);
  return record === null
    ? { robots: { index: false, follow: false } }
    : collectionMetadata(record, locale);
}

export default async function CollectionRoute({
  params,
  searchParams,
}: CollectionParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const record = await readCollection(slug);
  if (record === null) notFound();
  const query = await searchParams;
  const canonical = collectionOrderRedirect(locale, record.slug, query);
  if (canonical !== null) redirect(canonical);
  return <CollectionDetailPage locale={locale} record={record} query={query} />;
}
