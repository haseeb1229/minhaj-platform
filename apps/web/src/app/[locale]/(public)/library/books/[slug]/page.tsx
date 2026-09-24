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
  Alert,
  Breadcrumbs,
  Container,
  DetailRow,
  EmptyState,
  Panel,
  Prose,
  SectionHeading,
  StatusBadge,
  TextLink,
} from '@/components/ui';
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

  return (
    <Container>
      <div className="flex flex-col gap-10 py-12">
        <Breadcrumbs
          label={shell('nav.breadcrumbs')}
          trail={[
            { href: `/${locale}`, text: shell('nav.home') },
            { href: `/${locale}/library`, text: t('title') },
            { href: `/${locale}/library/books`, text: t('books') },
            { text: label.title },
          ]}
        />

        <Prose>
          {/*
           * The title is rendered in ITS OWN language and direction. `lang` on
           * the element rather than on the page is what lets an Arabic title sit
           * inside an English page and still be announced in Arabic (WCAG 3.1.2).
           */}
          <h1
            className="text-3xl font-semibold tracking-tight"
            lang={label.locale}
            dir={directionOf(label.locale)}
          >
            {label.title}
          </h1>

          {label.description === '' ? null : (
            <p lang={label.locale} dir={directionOf(label.locale)}>
              {label.description}
            </p>
          )}

          {/*
           * THE DISTINCTION DOMAIN_MODEL.md §10.1 EXISTS TO PROTECT, said on the
           * page rather than only in a document. The title above is this
           * platform's descriptive metadata; it is not a claim that a translated
           * Edition exists. The Editions below are where translation is a fact.
           */}
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('metadataNotice')}
          </p>
        </Prose>

        <Contributors work={record} people={references.people} locale={locale} t={t} />

        {record.topicIds.length === 0 ? null : (
          <section className="flex flex-col gap-3">
            <SectionHeading>{t('topics')}</SectionHeading>
            <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {record.topicIds.map((topicId) => {
                const topic = references.topics.get(topicId);
                if (topic === undefined) return null;
                return (
                  <li key={topicId}>
                    {/*
                     * A FILTERED LIBRARY BROWSE, not a Topic page. Taxonomy owns
                     * the canonical `/topics/{slug}` address and no phase has
                     * delivered it yet; linking to it would be dead navigation
                     * (ROUTE_MAP.md §5.2), and inventing a Topic page here would
                     * be Library publishing another context's resource (§33).
                     */}
                    <TextLink
                      href={`/${locale}/library/books?topic=${encodeURIComponent(topicId)}`}
                    >
                      {topic.name}
                    </TextLink>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

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
      </div>
    </Container>
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
    <section className="flex flex-col gap-3">
      <SectionHeading>{t('contributors')}</SectionHeading>
      <ul className="flex flex-col gap-1 text-sm">
        {rows.map((row) => (
          <li key={`${row.person.slug}-${row.role}`}>
            <TextLink href={`/${locale}/people/${encodeURIComponent(row.person.slug)}`}>
              {row.person.name}
            </TextLink>
            <span className="text-[color:var(--color-foreground-muted)]">
              {' · '}
              {t(`role.${row.role}` as 'role.author')}
            </span>
          </li>
        ))}
      </ul>
    </section>
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
    <section className="flex flex-col gap-4">
      <SectionHeading>{t('editions')}</SectionHeading>

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
            <Panel key={edition.id} as="li">
              <div className="flex flex-col gap-3">
                <div className="flex flex-wrap items-baseline gap-3">
                  <h3 className="text-base font-semibold">{edition.label}</h3>
                  {isSelected ? (
                    <StatusBadge tone="positive">{t('selectedEdition')}</StatusBadge>
                  ) : (
                    <TextLink
                      href={`${workPath(locale, record.slug)}?${EDITION_PARAM}=${encodeURIComponent(edition.id)}`}
                    >
                      {t('showEdition')}
                    </TextLink>
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
              </div>
            </Panel>
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
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <SectionHeading>{t('availability')}</SectionHeading>

        <ul className="flex flex-col gap-2 text-sm">
          {access.downloadable === null ? (
            <li className="text-[color:var(--color-foreground-muted)]">
              {t('downloadUnavailable')}
            </li>
          ) : (
            <li>
              <TextLink href={assetPath(edition.id, 'download', access.downloadable)}>
                {t('downloadFile')}
              </TextLink>
              {/*
               * The format is stated in the link's own text rather than left to
               * an icon: "no colour-only semantics" applies to shape too, and a
               * described link is what §23 asks for.
               */}
            </li>
          )}
        </ul>
      </div>

      {access.unavailable ? <Alert tone="info">{t('editionUnavailable')}</Alert> : null}

      {access.readableFile === null ? null : (
        <div className="flex flex-col gap-2">
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('readableFileNotice')}
          </p>
          <TextLink href={assetPath(edition.id, 'read', access.readableFile)}>
            {t('openFile')}
          </TextLink>
        </div>
      )}

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
    <section className="flex flex-col gap-3">
      <SectionHeading>{t('salePoints')}</SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('salePointsNotice')}
      </p>
      <ul className="flex flex-col gap-3">
        {record.salePoints.map((point) => (
          <Panel key={point.id} as="li">
            <div className="flex flex-col gap-1 text-sm">
              <p className="font-medium" dir="auto">
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
                  <TextLink href={point.url}>{point.url}</TextLink>
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
