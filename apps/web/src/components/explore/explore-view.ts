import { PAGE_BINDINGS } from '@minhaj/contracts/editorial';

import { OFFICIAL_CHANNELS } from '@/shell/official-channels';
import {
  EXPLORE_SECTIONS,
  exploreSlugsOf,
  ownerPathOf,
  type ExploreSection,
} from '@/shell/explore';

/**
 * EXPLORE'S PAGE MODEL (Explore, R2) — what each address in the allowlist is,
 * whether it is published, where it sits among its section's pages, and which
 * open parts of the platform already serve a reader who arrives before it is
 * published. PURE: it reads nothing, so every page decides the same way and a
 * unit test can hold every rule.
 *
 * NOTHING HERE IS CONTENT. Organisational words reach Explore only as
 * published Editorial Pages (OPEN_DECISIONS.md §6.1); this module names
 * addresses, registry route keys and the official-channel identifiers the
 * footer already lists, never a statement about the organisation.
 */

/**
 * What an Explore address is.
 *
 *   `page`      a destination an Editorial Page can be bound to;
 *   `listing`   one of the Shaykh-ul-Islam's four filtered listings, canonical
 *               to their domain collections (ROUTE_MAP.md §3.2) — no Page can
 *               be bound to it;
 *   `feed`      the feeds page, which describes feeds the site publishes — no
 *               Page can be bound to it either;
 *   `elsewhere` an item whose owner delivered it at its own address (the
 *               newsletter), which the Explore address redirects to.
 */
export type ExploreItemKind = 'page' | 'listing' | 'feed' | 'elsewhere';

/**
 * Where an Explore address stands. `null` when the published Pages could not
 * be read: then nothing is claimed either way.
 */
export type ExploreItemState = 'published' | 'awaiting' | 'elsewhere' | null;

export interface ExploreItem {
  readonly section: ExploreSection;
  readonly slug: string;
  readonly kind: ExploreItemKind;
  readonly state: ExploreItemState;
}

/** The items that are neither a Page nor delivered elsewhere. */
const NOT_PAGES: Readonly<Record<string, 'listing' | 'feed'>> = Object.freeze({
  'shaykh-ul-islam/books': 'listing',
  'shaykh-ul-islam/articles': 'listing',
  'shaykh-ul-islam/lectures': 'listing',
  'shaykh-ul-islam/collections': 'listing',
  'digital-resources/rss': 'feed',
});

/** The locale-relative address of a section, or of one of its pages. */
export function explorePath(section: ExploreSection, slug?: string): string {
  return slug === undefined ? `/explore/${section}` : `/explore/${section}/${slug}`;
}

/** What one allowlisted item is. */
export function exploreItemKind(section: ExploreSection, slug: string): ExploreItemKind {
  if (ownerPathOf(section, slug) !== null) return 'elsewhere';
  return NOT_PAGES[`${section}/${slug}`] ?? 'page';
}

/** Whether an Editorial Page may be bound to this Explore address. */
export function isPageAddress(path: string): boolean {
  return PAGE_BINDINGS.includes(path);
}

/** The published Page addresses, or `null` when they could not be read. */
export type PublishedAddresses = ReadonlySet<string> | null;

/** Every item a section reserves, in the allowlist's order, with its state. */
export function sectionItems(
  section: ExploreSection,
  published: PublishedAddresses,
): readonly ExploreItem[] {
  return exploreSlugsOf(section).map((slug) => {
    const kind = exploreItemKind(section, slug);
    const state: ExploreItemState =
      kind === 'elsewhere'
        ? 'elsewhere'
        : published === null
          ? null
          : kind === 'page' && published.has(explorePath(section, slug))
            ? 'published'
            : 'awaiting';
    return { section, slug, kind, state };
  });
}

/**
 * How many of a section's own items are published — the items delivered
 * elsewhere are not the section's to count — or `null` when unknown.
 */
export function publicationTally(
  items: readonly ExploreItem[],
): { readonly published: number; readonly total: number } | null {
  const own = items.filter((item) => item.kind !== 'elsewhere');
  if (own.some((item) => item.state === null)) return null;
  return {
    published: own.filter((item) => item.state === 'published').length,
    total: own.length,
  };
}

/** The tally across every section, or `null` when unknown. */
export function exploreTally(
  published: PublishedAddresses,
): { readonly published: number; readonly total: number } | null {
  return publicationTally(
    EXPLORE_SECTIONS.flatMap((section) => sectionItems(section, published)),
  );
}

/**
 * The pages either side of one in its section's own order. An item delivered
 * elsewhere is not one of the section's pages, so it is stepped over.
 */
