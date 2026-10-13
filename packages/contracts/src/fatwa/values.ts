import { z } from 'zod';

import { localeSchema } from '../env/shared.ts';
import type { Locale } from '../env/shared.ts';
import { exactText, hasControlCharacter, labelText } from '../exact-text.ts';

/**
 * Fatwa — its own bounded context, never an editorial record
 * (DOMAIN_MODEL.md §12; SECURITY_BASELINE.md §6; DELIVERY_PLAN.md Phase 20).
 *
 * TWO DIFFERENT KINDS OF DATA, KEPT APART. A QUESTION is private personal data
 * written by the person who asked it; it is readable only to its asker and to
 * the personnel whose stage of the workflow needs it NOW, and it never reaches
 * a public page, search, a sitemap, metadata, a log or an audit payload. A
 * FATWA is the public ruling: a sequence of immutable revisions, each holding
 * a SEPARATE, HUMAN-WRITTEN anonymised public question beside the ruling. The
 * original question is never copied into a revision and never "anonymised" by
 * code: nothing here rewrites, redacts, detects names in or summarises text.
 *
 * NO AI PATH. No value, port or service in this context generates, drafts,
 * suggests, rewrites or approves ruling text; every ruling is typed by a person
 * holding `fatwa.answer` and published by a different person holding
 * `fatwa.publish` behind step-up (DOMAIN_MODEL.md §12).
 *
 * NOTHING HERE IS A RULING. No category, question or ruling is written into
 * this repository. The bounds below are structural ceilings, not claims about
 * any corpus, and every fixture the tests use is an unmistakable
 * `NON_FATWA_FIXTURE_*` sentinel.
 */

/* ===========================================================================
 * Permissions and authority
 * ========================================================================= */

/** The three Fatwa keys, one per workflow stage. None implies another. */
export const FATWA_PERMISSIONS = Object.freeze({
  receive: 'question.receive',
  answer: 'fatwa.answer',
  publish: 'fatwa.publish',
} as const);

/** The step-up purpose a publication or withdrawal costs, and nothing else accepts. */
export const FATWA_STEP_UP_PURPOSE = 'fatwa-publication' as const;

/**
 * Whether the Fatwa service is open, and under which authority.
 *
 * ACTIVATION IS AN OPERATOR FACT, NOT A PERMISSION. A deployment with no
 * activation row accepts no question and publishes nothing, whoever holds
 * which key: there is nobody the organisation has authorised to handle a real
 * question, so capturing one would be dishonest (OPEN_DECISIONS.md §1.4). The
 * row is written only by the database owner; the runtime can read it and
 * nothing else. `fixture` exists for disposable proof environments only, and
 * every public page it produces says "Test fixture — not a genuine Fatwa".
 */
export type FatwaAuthority = 'fixture' | 'approved';
export const FATWA_AUTHORITIES = Object.freeze([
  'fixture',
  'approved',
] as const) satisfies readonly FatwaAuthority[];

export type FatwaAvailability =
  { readonly active: false } | { readonly active: true; readonly mode: FatwaAuthority };

/* ===========================================================================
 * Identity and bounds
 * ========================================================================= */

export const fatwaIdSchema = z.uuid();

/** An expected version, compared and never trusted. */
export const fatwaVersionSchema = z.number().int().min(0).max(2_147_483_646);

/** Structural ceilings, not claims about any corpus. */
export const FATWA_LIMITS = Object.freeze({
  /** The asker's own words. */
  questionMin: 20,
  questionMax: 4000,
  title: 300,
  publicQuestionMin: 20,
  publicQuestionMax: 4000,
  rulingMin: 20,
  rulingMax: 40_000,
  /** A public correction note, shown in the visible history. */
  correctionReason: 1000,
  /** A private note returning a revision to its drafter. */
  returnNote: 1000,
  /** A private reason recorded with a withdrawal. */
  withdrawalReason: 1000,
  categoryName: 200,
  topicsPerRevision: 10,
} as const);

/**
 * The words `/fatwa/{slug}` shares a path segment with, plus the two derived
 * views that must never become paths (ROUTE_MAP.md §2.3, §3.8). None may be a
 * Fatwa's slug; the database refuses them too.
 */
