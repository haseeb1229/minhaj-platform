import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  AUDIO_UPLOAD_MAX_BYTES,
  formatDuration,
  MEDIA_LIMITS,
  MEDIA_PAGE,
  type AudioSeriesRecord,
  type AudioTrackListing,
  type AudioTrackRecord,
} from '@minhaj/contracts/media';

import { requireAdminPage } from '@/composition/authorization';
import { audioAssetStatus, mediaRuntime } from '@/composition/media';
import { ownerReferenceChoices } from '@/composition/owner-references';
import { AudioPlayer } from '@/components/media/audio-player';
import {
  audioSeriesPath,
  audioTrackPath,
  mediaLabel,
} from '@/components/media/presentation';
import {
  Alert,
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
  TextArea,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { pageOffset, queryValue } from '../shared';
import { saveAudioSeries, saveAudioTrack } from './actions';
import { AudioUploader } from './audio-uploader';
import { MEDIA_FORM_ROWS } from './rows';
import {
  CommonFields,
  DirectoryFilter,
  directoryHref,
  directoryQuery,
  EditIdentity,
  LabelFields,
  mediaCopy,
  Pager,
  ReferenceSearch,
  StateBadge,
  Title,
  withSelected,
  type Choices,
  type Copy,
  type EditorParams,
  type ListParams,
} from './surfaces';

/**
 * The audio administration — AudioTracks and AudioSeries (ROUTE_MAP.md §7:
 * `/admin/media/audio`, with audio series beneath it at `audio/series` so they
 * are never confused with the Video `series` screen).
 *
 * THE SAME RULES AS THE VIDEO SCREENS. `media.read` opens a screen and
 * `media.administer` is what every change re-checks, live; every form carries
 * its record's expected version; records are headed by title and references are
 * chosen by name. No raw identifier is the primary way to do anything.
 *
 * THE FILE IS NEVER AN IDENTIFIER HERE. A track's audio is uploaded to that
 * track and nowhere else; there is no field for an asset identifier and no file
 * browser. Its state is shown as Storage reports it through the preview
 * decision — playable, or not servable right now — and an operator listens to it
 * through the administrator's preview route before publishing.
 */

/* ===========================================================================
 * Shared
 * ========================================================================= */

/** A table of tracks, headed by title, with state, file and version in words. */
function TrackTable({
  locale,
  tracks,
  caption,
  copy,
  position = false,
}: {
  readonly locale: Locale;
  readonly tracks: readonly AudioTrackListing[];
  readonly caption: string;
  readonly copy: Copy;
  readonly position?: boolean;
}) {
  const { t } = copy;
  if (tracks.length === 0) return <EmptyState>{t('empty')}</EmptyState>;
  return (
    <DataTable
      caption={caption}
      columns={[
        ...(position ? [t('audio.seriesPosition')] : []),
        t('labelTitle'),
        t('slug'),
        t('state'),
        t('audio.file'),
        t('version'),
      ]}
    >
      {tracks.map((track) => (
        <DataRow key={track.id}>
          {position ? <DataCell>{track.seriesPosition ?? '—'}</DataCell> : null}
          <DataCell wrap>
            <TextLink href={`/${locale}/admin/media/audio/${track.id}`}>
              <Title record={track} locale={locale} />
            </TextLink>
          </DataCell>
          <DataCell wrap>{track.slug}</DataCell>
          <DataCell>
            <StateBadge state={track.state} copy={copy} />
          </DataCell>
          <DataCell>
            {track.hasAudio ? t('audio.fileAttached') : t('audio.fileNone')}
          </DataCell>
          <DataCell>{track.version}</DataCell>
        </DataRow>
      ))}
    </DataTable>
  );
}

/** A byte count as a person reads it, in the interface locale. */
function formatBytes(bytes: number, locale: Locale): string {
  const megabytes = bytes / (1024 * 1024);
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(megabytes)} MB`;
}

/* ===========================================================================
 * Tracks
 * ========================================================================= */

export async function AudioDirectory({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/media/audio`;
  const context = await requireAdminPage(locale, 'media.read', base);
  const copy = await mediaCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const filter = directoryQuery(query);
  const reference = queryValue(query, 'q') ?? '';
  const administer = context.authorization.can('media.administer');

  const [page, choices, series] = await Promise.all([
    mediaRuntime().media.audioTracks(actor, filter),
    ownerReferenceChoices(locale, reference),
    mediaRuntime().media.audioSeriesChoices(actor),
  ]);

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.audio')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('audio.scope')}
      </p>
      <DirectoryFilter
        base={base}
        state={filter.state}
        text={filter.text ?? ''}
        copy={copy}
      />
      <TrackTable
        locale={locale}
        tracks={page.items}
        caption={t('surface.audio')}
        copy={copy}
      />
      <Pager
        offset={filter.offset}
        hasMore={page.hasMore}
        hrefFor={directoryHref(base, filter)}
        label={t('surface.audio')}
        copy={copy}
      />
      {administer ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('audio.create')}</SectionHeading>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('audio.createHelp')}
            </p>
            <ReferenceSearch query={reference} copy={copy} />
            <TrackForm
              locale={locale}
              record={null}
              choices={choices}
              series={series}
              copy={copy}
            />
          </div>
        </Panel>
      ) : null}
    </main>
  );
}

