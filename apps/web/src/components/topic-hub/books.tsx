import 'server-only';

import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import type { TopicWork, TopicWorksShelf } from '@minhaj/contracts/library';
import { CONTRIBUTION_ROLES, type ContributionRole } from '@minhaj/contracts/people';

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
  TextInput,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import {
  NO_LIBRARY_FILTERS,
  booksFiltered,
  booksHref,
  booksPageCount,
  booksRange,
  booksReadQuery,
  type BooksQuery,
  type BooksScope,
  type LibraryBooksFilters,
} from './books-view';
import type { HubDomain, HubLink } from './domain';
import { ActiveFilters, ExploreFilters, ExploreHero, languageName } from './parts';

/**
 * A SUBJECT'S BOOKS HUB (Quran Part 10; shared with Hadith since Hadith Part
 * 1) — `/quran/books`, `/hadith/books`.
 *
 * LAYER-4 COMPOSITION OF LIBRARY'S OWN PUBLIC READS (DOMAIN_MODEL.md §3.1,
 * §10.1): the books are Library Works on the subject's Taxonomy Topic — and,
 * for the Quran alone, every Work that explains a Quran passage — read
 * through Library's public `topicWorks` and `topicWorkFacets`; the names of
 * their contributors are People's. No subject context imports Library; only
 * this presentation layer composes them.
 *
 * ONE ADDRESS PER VIEW (`./books-view`): a language, a contributor, an order
 * and a page — and, with the Quran passage parts, a shelf and a Surah — each
 * a GET parameter, so the hub works without script and every view can be
 * shared. Nothing is stated that Library did not answer: a filter with no
 * choice is not offered, a figure of zero is not shown, and a book with no
 * cover is a titled tile, never a grey box.
 *
 * LIBRARY PART 1 — `/library/books` IS THIS LISTING OVER THE WHOLE LIBRARY
 * (`LIBRARY_BOOKS`, read with `scope: 'library'`), not a second
 * implementation: the same cards, figures, featured shelf, filters with
 * counts, chips, orders and numbered pages, plus the Library's own filters —
 * a Topic (with counts), a publication-year range, and readable online and
 * downloadable (each with the count checking it would show). A subject's hub
 * shows none of those and renders exactly as before.
 */

type HubTranslator = Awaited<ReturnType<typeof getTranslations<'topicHub'>>>;
type Names = Awaited<ReturnType<typeof libraryReferenceNames>>;

/** What a subject says on its Books hub, in its own words. */
export interface BooksCopy {
  readonly lede: string;
  /** "12 books on Hadith". */
  readonly stat: (count: number) => string;
  /** What the listing holds, unnarrowed by a shelf. */
  readonly listIntro: string;
  readonly emptyTitle: string;
  readonly empty: string;
  readonly noResults: string;
  readonly about: string;
  /** The hero's eyebrow, where the listing is not a subject's "Explore · Books". */
  readonly eyebrow?: string;
  /** A statement under the hero's lede (the Library's metadata notice). */
  readonly notice?: string;
}

/**
 * THE QURAN PASSAGE PARTS of a Books hub — only the Quran's has them: the
 * shelves (explains a Surah, the rest), a Surah filter, the Quran order, and
 * the Surahs each book explains, as the Quran renders them.
 */
export interface BooksPassages {
  readonly statExplaining: (count: number) => string;
  readonly shelves: string;
  readonly shelf: Readonly<Record<TopicWorksShelf, string>>;
  readonly shelfHelp: Readonly<Record<Exclude<TopicWorksShelf, 'all'>, string>>;
  readonly filterSurah: string;
  readonly anySurah: string;
  readonly sortQuran: string;
  /** A Surah as plain words, for an option or a filter chip ("18. Al-Kahf"). */
  readonly surahOption: (surah: number) => string;
  /** The Surahs a book explains, each its own link, below the card's link. */
  readonly chips: (work: TopicWork) => ReactNode;
}

/**
 * A book's title and description as a reader of `locale` is shown them: in
 * that locale, else the book's own, else whichever it has.
 */
