import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  QURAN_LIMITS,
  QURAN_PAGE,
  RECITATION_AUDIO_MEDIA_TYPES,
  RECITATION_UPLOAD_MAX_BYTES,
  type QuranSourceRecord,
  type RecitationDetail,
  type SurahRecord,
} from '@minhaj/contracts/quran';

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
  StatusBadge,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { pageOffset, queryValue } from '../shared';
import { addRecitationSegment, removeRecitationSegment, saveRecitation } from './actions';
import { SegmentPreview } from './segment-preview';
import { SegmentUploader } from './segment-uploader';
import {
  actorOf,
  EditIdentity,
  EditorHeading,
  Pager,
  PeopleSearch,
  peopleChoices,
  quranCopy,
  recordTarget,
  SlugField,
  SourceName,
  SourceSelect,
  StateBadge,
  StateControls,
  surahText,
  type Copy,
  type EditorParams,
  type ListParams,
  type PersonChoice,
} from './shared';

/**
 * Recitations (ROUTE_MAP.md §7: `/admin/quran/recitations`), Phase 18.
 *
 * QURAN OWNS RECITATION (DOMAIN_MODEL.md §8.1; SECURITY_BASELINE.md §5.1 rule
 * 5). A Recitation is a reciter's work — the reciter a People Person chosen by
 * NAME, which grants that person nothing — made of segments, each a same-Surah
 * range of ayat with one audio file. Media's screens cannot author one, and
 * nothing here reads Media.
 *
 * THE FILE IS NEVER AN IDENTIFIER HERE. A segment's audio is uploaded to that
 * segment through its dedicated streaming route and nowhere else; there is no
 * field for an asset identifier and no file browser. An operator listens to it
 * through the private preview route before publishing, and publication itself
 * is refused by the service while a segment has no cleared audio.
 */

function formatBytes(bytes: number, locale: Locale): string {
  const megabytes = bytes / (1024 * 1024);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(megabytes)} MB`;
}

/* ===========================================================================
 * Directory
 * ========================================================================= */

export async function RecitationDirectory({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/quran/recitations`;
  const context = await requireAdminPage(locale, 'quran.read', base);
  const copy = await quranCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const administer = context.authorization.can('quran.administer');
  const offset = pageOffset(query, QURAN_PAGE);
  const reference = queryValue(query, 'q') ?? '';

  const [page, status] = await Promise.all([
    quranRuntime().quran.recitations(actor, offset),
    quranRuntime().quran.corpusStatus(actor),
  ]);
  const people = await peopleChoices(
    locale,
    administer ? reference : '',
    page.items.map((item) => item.reciterId),
    copy,
  );
  const sources = new Map(status.sources.map((source) => [source.id, source]));

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.recitations')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('scope.recitations')}
      </p>

      {page.items.length === 0 ? (
        <EmptyState>{t('empty')}</EmptyState>
      ) : (
        <DataTable
          caption={t('surface.recitations')}
          columns={[
            t('name'),
            t('recitation.reciter'),
            t('slug'),
            t('source'),
            t('state'),
            t('recitation.segments'),
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
                <span dir="auto">
                  {people.names.get(item.reciterId) ?? t('personUnavailable')}
                </span>
              </DataCell>
              <DataCell wrap>
                <span dir="ltr">{item.slug}</span>
              </DataCell>
              <DataCell wrap>
                <SourceName
                  source={item.sourceId === null ? undefined : sources.get(item.sourceId)}
                  copy={copy}
                />
              </DataCell>
              <DataCell>
                <StateBadge state={item.state} copy={copy} />
              </DataCell>
              <DataCell>{item.segmentCount}</DataCell>
              <DataCell>{item.version}</DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}
      <Pager
        offset={offset}
        total={page.total}
        hrefFor={(number) => (number > 1 ? `${base}?page=${String(number)}` : base)}
        label={t('surface.recitations')}
        copy={copy}
      />

      {administer ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('create.recitations')}</SectionHeading>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('createHelp')}
            </p>
            <PeopleSearch query={reference} copy={copy} />
            <RecitationForm
              locale={locale}
              record={null}
              sources={status.sources}
              people={people.options}
              copy={copy}
            />
          </div>
        </Panel>
      ) : null}
    </main>
  );
}

/* ===========================================================================
 * Editor
 * ========================================================================= */

