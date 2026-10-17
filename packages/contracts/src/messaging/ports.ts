import type { AuditEvent } from '../platform/ports.ts';
import type { StorageServicePort } from '../platform/storage.ts';
import type {
  AttachmentState,
  ConversationClosedReason,
  ConversationKind,
  ConversationState,
  DirectConversationKind,
  MessageModerationState,
  MessagingAuthority,
  MessagingCapability,
  MessagingExport,
  ModerationAction,
  ParticipantRole,
  ReportReason,
  ReportState,
} from './values.ts';

/**
 * The ports between Messaging and what it depends on (ARCHITECTURE.md §3.1.1).
 *
 * THE HOSTED SERVICE TAKES THESE AND NOTHING ELSE. Messaging's application
 * services live in `packages/server-core/src/messaging` so the web process
 * and the Phase-25 realtime transport call one implementation; that host may
 * import no database, storage or provider package, so everything it needs
 * arrives here as a narrow, named port wired at Layer 4.
 *
 *   - `MessagingPersistencePort` — Messaging's own rows, through its owning
 *     adapter. Every method is one named act with its own bounds: no
 *     repository, no `where`, no transaction handle, no raw query.
 *   - `MessagingTeachingPort` — Learning's current-relationship answer
 *     (DOMAIN_MODEL.md §3.2). Messaging never reads a Learning table.
 *   - `MessagingAuthorityPort` — Identity's live answer for the two
 *     externally gated keys.
 *   - `MessagingAccountPort` — Identity's answer to "which of these accounts
 *     are closed", for the terminal-history rule and disposition.
 *   - `MessagingPeerPolicyPort` — the student-to-student policy seam. Its
 *     production wiring DENIES; only a disposable proof supplies another.
 *   - `MessagingAttachmentStoragePort` — the Storage service, narrowed.
 */

/* ===========================================================================
 * Records the adapter returns — facts, never decisions
 * ========================================================================= */

export interface ParticipantRecord {
  readonly accountId: string;
  readonly role: ParticipantRole;
  readonly joinedAt: Date;
  /** Set when the person left: their account closed, or a support claim moved on. */
  readonly leftAt: Date | null;
}

export interface ConversationRecord {
  readonly id: string;
  readonly kind: ConversationKind;
  readonly courseId: string | null;
  readonly state: ConversationState;
  readonly closedReason: ConversationClosedReason | null;
  readonly closedAt: Date | null;
  readonly lastSequence: number;
  readonly lastMessageAt: Date | null;
  readonly createdAt: Date;
  readonly version: number;
  /** Every participant row, current and past. Bounded: at most a handful. */
  readonly participants: readonly ParticipantRecord[];
}

export interface AttachmentFact {
  readonly id: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly displayName: string | null;
  readonly position: number;
}

export interface MessageRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly sequence: number;
  readonly senderAccountId: string;
  readonly body: string;
  readonly moderation: MessageModerationState;
  readonly sentAt: Date;
  /** In position order. */
  readonly attachments: readonly AttachmentFact[];
}

export interface MessageAttachmentRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly uploaderAccountId: string;
  readonly state: AttachmentState;
  readonly messageId: string | null;
  readonly assetId: string | null;
  readonly mediaType: string | null;
  readonly byteSize: number | null;
  readonly displayName: string | null;
  readonly createdAt: Date;
  /** The moderation state of the message it is attached to, while attached. */
  readonly messageModeration: MessageModerationState | null;
}

export interface ReadingState {
  readonly readSequence: number;
  /** Messages from others after `readSequence`. */
  readonly unread: number;
}

export interface SupportQueueRecord {
  readonly conversation: ConversationRecord;
  /** The last message was the person's own. */
  readonly awaitingReply: boolean;
}

export interface ReportRecord {
  readonly id: string;
  readonly conversationId: string;
  readonly conversationKind: ConversationKind;
  readonly messageId: string | null;
  readonly reporterAccountId: string;
  readonly reason: ReportReason;
  /** The conversation's last sequence when the report was filed. */
  readonly atSequence: number;
  /** The reported message's sequence, when a message is the target. */
  readonly messageSequence: number | null;
  readonly state: ReportState;
  readonly createdAt: Date;
  readonly version: number;
  readonly decision: {
    readonly action: ModerationAction;
    readonly decidedAt: Date;
    readonly moderatorAccountId: string;
  } | null;
}

