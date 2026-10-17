import {
  MESSAGING_ATTACHMENT_TYPES,
  REALTIME_FAILURES,
  type MessagingAttachmentType,
  type RealtimeFailure,
  type RealtimeMessage,
} from '@minhaj/contracts/messaging';

/**
 * How live messages join the history the server rendered — PURE, so every
 * ordering, duplicate and gap rule is proved without a browser or a socket
 * (DELIVERY_PLAN.md Phase 25).
 *
 * THE SERVER-RENDERED LIST IS THE BASE. The page drew the newest history from
 * SQL; the realtime island only ever APPENDS after it. `floor` is the highest
 * sequence that base holds; nothing at or below it is drawn twice, and a
 * message the base already holds (the page re-rendered after a web send, or
 * after "Check for new messages") is dropped from the live list by its id.
 *
 * ORDER IS THE CONVERSATION'S SEQUENCE, NEVER A CLOCK. A message that arrives
 * late — through catch-up after a reconnect, or after a gap — is placed by its
 * sequence, so the thread reads as the durable record does. Two arrivals of
 * the same message (the send acknowledgement and a fan-out to another tab, or
 * a catch-up overlapping a delivery) are ONE item: the later copy replaces the
 * earlier, since a re-read is never older than what it replaces.
 *
 * A GAP IS A QUESTION FOR THE DURABLE READ. `caughtUpTo` is the highest
 * sequence reached without a hole; a live delivery beyond it means something
 * in between never arrived (a message sent through the web path, which the
 * transport does not fan out, or a delivery lost in a reconnect), and the
 * island asks catch-up from there. Transport memory never fills a gap.
 *
 * NOTHING THE SERVER SENDS IS TRUSTED BEYOND ITS SHAPE. `realtimeMessageOf`
 * accepts a frame only when every field the thread draws has its type; any
 * other frame is ignored, never rendered.
 */

/** Live messages, ascending by sequence, unique by id and by sequence. */
export type LiveMessages = readonly RealtimeMessage[];

/** Adds `incoming` to `current`: ordered by sequence, one item per message. */
export function mergeLive(current: LiveMessages, incoming: LiveMessages): LiveMessages {
  if (incoming.length === 0) return current;
  const byId = new Map<string, RealtimeMessage>();
  for (const message of current) byId.set(message.id, message);
  const sequences = new Map<number, string>();
  for (const message of current) sequences.set(message.sequence, message.id);
  for (const message of incoming) {
    const holder = sequences.get(message.sequence);
    // A different id at a sequence already held is not this conversation's
    // record of that position; the first, durable answer stands.
    if (holder !== undefined && holder !== message.id) continue;
    byId.set(message.id, message);
    sequences.set(message.sequence, message.id);
  }
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
}

/** The live messages to draw after a base ending at `floor` and holding `baseIds`. */
export function liveAfter(
  messages: LiveMessages,
  floor: number,
  baseIds: ReadonlySet<string>,
): LiveMessages {
  return messages.filter(
    (message) => message.sequence > floor && !baseIds.has(message.id),
  );
}

/** The highest sequence reached from `floor` without a hole. */
export function caughtUpTo(messages: LiveMessages, floor: number): number {
  let reached = floor;
  for (const message of messages) {
    if (message.sequence <= reached) continue;
    if (message.sequence !== reached + 1) break;
    reached = message.sequence;
  }
  return reached;
}

/** The highest sequence held at all — the base's, or a live one beyond it. */
export function highestHeld(messages: LiveMessages, floor: number): number {
  return Math.max(floor, messages.at(-1)?.sequence ?? floor);
}

/** The newest live message after `after` that someone else sent, if any. */
export function newestFromOthers(
  messages: LiveMessages,
  after: number,
): RealtimeMessage | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message === undefined || message.sequence <= after) return null;
    if (!message.own) return message;
  }
  return null;
}

/* ===========================================================================
 * Shape checks for what the transport answers
 * ========================================================================= */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isSequence(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}

function isAttachmentType(value: unknown): value is MessagingAttachmentType {
  return MESSAGING_ATTACHMENT_TYPES.some((type) => type === value);
}

function attachmentsOf(value: unknown): RealtimeMessage['attachments'] | null {
  if (!Array.isArray(value)) return null;
  const attachments: RealtimeMessage['attachments'][number][] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return null;
    const { id, mediaType, byteSize, displayName } = entry;
    if (typeof id !== 'string' || !isAttachmentType(mediaType)) return null;
    if (typeof byteSize !== 'number' || !Number.isFinite(byteSize)) return null;
    if (displayName !== null && typeof displayName !== 'string') return null;
    attachments.push({ id, mediaType, byteSize, displayName });
  }
  return attachments;
}

/** A message frame the thread may draw, or `null` for anything else. */
export function realtimeMessageOf(value: unknown): RealtimeMessage | null {
  if (!isRecord(value)) return null;
  const { id, sequence, senderAccountId, own, body, withheld, sentAt } = value;
  if (typeof id !== 'string' || id === '' || !isSequence(sequence)) return null;
  if (typeof senderAccountId !== 'string' || typeof own !== 'boolean') return null;
  if (body !== null && typeof body !== 'string') return null;
  if (typeof withheld !== 'boolean' || typeof sentAt !== 'string') return null;
  if (Number.isNaN(Date.parse(sentAt))) return null;
  const attachments = attachmentsOf(value['attachments']);
  if (attachments === null) return null;
  return { id, sequence, senderAccountId, own, body, withheld, sentAt, attachments };
}

/** Every well-formed message of a list, in the order given; the rest dropped. */
export function realtimeMessagesOf(value: unknown): LiveMessages {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => realtimeMessageOf(entry))
    .filter((message): message is RealtimeMessage => message !== null);
}

/** An acknowledgement, as the island acts on it: a value to read, or a failure category. */
export type LiveAck =
  | { readonly ok: true; readonly value: Readonly<Record<string, unknown>> }
  | { readonly ok: false; readonly failure: RealtimeFailure };

/**
 * Reads an acknowledgement. A refusal keeps its category only when it is one
 * the contract names; anything else — no answer, a malformed one — is
 * `unavailable`, which the island treats as "fall back to the page".
 */
export function ackOf(answer: unknown): LiveAck {
  if (isRecord(answer) && answer['ok'] === true && isRecord(answer['value']))
    return { ok: true, value: answer['value'] };
  if (isRecord(answer) && answer['ok'] === false) {
    const failure = REALTIME_FAILURES.find((known) => known === answer['failure']);
    if (failure !== undefined) return { ok: false, failure };
  }
  return { ok: false, failure: 'unavailable' };
}

/** A server event's fields, only when it is about `conversationId`. */
export function signalOf(
  payload: unknown,
  conversationId: string,
): Readonly<Record<string, unknown>> | null {
  return isRecord(payload) && payload['conversationId'] === conversationId
    ? payload
    : null;
}
