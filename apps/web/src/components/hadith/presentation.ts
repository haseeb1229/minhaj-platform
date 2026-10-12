import { z } from 'zod';

import type { Locale } from '@minhaj/contracts';
import {
  HADITH_NAME_LOCALES,
  hadithCollectionSlugSchema,
  hadithNumberSegment,
  hadithSlugSchema,
  type HadithCollectionNameRecord,
  type HadithScienceTextRecord,
  type HadithStructureNameRecord,
  type PublicHadithScience,
  type PublicHadithScienceSummary,
} from '@minhaj/contracts/hadith';

import { isSupportedLocale } from '@/config/locale';

/**
 * Presentation decisions for the public Hadith surfaces — PURE and free of
 * React (ROUTE_MAP.md §3.4; DELIVERY_PLAN.md Phase 19).
 *
 * Which address a citation, a collection, a book, a chapter or a study page
 * has; which name a structure is shown under; which offset a URL asks for. Each
 * has ONE implementation: the pages, the sitemap and the search labels all call
 * these, so no two can spell a citation differently.
 *
 * THE SHORT CITATION IS THE ONLY HADITH ENTITY ADDRESS. `/hadith/{collection}/
 * {number}` names one public citation; the structural pages list citations and
 * link to it, and no deeper detail address exists (ROUTE_MAP.md §2.1).
 *
 * NOTHING HERE KNOWS WHAT ANY HADITH SAYS. No collection, book, chapter,
 * number or grading is written here — every such fact arrives from the reader.
 */

type Query = Record<string, string | string[] | undefined>;

const part = (value: string) => encodeURIComponent(value);

/* ===========================================================================
 * Addresses — locale-free first, then prefixed once
 * ========================================================================= */

/** The LOCALE-FREE canonical citation of one Hadith (ROUTE_MAP.md §2.1). */
export function hadithCitationPath(collectionSlug: string, number: number): string {
  return `/hadith/${part(collectionSlug)}/${String(number)}`;
}

export function citationHref(locale: string, collectionSlug: string, number: number) {
  return `/${locale}${hadithCitationPath(collectionSlug, number)}`;
}

/** The Hadith section address under a locale: `/{locale}/hadith[/{section}]`. */
export function hadithPath(locale: string, section = ''): string {
  return section === '' ? `/${locale}/hadith` : `/${locale}/hadith/${section}`;
}

export function collectionPathOf(slug: string): string {
  return `/hadith/collections/${part(slug)}`;
}

export function collectionPath(locale: string, slug: string): string {
  return `/${locale}${collectionPathOf(slug)}`;
}

export function collectionBooksPathOf(slug: string): string {
  return `${collectionPathOf(slug)}/books`;
}

export function bookPathOf(collectionSlug: string, bookSlug: string): string {
  return `${collectionBooksPathOf(collectionSlug)}/${part(bookSlug)}`;
}

export function chapterPathOf(
  collectionSlug: string,
  bookSlug: string,
  chapterSlug: string,
): string {
  return `${bookPathOf(collectionSlug, bookSlug)}/chapters/${part(chapterSlug)}`;
}

export function sciencePathOf(slug: string): string {
  return `/hadith/sciences/${part(slug)}`;
}

export function hadithTopicPath(locale: string, topicSlug: string): string {
  return `/${locale}/hadith/topics/${part(topicSlug)}`;
}

/** One step of a page's breadcrumb, as both the trail and its structured data name it. */
export interface TrailStep {
  readonly name: string;
  readonly path: string;
}

/**
 * The breadcrumb of a citation page — Home, Hadith, the collection, its book,
 * its chapter when it has one, and the citation itself at its SHORT canonical
 * address. One implementation for the visible trail and the `BreadcrumbList`,
 * so the two can never disagree.
 */
export function citationTrail(input: {
  readonly locale: string;
  readonly home: string;
  readonly hadith: string;
  readonly collection: { readonly slug: string; readonly name: string };
  readonly book: { readonly slug: string; readonly name: string };
  readonly chapter: { readonly slug: string; readonly name: string } | null;
  readonly citation: { readonly number: number; readonly name: string };
}): readonly TrailStep[] {
  const { locale, collection, book, chapter } = input;
  return [
    { name: input.home, path: `/${locale}` },
    { name: input.hadith, path: hadithPath(locale) },
    { name: collection.name, path: collectionPath(locale, collection.slug) },
    { name: book.name, path: `/${locale}${bookPathOf(collection.slug, book.slug)}` },
    ...(chapter === null
      ? []
      : [
          {
            name: chapter.name,
            path: `/${locale}${chapterPathOf(collection.slug, book.slug, chapter.slug)}`,
          },
        ]),
    {
      name: input.citation.name,
      path: citationHref(locale, collection.slug, input.citation.number),
    },
  ];
}

/* ===========================================================================
 * Path segments
 * ========================================================================= */

/** A collection's slug from a path segment — never one of the section's own words. */
export function readCollectionSegment(value: string): string | null {
  return hadithCollectionSlugSchema.safeParse(value).success ? value : null;
}

/** A book's, chapter's or study page's slug from a path segment, or `null`. */
export function readSlugSegment(value: string): string | null {
  return hadithSlugSchema.safeParse(value).success ? value : null;
}

/** A citation number from a path segment — canonical decimal, within the range. */
export function readNumberSegment(value: string): number | null {
  return hadithNumberSegment(value);
}

