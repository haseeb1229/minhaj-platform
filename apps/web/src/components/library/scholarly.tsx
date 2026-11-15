import type { ReactNode } from 'react';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  MAGAZINE_ISSUE_PAGE,
  type MagazineDirectoryItem,
  type MagazineRecord,
  type PublishedRecordItem,
  type ScholarlyCitation,
  type ScholarlyListing as ListingRow,
  type ScholarlyRecord,
  type TopicResearchItem,
} from '@minhaj/contracts/library';

import {
  libraryContentLanguages,
  libraryReadRuntime,
  libraryReferenceNames,
  type ContentLanguage,
} from '@/composition/library-read';
import { absoluteUrl } from '@/config/origin';
import { directionOf } from '@/config/locale';
import {
  ActionLink,
  Alert,
  Breadcrumbs,
  Container,
  Cover,
  DetailRow,
  EmptyState,
  Icon,
  Pager,
  SectionHeader,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { Shelf } from '@/components/ui/shelf';
import { ExploreHero } from '@/components/topic-hub/parts';
import { ResearchShelf, yearText } from '@/components/topic-hub/research';
import {
  DEFAULT_RESEARCH_QUERY,
  LIBRARY_RECORD_SCOPES,
  excerptOf,
  researchHref,
} from '@/components/topic-hub/research-view';
import { caseless } from '@/components/topic-hub/address';
import { isContentIndexable, serializeStructuredData } from '@/seo/metadata';
import { issueNumbering, PeriodicalCard } from './cards';
import { issueCoverPath } from './cover';
import { RecordFrame, RecordSection } from './frame';
import {
  magazineHref,
  magazineIssuesRead,
  magazinePageCount,
  magazinesHref,
  type MagazineView,
} from './magazine-view';
import { PublishedShelf } from './published';
import { Reader, READER_SECTION_ID } from './reader';
import {
  doiHref,
  issuePath,
  issuesByYear,
  listingHref,
  paragraphsOf,
  scholarlyLabel,
  scholarlyListPath,
  scholarlyLocales,
  scholarlyPath,
  sectionBody,
  sectionTitle,
} from './scholarly-presentation';

/**
 * The public Phase-9 Library surfaces — Research, ResearchPaper, Publication,
 * Magazine, MagazineIssue and Encyclopedia (ROUTE_MAP.md §3.6) — rebuilt in
 * Library Part 3: every record's page (its calls to action from its real
 * stored state, its facts and access, the reader at full width, citations and
 * related works), the periodicals directory and a Magazine's page (its year
 * index, its latest issue, numbered pages). The listings of the four
 * non-periodical kinds are the shared record listing
 * (`@/components/topic-hub/research`, `./published`).
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read goes through
 * `@/composition/library-read`, which reaches no Identity, session or cookie,
 * so what a signed-in visitor sees is what an anonymous one sees
 * (ARCHITECTURE.md §8.1).
 *
 * NOT A CATALOGUE CARD. A record with readable text renders that text through
 * the Library's own reader; one without says so plainly. Every fact shown is
 * one the record genuinely has — an unknown publisher, venue, DOI or date is
 * ABSENT, never rendered as a dash or a placeholder; a Magazine's publisher
 * and frequency are not modelled, so none is shown; and no file is held for
 * any of these aggregates, so "no download" is said once, never offered.
 *
 * EVERY STRING OF CONTENT IS A TEXT NODE. Titles, summaries, abstracts,
 * citations and the document are plain text; there is no
 * `dangerouslySetInnerHTML` except the JSON-LD element, whose serialiser
 * escapes `<`.
 */

type LibraryTranslator = Awaited<ReturnType<typeof getTranslations<'library'>>>;
type NameMap = ReadonlyMap<string, { readonly slug: string; readonly name: string }>;

/** A date-only fact, formatted in the interface locale and never shifted by a zone. */
function formatDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}

/** Shared with the admin and the cross-domain related lists, which import them from here. */
export { issueNumbering } from './cards';
export { listingHref } from './scholarly-presentation';

/** How many related works a record's page shows on each shelf. */
const RELATED = 4;
/** How many other issues an issue's page shows. */
const MORE_ISSUES = 12;

/* ===========================================================================
 * The periodicals directory
 * ========================================================================= */

/** A year span in the interface's numerals, or null when no issue is dated. */
function yearsOf(
  earliest: number | null,
  latest: number | null,
  locale: Locale,
  t: LibraryTranslator,
): string | null {
  if (earliest === null || latest === null) return null;
  return earliest === latest
    ? yearText(earliest, locale)
    : t('periodicals.span', {
        from: yearText(earliest, locale),
        to: yearText(latest, locale),
      });
}

/**
 * ONE PERIODICAL in the directory: its cover (its newest issue's), title and
 * description in their own language, how many issues and over which years,
 * and the way straight to its newest issue.
 */
