import 'server-only';

import { localizedPath, type Locale } from '@minhaj/contracts';
import { leadImagePath, newsPathOf } from '@minhaj/contracts/editorial';
import { cache } from 'react';

import { translationFor } from '@/components/editorial/presentation';
import { editionCoverPath } from '@/components/library/cover';
import { labelFor, workPath } from '@/components/library/presentation';
import { mediaLabel, videoPath, videoPosterPath } from '@/components/media/presentation';
import { editorialReadRuntime } from '@/composition/editorial-read';
import { libraryReadRuntime } from '@/composition/library-read';
import { mediaReadRuntime } from '@/composition/media-read';
import { directionOf } from '@/config/locale';
import type { NavigationGroupId } from '@/shell/presence';

/**
 * THE MEGA-NAVIGATION'S FEATURED CARDS (R2) — one real, recent record with a
 * real picture per panel where the corpus has one: the newest video with a
 * poster (Watch & Listen), the newest book with a cover (Knowledge), the
 * newest news story with a lead image (News & Events).
 *
 * PUBLIC READS ONLY, through the same composition roots the public pages use;
 * no session, no request API. Each read FAILS CLOSED on its own: a panel whose
 * read fails or finds nothing simply has no featured card. Never a stock image.
 *
 * BOUNDED COST, like the presence snapshot: computed at most once per request
 * and reused per locale for `TTL_MS`, so a new record reaches the menu within
 * that delay. Every image address is the owning context's first-party route.
 */
export interface NavigationFeature {
  readonly kind: 'video' | 'book' | 'news';
  readonly href: string;
  readonly title: string;
  readonly lang: Locale;
  readonly dir: 'ltr' | 'rtl';
  readonly image: {
    readonly path: string;
    readonly width: number;
    readonly height: number;
  };
}

export type NavigationFeatures = Readonly<
  Partial<Record<NavigationGroupId, NavigationFeature>>
>;

const TTL_MS = 30_000;

const memo = new Map<
  Locale,
  { readonly at: number; readonly value: NavigationFeatures }
>();

async function latestVideo(locale: Locale): Promise<NavigationFeature | null> {
  const page = await mediaReadRuntime().videos({});
  const video = page.items.find((item) => item.poster !== null);
  if (video === undefined || video.poster === null) return null;
  const label = mediaLabel(video, locale);
  return {
    kind: 'video',
    href: videoPath(locale, video.slug),
    title: label.title,
    lang: label.locale,
    dir: directionOf(label.locale),
    image: {
      path: videoPosterPath(video.id, video.poster.assetId),
      width: video.poster.width,
      height: video.poster.height,
    },
  };
}

async function latestBook(locale: Locale): Promise<NavigationFeature | null> {
  const page = await libraryReadRuntime().works({});
  const work = page.items.find((item) => item.cover !== null);
  if (work === undefined || work.cover === null) return null;
  const label = labelFor(work, locale);
  return {
    kind: 'book',
    href: workPath(locale, work.slug),
    title: label.title,
    lang: label.locale,
    dir: directionOf(label.locale),
    image: {
      path: editionCoverPath(work.cover.editionId, work.cover.assetId),
      width: work.cover.width,
      height: work.cover.height,
    },
  };
}

async function latestStory(locale: Locale): Promise<NavigationFeature | null> {
  const page = await editorialReadRuntime().newsList('news-article', 0);
  const item = page.items.find((row) => row.leadImage !== null);
  if (item === undefined || item.leadImage === null) return null;
  const translation = translationFor(item, locale);
  return {
    kind: 'news',
    href: localizedPath(locale, newsPathOf(item.kind, item.slug)),
    title: translation.title,
    lang: translation.languageCode,
    dir: directionOf(translation.languageCode),
    image: {
      path: leadImagePath(item.leadImage),
      width: item.leadImage.width,
      height: item.leadImage.height,
    },
  };
}

const quietly = (read: Promise<NavigationFeature | null>) =>
  read.catch((): NavigationFeature | null => null);

async function compute(locale: Locale): Promise<NavigationFeatures> {
  const [watch, knowledge, news] = await Promise.all([
    quietly(latestVideo(locale)),
    quietly(latestBook(locale)),
    quietly(latestStory(locale)),
  ]);
  return Object.freeze({
    ...(watch === null ? {} : { watch }),
    ...(knowledge === null ? {} : { knowledge }),
    ...(news === null ? {} : { news }),
  });
}

/** The featured card of each panel that has one, for this locale. */
export const readNavigationFeatures = cache(
  async (locale: Locale): Promise<NavigationFeatures> => {
    const now = Date.now();
    const known = memo.get(locale);
    if (known !== undefined && now - known.at < TTL_MS) return known.value;
    const value = await compute(locale);
    memo.set(locale, { at: now, value });
    return value;
  },
);
