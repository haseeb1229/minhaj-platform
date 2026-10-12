import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  chapterPathOf,
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
 * `/{locale}/hadith/collections/{slug}/books/{bookSlug}/chapters/{chapterSlug}`
 * — one chapter's citations in bounded pages, each linked to its short
 * canonical address (ROUTE_MAP.md §2.1, §3.4). The chapter is resolved within
 * its book and the book within its collection; anything not public now is a
 * 404.
 */
export const dynamic = 'force-dynamic';

interface ChapterParams {
  readonly params: Promise<{
    readonly locale: string;
    readonly slug: string;
    readonly bookSlug: string;
    readonly chapterSlug: string;
  }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function load(params: ChapterParams['params']) {
  const { slug, bookSlug, chapterSlug } = await params;
  const collection = readCollectionSegment(slug);
  const book = readSlugSegment(bookSlug);
  const chapter = readSlugSegment(chapterSlug);
  if (collection === null || book === null || chapter === null) return null;
  const found = await readStructure(collection, book, chapter);
  return found === null || found.book === null || found.chapter === null
    ? null
    : { collection: found.collection, book: found.book, chapter: found.chapter };
}

export async function generateMetadata({
  params,
  searchParams,
}: ChapterParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const found = await load(params);
  if (found === null) return { robots: { index: false, follow: false } };
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const offset = readHadithOffset(await searchParams);
  return hadithMetadata({
    locale,
    availability: await hadithAvailability(),
    canonicalPath: offsetPathOf(
      chapterPathOf(found.collection.slug, found.book.slug, found.chapter.slug),
      offset,
    ),
    title: `${structureText(found.chapter, locale, t, 'chapter')} · ${collectionText(found.collection, locale)}`,
  });
}

export default async function ChapterRoute({ params, searchParams }: ChapterParams) {
  const locale = await requireLocale(params);
  const [availability, found] = await Promise.all([hadithAvailability(), load(params)]);
  if (!availability.active || found === null) notFound();
  return (
    <StructurePage
      locale={locale}
      availability={availability}
      collection={found.collection}
      book={found.book}
      chapter={found.chapter}
      offset={readHadithOffset(await searchParams)}
    />
  );
}