export const FATWA_RESERVED_SLUGS = Object.freeze([
  'search',
  'categories',
  'topics',
  'how-it-works',
  'ask',
  'latest',
  'popular',
] as const);

const slugShape = z
  .string()
  .min(2)
  .max(120)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

/**
 * A ruling's public slug. It may change while the ruling has never been
 * published and FREEZES at first publication (the database refuses a later
 * change), so a published URL never moves and no slug history is owed.
 */
export const fatwaSlugSchema = slugShape.refine(
  (slug) => !(FATWA_RESERVED_SLUGS as readonly string[]).includes(slug),
  'That slug is reserved.',
);

/** A category's slug: chosen once at creation and never changed. */
export const fatwaCategorySlugSchema = slugShape;

/** A content language code, as Taxonomy's `Language` stores it. */
export const fatwaLanguageSchema = z
  .string()
  .min(2)
  .max(16)
  .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/);

/**
 * Free text a person types — the question, the anonymised public question and
 * the ruling. Line breaks are kept exactly; surrounding whitespace is trimmed
 * here and nowhere else, and no character is substituted.
 */
function writtenText(min: number, max: number) {
  return z
    .string()
    .transform((value) => value.replace(/\r\n?/g, '\n').trim())
    .pipe(
      exactText(max).refine((value) => [...value].length >= min, 'Text is too short.'),
    );
}

/** A one-line human label: no line breaks, no control characters. */
function lineText(max: number) {
  return labelText(max).refine((value) => !hasControlCharacter(value), 'One line only.');
}

/* ===========================================================================
 * Question
 * ========================================================================= */

/**
 * A question's own status. Drafting and review happen on the Fatwa, so they
 * are not repeated here; the combined stage is derived (`fatwaQuestionStage`).
 *
 *   submitted → triaged → assigned → answered (first publication)
 *   submitted | triaged | assigned → declined
 *   submitted | triaged | assigned → closed   (the asker's account closed)
 */
export type FatwaQuestionStatus =
  'submitted' | 'triaged' | 'assigned' | 'answered' | 'declined' | 'closed';
export const FATWA_QUESTION_STATUSES = Object.freeze([
  'submitted',
  'triaged',
  'assigned',
  'answered',
  'declined',
  'closed',
] as const) satisfies readonly FatwaQuestionStatus[];

/** Where a ruling is in drafting and review; null when nothing is pending. */
export type FatwaReviewState = 'drafting' | 'in_review' | 'returned';
export const FATWA_REVIEW_STATES = Object.freeze([
  'drafting',
  'in_review',
  'returned',
] as const) satisfies readonly FatwaReviewState[];

/**
 * The canonical lifecycle of DOMAIN_MODEL.md §12, derived from the two owners'
 * facts so it can never disagree with them.
 */
export type FatwaQuestionStage =
  | 'submitted'
  | 'triaged'
  | 'assigned'
  | 'drafted'
  | 'in_review'
  | 'returned'
  | 'published'
  | 'declined'
  | 'closed';

export function fatwaQuestionStage(
  status: FatwaQuestionStatus,
  reviewState: FatwaReviewState | null,
): FatwaQuestionStage {
  if (status === 'answered') return 'published';
  if (status !== 'assigned') return status;
  if (reviewState === 'drafting') return 'drafted';
  if (reviewState === 'in_review') return 'in_review';
  if (reviewState === 'returned') return 'returned';
  return 'assigned';
}

/**
 * What the ASKER is told. Coarser than the staff lifecycle on purpose: who is
 * drafting and whether a revision was returned are internal workflow facts.
 */
export type FatwaOwnerStatus =
  'received' | 'in_progress' | 'answered' | 'declined' | 'closed';

export function fatwaOwnerStatus(stage: FatwaQuestionStage): FatwaOwnerStatus {
  switch (stage) {
    case 'submitted':
      return 'received';
    case 'published':
      return 'answered';
    case 'declined':
    case 'closed':
      return stage;
    default:
      return 'in_progress';
  }
}

/** The ask form: the question and nothing else. Identity is the session's. */
export const questionSubmissionSchema = z.strictObject({
  body: writtenText(FATWA_LIMITS.questionMin, FATWA_LIMITS.questionMax),
});
export type QuestionSubmissionValue = z.output<typeof questionSubmissionSchema>;