export function neighboursOf(
  section: ExploreSection,
  slug: string,
): { readonly previous: string | null; readonly next: string | null } {
  const own = exploreSlugsOf(section).filter(
    (entry) => exploreItemKind(section, entry) !== 'elsewhere',
  );
  const index = own.indexOf(slug);
  if (index === -1) return { previous: null, next: null };
  return { previous: own[index - 1] ?? null, next: own[index + 1] ?? null };
}

/**
 * WHERE A READER IS SERVED NOW — registry route keys of open, delivered parts
 * of the platform. A page names its own; a page without its own, and every
 * section landing, names its section's.
 */
const ONWARD: Readonly<Record<string, readonly string[]>> = Object.freeze({
  // The sections.
  about: ['news-events', 'events', 'global', 'collections'],
  leadership: ['library.authors', 'watch.speakers', 'listen'],
  'shaykh-ul-islam': ['library.books', 'watch.lectures', 'listen.lectures', 'articles'],
  organization: ['global', 'find-a-centre', 'membership', 'contact'],
  'our-work': ['learn', 'library.research', 'events', 'collections'],
  community: ['find-a-centre', 'events', 'membership', 'newsletter', 'contact'],
  'digital-resources': ['newsletter', 'news-events', 'watch', 'listen'],
  // About.
  'about/introduction': ['global', 'news-events', 'collections'],
  'about/history': ['news.archive', 'collections'],
  'about/timeline': ['news.archive', 'events', 'collections'],
  'about/global-impact': ['global', 'global.countries', 'news-events'],
  // The Shaykh-ul-Islam.
  'shaykh-ul-islam/works': ['library.books', 'library.research', 'library.authors'],
  'shaykh-ul-islam/books': ['library.books', 'library.authors', 'library.downloads'],
  'shaykh-ul-islam/articles': ['articles', 'library.research'],
  'shaykh-ul-islam/lectures': ['watch.lectures', 'listen.lectures', 'watch.speakers'],
  'shaykh-ul-islam/collections': ['collections', 'watch.series', 'listen.series'],
  // The organisation.
  'organization/governance': ['contact', 'global'],
  'organization/departments': ['contact', 'global'],
  'organization/forums': ['global', 'events'],
  'organization/wings': ['global', 'events', 'find-a-centre'],
  'organization/institutions': ['global', 'find-a-centre', 'learn'],
  'organization/annual-reports': ['news.press-releases', 'library.publications'],
  'organization/un-recognition': ['news.statements', 'news-events'],
  'organization/awards': ['news-events', 'collections'],
  // Our work.
  'our-work/education': ['learn', 'learn.courses', 'library'],
  'our-work/research': [
    'library.research',
    'library.research-papers',
    'library.publications',
  ],
  'our-work/welfare': ['collections', 'events', 'donate'],
  'our-work/women': ['events', 'collections', 'news-events'],
  'our-work/youth': ['events', 'learn', 'find-a-centre'],
  'our-work/students': ['learn', 'events', 'library'],
  'our-work/interfaith': ['collections', 'library.books', 'news-events'],
  'our-work/human-rights': ['library.books', 'news.statements', 'library.research'],
  'our-work/peace': ['library.books', 'watch.lectures', 'news.statements'],
  // Digital resources.
  'digital-resources/mobile-apps': ['library.downloads', 'listen', 'watch'],
  'digital-resources/rss': ['news-events', 'newsletter'],
  'digital-resources/social-media': ['watch', 'news-events', 'newsletter'],
});

/** The open parts of the platform that serve this section, or this page of it. */
export function onwardOf(section: ExploreSection, slug?: string): readonly string[] {
  return (
    (slug === undefined ? undefined : ONWARD[`${section}/${slug}`]) ??
    ONWARD[section] ??
    []
  );
}

export type OfficialChannel = (typeof OFFICIAL_CHANNELS)[number];

/**
 * The organisation's official channels a page names — only from the footer's
 * evidenced list (`@/shell/official-channels`), never a new address.
 */
const CHANNELS: Readonly<Record<string, readonly OfficialChannel['id'][]>> =
  Object.freeze({
    'digital-resources': ['youtube', 'facebook', 'x', 'app-store', 'google-play'],
    'digital-resources/mobile-apps': ['app-store', 'google-play'],
    'digital-resources/social-media': ['youtube', 'facebook', 'x'],
  });

/** The official channels this section or page names, in the footer's order. */
export function channelsOf(
  section: ExploreSection,
  slug?: string,
): readonly OfficialChannel[] {
  const ids = slug === undefined ? CHANNELS[section] : CHANNELS[`${section}/${slug}`];
  if (ids === undefined) return [];
  return OFFICIAL_CHANNELS.filter((channel) => ids.includes(channel.id));
}
