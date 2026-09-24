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
  Breadcrumbs,
  Button,
  Container,
  DetailRow,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  Prose,
  SectionHeading,
  Select,
  StatusBadge,
  TextInput,
  TextLink,
} from '@/components/ui';
import { isContentIndexable, serializeStructuredData } from '@/seo/metadata';
import { Reader } from './reader';
import {
  doiHref,
  issuePath,
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

/** "Volume 3, issue 2" — only the numbers the issue genuinely has. */
export function issueNumbering(
  t: LibraryTranslator,
  volume: number | null,
  issueNumber: number | null,
): string | null {
  if (volume !== null && issueNumber !== null)
    return t('scholarly.numbering.both', { volume, number: issueNumber });
  if (volume !== null) return t('scholarly.numbering.volume', { volume });
  if (issueNumber !== null)
    return t('scholarly.numbering.number', { number: issueNumber });
  return null;
}

/** The address of one listing row. */
export function listingHref(locale: Locale, row: ListingRow): string {
  return row.kind === 'magazine-issue' && row.issue !== null
    ? issuePath(locale, row.issue.magazineSlug, row.slug)
    : scholarlyPath(locale, row.kind as StandaloneScholarlyKind, row.slug);
}

/* ===========================================================================
 * Listing
 * ========================================================================= */

/**
 * One listing row. Title in its own language and direction, the summary, and the
 * facts that distinguish one record from the next — content language, year, and
 * for an issue its numbering — each only when genuinely known.
 */
function ScholarlyCard({
  locale,
  row,
  languages,
  t,
  headingLevel = 'h2',
}: {
  readonly locale: Locale;
  readonly row: ListingRow;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly t: LibraryTranslator;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const label = scholarlyLabel(row, locale);
  const direction = directionOf(label.locale);
  const Heading = headingLevel;
  const language = row.languageCode === null ? null : languages.get(row.languageCode);
  const numbering =
    row.issue === null
      ? null
      : issueNumbering(t, row.issue.volume, row.issue.issueNumber);

  const facts = [
    numbering,
    row.publishedOn === null
      ? row.publicationYear === null
        ? null
        : String(row.publicationYear)
      : formatDate(row.publishedOn, locale),
  ].filter((fact): fact is string => fact !== null);

  return (
    <Panel as="li">
      <div className="flex min-w-0 flex-col gap-2">
        <Heading
          className="text-lg font-semibold break-words"
          lang={label.locale}
          dir={direction}
        >
          <TextLink href={listingHref(locale, row)}>{label.title}</TextLink>
        </Heading>
        {label.summary === '' ? null : (
          <p
            className="text-sm break-words text-[color:var(--color-foreground-muted)]"
            lang={label.locale}
            dir={direction}
          >
            {label.summary}
          </p>
        )}
        {facts.length === 0 && language === null ? null : (
          <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            {language === null ? null : (
              <span>
                <span className="text-[color:var(--color-foreground-muted)]">
                  {t('scholarly.fact.contentLanguage')}:{' '}
                </span>
                <span
                  lang={row.languageCode ?? undefined}
                  dir={language?.direction ?? 'auto'}
                >
                  {language?.name ?? row.languageCode}
                </span>
              </span>
            )}
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </p>
        )}
      </div>
    </Panel>
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
  const dated = kind !== 'magazine';
  const base = scholarlyListPath(locale, kind);

  const [page, languages, topics] = await Promise.all([
    libraryReadRuntime().scholarlyList(kind, filters),
    libraryContentLanguages(),
    taxonomyRuntime().taxonomy.listTree({ locale, includeArchived: false }),
  ]);

  const filtered =
    filters.topic !== null ||
    (dated &&
      (filters.language !== null || filters.from !== null || filters.to !== null));
  const title = sectionTitle(t, kind);

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            { href: `/${locale}`, text: shell('nav.home') },
            { href: `/${locale}/library`, text: t('title') },
            { text: title },
          ]}
        />

        <div className="flex flex-col gap-2">
          <PageHeading>{title}</PageHeading>
          <p className="text-[color:var(--color-foreground-muted)]">
            {sectionBody(t, kind)}
          </p>
        </div>

        <Panel>
          <form
            method="get"
            action={base}
            className="flex flex-col gap-4"
            aria-label={t('scholarly.filters')}
          >
            <div className="grid gap-4 sm:grid-cols-2">
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
                <>
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
                </>
              ) : null}
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <Button tone="secondary">{t('filterApply')}</Button>
              {filtered ? <TextLink href={base}>{t('filterClear')}</TextLink> : null}
            </div>
          </form>
        </Panel>

        {page.items.length === 0 ? (
          <EmptyState>
            {filtered ? (
              <span className="flex flex-col gap-2">
                <span>{t('scholarly.emptyFiltered')}</span>
                <TextLink href={base}>{t('filterClear')}</TextLink>
              </span>
            ) : (
              t(`scholarly.empty.${kind}`)
            )}
          </EmptyState>
        ) : (
          <ul aria-label={title} className="flex flex-col gap-4">
            {page.items.map((row) => (
              <ScholarlyCard
                key={row.id}
                locale={locale}
                row={row}
                languages={languages}
                t={t}
              />
            ))}
          </ul>
        )}

        <Pagination
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
          t={t}
        />
      </div>
    </Container>
  );
}

