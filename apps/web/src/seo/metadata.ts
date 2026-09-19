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

/* ===========================================================================
 * Content-bearing routes
 * ========================================================================= */

/**
 * Which language version a content route should CLAIM as canonical, and which
 * versions it may advertise.
 *
 * SEPARATE FROM `shellMetadata`, AND NOT A GENERALISATION OF IT. The shell
 * genuinely exists in all three locales, so listing all three is honest there.
 * A Person, an Article or a Fatwa exists in the languages somebody actually
 * wrote it in — and ROUTE_MAP.md §9.2 is explicit that "untranslated content is
 * never listed as an alternate" and that "a URL that merely falls back to
 * another language is not a language version". Reusing the shell's helper for
 * content would announce three versions of a contributor who has one, which is
 * a false signal rather than a missing one.
 */
export interface ContentMetadataInput {
  /** The interface locale being rendered. */
  readonly locale: Locale;
  /**
   * The locales the CONTENT genuinely exists in. Never the platform's locale
   * list, and never widened by a fallback.
   */
  readonly contentLocales: readonly Locale[];
  /** The language the content was originally written in. */
  readonly primaryLocale: Locale;
  /** Builds the locale-prefixed path for one language version. */
  readonly pathFor: (locale: Locale) => string;
  readonly title: string;
  readonly description?: string;
}

/**
 * Resolves `x-default` per ROUTE_MAP.md §9.2.1, as a CONDITION rather than a
 * default.
 *
 *   1. a canonical English version exists → the English URL;
 *   2. no English version, but others exist → the content's ORIGINAL language,
 *      which is why `primaryLocale` is stored on the record rather than assumed;
 *   3. the original language somehow has no version → the first that does, so
 *      the answer is still a real page;
 *   4. no version exists at all → no `x-default`, and the page is not indexable.
 *
 * "Omitting `x-default` is correct and harmless when no suitable target exists.
 * Emitting a wrong one is not."
 */
function defaultLocaleFor(
  contentLocales: readonly Locale[],
  primaryLocale: Locale,
): Locale | null {
  if (contentLocales.includes('en')) return 'en';
  if (contentLocales.includes(primaryLocale)) return primaryLocale;
  return contentLocales[0] ?? null;
}

/**
 * Which language version the reader is actually being shown.
 *
 * The requested locale when it exists, and otherwise the same resolution the
 * read model performs — so the canonical URL points at the EXISTING-language
 * URL rather than at the fallback URL, exactly as §9.3 requires.
 */
export function resolvedContentLocale(
  input: Pick<ContentMetadataInput, 'locale' | 'contentLocales' | 'primaryLocale'>,
): Locale | null {
  if (input.contentLocales.includes(input.locale)) return input.locale;
  if (input.contentLocales.includes(input.primaryLocale)) return input.primaryLocale;
  return input.contentLocales[0] ?? null;
}

/**
 * May a content-bearing page claim anything at all?
 *
 * ONE FUNCTION, SO THE SIGNALS CANNOT DISAGREE. A page decides three things
 * from this: whether to emit `index, follow`, whether to emit a canonical link,
 * and whether to emit structured data. If each read the condition for itself,
 * the day one of them changed would be the day a page said `noindex` while
 * publishing a machine-readable claim about a real person — which is exactly
 * the over-claiming ROUTE_MAP.md §9.6 warns about.
 *
 * Both halves must hold: the DEPLOYMENT may be indexed (the pre-adoption origin
 * may not, and the control fails closed), and the CONTENT exists in at least
 * one genuine language version.
 */
export function isContentIndexable(input: {
  readonly contentLocales: readonly Locale[];
}): boolean {
  return publicIndexingEnabled() && input.contentLocales.length > 0;
}

/**
 * Metadata for one content-bearing public route.
 *
 * TWO INDEPENDENT CONDITIONS, as `shellMetadata` has, and a third of its own:
 *
 *   1. the DEPLOYMENT may be indexed at all — the pre-adoption origin may not,
 *      and the control fails closed (ROUTE_MAP.md §9.5);
 *   2. the CONTENT exists in at least one language, because a record with no
 *      language version has no canonical URL that is true (§9.3);
 *   3. the ALTERNATES are the content's own languages and nothing else.
 *
 * When indexing is off, the page emits `noindex, nofollow` AND NO CANONICAL AND
 * NO ALTERNATES — a canonical link is a claim that this URL is the one to
 * index, and a page that must not be indexed has no such claim to make.
 */
export function contentMetadata(input: ContentMetadataInput): Metadata {
  const resolved = resolvedContentLocale(input);
  const indexable = isContentIndexable(input) && resolved !== null;

  if (!indexable) {
    return {
      title: input.title,
      ...(input.description === undefined ? {} : { description: input.description }),
      robots: { index: false, follow: false },
    };
  }

  const languages: Record<string, string> = {};
  for (const contentLocale of input.contentLocales) {
    languages[contentLocale] = absoluteUrl(input.pathFor(contentLocale));
  }

  const fallbackLocale = defaultLocaleFor(input.contentLocales, input.primaryLocale);
  if (fallbackLocale !== null) {
    languages['x-default'] = absoluteUrl(input.pathFor(fallbackLocale));
  }

  return {
    title: input.title,
    ...(input.description === undefined ? {} : { description: input.description }),
    robots: { index: true, follow: true },
    alternates: {
      // THE EXISTING-LANGUAGE URL, not the URL that was requested. A page
      // serving Urdu because no English version exists must canonicalise to the
      // Urdu URL; canonicalising to itself would put two addresses forward for
      // one piece of content (§9.3).
      canonical: absoluteUrl(input.pathFor(resolved)),
      languages,
    },
  };
}

/**
 * Serialises JSON-LD without allowing stored text to terminate its script tag.
 *
 * JSON.stringify does not escape `<`; a contributor name containing
 * `</script>` would otherwise become markup when inserted with
 * dangerouslySetInnerHTML. The escape remains valid JSON and decodes back to
 * the exact stored text.
 */
export function serializeStructuredData(value: unknown): string {
  return JSON.stringify(value).replaceAll('<', '\\u003c');
}
