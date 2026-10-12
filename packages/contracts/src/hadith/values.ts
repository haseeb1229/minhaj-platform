import { z } from 'zod';

import { exactText, hasControlCharacter, labelText } from '../exact-text.ts';

/**
 * Hadith — a first-class religious context, structurally parallel to the Quran
 * and never merged with it (DOMAIN_MODEL.md §9; DELIVERY_PLAN.md Phase 19).
 *
 * THE SOURCE IS THE IDENTITY. A record is identified by its COLLECTION, SOURCE
 * SYSTEM, EDITION and the source's own REFERENCE, kept exactly as supplied. A
 * bare number is never a platform-wide key: the same apparent number names
 * different narrations across collections, editions and systems, and here they
 * coexist without colliding.
 *
 * THE PUBLIC CITATION IS A SEPARATE, REVIEWED MAPPING. `/hadith/{collection}/
 * {number}` names exactly one source-qualified record — a record that declared
 * that number as its intended citation, verified at its current version, with
 * no conflict evidence against the citation. Variants coexist; nothing chooses
 * a winner silently.
 *
 * NOTHING HERE KNOWS WHAT ANY HADITH SAYS. No collection, edition, number,
 * grading, grader or narrator is written into this repository; each arrives
 * only from authorised personnel against a source the operator registered, and
 * the bounds below are structural ceilings, never a claim about a corpus.
 *
 * GRADINGS AND CHAINS ARE SOURCED DATA. A grading is the grader's own words and
 * the reference where they were published; there is no grade vocabulary, rank
 * or equivalence. A chain is the source's own text; no narrator is parsed,
 * inferred or linked (DOMAIN_MODEL.md §9; PRODUCT_SCOPE.md §4.4).
 */

/* ===========================================================================
 * Structural identity
 * ========================================================================= */

/** A ceiling on a collection-local public citation number — not a corpus size. */
export const HADITH_NUMBER_MAX = 999_999;

export const hadithNumberSchema = z.number().int().min(1).max(HADITH_NUMBER_MAX);

/** A path segment that is a canonical decimal citation number and nothing else. */
export function hadithNumberSegment(value: string): number | null {
  if (!/^[1-9][0-9]{0,5}$/.test(value)) return null;
  const number = Number(value);
  return number <= HADITH_NUMBER_MAX ? number : null;
}

export const hadithIdSchema = z.uuid();

/** Immutable once chosen: the column refuses UPDATE, so no slug history is owed. */
export const hadithSlugSchema = z
  .string()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/**
 * The words the Hadith section already uses as a first path segment. A
 * collection's slug shares that segment with them in `/hadith/{collectionSlug}/
 * {hadithNumber}`, so none may be a collection's slug; the database refuses
 * them too.
 */
export const HADITH_RESERVED_SLUGS = Object.freeze([
  'introduction',
  'collections',
  'browse',
  'search',
  'topics',
  'sciences',
  'commentary',
  'books',
  'videos',
  'articles',
  'research',
  'courses',
  'scholars',
] as const);

export const hadithCollectionSlugSchema = hadithSlugSchema.refine(
  (slug) => !(HADITH_RESERVED_SLUGS as readonly string[]).includes(slug),
  'This word is a Hadith section path.',
);

export const hadithVersionSchema = z.number().int().positive().max(2_147_483_646);

/** A content-language reference, in the shape Taxonomy's `Language.code` takes. */
export const hadithLanguageCodeSchema = z
  .string()
  .min(2)
  .max(16)
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);

/**
 * A source's own reference — a record's number in its edition, a book's or a
 * chapter's — exactly as supplied: present, bounded, unpadded and free of every
 * control character. It is refused, never trimmed or renumbered.
 */
export const hadithSourceReferenceSchema = exactText(64).refine(
  (value) => !hasControlCharacter(value),
  'A reference holds no control character.',
);

/** What a registered source system is; neither is chosen at runtime. */
export type HadithSourceAuthority = 'fixture' | 'approved';

/**
 * Whether the Hadith section is public, and under which authority. Every
 * activation shares one authority, so the section is wholly fixture proof or
 * wholly approved.
 */
export type HadithAvailability =
  | { readonly active: false }
  | { readonly active: true; readonly mode: HadithSourceAuthority };

