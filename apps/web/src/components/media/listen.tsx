import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import type {
  AudioSeriesEntry,
  AudioSeriesRecord,
  AudioTrackListing,
  AudioTrackRecord,
  AudioTrackSeries,
} from '@minhaj/contracts/media';

import { mediaReadRuntime } from '@/composition/media-read';
import { contributorNames, referenceNames } from '@/composition/public-references';
import { contentLanguageBadge } from '@/components/content-language';
import { RecitationPreview } from '@/components/quran/recitations';
import { quranAvailability } from '@/components/quran/read';
import { caseless } from '@/components/topic-hub/address';
import {
  ActionLink,
  Breadcrumbs,
  Container,
  EmptyState,
  Hero,
  Icon,
  LanguageBadge,
  MetaRow,
  SectionHeader,
  Stat,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { runningTime, spanText } from './groups';
import { listenLecturesHref } from './listen-view';
import { Duration, formatDate } from './parts';
import {
  audioSeriesPath,
  audioTrackPath,
  mediaLabel,
  mediaLocales,
} from './presentation';
import { CountChips } from './watch';

/**
 * LISTEN — the public audio surfaces (ROUTE_MAP.md §3.7; Phase 11, rebuilt in
 * Watch Part 3): this module's shared parts — a recording's card, an audio
 * series' card, the trail, the preview other owners' pages compose, the
 * metadata — and the landing. The audio lectures listing and a recording's
 * page are `./listen-lectures`; the audio series' directory and pages
 * `./listen-series`.
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Every read goes through
 * Media's, People's, Taxonomy's and Quran's PUBLIC compositions, none of which
 * reaches Identity, a session or a cookie, so a signed-in listener sees
 * exactly what an anonymous one does, and nothing about a visit is recorded.
 *
 * HONEST PRESENTATION. No track or series has cover art, so none is painted: a
 * recording is marked by a drawn first-party audio tile, never a stock image or
 * a generated picture. Every fact shown is one the record has — an unknown
 * duration or date is absent, never a dash — and a figure of zero is never
 * stated. Nothing is "featured": the model records no such choice for audio.
 *
 * NO RECITATION IS MEDIA'S. Everything Media answers here is non-Quran audio.
 * The landing's recitations are Quran's own cards over Quran's public reader
 * (`RecitationPreview`), composed here at Layer 4, and their catalogue is
 * `/quran/recitations` alone.
 */

export type ListenTranslator = Awaited<ReturnType<typeof getTranslations<'listen'>>>;
type Names = ReadonlyMap<string, { readonly slug: string; readonly name: string }>;

/** Home › Listen › … — the trail every Listen page starts with. */
export async function listenTrail(locale: Locale) {
  const [shell, t] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'listen' }),
  ]);
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: localizedPath(locale, ''), text: shell('nav.home') },
    listen: { href: localizedPath(locale, '/listen'), text: t('title') },
  };
}

/** A grid of cards: one column on a phone, up to three on a laptop. */
export const LISTEN_GRID =
  'grid list-none grid-cols-1 gap-x-6 gap-y-6 p-0 *:min-w-0 sm:grid-cols-2 lg:grid-cols-3';

