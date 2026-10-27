import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { EditionRecord, WorkDetail } from '@minhaj/contracts/library';
import { readerPosition } from '@minhaj/contracts/library';

import {
  libraryContentLanguages,
  libraryReadRuntime,
  libraryReferenceNames,
  type ContentLanguage,
} from '@/composition/library-read';
import { directionOf } from '@/config/locale';
import { requireLocale } from '@/config/route-locale';
import {
  ActionLink,
  Alert,
  DetailRow,
  EmptyState,
  MetaRow,
  Panel,
  StatusBadge,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { RecordFrame, RecordSection } from '@/components/library/frame';
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
import { Reader } from '@/components/library/reader';
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

  const [languages, references] = await Promise.all([
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
  ]);

  const selected = selectEdition(
    record.editions,
    locale,
    record.primaryLocale,
    single(query, EDITION_PARAM),
  );

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

  const topics = record.topicIds.flatMap((topicId) => {
    const topic = references.topics.get(topicId);
    return topic === undefined ? [] : [{ id: topicId, name: topic.name }];
  });

  return (
    <RecordFrame
      breadcrumbLabel={shell('nav.breadcrumbs')}
      trail={[
        { href: `/${locale}`, text: shell('nav.home') },
        { href: `/${locale}/library`, text: t('title') },
        { href: `/${locale}/library/books`, text: t('books') },
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
      /*
       * THE DISTINCTION DOMAIN_MODEL.md §10.1 EXISTS TO PROTECT, said on the
       * page rather than only in a document. The title above is this
       * platform's descriptive metadata; it is not a claim that a translated
       * Edition exists. The Editions below are where translation is a fact.
       */
      notice={t('metadataNotice')}
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
                  href: `/${locale}/library/books?topic=${encodeURIComponent(topic.id)}`,
                  text: topic.name,
                }))}
              />
            </RecordSection>
          )}
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
          languages={languages}
          locale={locale}
          interfaceDirection={interfaceDirection}
          t={t}
        />
      )}

      <SalePoints record={record} t={t} />

      <BookStructuredData
        record={record}
        edition={selected}
        label={label}
        people={references.people}
      />
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
      <ul className="flex flex-col divide-y divide-[color:var(--color-border)] text-sm">
        {rows.map((row) => (
          <li
            key={`${row.person.slug}-${row.role}`}
            className="flex flex-col gap-0.5 py-2"
          >
            <TextLink href={`/${locale}/people/${encodeURIComponent(row.person.slug)}`}>
              {row.person.name}
            </TextLink>
            <span className="text-caption text-[color:var(--color-foreground-muted)]">
              {t(`role.${row.role}` as 'role.author')}
            </span>
          </li>
        ))}
      </ul>
    </RecordSection>
  );
}

/**
 * Every published Edition, with the selector.
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
 * translators and, where it is known, the source Edition. Where the source is not
 * recorded, the page says it is not recorded rather than guessing at one (§13).
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

  return (
    <section aria-labelledby="work-editions" className="flex flex-col gap-4">
      <h2
        id="work-editions"
        className="border-b border-[color:var(--color-border)] pb-3 text-heading font-semibold"
      >
        {t('editions')}
      </h2>

      <ul aria-label={t('editions')} className="flex flex-col gap-3">
        {record.editions.map((edition) => {
          const language = languages.get(edition.languageCode);
          const isSelected = selected !== null && selected.id === edition.id;
          const source =
            edition.translation?.sourceEditionId === null || edition.translation === null
              ? null
              : (record.editions.find(
                  (candidate) => candidate.id === edition.translation?.sourceEditionId,
                ) ?? null);

          return (
            <li
              key={edition.id}
              className={`flex min-w-0 flex-col gap-3 rounded-[var(--radius-panel)] border bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-panel)] ${
                isSelected
                  ? 'border-[color:var(--color-accent)] border-s-4'
                  : 'border-[color:var(--color-border)]'
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                <h3 className="text-subheading font-semibold wrap-anywhere" dir="auto">
                  {edition.label}
                </h3>
                {isSelected ? (
                  <StatusBadge tone="positive">{t('selectedEdition')}</StatusBadge>
                ) : (
                  <a
                    href={`${workPath(locale, record.slug)}?${EDITION_PARAM}=${encodeURIComponent(edition.id)}`}
                    className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-semibold no-underline transition-colors duration-[var(--duration-fast)] hover:bg-[color:var(--color-surface-sunken)] active:bg-[color:var(--color-border)]"
                  >
                    {t('showEdition')}
                  </a>
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
                      {source === null ? t('sourceUnknown') : source.label}
                    </DetailRow>
                    <DetailRow term={t('translators')}>
                      {edition.translation.translatorIds
                        .map((id) => people.get(id)?.name)
                        .filter((name): name is string => name !== undefined)
                        .join(' · ') || t('sourceUnknown')}
                    </DetailRow>
                  </>
                )}
              </dl>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * What the visitor may actually DO with the selected Edition — read it, take a
 * copy, or neither, said explicitly.
 *
 * FOUR STATES, AND NONE IS DERIVED FROM ANOTHER (§26, §27, §38):
 *
 *   - REFLOWABLE TEXT exists → the reader renders the edition.
 *   - A READABLE FILE and no text → a described link to the file, and a plain
 *     statement that this edition is a file rather than reflowing text. A PDF is
 *     never offered as a substitute for text that exists (§23).
 *   - A DOWNLOAD is a SEPARATE decision. "Readable online" does not imply
 *     downloadable and a file existing does not imply either: the availability
 *     decision is Library-owned data, never inferred from file presence, an ISBN,
 *     a publisher or a source URL (§26).
 *   - NOTHING READABLE → an explicit, usable state. Not a 500, not a blank area,
 *     not a broken link (§38).
 *
 * WHAT THE UNAVAILABLE STATE DOES NOT SAY. It does not state a legal reason,
 * because the data carries none and inventing one would be inventing law. It does
 * not name a scanner result, a filesystem path or an internal permission reason
 * either — those are the disclosures §38 prohibits.
 */