/** A layered record's lifecycle. Publication is further gated by a registered source. */
export type HadithLayerState = 'draft' | 'published' | 'archived';
export const HADITH_LAYER_STATES = Object.freeze([
  'draft',
  'published',
  'archived',
] as const) satisfies readonly HadithLayerState[];
export const hadithLayerStateSchema = z.enum(HADITH_LAYER_STATES);

/** A public citation is mapped to one candidate, or withdrawn from public view. */
export type HadithCitationState = 'mapped' | 'withdrawn';
export const HADITH_CITATION_STATES = Object.freeze([
  'mapped',
  'withdrawn',
] as const) satisfies readonly HadithCitationState[];

/**
 * How two candidates for one citation disagree, as the database detected it —
 * byte for byte, never normalised. `structure` is compared within one edition
 * only: each edition keeps its own books and chapters.
 */
export type HadithConflictFacet = 'text' | 'chain' | 'structure' | 'grading';
export const HADITH_CONFLICT_FACETS = Object.freeze([
  'text',
  'chain',
  'structure',
  'grading',
] as const) satisfies readonly HadithConflictFacet[];

/** The database's comma-separated facet list, as a known-facet list. */
export function conflictFacetsOf(value: string): readonly HadithConflictFacet[] {
  return value
    .split(',')
    .filter((facet): facet is HadithConflictFacet =>
      (HADITH_CONFLICT_FACETS as readonly string[]).includes(facet),
    );
}

export const HADITH_LIMITS = Object.freeze({
  text: 200_000,
  chain: 40_000,
  title: 400,
  grader: 200,
  gradingLabel: 400,
  gradingReference: 400,
  gradings: 32,
  evidence: 400,
  reason: 500,
  name: 200,
  description: 2_000,
  attribution: 400,
  translationText: 200_000,
  commentaryText: 120_000,
  scienceTitle: 200,
  scienceBody: 40_000,
  sciences: 200,
  contributors: 12,
  topicsPerRecord: 20,
  position: 100_000,
  collectionPosition: 10_000,
});

/** Admin and public listing page size. */
export const HADITH_PAGE = 50;
/** How many citations one current-projection read for a results page may name. */
export const HADITH_SEARCH_RECORDS_MAX = 100;

/* ===========================================================================
 * Canonical input — `hadith.editCanonical` with step-up
 * ========================================================================= */

export const collectionCreateSchema = z.strictObject({
  slug: hadithCollectionSlugSchema,
  position: z.number().int().min(0).max(HADITH_LIMITS.collectionPosition),
});
export type CollectionCreateValue = z.output<typeof collectionCreateSchema>;

const sourcedTitle = {
  title: exactText(HADITH_LIMITS.title).nullable(),
  titleLanguage: hadithLanguageCodeSchema.nullable(),
};

function titled<T extends { title: string | null; titleLanguage: string | null }>(
  value: T,
) {
  return (value.title === null) === (value.titleLanguage === null);
}

export const bookCreateSchema = z
  .strictObject({
    editionId: hadithIdSchema,
    slug: hadithSlugSchema,
    reference: hadithSourceReferenceSchema,
    position: z.number().int().min(0).max(HADITH_LIMITS.position),
    ...sourcedTitle,
  })
  .refine(titled, 'A title names its language, and a language its title.');
export type BookCreateValue = z.output<typeof bookCreateSchema>;

export const chapterCreateSchema = z
  .strictObject({
    bookId: hadithIdSchema,
    slug: hadithSlugSchema,
    reference: hadithSourceReferenceSchema,
    position: z.number().int().min(0).max(HADITH_LIMITS.position),
    ...sourcedTitle,
  })
  .refine(titled, 'A title names its language, and a language its title.');
export type ChapterCreateValue = z.output<typeof chapterCreateSchema>;

/**
 * One grading as the source gives it: the grader's attribution and label in
 * their own words, the label's language, and the published reference. All four
 * are mandatory — there is no grading without its source.
 */
export const gradingInputSchema = z.strictObject({
  grader: exactText(HADITH_LIMITS.grader),
  label: exactText(HADITH_LIMITS.gradingLabel),
  labelLanguage: hadithLanguageCodeSchema,
  reference: exactText(HADITH_LIMITS.gradingReference),
});
export type GradingValue = z.output<typeof gradingInputSchema>;

