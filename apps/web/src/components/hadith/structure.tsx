import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  HADITH_PAGE,
  type HadithAvailability,
  type PublicHadithCitationPage,
  type PublicHadithCollection,
  type PublicHadithBook,
  type PublicHadithStructure,
} from '@minhaj/contracts/hadith';

import { hadithReadRuntime } from '@/composition/hadith-read';
import { contentLanguages } from '@/composition/public-references';
import { BreadcrumbData, Pagination } from '@/components/media/parts';
import {
  DetailRow,
  EmptyState,
  PageHeading,
  Panel,
  Prose,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import {
  CitationList,
  HadithFrame,
  collectionLabels,
  hadithTrail,
  type HadithTranslator,
} from './parts';
import {
  bookPathOf,
  chapterPathOf,
  collectionBooksPathOf,
  collectionName,
  collectionPath,
  hadithPath,
  offsetPathOf,
  pageLinks,
  structureName,
} from './presentation';
import { hadithStructuredLocales, readBooks, readCollections } from './read';

/**
 * Structural browsing — collections, books, chapters and every public citation
 * (ROUTE_MAP.md §3.4).
 *
 * THE STRUCTURE IS THE SOURCE'S. A book and a chapter are shown under the name
 * an editor recorded for the interface locale, else the source's own title in
 * its own language, else "Book {reference}" with the source's reference exactly
 * as given — never a name invented here.
 *
 * STRUCTURAL PAGES LIST CITATIONS; THEY ARE NOT CITATIONS. Every narration
 * listed links to its one short canonical address; no deeper detail address
 * exists, and the listings are bounded pages.
 */

type Trail = readonly { readonly name: string; readonly path: string }[];

/** The breadcrumb a page shows, from the same trail its structured data names. */
function crumbs(trail: Trail) {
  return [
    ...trail.slice(0, -1).map((entry) => ({ href: entry.path, text: entry.name })),
    { text: trail[trail.length - 1]?.name ?? '' },
  ];
}

/** A collection's name — the recorded one in its own language, or the slug. */
export function CollectionTitle({
  collection,
  locale,
}: {
  readonly collection: Pick<PublicHadithCollection, 'names' | 'slug'>;
  readonly locale: Locale;
}) {
  const name = collectionName(collection.names, locale);
  return name === null ? (
    <span dir="ltr">{collection.slug}</span>
  ) : (
    <span lang={name.locale}>{name.text}</span>
  );
}

/** A collection's name as plain text, for a trail or a title. */
export function collectionText(
  collection: Pick<PublicHadithCollection, 'names' | 'slug'>,
  locale: Locale,
) {
  return collectionName(collection.names, locale)?.text ?? collection.slug;
}

/** A book's or chapter's name as plain text, for a trail or a title. */
export function structureText(
  structure: PublicHadithStructure,
  locale: Locale,
  t: HadithTranslator,
  kind: 'book' | 'chapter',
): string {
  return (
    structureName(structure, locale)?.text ??
    (kind === 'book'
      ? t('bookName', { reference: structure.reference })
      : t('chapterName', { reference: structure.reference }))
  );
}

/** A book's or chapter's name, marked with the language it is actually in. */
export function StructureTitle({
  structure,
  locale,
  t,
  kind,
}: {
  readonly structure: PublicHadithStructure;
  readonly locale: Locale;
  readonly t: HadithTranslator;
  readonly kind: 'book' | 'chapter';
}) {
  const name = structureName(structure, locale);
  return name === null ? (
    <>{structureText(structure, locale, t, kind)}</>
  ) : (
    <span lang={name.language} dir="auto">
      {name.text}
    </span>
  );
}

/**
 * Books or chapters as a list of links, each with the source's reference. A
 * book also names its edition: each edition keeps its own structure, and a
 * collection's public books may come from more than one.
 */
function StructureList({
  locale,
  items,
  hrefOf,
  label,
  kind,
  t,
}: {
  readonly locale: Locale;
  readonly items: readonly (PublicHadithStructure | PublicHadithBook)[];
  readonly hrefOf: (item: PublicHadithStructure) => string;
  readonly label: string;
  readonly kind: 'book' | 'chapter';
  readonly t: HadithTranslator;
}) {
  return (
    <ol aria-label={label} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <Panel key={item.id} as="li">
          <div className="flex min-w-0 flex-col gap-1">
            <h3 className="text-base font-semibold wrap-anywhere">
              <TextLink href={hrefOf(item)}>
                <StructureTitle structure={item} locale={locale} t={t} kind={kind} />
              </TextLink>
            </h3>
            <p className="text-xs text-[color:var(--color-foreground-muted)] wrap-anywhere">
              {t('fact.sourceReference')}:{' '}
              <span dir="auto" className="whitespace-pre-wrap">
                {item.reference}
              </span>
            </p>
            {'edition' in item ? (
              <p className="text-xs text-[color:var(--color-foreground-muted)] wrap-anywhere">
                {t('fact.edition')}: <span dir="auto">{item.edition.editionTitle}</span>{' '}
                <span dir="ltr">({item.edition.editionCode})</span> · {t('fact.source')}:{' '}
                <span dir="auto">{item.edition.sourceSystemTitle}</span>
              </p>
            ) : null}
          </div>
        </Panel>
      ))}
    </ol>
  );
}