/* ===========================================================================
 * Paging
 * ========================================================================= */

/** A plain `?offset=`, bounded; anything else is the first page. */
export function readHadithOffset(query: Query): number {
  const raw = query['offset'];
  return z.coerce
    .number()
    .int()
    .min(0)
    .max(1_000_000)
    .catch(0)
    .parse(typeof raw === 'string' && /^\d{1,7}$/.test(raw) ? raw : 0);
}

/** A paged address. The first page is the bare address. */
export function offsetPathOf(path: string, offset: number): string {
  return offset <= 0 ? path : `${path}?offset=${String(offset)}`;
}

/** The previous and next page offsets of a bounded page, or `null` at an end. */
export function pageLinks(
  offset: number,
  size: number,
  total: number,
): { readonly previous: number | null; readonly next: number | null } {
  return {
    previous: offset > 0 ? Math.max(0, offset - size) : null,
    next: offset + size < total ? offset + size : null,
  };
}

/* ===========================================================================
 * Languages
 * ========================================================================= */

/** Scripts written right to left, by their language subtag. */
const RTL_LANGUAGES = new Set([
  'ar',
  'ur',
  'fa',
  'he',
  'ps',
  'sd',
  'ug',
  'yi',
  'ckb',
  'dv',
]);

/**
 * The direction of a content language Taxonomy does not describe, derived from
 * its primary subtag. Taxonomy's own `Language.direction` is preferred
 * wherever it exists; this is the fallback, so Arabic is right-to-left in every
 * interface locale even before the vocabulary names it.
 */
export function derivedDirection(code: string): 'ltr' | 'rtl' {
  const primary = code.split('-')[0]?.toLowerCase() ?? '';
  return RTL_LANGUAGES.has(primary) ? 'rtl' : 'ltr';
}

/* ===========================================================================
 * Labels
 * ========================================================================= */

/** Locales tried, in order, after the interface locale's own. */
const NAME_ORDER: readonly Locale[] = HADITH_NAME_LOCALES;

/**
 * A collection's display name for an interface locale: the operator's own for
 * that locale when recorded, otherwise the first that exists — returned WITH the
 * locale it is actually in, so the element is marked with that language rather
 * than passed off as a translation. `null` when no name was recorded at all;
 * the page then shows the collection's slug.
 */
export function collectionName(
  names: readonly HadithCollectionNameRecord[],
  locale: Locale,
): {
  readonly text: string;
  readonly locale: Locale;
  readonly description: string | null;
} | null {
  for (const candidate of [locale, ...NAME_ORDER]) {
    const name = names.find((entry) => entry.locale === candidate);
    if (name !== undefined && name.name !== '')
      return { text: name.name, locale: candidate, description: name.description };
  }
  return null;
}

/**
 * A book's or chapter's display name: the operator's name for the interface
 * locale (or the first recorded), else the SOURCE'S own title in its own
 * language, else `null` — and the page then says "Book {reference}" with the
 * source's reference exactly as given.
 */
export function structureName(
  structure: {
    readonly names: readonly HadithStructureNameRecord[];
    readonly title: string | null;
    readonly titleLanguage: string | null;
  },
  locale: Locale,
): { readonly text: string; readonly language: string } | null {
  for (const candidate of [locale, ...NAME_ORDER]) {
    const name = structure.names.find((entry) => entry.locale === candidate);
    if (name !== undefined && name.name !== '')
      return { text: name.name, language: candidate };
  }
  return structure.title === null || structure.titleLanguage === null
    ? null
    : { text: structure.title, language: structure.titleLanguage };
}

/* ===========================================================================
 * Sciences — the language a page is shown in
 * ========================================================================= */

/**
 * The text of a study page a visitor sees: the interface locale's when the
 * source supplied one, otherwise the first it did — and the page then SAYS it
 * is showing another language rather than passing it off as a translation.
 */
export function scienceTextFor(
  science: Pick<PublicHadithScience, 'texts'>,
  locale: Locale,
): { readonly text: HadithScienceTextRecord; readonly fallback: boolean } | null {
  const own = science.texts.find((text) => text.languageCode === locale);
  if (own !== undefined) return { text: own, fallback: false };
  const first = science.texts[0];
  return first === undefined ? null : { text: first, fallback: true };
}

/** A listing's title for a study page, in the interface locale when it exists. */
export function scienceTitleFor(
  science: Pick<PublicHadithScienceSummary, 'titles'>,
  locale: Locale,
): { readonly title: string; readonly languageCode: string } | null {
  return (
    science.titles.find((entry) => entry.languageCode === locale) ??
    science.titles[0] ??
    null
  );
}

/** The interface locales a study page genuinely has text in — its `hreflang` set. */
export function scienceLocales(science: Pick<PublicHadithScience, 'texts'>): Locale[] {
  return science.texts.flatMap((text) =>
    isSupportedLocale(text.languageCode) ? [text.languageCode] : [],
  );
}

/* ===========================================================================
 * Hadith search — what is passed to the shared Search service
 * ========================================================================= */

/** One parameter as one string; a repeated parameter is its first value. */
function single(query: Query, name: string): string {
  const value = query[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : '';
}

/** The only parameters this page passes to Search — and the type, fixed. */
export function hadithSearchRequest(query: Query): Record<string, string> {
  const q = single(query, 'q');
  const page = single(query, 'page');
  return {
    q,
    type: 'hadith',
    ...(page === '' ? {} : { page }),
  };
}
