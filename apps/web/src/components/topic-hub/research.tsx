import 'server-only';

import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import type {
  TopicResearchFacetPage,
  TopicResearchItem,
  TopicResearchKind,
} from '@minhaj/contracts/library';
import { CONTRIBUTION_ROLES, type ContributionRole } from '@minhaj/contracts/people';

import {
  libraryContentLanguages,
  libraryReadRuntime,
  libraryReferenceNames,
  type ContentLanguage,
} from '@/composition/library-read';
import {
  doiHref,
  scholarlyLabel,
  scholarlyListPath,
  scholarlyPath,
} from '@/components/library/scholarly-presentation';
import {
  Badge,
  EmptyState,
  Field,
  Icon,
  LinkTabs,
  Pager,
  SectionHeader,
  Select,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { caseless } from './address';
import type { HubDomain, HubLink } from './domain';
import { ActiveFilters, ExploreFilters, ExploreHero, languageName } from './parts';
import {
  KIND_WORDS,
  LIBRARY_RECORD_SCOPES,
  byDecade,
  excerptOf,
  libraryRecordsReadQuery,
  researchFiltered,
  researchHref,
  researchPageCount,
  researchRange,
  researchReadQuery,
  type ResearchQuery,
  type ResearchScope,
} from './research-view';

/**
 * A SUBJECT'S RESEARCH HUB (Quran Part 12; shared with Hadith since Hadith
 * Part 1) — `/quran/research`, `/hadith/research` — and, since Library Part
 * 3, the whole Library's research listings, `/library/research` and
 * `/library/research-papers` (`scope.kind`), as Library Part 1 made the Books
 * listing.
 *
 * LAYER-4 COMPOSITION OF LIBRARY'S OWN PUBLIC READS (DOMAIN_MODEL.md §3.1,
 * §10.2): the research is Library's — the public Research and ResearchPaper
 * records on the subject's Taxonomy Topic, or (whole Library) every public
 * record of one kind — read through Library's public `topicResearch` and
 * `topicResearchFacets`; the names of their contributors are People's, the
 * Topics' Taxonomy's, the content languages' directions Taxonomy's. No
 * subject context imports Library; only this presentation layer composes
 * them.
 *
 * READ MODE: SCHOLARLY, PRECISE, CALM. A record is a catalogue entry, not a
 * poster: its kind, content language and date; its title in its own language,
 * linked to Library's canonical address; its authors; where it appeared or the
 * institution it comes from; the opening of its abstract in the abstract's own
 * language and direction; and, below, the way to its full text, its DOI and how
 * many works it cites. In the chronological orders the list reads as a
 * timeline, grouped by decade. No record carries a passage, so there are no
 * passage links — nothing is stated that Library did not answer.
 *
 * ONE ADDRESS PER VIEW (`./research-view`): a kind (a hub's; the whole
 * Library's kind is its address), a Topic (whole Library), a content
 * language, an author, a decade, "full text on the platform", an order and a
 * page, each a GET parameter, so the listing works without script and every
 * view can be shared.
 *
 * THE LISTING BODY IS SHARED (`RecordListing`) with the whole Library's
 * Publications and Encyclopedias (`@/components/library/published`), which
 * differ only in their entries and their words.
 */

/** What a subject says on its Research hub, in its own words. */
export interface ResearchCopy {
  readonly lede: string;
  /** "12 works of research on Hadith". */
  readonly stat: (count: number) => string;
  /** What the listing holds with every kind. */
  readonly listIntro: string;
  readonly emptyTitle: string;
  readonly empty: string;
  readonly noResults: string;
  /** Library Part 3: the whole Library's own eyebrow, notice and closing words. */
  readonly eyebrow?: string;
  readonly notice?: string;
  readonly about?: string;
  /** Library Part 3: where the empty state leads (a hub: the Library's research). */
  readonly emptyAction?: HubLink;
}

type HubTranslator = Awaited<ReturnType<typeof getTranslations<'topicHub'>>>;
type Names = Awaited<ReturnType<typeof libraryReferenceNames>>;

function isRole(role: string): role is ContributionRole {
  return (CONTRIBUTION_ROLES as readonly string[]).includes(role);
}

/** A year as written in the interface's numerals, never grouped ("2021", not "2,021"). */
export function yearText(year: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { useGrouping: false }).format(year);
}