export const questionTriageSchema = z.strictObject({
  id: fatwaIdSchema,
  expectedVersion: fatwaVersionSchema,
  categoryId: fatwaIdSchema,
});
export type QuestionTriageValue = z.output<typeof questionTriageSchema>;

export const questionAssignmentSchema = z.strictObject({
  id: fatwaIdSchema,
  expectedVersion: fatwaVersionSchema,
  assigneeId: z.string().min(1).max(36),
});
export type QuestionAssignmentValue = z.output<typeof questionAssignmentSchema>;

export const questionDeclineSchema = z.strictObject({
  id: fatwaIdSchema,
  expectedVersion: fatwaVersionSchema,
});
export type QuestionDeclineValue = z.output<typeof questionDeclineSchema>;

/* ===========================================================================
 * Ruling revisions
 * ========================================================================= */

/**
 * One draft revision, typed by the assigned answerer. Saving always creates a
 * NEW immutable revision; nothing is edited in place.
 *
 * `publicQuestion` IS NOT THE QUESTION. It is a separately written, anonymised
 * public statement of what was asked — the asker's identity, contact details
 * and personal circumstances left out by a person, never by code.
 *
 * `correctionReason` is required exactly when the ruling is already published:
 * it is shown publicly in the visible correction history.
 */
export const revisionDraftSchema = z.strictObject({
  questionId: fatwaIdSchema,
  /** The Fatwa's version; 0 when no ruling exists yet for the question. */
  expectedVersion: fatwaVersionSchema,
  slug: fatwaSlugSchema,
  title: lineText(FATWA_LIMITS.title),
  publicQuestion: writtenText(
    FATWA_LIMITS.publicQuestionMin,
    FATWA_LIMITS.publicQuestionMax,
  ),
  ruling: writtenText(FATWA_LIMITS.rulingMin, FATWA_LIMITS.rulingMax),
  language: fatwaLanguageSchema,
  categoryId: fatwaIdSchema,
  topicIds: z
    .array(fatwaIdSchema)
    .max(FATWA_LIMITS.topicsPerRevision)
    .refine((ids) => new Set(ids).size === ids.length, 'A topic is listed twice.'),
  correctionReason: writtenText(1, FATWA_LIMITS.correctionReason).nullable(),
});
export type RevisionDraftValue = z.output<typeof revisionDraftSchema>;

/** Submit, publish and return name the exact revision reviewed. */
export const revisionDecisionSchema = z.strictObject({
  fatwaId: fatwaIdSchema,
  expectedVersion: fatwaVersionSchema,
  revisionId: fatwaIdSchema,
});
export type RevisionDecisionValue = z.output<typeof revisionDecisionSchema>;

export const revisionReturnSchema = revisionDecisionSchema.extend({
  note: writtenText(1, FATWA_LIMITS.returnNote),
});
export type RevisionReturnValue = z.output<typeof revisionReturnSchema>;

export const fatwaWithdrawalSchema = z.strictObject({
  fatwaId: fatwaIdSchema,
  expectedVersion: fatwaVersionSchema,
  reason: writtenText(1, FATWA_LIMITS.withdrawalReason),
});
export type FatwaWithdrawalValue = z.output<typeof fatwaWithdrawalSchema>;

/* ===========================================================================
 * Categories
 * ========================================================================= */

export type FatwaCategoryStatus = 'active' | 'archived';
export const FATWA_CATEGORY_STATUSES = Object.freeze([
  'active',
  'archived',
] as const) satisfies readonly FatwaCategoryStatus[];

const categoryNamesSchema = z
  .array(
    z.strictObject({ locale: localeSchema, name: lineText(FATWA_LIMITS.categoryName) }),
  )
  .min(1)
  .max(3)
  .refine(
    (names) => new Set(names.map((entry) => entry.locale)).size === names.length,
    'A locale is named twice.',
  );

/**
 * A domain classification that maps onto exactly one canonical Topic and never
 * replaces it (DOMAIN_MODEL.md §12, §6.2).
 */
