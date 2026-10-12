import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  HADITH_COMMENTARY_ROLES,
  HADITH_LIMITS,
  HADITH_PAGE,
  type HadithCommentaryEntryRecord,
  type HadithCommentaryRecord,
  type HadithScienceRecord,
  type HadithSourceSystemRecord,
} from '@minhaj/contracts/hadith';
import type { LanguageView } from '@minhaj/contracts/taxonomy';

import { requireAdminPage } from '@/composition/authorization';
import { hadithRuntime } from '@/composition/hadith';
import {
  DataCell,
  DataRow,
  DataTable,
  DetailRow,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  TextArea,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { pageOffset, queryValue } from '../shared';
import {
  saveHadithCommentary,
  saveHadithCommentaryEntry,
  saveHadithScience,
} from './actions';
import { ContributorFields, ContributorList } from './contributors';
import {
  actorOf,
  EditIdentity,
  EditorHeading,
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
  SlugField,
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
} from './shared';

/**
 * The layered works that stand beside records — commentary and the Hadith
 * sciences (ROUTE_MAP.md §7: `/admin/hadith/{commentary|sciences}`), Phase 19.
 *
 * EACH IS ITS OWN WORK, never a field on a record: its own identity, source,
 * lifecycle and version, managed under `hadith.administer`. NOTHING HERE
 * TOUCHES A SOURCED FACT — the actions behind these forms have no path that
 * writes a record's text, chain, gradings or citation.
 *
 * A SOURCE IS CHOSEN, NEVER CREATED. The selector lists the registered source
 * systems; only the owner/operator registers one, and publication requires
 * one, so no administrator self-approves a work.
 *
 * TEXT IS SAVED EXACTLY AS ENTERED. Commentary entries and science bodies are
 * plain textareas — no rich-text editor, no markup — and surrounding
 * whitespace is refused rather than trimmed.
 */

function sourceIndex(sources: readonly HadithSourceSystemRecord[]) {
  return new Map(sources.map((source) => [source.id, source]));
}

/** A record as one line: where it is from, in the source's own terms. */
function entryRecordText(entry: HadithCommentaryEntryRecord): string {
  return `${entry.collectionSlug} · ${entry.editionCode} · ${entry.sourceReference}`;
}

/* ===========================================================================
 * Commentary
 * ========================================================================= */

export async function CommentaryDirectory({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/hadith/commentary`;
  const context = await requireAdminPage(locale, 'hadith.read', base);
  const copy = await hadithCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const administer = context.authorization.can('hadith.administer');
  const offset = pageOffset(query, HADITH_PAGE);
  const reference = queryValue(query, 'q') ?? '';
  const service = hadithRuntime().hadith;

  const [page, sources, languages, people] = await Promise.all([
    service.commentaries(actor, offset),
    service.sourceSystems(actor),
    languageIndex(),
    administer ? peopleChoices(locale, reference, [], copy) : Promise.resolve(null),
  ]);
  const sourceById = sourceIndex(sources);

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.commentary')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scope.commentary')}
      </p>

      {page.items.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('surface.commentary')}
          columns={[
            t('name'),
            t('slug'),
            t('language.label'),
            t('source'),
            t('state'),
            t('commentary.entries'),
            t('version'),
          ]}
        >
          {page.items.map((item) => (
            <DataRow key={item.id}>
              <DataCell wrap>
                <TextLink href={`${base}/${item.id}`}>
                  <span dir="auto">{item.name}</span>
                </TextLink>
              </DataCell>
              <DataCell wrap>
                <span dir="ltr">{item.slug}</span>
              </DataCell>
              <DataCell>{languageText(item.languageCode, languages)}</DataCell>
              <DataCell wrap>
                <SourceName
                  source={
                    item.sourceSystemId === null
                      ? undefined
                      : sourceById.get(item.sourceSystemId)
                  }
                  copy={copy}
                />
              </DataCell>
              <DataCell>
                <StateBadge state={item.state} copy={copy} />
              </DataCell>
              <DataCell>{item.entryCount}</DataCell>
              <DataCell>{item.version}</DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
      <Pager
        offset={offset}
        total={page.total}
        hrefFor={(number) => (number > 1 ? `${base}?page=${String(number)}` : base)}
        label={t('surface.commentary')}
        copy={copy}
      />

      {administer ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('commentary.create')}</SectionHeading>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('createHelp')}
            </p>
            <PeopleSearch query={reference} copy={copy} />
            <CommentaryForm
              locale={locale}
              record={null}
              sources={sources}
              languages={languages}
              people={people?.options ?? []}
              copy={copy}
            />
          </div>
        </Panel>
      ) : null}
    </main>
  );
}

export async function CommentaryEditor({ params, searchParams }: EditorParams) {
  const locale = await requireLocale(params);
  const id = recordTarget((await params).id);
  const query = await searchParams;
  const list = `/${locale}/admin/hadith/commentary`;
  const base = `${list}/${id}`;
  const context = await requireAdminPage(locale, 'hadith.read', base);
  const copy = await hadithCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const administer = context.authorization.can('hadith.administer');
  const service = hadithRuntime().hadith;

  const record = await service.commentary(actor, id);
  if (record === null) notFound();

  const reference = queryValue(query, 'q') ?? '';
  const offset = pageOffset(query, HADITH_PAGE);
  const [sources, languages, people, entries] = await Promise.all([
    service.sourceSystems(actor),
    languageIndex(),
    peopleChoices(
      locale,
      administer ? reference : '',
      record.contributors.map((entry) => entry.personId),
      copy,
    ),
    service.commentaryEntries(actor, record.id, offset),
  ]);
  const source =
    record.sourceSystemId === null
      ? undefined
      : sources.find((entry) => entry.id === record.sourceSystemId);
  const direction = languages.get(record.languageCode)?.direction ?? 'auto';

  return (
    <main className="flex flex-col gap-8">
      <EditorHeading
        base={list}
        locale={locale}
        title={<span dir="auto">{record.name}</span>}
        record={record}
        copy={copy}
      />

      {/* ---- Lifecycle ---------------------------------------------------- */}
      <Panel>
        <section className="flex flex-col gap-4" aria-labelledby="work-state">
          <SectionHeading>
            <span id="work-state">{t('stateTitle')}</span>
          </SectionHeading>
          <p className="text-sm">
            {t('source')}: <SourceName source={source} copy={copy} />
          </p>
          {administer ? (
            <StateControls
              kind="commentary"
              locale={locale}
              record={record}
              copy={copy}
            />
          ) : null}
        </section>
      </Panel>

      {/* ---- Metadata ----------------------------------------------------- */}
      <Panel>
        <section className="flex flex-col gap-4" aria-labelledby="work-details">
          <SectionHeading>
            <span id="work-details">{t('details')}</span>
          </SectionHeading>
          {administer ? (
            <>
              <PeopleSearch query={reference} copy={copy} />
              <CommentaryForm
                locale={locale}
                record={record}
                sources={sources}
                languages={languages}
                people={people.options}
                copy={copy}
              />
            </>
          ) : (
            <dl className="flex flex-col">
              <DetailRow term={t('language.label')}>
                {languageText(record.languageCode, languages)}
              </DetailRow>
              <DetailRow term={t('description')}>
                {record.description === null ? (
                  t('none')
                ) : (
                  <span dir="auto">{record.description}</span>
                )}
              </DetailRow>
              <DetailRow term={t('attribution')}>
                {record.attribution === null ? (
                  t('none')
                ) : (
                  <span dir="auto">{record.attribution}</span>
                )}
              </DetailRow>
              <DetailRow term={t('contributors.title')}>
                <ContributorList
                  contributors={record.contributors}
                  names={people.names}
                  copy={copy}
                />
              </DetailRow>
            </dl>
          )}
        </section>
      </Panel>

      {/* ---- Entries ------------------------------------------------------ */}
      <section className="flex flex-col gap-4" aria-labelledby="work-entries">
        <SectionHeading>
          <span id="work-entries">{t('commentary.entries')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('commentary.entriesHelp')}
        </p>
        {entries.items.length === 0 ? (
          <EmptyState>{t('commentary.entriesEmpty')}</EmptyState>
        ) : (
          <ol className="flex flex-col gap-4">
            {entries.items.map((entry) => (
              <Panel key={entry.hadithId} as="li">
                <div className="flex flex-col gap-3">
                  <p className="text-sm font-semibold">
                    <TextLink href={`/${locale}/admin/hadith/records/${entry.hadithId}`}>
                      <span dir="auto">{entryRecordText(entry)}</span>
                    </TextLink>
                  </p>
                  {administer ? (
                    <>
                      <EntryForm
                        locale={locale}
                        record={record}
                        hadithId={entry.hadithId}
                        text={entry.text}
                        direction={direction}
                        copy={copy}
                        records={null}
                      />
                      <ActionForm
                        action={saveHadithCommentaryEntry}
                        submitLabel={t('commentary.removeEntry')}
                        pendingLabel={t('pending')}
                        messages={copy.messages}
                        tone="destructive"
                      >
                        <EditIdentity locale={locale} record={record} />
                        <input type="hidden" name="op" value="remove" />
                        <input type="hidden" name="hadithId" value={entry.hadithId} />
                      </ActionForm>
                    </>
                  ) : (
                    <ExactText text={entry.text} language={record.languageCode} />
                  )}
                </div>
              </Panel>
            ))}
          </ol>
        )}
        <Pager
          offset={offset}
          total={entries.total}
          hrefFor={(number) => (number > 1 ? `${base}?page=${String(number)}` : base)}
          label={t('commentary.entries')}
          copy={copy}
        />
      </section>

      {administer ? (
        <EntryAdder
          locale={locale}
          base={base}
          query={query}
          record={record}
          direction={direction}
          copy={copy}
          actor={actor}
        />
      ) : null}
    </main>
  );
}

/**
 * Adding an entry: the record is CHOSEN from the record list — narrowed by
 * collection and paged without script — never typed in by identifier.
 */
async function EntryAdder({
  locale,
  base,
  query,
  record,
  direction,
  copy,
  actor,
}: {
  readonly locale: Locale;
  readonly base: string;
  readonly query: Record<string, string | string[] | undefined>;
  readonly record: HadithCommentaryRecord;
  readonly direction: 'ltr' | 'rtl' | 'auto';
  readonly copy: Copy;
  readonly actor: { readonly accountId: string };
}) {
  const { t } = copy;
  const service = hadithRuntime().hadith;
  const collections = await everyPage((at) => service.collections(actor, at));
  const collectionId = queryId(query, 'collection');
  const collection = collections.items.find((entry) => entry.id === collectionId);
  const offset = pageOffset({ page: query['records'] }, HADITH_PAGE);
  const records = await service.records(
    actor,
    { collectionId: collection?.id ?? null, view: 'all' },
    offset,
  );

  return (
    <Panel>
      <section className="flex flex-col gap-4" aria-labelledby="add-entry">
        <SectionHeading>
          <span id="add-entry">{t('commentary.addEntry')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('commentary.addEntryHelp')}
        </p>
        <form method="get" action={base} className="flex flex-wrap items-end gap-3">
          <Field id="entry-collection" label={t('structure.collection')}>
            {(props) => (
              <Select {...props} name="collection" defaultValue={collection?.id ?? ''}>
                <option value="">{t('filter.allCollections')}</option>
                {collections.items.map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    {entry.slug}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <button type="submit" className={SUBMIT_CLASSES}>
            {t('commentary.findRecords')}
          </button>
        </form>
        {records.items.length === 0 ? (
          <EmptyState>{t('records.empty')}</EmptyState>
        ) : (
          <>
            <EntryForm
              locale={locale}
              record={record}
              hadithId={null}
              text=""
              direction={direction}
              copy={copy}
              records={records.items.map((entry) => ({
                id: entry.id,
                label: `${entry.collectionSlug} · ${entry.editionCode} · ${entry.sourceReference}`,
              }))}
            />
            <Pager
              offset={offset}
              total={records.total}
              hrefFor={(number) =>
                `${withQuery(base, {
                  collection: collection?.id ?? null,
                  records: number > 1 ? String(number) : null,
                })}#add-entry`
              }
              label={t('commentary.addEntry')}
              copy={copy}
            />
          </>
        )}
      </section>
    </Panel>
  );
}