/** A keyset position: the activity instant and the id that breaks its ties. */
export interface ActivityCursor {
  readonly at: Date;
  readonly id: string;
}

/* ===========================================================================
 * Outcomes the adapter reports
 * ========================================================================= */

/**
 * What one append did. `replayed` is the SAME operation identifier with the
 * SAME payload — the existing message, created by an earlier attempt;
 * `conflict` is the same identifier with a different payload, which never
 * touches the existing message. The rest are refusals the adapter re-proves
 * under its own lock, after the service's checks, so a race cannot slip past.
 */
export type AppendOutcome =
  | { readonly state: 'created'; readonly message: MessageRecord }
  | { readonly state: 'replayed'; readonly message: MessageRecord }
  | { readonly state: 'conflict' }
  | { readonly state: 'closed' }
  | { readonly state: 'not-participant' }
  | { readonly state: 'blocked' }
  | { readonly state: 'attachment-unavailable' };

export type ClaimOutcome = 'claimed' | 'conflict' | 'closed' | 'missing';
export type ResolveOutcome = 'resolved' | 'conflict' | 'closed' | 'missing';
export type DecisionOutcome = 'decided' | 'conflict' | 'invalid' | 'missing';

export type ReportOutcome =
  | { readonly state: 'filed'; readonly reportId: string }
  | { readonly state: 'duplicate'; readonly reportId: string }
  | { readonly state: 'invalid' };

/** One release the service owes Storage: the attachment and the secret it was stored under. */
export interface PendingRelease {
  readonly attachmentId: string;
  readonly releaseToken: string;
}

export interface DisposalCandidate {
  readonly conversationId: string;
  readonly kind: ConversationKind;
  /** Every OTHER non-support participant (or the requester, for support). */
  readonly otherAccountIds: readonly string[];
  /** A report names this conversation: it is evidence and is never disposed. */
  readonly evidence: boolean;
}

export type DisposalStep = 'progress' | 'awaiting-release' | 'removed';

/* ===========================================================================
 * Messaging's persistence
 * ========================================================================= */

export interface MessagingPersistencePort {
  /* ---- activation (owner/operator-written; the runtime only reads) ------- */
  activations(): Promise<ReadonlyMap<MessagingCapability, MessagingAuthority>>;

  /* ---- conversations ----------------------------------------------------- */
  conversation(conversationId: string): Promise<ConversationRecord | null>;
  /**
   * The conversations in which `accountId` holds a CURRENT (not left)
   * participant row in one of `roles`, newest activity first, after `after`.
   * Membership is only the candidate set: the service re-decides each one.
   */
  conversationsOf(input: {
    readonly accountId: string;
    readonly roles: readonly ParticipantRole[];
    readonly after: ActivityCursor | null;
    readonly limit: number;
  }): Promise<readonly ConversationRecord[]>;
  /**
   * The ONE direct conversation of this kind between these two people on this
   * Course — created with both participant rows if absent. Concurrent calls
   * converge on one row (unique key), and `created` says which call made it.
   */
  openDirect(input: {
    readonly kind: DirectConversationKind;
    readonly courseId: string;
    readonly first: { readonly accountId: string; readonly role: ParticipantRole };
    readonly second: { readonly accountId: string; readonly role: ParticipantRole };
  }): Promise<{ readonly conversation: ConversationRecord; readonly created: boolean }>;
  /** The person's ONE open support conversation — created if absent (unique key). */
  openSupport(requesterAccountId: string): Promise<{
    readonly conversation: ConversationRecord;
    readonly created: boolean;
  }>;
  /** The reader's high-water mark and unread count in each of `conversationIds`. */
  readingStates(
    accountId: string,
    conversationIds: readonly string[],
  ): Promise<ReadonlyMap<string, ReadingState>>;

