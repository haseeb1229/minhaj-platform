import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  MEDIA_FACET_PAGE,
  MEDIA_PAGE,
  providerWatchUrl,
  type PlaylistRecord,
  type SeriesKind,
  type SeriesRecord,
  type VideoFormat,
  type VideoListing,
  type VideoRecord,
} from '@minhaj/contracts/media';
import type { TopicView } from '@minhaj/contracts/taxonomy';

import { mediaReadRuntime } from '@/composition/media-read';
import {
  contentLanguages,
  referenceNames,
  type ContentLanguage,
} from '@/composition/public-references';
import { taxonomyRuntime } from '@/composition/taxonomy';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import {
  Alert,
  Breadcrumbs,
  Button,
  Container,
  DetailRow,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  Prose,
  SectionHeading,
  Select,
  StatusBadge,
  TextLink,
} from '@/components/ui';
import { absoluteUrl } from '@/config/origin';
import { directionOf } from '@/config/locale';
import { isContentIndexable, serializeStructuredData } from '@/seo/metadata';
import { Duration, formatDate, Pagination as MediaPagination } from './parts';
import { VideoPlayer } from './player';
import {
  mediaLabel,
  mediaLocales,
  offsetPath,
  playlistPath,
  readOffset,
  readMediaQuery,
  seriesPath,
  seriesSegment,
  videoPath,
  mediaQueryPath,
  videoStructuredData,
  viewOfFormat,
  WATCH_VIEWS,
} from './presentation';

/**
 * The public Watch surfaces (ROUTE_MAP.md §3.7) — Video, Series, Playlist.
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read goes through
 * `@/composition/media-read`, `@/composition/public-references` and
 * `@/composition/taxonomy`, none of which reaches Identity, a session or a
 * cookie, so a signed-in visitor sees exactly what an anonymous one does. The
 * one client island is the privacy-gated player.
 *
 * NO THIRD-PARTY REQUEST TO PAINT A CARD. A card's poster is a first-party
 * placeholder: no provider thumbnail, no frame, no preconnect. The provider is
 * contacted only from a Video's own page, and only after the visitor asks.
 *
 * EVERY FACT SHOWN IS ONE THE RECORD HAS. An unknown duration, date or format
 * is absent, never a dash; a missing caption or transcript is stated as
 * missing, never implied.
 */

type WatchTranslator = Awaited<ReturnType<typeof getTranslations<'watch'>>>;
type NameMap = ReadonlyMap<string, { readonly slug: string; readonly name: string }>;

/** A provider's name, for prose. */
function providerName(t: WatchTranslator, provider: VideoRecord['provider']): string {
  return t(`provider.${provider}`);
}

/* ===========================================================================
 * Cards
 * ========================================================================= */

/**
 * The poster. DECORATIVE AND FIRST-PARTY: a tinted panel with a play mark,
 * drawn inline, so a grid of twenty-four videos makes no request to anybody.
 */
function Poster() {
  return (
    <div
      aria-hidden="true"
      className="flex aspect-video w-full items-center justify-center rounded-[var(--radius-control)] bg-[color:var(--color-surface-sunken)] text-[color:var(--color-foreground-muted)]"
    >
      <svg viewBox="0 0 24 24" className="size-10" fill="currentColor">
        <path d="M8 5.5v13l11-6.5z" />
      </svg>
    </div>
  );
}

function VideoCard({
  locale,
  video,
  people,
  languages,
  t,
  headingLevel = 'h2',
  episode = false,
}: {
  readonly locale: Locale;
  readonly video: VideoListing;
  readonly people: NameMap;
  readonly languages: ReadonlyMap<string, ContentLanguage>;
  readonly t: WatchTranslator;
  readonly headingLevel?: 'h2' | 'h3';
  /** Show the episode number, for a Series page. */
  readonly episode?: boolean;
}) {
  const label = mediaLabel(video, locale);
  const Heading = headingLevel;
  const language = languages.get(video.languageCode);
  const speakers = video.speakerIds.flatMap((id) => {
    const person = people.get(id);
    return person === undefined ? [] : [person.name];
  });

  return (
    <Panel as="li">
      <div className="flex min-w-0 flex-col gap-3">
        <Poster />
        <div className="flex flex-wrap items-center gap-2">
          {episode && video.seriesPosition !== null ? (
            <StatusBadge tone="neutral">
              {t('fact.episode', { number: video.seriesPosition })}
            </StatusBadge>
          ) : null}
          {video.format === null ? null : (
            <StatusBadge tone="neutral">{t(`format.${video.format}`)}</StatusBadge>
          )}
          {video.availability === 'unavailable' ? (
            <StatusBadge tone="caution">{t('unavailable')}</StatusBadge>
          ) : null}
        </div>
        <Heading
          className="text-lg font-semibold break-words"
          lang={label.locale}
          dir={directionOf(label.locale)}
        >
          <TextLink href={videoPath(locale, video.slug)}>{label.title}</TextLink>
        </Heading>
        {speakers.length === 0 ? null : (
          <p className="text-sm break-words" dir="auto">
            <span className="text-[color:var(--color-foreground-muted)]">
              {t('speakers')}:{' '}
            </span>
            {speakers.join(' · ')}
          </p>
        )}
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-[color:var(--color-foreground-muted)]">
          {video.durationSeconds === null ? null : (
            <span>
              <Duration seconds={video.durationSeconds} />
            </span>
          )}
          {video.publishedOn === null ? null : (
            <span>
              <time dateTime={video.publishedOn}>
                {formatDate(video.publishedOn, locale)}
              </time>
            </span>
          )}
          <span lang={video.languageCode} dir={language?.direction ?? 'auto'}>
            {language?.name ?? video.languageCode}
          </span>
        </p>
      </div>
    </Panel>
  );
}

