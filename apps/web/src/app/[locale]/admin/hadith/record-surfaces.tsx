import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  HADITH_LIMITS,
  HADITH_NUMBER_MAX,
  HADITH_PAGE,
  HADITH_RECORD_FILTERS,
  HADITH_TRANSLATION_ROLES,
  type HadithActor,
  type HadithBookRecord,
  type HadithChapterRecord,
  type HadithRecordDetail,
  type HadithRecordFilter,
  type HadithSourceSystemRecord,
  type HadithTranslationRecord,
} from '@minhaj/contracts/hadith';
import type { LanguageView } from '@minhaj/contracts/taxonomy';

import { requireAdminPage } from '@/composition/authorization';
import { hadithRuntime } from '@/composition/hadith';
import { taxonomyRuntime } from '@/composition/taxonomy';
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
  TextArea,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { pageOffset, queryValue } from '../shared';
import {
  changeHadithTopic,
  correctHadithRecord,
  createHadithRecord,
  saveHadithTranslation,
  setHadithCitation,
  verifyHadithRecord,
} from './actions';
import { ContributorFields, ContributorList } from './contributors';
import {
  actorOf,
  AuthorityBadge,
  CanonicalStepUp,
  ConfirmField,
  DateText,
  EditIdentity,
  everyPage,
  ExactText,
  hadithCopy,
  LanguageSelect,
  languageIndex,
  languageText,
  Pager,
  PeopleSearch,
  peopleChoices,
  queryId,
  recordTarget,
  SourceName,
  SourceSelect,
  StateBadge,
  StateControls,
  SUBMIT_CLASSES,
  withQuery,
  type Copy,
  type EditorParams,
  type ListParams,
  type PersonChoice,
  type Query,
} from './shared';

/**
 * The record screens (ROUTE_MAP.md §7: `/admin/hadith/records`), Phase 19.
 *
 * A RECORD IS SOURCE-QUALIFIED. It is identified by its collection, source
 * system, edition and the source's own reference — never by a bare number —
 * and the public citation it may be mapped to is a separate, reviewed fact.
 * Everything on a record's page is READ-ONLY by default: its original text,
 * chain and gradings exactly as sourced, its immutable revisions, its
 * verifications, its conflict evidence, the other candidates for its citation
 * number and the citation's own history.
 *
 * CANONICAL CHANGES ARE ENTERED ON PURPOSE. Correcting a record, verifying its
 * current version and mapping or withdrawing its citation sit behind
 * `?canonical=1`, which opens the step-up prompt for exactly
 * `hadith-canonical-edit`; each form needs evidence and an explicit
 * confirmation, and the database procedure re-checks the permission and grant.
 *
 * CONFLICTS ARE NEVER RESOLVED HERE. Conflict evidence is immutable and blocks
 * the citation until an external authority decides (OPEN_DECISIONS.md §1.6);
 * no control on any screen clears it or chooses a candidate.
 *
 * LAYERED WORK BESIDE IT. Topics and translations are `hadith.administer`
 * work: their actions cannot reach a sourced fact.
 */

const VIEW_KEYS = {
  all: 'all',
  unverified: 'unverified',
  conflicted: 'conflicted',
  mapped: 'mapped',
} as const satisfies Record<HadithRecordFilter, string>;

function viewOf(query: Query): HadithRecordFilter {
  const raw = queryValue(query, 'view');
  return (HADITH_RECORD_FILTERS as readonly string[]).includes(raw ?? '')
    ? (raw as HadithRecordFilter)
    : 'all';
}

/** A record as one line: where it is from, in the source's own terms. */
function recordText(record: {
  readonly collectionSlug: string;
  readonly editionCode: string;
  readonly sourceReference: string;
}): string {
  return `${record.collectionSlug} · ${record.editionCode} · ${record.sourceReference}`;
}

function structureText(structure: { readonly slug: string; readonly reference: string }) {
  return `${structure.slug} — ${structure.reference}`;
}

function VerifiedBadge({
  verified,
  copy,
}: {
  readonly verified: boolean;
  readonly copy: Copy;
}) {
  return (
    <StatusBadge tone={verified ? 'positive' : 'caution'}>
      {verified ? copy.t('verification.verified') : copy.t('verification.unverified')}
    </StatusBadge>
  );
}

function ConflictBadge({ count, copy }: { readonly count: number; readonly copy: Copy }) {
  return count === 0 ? (
    <span>{copy.t('none')}</span>
  ) : (
    <StatusBadge tone="caution">{copy.t('conflicts.count', { count })}</StatusBadge>
  );
}

/* ===========================================================================
 * Records — the list, narrowed, and the protected creation
 * ========================================================================= */

