import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  QURAN_LIMITS,
  QURAN_PAGE,
  QURAN_SURAH_MAX,
  TAFSIR_CONTRIBUTOR_ROLES,
  TRANSLATION_CONTRIBUTOR_ROLES,
  numericSegment,
  type AyahRecord,
  type LayerText,
  type QuranActor,
  type QuranContributorRef,
  type QuranPage,
  type QuranSourceRecord,
  type SurahRecord,
  type TafsirEntryRecord,
  type TafsirRecord,
  type TranslationRecord,
  type TransliterationRecord,
} from '@minhaj/contracts/quran';
import type { LanguageView } from '@minhaj/contracts/taxonomy';

import { requireAdminPage } from '@/composition/authorization';
import { quranRuntime } from '@/composition/quran';
import {
  DataCell,
  DataRow,
  DataTable,
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
  removeTafsirEntry,
  saveLayerTexts,
  saveTafsir,
  saveTafsirEntry,
  saveTranslation,
  saveTransliteration,
} from './actions';
import {
  actorOf,
  EditIdentity,
  EditorHeading,
  LanguageSelect,
  languageIndex,
  languageText,
  Pager,
  PeopleSearch,
  peopleChoices,
  quranCopy,
  recordTarget,
  Scripture,
  SourceName,
  SlugField,
  SourceSelect,
  StateBadge,
  StateControls,
  SurahPicker,
  surahText,
  type Copy,
  type EditorParams,
  type ListParams,
  type PersonChoice,
} from './shared';

/**
 * The layered works — Translations, Transliterations and Tafsir (ROUTE_MAP.md
 * §7: `/admin/quran/{translations|transliterations|tafsir}`), Phase 18.
 *
 * EACH IS ITS OWN WORK, never a field on the Ayah (DOMAIN_MODEL.md §8.2): its
 * own identity, source, lifecycle and version. `quran.administer` manages them
 * and NOTHING HERE TOUCHES CANONICAL TEXT — the Arabic shown beside a text
 * field is read-only context, and the actions behind these forms have no path
 * that writes it (SECURITY_BASELINE.md §5.1 rule 2).
 *
 * A SOURCE IS CHOSEN, NEVER CREATED. The source selector lists the registered
 * sources; only the owner/operator can register one, and publication requires
 * one, so no administrator self-approves a work.
 *
 * TEXT IS SAVED EXACTLY AS ENTERED. One plain textarea per Ayah, no rich-text
 * editor (§5.3); only the ayat that changed are sent, an emptied field removes
 * that ayah's text, and surrounding whitespace is refused rather than trimmed.
 * Each page of a Surah's editor carries at most one listing page of ayat, which
 * keeps every save comfortably inside the Server Action body cap.
 */

export type LayerKind = 'translation' | 'transliteration' | 'tafsir';

type LayerRecord = TranslationRecord | TransliterationRecord | TafsirRecord;

const PATHS: Record<LayerKind, 'translations' | 'transliterations' | 'tafsir'> = {
  translation: 'translations',
  transliteration: 'transliterations',
  tafsir: 'tafsir',
};

function listOf(
  kind: LayerKind,
  actor: QuranActor,
  offset: number,
): Promise<QuranPage<LayerRecord>> {
  const service = quranRuntime().quran;
  if (kind === 'translation') return service.translations(actor, offset);
  if (kind === 'transliteration') return service.transliterations(actor, offset);
  return service.tafsirs(actor, offset);
}

function recordOf(
  kind: LayerKind,
  actor: QuranActor,
  id: string,
): Promise<LayerRecord | null> {
  const service = quranRuntime().quran;
  if (kind === 'translation') return service.translation(actor, id);
  if (kind === 'transliteration') return service.transliteration(actor, id);
  return service.tafsir(actor, id);
}

function contributorsOf(record: LayerRecord | null): readonly QuranContributorRef[] {
  return record !== null && 'contributors' in record ? record.contributors : [];
}

/* ===========================================================================
 * Directories
 * ========================================================================= */