function Pagination({
  label,
  previous,
  next,
  t,
}: {
  readonly label: string;
  readonly previous: string | null;
  readonly next: string | null;
  readonly t: LibraryTranslator;
}) {
  if (previous === null && next === null) return null;
  return (
    <nav className="flex flex-wrap gap-6" aria-label={label}>
      {previous === null ? null : <TextLink href={previous}>{t('previous')}</TextLink>}
      {next === null ? null : <TextLink href={next}>{t('next')}</TextLink>}
    </nav>
  );
}

/* ===========================================================================
 * Shared detail parts
 * ========================================================================= */

function Header({
  label,
  t,
}: {
  readonly label: {
    readonly locale: Locale;
    readonly title: string;
    readonly summary: string;
  };
  readonly t: LibraryTranslator;
}) {
  const direction = directionOf(label.locale);
  return (
    <Prose>
      {/* The title in ITS OWN language and direction (WCAG 3.1.2). */}
      <h1
        className="text-3xl font-semibold tracking-tight break-words"
        lang={label.locale}
        dir={direction}
      >
        {label.title}
      </h1>
      {paragraphsOf(label.summary).map((paragraph, index) => (
        <p key={index} lang={label.locale} dir={direction}>
          {paragraph}
        </p>
      ))}
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scholarly.metadataNotice')}
      </p>
    </Prose>
  );
}