  /* ---- messages ---------------------------------------------------------- */
  /** Oldest first: the `limit` messages before `before` (or the newest, when `null`). */
  history(input: {
    readonly conversationId: string;
    readonly before: number | null;
    readonly limit: number;
  }): Promise<readonly MessageRecord[]>;
  /** Oldest first: up to `limit` messages after `after`. */
  after(input: {
    readonly conversationId: string;
    readonly after: number;
    readonly limit: number;
  }): Promise<readonly MessageRecord[]>;
  /** Oldest first: the messages with `from <= sequence <= to`. The caller bounds the span. */
  span(input: {
    readonly conversationId: string;
    readonly from: number;
    readonly to: number;
  }): Promise<readonly MessageRecord[]>;
  /**
   * Appends one message under the conversation's lock: replay/conflict by
   * operation identifier first, then open state, the sender's current
   * participation, the block pair (both directions, when given) and each
   * attachment (the sender's own `ready` upload in this conversation), then
   * the next sequence, the attachments' association and the sender's own
   * high-water mark — all in one transaction.
   */
  append(input: {
    readonly conversationId: string;
    readonly senderAccountId: string;
    readonly operationId: string;
    readonly body: string;
    readonly payloadDigest: string;
    readonly attachmentIds: readonly string[];
    readonly blockPair: readonly [string, string] | null;
  }): Promise<AppendOutcome>;
  /** Raises the reader's high-water mark to `sequence` (never lowers it); returns the result. */
  markRead(input: {
    readonly conversationId: string;
    readonly accountId: string;
    readonly sequence: number;
  }): Promise<number>;

  /* ---- blocks ------------------------------------------------------------ */
  blockState(
    first: string,
    second: string,
  ): Promise<{
    readonly firstBlockedSecond: boolean;
    readonly secondBlockedFirst: boolean;
  }>;
  /** Idempotent. */
  block(blockerAccountId: string, blockedAccountId: string): Promise<void>;
  /** Idempotent. */
  unblock(blockerAccountId: string, blockedAccountId: string): Promise<void>;
  blocksBy(
    blockerAccountId: string,
    limit: number,
  ): Promise<readonly { readonly blockedAccountId: string; readonly createdAt: Date }[]>;

  /* ---- attachments ------------------------------------------------------- */
  /**
   * Records an upload BEFORE its bytes are stored, with the release token the
   * bytes will be stored under — so a crash after storing can never leave a
   * clean asset nobody can release. Refuses past `limit` unsent uploads.
   */
  prepareAttachment(input: {
    readonly conversationId: string;
    readonly uploaderAccountId: string;
    readonly releaseToken: string;
    readonly limit: number;
  }): Promise<
    | { readonly state: 'prepared'; readonly attachmentId: string }
    | { readonly state: 'too-many' }
  >;
  /** `pending` → `ready`, with the facts STORAGE measured. `false` if it is no longer pending. */
  recordAttachment(input: {
    readonly attachmentId: string;
    readonly uploaderAccountId: string;
    readonly assetId: string;
    readonly mediaType: string;
    readonly byteSize: number;
    readonly displayName: string | null;
  }): Promise<boolean>;
  /** An unsent upload (`pending` or `ready`) → `releasing`; its release, or `null`. */
  abandonAttachment(attachmentId: string): Promise<PendingRelease | null>;
  attachment(attachmentId: string): Promise<MessageAttachmentRecord | null>;
  /**
   * Bounded: every `releasing` row, after first moving each unsent upload older
   * than `staleBefore` to `releasing` — optionally only one conversation's.
   */
  releaseQueue(input: {
    readonly staleBefore: Date;
    readonly conversationId: string | null;
    readonly limit: number;
  }): Promise<readonly PendingRelease[]>;
  /** Deletes a `releasing` row once Storage released its asset. */
  forgetAttachment(attachmentId: string): Promise<void>;

  /* ---- support ----------------------------------------------------------- */
  supportQueue(input: {
    readonly state: ConversationState;
    readonly after: ActivityCursor | null;
    readonly limit: number;
  }): Promise<readonly SupportQueueRecord[]>;
  /** Makes `staffAccountId` the one active support participant; audited in the same transaction. */
  claimSupport(input: {
    readonly conversationId: string;
    readonly staffAccountId: string;
    readonly expectedVersion: number;
    readonly audit: AuditEvent;
  }): Promise<ClaimOutcome>;
  /** Closes a support conversation as `resolved`; audited in the same transaction. */
  resolveSupport(input: {
    readonly conversationId: string;
    readonly staffAccountId: string;
    readonly expectedVersion: number;
    readonly audit: AuditEvent;
  }): Promise<ResolveOutcome>;