async function Directory(kind: LayerKind, { params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const path = PATHS[kind];
  const base = `/${locale}/admin/quran/${path}`;
  const context = await requireAdminPage(locale, 'quran.read', base);
  const copy = await quranCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const administer = context.authorization.can('quran.administer');
  const offset = pageOffset(query, QURAN_PAGE);
  const reference = queryValue(query, 'q') ?? '';

  const [page, status, languages] = await Promise.all([
    listOf(kind, actor, offset),
    quranRuntime().quran.corpusStatus(actor),
    languageIndex(),
  ]);
  const sources = new Map(status.sources.map((source) => [source.id, source]));
  const people =
    administer && kind !== 'transliteration'
      ? await peopleChoices(locale, reference, [], copy)
      : null;

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t(`surface.${path}`)}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t(`scope.${path}`)}
      </p>

      {page.items.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t(`surface.${path}`)}
          columns={[
            t('name'),
            t('slug'),
            t('language.label'),
            t('source'),
            t('state'),
            kind === 'tafsir' ? t('tafsir.entries') : t('texts.count'),
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
                  source={item.sourceId === null ? undefined : sources.get(item.sourceId)}
                  copy={copy}
                />
              </DataCell>
              <DataCell>
                <StateBadge state={item.state} copy={copy} />
              </DataCell>
              <DataCell>{item.textCount}</DataCell>
              <DataCell>{item.version}</DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
      <Pager
        offset={offset}
        total={page.total}
        hrefFor={(number) => (number > 1 ? `${base}?page=${String(number)}` : base)}
        label={t(`surface.${path}`)}
        copy={copy}
      />

      {administer ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t(`create.${path}`)}</SectionHeading>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('createHelp')}
            </p>
            {people === null ? null : <PeopleSearch query={reference} copy={copy} />}
            <WorkForm
              kind={kind}
              locale={locale}
              record={null}
              sources={status.sources}
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

export function TranslationDirectory(props: ListParams) {
  return Directory('translation', props);
}

export function TransliterationDirectory(props: ListParams) {
  return Directory('transliteration', props);
}

export function TafsirDirectory(props: ListParams) {
  return Directory('tafsir', props);
}

/* ===========================================================================
 * Editors
 * ========================================================================= */

async function Editor(kind: LayerKind, { params, searchParams }: EditorParams) {
  const locale = await requireLocale(params);
  const id = recordTarget((await params).id);
  const query = await searchParams;
  const path = PATHS[kind];
  const list = `/${locale}/admin/quran/${path}`;
  const base = `${list}/${id}`;
  const context = await requireAdminPage(locale, 'quran.read', base);
  const copy = await quranCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const administer = context.authorization.can('quran.administer');

  const record = await recordOf(kind, actor, id);
  if (record === null) notFound();

  const reference = queryValue(query, 'q') ?? '';
  const named = contributorsOf(record).map((entry) => entry.personId);
  const [status, languages, surahs, people] = await Promise.all([
    quranRuntime().quran.corpusStatus(actor),
    languageIndex(),
    quranRuntime().quran.surahs(actor),
    kind === 'transliteration'
      ? Promise.resolve(null)
      : administer
        ? peopleChoices(locale, reference, named, copy)
        : peopleChoices(locale, '', named, copy),
  ]);
  const source =
    record.sourceId === null
      ? undefined
      : status.sources.find((entry) => entry.id === record.sourceId);
  const chosen = numericSegment(queryValue(query, 'surah') ?? '', QURAN_SURAH_MAX);
  const surah =
    chosen === null ? undefined : surahs.find((entry) => entry.number === chosen);

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
            <StateControls kind={kind} locale={locale} record={record} copy={copy} />
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
              {people === null ? null : (
                <PeopleSearch
                  query={reference}
                  copy={copy}
                  keep={surah === undefined ? {} : { surah: String(surah.number) }}
                />
              )}
              <WorkForm
                kind={kind}
                locale={locale}
                record={record}
                sources={status.sources}
                languages={languages}
                people={people?.options ?? []}
                copy={copy}
              />
            </>
          ) : (
            <WorkFacts
              record={record}
              languages={languages}
              names={people?.names ?? new Map()}
              copy={copy}
            />
          )}
        </section>
      </Panel>

      {/* ---- Texts -------------------------------------------------------- */}
      <section className="flex flex-col gap-4" aria-labelledby="work-texts">
        <SectionHeading>
          <span id="work-texts">
            {kind === 'tafsir' ? t('tafsir.entries') : t('texts.title')}
          </span>
        </SectionHeading>
        {surahs.length === 0 ? (
          <EmptyState>{t('texts.noCorpus')}</EmptyState>
        ) : (
          <SurahPicker
            action={base}
            surahs={surahs}
            selected={surah?.number ?? null}
            locale={locale}
            copy={copy}
          />
        )}
        {surah === undefined ? null : kind === 'tafsir' ? (
          <TafsirEntries
            locale={locale}
            record={record}
            surah={surah}
            language={languages.get(record.languageCode)}
            administer={administer}
            copy={copy}
            entries={await quranRuntime().quran.tafsirEntries(
              actor,
              record.id,
              surah.number,
            )}
          />
        ) : (
          <LayerTexts
            kind={kind}
            locale={locale}
            base={base}
            record={record}
            surah={surah}
            language={languages.get(record.languageCode)}
            administer={administer}
            copy={copy}
            offset={pageOffset(query, QURAN_PAGE)}
            actor={actor}
          />
        )}
      </section>
    </main>
  );
}

