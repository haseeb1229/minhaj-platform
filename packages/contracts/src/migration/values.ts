import { z } from 'zod';

/**
 * Migration & Provenance — values (DOMAIN_MODEL.md §16, MIGRATION_STRATEGY.md).
 *
 * LAYER 0 AND BROWSER-SAFE. Vocabularies, bounds and input schemas only; the
 * rules that give them force live in the Migration & Provenance context and,
 * for every invariant the database can hold, in the Phase-29 migration's
 * CHECKs and triggers — each vocabulary here is transcribed there.
 *
 * NO TARGET VOCABULARY. Nothing here names Media, Editorial or any other
 * target's types: a staged record is Migration's own normalised shape, and
 * only the Layer-4 publisher translates it into a target's input
 * (MIGRATION_STRATEGY.md §2.2).
 */

/* ===========================================================================
 * Content kinds and sources
 * ========================================================================= */

/**
 * The content kinds a source may yield and a staged record may carry.
 *
 * A STRICT, CLOSED VOCABULARY — never a free-form target type. Each kind has
 * one strict staged-payload schema and one normaliser, and is either
 * PUBLISHABLE (a Layer-4 publisher carries it into its owning domain through
 * that domain's public service) or REVIEW-ONLY (religious material preserved
 * and reviewed as evidence, which migration never publishes — see
 * `payloads.ts`). Every vocabulary here is transcribed into the database
 * CHECKs.
 */
export const MIGRATION_PUBLISHABLE_KINDS = Object.freeze([
  'media.video',
  'library.work',
  'library.magazine',
  'library.magazine-issue',
  'editorial.news',
  'editorial.article',
  // Phase 30-R: Editorial's press releases and shell-bound Pages, People's
  // public profiles and Global Network's countries.
  'editorial.press-release',
  'editorial.page',
  'people.person',
  'global.country',
] as const);
export type MigrationPublishableKind = (typeof MIGRATION_PUBLISHABLE_KINDS)[number];

export const MIGRATION_REVIEW_ONLY_KINDS = Object.freeze([
  'fatwa.ruling',
  'quran.translation',
] as const);
export type MigrationReviewOnlyKind = (typeof MIGRATION_REVIEW_ONLY_KINDS)[number];

export const MIGRATION_CONTENT_KINDS = Object.freeze([
  ...MIGRATION_PUBLISHABLE_KINDS,
  ...MIGRATION_REVIEW_ONLY_KINDS,
] as const);
export type MigrationContentKind = (typeof MIGRATION_CONTENT_KINDS)[number];
export const migrationContentKindSchema = z.enum(MIGRATION_CONTENT_KINDS);

export function isPublishableKind(kind: string): kind is MigrationPublishableKind {
  return (MIGRATION_PUBLISHABLE_KINDS as readonly string[]).includes(kind);
}

/**
 * WHO VOUCHES FOR A SOURCE.
 *
 * `fixture` — a synthetic source on controlled local infrastructure, for
 * engineering proof. It carries NO authorisation evidence and may name only
 * `*.fixture.invalid` hosts.
 *
 * `authorised` — a real source whose written authorisation is recorded. It is
 * modelled so Phase 30 has somewhere to record that authorisation; Phase 29
 * creates none, runs none and activates none (OPEN_DECISIONS.md §3.1).
 *
 * Fixed at creation, in SQL as well as here: a fixture never becomes a real
 * source by an edit.
 */
export const SOURCE_AUTHORITY_KINDS = Object.freeze(['fixture', 'authorised'] as const);
export type SourceAuthorityKind = (typeof SOURCE_AUTHORITY_KINDS)[number];

export const SOURCE_ACCESS_METHODS = Object.freeze(['http', 'export'] as const);
export type SourceAccessMethod = (typeof SOURCE_ACCESS_METHODS)[number];
export const sourceAccessMethodSchema = z.enum(SOURCE_ACCESS_METHODS);

export const SOURCE_STATES = Object.freeze(['active', 'inactive'] as const);
export type SourceState = (typeof SOURCE_STATES)[number];
export const sourceStateSchema = z.enum(SOURCE_STATES);

/**
 * RFC 6761 reserves `.invalid`: it never resolves in the public DNS. A fixture
 * host under it can only ever reach whatever the fixture resolver maps it to.
 */
export const FIXTURE_HOST_SUFFIX = '.fixture.invalid';