/**
 * A page of cards with the names of everyone on it resolved in ONE People call
 * and the content languages in ONE Taxonomy call — never a call per card.
 */
async function VideoGrid({
  locale,
  videos,
  label,
  headingLevel = 'h2',
  episode = false,
  ordered = false,
}: {
  readonly locale: Locale;
  readonly videos: readonly VideoListing[];
  readonly label: string;
  readonly headingLevel?: 'h2' | 'h3';
  readonly episode?: boolean;
  /** A playlist's order is its meaning, so it is an ordered list. */
  readonly ordered?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'watch' });
  const [references, languages] = await Promise.all([
    referenceNames(
      { personIds: videos.flatMap((video) => video.speakerIds), topicIds: [] },
      locale,
    ),
    contentLanguages(),
  ]);
  const List = ordered ? 'ol' : 'ul';

  return (
    <List aria-label={label} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {videos.map((video) => (
        <VideoCard
          key={video.id}
          locale={locale}
          video={video}
          people={references.people}
          languages={languages}
          t={t}
          headingLevel={headingLevel}
          episode={episode}
        />
      ))}
    </List>
  );
}

function Pagination({
  label,
  previous,
  next,
  t,
}: {
  readonly label: string;
  readonly previous: string | null;
  readonly next: string | null;
  readonly t: WatchTranslator;
}) {
  return (
    <MediaPagination
      label={label}
      previous={previous}
      next={next}
      previousLabel={t('previous')}
      nextLabel={t('next')}
    />
  );
}

/** Home / Watch / … — the trail every Watch page starts with. */
async function watchTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'watch' });
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: `/${locale}`, text: shell('nav.home') },
    watch: { href: `/${locale}/watch`, text: t('title') },
  };
}

/* ===========================================================================
 * Video listings — /watch/videos and the five curated views
 * ========================================================================= */

/**
 * A REAL GET FORM: every filter works without JavaScript, every filtered view
 * is a shareable address canonical to its base, and changing a filter returns
 * to the first page. The options are bounded vocabularies — active topics, the
 * speakers with the most published videos, published series and programmes,
 * Taxonomy's content languages — never the catalogue itself.
 *
 * TWO EMPTY STATES: "nothing is published here yet" and "nothing matches these
 * filters" are different facts, and the second offers the way back.
 */
