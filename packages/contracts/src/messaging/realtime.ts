import { z } from 'zod';

import {
  MESSAGING_LIMITS,
  messageBodySchema,
  messageSequenceSchema,
  messagingIdSchema,
  type MessageView,
} from './values.ts';

/**
 * The realtime event vocabulary (DELIVERY_PLAN.md Phase 25) — client-safe, so
 * the browser and the realtime transport share ONE definition of every frame.
 *
 * A TRANSPORT VOCABULARY, NOT A SECOND API. Every client event names one
 * existing Messaging operation and carries exactly that operation's input; the
 * server answers from the SAME Messaging service the web application calls.
 * Starting a conversation, uploading or opening an attachment, blocking,
 * reporting, support administration and moderation have NO event: they stay on
 * their audited web paths.
 *
 * NO AUTHORITY TRAVELS HERE. No frame carries a token, a session id, an account
 * id the server would trust, or an attachment's bytes. The server identifies
 * the person from the session cookie of the connection, re-resolved on every
 * event, and decides every answer from current state.
 *
 * DURABLE TRUTH IS SQL. A delivered message is the committed row, read for its
 * recipient; a lost delivery is recovered by catch-up from the durable
 * sequence, never from transport memory. Presence and typing are ephemeral
 * transport state and are never persisted.
 */

/* ===========================================================================
 * Bounds — engineering bounds of the transport
 * ========================================================================= */

export const REALTIME_LIMITS = Object.freeze({
  /**
   * The largest frame the transport accepts, in bytes. The largest valid
   * frame is a send of 4,000 code points (at most 16,000 UTF-8 bytes, JSON
   * escaping included well under 2x) plus four attachment ids and protocol
   * overhead; 64 KiB admits it and refuses anything carrying file bytes.
   */
  maxPayloadBytes: 64 * 1024,
  /** Conversations one connection may follow at once. */
  subscriptionsPerConnection: 20,
  /** How long a typing signal lasts without being renewed, in milliseconds. */
  typingTtlMs: 6_000,
  /** Per-connection budgets: at most `max` events of a kind per `windowMs`. */
  budgets: Object.freeze({
    subscribe: Object.freeze({ max: 30, windowMs: 60_000 }),
    catchUp: Object.freeze({ max: 60, windowMs: 60_000 }),
    send: Object.freeze({ max: 30, windowMs: 60_000 }),
    read: Object.freeze({ max: 120, windowMs: 60_000 }),
    typing: Object.freeze({ max: 40, windowMs: 60_000 }),
  }),
} as const);

/** The transport path, same-origin, behind the proxy (ROUTE_MAP.md §8). */
export const REALTIME_PATH = '/socket.io/';

/* ===========================================================================
 * Client → server
 * ========================================================================= */

export const REALTIME_CLIENT_EVENTS = Object.freeze({
  subscribe: 'conversation:subscribe',
  unsubscribe: 'conversation:unsubscribe',
  catchUp: 'conversation:catch-up',
  send: 'message:send',
  read: 'message:read',
  typing: 'typing:set',
} as const);
export type RealtimeClientEvent =
  (typeof REALTIME_CLIENT_EVENTS)[keyof typeof REALTIME_CLIENT_EVENTS];

const conversationOnly = z.object({ conversationId: messagingIdSchema }).strict();

export const realtimeSubscribeSchema = conversationOnly;
export const realtimeUnsubscribeSchema = conversationOnly;

export const realtimeCatchUpSchema = z
  .object({ conversationId: messagingIdSchema, after: messageSequenceSchema })
  .strict();

/** The same input the web send takes — and the same idempotency key. */
export const realtimeSendSchema = z
  .object({
    conversationId: messagingIdSchema,
    operationId: z.uuid(),
    body: messageBodySchema,
    attachmentIds: z
      .array(messagingIdSchema)
      .max(MESSAGING_LIMITS.attachmentsPerMessage)
      .refine((ids) => new Set(ids).size === ids.length),
  })
  .strict();

export const realtimeReadSchema = z
  .object({ conversationId: messagingIdSchema, sequence: messageSequenceSchema })
  .strict();

/** A typing signal is a boolean and nothing else: never a body or a draft. */
export const realtimeTypingSchema = z
  .object({ conversationId: messagingIdSchema, typing: z.boolean() })
  .strict();

/* ===========================================================================
 * Server → client
 * ========================================================================= */

export const REALTIME_SERVER_EVENTS = Object.freeze({
  messageCreated: 'message:created',
  presenceChanged: 'presence:changed',
  typingChanged: 'typing:changed',
} as const);

/** A committed message, as THIS recipient may see it, read from SQL for them. */
export interface RealtimeMessageCreated {
  readonly conversationId: string;
  readonly message: RealtimeMessage;
}

/** `MessageView` with its instant as ISO text — the shape that crosses the wire. */
export type RealtimeMessage = Omit<MessageView, 'sentAt'> & { readonly sentAt: string };

/** Whether the OTHER person of the conversation has a live connection to it. */
export interface RealtimePresenceChanged {
  readonly conversationId: string;
  readonly online: boolean;
}

/** Whether the other person is typing. No text, ever. */
export interface RealtimeTypingChanged {
  readonly conversationId: string;
  readonly typing: boolean;
}

/**
 * Every acknowledgement. A refusal names only a category the person can act
 * on; an inaccessible conversation and a missing one answer the same
 * `not-found`, and nothing internal — a stack, a SQL error, a permission — is
 * ever named.
 */
export type RealtimeAck<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: RealtimeFailure };

export const REALTIME_FAILURES = Object.freeze([
  'invalid',
  'not-found',
  'ended',
  'closed',
  'blocked',
  'terminal',
  'operation-conflict',
  'rate-limited',
  'too-many',
  'signed-out',
  'unavailable',
] as const);
export type RealtimeFailure = (typeof REALTIME_FAILURES)[number];

/** What a subscription returns: where the conversation stands now. */
export interface RealtimeSubscription {
  readonly conversationId: string;
  readonly lastSequence: number;
  readonly readSequence: number;
  readonly canSend: boolean;
  /** The other person currently has a live connection to this conversation. */
  readonly counterpartOnline: boolean;
}

/** One bounded page of durable catch-up. */
export interface RealtimeCatchUp {
  readonly messages: readonly RealtimeMessage[];
  readonly more: boolean;
  readonly lastSequence: number;
}

export interface RealtimeSent {
  readonly message: RealtimeMessage;
  readonly replayed: boolean;
}

/** The wire form of a message view. */
export function toRealtimeMessage(view: MessageView): RealtimeMessage {
  return { ...view, sentAt: view.sentAt.toISOString() };
}