export function isFixtureHost(host: string): boolean {
  return (
    host.length > FIXTURE_HOST_SUFFIX.length &&
    host.endsWith(FIXTURE_HOST_SUFFIX) &&
    /^[a-z0-9.-]+$/.test(host) &&
    !host.startsWith('.') &&
    !host.includes('..')
  );
}

/* ===========================================================================
 * Bounds
 * ========================================================================= */

export const MIGRATION_LIMITS = Object.freeze({
  /** One page of any operator list. */
  page: 25,
  /** The deepest offset a list accepts. */
  maxOffset: 100_000,
  /** Records discovered, fetched or staged per batch — the checkpoint unit. */
  batch: 25,
  /** Entries in one publish manifest. */
  manifestEntries: 200,
  /** Entries in one promotion. */
  promotionEntries: 500,
  /** The ceiling on a single response body, in bytes (SQL CHECK too). */
  maxBodyBytes: 8 * 1024 * 1024,
  /** A staged payload's JSON length (SQL CHECK too). */
  payload: 200_000,
  /** How much of a raw body the escaped operator preview shows. */
  rawPreviewBytes: 64 * 1024,
  /** Hosts one source may name. */
  hosts: 8,
  /** Links recorded per staged revision. */
  links: 200,
  /** Categories per staged revision. */
  categories: 24,
  /** Assets per record. */
  assets: 8,
  /** A safe error detail. */
  detail: 500,
  /** A free-text operator note or reason. */
  note: 500,
  title: 240,
  description: 4000,
  url: 2000,
  externalKey: 400,
  key: 64,
  name: 200,
});

/** The politeness and safety bounds one source runs under. */
export interface SourcePolicy {
  /** Minimum interval between two requests to the source. */
  readonly minIntervalMs: number;
  readonly maxConcurrency: number;
  /** Attempts per request, including the first. */
  readonly maxAttempts: number;
  readonly timeoutMs: number;
  readonly maxBodyBytes: number;
  readonly maxRedirects: number;
}

export const sourcePolicySchema = z
  .object({
    minIntervalMs: z.number().int().min(0).max(600_000),
    maxConcurrency: z.number().int().min(1).max(4),
    maxAttempts: z.number().int().min(1).max(6),
    timeoutMs: z.number().int().min(1000).max(60_000),
    maxBodyBytes: z.number().int().min(1024).max(MIGRATION_LIMITS.maxBodyBytes),
    maxRedirects: z.number().int().min(0).max(5),
  })
  .strict();

/* ===========================================================================
 * Lifecycle vocabularies — transcribed into the Phase-29 CHECKs
 * ========================================================================= */

/** MigrationStatus (DOMAIN_MODEL.md §16.1): one record across the pipeline. */
export const RECORD_STATUSES = Object.freeze([
  'discovered',
  'fetched',
  'staged',
  'rejected',
  'errored',
  'excluded',
  'approved',
  'published',
  'merged',
] as const);
export type RecordStatus = (typeof RECORD_STATUSES)[number];

export const RECORD_OBSERVATIONS = Object.freeze(['present', 'missing'] as const);
export type RecordObservation = (typeof RECORD_OBSERVATIONS)[number];

/**
 * How a person classifies a record a source stopped returning
 * (MIGRATION_STRATEGY.md §5.3). Absence is an OBSERVATION; none of these
 * deletes or unpublishes anything.
 */
export const DISAPPEARANCE_CLASSES = Object.freeze([
  'withdrawn',
  'moved',
  'source-error',
  'transient-failure',
  'access-failure',
  'unresolved',
] as const);
export type DisappearanceClass = (typeof DISAPPEARANCE_CLASSES)[number];
export const disappearanceClassSchema = z.enum(DISAPPEARANCE_CLASSES);

export const RUN_STATES = Object.freeze(['open', 'completed', 'cancelled'] as const);
export type RunState = (typeof RUN_STATES)[number];

export const RECONCILIATION_STATES = Object.freeze([
  'pending',
  'balanced',
  'unbalanced',
] as const);
export type ReconciliationState = (typeof RECONCILIATION_STATES)[number];

export const ITEM_OUTCOMES = Object.freeze([
  'pending',
  'staged',
  'unchanged',
  'rejected',
  'errored',
  'excluded',
] as const);
export type ItemOutcome = (typeof ITEM_OUTCOMES)[number];

