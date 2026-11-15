import { localizedPath } from '@minhaj/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { EditionRecord, WorkDetail, WorkRecord } from '@minhaj/contracts/library';
import { readerPosition } from '@minhaj/contracts/library';

import {
  libraryContentLanguages,
  libraryReadRuntime,
  libraryReferenceNames,
  type ContentLanguage,
} from '@/composition/library-read';
import { directionOf } from '@/config/locale';
import { QuranPassageLinks } from '@/components/quran/tafsir-links';
import { requireLocale } from '@/config/route-locale';
import {
  ActionLink,
  Alert,
  Badge,
  Cover,
  DetailRow,
  EmptyState,
  MetaRow,
  Panel,
  SectionHeader,
  StatusBadge,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { Shelf } from '@/components/ui/shelf';
import { WorkCard } from '@/components/library/cards';
import { editionCoverPath } from '@/components/library/cover';
import { RecordFrame, RecordSection } from '@/components/library/frame';
import { libraryBooksHref } from '@/components/topic-hub/books-view';
import { languageName } from '@/components/topic-hub/parts';
import { absoluteUrl } from '@/config/origin';
import {
  assetPath,
  bibliography,
  canClaimBook,
  EDITION_PARAM,
  editionAccess,
  labelFor,
  labelLocales,
  selectEdition,
  workPath,
} from '@/components/library/presentation';
import { Reader, READER_SECTION_ID } from '@/components/library/reader';
import { PersonalControls } from '@/components/personal-island/personal-controls';
import {
  contentMetadata,
  isContentIndexable,
  serializeStructuredData,
} from '@/seo/metadata';

/**
 * `/{locale}/library/books/{slug}` — THE canonical Work page
 * (ROUTE_MAP.md §5, §9.1; DOMAIN_MODEL.md §10.1).
 *
 * ONE ADDRESS FOR ONE WORK, and the Editions live on it rather than beside it.
 * A Work is "the intellectual creation, independent of any printing or
 * language"; its Editions are manifestations of the same thing. Giving each
 * Edition its own indexable URL would split one work's search authority across
 * however many printings exist, and the route map defines no Edition address —
 * so the selector below is a QUERY PARAMETER and the canonical link stays the
 * bare Work URL (§19, §47).
 *
 * THIS IS NOT A CATALOGUE CARD. PRODUCT_SCOPE.md §2.1 promises readable access,
 * and DELIVERY_PLAN.md Phase 8 says so in as many words: "A visitor who reaches a
 * Work must be able to READ WHAT IS GENUINELY AVAILABLE, and to see honestly when
 * an edition is not available to them." So a readable Edition renders its whole
 * text here, and an Edition that is not readable renders an explicit state rather
 * than an empty panel (§21, §38).
 *
 * THE BOOK'S LANDING (Library Part 1). The header carries the calls to action
 * the selected Edition's real availability allows — read online, open its file,
 * download it — or, when the selected Edition offers none, the way to one that
 * does; every Edition states its language, year, publisher, pages, ISBN,
 * translation facts (translated from, and translated into) and its own calls
 * to action; the reader then takes the page's full width; and the related
 * shelves follow — more on the book's first Topic and more by its first
 * author, each the Library's own listing filtered by it.
 *
 * USABLE SIGNED OUT, AND STRUCTURALLY SO. Every read on this page goes through
 * `@/composition/library-read`, `@/composition/people-read` and
 * `@/composition/taxonomy` — none of which can reach Identity, a session or a
 * cookie. There is no parameter a viewer's identity could arrive through, so the
 * response an authenticated visitor gets is the response an anonymous one gets
 * (ARCHITECTURE.md §8.1, §36).
 *
 * NO PER-USER STATE, HERE OR ANYWHERE THIS PHASE TOUCHES. The reader's position
 * identifier is defined and is linkable; nothing stores where anybody has read
 * to. Authenticated reading history is Phase 21's (DOMAIN_MODEL.md §14.1).
 *
 * `force-dynamic`, for visibility rather than personalisation. A Work is
 * published, corrected and withdrawn by administrators, and "unpublished, staged
 * or draft content is never publicly reachable at all" (ROUTE_MAP.md §9.5) is not
 * a claim a statically cached copy can honour.
 *
 * THE OLD-SLUG 301 IS NOT HERE. It happens in `apps/web/src/proxy.ts`, before
 * this page renders, through Library's own slug history — the same mechanism
 * Editorial's slugs use. A page-level `permanentRedirect()` would emit 308 where
 * DOMAIN_MODEL.md §19.7 and ROUTE_MAP.md §9.7 name 301, and a second redirect
 * mechanism would be a second place for one of them to stop being a 301.
 */
export const dynamic = 'force-dynamic';

interface WorkParams {
  readonly params: Promise<{ readonly locale: string; readonly slug: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** One requested query value, or `null`. A repeated parameter is not a value. */
function single(
  query: Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  const raw = query[key];
  return typeof raw === 'string' && raw !== '' ? raw : null;
}

/** How many related books one shelf holds at most. */
const RELATED = 12;

export async function generateMetadata({ params }: WorkParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const { slug } = await params;

  const record = await libraryReadRuntime().work(slug);
  if (record === null) {
    // A 404 CARRIES NO CANONICAL AND NO ALTERNATES. Announcing a language
    // version of a page that does not exist is the false signal ROUTE_MAP.md
    // §9.2 exists to prevent.
    return { robots: { index: false, follow: false } };
  }

  const label = labelFor(record, locale);

  return contentMetadata({
    locale,
    // THE WORK'S OWN DESCRIPTIVE LANGUAGES, never the platform's locale list. A
    // Work described only in Urdu advertises one alternate, and "untranslated
    // content is never listed as an alternate" (§9.2, §9.8).
    contentLocales: labelLocales(record),
    primaryLocale: record.primaryLocale,
    // THE BARE WORK URL. The selected Edition is deliberately absent: a filtered
    // or selected variant must not become a second canonical address (§47).
    pathFor: (alternate) => workPath(alternate, record.slug),
    title: label.title,
    ...(label.description === '' ? {} : { description: label.description.slice(0, 160) }),
  });
}

/** The address of one Edition on its Work's page, at the reader where it has one. */
function editionPath(
  locale: Locale,
  slug: string,
  editionId: string,
  anchor: string | null,
): string {
  return `${workPath(locale, slug)}?${EDITION_PARAM}=${encodeURIComponent(editionId)}${
    anchor === null ? '' : `#${anchor}`
  }`;
}

export default async function WorkPage({ params, searchParams }: WorkParams) {
  const locale = await requireLocale(params);
  const { slug } = await params;
  const query = await searchParams;

  const t = await getTranslations({ locale, namespace: 'library' });
  const shell = await getTranslations({ locale, namespace: 'shell' });

  // PUBLISHED ONLY, AND THE PREDICATE IS IN THE QUERY. A draft Work, an archived
  // Work and a Work with no published Edition are all absent rather than
  // filtered here, so this page cannot render one by forgetting a check.
  const record = await libraryReadRuntime().work(slug);
  if (record === null) notFound();

  const label = labelFor(record, locale);
  const interfaceDirection = directionOf(locale);

  // RELATED: the Library's own A–Z listing under this Work's first Topic, and
  // under its first author (else its first credited person) — one bounded read
  // each, this Work left out. No Topic or no credit, no such shelf.
  const relatedTopic = record.topicIds[0] ?? null;
  const relatedPerson =
    (
      record.contributors.find((contributor) => contributor.role === 'author') ??
      record.contributors[0]
    )?.personId ?? null;
  const [languages, references, byTopic, byPerson] = await Promise.all([
    libraryContentLanguages(),
    libraryReferenceNames(
      {
        personIds: [
          ...record.contributors.map((contributor) => contributor.personId),
          ...record.editions.flatMap(
            (edition) => edition.translation?.translatorIds ?? [],
          ),
        ],
        topicIds: record.topicIds,
      },
      locale,
    ),
    relatedTopic === null
      ? Promise.resolve(null)
      : libraryReadRuntime().works({
          topic: relatedTopic,
          sort: 'title',
          titleLocale: locale,
        }),
    relatedPerson === null
      ? Promise.resolve(null)
      : libraryReadRuntime().works({
          contributor: relatedPerson,
          sort: 'title',
          titleLocale: locale,
        }),
  ]);

  const selected = selectEdition(
    record.editions,
    locale,
    record.primaryLocale,
    single(query, EDITION_PARAM),
  );
  const selectedAccess = selected === null ? null : editionAccess(selected);
  const contentVersion = selected?.contentVersion ?? null;
  const readerShown =
    selected !== null &&
    selectedAccess !== null &&
    selectedAccess.reflowable &&
    selected.document !== null &&
    contentVersion !== null;

  // The Work's authors, by name, for the opening metadata row — the full
  // credit list, with roles and links, is in the aside.
  const authors = record.contributors
    .filter((contributor) => contributor.role === 'author')
    .flatMap((contributor) => {
      const name = references.people.get(contributor.personId)?.name;
      return name === undefined ? [] : [name];
    });
  // Each content language the published Editions are in, once, in their order.
  const editionLanguages = [
    ...new Set(record.editions.map((edition) => edition.languageCode)),
  ];
  // A content language named in the INTERFACE language, for a sentence in it
  // ("Read the Arabic edition"); the badges and facts keep Taxonomy's own name.
  const languageNameOf = (code: string) => languageName(code, locale);

  const topics = record.topicIds.flatMap((topicId) => {
    const topic = references.topics.get(topicId);
    return topic === undefined ? [] : [{ id: topicId, name: topic.name }];
  });

  // The cover shown is the selected Edition's, else the Work's card cover
  // (Phase 30-R). Its path names the Edition that holds it.
  const shownCover =
    selected !== null && selected.cover !== null
      ? { ...selected.cover, editionId: selected.id }
      : record.cover;
  const coverSrc =
    shownCover === null
      ? null
      : editionCoverPath(shownCover.editionId, shownCover.assetId);

  // THE CALLS TO ACTION THE SELECTED EDITION'S REAL AVAILABILITY ALLOWS — and
  // when it allows no reading, the way to the first Edition that does. Never a
  // call to an action the stored decision refuses.
  const otherReadable =
    selectedAccess === null || !selectedAccess.unavailable
      ? null
      : (record.editions.find((edition) => !editionAccess(edition).unavailable) ?? null);
  const actions = [
    readerShown ? (
      <ActionLink key="read" href={`#${READER_SECTION_ID}`}>
        {t('readOnline')}
      </ActionLink>
    ) : null,
    selected !== null &&
    selectedAccess !== null &&
    selectedAccess.readableFile !== null ? (
      <ActionLink
        key="file"
        href={assetPath(selected.id, 'read', selectedAccess.readableFile)}
      >
        {t('openFile')}
      </ActionLink>
    ) : null,
    otherReadable === null ? null : (
      <ActionLink
        key="other"
        href={editionPath(
          locale,
          record.slug,
          otherReadable.id,
          editionAccess(otherReadable).reflowable
            ? READER_SECTION_ID
            : 'work-availability',
        )}
      >
        {t('readEditionIn', { language: languageNameOf(otherReadable.languageCode) })}
      </ActionLink>
    ),
    selected !== null &&
    selectedAccess !== null &&
    selectedAccess.downloadable !== null ? (
      <ActionLink
        key="download"
        tone="secondary"
        href={assetPath(selected.id, 'download', selectedAccess.downloadable)}
      >
        {t('downloadFile')}
      </ActionLink>
    ) : null,
    record.editions.length > 1 ? (
      <ActionLink key="editions" tone="secondary" href="#work-editions">
        {t('allEditions', { count: record.editions.length })}
      </ActionLink>
    ) : null,
  ].filter((action) => action !== null);

  const positionTemplate = t('sectionPosition', {
    current: '{current}',
    total: '{total}',
  });
  const selectedLanguage =
    selected === null ? undefined : languages.get(selected.languageCode);

  const relatedTopicName =
    relatedTopic === null ? null : (references.topics.get(relatedTopic)?.name ?? null);
  const relatedPersonName =
    relatedPerson === null ? null : (references.people.get(relatedPerson)?.name ?? null);
  const others = (page: { readonly items: readonly WorkRecord[] } | null) =>
    (page?.items ?? []).filter((work) => work.id !== record.id).slice(0, RELATED);

  return (
    <RecordFrame
      breadcrumbLabel={shell('nav.breadcrumbs')}
      trail={[
        { href: localizedPath(locale, ''), text: shell('nav.home') },
        { href: localizedPath(locale, '/library'), text: t('title') },
        { href: localizedPath(locale, '/library/books'), text: t('books') },
        { text: label.title },
      ]}
      eyebrow={t('kindBook')}
      /*
       * The title is rendered in ITS OWN language and direction. `lang` on the
       * heading rather than on the page is what lets an Arabic title sit inside
       * an English page and still be announced in Arabic (WCAG 3.1.2).
       */
      title={label.title}
      lang={label.locale}
      dir={directionOf(label.locale)}
      summary={label.description === '' ? [] : [label.description]}
      meta={
        <MetaRow
          items={[
            authors.length === 0
              ? null
              : new Intl.ListFormat(locale, { type: 'conjunction' }).format(authors),
            record.editions.length === 0
              ? null
              : t('editionCount', { count: record.editions.length }),
            ...editionLanguages.map((code) => {
              const language = languages.get(code);
              return (
                <span key={code} lang={code} dir={language?.direction ?? 'ltr'}>
                  {language?.name ?? code}
                </span>
              );
            }),
          ]}
        />
      }
      {...(actions.length === 0 ? {} : { actions: <>{actions}</> })}
      /*
       * THE DISTINCTION DOMAIN_MODEL.md §10.1 EXISTS TO PROTECT, said on the
       * page rather than only in a document. The title above is this
       * platform's descriptive metadata; it is not a claim that a translated
       * Edition exists. The Editions below are where translation is a fact.
       */
      notice={t('metadataNotice')}
      {...(shownCover === null || coverSrc === null
        ? {}
        : {
            cover: (
              <Cover
                path={coverSrc}
                width={shownCover.width}
                height={shownCover.height}
                alt={t('coverAlt', { title: label.title })}
                priority
                sizes="(min-width: 64rem) 14rem, 11rem"
              />
            ),
          })}
      aside={
        <>
          <PersonalControls locale={locale} target={{ kind: 'work', id: record.id }} />

          <Contributors work={record} people={references.people} locale={locale} t={t} />

          {topics.length === 0 ? null : (
            <RecordSection id="work-topics" heading={t('topics')}>
              {/*
               * A FILTERED LIBRARY BROWSE, not a Topic page. Each chip narrows
               * the Library's own listing to this Topic; Taxonomy's canonical
               * hub is a different surface with its own entry points.
               */}
              <TopicChips
                label={t('topics')}
                topics={topics.map((topic) => ({
                  href: libraryBooksHref(locale, { library: { topic: topic.id } }),
                  text: topic.name,
                }))}
              />
            </RecordSection>
          )}
        </>
      }
      after={
        <>
          {readerShown &&
          selected !== null &&
          selected.document !== null &&
          contentVersion !== null ? (
            <Reader
              anchorFor={(key) => readerPosition(selected.id, contentVersion, key)}
              languageCode={selected.languageCode}
              direction={selectedLanguage?.direction ?? 'ltr'}
              interfaceLocale={locale}
              interfaceDirection={interfaceDirection}
              document={selected.document}
              labels={{
                readerHeading: t('readerHeading'),
                readerIntro: t('readerIntro', {
                  edition: selected.label,
                  language: languageNameOf(selected.languageCode),
                  count: selected.document.sections.length,
                }),
                contents: t('contents'),
                // The placeholders are handed back AS placeholders: the position is
                // substituted per section on the server and per scroll step in the
                // controls island, so the catalogue is formatted once here with its
                // own tokens rather than once per section.
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
          ) : null}

          <RelatedShelf
            id="work-related-topic"
            locale={locale}
            works={others(byTopic)}
            heading={
              relatedTopicName === null
                ? null
                : t('related.heading', { topic: relatedTopicName })
            }
            all={
              relatedTopic === null || relatedTopicName === null
                ? null
                : {
                    href: libraryBooksHref(locale, { library: { topic: relatedTopic } }),
                    text: t('related.all', { topic: relatedTopicName }),
                  }
            }
            t={t}
          />
          <RelatedShelf
            id="work-related-person"
            locale={locale}
            works={others(byPerson)}
            heading={
              relatedPersonName === null
                ? null
                : t('related.byHeading', { name: relatedPersonName })
            }
            all={
              relatedPerson === null || relatedPersonName === null
                ? null
                : {
                    href: libraryBooksHref(locale, { contributor: relatedPerson }),
                    text: t('related.byAll', { name: relatedPersonName }),
                  }
            }
            t={t}
          />

          <BookStructuredData
            record={record}
            edition={selected}
            label={label}
            people={references.people}
            imagePath={coverSrc}
          />
        </>
      }
    >
      <Editions
        record={record}
        selected={selected}
        languages={languages}
        people={references.people}
        locale={locale}
        t={t}
      />

      {selected === null ? (
        <EmptyState>{t('noEditions')}</EmptyState>
      ) : (
        <EditionAccessPanel
          edition={selected}
          readerShown={readerShown}
          otherReadable={otherReadable}
          languageName={languageNameOf}
          slug={record.slug}
          locale={locale}
          t={t}
        />
      )}

      {/* Quran Part 8: the Quran passages this book explains, into the Tafsir hub. */}
      <QuranPassageLinks locale={locale} passages={record.quranPassages} />

      <SalePoints record={record} t={t} />
    </RecordFrame>
  );
}

type LibraryTranslator = Awaited<ReturnType<typeof getTranslations<'library'>>>;
type NameMap = ReadonlyMap<string, { slug: string; name: string }>;

/**
 * The Work's contributors, resolved by People and linked to People's canonical
 * address.
 *
 * `/{locale}/people/{slug}` DIRECTLY, not `/library/authors/{slug}`. That alias
 * exists and 301s here, but it exists for links already in the world — sending a
 * visitor through a redirect the page could have skipped is a hop for nothing,
 * and ROUTE_MAP.md §9.1 rule 3 makes the canonical the destination (§32).
 *
 * A CONTRIBUTOR RELATION GRANTS NOTHING. This is attribution: it says who wrote
 * the book, and nothing about what anybody may do on this platform
 * (DOMAIN_MODEL.md §5, and this phase's §14).
 *
 * AN UNRESOLVED CONTRIBUTOR IS OMITTED. If People does not return a published
 * contributor for an identifier, there is no name to show, and a bare identifier
 * beside a book would be worse than nothing.
 */
function Contributors({
  work,
  people,
  locale,
  t,
}: {
  readonly work: WorkDetail;
  readonly people: NameMap;
  readonly locale: Locale;
  readonly t: LibraryTranslator;
}) {
  const rows = work.contributors
    .map((contributor) => ({
      role: contributor.role,
      person: people.get(contributor.personId),
    }))
    .filter(
      (row): row is { role: typeof row.role; person: { slug: string; name: string } } =>
        row.person !== undefined,
    );

  if (rows.length === 0) return null;

  return (
    <RecordSection id="work-contributors" heading={t('contributors')}>
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
              {t(`role.${row.role}` as 'role.author')}
            </span>
          </li>
        ))}
      </ul>
    </RecordSection>
  );
}

