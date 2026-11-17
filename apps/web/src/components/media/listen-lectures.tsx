import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import {
  AUDIO_LISTING_PAGE,
  type AudioListingTrack,
  type AudioTrackListing,
  type AudioTrackRecord,
  type TopicVideoLength,
} from '@minhaj/contracts/media';

import { audioPlayable } from '@/composition/media-assets';
import { mediaReadRuntime } from '@/composition/media-read';
import { contentLanguages, referenceNames } from '@/composition/public-references';
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
  Alert,
  Badge,
  Breadcrumbs,
  Container,
  DetailRow,
  EmptyState,
  Field,
  Icon,
  LanguageBadge,
  MetaRow,
  Pager,
  Prose,
  SectionHeader,
  Select,
  TextLink,
  TopicChips,
} from '@/components/ui';
import { absoluteUrl } from '@/config/origin';
import { directionOf } from '@/config/locale';
import { AudioPlayer } from './audio-player';
import { AudioCards, AudioTile, listenTrail, type ListenTranslator } from './listen';
import {
  lecturesFiltered,
  lecturesHref,
  lecturesReadQuery,
  listenLecturesHref,
  type LecturesView,
} from './listen-view';
import { BreadcrumbData, Duration, formatDate } from './parts';
import {
  audioSeriesPath,
  audioTrackPath,
  mediaLabel,
  mediaLocales,
} from './presentation';
import { ShareVideo } from './share';

/**
 * WATCH PART 3 — THE AUDIO LECTURES LISTING AND ONE RECORDING'S PAGE
 * (ROUTE_MAP.md §3.7): `/listen/lectures` and `/listen/lectures/{slug}`.
 *
 * THE LISTING IS THE TOPIC HUBS' LISTING PATTERN OVER EVERY PUBLISHED
 * RECORDING: the figures of the whole of Listen, a GET form of counted filters
 * (Topic, language, speaker, audio series, length — each option counted under
 * every other filter), two orders, chips that each remove one filter, a range,
 * numbered pages, and one address per view (`./listen-view`). The parts are the
 * hubs' shared ones (`ExploreHero`, `ExploreFilters`, `CountedSelect`,
 * `ActiveFilters`, `Pager`), not a second copy.
 *
 * A RECORDING'S PAGE plays its own file from this origin with the browser's
 * native player — nothing loads before the press, nothing plays by itself and
 * no copy is offered to keep (SECURITY_BASELINE.md §16.2) — then says what it
 * is, where it stands in its series (the previous and next PUBLISHED
 * recording), what it is about, and what else to hear: more with its speaker,
 * on its Topic or — only when neither has more — in its language. No "listen
 * from" moments: the model records none for audio.
 */

type HubTranslator = Awaited<ReturnType<typeof getTranslations<'topicHub'>>>;

/** The length bands, as the filter and its chip name them. */
function lengthText(t: HubTranslator, length: TopicVideoLength): string {
  return t(`videos.length.${length}`);
}

/* ===========================================================================
 * /listen/lectures
 * ========================================================================= */