  /* ---- reports and moderation -------------------------------------------- */
  /** One OPEN report per reporter and target; a second answers `duplicate`. */
  fileReport(input: {
    readonly conversationId: string;
    readonly messageId: string | null;
    readonly reporterAccountId: string;
    readonly reason: ReportReason;
  }): Promise<ReportOutcome>;
  reports(input: {
    readonly state: ReportState;
    readonly after: ActivityCursor | null;
    readonly limit: number;
  }): Promise<readonly ReportRecord[]>;
  report(reportId: string): Promise<ReportRecord | null>;
  /**
   * Records one immutable decision on an OPEN report at its expected version,
   * applies its effect (withhold the reported message; close the conversation)
   * and resolves the report — with the audit row, in one transaction.
   */
  decide(input: {
    readonly reportId: string;
    readonly expectedVersion: number;
    readonly moderatorAccountId: string;
    readonly action: ModerationAction;
    readonly audit: AuditEvent;
  }): Promise<DecisionOutcome>;

  /* ---- export and disposition -------------------------------------------- */
  exportFor(
    accountId: string,
  ): Promise<Omit<MessagingExport, 'schema' | 'version' | 'generatedAt'>>;
  /** Accounts holding live Messaging state, in identifier order after `after`. Bounded. */
  accountsWithData(after: string | null, limit: number): Promise<readonly string[]>;
  /**
   * For a CLOSED account, up to `limit` rows of its live state: its open
   * conversations closed as `account-closed`, its participation ended, its read
   * state and blocks removed, its unsent uploads moved to `releasing`. Returns
   * how many rows changed; `0` means nothing is left to withdraw.
   */
  withdrawAccount(accountId: string, limit: number): Promise<number>;
  /**
   * Closed conversations the account took part in that are not yet being
   * disposed and in which EVERY non-support participant has left (a person
   * leaves only through their own account's withdrawal), in conversation-id
   * order after `after`. A conversation still held by a living participant is
   * never a candidate, so retained history costs nothing on later runs. The
   * service still confirms each closure with Identity before marking.
   */
  disposalCandidates(
    accountId: string,
    after: string | null,
    limit: number,
  ): Promise<readonly DisposalCandidate[]>;
  /** Marks a conversation for disposal and moves its attachments to `releasing`. Idempotent. */
  beginDisposal(conversationId: string): Promise<void>;
  /** Conversations marked for disposal, bounded. */
  disposing(limit: number): Promise<readonly string[]>;
  /**
   * One bounded step of a marked conversation's removal: messages and read
   * state go in batches; the conversation and its participants go last, only
   * once no attachment row is left.
   */
  disposeStep(conversationId: string, limit: number): Promise<DisposalStep>;
}

/* ===========================================================================
 * What Messaging asks other owners — wired at Layer 4
 * ========================================================================= */

/** Learning's current-relationship answer (DOMAIN_MODEL.md §3.2, §15.3). */
export interface MessagingTeachingPort {
  standing(
    queries: readonly {
      readonly teacherAccountId: string;
      readonly learnerAccountId: string;
      readonly courseId: string;
    }[],
  ): Promise<readonly { readonly teacher: boolean; readonly learner: boolean }[]>;
  currentTeachers(
    learnerAccountId: string,
  ): Promise<readonly { readonly teacherAccountId: string; readonly courseId: string }[]>;
}

/** The two Messaging keys. Both are externally gated (SECURITY_BASELINE.md §3.5). */
export type MessagingPermission = 'messaging.support' | 'messaging.moderate';

/** Identity's LIVE answer: does this account hold this key, now, while active. */
export interface MessagingAuthorityPort {
  permits(accountId: string, permission: MessagingPermission): Promise<boolean>;
}

/** Identity's answer: which of these accounts are closed. Bounded by the input. */
export interface MessagingAccountPort {
  closedAccounts(accountIds: readonly string[]): Promise<readonly string[]>;
}

/**
 * The student-to-student policy seam (OPEN_DECISIONS.md §2.5 is OPEN).
 *
 * The production wiring answers `false` for every question; there is no
 * permission, setting or checkbox that changes that. A future approved policy
 * is implemented behind this port, with its own tests, before activation.
 */
export interface MessagingPeerPolicyPort {
  permits(input: {
    readonly firstAccountId: string;
    readonly secondAccountId: string;
    readonly courseId: string;
  }): Promise<boolean>;
}

/**
 * The Storage service, narrowed to what Messaging uses: store an upload under
 * its release token, open a clean attachment behind Messaging's own decision,
 * and release what Messaging stored. No path, root, delete-by-id or reconcile.
 */
export type MessagingAttachmentStoragePort = Pick<
  StorageServicePort,
  'store' | 'open' | 'release'
>;
