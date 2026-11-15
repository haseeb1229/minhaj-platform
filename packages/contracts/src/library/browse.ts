import { z } from 'zod';

import { localeSchema, type Locale } from '../env/shared.ts';
import type { ContributionRole } from '../people/values.ts';
import {
  libraryIdSchema,
  libraryLanguageCodeSchema,
  type LibraryCover,
} from './values.ts';

/**
 * LIBRARY PART 2 — THE LIBRARY'S BROWSE AND ACCESS READS (DOMAIN_MODEL.md
 * §10.1–§10.2; ROUTE_MAP.md §3.6): what `/library/resources`,
 * `/library/authors`, `/library/topics`, `/library/languages`,
 * `/library/downloads` and `/library/sale-points` are built on.
 *
 * EACH IS ONE BOUNDED, GROUPED READ under the ordinary public predicate of
 * every aggregate it counts — a Work is public while it is published with a
 * published Edition; a Research, ResearchPaper, Publication, Encyclopedia or
 * Magazine while it is published; an issue while it and its Magazine are; a
 * sale point while it is published — so each count is what the listing it
 * leads to shows. Library holds identifiers of Persons, Topics and Languages
 * and nothing of their names: the pages resolve those from their owners at
 * Layer 4.
 */

/**
 * The Library-owned kinds a Topic or a content language can narrow, each with
 * a public listing that takes that filter. A Magazine has a Topic but no
 * content language of its own (its issues have one, and no listing narrows
 * them by it), so it is absent from the language kinds. Articles are
 * Editorial's, never counted here.
 */
export const LIBRARY_BROWSE_KINDS = Object.freeze([
  'work',
  'research',
  'research-paper',
  'publication',
  'encyclopedia',
  'magazine',
] as const);
export type LibraryBrowseKind = (typeof LIBRARY_BROWSE_KINDS)[number];

export const LIBRARY_LANGUAGE_KINDS = Object.freeze([
  'work',
  'research',
  'research-paper',
  'publication',
  'encyclopedia',
] as const);

/** How many public records of one kind a Topic or a language holds (never zero). */
export interface LibraryKindCount {
  readonly kind: LibraryBrowseKind;
  readonly count: number;
}

/** Per Topic asked about: its public records by kind. A Topic with none is absent. */
export interface LibraryTopicHoldings {
  readonly topic: string;
  readonly kinds: readonly LibraryKindCount[];
}

/**
 * Per content language: its public records by kind — a Work once for each
 * language one of its published Editions is in, a dated record in its own
 * language. A language with none is absent.
 */
export interface LibraryLanguageHoldings {
  readonly language: string;
  readonly kinds: readonly LibraryKindCount[];
}

/** The most language rows one holdings read returns (languages × kinds). */
export const LIBRARY_LANGUAGE_HOLDINGS_MAX = 600;

/**
 * The whole Library by kind — what `/library/resources` states. Every figure
 * is a count of PUBLIC records; `editions` and `downloadableEditions` count
 * published Editions of public Works, the second those whose stored
 * availability allows a download with a file recorded (the decision the asset
 * route enforces). `topics`, `languages` and `contributors` are the distinct
 * Topics filed on, content languages written in and Persons credited on a
 * public Work.
 */
export interface LibraryHoldings {
  readonly works: number;
  readonly readableWorks: number;
  readonly downloadableWorks: number;
  readonly editions: number;
  readonly downloadableEditions: number;
  readonly research: number;
  readonly researchPapers: number;
  readonly publications: number;
  readonly encyclopedias: number;
  readonly magazines: number;
  readonly magazineIssues: number;
  readonly salePoints: number;
  readonly topics: number;
  readonly languages: number;
  readonly contributors: number;
}

/* ===========================================================================
 * The contributor directory (`/library/authors`)
 * ========================================================================= */

/**
 * The most Persons one directory read names: bounded, ordered by the public
 * Works they are credited on (most first), then by identifier. The page
 * resolves their names from People in batches and orders them by name.
 */
export const LIBRARY_CONTRIBUTOR_DIRECTORY_MAX = 1000;

/** One Person credited on a public Work: the Works, and the Works per role. */
export interface LibraryContributorEntry {
  readonly personId: string;
  /** Distinct public Works crediting them in any role. */
  readonly works: number;
  /** Per role they hold, in `CONTRIBUTION_ROLES` order, the Works in it (never zero). */
  readonly roles: readonly { readonly role: ContributionRole; readonly works: number }[];
}

export interface LibraryContributorDirectory {
  readonly items: readonly LibraryContributorEntry[];
  /** More Persons are credited than the read's bound returned. */
  readonly hasMore: boolean;
}

