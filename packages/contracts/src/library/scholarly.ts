import { z } from 'zod';

import { localeSchema, type Locale } from '../env/shared.ts';
import { CONTRIBUTION_ROLES, type ContributionRole } from '../people/values.ts';
import {
  libraryIdSchema,
  libraryLanguageCodeSchema,
  librarySlugSchema,
  libraryStateSchema,
  readerDocumentSchema,
  type LibraryState,
  type ReaderDocument,
} from './values.ts';

/**
 * Research, ResearchPaper, Publication, Magazine, MagazineIssue and Encyclopedia
 * — the scholarly and periodical aggregates of the Library (DOMAIN_MODEL.md
 * §10.2, DELIVERY_PLAN.md Phase 9).
 *
 * SIX AGGREGATES, NOT ONE WITH A TYPE COLUMN. Each has its own table, its own
 * slug namespace, its own typed contributor, topic and label relations, and —
 * where it has them — its own citations. What they SHARE is value shapes: a
 * localized label, a contributor credit, a citation, a set of date facts. Those
 * are defined once below and composed into six distinct input schemas, so a
 * rule about what a citation may contain cannot drift between Research and
 * ResearchPaper while the aggregates themselves stay apart.
 *
 * THE KIND VOCABULARY is a discriminator for DTOs and for the one adapter that
 * writes six typed tables. It is not a column anywhere: no row stores which
 * aggregate it is, because each table is only ever one.
 *
 * NOTHING HERE IS MARKUP. Titles, summaries, abstracts, institutional context,
 * venues and citations are plain text; long-form content is the Library's
 * existing semantic `ReaderDocument`. There is no HTML path from any of these
 * inputs to a rendered page, so there is nothing to sanitise.
 */

export const SCHOLARLY_KINDS = Object.freeze([
  'research',
  'research-paper',
  'publication',
  'magazine',
  'magazine-issue',
  'encyclopedia',
] as const);

export type ScholarlyKind = (typeof SCHOLARLY_KINDS)[number];

export const scholarlyKindSchema = z.enum(SCHOLARLY_KINDS);

/** The kinds with an address of their own, rather than one beneath a Magazine. */
export type StandaloneScholarlyKind = Exclude<ScholarlyKind, 'magazine-issue'>;

/**
 * Every bound in one place, each one enforced twice — here at the trust boundary
 * and again by a CHECK constraint or column size in SQL.
 */
export const SCHOLARLY_LIMITS = Object.freeze({
  title: 240,
  summary: 1000,
  abstract: 4000,
  institutionalContext: 500,
  venue: 300,
  publisher: 240,
  contributors: 24,
  topics: 24,
  citations: 100,
  citationText: 1000,
  url: 2000,
  doi: 200,
  /** Volume and issue numbers are positive and bounded, never invented. */
  issueNumber: 100_000,
  /** A Magazine carries at most this many issues, enforced when one is created. */
  issuesPerMagazine: 500,
});

/** One listing page. Matches the Work listing's page size. */
export const SCHOLARLY_PAGE = 25;

const text = (max: number) => z.string().trim().max(max);

/* ===========================================================================
 * Shared value shapes
 * ========================================================================= */

/**
 * LOCALIZED DESCRIPTIVE METADATA — a title and a summary in an interface locale.
 *
 * NOT A TRANSLATION. An English label on an Urdu research paper describes it for
 * an English-reading visitor; it is not an English version of the paper
 * (DOMAIN_MODEL.md §10.1). The paper's own language is `languageCode`.
 */
const scholarlyLabelSchema = z
  .object({
    locale: localeSchema,
    title: text(SCHOLARLY_LIMITS.title).min(1),
    summary: text(SCHOLARLY_LIMITS.summary),
  })
  .strict();

const contributorSchema = z
  .object({ personId: libraryIdSchema, role: z.enum(CONTRIBUTION_ROLES) })
  .strict();

/**
 * A DOI, in the character set Crossref recommends. The prefix is `10.` and a
 * registrant code; the suffix admits no whitespace, no quote and no angle
 * bracket, so a stored DOI can never break out of the link it is rendered into.
 */
const DOI_PATTERN = /^10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+$/;

const scholarlyDoiSchema = z.string().trim().max(SCHOLARLY_LIMITS.doi).regex(DOI_PATTERN);

/** HTTPS only, and never with credentials in it. */
const scholarlyHttpsUrlSchema = z
  .url()
  .max(SCHOLARLY_LIMITS.url)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && url.username === '' && url.password === '';
  });

