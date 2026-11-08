import type { Locale } from '@minhaj/contracts';
import type { VideoListing } from '@minhaj/contracts/media';
import { getTranslations } from 'next-intl/server';

import { contentLanguageBadge } from '@/components/content-language';
import { Duration } from '@/components/media/parts';
import { mediaLabel, videoPath, videoPosterPath } from '@/components/media/presentation';
import { MediaCard, SectionHeader } from '@/components/ui';
import { Shelf } from '@/components/ui/shelf';
import { directionOf } from '@/config/locale';
import { pathFor, requireRoute } from '@/shell/registry';

import { HomeSection } from './section';

/**
 * THE WATCH SHELF (R2): the newest lectures as posters, each with its running
 * time on the picture and its content language named when it is not the
 * interface's. Media's own first page, in Media's own order; nothing renders
 * when nothing is published. An unavailable video is left off the home page —
 * it is a notice, not something to watch.
 */
export async function WatchShelf({
  locale,
  videos,
}: {
  readonly locale: Locale;
  readonly videos: readonly VideoListing[];
}) {
  const shown = videos.filter((video) => video.availability !== 'unavailable');
  if (shown.length === 0) return null;
  const [t, watch] = await Promise.all([
    getTranslations({ locale, namespace: 'shell' }),
    getTranslations({ locale, namespace: 'watch' }),
  ]);
  const heading = t('home.watch.heading');

  return (
    <HomeSection id="home-watch">
      <Shelf
        label={heading}
        size="poster"
        previousLabel={t('home.shelf.previous')}
        nextLabel={t('home.shelf.next')}
        header={
          <SectionHeader
            id="home-watch"
            heading={heading}
            action={{
              href: pathFor(locale, requireRoute('watch')),
              text: watch('allVideos'),
            }}
          />
        }
      >
        {shown.map((video) => {
          const label = mediaLabel(video, locale);
          const language = contentLanguageBadge(video.languageCode, locale);
          return (
            <MediaCard
              key={video.id}
              href={videoPath(locale, video.slug)}
              title={label.title}
              aspect="poster"
              sizes="18.5rem"
              lang={label.locale}
              dir={directionOf(label.locale)}
              {...(language === undefined ? {} : { language })}
              {...(video.durationSeconds === null
                ? {}
                : { overlay: <Duration seconds={video.durationSeconds} /> })}
              image={
                video.poster === null
                  ? null
                  : {
                      path: videoPosterPath(video.id, video.poster.assetId),
                      width: video.poster.width,
                      height: video.poster.height,
                    }
              }
            />
          );
        })}
      </Shelf>
    </HomeSection>
  );
}