export const categoryCreateSchema = z.strictObject({
  slug: fatwaCategorySlugSchema,
  topicId: fatwaIdSchema,
  position: z.number().int().min(0).max(100_000),
  names: categoryNamesSchema,
});
export type CategoryCreateValue = z.output<typeof categoryCreateSchema>;

export const categoryUpdateSchema = z.strictObject({
  id: fatwaIdSchema,
  expectedVersion: fatwaVersionSchema,
  topicId: fatwaIdSchema,
  position: z.number().int().min(0).max(100_000),
  status: z.enum(FATWA_CATEGORY_STATUSES),
  names: categoryNamesSchema,
});
export type CategoryUpdateValue = z.output<typeof categoryUpdateSchema>;

/* ===========================================================================
 * Public browsing
 * ========================================================================= */

/**
 * `/fatwa?sort=` — query-based views, never paths (ROUTE_MAP.md §2.3).
 *
 * `latest`  — first publication instant, newest first.
 * `popular` — anonymous reads over the trailing `FATWA_POPULAR_WINDOW_DAYS`
 *             UTC days, most first. A read is counted by a POST the page sends
 *             after it renders — never by a GET — at most once per network
 *             address per ruling per `FATWA_READ_WINDOW_SECONDS`, and stored
 *             only as a per-ruling, per-day count: no account, address,
 *             cookie, fingerprint or user agent is kept.
 *
 * Both break ties by the first publication instant (newest first) and then by
 * id, so an order is total and repeatable.
 */
export const FATWA_SORTS = Object.freeze(['latest', 'popular'] as const);
export type FatwaSort = (typeof FATWA_SORTS)[number];
export const FATWA_DEFAULT_SORT: FatwaSort = 'latest';
export const FATWA_POPULAR_WINDOW_DAYS = 30;
export const FATWA_READ_WINDOW_SECONDS = 1800;

export const FATWA_PAGE_SIZE = 20;
/** How many rulings one search-results page asks the reader about at once. */
export const FATWA_SEARCH_RECORDS_MAX = 100;
/** A ceiling on how deep a public listing pages, not a corpus size. */
export const FATWA_MAX_OFFSET = 10_000;

export interface FatwaBrowseFilter {
  readonly sort: FatwaSort;
  readonly categoryId: string | null;
  readonly topicId: string | null;
  readonly offset: number;
}

/* ===========================================================================
 * Read models — public
 * ========================================================================= */

export interface FatwaCategoryName {
  readonly locale: Locale;
  readonly name: string;
}

export interface PublicFatwaCategory {
  readonly id: string;
  readonly slug: string;
  readonly topicId: string;
  readonly position: number;
  readonly names: readonly FatwaCategoryName[];
  /** How many rulings are public in it now. */
  readonly publicCount: number;
}

export interface PublicFatwaSummary {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly language: string;
  readonly categoryId: string;
  readonly firstPublishedAt: Date;
  readonly correctedAt: Date | null;
}

export interface PublicFatwaPage {
  readonly items: readonly PublicFatwaSummary[];
  readonly total: number;
  readonly offset: number;
}

/** One entry of the visible public history: every published revision. */
export interface PublicFatwaHistoryEntry {
  readonly sequence: number;
  readonly revisionId: string;
  readonly publishedAt: Date;
  readonly title: string;
  readonly publicQuestion: string;
  readonly ruling: string;
  readonly language: string;
  /** Null for the first publication; the public note for every correction. */
  readonly correctionReason: string | null;
}

/**
 * Everything the canonical page may show — and nothing it may not. No asker,
 * no account id, no assignment, no private question, no internal note.
 * Attribution is a published contributor record, only where the person who
 * acted had one linked to their account at the time.
 */
export interface PublicFatwa {
  readonly id: string;
  readonly slug: string;
  readonly categoryId: string;
  readonly topicIds: readonly string[];
  readonly current: PublicFatwaHistoryEntry;
  /** Older published revisions, newest first. */
  readonly previous: readonly PublicFatwaHistoryEntry[];
  readonly firstPublishedAt: Date;
  readonly answeredByPersonId: string | null;
  readonly publishedByPersonId: string | null;
}

export interface FatwaSitemapEntry {
  readonly slug: string;
  readonly language: string;
  readonly lastModified: Date;
}

