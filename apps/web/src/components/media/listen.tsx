import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  MEDIA_PAGE,
  type AudioSeriesRecord,
  type AudioTrackListing,
  type AudioTrackRecord,
} from '@minhaj/contracts/media';

import { audioPlayable } from '@/composition/media-assets';
import { mediaReadRuntime } from '@/composition/media-read';
import { quranReadRuntime } from '@/composition/quran-read';
import {
  contentLanguages,
  referenceNames,
  type ContentLanguage,
} from '@/composition/public-references';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import {
  ActionLink,
  Alert,
  Breadcrumbs,
  Button,
  CardGrid,
  Container,
  DetailRow,
  EmptyState,
  Field,
  LinkCard,
  MetaRow,
  PageHero,
  Panel,
  Prose,
  SectionHeader,
  Select,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { AudioPlayer } from './audio-player';
import {
  BreadcrumbData,
  Duration,
  formatDate,
  MEDIA_CARD,
  MEDIA_CARD_LINK,
  MediaPageHeader,
  Pagination,
} from './parts';
import {
  audioSeriesPath,
  audioTrackPath,
  mediaLabel,
  mediaLocales,
  mediaQueryPath,
  offsetPath,
  readMediaQuery,
  readOffset,
} from './presentation';

/**
 * The public Listen surfaces (ROUTE_MAP.md §3.7) — non-Quran AudioTrack and
 * AudioSeries (Phase 11).
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read goes through
 * `@/composition/media-read`, `@/composition/media-assets`,
 * `@/composition/public-references` and `@/composition/taxonomy`, none of which
 * reaches Identity, a session or a cookie, so a signed-in listener sees exactly
 * what an anonymous one does, and nothing about a visit is recorded. The one
 * client island is the native audio player.
 *
 * HONEST PRESENTATION. There is no cover art, because no track has one: a row is
 * marked with a first-party audio glyph, never a stock image or a generated
 * picture. Every fact shown is one the record has — an unknown duration or date
 * is absent, never a dash — and a missing transcript is said to be missing.
 *
 * NO RECITATION IS HERE. Everything on these pages is non-Quran audio; Quran
 * recitations are Quran's. `/listen/recitations` is Quran's catalogue projected
 * into Listen (Phase 18), and the landing links it only while a Quran corpus is
 * active — the one question it asks of Quran's public reader.
 */

type ListenTranslator = Awaited<ReturnType<typeof getTranslations<'listen'>>>;
type NameMap = ReadonlyMap<string, { readonly slug: string; readonly name: string }>;

/** Home / Listen / … — the trail every Listen page starts with. */
async function listenTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'listen' });
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: `/${locale}`, text: shell('nav.home') },
    listen: { href: `/${locale}/listen`, text: t('title') },
  };
}

function pages(t: ListenTranslator) {
  return { previousLabel: t('previous'), nextLabel: t('next') };
}

/* ===========================================================================
 * Rows
 * ========================================================================= */

/**
 * The first-party audio mark. DECORATIVE, drawn inline, and the same for every
 * track: a row says what the recording is in words, not in a picture.
 */
function AudioMark() {
  return (
    <span
      aria-hidden="true"
      className="flex size-12 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-[color:var(--color-surface-sunken)] text-[color:var(--color-action)]"
    >
      <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor">
        <path
          strokeWidth="1.75"
          strokeLinecap="round"
          d="M4 14v-2a8 8 0 0 1 16 0v2M4 14v3a2 2 0 0 0 2 2h1v-7H6a2 2 0 0 0-2 2Zm16 0v3a2 2 0 0 1-2 2h-1v-7h1a2 2 0 0 1 2 2Z"
        />
      </svg>
    </span>
  );
}