export const ERROR_STAGES = Object.freeze([
  'discover',
  'fetch',
  'parse',
  'normalize',
  'validate',
  'asset',
  'publish',
  'rollback',
  'promote',
] as const);
export type ErrorStage = (typeof ERROR_STAGES)[number];

export const ERROR_CLASSIFICATIONS = Object.freeze([
  'network',
  'timeout',
  'rate-limited',
  'server-error',
  'not-found',
  'gone',
  'access-denied',
  'client-error',
  'redirect-refused',
  'address-refused',
  'scope-refused',
  'too-large',
  'unsupported-type',
  'parse-failed',
  'validation-failed',
  'asset-rejected',
  'asset-unavailable',
  'target-refused',
  'target-unavailable',
  'approval-withdrawn',
] as const);
export type ErrorClassification = (typeof ERROR_CLASSIFICATIONS)[number];

export const ERROR_RESOLUTIONS = Object.freeze([
  'open',
  'retry-requested',
  'dismissed',
  'resolved',
] as const);
export type ErrorResolution = (typeof ERROR_RESOLUTIONS)[number];

export const REVIEW_STATES = Object.freeze([
  'pending',
  'approved',
  'rejected',
  'superseded',
] as const);
export type ReviewState = (typeof REVIEW_STATES)[number];

export const VALIDATION_STATES = Object.freeze(['valid', 'invalid'] as const);
export type ValidationState = (typeof VALIDATION_STATES)[number];

export const PERSONAL_DATA_STATES = Object.freeze(['none', 'flagged'] as const);
export type PersonalDataState = (typeof PERSONAL_DATA_STATES)[number];

export const LINK_DISPOSITIONS = Object.freeze([
  'rewritten',
  'unresolved',
  'external',
  'dropped',
] as const);
export type LinkDisposition = (typeof LINK_DISPOSITIONS)[number];

export const TOPIC_MAPPING_STATES = Object.freeze([
  'unmapped',
  'confirmed',
  'excluded',
] as const);
export type TopicMappingState = (typeof TOPIC_MAPPING_STATES)[number];

export const DUPLICATE_SIGNALS = Object.freeze([
  'provider-id',
  'asset-checksum',
  'identifier',
  'title-similarity',
] as const);
export type DuplicateSignal = (typeof DUPLICATE_SIGNALS)[number];

export const DUPLICATE_STATES = Object.freeze([
  'open',
  'collapsed',
  'merged',
  'distinct',
] as const);
export type DuplicateState = (typeof DUPLICATE_STATES)[number];

export const ASSET_LICENCES = Object.freeze([
  'unknown',
  'organisation-owned',
  'licensed',
  'third-party',
] as const);
export type AssetLicence = (typeof ASSET_LICENCES)[number];
export const assetLicenceSchema = z.enum(ASSET_LICENCES);

export const ASSET_VISIBILITIES = Object.freeze([
  'restricted',
  'public-eligible',
] as const);
export type AssetVisibility = (typeof ASSET_VISIBILITIES)[number];
export const assetVisibilitySchema = z.enum(ASSET_VISIBILITIES);

/**
 * Phase 30-R. A source host's role: a PAGE host is where discovery, items and
 * links live; an ASSET host is an exact first-party host the source's own
 * pages name for their images, reached only to acquire such an image — never
 * discovered, never an item, never a link target.
 */
export const SOURCE_HOST_ROLES = Object.freeze(['page', 'asset'] as const);
export type SourceHostRole = (typeof SOURCE_HOST_ROLES)[number];

/**
 * Phase 30-R. A manifest entry CREATES a record in its owning domain, or
 * REFRESHES one an earlier manifest already made: a newer approved revision of
 * the same legacy record carried into the existing target through the owning
 * domain's own update. A refresh makes no legacy mapping, and migration never
 * rolls one back — what it changed in a record people may already hold is a
 * person's to undo (MIGRATION_STRATEGY.md §7.2).
 */
export const MANIFEST_ENTRY_MODES = Object.freeze(['create', 'refresh'] as const);
export type ManifestEntryMode = (typeof MANIFEST_ENTRY_MODES)[number];

export const LEGACY_MAPPING_STATES = Object.freeze(['active', 'disabled'] as const);
export type LegacyMappingState = (typeof LEGACY_MAPPING_STATES)[number];

