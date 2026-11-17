import 'server-only';

import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import {
  AUDIO_SERIES_FACETS_MAX,
  MEDIA_PAGE,
  type AudioSeriesEntry,
  type AudioSeriesRecord,
  type AudioTrackListing,
} from '@minhaj/contracts/media';

import { mediaReadRuntime } from '@/composition/media-read';
import {
  contributorCards,
  contributorNames,
  topicNames,
} from '@/composition/public-references';
import { contentLanguageBadge } from '@/components/content-language';
import { ClosingNote, RangeSummary } from '@/components/library/browse-parts';
import { paragraphsOf } from '@/components/library/scholarly-presentation';
import { caseless, pageCount, pageRange } from '@/components/topic-hub/address';
import {
  ActiveFilters,
  CountedSelect,
  ExploreFilters,
  ExploreHero,
  languageName,
} from '@/components/topic-hub/parts';
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
  SectionHeader,
  Select,
  Stat,
  TextInput,
  TopicChips,
} from '@/components/ui';
import { directionOf } from '@/config/locale';
import { runningTime, SpeakerList, spanText } from './groups';
import {
  DEFAULT_GROUPS_VIEW,
  GROUPS_PAGE,
  groupFacets,
  groupMatches,
  groupPageHref,
  groupSortParam,
  groupsFiltered,
  groupsHref,
  relatedGroups,
  sortGroups,
  yearSpan,
  type GroupRow,
  type GroupsView,
} from './groups-view';
import {
  AudioSeriesCard,
  AudioTile,
  LISTEN_GRID,
  listenTrail,
  speakerLine,
  type ListenTranslator,
} from './listen';
import { BreadcrumbData, Duration, formatDate } from './parts';
import {
  audioSeriesPath,
  audioTrackPath,
  mediaLabel,
  mediaLocales,
} from './presentation';

/**
 * WATCH PART 3 — THE AUDIO SERIES (ROUTE_MAP.md §3.7; DOMAIN_MODEL.md §11):
 * `/listen/series` and `/listen/series/{slug}`, on Watch Part 2's grouping
 * design.
 *
 * AN AUDIO SERIES IS AN ORDERED RUN OF RECORDINGS, numbered by its editor, a
 * track in at most one — so its page opens on "Start from part n" (its first
 * PUBLISHED recording's own number) and then its latest recording. Everything
 * shown of a series — its figures, languages, speakers, Topics — is what its
 * PUBLISHED tracks say (Media's `audioSeriesDirectory`, `audioSeriesSummary`);
 * nothing is stored twice.
 *
 * ONE SET OF RULES WITH WATCH'S GROUPINGS. The directory's title search,
 * language, speaker and Topic filters (each option counted under the others),
 * its three orders, related series and one address per view are
 * `./groups-view`'s, for the directory kind `audio` — not a second copy. Who
 * speaks is Watch Part 2's speaker list. People name the speakers and Taxonomy
 * the Topics, a whole directory at once in bounded batches.
 */

/** How many related series a series' page offers. */
const RELATED = 3;

/* ===========================================================================
 * /listen/series
 * ========================================================================= */

