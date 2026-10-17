import 'server-only';

import type {
  MessagingAccountPort,
  MessagingActor,
  MessagingAttachmentStoragePort,
  MessagingAuthorityPort,
  MessagingDispositionProgress,
  MessagingExport,
  MessagingPeerPolicyPort,
  MessagingPersistencePort,
  MessagingSurface,
  MessagingTeachingPort,
  AttachmentView,
  CatchUpPage,
  ConversationPage,
  ConversationState,
  ConversationView,
  HistoryPage,
  MessageView,
  ModerationDecisionInput,
  ReportEvidence,
  ReportInput,
  ReportPage,
  ReportState,
  SendMessageInput,
  StartTeachingConversationInput,
  SupportOverview,
  SupportQueuePage,
} from '@minhaj/contracts/messaging';
import type { AssetStream } from '@minhaj/contracts/platform';
import type {
  AuditPort,
  RateLimiterPort,
  RateLimitRule,
} from '@minhaj/contracts/platform';

/**
 * The Messaging service's public surface — what `apps/web` calls today and the
 * Phase-25 realtime transport will call through the SAME implementation
 * (ARCHITECTURE.md §3.1, §3.1.3). Messaging is its semantic owner; this host
 * adds no rule.
 *
 * EVERY CALL RE-DECIDES. No method trusts a participant row, a page that was
 * rendered a moment ago, or a previous call: each re-reads the activation,
 * Learning's current relationship, Identity's live key and Messaging's own
 * blocks and states, so a revocation wins on the next request.
 *
 * ONE ANSWER FOR "NOT YOURS". A conversation the actor has no part in, one of
 * an inactive kind and one that does not exist all refuse `not-found`. Only a
 * participant whose relationship has since ENDED is told `ended` — they already
 * know the conversation existed — and is shown nothing of it.
 */

export const MESSAGING_REFUSAL_REASONS = Object.freeze([
  'invalid',
  'not-found',
  'ended',
  'closed',
  'blocked',
  'terminal',
  'unclaimed',
  'operation-conflict',
  'conflict',
  'rate-limited',
  'too-many',
  'too-large',
  'unsupported',
  'not-cleared',
  'denied',
] as const);
export type MessagingRefusalReason = (typeof MESSAGING_REFUSAL_REASONS)[number];

/** A refusal Messaging chose to give. Anything else thrown is an outage. */
export class MessagingRefusal extends Error {
  readonly reason: MessagingRefusalReason;

  constructor(reason: MessagingRefusalReason) {
    super(`Messaging refused: ${reason}`);
    this.reason = reason;
    this.name = 'MessagingRefusal';
  }
}

/** The failure category a surface shows: a refusal's reason, or `unavailable`. */
export function messagingFailure(error: unknown): MessagingRefusalReason | 'unavailable' {
  return error instanceof MessagingRefusal ? error.reason : 'unavailable';
}

/** Which kinds are switched on now, and whether any switch is a test fixture. */
export interface MessagingCapabilities {
  readonly support: boolean;
  readonly teacherStudent: boolean;
  /** Activated. Each pair is still decided by the peer policy, which denies in production. */
  readonly studentStudent: boolean;
  /** Some active capability is a `fixture` row — a disposable proof's state. */
  readonly fixture: boolean;
}

/** A teaching relationship the actor could message within — offered, never a directory. */
export interface StartableConversation {
  readonly counterpartAccountId: string;
  readonly courseId: string;
}

/** A support conversation as its STAFF view shows it. */
export interface SupportConversationView {
  readonly conversation: ConversationView;
  readonly requesterAccountId: string;
  readonly claimedByAccountId: string | null;
  readonly version: number;
}

/** The engineering rate-limit budgets, per account (single-instance limiter). */
export interface MessagingRateRules {
  readonly start: RateLimitRule;
  readonly send: RateLimitRule;
  readonly sendPerConversation: RateLimitRule;
  readonly upload: RateLimitRule;
  readonly supportOpen: RateLimitRule;
  readonly report: RateLimitRule;
  readonly block: RateLimitRule;
  readonly staffRead: RateLimitRule;
  readonly moderation: RateLimitRule;
  readonly export: RateLimitRule;
}

export interface MessagingServiceDependencies {
  readonly persistence: MessagingPersistencePort;
  readonly teaching: MessagingTeachingPort;
  readonly authority: MessagingAuthorityPort;
  readonly accounts: MessagingAccountPort;
  /** Production wiring: `denyAllPeers`. */
  readonly peers: MessagingPeerPolicyPort;
  readonly storage: MessagingAttachmentStoragePort;
  readonly audit: AuditPort;
  readonly limiter: RateLimiterPort;
  readonly limitKey: (purpose: string, subject: string) => string;
  readonly clock?: () => Date;
}

export interface MessagingService {
  capabilities(): Promise<MessagingCapabilities>;