const gradingsSchema = z
  .array(gradingInputSchema)
  .max(HADITH_LIMITS.gradings)
  .refine(
    (list) => new Set(list.map((grading) => grading.grader)).size === list.length,
    'A grader is named once per version.',
  );

/** Every sourced fact of one version of a record — supplied whole, every time. */
const recordFacts = {
  sourceReference: hadithSourceReferenceSchema,
  citationNumber: hadithNumberSchema.nullable(),
  bookId: hadithIdSchema,
  chapterId: hadithIdSchema.nullable(),
  text: exactText(HADITH_LIMITS.text),
  textLanguage: hadithLanguageCodeSchema,
  chain: exactText(HADITH_LIMITS.chain).nullable(),
  chainLanguage: hadithLanguageCodeSchema.nullable(),
  gradings: gradingsSchema,
  /** The authorising source of this version — what the facts were taken from. */
  evidence: labelText(HADITH_LIMITS.evidence),
};

function chained<T extends { chain: string | null; chainLanguage: string | null }>(
  value: T,
) {
  return (value.chain === null) === (value.chainLanguage === null);
}

export const recordCreateSchema = z
  .strictObject({ editionId: hadithIdSchema, ...recordFacts })
  .refine(chained, 'A chain names its language, and a language its chain.');
export type RecordCreateValue = z.output<typeof recordCreateSchema>;

export const recordCorrectionSchema = z
  .strictObject({
    id: hadithIdSchema,
    expectedVersion: hadithVersionSchema,
    ...recordFacts,
    reason: labelText(HADITH_LIMITS.reason),
  })
  .refine(chained, 'A chain names its language, and a language its chain.');
export type RecordCorrectionValue = z.output<typeof recordCorrectionSchema>;

export const recordVerificationSchema = z.strictObject({
  id: hadithIdSchema,
  expectedVersion: hadithVersionSchema,
  evidence: labelText(HADITH_LIMITS.evidence),
});
export type RecordVerificationValue = z.output<typeof recordVerificationSchema>;

/**
 * Mapping a public citation to one candidate, or withdrawing it. Version 0
 * creates the citation; a change to an existing one states its reason.
 */
export const citationSetSchema = z
  .strictObject({
    collectionId: hadithIdSchema,
    number: hadithNumberSchema,
    hadithId: hadithIdSchema,
    state: z.enum(HADITH_CITATION_STATES),
    expectedVersion: z.number().int().min(0).max(2_147_483_646),
    evidence: labelText(HADITH_LIMITS.evidence),
    reason: labelText(HADITH_LIMITS.reason).nullable(),
  })
  .refine(
    (value) => value.expectedVersion === 0 || value.reason !== null,
    'A change to a citation states its reason.',
  )
  .refine(
    (value) => value.expectedVersion > 0 || value.state === 'mapped',
    'A new citation is mapped.',
  );
export type CitationSetValue = z.output<typeof citationSetSchema>;

/* ===========================================================================
 * Layered input — `hadith.administer`
 * ========================================================================= */

export const HADITH_NAME_LOCALES = Object.freeze(['en', 'ur', 'ar'] as const);
export type HadithNameLocale = (typeof HADITH_NAME_LOCALES)[number];

const nameLocaleSchema = z.enum(HADITH_NAME_LOCALES);

function uniqueLocales<T extends { locale: string }>(list: readonly T[]) {
  return new Set(list.map((entry) => entry.locale)).size === list.length;
}

/** A collection's display names, per interface locale; presentation, not identity. */
export const collectionNamesSchema = z.strictObject({
  id: hadithIdSchema,
  expectedVersion: hadithVersionSchema,
  names: z
    .array(
      z.strictObject({
        locale: nameLocaleSchema,
        name: labelText(HADITH_LIMITS.name),
        description: labelText(HADITH_LIMITS.description).nullable(),
      }),
    )
    .max(HADITH_NAME_LOCALES.length)
    .refine(uniqueLocales, 'A locale is named once.'),
});
export type CollectionNamesValue = z.output<typeof collectionNamesSchema>;

