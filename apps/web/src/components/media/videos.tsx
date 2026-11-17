import 'server-only';

import { getTranslations } from 'next-intl/server';

import { localizedPath, type Locale } from '@minhaj/contracts';

import { VideosHub } from '@/components/topic-hub/videos';
import type { VideosQuery, VideosScope } from '@/components/topic-hub/videos-view';
import { Breadcrumbs, Container } from '@/components/ui';
import { viewOfFormat } from './presentation';

/**
 * `/watch/videos` AND THE FIVE CURATED VIEWS (ROUTE_MAP.md §3.7; Watch Part 1):
 * the shared Videos listing (`@/components/topic-hub/videos`) over the whole
 * of Media — figures, the featured videos, the curated formats as tabs with
 * counts, filters with counts (Topic, content language, speaker, Series,
 * length), two orders, removable chips and numbered pages — read with
 * `scope: 'media'`, exactly as the Quran and Hadith hubs read their Topic. A
 * curated view (`/watch/lectures` …) is the same listing standing on its
 * format, with its own title and canonical address.
 *
 * THE INTERFACE LOCALE DOES NOT FILTER CONTENT: `/ur/watch/videos` lists videos
 * in every content language (ROUTE_MAP.md §1.5); a content language is a
 * filter the visitor chooses. Signed out, always: nothing here can reach
 * Identity or a cookie, and no provider is contacted to paint a card.
 */
export async function WatchVideosPage({
  locale,
  scope,
  query,
}: {
  readonly locale: Locale;
  readonly scope: VideosScope;
  readonly query: VideosQuery;
}) {
  const [t, shell] = await Promise.all([
    getTranslations({ locale, namespace: 'watch' }),
    getTranslations({ locale, namespace: 'shell' }),
  ]);
  const format = scope.media?.format ?? null;
  const section = format === null ? 'videos' : viewOfFormat(format);
  const title = t(`sections.${section}` as 'sections.videos');
  const link = (path: string, text: string) => ({
    href: localizedPath(locale, path),
    text,
  });

  return (
    <VideosHub
      domain={{
        key: 'watch',
        locale,
        topicId: null,
        title,
        frame: (children) => (
          <Container>
            <div className="flex min-w-0 flex-col gap-8 pt-6 pb-[var(--space-section)]">
              <Breadcrumbs
                label={shell('nav.breadcrumbs')}
                trail={[
                  { href: localizedPath(locale, ''), text: shell('nav.home') },
                  { href: localizedPath(locale, '/watch'), text: t('title') },
                  { text: title },
                ]}
              />
              {children}
            </div>
          </Container>
        ),
        previous: t('previous'),
        next: t('next'),
      }}
      scope={scope}
      query={query}
      copy={{
        eyebrow: t('title'),
        lede: t(`sectionBody.${section}` as 'sectionBody.videos'),
        hours: (count) => t('listing.statHours', { count }),
        stat: (count) => t('listing.stat', { count }),
        listIntro: t('listing.listIntro'),
        emptyTitle: t('listing.emptyTitle'),
        empty: format === null ? t('empty') : t('listing.emptyView'),
        noResults: t('emptyFiltered'),
        about: t('listing.about'),
      }}
      actions={[
        link('/watch/series', t('sections.series')),
        link('/watch/programs', t('sections.programs')),
        link('/watch/speakers', t('sections.speakers')),
        link('/watch/playlists', t('sections.playlists')),
      ]}
      passages={null}
      onward={[
        link('/quran/videos', t('listing.quranVideos')),
        link('/hadith/videos', t('listing.hadithVideos')),
        link('/listen', t('listing.listen')),
      ]}
    />
  );
}