export async function AudioSeriesDirectoryPage({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: GroupsView;
}) {
  const [t, tw, hub, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'listen' }),
    getTranslations({ locale, namespace: 'watch' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    listenTrail(locale),
  ]);
  const directory = await mediaReadRuntime().audioSeriesDirectory();
  const collator = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
  const rows: GroupRow<AudioSeriesEntry>[] = directory.items.map((entry) => ({
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

  const title = t('sections.series');
  const listId = 'listen-series-list';
  const href = (change: Partial<GroupsView>) =>
    groupsHref('audio', locale, view, { page: 1, ...change });
  const base = groupsHref('audio', locale, { ...DEFAULT_GROUPS_VIEW, sort: view.sort });
  const filtered = groupsFiltered(view);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const option = (name: string, count: number) => hub('common.option', { name, count });

  // The figures of the whole directory — never of a filtered view — each
  // stated only when it is true: a track is in at most one series, so their
  // sum is a count; a distinct count only while no series reached the read's
  // per-series bound.
  const tracks = rows.reduce((sum, row) => sum + row.entry.tracks, 0);
  const seconds = rows.reduce((sum, row) => sum + row.entry.seconds, 0);
  const distinct = (
    of: (entry: AudioSeriesEntry) => readonly { readonly id: string }[],
  ) =>
    rows.some((row) => of(row.entry).length >= AUDIO_SERIES_FACETS_MAX)
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
      : [{ value: facet.id, name: person.name, count: facet.videos }];
  });
  const topicOptions = facets.topics.flatMap((facet) => {
    const topic = topics.get(facet.id);
    return topic === undefined
      ? []
      : [{ value: facet.id, name: topic.name, count: facet.videos }];
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
      : [chip('q', tw('groups.chipTitle', { q: view.q }), href({ q: null }))]),
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
      : [chip('topic', topicName ?? tw('unknownTopic'), href({ topic: null }))]),
  ];

  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
        <Breadcrumbs
          label={trail.label}
          trail={[trail.home, trail.listen, { text: title }]}
        />
        <ExploreHero
          eyebrow={trail.listen.text}
          title={title}
          lede={t('sectionBody.series')}
          notice={t('series.notice')}
          stats={[
            ...(rows.length === 0
              ? []
              : [
                  {
                    value: number(rows.length),
                    label: t('series.stat', { count: rows.length }),
                    href: `#${listId}`,
                  },
                ]),
            ...(tracks === 0
              ? []
              : [
                  {
                    value: number(tracks),
                    label: t('stats.recordings', { count: tracks }),
                  },
                ]),
            ...(hours === 0
              ? []
              : [{ value: number(hours), label: t('stats.hours', { count: hours }) }]),
            ...(languages < 2
              ? []
              : [
                  {
                    value: number(languages),
                    label: t('stats.languages', { count: languages }),
                  },
                ]),
            ...(speakers === 0
              ? []
              : [
                  {
                    value: number(speakers),
                    label: t('stats.speakers', { count: speakers }),
                  },
                ]),
          ]}
          actions={[
            {
              href: localizedPath(locale, '/listen/lectures'),
              text: t('sections.lectures'),
            },
            {
              href: localizedPath(locale, '/watch/series'),
              text: t('series.videoSeries'),
            },
          ]}
        />

        {rows.length === 0 ? (
          <EmptyState
            icon="audio"
            title={t('series.emptyTitle')}
            action={{ href: trail.listen.href, text: t('lectures.listenLink') }}
          >
            {t('seriesListEmpty')}
          </EmptyState>
        ) : (
          <section aria-labelledby={listId} className="flex flex-col gap-5">
            <SectionHeader
              id={listId}
              heading={t('series.listHeading')}
              intro={t('series.listIntro')}
            />

            <ExploreFilters
              action={localizedPath(locale, '/listen/series')}
              label={t('series.filters')}
              hidden={[]}
              submit={tw('groups.apply')}
              reset={filtered ? { href: base, text: hub('common.reset') } : null}
            >
              <Field
                id="series-q"
                label={tw('groups.search')}
                help={tw('groups.searchHelp')}
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
                <CountedSelect
                  id="series-language"
                  label={hub('common.filterLanguage')}
                  name="language"
                  value={view.language ?? ''}
                  any={hub('common.anyLanguage')}
                  options={facets.languages.map((facet) => ({
                    value: facet.id,
                    name: languageName(facet.id, locale),
                    count: facet.videos,
                  }))}
                  optionText={option}
                />
              ) : null}
              {speakerOptions.length > 0 || view.speaker !== null ? (
                <CountedSelect
                  id="series-speaker"
                  label={hub('videos.filterSpeaker')}
                  name="speaker"
                  value={view.speaker ?? ''}
                  any={hub('videos.anySpeaker')}
                  options={speakerOptions}
                  optionText={option}
                />
              ) : null}
              {topicOptions.length > 0 || view.topic !== null ? (
                <CountedSelect
                  id="series-topic"
                  label={tw('filterTopic')}
                  name="topic"
                  value={view.topic ?? ''}
                  any={tw('anyTopic')}
                  options={topicOptions}
                  optionText={option}
                />
              ) : null}
              <Field id="series-sort" label={hub('common.filterSort')}>
                {(props) => (
                  <Select
                    {...props}
                    name="sort"
                    defaultValue={groupSortParam('audio', view.sort)}
                  >
                    <option value="newest">{tw('groups.sort.newest')}</option>
                    <option value="title">{tw('groups.sort.title')}</option>
                    <option value={groupSortParam('audio', 'videos')}>
                      {t('series.sortMost')}
                    </option>
                  </Select>
                )}
              </Field>
            </ExploreFilters>

            <ActiveFilters label={hub('common.active')} filters={active} />

            {range === null ? null : (
              <RangeSummary>
                {t('series.summary', {
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
                  {tw('groups.pastEnd', { page: view.page })}
                </EmptyState>
              ) : (
                <EmptyState
                  title={tw('groups.noResultsTitle')}
                  action={{ href: base, text: hub('common.reset') }}
                >
                  {t('series.noResults')}
                </EmptyState>
              )
            ) : (
              <ul aria-label={title} className={LISTEN_GRID}>
                {slice.map((row) => (
                  <AudioSeriesCard
                    key={row.entry.id}
                    locale={locale}
                    entry={row.entry}
                    people={people}
                    t={t}
                    tw={tw}
                  />
                ))}
              </ul>
            )}

            {slice.length === 0 ? null : (
              <Pager
                label={t('series.pages')}
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
                {t('series.truncated', { count: directory.items.length })}
              </p>
            ) : null}
          </section>
        )}

        <ClosingNote
          text={t('series.about')}
          links={[
            { href: localizedPath(locale, '/topics'), text: t('sections.topics') },
            { href: localizedPath(locale, '/watch'), text: t('sections.watch') },
          ]}
        />
      </div>
    </Container>
  );
}