export async function VideoListingPage({
  locale,
  format,
  query,
}: {
  readonly locale: Locale;
  readonly format: VideoFormat | null;
  readonly query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: 'watch' });
  const trail = await watchTrail(locale);
  const filters = readMediaQuery(query);
  const section = format === null ? 'videos' : viewOfFormat(format);
  const base = `/${locale}/watch/${section}`;
  const title = t(`sections.${section}` as 'sections.videos');

  const reads = mediaReadRuntime();
  const [page, languages, topics, speakers, series, programs] = await Promise.all([
    reads.videos({ ...filters, format }),
    contentLanguages(),
    taxonomyRuntime().taxonomy.listTree({ locale, includeArchived: false }),
    reads.speakerFacets(0),
    reads.seriesList('series', 0),
    reads.seriesList('program', 0),
  ]);
  const speakerNames = await referenceNames(
    {
      personIds: [
        ...speakers.items.map((facet) => facet.id),
        ...(filters.speaker === null ? [] : [filters.speaker]),
      ],
      topicIds: [],
    },
    locale,
  );

  const filtered =
    filters.topic !== null ||
    filters.speaker !== null ||
    filters.series !== null ||
    filters.language !== null;
  const groupings = [...series.items, ...programs.items];

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.watch, { text: title }]}
        />

        <div className="flex flex-col gap-2">
          <PageHeading>{title}</PageHeading>
          <p className="text-[color:var(--color-foreground-muted)]">
            {t(`sectionBody.${section}` as 'sectionBody.videos')}
          </p>
        </div>

        <Panel>
          <form
            method="get"
            action={base}
            className="flex flex-col gap-4"
            aria-label={t('filters')}
          >
            <div className="grid gap-4 sm:grid-cols-2">
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
              <Field id="filter-speaker" label={t('filterSpeaker')}>
                {(props) => (
                  <Select {...props} name="speaker" defaultValue={filters.speaker ?? ''}>
                    <option value="">{t('filterAny')}</option>
                    {[...speakerNames.people.entries()].map(([id, person]) => (
                      <option key={id} value={id}>
                        {person.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id="filter-series" label={t('filterSeries')}>
                {(props) => (
                  <Select {...props} name="series" defaultValue={filters.series ?? ''}>
                    <option value="">{t('filterAny')}</option>
                    {groupings.map((group) => (
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
          <VideoGrid locale={locale} videos={page.items} label={title} />
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
          t={t}
        />
      </div>
    </Container>
  );
}

/* ===========================================================================
 * Video detail
 * ========================================================================= */

/** The breadcrumb names and paths of one Video's page, shared with JSON-LD. */
function videoTrail(
  locale: Locale,
  record: VideoRecord,
  labels: { readonly home: string; readonly watch: string; readonly videos: string },
) {
  const label = mediaLabel(record, locale);
  return [
    { name: labels.home, path: `/${locale}` },
    { name: labels.watch, path: `/${locale}/watch` },
    { name: labels.videos, path: `/${locale}/watch/videos` },
    { name: label.title, path: videoPath(locale, record.slug) },
  ];
}

/**
 * JSON-LD, ONLY WHAT IS TRUE and only when the page may be indexed at all: a
 * `BreadcrumbList` always, and a `VideoObject` only under the truthful minimum
 * `videoStructuredData` enforces. While the deployment is pre-adoption nothing
 * is emitted (ROUTE_MAP.md §9.5, §9.6).
 */
function VideoStructuredData({
  locale,
  record,
  trail,
}: {
  readonly locale: Locale;
  readonly record: VideoRecord;
  readonly trail: readonly { readonly name: string; readonly path: string }[];
}) {
  if (!isContentIndexable({ contentLocales: mediaLocales(record) })) return null;
  const label = mediaLabel(record, locale);
  const video = videoStructuredData(
    record,
    label,
    absoluteUrl(videoPath(label.locale, record.slug)),
  );
  const graph: Record<string, unknown>[] = [
    {
      '@type': 'BreadcrumbList',
      itemListElement: trail.map((entry, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        name: entry.name,
        item: absoluteUrl(entry.path),
      })),
    },
    ...(video === null ? [] : [video]),
  ];
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: serializeStructuredData({
          '@context': 'https://schema.org',
          '@graph': graph,
        }),
      }}
    />
  );
}

/** How many other episodes a Video's page previews. */
const EPISODE_PREVIEW = 6;

/**
 * One Video's page: what it is and who speaks, then the privacy-gated player —
 * or, for a video the provider no longer serves, an honest statement and the
 * link — then its facts, accessibility alternatives, topics, series and
 * playlists. Usable signed out; nothing about the visit is recorded.
 */
export async function VideoDetailPage({
  locale,
  record,
}: {
  readonly locale: Locale;
  readonly record: VideoRecord;
}) {
  const t = await getTranslations({ locale, namespace: 'watch' });
  const trailParts = await watchTrail(locale);
  const reads = mediaReadRuntime();

  const [references, languages, playlists, episodes] = await Promise.all([
    referenceNames({ personIds: record.speakerIds, topicIds: record.topicIds }, locale),
    contentLanguages(),
    reads.videoPlaylists(record.id),
    record.series === null
      ? Promise.resolve(null)
      : reads.seriesVideos(record.series.id, 0),
  ]);

  const label = mediaLabel(record, locale);
  const direction = directionOf(label.locale);
  const language = languages.get(record.languageCode);
  const contentDirection = language?.direction ?? 'ltr';
  const provider = providerName(t, record.provider);
  const trail = videoTrail(locale, record, {
    home: trailParts.home.text,
    watch: trailParts.watch.text,
    videos: t('sections.videos'),
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
    episodes === null
      ? []
      : episodes.items
          .filter((video) => video.id !== record.id)
          .slice(0, EPISODE_PREVIEW);

  return (
    <Container>
      <article className="flex flex-col gap-10 py-12">
        <Breadcrumbs
          label={trailParts.label}
          trail={[
            ...trail
              .slice(0, -1)
              .map((entry) => ({ href: entry.path, text: entry.name })),
            { text: label.title },
          ]}
        />

        <Prose>
          <div className="flex flex-wrap items-center gap-2">
            {record.format === null ? null : (
              <StatusBadge tone="neutral">{t(`format.${record.format}`)}</StatusBadge>
            )}
            {record.availability === 'unavailable' ? (
              <StatusBadge tone="caution">{t('unavailable')}</StatusBadge>
            ) : null}
          </div>
          <h1
            className="text-3xl font-semibold tracking-tight break-words"
            lang={label.locale}
            dir={direction}
          >
            {label.title}
          </h1>
          {speakers.length === 0 ? null : (
            <p className="text-sm" dir="auto">
              <span className="text-[color:var(--color-foreground-muted)]">
                {t('speakers')}:{' '}
              </span>
              {speakers.map((person, index) => (
                <span key={person.slug}>
                  {index === 0 ? null : ' · '}
                  <TextLink href={`/${locale}/people/${encodeURIComponent(person.slug)}`}>
                    {person.name}
                  </TextLink>
                </span>
              ))}
            </p>
          )}
        </Prose>

        <section aria-labelledby="video-player" className="flex flex-col gap-3">
          <h2 id="video-player" className="sr-only">
            {t('playerHeading')}
          </h2>
          {record.availability === 'available' ? (
            <VideoPlayer
              provider={record.provider}
              providerVideoId={record.providerVideoId}
              labels={{
                notice: t('player.notice', { provider }),
                load: t('player.load', { provider }),
                fallback: t('player.fallback', { provider, title: label.title }),
                frameTitle: t('player.frameTitle', { provider, title: label.title }),
              }}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <Alert tone="info">{t('player.unavailable', { provider })}</Alert>
              <p className="text-sm">
                <TextLink
                  href={providerWatchUrl(record.provider, record.providerVideoId)}
                >
                  {t('player.tryProvider', { provider })}
                </TextLink>
              </p>
            </div>
          )}
        </section>

        {label.description === '' ? null : (
          <Prose>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('metadataNotice')}
            </p>
            {paragraphsOf(label.description).map((paragraph, index) => (
              <p key={index} lang={label.locale} dir={direction}>
                {paragraph}
              </p>
            ))}
          </Prose>
        )}

        <section className="flex flex-col gap-3" aria-labelledby="video-facts">
          <h2 id="video-facts" className="text-lg font-semibold">
            {t('facts')}
          </h2>
          <dl className="grid gap-x-8 sm:grid-cols-2">
            <DetailRow term={t('fact.provider')}>{provider}</DetailRow>
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
            {record.publishedOn === null ? null : (
              <DetailRow term={t('fact.published')}>
                <time dateTime={record.publishedOn}>
                  {formatDate(record.publishedOn, locale)}
                </time>
              </DetailRow>
            )}
            {record.series === null || seriesLabel === null ? null : (
              <DetailRow term={t(`fact.partOf.${record.series.kind}`)}>
                <TextLink
                  href={seriesPath(locale, record.series.kind, record.series.slug)}
                >
                  <span lang={seriesLabel.locale} dir={directionOf(seriesLabel.locale)}>
                    {seriesLabel.title}
                  </span>
                </TextLink>
                {' · '}
                {t('fact.episode', { number: record.series.position })}
              </DetailRow>
            )}
            <DetailRow term={t('fact.captions')}>
              {record.captions
                ? t('captionsAvailable', { provider })
                : t('captionsUnknown')}
            </DetailRow>
            <DetailRow term={t('fact.transcript')}>
              {record.transcript === null ? t('transcriptNone') : t('transcriptBelow')}
            </DetailRow>
          </dl>
        </section>

        {record.transcript === null ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="video-transcript">
            <h2 id="video-transcript" className="text-lg font-semibold">
              {t('fact.transcript')}
            </h2>
            <details className="rounded-[var(--radius-panel)] border border-[color:var(--color-border)] p-4">
              <summary className="min-h-11 cursor-pointer py-2 font-medium">
                {t('transcriptShow')}
              </summary>
              <div
                className="library-reader flex flex-col gap-4 pt-3"
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

        {topics.length === 0 ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="video-topics">
            <h2 id="video-topics" className="text-lg font-semibold">
              {t('topics')}
            </h2>
            <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
              {topics.map((topic) => (
                <li key={topic.slug}>
                  <TextLink href={`/${locale}/topics/${encodeURIComponent(topic.slug)}`}>
                    {topic.name}
                  </TextLink>
                </li>
              ))}
            </ul>
          </section>
        )}

        {playlists.length === 0 ? null : (
          <section className="flex flex-col gap-3" aria-labelledby="video-playlists">
            <h2 id="video-playlists" className="text-lg font-semibold">
              {t('inPlaylists')}
            </h2>
            <ul className="flex flex-col gap-1 text-sm">
              {playlists.map((playlist) => {
                const playlistLabel = mediaLabel(playlist, locale);
                return (
                  <li key={playlist.id}>
                    <TextLink href={playlistPath(locale, playlist.slug)}>
                      <span
                        lang={playlistLabel.locale}
                        dir={directionOf(playlistLabel.locale)}
                      >
                        {playlistLabel.title}
                      </span>
                    </TextLink>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {record.series === null || others.length === 0 ? null : (
          <section className="flex flex-col gap-4" aria-labelledby="video-episodes">
            <SectionHeading>
              <span id="video-episodes">{t(`moreFrom.${record.series.kind}`)}</span>
            </SectionHeading>
            <VideoGrid
              locale={locale}
              videos={others}
              label={t(`moreFrom.${record.series.kind}`)}
              headingLevel="h3"
              episode
            />
            <p>
              <TextLink href={seriesPath(locale, record.series.kind, record.series.slug)}>
                {t('allEpisodes')}
              </TextLink>
            </p>
          </section>
        )}

        <VideoStructuredData locale={locale} record={record} trail={trail} />
      </article>
    </Container>
  );
}

/* ===========================================================================
 * Series, programmes and playlists
 * ========================================================================= */

function GroupCard({
  locale,
  href,
  record,
}: {
  readonly locale: Locale;
  readonly href: string;
  readonly record: SeriesRecord | PlaylistRecord;
}) {
  const label = mediaLabel(record, locale);
  const direction = directionOf(label.locale);
  return (
    <Panel as="li">
      <div className="flex min-w-0 flex-col gap-2">
        <h2
          className="text-lg font-semibold break-words"
          lang={label.locale}
          dir={direction}
        >
          <TextLink href={href}>{label.title}</TextLink>
        </h2>
        {label.description === '' ? null : (
          <p
            className="line-clamp-3 text-sm break-words text-[color:var(--color-foreground-muted)]"
            lang={label.locale}
            dir={direction}
          >
            {label.description}
          </p>
        )}
      </div>
    </Panel>
  );
}

/** `/watch/series` and `/watch/programs`. */
export async function SeriesListingPage({
  locale,
  kind,
  query,
}: {
  readonly locale: Locale;
  readonly kind: SeriesKind;
  readonly query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: 'watch' });
  const trail = await watchTrail(locale);
  const offset = readOffset(query);
  const section = seriesSegment(kind);
  const base = `/${locale}/watch/${section}`;
  const title = t(`sections.${section}` as 'sections.series');
  const page = await mediaReadRuntime().seriesList(kind, offset);

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.watch, { text: title }]}
        />
        <div className="flex flex-col gap-2">
          <PageHeading>{title}</PageHeading>
          <p className="text-[color:var(--color-foreground-muted)]">
            {t(`sectionBody.${section}` as 'sectionBody.series')}
          </p>
        </div>
        {page.items.length === 0 ? (
          <EmptyState>{t(`groupEmpty.${kind}`)}</EmptyState>
        ) : (
          <ul aria-label={title} className="grid gap-4 sm:grid-cols-2">
            {page.items.map((record) => (
              <GroupCard
                key={record.id}
                locale={locale}
                record={record}
                href={seriesPath(locale, record.kind, record.slug)}
              />
            ))}
          </ul>
        )}
        <Pagination
          label={title}
          previous={
            offset > 0 ? offsetPath(base, Math.max(0, offset - MEDIA_PAGE)) : null
          }
          next={page.hasMore ? offsetPath(base, offset + MEDIA_PAGE) : null}
          t={t}
        />
      </div>
    </Container>
  );
}

/** BreadcrumbList JSON-LD for a grouping page, under the same indexing gate. */
function GroupStructuredData({
  record,
  trail,
}: {
  readonly record: SeriesRecord | PlaylistRecord;
  readonly trail: readonly { readonly name: string; readonly path: string }[];
}) {
  if (!isContentIndexable({ contentLocales: mediaLocales(record) })) return null;
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: serializeStructuredData({
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: trail.map((entry, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: entry.name,
            item: absoluteUrl(entry.path),
          })),
        }),
      }}
    />
  );
}

/**
 * A Series or a Playlist and its public Videos, in ITS order: episode order for
 * a Series, the curated order for a Playlist. Bounded pages; an honest empty
 * state when nothing in it is published yet.
 */
async function GroupDetail({
  locale,
  record,
  section,
  path,
  videos,
  offset,
  heading,
  empty,
  episode,
}: {
  readonly locale: Locale;
  readonly record: SeriesRecord | PlaylistRecord;
  readonly section: 'series' | 'programs' | 'playlists';
  readonly path: string;
  readonly videos: { readonly items: readonly VideoListing[]; readonly hasMore: boolean };
  readonly offset: number;
  readonly heading: string;
  readonly empty: string;
  readonly episode: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'watch' });
  const parts = await watchTrail(locale);
  const label = mediaLabel(record, locale);
  const direction = directionOf(label.locale);
  const sectionTitle = t(`sections.${section}`);
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.watch.text, path: parts.watch.href },
    { name: sectionTitle, path: `/${locale}/watch/${section}` },
    { name: label.title, path },
  ];

  return (
    <Container>
      <article className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={parts.label}
          trail={[
            ...trail
              .slice(0, -1)
              .map((entry) => ({ href: entry.path, text: entry.name })),
            { text: label.title },
          ]}
        />
        <Prose>
          <h1
            className="text-3xl font-semibold tracking-tight break-words"
            lang={label.locale}
            dir={direction}
          >
            {label.title}
          </h1>
          {paragraphsOf(label.description).map((paragraph, index) => (
            <p key={index} lang={label.locale} dir={direction}>
              {paragraph}
            </p>
          ))}
        </Prose>

        <section className="flex flex-col gap-4" aria-labelledby="group-videos">
          <SectionHeading>
            <span id="group-videos">{heading}</span>
          </SectionHeading>
          {videos.items.length === 0 ? (
            <EmptyState>{empty}</EmptyState>
          ) : (
            <VideoGrid
              locale={locale}
              videos={videos.items}
              label={heading}
              headingLevel="h3"
              episode={episode}
              ordered={!episode}
            />
          )}
          <Pagination
            label={heading}
            previous={
              offset > 0 ? offsetPath(path, Math.max(0, offset - MEDIA_PAGE)) : null
            }
            next={videos.hasMore ? offsetPath(path, offset + MEDIA_PAGE) : null}
            t={t}
          />
        </section>

        <GroupStructuredData record={record} trail={trail} />
      </article>
    </Container>
  );
}

export async function SeriesDetailPage({
  locale,
  record,
  query,
}: {
  readonly locale: Locale;
  readonly record: SeriesRecord;
  readonly query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: 'watch' });
  const offset = readOffset(query);
  const videos = await mediaReadRuntime().seriesVideos(record.id, offset);
  return (
    <GroupDetail
      locale={locale}
      record={record}
      section={seriesSegment(record.kind) as 'series' | 'programs'}
      path={seriesPath(locale, record.kind, record.slug)}
      videos={videos}
      offset={offset}
      heading={t('episodes')}
      empty={t('episodesEmpty')}
      episode
    />
  );
}

