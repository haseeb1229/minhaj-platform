import 'server-only';

import { Prisma } from '@prisma/client';

import type {
  AttachmentFact,
  ConversationClosedReason,
  ConversationKind,
  ConversationRecord,
  ConversationState,
  MessageModerationState,
  MessageRecord,
  ParticipantRole,
} from '@minhaj/contracts/messaging';

import { MessagingDataError } from './errors.ts';

/**
 * What the Messaging adapter's halves share — refusal mapping, the record
 * shapes, the clock and the bounds — so conversations, messages, attachments,
 * moderation and disposition cannot disagree about what a conversation looks
 * like or what a refusal means.
 *
 * PACKAGE-INTERNAL, AND NEVER NAMED BY THE ADAPTER'S ENTRY: it holds the
 * Prisma value its SQL fragments are built from. Only `MessagingDataError`
 * (defined in `./errors.ts`) leaves this package.
 */

export type Client = Prisma.TransactionClient;

export { MessagingDataError };

/* ===========================================================================
 * Refusals
 * ========================================================================= */

/**
 * The migration's own refusals (`THROW 51300`–`51309`), by number. They are the
 * FLOOR beneath the adapter's own questions, which are asked first under the
 * lock each needs; a write that still meets one is mapped here when the port
 * has no outcome for it. Read from the STRUCTURED fields the driver populates,
 * never from message text, which a stored value could otherwise imitate.
 */
const THROW_REASONS: ReadonlyMap<number, string> = new Map([
  [51300, 'immutable'],
  [51301, 'not-participant'],
  [51302, 'invalid'],
  [51303, 'closed'],
  [51304, 'immutable'],
  [51305, 'immutable'],
  [51306, 'attachment-unavailable'],
  [51307, 'invalid'],
  [51308, 'invalid'],
  [51309, 'conflict'],
]);

const UNIQUE_VIOLATION = 'UniqueConstraintViolation';
const CONSTRAINT_VIOLATIONS: ReadonlySet<string> = new Set([
  'ForeignKeyConstraintViolation',
  'NullConstraintViolation',
]);

/** Where a structured error fact can sit once Prisma and the driver wrap it. */
const NESTED_KEYS = ['cause', 'meta', 'driverAdapterError', 'originalError', 'info'];

/** Bounded, so a wrapped error cannot cost unbounded work to classify. */
const MAX_VISITED_NODES = 32;

