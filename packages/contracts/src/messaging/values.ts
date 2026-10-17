import { z } from 'zod';

/**
 * Messaging — Conversation, ConversationParticipant, Message, MessageAttachment,
 * MessageReadState, Block, Report and moderation records (DOMAIN_MODEL.md §15,
 * DELIVERY_PLAN.md Phase 24).
 *
 * WHAT PHASE 24 IS. Durable, NON-REALTIME messaging through the web
 * application: a person's conversations, bounded history, durable per-
 * conversation ordering, high-water read state, idempotent send, catch-up from
 * durable history, Storage-backed attachments, blocking, reporting, a support
 * queue and moderation primitives. Delivery is on-refresh. Phase 25 adds a
 * realtime TRANSPORT over the same services; nothing here is a socket,
 * presence or typing state, and nothing transport-shaped is persisted.
 *
 * THREE KINDS, AND NO OTHERS. A teacher and a learner on one Course, two
 * learners (disabled while OPEN_DECISIONS.md §2.5 is open), and a person's
 * support conversation with the organisation. No room, group, broadcast,
 * announcement channel, call, story or status exists.
 *
 * PLAIN TEXT, IMMUTABLE. A message body is plain text rendered as text nodes —
 * no markup, no Markdown, no link preview and no server-side fetch. Once sent it
 * never changes: moderation withholds a message from ordinary view and keeps it
 * as evidence, it never rewrites it.
 *
 * NO POLICY IS INVENTED. No age, guardian, vetting, retention period, strike,
 * ban or escalation rule exists here (OPEN_DECISIONS.md §2.1, §2.2, §2.5, §6.6).
 */

/* ===========================================================================
 * Identifiers
 * ========================================================================= */

export const messagingIdSchema = z.uuid();

/** An account id as Identity issues it — opaque here, never parsed. */
export const messagingAccountIdSchema = z.string().min(1).max(36);

/** A Course id as Learning issues it — opaque here. */
export const messagingCourseIdSchema = z.uuid();

export const messagingVersionSchema = z.number().int().positive().max(2_147_483_646);

/** A position in one conversation's durable order. `0` means "before the first message". */
export const messageSequenceSchema = z.number().int().min(0).max(2_147_483_646);

/* ===========================================================================
 * Controlled vocabularies (each mirrored by a database CHECK)
 * ========================================================================= */

export const CONVERSATION_KINDS = Object.freeze([
  'teacher-student',
  'student-student',
  'support',
] as const);
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

/** The two kinds between exactly two people. Support is not a peer relation. */
export type DirectConversationKind = Exclude<ConversationKind, 'support'>;

/**
 * The capabilities `MessagingActivation` switches on, one per kind. Absent is
 * OFF; a `fixture` row is a disposable proof's; an `approved` row records the
 * organisation's decision with its evidence.
 */
export const MESSAGING_CAPABILITIES = CONVERSATION_KINDS;
export type MessagingCapability = ConversationKind;

export const MESSAGING_AUTHORITIES = Object.freeze(['fixture', 'approved'] as const);
export type MessagingAuthority = (typeof MESSAGING_AUTHORITIES)[number];

export const PARTICIPANT_ROLES = Object.freeze([
  'teacher',
  'learner',
  'peer',
  'requester',
  'support',
] as const);
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

export const CONVERSATION_STATES = Object.freeze(['open', 'closed'] as const);
export type ConversationState = (typeof CONVERSATION_STATES)[number];

/**
 * Why a conversation stopped accepting messages. `account-closed` is the ONLY
 * reason that creates the terminal-history rule (DOMAIN_MODEL.md §15.6);
 * `moderation` is a moderator's decision; `resolved` closes a support
 * conversation and lets its person start a new one.
 */
export const CONVERSATION_CLOSED_REASONS = Object.freeze([
  'account-closed',
  'moderation',
  'resolved',
] as const);
export type ConversationClosedReason = (typeof CONVERSATION_CLOSED_REASONS)[number];

export const MESSAGE_MODERATION_STATES = Object.freeze(['visible', 'withheld'] as const);
export type MessageModerationState = (typeof MESSAGE_MODERATION_STATES)[number];

