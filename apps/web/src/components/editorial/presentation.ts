import 'server-only';

import { z } from 'zod';

import type { Locale } from '@minhaj/contracts';
import {
  NEWS_EARLIEST_YEAR,
  NEWS_MAX_OFFSET,
  leadImagePath,
  newsPathOf,
  type PublicNews,
} from '@minhaj/contracts/editorial';

import { absoluteUrl } from '@/config/origin';
import { contentMetadata } from '@/seo/metadata';

/**
 * The PURE presentation rules of Editorial's public pages: which translation a
 * reader is shown, what a News page claims to search engines, and how the News
 * queries are read. No read runtime and no rendering here, so each rule is
 * proved on its own (`tests/editorial/news-presentation.test.ts`).
 */

type Query = Record<string, string | string[] | undefined>;

/**
 * The translation a reader is shown: the requested locale when the record has
 * it, otherwise the record's own primary language — never a fabricated one.
 */
export function translationFor<T extends { readonly languageCode: Locale }>(
  record: { readonly translations: readonly T[]; readonly primaryLanguage: Locale },
  locale: Locale,
): T {
  const translation =
    record.translations.find((row) => row.languageCode === locale) ??
    record.translations.find((row) => row.languageCode === record.primaryLanguage);
  if (!translation) throw new Error('Published editorial translation is missing.');
  return translation;
}

/** `?offset=`, bounded; anything else is the first page. */
export function readNewsOffset(query: Query): number {
  const raw = query['offset'];
  return z.coerce
    .number()
    .int()
    .min(0)
    .max(NEWS_MAX_OFFSET)
    .catch(0)
    .parse(typeof raw === 'string' && raw.length <= 8 ? raw : 0);
}

/**
 * The archive's `?year=` and `?month=`, TOLERATED: a malformed or impossible
 * value is simply absent, and a month without a year means nothing. The read
 * service validates again.
 */
export function readNewsArchiveQuery(query: Query): {
  readonly year: number | null;
  readonly month: number | null;
  readonly offset: number;
} {
  const whole = (key: string, pattern: RegExp): number | null => {
    const raw = query[key];
    return typeof raw === 'string' && pattern.test(raw) ? Number(raw) : null;
  };
  const rawYear = whole('year', /^\d{4}$/);
  const year =
    rawYear !== null && rawYear >= NEWS_EARLIEST_YEAR && rawYear <= 9998 ? rawYear : null;
  const rawMonth = whole('month', /^\d{1,2}$/);
  const month =
    year !== null && rawMonth !== null && rawMonth >= 1 && rawMonth <= 12
      ? rawMonth
      : null;
  return { year, month, offset: readNewsOffset(query) };
}

/** The archive's address for a year, a month and an offset, neutral values omitted. */
export function newsArchivePath(
  locale: string,
  filter: { readonly year: number | null; readonly month: number | null },
  offset = 0,
): string {
  const search = new URLSearchParams();
  if (filter.year !== null) search.set('year', String(filter.year));
  if (filter.year !== null && filter.month !== null)
    search.set('month', String(filter.month));
  if (offset > 0) search.set('offset', String(offset));
  const encoded = search.toString();
  return `/${locale}/news/archive${encoded === '' ? '' : `?${encoded}`}`;
}

/** Canonical, `hreflang` and `x-default` from the record's own languages. */
export function newsMetadata(record: PublicNews, locale: Locale) {
  const translation = translationFor(record, locale);
  const description = translation.seoDescription || translation.excerpt;
  return contentMetadata({
    locale,
    contentLocales: record.translations.map((row) => row.languageCode),
    primaryLocale: record.primaryLanguage,
    pathFor: (language) => `/${language}${newsPathOf(record.kind, record.slug)}`,
    title: translation.seoTitle || translation.title,
    ...(description ? { description } : {}),
  });
}

/**
 * STRUCTURED DATA, ONLY WHAT IS TRUE. `NewsArticle` for a NewsArticle, a press
 * release and a statement (ROUTE_MAP.md §9.6): headline, language, address,
 * the record's chronology as its publication date (its source's own date where
 * a migrated record states one — Phase 30-R) and its modification instant,
 * its own first-party lead image where it has one — and, for a NewsArticle or
 * a press release, the People credited as its authors. No publisher, no logo:
 * the pre-adoption origin claims no organisation. A statement's authority is an institution, not a person, so no
 * author is claimed for it. MEDIA COVERAGE CLAIMS NO ARTICLE AT ALL — the
 * coverage is a third party's, and the page is only a summary of it — so it is
 * `null` here and carries a BreadcrumbList alone.
 */
export function newsStructuredData(
  record: PublicNews,
  locale: Locale,
  authors: readonly { readonly slug: string; readonly name: string }[],
): Record<string, unknown> | null {
  if (record.kind === 'media-coverage') return null;
  const translation = translationFor(record, locale);
  const language = translation.languageCode;
  const url = absoluteUrl(`/${language}${newsPathOf(record.kind, record.slug)}`);
  return {
    '@context': 'https://schema.org',
    '@type': 'NewsArticle',
    headline: translation.title.slice(0, 110),
    inLanguage: language,
    url,
    mainEntityOfPage: url,
    ...(record.leadImage ? { image: absoluteUrl(leadImagePath(record.leadImage)) } : {}),
    datePublished: (record.chronologyAt ?? record.publishedAt).toISOString(),
    dateModified: record.updatedAt.toISOString(),
    ...(record.kind !== 'statement' && authors.length > 0
      ? {
          author: authors.map((person) => ({
            '@type': 'Person',
            name: person.name,
            url: absoluteUrl(`/${language}/people/${encodeURIComponent(person.slug)}`),
          })),
        }
      : {}),
  };
}