export async function LecturesPage({
  locale,
  view,
}: {
  readonly locale: Locale;
  readonly view: LecturesView;
}) {
  const [t, hub, tw, trail] = await Promise.all([
    getTranslations({ locale, namespace: 'listen' }),
    getTranslations({ locale, namespace: 'topicHub' }),
    getTranslations({ locale, namespace: 'watch' }),
    listenTrail(locale),
  ]);
  const reads = mediaReadRuntime();
  const read = lecturesReadQuery(view, locale);
  const [page, facets] = await Promise.all([
    reads.audioListing(read),
    reads.audioListingFacets(read),
  ]);
  const names = await referenceNames(
    {
      personIds: [
        ...facets.speakers.items.map((facet) => facet.id),
        ...(view.speaker === null ? [] : [view.speaker]),
      ],
      topicIds: [
        ...facets.topics.items.map((facet) => facet.id),
        ...(view.topic === null ? [] : [view.topic]),
      ],
    },
    locale,
  );
  // An address carries an identifier in lower case, while an owner returns it
  // as stored: options and chips compare without case.
  const people = caseless(names.people);
  const topics = caseless(names.topics);

  const title = t('sections.lectures');
  const listId = 'listen-lectures-list';
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const href = (change: Partial<LecturesView>) => lecturesHref(locale, view, change);
  const filtered = lecturesFiltered(view);
  // Clearing the filters keeps the order: it is not a narrowing.
  const base = listenLecturesHref(locale, { sort: view.sort });
  const pages = pageCount(page.total, AUDIO_LISTING_PAGE);
  const range = pageRange(view.page, page.items.length, AUDIO_LISTING_PAGE);
  const all = facets.all;
  const hours = Math.floor(all.seconds / 3600);
  const option = (name: string, count: number) => hub('common.option', { name, count });

  const topicOptions = facets.topics.items.flatMap((facet) => {
    const topic = topics.get(facet.id.toLowerCase());
    return topic === undefined
      ? []
      : [{ value: facet.id.toLowerCase(), name: topic.name, count: facet.tracks }];
  });
  const speakerOptions = facets.speakers.items.flatMap((facet) => {
    const person = people.get(facet.id.toLowerCase());
    return person === undefined
      ? []
      : [{ value: facet.id.toLowerCase(), name: person.name, count: facet.tracks }];
  });
  const seriesOptions = facets.series.items.map((entry) => {
    const label = mediaLabel(entry, locale);
    return {
      value: entry.id.toLowerCase(),
      name: label.title,
      count: entry.tracks,
      lang: label.locale,
    };
  });
  const topicName =
    view.topic === null ? null : (topics.get(view.topic.toLowerCase())?.name ?? null);
  const topicSlug =
    view.topic === null ? null : (topics.get(view.topic.toLowerCase())?.slug ?? null);
  const speakerName =
    view.speaker === null ? null : (people.get(view.speaker.toLowerCase())?.name ?? null);
  const seriesChosen =
    view.series === null
      ? null
      : (seriesOptions.find((entry) => entry.value === view.series?.toLowerCase()) ??
        null);

  const chip = (key: string, text: string, removeHref: string, lang?: Locale) => ({
    key,
    text:
      lang === undefined ? (
        text
      ) : (
        <span lang={lang} dir={directionOf(lang)}>
          {text}
        </span>
      ),
    removeHref,
    removeLabel: hub('common.remove', { name: text }),
  });
  const active = [
    ...(view.topic === null
      ? []
      : [chip('topic', topicName ?? tw('unknownTopic'), href({ topic: null }))]),
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
    ...(view.series === null
      ? []
      : [
          seriesChosen === null
            ? chip('series', t('lectures.unknownSeries'), href({ series: null }))
            : chip(
                'series',
                seriesChosen.name,
                href({ series: null }),
                seriesChosen.lang,
              ),
        ]),
    ...(view.length === null
      ? []
      : [chip('length', lengthText(hub, view.length), href({ length: null }))]),
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
          lede={t('sectionBody.lectures')}
          notice={t('lectures.notice')}
          stats={[
            ...(all.tracks === 0
              ? []
              : [
                  {
                    value: number(all.tracks),
                    label: t('stats.recordings', { count: all.tracks }),
                    href: `#${listId}`,
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
          ]}
          actions={[
            { href: localizedPath(locale, '/listen/series'), text: t('sections.series') },
            { href: localizedPath(locale, '/watch/videos'), text: t('lectures.videos') },
          ]}
        />

        {all.tracks === 0 ? (
          <EmptyState
            icon="audio"
            title={t('landing.emptyTitle')}
            action={{ href: trail.listen.href, text: t('lectures.listenLink') }}
          >
            {t('empty')}
          </EmptyState>
        ) : (
          <section aria-labelledby={listId} className="flex flex-col gap-5">
            <SectionHeader
              id={listId}
              heading={t('lectures.listHeading')}
              intro={t('lectures.listIntro')}
            />

            <ExploreFilters
              action={localizedPath(locale, '/listen/lectures')}
              label={t('lectures.filters')}
              hidden={[]}
              submit={t('lectures.apply')}
              reset={filtered ? { href: base, text: hub('common.reset') } : null}
            >
              {topicOptions.length > 0 || view.topic !== null ? (
                <CountedSelect
                  id="lectures-topic"
                  label={tw('filterTopic')}
                  name="topic"
                  value={view.topic ?? ''}
                  any={tw('anyTopic')}
                  options={topicOptions}
                  optionText={option}
                />
              ) : null}
              {facets.languages.items.length > 1 || view.language !== null ? (
                <CountedSelect
                  id="lectures-language"
                  label={hub('common.filterLanguage')}
                  name="language"
                  value={view.language ?? ''}
                  any={hub('common.anyLanguage')}
                  options={facets.languages.items.map((facet) => ({
                    value: facet.id,
                    name: languageName(facet.id, locale),
                    count: facet.tracks,
                  }))}
                  optionText={option}
                />
              ) : null}
              {speakerOptions.length > 0 || view.speaker !== null ? (
                <CountedSelect
                  id="lectures-speaker"
                  label={hub('videos.filterSpeaker')}
                  name="speaker"
                  value={view.speaker ?? ''}
                  any={hub('videos.anySpeaker')}
                  options={speakerOptions}
                  optionText={option}
                />
              ) : null}
              {seriesOptions.length > 0 || view.series !== null ? (
                <CountedSelect
                  id="lectures-series"
                  label={t('lectures.filterSeries')}
                  name="series"
                  value={view.series ?? ''}
                  any={t('lectures.anySeries')}
                  options={seriesOptions}
                  optionText={option}
                />
              ) : null}
              {facets.lengths.length > 1 || view.length !== null ? (
                <CountedSelect
                  id="lectures-length"
                  label={hub('videos.filterLength')}
                  name="length"
                  value={view.length ?? ''}
                  any={hub('videos.anyLength')}
                  options={facets.lengths.map((row) => ({
                    value: row.length,
                    name: lengthText(hub, row.length),
                    count: row.tracks,
                  }))}
                  optionText={option}
                />
              ) : null}
              <Field id="lectures-sort" label={hub('common.filterSort')}>
                {(props) => (
                  <Select {...props} name="sort" defaultValue={view.sort}>
                    <option value="newest">{t('lectures.sort.newest')}</option>
                    <option value="title">{hub('common.sort.title')}</option>
                  </Select>
                )}
              </Field>
            </ExploreFilters>

            <ActiveFilters label={hub('common.active')} filters={active} />

            {topicSlug === null ? null : (
              <p className="text-sm">
                <a
                  href={localizedPath(locale, `/topics/${encodeURIComponent(topicSlug)}`)}
                  className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
                >
                  {tw('topicHub')}
                  <Icon name="arrow-end" size={16} />
                </a>
              </p>
            )}

            {range === null ? null : (
              <RangeSummary>
                {t('lectures.summary', {
                  from: number(range.from),
                  to: number(range.to),
                  total: page.total,
                })}
              </RangeSummary>
            )}

            {page.items.length === 0 ? (
              view.page > 1 && page.total > 0 ? (
                <EmptyState
                  title={hub('common.pastEndTitle')}
                  action={{ href: href({ page: 1 }), text: hub('common.firstPage') }}
                >
                  {t('lectures.pastEnd', { page: view.page })}
                </EmptyState>
              ) : (
                <EmptyState
                  title={t('lectures.noResultsTitle')}
                  action={{ href: base, text: hub('common.reset') }}
                >
                  {t('emptyFiltered')}
                </EmptyState>
              )
            ) : (
              <AudioCards locale={locale} tracks={page.items} label={title} />
            )}

            {page.items.length === 0 ? null : (
              <Pager
                label={t('lectures.pages')}
                previous={view.page > 1 ? href({ page: view.page - 1 }) : null}
                next={page.hasMore ? href({ page: view.page + 1 }) : null}
                previousLabel={t('previous')}
                nextLabel={t('next')}
                pages={{
                  current: view.page,
                  total: pages,
                  href: (target) => href({ page: target }),
                  label: (target) => hub('common.pageLabel', { page: target }),
                  format: number,
                }}
              />
            )}
          </section>
        )}

        {/* Ways onward the header does not already offer. */}
        <ClosingNote
          text={t('lectures.about')}
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
 * /listen/lectures/{slug}
 * ========================================================================= */

/** How many recordings each related shelf of a recording's page shows. */
const RELATED_PREVIEW = 3;
/** How many a related read asks for, so that what is excluded still leaves a shelf. */
const RELATED_ASK = 12;

/** One "more like this" shelf: what relates it, and the way to all of them. */
interface RelatedShelf {
  readonly key: 'speaker' | 'topic' | 'language';
  readonly heading: string;
  readonly more: { readonly href: string; readonly text: string };
  readonly tracks: readonly AudioListingTrack[];
}

/**
 * WHAT ELSE TO HEAR — composed from Media's own public listing, so "related"
 * is a fact the records state, never a guess: more with its first speaker,
 * more on its first Topic, and only when neither has anything else, more in
 * its content language. Never itself, never one already offered beside it,
 * never one recording twice.
 */
async function relatedTracks(
  locale: Locale,
  record: AudioTrackRecord,
  exclude: ReadonlySet<string>,
  /** The first speaker and Topic their owners name, or null. */
  first: {
    readonly speaker: { readonly id: string; readonly name: string } | null;
    readonly topic: { readonly id: string; readonly name: string } | null;
  },
  t: ListenTranslator,
): Promise<readonly RelatedShelf[]> {
  const reads = mediaReadRuntime();
  const ask = (filter: Record<string, string>) =>
    reads.audioListing({ titleLocale: locale, limit: RELATED_ASK, ...filter });
  const speaker = first.speaker?.id;
  const topic = first.topic?.id;
  const [bySpeaker, byTopic] = await Promise.all([
    speaker === undefined ? null : ask({ speaker }),
    topic === undefined ? null : ask({ topic }),
  ]);
  const seen = new Set([record.id.toLowerCase(), ...exclude]);
  const shelves: RelatedShelf[] = [];
  const add = (
    key: RelatedShelf['key'],
    page: { readonly items: readonly AudioListingTrack[]; readonly total: number } | null,
    heading: string,
    href: string,
  ) => {
    if (page === null) return;
    const tracks = page.items
      .filter((track) => !seen.has(track.id.toLowerCase()))
      .slice(0, RELATED_PREVIEW);
    for (const track of tracks) seen.add(track.id.toLowerCase());
    if (tracks.length > 0)
      shelves.push({
        key,
        heading,
        more: { href, text: t('track.relatedAll', { count: page.total }) },
        tracks,
      });
  };
  if (speaker !== undefined && first.speaker !== null)
    add(
      'speaker',
      bySpeaker,
      t('track.relatedSpeaker', { name: first.speaker.name }),
      listenLecturesHref(locale, { speaker }),
    );
  if (topic !== undefined && first.topic !== null)
    add(
      'topic',
      byTopic,
      t('track.relatedTopic', { name: first.topic.name }),
      listenLecturesHref(locale, { topic }),
    );
  if (shelves.length === 0)
    add(
      'language',
      await ask({ language: record.languageCode }),
      t('track.relatedLanguage', { name: languageName(record.languageCode, locale) }),
      listenLecturesHref(locale, { language: record.languageCode }),
    );
  return shelves;
}

/** A previous or next recording in its series, with its direction named first. */
function TrackStep({
  locale,
  track,
  direction,
  t,
}: {
  readonly locale: Locale;
  readonly track: AudioTrackListing;
  readonly direction: 'previous' | 'next';
  readonly t: ListenTranslator;
}) {
  const label = mediaLabel(track, locale);
  return (
    <a
      href={audioTrackPath(locale, track.slug)}
      className={`group flex min-h-11 min-w-0 flex-col gap-1 rounded-control border border-border bg-surface p-3 no-underline hover:border-action ${direction === 'next' ? 'sm:col-start-2 sm:items-end sm:text-end' : ''}`}
    >
      <span className="inline-flex items-center gap-1.5 text-caption font-semibold text-action">
        {direction === 'previous' ? <Icon name="arrow-start" size={16} /> : null}
        {t(direction === 'previous' ? 'track.previous' : 'track.next')}
        {track.seriesPosition === null ? null : (
          <span className="font-normal text-foreground-muted">
            {' · '}
            {t('fact.position', { number: track.seriesPosition })}
          </span>
        )}
        {direction === 'next' ? <Icon name="arrow-end" size={16} /> : null}
      </span>
      <span
        className="font-medium wrap-anywhere text-foreground group-hover:underline"
        lang={label.locale}
        dir={directionOf(label.locale)}
      >
        {label.title}
      </span>
    </a>
  );
}

/**
 * One recording's page: what it is (its series place, title, language, length,
 * date and speakers, and Share), then the player — or, when the file cannot be
 * served now, an honest statement — then its series with the previous and next
 * recording, what it is about and its transcript where the organisation holds
 * one; beside them its facts and Topics; below, what else to hear. Usable
 * signed out; nothing about the visit is recorded.
 */
export async function TrackPage({
  locale,
  record,
}: {
  readonly locale: Locale;
  readonly record: AudioTrackRecord;
}) {
  const [t, tw, parts] = await Promise.all([
    getTranslations({ locale, namespace: 'listen' }),
    getTranslations({ locale, namespace: 'watch' }),
    listenTrail(locale),
  ]);
  const reads = mediaReadRuntime();
  const [references, languages, neighbours, playable] = await Promise.all([
    referenceNames({ personIds: record.speakerIds, topicIds: record.topicIds }, locale),
    contentLanguages(),
    record.series === null
      ? Promise.resolve(null)
      : reads.audioSeriesNeighbours({
          series: record.series.id,
          position: record.series.position,
        }),
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
  const badge = contentLanguageBadge(record.languageCode, locale);
  const people = caseless(references.people);
  const topicNames = caseless(references.topics);
  const speakers = record.speakerIds.flatMap((id) => {
    const person = people.get(id.toLowerCase());
    return person === undefined ? [] : [{ id, ...person }];
  });
  const topics = record.topicIds.flatMap((id) => {
    const topic = topicNames.get(id.toLowerCase());
    return topic === undefined ? [] : [{ id, ...topic }];
  });
  const seriesLabel = record.series === null ? null : mediaLabel(record.series, locale);
  const previous = neighbours?.previous ?? null;
  const next = neighbours?.next ?? null;
  const related = await relatedTracks(
    locale,
    record,
    new Set(
      [previous, next].flatMap((track) =>
        track === null ? [] : [track.id.toLowerCase()],
      ),
    ),
    { speaker: speakers[0] ?? null, topic: topics[0] ?? null },
    t,
  );
  const lectures = t('sections.lectures');
  const trail = [
    { name: parts.home.text, path: parts.home.href },
    { name: parts.listen.text, path: parts.listen.href },
    { name: lectures, path: localizedPath(locale, '/listen/lectures') },
    { name: label.title, path: audioTrackPath(locale, record.slug) },
  ];
  // A description written in the reader's language describes a recording that
  // may be in another; it is said so only when the two differ.
  const describedInOtherLanguage =
    label.description !== '' &&
    (record.languageCode.split('-')[0] ?? '').toLowerCase() !== label.locale;
  const hasStory = label.description !== '' || record.transcript !== null;

  return (
    <Container>
      <article className="flex min-w-0 flex-col gap-10 py-[var(--space-page)]">
        <header className="flex min-w-0 flex-col gap-4 border-b border-border pb-8">
          <Breadcrumbs
            label={parts.label}
            trail={[
              ...trail
                .slice(0, -1)
                .map((entry) => ({ href: entry.path, text: entry.name })),
              { text: label.title },
            ]}
          />
          <p className="flex flex-wrap items-center gap-2">
            <Badge>{t('track.kind')}</Badge>
            {badge === undefined ? null : <LanguageBadge {...badge} />}
            {record.series === null ? null : (
              <span className="text-caption font-semibold tracking-[var(--tracking-eyebrow)] text-accent uppercase">
                {t('fact.position', { number: record.series.position })}
              </span>
            )}
          </p>
          <h1
            className="text-display font-semibold tracking-[var(--tracking-display)] text-balance wrap-anywhere"
            lang={label.locale}
            dir={direction}
          >
            {label.title}
          </h1>
          <MetaRow
            items={[
              record.durationSeconds === null ? null : (
                <span>
                  <span className="sr-only">{t('fact.duration')}: </span>
                  <Duration seconds={record.durationSeconds} />
                </span>
              ),
              record.recordedOn === null ? null : (
                <time dateTime={record.recordedOn}>
                  {formatDate(record.recordedOn, locale)}
                </time>
              ),
            ]}
          />
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
            url={absoluteUrl(audioTrackPath(locale, record.slug))}
            title={label.title}
            labels={{
              share: tw('share.action'),
              copied: tw('share.copied'),
              failed: tw('share.failed'),
            }}
          />
        </header>

        <div className="grid min-w-0 gap-x-12 gap-y-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex min-w-0 flex-col gap-10">
            <section
              aria-labelledby="audio-player"
              className="rounded-panel border border-accent-rule bg-accent-surface p-5 shadow-panel sm:p-6"
            >
              <div className="flex flex-col gap-4">
                <div className="flex items-center gap-4">
                  <AudioTile />
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

            {record.series === null || seriesLabel === null ? null : (
              <section
                aria-labelledby="audio-series"
                className="flex flex-col gap-4 rounded-panel border border-border bg-surface-raised p-4 sm:p-5"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-sm text-foreground-muted">{t('fact.partOf')}</p>
                  <h2
                    id="audio-series"
                    className="text-subheading font-semibold wrap-anywhere"
                  >
                    <TextLink href={audioSeriesPath(locale, record.series.slug)}>
                      <span
                        lang={seriesLabel.locale}
                        dir={directionOf(seriesLabel.locale)}
                      >
                        {seriesLabel.title}
                      </span>
                    </TextLink>
                  </h2>
                  <p className="text-sm font-medium">
                    {neighbours === null || neighbours.tracks < 2
                      ? t('fact.position', { number: record.series.position })
                      : t('track.partOf', {
                          number: record.series.position,
                          total: neighbours.tracks,
                        })}
                  </p>
                </div>
                {previous === null && next === null ? null : (
                  <nav
                    aria-label={t('track.seriesNav')}
                    className="grid gap-3 sm:grid-cols-2"
                  >
                    {previous === null ? null : (
                      <TrackStep
                        locale={locale}
                        track={previous}
                        direction="previous"
                        t={t}
                      />
                    )}
                    {next === null ? null : (
                      <TrackStep locale={locale} track={next} direction="next" t={t} />
                    )}
                  </nav>
                )}
                <p className="text-sm">
                  <TextLink href={audioSeriesPath(locale, record.series.slug)}>
                    {t('allInSeries')}
                  </TextLink>
                </p>
              </section>
            )}

            {hasStory ? (
              <>
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
                      {describedInOtherLanguage ? (
                        <p className="text-caption border-s-2 border-accent-rule ps-3 text-foreground-muted">
                          {t('metadataNotice')}
                        </p>
                      ) : null}
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
              </>
            ) : null}
          </div>

          <aside className="flex min-w-0 flex-col gap-8">
            <section className="flex flex-col gap-2" aria-labelledby="audio-facts">
              <h2 id="audio-facts" className="text-subheading font-semibold">
                {t('facts')}
              </h2>
              <dl className="grid divide-y divide-border">
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
                    href: localizedPath(
                      locale,
                      `/topics/${encodeURIComponent(topic.slug)}`,
                    ),
                    text: topic.name,
                  }))}
                />
              </section>
            )}
          </aside>
        </div>

        {related.map((shelf) => (
          <section
            key={shelf.key}
            className="flex flex-col gap-6"
            aria-labelledby={`audio-related-${shelf.key}`}
          >
            <SectionHeader
              id={`audio-related-${shelf.key}`}
              heading={shelf.heading}
              action={shelf.more}
            />
            <AudioCards locale={locale} tracks={shelf.tracks} label={shelf.heading} />
          </section>
        ))}

        <BreadcrumbData contentLocales={mediaLocales(record)} trail={trail} />
      </article>
    </Container>
  );
}