function MagazineEntry({
  locale,
  item,
  t,
}: {
  readonly locale: Locale;
  readonly item: MagazineDirectoryItem;
  readonly t: LibraryTranslator;
}) {
  const label = scholarlyLabel(item.magazine, locale);
  const dir = directionOf(label.locale);
  const cover = item.magazine.latestCover;
  const years = yearsOf(item.earliest, item.latest, locale, t);
  const latest =
    item.latestIssue === null || !isPlaced(item.latestIssue)
      ? null
      : scholarlyLabel(item.latestIssue, locale);
  const summary = excerptOf(label.summary);
  return (
    <li className="grid min-w-0 grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-4 rounded-panel border border-border bg-surface-raised p-4 sm:grid-cols-[minmax(0,10rem)_minmax(0,1fr)] sm:gap-6 sm:p-6">
      <div className="min-w-0">
        {cover === null ? (
          <div
            aria-hidden="true"
            className="flex aspect-[3/4] items-center justify-center rounded-control bg-surface-sunken text-accent"
          >
            <Icon name="book" size={24} />
          </div>
        ) : (
          <Cover
            path={issueCoverPath(cover.issueId, cover.cover.assetId)}
            width={cover.cover.width}
            height={cover.cover.height}
            alt=""
            shape="magazine"
            sizes="(min-width: 40rem) 10rem, 7rem"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <h2
          className="font-serif text-heading font-semibold text-balance wrap-anywhere"
          lang={label.locale}
          dir={dir}
        >
          <a
            href={listingHref(locale, item.magazine)}
            className="text-foreground underline decoration-accent-rule decoration-1 underline-offset-4 hover:decoration-accent"
          >
            {label.title}
          </a>
        </h2>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-foreground-muted">
          <span>{t('periodicals.issueCount', { count: item.issues })}</span>
          {years === null ? null : (
            <>
              <span aria-hidden="true">·</span>
              <span>{years}</span>
            </>
          )}
        </p>
        {summary === null ? null : (
          <p
            className="max-w-[var(--measure-prose)] text-sm leading-relaxed text-foreground-muted"
            lang={label.locale}
            dir={dir}
          >
            {summary}
          </p>
        )}
        {item.latestIssue === null || latest === null ? null : (
          <p className="mt-auto pt-2 text-sm">
            <a
              href={listingHref(locale, item.latestIssue)}
              className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
            >
              {/*
               * One inline run with a visible colon, so the link's name reads
               * "Latest issue: {title}" — a hidden or flex part is named apart.
               */}
              <span className="min-w-0">
                {t('periodicals.latestIssue')}:{' '}
                <bdi
                  className="font-normal text-foreground"
                  lang={latest.locale}
                  dir={directionOf(latest.locale)}
                >
                  {latest.title}
                </bdi>
              </span>
              <Icon name="arrow-end" size={16} className="shrink-0" />
            </a>
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * `/{locale}/library/magazines` — THE PERIODICALS DIRECTORY (Library Part 3):
 * the figures (Magazines, their issues, those with their contents here),
 * every public Magazine with its cover, issue count, years and newest issue,
 * the Topics they are filed under as chips with counts (`?topic=`), and the
 * newest issues across every title. Honest states: nothing published, and
 * nothing under the chosen Topic.
 */
export async function MagazinesListing({
  locale,
  topic,
}: {
  readonly locale: Locale;
  readonly topic: string | null;
}) {
  const t = await getTranslations({ locale, namespace: 'library' });
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const library = libraryReadRuntime();
  const [directory, latest] = await Promise.all([
    library.magazineDirectory({ topic }),
    topic === null ? library.scholarlyList('magazine-issue', {}) : Promise.resolve(null),
  ]);
  const names = await libraryReferenceNames(
    {
      personIds: [],
      topicIds: [
        ...directory.topics.items.map((facet) => facet.id),
        ...(topic === null ? [] : [topic]),
      ],
    },
    locale,
  );
  const topics = caseless(names.topics);
  const title = sectionTitle(t, 'magazine');
  const figures = directory.figures;
  const topicChips = directory.topics.items.flatMap((facet) => {
    const named = topics.get(facet.id.toLowerCase());
    return named === undefined
      ? []
      : [{ id: facet.id.toLowerCase(), name: named.name, count: facet.records }];
  });
  const topicName = topic === null ? null : (topics.get(topic)?.name ?? null);
  // "The latest issues" only where the order means it: dated or numbered.
  const newest = (latest?.items ?? []).filter(isPlaced).slice(0, MORE_ISSUES);
  const LIST_ID = 'library-magazines-list';

  return (
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
        <ExploreHero
          eyebrow={t('title')}
          title={title}
          lede={sectionBody(t, 'magazine')}
          notice={t('scholarly.listingNotice')}
          stats={
            figures.magazines === 0
              ? []
              : [
                  {
                    value: figures.magazines,
                    label: t('periodicals.statMagazines', { count: figures.magazines }),
                    href: `#${LIST_ID}`,
                  },
                  {
                    value: figures.issues,
                    label: t('periodicals.statIssues', { count: figures.issues }),
                  },
                  ...(figures.readable === 0
                    ? []
                    : [
                        {
                          value: figures.readable,
                          label: t('periodicals.statReadable', {
                            count: figures.readable,
                          }),
                        },
                      ]),
                ]
          }
          actions={[
            {
              href: localizedPath(locale, '/library/topics'),
              text: t('section.topics'),
            },
          ]}
        />

        {figures.magazines === 0 ? (
          <EmptyState
            icon="book"
            title={t('periodicals.emptyTitle')}
            action={{
              href: localizedPath(locale, '/library/resources'),
              text: t('records.toResources'),
            }}
          >
            {t('scholarly.empty.magazine')}
          </EmptyState>
        ) : (
          <section aria-labelledby={LIST_ID} className="flex flex-col gap-5">
            <SectionHeader
              id={LIST_ID}
              heading={t('periodicals.listHeading')}
              intro={t('periodicals.listIntro')}
            />
            {topicChips.length < 2 && topic === null ? null : (
              <nav aria-label={t('periodicals.byTopic')} className="flex flex-col gap-2">
                <p className="text-sm font-semibold">{t('periodicals.byTopic')}</p>
                <ul className="flex flex-wrap gap-2">
                  {[
                    {
                      id: null,
                      name: t('periodicals.allTopics'),
                      count: figures.magazines,
                    },
                    ...topicChips,
                  ].map((chip) => (
                    <li key={chip.id ?? 'all'}>
                      <Chip
                        href={magazinesHref(locale, chip.id)}
                        current={chip.id === topic}
                        name={chip.name}
                        count={new Intl.NumberFormat(locale).format(chip.count)}
                      />
                    </li>
                  ))}
                </ul>
              </nav>
            )}
            {directory.items.length === 0 ? (
              <EmptyState
                title={t('periodicals.noResultsTitle')}
                action={{
                  href: magazinesHref(locale, null),
                  text: t('periodicals.allMagazines'),
                }}
              >
                {t('periodicals.noResults', {
                  topic: topicName ?? t('periodicals.thisTopic'),
                })}
              </EmptyState>
            ) : (
              <ul
                aria-label={title}
                className="grid list-none grid-cols-1 gap-4 p-0 xl:grid-cols-2"
              >
                {directory.items.map((item) => (
                  <MagazineEntry
                    key={item.magazine.id}
                    locale={locale}
                    item={item}
                    t={t}
                  />
                ))}
              </ul>
            )}
            {directory.hasMore ? (
              <p className="text-sm text-foreground-muted">{t('periodicals.more')}</p>
            ) : null}
          </section>
        )}

        {newest.length === 0 ? null : (
          <section aria-labelledby="latest-issues">
            <Shelf
              label={t('landing.latestIssues')}
              size="cover"
              previousLabel={t('landing.showPrevious')}
              nextLabel={t('landing.showNext')}
              header={
                <h2 id="latest-issues" className="text-heading font-semibold">
                  {t('landing.latestIssues')}
                </h2>
              }
            >
              {newest.map((row) => (
                <PeriodicalCard key={row.id} locale={locale} row={row} t={t} />
              ))}
            </Shelf>
          </section>
        )}
      </div>
    </Container>
  );
}

/**
 * Whether an issue has a place in its periodical's order — a year or a
 * printed number. Only then is "the latest" a true word for the first one: a
 * Magazine whose issues carry neither is listed in slug order, and nothing
 * calls one of them its latest.
 */
function isPlaced(row: ListingRow): boolean {
  return (
    row.publicationYear !== null ||
    (row.issue?.volume ?? null) !== null ||
    (row.issue?.issueNumber ?? null) !== null
  );
}

/** A link chip in an index: its name, its count, and whether it is the view shown. */
function Chip({
  href,
  current,
  name,
  count,
}: {
  readonly href: string;
  readonly current: boolean;
  readonly name: string;
  readonly count: string;
}) {
  return (
    <a
      href={href}
      {...(current ? { 'aria-current': 'page' as const } : {})}
      className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm no-underline tabular-nums ${
        current
          ? 'border-action bg-accent-surface font-semibold text-foreground'
          : 'border-border bg-surface-raised text-foreground hover:bg-surface-sunken'
      }`}
    >
      {name}
      <span className="text-caption font-normal text-foreground-muted">{count}</span>
    </a>
  );
}

/* ===========================================================================
 * Shared detail parts
 * ========================================================================= */

/**
 * Contributors, resolved by People and linked to People's canonical address. A
 * credit is attribution and grants nothing; one People cannot resolve is omitted
 * rather than printed as an identifier.
 */
function contributorRows(
  record: { readonly contributors: ScholarlyRecord['contributors'] },
  people: NameMap,
) {
  const named = caseless(people);
  return record.contributors.flatMap((entry) => {
    const person = named.get(entry.personId.toLowerCase());
    return person === undefined ? [] : [{ person, role: entry.role }];
  });
}

function Contributors({
  record,
  people,
  locale,
  t,
}: {
  readonly record: { readonly contributors: ScholarlyRecord['contributors'] };
  readonly people: NameMap;
  readonly locale: Locale;
  readonly t: LibraryTranslator;
}) {
  const rows = contributorRows(record, people);
  if (rows.length === 0) return null;

  return (
    <RecordSection id="scholarly-contributors" heading={t('contributors')}>
      <ul className="flex flex-col divide-y divide-border text-sm">
        {rows.map((row) => (
          <li
            key={`${row.person.slug}-${row.role}`}
            className="flex flex-col gap-0.5 py-2"
          >
            <TextLink
              href={localizedPath(
                locale,
                `/people/${encodeURIComponent(row.person.slug)}`,
              )}
            >
              {row.person.name}
            </TextLink>
            <span className="text-caption text-foreground-muted">
              {t(`role.${row.role}`)}
            </span>
          </li>
        ))}
      </ul>
    </RecordSection>
  );
}

/** Topics resolved by Taxonomy, in the record's own order. */
function topicRows(topicIds: readonly string[], topics: NameMap) {
  const named = caseless(topics);
  return topicIds.flatMap((id) => {
    const topic = named.get(id.toLowerCase());
    return topic === undefined ? [] : [{ id, ...topic }];
  });
}

/** Topics, each linked to its canonical hub (Phase 17). */
function Topics({
  topicIds,
  topics,
  locale,
  t,
}: {
  readonly topicIds: readonly string[];
  readonly topics: NameMap;
  readonly locale: Locale;
  readonly t: LibraryTranslator;
}) {
  const rows = topicRows(topicIds, topics);
  if (rows.length === 0) return null;

  return (
    <RecordSection id="scholarly-topics" heading={t('topics')}>
      <TopicChips
        label={t('topics')}
        topics={rows.map((topic) => ({
          href: localizedPath(locale, `/topics/${encodeURIComponent(topic.slug)}`),
          text: topic.name,
        }))}
      />
    </RecordSection>
  );
}

/** The citations, in the source's order, each link only where one is known. */
function Citations({
  citations,
  direction,
  languageCode,
  t,
}: {
  readonly citations: readonly ScholarlyCitation[];
  readonly direction: 'ltr' | 'rtl';
  readonly languageCode: string;
  readonly t: LibraryTranslator;
}) {
  if (citations.length === 0) return null;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="scholarly-citations">
      <h2 id="scholarly-citations" className="text-heading font-semibold">
        {t('scholarly.citations')}
      </h2>
      <ol className="flex max-w-[var(--measure-prose)] list-decimal flex-col gap-4 ps-6 text-sm marker:text-foreground-muted">
        {citations.map((citation, index) => (
          <li key={index} className="break-words ps-1">
            <span lang={languageCode} dir={direction}>
              {citation.text}
            </span>
            {citation.doi === null && citation.url === null ? null : (
              <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {citation.doi === null ? null : (
                  <TextLink href={doiHref(citation.doi)}>
                    {t('scholarly.citationDoi', { doi: citation.doi })}
                  </TextLink>
                )}
                {citation.url === null ? null : (
                  <TextLink href={citation.url}>{t('scholarly.citationSource')}</TextLink>
                )}
              </span>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

/** What each kind calls its readable text, and the call to read it. */
const READING_WORDS = {
  research: { heading: 'scholarly.fullText', action: 'records.readFull' },
  'research-paper': { heading: 'scholarly.fullText', action: 'records.readFull' },
  publication: { heading: 'scholarly.fullText', action: 'records.readFull' },
  encyclopedia: { heading: 'records.entriesHeading', action: 'records.readEntries' },
  'magazine-issue': {
    heading: 'periodicals.inThisIssue',
    action: 'periodicals.readIssue',
  },
} as const;

/**
 * The readable text through the Library's reader (the Part 1 layout, at the
 * page's full width), introduced by its language and its sections — an
 * Encyclopedia's sections are its entries.
 */
function RecordReader({
  record,
  language,
  locale,
  t,
}: {
  readonly record: ContentRecord;
  readonly language: ContentLanguage | undefined;
  readonly locale: Locale;
  readonly t: LibraryTranslator;
}) {
  if (record.document === null) return null;
  const positionTemplate = t('sectionPosition', {
    current: '{current}',
    total: '{total}',
  });
  const count = record.document.sections.length;
  return (
    <Reader
      anchorFor={(key) => `section-${key}`}
      languageCode={record.languageCode}
      direction={language?.direction ?? 'ltr'}
      interfaceLocale={locale}
      interfaceDirection={directionOf(locale)}
      document={record.document}
      labels={{
        readerHeading: t(READING_WORDS[record.kind].heading),
        readerIntro: t(
          record.kind === 'encyclopedia' ? 'records.entriesIntro' : 'records.readerIntro',
          { language: language?.name ?? record.languageCode, count },
        ),
        contents: t('contents'),
        sectionPosition: positionTemplate,
        nextSection: t('nextSection'),
        previousSection: t('previousSection'),
        backToContents: t('backToContents'),
        heading: t('readerControls'),
        fontSize: t('fontSize'),
        lineHeight: t('lineHeight'),
        measure: t('measure'),
        decrease: t('decrease'),
        increase: t('increase'),
        reset: t('reset'),
        progressValue: positionTemplate,
        positionBar: t('readerPosition'),
      }}
    />
  );
}

/**
 * JSON-LD, ONLY WHAT IS TRUE and only when the page is indexable at all.
 *
 * A `BreadcrumbList` for every record, because every record has a hierarchical
 * path. `Article` for Research and ResearchPaper, which is the type ROUTE_MAP.md
 * §9.6 assigns to research, carrying a headline, the content language, the
 * address and — only where genuinely known — resolved author names and a
 * publication date. No image, no publisher Organization, no rating.
 */
function StructuredData({
  record,
  title,
  trail,
  path,
  authors,
}: {
  readonly record: ScholarlyRecord;
  readonly title: string;
  readonly trail: readonly { readonly name: string; readonly path: string }[];
  readonly path: string;
  readonly authors: readonly string[];
}) {
  if (!isContentIndexable({ contentLocales: scholarlyLocales(record) })) return null;

  const graph: Record<string, unknown>[] = [
    {
      '@type': 'BreadcrumbList',
      itemListElement: trail.map((entry, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: entry.name,
        item: absoluteUrl(entry.path),
      })),
    },
  ];
  if (record.kind === 'research' || record.kind === 'research-paper') {
    graph.push({
      '@type': 'Article',
      headline: title,
      inLanguage: record.languageCode,
      url: absoluteUrl(path),
      ...(authors.length === 0
        ? {}
        : { author: authors.map((name) => ({ '@type': 'Person', name })) }),
      ...(record.publishedOn === null ? {} : { datePublished: record.publishedOn }),
    });
  }

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: serializeStructuredData({
          '@context': 'https://schema.org',
          '@graph': graph,
        }),
      }}
    />
  );
}

/* ===========================================================================
 * Detail
 * ========================================================================= */

type ContentRecord = Exclude<ScholarlyRecord, MagazineRecord>;

/** A breadcrumb trail from a structured-data trail: every entry linked but the last. */
function crumbsOf(
  trail: readonly { readonly name: string; readonly path: string }[],
  current: string,
) {
  return [
    ...trail.slice(0, -1).map((entry) => ({ href: entry.path, text: entry.name })),
    { text: current },
  ];
}

/** The first credited Person with a role, else the first credited at all. */
function leadPerson(record: { readonly contributors: ScholarlyRecord['contributors'] }) {
  return (
    record.contributors.find((entry) => entry.role === 'author') ??
    record.contributors[0] ??
    null
  );
}

/** A related shelf: its heading, its way to the whole filtered listing, its entries. */
function RelatedSection({
  id,
  heading,
  all,
  children,
}: {
  readonly id: string;
  readonly heading: string;
  readonly all: { readonly href: string; readonly text: string };
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-4">
      <SectionHeader id={id} heading={heading} action={all} />
      {children}
    </section>
  );
}

/**
 * RELATED WORKS (Library Part 3): more of the same kind family on the
 * record's first Topic, then more by its first author (else its first
 * credited Person) — never the record itself, and never one record twice
 * across the two shelves. Research and research papers are related across
 * the two kinds (one research read); a Publication or an Encyclopedia among
 * its own kind.
 */
async function RelatedWorks({
  locale,
  record,
  references,
  t,
}: {
  readonly locale: Locale;
  readonly record: Exclude<ContentRecord, { readonly kind: 'magazine-issue' }>;
  readonly references: { readonly people: NameMap; readonly topics: NameMap };
  readonly t: LibraryTranslator;
}) {
  const library = libraryReadRuntime();
  const topic = topicRows(record.topicIds, references.topics)[0] ?? null;
  const person = leadPerson(record);
  const personName =
    person === null
      ? null
      : (caseless(references.people).get(person.personId.toLowerCase())?.name ?? null);
  const research = record.kind === 'research' || record.kind === 'research-paper';
  type Related = TopicResearchItem | PublishedRecordItem;
  const ask = async (filter: {
    readonly topic?: string;
    readonly contributor?: string;
  }): Promise<readonly Related[]> => {
    const common = { titleLocale: locale, limit: RELATED + 2, ...filter };
    if (record.kind === 'research' || record.kind === 'research-paper')
      return (await library.topicResearch({ ...common, scope: 'library', kind: 'all' }))
        .items;
    return (await library.publishedRecords({ ...common, kind: record.kind })).items;
  };
  const [byTopic, byPerson] = await Promise.all([
    topic === null ? Promise.resolve([]) : ask({ topic: topic.id }),
    person === null || personName === null
      ? Promise.resolve([])
      : ask({ contributor: person.personId }),
  ]);
  const seen = new Set([`${record.kind}:${record.id.toLowerCase()}`]);
  const pick = (items: readonly Related[]): Related[] => {
    const key = (item: Related) => `${item.kind}:${item.id.toLowerCase()}`;
    const chosen = items.filter((item) => !seen.has(key(item))).slice(0, RELATED);
    for (const item of chosen) seen.add(key(item));
    return chosen;
  };
  const scope = LIBRARY_RECORD_SCOPES[record.kind];
  const listing = (filter: { readonly topic?: string; readonly contributor?: string }) =>
    researchHref(scope, locale, {
      ...DEFAULT_RESEARCH_QUERY,
      kind: research ? (record.kind as 'research' | 'research-paper') : 'all',
      topic: filter.topic?.toLowerCase() ?? null,
      contributor: filter.contributor?.toLowerCase() ?? null,
    });
  const kindName = record.kind === 'research-paper' ? 'paper' : record.kind;
  const topicItems = pick(byTopic);
  const personItems = pick(byPerson);

  const shelf = (items: typeof topicItems, label: string) =>
    research ? (
      <ResearchShelf
        locale={locale}
        items={items as Parameters<typeof ResearchShelf>[0]['items']}
        label={label}
      />
    ) : (
      <PublishedShelf
        locale={locale}
        items={items as Parameters<typeof PublishedShelf>[0]['items']}
        label={label}
      />
    );

  return (
    <>
      {topic === null || topicItems.length === 0 ? null : (
        <RelatedSection
          id="scholarly-related-topic"
          heading={t('records.related.onTopic', { topic: topic.name })}
          all={{
            href: listing({ topic: topic.id }),
            text: t('records.related.allOnTopic', { kind: kindName, topic: topic.name }),
          }}
        >
          {shelf(topicItems, t('records.related.onTopic', { topic: topic.name }))}
        </RelatedSection>
      )}
      {person === null || personName === null || personItems.length === 0 ? null : (
        <RelatedSection
          id="scholarly-related-person"
          heading={t('records.related.byPerson', { name: personName })}
          all={{
            href: listing({ contributor: person.personId }),
            text: t('records.related.allByPerson', { kind: kindName, name: personName }),
          }}
        >
          {shelf(personItems, t('records.related.byPerson', { name: personName }))}
        </RelatedSection>
      )}
    </>
  );
}

/**
 * One record's page. The title, its summary, its calls to action (only what
 * its stored state allows: "Read the full text" when its text is here) and the
 * standing notice open the page; the facts — language, date, where it
 * appeared, who published it, its institutional context, its access, and for
 * an issue its place in the periodical — sit beside the reading column with
 * who made it and what it is about; the reading column holds the abstract
 * (or the plain statement that the text is not here); the reader takes the
 * page's full width below, then the citations and the related works — for an
 * issue, the issues on either side and more from its Magazine.
 */
export async function ScholarlyDetail({
  locale,
  record,
}: {
  readonly locale: Locale;
  readonly record: ContentRecord;
}) {
  const t = await getTranslations({ locale, namespace: 'library' });
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const library = libraryReadRuntime();

  const [languages, references, neighbours, moreIssues] = await Promise.all([
    libraryContentLanguages(),
    libraryReferenceNames(
      {
        personIds: record.contributors.map((entry) => entry.personId),
        topicIds: record.topicIds,
      },
      locale,
    ),
    record.kind === 'magazine-issue'
      ? library.magazineIssueNeighbours(record.id)
      : Promise.resolve(null),
    record.kind === 'magazine-issue'
      ? library.magazineIssuePage({
          magazineId: record.magazineId,
          limit: MORE_ISSUES + 1,
        })
      : Promise.resolve(null),
  ]);

  const label = scholarlyLabel(record, locale);
  const language = languages.get(record.languageCode);
  const contentDirection = language?.direction ?? 'ltr';
  const listKind = record.kind === 'magazine-issue' ? 'magazine' : record.kind;
  const magazineLabel =
    record.kind === 'magazine-issue' ? scholarlyLabel(record.magazine, locale) : null;
  const magazinePath =
    record.kind === 'magazine-issue'
      ? scholarlyPath(locale, 'magazine', record.magazine.slug)
      : null;
  const path =
    record.kind === 'magazine-issue'
      ? issuePath(locale, record.magazine.slug, record.slug)
      : scholarlyPath(locale, record.kind, record.slug);

  const trail = [
    { name: shell('nav.home'), path: localizedPath(locale, '') },
    { name: t('title'), path: localizedPath(locale, '/library') },
    { name: sectionTitle(t, listKind), path: scholarlyListPath(locale, listKind) },
    ...(magazineLabel !== null && magazinePath !== null
      ? [{ name: magazineLabel.title, path: magazinePath }]
      : []),
    { name: label.title, path },
  ];

  const numbering =
    record.kind === 'magazine-issue'
      ? issueNumbering(t, record.volume, record.issueNumber)
      : null;

  const authors = record.contributors
    .filter((entry) => entry.role === 'author')
    .flatMap((entry) => {
      const name = caseless(references.people).get(entry.personId.toLowerCase())?.name;
      return name === undefined ? [] : [name];
    });

  const readable = record.document !== null;
  const hasAbstract =
    (record.kind === 'research' || record.kind === 'research-paper') &&
    record.abstract !== null;
  // The reader takes the page's full width below an abstract; with nothing
  // else in the reading column it fills that column, beside the facts.
  const reader = (
    <RecordReader record={record} language={language} locale={locale} t={t} />
  );
  const dateFact =
    record.publishedOn !== null ? (
      <time dateTime={record.publishedOn}>{formatDate(record.publishedOn, locale)}</time>
    ) : record.publicationYear !== null ? (
      yearText(record.publicationYear, locale)
    ) : null;
  const others =
    moreIssues === null
      ? []
      : moreIssues.items.filter((row) => row.id !== record.id).slice(0, MORE_ISSUES);

  return (
    <RecordFrame
      breadcrumbLabel={shell('nav.breadcrumbs')}
      trail={crumbsOf(trail, label.title)}
      eyebrow={t(`scholarly.kind.${record.kind}`)}
      title={label.title}
      lang={label.locale}
      dir={directionOf(label.locale)}
      summary={paragraphsOf(label.summary)}
      notice={t('scholarly.metadataNotice')}
      meta={
        <>
          {numbering === null ? null : (
            <span className="text-sm text-foreground-muted">{numbering}</span>
          )}
          {dateFact === null ? null : (
            <span className="text-sm text-foreground-muted">{dateFact}</span>
          )}
        </>
      }
      {...(readable
        ? {
            actions: (
              <ActionLink href={`#${READER_SECTION_ID}`}>
                {t(READING_WORDS[record.kind].action)}
              </ActionLink>
            ),
          }
        : {})}
      // An issue opens on its own cover, described, at Library's address.
      {...(record.kind === 'magazine-issue' && record.cover !== null
        ? {
            cover: (
              <Cover
                path={issueCoverPath(record.id, record.cover.assetId)}
                width={record.cover.width}
                height={record.cover.height}
                alt={t('coverAlt', { title: label.title })}
                shape="magazine"
                priority
                sizes="12rem"
              />
            ),
          }
        : {})}
      aside={
        <>
          <RecordSection id="scholarly-facts" heading={t('scholarly.facts')}>
            <dl className="flex flex-col divide-y divide-border rounded-panel border border-border bg-surface-raised px-4 py-1">
              {magazineLabel === null ? null : (
                <DetailRow term={t('scholarly.fact.magazine')}>
                  <span
                    lang={magazineLabel.locale}
                    dir={directionOf(magazineLabel.locale)}
                  >
                    {magazineLabel.title}
                  </span>
                </DetailRow>
              )}
              {numbering === null ? null : (
                <DetailRow term={t('scholarly.fact.numbering')}>{numbering}</DetailRow>
              )}
              <DetailRow term={t('scholarly.fact.contentLanguage')}>
                <span lang={record.languageCode} dir={contentDirection}>
                  {language?.name ?? record.languageCode}
                </span>
              </DetailRow>
              {record.publishedOn !== null ? (
                <DetailRow term={t('scholarly.fact.published')}>{dateFact}</DetailRow>
              ) : record.publicationYear !== null ? (
                <DetailRow term={t('scholarly.fact.publicationYear')}>
                  {dateFact}
                </DetailRow>
              ) : null}
              {(record.kind === 'publication' || record.kind === 'encyclopedia') &&
              record.publisher !== null ? (
                <DetailRow term={t('scholarly.fact.publisher')}>
                  <span dir="auto">{record.publisher}</span>
                </DetailRow>
              ) : null}
              {record.kind === 'research-paper' && record.venue !== null ? (
                <DetailRow term={t('scholarly.fact.venue')}>
                  <span dir="auto">{record.venue}</span>
                </DetailRow>
              ) : null}
              {record.kind === 'research-paper' && record.doi !== null ? (
                <DetailRow term={t('scholarly.fact.doi')}>
                  <TextLink href={doiHref(record.doi)}>
                    <span dir="ltr">{record.doi}</span>
                  </TextLink>
                </DetailRow>
              ) : null}
              {(record.kind === 'research' || record.kind === 'research-paper') &&
              record.institutionalContext !== null ? (
                <DetailRow term={t('scholarly.fact.institutionalContext')}>
                  <span lang={record.languageCode} dir={contentDirection}>
                    {record.institutionalContext}
                  </span>
                </DetailRow>
              ) : null}
              {(record.kind === 'research' || record.kind === 'research-paper') &&
              record.citations.length > 0 ? (
                <DetailRow term={t('scholarly.citations')}>
                  {t('records.citationCount', { count: record.citations.length })}
                </DetailRow>
              ) : null}
              <DetailRow term={t('records.access.text')}>
                {readable
                  ? t(
                      record.kind === 'encyclopedia'
                        ? 'records.access.entriesHere'
                        : 'records.access.here',
                      { count: record.document?.sections.length ?? 0 },
                    )
                  : t('records.access.notHere')}
              </DetailRow>
              <DetailRow term={t('records.access.download')}>
                {t('records.access.noDownload')}
              </DetailRow>
            </dl>
          </RecordSection>

          <Contributors
            record={record}
            people={references.people}
            locale={locale}
            t={t}
          />
          <Topics
            topicIds={record.topicIds}
            topics={references.topics}
            locale={locale}
            t={t}
          />
        </>
      }
      after={
        <>
          {hasAbstract ? reader : null}

          {record.kind === 'research' || record.kind === 'research-paper' ? (
            <Citations
              citations={record.citations}
              direction={contentDirection}
              languageCode={record.languageCode}
              t={t}
            />
          ) : null}

          {neighbours === null ||
          (neighbours.previous === null && neighbours.next === null) ? null : (
            <nav
              aria-label={t('scholarly.issueNavigation')}
              className="grid grid-cols-1 gap-3 border-t border-border pt-6 sm:grid-cols-2"
            >
              {neighbours.previous === null ? (
                <span className="hidden sm:block" />
              ) : (
                <IssueNeighbour
                  href={listingHref(locale, neighbours.previous)}
                  direction="previous"
                  label={t('scholarly.previousIssue')}
                  title={scholarlyLabel(neighbours.previous, locale)}
                />
              )}
              {neighbours.next === null ? null : (
                <IssueNeighbour
                  href={listingHref(locale, neighbours.next)}
                  direction="next"
                  label={t('scholarly.nextIssue')}
                  title={scholarlyLabel(neighbours.next, locale)}
                />
              )}
            </nav>
          )}

          {record.kind !== 'magazine-issue' ||
          magazineLabel === null ||
          magazinePath === null ||
          others.length === 0 ? null : (
            <section aria-labelledby="issue-more">
              <Shelf
                label={t('periodicals.moreFrom', { magazine: magazineLabel.title })}
                size="cover"
                previousLabel={t('landing.showPrevious')}
                nextLabel={t('landing.showNext')}
                header={
                  <SectionHeader
                    id="issue-more"
                    heading={t('periodicals.moreFrom', { magazine: magazineLabel.title })}
                    action={{
                      href: magazinePath,
                      text: t('periodicals.allIssuesOf', {
                        magazine: magazineLabel.title,
                      }),
                    }}
                  />
                }
              >
                {others.map((row) => (
                  <PeriodicalCard key={row.id} locale={locale} row={row} t={t} />
                ))}
              </Shelf>
            </section>
          )}

          {record.kind === 'magazine-issue' ? null : (
            <RelatedWorks locale={locale} record={record} references={references} t={t} />
          )}

          <StructuredData
            record={record}
            title={label.title}
            trail={trail}
            path={path}
            authors={authors}
          />
        </>
      }
    >
      {(record.kind === 'research' || record.kind === 'research-paper') &&
      record.abstract !== null ? (
        <section className="flex flex-col gap-3" aria-labelledby="scholarly-abstract">
          <h2 id="scholarly-abstract" className="text-heading font-semibold">
            {t('scholarly.abstract')}
          </h2>
          <div
            className="library-reader flex max-w-[var(--measure-prose)] flex-col gap-4 border-s-2 border-accent-rule ps-5"
            lang={record.languageCode}
            dir={contentDirection}
          >
            {paragraphsOf(record.abstract).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        </section>
      ) : null}

      {readable && !hasAbstract ? reader : null}

      {readable ? null : (
        <Alert tone="info">
          {t(
            record.kind === 'magazine-issue'
              ? 'periodicals.noIssueText'
              : 'scholarly.noFullText',
          )}
        </Alert>
      )}
    </RecordFrame>
  );
}

/**
 * One neighbouring issue: what it is ("Previous issue") and which one (its
 * title, in its own language). The link's name carries both, so it still says
 * where it goes when it is read out of context.
 */
function IssueNeighbour({
  href,
  direction,
  label,
  title,
}: {
  readonly href: string;
  readonly direction: 'previous' | 'next';
  readonly label: string;
  readonly title: { readonly locale: Locale; readonly title: string };
}) {
  return (
    <a
      href={href}
      className={`flex min-h-11 min-w-0 flex-col gap-1 rounded-panel border border-border bg-surface-raised p-4 no-underline transition-colors duration-[var(--duration-fast)] hover:border-border-strong active:bg-surface-sunken ${
        direction === 'next' ? 'sm:col-start-2 sm:text-end' : ''
      }`}
    >
      <span className="text-caption font-semibold text-accent">
        {direction === 'previous' ? (
          <Icon
            name="arrow-start"
            size={16}
            className="me-1 inline-block align-[-0.15em]"
          />
        ) : null}
        {label}
        {direction === 'next' ? (
          <Icon
            name="arrow-end"
            size={16}
            className="ms-1 inline-block align-[-0.15em]"
          />
        ) : null}
        <span className="sr-only">: </span>
      </span>
      <span
        className="font-semibold wrap-anywhere text-foreground"
        lang={title.locale}
        dir={directionOf(title.locale)}
      >
        {title.title}
      </span>
    </a>
  );
}

/* ===========================================================================
 * Magazine
 * ========================================================================= */

/**
 * `/{locale}/library/magazines/{slug}` — THE PERIODICAL AND ITS ISSUES
 * (Library Part 3).
 *
 * THE ISSUES ARE THE PAGE. The header shows the periodical as it looks now —
 * its newest issue's cover — with its figures (issues, years, those with their
 * contents here) and the way straight to the latest issue. Below, the year
 * index (each publication year with its issues, and the undated ones), an
 * address per year (`?year=`, `?undated=1`), and the issues themselves in the
 * periodical's own order — newest year, date, volume and number first —
 * grouped under their year, each as its cover, 24 a page with numbered
 * pages. A Magazine with no published issue says so plainly. A Magazine's
 * publisher and frequency are not modelled, so none is stated.
 */
export async function MagazineDetail({
  locale,
  record,
  view,
}: {
  readonly locale: Locale;
  readonly record: MagazineRecord;
  readonly view: MagazineView;
}) {
  const t = await getTranslations({ locale, namespace: 'library' });
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const library = libraryReadRuntime();

  const [issues, facets, newestPage, references] = await Promise.all([
    library.magazineIssuePage(magazineIssuesRead(record.id, view)),
    library.magazineIssueFacets(record.id),
    view.year === null && !view.undated && view.page === 1
      ? Promise.resolve(null)
      : library.magazineIssuePage({ magazineId: record.id, limit: 1 }),
    libraryReferenceNames(
      {
        personIds: record.contributors.map((entry) => entry.personId),
        topicIds: record.topicIds,
      },
      locale,
    ),
  ]);

  const label = scholarlyLabel(record, locale);
  const path = scholarlyPath(locale, 'magazine', record.slug);
  const trail = [
    { name: shell('nav.home'), path: localizedPath(locale, '') },
    { name: t('title'), path: localizedPath(locale, '/library') },
    { name: sectionTitle(t, 'magazine'), path: scholarlyListPath(locale, 'magazine') },
    { name: label.title, path },
  ];

  // The newest issue: the first of the unfiltered first page, else asked for.
  const newest: ListingRow | null =
    newestPage === null ? (issues.items[0] ?? null) : (newestPage.items[0] ?? null);
  const newestCover = newest?.issue?.cover ?? null;
  // Only an issue with a year or a printed number is truly "the latest".
  const newestLabel =
    newest === null || !isPlaced(newest) ? null : scholarlyLabel(newest, locale);
  const dated = facets.years.filter((row) => row.year !== null);
  const span =
    dated.length === 0
      ? null
      : yearsOf(dated.at(-1)?.year ?? null, dated[0]?.year ?? null, locale, t);
  const pages = magazinePageCount(issues.total);
  const viewName =
    view.year !== null
      ? yearText(view.year, locale)
      : view.undated
        ? t('scholarly.undated')
        : null;

  // The aside is only drawn when it has something to hold.
  const hasAside =
    contributorRows(record, references.people).length > 0 ||
    topicRows(record.topicIds, references.topics).length > 0;

  return (
    <RecordFrame
      breadcrumbLabel={shell('nav.breadcrumbs')}
      trail={crumbsOf(trail, label.title)}
      eyebrow={t('scholarly.kind.magazine')}
      title={label.title}
      lang={label.locale}
      dir={directionOf(label.locale)}
      summary={paragraphsOf(label.summary)}
      notice={t('scholarly.metadataNotice')}
      meta={
        facets.issues === 0 ? undefined : (
          <>
            <span className="text-sm text-foreground-muted">
              {t('periodicals.issueCount', { count: facets.issues })}
            </span>
            {span === null ? null : (
              <span className="text-sm text-foreground-muted">{span}</span>
            )}
            {facets.readable === 0 ? null : (
              <span className="text-sm text-foreground-muted">
                {t('periodicals.readableCount', { count: facets.readable })}
              </span>
            )}
          </>
        )
      }
      {...(newest === null || newestLabel === null
        ? {}
        : {
            actions: (
              <ActionLink href={listingHref(locale, newest)}>
                {/* One inline run, so the name reads "Open the latest issue: {title}". */}
                <span>
                  {t('periodicals.openLatest')}
                  <span className="sr-only">
                    {': '}
                    <bdi lang={newestLabel.locale}>{newestLabel.title}</bdi>
                  </span>
                </span>
              </ActionLink>
            ),
          })}
      {...(newest === null || newestCover === null
        ? {}
        : {
            // The periodical as it looks: the cover of the first issue in its order.
            cover: (
              <figure className="flex flex-col gap-2">
                <Cover
                  path={issueCoverPath(newest.id, newestCover.assetId)}
                  width={newestCover.width}
                  height={newestCover.height}
                  alt=""
                  shape="magazine"
                  priority
                  sizes="12rem"
                />
                {newestLabel === null ? null : (
                  <figcaption className="text-caption text-foreground-muted">
                    {t('periodicals.latestCover')}
                  </figcaption>
                )}
              </figure>
            ),
          })}
      {...(hasAside
        ? {
            aside: (
              <>
                <Contributors
                  record={record}
                  people={references.people}
                  locale={locale}
                  t={t}
                />
                <Topics
                  topicIds={record.topicIds}
                  topics={references.topics}
                  locale={locale}
                  t={t}
                />
              </>
            ),
          }
        : {})}
    >
      <section className="flex flex-col gap-5" aria-labelledby="magazine-issues">
        <h2
          id="magazine-issues"
          className="border-b border-border pb-3 text-heading font-semibold"
        >
          {t('scholarly.issues')}
        </h2>

        {facets.years.length < 2 ? null : (
          <nav aria-label={t('periodicals.yearIndex')} className="flex flex-col gap-2">
            <p className="text-sm font-semibold">{t('periodicals.yearIndex')}</p>
            <ul className="flex flex-wrap gap-2">
              {[
                {
                  key: 'all',
                  name: t('periodicals.allYears'),
                  count: facets.issues,
                  change: { year: null, undated: false },
                  current: view.year === null && !view.undated,
                },
                ...facets.years.map((row) => ({
                  key: row.year === null ? 'undated' : String(row.year),
                  name:
                    row.year === null
                      ? t('scholarly.undated')
                      : yearText(row.year, locale),
                  count: row.issues,
                  change:
                    row.year === null
                      ? { year: null, undated: true }
                      : { year: row.year, undated: false },
                  current: row.year === null ? view.undated : view.year === row.year,
                })),
              ].map((chip) => (
                <li key={chip.key}>
                  <a
                    href={magazineHref(locale, record.slug, view, chip.change)}
                    {...(chip.current ? { 'aria-current': 'page' as const } : {})}
                    className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm no-underline tabular-nums ${
                      chip.current
                        ? 'border-action bg-accent-surface font-semibold text-foreground'
                        : 'border-border bg-surface-raised text-foreground hover:bg-surface-sunken'
                    }`}
                  >
                    {chip.name}
                    <span className="text-caption text-foreground-muted">
                      {new Intl.NumberFormat(locale).format(chip.count)}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {issues.items.length === 0 ? (
          facets.issues === 0 ? (
            <EmptyState>{t('scholarly.noIssues')}</EmptyState>
          ) : (
            <EmptyState
              title={
                view.page > 1 && issues.total > 0
                  ? t('periodicals.pastEndTitle')
                  : t('periodicals.noneInView')
              }
              action={{
                href: magazineHref(locale, record.slug, view, {
                  year: null,
                  undated: false,
                }),
                text: t('periodicals.allIssuesOf', { magazine: label.title }),
              }}
            >
              {(view.page > 1 && issues.total > 0) || viewName === null
                ? t('periodicals.pastEnd', { page: view.page })
                : view.year === null
                  ? t('periodicals.noneUndated')
                  : t('periodicals.noneIn', { year: viewName })}
            </EmptyState>
          )
        ) : (
          <>
            <p className="text-sm text-foreground-muted">
              {t('periodicals.summary', {
                from: (view.page - 1) * MAGAZINE_ISSUE_PAGE + 1,
                to: (view.page - 1) * MAGAZINE_ISSUE_PAGE + issues.items.length,
                total: issues.total,
              })}
            </p>
            {issuesByYear(issues.items).map((group) => {
              const id = `issues-${group.year === null ? 'undated' : String(group.year)}`;
              const name =
                group.year === null
                  ? t('scholarly.undated')
                  : yearText(group.year, locale);
              return (
                <section key={id} aria-labelledby={id} className="flex flex-col gap-4">
                  <h3 id={id} className="text-subheading font-semibold tabular-nums">
                    {name}
                  </h3>
                  <ul
                    aria-labelledby={id}
                    className={`grid list-none grid-cols-2 gap-x-4 gap-y-8 p-0 sm:grid-cols-3 ${hasAside ? 'xl:grid-cols-4' : 'lg:grid-cols-4 xl:grid-cols-6'}`}
                  >
                    {group.issues.map((row) => (
                      <PeriodicalCard
                        key={row.id}
                        locale={locale}
                        row={row}
                        t={t}
                        headingLevel="h4"
                        sizes="(min-width: 64rem) 11rem, 45vw"
                      />
                    ))}
                  </ul>
                </section>
              );
            })}
          </>
        )}

        {issues.items.length === 0 ? null : (
          <Pager
            label={t('periodicals.pages')}
            previous={
              view.page > 1
                ? magazineHref(locale, record.slug, view, { page: view.page - 1 })
                : null
            }
            next={
              issues.hasMore
                ? magazineHref(locale, record.slug, view, { page: view.page + 1 })
                : null
            }
            previousLabel={t('previous')}
            nextLabel={t('next')}
            pages={{
              current: view.page,
              total: pages,
              href: (number) => magazineHref(locale, record.slug, view, { page: number }),
              label: (number) => t('periodicals.pageLabel', { page: number }),
              format: (number) => new Intl.NumberFormat(locale).format(number),
            }}
          />
        )}
      </section>

      <StructuredData
        record={record}
        title={label.title}
        trail={trail}
        path={path}
        authors={[]}
      />
    </RecordFrame>
  );
}

/** The shape every Phase-9 detail page's metadata needs, from one record. */
export function scholarlyMetadataInput(
  locale: Locale,
  record: ScholarlyRecord,
): {
  readonly title: string;
  readonly description?: string;
  readonly contentLocales: Locale[];
  readonly primaryLocale: Locale;
  readonly pathFor: (alternate: Locale) => string;
} {
  const label = scholarlyLabel(record, locale);
  return {
    title: label.title,
    ...(label.summary === '' ? {} : { description: label.summary.slice(0, 160) }),
    contentLocales: scholarlyLocales(record),
    primaryLocale: record.primaryLocale,
    pathFor: (alternate) =>
      record.kind === 'magazine-issue'
        ? issuePath(alternate, record.magazine.slug, record.slug)
        : scholarlyPath(alternate, record.kind, record.slug),
  };
}