function TrackRow({
  locale,
  track,
  people,
  languages,
  t,
  headingLevel,
  position,
}: {
  readonly locale: Locale;
  readonly track: AudioTrackListing;
  readonly people: NameMap;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly t: ListenTranslator;
  readonly headingLevel: 'h2' | 'h3';
  /** Show the track's place, for a series page. */
  readonly position: boolean;
}) {
  const label = mediaLabel(track, locale);
  const Heading = headingLevel;
  const language = languages.get(track.languageCode);
  const speakers = track.speakerIds.flatMap((id) => {
    const person = people.get(id);
    return person === undefined ? [] : [person.name];
  });

  return (
    <li className={MEDIA_CARD}>
      <div className="flex min-w-0 flex-1 items-start gap-4 p-4">
        <AudioMark />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {position && track.seriesPosition !== null ? (
            <p className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-[color:var(--color-accent)] uppercase">
              {t('fact.position', { number: track.seriesPosition })}
            </p>
          ) : null}
          <Heading
            className="text-subheading font-semibold wrap-anywhere"
            lang={label.locale}
            dir={directionOf(label.locale)}
          >
            <a href={audioTrackPath(locale, track.slug)} className={MEDIA_CARD_LINK}>
              {label.title}
            </a>
          </Heading>
          {speakers.length === 0 ? null : (
            <p
              className="line-clamp-2 text-sm wrap-anywhere text-[color:var(--color-foreground-muted)]"
              dir="auto"
            >
              <span className="sr-only">{t('speakers')}: </span>
              {speakers.join(' · ')}
            </p>
          )}
          <div className="mt-auto pt-1">
            <MetaRow
              items={[
                track.durationSeconds === null ? null : (
                  <Duration seconds={track.durationSeconds} />
                ),
                track.recordedOn === null ? null : (
                  <time dateTime={track.recordedOn}>
                    {formatDate(track.recordedOn, locale)}
                  </time>
                ),
                <span lang={track.languageCode} dir={language?.direction ?? 'auto'}>
                  {language?.name ?? track.languageCode}
                </span>,
              ]}
            />
          </div>
        </div>
      </div>
    </li>
  );
}

/**
 * A page of rows with every speaker's name resolved in ONE People call and the
 * content languages in ONE Taxonomy call — never a call per row.
 */
async function TrackList({
  locale,
  tracks,
  label,
  headingLevel = 'h2',
  ordered = false,
}: {
  readonly locale: Locale;
  readonly tracks: readonly AudioTrackListing[];
  readonly label: string;
  readonly headingLevel?: 'h2' | 'h3';
  /** A series is read in order, so it is an ordered list with its places shown. */
  readonly ordered?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'listen' });
  const [references, languages] = await Promise.all([
    referenceNames(
      { personIds: tracks.flatMap((track) => track.speakerIds), topicIds: [] },
      locale,
    ),
    contentLanguages(),
  ]);
  const List = ordered ? 'ol' : 'ul';

  return (
    <List
      aria-label={label}
      className="grid list-none grid-cols-1 gap-4 p-0 *:min-w-0 lg:grid-cols-2"
    >
      {tracks.map((track) => (
        <TrackRow
          key={track.id}
          locale={locale}
          track={track}
          people={references.people}
          languages={languages}
          t={t}
          headingLevel={headingLevel}
          position={ordered}
        />
      ))}
    </List>
  );
}

/* ===========================================================================
 * /listen/lectures
 * ========================================================================= */

/**
 * Every published track, most recently recorded first, with a REAL GET form:
 * every filter works without JavaScript, every filtered view is a shareable
 * address canonical to its base, and the options are bounded vocabularies —
 * active topics, published audio series, Taxonomy's content languages.
 *
 * A SPEAKER is a filter a person's profile links to rather than a menu here:
 * the filtered view names who it is showing and offers the way back.
 */