export async function RecordsScreen({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/hadith/records`;
  const context = await requireAdminPage(locale, 'hadith.read', base);
  const copy = await hadithCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const canonical = context.authorization.can('hadith.editCanonical');
  const service = hadithRuntime().hadith;
  const offset = pageOffset(query, HADITH_PAGE);
  const view = viewOf(query);

  const collections = await everyPage((at) => service.collections(actor, at));
  const collectionId = queryId(query, 'collection');
  const collection =
    collectionId === null
      ? undefined
      : collections.items.find((entry) => entry.id === collectionId);
  const page = await service.records(
    actor,
    { collectionId: collection?.id ?? null, view },
    offset,
  );
  const creating = canonical && queryValue(query, 'create') === '1';
  const filtered = (values: Readonly<Record<string, string | null>>) =>
    withQuery(base, {
      view: view === 'all' ? null : view,
      collection: collection?.id ?? null,
      ...values,
    });

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.records')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scope.records')}
      </p>

      <nav className="flex flex-wrap gap-2" aria-label={t('records.viewLabel')}>
        {HADITH_RECORD_FILTERS.map((entry) => (
          <FilterLink
            key={entry}
            href={filtered({ view: entry === 'all' ? null : entry })}
            current={entry === view}
          >
            {t(`records.view.${VIEW_KEYS[entry]}`)}
          </FilterLink>
        ))}
      </nav>
      {collections.items.length === 0 ? null : (
        <nav className="flex flex-wrap gap-2" aria-label={t('filter.collection')}>
          <FilterLink
            href={filtered({ collection: null })}
            current={collection === undefined}
          >
            {t('filter.allCollections')}
          </FilterLink>
          {collections.items.map((entry) => (
            <FilterLink
              key={entry.id}
              href={filtered({ collection: entry.id })}
              current={collection?.id === entry.id}
            >
              <span dir="ltr">{entry.slug}</span>
            </FilterLink>
          ))}
        </nav>
      )}

      {page.items.length === 0 ? (
        <EmptyState>{t('records.empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('surface.records')}
          columns={[
            t('record.sourceReference'),
            t('structure.collection'),
            t('structure.edition'),
            t('record.sourceSystem'),
            t('record.citationNumber'),
            t('version'),
            t('verification.title'),
            t('conflicts.title'),
            t('citation.title'),
          ]}
        >
          {page.items.map((record) => (
            <DataRow key={record.id}>
              <DataCell wrap>
                <TextLink href={`${base}/${record.id}`}>
                  <span dir="auto">{record.sourceReference}</span>
                </TextLink>
              </DataCell>
              <DataCell wrap>
                <span dir="ltr">{record.collectionSlug}</span>
              </DataCell>
              <DataCell wrap>
                <span dir="ltr">{record.editionCode}</span>
              </DataCell>
              <DataCell wrap>
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span dir="ltr">{record.sourceSystemCode}</span>
                  <AuthorityBadge authority={record.authority} copy={copy} />
                </span>
              </DataCell>
              <DataCell>{record.citationNumber ?? t('none')}</DataCell>
              <DataCell>{record.version}</DataCell>
              <DataCell>
                <VerifiedBadge verified={record.verified} copy={copy} />
              </DataCell>
              <DataCell>
                <ConflictBadge count={record.conflicts} copy={copy} />
              </DataCell>
              <DataCell>
                {record.citation === null
                  ? t('none')
                  : t(`citation.state.${record.citation}`)}
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
      <Pager
        offset={offset}
        total={page.total}
        hrefFor={(number) => filtered({ page: number > 1 ? String(number) : null })}
        label={t('surface.records')}
        copy={copy}
      />

      {!canonical ? null : !creating ? (
        <Panel>
          <section className="flex flex-col gap-3" aria-labelledby="create">
            <SectionHeading>
              <span id="create">{t('records.create')}</span>
            </SectionHeading>
            <p className="text-sm">{t('records.createHelp')}</p>
            <p className="text-sm">
              <TextLink href={`${withQuery(base, { create: '1' })}#create`}>
                {t('canonical.begin')}
              </TextLink>
            </p>
          </section>
        </Panel>
      ) : (
        <RecordCreation
          locale={locale}
          base={base}
          query={query}
          actor={actor}
          collections={collections.items}
          copy={copy}
        />
      )}
    </main>
  );
}

/**
 * The protected creation, in stages without script: choose a collection, then
 * one of its books — the book fixes the edition, because a record lives in its
 * own edition's structure — then enter the record's facts.
 */
