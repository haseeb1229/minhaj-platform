import type { ReactNode } from 'react';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  formatDuration,
  providerWatchUrl,
  type TopicVideo,
  type VideoListing,
  type VideoPoster,
  type VideoRecord,
} from '@minhaj/contracts/media';

import { mediaReadRuntime } from '@/composition/media-read';
import { contentLanguages, referenceNames } from '@/composition/public-references';
import {
  contentLanguageBadge,
  interfaceLanguageFirst,
} from '@/components/content-language';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import { caseless } from '@/components/topic-hub/address';
import { languageName } from '@/components/topic-hub/parts';
import { VideoShelf as VideoCards } from '@/components/topic-hub/videos';
import { watchVideosHref } from '@/components/topic-hub/videos-view';
import {
  ActionLink,
  Alert,
  Badge,
  Breadcrumbs,
  Container,
  DetailRow,
  EmptyState,
  Hero,
  Icon,
  LanguageBadge,
  LinkCard,
  LinkTabs,
  ListRow,
  MediaCard,
  MetaRow,
  Poster,
  Prose,
  SectionHeader,
  Stat,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { Shelf } from '@/components/ui/shelf';
import { absoluteUrl } from '@/config/origin';
import { directionOf } from '@/config/locale';
import { isContentIndexable, serializeStructuredData } from '@/seo/metadata';
import { Duration, formatDate } from './parts';
import { VideoPlayer } from './player';
import {
  formatOfView,
  mediaLabel,
  mediaLocales,
  playlistPath,
  seriesPath,
  videoPath,
  videoPosterPath,
  videoStructuredData,
  watchLanding,
  WATCH_VIEWS,
} from './presentation';
import { ShareVideo } from './share';

/**
 * The public Watch surfaces (ROUTE_MAP.md §3.7) — the landing and a Video's
 * page. Since Watch Part 2 the Series, programme and Playlist directories and
 * pages are `./groups`, and the speakers' directory `./speakers`.
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read goes through
 * `@/composition/media-read` and `@/composition/public-references`, neither
 * of which reaches Identity, a session or a cookie, so a signed-in visitor
 * sees exactly what an anonymous one does. The client islands are the
 * privacy-gated player and (Watch Part 1) the share button; a Video's page is
 * handed the private Save island from its route.
 *
 * WATCH PART 1: the video listings — `/watch/videos` and the five curated
 * views — are the shared Videos listing (`./videos`), and `/watch/topics/{slug}`
 * is one 301 into it.
 *
 * NO THIRD-PARTY REQUEST TO PAINT A CARD. A card's poster is first-party: our
 * own stored copy of the Video's image where it has one (Phase 30-R), else a
 * drawn placeholder — never a provider thumbnail, frame or preconnect. The
 * provider is contacted only from a Video's own page, and only after the
 * visitor asks.
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
 * A Video's picture, as the image primitives take it: our own stored copy of
 * the poster the organisation published for it (Phase 30-R), at Media's own
 * route, with its measured size — or null, and the card is text-first. NEVER a
 * provider thumbnail: painting a card contacts nobody but this platform.
 */
function posterImage(video: {
  readonly id: string;
  readonly poster: VideoPoster | null;
}): { readonly path: string; readonly width: number; readonly height: number } | null {
  return video.poster === null
    ? null
    : {
        path: videoPosterPath(video.id, video.poster.assetId),
        width: video.poster.width,
        height: video.poster.height,
      };
}

/** The people named on a page of Videos, in their order, as plain names. */
function speakerNames(video: VideoListing, people: NameMap): string {
  return video.speakerIds
    .flatMap((id) => {
      const person = people.get(id);
      return person === undefined ? [] : [person.name];
    })
    .join(' · ');
}

/**
 * ONE VIDEO AS A POSTER CARD (R2): the 16:9 poster edge to edge with its kind
 * on the picture and its running time on the corner, then the title in its own
 * language, then who speaks and when. The card is one link. A Video in another
 * language than the interface says which (F10); one the provider no longer
 * serves says so on its picture, so the card never promises playback.
 */
function VideoCard({
  locale,
  video,
  people,
  t,
  headingLevel = 'h2',
  episode = false,
  priority = false,
  sizes = '(min-width: 64rem) 22rem, (min-width: 40rem) 45vw, 100vw',
}: {
  readonly locale: Locale;
  readonly video: VideoListing;
  readonly people: NameMap;
  readonly t: WatchTranslator;
  readonly headingLevel?: 'h2' | 'h3';
  /** Show the episode number, for a Series page. */
  readonly episode?: boolean;
  readonly priority?: boolean;
  readonly sizes?: string;
}) {
  const label = mediaLabel(video, locale);
  const language = contentLanguageBadge(video.languageCode, locale);
  const kind =
    video.availability === 'unavailable'
      ? t('unavailable')
      : video.format === null
        ? undefined
        : t(`format.${video.format}`);
  const speakers = speakerNames(video, people);

  return (
    <MediaCard
      href={videoPath(locale, video.slug)}
      title={label.title}
      lang={label.locale}
      dir={directionOf(label.locale)}
      headingLevel={headingLevel}
      image={posterImage(video)}
      aspect="poster"
      sizes={sizes}
      priority={priority}
      {...(kind === undefined ? {} : { type: kind })}
      {...(language === undefined ? {} : { language })}
      {...(video.durationSeconds === null
        ? {}
        : { overlay: <Duration seconds={video.durationSeconds} /> })}
      meta={[
        episode && video.seriesPosition !== null
          ? t('fact.episode', { number: video.seriesPosition })
          : null,
        speakers === '' ? null : (
          <span dir="auto">
            <span className="sr-only">{t('speakers')}: </span>
            {speakers}
          </span>
        ),
        video.publishedOn === null ? null : (
          <time dateTime={video.publishedOn}>
            {formatDate(video.publishedOn, locale)}
          </time>
        ),
      ]}
    />
  );
}

/** The grid Media cards sit in: one column on a phone, up to three on a laptop. */
const VIDEO_GRID =
  'grid list-none grid-cols-1 gap-x-6 gap-y-9 p-0 *:min-w-0 sm:grid-cols-2 lg:grid-cols-3';

/** The people on a page of Videos, resolved in ONE People call. */
async function speakersOf(videos: readonly VideoListing[], locale: Locale) {
  const references = await referenceNames(
    { personIds: videos.flatMap((video) => video.speakerIds), topicIds: [] },
    locale,
  );
  return references.people;
}

/**
 * A page of cards with the names of everyone on it resolved in ONE People call
 * — never a call per card.
 */
async function VideoGrid({
  locale,
  videos,
  label,
  headingLevel = 'h2',
  episode = false,
  ordered = false,
  lead = false,
}: {
  readonly locale: Locale;
  readonly videos: readonly VideoListing[];
  readonly label: string;
  readonly headingLevel?: 'h2' | 'h3';
  readonly episode?: boolean;
  /** A playlist's order is its meaning, so it is an ordered list. */
  readonly ordered?: boolean;
  /**
   * The first card leads: two columns and two rows wide from a laptop up, its
   * poster loaded first — the landing's opening picture.
   */
  readonly lead?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'watch' });
  const people = await speakersOf(videos, locale);
  const List = ordered ? 'ol' : 'ul';

  return (
    <List
      aria-label={label}
      className={`${VIDEO_GRID} ${lead ? 'lg:items-start lg:[&>li:first-child]:col-span-2 lg:[&>li:first-child]:row-span-2' : ''}`}
    >
      {videos.map((video, index) => (
        <VideoCard
          key={video.id}
          locale={locale}
          video={video}
          people={people}
          t={t}
          headingLevel={headingLevel}
          episode={episode}
          {...(lead && index === 0
            ? {
                priority: true,
                sizes: '(min-width: 64rem) 46rem, (min-width: 40rem) 45vw, 100vw',
              }
            : {})}
        />
      ))}
    </List>
  );
}