/** The drawn audio tile — decorative, the same for every recording. */
export function AudioTile({ size = 'card' }: { readonly size?: 'card' | 'row' }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-control border border-accent-rule bg-accent-surface text-accent ${size === 'card' ? 'size-14' : 'size-11'}`}
    >
      <Icon name="audio" size={size === 'card' ? 24 : 20} />
    </span>
  );
}

/** The speakers of a recording, as one plain line of People's names. */
export function speakerLine(speakerIds: readonly string[], people: Names): string {
  return speakerIds
    .flatMap((id) => {
      const person = people.get(id.toLowerCase());
      return person === undefined ? [] : [person.name];
    })
    .join(' · ');
}

/**
 * ONE RECORDING AS A CARD: the drawn audio tile; its content language; its
 * title in its own language as ONE link stretched over the card; who speaks;
 * its length and recording date; and its place in its audio series, while
 * that series is published.
 */
export function AudioCard({
  locale,
  track,
  people,
  t,
  headingLevel = 'h3',
}: {
  readonly locale: Locale;
  readonly track: AudioTrackListing & { readonly series?: AudioTrackSeries | null };
  readonly people: Names;
  readonly t: ListenTranslator;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const Heading = headingLevel;
  const label = mediaLabel(track, locale);
  const language = contentLanguageBadge(track.languageCode, locale);
  const speakers = speakerLine(track.speakerIds, people);
  const series =
    track.series === undefined || track.series === null
      ? null
      : { ...mediaLabel(track.series, locale), position: track.series.position };
  return (
    <li className="card-surface group relative flex min-w-0 items-start gap-4 rounded-panel border border-border bg-surface-raised p-4">
      <AudioTile />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        {language === undefined ? null : (
          <span className="flex">
            <LanguageBadge {...language} />
          </span>
        )}
        <Heading
          className="text-subheading font-semibold text-balance wrap-anywhere"
          lang={label.locale}
          dir={directionOf(label.locale)}
        >
          <a
            href={audioTrackPath(locale, track.slug)}
            className="card-link text-foreground no-underline decoration-accent-rule decoration-1 underline-offset-4 group-hover:underline active:text-action"
          >
            {label.title}
          </a>
        </Heading>
        {speakers === '' ? null : (
          <p
            className="line-clamp-2 text-sm wrap-anywhere text-foreground-muted"
            dir="auto"
          >
            <span className="sr-only">{t('speakers')}: </span>
            {speakers}
          </p>
        )}
        <MetaRow
          items={[
            track.durationSeconds === null ? null : (
              <span>
                <span className="sr-only">{t('fact.duration')}: </span>
                <Duration seconds={track.durationSeconds} />
              </span>
            ),
            track.recordedOn === null ? null : (
              <time dateTime={track.recordedOn}>
                {formatDate(track.recordedOn, locale)}
              </time>
            ),
          ]}
        />
        {series === null ? null : (
          <p className="text-caption wrap-anywhere text-foreground-muted">
            {t('fact.position', { number: series.position })}
            {' · '}
            <span lang={series.locale} dir={directionOf(series.locale)}>
              {series.title}
            </span>
          </p>
        )}
      </div>
    </li>
  );
}

/**
 * Recordings as cards, every speaker on them named in ONE People call. Nothing
 * when there are none.
 */
export async function AudioCards({
  locale,
  tracks,
  label,
  headingLevel = 'h3',
}: {
  readonly locale: Locale;
  readonly tracks: readonly (AudioTrackListing & {
    readonly series?: AudioTrackSeries | null;
  })[];
  readonly label: string;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  if (tracks.length === 0) return null;
  const [t, names] = await Promise.all([
    getTranslations({ locale, namespace: 'listen' }),
    referenceNames(
      { personIds: tracks.flatMap((track) => track.speakerIds), topicIds: [] },
      locale,
    ),
  ]);
  const people = caseless(names.people);
  return (
    <ul aria-label={label} className={LISTEN_GRID}>
      {tracks.map((track) => (
        <AudioCard
          key={track.id}
          locale={locale}
          track={track}
          people={people}
          t={t}
          headingLevel={headingLevel}
        />
      ))}
    </ul>
  );
}

/**
 * ONE AUDIO SERIES AS A CARD: the drawn audio tile with sheets behind it — a
 * run of recordings, not one — and its count on the corner; then the title in
 * its own language (ONE link to its one address), the start of its
 * description, its span of years, running time, languages and speakers.
 */
export function AudioSeriesCard({
  locale,
  entry,
  people,
  t,
  tw,
  headingLevel = 'h3',
}: {
  readonly locale: Locale;
  readonly entry: AudioSeriesEntry;
  readonly people: Names;
  readonly t: ListenTranslator;
  readonly tw: Awaited<ReturnType<typeof getTranslations<'watch'>>>;
  readonly headingLevel?: 'h2' | 'h3';
}) {
  const Heading = headingLevel;
  const label = mediaLabel(entry, locale);
  const content = { lang: label.locale, dir: directionOf(label.locale) };
  const only = entry.languages.length === 1 ? entry.languages[0] : undefined;
  const language = only === undefined ? undefined : contentLanguageBadge(only.id, locale);
  const named = entry.speakers.flatMap((speaker) => {
    const person = people.get(speaker.id.toLowerCase());
    return person === undefined ? [] : [person.name];
  });
  const speakers =
    named.length === 0
      ? null
      : named.length > 2
        ? tw('groups.andMore', {
            names: named.slice(0, 2).join(' · '),
            count: named.length - 2,
          })
        : named.join(' · ');
  return (
    <li className="card-surface group relative flex min-w-0 flex-col gap-3 rounded-panel pt-2">
      <span className="relative block">
        <span
          aria-hidden="true"
          className="absolute inset-x-5 -top-2 h-8 rounded-panel border border-accent-rule bg-accent-surface"
        />
        <span
          aria-hidden="true"
          className="absolute inset-x-2.5 -top-1 h-8 rounded-panel border border-border bg-surface-sunken"
        />
        <span className="relative flex aspect-[5/2] w-full items-center justify-center rounded-panel border border-accent-rule bg-accent-surface">
          <Icon name="audio" size={24} className="text-accent" />
          <span className="absolute end-2 bottom-2 inline-flex items-center gap-1 rounded-control bg-ink/85 px-1.5 py-0.5 text-caption font-semibold text-ink-foreground tabular-nums">
            <Icon name="list" size={16} />
            {t('seriesCount', { count: entry.tracks })}
          </span>
        </span>
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        {language === undefined ? null : (
          <span className="flex">
            <LanguageBadge {...language} />
          </span>
        )}
        <Heading
          className="text-subheading font-semibold text-balance wrap-anywhere"
          {...content}
        >
          <a
            href={audioSeriesPath(locale, entry.slug)}
            className="card-link text-foreground no-underline decoration-accent-rule decoration-1 underline-offset-4 group-hover:underline active:text-action"
          >
            {label.title}
          </a>
        </Heading>
        {label.description === '' ? null : (
          <p
            className="line-clamp-2 text-sm wrap-anywhere text-foreground-muted"
            {...content}
          >
            {label.description}
          </p>
        )}
        <MetaRow
          items={[
            spanText(locale, tw, entry),
            runningTime(tw, entry.seconds),
            entry.languages.length > 1
              ? tw('groups.languages', { count: entry.languages.length })
              : null,
            speakers === null ? null : (
              <span dir="auto">
                <span className="sr-only">{t('speakers')}: </span>
                {speakers}
              </span>
            ),
          ]}
        />
      </div>
    </li>
  );
}

/* ===========================================================================
 * Previews composed into other owners' pages
 * ========================================================================= */

/** How many recordings a topic hub or a profile previews. */
const PREVIEW = 4;

/**
 * A bounded preview of public recordings — on a topic hub or a speaker's
 * profile, composed there at Layer 4 through Media's public reader. Renders
 * NOTHING when there are none, so no page carries an empty frame
 * (ROUTE_MAP.md §5.2).
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
  const page = await mediaReadRuntime().audioListing({
    ...filter,
    titleLocale: locale,
    limit: PREVIEW,
  });
  if (page.items.length === 0) return null;
  return (
    <section className="flex flex-col gap-5" aria-labelledby={headingId}>
      <SectionHeader id={headingId} heading={heading} action={more} />
      <AudioCards locale={locale} tracks={page.items} label={heading} />
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

/* ===========================================================================
 * /listen — the landing
 * ========================================================================= */

/** How many recordings the landing opens with. */
const LANDING_TRACKS = 6;
/** How many audio series it shows. */
const LANDING_SERIES = 3;
/** How many Topics and speakers it offers as ways in. */
const TOPIC_CHIPS = 12;
const SPEAKER_CHIPS = 10;

/**
 * The browse index: Listen's own surfaces — the Quran's recitations only while
 * a corpus is active, at their one address — then the ways to find by Topic
 * and Watch, Listen's sibling for video. Together with the Topic and speaker
 * ways in, every item of the Watch menu's Listen column.
 */
const LANDING_GROUPS = [
  { key: 'listen', surfaces: ['lectures', 'series', 'recitations'] },
  { key: 'find', surfaces: ['topics', 'watch', 'watchSpeakers'] },
] as const;

function surfacePath(locale: Locale, surface: string): string {
  switch (surface) {
    case 'recitations':
      return localizedPath(locale, '/quran/recitations');
    case 'topics':
      return localizedPath(locale, '/topics');
    case 'watch':
      return localizedPath(locale, '/watch');
    case 'watchSpeakers':
      return localizedPath(locale, '/watch/speakers');
    default:
      return localizedPath(locale, `/listen/${surface}`);
  }
}

/**
 * `/listen` — THE FRONT DOOR. What Listen holds, from ONE facet read of every
 * published recording (recordings, hours, languages, Topics and speakers — a
 * zero never stated, a bounded count never overstated); the latest
 * recordings; the audio series; the ways in by Topic and by speaker with
 * counts, each leading to the listing filtered by it; the Quran's recitations
 * (Quran's own cards, only while a corpus is active); and a compact index of
 * every surface. Each section only when it has something in it.
 */
export async function ListenLandingPage({ locale }: { readonly locale: Locale }) {
  const [t, tw, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'listen' }),
    getTranslations({ locale, namespace: 'watch' }),
    listenTrail(locale),
  ]);
  const reads = mediaReadRuntime();
  const [latest, facets, directory, quran] = await Promise.all([
    reads.audioListing({ titleLocale: locale, limit: LANDING_TRACKS }),
    reads.audioListingFacets({ titleLocale: locale }),
    reads.audioSeriesDirectory(),
    quranAvailability(),
  ]);
  const topicFacets = facets.topics.items.slice(0, TOPIC_CHIPS);
  const speakerFacets = facets.speakers.items.slice(0, SPEAKER_CHIPS);
  // The newest series first: the one whose latest recording is newest.
  const series = [...directory.items]
    .filter((entry) => entry.tracks > 0)
    .sort((a, b) => {
      const x = a.lastOn ?? '';
      const y = b.lastOn ?? '';
      return x === y ? b.tracks - a.tracks : x < y ? 1 : -1;
    })
    .slice(0, LANDING_SERIES);
  const [names, seriesPeople] = await Promise.all([
    referenceNames(
      {
        personIds: speakerFacets.map((facet) => facet.id),
        topicIds: topicFacets.map((facet) => facet.id),
      },
      locale,
    ),
    contributorNames(
      series.flatMap((entry) => entry.speakers.slice(0, 3).map((speaker) => speaker.id)),
      locale,
    ),
  ]);
  const topics = caseless(names.topics);
  const people = caseless(names.people);

  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const all = facets.all;
  const hours = Math.floor(all.seconds / 3600);
  const stats = [
    ...(all.tracks === 0
      ? []
      : [
          {
            value: number(all.tracks),
            label: t('stats.recordings', { count: all.tracks }),
          },
        ]),
    ...(hours === 0
      ? []
      : [{ value: number(hours), label: t('stats.hours', { count: hours }) }]),
    ...(all.languages < 2
      ? []
      : [
          {
            value: number(all.languages),
            label: t('stats.languages', { count: all.languages }),
          },
        ]),
    ...(facets.topics.items.length === 0 || facets.topics.hasMore
      ? []
      : [
          {
            value: number(facets.topics.items.length),
            label: t('stats.topics', { count: facets.topics.items.length }),
          },
        ]),
    ...(facets.speakers.items.length === 0 || facets.speakers.hasMore
      ? []
      : [
          {
            value: number(facets.speakers.items.length),
            label: t('stats.speakers', { count: facets.speakers.items.length }),
          },
        ]),
  ];
  const topicChips = topicFacets.flatMap((facet) => {
    const topic = topics.get(facet.id.toLowerCase());
    return topic === undefined
      ? []
      : [
          {
            href: listenLecturesHref(locale, { topic: facet.id }),
            text: topic.name,
            count: number(facet.tracks),
          },
        ];
  });
  const speakerChips = speakerFacets.flatMap((facet) => {
    const person = people.get(facet.id.toLowerCase());
    return person === undefined
      ? []
      : [
          {
            href: listenLecturesHref(locale, { speaker: facet.id }),
            text: person.name,
            count: number(facet.tracks),
          },
        ];
  });
  const groups = LANDING_GROUPS.map((group) => ({
    ...group,
    surfaces: group.surfaces.filter(
      (surface) => surface !== 'recitations' || quran.active,
    ),
  }));

  return (
    <>
      <Container>
        <div className="pt-6">
          <Breadcrumbs label={trail.label} trail={[trail.home, { text: t('title') }]} />
        </div>
      </Container>
      <Hero
        title={t('title')}
        lede={t('description')}
        actions={
          all.tracks === 0 ? undefined : (
            <ActionLink href={listenLecturesHref(locale)}>
              <span className="inline-flex items-center gap-2">
                <Icon name="audio" size={16} />
                {t('landing.browseAll')}
              </span>
            </ActionLink>
          )
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
          <section className="flex flex-col gap-5" aria-labelledby="listen-latest">
            <SectionHeader
              id="listen-latest"
              heading={t('latest')}
              intro={t('latestIntro')}
              {...(latest.total > latest.items.length
                ? {
                    action: {
                      href: listenLecturesHref(locale),
                      text: t('landing.seeAll', { count: latest.total }),
                    },
                  }
                : {})}
            />
            {latest.items.length === 0 ? (
              <EmptyState
                icon="audio"
                title={t('landing.emptyTitle')}
                action={{
                  href: localizedPath(locale, '/watch'),
                  text: t('landing.watchInstead'),
                }}
              >
                {t('empty')}
              </EmptyState>
            ) : (
              <AudioCards locale={locale} tracks={latest.items} label={t('latest')} />
            )}
          </section>

          {series.length === 0 ? null : (
            <section className="flex flex-col gap-6" aria-labelledby="listen-series">
              <SectionHeader
                id="listen-series"
                heading={t('sections.series')}
                intro={t('landing.seriesIntro')}
                action={{
                  href: localizedPath(locale, '/listen/series'),
                  text: t('allSeries'),
                }}
              />
              <ul aria-label={t('sections.series')} className={LISTEN_GRID}>
                {series.map((entry) => (
                  <AudioSeriesCard
                    key={entry.id}
                    locale={locale}
                    entry={entry}
                    people={caseless(seriesPeople)}
                    t={t}
                    tw={tw}
                  />
                ))}
              </ul>
            </section>
          )}

          {topicChips.length === 0 ? null : (
            <section className="flex flex-col gap-5" aria-labelledby="listen-topics">
              <SectionHeader
                id="listen-topics"
                heading={t('landing.topicsHeading')}
                intro={t('landing.topicsIntro')}
              />
              <CountChips label={t('landing.topicsHeading')} chips={topicChips} />
            </section>
          )}

          {speakerChips.length === 0 ? null : (
            <section className="flex flex-col gap-5" aria-labelledby="listen-speakers">
              <SectionHeader
                id="listen-speakers"
                heading={t('landing.speakersHeading')}
                intro={t('landing.speakersIntro')}
              />
              <CountChips label={t('landing.speakersHeading')} chips={speakerChips} />
            </section>
          )}

          <RecitationPreview
            locale={locale}
            headingId="listen-recitations"
            heading={t('sections.recitations')}
            intro={t('landing.recitationsIntro')}
          />

          {/* Every surface, as a compact index rather than a wall of cards. */}
          <nav aria-labelledby="listen-browse" className="flex flex-col gap-6">
            <h2 id="listen-browse" className="text-heading font-semibold">
              {t('browse')}
            </h2>
            <div className="grid gap-x-10 gap-y-8 border-t border-border pt-6 sm:grid-cols-2">
              {groups.map((group) => (
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
                            {t(`sections.${surface}`)}
                            <Icon
                              name="arrow-end"
                              size={16}
                              className="text-accent opacity-0 transition-opacity duration-[var(--duration-fast)] group-hover:opacity-100 group-focus-visible:opacity-100"
                            />
                          </span>
                          <span className="text-sm text-foreground-muted">
                            {t(`sectionBody.${surface}`)}
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
