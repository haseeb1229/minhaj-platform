import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  bookPathOf,
  offsetPathOf,
  readCollectionSegment,
  readHadithOffset,
  readSlugSegment,
} from '@/components/hadith/presentation';
import {
  hadithAvailability,
  hadithMetadata,
  readStructure,
} from '@/components/hadith/read';
import {
  StructurePage,
  collectionText,
  structureText,
} from '@/components/hadith/structure';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith/collections/{slug}/books/{bookSlug}` — one book: its
 * chapters, then the citations placed in it, in bounded pages that each
 * canonicalise to themselves. Every citation links to its short canonical
 * address; this page is structure, not a second address for any narration
 * (ROUTE_MAP.md §2.1, §3.4). A book that is not public now is a 404.
 */
export const dynamic = 'force-dynamic';

interface BookParams {
  readonly params: Promise<{
    readonly locale: string;
    readonly slug: string;
    readonly bookSlug: string;
  }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function load(params: BookParams['params']) {
  const { slug, bookSlug } = await params;
  const collection = readCollectionSegment(slug);
  const book = readSlugSegment(bookSlug);
  if (collection === null || book === null) return null;
  const found = await readStructure(collection, book);
  return found === null || found.book === null ? null : { ...found, book: found.book };
}

export async function generateMetadata({
  params,
  searchParams,
}: BookParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const found = await load(params);
  if (found === null) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const offset = readHadithOffset(await searchParams);
  return hadithMetadata({
    locale,
    availability: await hadithAvailability(),
    canonicalPath: offsetPathOf(
      bookPathOf(found.collection.slug, found.book.slug),
      offset,
    ),
    title: `${structureText(found.book, locale, t, 'book')} · ${collectionText(found.collection, locale)}`,
  });
}

export default async function BookRoute({ params, searchParams }: BookParams) {
  const locale = await requireLocale(params);
  const [availability, found] = await Promise.all([hadithAvailability(), load(params)]);
  if (!availability.active || found === null) notFound();
  return (
    <StructurePage
      locale={locale}
      availability={availability}
      collection={found.collection}
      book={found.book}
      chapter={null}
      offset={readHadithOffset(await searchParams)}
    />
  );
}
