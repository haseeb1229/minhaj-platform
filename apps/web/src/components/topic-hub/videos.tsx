import 'server-only';

import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';
import type {
  TopicVideo,
  TopicVideoLength,
  TopicVideosShelf,
} from '@minhaj/contracts/media';
import type { PassageSurahCount } from '@minhaj/contracts/passage';

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
import type { HubDomain, HubLink } from './domain';
import { ActiveFilters, ExploreFilters, ExploreHero, languageName } from './parts';
import {
  videosFiltered,
  videosHref,
  videosPageCount,
  videosRange,
  videosReadQuery,
  wholeHours,
  type VideosQuery,
  type VideosScope,
} from './videos-view';

/**
 * A SUBJECT'S VIDEOS HUB (Quran Part 11; shared with Hadith since Hadith Part
 * 1) — `/quran/videos`, `/hadith/videos`.
 *
 * LAYER-4 COMPOSITION OF MEDIA'S OWN PUBLIC READS (DOMAIN_MODEL.md §3.1,
 * §11): the videos are Media Videos on the subject's Taxonomy Topic — and,
 * for the Quran alone, every Video that explains a Quran passage — read
 * through Media's public `topicVideos` and `topicVideoFacets`; the speakers'
 * names are People's. No subject context imports Media; only this
 * presentation layer composes them.
 *
 * ONE ADDRESS PER VIEW (`./videos-view`): a content language, a speaker, a
 * Series, a length, an order and a page — and, with the Quran passage parts,
 * a shelf and a Surah — each a GET parameter, so the hub works without script
 * and every view can be shared. Nothing is stated that Media did not answer:
 * a filter with no choice is not offered, a figure of zero is not shown, and
 * a video with no poster is a drawn tile.
 *
 * NO THIRD-PARTY REQUEST TO PAINT A CARD — as on every Watch page, a poster is
 * Media's own stored copy, and the provider is contacted only from a video's
 * own page, after the visitor asks.
 */

type HubTranslator = Awaited<ReturnType<typeof getTranslations<'topicHub'>>>;
type WatchTranslator = Awaited<ReturnType<typeof getTranslations<'watch'>>>;
type Names = Awaited<ReturnType<typeof referenceNames>>;

/** What a subject says on its Videos hub, in its own words. */
export interface VideosCopy {
  readonly lede: string;
  /** "12 videos on Hadith". */
  readonly stat: (count: number) => string;
  /** What the listing holds, unnarrowed by a shelf. */
  readonly listIntro: string;
  readonly emptyTitle: string;
  readonly empty: string;
  readonly noResults: string;
  readonly about: string;
}

/**
 * THE QURAN PASSAGE PARTS of a Videos hub — only the Quran's has them: the
 * shelves, a Surah filter, the Quran order, the Surah figures, the opening's
 * Surah index, and below each card where it opens at a passage and the
 * Surahs it explains, as the Quran renders them.
 */
export interface VideosPassages {
  readonly statExplaining: (count: number) => string;
  readonly statSurahs: (count: number) => string;
  readonly shelves: string;
  readonly shelf: Readonly<Record<TopicVideosShelf, string>>;
  readonly shelfHelp: Readonly<Record<Exclude<TopicVideosShelf, 'all'>, string>>;
  readonly seeAll: (count: number) => string;
  readonly filterSurah: string;
  readonly anySurah: string;
  readonly sortQuran: string;
  /** A Surah as plain words, for an option or a filter chip ("18. Al-Kahf"). */
  readonly surahOption: (surah: number) => string;
  /** The opening's index of the Surahs lectures explain, headed by `id`. */
  readonly surahIndex: (id: string, rows: readonly PassageSurahCount[]) => ReactNode;
  /** Below a card, outside its link: where it opens at a passage, its Surahs. */
  readonly cardExtra: (video: TopicVideo) => ReactNode;
}

/** How many featured videos the hub opens with, at most. */
const FEATURED = 3;
/** How many lectures the opening "explains a Surah" shelf carries. */
const SHELF = 10;

