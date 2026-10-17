import 'server-only';

import {
  MESSAGING_ATTACHMENT_TYPES,
  messagingIdSchema,
  type ActivityCursor,
  type AttachmentFact,
  type AttachmentView,
  type ConversationAccess,
  type ConversationRecord,
  type ConversationSummary,
  type EvidenceMessage,
  type MessageRecord,
  type MessageView,
  type MessagingAttachmentType,
  type ParticipantRole,
  type ReadingState,
  type ReportRecord,
  type ReportSummary,
} from '@minhaj/contracts/messaging';

import { directCounterpart } from './access.ts';
import { MessagingRefusal } from './types.ts';

/**
 * Records into the views a reader is shown — shaping only, never deciding.
 * Every function here is handed a verdict the access decision already made.
 *
 * WITHHELD MEANS NOTHING OF IT. A message moderation withheld reaches a
 * participant as its position, sender and time only: no body and no
 * attachment, so its bytes cannot be fetched through a view that still names
 * them. Only a moderator's evidence carries the text (`evidenceMessage`).
 */

export const NO_READING: ReadingState = Object.freeze({ readSequence: 0, unread: 0 });

export function isAttachmentType(value: string | null): value is MessagingAttachmentType {
  return (
    value !== null && (MESSAGING_ATTACHMENT_TYPES as readonly string[]).includes(value)
  );
}

function attachmentViews(facts: readonly AttachmentFact[]): readonly AttachmentView[] {
  const views: AttachmentView[] = [];
  for (const fact of facts) {
    // The adapter guarantees the type; a row outside the three is never shown.
    if (!isAttachmentType(fact.mediaType)) continue;
    views.push({
      id: fact.id,
      mediaType: fact.mediaType,
      byteSize: fact.byteSize,
      displayName: fact.displayName,
    });
  }
  return views;
}

export function messageView(message: MessageRecord, readerId: string): MessageView {
  const withheld = message.moderation === 'withheld';
  return {
    id: message.id,
    sequence: message.sequence,
    senderAccountId: message.senderAccountId,
    own: message.senderAccountId === readerId,
    body: withheld ? null : message.body,
    withheld,
    sentAt: message.sentAt,
    attachments: withheld ? [] : attachmentViews(message.attachments),
  };
}

export function evidenceMessage(
  message: MessageRecord,
  report: ReportRecord,
): EvidenceMessage {
  return {
    id: message.id,
    sequence: message.sequence,
    senderAccountId: message.senderAccountId,
    body: message.body,
    withheld: message.moderation === 'withheld',
    sentAt: message.sentAt,
    reported: report.messageId === message.id,
    attachments: attachmentViews(message.attachments),
  };
}

export function summaryOf(
  record: ConversationRecord,
  readerId: string,
  role: ParticipantRole,
  reading: ReadingState,
  access: ConversationAccess,
): ConversationSummary {
  return {
    id: record.id,
    kind: record.kind,
    courseId: record.courseId,
    state: record.state,
    closedReason: record.closedReason,
    role,
    counterpartAccountId: directCounterpart(record, readerId)?.accountId ?? null,
    lastMessageAt: record.lastSequence > 0 ? record.lastMessageAt : null,
    lastSequence: record.lastSequence,
    unread: reading.unread,
    access,
  };
}

export function reportSummary(report: ReportRecord): ReportSummary {
  return {
    id: report.id,
    conversationId: report.conversationId,
    conversationKind: report.conversationKind,
    messageId: report.messageId,
    reason: report.reason,
    state: report.state,
    createdAt: report.createdAt,
    version: report.version,
  };
}

/* ===========================================================================
 * Keyset cursors
 * ========================================================================= */

/**
 * The activity instant a conversation is ordered by: its last message, or
 * its creation while it has none. The adapter orders by the same expression.
 */
export function activityOf(record: ConversationRecord): Date {
  return record.lastMessageAt ?? record.createdAt;
}

/**
 * An opaque continuation: base64url of `${iso}|${id}`. Opaque to the client,
 * not secret — it names a position, and every row it leads to is decided
 * again. A malformed one is refused rather than read as "the first page".
 */
export function encodeCursor(position: ActivityCursor): string {
  return Buffer.from(`${position.at.toISOString()}|${position.id}`, 'utf8').toString(
    'base64url',
  );
}

export function decodeCursor(cursor: string | null): ActivityCursor | null {
  if (cursor === null) return null;
  if (typeof cursor !== 'string' || cursor.length === 0 || cursor.length > 128) {
    throw new MessagingRefusal('invalid');
  }
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const parts = decoded.split('|');
  const [iso, id] = parts;
  if (parts.length !== 2 || iso === undefined || id === undefined) {
    throw new MessagingRefusal('invalid');
  }
  const at = new Date(iso);
  // Canonical only: the instant must round-trip exactly as it was issued.
  if (Number.isNaN(at.getTime()) || at.toISOString() !== iso) {
    throw new MessagingRefusal('invalid');
  }
  if (!messagingIdSchema.safeParse(id).success) throw new MessagingRefusal('invalid');
  return { at, id };
}
