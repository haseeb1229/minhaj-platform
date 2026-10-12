import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import {
  collectionName,
  collectionPathOf,
  readCollectionSegment,
} from '@/components/hadith/presentation';
import {
  hadithAvailability,
  hadithMetadata,
  readStructure,
} from '@/components/hadith/read';
import { CollectionPage } from '@/components/hadith/structure';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith/collections/{slug}` — one public collection: its sources,
 * then its books in source order (ROUTE_MAP.md §3.4). A collection that is not
 * activated or holds no public citation — or any collection while none is
 * activated — is a 404: the resource is absent, not unavailable.
 */
export const dynamic = 'force-dynamic';

interface CollectionParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

async function load(params: CollectionParams['params']) {
  const { slug } = await params;
  const valid = readCollectionSegment(slug);
  return valid === null ? null : readStructure(valid);
}

export async function generateMetadata({ params }: CollectionParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const found = await load(params);
  if (found === null) return { robots: { index: false, follow: false } };
  const name = collectionName(found.collection.names, locale);
  return hadithMetadata({
    locale,
    availability: await hadithAvailability(),
    canonicalPath: collectionPathOf(found.collection.slug),
    title: name?.text ?? found.collection.slug,
    ...(name?.description == null ? {} : { description: name.description.slice(0, 160) }),
  });
}

export default async function CollectionRoute({ params }: CollectionParams) {
  const locale = await requireLocale(params);
  const [availability, found] = await Promise.all([hadithAvailability(), load(params)]);
  if (!availability.active || found === null) notFound();
  return (
    <CollectionPage
      locale={locale}
      availability={availability}
      collection={found.collection}
      booksOnly={false}
    />
  );
}
