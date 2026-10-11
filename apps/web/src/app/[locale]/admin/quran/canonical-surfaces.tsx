import { NextIntlClientProvider } from 'next-intl';
import { getMessages, getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  QURAN_AYAH_NUMBER_MAX,
  QURAN_LIMITS,
  QURAN_PAGE,
  QURAN_SURAH_MAX,
  numericSegment,
  quranIdSchema,
  type QuranSourceRecord,
  type VerificationMismatch,
} from '@minhaj/contracts/quran';

import { requireAdminPage } from '@/composition/authorization';
import { quranRuntime } from '@/composition/quran';
import { taxonomyRuntime } from '@/composition/taxonomy';
import {
  Alert,
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
  StatusBadge,
  TextInput,
  TextLink,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { adminCopy, pageOffset, queryValue } from '../shared';
import { StepUpPrompt } from '../step-up';
import { changeAyahTopic, saveSurahNames } from './actions';
import { CorrectionForm } from './correction-form';
import {
  actorOf,
  AuthorityBadge,
  DateText,
  Pager,
  quranCopy,
  Scripture,
  SourceName,
  sourceOption,
  SUBMIT_CLASSES,
  SurahPicker,
  surahText,
  type Copy,
  type ListParams,
  type Query,
} from './shared';

/**
 * The canonical screens — corpus status, Surahs, Ayat and one Ayah
 * (ROUTE_MAP.md §7: `/admin/quran/{surahs|ayat}`), Phase 18.
 *
 * EVIDENCE, NOT CONTROLS. The corpus status shows which registered source is
 * active and in which mode, every registered source with its authority, and the
 * recent verification runs. None of it can be changed here: sources are
 * registered and a corpus accepted by the owner/operator on the host, so there
 * is no import screen and no button that turns a fixture into an authority.
 *
 * READ-ONLY CANONICAL TEXT, WITH ONE PROTECTED EXCEPTION. An Ayah's Arabic is
 * shown everywhere and editable nowhere — except the correction flow on that
 * Ayah's own page, which is absent from the markup without
 * `quran.editCanonical`, asks for a step-up grant for `quran-canonical-edit`,
 * shows the server-computed difference against a CHOSEN registered source, and
 * corrects one Ayah at a time to that source's text. There is no bulk edit.
 */

/* ===========================================================================
 * Shared
 * ========================================================================= */

const REASON_KEYS = {
  'malformed-encoding': 'malformedEncoding',
  'unsupported-encoding': 'unsupportedEncoding',
  'unknown-reference': 'unknownReference',
  'duplicate-reference': 'duplicateReference',
  'missing-reference': 'missingReference',
  'juz-mismatch': 'juzMismatch',
  'text-mismatch': 'textMismatch',
} as const;

/** A recorded mismatch in words: its category, reference and position — never text. */
function MismatchText({
  mismatch,
  copy,
}: {
  readonly mismatch: VerificationMismatch;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <span>
      {t(`correction.reason.${REASON_KEYS[mismatch.reason]}`)}
      {mismatch.ref === null ? null : (
        <>
          {' — '}
          <span dir="ltr">
            {t('correction.reference', {
              surah: mismatch.ref.surah,
              ayah: mismatch.ref.ayah,
            })}
          </span>
        </>
      )}
      {mismatch.offset === null ? null : (
        <>
          {' — '}
          {t('correction.offset', { offset: mismatch.offset })}
        </>
      )}
    </span>
  );
}

function sourceIndex(sources: readonly QuranSourceRecord[]) {
  return new Map(sources.map((source) => [source.id, source]));
}

/* ===========================================================================
 * Surahs — corpus status, sources, verification runs and display names
 * ========================================================================= */

export async function SurahsScreen({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/quran/surahs`;
  const context = await requireAdminPage(locale, 'quran.read', base);
  const copy = await quranCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const service = quranRuntime().quran;

  const [status, surahs] = await Promise.all([
    service.corpusStatus(actor),
    service.surahs(actor),
  ]);
  const sources = sourceIndex(status.sources);
  const administer = context.authorization.can('quran.administer');
  const editing = numericSegment(queryValue(query, 'edit') ?? '', QURAN_SURAH_MAX);
  const selected =
    editing === null ? undefined : surahs.find((surah) => surah.number === editing);

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.surahs')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scope.surahs')}
      </p>

      {/* ---- Corpus status ------------------------------------------------ */}
      <Panel>
        <section className="flex flex-col gap-4" aria-labelledby="corpus-status">
          <SectionHeading>
            <span id="corpus-status">{t('corpus.title')}</span>
          </SectionHeading>
          {status.activation === null ? (
            <Alert tone="info">{t('corpus.inactive')}</Alert>
          ) : status.activation.authority === 'fixture' ? (
            <Alert tone="warning">{t('corpus.fixture')}</Alert>
          ) : (
            <Alert tone="success">{t('corpus.approved')}</Alert>
          )}
          <dl className="flex flex-col">
            {status.activation === null ? null : (
              <>
                <DetailRow term={t('corpus.activeSource')}>
                  <SourceName
                    source={sources.get(status.activation.sourceId)}
                    copy={copy}
                  />
                </DetailRow>
                <DetailRow term={t('corpus.activatedAt')}>
                  <DateText date={status.activation.activatedAt} locale={locale} time />
                </DetailRow>
                <DetailRow term={t('corpus.authorisedBy')}>
                  <span dir="auto">{status.activation.authorisedBy}</span>
                </DetailRow>
              </>
            )}
            <DetailRow term={t('corpus.surahs')}>{status.surahs}</DetailRow>
            <DetailRow term={t('corpus.ayat')}>{status.ayat}</DetailRow>
            <DetailRow term={t('corpus.juz')}>{status.juz}</DetailRow>
          </dl>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('corpus.operatorOnly')}
          </p>
        </section>
      </Panel>

      {/* ---- Registered sources ------------------------------------------ */}
      <section className="flex flex-col gap-4" aria-labelledby="sources">
        <SectionHeading>
          <span id="sources">{t('sources.title')}</span>
        </SectionHeading>
        {status.sources.length === 0 ? (
          <EmptyState>{t('sources.empty')}</EmptyState>
        ) : (
          <DataTable
            caption={t('sources.title')}
            columns={[
              t('sources.titleColumn'),
              t('sources.code'),
              t('sources.authority'),
              t('sources.encoding'),
              t('sources.reference'),
              t('sources.ayat'),
              t('sources.registered'),
            ]}
          >
            {status.sources.map((source) => (
              <DataRow key={source.id}>
                <DataCell wrap>
                  <span dir="auto">{source.title}</span>
                  {source.script === null ? null : (
                    <span className="block text-xs" dir="auto">
                      {source.script}
                    </span>
                  )}
                </DataCell>
                <DataCell>
                  <span dir="ltr">
                    {source.code} · {source.version}
                  </span>
                </DataCell>
                <DataCell>
                  <AuthorityBadge authority={source.authority} copy={copy} />
                </DataCell>
                <DataCell>
                  <span dir="ltr">{source.encoding}</span>
                </DataCell>
                <DataCell wrap>
                  {source.reference === null ? (
                    t('none')
                  ) : (
                    <span dir="auto">{source.reference}</span>
                  )}
                </DataCell>
                <DataCell>{source.ayahCount}</DataCell>
                <DataCell>
                  <DateText date={source.createdAt} locale={locale} />
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
      </section>

      {/* ---- Verification evidence --------------------------------------- */}
      <section className="flex flex-col gap-4" aria-labelledby="runs">
        <SectionHeading>
          <span id="runs">{t('runs.title')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('runs.help')}
        </p>
        {status.recentRuns.length === 0 ? (
          <EmptyState>{t('runs.empty')}</EmptyState>
        ) : (
          <DataTable
            caption={t('runs.title')}
            columns={[
              t('runs.when'),
              t('runs.kind'),
              t('runs.outcome'),
              t('runs.source'),
              t('runs.checked'),
              t('runs.mismatches'),
              t('runs.first'),
            ]}
          >
            {status.recentRuns.map((run) => (
              <DataRow key={run.id}>
                <DataCell>
                  <DateText date={run.createdAt} locale={locale} time />
                </DataCell>
                <DataCell>{t(`runs.kindName.${run.kind}`)}</DataCell>
                <DataCell>
                  <StatusBadge tone={run.outcome === 'passed' ? 'positive' : 'caution'}>
                    {t(`runs.outcomeName.${run.outcome}`)}
                  </StatusBadge>
                </DataCell>
                <DataCell wrap>
                  <SourceName source={sources.get(run.sourceId)} copy={copy} />
                </DataCell>
                <DataCell>{run.checked}</DataCell>
                <DataCell>{run.mismatches}</DataCell>
                <DataCell wrap>
                  {run.first === null ? (
                    t('none')
                  ) : (
                    <MismatchText mismatch={run.first} copy={copy} />
                  )}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
      </section>

      {/* ---- Surahs ------------------------------------------------------- */}
      <section className="flex flex-col gap-4" aria-labelledby="surah-list">
        <SectionHeading>
          <span id="surah-list">{t('surahs.title')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('surahs.help')}
        </p>
        {surahs.length === 0 ? (
          <EmptyState>{t('surahs.empty')}</EmptyState>
        ) : (
          <DataTable
            caption={t('surahs.title')}
            columns={[
              t('surahs.number'),
              t('surahs.sourceName'),
              t('surahs.displayNames'),
              t('surahs.ayahCount'),
              t('surahs.revelation'),
              ...(administer ? [t('surahs.actions')] : []),
            ]}
          >
            {surahs.map((surah) => (
              <DataRow key={surah.number}>
                <DataCell>{surah.number}</DataCell>
                <DataCell>
                  {surah.nameArabic === null ? (
                    t('none')
                  ) : (
                    <span lang="ar" dir="rtl">
                      {surah.nameArabic}
                    </span>
                  )}
                </DataCell>
                <DataCell wrap>
                  <ul className="flex flex-col">
                    {localeSchema.options.map((language) => (
                      <li key={language}>
                        {t(`language.${language}`)}:{' '}
                        {surah.names[language] === undefined ? (
                          t('none')
                        ) : (
                          <span lang={language} dir={directionOf(language)}>
                            {surah.names[language]}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </DataCell>
                <DataCell>{surah.ayahCount}</DataCell>
                <DataCell>
                  {surah.revelation === null
                    ? t('none')
                    : t(`revelation.${surah.revelation}`)}
                </DataCell>
                {administer ? (
                  <DataCell>
                    <TextLink href={`${base}?edit=${String(surah.number)}#names`}>
                      {t('surahs.editNames')}
                    </TextLink>
                  </DataCell>
                ) : null}
              </DataRow>
            ))}
          </DataTable>
        )}
      </section>

      {administer && selected !== undefined ? (
        <Panel>
          <section className="flex flex-col gap-4" aria-labelledby="names">
            <SectionHeading>
              <span id="names">
                {t('surahs.namesTitle', { name: surahText(selected, locale, copy) })}
              </span>
            </SectionHeading>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('surahs.namesHelp')}
            </p>
            <ActionForm
              action={saveSurahNames}
              submitLabel={t('save')}
              pendingLabel={t('pending')}
              messages={copy.messages}
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="surah" value={String(selected.number)} />
              <input type="hidden" name="version" value={String(selected.namesVersion)} />
              {localeSchema.options.map((language) => (
                <Field
                  key={language}
                  id={`surah-name-${language}`}
                  label={t('nameIn', { language: t(`language.${language}`) })}
                >
                  {(props) => (
                    <TextInput
                      {...props}
                      name={`name-${language}`}
                      defaultValue={selected.names[language] ?? ''}
                      maxLength={QURAN_LIMITS.surahName}
                      lang={language}
                      dir={directionOf(language)}
                    />
                  )}
                </Field>
              ))}
            </ActionForm>
          </section>
        </Panel>
      ) : null}
    </main>
  );
}