/** A book's or chapter's display names, per interface locale. */
export const structureNamesSchema = z.strictObject({
  id: hadithIdSchema,
  expectedVersion: hadithVersionSchema,
  names: z
    .array(
      z.strictObject({ locale: nameLocaleSchema, name: labelText(HADITH_LIMITS.name) }),
    )
    .max(HADITH_NAME_LOCALES.length)
    .refine(uniqueLocales, 'A locale is named once.'),
});
export type StructureNamesValue = z.output<typeof structureNamesSchema>;

export const HADITH_TRANSLATION_ROLES = Object.freeze(['translator', 'editor'] as const);
export const HADITH_COMMENTARY_ROLES = Object.freeze([
  'author',
  'translator',
  'editor',
  'compiler',
] as const);
export type HadithTranslationRole = (typeof HADITH_TRANSLATION_ROLES)[number];
export type HadithCommentaryRole = (typeof HADITH_COMMENTARY_ROLES)[number];
export type HadithContributorRole = HadithTranslationRole | HadithCommentaryRole;

function contributors<const R extends readonly [string, ...string[]]>(roles: R) {
  return z
    .array(z.strictObject({ personId: hadithIdSchema, role: z.enum(roles) }))
    .max(HADITH_LIMITS.contributors)
    .refine(
      (list) => new Set(list.map((c) => `${c.personId}:${c.role}`)).size === list.length,
      'A contributor is named once per role.',
    );
}

/**
 * A translation of one record. Its text is exact — never generated, never
 * derived from the original. `sourceSystemId` names a REGISTERED source; it
 * may be chosen, never created, here.
 */
export const translationInputSchema = z.strictObject({
  languageCode: hadithLanguageCodeSchema,
  text: exactText(HADITH_LIMITS.translationText),
  attribution: labelText(HADITH_LIMITS.attribution).nullable(),
  sourceSystemId: hadithIdSchema.nullable(),
  contributors: contributors(HADITH_TRANSLATION_ROLES),
});
export type TranslationValue = z.output<typeof translationInputSchema>;

/** A commentary work's metadata. The slug is taken on creation only. */
export const commentaryInputSchema = z.strictObject({
  slug: hadithSlugSchema,
  name: labelText(HADITH_LIMITS.name),
  description: labelText(HADITH_LIMITS.description).nullable(),
  attribution: labelText(HADITH_LIMITS.attribution).nullable(),
  languageCode: hadithLanguageCodeSchema,
  sourceSystemId: hadithIdSchema.nullable(),
  contributors: contributors(HADITH_COMMENTARY_ROLES),
});
export type CommentaryValue = z.output<typeof commentaryInputSchema>;

/** One commentary entry on one record; `null` removes it. */
export const commentaryEntrySaveSchema = z.strictObject({
  hadithId: hadithIdSchema,
  text: exactText(HADITH_LIMITS.commentaryText).nullable(),
});
export type CommentaryEntrySaveValue = z.output<typeof commentaryEntrySaveSchema>;

/** Sciences study material: plain-text guidance per content language. */
export const scienceInputSchema = z.strictObject({
  slug: hadithSlugSchema,
  position: z.number().int().min(0).max(HADITH_LIMITS.sciences),
  attribution: labelText(HADITH_LIMITS.attribution).nullable(),
  sourceSystemId: hadithIdSchema.nullable(),
  texts: z
    .array(
      z.strictObject({
        languageCode: hadithLanguageCodeSchema,
        title: labelText(HADITH_LIMITS.scienceTitle),
        body: exactText(HADITH_LIMITS.scienceBody),
      }),
    )
    .max(8)
    .refine(
      (list) => new Set(list.map((text) => text.languageCode)).size === list.length,
      'A language is written once.',
    ),
});
export type ScienceValue = z.output<typeof scienceInputSchema>;

/* ===========================================================================
 * Records — administration views
 * ========================================================================= */

export interface HadithPage<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly offset: number;
}

export interface HadithSourceSystemRecord {
  readonly id: string;
  readonly code: string;
  readonly authority: HadithSourceAuthority;
  readonly title: string;
  readonly version: string;
  readonly reference: string | null;
  readonly createdAt: Date;
}

