import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  collectionBooksPathOf,
  collectionName,
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
 * `/{locale}/hadith/collections/{slug}/books` — the books of one public
 * collection that hold at least one public citation, in source order
 * (ROUTE_MAP.md §3.4). Absent collections are a 404.
 */
export const dynamic = 'force-dynamic';

interface BooksParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
}

async function load(params: BooksParams['params']) {
  const { slug } = await params;
  const valid = readCollectionSegment(slug);
  return valid === null ? null : readStructure(valid);
}

export async function generateMetadata({ params }: BooksParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const found = await load(params);
  if (found === null) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const name = collectionName(found.collection.names, locale);
  return hadithMetadata({
    locale,
    availability: await hadithAvailability(),
    canonicalPath: collectionBooksPathOf(found.collection.slug),
    title: `${t('books')} · ${name?.text ?? found.collection.slug}`,
  });
}

export default async function CollectionBooksRoute({ params }: BooksParams) {
  const locale = await requireLocale(params);
  const [availability, found] = await Promise.all([hadithAvailability(), load(params)]);
  if (!availability.active || found === null) notFound();
  return (
    <CollectionPage
      locale={locale}
      availability={availability}
      collection={found.collection}
      booksOnly
    />
  );
}