/** A decade's name: "1990s"; or the undated group's. */
function decadeText(decade: number | null, locale: Locale, t: HubTranslator): string {
  return decade === null
    ? t('research.undated')
    : t('research.decade', { decade: yearText(decade, locale) });
}

/** The People credited on a record, as one line; a role other than author is named. */
export function creditLine(
  item: {
    readonly contributors: readonly {
      readonly personId: string;
      readonly role: string;
    }[];
  },
  names: Names,
  t: HubTranslator,
): string {
  const people = caseless(names.people);
  return item.contributors
    .flatMap((entry) => {
      const person = people.get(entry.personId.toLowerCase());
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

/** The record's date: the day when it is known (a date, never shifted by a zone), else the year. */
export function dateOf(
  item: { readonly publishedOn: string | null; readonly publicationYear: number | null },
  locale: Locale,
): { readonly text: string; readonly machine: string } | null {
  if (item.publishedOn !== null)
    return {
      text: new Intl.DateTimeFormat(locale, {
        dateStyle: 'long',
        timeZone: 'UTC',
      }).format(new Date(`${item.publishedOn}T00:00:00Z`)),
      machine: item.publishedOn,
    };
  if (item.publicationYear !== null)
    return {
      text: yearText(item.publicationYear, locale),
      machine: String(item.publicationYear).padStart(4, '0'),
    };
  return null;
}

/**
 * ONE RECORD, as a catalogue entry. The title is the record's one link to its
 * page; the actions beneath — the full text or the details, the DOI — are
 * links of their own, never overlapping it.
 */
function ResearchEntry({
  locale,
  item,
  names,
  languages,
  heading,
  t,
}: {
  readonly locale: Locale;
  readonly item: TopicResearchItem;
  readonly names: Names;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly heading: 'h3' | 'h4';
  readonly t: HubTranslator;
}) {
  const label = scholarlyLabel(item, locale);
  const title = { lang: label.locale, dir: directionOf(label.locale) };
  const href = scholarlyPath(locale, item.kind, item.slug);
  const credits = creditLine(item, names, t);
  const date = dateOf(item, locale);
  const abstract = excerptOf(item.abstract);
  const summary = abstract === null ? excerptOf(label.summary) : null;
  const contentDirection = languages.get(item.languageCode)?.direction ?? 'ltr';
  const Heading = heading;

  return (
    <li className="flex min-w-0 flex-col gap-3 rounded-panel border border-border bg-surface-raised p-4 sm:p-6">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-foreground-muted">
        <Badge>{t(`research.kind.${item.kind}`)}</Badge>
        <span>{languageName(item.languageCode, locale)}</span>
        {date === null ? null : (
          <>
            <span aria-hidden="true">·</span>
            <time dateTime={date.machine}>{date.text}</time>
          </>
        )}
      </p>
      <div className="flex min-w-0 flex-col gap-1.5">
        <Heading
          className="font-serif text-subheading font-semibold text-balance wrap-anywhere"
          {...title}
        >
          <a
            href={href}
            className="text-foreground underline decoration-accent-rule decoration-1 underline-offset-4 hover:decoration-accent active:text-action"
          >
            {label.title}
          </a>
        </Heading>
        {credits === '' ? null : (
          <p className="text-sm font-medium wrap-anywhere text-foreground" dir="auto">
            {credits}
          </p>
        )}
        {item.venue === null ? null : (
          <p className="text-sm wrap-anywhere text-foreground-muted">
            {t('research.venue')} <bdi className="italic">{item.venue}</bdi>
          </p>
        )}
        {item.institutionalContext === null ? null : (
          <p className="text-sm wrap-anywhere text-foreground-muted" dir="auto">
            {item.institutionalContext}
          </p>
        )}
      </div>
      {abstract === null && summary === null ? null : (
        <p
          className="max-w-[var(--measure-prose)] border-s-2 border-accent-rule ps-4 text-sm leading-relaxed wrap-anywhere text-foreground-muted"
          {...(abstract === null
            ? title
            : { lang: item.languageCode, dir: contentDirection })}
        >
          {abstract ?? summary}
        </p>
      )}
      <ul className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-border pt-2 text-sm">
        <li>
          <a
            href={href}
            aria-label={t(
              item.readable ? 'research.readFullNamed' : 'research.detailsNamed',
              { title: label.title },
            )}
            className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
          >
            {t(item.readable ? 'research.readFull' : 'research.details')}
            <Icon name="arrow-end" size={16} />
          </a>
        </li>
        {item.doi === null ? null : (
          <li className="min-w-0">
            <a
              href={doiHref(item.doi)}
              rel="noopener noreferrer"
              className="inline-flex min-h-11 max-w-full items-center gap-1.5 text-action underline-offset-4 hover:underline"
            >
              <span className="font-semibold">{t('research.doi')}</span>
              <bdi dir="ltr" className="min-w-0 wrap-anywhere">
                {item.doi}
              </bdi>
              <Icon name="external" size={16} className="shrink-0" />
            </a>
          </li>
        )}
        {item.citations === 0 ? null : (
          <li className="inline-flex min-h-11 items-center text-foreground-muted">
            {t('research.citations', { count: item.citations })}
          </li>
        )}
      </ul>
    </li>
  );
}

/**
 * A list of research entries outside a hub — a Topic's own page (Learn Part
 * 2), a record's related works (Library Part 3) — every contributor resolved
 * in ONE People call and the content languages in ONE Taxonomy call. Nothing
 * when empty.
 */
export async function ResearchShelf({
  locale,
  items,
  label,
}: {
  readonly locale: Locale;
  readonly items: readonly TopicResearchItem[];
  readonly label: string;
}) {
  if (items.length === 0) return null;
  const [t, names, languages] = await Promise.all([
    getTranslations({ locale, namespace: 'topicHub' }),
    libraryReferenceNames(
      {
        personIds: items.flatMap((item) =>
          item.contributors.map((entry) => entry.personId),
        ),
        topicIds: [],
      },
      locale,
    ),
    libraryContentLanguages(),
  ]);
  return (
    <ul aria-label={label} className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
      {items.map((item) => (
        <ResearchEntry
          key={`${item.kind}-${item.id}`}
          locale={locale}
          item={item}
          names={names}
          languages={languages}
          heading="h3"
          t={t}
        />
      ))}
    </ul>
  );
}

/* ===========================================================================
 * The listing body, shared with the Library's Publications and Encyclopedias
 * ========================================================================= */

/** The words a listing of records speaks in: the research hub's, or a kind's. */
export interface ListingWords {
  readonly listHeading: string;
  readonly filters: string;
  readonly apply: string;
  readonly summary: (range: { from: number; to: number; total: number }) => string;
  readonly noResultsTitle: string;
  readonly pastEnd: (page: number) => string;
  readonly pages: string;
}

/** The figures a hero states: a count or a written figure, and where it leads. */
interface Stat {
  readonly value: number | string;
  readonly label: string;
  readonly href?: string;
}

/** What a listing is navigated by — every count without its own filter. */
export interface ListingFacets {
  readonly languages: TopicResearchFacetPage;
  readonly contributors: TopicResearchFacetPage;
  readonly topics: TopicResearchFacetPage;
  readonly decades: readonly { readonly decade: number; readonly records: number }[];
  readonly readable: number;
  /** Whether the full-text filter can change anything. */
  readonly showFullText: boolean;
}

/**
 * THE LISTING OF RECORDS — the hero, then (unless nothing is published) the
 * list's header, its tabs, the GET filter form, the active-filter chips,
 * "n–m of N", the entries (a timeline by decade in the chronological
 * orders), the honest empty states and numbered pages; and the closing words.
 */
export function RecordListing<T extends { readonly publicationYear: number | null }>({
  domain,
  scope,
  query,
  t,
  stem,
  hero,
  empty,
  tabs,
  intro,
  words,
  noResults,
  facets,
  names,
  page,
  entry,
  keyOf,
  footer,
}: {
  readonly domain: HubDomain;
  readonly scope: ResearchScope;
  readonly query: ResearchQuery;
  readonly t: HubTranslator;
  /** The listing's element identifiers start with it (`research`). */
  readonly stem: string;
  readonly hero: ReactNode;
  /** The state when nothing is published at all; the listing otherwise. */
  readonly empty: ReactNode | null;
  readonly tabs: ReactNode;
  readonly intro: string;
  readonly words: ListingWords;
  readonly noResults: string;
  readonly facets: ListingFacets;
  readonly names: Names;
  readonly page: {
    readonly items: readonly T[];
    readonly total: number;
    readonly hasMore: boolean;
  };
  readonly entry: (item: T, heading: 'h3' | 'h4') => ReactNode;
  readonly keyOf: (item: T) => string;
  readonly footer: ReactNode;
}) {
  const { locale } = domain;
  const LIST_ID = `${domain.key}-${stem}-list`;
  const title = domain.title;
  const filtered = researchFiltered(query, scope);
  const base = researchHref(scope, locale, query, {
    kind: scope.kind === undefined ? 'all' : query.kind,
    language: null,
    contributor: null,
    decade: null,
    fullText: false,
    ...(scope.kind === undefined ? {} : { topic: null }),
  });
  const pages = researchPageCount(page.total, scope);
  const range = researchRange(query.page, page.items.length, scope);

  const people = caseless(names.people);
  const topics = caseless(names.topics);
  const contributorOptions = facets.contributors.items.flatMap((facet) => {
    const person = people.get(facet.id.toLowerCase());
    return person === undefined
      ? []
      : [{ id: facet.id.toLowerCase(), name: person.name, records: facet.records }];
  });
  const topicOptions = facets.topics.items.flatMap((facet) => {
    const topic = topics.get(facet.id.toLowerCase());
    return topic === undefined
      ? []
      : [{ id: facet.id.toLowerCase(), name: topic.name, records: facet.records }];
  });
  const chosenTopic = query.topic ?? null;
  const showTopic = topicOptions.length > 0 || chosenTopic !== null;
  const showLanguage = facets.languages.items.length > 1 || query.language !== null;
  const showContributor = contributorOptions.length > 0 || query.contributor !== null;
  const showDecade = facets.decades.length > 1 || query.decade !== null;
  const contributorName =
    query.contributor === null
      ? null
      : (people.get(query.contributor.toLowerCase())?.name ?? null);
  const topicName =
    chosenTopic === null ? null : (topics.get(chosenTopic.toLowerCase())?.name ?? null);

  const active = [
    ...(chosenTopic === null
      ? []
      : [
          {
            key: 'topic',
            text: topicName ?? t('books.unknownTopic'),
            removeHref: researchHref(scope, locale, query, { topic: null }),
          },
        ]),
    ...(query.language === null
      ? []
      : [
          {
            key: 'language',
            text: languageName(query.language, locale),
            removeHref: researchHref(scope, locale, query, { language: null }),
          },
        ]),
    ...(query.contributor === null
      ? []
      : [
          {
            key: 'contributor',
            text: contributorName ?? t('common.unknownContributor'),
            removeHref: researchHref(scope, locale, query, { contributor: null }),
          },
        ]),
    ...(query.decade === null
      ? []
      : [
          {
            key: 'decade',
            text: decadeText(query.decade, locale, t),
            removeHref: researchHref(scope, locale, query, { decade: null }),
          },
        ]),
    ...(query.fullText
      ? [
          {
            key: 'fulltext',
            text: t('research.fullTextOnly'),
            removeHref: researchHref(scope, locale, query, { fullText: false }),
          },
        ]
      : []),
  ].map((filter) => ({
    ...filter,
    removeLabel: t('common.remove', { name: filter.text }),
  }));

  // In the chronological orders the page reads as a timeline, by decade.
  const chronological = query.sort !== 'title';
  const groups = chronological
    ? byDecade(page.items)
    : [{ decade: null, items: page.items }];

  return domain.frame(
    <>
      {hero}

      {empty ?? (
        <section aria-labelledby={LIST_ID} className="flex flex-col gap-5">
          <SectionHeader id={LIST_ID} heading={words.listHeading} intro={intro} />

          {tabs}

          <ExploreFilters
            action={localizedPath(locale, scope.path)}
            label={words.filters}
            hidden={
              scope.kind !== undefined || query.kind === 'all'
                ? []
                : [{ name: 'kind', value: KIND_WORDS[query.kind] }]
            }
            submit={words.apply}
            reset={filtered ? { href: base, text: t('common.reset') } : null}
          >
            {showTopic ? (
              <Field id={`${stem}-topic`} label={t('books.filterTopic')}>
                {(props) => (
                  <Select {...props} name="topic" defaultValue={chosenTopic ?? ''}>
                    <option value="">{t('books.anyTopic')}</option>
                    {topicOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {t('common.option', {
                          name: option.name,
                          count: option.records,
                        })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {showLanguage ? (
              <Field id={`${stem}-language`} label={t('common.filterLanguage')}>
                {(props) => (
                  <Select {...props} name="language" defaultValue={query.language ?? ''}>
                    <option value="">{t('common.anyLanguage')}</option>
                    {facets.languages.items.map((facet) => (
                      <option key={facet.id} value={facet.id}>
                        {t('common.option', {
                          name: languageName(facet.id, locale),
                          count: facet.records,
                        })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {showContributor ? (
              <Field id={`${stem}-contributor`} label={t('common.filterContributor')}>
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
                          count: option.records,
                        })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {showDecade ? (
              <Field id={`${stem}-decade`} label={t('research.filterDecade')}>
                {(props) => (
                  <Select
                    {...props}
                    name="decade"
                    defaultValue={query.decade === null ? '' : String(query.decade)}
                  >
                    <option value="">{t('research.anyDecade')}</option>
                    {facets.decades.map((row) => (
                      <option key={row.decade} value={String(row.decade)}>
                        {t('common.option', {
                          name: decadeText(row.decade, locale, t),
                          count: row.records,
                        })}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : null}
            {facets.showFullText ? (
              <Field id={`${stem}-fulltext`} label={t('research.filterFullText')}>
                {(props) => (
                  <Select
                    {...props}
                    name="fulltext"
                    defaultValue={query.fullText ? '1' : ''}
                  >
                    <option value="">{t('research.anyText')}</option>
                    <option value="1">
                      {t('common.option', {
                        name: t('research.fullTextOnly'),
                        count: facets.readable,
                      })}
                    </option>
                  </Select>
                )}
              </Field>
            ) : null}
            <Field id={`${stem}-sort`} label={t('common.filterSort')}>
              {(props) => (
                <Select {...props} name="sort" defaultValue={query.sort}>
                  <option value="newest">{t('common.sort.newest')}</option>
                  <option value="oldest">{t('research.sortOldest')}</option>
                  <option value="title">{t('common.sort.title')}</option>
                </Select>
              )}
            </Field>
          </ExploreFilters>

          <ActiveFilters label={t('common.active')} filters={active} />

          {range === null ? null : (
            <p className="text-sm text-foreground-muted">
              {words.summary({ from: range.from, to: range.to, total: page.total })}
            </p>
          )}

          {page.items.length === 0 ? (
            query.page > 1 && page.total > 0 ? (
              <EmptyState
                title={t('common.pastEndTitle')}
                action={{
                  href: researchHref(scope, locale, query, { page: 1 }),
                  text: t('common.firstPage'),
                }}
              >
                {words.pastEnd(query.page)}
              </EmptyState>
            ) : (
              <EmptyState
                title={words.noResultsTitle}
                action={{ href: base, text: t('common.reset') }}
              >
                {noResults}
              </EmptyState>
            )
          ) : chronological ? (
            <div className="flex flex-col gap-8">
              {groups.map((group, index) => {
                const id = `${domain.key}-${stem}-decade-${String(index)}`;
                const name = decadeText(group.decade, locale, t);
                return (
                  <section
                    key={id}
                    aria-labelledby={id}
                    className="grid grid-cols-1 gap-3 md:grid-cols-[8rem_minmax(0,1fr)] md:gap-6"
                  >
                    <h3
                      id={id}
                      className="font-serif text-heading font-semibold text-accent tabular-nums md:sticky md:top-24 md:self-start md:pt-4"
                    >
                      {name}
                    </h3>
                    <ul aria-label={name} className="flex min-w-0 flex-col gap-4">
                      {group.items.map((item) => (
                        <EntrySlot key={keyOf(item)}>{entry(item, 'h4')}</EntrySlot>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          ) : (
            <ul aria-label={title} className="flex min-w-0 flex-col gap-4">
              {page.items.map((item) => (
                <EntrySlot key={keyOf(item)}>{entry(item, 'h3')}</EntrySlot>
              ))}
            </ul>
          )}

          {page.items.length === 0 ? null : (
            <Pager
              label={words.pages}
              previous={
                query.page > 1
                  ? researchHref(scope, locale, query, { page: query.page - 1 })
                  : null
              }
              next={
                page.hasMore
                  ? researchHref(scope, locale, query, { page: query.page + 1 })
                  : null
              }
              previousLabel={domain.previous}
              nextLabel={domain.next}
              pages={{
                current: query.page,
                total: pages,
                href: (number) => researchHref(scope, locale, query, { page: number }),
                label: (number) => t('common.pageLabel', { page: number }),
                format: (number) => new Intl.NumberFormat(locale).format(number),
              }}
            />
          )}
        </section>
      )}

      {footer}
    </>,
  );
}

/** A keyed wrapper: each entry renders its own `<li>`. */
function EntrySlot({ children }: { readonly children: ReactNode }) {
  return <>{children}</>;
}

/** A listing's closing words and its ways onward. */
export function ListingFooter({
  about,
  links,
}: {
  readonly about: string;
  readonly links: readonly HubLink[];
}) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-4">
      <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
        {about}
      </p>
      <ul className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {links.map((link) => (
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
    </div>
  );
}

/** A year span in words, or null when no record is dated. */
export function spanText(
  earliest: number | null,
  latest: number | null,
  locale: Locale,
  t: HubTranslator,
): string | null {
  if (earliest === null || latest === null) return null;
  return earliest === latest
    ? yearText(earliest, locale)
    : t('research.span', {
        from: yearText(earliest, locale),
        to: yearText(latest, locale),
      });
}

/** The figures every listing of records can state: the full text, authors, languages, years. */
export function commonStats(
  figures: {
    readonly readable: number;
    readonly contributors: number;
    readonly languages: number;
    readonly earliest: number | null;
    readonly latest: number | null;
  },
  readableHref: string,
  locale: Locale,
  t: HubTranslator,
): Stat[] {
  const span = spanText(figures.earliest, figures.latest, locale, t);
  return [
    ...(figures.readable === 0
      ? []
      : [
          {
            value: figures.readable,
            label: t('research.statReadable', { count: figures.readable }),
            href: readableHref,
          },
        ]),
    ...(figures.contributors === 0
      ? []
      : [
          {
            value: figures.contributors,
            label: t('research.statContributors', { count: figures.contributors }),
          },
        ]),
    ...(figures.languages < 2
      ? []
      : [
          {
            value: figures.languages,
            label: t('common.statLanguages', { count: figures.languages }),
          },
        ]),
    ...(span === null ? [] : [{ value: span, label: t('research.statSpan') }]),
  ];
}

/* ===========================================================================
 * The research hub and the Library's research listings
 * ========================================================================= */

export async function ResearchHub({
  domain,
  scope,
  query,
  copy,
  actions,
  onward,
}: {
  readonly domain: HubDomain;
  readonly scope: ResearchScope;
  readonly query: ResearchQuery;
  readonly copy: ResearchCopy;
  /** The ways onward the header offers. */
  readonly actions: readonly HubLink[];
  /** Library Part 3: the closing ways onward in place of the Library's listings. */
  readonly onward?: readonly HubLink[];
}) {
  const { locale } = domain;
  const t = await getTranslations({ locale, namespace: 'topicHub' });
  const library = libraryReadRuntime();
  const whole = scope.kind !== undefined;
  const read =
    scope.kind === undefined
      ? researchReadQuery(query, domain.topicId, locale)
      : libraryRecordsReadQuery({ ...scope, kind: scope.kind }, query, locale);
  const [page, facets, languages] = await Promise.all([
    library.topicResearch(read),
    library.topicResearchFacets(read),
    libraryContentLanguages(),
  ]);
  const names = await libraryReferenceNames(
    {
      personIds: [
        ...page.items.flatMap((item) => item.contributors.map((entry) => entry.personId)),
        ...facets.contributors.items.map((facet) => facet.id),
        ...(query.contributor === null ? [] : [query.contributor]),
      ],
      topicIds: [
        ...facets.topics.items.map((facet) => facet.id),
        ...((query.topic ?? null) === null ? [] : [query.topic ?? '']),
      ],
    },
    locale,
  );

  const LIST_ID = `${domain.key}-research-list`;
  const hub = facets.hub;
  const empty = (kind: Partial<ResearchQuery>) =>
    researchHref(scope, locale, query, {
      language: null,
      contributor: null,
      decade: null,
      fullText: false,
      ...(whole ? { topic: null } : {}),
      ...kind,
    });

  const hero = (
    <ExploreHero
      eyebrow={copy.eyebrow ?? t('research.eyebrow')}
      title={domain.title}
      lede={copy.lede}
      {...(copy.notice === undefined ? {} : { notice: copy.notice })}
      stats={[
        ...(hub.records === 0
          ? []
          : [{ value: hub.records, label: copy.stat(hub.records), href: `#${LIST_ID}` }]),
        ...(hub.research === 0 || hub.papers === 0
          ? []
          : [
              {
                value: hub.papers,
                label: t('research.statPapers', { count: hub.papers }),
                href: empty({ kind: 'research-paper' }),
              },
            ]),
        ...commonStats(
          hub,
          empty({ kind: whole ? query.kind : 'all', fullText: true }),
          locale,
          t,
        ),
      ]}
      actions={actions}
    />
  );

  const tabs = whole ? (
    <LinkTabs
      label={t('research.kinds')}
      tabs={(
        ['research', 'research-paper'] as const satisfies readonly TopicResearchKind[]
      ).map((kind) => ({
        href: researchHref(
          LIBRARY_RECORD_SCOPES[kind],
          locale,
          { ...query, kind },
          { page: 1 },
        ),
        text: t(`research.tab.${kind}`),
        current: scope.kind === kind,
        count: String(kind === 'research' ? facets.kinds.research : facets.kinds.papers),
      }))}
    />
  ) : (hub.research > 0 && hub.papers > 0) || query.kind !== 'all' ? (
    <LinkTabs
      label={t('research.kinds')}
      tabs={(['all', 'research', 'research-paper'] as const).map((kind) => ({
        href: researchHref(scope, locale, query, { kind }),
        text: t(`research.tab.${kind}`),
        current: query.kind === kind,
        count: String(
          kind === 'all'
            ? facets.kinds.all
            : kind === 'research'
              ? facets.kinds.research
              : facets.kinds.papers,
        ),
      }))}
    />
  ) : null;

  const footer = (
    <ListingFooter
      about={copy.about ?? t('research.about')}
      links={
        onward ??
        (['research', 'research-paper'] as const).map((kind) => ({
          href: `${scholarlyListPath(locale, kind)}${
            domain.topicId === null ? '' : `?topic=${encodeURIComponent(domain.topicId)}`
          }`,
          text: t(
            kind === 'research' ? 'research.libraryResearch' : 'research.libraryPapers',
          ),
        }))
      }
    />
  );

  return RecordListing({
    domain,
    scope,
    query,
    t,
    stem: 'research',
    hero,
    empty:
      hub.records === 0 ? (
        <EmptyState
          icon="book"
          title={copy.emptyTitle}
          action={
            copy.emptyAction ?? {
              href: scholarlyListPath(locale, 'research'),
              text: t('research.libraryResearch'),
            }
          }
        >
          {copy.empty}
        </EmptyState>
      ) : null,
    tabs,
    intro:
      whole || query.kind === 'all'
        ? copy.listIntro
        : t(`research.kindHelp.${query.kind}`),
    words: {
      listHeading: t('research.listHeading'),
      filters: t('research.filters'),
      apply: t('research.apply'),
      summary: (range) => t('research.summary', range),
      noResultsTitle: t('research.noResultsTitle'),
      pastEnd: (number) => t('research.pastEnd', { page: number }),
      pages: t('research.pages'),
    },
    noResults: copy.noResults,
    facets: {
      languages: facets.languages,
      contributors: facets.contributors,
      topics: facets.topics,
      decades: facets.decades,
      readable: facets.readable,
      showFullText: (hub.readable > 0 && hub.readable < hub.records) || query.fullText,
    },
    names,
    page,
    entry: (item: TopicResearchItem, heading) => (
      <ResearchEntry
        locale={locale}
        item={item}
        names={names}
        languages={languages}
        heading={heading}
        t={t}
      />
    ),
    keyOf: (item: TopicResearchItem) => `${item.kind}:${item.id}`,
    footer,
  });
}