export async function AudioEditor({ params, searchParams }: EditorParams) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const query = await searchParams;
  const base = `/${locale}/admin/media/audio`;
  const context = await requireAdminPage(locale, 'media.read', base);
  const copy = await mediaCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const administer = context.authorization.can('media.administer');

  // A malformed identifier is the page's own 404, not an error boundary.
  const record = await mediaRuntime()
    .media.audioTrack(actor, id)
    .catch(() => null);
  if (record === null) notFound();

  const reference = queryValue(query, 'q') ?? '';
  const [choices, series, file] = await Promise.all([
    ownerReferenceChoices(locale, reference),
    mediaRuntime().media.audioSeriesChoices(actor),
    // Storage's answer, through the SAME decision the preview route makes —
    // which needs `media.administer`; a reader sees the file's existence only.
    record.assetId === null || !administer
      ? Promise.resolve(null)
      : audioAssetStatus(
          { trackId: record.id, assetId: record.assetId },
          context.session.account.id,
        ),
  ]);
  const label = mediaLabel(record, locale);

  return (
    <main className="flex flex-col gap-8">
      <p className="text-sm">
        <TextLink href={base}>{t('backToList')}</TextLink>
      </p>
      <div className="flex flex-col gap-2">
        <PageHeading>
          <span lang={label.locale} dir="auto">
            {label.title}
          </span>
        </PageHeading>
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <StateBadge state={record.state} copy={copy} />
          <span>
            {t('version')}: {record.version}
          </span>
          {record.state === 'published' ? (
            <TextLink href={audioTrackPath(locale, record.slug)}>
              {t('viewPublic')}
            </TextLink>
          ) : null}
        </p>
      </div>

      <Panel>
        <section className="flex flex-col gap-4" aria-labelledby="audio-file">
          <SectionHeading>
            <span id="audio-file">{t('audio.file')}</span>
          </SectionHeading>
          <FileState
            record={record}
            file={file}
            administer={administer}
            locale={locale}
            copy={copy}
          />
          {administer ? (
            <AudioUploader
              trackId={record.id}
              version={record.version}
              maxBytes={AUDIO_UPLOAD_MAX_BYTES}
              labels={{
                file: record.assetId === null ? t('audio.upload') : t('audio.replace'),
                help: t('audio.uploadHelp', {
                  size: formatBytes(AUDIO_UPLOAD_MAX_BYTES, locale),
                }),
                submit:
                  record.assetId === null
                    ? t('audio.uploadSubmit')
                    : t('audio.replaceSubmit'),
                pending: t('audio.uploading'),
                progress: t('audio.progress'),
                success: t('audio.uploaded'),
                failures: copy.messages,
              }}
            />
          ) : null}
        </section>
      </Panel>

      {administer ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('audio.edit')}</SectionHeading>
            <ReferenceSearch query={reference} copy={copy} />
            <TrackForm
              locale={locale}
              record={record}
              choices={choices}
              series={series}
              copy={copy}
            />
          </div>
        </Panel>
      ) : null}
    </main>
  );
}

/**
 * What the operator is told about the file — in words, never a colour alone,
 * and never Storage's internal reason: a file is playable, or it cannot be
 * served right now, or there is none yet.
 */
function FileState({
  record,
  file,
  administer,
  locale,
  copy,
}: {
  readonly record: AudioTrackRecord;
  readonly file: { readonly mediaType: string; readonly byteSize: number } | null;
  readonly administer: boolean;
  readonly locale: Locale;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const label = mediaLabel(record, locale);

  if (record.assetId === null) {
    return <EmptyState>{t('audio.fileNoneHelp')}</EmptyState>;
  }
  if (!administer) {
    return <p className="text-sm">{t('audio.fileAttached')}</p>;
  }
  if (file === null) {
    return <Alert tone="warning">{t('audio.fileUnavailable')}</Alert>;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="flex flex-wrap items-center gap-3 text-sm">
        <StatusBadge tone="positive">{t('audio.filePlayable')}</StatusBadge>
        <span dir="ltr">{file.mediaType}</span>
        <span>{formatBytes(file.byteSize, locale)}</span>
      </p>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('audio.previewHelp')}
      </p>
      <AudioPlayer
        trackId={record.id}
        assetId={record.assetId}
        mode="preview"
        labels={{
          player: t('audio.previewName', { title: label.title }),
          unsupported: t('audio.previewUnsupported'),
          failed: t('audio.fileUnavailable'),
        }}
      />
    </div>
  );
}