/* ===========================================================================
 * /listen/series/{slug}
 * ========================================================================= */

/**
 * ONE RECORDING OF A SERIES, in its place: its number, its title in its own
 * language (one link stretched over the row), its length, recording date,
 * content language and speakers.
 */
function TrackRow({
  locale,
  track,
  people,
  t,
}: {
  readonly locale: Locale;
  readonly track: AudioTrackListing;
  readonly people: ReadonlyMap<string, { readonly slug: string; readonly name: string }>;
  readonly t: ListenTranslator;
}) {
  const label = mediaLabel(track, locale);
  const language = contentLanguageBadge(track.languageCode, locale);
  const speakers = speakerLine(track.speakerIds, people);
  return (
    <li className="card-surface group relative grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-start gap-x-4 gap-y-2 py-5">
      <span
        aria-hidden="true"
        className="flex size-10 items-center justify-center rounded-full border border-accent-rule bg-accent-surface font-serif text-subheading font-semibold text-accent tabular-nums"
      >
        {track.seriesPosition === null
          ? null
          : new Intl.NumberFormat(locale).format(track.seriesPosition)}
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        {language === undefined ? null : (
          <span className="flex">
            <LanguageBadge {...language} />
          </span>
        )}
        <h3
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
        </h3>
        <MetaRow
          items={[
            track.seriesPosition === null
              ? null
              : t('fact.position', { number: track.seriesPosition }),
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
            speakers === '' ? null : (
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

/**
 * One published AudioSeries: what it is (title, description, figures), where
 * to begin, its published recordings in order, 24 a page, who speaks in it,
 * its Topics and languages, and the series that share a speaker or a Topic
 * with it.
 */
export async function AudioSeriesPage({
  locale,
  record,
  page,
}: {
  readonly locale: Locale;
  readonly record: AudioSeriesRecord;
  /** 1-based, from `?page`. */
  readonly page: number;
}) {
  const reads = mediaReadRuntime();
  const [t, tw, hub, trail, summary, tracks, directory] = await Promise.all([
    getTranslations({ locale, namespace: 'listen' }),
    getTranslations({ locale, namespace: 'watch' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    listenTrail(locale),
    reads.audioSeriesSummary(record.id),
    reads.audioSeriesTracks(record.id, (page - 1) * MEDIA_PAGE),
    reads.audioSeriesDirectory(),
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
        ...tracks.items.flatMap((track) => track.speakerIds),
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
  const path = audioSeriesPath(locale, record.slug);
  const section = t('sections.series');
  const crumbs = [
    { name: trail.home.text, path: trail.home.href },
    { name: trail.listen.text, path: trail.listen.href },
    { name: section, path: localizedPath(locale, '/listen/series') },
    { name: label.title, path },
  ];
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const span = yearSpan(entry.firstOn, entry.lastOn);
  const spanned = spanText(locale, tw, entry);
  const time = runningTime(tw, entry.seconds);
  const pages = pageCount(entry.tracks, MEDIA_PAGE);
  const range = pageRange(page, tracks.items.length, MEDIA_PAGE);
  const listId = 'series-tracks';
  const description = paragraphsOf(label.description);
  const badge =
    entry.languages.length === 1 && entry.languages[0] !== undefined
      ? contentLanguageBadge(entry.languages[0].id, locale)
      : undefined;

  // WHERE TO BEGIN: the first published recording (its own number, so never
  // "part 1" while that one is unpublished), then the latest when it differs.
  const actions = [
    ...(first === null
      ? []
      : [
          {
            key: 'first',
            href: audioTrackPath(locale, first.slug),
            text:
              first.seriesPosition === null
                ? t('series.startFirst')
                : t('series.start', { number: first.seriesPosition }),
          },
        ]),
    ...(latest === null || latest.id === first?.id
      ? []
      : [
          {
            key: 'latest',
            href: audioTrackPath(locale, latest.slug),
            text: t('series.latest'),
          },
        ]),
  ];

  return (
    <Container>
      <article className="flex min-w-0 flex-col gap-[var(--space-section)] py-[var(--space-page)]">
        <header className="flex min-w-0 flex-col gap-5 border-b border-border pb-10">
          <Breadcrumbs
            label={trail.label}
            trail={[
              ...crumbs
                .slice(0, -1)
                .map((crumb) => ({ href: crumb.path, text: crumb.name })),
              { text: label.title },
            ]}
          />
          <div className="flex min-w-0 items-start gap-5">
            <span className="hidden sm:block">
              <AudioTile />
            </span>
            <div className="flex min-w-0 flex-col gap-3">
              <p className="flex flex-wrap items-center gap-2">
                <Badge>{t('series.kind')}</Badge>
                {badge === undefined ? null : <LanguageBadge {...badge} />}
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
          </div>
          {entry.tracks === 0 ? null : (
            <div className="flex flex-wrap gap-x-10 gap-y-4">
              <Stat
                value={number(entry.tracks)}
                label={t('stats.recordings', { count: entry.tracks })}
                href={`#${listId}`}
              />
              {time === null ? null : (
                <Stat value={time} label={tw('groups.statRunning')} />
              )}
              {span === null || spanned === null ? null : (
                <Stat
                  value={spanned}
                  label={t('series.statSpan', { count: span.to - span.from + 1 })}
                />
              )}
              {entry.languages.length < 2 ? null : (
                <Stat
                  value={number(entry.languages.length)}
                  label={t('stats.languages', { count: entry.languages.length })}
                />
              )}
            </div>
          )}
          {actions.length === 0 ? null : (
            <div className="flex flex-wrap gap-3">
              {actions.map((action, index) => (
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
        </header>

        <div className="grid min-w-0 gap-x-12 gap-y-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section aria-labelledby={listId} className="flex min-w-0 flex-col gap-4">
            <SectionHeader
              id={listId}
              heading={t('seriesTracks')}
              intro={t('series.tracksIntro')}
            />
            {range === null ? null : (
              <RangeSummary>
                {t('series.range', {
                  from: number(range.from),
                  to: number(range.to),
                  total: entry.tracks,
                })}
              </RangeSummary>
            )}
            {tracks.items.length === 0 ? (
              page > 1 && entry.tracks > 0 ? (
                <EmptyState
                  title={hub('common.pastEndTitle')}
                  action={{ href: path, text: hub('common.firstPage') }}
                >
                  {tw('groups.pastEnd', { page })}
                </EmptyState>
              ) : (
                <EmptyState
                  icon="audio"
                  action={{
                    href: localizedPath(locale, '/listen/lectures'),
                    text: t('allTracks'),
                  }}
                >
                  {t('seriesEmpty')}
                </EmptyState>
              )
            ) : (
              <ol
                aria-label={t('seriesTracks')}
                className="flex list-none flex-col divide-y divide-border border-y border-border p-0"
              >
                {tracks.items.map((track) => (
                  <TrackRow
                    key={track.id}
                    locale={locale}
                    track={track}
                    people={people}
                    t={t}
                  />
                ))}
              </ol>
            )}
            {tracks.items.length === 0 ? null : (
              <Pager
                label={t('series.trackPages')}
                previous={page > 1 ? groupPageHref(path, page - 1) : null}
                next={tracks.hasMore ? groupPageHref(path, page + 1) : null}
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
              <section aria-labelledby="series-speakers" className="flex flex-col gap-3">
                <h2 id="series-speakers" className="text-subheading font-semibold">
                  {t('speakers')}
                </h2>
                <SpeakerList
                  locale={locale}
                  speakers={entry.speakers.map((speaker) => ({
                    id: speaker.id,
                    count: t('seriesCount', { count: speaker.tracks }),
                  }))}
                  people={people}
                  portraits={portraits}
                />
              </section>
            )}

            {entry.topics.length === 0 ? null : (
              <section aria-labelledby="series-topics" className="flex flex-col gap-3">
                <h2 id="series-topics" className="text-subheading font-semibold">
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
              <section aria-labelledby="series-languages" className="flex flex-col gap-3">
                <h2 id="series-languages" className="text-subheading font-semibold">
                  {tw('groups.languagesHeading')}
                </h2>
                <ul className="flex list-none flex-col p-0 text-sm">
                  {entry.languages.map((value) => (
                    <li
                      key={value.id}
                      className="flex min-h-11 items-center justify-between gap-3 border-b border-border"
                    >
                      <span>{languageName(value.id, locale)}</span>
                      <span className="text-foreground-muted tabular-nums">
                        {t('seriesCount', { count: value.tracks })}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <p className="flex items-start gap-2 text-sm text-foreground-muted">
              <Icon name="info" size={16} className="mt-[0.2em] shrink-0 text-accent" />
              <span>{t('series.notice')}</span>
            </p>
          </aside>
        </div>

        {related.length === 0 ? null : (
          <section
            aria-labelledby="series-related"
            className="flex min-w-0 flex-col gap-6"
          >
            <SectionHeader
              id="series-related"
              heading={t('series.related')}
              intro={t('series.relatedIntro')}
              action={{
                href: localizedPath(locale, '/listen/series'),
                text: t('allSeries'),
              }}
            />
            <ul aria-label={t('series.related')} className={LISTEN_GRID}>
              {related.map((other) => (
                <AudioSeriesCard
                  key={other.id}
                  locale={locale}
                  entry={other}
                  people={people}
                  t={t}
                  tw={tw}
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