function labelOf(work: TopicWork, locale: Locale) {
  return (
    work.labels.find((label) => label.locale === locale) ??
    work.labels.find((label) => label.locale === work.primaryLocale) ??
    work.labels[0] ?? { locale: work.primaryLocale, title: '', description: '' }
  );
}

/** How many featured books the hub opens with, at most. */
const FEATURED = 4;

function isRole(role: string): role is ContributionRole {
  return (CONTRIBUTION_ROLES as readonly string[]).includes(role);
}

/** A copy of an owner's name map keyed by the identifier in lower case. */
function caseless<V>(map: ReadonlyMap<string, V>): Map<string, V> {
  return new Map([...map].map(([id, value]) => [id.toLowerCase(), value]));
}

/** The People credited on a book, as one line; a role other than author is named. */
function creditLine(work: TopicWork, names: Names, t: HubTranslator): string {
  return work.contributors
    .flatMap((entry) => {
      const person = names.people.get(entry.personId);
      if (person === undefined) return [];
      return [
        entry.role === 'author' || !isRole(entry.role)
          ? person.name
          : t('common.credit', {
              name: person.name,
              role: t(`common.roles.${entry.role}`),
            }),
      ];
    })
    .join(' · ');
}

/**
 * ONE BOOK: its cover (or a titled tile), title, credits, languages and year
 * as one link stretched over that part of the card — and BELOW it, outside
 * the stretched link, whatever the subject adds (the Quran's Surah chips),
 * each its own link. Two kinds of target that never overlap.
 */