/* ===========================================================================
 * /hadith/collections
 * ========================================================================= */

export async function CollectionsPage({
  locale,
  availability,
}: {
  readonly locale: Locale;
  readonly availability: HadithAvailability;
}) {
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const parts = await hadithTrail(locale);
  const collections = await readCollections();
  const title = t('sections.collections');

  return (
    <HadithFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.hadith, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="text-[color:var(--color-foreground-muted)]">
          {t('sectionBody.collections')}
        </p>
      </div>
      {collections.length === 0 ? (
        <EmptyState>{t('collectionsEmpty')}</EmptyState>
      ) : (
        <ul aria-label={title} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {collections.map((collection) => {
            const name = collectionName(collection.names, locale);
            return (
              <Panel key={collection.id} as="li">
                <div className="flex min-w-0 flex-col gap-2">
                  <h2 className="text-lg font-semibold wrap-anywhere">
                    <TextLink href={collectionPath(locale, collection.slug)}>
                      <CollectionTitle collection={collection} locale={locale} />
                    </TextLink>
                  </h2>
                  {name?.description == null ? null : (
                    <p className="line-clamp-3 text-sm wrap-anywhere" lang={name.locale}>
                      {name.description}
                    </p>
                  )}
                </div>
              </Panel>
            );
          })}
        </ul>
      )}
    </HadithFrame>
  );
}

/* ===========================================================================
 * /hadith/collections/{slug} and /hadith/collections/{slug}/books
 * ========================================================================= */