function EditionAccessPanel({
  edition,
  languages,
  locale,
  interfaceDirection,
  t,
}: {
  readonly edition: EditionRecord;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly locale: Locale;
  readonly interfaceDirection: 'ltr' | 'rtl';
  readonly t: LibraryTranslator;
}) {
  const access = editionAccess(edition);
  const language = languages.get(edition.languageCode);
  const contentVersion = edition.contentVersion;
  const positionTemplate = t('sectionPosition', {
    current: '{current}',
    total: '{total}',
  });

  return (
    <section aria-labelledby="work-availability" className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <h2
          id="work-availability"
          className="border-b border-[color:var(--color-border)] pb-3 text-heading font-semibold"
        >
          {t('availability')}
        </h2>

        {/*
         * TWO SEPARATE DECISIONS, shown side by side and never derived from one
         * another: whether this edition can be read here, and whether a copy
         * may be taken.
         */}
        <dl className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-4">
            <dt className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-accent)] uppercase">
              {t('availabilityReading')}
            </dt>
            <dd className="flex flex-col gap-3 text-sm">
              {access.unavailable ? (
                <Alert tone="info">{t('editionUnavailable')}</Alert>
              ) : access.readableFile === null ? (
                <p>{t('readBelow')}</p>
              ) : (
                <>
                  <p className="text-[color:var(--color-foreground-muted)]">
                    {t('readableFileNotice')}
                  </p>
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

          <div className="flex flex-col gap-2 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-4">
            <dt className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-accent)] uppercase">
              {t('availabilityDownload')}
            </dt>
            <dd className="flex flex-col gap-3 text-sm">
              {access.downloadable === null ? (
                <p className="text-[color:var(--color-foreground-muted)]">
                  {t('downloadUnavailable')}
                </p>
              ) : (
                <div>
                  <ActionLink
                    href={assetPath(edition.id, 'download', access.downloadable)}
                  >
                    {t('downloadFile')}
                  </ActionLink>
                  {/*
                   * The format is stated in the link's own text rather than left to
                   * an icon: "no colour-only semantics" applies to shape too, and a
                   * described link is what §23 asks for.
                   */}
                </div>
              )}
            </dd>
          </div>
        </dl>
      </div>

      {/*
       * `contentVersion` is non-null whenever a document is, by a CHECK
       * constraint and by the schema — but the reader's position identifier is
       * built from it, so it is read as a condition rather than asserted. A
       * position identifier built from an empty digest would be a stable name
       * for nothing.
       */}
      {access.reflowable && edition.document !== null && contentVersion !== null ? (
        <Reader
          anchorFor={(key) => readerPosition(edition.id, contentVersion, key)}
          languageCode={edition.languageCode}
          direction={language?.direction ?? 'ltr'}
          interfaceLocale={locale}
          interfaceDirection={interfaceDirection}
          document={edition.document}
          labels={{
            readerHeading: t('readerHeading'),
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
          }}
        />
      ) : null}
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
        className="border-b border-[color:var(--color-border)] pb-3 text-heading font-semibold"
      >
        {t('salePoints')}
      </h2>
      <p className="max-w-[var(--measure-prose)] text-sm text-[color:var(--color-foreground-muted)]">
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
 * ISBN, no author, no publisher, no date, no image, no Organization, no
 * translation, no rating and no price. If either fact is missing the element is
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
}: {
  readonly record: WorkDetail;
  readonly edition: EditionRecord | null;
  readonly label: { locale: Locale; title: string };
  readonly people: NameMap;
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
        }),
      }}
    />
  );
}