/** One entry's text on one record. A `null` record id offers the record choice. */
function EntryForm({
  locale,
  record,
  hadithId,
  text,
  direction,
  records,
  copy,
}: {
  readonly locale: Locale;
  readonly record: HadithCommentaryRecord;
  readonly hadithId: string | null;
  readonly text: string;
  readonly direction: 'ltr' | 'rtl' | 'auto';
  readonly records: readonly { readonly id: string; readonly label: string }[] | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = hadithId === null ? 'new-entry' : `entry-${hadithId}`;
  return (
    <ActionForm
      action={saveHadithCommentaryEntry}
      submitLabel={
        hadithId === null ? t('commentary.addEntrySubmit') : t('commentary.saveEntry')
      }
      pendingLabel={t('pending')}
      messages={copy.messages}
      preserveInput
    >
      <EditIdentity locale={locale} record={record} />
      <input type="hidden" name="op" value="save" />
      {hadithId !== null ? (
        <input type="hidden" name="hadithId" value={hadithId} />
      ) : (
        <Field id={`${prefix}-record`} label={t('commentary.record')}>
          {(props) => (
            <Select {...props} name="hadithId" required defaultValue="">
              <option value="">{t('commentary.chooseRecord')}</option>
              {(records ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field id={`${prefix}-text`} label={t('commentary.text')} help={t('exactTextHelp')}>
        {(props) => (
          <TextArea
            {...props}
            name="text"
            required
            rows={8}
            defaultValue={text}
            maxLength={HADITH_LIMITS.commentaryText}
            lang={record.languageCode}
            dir={direction}
          />
        )}
      </Field>
    </ActionForm>
  );
}

function CommentaryForm({
  locale,
  record,
  sources,
  languages,
  people,
  copy,
}: {
  readonly locale: Locale;
  /** `null` creates. An existing record edits, and carries its expected version. */
  readonly record: HadithCommentaryRecord | null;
  readonly sources: readonly HadithSourceSystemRecord[];
  readonly languages: ReadonlyMap<string, LanguageView>;
  readonly people: readonly PersonChoice[];
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? 'new-commentary' : 'commentary';
  return (
    <ActionForm
      action={saveHadithCommentary}
      submitLabel={record === null ? t('createSubmit') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
      preserveInput
    >
      <EditIdentity locale={locale} record={record} />
      <SlugField prefix={prefix} slug={record?.slug ?? null} copy={copy} />
      <Field id={`${prefix}-name`} label={t('name')}>
        {(props) => (
          <TextInput
            {...props}
            name="name"
            required
            defaultValue={record?.name ?? ''}
            maxLength={HADITH_LIMITS.name}
            dir="auto"
          />
        )}
      </Field>
      <Field id={`${prefix}-description`} label={t('description')}>
        {(props) => (
          <TextArea
            {...props}
            name="description"
            rows={3}
            defaultValue={record?.description ?? ''}
            maxLength={HADITH_LIMITS.description}
            dir="auto"
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
            defaultValue={record?.attribution ?? ''}
            maxLength={HADITH_LIMITS.attribution}
            dir="auto"
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <LanguageSelect
          id={`${prefix}-language`}
          languages={languages}
          selected={record?.languageCode ?? null}
          copy={copy}
        />
        <SourceSelect
          id={`${prefix}-source`}
          sources={sources}
          selected={record?.sourceSystemId ?? null}
          copy={copy}
        />
      </div>
      <ContributorFields
        prefix={prefix}
        roles={HADITH_COMMENTARY_ROLES}
        current={record?.contributors ?? []}
        people={people}
        copy={copy}
      />
    </ActionForm>
  );
}

/* ===========================================================================
 * Sciences
 * ========================================================================= */

/** The schema's own ceiling on texts per sciences entry. */
const TEXT_ROWS = 8;

/** An entry's title in the reader's language where it has one, else its first. */
function titleOf(science: HadithScienceRecord, locale: Locale) {
  return science.texts.find((text) => text.languageCode === locale) ?? science.texts[0];
}

function ScienceTitle({
  science,
  locale,
  languages,
}: {
  readonly science: HadithScienceRecord;
  readonly locale: Locale;
  readonly languages: ReadonlyMap<string, LanguageView>;
}) {
  const title = titleOf(science, locale);
  return title === undefined ? (
    <span dir="ltr">{science.slug}</span>
  ) : (
    <span
      lang={title.languageCode}
      dir={languages.get(title.languageCode)?.direction ?? 'auto'}
    >
      {title.title}
    </span>
  );
}

export async function SciencesDirectory({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/hadith/sciences`;
  const context = await requireAdminPage(locale, 'hadith.read', base);
  const copy = await hadithCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const administer = context.authorization.can('hadith.administer');
  const offset = pageOffset(query, HADITH_PAGE);
  const service = hadithRuntime().hadith;

  const [page, sources, languages] = await Promise.all([
    service.sciences(actor, offset),
    service.sourceSystems(actor),
    languageIndex(),
  ]);
  const sourceById = sourceIndex(sources);

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.sciences')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scope.sciences')}
      </p>

      {page.items.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('surface.sciences')}
          columns={[
            t('position'),
            t('sciences.title'),
            t('slug'),
            t('source'),
            t('state'),
            t('version'),
          ]}
        >
          {page.items.map((science) => (
            <DataRow key={science.id}>
              <DataCell>{science.position}</DataCell>
              <DataCell wrap>
                <TextLink href={`${base}/${science.id}`}>
                  <ScienceTitle science={science} locale={locale} languages={languages} />
                </TextLink>
              </DataCell>
              <DataCell wrap>
                <span dir="ltr">{science.slug}</span>
              </DataCell>
              <DataCell wrap>
                <SourceName
                  source={
                    science.sourceSystemId === null
                      ? undefined
                      : sourceById.get(science.sourceSystemId)
                  }
                  copy={copy}
                />
              </DataCell>
              <DataCell>
                <StateBadge state={science.state} copy={copy} />
              </DataCell>
              <DataCell>{science.version}</DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
      <Pager
        offset={offset}
        total={page.total}
        hrefFor={(number) => (number > 1 ? `${base}?page=${String(number)}` : base)}
        label={t('surface.sciences')}
        copy={copy}
      />

      {administer ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('sciences.create')}</SectionHeading>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('createHelp')}
            </p>
            <ScienceForm
              locale={locale}
              record={null}
              sources={sources}
              languages={languages}
              copy={copy}
            />
          </div>
        </Panel>
      ) : null}
    </main>
  );
}

export async function ScienceEditor({ params }: EditorParams) {
  const locale = await requireLocale(params);
  const id = recordTarget((await params).id);
  const list = `/${locale}/admin/hadith/sciences`;
  const context = await requireAdminPage(locale, 'hadith.read', `${list}/${id}`);
  const copy = await hadithCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const administer = context.authorization.can('hadith.administer');
  const service = hadithRuntime().hadith;

  const record = await service.science(actor, id);
  if (record === null) notFound();

  const [sources, languages] = await Promise.all([
    service.sourceSystems(actor),
    languageIndex(),
  ]);
  const source =
    record.sourceSystemId === null
      ? undefined
      : sources.find((entry) => entry.id === record.sourceSystemId);

  return (
    <main className="flex flex-col gap-8">
      <EditorHeading
        base={list}
        locale={locale}
        title={<ScienceTitle science={record} locale={locale} languages={languages} />}
        record={record}
        copy={copy}
      />

      <Panel>
        <section className="flex flex-col gap-4" aria-labelledby="science-state">
          <SectionHeading>
            <span id="science-state">{t('stateTitle')}</span>
          </SectionHeading>
          <p className="text-sm">
            {t('source')}: <SourceName source={source} copy={copy} />
          </p>
          {administer ? (
            <StateControls kind="science" locale={locale} record={record} copy={copy} />
          ) : null}
        </section>
      </Panel>

      <Panel>
        <section className="flex flex-col gap-4" aria-labelledby="science-details">
          <SectionHeading>
            <span id="science-details">{t('details')}</span>
          </SectionHeading>
          {administer ? (
            <ScienceForm
              locale={locale}
              record={record}
              sources={sources}
              languages={languages}
              copy={copy}
            />
          ) : (
            <ol className="flex flex-col gap-4">
              {record.texts.map((text) => {
                const direction = languages.get(text.languageCode)?.direction ?? 'auto';
                return (
                  <li key={text.languageCode} className="flex flex-col gap-1">
                    <span className="text-xs">
                      {languageText(text.languageCode, languages)}
                    </span>
                    <span
                      lang={text.languageCode}
                      dir={direction}
                      className="font-medium"
                    >
                      {text.title}
                    </span>
                    <p
                      lang={text.languageCode}
                      dir={direction}
                      className="text-sm whitespace-pre-wrap wrap-anywhere"
                    >
                      {text.body}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </Panel>
    </main>
  );
}

function ScienceForm({
  locale,
  record,
  sources,
  languages,
  copy,
}: {
  readonly locale: Locale;
  /** `null` creates. An existing record edits, and carries its expected version. */
  readonly record: HadithScienceRecord | null;
  readonly sources: readonly HadithSourceSystemRecord[];
  readonly languages: ReadonlyMap<string, LanguageView>;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? 'new-science' : 'science';
  const texts = record?.texts ?? [];
  // Every text the entry has, and one more empty row while the schema allows it.
  const rows = Math.min(TEXT_ROWS, texts.length + 1);

  return (
    <ActionForm
      action={saveHadithScience}
      submitLabel={record === null ? t('createSubmit') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
      preserveInput
    >
      <EditIdentity locale={locale} record={record} />
      <SlugField prefix={prefix} slug={record?.slug ?? null} copy={copy} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${prefix}-position`}
          label={t('position')}
          help={t('sciences.positionHelp')}
        >
          {(props) => (
            <TextInput
              {...props}
              name="position"
              type="number"
              required
              min={0}
              max={HADITH_LIMITS.sciences}
              inputMode="numeric"
              defaultValue={record?.position ?? 0}
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
              defaultValue={record?.attribution ?? ''}
              maxLength={HADITH_LIMITS.attribution}
              dir="auto"
            />
          )}
        </Field>
      </div>
      <SourceSelect
        id={`${prefix}-source`}
        sources={sources}
        selected={record?.sourceSystemId ?? null}
        copy={copy}
      />

      <fieldset className="flex flex-col gap-4">
        <legend className="text-sm font-semibold">{t('sciences.texts')}</legend>
        <p className="text-xs text-[color:var(--color-foreground-muted)]">
          {t('sciences.textsHelp')}
        </p>
        {Array.from({ length: rows }, (_, index) => {
          const text = texts[index];
          const direction =
            text === undefined
              ? 'auto'
              : (languages.get(text.languageCode)?.direction ?? 'auto');
          const offered = [...languages.values()].filter(
            (language) =>
              language.status === 'active' || language.code === text?.languageCode,
          );
          return (
            <div key={index} className="flex flex-col gap-3">
              <Field
                id={`${prefix}-text-language-${String(index)}`}
                label={t('sciences.textLanguage', { number: index + 1 })}
              >
                {(props) => (
                  <Select
                    {...props}
                    name={`text-language-${String(index)}`}
                    defaultValue={text?.languageCode ?? ''}
                  >
                    <option value="">{t('none')}</option>
                    {offered.map((language) => (
                      <option key={language.code} value={language.code}>
                        {languageText(language.code, languages)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                id={`${prefix}-text-title-${String(index)}`}
                label={t('sciences.textTitle', { number: index + 1 })}
              >
                {(props) => (
                  <TextInput
                    {...props}
                    name={`text-title-${String(index)}`}
                    defaultValue={text?.title ?? ''}
                    maxLength={HADITH_LIMITS.scienceTitle}
                    lang={text?.languageCode}
                    dir={direction}
                  />
                )}
              </Field>
              <Field
                id={`${prefix}-text-body-${String(index)}`}
                label={t('sciences.textBody', { number: index + 1 })}
                help={t('exactTextHelp')}
              >
                {(props) => (
                  <TextArea
                    {...props}
                    name={`text-body-${String(index)}`}
                    rows={8}
                    defaultValue={text?.body ?? ''}
                    maxLength={HADITH_LIMITS.scienceBody}
                    lang={text?.languageCode}
                    dir={direction}
                  />
                )}
              </Field>
            </div>
          );
        })}
      </fieldset>
    </ActionForm>
  );
}