export async function PlaylistListingPage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: 'watch' });
  const trail = await watchTrail(locale);
  const offset = readOffset(query);
  const base = `/${locale}/watch/playlists`;
  const title = t('sections.playlists');
  const page = await mediaReadRuntime().playlists(offset);

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.watch, { text: title }]}
        />
        <div className="flex flex-col gap-2">
          <PageHeading>{title}</PageHeading>
          <p className="text-[color:var(--color-foreground-muted)]">
            {t('sectionBody.playlists')}
          </p>
        </div>
        {page.items.length === 0 ? (
          <EmptyState>{t('groupEmpty.playlist')}</EmptyState>
        ) : (
          <ul aria-label={title} className="grid gap-4 sm:grid-cols-2">
            {page.items.map((record) => (
              <GroupCard
                key={record.id}
                locale={locale}
                record={record}
                href={playlistPath(locale, record.slug)}
              />
            ))}
          </ul>
        )}
        <Pagination
          label={title}
          previous={
            offset > 0 ? offsetPath(base, Math.max(0, offset - MEDIA_PAGE)) : null
          }
          next={page.hasMore ? offsetPath(base, offset + MEDIA_PAGE) : null}
          t={t}
        />
      </div>
    </Container>
  );
}

export async function PlaylistDetailPage({
  locale,
  record,
  query,
}: {
  readonly locale: Locale;
  readonly record: PlaylistRecord;
  readonly query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: 'watch' });
  const offset = readOffset(query);
  const videos = await mediaReadRuntime().playlistVideos(record.id, offset);
  return (
    <GroupDetail
      locale={locale}
      record={record}
      section="playlists"
      path={playlistPath(locale, record.slug)}
      videos={videos}
      offset={offset}
      heading={t('playlistVideos')}
      empty={t('playlistEmpty')}
      episode={false}
    />
  );
}

