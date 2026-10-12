import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  HADITH_LIMITS,
  HADITH_NAME_LOCALES,
  HADITH_PAGE,
  HADITH_RESERVED_SLUGS,
  type HadithActor,
  type HadithBookRecord,
  type HadithChapterRecord,
  type HadithCollectionNameRecord,
  type HadithCollectionRecord,
  type HadithSourceAuthority,
  type HadithStructureNameRecord,
} from '@minhaj/contracts/hadith';
import type { LanguageView } from '@minhaj/contracts/taxonomy';

import { requireAdminPage } from '@/composition/authorization';
import { hadithRuntime } from '@/composition/hadith';
import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  DetailRow,
  EmptyState,
  Field,
  FilterLink,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  StatusBadge,
  TextInput,
  TextLink,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { pageOffset, queryValue } from '../shared';
import {
  createHadithBook,
  createHadithChapter,
  createHadithCollection,
  saveHadithCollectionNames,
  saveHadithStructureNames,
} from './actions';
import {
  actorOf,
  AuthorityBadge,
  CanonicalStepUp,
  ConfirmField,
  everyPage,
  ExactText,
  hadithCopy,
  LanguageSelect,
  languageIndex,
  languageText,
  Pager,
  queryId,
  recordTarget,
  SlugField,
  withQuery,
  type Copy,
  type EditorParams,
  type ListParams,
} from './shared';

/**
 * The structure screens — collections, books and chapters (ROUTE_MAP.md §7:
 * `/admin/hadith/{collections|books|chapters}`), Phase 19.
 *
 * STRUCTURE IS SOURCED AND FIXED. A collection's slug and position, and a
 * book's or chapter's edition, slug, source reference, position and sourced
 * title are created through the canonical flow — `hadith.editCanonical` with a
 * step-up grant for `hadith-canonical-edit` and an explicit confirmation — and
 * have no edit path at all afterwards. Only the DISPLAY NAMES shown to readers
 * are edited here, under `hadith.administer`.
 *
 * SOURCES ARE THE OPERATOR'S. Registered source systems, editions and a
 * collection's activation are shown as evidence and cannot be created or
 * changed on any screen: the owner/operator registers them on the host.
 */

/* ===========================================================================
 * Shared
 * ========================================================================= */

/** A collection by its display name in this locale, falling back to its slug. */
function collectionText(
  collection: {
    readonly slug: string;
    readonly names: readonly HadithCollectionNameRecord[];
  },
  locale: Locale,
): string {
  return (
    collection.names.find((entry) => entry.locale === locale)?.name ?? collection.slug
  );
}

/** A book or chapter as one line: its slug and the source's own reference. */
function structureText(structure: { readonly slug: string; readonly reference: string }) {
  return `${structure.slug} — ${structure.reference}`;
}

function ActivationBadge({
  activation,
  copy,
}: {
  readonly activation: HadithSourceAuthority | null;
  readonly copy: Copy;
}) {
  if (activation === null)
    return <StatusBadge tone="neutral">{copy.t('activation.none')}</StatusBadge>;
  return (
    <StatusBadge tone={activation === 'approved' ? 'positive' : 'caution'}>
      {copy.t(`activation.${activation}`)}
    </StatusBadge>
  );
}

/** A sourced title exactly as stored, in its declared language — or "none". */
function SourcedTitle({
  title,
  language,
  copy,
}: {
  readonly title: string | null;
  readonly language: string | null;
  readonly copy: Copy;
}) {
  return title === null ? (
    <span>{copy.t('none')}</span>
  ) : (
    <ExactText text={title} language={language} as="span" />
  );
}

/** The entry into a canonical creation: a link until the operator begins on purpose. */
function CanonicalEntry({
  href,
  title,
  intro,
  copy,
}: {
  readonly href: string;
  readonly title: string;
  readonly intro: string;
  readonly copy: Copy;
}) {
  return (
    <Panel>
      <section className="flex flex-col gap-3" aria-labelledby="create">
        <SectionHeading>
          <span id="create">{title}</span>
        </SectionHeading>
        <p className="text-sm">{intro}</p>
        <p className="text-sm">
          <TextLink href={href}>{copy.t('canonical.begin')}</TextLink>
        </p>
      </section>
    </Panel>
  );
}

