import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { localeSchema, type Locale } from '@minhaj/contracts';
import {
  formatDuration,
  MEDIA_LIMITS,
  mediaStateSchema,
  SERIES_KINDS,
  VIDEO_AVAILABILITY,
  VIDEO_FORMATS,
  VIDEO_PROVIDERS,
  type MediaLabel,
  type MediaState,
  type PlaylistDetail,
  type PlaylistRecord,
  type SeriesRecord,
  type VideoListing,
  type VideoRecord,
} from '@minhaj/contracts/media';

import { requireAdminPage } from '@/composition/authorization';
import { mediaRuntime } from '@/composition/media';
import { ownerReferenceChoices } from '@/composition/owner-references';
import { VideoPlayer } from '@/components/media/player';
import {
  mediaLabel,
  playlistPath,
  seriesPath,
  videoPath,
} from '@/components/media/presentation';
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
  TextArea,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../(identity)/form-state';
import { pageOffset, PAGE_SIZE, queryValue } from '../shared';
import { changePlaylist, savePlaylist, saveSeries, saveVideo } from './actions';
import { VIDEO_FORM_ROWS } from './rows';

/**
 * The Media administration — Videos, Series and Playlists (ROUTE_MAP.md §7).
 *
 * `media.read` OPENS A SCREEN, `media.administer` IS WHAT EVERY ACTION
 * RE-CHECKS, live. Every screen is `noindex` and private through the
 * administrative layouts. Every form carries its record's expected version, so
 * a stale save is a visible conflict rather than a silent overwrite
 * (DOMAIN_MODEL.md §19.8).
 *
 * NO RAW IDENTIFIERS AS THE PRIMARY UX. Records are listed and headed by their
 * resolved title; speakers, topics, languages and Series are chosen from their
 * owners' names; a Playlist's order is changed with named buttons, one step at a
 * time, never by editing a list of identifiers.
 */

type Copy = Awaited<ReturnType<typeof mediaCopy>>;
type Choices = Awaited<ReturnType<typeof ownerReferenceChoices>>;
type Query = Record<string, string | string[] | undefined>;

interface ListParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}

interface EditorParams {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
  readonly searchParams: Promise<Query>;
}

/** The copy every Media screen needs, and a message for every failure. */
async function mediaCopy(locale: Locale) {
  const t = await getTranslations({ locale, namespace: 'media' });
  return {
    t,
    messages: {
      success: t('saved'),
      denied: t('denied'),
      invalid: t('invalid'),
      conflict: t('conflict'),
      'not-found': t('notFound'),
      'duplicate-slug': t('duplicateSlug'),
      'duplicate-video': t('duplicateVideo'),
      'duplicate-position': t('duplicatePosition'),
      'duplicate-member': t('duplicateMember'),
      limit: t('limit'),
      unavailable: t('unknown'),
      unknown: t('unknown'),
    } as Readonly<Record<string, string>>,
  };
}

/* ===========================================================================
 * Shared parts
 * ========================================================================= */

function StateBadge({
  state,
  copy,
}: {
  readonly state: MediaState;
  readonly copy: Copy;
}) {
  return (
    <StatusBadge tone={state === 'published' ? 'positive' : 'neutral'}>
      {copy.t(`stateName.${state}`)}
    </StatusBadge>
  );
}

function Pager({
  offset,
  hasMore,
  hrefFor,
  label,
  copy,
}: {
  readonly offset: number;
  readonly hasMore: boolean;
  readonly hrefFor: (page: number) => string;
  readonly label: string;
  readonly copy: Copy;
}) {
  if (offset === 0 && !hasMore) return null;
  const current = offset / PAGE_SIZE + 1;
  return (
    <nav className="flex gap-6" aria-label={label}>
      {offset > 0 ? (
        <TextLink href={hrefFor(current - 1)}>{copy.t('previous')}</TextLink>
      ) : null}
      {hasMore ? <TextLink href={hrefFor(current + 1)}>{copy.t('next')}</TextLink> : null}
    </nav>
  );
}

