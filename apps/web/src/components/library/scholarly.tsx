import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type {
  MagazineRecord,
  ScholarlyCitation,
  ScholarlyListing as ListingRow,
  ScholarlyRecord,
  StandaloneScholarlyKind,
} from '@minhaj/contracts/library';
import { SCHOLARLY_PAGE } from '@minhaj/contracts/library';

import {
  libraryContentLanguages,
  libraryReadRuntime,
  libraryReferenceNames,
  type ContentLanguage,
} from '@/composition/library-read';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { absoluteUrl } from '@/config/origin';
import { directionOf } from '@/config/locale';
import {
  Alert,
  Button,
  Cover,
  DetailRow,
  EmptyState,
  Field,
  Icon,
  ListRow,
  Select,
  TextInput,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { Shelf } from '@/components/ui/shelf';
import { contentLanguageBadge } from '@/components/content-language';
import { isContentIndexable, serializeStructuredData } from '@/seo/metadata';
import { issueNumbering, PeriodicalCard } from './cards';
import { issueCoverPath } from './cover';
import { FilterPanel, ListingFrame, Pager, RecordFrame, RecordSection } from './frame';
import { Reader } from './reader';
import {
  doiHref,
  issuePath,
  issuesByYear,
  listingHref,
  paragraphsOf,
  readScholarlyQuery,
  scholarlyLabel,
  scholarlyListPath,
  scholarlyLocales,
  scholarlyPath,
  scholarlyQueryPath,
} from './scholarly-presentation';

/**
 * The public Phase-9 Library surfaces — Research, ResearchPaper, Publication,
 * Magazine, MagazineIssue and Encyclopedia (ROUTE_MAP.md §3.6).
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read goes through
 * `@/composition/library-read` and `@/composition/taxonomy`, neither of which
 * reaches Identity, a session or a cookie, so what a signed-in visitor sees is
 * what an anonymous one sees (ARCHITECTURE.md §8.1).
 *
 * NOT A CATALOGUE CARD. A record with readable text renders that text through the
 * Library's own reader; one without says so plainly. Every fact shown is one the
 * record genuinely has — an unknown publisher, venue, DOI or date is ABSENT, never
 * rendered as a dash or a placeholder.
 *
 * EVERY STRING OF CONTENT IS A TEXT NODE. Titles, summaries, abstracts, citations
 * and the document are plain text; there is no `dangerouslySetInnerHTML` except
 * the JSON-LD element, whose serialiser escapes `<`.
 */

type LibraryTranslator = Awaited<ReturnType<typeof getTranslations<'library'>>>;
type NameMap = ReadonlyMap<string, { readonly slug: string; readonly name: string }>;

/** The listing address of a kind, and the registry-backed section name for it. */
const SECTION_KEY = {
  research: 'research',
  'research-paper': 'research-papers',
  publication: 'publications',
  magazine: 'magazines',
  encyclopedia: 'encyclopedias',
} as const satisfies Record<StandaloneScholarlyKind, string>;

export function sectionTitle(
  t: LibraryTranslator,
  kind: StandaloneScholarlyKind,
): string {
  return t(`section.${SECTION_KEY[kind]}`);
}

export function sectionBody(t: LibraryTranslator, kind: StandaloneScholarlyKind): string {
  return t(`sectionBody.${SECTION_KEY[kind]}`);
}

/** A date-only fact, formatted in the interface locale and never shifted by a zone. */
function formatDate(value: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(
    new Date(`${value}T00:00:00.000Z`),
  );
}

/** Shared with the admin and the cross-domain related lists, which import them from here. */
export { issueNumbering } from './cards';
export { listingHref } from './scholarly-presentation';

/* ===========================================================================
 * Listing
 * ========================================================================= */

/**
 * One listing row (R2): a periodical by its cover, anything else as a row of
 * words under a hairline — title and summary in their own language and
 * direction, then the facts that tell one record from the next (year, and the
 * content language when it is not the interface's), each only when known.
 */
function ScholarlyCard({
  locale,
  row,
  t,
  headingLevel = 'h2',
}: {
  readonly locale: Locale;
  readonly row: ListingRow;
  readonly t: LibraryTranslator;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  if (row.kind === 'magazine' || row.kind === 'magazine-issue')
    return (
      <PeriodicalCard
        locale={locale}
        row={row}
        t={t}
        headingLevel={headingLevel}
        sizes="(min-width: 64rem) 12rem, 45vw"
      />
    );

  const label = scholarlyLabel(row, locale);
  const language =
    row.languageCode === null
      ? undefined
      : contentLanguageBadge(row.languageCode, locale);
  const date =
    row.publishedOn === null
      ? row.publicationYear === null
        ? null
        : String(row.publicationYear)
      : formatDate(row.publishedOn, locale);
  return (
    <ListRow
      href={listingHref(locale, row)}
      title={label.title}
      description={label.summary}
      headingLevel={headingLevel}
      lang={label.locale}
      dir={directionOf(label.locale)}
      meta={[date]}
      {...(language === undefined ? {} : { language })}
    />
  );
}

/**
 * `/{locale}/library/{research|research-papers|publications|magazines|encyclopedias}`.
 *
 * A REAL GET FORM, like the Work listing: every filter works without JavaScript,
 * every filtered view is a shareable address, and changing a filter returns to
 * the first page. The options are the platform's active topics and the content
 * languages Taxonomy knows — bounded vocabularies, never the corpus.
 *
 * TWO DIFFERENT EMPTY STATES. "Nothing is published yet" and "nothing matches
 * these filters" are different facts, and the second offers the way back.
 */
export async function ScholarlyListing({
  locale,
  kind,
  query,
}: {
  readonly locale: Locale;
  readonly kind: StandaloneScholarlyKind;
  readonly query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: 'library' });
  const shell = await getTranslations({ locale, namespace: 'shell' });

  const filters = readScholarlyQuery(query);
  // A Magazine has no content language and no single date of its own — its
  // issues do — so its listing filters by topic only.
  const dated = kind !== 'magazine';
  const base = scholarlyListPath(locale, kind);

  const [page, languages, topics, latestIssues] = await Promise.all([
    libraryReadRuntime().scholarlyList(kind, filters),
    libraryContentLanguages(),
    taxonomyRuntime().taxonomy.listTree({ locale, includeArchived: false }),
    // The magazines' front page opens on their newest issues across every title.
    kind === 'magazine' && filters.topic === null && filters.offset === 0
      ? libraryReadRuntime().scholarlyList('magazine-issue', {})
      : Promise.resolve(null),
  ]);

  const filtered =
    filters.topic !== null ||
    (dated &&
      (filters.language !== null || filters.from !== null || filters.to !== null));
  const title = sectionTitle(t, kind);

  return (
    <ListingFrame
      breadcrumbLabel={shell('nav.breadcrumbs')}
      trail={[
        { href: localizedPath(locale, ''), text: shell('nav.home') },
        { href: localizedPath(locale, '/library'), text: t('title') },
        { text: title },
      ]}
      title={title}
      lede={sectionBody(t, kind)}
    >
      {latestIssues === null || latestIssues.items.length === 0 ? null : (
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
            {latestIssues.items.slice(0, 12).map((row) => (
              <PeriodicalCard key={row.id} locale={locale} row={row} t={t} />
            ))}
          </Shelf>
        </section>
      )}
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-10">
        <div className="min-w-0">
          <FilterPanel id="scholarly-filters" heading={t('scholarly.filters')}>
            <form
              method="get"
              action={base}
              className="flex flex-col gap-4"
              aria-label={t('scholarly.filters')}
            >
              {dated ? (
                <Field id="filter-language" label={t('filterLanguage')}>
                  {(props) => (
                    <Select
                      {...props}
                      name="language"
                      defaultValue={filters.language ?? ''}
                    >
                      <option value="">{t('filterAny')}</option>
                      {[...languages.values()].map((language) => (
                        <option key={language.code} value={language.code}>
                          {language.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}

              <Field id="filter-topic" label={t('filterTopic')}>
                {(props) => (
                  <Select {...props} name="topic" defaultValue={filters.topic ?? ''}>
                    <option value="">{t('filterAny')}</option>
                    {topics.map((topic) => (
                      <option key={topic.id} value={topic.id}>
                        {topic.label.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              {dated ? (
                <div className="grid grid-cols-2 gap-3">
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
              ) : null}

              <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                <Button tone="secondary">{t('filterApply')}</Button>
                {filtered ? <TextLink href={base}>{t('filterClear')}</TextLink> : null}
              </div>
            </form>
          </FilterPanel>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {page.items.length === 0 ? (
            <EmptyState>
              {filtered ? (
                <span className="flex flex-col items-center gap-2">
                  <span>{t('scholarly.emptyFiltered')}</span>
                  <TextLink href={base}>{t('filterClear')}</TextLink>
                </span>
              ) : (
                t(`scholarly.empty.${kind}`)
              )}
            </EmptyState>
          ) : (
            <ul
              aria-label={title}
              className={
                kind === 'magazine'
                  ? 'grid list-none grid-cols-2 gap-x-4 gap-y-8 p-0 sm:grid-cols-3 xl:grid-cols-4'
                  : 'm-0 list-none border-t border-border p-0'
              }
            >
              {page.items.map((row) => (
                <ScholarlyCard key={row.id} locale={locale} row={row} t={t} />
              ))}
            </ul>
          )}

          <Pager
            label={title}
            previous={
              filters.offset > 0
                ? scholarlyQueryPath(base, filters, {
                    offset: Math.max(0, filters.offset - SCHOLARLY_PAGE),
                  })
                : null
            }
            next={
              page.hasMore
                ? scholarlyQueryPath(base, filters, {
                    offset: filters.offset + SCHOLARLY_PAGE,
                  })
                : null
            }
            previousLabel={t('previous')}
            nextLabel={t('next')}
          />
        </div>
      </div>
    </ListingFrame>
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
  return record.contributors.flatMap((entry) => {
    const person = people.get(entry.personId);
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
  return topicIds.flatMap((id) => {
    const topic = topics.get(id);
    return topic === undefined ? [] : [topic];
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
      <ol className="flex list-decimal flex-col gap-4 ps-6 text-sm marker:text-foreground-muted">
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

/**
 * The readable text, or an explicit statement that there is none here. Never an
 * empty panel and never a broken link (PRODUCT_SCOPE.md §2.1).
 */
function FullText({
  record,
  language,
  locale,
  t,
}: {
  readonly record: Extract<ScholarlyRecord, { readonly languageCode: string }>;
  readonly language: ContentLanguage | undefined;
  readonly locale: Locale;
  readonly t: LibraryTranslator;
}) {
  if (record.document === null)
    return <Alert tone="info">{t('scholarly.noFullText')}</Alert>;

  const positionTemplate = t('sectionPosition', {
    current: '{current}',
    total: '{total}',
  });
  return (
    <Reader
      anchorFor={(key) => `section-${key}`}
      languageCode={record.languageCode}
      direction={language?.direction ?? 'ltr'}
      interfaceLocale={locale}
      interfaceDirection={directionOf(locale)}
      document={record.document}
      labels={{
        readerHeading: t('scholarly.fullText'),
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

/**
 * One record's page. The title, its summary and the standing notice open the
 * page; the facts — language, date, where it appeared, who published it, its
 * institutional context and, for an issue, its place in the periodical — sit
 * beside the reading column with who made it and what it is about; the reading
 * column holds the abstract, the text itself, and the citations.
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

  const [languages, references, neighbours] = await Promise.all([
    libraryContentLanguages(),
    libraryReferenceNames(
      {
        personIds: record.contributors.map((entry) => entry.personId),
        topicIds: record.topicIds,
      },
      locale,
    ),
    record.kind === 'magazine-issue'
      ? libraryReadRuntime().magazineIssueNeighbours(record.id)
      : Promise.resolve(null),
  ]);

  const label = scholarlyLabel(record, locale);
  const language = languages.get(record.languageCode);
  const contentDirection = language?.direction ?? 'ltr';
  const listKind: StandaloneScholarlyKind =
    record.kind === 'magazine-issue' ? 'magazine' : record.kind;
  const magazineLabel =
    record.kind === 'magazine-issue' ? scholarlyLabel(record.magazine, locale) : null;
  const path =
    record.kind === 'magazine-issue'
      ? issuePath(locale, record.magazine.slug, record.slug)
      : scholarlyPath(locale, record.kind, record.slug);

  const trail = [
    { name: shell('nav.home'), path: localizedPath(locale, '') },
    { name: t('title'), path: localizedPath(locale, '/library') },
    { name: sectionTitle(t, listKind), path: scholarlyListPath(locale, listKind) },
    ...(record.kind === 'magazine-issue' && magazineLabel !== null
      ? [
          {
            name: magazineLabel.title,
            path: scholarlyPath(locale, 'magazine', record.magazine.slug),
          },
        ]
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
      const name = references.people.get(entry.personId)?.name;
      return name === undefined ? [] : [name];
    });

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
              {record.kind === 'magazine-issue' && magazineLabel !== null ? (
                <DetailRow term={t('scholarly.fact.magazine')}>
                  <TextLink
                    href={scholarlyPath(locale, 'magazine', record.magazine.slug)}
                  >
                    <span
                      lang={magazineLabel.locale}
                      dir={directionOf(magazineLabel.locale)}
                    >
                      {magazineLabel.title}
                    </span>
                  </TextLink>
                </DetailRow>
              ) : null}
              {numbering === null ? null : (
                <DetailRow term={t('scholarly.fact.numbering')}>{numbering}</DetailRow>
              )}
              <DetailRow term={t('scholarly.fact.contentLanguage')}>
                <span lang={record.languageCode} dir={contentDirection}>
                  {language?.name ?? record.languageCode}
                </span>
              </DetailRow>
              {record.publishedOn !== null ? (
                <DetailRow term={t('scholarly.fact.published')}>
                  <time dateTime={record.publishedOn}>
                    {formatDate(record.publishedOn, locale)}
                  </time>
                </DetailRow>
              ) : record.publicationYear !== null ? (
                <DetailRow term={t('scholarly.fact.publicationYear')}>
                  {String(record.publicationYear)}
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

      <FullText record={record} language={language} locale={locale} t={t} />

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

      <StructuredData
        record={record}
        title={label.title}
        trail={trail}
        path={path}
        authors={authors}
      />
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

/** One page of a Magazine's issues. The first page is the bare address. */
function pageOf(path: string, offset: number): string {
  return offset === 0 ? path : `${path}?offset=${String(offset)}`;
}

/**
 * `/{locale}/library/magazines/{slug}` — the periodical and its issues.
 *
 * THE ISSUES ARE THE PAGE. Newest first by year, date, volume and number, with a
 * total tie-breaker, in bounded pages — and grouped under their year, each as
 * its cover (R2, audit F14). The page opens on the newest issue's cover. A
 * Magazine with no published issue says so plainly: an honest empty state,
 * never an invented issue list.
 */
export async function MagazineDetail({
  locale,
  record,
  query,
}: {
  readonly locale: Locale;
  readonly record: MagazineRecord;
  readonly query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: 'library' });
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const offset = readScholarlyQuery(query).offset;

  const [issues, references] = await Promise.all([
    libraryReadRuntime().magazineIssues(record.id, offset),
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

  const newest = offset === 0 ? (issues.items[0] ?? null) : null;
  const newestCover = newest?.issue?.cover ?? null;

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
      {...(newest === null || newestCover === null
        ? {}
        : {
            // The periodical as it looks now: its newest issue's cover.
            cover: (
              <Cover
                path={issueCoverPath(newest.id, newestCover.assetId)}
                width={newestCover.width}
                height={newestCover.height}
                alt=""
                shape="magazine"
                priority
                sizes="12rem"
              />
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
        {issues.items.length === 0 ? (
          <EmptyState>{t('scholarly.noIssues')}</EmptyState>
        ) : (
          issuesByYear(issues.items).map((group) => {
            const id = `issues-${group.year === null ? 'undated' : String(group.year)}`;
            return (
              <section key={id} aria-labelledby={id} className="flex flex-col gap-4">
                <h3 id={id} className="text-subheading font-semibold tabular-nums">
                  {group.year === null
                    ? t('scholarly.undated')
                    : new Intl.NumberFormat(locale, { useGrouping: false }).format(
                        group.year,
                      )}
                </h3>
                <ul
                  aria-labelledby={id}
                  className={`grid list-none grid-cols-2 gap-x-4 gap-y-8 p-0 sm:grid-cols-3 ${hasAside ? 'xl:grid-cols-4' : 'lg:grid-cols-4 xl:grid-cols-5'}`}
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
          })
        )}
        <Pager
          label={t('scholarly.issues')}
          previous={
            offset > 0 ? pageOf(path, Math.max(0, offset - SCHOLARLY_PAGE)) : null
          }
          next={issues.hasMore ? pageOf(path, offset + SCHOLARLY_PAGE) : null}
          previousLabel={t('previous')}
          nextLabel={t('next')}
        />
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