export async function RecitationEditor({ params, searchParams }: EditorParams) {
  const locale = await requireLocale(params);
  const id = recordTarget((await params).id);
  const query = await searchParams;
  const list = `/${locale}/admin/quran/recitations`;
  const base = `${list}/${id}`;
  const context = await requireAdminPage(locale, 'quran.read', base);
  const copy = await quranCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const administer = context.authorization.can('quran.administer');

  const record = await quranRuntime().quran.recitation(actor, id);
  if (record === null) notFound();

  const reference = queryValue(query, 'q') ?? '';
  const [status, surahs, people] = await Promise.all([
    quranRuntime().quran.corpusStatus(actor),
    quranRuntime().quran.surahs(actor),
    peopleChoices(locale, administer ? reference : '', [record.reciterId], copy),
  ]);
  const source =
    record.sourceId === null
      ? undefined
      : status.sources.find((entry) => entry.id === record.sourceId);
  const surahIndex = new Map(surahs.map((surah) => [surah.number, surah]));
  const segments = [...record.segments].sort(
    (a, b) => a.surah - b.surah || a.startAyah - b.startAyah,
  );
  const reciter = people.names.get(record.reciterId) ?? t('personUnavailable');

  return (
    <main className="flex flex-col gap-8">
      <EditorHeading
        base={list}
        locale={locale}
        title={<span dir="auto">{record.name}</span>}
        record={record}
        copy={copy}
      >
        <span>
          {t('recitation.reciter')}: <span dir="auto">{reciter}</span>
        </span>
      </EditorHeading>

      {/* ---- Lifecycle ---------------------------------------------------- */}
      <Panel>
        <section className="flex flex-col gap-4" aria-labelledby="recitation-state">
          <SectionHeading>
            <span id="recitation-state">{t('stateTitle')}</span>
          </SectionHeading>
          <p className="text-sm">
            {t('source')}: <SourceName source={source} copy={copy} />
          </p>
          {administer ? (
            <StateControls
              kind="recitation"
              locale={locale}
              record={record}
              copy={copy}
            />
          ) : null}
        </section>
      </Panel>

      {/* ---- Metadata ----------------------------------------------------- */}
      {administer ? (
        <Panel>
          <section className="flex flex-col gap-4" aria-labelledby="recitation-details">
            <SectionHeading>
              <span id="recitation-details">{t('details')}</span>
            </SectionHeading>
            <PeopleSearch query={reference} copy={copy} />
            <RecitationForm
              locale={locale}
              record={record}
              sources={status.sources}
              people={people.options}
              copy={copy}
            />
          </section>
        </Panel>
      ) : (
        <Panel>
          <dl className="flex flex-col gap-2 text-sm">
            <div>
              <dt className="font-medium">{t('recitation.style')}</dt>
              <dd dir="auto">{record.style ?? t('none')}</dd>
            </div>
            <div>
              <dt className="font-medium">{t('attribution')}</dt>
              <dd dir="auto">{record.attribution ?? t('none')}</dd>
            </div>
          </dl>
        </Panel>
      )}

      {/* ---- Segments ----------------------------------------------------- */}
      <section className="flex flex-col gap-4" aria-labelledby="recitation-segments">
        <SectionHeading>
          <span id="recitation-segments">{t('recitation.segments')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('recitation.segmentsHelp', {
            count: segments.length,
            limit: QURAN_LIMITS.segmentsPerRecitation,
          })}
        </p>
        {segments.length === 0 ? (
          <EmptyState>{t('recitation.segmentsEmpty')}</EmptyState>
        ) : (
          <ol className="flex flex-col gap-4">
            {segments.map((segment) => {
              const surah = surahIndex.get(segment.surah);
              const range = t('recitation.range', {
                surah: segment.surah,
                start: segment.startAyah,
                end: segment.endAyah,
              });
              return (
                <Panel key={segment.id} as="li">
                  <div className="flex flex-col gap-3">
                    <p className="flex flex-wrap items-center gap-3 text-sm">
                      <span className="font-semibold">{range}</span>
                      {surah === undefined ? null : (
                        <span>{surahText(surah, locale, copy)}</span>
                      )}
                      <StatusBadge
                        tone={segment.assetId === null ? 'caution' : 'positive'}
                      >
                        {segment.assetId === null
                          ? t('recitation.audioNone')
                          : t('recitation.audioAttached')}
                      </StatusBadge>
                    </p>
                    {administer && segment.assetId !== null ? (
                      <SegmentPreview
                        recitationId={record.id}
                        segmentId={segment.id}
                        assetId={segment.assetId}
                        labels={{
                          player: t('recitation.previewName', { range }),
                          unsupported: t('recitation.previewUnsupported'),
                          failed: t('recitation.previewFailed'),
                        }}
                      />
                    ) : null}
                    {administer ? (
                      <>
                        <SegmentUploader
                          recitationId={record.id}
                          segmentId={segment.id}
                          version={record.version}
                          maxBytes={RECITATION_UPLOAD_MAX_BYTES}
                          accept={[...RECITATION_AUDIO_MEDIA_TYPES, '.mp3'].join(',')}
                          labels={{
                            file:
                              segment.assetId === null
                                ? t('recitation.upload')
                                : t('recitation.replace'),
                            help: t('recitation.uploadHelp', {
                              size: formatBytes(RECITATION_UPLOAD_MAX_BYTES, locale),
                            }),
                            submit:
                              segment.assetId === null
                                ? t('recitation.uploadSubmit')
                                : t('recitation.replaceSubmit'),
                            pending: t('recitation.uploading'),
                            progress: t('recitation.progress'),
                            success: t('recitation.uploaded'),
                            failures: copy.messages,
                          }}
                        />
                        <ActionForm
                          action={removeRecitationSegment}
                          submitLabel={t('recitation.removeSegment')}
                          pendingLabel={t('pending')}
                          messages={copy.messages}
                          tone="destructive"
                        >
                          <EditIdentity locale={locale} record={record} />
                          <input type="hidden" name="segmentId" value={segment.id} />
                        </ActionForm>
                      </>
                    ) : null}
                  </div>
                </Panel>
              );
            })}
          </ol>
        )}

        {administer ? (
          surahs.length === 0 ? (
            <EmptyState>{t('texts.noCorpus')}</EmptyState>
          ) : (
            <Panel>
              <div className="flex flex-col gap-4">
                <SectionHeading>{t('recitation.addSegment')}</SectionHeading>
                <SegmentForm
                  locale={locale}
                  record={record}
                  surahs={surahs}
                  copy={copy}
                />
              </div>
            </Panel>
          )
        ) : null}
      </section>
    </main>
  );
}