/** A small controlled reason. There is no free-text narrative: the reported content is the evidence. */
export const REPORT_REASONS = Object.freeze([
  'harassment',
  'spam',
  'inappropriate',
  'safety',
  'other',
] as const);
export type ReportReason = (typeof REPORT_REASONS)[number];

export const REPORT_STATES = Object.freeze(['open', 'resolved'] as const);
export type ReportState = (typeof REPORT_STATES)[number];

/** The only moderation acts. No strike, suspension, ban or escalation exists. */
export const MODERATION_ACTIONS = Object.freeze([
  'dismiss',
  'withhold-message',
  'close-conversation',
] as const);
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const ATTACHMENT_STATES = Object.freeze([
  'pending',
  'ready',
  'attached',
  'releasing',
] as const);
export type AttachmentState = (typeof ATTACHMENT_STATES)[number];

/* ===========================================================================
 * Bounds — ENGINEERING bounds, not policy promises
 * ========================================================================= */

/**
 * Every bound in one place. These are engineering ceilings chosen so nothing is
 * unbounded; none is a product, retention or legal promise.
 */
export const MESSAGING_LIMITS = Object.freeze({
  /** Unicode code points in one message body. */
  bodyMax: 4_000,
  attachmentsPerMessage: 4,
  /** Bytes in one attachment. */
  attachmentMaxBytes: 5 * 1024 * 1024,
  /** Unsent uploads one person may hold in one conversation at once. */
  pendingUploadsPerConversation: 8,
  /** An upload never attached to a message is released after this long. */
  unattachedUploadHours: 24,
  conversationPage: 25,
  historyPage: 30,
  catchUpPage: 50,
  supportQueuePage: 25,
  reportPage: 25,
  blockPage: 50,
  /** Messages either side of a reported message a moderator may read. */
  evidenceAround: 10,
  /** Messages up to a reported conversation's report instant a moderator may read. */
  evidenceConversation: 30,
  /** Conversations an export or one closure batch handles at once. */
  dispositionBatch: 50,
} as const);

/** The only formats a message may carry. Storage recognises more; Messaging narrows. */
export const MESSAGING_ATTACHMENT_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'application/pdf',
] as const);
export type MessagingAttachmentType = (typeof MESSAGING_ATTACHMENT_TYPES)[number];

/** Still-image bounds (Storage strips hidden metadata from both formats). */
export const MESSAGING_IMAGE_LIMITS = Object.freeze({
  maxPixels: 40_000_000,
  maxEdge: 8_192,
});

/* ===========================================================================
 * Input schemas — the trust boundary
 * ========================================================================= */

/**
 * Characters a plain-text message may not carry: C0 controls except tab and
 * line feed, DEL, C1 controls, and the bidirectional overrides and isolates
 * that can make text render in a different order from the one stored.
 */
function disallowed(codePoint: number): boolean {
  return (
    (codePoint <= 0x1f && codePoint !== 0x09 && codePoint !== 0x0a) ||
    (codePoint >= 0x7f && codePoint <= 0x9f) ||
    (codePoint >= 0x202a && codePoint <= 0x202e) ||
    (codePoint >= 0x2066 && codePoint <= 0x2069)
  );
}

/**
 * A message body: NFC, line endings normalised to `\n`, at most
 * `MESSAGING_LIMITS.bodyMax` code points. Empty is allowed here — the send
 * schema requires text OR an attachment.
 */
export const messageBodySchema = z
  .string()
  .transform((value) => value.replace(/\r\n?/g, '\n').normalize('NFC'))
  .refine(
    (value) => ![...value].some((character) => disallowed(character.codePointAt(0) ?? 0)),
    'That text contains characters a message cannot carry.',
  )
  .refine(
    (value) => [...value].length <= MESSAGING_LIMITS.bodyMax,
    'That message is too long.',
  );

export const sendMessageSchema = z
  .object({
    /** The client's operation identifier: a retry with it creates nothing new. */
    operationId: z.uuid(),
    body: messageBodySchema,
    attachmentIds: z
      .array(messagingIdSchema)
      .max(MESSAGING_LIMITS.attachmentsPerMessage)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        'An attachment is listed twice.',
      ),
  })
  .strict()
  .refine(
    (input) => input.body.trim().length > 0 || input.attachmentIds.length > 0,
    'A message needs text or an attachment.',
  );