/**
 * A SHELF OF POSTERS (R2): one horizontal row under its section header, every
 * card in the list and the tab order, scrolled by touch or by its buttons.
 */
async function VideoShelf({
  locale,
  id,
  heading,
  headingLang,
  videos,
  action,
  episode = false,
}: {
  readonly locale: Locale;
  readonly id: string;
  readonly heading: string;
  /** The heading's language, when it is content (a programme's title). */
  readonly headingLang?: Locale;
  readonly videos: readonly VideoListing[];
  readonly action: { readonly href: string; readonly text: string };
  readonly episode?: boolean;
}) {
  const t = await getTranslations({ locale, namespace: 'watch' });
  const people = await speakersOf(videos, locale);

  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-5">
      <Shelf
        label={heading}
        previousLabel={t('previous')}
        nextLabel={t('next')}
        size="poster"
        header={
          <SectionHeader
            id={id}
            heading={
              headingLang === undefined ? (
                heading
              ) : (
                <span lang={headingLang} dir={directionOf(headingLang)}>
                  {heading}
                </span>
              )
            }
            action={action}
          />
        }
      >
        {videos.map((video) => (
          <VideoCard
            key={video.id}
            locale={locale}
            video={video}
            people={people}
            t={t}
            headingLevel="h3"
            episode={episode}
            sizes="(min-width: 40rem) 18.5rem, 16rem"
          />
        ))}
      </Shelf>
    </section>
  );
}

/** Home / Watch / … — the trail every Watch page starts with. */
async function watchTrail(locale: Locale) {
  const shell = await getTranslations({ locale, namespace: 'shell' });
  const t = await getTranslations({ locale, namespace: 'watch' });
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: localizedPath(locale, ''), text: shell('nav.home') },
    watch: { href: localizedPath(locale, '/watch'), text: t('title') },
  };
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
    { name: labels.home, path: localizedPath(locale, '') },
    { name: labels.watch, path: localizedPath(locale, '/watch') },
    { name: labels.videos, path: localizedPath(locale, '/watch/videos') },
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

/** How many episodes around this one a Video's page lists. */
const EPISODE_WINDOW = 5;

/** How many videos each related shelf of a Video's page shows. */
const RELATED_PREVIEW = 3;

/** How many a related read asks for, so that what is excluded still leaves a shelf. */
const RELATED_ASK = 12;

/** One "more like this" shelf under a Video: what relates it, and the way to all of them. */
interface RelatedShelf {
  readonly key: 'speaker' | 'topic' | 'language';
  readonly heading: string;
  readonly more: { readonly href: string; readonly text: string };
  readonly videos: readonly TopicVideo[];
}

/**
 * WHAT ELSE TO WATCH — composed from Media's own public reads, so "related"
 * is a fact the records state, never a guess: more with its first speaker,
 * more on its first Topic, and only when neither has anything else, more in
 * its content language. Never itself, never an episode already offered
 * beside it, never one video twice. When the page offers no next episode, the
 * first of them is "Up next".
 */