/* ===========================================================================
 * Ayat — one Surah's canonical text, paged and read-only
 * ========================================================================= */

export async function AyatScreen({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/quran/ayat`;
  const context = await requireAdminPage(locale, 'quran.read', base);
  const copy = await quranCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const service = quranRuntime().quran;

  const surahs = await service.surahs(actor);
  const chosen = numericSegment(queryValue(query, 'surah') ?? '', QURAN_SURAH_MAX);
  const surah =
    chosen === null ? undefined : surahs.find((entry) => entry.number === chosen);
  const offset = pageOffset(query, QURAN_PAGE);
  const page =
    surah === undefined ? null : await service.surahAyat(actor, surah.number, offset);

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.ayat')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scope.ayat')}
      </p>

      {surahs.length === 0 ? (
        <EmptyState>{t('surahs.empty')}</EmptyState>
      ) : (
        <SurahPicker
          action={base}
          surahs={surahs}
          selected={surah?.number ?? null}
          locale={locale}
          copy={copy}
        />
      )}

      {surah === undefined || page === null ? null : (
        <section className="flex flex-col gap-4" aria-labelledby="ayat-list">
          <SectionHeading>
            <span id="ayat-list">{surahText(surah, locale, copy)}</span>
          </SectionHeading>
          {page.items.length === 0 ? (
            <EmptyState>{t('empty')}</EmptyState>
          ) : (
            <ol className="flex flex-col gap-4">
              {page.items.map((ayah) => (
                <Panel key={ayah.ayah} as="li">
                  <article
                    className="flex flex-col gap-2"
                    aria-label={t('ayahName', { surah: ayah.surah, ayah: ayah.ayah })}
                  >
                    <p className="flex flex-wrap items-center gap-3 text-sm">
                      <TextLink
                        href={`${base}/${String(ayah.surah)}/${String(ayah.ayah)}`}
                      >
                        {t('ayahName', { surah: ayah.surah, ayah: ayah.ayah })}
                      </TextLink>
                      <span>
                        {t('ayah.juz')}: {ayah.juz}
                      </span>
                      <span>
                        {t('version')}: {ayah.version}
                      </span>
                    </p>
                    <Scripture text={ayah.text} />
                  </article>
                </Panel>
              ))}
            </ol>
          )}
          <Pager
            offset={offset}
            total={page.total}
            hrefFor={(number) =>
              `${base}?surah=${String(surah.number)}${number > 1 ? `&page=${String(number)}` : ''}`
            }
            label={surahText(surah, locale, copy)}
            copy={copy}
          />
        </section>
      )}
    </main>
  );
}

/* ===========================================================================
 * One Ayah — facts, history, topics and the protected correction
 * ========================================================================= */

export async function AyahScreen({
  params,
  searchParams,
}: {
  readonly params: Promise<{
    readonly locale: string;
    readonly surah: string;
    readonly ayah: string;
  }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const segments = await params;
  const surahNumber = numericSegment(segments.surah, QURAN_SURAH_MAX);
  const ayahNumber = numericSegment(segments.ayah, QURAN_AYAH_NUMBER_MAX);
  if (surahNumber === null || ayahNumber === null) notFound();

  const query = await searchParams;
  const list = `/${locale}/admin/quran/ayat`;
  const base = `${list}/${String(surahNumber)}/${String(ayahNumber)}`;
  const context = await requireAdminPage(locale, 'quran.read', base);
  const copy = await quranCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const service = quranRuntime().quran;
  const ref = { surah: surahNumber, ayah: ayahNumber };

  const detail = await service.ayah(actor, ref);
  if (detail === null) notFound();

  const administer = context.authorization.can('quran.administer');
  const canonical = context.authorization.can('quran.editCanonical');
  const [status, surahs, assigned, tree] = await Promise.all([
    service.corpusStatus(actor),
    service.surahs(actor),
    taxonomyRuntime().taxonomy.topicReferences(detail.topicIds, locale),
    administer
      ? taxonomyRuntime().taxonomy.listTree({ locale, includeArchived: false })
      : Promise.resolve([]),
  ]);
  const sources = sourceIndex(status.sources);
  const surah = surahs.find((entry) => entry.number === surahNumber);
  const names = new Map(assigned.map((topic) => [topic.id, topic.name]));
  const offered = tree.filter((topic) => !detail.topicIds.includes(topic.id));
  const full = detail.topicIds.length >= QURAN_LIMITS.topicsPerAyah;

  return (
    <main className="flex flex-col gap-8">
      <p className="text-sm">
        <TextLink href={`${list}?surah=${String(surahNumber)}`}>
          {t('backToList')}
        </TextLink>
      </p>
      <div className="flex flex-col gap-2">
        <PageHeading>
          {t('ayahName', { surah: surahNumber, ayah: ayahNumber })}
        </PageHeading>
        {surah === undefined ? null : (
          <p className="text-sm">{surahText(surah, locale, copy)}</p>
        )}
      </div>

      {/* ---- Facts and canonical text ------------------------------------ */}
      <Panel>
        <section className="flex flex-col gap-4" aria-labelledby="ayah-text">
          <SectionHeading>
            <span id="ayah-text">{t('ayah.canonical')}</span>
          </SectionHeading>
          <Scripture text={detail.text} />
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('ayah.readOnly')}
          </p>
          <dl className="flex flex-col">
            <DetailRow term={t('ayah.juz')}>{detail.juz}</DetailRow>
            <DetailRow term={t('ayah.hizb')}>{detail.hizb ?? t('none')}</DetailRow>
            <DetailRow term={t('ayah.page')}>{detail.page ?? t('none')}</DetailRow>
            <DetailRow term={t('ayah.sajdah')}>
              {detail.sajdah === null ? t('none') : t(`sajdah.${detail.sajdah}`)}
            </DetailRow>
            <DetailRow term={t('version')}>{detail.version}</DetailRow>
            <DetailRow term={t('source')}>
              <SourceName source={sources.get(detail.sourceId)} copy={copy} />
            </DetailRow>
            <DetailRow term={t('updated')}>
              <DateText date={detail.updatedAt} locale={locale} time />
            </DetailRow>
          </dl>
        </section>
      </Panel>

      {/* ---- Immutable history ------------------------------------------- */}
      <section className="flex flex-col gap-4" aria-labelledby="ayah-history">
        <SectionHeading>
          <span id="ayah-history">{t('history.title')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('history.help')}
        </p>
        {detail.history.length === 0 ? (
          <EmptyState>{t('history.empty')}</EmptyState>
        ) : (
          <ol className="flex flex-col gap-4">
            {[...detail.history]
              .sort((a, b) => b.version - a.version)
              .map((revision) => (
                <Panel key={revision.version} as="li">
                  <div className="flex flex-col gap-2">
                    <p className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="font-semibold">
                        {t('history.version', { version: revision.version })}
                      </span>
                      <DateText date={revision.createdAt} locale={locale} time />
                      <SourceName source={sources.get(revision.sourceId)} copy={copy} />
                    </p>
                    <p className="text-sm">
                      {t('history.reason')}:{' '}
                      {revision.reason === null ? (
                        t('history.initial')
                      ) : (
                        <span dir="auto">{revision.reason}</span>
                      )}
                    </p>
                    <Scripture text={revision.text} />
                  </div>
                </Panel>
              ))}
          </ol>
        )}
      </section>

      {/* ---- Topics ------------------------------------------------------- */}
      <section className="flex flex-col gap-4" aria-labelledby="ayah-topics">
        <SectionHeading>
          <span id="ayah-topics">{t('topics.title')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('topics.help', {
            count: detail.topicIds.length,
            limit: QURAN_LIMITS.topicsPerAyah,
          })}
        </p>
        {detail.topicIds.length === 0 ? (
          <EmptyState>{t('topics.empty')}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3">
            {detail.topicIds.map((topicId) => (
              <li key={topicId} className="flex flex-wrap items-center gap-4">
                <span>{names.get(topicId) ?? t('topics.unavailable')}</span>
                {administer ? (
                  <ActionForm
                    action={changeAyahTopic}
                    submitLabel={t('topics.remove')}
                    pendingLabel={t('pending')}
                    messages={copy.messages}
                    tone="secondary"
                  >
                    <TopicIdentity
                      locale={locale}
                      surah={surahNumber}
                      ayah={ayahNumber}
                    />
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
              action={changeAyahTopic}
              submitLabel={t('topics.add')}
              pendingLabel={t('pending')}
              messages={copy.messages}
            >
              <TopicIdentity locale={locale} surah={surahNumber} ayah={ayahNumber} />
              <input type="hidden" name="op" value="add" />
              <Field id="ayah-topic" label={t('topics.choose')}>
                {(props) => (
                  <Select {...props} name="topicId" required defaultValue="">
                    <option value="">{t('topics.placeholder')}</option>
                    {offered.map((topic) => (
                      <option key={topic.id} value={topic.id}>
                        {topic.label.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </ActionForm>
          )
        ) : null}
      </section>

      {/* ---- Canonical correction ---------------------------------------- */}
      {canonical ? (
        <CorrectionSection
          locale={locale}
          base={base}
          query={query}
          target={ref}
          sources={status.sources}
          copy={copy}
          actor={actor}
        />
      ) : null}
    </main>
  );
}

function TopicIdentity({
  locale,
  surah,
  ayah,
}: {
  readonly locale: Locale;
  readonly surah: number;
  readonly ayah: number;
}) {
  return (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="surah" value={String(surah)} />
      <input type="hidden" name="ayah" value={String(ayah)} />
    </>
  );
}

/**
 * The protected correction, entered on purpose.
 *
 * Read-only until the operator asks to begin (`?correct=1`); then the step-up
 * prompt for exactly `quran-canonical-edit`, a choice among REGISTERED sources
 * (`?source=`), and — once one is chosen — the server-computed preview: the
 * current text, the source's text, and the first differing code-point position.
 * Only then is the confirmation form offered.
 */
async function CorrectionSection({
  locale,
  base,
  query,
  target,
  sources,
  copy,
  actor,
}: {
  readonly locale: Locale;
  readonly base: string;
  readonly query: Query;
  readonly target: { readonly surah: number; readonly ayah: number };
  readonly sources: readonly QuranSourceRecord[];
  readonly copy: Copy;
  readonly actor: { readonly accountId: string };
}) {
  const { t } = copy;
  const entered = queryValue(query, 'correct') === '1';

  if (!entered) {
    return (
      <Panel>
        <section className="flex flex-col gap-3" aria-labelledby="correction">
          <SectionHeading>
            <span id="correction">{t('correction.title')}</span>
          </SectionHeading>
          <p className="text-sm">{t('correction.intro')}</p>
          <p className="text-sm">
            <TextLink href={`${base}?correct=1#correction`}>
              {t('correction.begin')}
            </TextLink>
          </p>
        </section>
      </Panel>
    );
  }

  const [admin, stepUp, messages] = await Promise.all([
    adminCopy(locale),
    getTranslations({ locale, namespace: 'admin.stepUp' }),
    getMessages({ locale }),
  ]);
  const chosen = quranIdSchema.safeParse(queryValue(query, 'source'));
  const preview = chosen.success
    ? await quranRuntime().quran.correctionPreview(actor, target, chosen.data)
    : null;

  return (
    <section className="flex flex-col gap-6" aria-labelledby="correction">
      <div className="flex flex-col gap-2">
        <SectionHeading>
          <span id="correction">{t('correction.title')}</span>
        </SectionHeading>
        <Alert tone="warning">{t('correction.warning')}</Alert>
        <p className="text-sm">
          <TextLink href={base}>{t('correction.leave')}</TextLink>
        </p>
      </div>

      <StepUpPrompt
        locale={locale}
        purpose="quran-canonical-edit"
        labels={{ ...admin.stepUp, description: stepUp('quranCanonicalEdit') }}
      />

      {sources.length === 0 ? (
        <EmptyState>{t('sources.empty')}</EmptyState>
      ) : (
        <form method="get" action={base} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="correct" value="1" />
          <Field
            id="correction-source"
            label={t('source')}
            help={t('correction.sourceHelp')}
          >
            {(props) => (
              <Select
                {...props}
                name="source"
                required
                defaultValue={chosen.success ? chosen.data : ''}
              >
                <option value="">{t('chooseSource')}</option>
                {sources.map((source) => (
                  <option key={source.id} value={source.id}>
                    {sourceOption(source, copy)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <button type="submit" className={SUBMIT_CLASSES}>
            {t('correction.compare')}
          </button>
        </form>
      )}

      {!chosen.success ? null : preview === null ? (
        <Alert tone="error">{t('correction.sourceUnknown')}</Alert>
      ) : (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('correction.previewTitle')}</SectionHeading>
            <p className="text-sm">
              <SourceName source={preview.source} copy={copy} />
            </p>
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">
                {t('correction.current', { version: preview.ayah.version })}
              </h3>
              <Scripture text={preview.ayah.text} />
            </div>
            <div className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t('correction.sourceText')}</h3>
              {preview.sourceText === null ? (
                <Alert tone="warning">{t('correction.sourceMissing')}</Alert>
              ) : (
                <Scripture text={preview.sourceText} />
              )}
            </div>
            {preview.sourceText === null ? null : (
              <>
                <p className="text-sm">
                  {preview.firstDifference === null
                    ? t('correction.same')
                    : t('correction.firstDifference', {
                        offset: preview.firstDifference,
                      })}
                </p>
                <NextIntlClientProvider
                  locale={locale}
                  messages={{
                    quranAdmin: { correction: messages.quranAdmin.correction },
                  }}
                >
                  <CorrectionForm
                    locale={locale}
                    surah={target.surah}
                    ayah={target.ayah}
                    version={preview.ayah.version}
                    sourceId={preview.source.id}
                    identical={preview.firstDifference === null}
                    messages={copy.messages}
                  />
                </NextIntlClientProvider>
              </>
            )}
          </div>
        </Panel>
      )}
    </section>
  );
}