/**
 * ONE CITATION: the reference as it is written, and — only where genuinely known
 * — a DOI and an HTTPS address for it.
 *
 * THE SMALLEST USEFUL SHAPE. No author list, no journal, no page range, no
 * citation-style engine and no lookup: the text is the citation, exactly as the
 * scholarly source gives it. Nothing is fetched from anywhere, and a DOI is
 * stored only because an operator typed one.
 */
const scholarlyCitationSchema = z
  .object({
    text: text(SCHOLARLY_LIMITS.citationText).min(1),
    url: scholarlyHttpsUrlSchema.nullable(),
    doi: scholarlyDoiSchema.nullable(),
  })
  .strict();

/**
 * A publication DATE is a date, never an instant (DOMAIN_MODEL.md §19.5). It is
 * carried as `YYYY-MM-DD` and stored in a SQL `date` column, so no timezone can
 * move it to the day before.
 *
 * WHEN BOTH ARE GIVEN THEY MUST AGREE, and a date alone supplies its year — a
 * record dated 2021-03-04 is a 2021 record, and saying otherwise would make the
 * year filter disagree with the page.
 */
const publicationYearSchema = z.number().int().min(1).max(9999).nullable();
const publishedOnSchema = z.iso.date().nullable();

const ids = (max: number) =>
  z
    .array(libraryIdSchema)
    .max(max)
    .refine((values) => new Set(values).size === values.length);

/** The fields every Phase-9 aggregate has. */
const describedShape = {
  slug: librarySlugSchema,
  primaryLocale: localeSchema,
  state: libraryStateSchema,
  labels: z.array(scholarlyLabelSchema).min(1).max(3),
  contributors: z.array(contributorSchema).max(SCHOLARLY_LIMITS.contributors),
  topicIds: ids(SCHOLARLY_LIMITS.topics),
};

/** The facts every aggregate with CONTENT has: a language and a date. */
const datedShape = {
  languageCode: libraryLanguageCodeSchema,
  publicationYear: publicationYearSchema,
  publishedOn: publishedOnSchema,
};

interface DescribedValue {
  readonly primaryLocale: Locale;
  readonly labels: readonly { readonly locale: Locale }[];
  readonly contributors: readonly { readonly personId: string; readonly role: string }[];
}

function describedRules(value: DescribedValue, ctx: z.RefinementCtx): void {
  if (
    !value.labels.some((label) => label.locale === value.primaryLocale) ||
    new Set(value.labels.map((label) => label.locale)).size !== value.labels.length
  )
    ctx.addIssue({
      code: 'custom',
      message: 'A unique primary locale label is required.',
    });
  if (
    new Set(value.contributors.map((entry) => `${entry.personId}:${entry.role}`)).size !==
    value.contributors.length
  )
    ctx.addIssue({ code: 'custom', message: 'Duplicate contribution.' });
}

interface DatedValue {
  readonly publicationYear: number | null;
  readonly publishedOn: string | null;
}

function datedRules(value: DatedValue, ctx: z.RefinementCtx): void {
  if (
    value.publishedOn !== null &&
    value.publicationYear !== null &&
    Number(value.publishedOn.slice(0, 4)) !== value.publicationYear
  )
    ctx.addIssue({ code: 'custom', message: 'The year and the date disagree.' });
}

/** A date supplies its own year, so the two can never be stored apart. */
function withYear<T extends DatedValue>(value: T): T {
  return value.publishedOn === null
    ? value
    : { ...value, publicationYear: Number(value.publishedOn.slice(0, 4)) };
}

/** Research and ResearchPaper: the scholarly apparatus a book does not have. */
const scholarshipShape = {
  institutionalContext: text(SCHOLARLY_LIMITS.institutionalContext).min(1).nullable(),
  abstract: text(SCHOLARLY_LIMITS.abstract).min(1).nullable(),
  citations: z.array(scholarlyCitationSchema).max(SCHOLARLY_LIMITS.citations),
};

/* ===========================================================================
 * The six inputs
 * ========================================================================= */

/** A research work: abstract, institutional context, citations, full text. */
export const researchInputSchema = z
  .object({
    ...describedShape,
    ...datedShape,
    ...scholarshipShape,
    document: readerDocumentSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    describedRules(value, ctx);
    datedRules(value, ctx);
  })
  .transform(withYear);

/**
 * A research PAPER: everything Research has, plus where it appeared and its own
 * DOI. Both are optional and both are facts an operator supplies — never a
 * venue or a DOI inferred from anything.
 */
export const researchPaperInputSchema = z
  .object({
    ...describedShape,
    ...datedShape,
    ...scholarshipShape,
    venue: text(SCHOLARLY_LIMITS.venue).min(1).nullable(),
    doi: scholarlyDoiSchema.nullable(),
    document: readerDocumentSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    describedRules(value, ctx);
    datedRules(value, ctx);
  })
  .transform(withYear);