export type SendMessageInput = z.input<typeof sendMessageSchema>;

export const reportInputSchema = z
  .object({
    conversationId: messagingIdSchema,
    messageId: messagingIdSchema.nullable(),
    reason: z.enum(REPORT_REASONS),
  })
  .strict();
export type ReportInput = z.input<typeof reportInputSchema>;

export const moderationDecisionSchema = z
  .object({
    reportId: messagingIdSchema,
    action: z.enum(MODERATION_ACTIONS),
    expectedVersion: messagingVersionSchema,
  })
  .strict();
export type ModerationDecisionInput = z.input<typeof moderationDecisionSchema>;

export const startTeachingConversationSchema = z
  .object({
    counterpartAccountId: messagingAccountIdSchema,
    courseId: messagingCourseIdSchema,
  })
  .strict();
export type StartTeachingConversationInput = z.input<
  typeof startTeachingConversationSchema
>;

/* ===========================================================================
 * Read views
 * ========================================================================= */

/** Who is asking. Resolved from the session, never from a form. */
export interface MessagingActor {
  readonly accountId: string;
}

/** Where a person meets their own conversations. */
export type MessagingSurface = 'my' | 'teacher';

/**
 * What a reader may do with a conversation NOW.
 *
 *   - `available` — the current relationship (or permission) holds; read and,
 *     when open and unblocked, send.
 *   - `terminal` — the counterpart's account was closed; the remaining
 *     participant reads the history it left, read-only, while their own half of
 *     the relationship is current.
 */
export type ConversationAccess = 'available' | 'terminal';

/** Why a reader who may read cannot send right now. */
export type SendRefusal = 'closed' | 'blocked' | 'terminal' | 'unclaimed';

export interface ConversationSummary {
  readonly id: string;
  readonly kind: ConversationKind;
  readonly courseId: string | null;
  readonly state: ConversationState;
  readonly closedReason: ConversationClosedReason | null;
  /** The reader's own role in it. */
  readonly role: ParticipantRole;
  /** The other person of a direct conversation; `null` for support. */
  readonly counterpartAccountId: string | null;
  readonly lastMessageAt: Date | null;
  readonly lastSequence: number;
  /** Messages from others after the reader's high-water mark. */
  readonly unread: number;
  readonly access: ConversationAccess;
}

export interface AttachmentView {
  readonly id: string;
  readonly mediaType: MessagingAttachmentType;
  readonly byteSize: number;
  readonly displayName: string | null;
}

export interface MessageView {
  readonly id: string;
  readonly sequence: number;
  readonly senderAccountId: string;
  readonly own: boolean;
  /** `null` while withheld by moderation — the UI shows a neutral placeholder. */
  readonly body: string | null;
  readonly withheld: boolean;
  readonly sentAt: Date;
  /** Empty while withheld. */
  readonly attachments: readonly AttachmentView[];
}

export interface ConversationView {
  readonly summary: ConversationSummary;
  /** The reader's high-water read sequence. */
  readonly readSequence: number;
  readonly canSend: boolean;
  readonly sendRefusal: SendRefusal | null;
  /** The reader blocked the counterpart (direct conversations only). */
  readonly blockedByMe: boolean;
}

/** One page of history, oldest first. `before` names the next older page, if any. */
export interface HistoryPage {
  readonly messages: readonly MessageView[];
  readonly before: number | null;
}

/** Messages after a sequence the reader already holds, oldest first. */
export interface CatchUpPage {
  readonly messages: readonly MessageView[];
  /** More messages exist after the last one returned. */
  readonly more: boolean;
  readonly lastSequence: number;
}

export interface ConversationPage {
  readonly conversations: readonly ConversationSummary[];
  /** Opaque continuation, or `null` on the last page. */
  readonly next: string | null;
}