async function RecordCreation({
  locale,
  base,
  query,
  actor,
  collections,
  copy,
}: {
  readonly locale: Locale;
  readonly base: string;
  readonly query: Query;
  readonly actor: HadithActor;
  readonly collections: readonly { readonly id: string; readonly slug: string }[];
  readonly copy: Copy;
}) {
  const { t } = copy;
  const service = hadithRuntime().hadith;
  const bookId = queryId(query, 'book');
  const book = bookId === null ? null : await service.book(actor, bookId);
  const collectionId = book?.collectionId ?? queryId(query, 'collection');
  const books =
    book === null && collectionId !== null
      ? await everyPage((at) => service.books(actor, collectionId, at))
      : null;

  let body: ReactNode;
  if (book === null) {
    body = (
      <div className="flex flex-col gap-4">
        <form method="get" action={base} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="create" value="1" />
          <Field id="create-collection" label={t('structure.collection')}>
            {(props) => (
              <Select
                {...props}
                name="collection"
                required
                defaultValue={collectionId ?? ''}
              >
                <option value="">{t('records.chooseCollection')}</option>
                {collections.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.slug}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <button type="submit" className={SUBMIT_CLASSES}>
            {t('records.showBooks')}
          </button>
        </form>
        {books === null ? null : books.items.length === 0 ? (
          <EmptyState>{t('books.empty')}</EmptyState>
        ) : (
          <form method="get" action={base} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="create" value="1" />
            <Field
              id="create-book"
              label={t('structure.book')}
              help={t('records.bookHelp')}
            >
              {(props) => (
                <Select {...props} name="book" required defaultValue="">
                  <option value="">{t('records.chooseBook')}</option>
                  {books.items.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {`${entry.editionCode} · ${structureText(entry)}`}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <button type="submit" className={SUBMIT_CLASSES}>
              {t('records.useBook')}
            </button>
            {books.truncated ? (
              <p className="text-sm">{t('records.choicesTruncated')}</p>
            ) : null}
          </form>
        )}
      </div>
    );
  } else {
    const [chapters, languages] = await Promise.all([
      everyPage((at) => service.chapters(actor, book.id, at)),
      languageIndex(),
    ]);
    const chosenChapter = queryId(query, 'chapter');
    body = (
      <div className="flex flex-col gap-4">
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <span>
            {t('structure.book')}:{' '}
            <span dir="auto">
              {book.collectionSlug} · {book.editionCode} · {structureText(book)}
            </span>
          </span>
          <TextLink
            href={`${withQuery(base, { create: '1', collection: book.collectionId })}#create`}
          >
            {t('records.otherBook')}
          </TextLink>
        </p>
        <RecordForm
          locale={locale}
          book={book}
          chapters={chapters}
          chapterId={chosenChapter}
          record={null}
          languages={languages}
          copy={copy}
        />
      </div>
    );
  }

  return (
    <section className="flex flex-col gap-6" aria-labelledby="create">
      <div className="flex flex-col gap-2">
        <SectionHeading>
          <span id="create">{t('records.create')}</span>
        </SectionHeading>
        <Alert tone="warning">{t('canonical.warning')}</Alert>
        <p className="text-sm">
          <TextLink href={base}>{t('canonical.leave')}</TextLink>
        </p>
      </div>
      <CanonicalStepUp locale={locale} />
      <Panel>{body}</Panel>
    </section>
  );
}

/**
 * Every sourced fact of one version of a record, in one form: placement within
 * the book's own edition, the source reference, the intended citation, the
 * original text and its language, the chain and its language, the gradings,
 * and the evidence. A correction carries the expected version and a reason;
 * both carry an explicit confirmation.
 *
 * PLAIN FIELDS. No rich-text editor, no masking and no trimming in the
 * browser; the direction of each field follows its text.
 */
function RecordForm({
  locale,
  book,
  chapters,
  chapterId,
  record,
  languages,
  copy,
}: {
  readonly locale: Locale;
  readonly book: HadithBookRecord;
  readonly chapters: {
    readonly items: readonly HadithChapterRecord[];
    readonly truncated: boolean;
  };
  /** The chapter preselected; `null` places the record in no chapter. */
  readonly chapterId: string | null;
  /** `null` creates; a record corrects it under its expected version. */
  readonly record: HadithRecordDetail | null;
  readonly languages: ReadonlyMap<string, LanguageView>;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? 'new-record' : 'correct-record';
  const current = record?.gradings ?? [];
  const rows = Math.min(HADITH_LIMITS.gradings, Math.max(2, current.length + 2));
  const ordered = [...current].sort((a, b) => a.position - b.position);

  return (
    <ActionForm
      action={record === null ? createHadithRecord : correctHadithRecord}
      submitLabel={record === null ? t('records.createSubmit') : t('correction.submit')}
      pendingLabel={t('pending')}
      messages={copy.messages}
      tone={record === null ? 'primary' : 'destructive'}
      preserveInput
    >
      {record === null ? (
        <>
          <input type="hidden" name="locale" value={locale} />
          <input type="hidden" name="editionId" value={book.editionId} />
        </>
      ) : (
        <EditIdentity locale={locale} record={record} />
      )}
      <input type="hidden" name="bookId" value={book.id} />

      <Field
        id={`${prefix}-chapter`}
        label={t('structure.chapter')}
        help={t('record.chapterHelp')}
      >
        {(props) => (
          <Select {...props} name="chapterId" defaultValue={chapterId ?? ''}>
            <option value="">{t('record.noChapter')}</option>
            {chapters.items.map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                {structureText(chapter)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      {chapters.truncated ? (
        <p className="text-sm">{t('records.choicesTruncated')}</p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${prefix}-reference`}
          label={t('record.sourceReference')}
          help={t('record.sourceReferenceHelp')}
        >
          {(props) => (
            <TextInput
              {...props}
              name="sourceReference"
              required
              maxLength={64}
              defaultValue={record?.sourceReference ?? ''}
              dir="auto"
              spellCheck={false}
              autoComplete="off"
            />
          )}
        </Field>
        <Field
          id={`${prefix}-citation`}
          label={t('record.citationNumber')}
          help={t('record.citationNumberHelp')}
        >
          {(props) => (
            <TextInput
              {...props}
              name="citationNumber"
              type="number"
              min={1}
              max={HADITH_NUMBER_MAX}
              inputMode="numeric"
              defaultValue={record?.citationNumber ?? ''}
            />
          )}
        </Field>
      </div>

      <Field id={`${prefix}-text`} label={t('record.text')} help={t('exactTextHelp')}>
        {(props) => (
          <TextArea
            {...props}
            name="text"
            required
            rows={10}
            maxLength={HADITH_LIMITS.text}
            defaultValue={record?.text ?? ''}
            {...(record === null ? {} : { lang: record.textLanguage })}
            dir="auto"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        )}
      </Field>
      <LanguageSelect
        id={`${prefix}-text-language`}
        name="textLanguage"
        label={t('record.textLanguage')}
        languages={languages}
        selected={record?.textLanguage ?? null}
        copy={copy}
      />

      <Field
        id={`${prefix}-chain`}
        label={t('record.chain')}
        help={t('record.chainHelp')}
      >
        {(props) => (
          <TextArea
            {...props}
            name="chain"
            rows={4}
            maxLength={HADITH_LIMITS.chain}
            defaultValue={record?.chain ?? ''}
            {...(record?.chainLanguage ? { lang: record.chainLanguage } : {})}
            dir="auto"
            spellCheck={false}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
          />
        )}
      </Field>
      <LanguageSelect
        id={`${prefix}-chain-language`}
        name="chainLanguage"
        label={t('record.chainLanguage')}
        help={t('record.chainLanguageHelp')}
        languages={languages}
        selected={record?.chainLanguage ?? null}
        optional
        copy={copy}
      />

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-semibold">{t('gradings.title')}</legend>
        <p className="text-xs text-[color:var(--color-foreground-muted)]">
          {t('gradings.formHelp', { limit: HADITH_LIMITS.gradings })}
        </p>
        {Array.from({ length: rows }, (_, index) => {
          const grading = ordered[index];
          const row = String(index);
          return (
            <div key={index} className="grid gap-3 sm:grid-cols-2">
              <Field
                id={`${prefix}-grading-grader-${row}`}
                label={t('gradings.graderNumbered', { number: index + 1 })}
              >
                {(props) => (
                  <TextInput
                    {...props}
                    name={`grading-grader-${row}`}
                    maxLength={HADITH_LIMITS.grader}
                    defaultValue={grading?.grader ?? ''}
                    dir="auto"
                    spellCheck={false}
                    autoComplete="off"
                  />
                )}
              </Field>
              <Field
                id={`${prefix}-grading-label-${row}`}
                label={t('gradings.labelNumbered', { number: index + 1 })}
              >
                {(props) => (
                  <TextInput
                    {...props}
                    name={`grading-label-${row}`}
                    maxLength={HADITH_LIMITS.gradingLabel}
                    defaultValue={grading?.label ?? ''}
                    {...(grading === undefined ? {} : { lang: grading.labelLanguage })}
                    dir="auto"
                    spellCheck={false}
                    autoComplete="off"
                  />
                )}
              </Field>
              <LanguageSelect
                id={`${prefix}-grading-language-${row}`}
                name={`grading-language-${row}`}
                label={t('gradings.labelLanguageNumbered', { number: index + 1 })}
                help={t('gradings.labelLanguageHelp')}
                languages={languages}
                selected={grading?.labelLanguage ?? null}
                optional
                copy={copy}
              />
              <Field
                id={`${prefix}-grading-reference-${row}`}
                label={t('gradings.referenceNumbered', { number: index + 1 })}
              >
                {(props) => (
                  <TextInput
                    {...props}
                    name={`grading-reference-${row}`}
                    maxLength={HADITH_LIMITS.gradingReference}
                    defaultValue={grading?.reference ?? ''}
                    dir="auto"
                  />
                )}
              </Field>
            </div>
          );
        })}
      </fieldset>

      <Field
        id={`${prefix}-evidence`}
        label={t('evidence.label')}
        help={t('evidence.help')}
      >
        {(props) => (
          <TextInput
            {...props}
            name="evidence"
            required
            maxLength={HADITH_LIMITS.evidence}
            dir="auto"
          />
        )}
      </Field>
      {record === null ? null : (
        <Field id={`${prefix}-reason`} label={t('reason.label')} help={t('reason.help')}>
          {(props) => (
            <TextInput
              {...props}
              name="reason"
              required
              maxLength={HADITH_LIMITS.reason}
              dir="auto"
            />
          )}
        </Field>
      )}
      <ConfirmField
        id={`${prefix}-confirm`}
        label={record === null ? t('records.confirm') : t('correction.confirm')}
      />
    </ActionForm>
  );
}

/* ===========================================================================
 * One record
 * ========================================================================= */

export async function RecordScreen({ params, searchParams }: EditorParams) {
  const locale = await requireLocale(params);
  const id = recordTarget((await params).id);
  const query = await searchParams;
  const list = `/${locale}/admin/hadith/records`;
  const base = `${list}/${id}`;
  const context = await requireAdminPage(locale, 'hadith.read', base);
  const copy = await hadithCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const service = hadithRuntime().hadith;

  const record = await service.record(actor, id);
  if (record === null) notFound();

  const administer = context.authorization.can('hadith.administer');
  const canonical = context.authorization.can('hadith.editCanonical');
  const [sources, languages, translations, assigned, tree] = await Promise.all([
    service.sourceSystems(actor),
    languageIndex(),
    service.translations(actor, record.id),
    taxonomyRuntime().taxonomy.topicReferences(record.topicIds, locale),
    administer
      ? taxonomyRuntime().taxonomy.listTree({ locale, includeArchived: false })
      : Promise.resolve([]),
  ]);
  const source = sources.find((entry) => entry.code === record.sourceSystemCode);
  const candidates = new Map(record.candidates.map((entry) => [entry.id, entry]));
  const otherLabel = (hadithId: string) => {
    if (hadithId === record.id) return t('citation.thisRecord');
    const candidate = candidates.get(hadithId);
    return candidate === undefined
      ? t('citation.otherRecord')
      : `${candidate.editionCode} · ${candidate.sourceReference}`;
  };

  return (
    <main className="flex flex-col gap-8">
      <p className="text-sm">
        <TextLink href={withQuery(list, { collection: record.collectionId })}>
          {t('backToList')}
        </TextLink>
      </p>
      <div className="flex flex-col gap-2">
        <PageHeading>
          <span dir="auto">{recordText(record)}</span>
        </PageHeading>
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <AuthorityBadge authority={record.authority} copy={copy} />
          <VerifiedBadge verified={record.verified} copy={copy} />
          {record.citationConflicted ? (
            <StatusBadge tone="caution">{t('conflicts.blocked')}</StatusBadge>
          ) : null}
          <span>
            {t('version')}: {record.version}
          </span>
          <span>
            {t('updated')}: <DateText date={record.updatedAt} locale={locale} />
          </span>
        </p>
      </div>

      {/* ---- Source and placement ---------------------------------------- */}
      <Panel>
        <section className="flex flex-col gap-4" aria-labelledby="record-facts">
          <SectionHeading>
            <span id="record-facts">{t('record.facts')}</span>
          </SectionHeading>
          <dl className="flex flex-col">
            <DetailRow term={t('structure.collection')}>
              <TextLink
                href={`/${locale}/admin/hadith/collections/${record.collectionId}`}
              >
                <span dir="ltr">{record.collectionSlug}</span>
              </TextLink>
            </DetailRow>
            <DetailRow term={t('record.sourceSystem')}>
              {source === undefined ? (
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span dir="ltr">{record.sourceSystemCode}</span>
                  <AuthorityBadge authority={record.authority} copy={copy} />
                </span>
              ) : (
                <SourceName source={source} copy={copy} />
              )}
            </DetailRow>
            <DetailRow term={t('structure.edition')}>
              <span dir="ltr">{record.editionCode}</span>
            </DetailRow>
            <DetailRow term={t('record.sourceReference')}>
              <span dir="auto">{record.sourceReference}</span>
            </DetailRow>
            <DetailRow term={t('record.citationNumber')}>
              {record.citationNumber ?? t('record.noCitationNumber')}
            </DetailRow>
            <DetailRow term={t('structure.book')}>
              <TextLink href={`/${locale}/admin/hadith/books/${record.bookId}`}>
                <span dir="auto">
                  {structureText({
                    slug: record.bookSlug,
                    reference: record.bookReference,
                  })}
                </span>
              </TextLink>
            </DetailRow>
            <DetailRow term={t('structure.chapter')}>
              {record.chapterId === null ||
              record.chapterSlug === null ||
              record.chapterReference === null ? (
                t('record.noChapter')
              ) : (
                <TextLink href={`/${locale}/admin/hadith/chapters/${record.chapterId}`}>
                  <span dir="auto">
                    {structureText({
                      slug: record.chapterSlug,
                      reference: record.chapterReference,
                    })}
                  </span>
                </TextLink>
              )}
            </DetailRow>
          </dl>
        </section>
      </Panel>

      {/* ---- Original text, chain and gradings, exactly as sourced -------- */}
      <Panel>
        <section className="flex flex-col gap-4" aria-labelledby="record-text">
          <SectionHeading>
            <span id="record-text">{t('record.text')}</span>
          </SectionHeading>
          <p className="text-xs">{languageText(record.textLanguage, languages)}</p>
          <ExactText text={record.text} language={record.textLanguage} large />
          <h3 className="text-sm font-semibold">{t('record.chain')}</h3>
          {record.chain === null ? (
            <p className="text-sm">{t('record.noChain')}</p>
          ) : (
            <>
              {record.chainLanguage === null ? null : (
                <p className="text-xs">{languageText(record.chainLanguage, languages)}</p>
              )}
              <ExactText text={record.chain} language={record.chainLanguage} />
            </>
          )}
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('record.readOnly')}
          </p>
        </section>
      </Panel>

      <section className="flex flex-col gap-4" aria-labelledby="record-gradings">
        <SectionHeading>
          <span id="record-gradings">{t('gradings.title')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('gradings.help')}
        </p>
        {record.gradings.length === 0 ? (
          <EmptyState>{t('gradings.empty')}</EmptyState>
        ) : (
          <DataTable
            caption={t('gradings.title')}
            columns={[
              t('gradings.grader'),
              t('gradings.label'),
              t('gradings.labelLanguage'),
              t('gradings.reference'),
            ]}
          >
            {[...record.gradings]
              .sort((a, b) => a.position - b.position)
              .map((grading) => (
                <DataRow key={grading.position}>
                  <DataCell wrap>
                    <ExactText text={grading.grader} language={null} as="span" />
                  </DataCell>
                  <DataCell wrap>
                    <ExactText
                      text={grading.label}
                      language={grading.labelLanguage}
                      as="span"
                    />
                  </DataCell>
                  <DataCell>{languageText(grading.labelLanguage, languages)}</DataCell>
                  <DataCell wrap>
                    <span dir="auto">{grading.reference}</span>
                  </DataCell>
                </DataRow>
              ))}
          </DataTable>
        )}
      </section>

      {/* ---- Verification -------------------------------------------------- */}
      <section className="flex flex-col gap-4" aria-labelledby="record-verification">
        <SectionHeading>
          <span id="record-verification">{t('verification.title')}</span>
        </SectionHeading>
        {record.verified ? (
          <Alert tone="success">
            {t('verification.current', { version: record.version })}
          </Alert>
        ) : (
          <Alert tone="info">
            {t('verification.notCurrent', { version: record.version })}
          </Alert>
        )}
        {record.verifications.length === 0 ? (
          <EmptyState>{t('verification.empty')}</EmptyState>
        ) : (
          <DataTable
            caption={t('verification.history')}
            columns={[t('version'), t('evidence.label'), t('when')]}
          >
            {[...record.verifications]
              .sort((a, b) => b.version - a.version)
              .map((verification) => (
                <DataRow key={verification.id}>
                  <DataCell>{verification.version}</DataCell>
                  <DataCell wrap>
                    <span dir="auto">{verification.evidence}</span>
                  </DataCell>
                  <DataCell>
                    <DateText date={verification.createdAt} locale={locale} time />
                  </DataCell>
                </DataRow>
              ))}
          </DataTable>
        )}
      </section>

      {/* ---- Conflict evidence and the other candidates ------------------- */}
      <section className="flex flex-col gap-4" aria-labelledby="record-conflicts">
        <SectionHeading>
          <span id="record-conflicts">{t('conflicts.title')}</span>
        </SectionHeading>
        {record.citationConflicted || record.conflictEvidence.length > 0 ? (
          <Alert tone="warning">{t('conflicts.escalated')}</Alert>
        ) : null}
        {record.conflictEvidence.length === 0 ? (
          <EmptyState>{t('conflicts.empty')}</EmptyState>
        ) : (
          <DataTable
            caption={t('conflicts.title')}
            columns={[
              t('conflicts.facets'),
              t('conflicts.thisVersion'),
              t('conflicts.other'),
              t('conflicts.otherVersion'),
              t('conflicts.detected'),
            ]}
          >
            {record.conflictEvidence.map((conflict) => {
              // The persistence port orients every row: `hadithId` is the record
              // shown here and `other*` is the competing candidate.
              const otherId = conflict.otherHadithId;
              const mine = conflict.hadithVersion;
              const theirs = conflict.otherVersion;
              const label = `${conflict.otherEditionCode} · ${conflict.otherSourceReference}`;
              return (
                <DataRow key={conflict.id}>
                  <DataCell wrap>
                    {conflict.facets.length === 0
                      ? t('none')
                      : conflict.facets
                          .map((facet) => t(`conflicts.facet.${facet}`))
                          .join(', ')}
                  </DataCell>
                  <DataCell>{mine}</DataCell>
                  <DataCell wrap>
                    <TextLink href={`${list}/${otherId}`}>
                      <span dir="auto">{label}</span>
                    </TextLink>
                  </DataCell>
                  <DataCell>{theirs}</DataCell>
                  <DataCell>
                    <DateText date={conflict.detectedAt} locale={locale} time />
                  </DataCell>
                </DataRow>
              );
            })}
          </DataTable>
        )}

        <h3 className="text-sm font-semibold">{t('candidates.title')}</h3>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('candidates.help')}
        </p>
        {record.candidates.length === 0 ? (
          <EmptyState>{t('candidates.empty')}</EmptyState>
        ) : (
          <DataTable
            caption={t('candidates.title')}
            columns={[
              t('record.sourceReference'),
              t('structure.edition'),
              t('record.sourceSystem'),
              t('version'),
              t('verification.title'),
            ]}
          >
            {record.candidates.map((candidate) => (
              <DataRow key={candidate.id}>
                <DataCell wrap>
                  <TextLink href={`${list}/${candidate.id}`}>
                    <span dir="auto">{candidate.sourceReference}</span>
                  </TextLink>
                </DataCell>
                <DataCell wrap>
                  <span dir="ltr">{candidate.editionCode}</span>
                </DataCell>
                <DataCell wrap>
                  <span dir="ltr">{candidate.sourceSystemCode}</span>
                </DataCell>
                <DataCell>{candidate.version}</DataCell>
                <DataCell>
                  <VerifiedBadge verified={candidate.verified} copy={copy} />
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
      </section>

      {/* ---- The public citation ------------------------------------------ */}
      <section className="flex flex-col gap-4" aria-labelledby="record-citation">
        <SectionHeading>
          <span id="record-citation">{t('citation.title')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('citation.help')}
        </p>
        {record.citationNumber === null ? (
          <EmptyState>{t('citation.noNumber')}</EmptyState>
        ) : record.citationRecord === null ? (
          <p className="text-sm">
            {t('citation.unmapped', {
              collection: record.collectionSlug,
              number: record.citationNumber,
            })}
          </p>
        ) : (
          <>
            <dl className="flex flex-col">
              <DetailRow term={t('citation.number')}>
                <span dir="ltr">
                  {record.collectionSlug} {record.citationRecord.number}
                </span>
              </DetailRow>
              <DetailRow term={t('state')}>
                {t(`citation.state.${record.citationRecord.state}`)}
              </DetailRow>
              <DetailRow term={t('citation.names')}>
                {record.citationRecord.hadithId === record.id ? (
                  t('citation.thisRecord')
                ) : (
                  <TextLink href={`${list}/${record.citationRecord.hadithId}`}>
                    <span dir="auto">{otherLabel(record.citationRecord.hadithId)}</span>
                  </TextLink>
                )}
              </DetailRow>
              <DetailRow term={t('version')}>{record.citationRecord.version}</DetailRow>
              <DetailRow term={t('updated')}>
                <DateText date={record.citationRecord.updatedAt} locale={locale} time />
              </DetailRow>
            </dl>
            <h3 className="text-sm font-semibold">{t('citation.history')}</h3>
            {record.citationRecord.revisions.length === 0 ? (
              <EmptyState>{t('citation.historyEmpty')}</EmptyState>
            ) : (
              <DataTable
                caption={t('citation.history')}
                columns={[
                  t('version'),
                  t('state'),
                  t('citation.names'),
                  t('evidence.label'),
                  t('reason.label'),
                  t('when'),
                ]}
              >
                {[...record.citationRecord.revisions]
                  .sort((a, b) => b.version - a.version)
                  .map((revision) => (
                    <DataRow key={revision.version}>
                      <DataCell>{revision.version}</DataCell>
                      <DataCell>{t(`citation.state.${revision.state}`)}</DataCell>
                      <DataCell wrap>
                        <span dir="auto">{otherLabel(revision.hadithId)}</span>
                      </DataCell>
                      <DataCell wrap>
                        <span dir="auto">{revision.evidence}</span>
                      </DataCell>
                      <DataCell wrap>
                        {revision.reason === null ? (
                          t('none')
                        ) : (
                          <span dir="auto">{revision.reason}</span>
                        )}
                      </DataCell>
                      <DataCell>
                        <DateText date={revision.createdAt} locale={locale} time />
                      </DataCell>
                    </DataRow>
                  ))}
              </DataTable>
            )}
          </>
        )}
      </section>

      {/* ---- Immutable revisions ------------------------------------------- */}
      <section className="flex flex-col gap-4" aria-labelledby="record-history">
        <SectionHeading>
          <span id="record-history">{t('history.title')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('history.help')}
        </p>
        {record.revisions.length === 0 ? (
          <EmptyState>{t('history.empty')}</EmptyState>
        ) : (
          <DataTable
            caption={t('history.title')}
            columns={[
              t('version'),
              t('history.operation'),
              t('record.sourceReference'),
              t('record.citationNumber'),
              t('evidence.label'),
              t('reason.label'),
              t('when'),
            ]}
          >
            {[...record.revisions]
              .sort((a, b) => b.version - a.version)
              .map((revision) => (
                <DataRow key={revision.version}>
                  <DataCell>{revision.version}</DataCell>
                  <DataCell>{t(`history.operationName.${revision.operation}`)}</DataCell>
                  <DataCell wrap>
                    <span dir="auto">{revision.sourceReference}</span>
                  </DataCell>
                  <DataCell>{revision.citationNumber ?? t('none')}</DataCell>
                  <DataCell wrap>
                    <span dir="auto">{revision.evidence}</span>
                  </DataCell>
                  <DataCell wrap>
                    {revision.reason === null ? (
                      t('none')
                    ) : (
                      <span dir="auto">{revision.reason}</span>
                    )}
                  </DataCell>
                  <DataCell>
                    <DateText date={revision.createdAt} locale={locale} time />
                  </DataCell>
                </DataRow>
              ))}
          </DataTable>
        )}
      </section>

      {/* ---- Topics -------------------------------------------------------- */}
      <TopicsSection
        locale={locale}
        record={record}
        names={new Map(assigned.map((topic) => [topic.id, topic.name]))}
        offered={tree
          .filter((topic) => !record.topicIds.includes(topic.id))
          .map((topic) => ({ id: topic.id, name: topic.label.name }))}
        administer={administer}
        copy={copy}
      />

      {/* ---- Translations -------------------------------------------------- */}
      <TranslationsSection
        locale={locale}
        base={base}
        query={query}
        record={record}
        translations={translations}
        sources={sources}
        languages={languages}
        administer={administer}
        copy={copy}
      />

      {/* ---- Canonical changes --------------------------------------------- */}
      {canonical ? (
        <CanonicalChanges
          locale={locale}
          base={base}
          query={query}
          actor={actor}
          record={record}
          languages={languages}
          copy={copy}
        />
      ) : null}
    </main>
  );
}

/* ===========================================================================
 * Topics
 * ========================================================================= */

function TopicsSection({
  locale,
  record,
  names,
  offered,
  administer,
  copy,
}: {
  readonly locale: Locale;
  readonly record: HadithRecordDetail;
  readonly names: ReadonlyMap<string, string>;
  readonly offered: readonly { readonly id: string; readonly name: string }[];
  readonly administer: boolean;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const full = record.topicIds.length >= HADITH_LIMITS.topicsPerRecord;
  const identity = (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="hadithId" value={record.id} />
    </>
  );
  return (
    <section className="flex flex-col gap-4" aria-labelledby="record-topics">
      <SectionHeading>
        <span id="record-topics">{t('topics.title')}</span>
      </SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('topics.help', {
          count: record.topicIds.length,
          limit: HADITH_LIMITS.topicsPerRecord,
        })}
      </p>
      {record.topicIds.length === 0 ? (
        <EmptyState>{t('topics.empty')}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {record.topicIds.map((topicId) => (
            <li key={topicId} className="flex flex-wrap items-center gap-4">
              <span>{names.get(topicId) ?? t('topics.unavailable')}</span>
              {administer ? (
                <ActionForm
                  action={changeHadithTopic}
                  submitLabel={t('topics.remove')}
                  pendingLabel={t('pending')}
                  messages={copy.messages}
                  tone="secondary"
                >
                  {identity}
                  <input type="hidden" name="op" value="remove" />
                  <input type="hidden" name="topicId" value={topicId} />
                </ActionForm>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {administer ? (
        full ? (
          <Alert tone="info">{t('topics.full')}</Alert>
        ) : offered.length === 0 ? (
          <EmptyState>{t('topics.none')}</EmptyState>
        ) : (
          <ActionForm
            action={changeHadithTopic}
            submitLabel={t('topics.add')}
            pendingLabel={t('pending')}
            messages={copy.messages}
          >
            {identity}
            <input type="hidden" name="op" value="add" />
            <Field id="record-topic" label={t('topics.choose')}>
              {(props) => (
                <Select {...props} name="topicId" required defaultValue="">
                  <option value="">{t('topics.placeholder')}</option>
                  {offered.map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </ActionForm>
        )
      ) : null}
    </section>
  );
}

/* ===========================================================================
 * Translations — layered, each its own record with its own lifecycle
 * ========================================================================= */

async function TranslationsSection({
  locale,
  base,
  query,
  record,
  translations,
  sources,
  languages,
  administer,
  copy,
}: {
  readonly locale: Locale;
  readonly base: string;
  readonly query: Query;
  readonly record: HadithRecordDetail;
  readonly translations: readonly HadithTranslationRecord[];
  readonly sources: readonly HadithSourceSystemRecord[];
  readonly languages: ReadonlyMap<string, LanguageView>;
  readonly administer: boolean;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const chosen = queryValue(query, 'translation');
  const editing =
    chosen === null ? undefined : translations.find((entry) => entry.id === chosen);
  const adding = administer && chosen === 'new';
  const reference = queryValue(query, 'q') ?? '';
  const people =
    editing !== undefined || adding
      ? await peopleChoices(
          locale,
          administer ? reference : '',
          editing?.contributors.map((entry) => entry.personId) ?? [],
          copy,
        )
      : null;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="record-translations">
      <SectionHeading>
        <span id="record-translations">{t('translations.title')}</span>
      </SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('translations.help')}
      </p>
      {translations.length === 0 ? (
        <EmptyState>{t('translations.empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('translations.title')}
          columns={[
            t('language.label'),
            t('state'),
            t('source'),
            t('version'),
            t('updated'),
            t('translations.open'),
          ]}
        >
          {translations.map((translation) => (
            <DataRow key={translation.id}>
              <DataCell>{languageText(translation.languageCode, languages)}</DataCell>
              <DataCell>
                <StateBadge state={translation.state} copy={copy} />
              </DataCell>
              <DataCell wrap>
                <SourceName
                  source={
                    translation.sourceSystemId === null
                      ? undefined
                      : sourceById.get(translation.sourceSystemId)
                  }
                  copy={copy}
                />
              </DataCell>
              <DataCell>{translation.version}</DataCell>
              <DataCell>
                <DateText date={translation.updatedAt} locale={locale} />
              </DataCell>
              <DataCell>
                <TextLink
                  href={`${withQuery(base, { translation: translation.id })}#translation-editor`}
                >
                  {administer ? t('translations.edit') : t('translations.view')}
                </TextLink>
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
      {administer && !adding ? (
        <p className="text-sm">
          <TextLink
            href={`${withQuery(base, { translation: 'new' })}#translation-editor`}
          >
            {t('translations.add')}
          </TextLink>
        </p>
      ) : null}

      {editing === undefined && !adding ? null : (
        <Panel>
          <section className="flex flex-col gap-4" aria-labelledby="translation-editor">
            <SectionHeading>
              <span id="translation-editor">
                {editing === undefined
                  ? t('translations.new')
                  : t('translations.editing', {
                      language: languageText(editing.languageCode, languages),
                    })}
              </span>
            </SectionHeading>
            <p className="text-sm">
              <TextLink href={base}>{t('translations.close')}</TextLink>
            </p>
            {editing === undefined ? null : (
              <div className="flex flex-col gap-3">
                <p className="flex flex-wrap items-center gap-3 text-sm">
                  <StateBadge state={editing.state} copy={copy} />
                  <span>
                    {t('version')}: {editing.version}
                  </span>
                </p>
                {administer ? (
                  <StateControls
                    kind="translation"
                    locale={locale}
                    record={editing}
                    copy={copy}
                  />
                ) : null}
              </div>
            )}
            {administer ? (
              <>
                <PeopleSearch
                  query={reference}
                  copy={copy}
                  keep={{ translation: editing?.id ?? 'new' }}
                />
                <TranslationForm
                  locale={locale}
                  hadithId={record.id}
                  translation={editing ?? null}
                  sources={sources}
                  languages={languages}
                  people={people?.options ?? []}
                  copy={copy}
                />
              </>
            ) : editing === undefined ? null : (
              <TranslationFacts
                translation={editing}
                languages={languages}
                names={people?.names ?? new Map()}
                copy={copy}
              />
            )}
          </section>
        </Panel>
      )}
    </section>
  );
}

function TranslationForm({
  locale,
  hadithId,
  translation,
  sources,
  languages,
  people,
  copy,
}: {
  readonly locale: Locale;
  readonly hadithId: string;
  /** `null` creates. An existing translation edits, and carries its expected version. */
  readonly translation: HadithTranslationRecord | null;
  readonly sources: readonly HadithSourceSystemRecord[];
  readonly languages: ReadonlyMap<string, LanguageView>;
  readonly people: readonly PersonChoice[];
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = translation === null ? 'new-translation' : 'translation';
  const direction =
    translation === null
      ? 'auto'
      : (languages.get(translation.languageCode)?.direction ?? 'auto');
  return (
    <ActionForm
      action={saveHadithTranslation}
      submitLabel={translation === null ? t('createSubmit') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
      preserveInput
    >
      <EditIdentity locale={locale} record={translation} />
      <input type="hidden" name="hadithId" value={hadithId} />
      <LanguageSelect
        id={`${prefix}-language`}
        languages={languages}
        selected={translation?.languageCode ?? null}
        copy={copy}
      />
      <Field
        id={`${prefix}-text`}
        label={t('translations.text')}
        help={t('exactTextHelp')}
      >
        {(props) => (
          <TextArea
            {...props}
            name="text"
            required
            rows={8}
            maxLength={HADITH_LIMITS.translationText}
            defaultValue={translation?.text ?? ''}
            {...(translation === null ? {} : { lang: translation.languageCode })}
            dir={direction}
          />
        )}
      </Field>
      <Field
        id={`${prefix}-attribution`}
        label={t('attribution')}
        help={t('attributionHelp')}
      >
        {(props) => (
          <TextInput
            {...props}
            name="attribution"
            defaultValue={translation?.attribution ?? ''}
            maxLength={HADITH_LIMITS.attribution}
            dir="auto"
          />
        )}
      </Field>
      <SourceSelect
        id={`${prefix}-source`}
        sources={sources}
        selected={translation?.sourceSystemId ?? null}
        copy={copy}
      />
      <ContributorFields
        prefix={prefix}
        roles={HADITH_TRANSLATION_ROLES}
        current={translation?.contributors ?? []}
        people={people}
        copy={copy}
      />
    </ActionForm>
  );
}

/** What a reader without `hadith.administer` sees in place of the form. */
function TranslationFacts({
  translation,
  languages,
  names,
  copy,
}: {
  readonly translation: HadithTranslationRecord;
  readonly languages: ReadonlyMap<string, LanguageView>;
  readonly names: ReadonlyMap<string, string>;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <dl className="flex flex-col">
      <DetailRow term={t('language.label')}>
        {languageText(translation.languageCode, languages)}
      </DetailRow>
      <DetailRow term={t('translations.text')}>
        <ExactText text={translation.text} language={translation.languageCode} />
      </DetailRow>
      <DetailRow term={t('attribution')}>
        {translation.attribution === null ? (
          t('none')
        ) : (
          <span dir="auto">{translation.attribution}</span>
        )}
      </DetailRow>
      <DetailRow term={t('contributors.title')}>
        <ContributorList
          contributors={translation.contributors}
          names={names}
          copy={copy}
        />
      </DetailRow>
    </dl>
  );
}

/* ===========================================================================
 * Canonical changes — verify, map or withdraw the citation, correct
 * ========================================================================= */

async function CanonicalChanges({
  locale,
  base,
  query,
  actor,
  record,
  languages,
  copy,
}: {
  readonly locale: Locale;
  readonly base: string;
  readonly query: Query;
  readonly actor: HadithActor;
  readonly record: HadithRecordDetail;
  readonly languages: ReadonlyMap<string, LanguageView>;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const entered = queryValue(query, 'canonical') === '1';

  if (!entered) {
    return (
      <Panel>
        <section className="flex flex-col gap-3" aria-labelledby="canonical">
          <SectionHeading>
            <span id="canonical">{t('canonical.title')}</span>
          </SectionHeading>
          <p className="text-sm">{t('canonical.intro')}</p>
          <p className="text-sm">
            <TextLink href={`${base}?canonical=1#canonical`}>
              {t('canonical.begin')}
            </TextLink>
          </p>
        </section>
      </Panel>
    );
  }

  const service = hadithRuntime().hadith;
  // A correction may move the record to another book of ITS OWN edition; the
  // book is chosen first, so the chapter list below always belongs to it.
  const books = await everyPage((at) => service.books(actor, record.collectionId, at));
  const sameEdition = books.items.filter((book) => book.editionId === record.editionId);
  const requested = queryId(query, 'book');
  const book =
    sameEdition.find((entry) => entry.id === requested) ??
    sameEdition.find((entry) => entry.id === record.bookId) ??
    (await service.book(actor, record.bookId));
  const chapters =
    book === null ? null : await everyPage((at) => service.chapters(actor, book.id, at));

  const citation = record.citationRecord;
  const mappedHere =
    citation !== null && citation.state === 'mapped' && citation.hadithId === record.id;

  return (
    <section className="flex flex-col gap-6" aria-labelledby="canonical">
      <div className="flex flex-col gap-2">
        <SectionHeading>
          <span id="canonical">{t('canonical.title')}</span>
        </SectionHeading>
        <Alert tone="warning">{t('canonical.warning')}</Alert>
        <p className="text-sm">
          <TextLink href={base}>{t('canonical.leave')}</TextLink>
        </p>
      </div>

      <CanonicalStepUp locale={locale} />

      {/* ---- Verify the current version ----------------------------------- */}
      <Panel>
        <section className="flex flex-col gap-4" aria-labelledby="verify">
          <SectionHeading>
            <span id="verify">{t('verify.title', { version: record.version })}</span>
          </SectionHeading>
          <p className="text-sm">{t('verify.help')}</p>
          {record.verified ? (
            <Alert tone="info">{t('verify.already')}</Alert>
          ) : (
            <ActionForm
              action={verifyHadithRecord}
              submitLabel={t('verify.submit')}
              pendingLabel={t('pending')}
              messages={copy.messages}
              preserveInput
            >
              <EditIdentity locale={locale} record={record} />
              <EvidenceField id="verify-evidence" copy={copy} />
              <ConfirmField id="verify-confirm" label={t('verify.confirm')} />
            </ActionForm>
          )}
        </section>
      </Panel>

      {/* ---- Map or withdraw the citation ---------------------------------- */}
      <Panel>
        <section className="flex flex-col gap-4" aria-labelledby="mapping">
          <SectionHeading>
            <span id="mapping">{t('mapping.title')}</span>
          </SectionHeading>
          <p className="text-sm">{t('mapping.help')}</p>
          {record.citationNumber === null ? (
            <Alert tone="info">{t('citation.noNumber')}</Alert>
          ) : (
            <>
              {record.citationConflicted ? (
                <Alert tone="warning">{t('mapping.conflicted')}</Alert>
              ) : mappedHere ? (
                <Alert tone="info">{t('mapping.already')}</Alert>
              ) : !record.verified ? (
                <Alert tone="info">{t('mapping.unverified')}</Alert>
              ) : (
                <CitationForm
                  locale={locale}
                  record={record}
                  number={record.citationNumber}
                  state="mapped"
                  copy={copy}
                />
              )}
              {mappedHere ? (
                <>
                  <h3 className="text-sm font-semibold">{t('mapping.withdrawTitle')}</h3>
                  <CitationForm
                    locale={locale}
                    record={record}
                    number={record.citationNumber}
                    state="withdrawn"
                    copy={copy}
                  />
                </>
              ) : null}
            </>
          )}
        </section>
      </Panel>

      {/* ---- Correct the record ---------------------------------------------- */}
      <Panel>
        <section className="flex flex-col gap-4" aria-labelledby="correct">
          <SectionHeading>
            <span id="correct">{t('correction.title')}</span>
          </SectionHeading>
          <p className="text-sm">{t('correction.help')}</p>
          {mappedHere ? <Alert tone="info">{t('correction.citationKept')}</Alert> : null}
          <form method="get" action={base} className="flex flex-wrap items-end gap-3">
            <input type="hidden" name="canonical" value="1" />
            <Field
              id="correct-book"
              label={t('structure.book')}
              help={t('correction.bookHelp')}
            >
              {(props) => (
                <Select {...props} name="book" required defaultValue={book?.id ?? ''}>
                  {sameEdition.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {structureText(entry)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <button type="submit" className={SUBMIT_CLASSES}>
              {t('records.useBook')}
            </button>
          </form>
          {books.truncated ? (
            <p className="text-sm">{t('records.choicesTruncated')}</p>
          ) : null}
          {book === null || chapters === null ? (
            <Alert tone="error">{t('unavailableReference')}</Alert>
          ) : (
            <RecordForm
              locale={locale}
              book={book}
              chapters={chapters}
              chapterId={book.id === record.bookId ? record.chapterId : null}
              record={record}
              languages={languages}
              copy={copy}
            />
          )}
        </section>
      </Panel>
    </section>
  );
}

function EvidenceField({ id, copy }: { readonly id: string; readonly copy: Copy }) {
  const { t } = copy;
  return (
    <Field id={id} label={t('evidence.label')} help={t('evidence.help')}>
      {(props) => (
        <TextInput
          {...props}
          name="evidence"
          required
          maxLength={HADITH_LIMITS.evidence}
          dir="auto"
        />
      )}
    </Field>
  );
}

/**
 * Maps the record's declared citation to THIS record, or withdraws it. Version
 * 0 creates the citation; any change to an existing one states its reason.
 */
function CitationForm({
  locale,
  record,
  number,
  state,
  copy,
}: {
  readonly locale: Locale;
  readonly record: HadithRecordDetail;
  readonly number: number;
  readonly state: 'mapped' | 'withdrawn';
  readonly copy: Copy;
}) {
  const { t } = copy;
  const version = record.citationRecord?.version ?? 0;
  const prefix = state === 'mapped' ? 'map' : 'withdraw';
  return (
    <ActionForm
      action={setHadithCitation}
      submitLabel={state === 'mapped' ? t('mapping.submit') : t('mapping.withdraw')}
      pendingLabel={t('pending')}
      messages={copy.messages}
      tone={state === 'mapped' ? 'primary' : 'destructive'}
      preserveInput
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="collectionId" value={record.collectionId} />
      <input type="hidden" name="number" value={String(number)} />
      <input type="hidden" name="hadithId" value={record.id} />
      <input type="hidden" name="state" value={state} />
      <input type="hidden" name="version" value={String(version)} />
      <p className="text-sm">
        {t('mapping.target', { collection: record.collectionSlug, number })}
      </p>
      <EvidenceField id={`${prefix}-evidence`} copy={copy} />
      {version === 0 ? null : (
        <Field
          id={`${prefix}-reason`}
          label={t('reason.label')}
          help={t('mapping.reasonHelp')}
        >
          {(props) => (
            <TextInput
              {...props}
              name="reason"
              required
              maxLength={HADITH_LIMITS.reason}
              dir="auto"
            />
          )}
        </Field>
      )}
      <ConfirmField
        id={`${prefix}-confirm`}
        label={state === 'mapped' ? t('mapping.confirm') : t('mapping.withdrawConfirm')}
      />
    </ActionForm>
  );
}
