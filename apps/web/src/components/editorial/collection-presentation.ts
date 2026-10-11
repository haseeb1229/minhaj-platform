import 'server-only';

import type { Locale } from '@minhaj/contracts';
import {
  COLLECTION_MAX_OFFSET,
  collectionPathOf,
  type CollectionMemberTarget,
  type PublicCollection,
} from '@minhaj/contracts/editorial';

import { translationFor } from '@/components/editorial/presentation';
import { contentMetadata } from '@/seo/metadata';

/**
 * The PURE presentation rules of the Collection pages (Phase 15): how
 * `/collections` is paged, which of a member's titles a reader is shown and what
 * a Collection page claims to search engines. No read runtime and no rendering
 * here, so each rule can be proved on its own.
 */

type Query = Record<string, string | string[] | undefined>;

/**
 * `?offset=`, bounded: one plain whole number no deeper than the listing goes.
 * Anything else — a repeated parameter, a sign, a fraction, an overlong or
 * out-of-range value — is the first page, never an error and never a wider read.
 */
export function readCollectionOffset(query: Query): number {
  const raw = query['offset'];
  if (typeof raw !== 'string' || !/^\d{1,8}$/u.test(raw)) return 0;
  const offset = Number(raw);
  return offset <= COLLECTION_MAX_OFFSET ? offset : 0;
}

/** The listing's address for an offset; the first page is the bare `/collections`. */
export function collectionsPath(locale: string, offset = 0): string {
  return `/${locale}/collections${offset > 0 ? `?offset=${offset}` : ''}`;
}

/**
 * The title a reader is shown for one member: the owner's title in the
 * interface locale when it has one, otherwise the first of its titles in a
 * stable language order — the owner states no preferred language here — and,
 * only when the owner states no title at all, its public slug. Never a title
 * the owner did not give.
 */
export function memberTitle(
  target: CollectionMemberTarget,
  locale: Locale,
): { readonly text: string; readonly languageCode: string | null } {
  const exact = target.titles.find(
    (row) => row.languageCode === locale && row.title !== '',
  );
  if (exact !== undefined) return { text: exact.title, languageCode: exact.languageCode };
  const other = [...target.titles]
    .filter((row) => row.title !== '')
    .sort((a, b) => (a.languageCode < b.languageCode ? -1 : 1))[0];
  return other === undefined
    ? { text: target.slug, languageCode: null }
    : { text: other.title, languageCode: other.languageCode };
}

/**
 * Canonical, `hreflang` and `x-default` from the Collection's own languages —
 * never widened by a fallback — and its own SEO words, else its title and
 * excerpt.
 */
export function collectionMetadata(record: PublicCollection, locale: Locale) {
  const translation = translationFor(record, locale);
  const description = translation.seoDescription || translation.excerpt;
  return contentMetadata({
    locale,
    contentLocales: record.translations.map((row) => row.languageCode),
    primaryLocale: record.primaryLanguage,
    pathFor: (language) => `/${language}${collectionPathOf(record.slug)}`,
    title: translation.seoTitle || translation.title,
    ...(description ? { description } : {}),
  });
}
