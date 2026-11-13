import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import {
  formatDuration,
  type QuranVideo,
  type QuranVideoLength,
} from '@minhaj/contracts/media';
import type { PublicSurah, QuranAvailability } from '@minhaj/contracts/quran';

import { mediaReadRuntime } from '@/composition/media-read';
import { referenceNames } from '@/composition/public-references';
import { contentLanguageBadge } from '@/components/content-language';
import { Duration, formatDate } from '@/components/media/parts';
import { mediaLabel, videoPath, videoPosterPath } from '@/components/media/presentation';
import {
  Badge,
  EmptyState,
  Field,
  Icon,
  LanguageBadge,
  LinkTabs,
  MetaRow,
  Pager,
  ResponsiveImage,
  SectionHeader,
  Select,
} from '@/components/ui';
import { Shelf } from '@/components/ui/shelf';
import { directionOf } from '@/config/locale';
import { surahChips } from './books-view';
import {
  ActiveFilters,
  ExploreFilters,
  ExploreHero,
  PassageChips,
  languageName,
} from './explore';
import { QuranFrame, quranTrail } from './parts';
import { quranPath, surahName } from './presentation';
import { readQuranTopic, readSurahs } from './read';
import { lectureHref, passageCitation } from './tafsir-layout';
import {
  VIDEOS_PATH,
  passageStart,
  videosFiltered,
  videosHref,
  videosPageCount,
  videosRange,
  videosReadQuery,
  wholeHours,
  type VideosQuery,
} from './videos-view';

/**
 * THE QURAN VIDEOS HUB (Quran Part 11) — `/quran/videos`.
 *
 * LAYER-4 COMPOSITION OF MEDIA'S OWN PUBLIC READS (DOMAIN_MODEL.md §3.1,
 * §11): the videos are Media Videos — those on Taxonomy's `quran` Topic
 * together with those that explain a Quran passage — read through Media's
 * public `quranVideos` and `quranVideoFacets`; the speakers' names are
 * People's, the Surah names Quran's public reader's. Quran imports nothing of
 * Media; only this presentation layer composes them.
 *
 * ONE ADDRESS PER VIEW (`./videos-view`): a shelf (all, explains a Surah, the
 * rest), a Surah, a content language, a speaker, a Series, a length, an order
 * and a page, each a GET parameter, so the hub works without script and every
 * view can be shared. Nothing is stated that Media did not answer: a filter
 * with no choice is not offered, a figure of zero is not shown, a video with
 * no poster is a drawn tile, and a lecture opens at a passage only where its
 * editor recorded where the passage begins.
 *
 * NO THIRD-PARTY REQUEST TO PAINT A CARD — as on every Watch page, a poster is
 * Media's own stored copy, and the provider is contacted only from a video's
 * own page, after the visitor asks.
 */

type QuranTranslator = Awaited<ReturnType<typeof getTranslations<'quran'>>>;
type WatchTranslator = Awaited<ReturnType<typeof getTranslations<'watch'>>>;
type Names = Awaited<ReturnType<typeof referenceNames>>;

/** How many featured videos the hub opens with, at most. */
const FEATURED = 3;
/** How many lectures the opening "explains a Surah" shelf carries. */
const SHELF = 10;

const LIST_ID = 'quran-videos-list';
const FEATURED_ID = 'quran-videos-featured';
const SURAHS_ID = 'quran-videos-surahs';
const SHELF_ID = 'quran-videos-explaining';

/** "Surah 18 · Al-Kahf" for a select's option, which cannot carry markup. */
function surahOption(
  number: number,
  surah: PublicSurah | undefined,
  locale: Locale,
  t: QuranTranslator,
): string {
  const name = surah === undefined ? null : surahName(surah, locale);
  return name === null
    ? t('surahName', { number })
    : t('videosHub.surahOption', { number, name: name.text });
}

/** The speakers of a video, as one plain line of People's names. */
function speakerLine(video: QuranVideo, names: Names): string {
  return video.speakerIds
    .flatMap((id) => {
      const person = names.people.get(id);
      return person === undefined ? [] : [person.name];
    })
    .join(' · ');
}

/**
 * ONE VIDEO: its poster (or a drawn tile) with the running time on its corner,
 * the title in its own language, who speaks, when, and its Series — as one
 * link stretched over that part of the card — and BELOW it, outside the
 * stretched link, where the lecture begins a passage ("Watch from 18:1–10")
 * and the Surahs it explains, each its own link to that Surah's tafsir. Two
 * kinds of target that never overlap.
 */