/** The speakers of a video, as one plain line of People's names. */
function speakerLine(video: TopicVideo, names: Names): string {
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
 * stretched link, whatever the subject adds (the Quran's passage start and
 * Surah chips), each its own link. Two kinds of target that never overlap.
 */
function VideoCard({
  locale,
  video,
  names,
  t,
  tw,
  extra,
  wide = false,
  priority = false,
  sizes = '(min-width: 64rem) 22rem, (min-width: 40rem) 45vw, 100vw',
}: {
  readonly locale: Locale;
  readonly video: TopicVideo;
  readonly names: Names;
  readonly t: HubTranslator;
  readonly tw: WatchTranslator;
  readonly extra: ReactNode;
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
              <span className="sr-only">{t('videos.duration')}: </span>
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
              {t('videos.episode', { number: series.at.position })}
              {' · '}
              <span lang={series.locale} dir={directionOf(series.locale)}>
                {series.title}
              </span>
            </p>
          )}
        </div>
      </div>
      {extra}
    </li>
  );
}

/** The length bands, as the filter and its chip name them. */
function lengthText(length: TopicVideoLength, t: HubTranslator): string {
  return t(`videos.length.${length}`);
}

export async function VideosHub({
  domain,
  scope,
  query,
  copy,
  actions,
  passages,
}: {
  readonly domain: HubDomain;
  readonly scope: VideosScope;
  readonly query: VideosQuery;
  readonly copy: VideosCopy;
  /** The ways onward the header offers. */
  readonly actions: readonly HubLink[];
  /** The Quran passage parts, or null where the subject has none. */
  readonly passages: VideosPassages | null;
}) {
  const { locale } = domain;
  const [t, tw] = await Promise.all([
    getTranslations({ locale, namespace: 'topicHub' }),
    getTranslations({ locale, namespace: 'watch' }),
  ]);
  const media = mediaReadRuntime();
  const read = videosReadQuery(scope, query, domain.topicId, locale);
  const filtered = videosFiltered(query);
  const opening = !filtered && query.page === 1;
  const [page, facets, featured, explaining] = await Promise.all([
    media.topicVideos(read),
    media.topicVideoFacets(read),
    opening
      ? media.topicVideos({ ...read, featured: true, limit: FEATURED })
      : Promise.resolve(null),
    opening && passages !== null
      ? media.topicVideos({ ...read, shelf: 'explains', sort: 'newest', limit: SHELF })
      : Promise.resolve(null),
  ]);
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

  const listId = `${domain.key}-videos-list`;
  const featuredId = `${domain.key}-videos-featured`;
  const surahsId = `${domain.key}-videos-surahs`;
  const shelfId = `${domain.key}-videos-explaining`;
  const title = domain.title;
  const hub = facets.hub;
  const hours = wholeHours(hub.seconds);
  const href = (change: Partial<VideosQuery> = {}) =>
    videosHref(scope, locale, query, change);
  const base = href({
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
  const surahOptions =
    passages === null || query.shelf === 'general' ? [] : facets.surahs;
  const showLanguage = languageOptions.length > 1 || query.language !== null;
  const showSpeaker = speakerOptions.length > 0 || query.speaker !== null;
  const showSeries = seriesOptions.length > 0 || query.series !== null;
  const showLength = facets.lengths.length > 1 || query.length !== null;
  const speakerName =
    query.speaker === null ? null : (names.people.get(query.speaker)?.name ?? null);
  const seriesLabel =
    query.series === null
      ? null
      : (seriesOptions.find((entry) => entry.id === query.series)?.label ?? null);

  const active = [
    ...(passages === null || query.surah === null
      ? []
      : [
          {
            key: 'surah',
            text: passages.surahOption(query.surah),
            removeText: passages.surahOption(query.surah),
            removeHref: href({ surah: null }),
          },
        ]),
    ...(query.language === null
      ? []
      : [
          {
            key: 'language',
            text: languageName(query.language, locale),
            removeText: languageName(query.language, locale),
            removeHref: href({ language: null }),
          },
        ]),
    ...(query.speaker === null
      ? []
      : [
          {
            key: 'speaker',
            text: speakerName ?? t('videos.unknownSpeaker'),
            removeText: speakerName ?? t('videos.unknownSpeaker'),
            removeHref: href({ speaker: null }),
          },
        ]),
    ...(query.series === null
      ? []
      : [
          {
            key: 'series',
            text:
              seriesLabel === null ? (
                t('videos.unknownSeries')
              ) : (
                <span lang={seriesLabel.locale} dir={directionOf(seriesLabel.locale)}>
                  {seriesLabel.title}
                </span>
              ),
            removeText: seriesLabel?.title ?? t('videos.unknownSeries'),
            removeHref: href({ series: null }),
          },
        ]),
    ...(query.length === null
      ? []
      : [
          {
            key: 'length',
            text: lengthText(query.length, t),
            removeText: lengthText(query.length, t),
            removeHref: href({ length: null }),
          },
        ]),
  ].map(({ removeText, ...filter }) => ({
    ...filter,
    removeLabel: t('common.remove', { name: removeText }),
  }));

  const card = (
    video: TopicVideo,
    extra: { wide?: boolean; priority?: boolean } = {},
  ) => (
    <VideoCard
      key={video.id}
      locale={locale}
      video={video}
      names={names}
      t={t}
      tw={tw}
      extra={passages?.cardExtra(video) ?? null}
      {...extra}
    />
  );

  return domain.frame(
    <>
      <ExploreHero
        eyebrow={t('videos.eyebrow')}
        title={title}
        lede={copy.lede}
        stats={[
          ...(hub.videos === 0
            ? []
            : [{ value: hub.videos, label: copy.stat(hub.videos), href: `#${listId}` }]),
          ...(passages === null || hub.explaining === 0
            ? []
            : [
                {
                  value: hub.explaining,
                  label: passages.statExplaining(hub.explaining),
                  href: href({
                    shelf: 'explains',
                    surah: null,
                    language: null,
                    speaker: null,
                    series: null,
                    length: null,
                  }),
                },
              ]),
          ...(passages === null || hub.surahs === 0
            ? []
            : [
                {
                  value: hub.surahs,
                  label: passages.statSurahs(hub.surahs),
                  href: `#${surahsId}`,
                },
              ]),
          ...(hours === 0
            ? []
            : [{ value: hours, label: t('videos.statHours', { count: hours }) }]),
          ...(hub.languages < 2
            ? []
            : [
                {
                  value: hub.languages,
                  label: t('common.statLanguages', { count: hub.languages }),
                },
              ]),
        ]}
        actions={actions}
      />

      {hub.videos === 0 ? (
        <EmptyState
          icon="video"
          title={copy.emptyTitle}
          action={{
            href: localizedPath(locale, '/watch/videos'),
            text: t('videos.watchLink'),
          }}
        >
          {copy.empty}
        </EmptyState>
      ) : (
        <>
          {featuredItems.length === 0 ? null : (
            <section aria-labelledby={featuredId} className="flex flex-col gap-4">
              <SectionHeader
                id={featuredId}
                heading={t('videos.featuredHeading')}
                intro={t('videos.featuredHelp')}
              />
              <ul className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
                {featuredItems.map((video, index) =>
                  card(video, { wide: true, priority: index === 0 }),
                )}
              </ul>
            </section>
          )}

          {opening && passages !== null && facets.surahs.length > 0
            ? passages.surahIndex(surahsId, facets.surahs)
            : null}

          {opening && passages !== null && shelfItems.length > 0 ? (
            <section aria-labelledby={shelfId} className="flex min-w-0 flex-col gap-5">
              <Shelf
                label={passages.shelf.explains}
                previousLabel={domain.previous}
                nextLabel={domain.next}
                size="poster"
                header={
                  <SectionHeader
                    id={shelfId}
                    heading={passages.shelf.explains}
                    intro={passages.shelfHelp.explains}
                    action={{
                      href: href({ shelf: 'explains' }),
                      text: passages.seeAll(facets.shelves.explaining),
                    }}
                  />
                }
              >
                {shelfItems.map((video) => card(video))}
              </Shelf>
            </section>
          ) : null}

          <section aria-labelledby={listId} className="flex flex-col gap-5">
            <SectionHeader
              id={listId}
              heading={t('videos.listHeading')}
              intro={
                passages === null || query.shelf === 'all'
                  ? copy.listIntro
                  : passages.shelfHelp[query.shelf]
              }
            />

            {passages !== null && facets.shelves.explaining > 0 && general > 0 ? (
              <LinkTabs
                label={passages.shelves}
                tabs={(['all', 'explains', 'general'] as const).map((shelf) => ({
                  href: href({ shelf }),
                  text: passages.shelf[shelf],
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
              action={localizedPath(locale, scope.path)}
              label={t('videos.filters')}
              hidden={
                query.shelf === 'all' ? [] : [{ name: 'shelf', value: query.shelf }]
              }
              submit={t('videos.apply')}
              reset={filtered ? { href: base, text: t('common.reset') } : null}
            >
              {passages === null || surahOptions.length === 0 ? null : (
                <Field id="videos-surah" label={passages.filterSurah}>
                  {(props) => (
                    <Select
                      {...props}
                      name="surah"
                      defaultValue={query.surah === null ? '' : String(query.surah)}
                    >
                      <option value="">{passages.anySurah}</option>
                      {surahOptions.map((row) => (
                        <option key={row.surah} value={String(row.surah)}>
                          {t('common.option', {
                            name: passages.surahOption(row.surah),
                            count: row.owners,
                          })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}
              {showLanguage ? (
                <Field id="videos-language" label={t('common.filterLanguage')}>
                  {(props) => (
                    <Select
                      {...props}
                      name="language"
                      defaultValue={query.language ?? ''}
                    >
                      <option value="">{t('common.anyLanguage')}</option>
                      {languageOptions.map((facet) => (
                        <option key={facet.id} value={facet.id}>
                          {t('common.option', {
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
                <Field id="videos-speaker" label={t('videos.filterSpeaker')}>
                  {(props) => (
                    <Select {...props} name="speaker" defaultValue={query.speaker ?? ''}>
                      <option value="">{t('videos.anySpeaker')}</option>
                      {speakerOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {t('common.option', {
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
                <Field id="videos-series" label={t('videos.filterSeries')}>
                  {(props) => (
                    <Select {...props} name="series" defaultValue={query.series ?? ''}>
                      <option value="">{t('videos.anySeries')}</option>
                      {seriesOptions.map((option) => (
                        <option
                          key={option.id}
                          value={option.id}
                          lang={option.label.locale}
                        >
                          {t('common.option', {
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
                <Field id="videos-length" label={t('videos.filterLength')}>
                  {(props) => (
                    <Select {...props} name="length" defaultValue={query.length ?? ''}>
                      <option value="">{t('videos.anyLength')}</option>
                      {facets.lengths.map((row) => (
                        <option key={row.length} value={row.length}>
                          {t('common.option', {
                            name: lengthText(row.length, t),
                            count: row.videos,
                          })}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
              <Field id="videos-sort" label={t('common.filterSort')}>
                {(props) => (
                  <Select {...props} name="sort" defaultValue={query.sort}>
                    <option value="newest">{t('common.sort.newest')}</option>
                    {passages !== null &&
                    hub.explaining > 0 &&
                    query.shelf !== 'general' ? (
                      <option value="quran">{passages.sortQuran}</option>
                    ) : null}
                    <option value="title">{t('common.sort.title')}</option>
                  </Select>
                )}
              </Field>
            </ExploreFilters>

            <ActiveFilters label={t('common.active')} filters={active} />

            {range === null ? null : (
              <p className="text-sm text-foreground-muted">
                {t('videos.summary', {
                  from: range.from,
                  to: range.to,
                  total: page.total,
                })}
              </p>
            )}

            {page.items.length === 0 ? (
              query.page > 1 && page.total > 0 ? (
                <EmptyState
                  title={t('common.pastEndTitle')}
                  action={{ href: href({ page: 1 }), text: t('common.firstPage') }}
                >
                  {t('videos.pastEnd', { page: query.page })}
                </EmptyState>
              ) : (
                <EmptyState
                  title={t('videos.noResultsTitle')}
                  action={{ href: base, text: t('common.reset') }}
                >
                  {copy.noResults}
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
                label={t('videos.pages')}
                previous={query.page > 1 ? href({ page: query.page - 1 }) : null}
                next={page.hasMore ? href({ page: query.page + 1 }) : null}
                previousLabel={domain.previous}
                nextLabel={domain.next}
                pages={{
                  current: query.page,
                  total: pages,
                  href: (number) => href({ page: number }),
                  label: (number) => t('common.pageLabel', { page: number }),
                  format: (number) => new Intl.NumberFormat(locale).format(number),
                }}
              />
            )}
          </section>
        </>
      )}

      <div className="flex flex-col gap-3 border-t border-border pt-4">
        <p className="max-w-[var(--measure-prose)] text-sm text-foreground-muted">
          {copy.about}
        </p>
        <p className="text-sm">
          <a
            href={
              domain.topicId === null
                ? localizedPath(locale, '/watch/videos')
                : localizedPath(
                    locale,
                    `/watch/videos?topic=${encodeURIComponent(domain.topicId)}`,
                  )
            }
            className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-action underline-offset-4 hover:underline"
          >
            {t('videos.watchLink')}
            <Icon name="arrow-end" size={16} />
          </a>
        </p>
      </div>
    </>,
  );
}
