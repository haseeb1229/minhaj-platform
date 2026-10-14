export {
  EXPLORE_SECTIONS,
  EXPLORE_PAGES,
  exploreSlugsOf,
  isExplorePage,
} from '@minhaj/contracts/editorial';
export type { ExploreSection, SectionWithPages } from '@minhaj/contracts/editorial';

/**
 * Explore items whose owner has since delivered the real page. They link
 * there, and their reserved Explore address answers one permanent redirect to
 * it, so the resource keeps a single canonical URL (ROUTE_MAP.md §2.1).
 *
 * Phase 21: the newsletter is Personalisation's `/newsletter`.
 */
const DELIVERED_BY_OWNER: Readonly<Record<string, string>> = Object.freeze({
  'digital-resources/newsletter': '/newsletter',
});

/** Where an owner delivered this Explore item, or null while it is reserved. */
export function ownerPathOf(section: string, slug: string): string | null {
  return DELIVERED_BY_OWNER[`${section}/${slug}`] ?? null;
}

/** The locale-prefixed address an Explore item links to. */
export function exploreHrefOf(locale: string, section: string, slug: string): string {
  return `/${locale}${ownerPathOf(section, slug) ?? `/explore/${section}/${slug}`}`;
}
