import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import type { QuranWork } from '@minhaj/contracts/library';
import { CONTRIBUTION_ROLES, type ContributionRole } from '@minhaj/contracts/people';
import type { PublicSurah, QuranAvailability } from '@minhaj/contracts/quran';

import { libraryReadRuntime, libraryReferenceNames } from '@/composition/library-read';
import { editionCoverPath } from '@/components/library/cover';
import { workPath } from '@/components/library/presentation';
import {
  Badge,
  EmptyState,
  Field,
  Icon,
  LinkTabs,
  Pager,
  ResponsiveImage,
  SectionHeader,
  Select,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import {
  BOOKS_PATH,
  booksFiltered,
  booksHref,
  booksPageCount,
  booksRange,
  booksReadQuery,
  surahChips,
  type BooksQuery,
} from './books-view';
import { ActiveFilters, ExploreFilters, ExploreHero, PassageChips } from './explore';
import { QuranFrame, quranTrail } from './parts';
import { quranPath, surahName } from './presentation';
import { readQuranTopic, readSurahs } from './read';
import { bookTitle } from './tafsir-layout';

/**
 * THE QURAN BOOKS HUB (Quran Part 10) — `/quran/books`.
 *
 * LAYER-4 COMPOSITION OF LIBRARY'S OWN PUBLIC READS (DOMAIN_MODEL.md §3.1,
 * §10.1): the books are Library Works — those on Taxonomy's `quran` Topic
 * together with those that explain a Quran passage — read through Library's
 * public `quranWorks` and `quranWorkFacets`; the names of their contributors
 * are People's, the Surah names Quran's public reader's. Quran imports
 * nothing of Library; only this presentation layer composes them.
 *
 * ONE ADDRESS PER VIEW (`./books-view`): a shelf (all, explains a Surah, the
 * rest), a Surah, a content language, a contributor, an order and a page,
 * each a GET parameter, so the hub works without script and every view can be
 * shared. Nothing is stated that Library did not answer: a filter with no
 * choice is not offered, a figure of zero is not shown, and a book with no
 * cover is a titled tile, never a grey box.
 */

type QuranTranslator = Awaited<ReturnType<typeof getTranslations<'quran'>>>;
type Names = Awaited<ReturnType<typeof libraryReferenceNames>>;

/** How many featured books the hub opens with, at most. */
const FEATURED = 4;

const LIST_ID = 'quran-books-list';
const FEATURED_ID = 'quran-books-featured';

/** A content language named in the interface language ("Urdu" on an English page). */
function languageName(code: string, locale: Locale): string {
  try {
    return (
      new Intl.DisplayNames([locale], { type: 'language', fallback: 'code' }).of(code) ??
      code
    );
  } catch {
    return code;
  }
}

function isRole(role: string): role is ContributionRole {
  return (CONTRIBUTION_ROLES as readonly string[]).includes(role);
}

/** The People credited on a book, as one line; a role other than author is named. */
function creditLine(work: QuranWork, names: Names, t: QuranTranslator): string {
  return work.contributors
    .flatMap((entry) => {
      const person = names.people.get(entry.personId);
      if (person === undefined) return [];
      return [
        entry.role === 'author' || !isRole(entry.role)
          ? person.name
          : t('booksHub.credit', {
              name: person.name,
              role: t(`booksHub.roles.${entry.role}`),
            }),
      ];
    })
    .join(' · ');
}

/** "Surah 18 · Al-Kahf" for a select's option, which cannot carry markup. */
function surahOption(
  number: number,
  surah: PublicSurah | undefined,
  locale: Locale,
  t: QuranTranslator,
): string {
  const name = surah === undefined ? null : surahName(surah, locale);
  return name === null
    ? t('surahName', { number })
    : t('booksHub.surahOption', { number, name: name.text });
}

/**
 * ONE BOOK: its cover (or a titled tile), title, credits, languages and year
 * as one link stretched over that part of the card — and BELOW it, outside
 * the stretched link, the Surahs it explains, each its own link to that
 * Surah's tafsir. Two kinds of target that never overlap.
 */
function BookCard({
  locale,
  work,
  names,
  surahs,
  t,
  wide = false,
  priority = false,
}: {
  readonly locale: Locale;
  readonly work: QuranWork;
  readonly names: Names;
  readonly surahs: ReadonlyMap<number, PublicSurah>;
  readonly t: QuranTranslator;
  /** The featured layout: the cover beside the words, with the description. */
  readonly wide?: boolean;
  readonly priority?: boolean;
}) {
  const label = bookTitle(work, locale);
  const description =
    work.labels.find((entry) => entry.locale === label.locale)?.description ?? '';
  const content = { lang: label.locale, dir: directionOf(label.locale) };
  const credits = creditLine(work, names, t);
  const facts = [
    work.languages.map((code) => languageName(code, locale)).join(' · '),
    work.year === null
      ? ''
      : new Intl.NumberFormat(locale, { useGrouping: false }).format(work.year),
  ].filter((fact) => fact !== '');
  const { chips, more } = surahChips(work.passages);
  const cover =
    work.cover === null ? (
      <span
        aria-hidden="true"
        className="flex aspect-[2/3] w-full flex-col justify-between gap-3 rounded-panel border border-accent-rule bg-accent-surface p-3"
      >
        <Icon name="book" size={20} className="text-accent" />
        <span
          className="line-clamp-5 font-serif text-sm font-semibold wrap-anywhere text-foreground"
          {...content}
        >
          {label.title}
        </span>
      </span>
    ) : (
      <ResponsiveImage
        path={editionCoverPath(work.cover.editionId, work.cover.assetId)}
        alt=""
        aspect="2/3"
        fit="contain"
        radius="panel"
        width={work.cover.width}
        height={work.cover.height}
        sizes={wide ? '9rem' : '(min-width: 64rem) 14rem, (min-width: 40rem) 30vw, 45vw'}
        priority={priority}
        className="transition-[filter] duration-[var(--duration-medium)] ease-[var(--ease-standard)] group-hover:brightness-95"
      />
    );

  return (
    <li
      className={`card-surface flex min-w-0 flex-col gap-3 rounded-panel ${
        wide ? 'border border-border bg-surface-raised p-4' : ''
      }`}
    >
      <div
        className={`group relative flex min-w-0 gap-3 ${
          wide ? 'flex-row items-start' : 'flex-col'
        }`}
      >
        <div className={wide ? 'w-24 shrink-0 sm:w-32' : 'w-full'}>{cover}</div>
        <div className="flex min-w-0 flex-col gap-1.5">
          {work.readable ? (
            <span className="flex">
              <Badge kind="status" tone="neutral">
                {t('booksHub.readable')}
              </Badge>
            </span>
          ) : null}
          <h3
            className="text-subheading font-semibold text-balance wrap-anywhere"
            {...content}
          >
            <a
              href={workPath(locale, work.slug)}
              className="card-link text-foreground no-underline decoration-accent-rule decoration-1 underline-offset-4 group-hover:underline active:text-action"
            >
              {label.title}
            </a>
          </h3>
          {credits === '' ? null : (
            <p className="text-sm wrap-anywhere text-foreground-muted" dir="auto">
              {credits}
            </p>
          )}
          {facts.length === 0 ? null : (
            <p className="text-caption text-foreground-muted">{facts.join(' · ')}</p>
          )}
          {wide && description !== '' ? (
            <p
              className="line-clamp-3 text-sm wrap-anywhere text-foreground-muted"
              {...content}
            >
              {description}
            </p>
          ) : null}
        </div>
      </div>
      <PassageChips
        locale={locale}
        label={t('booksHub.explains')}
        chips={chips}
        more={more}
        moreText={t('booksHub.moreSurahs', { count: more })}
        surahs={surahs}
      />
    </li>
  );
}

export async function QuranBooksPage({
  locale,
  availability,
  query,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly query: BooksQuery;
}) {
  const t = await getTranslations({ locale, namespace: 'quran' });
  const parts = await quranTrail(locale);
  const topic = await readQuranTopic(locale);
  const library = libraryReadRuntime();
  const read = booksReadQuery(query, topic?.id ?? null, locale);
  const opening = !booksFiltered(query) && query.page === 1;
  const [page, facets, featured, surahList] = await Promise.all([
    library.quranWorks(read),
    library.quranWorkFacets(read),
    opening
      ? library.quranWorks({ ...read, featured: true, limit: FEATURED })
      : Promise.resolve(null),
    readSurahs(),
  ]);
  const surahs = new Map(surahList.map((surah) => [surah.number, surah]));
  const featuredItems = featured?.items ?? [];
  const names = await libraryReferenceNames(
    {
      personIds: [
        ...page.items.flatMap((work) => work.contributors.map((entry) => entry.personId)),
        ...featuredItems.flatMap((work) =>
          work.contributors.map((entry) => entry.personId),
        ),
        ...facets.contributors.items.map((facet) => facet.id),
        ...(query.contributor === null ? [] : [query.contributor]),
      ],
      topicIds: [],
    },
    locale,
  );

  const title = t('sections.books');
  const hub = facets.hub;
  const general = facets.shelves.all - facets.shelves.explaining;
  const filtered = booksFiltered(query);
  const base = booksHref(locale, query, {
    shelf: 'all',
    surah: null,
    language: null,
    contributor: null,
  });
  const pages = booksPageCount(page.total);
  const range = booksRange(query.page, page.items.length);

  const languageOptions = facets.languages.items;
  const contributorOptions = facets.contributors.items.flatMap((facet) => {
    const person = names.people.get(facet.id);
    return person === undefined
      ? []
      : [{ id: facet.id, name: person.name, works: facet.works }];
  });
  const surahOptions = query.shelf === 'general' ? [] : facets.surahs;
  const showLanguage = languageOptions.length > 1 || query.language !== null;
  const showContributor = contributorOptions.length > 0 || query.contributor !== null;
  const showQuranOrder = hub.explaining > 0 && query.shelf !== 'general';
  const contributorName =
    query.contributor === null
      ? null
      : (names.people.get(query.contributor)?.name ?? null);

  const active = [
    ...(query.surah === null
      ? []
      : [
          {
            key: 'surah',
            text: surahOption(query.surah, surahs.get(query.surah), locale, t),
            removeHref: booksHref(locale, query, { surah: null }),
          },
        ]),
    ...(query.language === null
      ? []
      : [
          {
            key: 'language',
            text: languageName(query.language, locale),
            removeHref: booksHref(locale, query, { language: null }),
          },
        ]),
    ...(query.contributor === null
      ? []
      : [
          {
            key: 'contributor',
            text: contributorName ?? t('booksHub.unknownContributor'),
            removeHref: booksHref(locale, query, { contributor: null }),
          },
        ]),
  ].map((filter) => ({
    ...filter,
    removeLabel: t('booksHub.remove', { name: filter.text }),
  }));

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <ExploreHero
        eyebrow={t('booksHub.eyebrow')}
        title={title}
        lede={t('booksHub.lede')}
        stats={[
          ...(hub.works === 0
            ? []
            : [
                {
                  value: hub.works,
                  label: t('booksHub.statBooks', { count: hub.works }),
                  href: `#${LIST_ID}`,
                },
              ]),
          ...(hub.explaining === 0
            ? []
            : [
                {
                  value: hub.explaining,
                  label: t('booksHub.statExplaining', { count: hub.explaining }),
                  href: booksHref(locale, query, {
                    shelf: 'explains',
                    surah: null,
                    language: null,
                    contributor: null,
                  }),
                },
              ]),
          ...(hub.languages < 2
            ? []
            : [
                {
                  value: hub.languages,
                  label: t('booksHub.statLanguages', { count: hub.languages }),
                },
              ]),
        ]}
        actions={[
          { href: quranPath(locale, 'tafsir'), text: t('booksHub.tafsirLink') },
          { href: quranPath(locale, 'surah'), text: t('booksHub.readLink') },
        ]}
      />

      {hub.works === 0 ? (
        <EmptyState
          icon="book"
          title={t('booksHub.emptyTitle')}
          action={{
            href: localizedPath(locale, '/library/books'),
            text: t('booksHub.libraryLink'),
          }}
        >
          {t('booksHub.empty')}
        </EmptyState>
      ) : (
        <>
          {featuredItems.length === 0 ? null : (
            <section aria-labelledby={FEATURED_ID} className="flex flex-col gap-4">
              <SectionHeader
                id={FEATURED_ID}
                heading={t('booksHub.featuredHeading')}
                intro={t('booksHub.featuredHelp')}
              />
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {featuredItems.map((work, index) => (
                  <BookCard
                    key={work.id}
                    locale={locale}
                    work={work}
                    names={names}
                    surahs={surahs}
                    t={t}
                    wide
                    priority={index === 0}
                  />
                ))}
              </ul>
            </section>
          )}

          <section aria-labelledby={LIST_ID} className="flex flex-col gap-5">
            <SectionHeader
              id={LIST_ID}
              heading={t('booksHub.listHeading')}
              intro={t(`booksHub.shelfHelp.${query.shelf}`)}
            />

            {facets.shelves.explaining > 0 && general > 0 ? (
              <LinkTabs
                label={t('booksHub.shelves')}
                tabs={(['all', 'explains', 'general'] as const).map((shelf) => ({
                  href: booksHref(locale, query, { shelf }),
                  text: t(`booksHub.shelf.${shelf}`),
                  current: query.shelf === shelf,
                  count: String(
                    shelf === 'all'
                      ? facets.shelves.all
                      : shelf === 'explains'
                        ? facets.shelves.explaining
                        : general,
                  ),
                }))}
              />
            ) : null}

            <ExploreFilters
              action={localizedPath(locale, BOOKS_PATH)}
              label={t('booksHub.filters')}
              hidden={
                query.shelf === 'all' ? [] : [{ name: 'shelf', value: query.shelf }]
              }
              submit={t('booksHub.apply')}
              reset={filtered ? { href: base, text: t('booksHub.reset') } : null}
            >
              {surahOptions.length === 0 ? null : (
                <Field id="books-surah" label={t('booksHub.filterSurah')}>
                  {(props) => (
                    <Select
                      {...props}
                      name="surah"
                      defaultValue={query.surah === null ? '' : String(query.surah)}
                    >
                      <option value="">{t('booksHub.anySurah')}</option>
                      {surahOptions.map((row) => (
                        <option key={row.surah} value={String(row.surah)}>
                          {t('booksHub.option', {
                            name: surahOption(
                              row.surah,
                              surahs.get(row.surah),
                              locale,
                              t,
                            ),
                            count: row.owners,
                          })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              {showLanguage ? (
                <Field id="books-language" label={t('booksHub.filterLanguage')}>
                  {(props) => (
                    <Select
                      {...props}
                      name="language"
                      defaultValue={query.language ?? ''}
                    >
                      <option value="">{t('booksHub.anyLanguage')}</option>
                      {languageOptions.map((facet) => (
                        <option key={facet.id} value={facet.id}>
                          {t('booksHub.option', {
                            name: languageName(facet.id, locale),
                            count: facet.works,
                          })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              {showContributor ? (
                <Field id="books-contributor" label={t('booksHub.filterContributor')}>
                  {(props) => (
                    <Select
                      {...props}
                      name="contributor"
                      defaultValue={query.contributor ?? ''}
                    >
                      <option value="">{t('booksHub.anyContributor')}</option>
                      {contributorOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {t('booksHub.option', {
                            name: option.name,
                            count: option.works,
                          })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              <Field id="books-sort" label={t('booksHub.filterSort')}>
                {(props) => (
                  <Select {...props} name="sort" defaultValue={query.sort}>
                    <option value="title">{t('booksHub.sort.title')}</option>
                    <option value="newest">{t('booksHub.sort.newest')}</option>
                    {showQuranOrder ? (
                      <option value="quran">{t('booksHub.sort.quran')}</option>
                    ) : null}
                  </Select>
                )}
              </Field>
            </ExploreFilters>

            <ActiveFilters label={t('booksHub.active')} filters={active} />

            {range === null ? null : (
              <p className="text-sm text-foreground-muted">
                {t('booksHub.summary', {
                  from: range.from,
                  to: range.to,
                  total: page.total,
                })}
              </p>
            )}

            {page.items.length === 0 ? (
              query.page > 1 && page.total > 0 ? (
                <EmptyState
                  title={t('booksHub.pastEndTitle')}
                  action={{
                    href: booksHref(locale, query, { page: 1 }),
                    text: t('booksHub.firstPage'),
                  }}
                >
                  {t('booksHub.pastEnd', { page: query.page })}
                </EmptyState>
              ) : (
                <EmptyState
                  title={t('booksHub.noResultsTitle')}
                  action={{ href: base, text: t('booksHub.reset') }}
                >
                  {t('booksHub.noResults')}
                </EmptyState>
              )
            ) : (
              <ul
                aria-label={title}
                className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4"
              >
                {page.items.map((work) => (
                  <BookCard
                    key={work.id}
                    locale={locale}
                    work={work}
                    names={names}
                    surahs={surahs}
                    t={t}
                  />
                ))}
              </ul>
            )}

            {page.items.length === 0 ? null : (
              <Pager
                label={t('booksHub.pages')}
                previous={
                  query.page > 1
                    ? booksHref(locale, query, { page: query.page - 1 })
                    : null
                }
                next={
                  page.hasMore ? booksHref(locale, query, { page: query.page + 1 }) : null
                }
                previousLabel={t('previous')}
                nextLabel={t('next')}
                pages={{
                  current: query.page,
                  total: pages,
                  href: (number) => booksHref(locale, query, { page: number }),
                  label: (number) => t('booksHub.pageLabel', { page: number }),
                  format: (number) => new Intl.NumberFormat(locale).format(number),
                }}
              />
            )}
          </section>
        </>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
          {t('booksHub.about')}
        </p>
        <p className="text-sm">
          <a
            href={
              topic === null
                ? localizedPath(locale, '/library/books')
                : localizedPath(
                    locale,
                    `/library/books?topic=${encodeURIComponent(topic.id)}`,
                  )
            }
            className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
          >
            {t('booksHub.libraryLink')}
            <Icon name="arrow-end" size={16} />
          </a>
        </p>
      </div>
    </QuranFrame>
  );
}