/** One own DATA property — never an accessor, and never one that throws. */
function ownData(record: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor !== undefined && 'value' in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Every NUMERIC `code` / `number` and every adapter `kind` in a wrapped error.
 * A string is never read as an error number — `code` is `'P2010'` on Prisma's
 * error and the SQL number on the driver's — and no message text is read.
 */
function errorFacts(error: unknown): {
  readonly numbers: readonly number[];
  readonly kinds: ReadonlySet<string>;
} {
  const numbers: number[] = [];
  const kinds = new Set<string>();
  const seen = new Set<object>();
  const pending: unknown[] = [error];
  while (pending.length > 0 && seen.size < MAX_VISITED_NODES) {
    const current = pending.shift();
    if (current === null || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    for (const key of ['code', 'number']) {
      const value = ownData(current, key);
      if (typeof value === 'number' && Number.isInteger(value)) numbers.push(value);
    }
    const kind = ownData(current, 'kind');
    if (typeof kind === 'string') kinds.add(kind);
    for (const key of NESTED_KEYS) {
      const value = ownData(current, key);
      if (value !== undefined) pending.push(value);
    }
  }
  return { numbers, kinds };
}

/** The migration refusal a write met, if any. */
export function refusalNumber(error: unknown): number | null {
  return errorFacts(error).numbers.find((number) => THROW_REASONS.has(number)) ?? null;
}

/**
 * Whether the database refused a write on a uniqueness rule — and on nothing
 * the migration numbered first: the signal that an idempotent insert lost a
 * race to its own twin.
 */
export function isUniqueViolation(error: unknown): boolean {
  const { numbers, kinds } = errorFacts(error);
  if (numbers.some((number) => THROW_REASONS.has(number))) return false;
  return (
    (error as { code?: unknown } | null)?.code === 'P2002' ||
    kinds.has(UNIQUE_VIOLATION) ||
    numbers.includes(2627) ||
    numbers.includes(2601)
  );
}

/**
 * Structured database refusals, and ONLY those, become domain answers. A
 * migration refusal is mapped by its number first, then a uniqueness or
 * constraint refusal by its category. Everything unrecognised — a deadlock, an
 * outage, a permission refusal this principal should never meet — is rethrown
 * unchanged, never reported as a rule that was not evaluated.
 */
export function refuse(error: unknown): never {
  if (error instanceof MessagingDataError) throw error;
  const { numbers, kinds } = errorFacts(error);
  for (const number of numbers) {
    const reason = THROW_REASONS.get(number);
    if (reason !== undefined) throw new MessagingDataError(reason);
  }
  const code = (error as { code?: unknown } | null)?.code;
  if (
    code === 'P2002' ||
    kinds.has(UNIQUE_VIOLATION) ||
    numbers.includes(2627) ||
    numbers.includes(2601)
  )
    throw new MessagingDataError('conflict');
  if (
    code === 'P2003' ||
    code === 'P2004' ||
    numbers.includes(547) ||
    [...kinds].some((kind) => CONSTRAINT_VIOLATIONS.has(kind))
  )
    throw new MessagingDataError('invalid');
  throw error;
}

/* ===========================================================================
 * Transactions, the clock and bounds
 * ========================================================================= */

/** How long one writer waits for a lock before giving up. */
const LOCK_TIMEOUT_MS = 5_000;

/**
 * How long a locking transaction may live. Explicit, because the interactive
 * default (5s) is no longer than the wait for a lock it may need.
 */
export const LOCKED_TRANSACTION = { timeout: 20_000, maxWait: LOCK_TIMEOUT_MS } as const;

/**
 * THE KEYSET CLOCK. Every instant a keyset orders by (`Conversation.activityAt`
 * and `createdAt`, `MessagingReport.createdAt`) is written at MILLISECOND
 * precision. A `DATETIME2` keeps 100 ns; a JavaScript `Date` keeps 1 ms; a
 * cursor built from a truncated instant would skip every row whose stored
 * instant fell between the truncation and the true value. Writing what a
 * `Date` can carry exactly makes the cursor and the row agree.
 */
export const NOW_MS = Prisma.sql`CAST(SYSUTCDATETIME() AS DATETIME2(3))`;

/** The most rows one list, one batch or one span may name. */
export const LIST_MAX = 100;

export function bounded(value: number, max: number = LIST_MAX): number {
  return Math.min(max, Math.max(1, Math.trunc(value) || 1));
}

/** A raw query's timestamp, whatever shape the driver hands back. */
export function dateOf(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

export function maybeDate(value: Date | string | null): Date | null {
  return value === null ? null : dateOf(value);
}

/** A raw query's `BIGINT` / `COUNT`, whatever shape the driver hands back. */
export function numberOf(value: number | bigint | string | null): number {
  return value === null ? 0 : Number(value);
}

/* ===========================================================================
 * Records
 * ========================================================================= */

/** The columns every ConversationRecord is built from, with its participants. */
export const CONVERSATION_SELECT = {
  id: true,
  kind: true,
  courseId: true,
  state: true,
  closedReason: true,
  closedAt: true,
  lastSequence: true,
  activityAt: true,
  createdAt: true,
  version: true,
  participants: {
    select: { userId: true, role: true, joinedAt: true, leftAt: true },
    orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
  },
} as const satisfies Prisma.ConversationSelect;

export type ConversationRow = Prisma.ConversationGetPayload<{
  select: typeof CONVERSATION_SELECT;
}>;

/**
 * A conversation as the port sees it. `lastMessageAt` is the activity instant
 * once a message exists — `append` moves `activityAt` and nothing else does —
 * and `null` before the first. An EMPTY conversation's `activityAt` equals its
 * `createdAt` exactly (both are written once, together), so a keyset position
 * is always `lastMessageAt ?? createdAt` with the id.
 */
export function toConversationRecord(row: ConversationRow): ConversationRecord {
  return {
    id: row.id,
    kind: row.kind as ConversationKind,
    courseId: row.courseId,
    state: row.state as ConversationState,
    closedReason: row.closedReason as ConversationClosedReason | null,
    closedAt: row.closedAt,
    lastSequence: row.lastSequence,
    lastMessageAt: row.lastSequence > 0 ? row.activityAt : null,
    createdAt: row.createdAt,
    version: row.version,
    participants: row.participants.map((participant) => ({
      accountId: participant.userId,
      role: participant.role as ParticipantRole,
      joinedAt: participant.joinedAt,
      leftAt: participant.leftAt,
    })),
  };
}

/** The visible conversations: one being disposed is already gone to every reader. */
export const NOT_DISPOSING = { disposingAt: null } as const;

async function conversationRecord(
  db: Client,
  conversationId: string,
): Promise<ConversationRecord | null> {
  const row = await db.conversation.findFirst({
    where: { id: conversationId, ...NOT_DISPOSING },
    select: CONVERSATION_SELECT,
  });
  return row === null ? null : toConversationRecord(row);
}

const MESSAGE_SELECT = {
  id: true,
  conversationId: true,
  sequence: true,
  senderUserId: true,
  body: true,
  moderation: true,
  sentAt: true,
} as const satisfies Prisma.MessageSelect;

type MessageRow = Prisma.MessageGetPayload<{ select: typeof MESSAGE_SELECT }>;

/**
 * Messages with their ATTACHED attachments, in position order — one query for
 * the messages, one for every attachment of the page, never one per message.
 */
async function messagesWhere(
  db: Client,
  where: Prisma.MessageWhereInput,
  order: 'asc' | 'desc',
  limit: number,
): Promise<readonly MessageRecord[]> {
  const rows = await db.message.findMany({
    where,
    select: MESSAGE_SELECT,
    orderBy: { sequence: order },
    take: limit,
  });
  const ascending = order === 'asc' ? rows : [...rows].reverse();
  return withAttachments(db, ascending);
}

async function withAttachments(
  db: Client,
  rows: readonly MessageRow[],
): Promise<readonly MessageRecord[]> {
  const facts = new Map<string, AttachmentFact[]>();
  if (rows.length > 0) {
    const attachments = await db.messageAttachment.findMany({
      where: { messageId: { in: rows.map((row) => row.id) }, state: 'attached' },
      select: {
        id: true,
        messageId: true,
        mediaType: true,
        byteSize: true,
        displayName: true,
        position: true,
      },
      orderBy: [{ messageId: 'asc' }, { position: 'asc' }],
    });
    for (const attachment of attachments) {
      // The `attached` shape guarantees every one of these columns (CHECK).
      if (
        attachment.messageId === null ||
        attachment.mediaType === null ||
        attachment.byteSize === null ||
        attachment.position === null
      )
        continue;
      const list = facts.get(attachment.messageId) ?? [];
      list.push({
        id: attachment.id,
        mediaType: attachment.mediaType,
        byteSize: Number(attachment.byteSize),
        displayName: attachment.displayName,
        position: attachment.position,
      });
      facts.set(attachment.messageId, list);
    }
  }
  return rows.map((row) => ({
    id: row.id,
    conversationId: row.conversationId,
    sequence: row.sequence,
    senderAccountId: row.senderUserId,
    body: row.body,
    moderation: row.moderation as MessageModerationState,
    sentAt: row.sentAt,
    attachments: facts.get(row.id) ?? [],
  }));
}

/** One message by its operation key, with its attachments — the replay answer. */
async function messageByOperation(
  db: Client,
  key: {
    readonly conversationId: string;
    readonly senderAccountId: string;
    readonly operationId: string;
  },
): Promise<{ readonly message: MessageRecord; readonly payloadDigest: string } | null> {
  const row = await db.message.findFirst({
    where: {
      conversationId: key.conversationId,
      senderUserId: key.senderAccountId,
      operationId: key.operationId,
    },
    select: { ...MESSAGE_SELECT, payloadDigest: true },
  });
  if (row === null) return null;
  const [message] = await withAttachments(db, [row]);
  return message === undefined ? null : { message, payloadDigest: row.payloadDigest };
}

/**
 * The moment a participant leaves: now, but never before they joined (the
 * CHECK `leftAt >= joinedAt`), whatever the two clocks that wrote them said.
 */
export const LEFT_NOW = Prisma.sql`CASE WHEN SYSUTCDATETIME() < [joinedAt] THEN [joinedAt] ELSE SYSUTCDATETIME() END`;

/**
 * The reads every half shares, BOUND to one client or one transaction, so a
 * half's own methods never hand a database handle to a helper they return
 * through: the handle stays in this closure.
 */
export interface MessagingReads {
  conversation(conversationId: string): Promise<ConversationRecord | null>;
  messages(
    where: Prisma.MessageWhereInput,
    order: 'asc' | 'desc',
    limit: number,
  ): Promise<readonly MessageRecord[]>;
  byOperation(key: {
    readonly conversationId: string;
    readonly senderAccountId: string;
    readonly operationId: string;
  }): Promise<{ readonly message: MessageRecord; readonly payloadDigest: string } | null>;
}

export function readsOf(db: Client): MessagingReads {
  return {
    conversation: (conversationId) => conversationRecord(db, conversationId),
    messages: (where, order, limit) => messagesWhere(db, where, order, limit),
    byOperation: (key) => messageByOperation(db, key),
  };
}
