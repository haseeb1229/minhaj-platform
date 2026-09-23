import 'server-only';

import { localeSchema } from '@minhaj/contracts';

import { taxonomyRuntime } from '@/composition/taxonomy';
import { publicIndexingEnabled } from '@/config/indexing';
import { absoluteUrl } from '@/config/origin';
import type { SitemapPartition } from './sitemap';

/**
 * The `topics` sitemap segment (ROUTE_MAP.md §9.4) — the canonical topic hubs
 * Phase 17 delivers at `/topics/{slug}`.
 *
 * ONLY LOCALES A TRANSLATION GENUINELY EXISTS IN. A topic shown in English
 * inside an Urdu page is a fallback, not an Urdu version, and a sitemap that
 * listed it would advertise a translation that does not exist (§9.2).
 *
 * NO `lastmod`. Taxonomy exposes no modification time for a topic's public
 * hub, and a date invented here would be the build-time `lastmod` §9.4 forbids.
 *
 * BOUNDED BY TAXONOMY'S OWN LISTING — the same accepted bound the `/topics`
 * browser renders — rather than by a second enumeration of its own.
 */

const TOPICS_SEGMENT = 'topics';

export async function topicsSitemapPartitions(): Promise<readonly SitemapPartition[]> {
  // FAIL CLOSED FIRST, and before any query.
  if (!publicIndexingEnabled()) return [];

  const tree = await taxonomyRuntime().taxonomy.listTree({
    locale: 'en',
    includeArchived: false,
  });

  return localeSchema.options.flatMap((locale): SitemapPartition[] => {
    const urls = tree
      .filter((topic) => topic.translatedLocales.includes(locale))
      .map((topic) => ({
        loc: absoluteUrl(`/${locale}/topics/${encodeURIComponent(topic.slug)}`),
      }));
    return urls.length === 0 ? [] : [{ segment: TOPICS_SEGMENT, locale, urls }];
  });
}