  /* ---- a person's own conversations ------------------------------------ */
  /** `my`: learner, peer and requester conversations; `teacher`: the actor's teacher conversations. */
  conversations(
    actor: MessagingActor,
    input: { readonly surface: MessagingSurface; readonly cursor: string | null },
  ): Promise<ConversationPage>;
  conversation(actor: MessagingActor, conversationId: string): Promise<ConversationView>;
  history(
    actor: MessagingActor,
    conversationId: string,
    before: number | null,
  ): Promise<HistoryPage>;
  /** Durable catch-up: exactly the messages after `after`, bounded, in order. */
  catchUp(
    actor: MessagingActor,
    conversationId: string,
    after: number,
  ): Promise<CatchUpPage>;
  /** Unread messages across the actor's first page of conversations, for My Home. */
  unreadTotal(actor: MessagingActor): Promise<number>;
  /** The learner-side teaching relationships the actor could message within now. */
  startable(actor: MessagingActor): Promise<readonly StartableConversation[]>;
  /** Opens (or returns) the direct conversation of a CURRENT teaching relationship, from either side. */
  startTeaching(
    actor: MessagingActor,
    input: StartTeachingConversationInput,
  ): Promise<{ readonly conversationId: string }>;
  /** Student-to-student. Refused while OPEN_DECISIONS.md §2.5 is open (the peer policy denies). */
  startPeer(
    actor: MessagingActor,
    input: StartTeachingConversationInput,
  ): Promise<{ readonly conversationId: string }>;
  send(
    actor: MessagingActor,
    conversationId: string,
    input: SendMessageInput,
  ): Promise<{ readonly message: MessageView; readonly replayed: boolean }>;
  markRead(
    actor: MessagingActor,
    conversationId: string,
    sequence: number,
  ): Promise<{ readonly readSequence: number }>;

  /* ---- safety ---------------------------------------------------------- */
  /** Blocks the counterpart of a direct conversation the actor takes part in. Idempotent. */
  block(actor: MessagingActor, conversationId: string): Promise<void>;
  /** Idempotent. */
  unblock(actor: MessagingActor, counterpartAccountId: string): Promise<void>;
  blocks(
    actor: MessagingActor,
  ): Promise<readonly { readonly blockedAccountId: string; readonly createdAt: Date }[]>;
  report(
    actor: MessagingActor,
    input: ReportInput,
  ): Promise<{ readonly reportId: string; readonly duplicate: boolean }>;

  /* ---- attachments ----------------------------------------------------- */
  /**
   * Decides send authority FIRST, then consumes `bytes` into Storage under a
   * fresh release token recorded beforehand. Only a clean JPEG, PNG or PDF
   * within the bounds becomes an attachment; anything else is released.
   */
  uploadAttachment(
    actor: MessagingActor,
    conversationId: string,
    bytes: AsyncIterable<Uint8Array>,
    declared: { readonly mediaType: string | null; readonly displayName: string | null },
  ): Promise<AttachmentView>;
  /** Releases one of the actor's own unsent uploads. */
  discardAttachment(actor: MessagingActor, attachmentId: string): Promise<void>;
  /** Both halves: Messaging's read decision NOW, then Storage's clean custody. `null` for every denial. */
  openAttachment(
    actor: MessagingActor,
    attachmentId: string,
  ): Promise<AssetStream | null>;

  /* ---- support --------------------------------------------------------- */
  support(actor: MessagingActor): Promise<SupportOverview>;
  openSupport(actor: MessagingActor): Promise<{ readonly conversationId: string }>;
  /** Live `messaging.support`. Metadata only — opening content is a separate, audited act. */
  supportQueue(
    actor: MessagingActor,
    input: { readonly state: ConversationState; readonly cursor: string | null },
  ): Promise<SupportQueuePage>;
  /** Live `messaging.support`; audited as a sensitive access. */
  supportConversation(
    actor: MessagingActor,
    conversationId: string,
  ): Promise<SupportConversationView>;
  /** Live `messaging.support`; audited. */
  supportHistory(
    actor: MessagingActor,
    conversationId: string,
    before: number | null,
  ): Promise<HistoryPage>;
  /** Live `messaging.support`; staff attachment bytes, audited. */
  openSupportAttachment(
    actor: MessagingActor,
    attachmentId: string,
  ): Promise<AssetStream | null>;
  claimSupport(
    actor: MessagingActor,
    conversationId: string,
    expectedVersion: number,
  ): Promise<void>;
  resolveSupport(
    actor: MessagingActor,
    conversationId: string,
    expectedVersion: number,
  ): Promise<void>;

  /* ---- moderation ------------------------------------------------------ */
  /** Live `messaging.moderate`. Identifiers and states, never content. */
  reports(
    actor: MessagingActor,
    input: { readonly state: ReportState; readonly cursor: string | null },
  ): Promise<ReportPage>;
  /** Live `messaging.moderate`; the bounded evidence ONE report authorises; audited. */
  evidence(actor: MessagingActor, reportId: string): Promise<ReportEvidence>;
  /** Live `messaging.moderate`; an attachment inside that report's evidence only; audited. */
  openEvidenceAttachment(
    actor: MessagingActor,
    reportId: string,
    attachmentId: string,
  ): Promise<AssetStream | null>;
  decide(actor: MessagingActor, input: ModerationDecisionInput): Promise<void>;

  /* ---- export and disposition ----------------------------------------- */
  export(actor: MessagingActor): Promise<MessagingExport>;
  /** Refused unless Identity reports the account CLOSED. Bounded, idempotent, resumable. */
  disposeAccount(accountId: string): Promise<MessagingDispositionProgress>;
  /** Finishes every closed account's and every marked conversation's pending work, bounded. */
  reconcileClosedAccounts(): Promise<MessagingDispositionProgress>;
  /** Releases unsent uploads older than the bound and finishes interrupted releases. Bounded. */
  sweepAttachments(): Promise<number>;
}
