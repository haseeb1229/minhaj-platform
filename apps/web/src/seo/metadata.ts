import 'server-only';

import type { Metadata } from 'next';

import { localeSchema, type Locale } from '@minhaj/contracts';

import { absoluteUrl } from '@/config/origin';
import { publicIndexingEnabled } from '@/config/indexing';
import { pathFor, type AvailableRoute } from '@/shell/registry';

/**
 * THE one metadata path (ROUTE_MAP.md §9).
 *
 * Every public surface builds its `robots`, its canonical link and its
 * `hreflang` alternates here, so the three can never disagree — a page that
 * said `noindex` in its head while advertising itself in a sitemap, or one that
 * announced an Urdu alternate that does not exist, would be a false signal
 * rather than a missing one.
 *
 * TWO INDEPENDENT CONDITIONS, and BOTH must hold before anything is claimed:
 *
 *   1. THE DEPLOYMENT may be indexed at all. The pre-adoption origin may not
 *      (ROUTE_MAP.md §9.5), and the control fails closed.
 *   2. THE ROUTE is eligible. A reserved shell carrying a "not yet published"
 *      notice is not, and neither is anything private.
 *
 * When either fails, the page emits `noindex, nofollow` AND NO CANONICAL AND NO
 * ALTERNATES. That is deliberate: a canonical link is a claim that this URL is
 * the one to index, and a page that must not be indexed has no such claim to
 * make.
 */

interface ShellMetadataInput {
  readonly locale: Locale;
  /** The registry entry for the route being rendered. */
  readonly route: AvailableRoute;
  /**
   * The page's own title, composed into `%s · One Minhaj` by the root layout's
   * template.
   *
   * OMITTED BY THE HOME PAGE, deliberately: its title is the product name, and
   * supplying it here would compose it with itself.
   */
  readonly title?: string;
  readonly description?: string;
}

/** Is anything on this route indexable right now? */
export function isIndexable(route: AvailableRoute): boolean {
  return publicIndexingEnabled() && route.indexing === 'eligible';
}

/**
 * Locale alternates for a route (ROUTE_MAP.md §9.2).
 *
 * THE SHELL GENUINELY EXISTS IN ALL THREE LOCALES, which is what makes listing
 * all three honest here: these are chrome, navigation and status surfaces, and
 * every one of them is fully translated. That is emphatically NOT a licence for
 * later phases to list three alternates for a Fatwa that exists only in Urdu —
 * "untranslated content is never listed as an alternate", and a content-bearing
 * route must decide its own alternates from the languages its content actually
 * has (§9.2, §9.8).
 *
 * `x-default` IS RESOLVED, NOT ASSUMED (§9.2.1). It points at the English
 * canonical URL because a canonical English version of a shell route exists;
 * the resolution is written as a condition rather than hard-coded, because for
 * the Urdu-original and Arabic-original corpus arriving in later phases the
 * answer will frequently be a different language, or none.
 */
function alternatesFor(route: AvailableRoute): Record<string, string> {
  const languages: Record<string, string> = {};

  for (const locale of localeSchema.options) {
    languages[locale] = absoluteUrl(pathFor(locale, route));
  }

  const english = languages['en'];
  if (english !== undefined) languages['x-default'] = english;

  return languages;
}

/** Metadata for one public shell route. */
export function shellMetadata({
  locale,
  route,
  title,
  description,
}: ShellMetadataInput): Metadata {
  const indexable = isIndexable(route);

  return {
    ...(title === undefined ? {} : { title }),
    ...(description === undefined ? {} : { description }),

    robots: indexable ? { index: true, follow: true } : { index: false, follow: false },

    ...(indexable
      ? {
          alternates: {
            canonical: absoluteUrl(pathFor(locale, route)),
            languages: alternatesFor(route),
          },
        }
      : {}),
  };
}
