import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { HadithVideosPage } from '@/components/hadith/hub-pages';
import { HADITH_VIDEOS } from '@/components/hadith/hubs';
import { hadithAvailability, hadithMetadata } from '@/components/hadith/read';
import {
  videosCanonicalRedirect,
  readVideosQuery,
} from '@/components/topic-hub/videos-view';
import { requireLocale } from '@/config/route-locale';

/**
 * `/{locale}/hadith/videos` — THE HADITH VIDEOS HUB (Hadith Part 1; ROUTE_MAP.md
 * §3.4): Media's published Videos on Taxonomy's `hadith` Topic, composed at Layer 4 from its owner's own public reads —
 * a content language, a speaker, a Series, a length, an order and a page, each a GET parameter, every view at ONE address (any other
 * spelling of it is one redirect there). Nothing of Hadith's is read: there
 * is no Hadith corpus (OPEN_DECISIONS.md §1.3), so the hub stands whether or
 * not a collection is activated, and without the Topic it says, as its empty
 * state, that nothing is on Hadith yet — never a 404.
 *
 * CANONICAL TO ITSELF, the bare path, since Hadith Part 1 (until then the
 * owner's own collection — historical): every filtered or paged view
 * canonicalises to it. Like every Hadith page it is indexable only under an
 * approved activation on an indexable deployment (`hadithMetadata`);
 * otherwise it claims no canonical and is `noindex`.
 *
 * Signed out and `force-dynamic`: every part is mutable public data.
 */
export const dynamic = 'force-dynamic';

interface HubParams {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: HubParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'hadith' });
  return hadithMetadata({
    locale,
    availability: await hadithAvailability(),
    canonicalPath: HADITH_VIDEOS.path,
    title: t('sections.videos'),
    description: t('sectionBody.videos'),
  });
}

export default async function HadithVideosRoute({ params, searchParams }: HubParams) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  // One address per view: a form's empty controls, a malformed value or
  // another order is ONE redirect to the canonical spelling.
  const canonical = videosCanonicalRedirect(HADITH_VIDEOS, locale, query);
  if (canonical !== null) redirect(canonical);
  return (
    <HadithVideosPage
      locale={locale}
      availability={await hadithAvailability()}
      query={readVideosQuery(HADITH_VIDEOS, query)}
    />
  );
}
