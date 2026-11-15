import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';

import { BooksHub } from '@/components/topic-hub/books';
import { LIBRARY_BOOKS, type BooksQuery } from '@/components/topic-hub/books-view';
import { Breadcrumbs, Container } from '@/components/ui';

/**
 * `/library/books` — EVERY BOOK IN THE LIBRARY (ROUTE_MAP.md §3.6; Library
 * Part 1): the shared Books listing (`@/components/topic-hub/books`) over the
 * whole Library — figures, the featured shelf, filters with counts (Topic,
 * content language, author, a publication-year range, readable online and
 * downloadable), active-filter chips, two orders and numbered pages — read
 * with `scope: 'library'`, exactly as the Quran and Hadith hubs read their
 * Topic.
 *
 * THE INTERFACE LOCALE DOES NOT FILTER CONTENT: `/ur/library/books` lists
 * books in every content language (ROUTE_MAP.md §1.5); a content language is
 * a filter the visitor chooses. Titles and descriptions are descriptive
 * metadata, which the hero says. Signed out, always: nothing here can reach
 * Identity or a cookie.
 */
export async function LibraryBooksPage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: BooksQuery;
}) {
  const [t, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'library' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  const title = t('books');
  const link = (path: string, text: string) => ({
    href: localizedPath(locale, path),
    text,
  });

  return (
    <BooksHub
      domain={{
        key: 'library',
        locale,
        topicId: null,
        title,
        frame: (children) => (
          <Container>
            <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
              <Breadcrumbs
                label={shell('nav.breadcrumbs')}
                trail={[
                  { href: localizedPath(locale, ''), text: shell('nav.home') },
                  { href: localizedPath(locale, '/library'), text: t('title') },
                  { text: title },
                ]}
              />
              {children}
            </div>
          </Container>
        ),
        previous: t('previous'),
        next: t('next'),
      }}
      scope={LIBRARY_BOOKS}
      query={query}
      copy={{
        eyebrow: t('title'),
        lede: t('booksDescription'),
        notice: t('metadataNotice'),
        stat: (count) => t('booksPage.stat', { count }),
        listIntro: t('booksPage.listIntro'),
        emptyTitle: t('booksPage.emptyTitle'),
        empty: t('empty'),
        noResults: t('booksPage.noResults'),
        about: t('booksPage.about'),
      }}
      actions={[
        link('/library/topics', t('section.topics')),
        link('/library/authors', t('section.authors')),
        link('/library/languages', t('section.languages')),
      ]}
      passages={null}
      onward={[
        link('/quran/books', t('booksPage.quranBooks')),
        link('/hadith/books', t('booksPage.hadithBooks')),
        link('/library', t('booksPage.libraryHome')),
      ]}
    />
  );
}