/** A narrowing GET form for a directory: a state and a title-or-slug match. */
function DirectoryFilter({
  base,
  state,
  text,
  copy,
}: {
  readonly base: string;
  readonly state: MediaState | null;
  readonly text: string;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <form method="get" action={base} className="flex flex-wrap items-end gap-3">
      <Field id="state-filter" label={t('state')}>
        {(props) => (
          <Select {...props} name="state" defaultValue={state ?? ''}>
            <option value="">{t('allStates')}</option>
            {mediaStateSchema.options.map((option) => (
              <option key={option} value={option}>
                {t(`stateName.${option}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field id="text-filter" label={t('textFilter')}>
        {(props) => (
          <TextInput {...props} name="text" defaultValue={text} maxLength={200} />
        )}
      </Field>
      <button
        type="submit"
        className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-medium"
      >
        {t('filterApply')}
      </button>
    </form>
  );
}

/** The directory filter read back from the query, bounded. */
function directoryQuery(query: Query) {
  const state = mediaStateSchema.safeParse(queryValue(query, 'state'));
  return {
    offset: pageOffset(query, PAGE_SIZE),
    state: state.success ? state.data : null,
    text: queryValue(query, 'text'),
  };
}

function directoryHref(
  base: string,
  filter: ReturnType<typeof directoryQuery>,
): (page: number) => string {
  return (page) => {
    const search = new URLSearchParams();
    if (page > 1) search.set('page', String(page));
    if (filter.state !== null) search.set('state', filter.state);
    if (filter.text !== null) search.set('text', filter.text);
    const encoded = search.toString();
    return encoded === '' ? base : `${base}?${encoded}`;
  };
}

/** The title of a record in its own language, for a table cell or a heading. */
function Title({
  record,
  locale,
}: {
  readonly record: {
    readonly labels: readonly MediaLabel[];
    readonly primaryLocale: Locale;
  };
  readonly locale: Locale;
}) {
  const label = mediaLabel(record, locale);
  return (
    <span lang={label.locale} dir="auto">
      {label.title}
    </span>
  );
}

/** A narrowing GET form for the speaker choices, beside — never inside — a save form. */
function ReferenceSearch({
  query,
  copy,
}: {
  readonly query: string;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <Field id="reference-query" label={t('referenceQuery')}>
          {(props) => (
            <TextInput {...props} name="q" defaultValue={query} maxLength={200} />
          )}
        </Field>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-medium"
        >
          {t('findReferences')}
        </button>
      </form>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('referenceHelp')}
      </p>
    </>
  );
}

/** Enable, title and description for each interface locale. */
function LabelFields({
  prefix,
  locale,
  record,
  copy,
}: {
  readonly prefix: string;
  readonly locale: Locale;
  readonly record: {
    readonly labels: readonly MediaLabel[];
    readonly primaryLocale: Locale;
  } | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <>
      <SectionHeading>{t('labels')}</SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('labelsHelp')}
      </p>
      {localeSchema.options.map((language) => {
        const existing = record?.labels.find((entry) => entry.locale === language);
        return (
          <Panel key={language}>
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <input
                  type="checkbox"
                  name={`${language}-enabled`}
                  defaultChecked={
                    existing !== undefined ||
                    language === (record?.primaryLocale ?? locale)
                  }
                  className="size-5"
                />
                {language}
              </label>
              <Field id={`${prefix}-title-${language}`} label={t('labelTitle')}>
                {(props) => (
                  <TextInput
                    {...props}
                    name={`${language}-title`}
                    defaultValue={existing?.title ?? ''}
                    maxLength={MEDIA_LIMITS.title}
                    lang={language}
                    dir="auto"
                  />
                )}
              </Field>
              <Field id={`${prefix}-description-${language}`} label={t('description')}>
                {(props) => (
                  <TextArea
                    {...props}
                    name={`${language}-description`}
                    defaultValue={existing?.description ?? ''}
                    maxLength={MEDIA_LIMITS.description}
                    rows={3}
                    lang={language}
                    dir="auto"
                  />
                )}
              </Field>
            </div>
          </Panel>
        );
      })}
    </>
  );
}

/** Slug, primary locale and lifecycle — the fields every Media aggregate has. */
function CommonFields({
  prefix,
  locale,
  record,
  copy,
}: {
  readonly prefix: string;
  readonly locale: Locale;
  readonly record: {
    readonly slug: string;
    readonly primaryLocale: Locale;
    readonly state: MediaState;
  } | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  return (
    <>
      <Field id={`${prefix}-slug`} label={t('slug')} help={t('slugHelp')}>
        {(props) => (
          <TextInput
            {...props}
            name="slug"
            required
            defaultValue={record?.slug ?? ''}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            maxLength={120}
          />
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${prefix}-primary`}
          label={t('primaryLocale')}
          help={t('primaryLocaleHelp')}
        >
          {(props) => (
            <Select
              {...props}
              name="primaryLocale"
              defaultValue={record?.primaryLocale ?? locale}
            >
              {localeSchema.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id={`${prefix}-state`} label={t('state')} help={t('stateHelp')}>
          {(props) => (
            <Select {...props} name="state" defaultValue={record?.state ?? 'draft'}>
              {mediaStateSchema.options.map((option) => (
                <option key={option} value={option}>
                  {t(`stateName.${option}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </>
  );
}

/** The hidden fields that make an edit an edit: its record and expected version. */
function EditIdentity({
  locale,
  record,
}: {
  readonly locale: Locale;
  readonly record: { readonly id: string; readonly version: number } | null;
}) {
  return (
    <>
      <input type="hidden" name="locale" value={locale} />
      {record === null ? null : (
        <>
          <input type="hidden" name="id" value={record.id} />
          <input type="hidden" name="version" value={String(record.version)} />
        </>
      )}
    </>
  );
}

/** A table of Videos, headed by title, with state and version in words. */
function VideoTable({
  locale,
  videos,
  caption,
  copy,
  episode = false,
}: {
  readonly locale: Locale;
  readonly videos: readonly VideoListing[];
  readonly caption: string;
  readonly copy: Copy;
  readonly episode?: boolean;
}) {
  const { t } = copy;
  if (videos.length === 0) return <EmptyState>{t('empty')}</EmptyState>;
  return (
    <DataTable
      caption={caption}
      columns={[
        ...(episode ? [t('video.seriesPosition')] : []),
        t('labelTitle'),
        t('slug'),
        t('state'),
        t('video.availability'),
        t('version'),
      ]}
    >
      {videos.map((video) => (
        <DataRow key={video.id}>
          {episode ? <DataCell>{video.seriesPosition ?? '—'}</DataCell> : null}
          <DataCell wrap>
            <TextLink href={`/${locale}/admin/media/videos/${video.id}`}>
              <Title record={video} locale={locale} />
            </TextLink>
          </DataCell>
          <DataCell wrap>{video.slug}</DataCell>
          <DataCell>
            <StateBadge state={video.state} copy={copy} />
          </DataCell>
          <DataCell>{t(`video.availabilityName.${video.availability}`)}</DataCell>
          <DataCell>{video.version}</DataCell>
        </DataRow>
      ))}
    </DataTable>
  );
}

/* ===========================================================================
 * Videos
 * ========================================================================= */

export async function VideoDirectory({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/media/videos`;
  const context = await requireAdminPage(locale, 'media.read', base);
  const copy = await mediaCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };
  const filter = directoryQuery(query);
  const reference = queryValue(query, 'q') ?? '';

  const [page, choices, series] = await Promise.all([
    mediaRuntime().media.videos(actor, filter),
    ownerReferenceChoices(locale, reference),
    mediaRuntime().media.seriesChoices(actor),
  ]);

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.videos')}</PageHeading>
      <DirectoryFilter
        base={base}
        state={filter.state}
        text={filter.text ?? ''}
        copy={copy}
      />
      <VideoTable
        locale={locale}
        videos={page.items}
        caption={t('surface.videos')}
        copy={copy}
      />
      <Pager
        offset={filter.offset}
        hasMore={page.hasMore}
        hrefFor={directoryHref(base, filter)}
        label={t('surface.videos')}
        copy={copy}
      />
      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>{t('video.create')}</SectionHeading>
          <ReferenceSearch query={reference} copy={copy} />
          <VideoForm
            locale={locale}
            record={null}
            choices={choices}
            series={series}
            copy={copy}
          />
        </div>
      </Panel>
    </main>
  );
}

export async function VideoEditor({ params, searchParams }: EditorParams) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const query = await searchParams;
  const base = `/${locale}/admin/media/videos`;
  const context = await requireAdminPage(locale, 'media.read', base);
  const copy = await mediaCopy(locale);
  const { t } = copy;
  const watch = await getTranslations({ locale, namespace: 'watch' });
  const actor = { accountId: context.session.account.id };

  // A malformed identifier is the page's own 404, not an error boundary.
  const record = await mediaRuntime()
    .media.video(actor, id)
    .catch(() => null);
  if (record === null) notFound();

  const reference = queryValue(query, 'q') ?? '';
  const [choices, series] = await Promise.all([
    ownerReferenceChoices(locale, reference),
    mediaRuntime().media.seriesChoices(actor),
  ]);
  const label = mediaLabel(record, locale);
  const provider = watch(`provider.${record.provider}`);

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
            <TextLink href={videoPath(locale, record.slug)}>{t('viewPublic')}</TextLink>
          ) : null}
        </p>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="video-preview">
        <SectionHeading>
          <span id="video-preview">{t('video.preview')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('video.previewHelp')}
        </p>
        {record.availability === 'available' ? (
          <VideoPlayer
            provider={record.provider}
            providerVideoId={record.providerVideoId}
            labels={{
              notice: watch('player.notice', { provider }),
              load: watch('player.load', { provider }),
              fallback: watch('player.fallback', { provider, title: label.title }),
              frameTitle: watch('player.frameTitle', { provider, title: label.title }),
            }}
          />
        ) : (
          <EmptyState>{watch('player.unavailable', { provider })}</EmptyState>
        )}
      </section>

      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>{t('video.edit')}</SectionHeading>
          <ReferenceSearch query={reference} copy={copy} />
          <VideoForm
            locale={locale}
            record={record}
            choices={choices}
            series={series}
            copy={copy}
          />
        </div>
      </Panel>
    </main>
  );
}

/** The currently selected option stays offered even when off the first page. */
function withSelected<T extends { readonly id: string }>(
  options: readonly T[],
  selected: string | undefined,
  make: (id: string) => T,
): readonly T[] {
  if (selected === undefined || options.some((option) => option.id === selected))
    return options;
  return [make(selected), ...options];
}

function VideoForm({
  locale,
  record,
  choices,
  series,
  copy,
}: {
  readonly locale: Locale;
  /** `null` creates. An existing record edits, and carries its expected version. */
  readonly record: VideoRecord | null;
  readonly choices: Choices;
  readonly series: readonly SeriesRecord[];
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? 'new-video' : 'video';

  return (
    <ActionForm
      action={saveVideo}
      submitLabel={record === null ? t('create') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
    >
      <EditIdentity locale={locale} record={record} />
      <CommonFields prefix={prefix} locale={locale} record={record} copy={copy} />

      <SectionHeading>{t('video.source')}</SectionHeading>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={`${prefix}-provider`} label={t('video.provider')}>
          {(props) => (
            <Select
              {...props}
              name="provider"
              defaultValue={record?.provider ?? 'youtube'}
            >
              {VIDEO_PROVIDERS.map((provider) => (
                <option key={provider} value={provider}>
                  {t(`video.providerName.${provider}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          id={`${prefix}-reference`}
          label={t('video.providerReference')}
          help={t('video.providerReferenceHelp')}
        >
          {(props) => (
            <TextInput
              {...props}
              name="providerReference"
              required
              defaultValue={record?.providerVideoId ?? ''}
              maxLength={MEDIA_LIMITS.providerReference}
              dir="ltr"
            />
          )}
        </Field>
        <Field
          id={`${prefix}-availability`}
          label={t('video.availability')}
          help={t('video.availabilityHelp')}
        >
          {(props) => (
            <Select
              {...props}
              name="availability"
              defaultValue={record?.availability ?? 'available'}
            >
              {VIDEO_AVAILABILITY.map((option) => (
                <option key={option} value={option}>
                  {t(`video.availabilityName.${option}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field
          id={`${prefix}-format`}
          label={t('video.format')}
          help={t('video.formatHelp')}
        >
          {(props) => (
            <Select {...props} name="format" defaultValue={record?.format ?? ''}>
              <option value="">{t('none')}</option>
              {VIDEO_FORMATS.map((format) => (
                <option key={format} value={format}>
                  {t(`video.formatName.${format}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="featured"
          defaultChecked={record?.isFeatured ?? false}
          className="size-5"
        />
        {t('video.featured')}
      </label>

      <LabelFields prefix={prefix} locale={locale} record={record} copy={copy} />

      <SectionHeading>{t('video.facts')}</SectionHeading>
      <Field
        id={`${prefix}-language`}
        label={t('video.contentLanguage')}
        help={t('video.contentLanguageHelp')}
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
          label={t('video.duration')}
          help={t('video.durationHelp')}
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
          id={`${prefix}-published`}
          label={t('video.publishedOn')}
          help={t('video.publishedOnHelp')}
        >
          {(props) => (
            <TextInput
              {...props}
              name="publishedOn"
              type="date"
              defaultValue={record?.publishedOn ?? ''}
            />
          )}
        </Field>
      </div>
      <Field
        id={`${prefix}-thumbnail`}
        label={t('video.thumbnailUrl')}
        help={t('video.thumbnailUrlHelp')}
      >
        {(props) => (
          <TextInput
            {...props}
            name="thumbnailUrl"
            type="url"
            defaultValue={record?.thumbnailUrl ?? ''}
            maxLength={MEDIA_LIMITS.thumbnailUrl}
            dir="ltr"
          />
        )}
      </Field>

      <SectionHeading>{t('video.alternatives')}</SectionHeading>
      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          name="captions"
          defaultChecked={record?.captions ?? false}
          className="size-5"
        />
        {t('video.captions')}
      </label>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('video.captionsHelp')}
      </p>
      <Field
        id={`${prefix}-transcript`}
        label={t('video.transcript')}
        help={t('video.transcriptHelp')}
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

      <SectionHeading>{t('video.grouping')}</SectionHeading>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`${prefix}-series`}
          label={t('video.series')}
          help={t('video.seriesHelp')}
        >
          {(props) => (
            <Select {...props} name="seriesId" defaultValue={record?.series?.id ?? ''}>
              <option value="">{t('none')}</option>
              {series.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {mediaLabel(entry, locale).title} · {t(`series.kindName.${entry.kind}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id={`${prefix}-position`} label={t('video.seriesPosition')}>
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

      <SectionHeading>{t('video.speakers')}</SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('video.speakersHelp')}
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: VIDEO_FORM_ROWS.speakers }, (_, index) => {
          const selected = record?.speakerIds[index];
          return (
            <Field
              key={index}
              id={`${prefix}-speaker-${String(index)}`}
              label={t('video.speaker', { number: index + 1 })}
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

      <SectionHeading>{t('video.topics')}</SectionHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: VIDEO_FORM_ROWS.topics }, (_, index) => (
          <Field
            key={index}
            id={`${prefix}-topic-${String(index)}`}
            label={t('video.topic', { number: index + 1 })}
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
 * Series and programmes
 * ========================================================================= */

function GroupTable({
  locale,
  items,
  caption,
  hrefFor,
  copy,
  kind = false,
}: {
  readonly locale: Locale;
  readonly items: readonly (SeriesRecord | PlaylistRecord)[];
  readonly caption: string;
  readonly hrefFor: (id: string) => string;
  readonly copy: Copy;
  readonly kind?: boolean;
}) {
  const { t } = copy;
  if (items.length === 0) return <EmptyState>{t('empty')}</EmptyState>;
  return (
    <DataTable
      caption={caption}
      columns={[
        t('labelTitle'),
        ...(kind ? [t('series.kind')] : []),
        t('slug'),
        t('state'),
        t('version'),
      ]}
    >
      {items.map((item) => (
        <DataRow key={item.id}>
          <DataCell wrap>
            <TextLink href={hrefFor(item.id)}>
              <Title record={item} locale={locale} />
            </TextLink>
          </DataCell>
          {kind && 'kind' in item ? (
            <DataCell>{t(`series.kindName.${item.kind}`)}</DataCell>
          ) : null}
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
  readonly record: SeriesRecord | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? 'new-series' : 'series';
  return (
    <ActionForm
      action={saveSeries}
      submitLabel={record === null ? t('create') : t('save')}
      pendingLabel={t('pending')}
      messages={copy.messages}
    >
      <EditIdentity locale={locale} record={record} />
      <CommonFields prefix={prefix} locale={locale} record={record} copy={copy} />
      <Field id={`${prefix}-kind`} label={t('series.kind')} help={t('series.kindHelp')}>
        {(props) => (
          <Select {...props} name="kind" defaultValue={record?.kind ?? 'series'}>
            {SERIES_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {t(`series.kindName.${kind}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <LabelFields prefix={prefix} locale={locale} record={record} copy={copy} />
    </ActionForm>
  );
}

export async function SeriesDirectory({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/media/series`;
  const context = await requireAdminPage(locale, 'media.read', base);
  const copy = await mediaCopy(locale);
  const { t } = copy;
  const filter = directoryQuery(query);
  const page = await mediaRuntime().media.seriesDirectory(
    { accountId: context.session.account.id },
    filter,
  );

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.series')}</PageHeading>
      <DirectoryFilter
        base={base}
        state={filter.state}
        text={filter.text ?? ''}
        copy={copy}
      />
      <GroupTable
        locale={locale}
        items={page.items}
        caption={t('surface.series')}
        hrefFor={(id) => `${base}/${id}`}
        copy={copy}
        kind
      />
      <Pager
        offset={filter.offset}
        hasMore={page.hasMore}
        hrefFor={directoryHref(base, filter)}
        label={t('surface.series')}
        copy={copy}
      />
      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>{t('series.create')}</SectionHeading>
          <SeriesForm locale={locale} record={null} copy={copy} />
        </div>
      </Panel>
    </main>
  );
}

export async function SeriesEditor({ params, searchParams }: EditorParams) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const query = await searchParams;
  const base = `/${locale}/admin/media/series`;
  const context = await requireAdminPage(locale, 'media.read', base);
  const copy = await mediaCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };

  const record = await mediaRuntime()
    .media.series(actor, id)
    .catch(() => null);
  if (record === null) notFound();

  const offset = pageOffset(query, PAGE_SIZE);
  const episodes = await mediaRuntime().media.seriesEpisodes(actor, record.id, offset);
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
          <span>{t(`series.kindName.${record.kind}`)}</span>
          <span>
            {t('version')}: {record.version}
          </span>
          {record.state === 'published' ? (
            <TextLink href={seriesPath(locale, record.kind, record.slug)}>
              {t('viewPublic')}
            </TextLink>
          ) : null}
        </p>
      </div>

      <section className="flex flex-col gap-4">
        <SectionHeading>{t('series.episodes')}</SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('series.episodesHelp')}
        </p>
        <VideoTable
          locale={locale}
          videos={episodes.items}
          caption={t('series.episodes')}
          copy={copy}
          episode
        />
        <Pager
          offset={offset}
          hasMore={episodes.hasMore}
          hrefFor={(page) =>
            `${base}/${record.id}${page > 1 ? `?page=${String(page)}` : ''}`
          }
          label={t('series.episodes')}
          copy={copy}
        />
      </section>

      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>{t('series.edit')}</SectionHeading>
          <SeriesForm locale={locale} record={record} copy={copy} />
        </div>
      </Panel>
    </main>
  );
}

/* ===========================================================================
 * Playlists
 * ========================================================================= */

function PlaylistForm({
  locale,
  record,
  copy,
}: {
  readonly locale: Locale;
  readonly record: PlaylistRecord | null;
  readonly copy: Copy;
}) {
  const { t } = copy;
  const prefix = record === null ? 'new-playlist' : 'playlist';
  return (
    <ActionForm
      action={savePlaylist}
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

export async function PlaylistDirectory({ params, searchParams }: ListParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const base = `/${locale}/admin/media/playlists`;
  const context = await requireAdminPage(locale, 'media.read', base);
  const copy = await mediaCopy(locale);
  const { t } = copy;
  const filter = directoryQuery(query);
  const page = await mediaRuntime().media.playlists(
    { accountId: context.session.account.id },
    filter,
  );

  return (
    <main className="flex flex-col gap-8">
      <PageHeading>{t('surface.playlists')}</PageHeading>
      <DirectoryFilter
        base={base}
        state={filter.state}
        text={filter.text ?? ''}
        copy={copy}
      />
      <GroupTable
        locale={locale}
        items={page.items}
        caption={t('surface.playlists')}
        hrefFor={(id) => `${base}/${id}`}
        copy={copy}
      />
      <Pager
        offset={filter.offset}
        hasMore={page.hasMore}
        hrefFor={directoryHref(base, filter)}
        label={t('surface.playlists')}
        copy={copy}
      />
      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>{t('playlist.create')}</SectionHeading>
          <PlaylistForm locale={locale} record={null} copy={copy} />
        </div>
      </Panel>
    </main>
  );
}

/**
 * One membership change, as its own small form: the Playlist, the version the
 * operator is looking at, the Video and the named change. A stale click is a
 * visible conflict, never a reorder of something the operator has not seen.
 */
function ChangeForm({
  locale,
  playlist,
  videoId,
  op,
  direction,
  label,
  copy,
  tone = 'secondary',
}: {
  readonly locale: Locale;
  readonly playlist: PlaylistDetail;
  readonly videoId: string;
  readonly op: 'remove' | 'move';
  readonly direction?: 'earlier' | 'later';
  readonly label: string;
  readonly copy: Copy;
  readonly tone?: 'secondary' | 'destructive';
}) {
  return (
    <ActionForm
      action={changePlaylist}
      submitLabel={label}
      pendingLabel={copy.t('pending')}
      messages={copy.messages}
      tone={tone}
    >
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="playlistId" value={playlist.id} />
      <input type="hidden" name="version" value={String(playlist.version)} />
      <input type="hidden" name="videoId" value={videoId} />
      <input type="hidden" name="op" value={op} />
      {direction === undefined ? null : (
        <input type="hidden" name="direction" value={direction} />
      )}
    </ActionForm>
  );
}

export async function PlaylistEditor({ params, searchParams }: EditorParams) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const query = await searchParams;
  const base = `/${locale}/admin/media/playlists`;
  const context = await requireAdminPage(locale, 'media.read', base);
  const copy = await mediaCopy(locale);
  const { t } = copy;
  const actor = { accountId: context.session.account.id };

  const record = await mediaRuntime()
    .media.playlist(actor, id)
    .catch(() => null);
  if (record === null) notFound();

  const find = queryValue(query, 'find');
  const candidates = await mediaRuntime().media.videos(actor, { text: find });
  const members = new Set(record.videos.map((video) => video.id));
  const addable = candidates.items.filter((video) => !members.has(video.id));
  const label = mediaLabel(record, locale);
  const full = record.videos.length >= MEDIA_LIMITS.playlistVideos;

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
            <TextLink href={playlistPath(locale, record.slug)}>
              {t('viewPublic')}
            </TextLink>
          ) : null}
        </p>
      </div>

      <section className="flex flex-col gap-4" aria-labelledby="playlist-videos">
        <SectionHeading>
          <span id="playlist-videos">{t('playlist.videos')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('playlist.videosHelp', { count: String(record.videos.length) })}
        </p>
        {record.videos.length === 0 ? (
          <EmptyState>{t('playlist.videosEmpty')}</EmptyState>
        ) : (
          <ol aria-labelledby="playlist-videos" className="flex flex-col gap-3">
            {record.videos.map((video, index) => (
              <Panel key={video.id} as="li">
                <div className="flex flex-col gap-3">
                  <p className="flex flex-wrap items-center gap-3">
                    <span className="text-sm text-[color:var(--color-foreground-muted)]">
                      {t('playlist.position', { number: index + 1 })}
                    </span>
                    <TextLink href={`/${locale}/admin/media/videos/${video.id}`}>
                      <Title record={video} locale={locale} />
                    </TextLink>
                    <StateBadge state={video.state} copy={copy} />
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {index === 0 ? null : (
                      <ChangeForm
                        locale={locale}
                        playlist={record}
                        videoId={video.id}
                        op="move"
                        direction="earlier"
                        label={t('playlist.moveEarlier')}
                        copy={copy}
                      />
                    )}
                    {index === record.videos.length - 1 ? null : (
                      <ChangeForm
                        locale={locale}
                        playlist={record}
                        videoId={video.id}
                        op="move"
                        direction="later"
                        label={t('playlist.moveLater')}
                        copy={copy}
                      />
                    )}
                    <ChangeForm
                      locale={locale}
                      playlist={record}
                      videoId={video.id}
                      op="remove"
                      label={t('playlist.remove')}
                      copy={copy}
                      tone="destructive"
                    />
                  </div>
                </div>
              </Panel>
            ))}
          </ol>
        )}
      </section>

      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>{t('playlist.add')}</SectionHeading>
          <form method="get" className="flex flex-wrap items-end gap-3">
            <Field id="video-find" label={t('playlist.findLabel')}>
              {(props) => (
                <TextInput
                  {...props}
                  name="find"
                  defaultValue={find ?? ''}
                  maxLength={200}
                />
              )}
            </Field>
            <button
              type="submit"
              className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-medium"
            >
              {t('playlist.find')}
            </button>
          </form>
          {full ? (
            <EmptyState>{t('limit')}</EmptyState>
          ) : addable.length === 0 ? (
            <EmptyState>{t('playlist.noCandidates')}</EmptyState>
          ) : (
            <ActionForm
              action={changePlaylist}
              submitLabel={t('playlist.addSubmit')}
              pendingLabel={t('pending')}
              messages={copy.messages}
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="playlistId" value={record.id} />
              <input type="hidden" name="version" value={String(record.version)} />
              <input type="hidden" name="op" value="add" />
              <Field id="playlist-add-video" label={t('playlist.addVideo')}>
                {(props) => (
                  <Select {...props} name="videoId" required defaultValue="">
                    <option value="">{t('none')}</option>
                    {addable.map((video) => (
                      <option key={video.id} value={video.id}>
                        {mediaLabel(video, locale).title} ({video.slug})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </ActionForm>
          )}
        </div>
      </Panel>

      <Panel>
        <div className="flex flex-col gap-4">
          <SectionHeading>{t('playlist.edit')}</SectionHeading>
          <PlaylistForm locale={locale} record={record} copy={copy} />
        </div>
      </Panel>
    </main>
  );
}