/* ===========================================================================
 * Downloads (`/library/downloads`)
 * ========================================================================= */

export const LIBRARY_DOWNLOADS_PAGE = 24;

/**
 * Which downloadable Editions a page lists: every published Edition of a
 * public Work whose stored availability allows a download and records a file,
 * narrowed by its content language and its Work's Topic, ordered by the title
 * a reader of `titleLocale` is shown (then the Edition's label) or by its
 * publication year (newest first, undated last). Every order ends on the
 * Edition's identifier, so a page never repeats or skips one.
 */
export const libraryDownloadsQuerySchema = z
  .object({
    language: libraryLanguageCodeSchema.nullable().default(null),
    topic: libraryIdSchema.nullable().default(null),
    sort: z.enum(['title', 'newest']).default('title'),
    titleLocale: localeSchema.nullable().default(null),
    offset: z.number().int().min(0).max(25_000).default(0),
    limit: z
      .number()
      .int()
      .min(1)
      .max(LIBRARY_DOWNLOADS_PAGE)
      .default(LIBRARY_DOWNLOADS_PAGE),
  })
  .strict();
export type LibraryDownloadsQuery = z.infer<typeof libraryDownloadsQuerySchema>;

/**
 * One downloadable Edition: its facts, its own cover, the file the asset
 * route serves (`/assets/library/editions/{editionId}/download/{assetId}`)
 * and its Work's address and titles. Nothing about any other Edition.
 */
export interface LibraryDownload {
  readonly editionId: string;
  readonly assetId: string;
  readonly label: string;
  readonly languageCode: string;
  readonly publisher: string | null;
  readonly publicationYear: number | null;
  readonly pageCount: number | null;
  readonly cover: LibraryCover | null;
  readonly work: {
    readonly id: string;
    readonly slug: string;
    readonly primaryLocale: Locale;
    readonly labels: readonly { readonly locale: Locale; readonly title: string }[];
  };
}

export interface LibraryDownloadPage {
  readonly items: readonly LibraryDownload[];
  /** How many Editions the query admits in all. */
  readonly total: number;
  readonly hasMore: boolean;
}

/**
 * The aggregates `/library/downloads` is navigated by: the unfiltered
 * downloadable Editions, the Works they belong to and their content
 * languages; and the languages and Topics, each counting the Editions it
 * would show under the query's other filter.
 */
/** One download facet: a content-language code or a Topic identifier, and its Editions. */
export interface LibraryDownloadFacetPage {
  readonly items: readonly { readonly id: string; readonly editions: number }[];
  readonly hasMore: boolean;
}

export interface LibraryDownloadFacets {
  readonly editions: number;
  readonly works: number;
  readonly languageCount: number;
  readonly languages: LibraryDownloadFacetPage;
  readonly topics: LibraryDownloadFacetPage;
}

/* ===========================================================================
 * Sale points (`/library/sale-points`)
 * ========================================================================= */

export const LIBRARY_SALE_POINT_PAGE = 24;
/** How many of a sale point's books one directory entry names. */
export const LIBRARY_SALE_POINT_WORKS = 6;

/**
 * Which published sale points a page lists, A–Z by name: all of them, or those
 * whose name or address contains `text` (a place, a street, a shop's name).
 * The text is a bound parameter matched literally — no wildcard it carries
 * is honoured.
 */
export const librarySalePointQuerySchema = z
  .object({
    text: z.string().trim().min(1).max(80).nullable().default(null),
    titleLocale: localeSchema.nullable().default(null),
    offset: z.number().int().min(0).max(25_000).default(0),
  })
  .strict();
export type LibrarySalePointQuery = z.infer<typeof librarySalePointQuerySchema>;

/**
 * One published sale point as the directory shows it: the public business
 * facts an operator entered — never more — and the public Works it is
 * recorded as selling (how many, and the first few by title).
 */
export interface LibrarySalePointEntry {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly contact: string;
  readonly url: string | null;
  readonly works: {
    readonly total: number;
    readonly items: readonly {
      readonly id: string;
      readonly slug: string;
      readonly primaryLocale: Locale;
      readonly labels: readonly { readonly locale: Locale; readonly title: string }[];
    }[];
  };
}

export interface LibrarySalePointPage {
  readonly items: readonly LibrarySalePointEntry[];
  /** How many sale points the query admits in all. */
  readonly total: number;
  readonly hasMore: boolean;
  /** Unfiltered: every published sale point, and the public Works sold through them. */
  readonly all: { readonly salePoints: number; readonly works: number };
}
