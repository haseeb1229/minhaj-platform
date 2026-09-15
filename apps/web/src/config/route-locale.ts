import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';

import { isSupportedLocale } from './locale';

/**
 * Narrows a route's `[locale]` segment, or renders 404.
 *
 * `[locale]` is effectively a catch-all, so every page validates the segment it
 * was handed rather than trusting that the proxy already did. The proxy is a
 * convenience, not a trust boundary: a request that never passes through it —
 * a matcher change, a direct hit on a prefixed path — must still fail closed
 * (SECURITY_BASELINE.md §9.1).
 *
 * Declared once so there is ONE rule, and so a new route cannot quietly
 * acquire a laxer one.
 *
 * WHY IT IS NOT IN `./locale.ts`. That module is the platform's locale
 * vocabulary — a schema, a list, an endonym table — and it is imported by the
 * request helpers and by tests that have no framework around them. `notFound()`
 * drags Next's navigation module in behind it, so keeping the two apart is
 * what lets the vocabulary stay testable on its own.
 */
export async function requireLocale(
  params: Promise<{ readonly locale: string }>,
): Promise<Locale> {
  const { locale } = await params;
  if (!isSupportedLocale(locale)) notFound();
  return locale;
}
