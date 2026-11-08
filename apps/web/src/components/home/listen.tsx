import { localizedPath } from '@minhaj/contracts';
import type { Locale } from '@minhaj/contracts';
import type { AudioTrackListing } from '@minhaj/contracts/media';
import { getTranslations } from 'next-intl/server';

import { TrackList } from '@/components/media/listen';

import { HomeSection } from './section';

/**
 * LISTEN (restored from the pre-R2 portal): the newest audio lectures beside
 * the Watch shelf, through Listen's own track list, and the way to every audio
 * lecture at `/listen/lectures`. Media's own first page, in its own order;
 * nothing renders when no track is published.
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
          href: localizedPath(locale, '/listen/lectures'),
          text: listen('allTracks'),
        },
      }}
    >
      <TrackList
        locale={locale}
        tracks={tracks}
        label={listen('title')}
        headingLevel="h3"
      />
    </HomeSection>
  );
}