export const MANIFEST_STATES = Object.freeze([
  'draft',
  'publishing',
  'published',
  'rolling-back',
  'rolled-back',
  'discarded',
] as const);
export type ManifestState = (typeof MANIFEST_STATES)[number];

export const MANIFEST_ENTRY_STATES = Object.freeze([
  'pending',
  'publishing',
  'published',
  'refused',
  'rolled-back',
  'rollback-refused',
] as const);
export type ManifestEntryState = (typeof MANIFEST_ENTRY_STATES)[number];

export const PROMOTION_STATES = Object.freeze([
  'draft',
  'approved',
  'promoting',
  'promoted',
  'withdrawn',
] as const);
export type PromotionState = (typeof PROMOTION_STATES)[number];

export const PROMOTION_DESTINATIONS = Object.freeze(['bundle'] as const);
export type PromotionDestination = (typeof PROMOTION_DESTINATIONS)[number];

/* ===========================================================================
 * Identifiers and operator input
 * ========================================================================= */

export const migrationIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

export const migrationVersionSchema = z.number().int().min(1).max(2_000_000_000);

export const migrationOffsetSchema = z
  .number()
  .int()
  .min(0)
  .max(MIGRATION_LIMITS.maxOffset);

export const sourceKeySchema = z
  .string()
  .min(3)
  .max(MIGRATION_LIMITS.key)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

const note = z.string().trim().max(MIGRATION_LIMITS.note);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable();

export const languageCodeSchema = z
  .string()
  .min(2)
  .max(16)
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);

/**
 * Registering a FIXTURE source. There is no authority field: Phase 29 creates
 * fixture sources only, so the kind is not the operator's to choose, and a
 * request carrying an authorisation reference is refused before it is read.
 */
export const fixtureSourceCreateSchema = z
  .object({
    key: sourceKeySchema,
    name: z.string().trim().min(1).max(MIGRATION_LIMITS.name),
    contentKind: migrationContentKindSchema,
    accessMethod: sourceAccessMethodSchema,
    /** An `http(s)://<host>.fixture.invalid/` base, or null for an export. */
    baseUrl: z.string().trim().max(MIGRATION_LIMITS.url).nullable(),
    /** Every host the source may reach, each `*.fixture.invalid`. */
    hosts: z.array(z.string().trim().toLowerCase().max(253)).max(MIGRATION_LIMITS.hosts),
    defaultLanguageCode: languageCodeSchema.nullable(),
    policy: sourcePolicySchema,
    licensingEvidence: optionalText(2000),
    policyNotes: optionalText(2000),
  })
  .strict();
export type FixtureSourceCreate = z.output<typeof fixtureSourceCreateSchema>;

/**
 * The politeness floor of an AUTHORISED source (MIGRATION_STRATEGY.md §4.2):
 * at least a second between two requests and one request at a time, whatever
 * the registration asks for. Transcribed into the source CHECK.
 */
export const AUTHORISED_MIN_INTERVAL_MS = 1000;
export const AUTHORISED_MAX_CONCURRENCY = 1;

/** A written authorisation reference: printable, no secret-looking separators. */
export const authorisationReferenceSchema = z
  .string()
  .trim()
  .min(3)
  .max(400)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._:/#()-]*$/);

/**
 * Registering an AUTHORISED source (Phase 30). The authority kind is not a
 * field: this schema exists only on the authorised registration path, which
 * sets it. The written authorisation REFERENCE and DATE are mandatory; the
 * application records and audits them but cannot prove the organisational
 * decision they point at — that evidence lives outside the platform
 * (OPEN_DECISIONS.md §3.1.1). The scope is real `https` hosts only, never a
 * credential, and the politeness bounds cannot go below the floor.
 */
export const authorisedSourceCreateSchema = z
  .object({
    key: sourceKeySchema,
    name: z.string().trim().min(1).max(MIGRATION_LIMITS.name),
    contentKind: migrationContentKindSchema,
    accessMethod: z.literal('http'),
    baseUrl: z.string().trim().min(1).max(MIGRATION_LIMITS.url),
    hosts: z
      .array(z.string().trim().toLowerCase().min(1).max(253))
      .min(1)
      .max(MIGRATION_LIMITS.hosts),
    /** Phase 30-R: exact first-party ASSET hosts, beside the page hosts. */
    assetHosts: z
      .array(z.string().trim().toLowerCase().min(1).max(253))
      .max(MIGRATION_LIMITS.hosts)
      .default([]),
    defaultLanguageCode: languageCodeSchema.nullable(),
    policy: sourcePolicySchema.refine(
      (policy) =>
        policy.minIntervalMs >= AUTHORISED_MIN_INTERVAL_MS &&
        policy.maxConcurrency <= AUTHORISED_MAX_CONCURRENCY,
    ),
    authorisationReference: authorisationReferenceSchema,
    authorisedOn: z.iso.date(),
    licensingEvidence: optionalText(2000),
    policyNotes: optionalText(2000),
  })
  .strict();