export interface HadithEditionRecord {
  readonly id: string;
  readonly collectionId: string;
  readonly sourceSystemId: string;
  readonly sourceSystemCode: string;
  readonly sourceSystemTitle: string;
  readonly authority: HadithSourceAuthority;
  readonly code: string;
  readonly title: string;
  readonly reference: string | null;
}

export interface HadithCollectionNameRecord {
  readonly locale: HadithNameLocale;
  readonly name: string;
  readonly description: string | null;
}

export interface HadithStructureNameRecord {
  readonly locale: HadithNameLocale;
  readonly name: string;
}

export interface HadithCollectionRecord {
  readonly id: string;
  readonly slug: string;
  readonly position: number;
  readonly namesVersion: number;
  readonly names: readonly HadithCollectionNameRecord[];
  /** The operator's activation, if any — read-only here. */
  readonly activation: HadithSourceAuthority | null;
  readonly editions: readonly HadithEditionRecord[];
}

export interface HadithBookRecord {
  readonly id: string;
  readonly collectionId: string;
  readonly collectionSlug: string;
  readonly editionId: string;
  readonly editionCode: string;
  readonly slug: string;
  readonly reference: string;
  readonly position: number;
  readonly title: string | null;
  readonly titleLanguage: string | null;
  readonly namesVersion: number;
  readonly names: readonly HadithStructureNameRecord[];
}

export interface HadithChapterRecord {
  readonly id: string;
  readonly bookId: string;
  readonly slug: string;
  readonly reference: string;
  readonly position: number;
  readonly title: string | null;
  readonly titleLanguage: string | null;
  readonly namesVersion: number;
  readonly names: readonly HadithStructureNameRecord[];
}

export interface HadithGradingRecord {
  readonly position: number;
  readonly grader: string;
  readonly label: string;
  readonly labelLanguage: string;
  readonly reference: string;
}

/** Filters an administrator may narrow the record list by; none broadens it. */
export type HadithRecordFilter = 'all' | 'unverified' | 'conflicted' | 'mapped';
export const HADITH_RECORD_FILTERS = Object.freeze([
  'all',
  'unverified',
  'conflicted',
  'mapped',
] as const) satisfies readonly HadithRecordFilter[];

/** One source-qualified record in the administration list. */
export interface HadithRecordSummary {
  readonly id: string;
  readonly collectionId: string;
  readonly collectionSlug: string;
  readonly editionId: string;
  readonly editionCode: string;
  readonly sourceSystemCode: string;
  readonly authority: HadithSourceAuthority;
  readonly sourceReference: string;
  readonly citationNumber: number | null;
  readonly version: number;
  /** Whether a human verification covers the CURRENT version. */
  readonly verified: boolean;
  readonly conflicts: number;
  /** The citation's state when this record is the one it names. */
  readonly citation: HadithCitationState | null;
  readonly updatedAt: Date;
}

export interface HadithRevisionRecord {
  readonly version: number;
  readonly operation: 'created' | 'corrected';
  readonly sourceReference: string;
  readonly citationNumber: number | null;
  readonly evidence: string;
  readonly reason: string | null;
  readonly actorId: string;
  readonly createdAt: Date;
}

export interface HadithVerificationRecord {
  readonly id: string;
  readonly version: number;
  readonly evidence: string;
  readonly actorId: string;
  readonly createdAt: Date;
}

/**
 * Conflict evidence as one record's detail presents it, ORIENTED to that
 * record: `hadithId` is the record being read, whichever side the database
 * recorded it on, and `other*` describes the competing candidate.
 */
export interface HadithConflictRecord {
  readonly id: string;
  readonly hadithId: string;
  readonly hadithVersion: number;
  readonly otherHadithId: string;
  readonly otherVersion: number;
  readonly otherEditionCode: string;
  readonly otherSourceReference: string;
  readonly facets: readonly HadithConflictFacet[];
  readonly detectedAt: Date;
}

export interface HadithCandidateRecord {
  readonly id: string;
  readonly editionCode: string;
  readonly sourceSystemCode: string;
  readonly sourceReference: string;
  readonly version: number;
  readonly verified: boolean;
}

export interface HadithCitationRevisionRecord {
  readonly version: number;
  readonly hadithId: string;
  readonly state: HadithCitationState;
  readonly evidence: string;
  readonly reason: string | null;
  readonly actorId: string;
  readonly createdAt: Date;
}