/** A support conversation as the QUEUE shows it: metadata, never content. */
export interface SupportQueueItem {
  readonly id: string;
  readonly state: ConversationState;
  readonly closedReason: ConversationClosedReason | null;
  readonly createdAt: Date;
  readonly lastMessageAt: Date | null;
  readonly claimed: boolean;
  readonly claimedByMe: boolean;
  /** The last message came from the person asking — a reply is owed. */
  readonly awaitingReply: boolean;
  readonly version: number;
}

export interface SupportQueuePage {
  readonly items: readonly SupportQueueItem[];
  readonly next: string | null;
}

/** A report as the QUEUE shows it: identifiers and states, never content. */
export interface ReportSummary {
  readonly id: string;
  readonly conversationId: string;
  readonly conversationKind: ConversationKind;
  /** `null` when the conversation itself is the reported target. */
  readonly messageId: string | null;
  readonly reason: ReportReason;
  readonly state: ReportState;
  readonly createdAt: Date;
  readonly version: number;
}

export interface ReportPage {
  readonly reports: readonly ReportSummary[];
  readonly next: string | null;
}

export interface ModerationDecisionView {
  readonly action: ModerationAction;
  readonly decidedAt: Date;
  readonly moderatorAccountId: string;
}

export interface EvidenceMessage {
  readonly id: string;
  readonly sequence: number;
  readonly senderAccountId: string;
  /** The immutable text, shown to the moderator even when withheld. */
  readonly body: string;
  readonly withheld: boolean;
  readonly sentAt: Date;
  readonly reported: boolean;
  readonly attachments: readonly AttachmentView[];
}

/** The bounded evidence one report authorises — and nothing more. */
export interface ReportEvidence {
  readonly report: ReportSummary;
  readonly reporterAccountId: string;
  readonly conversation: {
    readonly id: string;
    readonly kind: ConversationKind;
    readonly state: ConversationState;
    readonly closedReason: ConversationClosedReason | null;
    readonly courseId: string | null;
  };
  readonly messages: readonly EvidenceMessage[];
  readonly decision: ModerationDecisionView | null;
}

/** What a person may see about one support conversation of their own. */
export interface SupportOverview {
  /** The open conversation, if any. */
  readonly open: ConversationSummary | null;
  /** Earlier resolved or closed ones, newest first, bounded. */
  readonly earlier: readonly ConversationSummary[];
}

/* ===========================================================================
 * Export
 * ========================================================================= */

export const MESSAGING_EXPORT_SCHEMA = 'minhaj.messaging.export';
export const MESSAGING_EXPORT_VERSION = 1;

/**
 * A person's own Messaging data. Their participation, their OWN messages with
 * their text, their attachments' metadata (never bytes), their read state, the
 * blocks they made and the reports they filed. Another person's messages are
 * never included — not even in a conversation they shared.
 */
export interface MessagingExport {
  readonly schema: typeof MESSAGING_EXPORT_SCHEMA;
  readonly version: typeof MESSAGING_EXPORT_VERSION;
  readonly generatedAt: string;
  readonly conversations: readonly {
    readonly id: string;
    readonly kind: ConversationKind;
    readonly courseId: string | null;
    readonly role: ParticipantRole;
    readonly state: ConversationState;
    readonly closedReason: ConversationClosedReason | null;
    readonly joinedAt: string;
    readonly leftAt: string | null;
    readonly lastReadSequence: number;
  }[];
  readonly messages: readonly {
    readonly id: string;
    readonly conversationId: string;
    readonly sequence: number;
    readonly body: string;
    readonly withheld: boolean;
    readonly sentAt: string;
  }[];
  readonly attachments: readonly {
    readonly id: string;
    readonly conversationId: string;
    readonly messageId: string | null;
    readonly mediaType: string | null;
    readonly byteSize: number | null;
    readonly displayName: string | null;
    readonly createdAt: string;
  }[];
  readonly blocks: readonly {
    readonly blockedAccountId: string;
    readonly createdAt: string;
  }[];
  readonly reports: readonly {
    readonly id: string;
    readonly conversationId: string;
    readonly messageId: string | null;
    readonly reason: ReportReason;
    readonly state: ReportState;
    readonly createdAt: string;
  }[];
}

/** How far one disposition got. `complete: false` is honest pending work. */
export interface MessagingDispositionProgress {
  readonly removed: number;
  readonly complete: boolean;
}