/* ===========================================================================
 * Speakers, and a topic's videos
 * ========================================================================= */

/**
 * `/watch/speakers` — People named on at least one published Video.
 *
 * A PROJECTION OF PEOPLE, NOT A SECOND SPEAKER RECORD. Media counts its own
 * published Videos by speaker and asks People for the names, for a whole page
 * at once; each row links to the person's ONE canonical profile and to the
 * Videos they speak in. `/watch/speakers/{slug}` is an alias that 301s to
 * `/people/{slug}`.
 */
export async function SpeakerBrowsePage({
  locale,
  query,
}: {
  readonly locale: Locale;
  readonly query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: 'watch' });
  const trail = await watchTrail(locale);
  const offset = readOffset(query);
  const title = t('sections.speakers');
  const base = `/${locale}/watch/speakers`;
  const page = await mediaReadRuntime().speakerFacets(offset);
  const names = await referenceNames(
    { personIds: page.items.map((facet) => facet.id), topicIds: [] },
    locale,
  );
  const rows = page.items.flatMap((facet) => {
    const person = names.people.get(facet.id);
    return person === undefined ? [] : [{ id: facet.id, videos: facet.videos, person }];
  });

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.watch, { text: title }]}
        />
        <div className="flex flex-col gap-2">
          <PageHeading>{title}</PageHeading>
          <p className="text-[color:var(--color-foreground-muted)]">
            {t('sectionBody.speakers')}
          </p>
        </div>
        {rows.length === 0 ? (
          <EmptyState>{t('speakersEmpty')}</EmptyState>
        ) : (
          <ul aria-label={title} className="flex flex-col gap-3">
            {rows.map((row) => (
              <Panel key={row.id} as="li">
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="font-medium" dir="auto">
                    <TextLink
                      href={`/${locale}/people/${encodeURIComponent(row.person.slug)}`}
                    >
                      {row.person.name}
                    </TextLink>
                  </p>
                  <p className="text-sm">
                    <TextLink
                      href={mediaQueryPath(
                        `/${locale}/watch/videos`,
                        readMediaQuery({}),
                        {
                          speaker: row.id,
                        },
                      )}
                    >
                      {t('speakerVideos', { count: String(row.videos) })}
                    </TextLink>
                  </p>
                </div>
              </Panel>
            ))}
          </ul>
        )}
        <Pagination
          label={title}
          previous={
            offset > 0 ? offsetPath(base, Math.max(0, offset - MEDIA_FACET_PAGE)) : null
          }
          next={page.hasMore ? offsetPath(base, offset + MEDIA_FACET_PAGE) : null}
          t={t}
        />
      </div>
    </Container>
  );
}