function TrackForm({
  locale,
  record,
  choices,
  series,
  copy,
}: {
  readonly locale: Locale;
  /** `null` creates. An existing record edits, and carries its expected version. */
  readonly record: AudioTrackRecord | null;
  readonly choices: Choices;
  readonly series: readonly AudioSeriesRecord[];
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? 'new-audio' : 'audio';

  return (
    <ActionForm
      action={saveAudioTrack}
      submitLabel={record === null ? t('create') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
    >
      <EditIdentity locale={locale} record={record} />
      <CommonFields prefix={prefix} locale={locale} record={record} copy={copy} />
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('audio.publishHelp')}
      </p>

      <LabelFields prefix={prefix} locale={locale} record={record} copy={copy} />

      <SectionHeading>{t('audio.facts')}</SectionHeading>
      <Field
        id={`${prefix}-language`}
        label={t('audio.contentLanguage')}
        help={t('audio.contentLanguageHelp')}
      >
        {(props) => (
          <Select
            {...props}
            name="languageCode"
            required
            defaultValue={record?.languageCode ?? ''}
          >
            <option value="">{t('none')}</option>
            {choices.languages.map((language) => (
              <option key={language.code} value={language.code}>
                {language.name} ({language.code})
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${prefix}-duration`}
          label={t('audio.duration')}
          help={t('audio.durationHelp')}
        >
          {(props) => (
            <TextInput
              {...props}
              name="duration"
              inputMode="numeric"
              defaultValue={
                record?.durationSeconds == null
                  ? ''
                  : formatDuration(record.durationSeconds)
              }
              maxLength={12}
              dir="ltr"
            />
          )}
        </Field>
        <Field
          id={`${prefix}-recorded`}
          label={t('audio.recordedOn')}
          help={t('audio.recordedOnHelp')}
        >
          {(props) => (
            <TextInput
              {...props}
              name="recordedOn"
              type="date"
              defaultValue={record?.recordedOn ?? ''}
            />
          )}
        </Field>
      </div>

      <Field
        id={`${prefix}-transcript`}
        label={t('audio.transcript')}
        help={t('audio.transcriptHelp')}
      >
        {(props) => (
          <TextArea
            {...props}
            name="transcript"
            rows={8}
            defaultValue={record?.transcript ?? ''}
            maxLength={MEDIA_LIMITS.transcript}
            dir="auto"
          />
        )}
      </Field>

      <SectionHeading>{t('audio.grouping')}</SectionHeading>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${prefix}-series`}
          label={t('audio.series')}
          help={t('audio.seriesHelp')}
        >
          {(props) => (
            <Select {...props} name="seriesId" defaultValue={record?.series?.id ?? ''}>
              <option value="">{t('none')}</option>
              {series.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {mediaLabel(entry, locale).title}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id={`${prefix}-position`} label={t('audio.seriesPosition')}>
          {(props) => (
            <TextInput
              {...props}
              name="seriesPosition"
              type="number"
              min={1}
              max={MEDIA_LIMITS.seriesPosition}
              inputMode="numeric"
              defaultValue={record?.series?.position ?? ''}
            />
          )}
        </Field>
      </div>

      <SectionHeading>{t('audio.speakers')}</SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('audio.speakersHelp')}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: MEDIA_FORM_ROWS.speakers }, (_, index) => {
          const selected = record?.speakerIds[index];
          return (
            <Field
              key={index}
              id={`${prefix}-speaker-${String(index)}`}
              label={t('audio.speaker', { number: index + 1 })}
            >
              {(props) => (
                <Select
                  {...props}
                  name={`speaker-${String(index)}`}
                  defaultValue={selected ?? ''}
                >
                  <option value="">{t('none')}</option>
                  {withSelected(choices.people, selected, (id) => ({ id, name: id })).map(
                    (person) => (
                      <option key={person.id} value={person.id}>
                        {person.name}
                      </option>
                    ),
                  )}
                </Select>
              )}
            </Field>
          );
        })}
      </div>

      <SectionHeading>{t('audio.topics')}</SectionHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: MEDIA_FORM_ROWS.topics }, (_, index) => (
          <Field
            key={index}
            id={`${prefix}-topic-${String(index)}`}
            label={t('audio.topic', { number: index + 1 })}
          >
            {(props) => (
              <Select
                {...props}
                name={`topic-${String(index)}`}
                defaultValue={record?.topicIds[index] ?? ''}
              >
                <option value="">{t('none')}</option>
                {choices.topics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ))}
      </div>
    </ActionForm>
  );
}

/* ===========================================================================
 * Audio series
 * ========================================================================= */

function SeriesTable({
  locale,
  items,
  caption,
  copy,
}: {
  readonly locale: Locale;
  readonly items: readonly AudioSeriesRecord[];
  readonly caption: string;
  readonly copy: Copy;
}) {
  const { t } = copy;
  if (items.length === 0) return <EmptyState>{t('empty')}</EmptyState>;
  return (
    <DataTable
      caption={caption}
      columns={[t('labelTitle'), t('slug'), t('state'), t('version')]}
    >
      {items.map((item) => (
        <DataRow key={item.id}>
          <DataCell wrap>
            <TextLink href={`/${locale}/admin/media/audio/series/${item.id}`}>
              <Title record={item} locale={locale} />
            </TextLink>
          </DataCell>
          <DataCell wrap>{item.slug}</DataCell>
          <DataCell>
            <StateBadge state={item.state} copy={copy} />
          </DataCell>
          <DataCell>{item.version}</DataCell>
        </DataRow>
      ))}
    </DataTable>
  );
}

function SeriesForm({
  locale,
  record,
  copy,
}: {
  readonly locale: Locale;
  readonly record: AudioSeriesRecord | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? 'new-audio-series' : 'audio-series';
  return (
    <ActionForm
      action={saveAudioSeries}
      submitLabel={record === null ? t('create') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
    >
      <EditIdentity locale={locale} record={record} />
      <CommonFields prefix={prefix} locale={locale} record={record} copy={copy} />
      <LabelFields prefix={prefix} locale={locale} record={record} copy={copy} />
    </ActionForm>
  );
}

export async function AudioSeriesDirectory({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/media/audio/series`;
  const context = await requireAdminPage(locale, 'media.read', base);
  const copy = await mediaCopy(locale);
  const { t } = copy;
  const filter = directoryQuery(query);
  const page = await mediaRuntime().media.audioSeriesDirectory(
    { accountId: context.session.account.id },
    filter,
  );

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.audioSeries')}</PageHeading>
      <DirectoryFilter
        base={base}
        state={filter.state}
        text={filter.text ?? ''}
        copy={copy}
      />
      <SeriesTable
        locale={locale}
        items={page.items}
        caption={t('surface.audioSeries')}
        copy={copy}
      />
      <Pager
        offset={filter.offset}
        hasMore={page.hasMore}
        hrefFor={directoryHref(base, filter)}
        label={t('surface.audioSeries')}
        copy={copy}
      />
      {context.authorization.can('media.administer') ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('audioSeries.create')}</SectionHeading>
            <SeriesForm locale={locale} record={null} copy={copy} />
          </div>
        </Panel>
      ) : null}
    </main>
  );
}

export async function AudioSeriesEditor({ params, searchParams }: EditorParams) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const query = await searchParams;
  const base = `/${locale}/admin/media/audio/series`;
  const context = await requireAdminPage(locale, 'media.read', base);
  const copy = await mediaCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };

  const record = await mediaRuntime()
    .media.audioSeries(actor, id)
    .catch(() => null);
  if (record === null) notFound();

  const offset = pageOffset(query, MEDIA_PAGE);
  const tracks = await mediaRuntime().media.audioSeriesTracks(actor, record.id, offset);
  const label = mediaLabel(record, locale);

  return (
    <main className="flex flex-col gap-8">
      <p className="text-sm">
        <TextLink href={base}>{t('backToList')}</TextLink>
      </p>
      <div className="flex flex-col gap-2">
        <PageHeading>
          <span lang={label.locale} dir="auto">
            {label.title}
          </span>
        </PageHeading>
        <p className="flex flex-wrap items-center gap-3 text-sm">
          <StateBadge state={record.state} copy={copy} />
          <span>
            {t('version')}: {record.version}
          </span>
          {record.state === 'published' ? (
            <TextLink href={audioSeriesPath(locale, record.slug)}>
              {t('viewPublic')}
            </TextLink>
          ) : null}
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <SectionHeading>{t('audioSeries.tracks')}</SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('audioSeries.tracksHelp')}
        </p>
        <TrackTable
          locale={locale}
          tracks={tracks.items}
          caption={t('audioSeries.tracks')}
          copy={copy}
          position
        />
        <Pager
          offset={offset}
          hasMore={tracks.hasMore}
          hrefFor={(page) =>
            `${base}/${record.id}${page > 1 ? `?page=${String(page)}` : ''}`
          }
          label={t('audioSeries.tracks')}
          copy={copy}
        />
      </section>

      {context.authorization.can('media.administer') ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('audioSeries.edit')}</SectionHeading>
            <SeriesForm locale={locale} record={record} copy={copy} />
          </div>
        </Panel>
      ) : null}
    </main>
  );
}