async function relatedVideos(
  locale: Locale,
  record: VideoRecord,
  exclude: ReadonlySet<string>,
  names: {
    readonly speaker: string | null;
    readonly topic: string | null;
  },
  t: WatchTranslator,
  takeUpNext: boolean,
): Promise<{
  readonly upNext: TopicVideo | null;
  readonly shelves: readonly RelatedShelf[];
}> {
  const reads = mediaReadRuntime();
  const ask = (filter: Record<string, string>) =>
    reads.topicVideos({
      scope: 'media',
      titleLocale: locale,
      limit: RELATED_ASK,
      ...filter,
    });
  const speaker = record.speakerIds[0];
  const topic = record.topicIds[0];
  const [bySpeaker, byTopic] = await Promise.all([
    speaker === undefined || names.speaker === null ? null : ask({ speaker }),
    topic === undefined || names.topic === null ? null : ask({ topic }),
  ]);
  const seen = new Set([record.id, ...exclude]);
  // Held in an object: the helper below decides it.
  const picked: { upNext: TopicVideo | null } = { upNext: null };
  const shelves: RelatedShelf[] = [];
  const add = (
    key: RelatedShelf['key'],
    page: { readonly items: readonly TopicVideo[]; readonly total: number } | null,
    heading: string,
    href: string,
  ) => {
    if (page === null) return;
    const fresh = page.items.filter((video) => !seen.has(video.id));
    if (takeUpNext && picked.upNext === null && fresh[0] !== undefined) {
      picked.upNext = fresh[0];
      seen.add(fresh[0].id);
      fresh.shift();
    }
    const videos = fresh.slice(0, RELATED_PREVIEW);
    for (const video of videos) seen.add(video.id);
    if (videos.length > 0)
      shelves.push({
        key,
        heading,
        more: { href, text: t('relatedAll', { count: page.total }) },
        videos,
      });
  };
  if (speaker !== undefined && names.speaker !== null)
    add(
      'speaker',
      bySpeaker,
      t('relatedSpeaker', { name: names.speaker }),
      watchVideosHref(locale, { speaker }),
    );
  if (topic !== undefined && names.topic !== null)
    add(
      'topic',
      byTopic,
      t('relatedTopic', { name: names.topic }),
      watchVideosHref(locale, { topic }),
    );
  if (shelves.length === 0 && picked.upNext === null)
    add(
      'language',
      await ask({ language: record.languageCode }),
      t('relatedLanguage', { name: languageName(record.languageCode, locale) }),
      watchVideosHref(locale, { language: record.languageCode }),
    );
  return { upNext: picked.upNext, shelves };
}

/** A previous or next episode, as a card with its direction named first. */
function EpisodeStep({
  locale,
  video,
  direction,
  t,
}: {
  readonly locale: Locale;
  readonly video: VideoListing;
  readonly direction: 'previous' | 'next';
  readonly t: WatchTranslator;
}) {
  const label = mediaLabel(video, locale);
  return (
    <a
      href={videoPath(locale, video.slug)}
      className={`group flex min-h-11 min-w-0 flex-col gap-1 rounded-control border border-border bg-surface p-3 no-underline hover:border-action ${direction === 'next' ? 'sm:col-start-2 sm:items-end sm:text-end' : ''}`}
    >
      <span className="inline-flex items-center gap-1.5 text-caption font-semibold text-action">
        {direction === 'previous' ? <Icon name="arrow-start" size={16} /> : null}
        {t(direction === 'previous' ? 'previousEpisode' : 'nextEpisode')}
        {video.seriesPosition === null ? null : (
          <span className="font-normal text-foreground-muted">
            {' · '}
            {t('fact.episode', { number: video.seriesPosition })}
          </span>
        )}
        {direction === 'next' ? <Icon name="arrow-end" size={16} /> : null}
      </span>
      <span
        className="font-medium text-foreground wrap-anywhere group-hover:underline"
        lang={label.locale}
        dir={directionOf(label.locale)}
      >
        {label.title}
      </span>
    </a>
  );
}

/**
 * One Video's page (R2; Watch Part 1): THE STAGE FIRST. The poster-led,
 * one-press player at full width of the reading column, then what the video
 * is — its title in its own language, its kind, language, length and date, who
 * speaks — and the way to share it; then, for an episode, its Series with the
 * previous and next episode and the episodes around it; then where it
 * explains the Quran (each passage's tafsir, and the moment it takes each one
 * up), its description and transcript; beside them "Up next", its facts,
 * Topics, playlists and the signed-in Save; and below, more with its speaker,
 * on its Topic or in its language. A video the provider no longer serves shows
 * its poster muted, says so plainly, and links out. Usable signed out;
 * nothing about the visit is recorded.
 *
 * ONLY WHAT IS KNOWN IS SHOWN. A caption track the provider offers is stated;
 * an unknown one is not turned into a "no captions" row, and a transcript is a
 * section of its own rather than a row saying where it is.
 */
