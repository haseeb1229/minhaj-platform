import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { WorkRecord } from '@minhaj/contracts/library';

import {
  libraryContentLanguages,
  libraryReadRuntime,
  libraryReferenceNames,
} from '@/composition/library-read';
import { directionOf } from '@/config/locale';
import { requireLocale } from '@/config/route-locale';
import {
  Breadcrumbs,
  Button,
  Container,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  Select,
  TextInput,
  TextLink,
} from '@/components/ui';
import {
  booksPath,
  labelFor,
  readLibraryQuery,
  workPath,
  WORK_PAGE,
} from '@/components/library/presentation';
import { requireRoute } from '@/shell/registry';
import { shellMetadata } from '@/seo/metadata';

/**
 * `/{locale}/library/books` — the Works listing (ROUTE_MAP.md §5).
 *
 * BOUNDED, DETERMINISTIC AND FILTERED IN SQL. The reader returns one page with a
 * stable order and a tie-breaker, the filters are part of the query rather than
 * applied to a loaded corpus, and nothing here reads more rows than it renders
 * (§31, §49). A "search" that loaded every Work and filtered in the process would
 * be the unbounded table scan §31 prohibits — and free-text search is Phase 17's
 * in any case, so there is none here.
 *
 * FILTERS ARE A GET FORM OF PLAIN CONTROLS. No JavaScript is required to use any
 * of them: the form submits to this same URL, the parameters are readable, and
 * each one is shareable. That also means every filtered view has an address a
 * crawler may reach, which is why the metadata below canonicalises a filtered
 * view to the BASE listing and keeps filtered combinations out of the sitemap
 * (ROUTE_MAP.md §2.3, §9.4, and §35).
 *
 * THE INTERFACE LOCALE DOES NOT FILTER CONTENT. `/ur/library/books` is the
 * Library in Urdu listing books in EVERY content language — "`/ur/library/books`
 * means Urdu UI chrome. It does NOT mean 'only Urdu books'" (ROUTE_MAP.md §1.5,
 * and this phase's §9). Content language is a filter the visitor chooses, and it
 * is never applied on their behalf.
 *
 * SIGNED OUT, ALWAYS. Nothing in this module's graph can reach Identity or a
 * cookie.
 */
export const dynamic = 'force-dynamic';

