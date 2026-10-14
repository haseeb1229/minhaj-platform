import type { PrivilegedActor } from '../identity/authorization.ts';
import type {
  CategoryCreateValue,
  CategoryUpdateValue,
  FatwaAnswererChoice,
  FatwaAvailability,
  FatwaBrowseFilter,
  FatwaCategoryRecord,
  FatwaRecord,
  FatwaSearchRecord,
  FatwaSitemapEntry,
  FatwaSummaryPage,
  FatwaTarget,
  FatwaWithdrawalValue,
  OwnQuestion,
  OwnQuestionPage,
  PublicFatwa,
  PublicFatwaCategory,
  PublicFatwaPage,
  QuestionAssignmentValue,
  QuestionDeclineValue,
  QuestionSubmissionValue,
  QuestionTriageValue,
  RevisionDecisionValue,
  RevisionDraftValue,
  RevisionReturnValue,
  StaffQuestion,
  StaffQuestionPage,
} from './values.ts';

/**
 * Fatwa's ports. Four of them, for four postures:
 *
 *   PUBLIC READER — anonymous, no actor: only rulings public NOW, only their
 *                   public fields, and nothing at all while the service is not
 *                   activated. It cannot reach a question.
 *   OWNER         — the asker, about their own questions only. Every read is
 *                   keyed by the asker's account id inside the query.
 *   WORKFLOW      — every write to questions and rulings. Each call names the
 *                   acting account, and the database procedure behind it
 *                   re-checks that account's CURRENT permission (and, for
 *                   publication and withdrawal, its live `fatwa-publication`
 *                   step-up grant) before it changes anything. There is no
 *                   other write path: the application principal holds no
 *                   INSERT, UPDATE or DELETE on these tables.
 *   STAFF READER  — workflow reads, each scoped in the query to what the
 *                   actor's stage may see now. A private question's text is
 *                   returned only by the detail reads, and each such read is
 *                   recorded as an audited data access.
 *
 * Activation has no write method anywhere: it is the operator's to record.
 */

/** Who performs a Fatwa operation. */
export interface FatwaActor {
  readonly accountId: string;
}

/** The verified publication authority the database re-checks. */
export interface FatwaPublicationAuthority {
  readonly actorId: string;
  readonly sessionId: string;
  readonly stepUpGrantId: string;
}

/**
 * Identity, as Fatwa needs it — wired at Layer 4. `permits` answers a live
 * permission question; `verifyPublication` re-verifies an Identity-minted
 * `PrivilegedActor` for `fatwa.publish` with the `fatwa-publication` purpose;
 * `answerers` lists the accounts that hold `fatwa.answer` now.
 */
export interface FatwaAuthorityPort {
  permits(accountId: string, permission: string): Promise<boolean>;
  verifyPublication(actor: PrivilegedActor): Promise<boolean>;
  answerers(): Promise<readonly FatwaAnswererChoice[]>;
}

/* ===========================================================================
 * Public reader
 * ========================================================================= */

export interface FatwaPublicReaderPort {
  availability(): Promise<FatwaAvailability>;
  /** Active categories, in order, with how many rulings are public in each. */
  categories(): Promise<readonly PublicFatwaCategory[]>;
  category(slug: string): Promise<PublicFatwaCategory | null>;
  browse(filter: FatwaBrowseFilter): Promise<PublicFatwaPage>;
  /** The canonical page's facts, or null unless public now. */
  fatwa(slug: string): Promise<PublicFatwa | null>;
  /** The Fatwa a public slug names, for counting a read; null unless public now. */
  publicId(slug: string): Promise<string | null>;
  sitemap(offset: number, limit: number): Promise<readonly FatwaSitemapEntry[]>;
  /** Search: the current projection of one ruling, or null when it is not public. */
  searchRecord(fatwaId: string): Promise<FatwaSearchRecord | null>;
  /** Search: every public ruling's scope and stamp, after a cursor, ascending. */
  searchScopes(
    after: string | null,
    limit: number,
  ): Promise<readonly { readonly id: string; readonly stamp: string }[]>;
  /** Search visibility: which of these rulings are public now, and where. */
  publicTargets(ids: readonly string[]): Promise<readonly FatwaTarget[]>;
  /** Search results: the current projection of up to `FATWA_SEARCH_RECORDS_MAX` rulings. */
  searchRecords(ids: readonly string[]): Promise<readonly FatwaSearchRecord[]>;
}

/** Counting an anonymous read: a per-ruling, per-day tally and nothing else. */
export interface FatwaReadTallyPort {
  /** Adds one read for today (UTC) if the ruling is public now. */
  record(fatwaId: string): Promise<void>;
}

/* ===========================================================================
 * The asker
 * ========================================================================= */

