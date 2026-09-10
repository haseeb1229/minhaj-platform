import type { Locale } from '@minhaj/contracts';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import type { ReactNode } from 'react';

import { directionOf, isSupportedLocale } from '@/config/locale';
import { routing } from '@/i18n/routing';
import '@/styles/globals.css';

/**
 * The root layout for every application route.
 *
 * There is no unprefixed tree beside it. ROUTE_MAP.md §1.1 requires the locale
 * segment to be ALWAYS present, so `app/[locale]/layout.tsx` IS the root
 * layout — the one that renders `<html>` — rather than a second layout nested
 * inside an unprefixed one. Keeping both would mean `/quran` and `/en/quran`
 * could each answer, which is the duplicate-URL problem §1.1 exists to remove.
 *
 * A Server Component, as everything is unless it opts out (ARCHITECTURE.md §7).
 * Nothing here reads a request-time API: the locale arrives as a route
 * parameter, so the anonymous public tree keeps the caching capability
 * ARCHITECTURE.md §8 requires.
 */

/**
 * Prerenders all three locale roots.
 *
 * Together with `setRequestLocale` below, this is what keeps the tree static:
 * next-intl otherwise discovers the locale from a request header, and reading
 * one would make every route dynamic.
 */
export function generateStaticParams(): { locale: Locale }[] {
  return routing.locales.map((locale) => ({ locale }));
}

interface LocaleParams {
  readonly params: Promise<{ readonly locale: string }>;
}

/**
 * THE authoritative locale guard.
 *
 * `[locale]` is effectively a catch-all — `/de`, `/anything` — so the segment
 * arrives here as an unvalidated string, and it is validated against the
 * accepted locale set (SECURITY_BASELINE.md §9.1: server-side validation of
 * application-owned input is mandatory and independent of anything upstream).
 *
 * The proxy is a convenience, not a trust boundary. If its matcher changes, if
 * a request reaches Next without passing through it, or if a future edit
 * loosens it, an unsupported locale still cannot render as a valid localised
 * page: it fails closed, here, with a 404.
 */
async function requireLocale(params: LocaleParams['params']): Promise<Locale> {
  const { locale } = await params;

  if (!isSupportedLocale(locale)) notFound();

  return locale;
}

export async function generateMetadata({ params }: LocaleParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'metadata' });

  return {
    title: t('title'),
    description: t('description'),

    /**
     * Nothing is published yet, so the foundation must not be indexed — the
     * Phase 0B behaviour, preserved through the routing restructure.
     *
     * No `alternates` are declared, deliberately. Three interface locales now
     * exist, and it would be mechanical to advertise all three as language
     * versions of every page. That would be a false claim: an interface locale
     * is not evidence that the CONTENT exists in that language, and
     * ROUTE_MAP.md §9.2 requires every advertised alternate to be a genuine
     * canonical version. The content-aware canonical/`hreflang`/`x-default`
     * system is Phase 4's, and it needs content to reason about.
     */
    robots: { index: false, follow: false },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: LocaleParams & { readonly children: ReactNode }) {
  const locale = await requireLocale(params);

  /**
   * Hands the validated locale to next-intl for this render.
   *
   * This is what makes static rendering possible: without it, next-intl reads
   * the locale from a request header, which opts the whole tree into dynamic
   * rendering and destroys the public caching capability of ARCHITECTURE.md §8.
   *
   * The library marks this API deprecated in favour of `next/root-params`.
   * Next 16.3.3 exposes that replacement without an experimental flag, but
   * next-intl 4.14.3 still exports this API and explicitly identifies it as the
   * supported static-rendering stopgap. Phase 3A keeps the already validated
   * path; adopting the newer request-config pattern is not required for correct
   * routing or static generation in this locked combination.
   */
  setRequestLocale(locale);

  return (
    /**
     * `dir` is DERIVED from the locale, never guessed and never written by
     * hand at a call site (ARCHITECTURE.md §9). One mapping, in
     * `@/config/locale`, so English cannot drift to `rtl` in one place and
     * `ltr` in another.
     */
    <html lang={locale} dir={directionOf(locale)}>
      <body>{children}</body>
    </html>
  );
}