/** The sources a collection's public citations rest on, as the operator registered them. */
function Sources({
  collection,
  t,
}: {
  readonly collection: PublicHadithCollection;
  readonly t: HadithTranslator;
}) {
  if (collection.attributions.length === 0) return null;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="collection-sources">
      <SectionHeading>
        <span id="collection-sources">{t('sources')}</span>
      </SectionHeading>
      <ul className="flex flex-col gap-2">
        {collection.attributions.map((attribution) => (
          <li
            key={`${attribution.editionCode}:${attribution.sourceSystemTitle}`}
            className="min-w-0 text-sm wrap-anywhere"
          >
            <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
              <DetailRow term={t('fact.edition')}>
                <span dir="auto">{attribution.editionTitle}</span>{' '}
                <span dir="ltr">({attribution.editionCode})</span>
              </DetailRow>
              <DetailRow term={t('fact.source')}>
                <span dir="auto">{attribution.sourceSystemTitle}</span>
              </DetailRow>
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}

export async function CollectionPage({
  locale,
  availability,
  collection,
  booksOnly,
}: {
  readonly locale: Locale;
  readonly availability: HadithAvailability;
  readonly collection: PublicHadithCollection;
  /** `/collections/{slug}/books`: the book index alone. */
  readonly booksOnly: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const parts = await hadithTrail(locale);
  const books = await readBooks(collection.id);
  const name = collectionName(collection.names, locale);
  const heading = collectionText(collection, locale);
  const trail: Trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.hadith.text, path: parts.hadith.href },
    { name: t('sections.collections'), path: hadithPath(locale, 'collections') },
    { name: heading, path: collectionPath(locale, collection.slug) },
    ...(booksOnly
      ? [
          {
            name: t('books'),
            path: `/${locale}${collectionBooksPathOf(collection.slug)}`,
          },
        ]
      : []),
  ];

  return (
    <HadithFrame locale={locale} availability={availability} trail={crumbs(trail)}>
      <Prose>
        <h1 className="text-2xl font-semibold tracking-tight wrap-anywhere">
          {booksOnly ? (
            <>
              {t('books')}
              {' · '}
            </>
          ) : null}
          <CollectionTitle collection={collection} locale={locale} />
        </h1>
        {booksOnly || name?.description == null ? null : (
          <p className="wrap-anywhere" lang={name.locale}>
            {name.description}
          </p>
        )}
      </Prose>

      {booksOnly ? null : <Sources collection={collection} t={t} />}

      <section className="flex flex-col gap-4" aria-labelledby="collection-books">
        <SectionHeading>
          <span id="collection-books">{t('books')}</span>
        </SectionHeading>
        {books.length === 0 ? (
          <EmptyState>{t('booksEmpty')}</EmptyState>
        ) : (
          <StructureList
            locale={locale}
            items={books}
            hrefOf={(book) => `/${locale}${bookPathOf(collection.slug, book.slug)}`}
            label={t('books')}
            kind="book"
            t={t}
          />
        )}
      </section>

      <BreadcrumbData
        contentLocales={hadithStructuredLocales(availability)}
        trail={trail}
      />
    </HadithFrame>
  );
}

/* ===========================================================================
 * Book and chapter pages
 * ========================================================================= */

function CitationSection({
  locale,
  page,
  collections,
  languages,
  heading,
  id,
  path,
  t,
}: {
  readonly locale: Locale;
  readonly page: PublicHadithCitationPage;
  readonly collections: Awaited<ReturnType<typeof collectionLabels>>;
  readonly languages: Awaited<ReturnType<typeof contentLanguages>>;
  readonly heading: string;
  readonly id: string;
  readonly path: string;
  readonly t: HadithTranslator;
}) {
  const links = pageLinks(page.offset, HADITH_PAGE, page.total);
  return (
    <section className="flex flex-col gap-2" aria-labelledby={id}>
      <SectionHeading>
        <span id={id}>{heading}</span>
      </SectionHeading>
      <CitationList
        locale={locale}
        citations={page.items}
        collections={collections}
        languages={languages}
        label={heading}
        idPrefix={id}
        headingLevel="h3"
        t={t}
      />
      <Pagination
        label={heading}
        previous={links.previous === null ? null : offsetPathOf(path, links.previous)}
        next={links.next === null ? null : offsetPathOf(path, links.next)}
        previousLabel={t('previous')}
        nextLabel={t('next')}
      />
    </section>
  );
}

/**
 * `/hadith/collections/{slug}/books/{bookSlug}` and its chapters — the book's
 * chapters, then the citations placed in it (or in the chapter) in bounded
 * pages, each linked to its short canonical address.
 */
export async function StructurePage({
  locale,
  availability,
  collection,
  book,
  chapter,
  offset,
}: {
  readonly locale: Locale;
  readonly availability: HadithAvailability;
  readonly collection: PublicHadithCollection;
  readonly book: PublicHadithStructure;
  readonly chapter: PublicHadithStructure | null;
  readonly offset: number;
}) {
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const parts = await hadithTrail(locale);
  const reader = hadithReadRuntime().reader;
  const [chapters, page, collections, languages] = await Promise.all([
    chapter === null ? reader.chapters(book.id) : Promise.resolve([]),
    chapter === null
      ? reader.bookCitations(book.id, offset)
      : reader.chapterCitations(chapter.id, offset),
    collectionLabels(locale),
    contentLanguages(),
  ]);
  const bookPath = `/${locale}${bookPathOf(collection.slug, book.slug)}`;
  const path =
    chapter === null
      ? bookPath
      : `/${locale}${chapterPathOf(collection.slug, book.slug, chapter.slug)}`;
  const shown = chapter ?? book;
  const kind = chapter === null ? 'book' : 'chapter';
  const trail: Trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.hadith.text, path: parts.hadith.href },
    { name: t('sections.collections'), path: hadithPath(locale, 'collections') },
    {
      name: collectionText(collection, locale),
      path: collectionPath(locale, collection.slug),
    },
    { name: t('books'), path: `/${locale}${collectionBooksPathOf(collection.slug)}` },
    { name: structureText(book, locale, t, 'book'), path: bookPath },
    ...(chapter === null
      ? []
      : [{ name: structureText(chapter, locale, t, 'chapter'), path }]),
  ];

  return (
    <HadithFrame locale={locale} availability={availability} trail={crumbs(trail)}>
      <article
        aria-labelledby="structure-heading"
        className="flex min-w-0 flex-col gap-8"
      >
        <div className="flex flex-col gap-2">
          <h1
            id="structure-heading"
            className="text-2xl font-semibold tracking-tight wrap-anywhere"
          >
            <StructureTitle structure={shown} locale={locale} t={t} kind={kind} />
          </h1>
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <DetailRow term={t('fact.collection')}>
              <TextLink href={collectionPath(locale, collection.slug)}>
                <CollectionTitle collection={collection} locale={locale} />
              </TextLink>
            </DetailRow>
            {chapter === null ? null : (
              <DetailRow term={t('fact.book')}>
                <TextLink href={bookPath}>
                  <StructureTitle structure={book} locale={locale} t={t} kind="book" />
                </TextLink>
              </DetailRow>
            )}
            <DetailRow term={t('fact.sourceReference')}>
              <span dir="auto" className="whitespace-pre-wrap">
                {shown.reference}
              </span>
            </DetailRow>
          </dl>
        </div>

        {chapters.length === 0 ? null : (
          <section className="flex flex-col gap-4" aria-labelledby="structure-chapters">
            <SectionHeading>
              <span id="structure-chapters">{t('chapters')}</span>
            </SectionHeading>
            <StructureList
              locale={locale}
              items={chapters}
              hrefOf={(item) =>
                `/${locale}${chapterPathOf(collection.slug, book.slug, item.slug)}`
              }
              label={t('chapters')}
              kind="chapter"
              t={t}
            />
          </section>
        )}

        {page.items.length === 0 ? (
          chapters.length === 0 ? (
            <EmptyState>{t('citationsEmpty')}</EmptyState>
          ) : null
        ) : (
          <CitationSection
            locale={locale}
            page={page}
            collections={collections}
            languages={languages}
            heading={t(chapter === null ? 'bookCitations' : 'chapterCitations')}
            id="structure-citations"
            path={path}
            t={t}
          />
        )}
      </article>

      <BreadcrumbData
        contentLocales={hadithStructuredLocales(availability)}
        trail={trail}
      />
    </HadithFrame>
  );
}

