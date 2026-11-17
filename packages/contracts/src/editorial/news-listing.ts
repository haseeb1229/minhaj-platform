import { z } from 'zod';

import {
  NEWS_EARLIEST_YEAR,
  NEWS_LIMITS,
  NEWS_MAX_OFFSET,
  NEWS_PAGE,
  newsKindSchema,
  type NewsKind,
  type NewsSummary,
} from './news.ts';
import { editorialIdSchema, editorialSlugSchema } from './values.ts';

/**
 * NEWS & EVENTS PART 1 — ONE NEWS FAMILY'S LISTING, AS ITS PUBLIC PAGES READ IT
 * (DOMAIN_MODEL.md §7.2.2; ROUTE_MAP.md §3.9): `/news` (NewsArticles) and the
 * press-release, statement and media-coverage listings are ONE listing,
 * parameterised by the family, with counted filters, two orders, a total for
 * numbered pages, and a record's place among its own family.
 *
 * THE ORDINARY PUBLIC PREDICATE THROUGHOUT. Only a PUBLISHED record of the
 * named family is listed or counted, and only its CURRENT revision's Topics,
 * translations and outlet are read. A filter only ever NARROWS that predicate;
 * none can widen it.
 *
 * THE DATE IS THE RECORD'S CHRONOLOGY (Phase 30-R): a NewsArticle's or a
 * PressRelease's `chronologyAt` (its source's own publication date where a
 * migrated record states one), a Statement's or a MediaCoverage record's
 * publication instant — the order and the year and month every view reads.
 *
 * PEOPLE AND TAXONOMY ARE NAMED AT LAYER 4. Editorial answers identifiers — a
 * Topic is a Taxonomy identifier, a language a code — and every name is
 * resolved by its owner, a whole page at once. An OUTLET is the coverage
 * record's own words, so it is answered as text.
 */

/** One page of a News listing. */
export const NEWS_LISTING_PAGE = NEWS_PAGE;

/** A facet names at most this many values, the commonest first. */
export const NEWS_FACET_PAGE = 50;

/** The content languages a News record may be written in. */
export const NEWS_LANGUAGES = Object.freeze(['en', 'ur', 'ar'] as const);
export const newsLanguageSchema = z.enum(NEWS_LANGUAGES);
export type NewsLanguage = z.infer<typeof newsLanguageSchema>;

/** The listing's orders: the most recent first (the default), or the earliest. */
export const NEWS_LISTING_SORTS = Object.freeze(['newest', 'oldest'] as const);
export const newsListingSortSchema = z.enum(NEWS_LISTING_SORTS);
export type NewsListingSort = z.infer<typeof newsListingSortSchema>;

/** An outlet as a coverage record names it — and as a filter may ask for it. */
export const newsOutletSchema = z.string().trim().min(1).max(NEWS_LIMITS.outlet);

/**
 * One view of one family. `year` and `month` are UTC calendar values of the
 * chronology, a month only with its year; `outlet` belongs to media coverage
 * alone; `prefer` only ORDERS — in the newest-first order, the records with a
 * translation in that language come first, each group still newest first —
 * and means nothing once `language` narrows the view or the order is oldest
 * first.
 */
export const newsListingQuerySchema = z
  .strictObject({
    kind: newsKindSchema,
    topic: editorialIdSchema.nullable().default(null),
    year: z.number().int().min(NEWS_EARLIEST_YEAR).max(9998).nullable().default(null),
    month: z.number().int().min(1).max(12).nullable().default(null),
    language: newsLanguageSchema.nullable().default(null),
    outlet: newsOutletSchema.nullable().default(null),
    prefer: newsLanguageSchema.nullable().default(null),
    sort: newsListingSortSchema.default('newest'),
    offset: z.number().int().min(0).max(NEWS_MAX_OFFSET).default(0),
    limit: z.number().int().min(1).max(NEWS_LISTING_PAGE).default(NEWS_LISTING_PAGE),
  })
  .refine((query) => query.month === null || query.year !== null, {
    message: 'A month needs its year.',
    path: ['month'],
  })
  .refine((query) => query.outlet === null || query.kind === 'media-coverage', {
    message: 'Only media coverage names an outlet.',
    path: ['outlet'],
  });
export type NewsListingQuery = z.infer<typeof newsListingQuerySchema>;

export interface NewsListingPage {
  readonly items: readonly NewsSummary[];
  /** How many published records the view admits in all. */
  readonly total: number;
  readonly hasMore: boolean;
}

/** The Topic facet: Topics commonest first (at most `NEWS_FACET_PAGE`), and whether more exist. */
export interface NewsTopicFacet {
  readonly items: readonly { readonly id: string; readonly records: number }[];
  readonly hasMore: boolean;
}

/** The outlet facet (media coverage): outlets commonest first, bounded the same way. */
export interface NewsOutletFacet {
  readonly items: readonly { readonly name: string; readonly records: number }[];
  readonly hasMore: boolean;
}

/**
 * The listing's aggregates.
 *
 *   `all`        the whole family, never narrowed: how many records, how many
 *                content languages they are written in, the first and last
 *                year of their chronology, and (media coverage) how many
 *                outlets they name;
 *   `kinds`      every family's published records under this view's Topic,
 *                year, month and language — the family tabs, which keep those
 *                filters (an outlet is coverage's own and is not kept);
 *   the rest     each value with how many records choosing it would show
 *                UNDER EVERY OTHER FILTER, its own left out. `months` only
 *                once a year is chosen; `outlets` only for media coverage.
 */
export interface NewsListingFacets {
  readonly all: {
    readonly records: number;
    readonly languages: number;
    readonly firstYear: number | null;
    readonly lastYear: number | null;
    readonly outlets: number;
  };
  readonly kinds: readonly { readonly kind: NewsKind; readonly records: number }[];
  readonly topics: NewsTopicFacet;
  readonly years: readonly { readonly year: number; readonly records: number }[];
  readonly months: readonly { readonly month: number; readonly records: number }[];
  readonly languages: readonly {
    readonly code: NewsLanguage;
    readonly records: number;
  }[];
  readonly outlets: NewsOutletFacet;
}

/**
 * WHERE ONE RECORD STANDS AMONG ITS FAMILY: the published record just newer
 * and just older than it in the family's newest-first order (chronology, then
 * identifier) — only while the record named is itself published.
 */
export const newsNeighboursQuerySchema = z.strictObject({
  kind: newsKindSchema,
  slug: editorialSlugSchema,
});
export type NewsNeighboursQuery = z.infer<typeof newsNeighboursQuerySchema>;

export interface NewsNeighbours {
  readonly newer: NewsSummary | null;
  readonly older: NewsSummary | null;
}
