import 'server-only';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { formatDuration } from '@minhaj/contracts/media';
import type { QuranAvailability } from '@minhaj/contracts/quran';

import { videoPath } from '@/components/media/presentation';
import { Icon, SectionHeader } from '@/components/ui';
import { VideosHub } from '@/components/topic-hub/videos';
import { videosHref, type VideosQuery } from '@/components/topic-hub/videos-view';
import { PassageChips } from './explore';
import { passageStart, surahChips } from './explore-view';
import { QURAN_VIDEOS } from './hubs';
import { QuranFrame, quranTrail } from './parts';
import { quranPath, surahName } from './presentation';
import { readQuranTopic, readSurahs } from './read';
import { lectureHref, passageCitation } from './tafsir-layout';

/**
 * THE QURAN VIDEOS HUB (Quran Part 11) — `/quran/videos`: the shared Videos
 * hub (`@/components/topic-hub/videos`) on Taxonomy's `quran` Topic WITH the
 * Quran passage parts — every published Video that explains a Quran passage
 * joins the set; the shelves, a Surah filter, the Quran order, the Surah
 * figures and the opening's "Lectures by Surah" are offered; and each lecture
 * says where it begins a passage ("Watch from 18:1–10") — only where its
 * editor recorded that — and carries the Surahs it explains, each linking to
 * that Surah's tafsir. The Surah names are Quran's public reader's; the
 * videos are Media's, composed at Layer 4.
 */
export async function QuranVideosPage({
  locale,
  availability,
  query,
}: {
  readonly locale: Locale;
  readonly availability: QuranAvailability;
  readonly query: VideosQuery;
}) {
  const [t, parts, topic, surahList] = await Promise.all([
    getTranslations({ locale, namespace: 'quran' }),
    quranTrail(locale),
    readQuranTopic(locale),
    readSurahs(),
  ]);
  const surahs = new Map(surahList.map((surah) => [surah.number, surah]));
  const title = t('sections.videos');

  /** "18. Al-Kahf" for a select's option, which cannot carry markup. */
  const surahOption = (number: number): string => {
    const surah = surahs.get(number);
    const name = surah === undefined ? null : surahName(surah, locale);
    return name === null
      ? t('surahName', { number })
      : t('videosHub.surahOption', { number, name: name.text });
  };

  return (
    <VideosHub
      domain={{
        key: 'quran',
        locale,
        topicId: topic?.id ?? null,
        title,
        frame: (children) => (
          <QuranFrame
            locale={locale}
            availability={availability}
            trail={[parts.home, parts.quran, { text: title }]}
          >
            {children}
          </QuranFrame>
        ),
        previous: t('previous'),
        next: t('next'),
      }}
      scope={QURAN_VIDEOS}
      query={query}
      copy={{
        lede: t('videosHub.lede'),
        stat: (count) => t('videosHub.statVideos', { count }),
        listIntro: t('videosHub.shelfHelp.all'),
        emptyTitle: t('videosHub.emptyTitle'),
        empty: t('videosHub.empty'),
        noResults: t('videosHub.noResults'),
        about: t('videosHub.about'),
      }}
      actions={[
        { href: quranPath(locale, 'tafsir'), text: t('videosHub.tafsirLink') },
        { href: quranPath(locale, 'surah'), text: t('videosHub.readLink') },
      ]}
      passages={{
        statExplaining: (count) => t('videosHub.statExplaining', { count }),
        statSurahs: (count) => t('videosHub.statSurahs', { count }),
        shelves: t('videosHub.shelves'),
        shelf: {
          all: t('videosHub.shelf.all'),
          explains: t('videosHub.shelf.explains'),
          general: t('videosHub.shelf.general'),
        },
        shelfHelp: {
          explains: t('videosHub.shelfHelp.explains'),
          general: t('videosHub.shelfHelp.general'),
        },
        seeAll: (count) => t('videosHub.seeAll', { count }),
        filterSurah: t('videosHub.filterSurah'),
        anySurah: t('videosHub.anySurah'),
        sortQuran: t('videosHub.sort.quran'),
        surahOption,
        surahIndex: (id, rows) => (
          <section aria-labelledby={id} className="flex flex-col gap-4">
            <SectionHeader
              id={id}
              heading={t('videosHub.surahsHeading')}
              intro={t('videosHub.surahsHelp')}
              action={{
                href: quranPath(locale, 'tafsir'),
                text: t('videosHub.tafsirLink'),
              }}
            />
            <ul aria-labelledby={id} className="flex flex-wrap gap-2">
              {rows.map((row) => {
                const surah = surahs.get(row.surah);
                const name = surah === undefined ? null : surahName(surah, locale);
                return (
                  <li key={row.surah} className="max-w-full min-w-0">
                    <a
                      href={videosHref(QURAN_VIDEOS, locale, query, { surah: row.surah })}
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
        ),
        cardExtra: (video) => {
          const start = passageStart(video.passages, query.surah);
          const { chips, more } = surahChips(video.passages);
          return (
            <>
              {start === null || start.startSeconds === null ? null : (
                <p className="flex">
                  <a
                    href={lectureHref(videoPath(locale, video.slug), start)}
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
            </>
          );
        },
      }}
    />
  );
}
