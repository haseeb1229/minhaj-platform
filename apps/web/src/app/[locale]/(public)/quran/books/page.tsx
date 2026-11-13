import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { QuranBooksPage } from '@/components/quran/books';
import {
  BOOKS_PATH,
  booksCanonicalRedirect,
  readBooksQuery,
} from '@/components/quran/books-view';
import { QuranUnavailable } from '@/components/quran/parts';
import { quranAvailability, quranMetadata } from '@/components/quran/read';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/quran/books` — THE QURAN BOOKS HUB (Quran Part 10; ROUTE_MAP.md
 * §3.3): Library's public Works on Taxonomy's `quran` Topic and every public
 * Work that explains a Quran passage, composed at Layer 4 from Library's own
 * public reads — shelves, a Surah, a content language, a contributor, an
 * order and a page, each a GET parameter, every view at ONE address (any
 * other spelling of it is one redirect there).
 *
 * CANONICAL TO ITSELF, the bare path, since Part 10: the hub is a curated
 * navigational view of its own (ROUTE_MAP.md §2.3), no longer a mirror of the
 * Library's topic-filtered listing; every filtered or paged view canonicalises
 * to it. While the corpus is not approved the page claims no canonical at all
 * (`quranMetadata`).
 *
 * Signed out and `force-dynamic`: every part is mutable public data. The
 * honest unavailable state while no corpus is active, as on every Quran page.
 */
export const dynamic = 'force-dynamic';

interface BooksParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: BooksParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'quran' });
  return quranMetadata({
    locale,
    availability: await quranAvailability(),
    canonicalPath: BOOKS_PATH,
    title: t('sections.books'),
    description: t('sectionBody.books'),
  });
}

export default async function QuranBooksRoute({ params, searchParams }: BooksParams) {
  const locale = await requireLocale(params);
  const availability = await quranAvailability();
  if (!availability.active) {
    const t = await getTranslations({ locale, namespace: 'quran' });
    return <QuranUnavailable locale={locale} section={t('sections.books')} />;
  }
  const query = await searchParams;
  // One address per view: a form's empty controls, a malformed value or
  // another order is ONE redirect to the canonical spelling.
  const canonical = booksCanonicalRedirect(locale, query);
  if (canonical !== null) redirect(canonical);
  return (
    <QuranBooksPage
      locale={locale}
      availability={availability}
      query={readBooksQuery(query)}
    />
  );
}