interface ListingParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: ListingParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'library' });

  // CANONICAL TO THE BASE LISTING, whatever filters are applied. A filtered view
  // is "indexable but canonical to the base, and excluded from sitemaps"
  // (ROUTE_MAP.md §2.3) — the alternative is one address per filter combination,
  // which is the index explosion §47 names.
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

  const t = await getTranslations({ locale, namespace: 'library' });
  const shell = await getTranslations({ locale, namespace: 'shell' });

  const filters = readLibraryQuery(query);

  const [page, languageFacets, topicFacets, languages] = await Promise.all([
    libraryReadRuntime().works(filters),
    libraryReadRuntime().languageFacets(0),
    libraryReadRuntime().topicFacets(0),
    libraryContentLanguages(),
  ]);

  // ONE resolution call for the whole page's topic names, plus the facet options.
  // Resolving per row would be the N+1 §49 prohibits.
  const references = await libraryReferenceNames(
    {
      personIds: filters.contributor === null ? [] : [filters.contributor],
      topicIds: topicFacets.items.map((facet) => facet.id),
    },
    locale,
  );

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            { href: `/${locale}`, text: shell('nav.home') },
            { href: `/${locale}/library`, text: t('title') },
            { text: t('books') },
          ]}
        />

        <div className="flex flex-col gap-2">
          <PageHeading>{t('books')}</PageHeading>
          <p className="text-[color:var(--color-foreground-muted)]">
            {t('booksDescription')}
          </p>
        </div>

        {/*
         * A REAL `<form method="get">`, so the filters work with JavaScript
         * disabled and every filtered view is a shareable address. The offset is
         * deliberately NOT carried: changing a filter returns the visitor to the
         * first page, because page 7 of a different result set is a page that
         * means nothing.
         */}
        <Panel>
          <form
            method="get"
            action={`/${locale}/library/books`}
            className="flex flex-col gap-4"
            aria-label={t('filters')}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="filter-language" label={t('filterLanguage')}>
                {(props) => (
                  <Select
                    {...props}
                    name="language"
                    defaultValue={filters.language ?? ''}
                  >
                    <option value="">{t('filterAny')}</option>
                    {languageFacets.items.map((facet) => (
                      <option key={facet.id} value={facet.id}>
                        {languages.get(facet.id)?.name ?? facet.id} ({facet.works})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field id="filter-topic" label={t('filterTopic')}>
                {(props) => (
                  <Select {...props} name="topic" defaultValue={filters.topic ?? ''}>
                    <option value="">{t('filterAny')}</option>
                    {topicFacets.items.map((facet) => {
                      const topic = references.topics.get(facet.id);
                      if (topic === undefined) return null;
                      return (
                        <option key={facet.id} value={facet.id}>
                          {topic.name} ({facet.works})
                        </option>
                      );
                    })}
                  </Select>
                )}
              </Field>

              <Field id="filter-from" label={t('filterFrom')}>
                {(props) => (
                  <TextInput
                    {...props}
                    name="from"
                    type="number"
                    min={1}
                    max={9999}
                    inputMode="numeric"
                    defaultValue={filters.from ?? ''}
                  />
                )}
              </Field>

              <Field id="filter-to" label={t('filterTo')}>
                {(props) => (
                  <TextInput
                    {...props}
                    name="to"
                    type="number"
                    min={1}
                    max={9999}
                    inputMode="numeric"
                    defaultValue={filters.to ?? ''}
                  />
                )}
              </Field>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="downloads"
                value="1"
                defaultChecked={filters.downloads}
                className="size-5"
              />
              {t('filterDownloads')}
            </label>

            {/*
             * The contributor filter travels as a hidden field rather than a
             * select: it is applied by following a contributor from
             * `/library/authors` or from a Work page, and a dropdown of every
             * contributor in the corpus would be an unbounded control. It is
             * visible as a named, clearable filter below.
             */}
            {filters.contributor === null ? null : (
              <input type="hidden" name="contributor" value={filters.contributor} />
            )}

            <div className="flex flex-wrap items-center gap-4">
              <Button tone="secondary">{t('filterApply')}</Button>
              <TextLink href={`/${locale}/library/books`}>{t('filterClear')}</TextLink>
            </div>
          </form>
        </Panel>

        {filters.contributor === null ? null : (
          <p className="text-sm">
            {t('filterContributor')}:{' '}
            <span className="font-medium">
              {references.people.get(filters.contributor)?.name ?? t('filterAny')}
            </span>{' '}
            <TextLink href={booksPath(locale, filters, { contributor: null, offset: 0 })}>
              {t('filterClearOne')}
            </TextLink>
          </p>
        )}

        {page.items.length === 0 ? (
          <EmptyState>{t('empty')}</EmptyState>
        ) : (
          <ul aria-label={t('books')} className="flex flex-col gap-4">
            {page.items.map((record) => (
              <WorkSummary key={record.id} record={record} locale={locale} />
            ))}
          </ul>
        )}

        <nav className="flex gap-6" aria-label={t('books')}>
          {filters.offset > 0 ? (
            <TextLink
              href={booksPath(locale, filters, {
                offset: Math.max(0, filters.offset - WORK_PAGE),
              })}
            >
              {t('previous')}
            </TextLink>
          ) : null}
          {page.hasMore ? (
            <TextLink
              href={booksPath(locale, filters, { offset: filters.offset + WORK_PAGE })}
            >
              {t('next')}
            </TextLink>
          ) : null}
        </nav>
      </div>
    </Container>
  );
}

/**
 * One Work in a listing.
 *
 * THE TITLE CARRIES ITS OWN LANGUAGE. A listing that mixes English, Urdu and
 * Arabic titles is the ordinary case for this corpus, and each one is marked so it
 * is announced and shaped correctly rather than inheriting the page's language
 * (WCAG 3.1.2, and this phase's §48 mixed-direction requirement).
 */
function WorkSummary({
  record,
  locale,
}: {
  readonly record: WorkRecord;
  readonly locale: Locale;
}) {
  const label = labelFor(record, locale);
  const direction = directionOf(label.locale);

  return (
    <Panel as="li">
      <div className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold" lang={label.locale} dir={direction}>
          <TextLink href={workPath(locale, record.slug)}>{label.title}</TextLink>
        </h2>
        {label.description === '' ? null : (
          <p
            className="text-sm text-[color:var(--color-foreground-muted)]"
            lang={label.locale}
            dir={direction}
          >
            {label.description}
          </p>
        )}
      </div>
    </Panel>
  );
}