function BookCard({
  locale,
  work,
  names,
  t,
  extra,
  wide = false,
  priority = false,
}: {
  readonly locale: Locale;
  readonly work: TopicWork;
  readonly names: Names;
  readonly t: HubTranslator;
  readonly extra: ReactNode;
  /** The featured layout: the cover beside the words, with the description. */
  readonly wide?: boolean;
  readonly priority?: boolean;
}) {
  const label = labelOf(work, locale);
  const description = label.description;
  const content = { lang: label.locale, dir: directionOf(label.locale) };
  const credits = creditLine(work, names, t);
  const facts = [
    work.languages.map((code) => languageName(code, locale)).join(' · '),
    work.year === null
      ? ''
      : new Intl.NumberFormat(locale, { useGrouping: false }).format(work.year),
  ].filter((fact) => fact !== '');
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
          {work.readable || work.downloadable ? (
            <span className="flex flex-wrap gap-1.5">
              {work.readable ? (
                <Badge kind="status" tone="neutral">
                  {t('books.readable')}
                </Badge>
              ) : null}
              {work.downloadable ? (
                <Badge kind="status" tone="neutral">
                  {t('books.downloadable')}
                </Badge>
              ) : null}
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
      {extra}
    </li>
  );
}

/**
 * A row of book cards outside a hub — a Topic's own page (Learn Part 2) —
 * every contributor on it resolved in ONE People call. Nothing when empty.
 */
export async function BookShelf({
  locale,
  works,
  label,
}: {
  readonly locale: Locale;
  readonly works: readonly TopicWork[];
  readonly label: string;
}) {
  if (works.length === 0) return null;
  const [t, names] = await Promise.all([
    getTranslations({ locale, namespace: 'topicHub' }),
    libraryReferenceNames(
      {
        personIds: works.flatMap((work) =>
          work.contributors.map((entry) => entry.personId),
        ),
        topicIds: [],
      },
      locale,
    ),
  ]);
  return (
    <ul
      aria-label={label}
      className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-6"
    >
      {works.map((work) => (
        <BookCard
          key={work.id}
          locale={locale}
          work={work}
          names={names}
          t={t}
          extra={null}
        />
      ))}
    </ul>
  );
}

export async function BooksHub({
  domain,
  scope,
  query,
  copy,
  actions,
  passages,
  onward,
}: {
  readonly domain: HubDomain;
  readonly scope: BooksScope;
  readonly query: BooksQuery;
  readonly copy: BooksCopy;
  /** The ways onward the header offers. */
  readonly actions: readonly HubLink[];
  /** The Quran passage parts, or null where the subject has none. */
  readonly passages: BooksPassages | null;
  /**
   * Where the closing note leads instead of the whole Library — the whole
   * Library's own listing, which leads on to the subjects' hubs.
   */
  readonly onward?: readonly HubLink[];
}) {
  const { locale } = domain;
  const t = await getTranslations({ locale, namespace: 'topicHub' });
  const library = libraryReadRuntime();
  const own: LibraryBooksFilters | null =
    scope.library === true ? (query.library ?? NO_LIBRARY_FILTERS) : null;
  const read = booksReadQuery(scope, query, domain.topicId, locale);
  const opening = !booksFiltered(query) && query.page === 1;
  const [page, facets, featured] = await Promise.all([
    library.topicWorks(read),
    library.topicWorkFacets(read),
    opening
      ? library.topicWorks({ ...read, featured: true, limit: FEATURED })
      : Promise.resolve(null),
  ]);
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
      topicIds: [
        ...facets.topics.items.map((facet) => facet.id),
        ...(own === null || own.topic === null ? [] : [own.topic]),
      ],
    },
    locale,
  );

  // An address carries an identifier in lower case (`identifier`), while an
  // owner returns it as stored: options and chips compare without case, so a
  // chosen Topic or contributor is pre-selected and named, never "unknown".
  const people = caseless(names.people);
  const topics = caseless(names.topics);

  const listId = `${domain.key}-books-list`;
  const featuredId = `${domain.key}-books-featured`;
  const title = domain.title;
  const hub = facets.hub;
  const general = facets.shelves.all - facets.shelves.explaining;
  const filtered = booksFiltered(query);
  const href = (change: Partial<BooksQuery> = {}) =>
    booksHref(scope, locale, query, change);
  /** A change to the whole Library's own filters alone. */
  const ownHref = (change: Partial<LibraryBooksFilters>) =>
    href({ library: { ...(own ?? NO_LIBRARY_FILTERS), ...change } });
  const base = href({
    shelf: 'all',
    surah: null,
    language: null,
    contributor: null,
    ...(own === null ? {} : { library: NO_LIBRARY_FILTERS }),
  });
  const pages = booksPageCount(page.total);
  const range = booksRange(query.page, page.items.length);
  const number = (value: number) =>
    new Intl.NumberFormat(locale, { useGrouping: false }).format(value);

  const languageOptions = facets.languages.items;
  const contributorOptions = facets.contributors.items.flatMap((facet) => {
    const person = people.get(facet.id.toLowerCase());
    return person === undefined
      ? []
      : [{ id: facet.id.toLowerCase(), name: person.name, works: facet.works }];
  });
  const topicOptions = facets.topics.items.flatMap((facet) => {
    const topic = topics.get(facet.id.toLowerCase());
    return topic === undefined
      ? []
      : [{ id: facet.id.toLowerCase(), name: topic.name, works: facet.works }];
  });
  const surahOptions =
    passages === null || query.shelf === 'general' ? [] : facets.surahs;
  const showLanguage = languageOptions.length > 1 || query.language !== null;
  const showContributor = contributorOptions.length > 0 || query.contributor !== null;
  const showTopic = own !== null && (topicOptions.length > 0 || own.topic !== null);
  const showYears =
    own !== null && (hub.earliest !== null || own.from !== null || own.to !== null);
  const showReadable = own !== null && (hub.readable > 0 || own.readable);
  const showDownloadable = own !== null && (hub.downloadable > 0 || own.downloadable);
  const showQuranOrder =
    passages !== null && hub.explaining > 0 && query.shelf !== 'general';
  const showShelves = passages !== null && facets.shelves.explaining > 0 && general > 0;
  const contributorName =
    query.contributor === null
      ? null
      : (people.get(query.contributor.toLowerCase())?.name ?? null);
  const topicName =
    own === null || own.topic === null
      ? null
      : (topics.get(own.topic.toLowerCase())?.name ?? null);

  /** A year span in words: both ends, or the one end that is set. */
  const yearSpan = (from: number | null, to: number | null): string | null =>
    from !== null && to !== null
      ? from === to
        ? number(from)
        : t('books.yearSpan', { from: number(from), to: number(to) })
      : from !== null
        ? t('books.yearFrom', { year: number(from) })
        : to !== null
          ? t('books.yearTo', { year: number(to) })
          : null;
  const chosenYears = own === null ? null : yearSpan(own.from, own.to);

  const active = [
    ...(passages === null || query.surah === null
      ? []
      : [
          {
            key: 'surah',
            text: passages.surahOption(query.surah),
            removeHref: href({ surah: null }),
          },
        ]),
    ...(own === null || own.topic === null
      ? []
      : [
          {
            key: 'topic',
            text: topicName ?? t('books.unknownTopic'),
            removeHref: ownHref({ topic: null }),
          },
        ]),
    ...(query.language === null
      ? []
      : [
          {
            key: 'language',
            text: languageName(query.language, locale),
            removeHref: href({ language: null }),
          },
        ]),
    ...(query.contributor === null
      ? []
      : [
          {
            key: 'contributor',
            text: contributorName ?? t('common.unknownContributor'),
            removeHref: href({ contributor: null }),
          },
        ]),
    ...(chosenYears === null
      ? []
      : [
          {
            key: 'years',
            text: chosenYears,
            removeHref: ownHref({ from: null, to: null }),
          },
        ]),
    ...(own === null || !own.readable
      ? []
      : [
          {
            key: 'readable',
            text: t('books.filterReadable'),
            removeHref: ownHref({ readable: false }),
          },
        ]),
    ...(own === null || !own.downloadable
      ? []
      : [
          {
            key: 'downloadable',
            text: t('books.filterDownloadable'),
            removeHref: ownHref({ downloadable: false }),
          },
        ]),
  ].map((filter) => ({
    ...filter,
    removeLabel: t('common.remove', { name: filter.text }),
  }));

  const card = (work: TopicWork, extra: { wide?: boolean; priority?: boolean } = {}) => (
    <BookCard
      key={work.id}
      locale={locale}
      work={work}
      names={names}
      t={t}
      extra={passages?.chips(work) ?? null}
      {...extra}
    />
  );

  const span = yearSpan(hub.earliest, hub.latest);
  const stats = [
    ...(hub.works === 0
      ? []
      : [{ value: hub.works, label: copy.stat(hub.works), href: `#${listId}` }]),
    ...(passages === null || hub.explaining === 0
      ? []
      : [
          {
            value: hub.explaining,
            label: passages.statExplaining(hub.explaining),
            href: href({
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
            label: t('common.statLanguages', { count: hub.languages }),
          },
        ]),
    // The whole Library's own figures, each linked to the view it counts.
    ...(own === null || hub.readable === 0
      ? []
      : [
          {
            value: hub.readable,
            label: t('books.statReadable', { count: hub.readable }),
            href: booksHref(scope, locale, {
              ...query,
              language: null,
              contributor: null,
              page: 1,
              library: { ...NO_LIBRARY_FILTERS, readable: true },
            }),
          },
        ]),
    ...(own === null || hub.downloadable === 0
      ? []
      : [
          {
            value: hub.downloadable,
            label: t('books.statDownloadable', { count: hub.downloadable }),
            href: booksHref(scope, locale, {
              ...query,
              language: null,
              contributor: null,
              page: 1,
              library: { ...NO_LIBRARY_FILTERS, downloadable: true },
            }),
          },
        ]),
    ...(own === null || span === null || hub.earliest === hub.latest
      ? []
      : [{ value: span, label: t('books.statYears') }]),
  ];

  return domain.frame(
    <>
      <ExploreHero
        eyebrow={copy.eyebrow ?? t('books.eyebrow')}
        title={title}
        lede={copy.lede}
        {...(copy.notice === undefined ? {} : { notice: copy.notice })}
        stats={stats}
        actions={actions}
      />

      {hub.works === 0 ? (
        <EmptyState
          icon="book"
          title={copy.emptyTitle}
          action={
            own === null
              ? {
                  href: localizedPath(locale, '/library/books'),
                  text: t('books.libraryLink'),
                }
              : { href: localizedPath(locale, '/library'), text: t('books.libraryHome') }
          }
        >
          {copy.empty}
        </EmptyState>
      ) : (
        <>
          {featuredItems.length === 0 ? null : (
            <section aria-labelledby={featuredId} className="flex flex-col gap-4">
              <SectionHeader
                id={featuredId}
                heading={t('books.featuredHeading')}
                intro={t('books.featuredHelp')}
              />
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {featuredItems.map((work, index) =>
                  card(work, { wide: true, priority: index === 0 }),
                )}
              </ul>
            </section>
          )}

          <section aria-labelledby={listId} className="flex flex-col gap-5">
            <SectionHeader
              id={listId}
              heading={t('books.listHeading')}
              intro={
                passages === null || query.shelf === 'all'
                  ? copy.listIntro
                  : passages.shelfHelp[query.shelf]
              }
            />

            {showShelves && passages !== null ? (
              <LinkTabs
                label={passages.shelves}
                tabs={(['all', 'explains', 'general'] as const).map((shelf) => ({
                  href: href({ shelf }),
                  text: passages.shelf[shelf],
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
              action={localizedPath(locale, scope.path)}
              label={t('books.filters')}
              hidden={
                query.shelf === 'all' ? [] : [{ name: 'shelf', value: query.shelf }]
              }
              submit={t('books.apply')}
              reset={filtered ? { href: base, text: t('common.reset') } : null}
            >
              {passages === null || surahOptions.length === 0 ? null : (
                <Field id="books-surah" label={passages.filterSurah}>
                  {(props) => (
                    <Select
                      {...props}
                      name="surah"
                      defaultValue={query.surah === null ? '' : String(query.surah)}
                    >
                      <option value="">{passages.anySurah}</option>
                      {surahOptions.map((row) => (
                        <option key={row.surah} value={String(row.surah)}>
                          {t('common.option', {
                            name: passages.surahOption(row.surah),
                            count: row.owners,
                          })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              {showTopic && own !== null ? (
                <Field id="books-topic" label={t('books.filterTopic')}>
                  {(props) => (
                    <Select {...props} name="topic" defaultValue={own.topic ?? ''}>
                      <option value="">{t('books.anyTopic')}</option>
                      {topicOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {t('common.option', { name: option.name, count: option.works })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              {showLanguage ? (
                <Field id="books-language" label={t('common.filterLanguage')}>
                  {(props) => (
                    <Select
                      {...props}
                      name="language"
                      defaultValue={query.language ?? ''}
                    >
                      <option value="">{t('common.anyLanguage')}</option>
                      {languageOptions.map((facet) => (
                        <option key={facet.id} value={facet.id}>
                          {t('common.option', {
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
                <Field id="books-contributor" label={t('common.filterContributor')}>
                  {(props) => (
                    <Select
                      {...props}
                      name="contributor"
                      defaultValue={query.contributor ?? ''}
                    >
                      <option value="">{t('common.anyContributor')}</option>
                      {contributorOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {t('common.option', {
                            name: option.name,
                            count: option.works,
                          })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              {showYears && own !== null ? (
                <>
                  <Field id="books-from" label={t('books.filterFrom')}>
                    {(props) => (
                      <TextInput
                        {...props}
                        name="from"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={9999}
                        {...(hub.earliest === null
                          ? {}
                          : { placeholder: String(hub.earliest) })}
                        defaultValue={own.from === null ? '' : String(own.from)}
                      />
                    )}
                  </Field>
                  <Field id="books-to" label={t('books.filterTo')}>
                    {(props) => (
                      <TextInput
                        {...props}
                        name="to"
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={9999}
                        {...(hub.latest === null
                          ? {}
                          : { placeholder: String(hub.latest) })}
                        defaultValue={own.to === null ? '' : String(own.to)}
                      />
                    )}
                  </Field>
                </>
              ) : null}
              {(showReadable || showDownloadable) && own !== null ? (
                <fieldset className="flex min-w-0 flex-col gap-1">
                  <legend className="pb-1 text-sm font-medium">
                    {t('books.filterAvailability')}
                  </legend>
                  {showReadable ? (
                    <Check
                      name="readable"
                      checked={own.readable}
                      label={t('common.option', {
                        name: t('books.filterReadable'),
                        count: facets.access.readable,
                      })}
                    />
                  ) : null}
                  {showDownloadable ? (
                    <Check
                      name="downloads"
                      checked={own.downloadable}
                      label={t('common.option', {
                        name: t('books.filterDownloadable'),
                        count: facets.access.downloadable,
                      })}
                    />
                  ) : null}
                </fieldset>
              ) : null}
              <Field id="books-sort" label={t('common.filterSort')}>
                {(props) => (
                  <Select {...props} name="sort" defaultValue={query.sort}>
                    <option value="title">{t('common.sort.title')}</option>
                    <option value="newest">{t('common.sort.newest')}</option>
                    {showQuranOrder && passages !== null ? (
                      <option value="quran">{passages.sortQuran}</option>
                    ) : null}
                  </Select>
                )}
              </Field>
            </ExploreFilters>

            <ActiveFilters label={t('common.active')} filters={active} />

            {range === null ? null : (
              <p className="text-sm text-foreground-muted">
                {t('books.summary', {
                  from: range.from,
                  to: range.to,
                  total: page.total,
                })}
              </p>
            )}

            {page.items.length === 0 ? (
              query.page > 1 && page.total > 0 ? (
                <EmptyState
                  title={t('common.pastEndTitle')}
                  action={{ href: href({ page: 1 }), text: t('common.firstPage') }}
                >
                  {t('books.pastEnd', { page: query.page })}
                </EmptyState>
              ) : (
                <EmptyState
                  title={t('books.noResultsTitle')}
                  action={{ href: base, text: t('common.reset') }}
                >
                  {copy.noResults}
                </EmptyState>
              )
            ) : (
              <ul
                aria-label={title}
                className="grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4"
              >
                {page.items.map((work) => card(work))}
              </ul>
            )}

            {page.items.length === 0 ? null : (
              <Pager
                label={t('books.pages')}
                previous={query.page > 1 ? href({ page: query.page - 1 }) : null}
                next={page.hasMore ? href({ page: query.page + 1 }) : null}
                previousLabel={domain.previous}
                nextLabel={domain.next}
                pages={{
                  current: query.page,
                  total: pages,
                  href: (number) => href({ page: number }),
                  label: (number) => t('common.pageLabel', { page: number }),
                  format: (number) => new Intl.NumberFormat(locale).format(number),
                }}
              />
            )}
          </section>
        </>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
          {copy.about}
        </p>
        {onward === undefined ? (
          <p className="text-sm">
            <a
              href={
                domain.topicId === null
                  ? localizedPath(locale, '/library/books')
                  : localizedPath(
                      locale,
                      `/library/books?topic=${encodeURIComponent(domain.topicId)}`,
                    )
              }
              className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
            >
              {t('books.libraryLink')}
              <Icon name="arrow-end" size={16} />
            </a>
          </p>
        ) : (
          <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {onward.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
                >
                  {link.text}
                  <Icon name="arrow-end" size={16} />
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>,
  );
}

/**
 * One availability choice: a native checkbox submitted as `name=1`, its label
 * the whole 44-pixel target.
 */
function Check({
  name,
  checked,
  label,
}: {
  readonly name: string;
  readonly checked: boolean;
  readonly label: string;
}) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm">
      <input
        type="checkbox"
        name={name}
        value="1"
        defaultChecked={checked}
        className="size-5 shrink-0 accent-action"
      />
      <span className="min-w-0 wrap-anywhere">{label}</span>
    </label>
  );
}