/**
 * Every published Edition, with the selector and its own calls to action.
 *
 * THE SELECTOR IS A LIST OF LINKS, which is what makes it keyboard-operable
 * without a line of JavaScript: Tab reaches each one, Enter follows it, and the
 * selected Edition is marked in TEXT rather than by styling alone (§20, §48).
 *
 * EACH EDITION STATES ITS OWN CONTENT LANGUAGE, resolved from Taxonomy. That is
 * the honest answer to "is there an Urdu version of this book?" — and it is a
 * different question from which language the page's chrome is in (§9).
 *
 * TRANSLATION IS SHOWN WHERE IT IS A FACT. A `BookTranslation` row names the
 * translators and, where it is known, the source Edition — and the source names
 * the Editions translated from it. Where the source is not recorded, the page
 * says it is not recorded rather than guessing at one (§13).
 *
 * AVAILABILITY IS STATED PER EDITION, in words (Library Part 1): readable
 * online, readable as a file, a download, or not available online — and each
 * call to action is the one that Edition's stored decision allows, through
 * Library's own asset routes (`assetPath`), which decide again on every
 * request.
 */
function Editions({
  record,
  selected,
  languages,
  people,
  locale,
  t,
}: {
  readonly record: WorkDetail;
  readonly selected: EditionRecord | null;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly people: NameMap;
  readonly locale: Locale;
  readonly t: LibraryTranslator;
}) {
  if (record.editions.length === 0) return null;

  const showLink = (edition: EditionRecord, text: string, anchor: string | null) => (
    <a
      href={editionPath(locale, record.slug, edition.id, anchor)}
      className="inline-flex min-h-11 items-center rounded-control border border-border-strong px-4 text-sm font-semibold no-underline transition-colors duration-[var(--duration-fast)] hover:bg-surface-sunken active:bg-border"
    >
      {text}
    </a>
  );

  return (
    <section aria-labelledby="work-editions" className="flex scroll-mt-4 flex-col gap-4">
      <h2
        id="work-editions"
        className="border-b border-border pb-3 text-heading font-semibold"
      >
        {t('editions')}
      </h2>

      <ul aria-label={t('editions')} className="flex flex-col gap-3">
        {record.editions.map((edition) => {
          const language = languages.get(edition.languageCode);
          const isSelected = selected !== null && selected.id === edition.id;
          const access = editionAccess(edition);
          const source =
            edition.translation?.sourceEditionId === null || edition.translation === null
              ? null
              : (record.editions.find(
                  (candidate) => candidate.id === edition.translation?.sourceEditionId,
                ) ?? null);
          const translations = record.editions.filter(
            (candidate) => candidate.translation?.sourceEditionId === edition.id,
          );

          return (
            <li
              key={edition.id}
              className={`flex min-w-0 flex-col gap-3 rounded-panel border p-5 ${
                isSelected
                  ? 'border-accent-rule bg-accent-surface'
                  : 'border-border bg-surface-raised'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                <div className="flex min-w-0 flex-col gap-2">
                  <h3 className="text-subheading font-semibold wrap-anywhere" dir="auto">
                    {edition.label}
                  </h3>
                  <span className="flex flex-wrap gap-1.5">
                    <Badge kind="language" lang={edition.languageCode}>
                      {language?.name ?? edition.languageCode}
                    </Badge>
                    {access.reflowable ? (
                      <Badge kind="status" tone="positive">
                        {t('editionState.readable')}
                      </Badge>
                    ) : access.readableFile !== null ? (
                      <Badge kind="status" tone="positive">
                        {t('editionState.file')}
                      </Badge>
                    ) : (
                      <Badge kind="status" tone="neutral">
                        {t('editionState.unavailable')}
                      </Badge>
                    )}
                    {access.downloadable === null ? null : (
                      <Badge kind="status" tone="positive">
                        {t('editionState.download')}
                      </Badge>
                    )}
                  </span>
                </div>
                {isSelected ? (
                  <StatusBadge tone="positive">{t('selectedEdition')}</StatusBadge>
                ) : (
                  showLink(edition, t('showEdition'), null)
                )}
              </div>

              <dl className="grid gap-x-8 sm:grid-cols-2">
                <DetailRow term={t('contentLanguage')}>
                  <span lang={edition.languageCode} dir={language?.direction ?? 'ltr'}>
                    {language?.name ?? edition.languageCode}
                  </span>
                </DetailRow>

                {bibliography(edition).map((fact) => (
                  <DetailRow key={fact.key} term={t(`fact.${fact.key}` as 'fact.isbn')}>
                    {fact.value}
                  </DetailRow>
                ))}

                {edition.translation === null ? null : (
                  <>
                    <DetailRow term={t('translationOf')}>
                      {source === null ? (
                        t('sourceUnknown')
                      ) : (
                        <TextLink
                          href={editionPath(locale, record.slug, source.id, null)}
                        >
                          <span dir="auto">{source.label}</span>
                        </TextLink>
                      )}
                    </DetailRow>
                    <DetailRow term={t('translators')}>
                      {edition.translation.translatorIds
                        .map((id) => people.get(id)?.name)
                        .filter((name): name is string => name !== undefined)
                        .join(' · ') || t('sourceUnknown')}
                    </DetailRow>
                  </>
                )}

                {translations.length === 0 ? null : (
                  <DetailRow term={t('translatedInto')}>
                    <span className="flex flex-wrap gap-x-3 gap-y-1">
                      {translations.map((translation) => (
                        <TextLink
                          key={translation.id}
                          href={editionPath(locale, record.slug, translation.id, null)}
                        >
                          <span dir="auto">{translation.label}</span>
                        </TextLink>
                      ))}
                    </span>
                  </DetailRow>
                )}
              </dl>

              {/*
               * THIS EDITION'S OWN CALLS TO ACTION, each the one its stored
               * decision allows. The visible words are short; the Edition they
               * act on is named for assistive technology, so a list of them
               * read out of context still says which is which (WCAG 2.4.4).
               */}
              {access.unavailable && access.downloadable === null ? null : (
                <p className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
                  {access.reflowable ? (
                    <EditionAction
                      href={editionPath(
                        locale,
                        record.slug,
                        edition.id,
                        READER_SECTION_ID,
                      )}
                      text={t('readOnline')}
                      edition={edition.label}
                    />
                  ) : null}
                  {access.readableFile === null ? null : (
                    <EditionAction
                      href={assetPath(edition.id, 'read', access.readableFile)}
                      text={t('openPdf')}
                      edition={edition.label}
                    />
                  )}
                  {access.downloadable === null ? null : (
                    <EditionAction
                      href={assetPath(edition.id, 'download', access.downloadable)}
                      text={t('downloadPdf')}
                      edition={edition.label}
                    />
                  )}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** One Edition's call to action: short visible words, the Edition named for assistive technology. */
function EditionAction({
  href,
  text,
  edition,
}: {
  readonly href: string;
  readonly text: string;
  readonly edition: string;
}) {
  return (
    <a
      href={href}
      className="inline-flex min-h-11 items-center gap-1 font-semibold text-action underline-offset-4 hover:underline"
    >
      {text}
      <span className="sr-only" dir="auto">
        {` — ${edition}`}
      </span>
    </a>
  );
}

/**
 * What the visitor may actually DO with the selected Edition — read it, take a
 * copy, or neither, said explicitly.
 *
 * FOUR STATES, AND NONE IS DERIVED FROM ANOTHER (§26, §27, §38):
 *
 *   - REFLOWABLE TEXT exists → the reader renders the edition, below.
 *   - A READABLE FILE and no text → a described link to the file, and a plain
 *     statement that this edition is a file rather than reflowing text. A PDF is
 *     never offered as a substitute for text that exists (§23).
 *   - A DOWNLOAD is a SEPARATE decision. "Readable online" does not imply
 *     downloadable and a file existing does not imply either: the availability
 *     decision is Library-owned data, never inferred from file presence, an ISBN,
 *     a publisher or a source URL (§26).
 *   - NOTHING READABLE → an explicit, usable state — and, where another Edition
 *     of the Work can be read, the way to it. Not a 500, not a blank area, not
 *     a broken link (§38).
 *
 * WHAT THE UNAVAILABLE STATE DOES NOT SAY. It does not state a legal reason,
 * because the data carries none and inventing one would be inventing law. It does
 * not name a scanner result, a filesystem path or an internal permission reason
 * either — those are the disclosures §38 prohibits.
 */
function EditionAccessPanel({
  edition,
  readerShown,
  otherReadable,
  languageName,
  slug,
  locale,
  t,
}: {
  readonly edition: EditionRecord;
  readonly readerShown: boolean;
  readonly otherReadable: EditionRecord | null;
  readonly languageName: (code: string) => string;
  readonly slug: string;
  readonly locale: Locale;
  readonly t: LibraryTranslator;
}) {
  const access = editionAccess(edition);

  return (
    <section
      aria-labelledby="work-availability"
      className="flex scroll-mt-4 flex-col gap-4"
    >
      <h2
        id="work-availability"
        className="border-b border-border pb-3 text-heading font-semibold"
      >
        {t('availability')}
      </h2>

      {/*
       * TWO SEPARATE DECISIONS, shown side by side and never derived from one
       * another: whether this edition can be read here, and whether a copy
       * may be taken.
       */}
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-panel border border-border bg-surface-raised p-4">
          <dt className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase">
            {t('availabilityReading')}
          </dt>
          <dd className="flex flex-col gap-3 text-sm">
            {access.unavailable ? (
              <>
                <Alert tone="info">{t('editionUnavailable')}</Alert>
                {otherReadable === null ? null : (
                  <p>
                    <TextLink
                      href={editionPath(
                        locale,
                        slug,
                        otherReadable.id,
                        editionAccess(otherReadable).reflowable
                          ? READER_SECTION_ID
                          : 'work-availability',
                      )}
                    >
                      {t('readEditionIn', {
                        language: languageName(otherReadable.languageCode),
                      })}
                    </TextLink>
                  </p>
                )}
              </>
            ) : access.readableFile === null ? (
              <>
                <p>{t('readBelow')}</p>
                {readerShown ? (
                  <div>
                    <ActionLink href={`#${READER_SECTION_ID}`} tone="secondary">
                      {t('startReading')}
                    </ActionLink>
                  </div>
                ) : null}
              </>
            ) : (
              <>
                <p className="text-foreground-muted">{t('readableFileNotice')}</p>
                <div>
                  <ActionLink
                    href={assetPath(edition.id, 'read', access.readableFile)}
                    tone="secondary"
                  >
                    {t('openFile')}
                  </ActionLink>
                </div>
              </>
            )}
          </dd>
        </div>

        <div className="flex flex-col gap-2 rounded-panel border border-border bg-surface-raised p-4">
          <dt className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase">
            {t('availabilityDownload')}
          </dt>
          <dd className="flex flex-col gap-3 text-sm">
            {access.downloadable === null ? (
              <p className="text-foreground-muted">{t('downloadUnavailable')}</p>
            ) : (
              <div>
                {/*
                 * The format is stated in the link's own text rather than left to
                 * an icon: "no colour-only semantics" applies to shape too, and a
                 * described link is what §23 asks for.
                 */}
                <ActionLink href={assetPath(edition.id, 'download', access.downloadable)}>
                  {t('downloadFile')}
                </ActionLink>
              </div>
            )}
          </dd>
        </div>
      </dl>
    </section>
  );
}

/**
 * A SHELF OF RELATED BOOKS (R2; by contributor too since Library Part 1): the
 * Library's own A–Z listing under the Work's first Topic or its first author,
 * as covers, with the way to the whole filtered listing. Absent when there is
 * no such Topic or person, or nothing else under it.
 */
function RelatedShelf({
  id,
  locale,
  works,
  heading,
  all,
  t,
}: {
  readonly id: string;
  readonly locale: Locale;
  readonly works: readonly WorkRecord[];
  readonly heading: string | null;
  readonly all: { readonly href: string; readonly text: string } | null;
  readonly t: LibraryTranslator;
}) {
  if (works.length === 0 || heading === null || all === null) return null;
  return (
    <section aria-labelledby={id}>
      <Shelf
        label={heading}
        size="cover"
        previousLabel={t('landing.showPrevious')}
        nextLabel={t('landing.showNext')}
        header={<SectionHeader id={id} heading={heading} action={all} />}
      >
        {works.map((work) => (
          <WorkCard key={work.id} locale={locale} work={work} />
        ))}
      </Shelf>
    </section>
  );
}

/**
 * Where a printed copy can be obtained.
 *
 * INFORMATION, NOT COMMERCE. SalePoint is "printed-book availability"
 * (DOMAIN_MODEL.md §10.2). There is no cart, no checkout, no price and no stock
 * here, and the notice says so plainly so a visitor is not left expecting one
 * (§30).
 */
function SalePoints({
  record,
  t,
}: {
  readonly record: WorkDetail;
  readonly t: LibraryTranslator;
}) {
  if (record.salePoints.length === 0) return null;

  return (
    <section aria-labelledby="work-sale-points" className="flex flex-col gap-4">
      <h2
        id="work-sale-points"
        className="border-b border-border pb-3 text-heading font-semibold"
      >
        {t('salePoints')}
      </h2>
      <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
        {t('salePointsNotice')}
      </p>
      <ul className="grid list-none grid-cols-1 gap-4 p-0 *:min-w-0 sm:grid-cols-2">
        {record.salePoints.map((point) => (
          <Panel key={point.id} as="li">
            <div className="flex flex-col gap-1 text-sm">
              <p className="text-subheading font-semibold wrap-anywhere" dir="auto">
                {point.name}
              </p>
              {point.address === '' ? null : <p dir="auto">{point.address}</p>}
              {point.contact === '' ? null : <p dir="auto">{point.contact}</p>}
              {point.url === null ? null : (
                <p>
                  {/*
                   * Stored HTTPS URLs only, validated at the trust boundary when
                   * the record was saved. `rel` is not set here because the
                   * platform's link posture belongs to the shell, and an
                   * outbound link is not a security decision this page makes.
                   */}
                  <TextLink href={point.url}>
                    <span className="wrap-anywhere">{point.url}</span>
                  </TextLink>
                </p>
              )}
            </div>
          </Panel>
        ))}
      </ul>
    </section>
  );
}

/**
 * `Book` structured data, and ONLY where the data supports the claim.
 *
 * DELIVERY_PLAN.md Phase 8 names the condition exactly: "`Book` structured data
 * only where genuine ISBN and author exist". Both must be real, on the Edition
 * being presented and on the Work respectively. Nothing here is fabricated — no
 * ISBN, no author, no publisher, no date, no Organization, no translation, no
 * rating and no price; an `image` only when the Edition's own cover is
 * recorded, at Library's own address (Phase 30-R). If either fact is missing the element is
 * omitted, because "omitting structured data is correct and harmless; emitting a
 * wrong claim is not" (ROUTE_MAP.md §9.6).
 *
 * AND ONLY WHEN THE PAGE IS INDEXABLE AT ALL. A page that says `noindex` while
 * publishing a machine-readable claim about a real book would be over-claiming in
 * the one place nobody looks.
 */
function BookStructuredData({
  record,
  edition,
  label,
  people,
  imagePath,
}: {
  readonly record: WorkDetail;
  readonly edition: EditionRecord | null;
  readonly label: { locale: Locale; title: string };
  readonly people: NameMap;
  readonly imagePath: string | null;
}) {
  if (!isContentIndexable({ contentLocales: labelLocales(record) })) return null;
  if (!canClaimBook(record, edition) || edition === null) return null;

  const authors = record.contributors
    .filter((contributor) => contributor.role === 'author')
    .map((contributor) => people.get(contributor.personId)?.name)
    .filter((name): name is string => name !== undefined);

  // The author facts have to be REAL NAMES, not identifiers. If People cannot
  // resolve any of them there is no author to claim, whatever the relation says.
  if (authors.length === 0) return null;

  return (
    <script
      type="application/ld+json"
      // Stored text cannot terminate the script element: the shared serialiser
      // escapes `<`, and the result is still valid JSON.
      dangerouslySetInnerHTML={{
        __html: serializeStructuredData({
          '@context': 'https://schema.org',
          '@type': 'Book',
          name: label.title,
          inLanguage: edition.languageCode,
          isbn: edition.isbn,
          author: authors.map((name) => ({ '@type': 'Person', name })),
          ...(imagePath === null ? {} : { image: absoluteUrl(imagePath) }),
        }),
      }}
    />
  );
}