export interface FatwaOwnerPort {
  submit(input: {
    readonly id: string;
    readonly askerId: string;
    readonly value: QuestionSubmissionValue;
  }): Promise<void>;
  questions(askerId: string, offset: number): Promise<OwnQuestionPage>;
  question(askerId: string, id: string): Promise<OwnQuestion | null>;
}

/* ===========================================================================
 * Workflow — the only write path
 * ========================================================================= */

interface Acting {
  readonly actorId: string;
}

export interface FatwaWorkflowPort {
  triage(input: Acting & { readonly value: QuestionTriageValue }): Promise<void>;
  assign(input: Acting & { readonly value: QuestionAssignmentValue }): Promise<void>;
  decline(input: Acting & { readonly value: QuestionDeclineValue }): Promise<void>;
  /** Saves a NEW immutable revision; creates the ruling on the first save. */
  saveDraft(
    input: Acting & {
      readonly fatwaId: string;
      readonly revisionId: string;
      readonly value: RevisionDraftValue;
    },
  ): Promise<void>;
  submitForReview(
    input: Acting & { readonly value: RevisionDecisionValue },
  ): Promise<void>;
  returnForRevision(
    input: Acting & { readonly value: RevisionReturnValue },
  ): Promise<void>;
  publish(input: {
    readonly authority: FatwaPublicationAuthority;
    readonly publicationId: string;
    readonly value: RevisionDecisionValue;
  }): Promise<void>;
  withdraw(input: {
    readonly authority: FatwaPublicationAuthority;
    readonly value: FatwaWithdrawalValue;
  }): Promise<void>;
  createCategory(
    input: Acting & { readonly id: string; readonly value: CategoryCreateValue },
  ): Promise<void>;
  updateCategory(input: Acting & { readonly value: CategoryUpdateValue }): Promise<void>;
  /**
   * WHO ASKED — read by the workflow service only after it has committed a
   * decline or a publication, so Layer 4 can tell the asker in-app (Phase 21).
   * The asker's account and the question's id; never the question's words.
   * For a ruling, only its FIRST publication has an asker to tell: a
   * correction answers null, so the question is never "answered" twice.
   */
  askerOf(
    input: { readonly questionId: string } | { readonly fatwaId: string },
  ): Promise<FatwaAsker | null>;
}

/** The asker of one question, as the in-app notification needs it. */
export interface FatwaAsker {
  readonly accountId: string;
  readonly questionId: string;
}

/* ===========================================================================
 * Staff reads — scoped per stage in the query
 * ========================================================================= */

export interface FatwaStaffReaderPort {
  /** Intake under `question.receive`: questions not yet answered, declined or closed. */
  intake(actorId: string, offset: number): Promise<StaffQuestionPage>;
  /** Under `question.receive`: intake questions assigned to an answerer now. */
  assignment(actorId: string, offset: number): Promise<StaffQuestionPage>;
  /** Intake detail. Recorded as an audited data access. */
  intakeQuestion(actorId: string, id: string): Promise<StaffQuestion | null>;
  /** Under `fatwa.answer`: the questions assigned to the actor now. */
  assigned(actorId: string, offset: number): Promise<StaffQuestionPage>;
  /** An assigned question's detail. Recorded as an audited data access. */
  assignedQuestion(actorId: string, id: string): Promise<StaffQuestion | null>;
  /** The ruling for a question assigned to the actor now. */
  assignedFatwa(actorId: string, questionId: string): Promise<FatwaRecord | null>;
  /** Under `fatwa.publish`: rulings awaiting review. */
  reviewQueue(actorId: string, offset: number): Promise<FatwaSummaryPage>;
  /** A ruling under review. */
  reviewFatwa(actorId: string, fatwaId: string): Promise<FatwaRecord | null>;
  /**
   * The private question of a ruling under review, and only while it is. Recorded
   * as an audited data access.
   */
  reviewQuestion(actorId: string, fatwaId: string): Promise<StaffQuestion | null>;
  /** Under `fatwa.publish`: rulings ever published, current and withdrawn. */
  published(actorId: string, offset: number): Promise<FatwaSummaryPage>;
  publishedFatwa(actorId: string, fatwaId: string): Promise<FatwaRecord | null>;
  /** Categories, active and archived, for any Fatwa permission holder. */
  categories(actorId: string): Promise<readonly FatwaCategoryRecord[]>;
}

/* ===========================================================================
 * Account closure
 * ========================================================================= */

/**
 * Fatwa's own part of account closure (SECURITY_BASELINE.md §19.1). Layer 4
 * calls it after Identity's closure has committed; it never reaches another
 * context's data, and it is idempotent and resumable.
 */
export interface FatwaDispositionPort {
  /**
   * Erases the private text of every question of a CLOSED account and closes
   * those not yet answered or declined. Refused for an account that is not
   * closed. Returns how many questions changed.
   */
  disposeAccount(accountId: string): Promise<number>;
  /** A bounded sweep of closed accounts' questions not yet disposed of. */
  disposeClosedAccounts(limit: number): Promise<number>;
}