function RecitationForm({
  locale,
  record,
  sources,
  people,
  copy,
}: {
  readonly locale: Locale;
  /** `null` creates. An existing record edits, and carries its expected version. */
  readonly record: RecitationDetail | null;
  readonly sources: readonly QuranSourceRecord[];
  readonly people: readonly PersonChoice[];
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? 'new-recitation' : 'recitation';
  return (
    <ActionForm
      action={saveRecitation}
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
      <Field
        id={`${prefix}-reciter`}
        label={t('recitation.reciter')}
        help={t('recitation.reciterHelp')}
      >
        {(props) => (
          <Select
            {...props}
            name="reciterId"
            required
            defaultValue={record?.reciterId ?? ''}
          >
            <option value="">{t('recitation.chooseReciter')}</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${prefix}-style`}
          label={t('recitation.style')}
          help={t('recitation.styleHelp')}
        >
          {(props) => (
            <TextInput
              {...props}
              name="style"
              defaultValue={record?.style ?? ''}
              maxLength={QURAN_LIMITS.style}
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
      </div>
      <SourceSelect
        id={`${prefix}-source`}
        sources={sources}
        selected={record?.sourceId ?? null}
        copy={copy}
      />
    </ActionForm>
  );
}

/** A new segment: one Surah and a range within it. Its audio is uploaded after. */
function SegmentForm({
  locale,
  record,
  surahs,
  copy,
}: {
  readonly locale: Locale;
  readonly record: RecitationDetail;
  readonly surahs: readonly SurahRecord[];
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <ActionForm
      action={addRecitationSegment}
      submitLabel={t('recitation.addSegmentSubmit')}
      pendingLabel={t('pending')}
      messages={copy.messages}
      preserveInput
    >
      <EditIdentity locale={locale} record={record} />
      <Field id="segment-surah" label={t('surah')}>
        {(props) => (
          <Select {...props} name="surah" required defaultValue="">
            <option value="">{t('chooseSurah')}</option>
            {surahs.map((surah) => (
              <option key={surah.number} value={String(surah.number)}>
                {surahText(surah, locale, copy)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="segment-start" label={t('recitation.start')}>
          {(props) => (
            <TextInput
              {...props}
              name="startAyah"
              type="number"
              required
              min={1}
              inputMode="numeric"
            />
          )}
        </Field>
        <Field id="segment-end" label={t('recitation.end')}>
          {(props) => (
            <TextInput
              {...props}
              name="endAyah"
              type="number"
              required
              min={1}
              inputMode="numeric"
            />
          )}
        </Field>
      </div>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('recitation.rangeHelp')}
      </p>
    </ActionForm>
  );
}