function VideoCard({
  locale,
  video,
  names,
  surahs,
  surah,
  t,
  tw,
  wide = false,
  priority = false,
  sizes = '(min-width: 64rem) 22rem, (min-width: 40rem) 45vw, 100vw',
}: {
  readonly locale: Locale;
  readonly video: QuranVideo;
  readonly names: Names;
  readonly surahs: ReadonlyMap<number, PublicSurah>;
  /** The Surah the view is narrowed to: the passage the lecture opens at is in it. */
  readonly surah: number | null;
  readonly t: QuranTranslator;
  readonly tw: WatchTranslator;
  /** The featured layout: the description under the title. */
  readonly wide?: boolean;
  readonly priority?: boolean;
  readonly sizes?: string;
}) {
  const label = mediaLabel(video, locale);
  const content = { lang: label.locale, dir: directionOf(label.locale) };
  const language = contentLanguageBadge(video.languageCode, locale);
  const speakers = speakerLine(video, names);
  const href = videoPath(locale, video.slug);
  const start = passageStart(video.passages, surah);
  const { chips, more } = surahChips(video.passages);
  const kind =
    video.availability === 'unavailable'
      ? tw('unavailable')
      : video.format === null
        ? null
        : tw(`format.${video.format}`);
  const series =
    video.series === null
      ? null
      : { ...mediaLabel(video.series, locale), at: video.series };

  return (
    <li className="card-surface flex min-w-0 flex-col gap-3 rounded-panel">
      <div className="group relative flex min-w-0 flex-col gap-3">
        <span className="relative block">
          {video.poster === null ? (
            <span
              aria-hidden="true"
              className="flex aspect-video w-full items-center justify-center rounded-panel border border-accent-rule bg-accent-surface"
            >
              <Icon name="video" size={24} className="text-accent" />
            </span>
          ) : (
            <ResponsiveImage
              path={videoPosterPath(video.id, video.poster.assetId)}
              alt=""
              aspect="16/9"
              fit="cover"
              radius="panel"
              width={video.poster.width}
              height={video.poster.height}
              sizes={sizes}
              priority={priority}
              className="transition-[filter] duration-[var(--duration-medium)] ease-[var(--ease-standard)] group-hover:brightness-95"
            />
          )}
          {kind === null ? null : (
            <span className="absolute start-2 top-2">
              <Badge tone="neutral">{kind}</Badge>
            </span>
          )}
          {video.durationSeconds === null ? null : (
            <span className="absolute end-2 bottom-2 rounded-control bg-ink/85 px-1.5 py-0.5 text-caption font-semibold text-ink-foreground tabular-nums">
              <span className="sr-only">{t('videosHub.duration')}: </span>
              <Duration seconds={video.durationSeconds} />
            </span>
          )}
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          {language === undefined ? null : (
            <span className="flex">
              <LanguageBadge {...language} />
            </span>
          )}
          <h3
            className="text-subheading font-semibold text-balance wrap-anywhere"
            {...content}
          >
            <a
              href={href}
              className="card-link text-foreground no-underline decoration-accent-rule decoration-1 underline-offset-4 group-hover:underline active:text-action"
            >
              {label.title}
            </a>
          </h3>
          {wide && label.description !== '' ? (
            <p
              className="line-clamp-2 text-sm wrap-anywhere text-foreground-muted"
              {...content}
            >
              {label.description}
            </p>
          ) : null}
          <MetaRow
            items={[
              speakers === '' ? null : (
                <span dir="auto">
                  <span className="sr-only">{tw('speakers')}: </span>
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
          {series === null ? null : (
            <p className="text-caption wrap-anywhere text-foreground-muted">
              {t('videosHub.episode', { number: series.at.position })}
              {' · '}
              <span lang={series.locale} dir={directionOf(series.locale)}>
                {series.title}
              </span>
            </p>
          )}
        </div>
      </div>
      {start === null || start.startSeconds === null ? null : (
        <p className="flex">
          <a
            href={lectureHref(href, start)}
            className="inline-flex min-h-11 items-center gap-1.5 rounded-control text-sm font-semibold text-action underline-offset-4 hover:underline"
          >
            <Icon name="play" size={16} className="shrink-0" />
            <span>
              {t.rich('videosHub.watchFrom', {
                citation: passageCitation(start),
                time: formatDuration(start.startSeconds),
                place: (chunks) => (
                  <bdi dir="ltr" className="tabular-nums">
                    {chunks}
                  </bdi>
                ),
              })}
            </span>
          </a>
        </p>
      )}
      <PassageChips
        locale={locale}
        label={t('videosHub.explains')}
        chips={chips}
        more={more}
        moreText={t('videosHub.moreSurahs', { count: more })}
        surahs={surahs}
      />
    </li>
  );
}

/** The length bands, as the filter and its chip name them. */
function lengthText(length: QuranVideoLength, t: QuranTranslator): string {
  return t(`videosHub.length.${length}`);
}

export async function QuranVideosPage({
  locale,
  availability,
  query,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly query: VideosQuery;
}) {
  const [t, tw] = await Promise.all([
    getTranslations({ locale, namespace: 'quran' }),
    getTranslations({ locale, namespace: 'watch' }),
  ]);
  const parts = await quranTrail(locale);
  const topic = await readQuranTopic(locale);
  const media = mediaReadRuntime();
  const read = videosReadQuery(query, topic?.id ?? null, locale);
  const filtered = videosFiltered(query);
  const opening = !filtered && query.page === 1;
  const [page, facets, featured, explaining, surahList] = await Promise.all([
    media.quranVideos(read),
    media.quranVideoFacets(read),
    opening
      ? media.quranVideos({ ...read, featured: true, limit: FEATURED })
      : Promise.resolve(null),
    opening
      ? media.quranVideos({ ...read, shelf: 'explains', sort: 'newest', limit: SHELF })
      : Promise.resolve(null),
    readSurahs(),
  ]);
  const surahs = new Map(surahList.map((surah) => [surah.number, surah]));
  const featuredItems = featured?.items ?? [];
  const general = facets.shelves.all - facets.shelves.explaining;
  // The opening shelf only says something the grid does not when the hub
  // holds both kinds of video.
  const shelfItems =
    facets.shelves.explaining > 0 && general > 0 ? (explaining?.items ?? []) : [];
  const names = await referenceNames(
    {
      personIds: [
        ...[...page.items, ...featuredItems, ...shelfItems].flatMap(
          (video) => video.speakerIds,
        ),
        ...facets.speakers.items.map((facet) => facet.id),
        ...(query.speaker === null ? [] : [query.speaker]),
      ],
      topicIds: [],
    },
    locale,
  );

  const title = t('sections.videos');
  const hub = facets.hub;
  const hours = wholeHours(hub.seconds);
  const base = videosHref(locale, query, {
    shelf: 'all',
    surah: null,
    language: null,
    speaker: null,
    series: null,
    length: null,
  });
  const pages = videosPageCount(page.total);
  const range = videosRange(query.page, page.items.length);

  const languageOptions = facets.languages.items;
  const speakerOptions = facets.speakers.items.flatMap((facet) => {
    const person = names.people.get(facet.id);
    return person === undefined
      ? []
      : [{ id: facet.id, name: person.name, videos: facet.videos }];
  });
  const seriesOptions = facets.series.items.map((entry) => ({
    id: entry.id,
    label: mediaLabel(entry, locale),
    videos: entry.videos,
  }));
  const surahOptions = query.shelf === 'general' ? [] : facets.surahs;
  const showLanguage = languageOptions.length > 1 || query.language !== null;
  const showSpeaker = speakerOptions.length > 0 || query.speaker !== null;
  const showSeries = seriesOptions.length > 0 || query.series !== null;
  const showLength = facets.lengths.length > 1 || query.length !== null;
  const showQuranOrder = hub.explaining > 0 && query.shelf !== 'general';
  const speakerName =
    query.speaker === null ? null : (names.people.get(query.speaker)?.name ?? null);
  const seriesLabel =
    query.series === null
      ? null
      : (seriesOptions.find((entry) => entry.id === query.series)?.label ?? null);

  const active = [
    ...(query.surah === null
      ? []
      : [
          {
            key: 'surah',
            text: surahOption(query.surah, surahs.get(query.surah), locale, t),
            removeText: surahOption(query.surah, surahs.get(query.surah), locale, t),
            removeHref: videosHref(locale, query, { surah: null }),
          },
        ]),
    ...(query.language === null
      ? []
      : [
          {
            key: 'language',
            text: languageName(query.language, locale),
            removeText: languageName(query.language, locale),
            removeHref: videosHref(locale, query, { language: null }),
          },
        ]),
    ...(query.speaker === null
      ? []
      : [
          {
            key: 'speaker',
            text: speakerName ?? t('videosHub.unknownSpeaker'),
            removeText: speakerName ?? t('videosHub.unknownSpeaker'),
            removeHref: videosHref(locale, query, { speaker: null }),
          },
        ]),
    ...(query.series === null
      ? []
      : [
          {
            key: 'series',
            text:
              seriesLabel === null ? (
                t('videosHub.unknownSeries')
              ) : (
                <span lang={seriesLabel.locale} dir={directionOf(seriesLabel.locale)}>
                  {seriesLabel.title}
                </span>
              ),
            removeText: seriesLabel?.title ?? t('videosHub.unknownSeries'),
            removeHref: videosHref(locale, query, { series: null }),
          },
        ]),
    ...(query.length === null
      ? []
      : [
          {
            key: 'length',
            text: lengthText(query.length, t),
            removeText: lengthText(query.length, t),
            removeHref: videosHref(locale, query, { length: null }),
          },
        ]),
  ].map(({ removeText, ...filter }) => ({
    ...filter,
    removeLabel: t('videosHub.remove', { name: removeText }),
  }));

  const card = (
    video: QuranVideo,
    extra: { wide?: boolean; priority?: boolean } = {},
  ) => (
    <VideoCard
      key={video.id}
      locale={locale}
      video={video}
      names={names}
      surahs={surahs}
      surah={query.surah}
      t={t}
      tw={tw}
      {...extra}
    />
  );

  return (
    <QuranFrame
      locale={locale}
      availability={availability}
      trail={[parts.home, parts.quran, { text: title }]}
    >
      <ExploreHero
        eyebrow={t('videosHub.eyebrow')}
        title={title}
        lede={t('videosHub.lede')}
        stats={[
          ...(hub.videos === 0
            ? []
            : [
                {
                  value: hub.videos,
                  label: t('videosHub.statVideos', { count: hub.videos }),
                  href: `#${LIST_ID}`,
                },
              ]),
          ...(hub.explaining === 0
            ? []
            : [
                {
                  value: hub.explaining,
                  label: t('videosHub.statExplaining', { count: hub.explaining }),
                  href: videosHref(locale, query, {
                    shelf: 'explains',
                    surah: null,
                    language: null,
                    speaker: null,
                    series: null,
                    length: null,
                  }),
                },
              ]),
          ...(hub.surahs === 0
            ? []
            : [
                {
                  value: hub.surahs,
                  label: t('videosHub.statSurahs', { count: hub.surahs }),
                  href: `#${SURAHS_ID}`,
                },
              ]),
          ...(hours === 0
            ? []
            : [{ value: hours, label: t('videosHub.statHours', { count: hours }) }]),
          ...(hub.languages < 2
            ? []
            : [
                {
                  value: hub.languages,
                  label: t('videosHub.statLanguages', { count: hub.languages }),
                },
              ]),
        ]}
        actions={[
          { href: quranPath(locale, 'tafsir'), text: t('videosHub.tafsirLink') },
          { href: quranPath(locale, 'surah'), text: t('videosHub.readLink') },
        ]}
      />

      {hub.videos === 0 ? (
        <EmptyState
          icon="video"
          title={t('videosHub.emptyTitle')}
          action={{
            href: localizedPath(locale, '/watch/videos'),
            text: t('videosHub.watchLink'),
          }}
        >
          {t('videosHub.empty')}
        </EmptyState>
      ) : (
        <>
          {featuredItems.length === 0 ? null : (
            <section aria-labelledby={FEATURED_ID} className="flex flex-col gap-4">
              <SectionHeader
                id={FEATURED_ID}
                heading={t('videosHub.featuredHeading')}
                intro={t('videosHub.featuredHelp')}
              />
              <ul className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
                {featuredItems.map((video, index) =>
                  card(video, { wide: true, priority: index === 0 }),
                )}
              </ul>
            </section>
          )}

          {opening && facets.surahs.length > 0 ? (
            <section aria-labelledby={SURAHS_ID} className="flex flex-col gap-4">
              <SectionHeader
                id={SURAHS_ID}
                heading={t('videosHub.surahsHeading')}
                intro={t('videosHub.surahsHelp')}
                action={{
                  href: quranPath(locale, 'tafsir'),
                  text: t('videosHub.tafsirLink'),
                }}
              />
              <ul aria-labelledby={SURAHS_ID} className="flex flex-wrap gap-2">
                {facets.surahs.map((row) => {
                  const surah = surahs.get(row.surah);
                  const name = surah === undefined ? null : surahName(surah, locale);
                  return (
                    <li key={row.surah} className="max-w-full min-w-0">
                      <a
                        href={videosHref(locale, query, { surah: row.surah })}
                        className="inline-flex min-h-11 max-w-full flex-wrap items-center gap-x-2 rounded-full border border-border-strong bg-surface-raised px-4 py-1 text-sm font-medium text-foreground no-underline hover:border-accent"
                      >
                        <span className="font-semibold text-accent tabular-nums">
                          {new Intl.NumberFormat(locale).format(row.surah)}
                        </span>
                        {name === null ? null : (
                          <span
                            lang={name.locale}
                            className={`wrap-anywhere ${name.locale === 'ar' ? 'quran-name' : ''}`}
                          >
                            {name.text}
                          </span>
                        )}
                        <span className="text-caption text-foreground-muted">
                          {t('videosHub.surahCount', { count: row.owners })}
                        </span>
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {opening && shelfItems.length > 0 ? (
            <section aria-labelledby={SHELF_ID} className="flex min-w-0 flex-col gap-5">
              <Shelf
                label={t('videosHub.shelf.explains')}
                previousLabel={t('previous')}
                nextLabel={t('next')}
                size="poster"
                header={
                  <SectionHeader
                    id={SHELF_ID}
                    heading={t('videosHub.shelf.explains')}
                    intro={t('videosHub.shelfHelp.explains')}
                    action={{
                      href: videosHref(locale, query, { shelf: 'explains' }),
                      text: t('videosHub.seeAll', { count: facets.shelves.explaining }),
                    }}
                  />
                }
              >
                {shelfItems.map((video) => card(video))}
              </Shelf>
            </section>
          ) : null}

          <section aria-labelledby={LIST_ID} className="flex flex-col gap-5">
            <SectionHeader
              id={LIST_ID}
              heading={t('videosHub.listHeading')}
              intro={t(`videosHub.shelfHelp.${query.shelf}`)}
            />

            {facets.shelves.explaining > 0 && general > 0 ? (
              <LinkTabs
                label={t('videosHub.shelves')}
                tabs={(['all', 'explains', 'general'] as const).map((shelf) => ({
                  href: videosHref(locale, query, { shelf }),
                  text: t(`videosHub.shelf.${shelf}`),
                  current: query.shelf === shelf,
                  count: String(
                    shelf === 'all'
                      ? facets.shelves.all
                      : shelf === 'explains'
                        ? facets.shelves.explaining
                        : general,
                  ),
                }))}
              />
            ) : null}

            <ExploreFilters
              action={localizedPath(locale, VIDEOS_PATH)}
              label={t('videosHub.filters')}
              hidden={
                query.shelf === 'all' ? [] : [{ name: 'shelf', value: query.shelf }]
              }
              submit={t('videosHub.apply')}
              reset={filtered ? { href: base, text: t('videosHub.reset') } : null}
            >
              {surahOptions.length === 0 ? null : (
                <Field id="videos-surah" label={t('videosHub.filterSurah')}>
                  {(props) => (
                    <Select
                      {...props}
                      name="surah"
                      defaultValue={query.surah === null ? '' : String(query.surah)}
                    >
                      <option value="">{t('videosHub.anySurah')}</option>
                      {surahOptions.map((row) => (
                        <option key={row.surah} value={String(row.surah)}>
                          {t('videosHub.option', {
                            name: surahOption(
                              row.surah,
                              surahs.get(row.surah),
                              locale,
                              t,
                            ),
                            count: row.owners,
                          })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              {showLanguage ? (
                <Field id="videos-language" label={t('videosHub.filterLanguage')}>
                  {(props) => (
                    <Select
                      {...props}
                      name="language"
                      defaultValue={query.language ?? ''}
                    >
                      <option value="">{t('videosHub.anyLanguage')}</option>
                      {languageOptions.map((facet) => (
                        <option key={facet.id} value={facet.id}>
                          {t('videosHub.option', {
                            name: languageName(facet.id, locale),
                            count: facet.videos,
                          })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              {showSpeaker ? (
                <Field id="videos-speaker" label={t('videosHub.filterSpeaker')}>
                  {(props) => (
                    <Select {...props} name="speaker" defaultValue={query.speaker ?? ''}>
                      <option value="">{t('videosHub.anySpeaker')}</option>
                      {speakerOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {t('videosHub.option', {
                            name: option.name,
                            count: option.videos,
                          })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              {showSeries ? (
                <Field id="videos-series" label={t('videosHub.filterSeries')}>
                  {(props) => (
                    <Select {...props} name="series" defaultValue={query.series ?? ''}>
                      <option value="">{t('videosHub.anySeries')}</option>
                      {seriesOptions.map((option) => (
                        <option
                          key={option.id}
                          value={option.id}
                          lang={option.label.locale}
                        >
                          {t('videosHub.option', {
                            name: option.label.title,
                            count: option.videos,
                          })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              {showLength ? (
                <Field id="videos-length" label={t('videosHub.filterLength')}>
                  {(props) => (
                    <Select {...props} name="length" defaultValue={query.length ?? ''}>
                      <option value="">{t('videosHub.anyLength')}</option>
                      {facets.lengths.map((row) => (
                        <option key={row.length} value={row.length}>
                          {t('videosHub.option', {
                            name: lengthText(row.length, t),
                            count: row.videos,
                          })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              <Field id="videos-sort" label={t('videosHub.filterSort')}>
                {(props) => (
                  <Select {...props} name="sort" defaultValue={query.sort}>
                    <option value="newest">{t('videosHub.sort.newest')}</option>
                    {showQuranOrder ? (
                      <option value="quran">{t('videosHub.sort.quran')}</option>
                    ) : null}
                    <option value="title">{t('videosHub.sort.title')}</option>
                  </Select>
                )}
              </Field>
            </ExploreFilters>

            <ActiveFilters label={t('videosHub.active')} filters={active} />

            {range === null ? null : (
              <p className="text-sm text-foreground-muted">
                {t('videosHub.summary', {
                  from: range.from,
                  to: range.to,
                  total: page.total,
                })}
              </p>
            )}

            {page.items.length === 0 ? (
              query.page > 1 && page.total > 0 ? (
                <EmptyState
                  title={t('videosHub.pastEndTitle')}
                  action={{
                    href: videosHref(locale, query, { page: 1 }),
                    text: t('videosHub.firstPage'),
                  }}
                >
                  {t('videosHub.pastEnd', { page: query.page })}
                </EmptyState>
              ) : (
                <EmptyState
                  title={t('videosHub.noResultsTitle')}
                  action={{ href: base, text: t('videosHub.reset') }}
                >
                  {t('videosHub.noResults')}
                </EmptyState>
              )
            ) : (
              <ul
                aria-label={title}
                className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3"
              >
                {page.items.map((video) => card(video))}
              </ul>
            )}

            {page.items.length === 0 ? null : (
              <Pager
                label={t('videosHub.pages')}
                previous={
                  query.page > 1
                    ? videosHref(locale, query, { page: query.page - 1 })
                    : null
                }
                next={
                  page.hasMore
                    ? videosHref(locale, query, { page: query.page + 1 })
                    : null
                }
                previousLabel={t('previous')}
                nextLabel={t('next')}
                pages={{
                  current: query.page,
                  total: pages,
                  href: (number) => videosHref(locale, query, { page: number }),
                  label: (number) => t('videosHub.pageLabel', { page: number }),
                  format: (number) => new Intl.NumberFormat(locale).format(number),
                }}
              />
            )}
          </section>
        </>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
          {t('videosHub.about')}
        </p>
        <p className="text-sm">
          <a
            href={
              topic === null
                ? localizedPath(locale, '/watch/videos')
                : localizedPath(
                    locale,
                    `/watch/videos?topic=${encodeURIComponent(topic.id)}`,
                  )
            }
            className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
          >
            {t('videosHub.watchLink')}
            <Icon name="arrow-end" size={16} />
          </a>
        </p>
      </div>
    </QuranFrame>
  );
}