export interface HadithCitationRecord {
  readonly id: string;
  readonly collectionId: string;
  readonly number: number;
  readonly hadithId: string;
  readonly state: HadithCitationState;
  readonly version: number;
  readonly updatedAt: Date;
  readonly revisions: readonly HadithCitationRevisionRecord[];
}

/** Everything an administrator reviews about one record. */
export interface HadithRecordDetail extends HadithRecordSummary {
  readonly bookId: string;
  readonly bookSlug: string;
  readonly bookReference: string;
  readonly chapterId: string | null;
  readonly chapterSlug: string | null;
  readonly chapterReference: string | null;
  readonly text: string;
  readonly textLanguage: string;
  readonly chain: string | null;
  readonly chainLanguage: string | null;
  readonly gradings: readonly HadithGradingRecord[];
  readonly revisions: readonly HadithRevisionRecord[];
  readonly verifications: readonly HadithVerificationRecord[];
  /** Conflict evidence naming this record on either side. */
  readonly conflicts: number;
  readonly conflictEvidence: readonly HadithConflictRecord[];
  /** The other candidates declaring the same citation number. */
  readonly candidates: readonly HadithCandidateRecord[];
  /** The citation for this record's number, whichever candidate it names. */
  readonly citationRecord: HadithCitationRecord | null;
  /** Whether conflict evidence exists against this record's citation number. */
  readonly citationConflicted: boolean;
  readonly topicIds: readonly string[];
}

export interface HadithContributorRecord {
  readonly personId: string;
  readonly role: HadithContributorRole;
  readonly position: number;
}

interface LayeredRecordBase {
  readonly id: string;
  readonly state: HadithLayerState;
  readonly version: number;
  readonly attribution: string | null;
  readonly sourceSystemId: string | null;
  readonly sourceAuthority: HadithSourceAuthority | null;
  readonly publishedAt: Date | null;
  readonly updatedAt: Date;
}

export interface HadithTranslationRecord extends LayeredRecordBase {
  readonly hadithId: string;
  readonly languageCode: string;
  readonly text: string;
  readonly contributors: readonly HadithContributorRecord[];
}

export interface HadithCommentaryRecord extends LayeredRecordBase {
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly languageCode: string;
  readonly entryCount: number;
  readonly contributors: readonly HadithContributorRecord[];
}

export interface HadithCommentaryEntryRecord {
  readonly commentaryId: string;
  readonly hadithId: string;
  readonly collectionSlug: string;
  readonly sourceReference: string;
  readonly editionCode: string;
  readonly text: string;
}

export interface HadithScienceTextRecord {
  readonly languageCode: string;
  readonly title: string;
  readonly body: string;
}

export interface HadithScienceRecord extends LayeredRecordBase {
  readonly slug: string;
  readonly position: number;
  readonly texts: readonly HadithScienceTextRecord[];
}

/* ===========================================================================
 * Public views — only what is public NOW
 * ========================================================================= */

export interface PublicHadithAttribution {
  readonly sourceSystemTitle: string;
  readonly editionTitle: string;
  readonly editionCode: string;
}

export interface PublicHadithCollection {
  readonly id: string;
  readonly slug: string;
  readonly names: readonly HadithCollectionNameRecord[];
  /** The editions whose records currently stand behind its public citations. */
  readonly attributions: readonly PublicHadithAttribution[];
  readonly lastModified: Date;
}

export interface PublicHadithStructure {
  readonly id: string;
  readonly slug: string;
  readonly reference: string;
  readonly title: string | null;
  readonly titleLanguage: string | null;
  readonly names: readonly HadithStructureNameRecord[];
}

/**
 * A public book carries the edition it belongs to: each edition keeps its own
 * structure, so two editions' books are never shown as one list without saying
 * whose they are.
 */
export interface PublicHadithBook extends PublicHadithStructure {
  readonly edition: PublicHadithAttribution;
}

/** One public citation as a listing shows it: the number and its original text. */
export interface PublicHadithCitationSummary {
  readonly collectionSlug: string;
  readonly number: number;
  readonly sourceReference: string;
  readonly text: string;
  readonly textLanguage: string;
}