/** The opened canonical creation: warning, the step-up prompt, then the form. */
function CanonicalSection({
  locale,
  title,
  leave,
  copy,
  children,
}: {
  readonly locale: Locale;
  readonly title: string;
  readonly leave: string;
  readonly copy: Copy;
  readonly children: React.ReactNode;
}) {
  const { t } = copy;
  return (
    <section className="flex flex-col gap-6" aria-labelledby="create">
      <div className="flex flex-col gap-2">
        <SectionHeading>
          <span id="create">{title}</span>
        </SectionHeading>
        <Alert tone="warning">{t('canonical.warning')}</Alert>
        <p className="text-sm">
          <TextLink href={leave}>{t('canonical.leave')}</TextLink>
        </p>
      </div>
      <CanonicalStepUp locale={locale} />
      <Panel>{children}</Panel>
    </section>
  );
}

/** The fields a new book or chapter shares: slug, the source's reference, position and title. */
function StructureFields({
  prefix,
  languages,
  copy,
}: {
  readonly prefix: string;
  readonly languages: ReadonlyMap<string, LanguageView>;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <>
      <SlugField prefix={prefix} slug={null} copy={copy} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${prefix}-reference`}
          label={t('structure.reference')}
          help={t('structure.referenceHelp')}
        >
          {(props) => (
            <TextInput
              {...props}
              name="reference"
              required
              maxLength={64}
              dir="auto"
              spellCheck={false}
              autoComplete="off"
            />
          )}
        </Field>
        <Field
          id={`${prefix}-position`}
          label={t('position')}
          help={t('structure.positionHelp')}
        >
          {(props) => (
            <TextInput
              {...props}
              name="position"
              type="number"
              required
              min={0}
              max={HADITH_LIMITS.position}
              inputMode="numeric"
            />
          )}
        </Field>
      </div>
      <Field
        id={`${prefix}-title`}
        label={t('structure.sourcedTitle')}
        help={t('structure.titleHelp')}
      >
        {(props) => (
          <TextInput
            {...props}
            name="title"
            maxLength={HADITH_LIMITS.title}
            dir="auto"
            spellCheck={false}
            autoComplete="off"
          />
        )}
      </Field>
      <LanguageSelect
        id={`${prefix}-title-language`}
        name="titleLanguage"
        label={t('structure.titleLanguage')}
        help={t('structure.titleLanguageHelp')}
        languages={languages}
        selected={null}
        optional
        copy={copy}
      />
    </>
  );
}

/* ===========================================================================
 * Display names
 * ========================================================================= */

/**
 * The display names shown to readers, one per interface locale. Presentation,
 * not identity: a name never changes a slug, a reference or a citation.
 */
function NamesSection({
  kind,
  locale,
  record,
  names,
  administer,
  copy,
}: {
  readonly kind: 'collection' | 'book' | 'chapter';
  readonly locale: Locale;
  readonly record: { readonly id: string; readonly namesVersion: number };
  readonly names: readonly (HadithStructureNameRecord & {
    readonly description?: string | null;
  })[];
  readonly administer: boolean;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const byLocale = new Map(names.map((entry) => [entry.locale, entry]));
  return (
    <Panel>
      <section className="flex flex-col gap-4" aria-labelledby="names">
        <SectionHeading>
          <span id="names">{t('names.title')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('names.help')}
        </p>
        {administer ? (
          <ActionForm
            action={
              kind === 'collection' ? saveHadithCollectionNames : saveHadithStructureNames
            }
            submitLabel={t('save')}
            pendingLabel={t('pending')}
            messages={copy.messages}
            preserveInput
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="id" value={record.id} />
            <input type="hidden" name="version" value={String(record.namesVersion)} />
            {kind === 'collection' ? null : (
              <input type="hidden" name="kind" value={kind} />
            )}
            {HADITH_NAME_LOCALES.map((language) => (
              <div key={language} className="flex flex-col gap-3">
                <Field
                  id={`name-${language}`}
                  label={t('nameIn', { language: t(`language.${language}`) })}
                >
                  {(props) => (
                    <TextInput
                      {...props}
                      name={`name-${language}`}
                      defaultValue={byLocale.get(language)?.name ?? ''}
                      maxLength={HADITH_LIMITS.name}
                      lang={language}
                      dir={directionOf(language)}
                    />
                  )}
                </Field>
                {kind === 'collection' ? (
                  <Field
                    id={`description-${language}`}
                    label={t('descriptionIn', { language: t(`language.${language}`) })}
                  >
                    {(props) => (
                      <TextInput
                        {...props}
                        name={`description-${language}`}
                        defaultValue={byLocale.get(language)?.description ?? ''}
                        maxLength={HADITH_LIMITS.description}
                        lang={language}
                        dir={directionOf(language)}
                      />
                    )}
                  </Field>
                ) : null}
              </div>
            ))}
          </ActionForm>
        ) : (
          <dl className="flex flex-col">
            {HADITH_NAME_LOCALES.map((language) => {
              const entry = byLocale.get(language);
              return (
                <DetailRow key={language} term={t(`language.${language}`)}>
                  {entry === undefined ? (
                    t('none')
                  ) : (
                    <span lang={language} dir={directionOf(language)}>
                      {entry.name}
                      {entry.description === null || entry.description === undefined
                        ? null
                        : ` — ${entry.description}`}
                    </span>
                  )}
                </DetailRow>
              );
            })}
          </dl>
        )}
      </section>
    </Panel>
  );
}

/* ===========================================================================
 * Collections
 * ========================================================================= */

export async function CollectionsScreen({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/hadith/collections`;
  const context = await requireAdminPage(locale, 'hadith.read', base);
  const copy = await hadithCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const canonical = context.authorization.can('hadith.editCanonical');
  const offset = pageOffset(query, HADITH_PAGE);
  const creating = canonical && queryValue(query, 'create') === '1';

  const page = await hadithRuntime().hadith.collections(actor, offset);

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.collections')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scope.collections')}
      </p>

      {page.items.length === 0 ? (
        <EmptyState>{t('collections.empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('surface.collections')}
          columns={[
            t('slug'),
            t('collections.displayName'),
            t('position'),
            t('activation.title'),
            t('collections.editions'),
          ]}
        >
          {page.items.map((collection) => (
            <DataRow key={collection.id}>
              <DataCell wrap>
                <TextLink href={`${base}/${collection.id}`}>
                  <span dir="ltr">{collection.slug}</span>
                </TextLink>
              </DataCell>
              <DataCell wrap>
                <span dir="auto">{collectionText(collection, locale)}</span>
              </DataCell>
              <DataCell>{collection.position}</DataCell>
              <DataCell>
                <ActivationBadge activation={collection.activation} copy={copy} />
              </DataCell>
              <DataCell>{collection.editions.length}</DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
      <Pager
        offset={offset}
        total={page.total}
        hrefFor={(number) => (number > 1 ? `${base}?page=${String(number)}` : base)}
        label={t('surface.collections')}
        copy={copy}
      />

      {!canonical ? null : !creating ? (
        <CanonicalEntry
          href={`${base}?create=1#create`}
          title={t('collections.create')}
          intro={t('collections.createHelp')}
          copy={copy}
        />
      ) : (
        <CanonicalSection
          locale={locale}
          title={t('collections.create')}
          leave={base}
          copy={copy}
        >
          <ActionForm
            action={createHadithCollection}
            submitLabel={t('createSubmit')}
            pendingLabel={t('pending')}
            messages={copy.messages}
            preserveInput
          >
            <input type="hidden" name="locale" value={locale} />
            <SlugField
              prefix="new-collection"
              slug={null}
              help={t('collections.slugHelp', {
                reserved: HADITH_RESERVED_SLUGS.join(', '),
              })}
              copy={copy}
            />
            <Field
              id="new-collection-position"
              label={t('position')}
              help={t('collections.positionHelp')}
            >
              {(props) => (
                <TextInput
                  {...props}
                  name="position"
                  type="number"
                  required
                  min={0}
                  max={HADITH_LIMITS.collectionPosition}
                  inputMode="numeric"
                />
              )}
            </Field>
            <ConfirmField id="new-collection-confirm" label={t('collections.confirm')} />
          </ActionForm>
        </CanonicalSection>
      )}
    </main>
  );
}

export async function CollectionScreen({ params }: EditorParams) {
  const locale = await requireLocale(params);
  const id = recordTarget((await params).id);
  const list = `/${locale}/admin/hadith/collections`;
  const context = await requireAdminPage(locale, 'hadith.read', `${list}/${id}`);
  const copy = await hadithCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const administer = context.authorization.can('hadith.administer');

  const collection = await hadithRuntime().hadith.collection(actor, id);
  if (collection === null) notFound();

  return (
    <main className="flex flex-col gap-8">
      <p className="text-sm">
        <TextLink href={list}>{t('backToList')}</TextLink>
      </p>
      <PageHeading>
        <span dir="auto">{collectionText(collection, locale)}</span>
      </PageHeading>

      <Panel>
        <section className="flex flex-col gap-4" aria-labelledby="collection-facts">
          <SectionHeading>
            <span id="collection-facts">{t('details')}</span>
          </SectionHeading>
          <dl className="flex flex-col">
            <DetailRow term={t('slug')}>
              <span dir="ltr">{collection.slug}</span>
            </DetailRow>
            <DetailRow term={t('position')}>{collection.position}</DetailRow>
            <DetailRow term={t('activation.title')}>
              <ActivationBadge activation={collection.activation} copy={copy} />
            </DetailRow>
          </dl>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('collections.fixed')}
          </p>
          <p className="flex flex-wrap gap-4 text-sm">
            <TextLink
              href={withQuery(`/${locale}/admin/hadith/books`, { collection: id })}
            >
              {t('collections.books')}
            </TextLink>
            <TextLink
              href={withQuery(`/${locale}/admin/hadith/records`, { collection: id })}
            >
              {t('collections.records')}
            </TextLink>
          </p>
        </section>
      </Panel>

      <EditionsSection collection={collection} copy={copy} />

      <NamesSection
        kind="collection"
        locale={locale}
        record={collection}
        names={collection.names}
        administer={administer}
        copy={copy}
      />
    </main>
  );
}

/** The registered editions: evidence only — the operator registers them. */
function EditionsSection({
  collection,
  copy,
}: {
  readonly collection: HadithCollectionRecord;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <section className="flex flex-col gap-4" aria-labelledby="editions">
      <SectionHeading>
        <span id="editions">{t('editions.title')}</span>
      </SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('editions.operatorOnly')}
      </p>
      {collection.editions.length === 0 ? (
        <EmptyState>{t('editions.empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('editions.title')}
          columns={[
            t('editions.code'),
            t('editions.titleColumn'),
            t('editions.sourceSystem'),
            t('editions.authority'),
            t('editions.reference'),
          ]}
        >
          {collection.editions.map((edition) => (
            <DataRow key={edition.id}>
              <DataCell wrap>
                <span dir="ltr">{edition.code}</span>
              </DataCell>
              <DataCell wrap>
                <span dir="auto">{edition.title}</span>
              </DataCell>
              <DataCell wrap>
                <span dir="auto">{edition.sourceSystemTitle}</span>{' '}
                <span dir="ltr" className="text-xs">
                  ({edition.sourceSystemCode})
                </span>
              </DataCell>
              <DataCell>
                <AuthorityBadge authority={edition.authority} copy={copy} />
              </DataCell>
              <DataCell wrap>
                {edition.reference === null ? (
                  t('none')
                ) : (
                  <span dir="auto">{edition.reference}</span>
                )}
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
    </section>
  );
}

/* ===========================================================================
 * Books
 * ========================================================================= */

async function collectionChoices(actor: HadithActor) {
  return everyPage((offset) => hadithRuntime().hadith.collections(actor, offset));
}

export async function BooksScreen({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/hadith/books`;
  const context = await requireAdminPage(locale, 'hadith.read', base);
  const copy = await hadithCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const canonical = context.authorization.can('hadith.editCanonical');
  const offset = pageOffset(query, HADITH_PAGE);
  const service = hadithRuntime().hadith;

  const [collections, chosen] = await Promise.all([
    collectionChoices(actor),
    (async () => {
      const id = queryId(query, 'collection');
      return id === null ? null : service.collection(actor, id);
    })(),
  ]);
  const [page, languages] = await Promise.all([
    service.books(actor, chosen?.id ?? null, offset),
    canonical ? languageIndex() : Promise.resolve(new Map<string, LanguageView>()),
  ]);
  const creating = canonical && chosen !== null && queryValue(query, 'create') === '1';
  const here = withQuery(base, { collection: chosen?.id });

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.books')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scope.books')}
      </p>

      <nav className="flex flex-wrap gap-2" aria-label={t('filter.collection')}>
        <FilterLink href={base} current={chosen === null}>
          {t('filter.allCollections')}
        </FilterLink>
        {collections.items.map((collection) => (
          <FilterLink
            key={collection.id}
            href={withQuery(base, { collection: collection.id })}
            current={chosen?.id === collection.id}
          >
            <span dir="auto">{collectionText(collection, locale)}</span>
          </FilterLink>
        ))}
      </nav>

      {page.items.length === 0 ? (
        <EmptyState>{t('books.empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('surface.books')}
          columns={[
            t('slug'),
            t('structure.collection'),
            t('structure.edition'),
            t('structure.reference'),
            t('position'),
            t('structure.sourcedTitle'),
          ]}
        >
          {page.items.map((book) => (
            <DataRow key={book.id}>
              <DataCell wrap>
                <TextLink href={`${base}/${book.id}`}>
                  <span dir="ltr">{book.slug}</span>
                </TextLink>
              </DataCell>
              <DataCell wrap>
                <span dir="ltr">{book.collectionSlug}</span>
              </DataCell>
              <DataCell wrap>
                <span dir="ltr">{book.editionCode}</span>
              </DataCell>
              <DataCell wrap>
                <span dir="auto">{book.reference}</span>
              </DataCell>
              <DataCell>{book.position}</DataCell>
              <DataCell wrap>
                <SourcedTitle
                  title={book.title}
                  language={book.titleLanguage}
                  copy={copy}
                />
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
      <Pager
        offset={offset}
        total={page.total}
        hrefFor={(number) =>
          withQuery(base, {
            collection: chosen?.id,
            page: number > 1 ? String(number) : null,
          })
        }
        label={t('surface.books')}
        copy={copy}
      />

      {!canonical ? null : chosen === null ? (
        <Alert tone="info">{t('books.chooseCollection')}</Alert>
      ) : !creating ? (
        <CanonicalEntry
          href={`${withQuery(base, { collection: chosen.id, create: '1' })}#create`}
          title={t('books.create', { collection: collectionText(chosen, locale) })}
          intro={t('books.createHelp')}
          copy={copy}
        />
      ) : (
        <CanonicalSection
          locale={locale}
          title={t('books.create', { collection: collectionText(chosen, locale) })}
          leave={here}
          copy={copy}
        >
          {chosen.editions.length === 0 ? (
            <EmptyState>{t('editions.empty')}</EmptyState>
          ) : (
            <ActionForm
              action={createHadithBook}
              submitLabel={t('createSubmit')}
              pendingLabel={t('pending')}
              messages={copy.messages}
              preserveInput
            >
              <input type="hidden" name="locale" value={locale} />
              <Field
                id="new-book-edition"
                label={t('structure.edition')}
                help={t('books.editionHelp')}
              >
                {(props) => (
                  <Select {...props} name="editionId" required defaultValue="">
                    <option value="">{t('books.chooseEdition')}</option>
                    {chosen.editions.map((edition) => (
                      <option key={edition.id} value={edition.id}>
                        {`${edition.code} — ${edition.title} (${edition.sourceSystemCode}, ${t(
                          `authority.${edition.authority}`,
                        )})`}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <StructureFields prefix="new-book" languages={languages} copy={copy} />
              <ConfirmField id="new-book-confirm" label={t('structure.confirm')} />
            </ActionForm>
          )}
        </CanonicalSection>
      )}
    </main>
  );
}

export async function BookScreen({ params }: EditorParams) {
  const locale = await requireLocale(params);
  const id = recordTarget((await params).id);
  const list = `/${locale}/admin/hadith/books`;
  const context = await requireAdminPage(locale, 'hadith.read', `${list}/${id}`);
  const copy = await hadithCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const administer = context.authorization.can('hadith.administer');
  const canonical = context.authorization.can('hadith.editCanonical');

  const book = await hadithRuntime().hadith.book(actor, id);
  if (book === null) notFound();
  const languages = await languageIndex();

  return (
    <main className="flex flex-col gap-8">
      <p className="text-sm">
        <TextLink href={withQuery(list, { collection: book.collectionId })}>
          {t('backToList')}
        </TextLink>
      </p>
      <PageHeading>
        <span dir="auto">{structureText(book)}</span>
      </PageHeading>

      <StructureFacts structure={book} languages={languages} copy={copy}>
        <DetailRow term={t('structure.collection')}>
          <TextLink href={`/${locale}/admin/hadith/collections/${book.collectionId}`}>
            <span dir="ltr">{book.collectionSlug}</span>
          </TextLink>
        </DetailRow>
        <DetailRow term={t('structure.edition')}>
          <span dir="ltr">{book.editionCode}</span>
        </DetailRow>
      </StructureFacts>

      <p className="flex flex-wrap gap-4 text-sm">
        <TextLink href={withQuery(`/${locale}/admin/hadith/chapters`, { book: book.id })}>
          {t('books.chapters')}
        </TextLink>
        {canonical ? (
          <>
            <TextLink
              href={`${withQuery(`/${locale}/admin/hadith/chapters`, { book: book.id, create: '1' })}#create`}
            >
              {t('books.addChapter')}
            </TextLink>
            <TextLink
              href={`${withQuery(`/${locale}/admin/hadith/records`, { create: '1', book: book.id })}#create`}
            >
              {t('structure.addRecord')}
            </TextLink>
          </>
        ) : null}
      </p>

      <NamesSection
        kind="book"
        locale={locale}
        record={book}
        names={book.names}
        administer={administer}
        copy={copy}
      />
    </main>
  );
}

/** A book's or chapter's sourced facts, read-only, with any facts the caller adds first. */
function StructureFacts({
  structure,
  languages,
  copy,
  children,
}: {
  readonly structure: HadithBookRecord | HadithChapterRecord;
  readonly languages: ReadonlyMap<string, LanguageView>;
  readonly copy: Copy;
  readonly children: React.ReactNode;
}) {
  const { t } = copy;
  return (
    <Panel>
      <section className="flex flex-col gap-4" aria-labelledby="structure-facts">
        <SectionHeading>
          <span id="structure-facts">{t('details')}</span>
        </SectionHeading>
        <dl className="flex flex-col">
          {children}
          <DetailRow term={t('slug')}>
            <span dir="ltr">{structure.slug}</span>
          </DetailRow>
          <DetailRow term={t('structure.reference')}>
            <span dir="auto">{structure.reference}</span>
          </DetailRow>
          <DetailRow term={t('position')}>{structure.position}</DetailRow>
          <DetailRow term={t('structure.sourcedTitle')}>
            <SourcedTitle
              title={structure.title}
              language={structure.titleLanguage}
              copy={copy}
            />
          </DetailRow>
          <DetailRow term={t('structure.titleLanguage')}>
            {structure.titleLanguage === null
              ? t('none')
              : languageText(structure.titleLanguage, languages)}
          </DetailRow>
        </dl>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('structure.readOnly')}
        </p>
      </section>
    </Panel>
  );
}

/* ===========================================================================
 * Chapters
 * ========================================================================= */

export async function ChaptersScreen({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/hadith/chapters`;
  const context = await requireAdminPage(locale, 'hadith.read', base);
  const copy = await hadithCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const canonical = context.authorization.can('hadith.editCanonical');
  const offset = pageOffset(query, HADITH_PAGE);
  const service = hadithRuntime().hadith;

  const bookId = queryId(query, 'book');
  const book = bookId === null ? null : await service.book(actor, bookId);
  const [page, languages] = await Promise.all([
    service.chapters(actor, book?.id ?? null, offset),
    canonical ? languageIndex() : Promise.resolve(new Map<string, LanguageView>()),
  ]);
  // Unfiltered, each row names its book; the page holds at most one listing
  // page of distinct books, each read once.
  const books =
    book !== null
      ? new Map([[book.id, book]])
      : new Map(
          (
            await Promise.all(
              [...new Set(page.items.map((chapter) => chapter.bookId))].map((id) =>
                service.book(actor, id),
              ),
            )
          )
            .filter((entry): entry is HadithBookRecord => entry !== null)
            .map((entry) => [entry.id, entry]),
        );
  const creating = canonical && book !== null && queryValue(query, 'create') === '1';
  const here = withQuery(base, { book: book?.id });

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.chapters')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scope.chapters')}
      </p>

      {book === null ? (
        <p className="text-sm">
          {t('chapters.chooseBook')}{' '}
          <TextLink href={`/${locale}/admin/hadith/books`}>{t('surface.books')}</TextLink>
        </p>
      ) : (
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            {t('structure.book')}:{' '}
            <TextLink href={`/${locale}/admin/hadith/books/${book.id}`}>
              <span dir="auto">{structureText(book)}</span>
            </TextLink>
          </span>
          <TextLink href={base}>{t('chapters.allBooks')}</TextLink>
        </p>
      )}

      {page.items.length === 0 ? (
        <EmptyState>{t('chapters.empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('surface.chapters')}
          columns={[
            t('slug'),
            t('structure.book'),
            t('structure.reference'),
            t('position'),
            t('structure.sourcedTitle'),
          ]}
        >
          {page.items.map((chapter) => {
            const owner = books.get(chapter.bookId);
            return (
              <DataRow key={chapter.id}>
                <DataCell wrap>
                  <TextLink href={`${base}/${chapter.id}`}>
                    <span dir="ltr">{chapter.slug}</span>
                  </TextLink>
                </DataCell>
                <DataCell wrap>
                  {owner === undefined ? (
                    t('unavailableReference')
                  ) : (
                    <span dir="auto">
                      {owner.collectionSlug} · {structureText(owner)}
                    </span>
                  )}
                </DataCell>
                <DataCell wrap>
                  <span dir="auto">{chapter.reference}</span>
                </DataCell>
                <DataCell>{chapter.position}</DataCell>
                <DataCell wrap>
                  <SourcedTitle
                    title={chapter.title}
                    language={chapter.titleLanguage}
                    copy={copy}
                  />
                </DataCell>
              </DataRow>
            );
          })}
        </DataTable>
      )}
      <Pager
        offset={offset}
        total={page.total}
        hrefFor={(number) =>
          withQuery(base, { book: book?.id, page: number > 1 ? String(number) : null })
        }
        label={t('surface.chapters')}
        copy={copy}
      />

      {!canonical || book === null ? null : !creating ? (
        <CanonicalEntry
          href={`${withQuery(base, { book: book.id, create: '1' })}#create`}
          title={t('chapters.create', { book: structureText(book) })}
          intro={t('chapters.createHelp')}
          copy={copy}
        />
      ) : (
        <CanonicalSection
          locale={locale}
          title={t('chapters.create', { book: structureText(book) })}
          leave={here}
          copy={copy}
        >
          <ActionForm
            action={createHadithChapter}
            submitLabel={t('createSubmit')}
            pendingLabel={t('pending')}
            messages={copy.messages}
            preserveInput
          >
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="bookId" value={book.id} />
            <StructureFields prefix="new-chapter" languages={languages} copy={copy} />
            <ConfirmField id="new-chapter-confirm" label={t('structure.confirm')} />
          </ActionForm>
        </CanonicalSection>
      )}
    </main>
  );
}

export async function ChapterScreen({ params }: EditorParams) {
  const locale = await requireLocale(params);
  const id = recordTarget((await params).id);
  const list = `/${locale}/admin/hadith/chapters`;
  const context = await requireAdminPage(locale, 'hadith.read', `${list}/${id}`);
  const copy = await hadithCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const administer = context.authorization.can('hadith.administer');
  const canonical = context.authorization.can('hadith.editCanonical');
  const service = hadithRuntime().hadith;

  const chapter = await service.chapter(actor, id);
  if (chapter === null) notFound();
  const [book, languages] = await Promise.all([
    service.book(actor, chapter.bookId),
    languageIndex(),
  ]);

  return (
    <main className="flex flex-col gap-8">
      <p className="text-sm">
        <TextLink href={withQuery(list, { book: chapter.bookId })}>
          {t('backToList')}
        </TextLink>
      </p>
      <PageHeading>
        <span dir="auto">{structureText(chapter)}</span>
      </PageHeading>

      <StructureFacts structure={chapter} languages={languages} copy={copy}>
        <DetailRow term={t('structure.book')}>
          {book === null ? (
            t('unavailableReference')
          ) : (
            <TextLink href={`/${locale}/admin/hadith/books/${book.id}`}>
              <span dir="auto">
                {book.collectionSlug} · {book.editionCode} · {structureText(book)}
              </span>
            </TextLink>
          )}
        </DetailRow>
      </StructureFacts>

      {canonical ? (
        <p className="text-sm">
          <TextLink
            href={`${withQuery(`/${locale}/admin/hadith/records`, {
              create: '1',
              book: chapter.bookId,
              chapter: chapter.id,
            })}#create`}
          >
            {t('structure.addRecord')}
          </TextLink>
        </p>
      ) : null}

      <NamesSection
        kind="chapter"
        locale={locale}
        record={chapter}
        names={chapter.names}
        administer={administer}
        copy={copy}
      />
    </main>
  );
}