export async function TrackListingPage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: 'listen' });
  const trail = await listenTrail(locale);
  const filters = readMediaQuery(query);
  const base = `/${locale}/listen/lectures`;
  const title = t('sections.lectures');

  const reads = mediaReadRuntime();
  const [page, languages, topics, series, speaker] = await Promise.all([
    reads.audioTracks(filters),
    contentLanguages(),
    taxonomyRuntime().taxonomy.listTree({ locale, includeArchived: false }),
    reads.audioSeriesList(0),
    filters.speaker === null
      ? Promise.resolve(null)
      : referenceNames({ personIds: [filters.speaker], topicIds: [] }, locale).then(
          (names) => names.people.get(filters.speaker ?? '') ?? null,
        ),
  ]);

  const filtered =
    filters.topic !== null ||
    filters.speaker !== null ||
    filters.series !== null ||
    filters.language !== null;

  return (
    <Container>
      <div className="flex flex-col gap-8 py-[var(--space-page)]">
        <MediaPageHeader
          crumbs={{
            label: trail.label,
            trail: [trail.home, trail.listen, { text: title }],
          }}
          eyebrow={trail.listen.text}
          title={title}
          lede={t('sectionBody.lectures')}
        />

        <Panel>
          <form
            method="get"
            action={base}
            className="flex flex-col gap-4"
            aria-label={t('filters')}
          >
            {filters.speaker === null ? null : (
              <input type="hidden" name="speaker" value={filters.speaker} />
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field id="filter-topic" label={t('filterTopic')}>
                {(props) => (
                  <Select {...props} name="topic" defaultValue={filters.topic ?? ''}>
                    <option value="">{t('filterAny')}</option>
                    {topics.map((topic) => (
                      <option key={topic.id} value={topic.id}>
                        {topic.label.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="filter-series" label={t('filterSeries')}>
                {(props) => (
                  <Select {...props} name="series" defaultValue={filters.series ?? ''}>
                    <option value="">{t('filterAny')}</option>
                    {series.items.map((group) => (
                      <option key={group.id} value={group.id}>
                        {mediaLabel(group, locale).title}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="filter-language" label={t('filterLanguage')}>
                {(props) => (
                  <Select
                    {...props}
                    name="language"
                    defaultValue={filters.language ?? ''}
                  >
                    <option value="">{t('filterAny')}</option>
                    {[...languages.values()].map((language) => (
                      <option key={language.code} value={language.code}>
                        {language.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              <Button tone="secondary">{t('filterApply')}</Button>
              {filtered ? <TextLink href={base}>{t('filterClear')}</TextLink> : null}
            </div>
          </form>
        </Panel>

        {speaker === null ? null : (
          <p
            className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[var(--radius-control)] border border-[color:var(--color-accent-rule)] bg-[color:var(--color-accent-surface)] px-4 py-2 text-sm"
            dir="auto"
          >
            <span>{t('speakerActive')}</span>
            <TextLink href={`/${locale}/people/${encodeURIComponent(speaker.slug)}`}>
              {speaker.name}
            </TextLink>
            <span aria-hidden="true">·</span>
            <TextLink href={mediaQueryPath(base, filters, { speaker: null, offset: 0 })}>
              {t('speakerClear')}
            </TextLink>
          </p>
        )}

        {page.items.length === 0 ? (
          <EmptyState>
            {filtered ? (
              <span className="flex flex-col gap-2">
                <span>{t('emptyFiltered')}</span>
                <TextLink href={base}>{t('filterClear')}</TextLink>
              </span>
            ) : (
              t('empty')
            )}
          </EmptyState>
        ) : (
          <TrackList locale={locale} tracks={page.items} label={title} />
        )}

        <Pagination
          label={title}
          previous={
            filters.offset > 0
              ? mediaQueryPath(base, filters, {
                  offset: Math.max(0, filters.offset - MEDIA_PAGE),
                })
              : null
          }
          next={
            page.hasMore
              ? mediaQueryPath(base, filters, { offset: filters.offset + MEDIA_PAGE })
              : null
          }
          {...pages(t)}
        />
      </div>
    </Container>
  );
}

/* ===========================================================================
 * /listen/lectures/{slug}
 * ========================================================================= */

/** The breadcrumb names and paths of one track's page, shared with JSON-LD. */
function trackTrail(
  locale: Locale,
  record: AudioTrackRecord,
  labels: { readonly home: string; readonly listen: string; readonly lectures: string },
) {
  return [
    { name: labels.home, path: `/${locale}` },
    { name: labels.listen, path: `/${locale}/listen` },
    { name: labels.lectures, path: `/${locale}/listen/lectures` },
    { name: mediaLabel(record, locale).title, path: audioTrackPath(locale, record.slug) },
  ];
}

/** How many other tracks of the same series a track's page previews. */
const SERIES_PREVIEW = 6;

/**
 * One track's page: what it is and who speaks, then the player — or, when the
 * file cannot be served right now, an honest statement — then its facts, its
 * transcript where the organisation holds one, its topics and its series.
 */
export async function TrackDetailPage({
  locale,
  record,
}: {
  readonly locale: Locale;
  readonly record: AudioTrackRecord;
}) {
  const t = await getTranslations({ locale, namespace: 'listen' });
  const parts = await listenTrail(locale);
  const reads = mediaReadRuntime();

  const [references, languages, siblings, playable] = await Promise.all([
    referenceNames({ personIds: record.speakerIds, topicIds: record.topicIds }, locale),
    contentLanguages(),
    record.series === null
      ? Promise.resolve(null)
      : reads.audioSeriesTracks(record.series.id, 0),
    // The SAME two decisions the byte route makes: a published track can still
    // be unplayable when its file is missing or not cleared, and then no player
    // is offered.
    record.assetId === null
      ? Promise.resolve(false)
      : audioPlayable({ trackId: record.id, assetId: record.assetId }),
  ]);

  const label = mediaLabel(record, locale);
  const direction = directionOf(label.locale);
  const language = languages.get(record.languageCode);
  const contentDirection = language?.direction ?? 'ltr';
  const trail = trackTrail(locale, record, {
    home: parts.home.text,
    listen: parts.listen.text,
    lectures: t('sections.lectures'),
  });
  const speakers = record.speakerIds.flatMap((id) => {
    const person = references.people.get(id);
    return person === undefined ? [] : [person];
  });
  const topics = record.topicIds.flatMap((id) => {
    const topic = references.topics.get(id);
    return topic === undefined ? [] : [topic];
  });
  const seriesLabel = record.series === null ? null : mediaLabel(record.series, locale);
  const others =
    siblings === null
      ? []
      : siblings.items.filter((track) => track.id !== record.id).slice(0, SERIES_PREVIEW);
  const hasStory = label.description !== '' || record.transcript !== null;

  return (
    <Container>
      <article className="flex flex-col gap-10 py-[var(--space-page)]">
        <MediaPageHeader
          crumbs={{
            label: parts.label,
            trail: [
              ...trail
                .slice(0, -1)
                .map((entry) => ({ href: entry.path, text: entry.name })),
              { text: label.title },
            ],
          }}
          eyebrow={
            record.series === null
              ? parts.listen.text
              : t('fact.position', { number: record.series.position })
          }
          title={label.title}
          lang={label.locale}
          dir={direction}
          {...(speakers.length === 0
            ? {}
            : {
                lede: (
                  <p className="text-base" dir="auto">
                    <span>{t('speakers')}: </span>
                    {speakers.map((person, index) => (
                      <span key={person.slug}>
                        {index === 0 ? null : ' · '}
                        <TextLink
                          href={`/${locale}/people/${encodeURIComponent(person.slug)}`}
                        >
                          {person.name}
                        </TextLink>
                      </span>
                    ))}
                  </p>
                ),
              })}
          meta={
            <MetaRow
              items={[
                record.durationSeconds === null ? null : (
                  <Duration seconds={record.durationSeconds} />
                ),
                record.recordedOn === null ? null : (
                  <time dateTime={record.recordedOn}>
                    {formatDate(record.recordedOn, locale)}
                  </time>
                ),
                <span lang={record.languageCode} dir={contentDirection}>
                  {language?.name ?? record.languageCode}
                </span>,
              ]}
            />
          }
        />

        <section
          aria-labelledby="audio-player"
          className="max-w-4xl rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-5 shadow-[var(--shadow-panel)]"
        >
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-4">
              <AudioMark />
              <h2 id="audio-player" className="text-subheading font-semibold">
                {t('playerHeading')}
              </h2>
            </div>
            {playable && record.assetId !== null ? (
              <AudioPlayer
                trackId={record.id}
                assetId={record.assetId}
                mode="public"
                describedBy="audio-transcript-status"
                labels={{
                  player: t('player.name', { title: label.title }),
                  unsupported: t('player.unsupported'),
                  failed: t('player.failed'),
                }}
              />
            ) : (
              <Alert tone="info">{t('player.unavailable')}</Alert>
            )}
          </div>
        </section>

        <div
          className={`grid gap-10 ${hasStory ? 'lg:grid-cols-[minmax(0,1fr)_20rem]' : ''}`}
        >
          {hasStory ? (
            <div className="flex min-w-0 flex-col gap-10">
              {label.description === '' ? null : (
                <section className="flex flex-col gap-4" aria-labelledby="audio-about">
                  <h2 id="audio-about" className="text-heading font-semibold">
                    {t('aboutHeading')}
                  </h2>
                  <Prose>
                    {paragraphsOf(label.description).map((paragraph, index) => (
                      <p key={index} lang={label.locale} dir={direction}>
                        {paragraph}
                      </p>
                    ))}
                    <p className="text-caption border-s-2 border-[color:var(--color-accent-rule)] ps-3 text-[color:var(--color-foreground-muted)]">
                      {t('metadataNotice')}
                    </p>
                  </Prose>
                </section>
              )}

              {record.transcript === null ? null : (
                <section
                  className="flex flex-col gap-4"
                  aria-labelledby="audio-transcript"
                >
                  <h2 id="audio-transcript" className="text-heading font-semibold">
                    {t('fact.transcript')}
                  </h2>
                  <details className="rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] px-5 py-2">
                    <summary className="min-h-11 cursor-pointer py-2.5 font-medium">
                      {t('transcriptShow')}
                    </summary>
                    <div
                      className="library-reader flex max-w-[var(--measure-prose)] flex-col gap-4 pt-2 pb-4"
                      lang={record.languageCode}
                      dir={contentDirection}
                    >
                      {paragraphsOf(record.transcript).map((paragraph, index) => (
                        <p key={index}>{paragraph}</p>
                      ))}
                    </div>
                  </details>
                </section>
              )}
            </div>
          ) : null}

          <aside className="flex min-w-0 flex-col gap-8">
            <section
              className="flex flex-col gap-3 rounded-[var(--radius-panel)] border border-[color:var(--color-border)] bg-[color:var(--color-surface-raised)] p-5"
              aria-labelledby="audio-facts"
            >
              <h2 id="audio-facts" className="text-subheading font-semibold">
                {t('facts')}
              </h2>
              <dl
                className={`grid gap-x-8 divide-y divide-[color:var(--color-border)] ${
                  hasStory ? '' : 'sm:grid-cols-2 sm:divide-y-0'
                }`}
              >
                <DetailRow term={t('fact.language')}>
                  <span lang={record.languageCode} dir={contentDirection}>
                    {language?.name ?? record.languageCode}
                  </span>
                </DetailRow>
                {record.durationSeconds === null ? null : (
                  <DetailRow term={t('fact.duration')}>
                    <Duration seconds={record.durationSeconds} />
                  </DetailRow>
                )}
                {record.recordedOn === null ? null : (
                  <DetailRow term={t('fact.recorded')}>
                    <time dateTime={record.recordedOn}>
                      {formatDate(record.recordedOn, locale)}
                    </time>
                  </DetailRow>
                )}
                {record.series === null || seriesLabel === null ? null : (
                  <DetailRow term={t('fact.partOf')}>
                    <TextLink href={audioSeriesPath(locale, record.series.slug)}>
                      <span
                        lang={seriesLabel.locale}
                        dir={directionOf(seriesLabel.locale)}
                      >
                        {seriesLabel.title}
                      </span>
                    </TextLink>
                    {' · '}
                    {t('fact.position', { number: record.series.position })}
                  </DetailRow>
                )}
                <DetailRow term={t('fact.transcript')}>
                  <span id="audio-transcript-status">
                    {record.transcript === null
                      ? t('transcriptNone')
                      : t('transcriptBelow')}
                  </span>
                </DetailRow>
              </dl>
            </section>

            {topics.length === 0 ? null : (
              <section className="flex flex-col gap-3" aria-labelledby="audio-topics">
                <h2 id="audio-topics" className="text-subheading font-semibold">
                  {t('topics')}
                </h2>
                <TopicChips
                  label={t('topics')}
                  topics={topics.map((topic) => ({
                    href: `/${locale}/topics/${encodeURIComponent(topic.slug)}`,
                    text: topic.name,
                  }))}
                />
              </section>
            )}
          </aside>
        </div>

        {record.series === null || others.length === 0 ? null : (
          <section className="flex flex-col gap-5" aria-labelledby="audio-series-more">
            <SectionHeader
              id="audio-series-more"
              heading={t('moreFromSeries')}
              action={{
                href: audioSeriesPath(locale, record.series.slug),
                text: t('allInSeries'),
              }}
            />
            <TrackList
              locale={locale}
              tracks={others}
              label={t('moreFromSeries')}
              headingLevel="h3"
              ordered
            />
          </section>
        )}

        <BreadcrumbData contentLocales={mediaLocales(record)} trail={trail} />
      </article>
    </Container>
  );
}

/* ===========================================================================
 * /listen/series and /listen/series/{slug}
 * ========================================================================= */

function SeriesCard({
  locale,
  record,
  headingLevel,
}: {
  readonly locale: Locale;
  readonly record: AudioSeriesRecord;
  readonly headingLevel: 'h2' | 'h3';
}) {
  const label = mediaLabel(record, locale);
  const direction = directionOf(label.locale);
  const Heading = headingLevel;
  return (
    <li className={MEDIA_CARD}>
      <div className="flex min-w-0 flex-1 items-start gap-4 p-4">
        <AudioMark />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <Heading
            className="text-subheading font-semibold wrap-anywhere"
            lang={label.locale}
            dir={direction}
          >
            <a href={audioSeriesPath(locale, record.slug)} className={MEDIA_CARD_LINK}>
              {label.title}
            </a>
          </Heading>
          {label.description === '' ? null : (
            <p
              className="line-clamp-3 text-sm wrap-anywhere text-[color:var(--color-foreground-muted)]"
              lang={label.locale}
              dir={direction}
            >
              {label.description}
            </p>
          )}
        </div>
      </div>
    </li>
  );
}

export async function AudioSeriesListingPage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: 'listen' });
  const trail = await listenTrail(locale);
  const offset = readOffset(query);
  const base = `/${locale}/listen/series`;
  const title = t('sections.series');
  const page = await mediaReadRuntime().audioSeriesList(offset);

  return (
    <Container>
      <div className="flex flex-col gap-8 py-[var(--space-page)]">
        <MediaPageHeader
          crumbs={{
            label: trail.label,
            trail: [trail.home, trail.listen, { text: title }],
          }}
          eyebrow={trail.listen.text}
          title={title}
          lede={t('sectionBody.series')}
        />
        {page.items.length === 0 ? (
          <EmptyState>{t('seriesListEmpty')}</EmptyState>
        ) : (
          <CardGrid label={title} columns={2}>
            {page.items.map((record) => (
              <SeriesCard
                key={record.id}
                locale={locale}
                record={record}
                headingLevel="h2"
              />
            ))}
          </CardGrid>
        )}
        <Pagination
          label={title}
          previous={
            offset > 0 ? offsetPath(base, Math.max(0, offset - MEDIA_PAGE)) : null
          }
          next={page.hasMore ? offsetPath(base, offset + MEDIA_PAGE) : null}
          {...pages(t)}
        />
      </div>
    </Container>
  );
}

/**
 * An AudioSeries and its published tracks, IN SERIES ORDER, in bounded pages,
 * with an honest empty state while none of them is published yet.
 */
export async function AudioSeriesDetailPage({
  locale,
  record,
  query,
}: {
  readonly locale: Locale;
  readonly record: AudioSeriesRecord;
  readonly query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: 'listen' });
  const parts = await listenTrail(locale);
  const offset = readOffset(query);
  const path = audioSeriesPath(locale, record.slug);
  const tracks = await mediaReadRuntime().audioSeriesTracks(record.id, offset);
  const label = mediaLabel(record, locale);
  const direction = directionOf(label.locale);
  const sectionTitle = t('sections.series');
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.listen.text, path: parts.listen.href },
    { name: sectionTitle, path: `/${locale}/listen/series` },
    { name: label.title, path },
  ];
  const description = paragraphsOf(label.description);

  return (
    <Container>
      <article className="flex flex-col gap-10 py-[var(--space-page)]">
        <MediaPageHeader
          crumbs={{
            label: parts.label,
            trail: [
              ...trail
                .slice(0, -1)
                .map((entry) => ({ href: entry.path, text: entry.name })),
              { text: label.title },
            ],
          }}
          eyebrow={sectionTitle}
          title={label.title}
          lang={label.locale}
          dir={direction}
        >
          {description.length === 0 ? null : (
            <div className="flex max-w-[var(--measure-prose)] flex-col gap-3 pt-1">
              {description.map((paragraph, index) => (
                <p key={index} lang={label.locale} dir={direction}>
                  {paragraph}
                </p>
              ))}
            </div>
          )}
        </MediaPageHeader>

        <section className="flex flex-col gap-5" aria-labelledby="series-tracks">
          <SectionHeader id="series-tracks" heading={t('seriesTracks')} />
          {tracks.items.length === 0 ? (
            <EmptyState>{t('seriesEmpty')}</EmptyState>
          ) : (
            <TrackList
              locale={locale}
              tracks={tracks.items}
              label={t('seriesTracks')}
              headingLevel="h3"
              ordered
            />
          )}
          <Pagination
            label={t('seriesTracks')}
            previous={
              offset > 0 ? offsetPath(path, Math.max(0, offset - MEDIA_PAGE)) : null
            }
            next={tracks.hasMore ? offsetPath(path, offset + MEDIA_PAGE) : null}
            {...pages(t)}
          />
        </section>

        <BreadcrumbData contentLocales={mediaLocales(record)} trail={trail} />
      </article>
    </Container>
  );
}

/* ===========================================================================
 * The landing page, and previews composed into other owners' pages
 * ========================================================================= */

/** How many recent tracks the landing shows, and how many series. */
const LANDING_TRACKS = 8;
const LANDING_SERIES = 4;

/**
 * `/listen` — the newest recordings, the audio series, and the ways in. The
 * browse list names only what exists: lectures, series and topics, Watch for
 * video, and — only while a Quran corpus is active — the recitation catalogue
 * Quran owns. No "coming soon".
 */
export async function ListenLandingPage({ locale }: { readonly locale: Locale }) {
  const t = await getTranslations({ locale, namespace: 'listen' });
  const trail = await listenTrail(locale);
  const reads = mediaReadRuntime();
  const [latest, series, quran] = await Promise.all([
    reads.audioTracks({}),
    reads.audioSeriesList(0),
    quranReadRuntime().reader.availability(),
  ]);

  const browse = [
    { href: `/${locale}/listen/lectures`, key: 'lectures' },
    { href: `/${locale}/listen/series`, key: 'series' },
    ...(quran.active
      ? [{ href: `/${locale}/listen/recitations`, key: 'recitations' } as const]
      : []),
    { href: `/${locale}/topics`, key: 'topics' },
    { href: `/${locale}/watch`, key: 'watch' },
  ] as const;

  return (
    <>
      <Container>
        <div className="pt-6">
          <Breadcrumbs label={trail.label} trail={[trail.home, { text: t('title') }]} />
        </div>
      </Container>
      <PageHero
        title={t('title')}
        lede={t('description')}
        actions={
          <ActionLink href={`/${locale}/listen/lectures`}>{t('allTracks')}</ActionLink>
        }
      />

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          <section className="flex flex-col gap-5" aria-labelledby="listen-latest">
            <SectionHeader
              id="listen-latest"
              heading={t('latest')}
              intro={t('latestIntro')}
            />
            {latest.items.length === 0 ? (
              <EmptyState>{t('empty')}</EmptyState>
            ) : (
              <TrackList
                locale={locale}
                tracks={latest.items.slice(0, LANDING_TRACKS)}
                label={t('latest')}
                headingLevel="h3"
              />
            )}
          </section>

          {series.items.length === 0 ? null : (
            <section className="flex flex-col gap-5" aria-labelledby="listen-series">
              <SectionHeader
                id="listen-series"
                heading={t('sections.series')}
                intro={t('sectionBody.series')}
                action={{ href: `/${locale}/listen/series`, text: t('allSeries') }}
              />
              <CardGrid label={t('sections.series')} columns={2}>
                {series.items.slice(0, LANDING_SERIES).map((record) => (
                  <SeriesCard
                    key={record.id}
                    locale={locale}
                    record={record}
                    headingLevel="h3"
                  />
                ))}
              </CardGrid>
            </section>
          )}

          <section className="flex flex-col gap-5" aria-labelledby="listen-browse">
            <SectionHeader
              id="listen-browse"
              heading={t('browse')}
              intro={t('browseIntro')}
            />
            <CardGrid columns={browse.length >= 5 ? 3 : 4}>
              {browse.map((entry) => (
                <LinkCard
                  key={entry.key}
                  href={entry.href}
                  title={t(`sections.${entry.key}`)}
                  description={t(`sectionBody.${entry.key}`)}
                />
              ))}
            </CardGrid>
          </section>
        </div>
      </Container>
    </>
  );
}

/** How many tracks a topic hub or a profile previews. */
const PREVIEW = 4;

/**
 * A bounded preview of public tracks — on a topic hub or a speaker's profile,
 * composed there at Layer 4 through Media's public reader. Renders NOTHING when
 * there are none, so no page carries an empty frame (ROUTE_MAP.md §5.2).
 */
export async function AudioPreview({
  locale,
  filter,
  heading,
  headingId,
  more,
}: {
  readonly locale: Locale;
  readonly filter: { readonly topic?: string; readonly speaker?: string };
  readonly heading: string;
  readonly headingId: string;
  readonly more: { readonly href: string; readonly text: string };
}) {
  const page = await mediaReadRuntime().audioTracks(filter);
  if (page.items.length === 0) return null;
  return (
    <section className="flex flex-col gap-5" aria-labelledby={headingId}>
      <SectionHeader id={headingId} heading={heading} action={more} />
      <TrackList
        locale={locale}
        tracks={page.items.slice(0, PREVIEW)}
        label={heading}
        headingLevel="h3"
      />
    </section>
  );
}

/** The shape a track's or a series' page metadata needs, from one record. */
export function listenMetadataInput(
  locale: Locale,
  record: AudioTrackRecord | AudioSeriesRecord,
  pathFor: (alternate: Locale) => string,
): {
  readonly title: string;
  readonly description?: string;
  readonly contentLocales: Locale[];
  readonly primaryLocale: Locale;
  readonly pathFor: (alternate: Locale) => string;
} {
  const label = mediaLabel(record, locale);
  return {
    title: label.title,
    ...(label.description === '' ? {} : { description: label.description.slice(0, 160) }),
    contentLocales: mediaLocales(record),
    primaryLocale: record.primaryLocale,
    pathFor,
  };
}