export type AuthorisedSourceCreate = z.output<typeof authorisedSourceCreateSchema>;

/**
 * Phase 30-R. Adding one exact first-party ASSET host to an AUTHORISED source:
 * an audited, append-only act — a host, once recorded, is never changed or
 * removed — carrying the evidence that the host serves the source's OWN
 * images (for example, that the source's own pages name it for them). Page
 * hosts are fixed at registration and are never added this way.
 */
export const assetHostAddSchema = z
  .object({
    sourceId: migrationIdSchema,
    expectedVersion: migrationVersionSchema,
    host: z.string().trim().toLowerCase().min(1).max(253),
    evidence: z.string().trim().min(10).max(1000),
  })
  .strict();
export type AssetHostAdd = z.output<typeof assetHostAddSchema>;

/** What an operator may change on a source: never its kind, key or hosts. */
export const sourceUpdateSchema = z
  .object({
    id: migrationIdSchema,
    expectedVersion: migrationVersionSchema,
    name: z.string().trim().min(1).max(MIGRATION_LIMITS.name),
    state: sourceStateSchema,
    defaultLanguageCode: languageCodeSchema.nullable(),
    policy: sourcePolicySchema,
    licensingEvidence: optionalText(2000),
    policyNotes: optionalText(2000),
  })
  .strict();
export type SourceUpdate = z.output<typeof sourceUpdateSchema>;

export const reviewDecisionSchema = z
  .object({
    stagedRecordId: migrationIdSchema,
    expectedVersion: migrationVersionSchema,
    decision: z.enum(['approve', 'reject', 'withdraw-approval']),
    note,
  })
  .strict();
export type ReviewDecision = z.output<typeof reviewDecisionSchema>;

/**
 * One reviewer's decision over a bounded selection — at most one operator
 * page — of revisions they have each seen, at the version they saw. Each item
 * is decided, checked and audited exactly as a single review is; nothing is
 * decided for a revision that was not named.
 */
export const reviewBatchSchema = z
  .object({
    decision: z.enum(['approve', 'reject']),
    note,
    items: z
      .array(
        z
          .object({
            stagedRecordId: migrationIdSchema,
            expectedVersion: migrationVersionSchema,
          })
          .strict(),
      )
      .min(1)
      .max(MIGRATION_LIMITS.page)
      .refine(
        (items) =>
          new Set(items.map((item) => item.stagedRecordId)).size === items.length,
      ),
  })
  .strict();
export type ReviewBatch = z.output<typeof reviewBatchSchema>;

export const duplicateDecisionSchema = z
  .object({
    candidateId: migrationIdSchema,
    expectedVersion: migrationVersionSchema,
    decision: z.enum(['merge', 'distinct', 'reopen']),
    note,
  })
  .strict();
export type DuplicateDecision = z.output<typeof duplicateDecisionSchema>;

export const topicMappingDecisionSchema = z
  .object({
    mappingId: migrationIdSchema,
    expectedVersion: migrationVersionSchema,
    decision: z.enum(['confirm', 'exclude', 'reopen']),
    topicId: migrationIdSchema.nullable(),
  })
  .strict();
export type TopicMappingDecision = z.output<typeof topicMappingDecisionSchema>;

export const errorDecisionSchema = z
  .object({
    errorId: migrationIdSchema,
    expectedVersion: migrationVersionSchema,
    decision: z.enum(['retry', 'dismiss']),
  })
  .strict();
export type ErrorDecision = z.output<typeof errorDecisionSchema>;

export const disappearanceDecisionSchema = z
  .object({
    recordId: migrationIdSchema,
    expectedVersion: migrationVersionSchema,
    classification: disappearanceClassSchema,
    note,
  })
  .strict();
