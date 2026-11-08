import { localizedPath } from '@minhaj/contracts';
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
  type VideoPoster,
  type VideoRecord,
} from '@minhaj/contracts/media';
import type { TopicView } from '@minhaj/contracts/taxonomy';

import { mediaReadRuntime } from '@/composition/media-read';
import { contentLanguages, referenceNames } from '@/composition/public-references';
import { taxonomyRuntime } from '@/composition/taxonomy';
import {
  contentLanguageBadge,
  interfaceLanguageFirst,
} from '@/components/content-language';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import {
  ActionLink,
  Alert,
  Badge,
  Breadcrumbs,
  Button,
  CardGrid,
  Container,
  DetailRow,
  EmptyState,
  Field,
  Hero,
  Icon,
  LanguageBadge,
  LinkTabs,
  ListRow,
  MediaCard,
  MetaRow,
  Panel,
  Poster,
  Prose,
  SectionHeader,
  Select,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { Shelf } from '@/components/ui/shelf';
import { absoluteUrl } from '@/config/origin';
import { directionOf } from '@/config/locale';
import { isContentIndexable, serializeStructuredData } from '@/seo/metadata';
import {
  Duration,
  formatDate,
  MediaPageHeader,
  Pagination as MediaPagination,
} from './parts';
import { VideoPlayer } from './player';
import {
  formatOfView,
  mediaLabel,
  mediaLocales,
  offsetPath,
  playlistPath,
  readOffset,
  readMediaQuery,
  seriesPath,
  seriesSegment,
  videoPath,
  videoPosterPath,
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
    home: { href: localizedPath(locale, ''), text: shell('nav.home') },
    watch: { href: localizedPath(locale, '/watch'), text: t('title') },
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
  const base = localizedPath(locale, `/watch/${section}`);
  const title = t(`sections.${section}` as 'sections.videos');

  const reads = mediaReadRuntime();
  const [page, languageMap, topics, speakers, series, programs] = await Promise.all([
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
  // The interface's own language is offered first among the content languages
  // (F10); every other language stays one choice away.
  const languages = interfaceLanguageFirst(
    [...languageMap.values()],
    (language) => language.code,
    locale,
  );

  return (
    <Container>
      <div className="flex flex-col gap-8 py-[var(--space-page)]">
        <MediaPageHeader
          crumbs={{
            label: trail.label,
            trail: [trail.home, trail.watch, { text: title }],
          }}
          title={title}
          lede={t(`sectionBody.${section}` as 'sectionBody.videos')}
        />

        {/* The curated views are sibling pages of this listing, one choice away. */}
        <LinkTabs
          label={t('viewsLabel')}
          tabs={['videos', ...WATCH_VIEWS].map((view) => ({
            href: localizedPath(locale, `/watch/${view}`),
            text: t(`sections.${view}` as 'sections.videos'),
            current: view === section,
          }))}
        />

        <form
          method="get"
          action={base}
          className="flex flex-col gap-4 border-b border-border pb-8"
          aria-label={t('filters')}
        >
          <div className="grid items-end gap-4 sm:grid-cols-2 lg:grid-cols-[repeat(4,minmax(0,1fr))_auto]">
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
                <Select {...props} name="language" defaultValue={filters.language ?? ''}>
                  <option value="">{t('filterAny')}</option>
                  {languages.map((language) => (
                    <option
                      key={language.code}
                      value={language.code}
                      lang={language.code}
                      dir={language.direction}
                    >
                      {language.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Button tone="secondary">{t('filterApply')}</Button>
          </div>
          {filtered ? (
            <p className="text-sm">
              <TextLink href={base}>{t('filterClear')}</TextLink>
            </p>
          ) : null}
        </form>

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

/** How many other episodes a Video's page lists beside it. */
const EPISODE_PREVIEW = 6;

/** How many related Videos a Video's page offers under it. */
const RELATED_PREVIEW = 6;

/**
 * VIDEOS RELATED TO ONE VIDEO — what else its first speaker gives, else what
 * else is on its first topic — never itself, and never the episodes already
 * listed beside it. Composed from the public listing read Media already has,
 * so "related" means a fact the records state, never a guess.
 */
async function relatedVideos(
  record: VideoRecord,
  exclude: ReadonlySet<string>,
): Promise<readonly VideoListing[]> {
  const reads = mediaReadRuntime();
  const keep = (items: readonly VideoListing[]) =>
    items.filter((video) => video.id !== record.id && !exclude.has(video.id));
  const speaker = record.speakerIds[0];
  const bySpeaker =
    speaker === undefined ? [] : keep((await reads.videos({ speaker })).items);
  if (bySpeaker.length >= RELATED_PREVIEW) return bySpeaker.slice(0, RELATED_PREVIEW);
  const topic = record.topicIds[0];
  const byTopic = topic === undefined ? [] : keep((await reads.videos({ topic })).items);
  const seen = new Set(bySpeaker.map((video) => video.id));
  return [...bySpeaker, ...byTopic.filter((video) => !seen.has(video.id))].slice(
    0,
    RELATED_PREVIEW,
  );
}

/**
 * One Video's page (R2): THE STAGE FIRST. The poster-led, one-press player at
 * full width of the reading column, then what the video is — its title in its
 * own language, its kind, who speaks — then its description and transcript,
 * with its facts, topics, playlists and the episodes around it beside them,
 * and related videos below. A video the provider no longer serves shows its
 * poster muted, says so plainly, and links out. Usable signed out; nothing
 * about the visit is recorded.
 *
 * ONLY WHAT IS KNOWN IS SHOWN. A caption track the provider offers is stated;
 * an unknown one is not turned into a "no captions" row, and a transcript is a
 * section of its own rather than a row saying where it is.
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
  const related = await relatedVideos(record, new Set(others.map((video) => video.id)));
  const people = await speakersOf([...others, ...related], locale);
  const contentBadge = contentLanguageBadge(record.languageCode, locale);
  // The description is written in the interface's language; when the video is
  // spoken in another, say once that the words describe it, not translate it.
  const describedInOtherLanguage =
    label.description !== '' &&
    (record.languageCode.split('-')[0] ?? '').toLowerCase() !== label.locale;
  const poster = posterImage(record);
  const unavailable = record.availability === 'unavailable';

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
                    record.series === null
                      ? null
                      : t('fact.episode', { number: record.series.position }),
                    record.durationSeconds === null ? null : (
                      <Duration seconds={record.durationSeconds} />
                    ),
                    record.publishedOn === null ? null : (
                      <time dateTime={record.publishedOn}>
                        {formatDate(record.publishedOn, locale)}
                      </time>
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
            </header>

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
            {record.series === null ||
            seriesLabel === null ||
            others.length === 0 ? null : (
              <section className="flex flex-col gap-1" aria-labelledby="video-episodes">
                <h2 id="video-episodes" className="text-subheading font-semibold">
                  {t(`moreFrom.${record.series.kind}`)}
                </h2>
                <p className="text-sm text-foreground-muted">
                  <span lang={seriesLabel.locale} dir={directionOf(seriesLabel.locale)}>
                    {seriesLabel.title}
                  </span>
                </p>
                <ol aria-labelledby="video-episodes" className="list-none p-0">
                  {others.map((video) => {
                    const other = mediaLabel(video, locale);
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
                        ]}
                      />
                    );
                  })}
                </ol>
                <p className="pt-2 text-sm">
                  <TextLink
                    href={seriesPath(locale, record.series.kind, record.series.slug)}
                  >
                    {t('allEpisodes')}
                  </TextLink>
                </p>
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
                      <span
                        lang={seriesLabel.locale}
                        dir={directionOf(seriesLabel.locale)}
                      >
                        {seriesLabel.title}
                      </span>
                    </TextLink>
                    {' · '}
                    {t('fact.episode', { number: record.series.position })}
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
          </aside>
        </div>

        {related.length === 0 ? null : (
          <section className="flex flex-col gap-6" aria-labelledby="video-related">
            <SectionHeader id="video-related" heading={t('related')} />
            <ul aria-labelledby="video-related" className={VIDEO_GRID}>
              {related.map((video) => (
                <VideoCard
                  key={video.id}
                  locale={locale}
                  video={video}
                  people={people}
                  t={t}
                  headingLevel="h3"
                />
              ))}
            </ul>
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

/**
 * A Series, programme or Playlist as a card: its kind, its title in its own
 * language and the start of its description — one link to its ONE address.
 * A grouping has no picture of its own, so its card is text-first (R2): the
 * kind as a badge, never an upper-case label over the title.
 */
function GroupCard({
  locale,
  href,
  record,
  kind,
}: {
  readonly locale: Locale;
  readonly href: string;
  readonly record: SeriesRecord | PlaylistRecord;
  readonly kind: string;
}) {
  const label = mediaLabel(record, locale);
  return (
    <MediaCard
      href={href}
      type={kind}
      title={label.title}
      description={label.description}
      headingLevel="h2"
      lang={label.locale}
      dir={directionOf(label.locale)}
    />
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
  const base = localizedPath(locale, `/watch/${section}`);
  const title = t(`sections.${section}` as 'sections.series');
  const page = await mediaReadRuntime().seriesList(kind, offset);

  return (
    <Container>
      <div className="flex flex-col gap-8 py-[var(--space-page)]">
        <MediaPageHeader
          crumbs={{
            label: trail.label,
            trail: [trail.home, trail.watch, { text: title }],
          }}
          title={title}
          lede={t(`sectionBody.${section}` as 'sectionBody.series')}
        />
        {page.items.length === 0 ? (
          <EmptyState>{t(`groupEmpty.${kind}`)}</EmptyState>
        ) : (
          <CardGrid label={title}>
            {page.items.map((record) => (
              <GroupCard
                key={record.id}
                locale={locale}
                record={record}
                kind={t(`kind.${record.kind}`)}
                href={seriesPath(locale, record.kind, record.slug)}
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
  kind,
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
  /** The record's kind, in words — the page's eyebrow. */
  readonly kind: string;
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
    { name: sectionTitle, path: localizedPath(locale, `/watch/${section}`) },
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
          eyebrow={kind}
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

        <section className="flex flex-col gap-5" aria-labelledby="group-videos">
          <SectionHeader id="group-videos" heading={heading} />
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
      kind={t(`kind.${record.kind}`)}
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
  const base = localizedPath(locale, '/watch/playlists');
  const title = t('sections.playlists');
  const page = await mediaReadRuntime().playlists(offset);

  return (
    <Container>
      <div className="flex flex-col gap-8 py-[var(--space-page)]">
        <MediaPageHeader
          crumbs={{
            label: trail.label,
            trail: [trail.home, trail.watch, { text: title }],
          }}
          title={title}
          lede={t('sectionBody.playlists')}
        />
        {page.items.length === 0 ? (
          <EmptyState>{t('groupEmpty.playlist')}</EmptyState>
        ) : (
          <CardGrid label={title}>
            {page.items.map((record) => (
              <GroupCard
                key={record.id}
                locale={locale}
                record={record}
                kind={t('kind.playlist')}
                href={playlistPath(locale, record.slug)}
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
      kind={t('kind.playlist')}
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

/** The first-party person mark, decorative: no portrait is invented. */
function PersonMark() {
  return (
    <span
      aria-hidden="true"
      className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-surface text-accent"
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor">
        <circle cx="12" cy="8.5" r="3.5" strokeWidth="1.6" />
        <path d="M5 19.5a7 7 0 0 1 14 0" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    </span>
  );
}

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
  const base = localizedPath(locale, '/watch/speakers');
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
      <div className="flex flex-col gap-8 py-[var(--space-page)]">
        <MediaPageHeader
          crumbs={{
            label: trail.label,
            trail: [trail.home, trail.watch, { text: title }],
          }}
          title={title}
          lede={t('sectionBody.speakers')}
        />
        {rows.length === 0 ? (
          <EmptyState>{t('speakersEmpty')}</EmptyState>
        ) : (
          <CardGrid label={title}>
            {rows.map((row) => (
              <Panel key={row.id} as="li">
                <div className="flex min-w-0 items-start gap-4">
                  <PersonMark />
                  <div className="flex min-w-0 flex-col gap-1">
                    <h2
                      className="text-subheading font-semibold wrap-anywhere"
                      dir="auto"
                    >
                      <TextLink
                        href={localizedPath(
                          locale,
                          `/people/${encodeURIComponent(row.person.slug)}`,
                        )}
                      >
                        {row.person.name}
                      </TextLink>
                    </h2>
                    <p className="text-sm">
                      <a
                        href={mediaQueryPath(
                          localizedPath(locale, '/watch/videos'),
                          readMediaQuery({}),
                          {
                            speaker: row.id,
                          },
                        )}
                        className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
                      >
                        {t('speakerVideos', { count: String(row.videos) })}
                        <Icon name="arrow-end" size={16} />
                      </a>
                    </p>
                  </div>
                </div>
              </Panel>
            ))}
          </CardGrid>
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
  const path = localizedPath(locale, `/watch/topics/${encodeURIComponent(topic.slug)}`);
  const page = await mediaReadRuntime().videos({ topic: topic.id, offset });
  const labelLocale = topic.label.resolvedLocale;

  return (
    <Container>
      <div className="flex flex-col gap-8 py-[var(--space-page)]">
        <MediaPageHeader
          crumbs={{
            label: trail.label,
            trail: [trail.home, trail.watch, { text: topic.label.name }],
          }}
          title={
            <>
              {t('topicTitle')}:{' '}
              <span lang={labelLocale} dir={directionOf(labelLocale)}>
                {topic.label.name}
              </span>
            </>
          }
        >
          <div className="pt-1">
            <ActionLink
              href={localizedPath(locale, `/topics/${encodeURIComponent(topic.slug)}`)}
              tone="secondary"
            >
              {t('topicHub')}
            </ActionLink>
          </div>
        </MediaPageHeader>
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

/** How many Videos the landing's featured or latest grid shows under the lead. */
const LANDING = 9;

/** How many posters one shelf of the landing carries. */
const SHELF = 12;

/** How many programmes the landing gives a shelf of their own episodes. */
const PROGRAMME_SHELVES = 2;

/**
 * Every Watch surface this phase delivers, grouped the way the landing's browse
 * index offers them: the kinds of video, the ordered groupings, and the ways to
 * find by person or topic — with Listen, Watch's sibling for audio, linked ONCE.
 */
const LANDING_GROUPS = [
  { key: 'formats', surfaces: ['videos', ...WATCH_VIEWS] },
  { key: 'groups', surfaces: ['series', 'programs', 'playlists'] },
  { key: 'find', surfaces: ['speakers', 'topics', 'listen'] },
] as const;

/** Where a browse entry goes: Watch's own surfaces, the topic hub, or Listen. */
function surfacePath(locale: Locale, surface: string): string {
  if (surface === 'topics') return localizedPath(locale, '/topics');
  if (surface === 'listen') return localizedPath(locale, '/listen');
  return localizedPath(locale, `/watch/${surface}`);
}

/**
 * `/watch` — `?sort=featured|latest` (ROUTE_MAP.md §3.7).
 *
 * POSTER-LED (R2, audit F13). The page opens on its lead video — the first
 * featured one with a poster, beside the section's name — then the featured or
 * latest grid, then a shelf per kind of video and per leading programme, each
 * only when it has something in it, then a compact index of every surface.
 * Within a shelf the interface's own language comes first (F10).
 *
 * NO FAKE CURATION. "Featured" is the Videos an operator marked featured, and
 * when there are none the page says so and points at the latest instead of
 * relabelling the latest as featured. The browse index names only what exists:
 * the Watch surfaces, topics, and Listen. Photographs are reached from News and
 * Events, their designed entry point. No "coming soon".
 */
export async function WatchLandingPage({
  locale,
  sort,
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
  const [page, programmes, ...byFormat] = await Promise.all([
    reads.videos({ featured: sort === 'featured' }),
    reads.seriesList('program', 0),
    ...views.map(({ format }) => reads.videos({ format })),
  ]);
  const programmeShelves = await Promise.all(
    programmes.items.slice(0, PROGRAMME_SHELVES).map(async (programme) => ({
      programme,
      videos: (await reads.seriesVideos(programme.id, 0)).items.slice(0, SHELF),
    })),
  );

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
              {t('sections.programs')}
            </ActionLink>
          </>
        }
      />

      <Container>
        <div className="flex flex-col gap-[var(--space-section)] py-[var(--space-section)]">
          <section className="flex flex-col gap-6" aria-labelledby="watch-videos">
            <SectionHeader
              id="watch-videos"
              heading={heading}
              intro={t(`landing.${sort}Intro`)}
            />
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
            {page.items.length === 0 ? (
              <EmptyState
                icon="video"
                {...(sort === 'featured'
                  ? {
                      action: {
                        href: localizedPath(locale, '/watch?sort=latest'),
                        text: t('sort.latest'),
                      },
                    }
                  : {})}
              >
                {sort === 'featured' ? t('featuredEmpty') : t('empty')}
              </EmptyState>
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

          {programmeShelves
            .filter((shelf) => shelf.videos.length > 0)
            .map(({ programme, videos }) => {
              const programmeLabel = mediaLabel(programme, locale);
              return (
                <VideoShelf
                  key={programme.id}
                  locale={locale}
                  id={`watch-programme-${programme.id}`}
                  heading={programmeLabel.title}
                  headingLang={programmeLabel.locale}
                  videos={videos}
                  episode
                  action={{
                    href: seriesPath(locale, programme.kind, programme.slug),
                    text: t('allEpisodes'),
                  }}
                />
              );
            })}

          {/* Every surface, as a compact index rather than a wall of cards. */}
          <nav aria-labelledby="watch-browse" className="flex flex-col gap-6">
            <h2 id="watch-browse" className="text-heading font-semibold">
              {t('browse')}
            </h2>
            <div className="grid gap-x-10 gap-y-8 border-t border-border pt-6 sm:grid-cols-2 lg:grid-cols-3">
              {LANDING_GROUPS.map((group) => (
                <div key={group.key} className="flex min-w-0 flex-col gap-3">
                  <h3 className="text-subheading font-semibold">
                    {t(`landing.${group.key}Heading`)}
                  </h3>
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
