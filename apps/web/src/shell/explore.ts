/**
 * THE Explore allowlists (ROUTE_MAP.md §3.2).
 *
 * Explore is the one content area Phase 4 owns, and its shape is FIXED by the
 * route map rather than discovered at runtime. Every section and every page
 * beneath it is named here, so an unknown slug is a 404 by construction rather
 * than by a guard somebody has to remember to write.
 *
 * WHY AN ALLOWLIST RATHER THAN A CATCH-ALL. A catch-all `[page]` that rendered
 * a titled shell for whatever it was handed would answer `/explore/about/xyz`
 * with a page — an infinite surface of near-empty URLs, each of them a
 * candidate for indexing and none of them a resource the information
 * architecture curates (ROUTE_MAP.md §2.3). The slugs below are the complete
 * set; nothing else resolves.
 *
 * THESE ARE ROUTE RESERVATIONS, NOT CONTENT. Every page beneath a section is a
 * reserved shell carrying a non-authoritative publication-status state until
 * the Phase-6 Page workflow publishes the genuine record (DELIVERY_PLAN.md
 * Phase 4, OPEN_DECISIONS.md §6.1). Naming a route here authorises no
 * organisational claim on it.
 */

/** The Explore sections, in the order ROUTE_MAP.md §3.2 lists them. */
export const EXPLORE_SECTIONS = Object.freeze([
  'about',
  'leadership',
  'shaykh-ul-islam',
  'organization',
  'our-work',
  'community',
  'digital-resources',
] as const);

export type ExploreSection = (typeof EXPLORE_SECTIONS)[number];

/**
 * The pages each section reserves.
 *
 * A section with no pages — `leadership`, `community` — is a landing shell on
 * its own and has no `{page}` segment at all. Its absence here is what makes
 * `/explore/community/anything` a 404.
 */
export const EXPLORE_PAGES = Object.freeze({
  about: Object.freeze([
    'introduction',
    'vision',
    'mission',
    'values',
    'objectives',
    'history',
    'timeline',
    'global-impact',
  ] as const),

  /**
   * The biography pages, and then the four FILTERED LISTINGS.
   *
   * ROUTE_MAP.md §3.2 lists `books`, `articles`, `lectures` and `collections`
   * beside the biography pages, and describes them as listings canonical to
   * their domain collections. Library, Media and Editorial have not shipped, so
   * there is nothing to list and nothing to canonicalise to — they are reserved
   * shells like the rest, and they emit no canonical link at a URL that does
   * not exist yet (§9.1).
   */
  'shaykh-ul-islam': Object.freeze([
    'biography',
    'early-life',
    'education',
    'academic-work',
    'achievements',
    'works',
    'isnad',
    'views-of-dignitaries',
    'books',
    'articles',
    'lectures',
    'collections',
  ] as const),

  organization: Object.freeze([
    'governance',
    'departments',
    'forums',
    'wings',
    'institutions',
    'annual-reports',
    'un-recognition',
    'awards',
  ] as const),

  'our-work': Object.freeze([
    'education',
    'research',
    'welfare',
    'women',
    'youth',
    'students',
    'interfaith',
    'human-rights',
    'peace',
  ] as const),

  'digital-resources': Object.freeze([
    'mobile-apps',
    'newsletter',
    'rss',
    'social-media',
  ] as const),
} as const);

/** Sections that reserve pages beneath them. */
export type SectionWithPages = keyof typeof EXPLORE_PAGES;

/** Every reserved page slug of a section, or an empty list for a leaf section. */
export function exploreSlugsOf(section: ExploreSection): readonly string[] {
  return section in EXPLORE_PAGES
    ? EXPLORE_PAGES[section as SectionWithPages]
    : Object.freeze([]);
}

/**
 * Narrows an unvalidated path segment to a reserved page of a section.
 *
 * The segment arrives from the URL, so it is validated server-side rather than
 * trusted — the same rule the locale segment follows (SECURITY_BASELINE.md
 * §9.1).
 */
export function isExplorePage<S extends SectionWithPages>(
  section: S,
  value: string,
): value is (typeof EXPLORE_PAGES)[S][number] {
  return (EXPLORE_PAGES[section] as readonly string[]).includes(value);
}