/* ===========================================================================
 * /hadith/browse
 * ========================================================================= */

/** Every public citation, collection by collection and number by number, in bounded pages. */
export async function BrowsePage({
  locale,
  availability,
  offset,
}: {
  readonly locale: Locale;
  readonly availability: HadithAvailability;
  readonly offset: number;
}) {
  const t = await getTranslations({ locale, namespace: 'hadith' });
  const parts = await hadithTrail(locale);
  const [page, collections, languages] = await Promise.all([
    hadithReadRuntime().reader.browse(offset),
    collectionLabels(locale),
    contentLanguages(),
  ]);
  const title = t('sections.browse');

  return (
    <HadithFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.hadith, { text: title }]}
    >
      <div className="flex flex-col gap-2">
        <PageHeading>{title}</PageHeading>
        <p className="text-[color:var(--color-foreground-muted)]">
          {t('sectionBody.browse')}
        </p>
      </div>
      {page.items.length === 0 ? (
        <EmptyState>{t('citationsEmpty')}</EmptyState>
      ) : (
        <CitationSection
          locale={locale}
          page={page}
          collections={collections}
          languages={languages}
          heading={t('citations')}
          id="browse-citations"
          path={hadithPath(locale, 'browse')}
          t={t}
        />
      )}
    </HadithFrame>
  );
}