export async function VideoDetailPage({
  locale,
  record,
  start = null,
  passages = null,
  moments = null,
  personal = null,
}: {
  readonly locale: Locale;
  readonly record: VideoRecord;
  /**
   * Quran Part 8: where the Play press begins, in seconds — a lecture opened
   * at the passage a visitor chose in the Tafsir hub (`?start=`). The page
   * names it; nothing plays before the press.
   */
  readonly start?: number | null;
  /** Quran Part 8: the Quran passages this lecture explains, composed at Layer 4. */
  readonly passages?: ReactNode;
  /** Watch Part 1: where in it the lecture takes up each passage, composed at Layer 4. */
  readonly moments?: ReactNode;
  /** The private island (Save and notes), placed beside the facts. */
  readonly personal?: ReactNode;
}) {
  const t = await getTranslations({ locale, namespace: 'watch' });
  const trailParts = await watchTrail(locale);
  const reads = mediaReadRuntime();

  const [references, languages, playlists, episodes, neighbours] = await Promise.all([
    referenceNames({ personIds: record.speakerIds, topicIds: record.topicIds }, locale),
    contentLanguages(),
    reads.videoPlaylists(record.id),
    record.series === null
      ? Promise.resolve(null)
      : reads.seriesVideos(record.series.id, 0),
    record.series === null
      ? Promise.resolve(null)
      : reads.seriesNeighbours({
          series: record.series.id,
          position: record.series.position,
        }),
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
  // The episodes around this one, in episode order, itself left out.
  const here = episodes?.items.findIndex((video) => video.id === record.id) ?? -1;
  const others =
    episodes === null
      ? []
      : episodes.items
          .slice(
            Math.max(0, here - 2),
            Math.max(0, here - 2) + EPISODE_WINDOW + (here === -1 ? 0 : 1),
          )
          .filter((video) => video.id !== record.id);
  const previous = neighbours?.previous ?? null;
  const next = neighbours?.next ?? null;
  const offered = new Set([
    ...others.map((video) => video.id),
    ...(previous === null ? [] : [previous.id]),
    ...(next === null ? [] : [next.id]),
  ]);
  const related = await relatedVideos(
    locale,
    record,
    offered,
    {
      speaker: speakers[0]?.name ?? null,
      topic:
        record.topicIds[0] === undefined
          ? null
          : (references.topics.get(record.topicIds[0])?.name ?? null),
    },
    t,
    next === null,
  );
  const people = await speakersOf(others, locale);
  const contentBadge = contentLanguageBadge(record.languageCode, locale);
  // The description is written in the interface's language; when the video is
  // spoken in another, say once that the words describe it, not translate it.
  const describedInOtherLanguage =
    label.description !== '' &&
    (record.languageCode.split('-')[0] ?? '').toLowerCase() !== label.locale;
  const poster = posterImage(record);
  const unavailable = record.availability === 'unavailable';
  const upNext = related.upNext;
  const upNextLabel = upNext === null ? null : mediaLabel(upNext, locale);

  return (
    <Container>
      <article className="flex flex-col gap-[var(--space-section)] py-[var(--space-page)]">
        <div className="grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_21rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <Breadcrumbs
              label={trailParts.label}
              trail={[
                ...trail
                  .slice(0, -1)
                  .map((entry) => ({ href: entry.path, text: entry.name })),
                { text: label.title },
              ]}
            />

            {/*
             * THE STAGE: a stable 16:9 box at every width. The player decides
             * whether anything is loaded from the provider; this page only
             * gives it room and its own poster.
             */}
            <section aria-labelledby="video-player">
              <h2 id="video-player" className="sr-only">
                {t('playerHeading')}
              </h2>
              {unavailable ? (
                <div className="flex flex-col gap-3">
                  {poster === null ? null : (
                    <Poster
                      {...poster}
                      alt=""
                      radius="panel"
                      priority
                      sizes="(min-width: 64rem) 48rem, 100vw"
                      className="opacity-40 grayscale"
                    />
                  )}
                  <Alert tone="info">{t('player.unavailable', { provider })}</Alert>
                  <p className="text-sm">
                    <TextLink
                      href={providerWatchUrl(record.provider, record.providerVideoId)}
                    >
                      {t('player.tryProvider', { provider })}
                    </TextLink>
                  </p>
                </div>
              ) : (
                <VideoPlayer
                  provider={record.provider}
                  providerVideoId={record.providerVideoId}
                  start={start}
                  backdrop={
                    poster === null ? null : (
                      <Poster
                        {...poster}
                        alt=""
                        radius="none"
                        priority
                        sizes="(min-width: 64rem) 48rem, 100vw"
                      />
                    )
                  }
                  badge={
                    record.durationSeconds === null ? null : (
                      <Duration seconds={record.durationSeconds} />
                    )
                  }
                  labels={{
                    play: t('player.play', { provider, title: label.title }),
                    disclosure: t('player.disclosure', { provider }),
                    fallback: t('player.fallback', { provider, title: label.title }),
                    frameTitle: t('player.frameTitle', { provider, title: label.title }),
                  }}
                />
              )}
            </section>

            <header className="flex flex-col gap-3 border-b border-border pb-6">
              <h1
                className="text-title font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere"
                lang={label.locale}
                dir={direction}
              >
                {label.title}
              </h1>
              <div className="flex flex-wrap items-center gap-2">
                {record.format === null ? null : (
                  <Badge>{t(`format.${record.format}`)}</Badge>
                )}
                {unavailable ? (
                  <Badge kind="status" tone="caution">
                    {t('unavailable')}
                  </Badge>
                ) : null}
                {contentBadge === undefined ? null : <LanguageBadge {...contentBadge} />}
                <MetaRow
                  items={[
                    record.durationSeconds === null ? null : (
                      <Duration seconds={record.durationSeconds} />
                    ),
                    record.publishedOn === null ? null : (
                      <time dateTime={record.publishedOn}>
                        {formatDate(record.publishedOn, locale)}
                      </time>
                    ),
                    start === null || unavailable ? null : (
                      <span className="font-semibold text-accent">
                        {t('player.startsAt', { time: formatDuration(start) })}
                      </span>
                    ),
                  ]}
                />
              </div>
              {speakers.length === 0 ? null : (
                <p className="text-base" dir="auto">
                  <span className="text-foreground-muted">{t('speakers')}: </span>
                  {speakers.map((person, index) => (
                    <span key={person.slug}>
                      {index === 0 ? null : ' · '}
                      <TextLink
                        href={localizedPath(
                          locale,
                          `/people/${encodeURIComponent(person.slug)}`,
                        )}
                      >
                        {person.name}
                      </TextLink>
                    </span>
                  ))}
                </p>
              )}
              <ShareVideo
                url={absoluteUrl(videoPath(locale, record.slug))}
                title={label.title}
                labels={{
                  share: t('share.action'),
                  copied: t('share.copied'),
                  failed: t('share.failed'),
                }}
              />
            </header>

            {record.series === null || seriesLabel === null ? null : (
              <section
                aria-labelledby="video-series"
                className="flex flex-col gap-4 rounded-panel border border-border bg-surface-raised p-4 sm:p-5"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-sm text-foreground-muted">
                    {t(`fact.partOf.${record.series.kind}`)}
                  </p>
                  <h2
                    id="video-series"
                    className="text-subheading font-semibold wrap-anywhere"
                  >
                    <TextLink
                      href={seriesPath(locale, record.series.kind, record.series.slug)}
                    >
                      <span
                        lang={seriesLabel.locale}
                        dir={directionOf(seriesLabel.locale)}
                      >
                        {seriesLabel.title}
                      </span>
                    </TextLink>
                  </h2>
                  <p className="text-sm font-medium">
                    {neighbours === null || neighbours.episodes < 2
                      ? t('fact.episode', { number: record.series.position })
                      : t('episodeOf', {
                          number: record.series.position,
                          total: neighbours.episodes,
                        })}
                  </p>
                </div>
                {previous === null && next === null ? null : (
                  <nav aria-label={t('episodeNav')} className="grid gap-3 sm:grid-cols-2">
                    {previous === null ? null : (
                      <EpisodeStep
                        locale={locale}
                        video={previous}
                        direction="previous"
                        t={t}
                      />
                    )}
                    {next === null ? null : (
                      <EpisodeStep locale={locale} video={next} direction="next" t={t} />
                    )}
                  </nav>
                )}
                {others.length === 0 ? null : (
                  <ol
                    aria-label={t(`moreFrom.${record.series.kind}`)}
                    className="list-none p-0"
                  >
                    {others.map((video) => {
                      const other = mediaLabel(video, locale);
                      const names = speakerNames(video, people);
                      return (
                        <ListRow
                          key={video.id}
                          href={videoPath(locale, video.slug)}
                          title={other.title}
                          lang={other.locale}
                          dir={directionOf(other.locale)}
                          image={posterImage(video)}
                          meta={[
                            video.seriesPosition === null
                              ? null
                              : t('fact.episode', { number: video.seriesPosition }),
                            video.durationSeconds === null ? null : (
                              <Duration seconds={video.durationSeconds} />
                            ),
                            names === '' ? null : <span dir="auto">{names}</span>,
                          ]}
                        />
                      );
                    })}
                  </ol>
                )}
                <p className="text-sm">
                  <TextLink
                    href={seriesPath(locale, record.series.kind, record.series.slug)}
                  >
                    {t('allEpisodes')}
                  </TextLink>
                </p>
              </section>
            )}

            {passages}

            {moments}

            {label.description === '' ? null : (
              <section className="flex flex-col gap-4" aria-labelledby="video-about">
                <h2 id="video-about" className="text-heading font-semibold">
                  {t('aboutHeading')}
                </h2>
                <Prose>
                  {paragraphsOf(label.description).map((paragraph, index) => (
                    <p key={index} lang={label.locale} dir={direction}>
                      {paragraph}
                    </p>
                  ))}
                  {describedInOtherLanguage ? (
                    <p className="text-caption text-foreground-muted">
                      {t('metadataNotice')}
                    </p>
                  ) : null}
                </Prose>
              </section>
            )}

            {record.transcript === null ? null : (
              <section className="flex flex-col gap-4" aria-labelledby="video-transcript">
                <h2 id="video-transcript" className="text-heading font-semibold">
                  {t('fact.transcript')}
                </h2>
                <details className="group/transcript border-y border-border">
                  <summary className="flex min-h-11 cursor-pointer items-center gap-2 py-2.5 font-medium">
                    <Icon
                      name="chevron-down"
                      size={16}
                      className="transition-transform duration-[var(--duration-fast)] group-open/transcript:rotate-180"
                    />
                    {t('transcriptShow')}
                  </summary>
                  <div
                    className="library-reader flex max-w-[var(--measure-prose)] flex-col gap-4 pt-2 pb-6"
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

          <aside className="flex min-w-0 flex-col gap-8 lg:pt-11">
            {upNext === null || upNextLabel === null ? null : (
              <section className="flex flex-col gap-1" aria-labelledby="video-up-next">
                <h2 id="video-up-next" className="text-subheading font-semibold">
                  {t('upNext')}
                </h2>
                <ListRow
                  as="div"
                  href={videoPath(locale, upNext.slug)}
                  title={upNextLabel.title}
                  lang={upNextLabel.locale}
                  dir={directionOf(upNextLabel.locale)}
                  image={posterImage(upNext)}
                  meta={[
                    upNext.format === null ? null : t(`format.${upNext.format}`),
                    upNext.durationSeconds === null ? null : (
                      <Duration seconds={upNext.durationSeconds} />
                    ),
                  ]}
                />
              </section>
            )}

            <section className="flex flex-col gap-2" aria-labelledby="video-facts">
              <h2 id="video-facts" className="text-subheading font-semibold">
                {t('facts')}
              </h2>
              <dl className="grid divide-y divide-border">
                <DetailRow term={t('fact.provider')}>{provider}</DetailRow>
                <DetailRow term={t('fact.language')}>
                  <span lang={record.languageCode} dir={contentDirection}>
                    {language?.name ?? record.languageCode}
                  </span>
                </DetailRow>
                {record.format === null ? null : (
                  <DetailRow term={t('fact.format')}>
                    {t(`format.${record.format}`)}
                  </DetailRow>
                )}
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
                {record.captions ? (
                  <DetailRow term={t('fact.captions')}>
                    {t('captionsAvailable', { provider })}
                  </DetailRow>
                ) : null}
              </dl>
            </section>

            {topics.length === 0 ? null : (
              <section className="flex flex-col gap-3" aria-labelledby="video-topics">
                <h2 id="video-topics" className="text-subheading font-semibold">
                  {t('topics')}
                </h2>
                <TopicChips
                  label={t('topics')}
                  topics={topics.map((topic) => ({
                    href: localizedPath(
                      locale,
                      `/topics/${encodeURIComponent(topic.slug)}`,
                    ),
                    text: topic.name,
                  }))}
                />
              </section>
            )}

            {playlists.length === 0 ? null : (
              <section className="flex flex-col gap-3" aria-labelledby="video-playlists">
                <h2 id="video-playlists" className="text-subheading font-semibold">
                  {t('inPlaylists')}
                </h2>
                <ul className="flex flex-col gap-1 text-sm">
                  {playlists.map((playlist) => {
                    const playlistLabel = mediaLabel(playlist, locale);
                    return (
                      <li key={playlist.id} className="flex min-h-11 items-center">
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

            {personal}
          </aside>
        </div>

        {related.shelves.map((shelf) => (
          <section
            key={shelf.key}
            className="flex flex-col gap-6"
            aria-labelledby={`video-related-${shelf.key}`}
          >
            <SectionHeader
              id={`video-related-${shelf.key}`}
              heading={shelf.heading}
              action={shelf.more}
            />
            <VideoCards locale={locale} videos={shelf.videos} label={shelf.heading} />
          </section>
        ))}

        <VideoStructuredData locale={locale} record={record} trail={trail} />
      </article>
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
    <section className="flex flex-col gap-5" aria-labelledby={headingId}>
      <SectionHeader id={headingId} heading={heading} action={more} />
      <VideoGrid
        locale={locale}
        videos={page.items.slice(0, PREVIEW)}
        label={heading}
        headingLevel="h3"
      />
    </section>
  );
}

/* ===========================================================================
 * The landing page
 * ========================================================================= */

/** How many Videos the landing's featured or latest grid shows, the lead included. */
const LANDING = 12;

/** How many posters one shelf of the landing carries. */
const SHELF = 12;

/** How many Series or programmes the landing gives a shelf of their own episodes. */
const SERIES_SHELVES = 2;

/** How many Topics the landing gives a shelf of their own videos. */
const TOPIC_SHELVES = 2;

/** How many Topics and speakers the landing offers as ways in. */
const TOPIC_CHIPS = 12;
const SPEAKER_CHIPS = 10;

/**
 * Every Watch surface, grouped the way the landing's browse index offers them
 * — the kinds of video, the ordered groupings, and the ways to find by person
 * or topic — with Listen, Watch's sibling for audio, and its two listings.
 * Together with the Topic and speaker ways in, every Watch menu item.
 */
const LANDING_GROUPS = [
  { key: 'formats', surfaces: ['videos', ...WATCH_VIEWS] },
  { key: 'groups', surfaces: ['series', 'programs', 'playlists'] },
  {
    key: 'find',
    surfaces: ['speakers', 'topics', 'listen', 'listenLectures', 'listenSeries'],
  },
] as const;

/** Where a browse entry goes: Watch's own surfaces, the Topic index, or Listen. */
function surfacePath(locale: Locale, surface: string): string {
  if (surface === 'topics') return localizedPath(locale, '/topics');
  if (surface === 'listen') return localizedPath(locale, '/listen');
  if (surface === 'listenLectures') return localizedPath(locale, '/listen/lectures');
  if (surface === 'listenSeries') return localizedPath(locale, '/listen/series');
  return localizedPath(locale, `/watch/${surface}`);
}

/** A way in with its count, as a chip: "Education · 12". Shared with Listen's landing. */
export function CountChips({
  label,
  chips,
}: {
  readonly label: string;
  readonly chips: readonly {
    readonly href: string;
    readonly text: string;
    readonly count: string;
  }[];
}) {
  return (
    <ul aria-label={label} className="flex list-none flex-wrap gap-2 p-0">
      {chips.map((chip) => (
        <li key={chip.href} className="min-w-0">
          <a
            href={chip.href}
            className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border border-border bg-surface-raised px-4 text-sm no-underline transition-colors duration-[var(--duration-fast)] hover:border-accent hover:bg-accent-surface"
          >
            <span className="min-w-0 wrap-anywhere" dir="auto">
              {chip.text}
            </span>
            <span className="text-caption font-semibold text-foreground-muted tabular-nums">
              {chip.count}
            </span>
          </a>
        </li>
      ))}
    </ul>
  );
}

/**
 * `/watch` — `?sort=featured|latest` (ROUTE_MAP.md §3.7).
 *
 * THE FRONT DOOR (R2, audit F13; Watch Part 1). The page opens on what Watch
 * holds — its figures, read in ONE facet read of the whole of Media — then its
 * lead video (the first featured one with a poster) in the featured or latest
 * grid, then a shelf per kind of video, the Topics and their leading shelves,
 * the leading Series and programmes, the speakers, the Quran's and Hadith's
 * own Videos hubs, and a compact index of every surface — each only when it
 * has something in it. Within a shelf the interface's own language comes
 * first (F10).
 *
 * NO FAKE CURATION. "Featured" is the Videos an operator marked featured, and
 * when there are none the page opens on Latest and offers no sort tabs rather
 * than relabelling the latest as featured. Figures are counts Media answered —
 * a zero is never stated. The browse index names only what exists: the Watch
 * surfaces, topics, and Listen. Photographs are reached from News and Events,
 * their designed entry point. No "coming soon".
 */
export async function WatchLandingPage({
  locale,
  sort: requested,
}: {
  readonly locale: Locale;
  readonly sort: 'featured' | 'latest';
}) {
  const t = await getTranslations({ locale, namespace: 'watch' });
  const reads = mediaReadRuntime();
  const views = WATCH_VIEWS.flatMap((view) => {
    const format = formatOfView(view);
    return format === null ? [] : [{ view, format }];
  });
  const [asked, facets, ...byFormat] = await Promise.all([
    reads.videos({ featured: requested === 'featured' }),
    reads.topicVideoFacets({ scope: 'media', titleLocale: locale }),
    ...views.map(({ format }) => reads.videos({ format })),
  ]);
  const topicFacets = facets.topics.items.slice(0, TOPIC_CHIPS);
  const speakerFacets = facets.speakers.items.slice(0, SPEAKER_CHIPS);
  const [names, seriesShelves, topicShelves] = await Promise.all([
    referenceNames(
      {
        personIds: speakerFacets.map((facet) => facet.id),
        topicIds: topicFacets.map((facet) => facet.id),
      },
      locale,
    ),
    Promise.all(
      facets.series.items.slice(0, SERIES_SHELVES).map(async (series) => ({
        series,
        videos: (await reads.seriesVideos(series.id, 0)).items.slice(0, SHELF),
      })),
    ),
    Promise.all(
      topicFacets.slice(0, TOPIC_SHELVES).map(async (facet) => ({
        facet,
        videos: (await reads.videos({ topic: facet.id })).items.slice(0, SHELF),
      })),
    ),
  ]);
  const topics = caseless(names.topics);
  const people = caseless(names.people);

  const { sort, tabs } = watchLanding(
    requested,
    requested === 'featured' ? asked.items.length : 1,
  );
  const page = sort === requested ? asked : await reads.videos({ featured: false });

  const heading = t(`sort.${sort}`);
  const ordered = interfaceLanguageFirst(
    page.items,
    (video) => video.languageCode,
    locale,
  );
  // The lead is the first with a poster, so the grid opens on a picture.
  const lead = ordered.find((video) => video.poster !== null) ?? ordered[0];
  const shown = (
    lead === undefined ? [] : [lead, ...ordered.filter((video) => video !== lead)]
  ).slice(0, LANDING);
  const shelves = views
    .map((entry, index) => ({
      ...entry,
      videos: interfaceLanguageFirst(
        byFormat[index]?.items ?? [],
        (video) => video.languageCode,
        locale,
      ).slice(0, SHELF),
    }))
    .filter((shelf) => shelf.videos.length > 0);
  const nameFor = (view: string) => t(`sections.${view}` as 'sections.videos');
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const hub = facets.hub;
  const hours = Math.floor(hub.seconds / 3600);
  const topicChips = topicFacets.flatMap((facet) => {
    const topic = topics.get(facet.id.toLowerCase());
    return topic === undefined
      ? []
      : [
          {
            href: watchVideosHref(locale, { topic: facet.id }),
            text: topic.name,
            count: number(facet.videos),
          },
        ];
  });
  const speakerChips = speakerFacets.flatMap((facet) => {
    const person = people.get(facet.id.toLowerCase());
    return person === undefined
      ? []
      : [
          {
            href: watchVideosHref(locale, { speaker: facet.id }),
            text: person.name,
            count: number(facet.videos),
          },
        ];
  });
  const stats = [
    ...(hub.videos === 0
      ? []
      : [
          {
            value: number(hub.videos),
            label: t('landing.stats.videos', { count: hub.videos }),
          },
        ]),
    ...(hours === 0
      ? []
      : [{ value: number(hours), label: t('listing.statHours', { count: hours }) }]),
    ...(hub.languages < 2
      ? []
      : [
          {
            value: number(hub.languages),
            label: t('landing.stats.languages', { count: hub.languages }),
          },
        ]),
    ...(facets.topics.items.length === 0 || facets.topics.hasMore
      ? []
      : [
          {
            value: number(facets.topics.items.length),
            label: t('landing.stats.topics', { count: facets.topics.items.length }),
          },
        ]),
    ...(facets.speakers.items.length === 0 || facets.speakers.hasMore
      ? []
      : [
          {
            value: number(facets.speakers.items.length),
            label: t('landing.stats.speakers', { count: facets.speakers.items.length }),
          },
        ]),
  ];

  return (
    <>
      <Hero
        title={t('title')}
        lede={t('description')}
        actions={
          <>
            <ActionLink href={localizedPath(locale, '/watch/videos')}>
              {t('allVideos')}
            </ActionLink>
            <ActionLink href={localizedPath(locale, '/watch/programs')} tone="secondary">
              {t('landing.programmesAction')}
            </ActionLink>
          </>
        }
      >
        {stats.length === 0 ? null : (
          <div className="flex flex-wrap gap-x-10 gap-y-4 pt-2">
            {stats.map((stat) => (
              <Stat key={stat.label} value={stat.value} label={stat.label} />
            ))}
          </div>
        )}
      </Hero>

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          <section className="flex flex-col gap-6" aria-labelledby="watch-videos">
            <SectionHeader
              id="watch-videos"
              heading={heading}
              intro={t(`landing.${sort}Intro`)}
            />
            {tabs ? (
              <LinkTabs
                label={t('sort.label')}
                tabs={(['featured', 'latest'] as const).map((option) => ({
                  href: localizedPath(
                    locale,
                    `/watch${option === 'featured' ? '' : '?sort=latest'}`,
                  ),
                  text: t(`sort.${option}`),
                  current: option === sort,
                }))}
              />
            ) : null}
            {page.items.length === 0 ? (
              <EmptyState icon="video">{t('empty')}</EmptyState>
            ) : (
              <VideoGrid
                locale={locale}
                videos={shown}
                label={heading}
                headingLevel="h3"
                lead
              />
            )}
          </section>

          {shelves.map((shelf) => (
            <VideoShelf
              key={shelf.view}
              locale={locale}
              id={`watch-${shelf.view}`}
              heading={nameFor(shelf.view)}
              videos={shelf.videos}
              action={{
                href: localizedPath(locale, `/watch/${shelf.view}`),
                text: t('landing.seeAll', {
                  name: nameFor(shelf.view).toLocaleLowerCase(locale),
                }),
              }}
            />
          ))}

          {topicChips.length === 0 ? null : (
            <section className="flex flex-col gap-5" aria-labelledby="watch-topics">
              <SectionHeader
                id="watch-topics"
                heading={t('landing.topicsHeading')}
                intro={t('landing.topicsIntro')}
                action={{
                  href: localizedPath(locale, '/topics'),
                  text: t('landing.allTopics'),
                }}
              />
              <CountChips label={t('landing.topicsHeading')} chips={topicChips} />
            </section>
          )}

          {topicShelves
            .filter((shelf) => shelf.videos.length > 0)
            .flatMap(({ facet, videos }) => {
              const topic = topics.get(facet.id.toLowerCase());
              return topic === undefined
                ? []
                : [
                    <VideoShelf
                      key={facet.id}
                      locale={locale}
                      id={`watch-topic-${topic.slug}`}
                      heading={t('landing.onTopic', { name: topic.name })}
                      videos={videos}
                      action={{
                        href: watchVideosHref(locale, { topic: facet.id }),
                        text: t('landing.allOnTopic', { name: topic.name }),
                      }}
                    />,
                  ];
            })}

          {seriesShelves
            .filter((shelf) => shelf.videos.length > 0)
            .map(({ series, videos }) => {
              const seriesLabel = mediaLabel(series, locale);
              return (
                <VideoShelf
                  key={series.id}
                  locale={locale}
                  id={`watch-series-${series.id}`}
                  heading={seriesLabel.title}
                  headingLang={seriesLabel.locale}
                  videos={videos}
                  episode
                  action={{
                    href: seriesPath(locale, series.kind, series.slug),
                    text: t('allEpisodes'),
                  }}
                />
              );
            })}

          {speakerChips.length === 0 ? null : (
            <section className="flex flex-col gap-5" aria-labelledby="watch-speakers">
              <SectionHeader
                id="watch-speakers"
                heading={t('landing.speakersHeading')}
                intro={t('landing.speakersIntro')}
                action={{
                  href: localizedPath(locale, '/watch/speakers'),
                  text: t('landing.allSpeakers'),
                }}
              />
              <CountChips label={t('landing.speakersHeading')} chips={speakerChips} />
            </section>
          )}

          <section className="flex flex-col gap-5" aria-labelledby="watch-subjects">
            <SectionHeader
              id="watch-subjects"
              heading={t('landing.subjectsHeading')}
              intro={t('landing.subjectsIntro')}
            />
            <ul className="grid list-none gap-4 p-0 sm:grid-cols-2">
              {(['quran', 'hadith'] as const).map((subject) => (
                <LinkCard
                  key={subject}
                  href={localizedPath(locale, `/${subject}/videos`)}
                  title={t(`landing.subjects.${subject}`)}
                  description={t(`landing.subjects.${subject}Body`)}
                />
              ))}
            </ul>
          </section>

          {/* Every surface, as a compact index rather than a wall of cards. */}
          <nav aria-labelledby="watch-browse" className="flex flex-col gap-6">
            <h2 id="watch-browse" className="text-heading font-semibold">
              {t('browse')}
            </h2>
            <div className="grid gap-x-10 gap-y-8 border-t border-border pt-6 sm:grid-cols-2 lg:grid-cols-3">
              {LANDING_GROUPS.map((group) => (
                <div key={group.key} className="flex min-w-0 flex-col gap-3">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-subheading font-semibold">
                      {t(`landing.${group.key}Heading`)}
                    </h3>
                    <p className="text-sm text-foreground-muted">
                      {t(`landing.${group.key}Intro`)}
                    </p>
                  </div>
                  <ul className="flex list-none flex-col p-0">
                    {group.surfaces.map((surface) => (
                      <li key={surface}>
                        <a
                          href={surfacePath(locale, surface)}
                          className="group flex min-h-11 flex-col justify-center gap-0.5 border-b border-border py-2.5 no-underline"
                        >
                          <span className="inline-flex items-center gap-1.5 font-semibold text-foreground decoration-accent-rule underline-offset-4 group-hover:underline">
                            {nameFor(surface)}
                            <Icon
                              name="arrow-end"
                              size={16}
                              className="text-accent opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100 group-focus-visible:opacity-100"
                            />
                          </span>
                          <span className="text-sm text-foreground-muted">
                            {t(`sectionBody.${surface}` as 'sectionBody.videos')}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </nav>
        </div>
      </Container>
    </>
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
