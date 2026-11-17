import type { Locale } from '@minhaj/contracts';
import type { AudioTrackListing } from '@minhaj/contracts/media';
import { getTranslations } from 'next-intl/server';

import { AudioCards } from '@/components/media/listen';
import { listenLecturesHref } from '@/components/media/listen-view';

import { HomeSection } from './section';

/**
 * LISTEN (restored from the pre-R2 portal): the newest audio lectures beside
 * the Watch shelf, as Listen's own cards (since Watch Part 3), and the way to
 * every audio lecture at `/listen/lectures`. Media's own first page, in its
 * own order; nothing renders when no track is published.
 */
export async function ListenModule({
  locale,
  tracks,
}: {
  readonly locale: Locale;
  readonly tracks: readonly AudioTrackListing[];
}) {
  if (tracks.length === 0) return null;
  const listen = await getTranslations({ locale, namespace: 'listen' });

  return (
    <HomeSection
      id="home-listen"
      header={{
        heading: listen('title'),
        action: {
          href: listenLecturesHref(locale),
          text: listen('allTracks'),
        },
      }}
    >
      <AudioCards locale={locale} tracks={tracks} label={listen('title')} />
    </HomeSection>
  );
}