export interface PublicHadithContributor {
  readonly personId: string;
  readonly role: HadithContributorRole;
}

export interface PublicHadithTranslation {
  readonly id: string;
  readonly languageCode: string;
  readonly text: string;
  readonly attribution: string | null;
  readonly sourceSystemTitle: string;
  readonly contributors: readonly PublicHadithContributor[];
}

export interface PublicHadithCommentaryEntry {
  readonly commentaryId: string;
  readonly slug: string;
  readonly name: string;
  readonly languageCode: string;
  readonly attribution: string | null;
  readonly text: string;
}

/** The canonical citation page: genuine current-public facts and nothing else. */
export interface PublicHadith {
  readonly collection: {
    readonly slug: string;
    readonly names: readonly HadithCollectionNameRecord[];
  };
  readonly number: number;
  readonly sourceReference: string;
  readonly attribution: PublicHadithAttribution;
  readonly book: PublicHadithBook;
  readonly chapter: PublicHadithStructure | null;
  readonly text: string;
  readonly textLanguage: string;
  readonly chain: string | null;
  readonly chainLanguage: string | null;
  readonly gradings: readonly HadithGradingRecord[];
  readonly translations: readonly PublicHadithTranslation[];
  readonly commentary: readonly PublicHadithCommentaryEntry[];
  readonly topicIds: readonly string[];
  readonly lastModified: Date;
}

export interface PublicHadithCommentary {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly description: string | null;
  readonly languageCode: string;
  readonly attribution: string | null;
  readonly sourceSystemTitle: string;
  readonly contributors: readonly PublicHadithContributor[];
  readonly entryCount: number;
}

export interface PublicHadithScienceSummary {
  readonly slug: string;
  readonly position: number;
  readonly titles: readonly { readonly languageCode: string; readonly title: string }[];
}

export interface PublicHadithScience {
  readonly slug: string;
  readonly attribution: string | null;
  readonly sourceSystemTitle: string;
  readonly texts: readonly HadithScienceTextRecord[];
  readonly lastModified: Date;
}

export interface HadithSitemapEntry {
  readonly collectionSlug: string;
  readonly number: number;
  readonly lastModified: Date;
}

/** A public citation as Search projects it: the original and each public translation. */
export interface HadithSearchRecord {
  readonly citationId: string;
  readonly collectionSlug: string;
  readonly number: number;
  readonly text: string;
  readonly textLanguage: string;
  readonly translations: readonly {
    readonly languageCode: string;
    readonly text: string;
  }[];
  readonly topicIds: readonly string[];
  /** A staleness stamp over everything the projection reads. */
  readonly stamp: string;
}

/** Where a public citation lives, for the search visibility resolver. */
export interface HadithCitationTarget {
  readonly citationId: string;
  readonly collectionSlug: string;
  readonly number: number;
}

/*
 * Concrete pages, one per record a port returns a page of. Each is exactly
 * `HadithPage<Record>`, spelled out so a port names a concrete contract rather
 * than a type parameter (ARCHITECTURE.md §4.1).
 */
export interface PublicHadithCitationPage {
  readonly items: readonly PublicHadithCitationSummary[];
  readonly total: number;
  readonly offset: number;
}
export interface HadithCollectionPage {
  readonly items: readonly HadithCollectionRecord[];
  readonly total: number;
  readonly offset: number;
}
export interface HadithBookPage {
  readonly items: readonly HadithBookRecord[];
  readonly total: number;
  readonly offset: number;
}
export interface HadithChapterPage {
  readonly items: readonly HadithChapterRecord[];
  readonly total: number;
  readonly offset: number;
}
export interface HadithRecordSummaryPage {
  readonly items: readonly HadithRecordSummary[];
  readonly total: number;
  readonly offset: number;
}
export interface HadithCommentaryPage {
  readonly items: readonly HadithCommentaryRecord[];
  readonly total: number;
  readonly offset: number;
}
export interface HadithCommentaryEntryPage {
  readonly items: readonly HadithCommentaryEntryRecord[];
  readonly total: number;
  readonly offset: number;
}
export interface HadithSciencePage {
  readonly items: readonly HadithScienceRecord[];
  readonly total: number;
  readonly offset: number;
}
