import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import type { Locale } from '@minhaj/contracts';
import { leadImagePath, newsPathOf, type PublicNews } from '@minhaj/contracts/editorial';

import { absoluteUrl } from '@/config/origin';
import { contentMetadata } from '@/seo/metadata';

/**
 * The PURE presentation rules of Editorial's public pages: which translation a
 * reader is shown and what a News page claims to search engines. No read
 * runtime and no rendering here, so each rule is proved on its own
 * (`tests/editorial/news-presentation.test.ts`). How the News listings and the
 * archive read their addresses is `./news-view` (News & Events Part 1).
 */

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

/** Canonical, `hreflang` and `x-default` from the record's own languages. */
export function newsMetadata(record: PublicNews, locale: Locale) {
  const translation = translationFor(record, locale);
  const description = translation.seoDescription || translation.excerpt;
  return contentMetadata({
    locale,
    contentLocales: record.translations.map((row) => row.languageCode),
    primaryLocale: record.primaryLanguage,
    pathFor: (language) =>
      localizedPath(language, `${newsPathOf(record.kind, record.slug)}`),
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
  const url = absoluteUrl(
    localizedPath(language, `${newsPathOf(record.kind, record.slug)}`),
  );
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
            url: absoluteUrl(
              localizedPath(language, `/people/${encodeURIComponent(person.slug)}`),
            ),
          })),
        }
      : {}),
  };
}
