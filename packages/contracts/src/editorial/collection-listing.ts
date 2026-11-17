import { z } from 'zod';

import {
  COLLECTION_MAX_OFFSET,
  COLLECTION_PAGE,
  type CollectionMemberKind,
  type CollectionSummary,
} from './collection.ts';
import { editorialIdSchema } from './values.ts';

/**
 * NEWS & EVENTS PART 2 — `/collections` AS ITS PUBLIC PAGE READS IT
 * (DOMAIN_MODEL.md §7.3.1; ROUTE_MAP.md §3.9): one bounded page with the
 * view's total for numbered pages, and the counted facets the listing is
 * navigated by — Topic, what a Collection holds and its content language —
 * in two orders.
 *
 * THE ORDINARY PUBLIC PREDICATE THROUGHOUT. Only a PUBLISHED Collection is
 * listed or counted, and only its CURRENT revision's Topics, translations and
 * members are read. A filter only ever NARROWS that predicate.
 *
 * WHAT A "KIND" COUNTS. A Collection holds a kind when its current revision
 * names at least one member of that kind in the kind's typed column(s) —
 * articles, the four News families together as "news", books (Works) or
 * videos. Whether that member is public NOW is its OWNER's answer, asked at
 * Layer 4 when the Collection is shown (a withdrawn member is omitted there);
 * this read never joins Library's or Media's tables, so a kind counts the
 * places the curator made, not the owners' current verdicts. The same is true
 * of the `entries` figure: the places the published current revisions hold.
 *
 * TAXONOMY IS NAMED AT LAYER 4. A Topic is answered as its identifier; its
 * name is resolved by its owner, a whole page at once.
 */

/** One page of the listing. */
export const COLLECTION_LISTING_PAGE = COLLECTION_PAGE;

/** The Topic facet names at most this many Topics, the commonest first. */
export const COLLECTION_FACET_PAGE = 50;

/**
 * What a Collection may hold, as a reader asks for it: articles, news (the
 * four News families together), books and videos — in the listing's order.
 */
export const COLLECTION_HOLDS = Object.freeze([
  'article',
  'news',
  'work',
  'video',
] as const);
export const collectionHoldsSchema = z.enum(COLLECTION_HOLDS);
export type CollectionHolds = z.infer<typeof collectionHoldsSchema>;

/** Which of the four a member of one stored kind is counted under. */
export function holdsOf(kind: CollectionMemberKind): CollectionHolds {
  return kind === 'article' || kind === 'work' || kind === 'video' ? kind : 'news';
}

/** The content languages a Collection may be written in. */
export const COLLECTION_LANGUAGES = Object.freeze(['en', 'ur', 'ar'] as const);
export const collectionLanguageSchema = z.enum(COLLECTION_LANGUAGES);
export type CollectionLanguage = z.infer<typeof collectionLanguageSchema>;

/**
 * The listing's orders, by FIRST publication: the most recent first (the
 * default), or the earliest. A title order is not offered: a Collection's
 * titles are in up to three languages and scripts, and no one collation
 * orders them meaningfully for every reader.
 */
export const COLLECTION_LISTING_SORTS = Object.freeze(['newest', 'oldest'] as const);
export const collectionListingSortSchema = z.enum(COLLECTION_LISTING_SORTS);
export type CollectionListingSort = z.infer<typeof collectionListingSortSchema>;

/** One view of the listing. Every member optional except the order and the page. */
export const collectionListingQuerySchema = z.strictObject({
  topic: editorialIdSchema.nullable().default(null),
  holds: collectionHoldsSchema.nullable().default(null),
  language: collectionLanguageSchema.nullable().default(null),
  sort: collectionListingSortSchema.default('newest'),
  offset: z.number().int().min(0).max(COLLECTION_MAX_OFFSET).default(0),
  limit: z
    .number()
    .int()
    .min(1)
    .max(COLLECTION_LISTING_PAGE)
    .default(COLLECTION_LISTING_PAGE),
});
export type CollectionListingQuery = z.infer<typeof collectionListingQuerySchema>;

export interface CollectionListingPage {
  readonly items: readonly CollectionSummary[];
  /** How many published Collections the view admits in all. */
  readonly total: number;
  readonly hasMore: boolean;
}

/**
 * The listing's aggregates.
 *
 *   `all`        every published Collection, never narrowed: how many, how
 *                many member places their current revisions hold, and how
 *                many content languages they are written in;
 *   the rest     each value with how many Collections choosing it would show
 *                UNDER EVERY OTHER FILTER, its own left out. `holds` names all
 *                four kinds, a kind no Collection holds counted 0;
 *   `anyKind`    the Collections the view's Topic and language admit, whatever
 *                they hold — the "every kind" tab (a Collection holding two
 *                kinds is one Collection, so it is not the kinds' sum).
 */
export interface CollectionListingFacets {
  readonly all: {
    readonly collections: number;
    readonly entries: number;
    readonly languages: number;
  };
  readonly topics: {
    readonly items: readonly { readonly id: string; readonly collections: number }[];
    readonly hasMore: boolean;
  };
  readonly holds: readonly {
    readonly holds: CollectionHolds;
    readonly collections: number;
  }[];
  readonly anyKind: number;
  readonly languages: readonly {
    readonly code: CollectionLanguage;
    readonly collections: number;
  }[];
}
