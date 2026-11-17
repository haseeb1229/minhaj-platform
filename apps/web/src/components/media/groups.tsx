import 'server-only';

import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import {
  formatDuration,
  isoDuration,
  MEDIA_GROUP_EPISODES_PAGE,
  MEDIA_GROUP_FACETS_MAX,
  type GroupEpisode,
  type MediaGroupEntry,
  type MediaGroupKind,
  type MediaGroupRef,
  type PlaylistRecord,
  type SeriesRecord,
} from '@minhaj/contracts/media';
import type { PublicPersonCard } from '@minhaj/contracts/people';

import { mediaReadRuntime } from '@/composition/media-read';
import {
  contributorCards,
  contributorNames,
  topicNames,
} from '@/composition/public-references';
import { contentLanguageBadge } from '@/components/content-language';
import { ClosingNote, RangeSummary } from '@/components/library/browse-parts';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import { PersonMark } from '@/components/people/portrait';
import { lectureHref, passageCitation } from '@/components/quran/tafsir-layout';
import {
  caseless,
  initialOf,
  pageCount,
  pageRange,
} from '@/components/topic-hub/address';
import {
  ActiveFilters,
  ExploreFilters,
  ExploreHero,
  languageName,
} from '@/components/topic-hub/parts';
import { watchVideosHref } from '@/components/topic-hub/videos-view';
import {
  ActionLink,
  Badge,
  Breadcrumbs,
  Container,
  EmptyState,
  Field,
  Icon,
  LanguageBadge,
  MetaRow,
  Pager,
  ResponsiveImage,
  SectionHeader,
  Select,
  Stat,
  TextInput,
  TopicChips,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import {
  DEFAULT_GROUPS_VIEW,
  GROUPS_PAGE,
  groupFacets,
  groupMatches,
  groupPageHref,
  groupsFiltered,
  groupsHref,
  groupsPathOf,
  relatedGroups,
  sortGroups,
  yearSpan,
  type GroupRow,
  type GroupsView,
} from './groups-view';
import { BreadcrumbData, Duration, formatDate } from './parts';
import {
  mediaLabel,
  mediaLocales,
  playlistPath,
  seriesPath,
  videoPath,
  videoPosterPath,
} from './presentation';

/**
 * WATCH PART 2 — SERIES, PROGRAMMES AND PLAYLISTS (ROUTE_MAP.md §3.7;
 * DOMAIN_MODEL.md §11): each kind's directory and each grouping's own page.
 *
 * WHAT EACH KIND IS DECIDES HOW IT IS SHOWN. A SERIES is meant to be watched
 * in order: its page opens on "Start from episode 1", then its latest. A
 * PROGRAMME is the same aggregate made to recur: its page opens on its latest
 * episode, then the first. Both number their episodes as their editor did
 * ("Episode 3"), and a Video is an episode of at most one. A PLAYLIST is a
 * hand-picked list in a chosen order whose Videos may come from anywhere and
 * appear in other lists too: it "plays from the start", numbers its Videos by
 * their place among its PUBLISHED ones, and has no "latest". None of the
 * three is stored twice: every figure, language, speaker, Topic and cover is
 * what the grouping's published Videos say (Media's `groupDirectory`,
 * `groupSummary`, `groupEpisodes`).
 *
 * LAYER-4 COMPOSITION, SESSION-FREE. Media answers identifiers; People names
 * the speakers and Taxonomy the Topics, a whole directory at once in bounded
 * batches — through the public compositions only, so no page here reaches
 * Identity, a session or a cookie. No provider is contacted to paint a card:
 * a cover is Media's own stored poster of the grouping's first Video that has
 * one, else a drawn tile.
 *
 * THE VIEW IS THE ADDRESS (`./groups-view`): a directory's title search,
 * language, speaker and Topic filters, order and page are GET parameters;
 * a grouping's page takes `?page` alone.
 */

type WatchTranslator = Awaited<ReturnType<typeof getTranslations<'watch'>>>;
type Names = ReadonlyMap<string, { readonly slug: string; readonly name: string }>;

/** A grouping's ONE address. */
function groupPath(
  locale: string,
  entry: Pick<MediaGroupEntry, 'kind' | 'slug'>,
): string {
  return entry.kind === 'playlist'
    ? playlistPath(locale, entry.slug)
    : seriesPath(locale, entry.kind, entry.slug);
}

/**
 * Whole hours, else whole minutes, of a running time — never more than the
 * truth. Shared with Listen's audio series (Watch Part 3).
 */
export function runningTime(t: WatchTranslator, seconds: number): string | null {
  if (seconds >= 3600) return t('groups.hours', { count: Math.floor(seconds / 3600) });
  if (seconds >= 60) return t('groups.minutes', { count: Math.floor(seconds / 60) });
  return null;
}

/** "2019–2023", or one year, or nothing. Shared with Listen's audio series. */
export function spanText(
  locale: string,
  t: WatchTranslator,
  entry: Pick<MediaGroupEntry, 'firstOn' | 'lastOn'>,
): string | null {
  const span = yearSpan(entry.firstOn, entry.lastOn);
  if (span === null) return null;
  const year = new Intl.NumberFormat(locale, { useGrouping: false });
  return span.from === span.to
    ? year.format(span.from)
    : t('groups.span', { from: year.format(span.from), to: year.format(span.to) });
}

/** The commonest speakers' names, as one plain line ("A · B and 2 more"). */
function speakerLine(
  t: WatchTranslator,
  entry: MediaGroupEntry,
  people: Names,
  shown = 2,
): string | null {
  const named = entry.speakers.flatMap((speaker) => {
    const person = people.get(speaker.id.toLowerCase());
    return person === undefined ? [] : [person.name];
  });
  if (named.length === 0) return null;
  const line = named.slice(0, shown).join(' · ');
  return named.length > shown
    ? t('groups.andMore', { names: line, count: named.length - shown })
    : line;
}

/**
 * ONE GROUPING AS A CARD: its cover (or a drawn tile) with sheets behind it —
 * a set of videos, not one — and its count on the corner; then the title in
 * its own language, the start of its description, its span of years, running
 * time and speakers. The card is ONE link to its one address.
 */
function GroupCard({
  locale,
  entry,
  people,
  t,
  headingLevel,
}: {
  readonly locale: Locale;
  readonly entry: MediaGroupEntry;
  readonly people: Names;
  readonly t: WatchTranslator;
  readonly headingLevel: 'h2' | 'h3';
}) {
  const Heading = headingLevel;
  const label = mediaLabel(entry, locale);
  const content = { lang: label.locale, dir: directionOf(label.locale) };
  const only = entry.languages.length === 1 ? entry.languages[0] : undefined;
  const language = only === undefined ? undefined : contentLanguageBadge(only.id, locale);
  const speakers = speakerLine(t, entry, people);
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
        <span className="relative block">
          {entry.cover === null ? (
            <span
              aria-hidden="true"
              className="flex aspect-video w-full items-center justify-center rounded-panel border border-accent-rule bg-accent-surface"
            >
              <Icon
                name={entry.kind === 'playlist' ? 'list' : 'video'}
                size={24}
                className="text-accent"
              />
            </span>
          ) : (
            <ResponsiveImage
              path={videoPosterPath(entry.cover.videoId, entry.cover.poster.assetId)}
              alt=""
              aspect="16/9"
              fit="cover"
              radius="panel"
              width={entry.cover.poster.width}
              height={entry.cover.poster.height}
              sizes="(min-width: 64rem) 22rem, (min-width: 40rem) 45vw, 100vw"
              className="transition-[filter] duration-[var(--duration-medium)] ease-[var(--ease-standard)] group-hover:brightness-95"
            />
          )}
          <span className="absolute end-2 bottom-2 inline-flex items-center gap-1 rounded-control bg-ink/85 px-1.5 py-0.5 text-caption font-semibold text-ink-foreground tabular-nums">
            <Icon name="list" size={16} />
            {t(`groups.${entry.kind}.count`, { count: entry.videos })}
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
            href={groupPath(locale, entry)}
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
            spanText(locale, t, entry),
            runningTime(t, entry.seconds),
            entry.languages.length > 1
              ? t('groups.languages', { count: entry.languages.length })
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

/** The grid groupings sit in: one column on a phone, up to three on a laptop. */
const GROUP_GRID =
  'grid list-none grid-cols-1 gap-x-6 gap-y-10 p-0 *:min-w-0 sm:grid-cols-2 lg:grid-cols-3';

/** Home › Watch › … */
async function trailOf(locale: Locale) {
  const [shell, t] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'watch' }),
  ]);
  return {
    label: shell('nav.breadcrumbs'),
    home: { href: localizedPath(locale, ''), text: shell('nav.home') },
    watch: { href: localizedPath(locale, '/watch'), text: t('title') },
  };
}

