import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { LibraryBooksPage } from '@/components/library/books';
import {
  LIBRARY_BOOKS,
  booksCanonicalRedirect,
  readBooksQuery,
} from '@/components/topic-hub/books-view';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';

/**
 * `/{locale}/library/books` — every published book (ROUTE_MAP.md §3.6; the
 * shared Books listing since Library Part 1),
 * `?topic, language, contributor, from, to, readable, downloads, sort, page`.
 *
 * BOUNDED, DETERMINISTIC AND FILTERED IN SQL. Library's `topicWorks` returns
 * one page of 24 in a total order with the total the view admits; every
 * filter is part of the query, never applied to a loaded corpus (§31, §49).
 *
 * ONE ADDRESS PER VIEW. The filters are a GET form of plain controls, so they
 * work without JavaScript and every view is shareable; a form's empty
 * controls, another order of the same parameters, a malformed value or a
 * former `?offset=` (25 Works a page until Library Part 1) is ONE redirect to
 * the canonical spelling, built from the parsed view — never from the typed
 * text. A filtered, ordered or paged view is "indexable but canonical to the
 * base, and excluded from sitemaps" (ROUTE_MAP.md §2.3, §9.4), so the
 * metadata below canonicalises every view to the bare listing.
 *
 * THE INTERFACE LOCALE DOES NOT FILTER CONTENT: `/ur/library/books` is the
 * Library in Urdu listing books in every content language (§1.5).
 *
 * SIGNED OUT, ALWAYS, and `force-dynamic` because a cached copy would keep
 * offering a withdrawn book.
 */
export const dynamic = 'force-dynamic';

interface ListingParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ListingParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'library' });
  return shellMetadata({
    locale,
    route: requireRoute('library.books'),
    title: t('books'),
    description: t('booksDescription'),
  });
}

export default async function BooksPage({ params, searchParams }: ListingParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const canonical = booksCanonicalRedirect(LIBRARY_BOOKS, locale, query);
  if (canonical !== null) redirect(canonical);
  return (
    <LibraryBooksPage locale={locale} query={readBooksQuery(LIBRARY_BOOKS, query)} />
  );
}
