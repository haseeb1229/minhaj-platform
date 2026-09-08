import { localeSchema, type Locale } from '@minhaj/contracts';

/**
 * Locale constants for the Phase 0B skeleton.
 *
 * Build-time, deliberately. Reading a runtime environment variable in the
 * render tree would force every public route to be dynamic and destroy the
 * caching capability ARCHITECTURE.md §8 requires — the regression this module
 * exists to avoid.
 *
 * `NEXT_PUBLIC_DEFAULT_LOCALE` is a build-time constant by construction: Next
 * inlines `NEXT_PUBLIC_` values during compilation, so reading it here is a
 * static substitution rather than a request-time lookup, and the page stays
 * statically renderable.
 *
 * This is NOT the final locale routing. ROUTE_MAP.md §1 specifies an
 * always-present locale path segment resolved per request, delivered by the
 * localisation phase together with next-intl. Phase 0B only needs `lang` and
 * `dir` to be correct, and to leave that future design unobstructed.
 */

/** RTL locales (ROUTE_MAP.md §1.2). */
const rtlLocales = new Set<Locale>(['ur', 'ar']);

/**
 * The locale used when the variable is absent (ROUTE_MAP.md §1.1).
 *
 * `.env.example` is valueless by policy (SECURITY_BASELINE.md §18.1), so an
 * unset OR blank variable is the documented, supported configuration and must
 * resolve to this.
 */
export const FALLBACK_LOCALE: Locale = 'en';

/**
 * Resolves the configured default locale.
 *
 * Two cases, deliberately different — Review #3 (N2) found them conflated:
 *
 *   - UNSET or BLANK  → `FALLBACK_LOCALE`. Nothing was configured, so the
 *     documented default applies. This is normal and not an error.
 *
 *   - PRESENT BUT INVALID → THROWS. Someone configured `NEXT_PUBLIC_DEFAULT_
 *     LOCALE=de` and meant it. The previous implementation used `.catch('en')`,
 *     which silently substituted English while the surrounding comment claimed
 *     invalid configuration fails the build. Silently discarding a deliberate
 *     value is the worse failure of the two: the build passes, the site renders
 *     in the wrong language and direction, and nothing anywhere says why.
 *
 * Exported so tests drive the real resolution rather than a copy of it.
 */
export function resolveDefaultLocale(raw: string | undefined): Locale {
  if (raw === undefined || raw.trim() === '') return FALLBACK_LOCALE;

  const result = localeSchema.safeParse(raw);

  if (!result.success) {
    // The variable name appears; the supplied value never does
    // (SECURITY_BASELINE.md §19.2). `NEXT_PUBLIC_` values are public by
    // definition, but the redaction habit is not worth breaking for one case.
    throw new Error(
      'Invalid NEXT_PUBLIC_DEFAULT_LOCALE. Supported locales are ' +
        `${localeSchema.options.join(', ')} (ROUTE_MAP.md §1.2). Leave the ` +
        `variable unset to use the documented default '${FALLBACK_LOCALE}'; an ` +
        'explicit value that is not a supported locale fails the build rather ' +
        'than silently rendering the wrong language and text direction.',
    );
  }

  return result.data;
}

/**
 * The default locale, validated at build time.
 *
 * An invalid explicit value fails the build rather than silently rendering the
 * wrong direction. Runtime server configuration is validated separately, before
 * the process listens (`apps/web/scripts/start.mjs`).
 */
export const defaultLocale: Locale = resolveDefaultLocale(
  process.env.NEXT_PUBLIC_DEFAULT_LOCALE,
);

/** Text direction for a locale. */
export function directionOf(locale: Locale): 'ltr' | 'rtl' {
  return rtlLocales.has(locale) ? 'rtl' : 'ltr';
}