export function TranslationEditor(props: EditorParams) {
  return Editor('translation', props);
}

export function TransliterationEditor(props: EditorParams) {
  return Editor('transliteration', props);
}

export function TafsirEditor(props: EditorParams) {
  return Editor('tafsir', props);
}

/* ===========================================================================
 * Metadata
 * ========================================================================= */

function WorkForm({
  kind,
  locale,
  record,
  sources,
  languages,
  people,
  copy,
}: {
  readonly kind: LayerKind;
  readonly locale: Locale;
  /** `null` creates. An existing record edits, and carries its expected version. */
  readonly record: LayerRecord | null;
  readonly sources: readonly QuranSourceRecord[];
  readonly languages: ReadonlyMap<string, LanguageView>;
  readonly people: readonly PersonChoice[];
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? `new-${kind}` : kind;
  const action =
    kind === 'translation'
      ? saveTranslation
      : kind === 'transliteration'
        ? saveTransliteration
        : saveTafsir;

  return (
    <ActionForm
      action={action}
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
            maxLength={QURAN_LIMITS.name}
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
            maxLength={QURAN_LIMITS.description}
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
            maxLength={QURAN_LIMITS.attribution}
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
          selected={record?.sourceId ?? null}
          copy={copy}
        />
      </div>
      {kind === 'transliteration' ? (
        <Field id={`${prefix}-scheme`} label={t('scheme')} help={t('schemeHelp')}>
          {(props) => (
            <TextArea
              {...props}
              name="scheme"
              rows={3}
              defaultValue={
                record !== null && 'scheme' in record ? (record.scheme ?? '') : ''
              }
              maxLength={QURAN_LIMITS.description}
              dir="auto"
            />
          )}
        </Field>
      ) : (
        <ContributorFields
          prefix={prefix}
          roles={
            kind === 'tafsir' ? TAFSIR_CONTRIBUTOR_ROLES : TRANSLATION_CONTRIBUTOR_ROLES
          }
          current={contributorsOf(record)}
          people={people}
          copy={copy}
        />
      )}
    </ActionForm>
  );
}

/**
 * The contributors, as People chosen by NAME with a role each. A fixed ceiling
 * of rows — the domain's own bound — offered two beyond those already named.
 */
function ContributorFields({
  prefix,
  roles,
  current,
  people,
  copy,
}: {
  readonly prefix: string;
  readonly roles: readonly string[];
  readonly current: readonly QuranContributorRef[];
  readonly people: readonly PersonChoice[];
  readonly copy: Copy;
}) {
  const { t } = copy;
  const ordered = [...current].sort((a, b) => a.position - b.position);
  const rows = Math.min(QURAN_LIMITS.contributors, Math.max(2, ordered.length + 2));
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="text-sm font-semibold">{t('contributors.title')}</legend>
      <p className="text-xs text-[color:var(--color-foreground-muted)]">
        {t('contributors.help', { limit: QURAN_LIMITS.contributors })}
      </p>
      {Array.from({ length: rows }, (_, index) => {
        const row = ordered[index];
        return (
          <div key={index} className="grid gap-3 sm:grid-cols-2">
            <Field
              id={`${prefix}-contributor-${String(index)}`}
              label={t('contributors.person', { number: index + 1 })}
            >
              {(props) => (
                <Select
                  {...props}
                  name={`contributor-${String(index)}`}
                  defaultValue={row?.personId ?? ''}
                >
                  <option value="">{t('none')}</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              id={`${prefix}-role-${String(index)}`}
              label={t('contributors.role', { number: index + 1 })}
            >
              {(props) => (
                <Select
                  {...props}
                  name={`role-${String(index)}`}
                  defaultValue={row?.role ?? roles[0]}
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {t(`contributors.roleName.${role as 'translator'}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        );
      })}
    </fieldset>
  );
}

/** What a reader without `quran.administer` sees in place of the form. */
function WorkFacts({
  record,
  languages,
  names,
  copy,
}: {
  readonly record: LayerRecord;
  readonly languages: ReadonlyMap<string, LanguageView>;
  readonly names: ReadonlyMap<string, string>;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const contributors = contributorsOf(record);
  return (
    <dl className="flex flex-col gap-2 text-sm">
      <div>
        <dt className="font-medium">{t('language.label')}</dt>
        <dd>{languageText(record.languageCode, languages)}</dd>
      </div>
      <div>
        <dt className="font-medium">{t('description')}</dt>
        <dd dir="auto">{record.description ?? t('none')}</dd>
      </div>
      <div>
        <dt className="font-medium">{t('attribution')}</dt>
        <dd dir="auto">{record.attribution ?? t('none')}</dd>
      </div>
      {'scheme' in record ? (
        <div>
          <dt className="font-medium">{t('scheme')}</dt>
          <dd dir="auto">{record.scheme ?? t('none')}</dd>
        </div>
      ) : (
        <div>
          <dt className="font-medium">{t('contributors.title')}</dt>
          <dd>
            {contributors.length === 0 ? (
              t('none')
            ) : (
              <ul>
                {contributors.map((entry) => (
                  <li key={`${entry.personId}:${entry.role}`}>
                    {names.get(entry.personId) ?? t('personUnavailable')} —{' '}
                    {t(`contributors.roleName.${entry.role}`)}
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </div>
      )}
    </dl>
  );
}

/* ===========================================================================
 * Translation and Transliteration texts
 * ========================================================================= */

async function LayerTexts({
  kind,
  locale,
  base,
  record,
  surah,
  language,
  administer,
  copy,
  offset,
  actor,
}: {
  readonly kind: 'translation' | 'transliteration';
  readonly locale: Locale;
  readonly base: string;
  readonly record: LayerRecord;
  readonly surah: SurahRecord;
  readonly language: LanguageView | undefined;
  readonly administer: boolean;
  readonly copy: Copy;
  readonly offset: number;
  readonly actor: QuranActor;
}) {
  const { t } = copy;
  const service = quranRuntime().quran;
  const [texts, canonical]: [readonly LayerText[], QuranPage<AyahRecord>] =
    await Promise.all([
      kind === 'translation'
        ? service.translationTexts(actor, record.id, surah.number)
        : service.transliterationTexts(actor, record.id, surah.number),
      service.surahAyat(actor, surah.number, offset),
    ]);
  const byAyah = new Map(texts.map((entry) => [entry.ayah, entry.text]));
  const direction = language?.direction ?? 'ltr';
  const label = surahText(surah, locale, copy);

  if (canonical.items.length === 0) return <EmptyState>{t('empty')}</EmptyState>;

  const fields = canonical.items.map((ayah) => (
    <div key={ayah.ayah} className="flex flex-col gap-2">
      <Scripture text={ayah.text} />
      {administer ? (
        <Field
          id={`text-${String(ayah.ayah)}`}
          label={t('ayahName', { surah: ayah.surah, ayah: ayah.ayah })}
        >
          {(props) => (
            <TextArea
              {...props}
              name={`text-${String(ayah.ayah)}`}
              rows={3}
              defaultValue={byAyah.get(ayah.ayah) ?? ''}
              maxLength={QURAN_LIMITS.layerText}
              lang={record.languageCode}
              dir={direction}
            />
          )}
        </Field>
      ) : (
        <p className="text-sm">
          <span className="font-medium">
            {t('ayahName', { surah: ayah.surah, ayah: ayah.ayah })}:
          </span>{' '}
          {byAyah.has(ayah.ayah) ? (
            <span
              lang={record.languageCode}
              dir={direction}
              className="whitespace-pre-wrap"
            >
              {byAyah.get(ayah.ayah)}
            </span>
          ) : (
            t('texts.missing')
          )}
        </p>
      )}
    </div>
  ));

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading>{label}</SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('texts.help')}
      </p>
      {administer ? (
        <ActionForm
          action={saveLayerTexts}
          submitLabel={t('texts.save')}
          pendingLabel={t('pending')}
          messages={copy.messages}
          preserveInput
        >
          <EditIdentity locale={locale} record={record} />
          <input type="hidden" name="kind" value={kind} />
          <input type="hidden" name="surah" value={String(surah.number)} />
          {fields}
        </ActionForm>
      ) : (
        fields
      )}
      <Pager
        offset={offset}
        total={canonical.total}
        hrefFor={(number) =>
          `${base}?surah=${String(surah.number)}${number > 1 ? `&page=${String(number)}` : ''}`
        }
        label={label}
        copy={copy}
      />
    </div>
  );
}

/* ===========================================================================
 * Tafsir entries
 * ========================================================================= */

function TafsirEntries({
  locale,
  record,
  surah,
  language,
  administer,
  copy,
  entries,
}: {
  readonly locale: Locale;
  readonly record: LayerRecord;
  readonly surah: SurahRecord;
  readonly language: LanguageView | undefined;
  readonly administer: boolean;
  readonly copy: Copy;
  readonly entries: readonly TafsirEntryRecord[];
}) {
  const { t } = copy;
  const direction = language?.direction ?? 'ltr';

  return (
    <div className="flex flex-col gap-4">
      <SectionHeading>{surahText(surah, locale, copy)}</SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('tafsir.help', { count: surah.ayahCount })}
      </p>
      {entries.length === 0 ? (
        <EmptyState>{t('tafsir.empty')}</EmptyState>
      ) : (
        <ol className="flex flex-col gap-4">
          {entries.map((entry) => (
            <Panel key={entry.id} as="li">
              <div className="flex flex-col gap-3">
                <p className="text-sm font-semibold">
                  {t('tafsir.range', {
                    surah: entry.surah,
                    start: entry.startAyah,
                    end: entry.endAyah,
                  })}
                </p>
                {administer ? (
                  <>
                    <EntryForm
                      locale={locale}
                      record={record}
                      surah={surah}
                      entry={entry}
                      direction={direction}
                      copy={copy}
                    />
                    <ActionForm
                      action={removeTafsirEntry}
                      submitLabel={t('tafsir.remove')}
                      pendingLabel={t('pending')}
                      messages={copy.messages}
                      tone="destructive"
                    >
                      <EditIdentity locale={locale} record={record} />
                      <input type="hidden" name="entryId" value={entry.id} />
                    </ActionForm>
                  </>
                ) : (
                  <p
                    lang={record.languageCode}
                    dir={direction}
                    className="text-sm whitespace-pre-wrap"
                  >
                    {entry.text}
                  </p>
                )}
              </div>
            </Panel>
          ))}
        </ol>
      )}
      {administer ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('tafsir.add')}</SectionHeading>
            <EntryForm
              locale={locale}
              record={record}
              surah={surah}
              entry={null}
              direction={direction}
              copy={copy}
            />
          </div>
        </Panel>
      ) : null}
    </div>
  );
}

/** One Tafsir entry: a same-Surah range and its text. `null` adds. */
function EntryForm({
  locale,
  record,
  surah,
  entry,
  direction,
  copy,
}: {
  readonly locale: Locale;
  readonly record: LayerRecord;
  readonly surah: SurahRecord;
  readonly entry: TafsirEntryRecord | null;
  readonly direction: 'ltr' | 'rtl';
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = entry === null ? 'new-entry' : `entry-${entry.id}`;
  return (
    <ActionForm
      action={saveTafsirEntry}
      submitLabel={entry === null ? t('tafsir.addSubmit') : t('tafsir.replace')}
      pendingLabel={t('pending')}
      messages={copy.messages}
      preserveInput
    >
      <EditIdentity locale={locale} record={record} />
      <input type="hidden" name="surah" value={String(surah.number)} />
      {entry === null ? null : <input type="hidden" name="entryId" value={entry.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${prefix}-start`} label={t('tafsir.start')}>
          {(props) => (
            <TextInput
              {...props}
              name="startAyah"
              type="number"
              required
              min={1}
              max={surah.ayahCount}
              inputMode="numeric"
              defaultValue={entry?.startAyah ?? ''}
            />
          )}
        </Field>
        <Field id={`${prefix}-end`} label={t('tafsir.end')}>
          {(props) => (
            <TextInput
              {...props}
              name="endAyah"
              type="number"
              required
              min={1}
              max={surah.ayahCount}
              inputMode="numeric"
              defaultValue={entry?.endAyah ?? ''}
            />
          )}
        </Field>
      </div>
      <Field id={`${prefix}-text`} label={t('tafsir.text')} help={t('exactTextHelp')}>
        {(props) => (
          <TextArea
            {...props}
            name="text"
            required
            rows={8}
            defaultValue={entry?.text ?? ''}
            maxLength={QURAN_LIMITS.tafsirText}
            lang={record.languageCode}
            dir={direction}
          />
        )}
      </Field>
    </ActionForm>
  );
}