/**
 * `/watch/topics/{slug}` — the Videos on one topic. A FILTERED VIEW whose
 * canonical is the topic hub, `/topics/{slug}` (ROUTE_MAP.md §2.2), which is
 * linked from here and which lists these Videos too.
 */
export async function WatchTopicPage({
  locale,
  topic,
  query,
}: {
  readonly locale: Locale;
  readonly topic: TopicView;
  readonly query: Record<string, string | string[] | undefined>;
}) {
  const t = await getTranslations({ locale, namespace: 'watch' });
  const trail = await watchTrail(locale);
  const offset = readOffset(query);
  const path = `/${locale}/watch/topics/${encodeURIComponent(topic.slug)}`;
  const page = await mediaReadRuntime().videos({ topic: topic.id, offset });
  const labelLocale = topic.label.resolvedLocale;

  return (
    <Container>
      <div className="flex flex-col gap-8 py-12">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.watch, { text: topic.label.name }]}
        />
        <div className="flex flex-col gap-2">
          <PageHeading>
            {t('topicTitle')}:{' '}
            <span lang={labelLocale} dir={directionOf(labelLocale)}>
              {topic.label.name}
            </span>
          </PageHeading>
          <p>
            <TextLink href={`/${locale}/topics/${encodeURIComponent(topic.slug)}`}>
              {t('topicHub')}
            </TextLink>
          </p>
        </div>
        {page.items.length === 0 ? (
          <EmptyState>{t('topicEmpty')}</EmptyState>
        ) : (
          <VideoGrid locale={locale} videos={page.items} label={topic.label.name} />
        )}
        <Pagination
          label={topic.label.name}
          previous={
            offset > 0 ? offsetPath(path, Math.max(0, offset - MEDIA_PAGE)) : null
          }
          next={page.hasMore ? offsetPath(path, offset + MEDIA_PAGE) : null}
          t={t}
        />
      </div>
    </Container>
  );
}

