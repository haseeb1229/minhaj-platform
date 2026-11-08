import { localizedPath } from '@minhaj/contracts';
import type { Locale } from '@minhaj/contracts';
import type { ScholarlyListing, WorkRecord } from '@minhaj/contracts/library';
import { getTranslations } from 'next-intl/server';

import { PeriodicalCard, WorkCard } from '@/components/library/cards';
import { SectionHeader } from '@/components/ui';
import { Shelf } from '@/components/ui/shelf';

import { HomeSection } from './section';

/**
 * THE LIBRARY ON THE HOME PAGE (R2): a shelf of book covers and a rack of the
 * latest magazine issues — the moments the audit found that "feel like
 * Minhaj". The Library's own cards, so a book looks the same here as on its
 * shelf in the Library.
 */
export async function BooksShelf({
  locale,
  works,
}: {
  readonly locale: Locale;
  readonly works: readonly WorkRecord[];
}) {
  if (works.length === 0) return null;
  const [t, library] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'library' }),
  ]);
  const heading = t('home.library.heading');

  return (
    <HomeSection id="home-books" band="sunken">
      <Shelf
        label={heading}
        size="cover"
        previousLabel={t('home.shelf.previous')}
        nextLabel={t('home.shelf.next')}
        header={
          <SectionHeader
            id="home-books"
            heading={heading}
            action={{
              href: localizedPath(locale, '/library/books'),
              text: library('allBooks'),
            }}
          />
        }
      >
        {works.map((work) => (
          <WorkCard key={work.id} locale={locale} work={work} />
        ))}
      </Shelf>
    </HomeSection>
  );
}

/** The newest issues across every magazine, each by its own cover. */
export async function MagazineRack({
  locale,
  issues,
}: {
  readonly locale: Locale;
  readonly issues: readonly ScholarlyListing[];
}) {
  if (issues.length === 0) return null;
  const [t, library] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'library' }),
  ]);
  const heading = t('home.magazines.heading');

  return (
    <HomeSection id="home-magazines">
      <Shelf
        label={heading}
        size="cover"
        previousLabel={t('home.shelf.previous')}
        nextLabel={t('home.shelf.next')}
        header={
          <SectionHeader
            id="home-magazines"
            heading={heading}
            action={{
              href: localizedPath(locale, '/library/magazines'),
              text: t('home.magazines.all'),
            }}
          />
        }
      >
        {issues.map((issue) => (
          <PeriodicalCard key={issue.id} locale={locale} row={issue} t={library} />
        ))}
      </Shelf>
    </HomeSection>
  );
}
