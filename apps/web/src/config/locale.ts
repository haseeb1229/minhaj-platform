import { localeSchema, UNPREFIXED_LOCALE, type Locale } from '@minhaj/contracts';

/**
 * Locale PROPERTIES — the direction and the endonym of each supported locale.
 *
 * This module deliberately owns no locale LIST. `localeSchema` in
 * `@minhaj/contracts` is the single definition of the three supported interface
 * locales (ROUTE_MAP.md §1.2), and `apps/web/src/i18n/routing.ts` derives the
 * routing locales from it. Two lists would drift, and the drift would be
 * silent.
 *
 * WHAT THIS MODULE NO LONGER DOES — and why
 * -----------------------------------------
 * Phase 0B resolved a CONFIGURABLE default locale here, from
 * `NEXT_PUBLIC_DEFAULT_LOCALE`, because no locale routing existed yet and
 * something had to decide the single `<html lang>` the skeleton rendered.
 *
 * The routing contract decides it instead (ROUTE_MAP.md §1.1). Since
 * Rebaseline R1 the ADDRESS alone decides the interface locale: an unprefixed
 * path is English, `/ur/…` Urdu, `/ar/…` Arabic — no cookie and no
 * `Accept-Language` header is consulted. The unprefixed locale is a fixed
 * contract (`UNPREFIXED_LOCALE`), never an environment variable: a deployment
 * file that could move it would contradict the accepted routing contract.
 */

/** RTL locales (ROUTE_MAP.md §1.2). */
const rtlLocales = new Set<Locale>(['ur', 'ar']);

/**
 * The interface locale of an unprefixed address (ROUTE_MAP.md §1.1, R1).
 *
 * A fixed contract, not configuration: it is `UNPREFIXED_LOCALE` from the
 * locale-path contract, and the `defaultLocale` of the next-intl routing
 * configuration.
 */
export const FALLBACK_LOCALE: Locale = UNPREFIXED_LOCALE;

/** Text direction for a locale. */
export function directionOf(locale: Locale): 'ltr' | 'rtl' {
  return rtlLocales.has(locale) ? 'rtl' : 'ltr';
}

/**
 * The direction of a record's DESCRIPTION, given its label's direction. One
 * label holds one locale for the title and the description, and a migrated
 * record can pair a romanised title with an Urdu description (Phase 30-RV):
 * under a left-to-right label the description takes its direction from its
 * own text; a right-to-left label's description stays right-to-left.
 */
export function descriptionDirection(dir: 'ltr' | 'rtl'): 'rtl' | 'auto' {
  return dir === 'rtl' ? 'rtl' : 'auto';
}

/**
 * Each locale's name IN ITS OWN LANGUAGE AND SCRIPT.
 *
 * Endonyms, deliberately — and deliberately NOT in the message catalogues.
 * A language's own name does not change with the interface language: the Urdu
 * option reads اردو whether the surrounding page is English, Urdu or Arabic.
 * Translating it would produce "Urdu" for a reader who cannot read the Latin
 * script, which is precisely the audience the option exists for (WCAG 2.2,
 * and the reason `lang`/`dir` are set per label at the call site).
 *
 * Keeping them here rather than in `messages/*.json` also means the three
 * catalogues cannot drift into disagreeing about what a language is called.
 */
const localeEndonyms: Readonly<Record<Locale, string>> = Object.freeze({
  en: 'English',
  ur: 'اردو',
  ar: 'العربية',
});

/** A locale's name in its own language, for a language-choice control. */
export function endonymOf(locale: Locale): string {
  return localeEndonyms[locale];
}

/**
 * Narrows an unvalidated route segment to a supported locale.
 *
 * The `[locale]` segment is effectively a catch-all: proxy routing is a
 * convenience, not the trust boundary, so the render tree validates the value
 * it was handed rather than trusting that something upstream already did
 * (SECURITY_BASELINE.md §9.1 — server-side validation of application-owned
 * input is mandatory and independent).
 */
export function isSupportedLocale(value: string): value is Locale {
  return localeSchema.safeParse(value).success;
}