/* ===========================================================================
 * Previews composed into other owners' pages
 * ========================================================================= */

/** How many Videos a topic hub or a profile previews. */
const PREVIEW = 6;

/**
 * A bounded preview of public Videos — on a topic hub or a speaker's profile.
 * Renders NOTHING when there are none, so no page carries an empty frame for a
 * section with nothing in it (ROUTE_MAP.md §5.2).
 */
export async function VideoPreview({
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
  const page = await mediaReadRuntime().videos(filter);
  if (page.items.length === 0) return null;
  return (
    <section className="flex flex-col gap-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-semibold">
        {heading}
      </h2>
      <VideoGrid
        locale={locale}
        videos={page.items.slice(0, PREVIEW)}
        label={heading}
        headingLevel="h3"
      />
      <p>
        <TextLink href={more.href}>{more.text}</TextLink>
      </p>
    </section>
  );
}

/* ===========================================================================
 * The landing page
 * ========================================================================= */

/** How many Videos the landing page shows before linking to the full list. */
const LANDING = 12;

/** Every Watch surface this phase delivers, in the order the landing lists them. */
const SURFACES = [
  'videos',
  ...WATCH_VIEWS,
  'series',
  'programs',
  'playlists',
  'speakers',
];

/**
 * `/watch` — `?sort=featured|latest` (ROUTE_MAP.md §3.7).
 *
 * NO FAKE CURATION. "Featured" is the Videos an operator marked featured, and
 * when there are none the page says so and points at the latest instead of
 * relabelling the latest as featured. The browse list names only what exists:
 * the Watch surfaces, topics, and — from Phase 11 — Listen, Watch's sibling for
 * audio. No galleries, no "coming soon".
 */
export async function WatchLandingPage({
  locale,
  sort,
}: {
  readonly locale: Locale;
  readonly sort: 'featured' | 'latest';
}) {
  const t = await getTranslations({ locale, namespace: 'watch' });
  const trail = await watchTrail(locale);
  const page = await mediaReadRuntime().videos({ featured: sort === 'featured' });
  const heading = t(`sort.${sort}`);

  return (
    <Container>
      <div className="flex flex-col gap-10 py-12">
        <Breadcrumbs label={trail.label} trail={[trail.home, { text: t('title') }]} />
        <Prose>
          <PageHeading>{t('title')}</PageHeading>
          <p>{t('description')}</p>
        </Prose>

        <section className="flex flex-col gap-4" aria-labelledby="watch-videos">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <SectionHeading>
              <span id="watch-videos">{heading}</span>
            </SectionHeading>
            <nav aria-label={t('sort.label')}>
              <ul className="flex flex-wrap gap-4 text-sm">
                {(['featured', 'latest'] as const).map((option) => (
                  <li key={option}>
                    {option === sort ? (
                      <span aria-current="page" className="font-semibold">
                        {t(`sort.${option}`)}
                      </span>
                    ) : (
                      <TextLink
                        href={`/${locale}/watch${option === 'featured' ? '' : '?sort=latest'}`}
                      >
                        {t(`sort.${option}`)}
                      </TextLink>
                    )}
                  </li>
                ))}
              </ul>
            </nav>
          </div>
          {page.items.length === 0 ? (
            <EmptyState>
              {sort === 'featured' ? (
                <span className="flex flex-col gap-2">
                  <span>{t('featuredEmpty')}</span>
                  <TextLink href={`/${locale}/watch?sort=latest`}>
                    {t('sort.latest')}
                  </TextLink>
                </span>
              ) : (
                t('empty')
              )}
            </EmptyState>
          ) : (
            <VideoGrid
              locale={locale}
              videos={page.items.slice(0, LANDING)}
              label={heading}
              headingLevel="h3"
            />
          )}
          <p>
            <TextLink href={`/${locale}/watch/videos`}>{t('allVideos')}</TextLink>
          </p>
        </section>

        <section className="flex flex-col gap-4" aria-labelledby="watch-browse">
          <SectionHeading>
            <span id="watch-browse">{t('browse')}</span>
          </SectionHeading>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {SURFACES.map((surface) => (
              <Panel key={surface} as="li">
                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-semibold">
                    <TextLink href={`/${locale}/watch/${surface}`}>
                      {t(`sections.${surface}` as 'sections.videos')}
                    </TextLink>
                  </h3>
                  <p className="text-sm text-[color:var(--color-foreground-muted)]">
                    {t(`sectionBody.${surface}` as 'sectionBody.videos')}
                  </p>
                </div>
              </Panel>
            ))}
            <Panel as="li">
              <div className="flex flex-col gap-2">
                <h3 className="text-lg font-semibold">
                  <TextLink href={`/${locale}/topics`}>{t('sections.topics')}</TextLink>
                </h3>
                <p className="text-sm text-[color:var(--color-foreground-muted)]">
                  {t('sectionBody.topics')}
                </p>
              </div>
            </Panel>
            <Panel as="li">
              <div className="flex flex-col gap-2">
                <h3 className="text-lg font-semibold">
                  <TextLink href={`/${locale}/listen`}>{t('sections.listen')}</TextLink>
                </h3>
                <p className="text-sm text-[color:var(--color-foreground-muted)]">
                  {t('sectionBody.listen')}
                </p>
              </div>
            </Panel>
          </ul>
        </section>
      </div>
    </Container>
  );
}

/** The shape a Video's page metadata needs, from one record. */
export function videoMetadataInput(
  locale: Locale,
  record: VideoRecord,
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
    pathFor: (alternate) => videoPath(alternate, record.slug),
  };
}

/** The same for a Series, a programme or a Playlist. */
export function groupMetadataInput(
  locale: Locale,
  record: SeriesRecord | PlaylistRecord,
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
