import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import type { Locale } from '@minhaj/contracts';
import {
  collectionPathOf,
  type CollectionMemberTarget,
  type PublicCollection,
} from '@minhaj/contracts/editorial';

import type { CollectionOrder } from '@/components/editorial/collections-view';
import { translationFor } from '@/components/editorial/presentation';
import { contentMetadata } from '@/seo/metadata';

/**
 * The PURE presentation rules of the Collection pages (Phase 15): the order a
 * Collection's members are read in, which of a member's titles a reader is
 * shown and what a Collection page claims to search engines. The addresses are
 * `./collections-view` (News & Events Part 2). No read runtime and no rendering
 * here, so each rule can be proved on its own.
 */

/**
 * The members in the chosen order. The curated order is kept as given. A date
 * order is STABLE — members of the same instant keep their curated order — and
 * a member whose owner states no date follows every dated one, in its curated
 * place; nothing is given a date it does not have.
 */
export function orderMembers<T extends { readonly target: CollectionMemberTarget }>(
  members: readonly T[],
  order: CollectionOrder,
): readonly T[] {
  if (order === 'curated') return members;
  const time = (member: T) => member.target.chronologyAt?.getTime() ?? null;
  return members
    .map((member, index) => ({ member, index, at: time(member) }))
    .sort((a, b) => {
      if (a.at === null || b.at === null)
        return a.at === b.at ? a.index - b.index : a.at === null ? 1 : -1;
      const by = order === 'newest' ? b.at - a.at : a.at - b.at;
      return by === 0 ? a.index - b.index : by;
    })
    .map((entry) => entry.member);
}

/**
 * The UTC year of a member's date, for grouping a date-ordered Collection — or
 * `null` for a member without one.
 */
export function memberYear(target: CollectionMemberTarget): number | null {
  return target.chronologyAt === null || target.chronologyAt === undefined
    ? null
    : target.chronologyAt.getUTCFullYear();
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
    pathFor: (language) => localizedPath(language, `${collectionPathOf(record.slug)}`),
    title: translation.seoTitle || translation.title,
    ...(description ? { description } : {}),
  });
}
