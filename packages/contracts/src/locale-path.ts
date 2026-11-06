import { localeSchema, type Locale } from './env/shared.ts';

/**
 * THE localised-URL contract (ROUTE_MAP.md §1.1, Rebaseline R1).
 *
 * English is the unprefixed interface locale: `/`, `/library`, `/watch/videos/x`.
 * Urdu and Arabic carry their prefix: `/ur/library`, `/ar/watch/videos/x`. A
 * request for `/en/…` is answered with ONE permanent redirect to the unprefixed
 * address (apps/web/src/proxy.ts).
 *
 * Every pathname the platform emits for a locale is built here and nowhere
 * else, so a link, a redirect, a canonical URL and the proxy can never disagree
 * about what a localised address looks like. Both helpers take and return a
 * PATHNAME (optionally with a query or fragment), never an origin, so nothing
 * passing through them can move a navigation off this site.
 */

/** The interface locale whose addresses carry no prefix. */
export const UNPREFIXED_LOCALE: Locale = 'en';

/**
 * The address of `path` in `locale`.
 *
 * `path` is the locale-free part: `''` or `'/'` for the locale's home, or a
 * pathname beginning with `/`, optionally followed by `?query` / `#fragment`;
 * a bare `?query` or `#fragment` addresses the locale's home with it.
 *
 * `locale` also accepts a plain string because many callers hold a locale that
 * was validated upstream as one; the builder distinguishes only the unprefixed
 * locale and prefixes every other value exactly as the template literals it
 * replaced did.
 */
export function localizedPath(locale: Locale | (string & {}), path: string): string {
  const rest = path === '/' ? '' : path;
  if (
    rest !== '' &&
    !rest.startsWith('/') &&
    !rest.startsWith('?') &&
    !rest.startsWith('#')
  )
    throw new Error('A localised path must be empty or begin with "/", "?" or "#".');
  if (locale === UNPREFIXED_LOCALE) {
    if (rest === '') return '/';
    return rest.startsWith('/') ? rest : `/${rest}`;
  }
  return `/${locale}${rest}`;
}

/** A pathname split into its interface locale and its locale-free part. */
export interface LocalePathParts {
  readonly locale: Locale;
  /** The locale-free pathname: `''` for a locale home, otherwise beginning with `/`. */
  readonly rest: string;
  /** Whether the pathname carried an explicit locale segment (including `/en`). */
  readonly prefixed: boolean;
}

/**
 * Splits a PATHNAME (no query) into locale and locale-free part.
 *
 * An unprefixed pathname is English. `/en` and `/en/…` are reported as
 * prefixed English so the proxy can send them to their canonical address.
 */
export function splitLocalePath(pathname: string): LocalePathParts {
  const segment = pathname.split('/', 2)[1] ?? '';
  const parsed = localeSchema.safeParse(segment);
  if (parsed.success) {
    const rest = pathname.slice(segment.length + 1);
    return { locale: parsed.data, rest: rest === '/' ? '' : rest, prefixed: true };
  }
  return {
    locale: UNPREFIXED_LOCALE,
    rest: pathname === '/' ? '' : pathname,
    prefixed: false,
  };
}