const publishedShape = {
  ...describedShape,
  ...datedShape,
  publisher: text(SCHOLARLY_LIMITS.publisher).min(1).nullable(),
  document: readerDocumentSchema.nullable(),
};

/** A standalone publication — a report, a booklet, a pamphlet. */
export const publicationInputSchema = z
  .object(publishedShape)
  .strict()
  .superRefine((value, ctx) => {
    describedRules(value, ctx);
    datedRules(value, ctx);
  })
  .transform(withYear);

/** An encyclopedia, readable as a whole through its own sections. */
export const encyclopediaInputSchema = z
  .object(publishedShape)
  .strict()
  .superRefine((value, ctx) => {
    describedRules(value, ctx);
    datedRules(value, ctx);
  })
  .transform(withYear);

/**
 * THE PERIODICAL ITSELF. It has no content language and no date of its own —
 * its issues do — which is exactly the difference between a magazine and a
 * book (DOMAIN_MODEL.md §10.2).
 */
export const magazineInputSchema = z
  .object(describedShape)
  .strict()
  .superRefine((value, ctx) => describedRules(value, ctx));

const issueNumberSchema = z
  .number()
  .int()
  .min(1)
  .max(SCHOLARLY_LIMITS.issueNumber)
  .nullable();

/**
 * ONE ISSUE OF ONE MAGAZINE. Volume, number and date are first-class access paths
 * for a periodical, and each is optional because each must be genuine: an issue
 * without a printed number has none, rather than a number made up for ordering.
 */
export const magazineIssueInputSchema = z
  .object({
    ...describedShape,
    ...datedShape,
    magazineId: libraryIdSchema,
    volume: issueNumberSchema,
    issueNumber: issueNumberSchema,
    document: readerDocumentSchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    describedRules(value, ctx);
    datedRules(value, ctx);
  })
  .transform(withYear);

export const SCHOLARLY_INPUT_SCHEMAS = Object.freeze({
  research: researchInputSchema,
  'research-paper': researchPaperInputSchema,
  publication: publicationInputSchema,
  magazine: magazineInputSchema,
  'magazine-issue': magazineIssueInputSchema,
  encyclopedia: encyclopediaInputSchema,
});

type ResearchInput = z.infer<typeof researchInputSchema>;
type ResearchPaperInput = z.infer<typeof researchPaperInputSchema>;
type PublicationInput = z.infer<typeof publicationInputSchema>;
type EncyclopediaInput = z.infer<typeof encyclopediaInputSchema>;
type MagazineInput = z.infer<typeof magazineInputSchema>;
type MagazineIssueInput = z.infer<typeof magazineIssueInputSchema>;

/**
 * One validated input, tagged with its aggregate. Stated as an explicit union so a
 * port that accepts it names every shape it can receive.
 */
export type ScholarlyValue =
  | { readonly kind: 'research'; readonly value: ResearchInput }
  | { readonly kind: 'research-paper'; readonly value: ResearchPaperInput }
  | { readonly kind: 'publication'; readonly value: PublicationInput }
  | { readonly kind: 'magazine'; readonly value: MagazineInput }
  | { readonly kind: 'magazine-issue'; readonly value: MagazineIssueInput }
  | { readonly kind: 'encyclopedia'; readonly value: EncyclopediaInput };

export type ScholarlyLabel = z.infer<typeof scholarlyLabelSchema>;
export type ScholarlyCitation = z.infer<typeof scholarlyCitationSchema>;

/* ===========================================================================
 * Records
 * ========================================================================= */

interface ScholarlyCommon {
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly state: LibraryState;
  readonly labels: readonly ScholarlyLabel[];
  readonly contributors: readonly {
    readonly personId: string;
    readonly role: ContributionRole;
  }[];
  readonly topicIds: readonly string[];
  readonly version: number;
  readonly updatedAt: Date;
}

interface ScholarlyDated {
  /** The CONTENT language, a Taxonomy reference. Never the interface locale. */
  readonly languageCode: string;
  readonly publicationYear: number | null;
  /** `YYYY-MM-DD`, a date and not an instant. */
  readonly publishedOn: string | null;
  readonly document: ReaderDocument | null;
}

interface ScholarlyCited {
  readonly institutionalContext: string | null;
  readonly abstract: string | null;
  readonly citations: readonly ScholarlyCitation[];
}

export interface ResearchRecord extends ScholarlyCommon, ScholarlyDated, ScholarlyCited {
  readonly kind: 'research';
}

export interface ResearchPaperRecord
  extends ScholarlyCommon, ScholarlyDated, ScholarlyCited {
  readonly kind: 'research-paper';
  readonly venue: string | null;
  readonly doi: string | null;
}