export type DisappearanceDecision = z.output<typeof disappearanceDecisionSchema>;

export const rightsDecisionSchema = z
  .object({
    provenanceId: migrationIdSchema,
    expectedVersion: migrationVersionSchema,
    licence: assetLicenceSchema,
    visibility: assetVisibilitySchema,
    licenceEvidence: optionalText(1000),
    rightsHolder: optionalText(200),
  })
  .strict();
export type RightsDecision = z.output<typeof rightsDecisionSchema>;

/**
 * Phase 30-R. A reviewer's rights decision over a SELECTION of one page of
 * acquisitions: each named at the version the reviewer was shown, and each
 * then decided — and audited — on its own, exactly as one decision would be.
 * The act only ever clears material for release: the licence is owned or
 * licensed, the visibility `public-eligible`, and the reviewer states the
 * evidence and the holder. Anything else is decided one acquisition at a time.
 */
export const rightsBatchSchema = z
  .object({
    items: z
      .array(
        z
          .object({
            provenanceId: migrationIdSchema,
            expectedVersion: migrationVersionSchema,
          })
          .strict(),
      )
      .min(1)
      .max(MIGRATION_LIMITS.page)
      .refine(
        (items) => new Set(items.map((item) => item.provenanceId)).size === items.length,
      ),
    licence: z.enum(['organisation-owned', 'licensed']),
    licenceEvidence: z.string().trim().min(10).max(1000),
    rightsHolder: z.string().trim().min(1).max(200),
  })
  .strict();
export type RightsBatch = z.output<typeof rightsBatchSchema>;

export const legacyMappingDecisionSchema = z
  .object({
    mappingId: migrationIdSchema,
    expectedVersion: migrationVersionSchema,
    state: z.enum(LEGACY_MAPPING_STATES),
  })
  .strict();
export type LegacyMappingDecision = z.output<typeof legacyMappingDecisionSchema>;

export const snapshotDisposalSchema = z
  .object({
    snapshotId: migrationIdSchema,
    reason: z.string().trim().min(1).max(MIGRATION_LIMITS.note),
  })
  .strict();
export type SnapshotDisposal = z.output<typeof snapshotDisposalSchema>;

export const manifestCreateSchema = z
  .object({
    runId: migrationIdSchema,
    stagedRecordIds: z
      .array(migrationIdSchema)
      .min(1)
      .max(MIGRATION_LIMITS.manifestEntries)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();
export type ManifestCreate = z.output<typeof manifestCreateSchema>;

export const manifestCommandSchema = z
  .object({
    manifestId: migrationIdSchema,
    expectedVersion: migrationVersionSchema,
  })
  .strict();
export type ManifestCommand = z.output<typeof manifestCommandSchema>;

export const rollbackCommandSchema = manifestCommandSchema
  .extend({ reason: z.string().trim().min(1).max(MIGRATION_LIMITS.note) })
  .strict();
export type RollbackCommand = z.output<typeof rollbackCommandSchema>;

export const promotionCreateSchema = z
  .object({
    manifestEntryIds: z
      .array(migrationIdSchema)
      .min(1)
      .max(MIGRATION_LIMITS.promotionEntries)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();
export type PromotionCreate = z.output<typeof promotionCreateSchema>;

export const promotionCommandSchema = z
  .object({
    promotionId: migrationIdSchema,
    expectedVersion: migrationVersionSchema,
  })
  .strict();
export type PromotionCommand = z.output<typeof promotionCommandSchema>;

/** Machine-readable validation issue codes — never free text from a source. */
export const VALIDATION_ISSUES = Object.freeze([
  'title-missing',
  'title-too-long',
  'language-missing',
  'language-invalid',
  'provider-missing',
  'provider-invalid',
  'provider-id-invalid',
  'primary-label-missing',
  'date-implausible',
  'duration-invalid',
  'slug-invalid',
  'description-too-long',
  'body-missing',
  'body-too-long',
  'excerpt-too-long',
  'language-unsupported',
  'reference-missing',
  'edition-label-missing',
  'isbn-invalid',
  'year-invalid',
  'page-count-invalid',
  'surah-invalid',
  'ayah-invalid',
  'question-missing',
  'answer-missing',
  /** A value no other issue names fails the kind's strict schema. */
  'payload-invalid',
] as const);
export type ValidationIssue = (typeof VALIDATION_ISSUES)[number];