/**
 * Contributors, resolved by People and linked to People's canonical address. A
 * credit is attribution and grants nothing; one People cannot resolve is omitted
 * rather than printed as an identifier.
 */
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
  const rows = record.contributors.flatMap((entry) => {
    const person = people.get(entry.personId);
    return person === undefined ? [] : [{ person, role: entry.role }];
  });
  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="scholarly-contributors">
      <h2 id="scholarly-contributors" className="text-lg font-semibold">
        {t('contributors')}
      </h2>
      <ul className="flex flex-col gap-1 text-sm">
        {rows.map((row) => (
          <li key={`${row.person.slug}-${row.role}`}>
            <TextLink href={`/${locale}/people/${encodeURIComponent(row.person.slug)}`}>
              {row.person.name}
            </TextLink>
            <span className="text-[color:var(--color-foreground-muted)]">
              {' · '}
              {t(`role.${row.role}`)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
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
  const rows = topicIds.flatMap((id) => {
    const topic = topics.get(id);
    return topic === undefined ? [] : [topic];
  });
  if (rows.length === 0) return null;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="scholarly-topics">
      <h2 id="scholarly-topics" className="text-lg font-semibold">
        {t('topics')}
      </h2>
      <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {rows.map((topic) => (
          <li key={topic.slug}>
            <TextLink href={`/${locale}/topics/${encodeURIComponent(topic.slug)}`}>
              {topic.name}
            </TextLink>
          </li>
        ))}
      </ul>
    </section>
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
      <h2 id="scholarly-citations" className="text-lg font-semibold">
        {t('scholarly.citations')}
      </h2>
      <ol className="flex list-decimal flex-col gap-3 ps-6 text-sm">
        {citations.map((citation, index) => (
          <li key={index} className="break-words">
            <span lang={languageCode} dir={direction}>
              {citation.text}
            </span>
            {citation.doi === null && citation.url === null ? null : (
              <span className="flex flex-wrap gap-x-4 gap-y-1">
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
 * Detail — Research, ResearchPaper, Publication, Encyclopedia, MagazineIssue
 * ========================================================================= */

type ContentRecord = Exclude<ScholarlyRecord, MagazineRecord>;

/**
 * One record's page. The facts first — language, date, where it appeared, who
 * published it, its institutional context and, for an issue, its place in the
 * periodical — then who made it and what it is about, then the abstract, the
 * text itself, and the citations.
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
    { name: shell('nav.home'), path: `/${locale}` },
    { name: t('title'), path: `/${locale}/library` },
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
    <Container>
      <article className="flex flex-col gap-10 py-12">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            ...trail
              .slice(0, -1)
              .map((entry) => ({ href: entry.path, text: entry.name })),
            { text: label.title },
          ]}
        />

        <div className="flex flex-col gap-3">
          <StatusBadge tone="neutral">{t(`scholarly.kind.${record.kind}`)}</StatusBadge>
          <Header label={label} t={t} />
        </div>

        <section className="flex flex-col gap-3" aria-labelledby="scholarly-facts">
          <h2 id="scholarly-facts" className="text-lg font-semibold">
            {t('scholarly.facts')}
          </h2>
          <dl className="grid gap-x-8 sm:grid-cols-2">
            {record.kind === 'magazine-issue' && magazineLabel !== null ? (
              <DetailRow term={t('scholarly.fact.magazine')}>
                <TextLink href={scholarlyPath(locale, 'magazine', record.magazine.slug)}>
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
        </section>

        <Contributors record={record} people={references.people} locale={locale} t={t} />
        <Topics
          topicIds={record.topicIds}
          topics={references.topics}
          locale={locale}
          t={t}
        />

        {(record.kind === 'research' || record.kind === 'research-paper') &&
        record.abstract !== null ? (
          <section className="flex flex-col gap-3" aria-labelledby="scholarly-abstract">
            <h2 id="scholarly-abstract" className="text-lg font-semibold">
              {t('scholarly.abstract')}
            </h2>
            <div
              className="library-reader flex flex-col gap-4"
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
            className="flex flex-wrap justify-between gap-4 text-sm"
          >
            {neighbours.previous === null ? (
              <span />
            ) : (
              <TextLink href={listingHref(locale, neighbours.previous)}>
                {t('scholarly.previousIssue')}
                {': '}
                {scholarlyLabel(neighbours.previous, locale).title}
              </TextLink>
            )}
            {neighbours.next === null ? null : (
              <TextLink href={listingHref(locale, neighbours.next)}>
                {t('scholarly.nextIssue')}
                {': '}
                {scholarlyLabel(neighbours.next, locale).title}
              </TextLink>
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
      </article>
    </Container>
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
 * total tie-breaker, in bounded pages. A Magazine with no published issue says so
 * plainly: an honest empty state, never an invented issue list.
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

  const [issues, languages, references] = await Promise.all([
    libraryReadRuntime().magazineIssues(record.id, offset),
    libraryContentLanguages(),
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
    { name: shell('nav.home'), path: `/${locale}` },
    { name: t('title'), path: `/${locale}/library` },
    { name: sectionTitle(t, 'magazine'), path: scholarlyListPath(locale, 'magazine') },
    { name: label.title, path },
  ];

  return (
    <Container>
      <article className="flex flex-col gap-10 py-12">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            ...trail
              .slice(0, -1)
              .map((entry) => ({ href: entry.path, text: entry.name })),
            { text: label.title },
          ]}
        />

        <div className="flex flex-col gap-3">
          <StatusBadge tone="neutral">{t('scholarly.kind.magazine')}</StatusBadge>
          <Header label={label} t={t} />
        </div>

        <Contributors record={record} people={references.people} locale={locale} t={t} />
        <Topics
          topicIds={record.topicIds}
          topics={references.topics}
          locale={locale}
          t={t}
        />

        <section className="flex flex-col gap-4" aria-labelledby="magazine-issues">
          <SectionHeading>
            <span id="magazine-issues">{t('scholarly.issues')}</span>
          </SectionHeading>
          {issues.items.length === 0 ? (
            <EmptyState>{t('scholarly.noIssues')}</EmptyState>
          ) : (
            <ul aria-labelledby="magazine-issues" className="flex flex-col gap-4">
              {issues.items.map((row) => (
                <ScholarlyCard
                  key={row.id}
                  locale={locale}
                  row={row}
                  languages={languages}
                  t={t}
                  headingLevel="h3"
                />
              ))}
            </ul>
          )}
          <Pagination
            label={t('scholarly.issues')}
            previous={
              offset > 0 ? pageOf(path, Math.max(0, offset - SCHOLARLY_PAGE)) : null
            }
            next={issues.hasMore ? pageOf(path, offset + SCHOLARLY_PAGE) : null}
            t={t}
          />
        </section>

        <StructuredData
          record={record}
          title={label.title}
          trail={trail}
          path={path}
          authors={[]}
        />
      </article>
    </Container>
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