export interface PublicationRecord extends ScholarlyCommon, ScholarlyDated {
  readonly kind: 'publication';
  readonly publisher: string | null;
}

export interface EncyclopediaRecord extends ScholarlyCommon, ScholarlyDated {
  readonly kind: 'encyclopedia';
  readonly publisher: string | null;
}

export interface MagazineRecord extends ScholarlyCommon {
  readonly kind: 'magazine';
}

export interface MagazineIssueRecord extends ScholarlyCommon, ScholarlyDated {
  readonly kind: 'magazine-issue';
  readonly magazineId: string;
  readonly magazine: {
    readonly slug: string;
    readonly primaryLocale: Locale;
    readonly labels: readonly ScholarlyLabel[];
  };
  readonly volume: number | null;
  readonly issueNumber: number | null;
}

export type ScholarlyRecord =
  | ResearchRecord
  | ResearchPaperRecord
  | PublicationRecord
  | EncyclopediaRecord
  | MagazineRecord
  | MagazineIssueRecord;

export type ScholarlyRecordOf<K extends ScholarlyKind> = Extract<
  ScholarlyRecord,
  { readonly kind: K }
>;

/**
 * One row of a listing: what a card or a table row shows, and nothing heavy.
 *
 * No abstract, no citations and no document — a listing of 25 research papers
 * does not read 25 full texts to print 25 titles.
 */
export interface ScholarlyListing {
  readonly kind: ScholarlyKind;
  readonly id: string;
  readonly slug: string;
  readonly primaryLocale: Locale;
  readonly state: LibraryState;
  readonly labels: readonly ScholarlyLabel[];
  /** `null` for a Magazine, which has no content language of its own. */
  readonly languageCode: string | null;
  readonly publicationYear: number | null;
  readonly publishedOn: string | null;
  /** Present for a MagazineIssue only. */
  readonly issue: {
    readonly magazineSlug: string;
    readonly volume: number | null;
    readonly issueNumber: number | null;
  } | null;
  readonly version: number;
  readonly updatedAt: Date;
}

export interface ScholarlyListingPage {
  readonly items: readonly ScholarlyListing[];
  readonly hasMore: boolean;
}

/* ===========================================================================
 * Queries
 * ========================================================================= */

/**
 * A public listing's filters. The same bounds as the Work listing, and the same
 * rule: a filter NARROWS the public predicate and can never widen it.
 */
export const scholarlyQuerySchema = z
  .object({
    offset: z.number().int().min(0).max(25_000).default(0),
    language: z.string().max(16).nullable().default(null),
    topic: libraryIdSchema.nullable().default(null),
    from: publicationYearSchema.default(null),
    to: publicationYearSchema.default(null),
  })
  .strict()
  .refine((value) => value.from === null || value.to === null || value.from <= value.to);

export type ScholarlyQuery = z.infer<typeof scholarlyQuerySchema>;

/** The administrative directory's filters: a state and, for issues, the Magazine. */
export const scholarlyAdminQuerySchema = z
  .object({
    offset: z.number().int().min(0).max(25_000).default(0),
    state: libraryStateSchema.nullable().default(null),
    magazineId: libraryIdSchema.nullable().default(null),
  })
  .strict();

export type ScholarlyAdminQuery = z.infer<typeof scholarlyAdminQuerySchema>;

/* ===========================================================================
 * Derived reads — sitemap and search
 * ========================================================================= */

export interface ScholarlySitemapRow {
  readonly slug: string;
  /** The Magazine's current slug, for an issue; `null` otherwise. */
  readonly magazineSlug: string | null;
  readonly locales: readonly string[];
  readonly updatedAt: Date;
}

/**
 * What Search may know about one public Phase-9 record.
 *
 * PUBLIC FIELDS ONLY, read through the same public predicate the pages use. The
 * text is plain — abstract, institutional context, venue, citations and the
 * readable document — and never markup; no private note, no draft and no asset
 * exists on these aggregates to leak.
 */
export interface ScholarlySearchRecord {
  readonly kind: ScholarlyKind;
  readonly id: string;
  /** Opaque; moves whenever anything this projection reads moves. */
  readonly stamp: string;
  readonly primaryLocale: Locale;
  readonly labels: readonly ScholarlyLabel[];
  readonly languageCode: string | null;
  readonly publicationYear: number | null;
  readonly topicIds: readonly string[];
  /** The record's own words, in its content language. */
  readonly text: readonly string[];
  /** For an issue, its Magazine's labels, so an issue is found by its periodical's name. */
  readonly parentLabels: readonly ScholarlyLabel[];
}

export interface ScholarlyTarget {
  readonly id: string;
  readonly slug: string;
  readonly magazineSlug: string | null;
}