/** The current published revision as Search projects it. Public fields only. */
export interface FatwaSearchRecord {
  readonly fatwaId: string;
  readonly slug: string;
  readonly title: string;
  readonly publicQuestion: string;
  readonly ruling: string;
  readonly language: string;
  readonly topicIds: readonly string[];
  readonly publishedAt: Date;
  /** A staleness stamp over everything the projection reads. */
  readonly stamp: string;
}

export interface FatwaTarget {
  readonly fatwaId: string;
  readonly slug: string;
}

/* ===========================================================================
 * Read models — the asker's own
 * ========================================================================= */

export interface OwnQuestionSummary {
  readonly id: string;
  readonly status: FatwaOwnerStatus;
  readonly submittedAt: Date;
}

export interface OwnQuestionPage {
  readonly items: readonly OwnQuestionSummary[];
  readonly total: number;
  readonly offset: number;
}

export interface OwnQuestion extends OwnQuestionSummary {
  /** Null once disposed of; the asker sees their own words until then. */
  readonly body: string | null;
  /** The public ruling's slug, only while it is public. */
  readonly answerSlug: string | null;
}

/* ===========================================================================
 * Read models — staff
 * ========================================================================= */

/** A list row. NO question text: a list never selects it. */
export interface StaffQuestionSummary {
  readonly id: string;
  readonly stage: FatwaQuestionStage;
  readonly categoryId: string | null;
  readonly assigneeId: string | null;
  readonly fatwaId: string | null;
  readonly submittedAt: Date;
  readonly updatedAt: Date;
  readonly version: number;
}

export interface StaffQuestionPage {
  readonly items: readonly StaffQuestionSummary[];
  readonly total: number;
  readonly offset: number;
}

/** A detail view; reading it is an audited data access. */
export interface StaffQuestion extends StaffQuestionSummary {
  readonly body: string;
}

export interface FatwaRevisionRecord {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly publicQuestion: string;
  readonly ruling: string;
  readonly language: string;
  readonly categoryId: string;
  readonly topicIds: readonly string[];
  readonly correctionReason: string | null;
  readonly authorId: string;
  readonly createdAt: Date;
  /** Set once this exact revision was published. */
  readonly publishedAt: Date | null;
}

export interface FatwaReviewNote {
  readonly revisionId: string;
  readonly decision: 'returned' | 'withdrawn';
  readonly note: string;
  readonly actorId: string;
  readonly decidedAt: Date;
}

export interface FatwaRecord {
  readonly id: string;
  readonly questionId: string;
  readonly slug: string;
  readonly version: number;
  readonly reviewState: FatwaReviewState | null;
  readonly pendingRevisionId: string | null;
  readonly publishedRevisionId: string | null;
  readonly firstPublishedAt: Date | null;
  readonly withdrawnAt: Date | null;
  readonly revisions: readonly FatwaRevisionRecord[];
  readonly notes: readonly FatwaReviewNote[];
}

/** A row of the review and published lists. */
export interface FatwaSummary {
  readonly id: string;
  readonly questionId: string;
  readonly slug: string;
  readonly title: string;
  readonly version: number;
  readonly reviewState: FatwaReviewState | null;
  readonly firstPublishedAt: Date | null;
  readonly withdrawnAt: Date | null;
  readonly updatedAt: Date;
}

export interface FatwaSummaryPage {
  readonly items: readonly FatwaSummary[];
  readonly total: number;
  readonly offset: number;
}

export interface FatwaCategoryRecord {
  readonly id: string;
  readonly slug: string;
  readonly topicId: string;
  readonly position: number;
  readonly status: FatwaCategoryStatus;
  readonly names: readonly FatwaCategoryName[];
  readonly version: number;
}

/** A current holder of `fatwa.answer`, as an assignment choice. */
export interface FatwaAnswererChoice {
  readonly accountId: string;
  readonly name: string;
}

/** The name to show for a category in a locale: that locale, else English, else any. */
export function fatwaCategoryName(
  names: readonly FatwaCategoryName[],
  locale: Locale,
): string | null {
  return (
    names.find((entry) => entry.locale === locale)?.name ??
    names.find((entry) => entry.locale === 'en')?.name ??
    names[0]?.name ??
    null
  );
}
