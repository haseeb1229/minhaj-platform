import { z } from 'zod';

import type { Locale } from '@minhaj/contracts';
import {
  labelFor,
  type CentreLabel,
  type PlaceLabel,
  type PublicPlace,
} from '@minhaj/contracts/global';

/**
 * The presentation rules every Global Network page shares — one implementation,
 * so a place name, a page link and a finder address read the same everywhere.
 */

type Query = Record<string, string | string[] | undefined>;

/**
 * The name a page renders and the language it is ACTUALLY in, so the markup can
 * say so (WCAG 3.1.2). A missing translation stays missing: the record's own
 * primary-language name is shown, marked as such, never a fabricated one.
 */
export function placeName(
  record: { readonly labels: readonly PlaceLabel[]; readonly primaryLocale: Locale },
  locale: Locale,
): { readonly text: string; readonly locale: Locale } {
  const label = labelFor(record, locale);
  return label === null
    ? { text: '', locale: record.primaryLocale }
    : { text: label.name, locale: label.locale };
}

/** A Centre's words in the reader's locale, by the same rule. */
export function centreWords(
  record: { readonly labels: readonly CentreLabel[]; readonly primaryLocale: Locale },
  locale: Locale,
): CentreLabel | null {
  return labelFor(record, locale);
}

/** The interface locales a record's names genuinely exist in. */
export function placeLocales(record: {
  readonly labels: readonly { readonly locale: Locale }[];
}): Locale[] {
  return record.labels.map((label) => label.locale);
}

/** A bounded page offset from one query key — malformed values are the first page. */
export function readOffsetOf(query: Query, key: string): number {
  const raw = query[key];
  return z.coerce
    .number()
    .int()
    .min(0)
    .max(25_000)
    .catch(0)
    .parse(typeof raw === 'string' && raw.length <= 8 ? raw : 0);
}

/** One query value as a slug candidate, or `null`. Validated again by the reader. */
function slugOf(query: Query, key: string): string | null {
  const raw = query[key];
  return typeof raw === 'string' && raw.length > 0 && raw.length <= 120 ? raw : null;
}

/** The finder's filters as the read service validates them. */
export function readFinderQuery(query: Query) {
  return {
    country: slugOf(query, 'country'),
    region: slugOf(query, 'region'),
    city: slugOf(query, 'city'),
    offset: readOffsetOf(query, 'offset'),
  };
}

/** A page address with its own query values, neutral ones omitted. */
export function withQuery(
  path: string,
  values: Readonly<Record<string, string | number | null>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== null && value !== 0 && value !== '') search.set(key, String(value));
  const encoded = search.toString();
  return encoded === '' ? path : `${path}?${encoded}`;
}

/** The finder's address for a scope. */
export function finderPath(
  locale: Locale,
  scope: {
    readonly country?: PublicPlace | null;
    readonly region?: PublicPlace | null;
    readonly city?: PublicPlace | null;
  },
): string {
  return withQuery(`/${locale}/global/find-a-centre`, {
    country: scope.country?.slug ?? null,
    region: scope.region?.slug ?? null,
    city: scope.city?.slug ?? null,
  });
}
