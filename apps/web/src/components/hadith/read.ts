import 'server-only';

import { cache } from 'react';
import type { Metadata } from 'next';

import { localeSchema, type Locale } from '@minhaj/contracts';
import type { HadithAvailability } from '@minhaj/contracts/hadith';

import { hadithReadRuntime } from '@/composition/hadith-read';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { publicIndexingEnabled } from '@/config/indexing';
import { absoluteUrl } from '@/config/origin';
import { contentMetadata } from '@/seo/metadata';

/**
 * The public Hadith reads a request shares, and the ONE metadata rule every
 * Hadith page follows.
 *
 * READ ONCE PER REQUEST. `generateMetadata` and the page body ask the same
 * questions — is any collection activated, which collection, book or citation
 * is this — so each is wrapped in React's request cache and answered by the
 * reader once.
 *
 * SESSION-FREE BY CONSTRUCTION. Everything here reaches `hadithReadRuntime()`,
 * whose reader takes no actor and returns only what is public now; nothing in
 * this graph reaches Identity, a session or a cookie (ARCHITECTURE.md §8.1).
 */

export const hadithAvailability = cache((): Promise<HadithAvailability> =>
  hadithReadRuntime().reader.availability(),
);

export const readCollections = cache(() => hadithReadRuntime().reader.collections());

export const readCollection = cache((slug: string) =>
  hadithReadRuntime().reader.collection(slug),
);

export const readBooks = cache((collectionId: string) =>
  hadithReadRuntime().reader.books(collectionId),
);

export const readBook = cache((collectionId: string, slug: string) =>
  hadithReadRuntime().reader.book(collectionId, slug),
);

export const readChapter = cache((bookId: string, slug: string) =>
  hadithReadRuntime().reader.chapter(bookId, slug),
);

export const readCitation = cache((collectionSlug: string, number: number) =>
  hadithReadRuntime().reader.citation(collectionSlug, number),
);

export const readScience = cache((slug: string) =>
  hadithReadRuntime().reader.science(slug),
);

/**
 * A collection and, when asked, one of its books and one of that book's
 * chapters — each resolved WITHIN its parent, so a book slug never names
 * another collection's book. `null` as soon as any level is not public now.
 */
export async function readStructure(
  collectionSlug: string,
  bookSlug: string | null = null,
  chapterSlug: string | null = null,
) {
  const collection = await readCollection(collectionSlug);
  if (collection === null) return null;
  if (bookSlug === null) return { collection, book: null, chapter: null };
  const book = await readBook(collection.id, bookSlug);
  if (book === null) return null;
  if (chapterSlug === null) return { collection, book, chapter: null };
  const chapter = await readChapter(book.id, chapterSlug);
  return chapter === null ? null : { collection, book, chapter };
}

/** Taxonomy's foundation slug for the Hadith subject — a vocabulary key, not content. */
export const HADITH_TOPIC_SLUG = 'hadith';

/**
 * The `hadith` Topic Taxonomy seeded with its foundation data (Phase 3B), or
 * `null` when it is absent or archived. The related-material views filter the
 * Library's and Media's own public listings by it; without it there is nothing
 * truthful to filter by and those views do not exist.
 */
export const readHadithTopic = cache(async (locale: Locale) => {
  const topic = await taxonomyRuntime().taxonomy.findTopicBySlug({
    slug: HADITH_TOPIC_SLUG,
    locale,
  });
  return topic !== null && topic.status === 'active' ? topic : null;
});

/** Is this deployment showing non-authoritative fixture text? */
export function isFixture(availability: HadithAvailability): boolean {
  return availability.active && availability.mode === 'fixture';
}

/**
 * May a Hadith page claim anything to a search engine?
 *
 * THREE CONDITIONS, ALL REQUIRED: the deployment may be indexed at all (the
 * pre-adoption origin may not, and the control fails closed); the section is
 * ACTIVE; and its activation is APPROVED. Fixture activation is engineering
 * proof text and is never indexable, whatever the deployment says.
 */
export function hadithIndexable(availability: HadithAvailability): boolean {
  return (
    publicIndexingEnabled() && availability.active && availability.mode === 'approved'
  );
}

/**
 * The interface locales a Hadith page's `BreadcrumbList` may be claimed in:
 * every locale when the page is indexable, and NONE otherwise — so fixture text
 * and an inactive section emit no structured data at all. Nothing but the
 * breadcrumb is ever claimed: no `Article`, author, date, rating or grading.
 */
export function hadithStructuredLocales(
  availability: HadithAvailability,
): readonly Locale[] {
  return hadithIndexable(availability) ? localeSchema.options : [];
}

/** What a page that may not be indexed says: no canonical, no alternates. */
function withheld(title: string, description: string | undefined): Metadata {
  return {
    title,
    ...(description === undefined ? {} : { description }),
    robots: { index: false, follow: false },
  };
}

/**
 * Metadata for one Hadith page.
 *
 * THE PAGE EXISTS IN EVERY INTERFACE LOCALE. A citation page is the sourced
 * text — identical in every locale — inside fully translated chrome, so each
 * locale's address is a genuine version of it and all three are listed, with
 * `x-default` resolved to the English one (ROUTE_MAP.md §9.2.1).
 *
 * `canonicalPath` is LOCALE-FREE. A related-material view passes the owner's
 * collection it canonicalises to.
 */
export function hadithMetadata(input: {
  readonly locale: Locale;
  readonly availability: HadithAvailability;
  readonly canonicalPath: string;
  readonly title: string;
  readonly description?: string;
}): Metadata {
  if (!hadithIndexable(input.availability))
    return withheld(input.title, input.description);

  const languages: Record<string, string> = {};
  for (const locale of localeSchema.options)
    languages[locale] = absoluteUrl(`/${locale}${input.canonicalPath}`);
  languages['x-default'] = absoluteUrl(`/en${input.canonicalPath}`);

  return {
    title: input.title,
    ...(input.description === undefined ? {} : { description: input.description }),
    robots: { index: true, follow: true },
    alternates: {
      canonical: absoluteUrl(`/${input.locale}${input.canonicalPath}`),
      languages,
    },
  };
}

/**
 * Metadata for a Hadith page whose content exists in SOME locales only — a
 * study page written in two languages, a topic view canonical to its hub —
 * through the shared content rule, and still never indexable unless the
 * activation is approved.
 */
export function hadithContentMetadata(
  availability: HadithAvailability,
  input: Parameters<typeof contentMetadata>[0],
): Metadata {
  if (!hadithIndexable(availability)) return withheld(input.title, input.description);
  return contentMetadata(input);
}

/**
 * The search page's directive: `noindex` always, `follow` only on an indexable
 * deployment with an approved activation (ROUTE_MAP.md §9.5).
 */
export function hadithSearchRobots(availability: HadithAvailability): Metadata['robots'] {
  return { index: false, follow: hadithIndexable(availability) };
}