/** The section name of a kind's directory ("Series", "Programmes", "Playlists"). */
function sectionOf(kind: MediaGroupKind): 'series' | 'programs' | 'playlists' {
  return kind === 'program' ? 'programs' : kind === 'playlist' ? 'playlists' : 'series';
}

/* ===========================================================================
 * The directory
 * ========================================================================= */

/**
 * `/watch/series`, `/watch/programs`, `/watch/playlists` — every published
 * grouping of the kind (Media's directory, at most
 * `MEDIA_GROUP_DIRECTORY_MAX`), searched by title and narrowed by a language,
 * a speaker and a Topic — each option counted under the others — in one of
 * three orders, 24 a page.
 */
export async function GroupDirectoryPage({
  locale,
  kind,
  view,
}: {
  readonly locale: Locale;
  readonly kind: MediaGroupKind;
  readonly view: GroupsView;
}) {
  const [t, hub, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'watch' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    trailOf(locale),
  ]);
  const directory = await mediaReadRuntime().groupDirectory(kind);
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const rows: GroupRow[] = directory.items.map((entry) => ({
    entry,
    title: mediaLabel(entry, locale).title,
  }));
  const facets = groupFacets(rows, view);
  const shown = sortGroups(
    rows.filter((row) => groupMatches(row, view)),
    view.sort,
    collator,
  );
  const pages = pageCount(shown.length, GROUPS_PAGE);
  const slice = shown.slice((view.page - 1) * GROUPS_PAGE, view.page * GROUPS_PAGE);
  const range = pageRange(view.page, slice.length, GROUPS_PAGE);

  const [peopleNames, topicNamed] = await Promise.all([
    contributorNames(
      [
        ...facets.speakers.map((entry) => entry.id),
        ...slice.flatMap((row) =>
          row.entry.speakers.slice(0, 3).map((entry) => entry.id),
        ),
        ...(view.speaker === null ? [] : [view.speaker]),
      ],
      locale,
    ),
    topicNames(
      [
        ...facets.topics.map((entry) => entry.id),
        ...(view.topic === null ? [] : [view.topic]),
      ],
      locale,
    ),
  ]);
  const people = caseless(peopleNames);
  const topics = caseless(topicNamed);

  const section = sectionOf(kind);
  const title = t(`sections.${section}`);
  const listId = `watch-${section}-list`;
  const href = (change: Partial<GroupsView>) =>
    groupsHref(kind, locale, view, { page: 1, ...change });
  const base = groupsHref(kind, locale, { ...DEFAULT_GROUPS_VIEW, sort: view.sort });
  const filtered = groupsFiltered(view);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);

  // The figures of the whole directory — never of a filtered view — each
  // stated only when it is true: a sum of Videos only where a Video is in at
  // most one grouping (a Series), and a distinct count only while no grouping
  // reached the read's per-grouping bound.
  const series = kind !== 'playlist';
  const videos = rows.reduce((sum, row) => sum + row.entry.videos, 0);
  const seconds = rows.reduce((sum, row) => sum + row.entry.seconds, 0);
  const distinct = (
    of: (entry: MediaGroupEntry) => readonly { readonly id: string }[],
  ) =>
    rows.some((row) => of(row.entry).length >= MEDIA_GROUP_FACETS_MAX)
      ? 0
      : new Set(
          rows.flatMap((row) => of(row.entry).map((value) => value.id.toLowerCase())),
        ).size;
  const languages = distinct((entry) => entry.languages);
  const speakers = distinct((entry) => entry.speakers);
  const hours = Math.floor(seconds / 3600);

  const speakerOptions = facets.speakers.flatMap((facet) => {
    const person = people.get(facet.id);
    return person === undefined
      ? []
      : [{ id: facet.id, name: person.name, count: facet.videos }];
  });
  const topicOptions = facets.topics.flatMap((facet) => {
    const topic = topics.get(facet.id);
    return topic === undefined
      ? []
      : [{ id: facet.id, name: topic.name, count: facet.videos }];
  });
  const speakerName =
    view.speaker === null ? null : (people.get(view.speaker)?.name ?? null);
  const topicName = view.topic === null ? null : (topics.get(view.topic)?.name ?? null);

  const chip = (key: string, text: string, removeHref: string) => ({
    key,
    text,
    removeHref,
    removeLabel: hub('common.remove', { name: text }),
  });
  const active = [
    ...(view.q === null
      ? []
      : [chip('q', t('groups.chipTitle', { q: view.q }), href({ q: null }))]),
    ...(view.language === null
      ? []
      : [
          chip('language', languageName(view.language, locale), href({ language: null })),
        ]),
    ...(view.speaker === null
      ? []
      : [
          chip(
            'speaker',
            speakerName ?? hub('videos.unknownSpeaker'),
            href({ speaker: null }),
          ),
        ]),
    ...(view.topic === null
      ? []
      : [chip('topic', topicName ?? t('unknownTopic'), href({ topic: null }))]),
  ];

  const others = (['series', 'program', 'playlist'] as const).filter(
    (other) => other !== kind,
  );

  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.watch, { text: title }]}
        />
        <ExploreHero
          eyebrow={t('title')}
          title={title}
          lede={t(`sectionBody.${section}`)}
          notice={t(`groups.${kind}.notice`)}
          stats={[
            ...(rows.length === 0
              ? []
              : [
                  {
                    value: number(rows.length),
                    label: t(`groups.${kind}.stat`, { count: rows.length }),
                    href: `#${listId}`,
                  },
                ]),
            ...(!series || videos === 0
              ? []
              : [
                  {
                    value: number(videos),
                    label: t('groups.statEpisodes', { count: videos }),
                  },
                ]),
            ...(!series || hours === 0
              ? []
              : [
                  {
                    value: number(hours),
                    label: t('groups.statHours', { count: hours }),
                  },
                ]),
            ...(languages < 2
              ? []
              : [
                  {
                    value: number(languages),
                    label: hub('common.statLanguages', { count: languages }),
                  },
                ]),
            ...(speakers === 0
              ? []
              : [
                  {
                    value: number(speakers),
                    label: t('groups.statSpeakers', { count: speakers }),
                  },
                ]),
          ]}
          actions={[
            ...others.map((other) => ({
              href: localizedPath(locale, groupsPathOf(other)),
              text: t(`sections.${sectionOf(other)}`),
            })),
            { href: watchVideosHref(locale), text: t('allVideos') },
            {
              href: localizedPath(locale, '/watch/speakers'),
              text: t('sections.speakers'),
            },
          ]}
        />

        {rows.length === 0 ? (
          <EmptyState
            icon="video"
            title={t(`groups.${kind}.emptyTitle`)}
            action={{ href: localizedPath(locale, '/watch'), text: t('homeLink') }}
          >
            {t(`groupEmpty.${kind}`)}
          </EmptyState>
        ) : (
          <section aria-labelledby={listId} className="flex flex-col gap-5">
            <SectionHeader
              id={listId}
              heading={t(`groups.${kind}.listHeading`)}
              intro={t(`groups.${kind}.listIntro`)}
            />

            <ExploreFilters
              action={localizedPath(locale, groupsPathOf(kind))}
              label={t(`groups.${kind}.filters`)}
              hidden={[]}
              submit={t('groups.apply')}
              reset={filtered ? { href: base, text: hub('common.reset') } : null}
            >
              <Field
                id="groups-q"
                label={t('groups.search')}
                help={t('groups.searchHelp')}
              >
                {(props) => (
                  <TextInput
                    {...props}
                    type="search"
                    name="q"
                    maxLength={60}
                    defaultValue={view.q ?? ''}
                    autoComplete="off"
                  />
                )}
              </Field>
              {facets.languages.length > 1 || view.language !== null ? (
                <Field id="groups-language" label={hub('common.filterLanguage')}>
                  {(props) => (
                    <Select {...props} name="language" defaultValue={view.language ?? ''}>
                      <option value="">{hub('common.anyLanguage')}</option>
                      {facets.languages.map((facet) => (
                        <option key={facet.id} value={facet.id}>
                          {hub('common.option', {
                            name: languageName(facet.id, locale),
                            count: facet.videos,
                          })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              {speakerOptions.length > 0 || view.speaker !== null ? (
                <Field id="groups-speaker" label={hub('videos.filterSpeaker')}>
                  {(props) => (
                    <Select {...props} name="speaker" defaultValue={view.speaker ?? ''}>
                      <option value="">{hub('videos.anySpeaker')}</option>
                      {speakerOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {hub('common.option', {
                            name: option.name,
                            count: option.count,
                          })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              {topicOptions.length > 0 || view.topic !== null ? (
                <Field id="groups-topic" label={t('filterTopic')}>
                  {(props) => (
                    <Select {...props} name="topic" defaultValue={view.topic ?? ''}>
                      <option value="">{t('anyTopic')}</option>
                      {topicOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {hub('common.option', {
                            name: option.name,
                            count: option.count,
                          })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              <Field id="groups-sort" label={hub('common.filterSort')}>
                {(props) => (
                  <Select {...props} name="sort" defaultValue={view.sort}>
                    <option value="newest">{t('groups.sort.newest')}</option>
                    <option value="title">{t('groups.sort.title')}</option>
                    <option value="videos">{t('groups.sort.videos')}</option>
                  </Select>
                )}
              </Field>
            </ExploreFilters>

            <ActiveFilters label={hub('common.active')} filters={active} />

            {range === null ? null : (
              <RangeSummary>
                {t(`groups.${kind}.summary`, {
                  from: number(range.from),
                  to: number(range.to),
                  total: shown.length,
                })}
              </RangeSummary>
            )}

            {slice.length === 0 ? (
              view.page > 1 && shown.length > 0 ? (
                <EmptyState
                  title={hub('common.pastEndTitle')}
                  action={{ href: href({}), text: hub('common.firstPage') }}
                >
                  {t('groups.pastEnd', { page: view.page })}
                </EmptyState>
              ) : (
                <EmptyState
                  title={t('groups.noResultsTitle')}
                  action={{ href: base, text: hub('common.reset') }}
                >
                  {t(`groups.${kind}.noResults`)}
                </EmptyState>
              )
            ) : (
              <ul aria-label={title} className={GROUP_GRID}>
                {slice.map((row) => (
                  <GroupCard
                    key={row.entry.id}
                    locale={locale}
                    entry={row.entry}
                    people={people}
                    t={t}
                    headingLevel="h3"
                  />
                ))}
              </ul>
            )}

            {slice.length === 0 ? null : (
              <Pager
                label={t('groups.pages')}
                previous={view.page > 1 ? href({ page: view.page - 1 }) : null}
                next={view.page < pages ? href({ page: view.page + 1 }) : null}
                previousLabel={t('previous')}
                nextLabel={t('next')}
                pages={{
                  current: view.page,
                  total: pages,
                  href: (page) => href({ page }),
                  label: (page) => hub('common.pageLabel', { page }),
                  format: number,
                }}
              />
            )}

            {directory.hasMore ? (
              <p className="text-sm text-foreground-muted">
                {t('groups.truncated', { count: directory.items.length })}
              </p>
            ) : null}
          </section>
        )}

        {/* Ways onward the header does not already offer, so no page names one
            destination twice under one name. */}
        <ClosingNote
          text={t(`groups.${kind}.about`)}
          links={[
            { href: localizedPath(locale, '/topics'), text: t('sections.topics') },
            { href: localizedPath(locale, '/listen'), text: t('sections.listen') },
          ]}
        />
      </div>
    </Container>
  );
}

/* ===========================================================================
 * One grouping's page
 * ========================================================================= */

/**
 * WHERE AN EPISODE TAKES UP A QURAN PASSAGE — Quran Part 8's recorded moments,
 * each a link to the Video's own page at that moment (`?start=`): only past
 * 0:00, only inside its recorded length and only while it can be played, as
 * on the Video's own page ("Watch from").
 */
function momentsOf(episode: GroupEpisode) {
  if (episode.availability === 'unavailable') return [];
  return episode.passages
    .filter(
      (passage) =>
        passage.startSeconds !== null &&
        passage.startSeconds > 0 &&
        (episode.durationSeconds === null ||
          passage.startSeconds < episode.durationSeconds),
    )
    .sort((a, b) => (a.startSeconds ?? 0) - (b.startSeconds ?? 0));
}

/** How many moments one row offers before saying how many more its page has. */
const MOMENTS = 4;

/**
 * ONE VIDEO OF A GROUPING, in its place: its number, its poster (or a drawn
 * tile) with its running time, its title in its own language, its kind, its
 * episode number, date, language and speakers — one link stretched over that
 * — and under it, outside that link, the moments it takes up a Quran passage.
 */
function EpisodeRow({
  locale,
  episode,
  kind,
  people,
  t,
}: {
  readonly locale: Locale;
  readonly episode: GroupEpisode;
  readonly kind: MediaGroupKind;
  readonly people: Names;
  readonly t: WatchTranslator;
}) {
  const label = mediaLabel(episode, locale);
  const path = videoPath(locale, episode.slug);
  const language = contentLanguageBadge(episode.languageCode, locale);
  const speakers = episode.speakerIds
    .flatMap((id) => {
      const person = people.get(id.toLowerCase());
      return person === undefined ? [] : [person.name];
    })
    .join(' · ');
  const moments = momentsOf(episode);
  const unavailable = episode.availability === 'unavailable';
  return (
    <li className="flex min-w-0 flex-col gap-3 py-5">
      <div className="card-surface group relative grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-3 gap-y-3 rounded-panel sm:grid-cols-[2.5rem_12rem_minmax(0,1fr)] sm:gap-x-5">
        <span
          aria-hidden="true"
          className="row-span-2 flex size-10 items-center justify-center rounded-full border border-accent-rule bg-accent-surface font-serif text-subheading font-semibold text-accent tabular-nums sm:row-span-1"
        >
          {new Intl.NumberFormat(locale).format(episode.number)}
        </span>
        <span className="relative block">
          {episode.poster === null ? (
            <span
              aria-hidden="true"
              className="flex aspect-video w-full items-center justify-center rounded-panel border border-accent-rule bg-accent-surface"
            >
              <Icon name="play" size={20} className="text-accent" />
            </span>
          ) : (
            <ResponsiveImage
              path={videoPosterPath(episode.id, episode.poster.assetId)}
              alt=""
              aspect="16/9"
              fit="cover"
              radius="panel"
              width={episode.poster.width}
              height={episode.poster.height}
              sizes="(min-width: 40rem) 12rem, 80vw"
              className={`transition-[filter] duration-[var(--duration-medium)] ease-[var(--ease-standard)] group-hover:brightness-95 ${unavailable ? 'opacity-50 grayscale' : ''}`}
            />
          )}
          {episode.durationSeconds === null ? null : (
            <span className="absolute end-1.5 bottom-1.5 rounded-control bg-ink/85 px-1.5 py-0.5 text-caption font-semibold text-ink-foreground tabular-nums">
              <span className="sr-only">{t('fact.duration')}: </span>
              <Duration seconds={episode.durationSeconds} />
            </span>
          )}
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          {episode.format === null && !unavailable && language === undefined ? null : (
            <span className="flex flex-wrap gap-1.5">
              {unavailable ? (
                <Badge kind="status" tone="caution">
                  {t('unavailable')}
                </Badge>
              ) : episode.format === null ? null : (
                <Badge tone="neutral">{t(`format.${episode.format}`)}</Badge>
              )}
              {language === undefined ? null : <LanguageBadge {...language} />}
            </span>
          )}
          <h3
            className="text-subheading font-semibold text-balance wrap-anywhere"
            lang={label.locale}
            dir={directionOf(label.locale)}
          >
            <a
              href={path}
              className="card-link text-foreground no-underline decoration-accent-rule decoration-1 underline-offset-4 group-hover:underline active:text-action"
            >
              {label.title}
            </a>
          </h3>
          <MetaRow
            items={[
              kind === 'playlist' ? null : t('fact.episode', { number: episode.number }),
              episode.publishedOn === null ? null : (
                <time dateTime={episode.publishedOn}>
                  {formatDate(episode.publishedOn, locale)}
                </time>
              ),
              speakers === '' ? null : (
                <span dir="auto">
                  <span className="sr-only">{t('speakers')}: </span>
                  {speakers}
                </span>
              ),
            ]}
          />
        </div>
      </div>
      {moments.length === 0 ? null : (
        <ul
          aria-label={t('groups.momentsOf', { title: label.title })}
          className="flex flex-wrap gap-2 ps-[3.25rem] sm:ps-[16.75rem]"
        >
          {moments.slice(0, MOMENTS).map((passage) => (
            <li key={`${passageCitation(passage)}-${String(passage.startSeconds)}`}>
              <a
                href={lectureHref(path, passage)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3.5 text-sm font-medium text-foreground no-underline hover:border-accent hover:bg-accent-surface"
              >
                <Icon name="play" size={16} className="text-accent" />
                <span className="sr-only">{t('groups.watchFrom')} </span>
                <time
                  dateTime={isoDuration(passage.startSeconds ?? 0)}
                  className="tabular-nums"
                >
                  {formatDuration(passage.startSeconds ?? 0)}
                </time>
                <span className="sr-only">, {t('groups.quran')} </span>
                <bdi dir="ltr" className="text-foreground-muted tabular-nums">
                  {passageCitation(passage)}
                </bdi>
              </a>
            </li>
          ))}
          {moments.length > MOMENTS ? (
            <li className="flex min-h-11 items-center text-sm text-foreground-muted">
              {t('groups.moreMoments', { count: moments.length - MOMENTS })}
            </li>
          ) : null}
        </ul>
      )}
    </li>
  );
}

/**
 * WHO SPEAKS IN A GROUPING — each named by People: portrait or initial, the
 * name in the language People resolved it in, linked to the canonical
 * profile, and how much of the grouping is theirs. Shared with Listen's audio
 * series (Watch Part 3). A speaker People does not name is left out.
 */
export function SpeakerList({
  locale,
  speakers,
  people,
  portraits,
}: {
  readonly locale: Locale;
  readonly speakers: readonly { readonly id: string; readonly count: string }[];
  /** People's names, keyed in lower case. */
  readonly people: Names;
  /** People's public cards, keyed in lower case. */
  readonly portraits: ReadonlyMap<string, PublicPersonCard>;
}) {
  return (
    <ul className="flex list-none flex-col gap-4 p-0">
      {speakers.flatMap((speaker) => {
        const person = people.get(speaker.id.toLowerCase());
        if (person === undefined) return [];
        const card = portraits.get(speaker.id.toLowerCase());
        const nameLocale = card?.resolvedLocale ?? null;
        const own =
          nameLocale === null
            ? { dir: 'auto' as const }
            : { lang: nameLocale, dir: directionOf(nameLocale) };
        return [
          <li key={speaker.id} className="flex min-w-0 items-center gap-3">
            <PersonMark
              personId={speaker.id}
              portrait={card?.portrait ?? null}
              letter={initialOf(person.name, locale)}
              size="small"
              own={own}
            />
            <div className="flex min-w-0 flex-col">
              <a
                href={localizedPath(locale, `/people/${encodeURIComponent(person.slug)}`)}
                className="font-semibold wrap-anywhere text-foreground no-underline decoration-accent-rule underline-offset-4 hover:underline"
                {...own}
              >
                {card?.name ?? person.name}
              </a>
              <span className="text-sm text-foreground-muted">{speaker.count}</span>
            </div>
          </li>,
        ];
      })}
    </ul>
  );
}

/** How many related groupings a page offers. */
const RELATED = 3;

/**
 * `/watch/series/{slug}`, `/watch/programs/{slug}`, `/watch/playlists/{slug}`
 * — one published grouping: what it is (its kind, title, description and
 * figures), where to begin, its published Videos in its order, 24 a page,
 * who speaks in it, its Topics and languages, and the groupings of its kind
 * that share a speaker or a Topic with it.
 */
export async function GroupPage({
  locale,
  record,
  page,
}: {
  readonly locale: Locale;
  readonly record: SeriesRecord | PlaylistRecord;
  /** 1-based, from `?page`. */
  readonly page: number;
}) {
  const kind: MediaGroupKind = 'kind' in record ? record.kind : 'playlist';
  const group: MediaGroupRef =
    kind === 'playlist'
      ? { of: 'playlist', id: record.id }
      : { of: 'series', id: record.id };
  const reads = mediaReadRuntime();
  const [t, hub, trail, summary, episodes, directory] = await Promise.all([
    getTranslations({ locale, namespace: 'watch' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    trailOf(locale),
    reads.groupSummary(group),
    reads.groupEpisodes({
      group,
      offset: (page - 1) * MEDIA_GROUP_EPISODES_PAGE,
      limit: MEDIA_GROUP_EPISODES_PAGE,
    }),
    reads.groupDirectory(kind),
  ]);
  // Withdrawn between the route's read and this one.
  if (summary === null) notFound();
  const { entry, first, latest } = summary;
  const related = relatedGroups(entry, directory.items, RELATED);

  const speakerIds = entry.speakers.map((speaker) => speaker.id);
  const [peopleNames, topicNamed, cards] = await Promise.all([
    contributorNames(
      [
        ...speakerIds,
        ...episodes.items.flatMap((episode) => episode.speakerIds),
        ...related.flatMap((other) =>
          other.speakers.slice(0, 3).map((speaker) => speaker.id),
        ),
      ],
      locale,
    ),
    topicNames(
      entry.topics.map((topic) => topic.id),
      locale,
    ),
    contributorCards(speakerIds, locale),
  ]);
  const people = caseless(peopleNames);
  const topics = caseless(topicNamed);
  const portraits = caseless(cards);

  const label = mediaLabel(record, locale);
  const direction = directionOf(label.locale);
  const section = sectionOf(kind);
  const path = groupPath(locale, { kind, slug: record.slug });
  const crumbs = [
    { name: trail.home.text, path: trail.home.href },
    { name: trail.watch.text, path: trail.watch.href },
    { name: t(`sections.${section}`), path: localizedPath(locale, groupsPathOf(kind)) },
    { name: label.title, path },
  ];
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const span = yearSpan(entry.firstOn, entry.lastOn);
  const spanned = spanText(locale, t, entry);
  const time = runningTime(t, entry.seconds);
  const pages = pageCount(episodes.total, MEDIA_GROUP_EPISODES_PAGE);
  const range = pageRange(page, episodes.items.length, MEDIA_GROUP_EPISODES_PAGE);
  const listId = 'group-videos';
  const heading = kind === 'playlist' ? t('playlistVideos') : t('episodes');
  const description = paragraphsOf(label.description);

  // WHERE TO BEGIN: a series from its first episode, then its latest; a
  // programme from its latest, then its first; a playlist from its start.
  const latestOther = latest !== null && latest.id !== first?.id ? latest : null;
  const actions = [
    ...(first === null
      ? []
      : [
          {
            key: 'first',
            href: videoPath(locale, first.slug),
            // The first PUBLISHED episode's own number: never "episode 1"
            // while that one is unpublished.
            text:
              kind === 'playlist'
                ? t('groups.playlist.start')
                : t(`groups.${kind}.start`, { number: first.number }),
          },
        ]),
    ...(latestOther === null
      ? []
      : [
          {
            key: 'latest',
            href: videoPath(locale, latestOther.slug),
            text: t('groups.latest'),
          },
        ]),
  ];
  const ordered = kind === 'program' ? [...actions].reverse() : actions;

  const hasCover = entry.cover !== null;

  return (
    <Container>
      <article className="flex min-w-0 flex-col gap-[var(--space-section)] py-[var(--space-page)]">
        <header
          className={`grid min-w-0 gap-x-12 gap-y-8 border-b border-border pb-10 ${hasCover ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,26rem)] lg:items-center' : ''}`}
        >
          <div className="flex min-w-0 flex-col gap-5">
            <Breadcrumbs
              label={trail.label}
              trail={[
                ...crumbs
                  .slice(0, -1)
                  .map((crumb) => ({ href: crumb.path, text: crumb.name })),
                { text: label.title },
              ]}
            />
            <div className="flex min-w-0 flex-col gap-3">
              <p className="flex flex-wrap items-center gap-2">
                <Badge>{t(`kind.${kind}`)}</Badge>
                {entry.languages.length === 1 && entry.languages[0] !== undefined
                  ? (() => {
                      const badge = contentLanguageBadge(entry.languages[0].id, locale);
                      return badge === undefined ? null : <LanguageBadge {...badge} />;
                    })()
                  : null}
              </p>
              <h1
                className="text-display font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere"
                lang={label.locale}
                dir={direction}
              >
                {label.title}
              </h1>
              {description.length === 0 ? null : (
                <div className="text-lede flex max-w-[var(--measure-prose)] flex-col gap-3 text-foreground-muted">
                  {description.map((paragraph, index) => (
                    <p key={index} lang={label.locale} dir={direction}>
                      {paragraph}
                    </p>
                  ))}
                </div>
              )}
            </div>
            {entry.videos === 0 ? null : (
              <div className="flex flex-wrap gap-x-10 gap-y-4">
                <Stat
                  value={number(entry.videos)}
                  label={t(`groups.${kind}.statVideos`, { count: entry.videos })}
                  href={`#${listId}`}
                />
                {time === null ? null : (
                  <Stat value={time} label={t('groups.statRunning')} />
                )}
                {span === null || spanned === null ? null : (
                  <Stat
                    value={spanned}
                    label={t('groups.statSpan', { count: span.to - span.from + 1 })}
                  />
                )}
                {entry.languages.length < 2 ? null : (
                  <Stat
                    value={number(entry.languages.length)}
                    label={hub('common.statLanguages', { count: entry.languages.length })}
                  />
                )}
              </div>
            )}
            {ordered.length === 0 ? null : (
              <div className="flex flex-wrap gap-3">
                {ordered.map((action, index) => (
                  <ActionLink
                    key={action.key}
                    href={action.href}
                    tone={index === 0 ? 'primary' : 'secondary'}
                  >
                    <span className="inline-flex items-center gap-2">
                      {index === 0 ? <Icon name="play" size={16} /> : null}
                      {action.text}
                    </span>
                  </ActionLink>
                ))}
              </div>
            )}
          </div>
          {entry.cover === null ? null : (
            <div className="relative hidden pt-3 lg:block">
              <span
                aria-hidden="true"
                className="absolute inset-x-8 top-0 h-12 rounded-panel border border-accent-rule bg-accent-surface"
              />
              <span
                aria-hidden="true"
                className="absolute inset-x-4 top-1.5 h-12 rounded-panel border border-border bg-surface-sunken"
              />
              <ResponsiveImage
                path={videoPosterPath(entry.cover.videoId, entry.cover.poster.assetId)}
                alt=""
                aspect="16/9"
                fit="cover"
                radius="panel"
                priority
                width={entry.cover.poster.width}
                height={entry.cover.poster.height}
                sizes="26rem"
                className="relative shadow-raised"
              />
            </div>
          )}
        </header>

        <div className="grid min-w-0 gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section aria-labelledby={listId} className="flex min-w-0 flex-col gap-4">
            <SectionHeader
              id={listId}
              heading={heading}
              intro={t(`groups.${kind}.episodesIntro`)}
            />
            {range === null ? null : (
              <RangeSummary>
                {t(`groups.${kind}.range`, {
                  from: number(range.from),
                  to: number(range.to),
                  total: episodes.total,
                })}
              </RangeSummary>
            )}
            {episodes.items.length === 0 ? (
              page > 1 && episodes.total > 0 ? (
                <EmptyState
                  title={hub('common.pastEndTitle')}
                  action={{ href: path, text: hub('common.firstPage') }}
                >
                  {t('groups.pastEnd', { page })}
                </EmptyState>
              ) : (
                <EmptyState
                  icon="video"
                  action={{ href: watchVideosHref(locale), text: t('allVideos') }}
                >
                  {kind === 'playlist' ? t('playlistEmpty') : t('episodesEmpty')}
                </EmptyState>
              )
            ) : (
              <ol
                aria-label={heading}
                className="flex list-none flex-col divide-y divide-border border-y border-border p-0"
              >
                {episodes.items.map((episode) => (
                  <EpisodeRow
                    key={episode.id}
                    locale={locale}
                    episode={episode}
                    kind={kind}
                    people={people}
                    t={t}
                  />
                ))}
              </ol>
            )}
            {episodes.items.length === 0 ? null : (
              <Pager
                label={t(`groups.${kind}.pages`)}
                previous={page > 1 ? groupPageHref(path, page - 1) : null}
                next={episodes.hasMore ? groupPageHref(path, page + 1) : null}
                previousLabel={t('previous')}
                nextLabel={t('next')}
                pages={{
                  current: page,
                  total: pages,
                  href: (target) => groupPageHref(path, target),
                  label: (target) => hub('common.pageLabel', { page: target }),
                  format: number,
                }}
              />
            )}
          </section>

          <aside className="flex min-w-0 flex-col gap-8">
            {entry.speakers.length === 0 ? null : (
              <section aria-labelledby="group-speakers" className="flex flex-col gap-3">
                <h2 id="group-speakers" className="text-subheading font-semibold">
                  {t('speakers')}
                </h2>
                <SpeakerList
                  locale={locale}
                  speakers={entry.speakers.map((speaker) => ({
                    id: speaker.id,
                    count: t(`groups.${kind}.count`, { count: speaker.videos }),
                  }))}
                  people={people}
                  portraits={portraits}
                />
              </section>
            )}

            {entry.topics.length === 0 ? null : (
              <section aria-labelledby="group-topics" className="flex flex-col gap-3">
                <h2 id="group-topics" className="text-subheading font-semibold">
                  {t('topics')}
                </h2>
                <TopicChips
                  label={t('topics')}
                  topics={entry.topics.flatMap((topic) => {
                    const named = topics.get(topic.id.toLowerCase());
                    return named === undefined
                      ? []
                      : [
                          {
                            href: localizedPath(
                              locale,
                              `/topics/${encodeURIComponent(named.slug)}`,
                            ),
                            text: named.name,
                          },
                        ];
                  })}
                />
              </section>
            )}

            {entry.languages.length < 2 ? null : (
              <section aria-labelledby="group-languages" className="flex flex-col gap-3">
                <h2 id="group-languages" className="text-subheading font-semibold">
                  {t('groups.languagesHeading')}
                </h2>
                <ul className="flex list-none flex-col p-0 text-sm">
                  {entry.languages.map((value) => (
                    <li
                      key={value.id}
                      className="flex min-h-11 items-center justify-between gap-3 border-b border-border"
                    >
                      <span>{languageName(value.id, locale)}</span>
                      <span className="text-foreground-muted tabular-nums">
                        {t(`groups.${kind}.count`, { count: value.videos })}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p className="flex items-start gap-2 text-sm text-foreground-muted">
              <Icon name="info" size={16} className="mt-[0.2em] shrink-0 text-accent" />
              <span>{t(`groups.${kind}.notice`)}</span>
            </p>
          </aside>
        </div>

        {related.length === 0 ? null : (
          <section
            aria-labelledby="group-related"
            className="flex min-w-0 flex-col gap-6"
          >
            <SectionHeader
              id="group-related"
              heading={t(`groups.${kind}.related`)}
              intro={t('groups.relatedIntro')}
              action={{
                href: localizedPath(locale, groupsPathOf(kind)),
                text: t(`groups.${kind}.all`),
              }}
            />
            <ul aria-label={t(`groups.${kind}.related`)} className={GROUP_GRID}>
              {related.map((other) => (
                <GroupCard
                  key={other.id}
                  locale={locale}
                  entry={other}
                  people={people}
                  t={t}
                  headingLevel="h3"
                />
              ))}
            </ul>
          </section>
        )}

        <BreadcrumbData contentLocales={mediaLocales(record)} trail={crumbs} />
      </article>
    </Container>
  );
}

/** The metadata a grouping's page needs, from its record. */
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
