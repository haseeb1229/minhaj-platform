import 'server-only';

import {
  REALTIME_CLIENT_EVENTS,
  REALTIME_LIMITS,
  realtimeCatchUpSchema,
  realtimeReadSchema,
  realtimeSendSchema,
  realtimeSubscribeSchema,
  realtimeTypingSchema,
  realtimeUnsubscribeSchema,
  toRealtimeMessage,
  type RealtimeAck,
  type RealtimeCatchUp,
  type RealtimeClientEvent,
  type RealtimeSent,
  type RealtimeSubscription,
} from '@minhaj/contracts/messaging';

import type { BudgetKind } from './budgets.ts';
import type { Connection } from './connection.ts';
import type { Hub } from './hub.ts';
import { elapsedSince } from './logging.ts';
import { accepted, failureOf, refused } from './refusals.ts';

/**
 * One handler per client event — and every one runs the same gate, in order:
 *
 *   1. SHAPE. Exactly one payload and an ack callback. A frame with no ack
 *      cannot be answered, so it does no work at all.
 *   2. SCHEMA. The contract's strict Zod schema: an unknown key, a wrong type,
 *      a malformed id or an oversized field is `invalid`. A key such as
 *      `__proto__` or `constructor` is just an unknown key — refused, and
 *      nothing is merged anywhere.
 *   3. BUDGET. The connection's own token bucket for this kind of event.
 *   4. SESSION. The cookie the handshake carried is resolved AGAIN by Identity.
 *      Anything but the same account, active, is `signed-out` and the end of
 *      the connection.
 *   5. MESSAGING. The one facade operation this event names. Its answer — or
 *      its refusal, mapped — is the ack.
 *
 * WHAT THE TRANSPORT DECIDES. Only socket lifecycle, schema validity, budgets,
 * which operation to call, and ephemeral presence and typing state. Whether a
 * person may follow, read, send, mark or type is Messaging's answer, every
 * time; nothing here caches it and nothing here repeats it.
 *
 * ALWAYS ANSWERED. Every accepted frame gets exactly one ack, and an outage is
 * `unavailable` — never a stack, never silence.
 */

type Reply = (envelope: RealtimeAck<unknown>) => void;

interface Schema<I> {
  safeParse(
    input: unknown,
  ): { readonly success: true; readonly data: I } | { readonly success: false };
}

interface EventDefinition<I> {
  readonly name: RealtimeClientEvent;
  readonly budget: BudgetKind;
  readonly schema: Schema<I>;
  /** Runs after the gate; `reply` sends the one ack, and work may continue after it. */
  run(connection: Connection, input: I, reply: Reply): Promise<void>;
}

/** A definition with its input type sealed inside: parse first, then run what parsed. */
interface EventHandler {
  readonly name: RealtimeClientEvent;
  readonly budget: BudgetKind;
  parse(
    payload: unknown,
  ): ((connection: Connection, reply: Reply) => Promise<void>) | null;
}

function define<I>(definition: EventDefinition<I>): EventHandler {
  return {
    name: definition.name,
    budget: definition.budget,
    parse(payload) {
      const parsed = definition.schema.safeParse(payload);
      if (!parsed.success) return null;
      return (connection, reply) => definition.run(connection, parsed.data, reply);
    },
  };
}

function handlersFor(hub: Hub): readonly EventHandler[] {
  const { messaging } = hub;

  const subscribe = define({
    name: REALTIME_CLIENT_EVENTS.subscribe,
    budget: 'subscribe',
    schema: realtimeSubscribeSchema,
    async run(connection, { conversationId }, reply) {
      const already = connection.subscriptions.has(conversationId);
      const atCapacity = (): boolean =>
        !connection.subscriptions.has(conversationId) &&
        connection.subscriptions.size >= REALTIME_LIMITS.subscriptionsPerConnection;
      if (atCapacity()) return reply(refused('too-many'));

      let current;
      try {
        current = await messaging.open(connection.actor, conversationId);
      } catch (error) {
        // Refused NOW: a connection that was following stops following, so a
        // revoked person is not left in the room until they disconnect.
        if (already) hub.unfollow(connection, conversationId);
        throw error;
      }
      if (!connection.socket.connected) return reply(refused('unavailable'));
      // Concurrent subscribes from one socket are re-checked after the await.
      if (atCapacity()) return reply(refused('too-many'));

      hub.follow(connection, conversationId);
      const value: RealtimeSubscription = {
        conversationId: current.conversationId,
        lastSequence: current.lastSequence,
        readSequence: current.readSequence,
        canSend: current.canSend,
        counterpartOnline: await hub.counterpartOnline(connection, conversationId),
      };
      reply(accepted(value));
    },
  });

  const unsubscribe = define({
    name: REALTIME_CLIENT_EVENTS.unsubscribe,
    // Subscribing and unsubscribing share one bucket: churn is churn.
    budget: 'subscribe',
    schema: realtimeUnsubscribeSchema,
    // Leaving needs no permission: it is socket lifecycle, not a Messaging act.
    run(connection, { conversationId }, reply) {
      hub.unfollow(connection, conversationId);
      reply(accepted(null));
      return Promise.resolve();
    },
  });

  const catchUp = define({
    name: REALTIME_CLIENT_EVENTS.catchUp,
    budget: 'catchUp',
    schema: realtimeCatchUpSchema,
    async run(connection, { conversationId, after }, reply) {
      const page = await messaging.catchUp(connection.actor, conversationId, after);
      const value: RealtimeCatchUp = {
        messages: page.messages.map(toRealtimeMessage),
        more: page.more,
        lastSequence: page.lastSequence,
      };
      reply(accepted(value));
    },
  });

  const send = define({
    name: REALTIME_CLIENT_EVENTS.send,
    budget: 'send',
    schema: realtimeSendSchema,
    async run(connection, { conversationId, operationId, body, attachmentIds }, reply) {
      // THE DURABLE COMMIT COMES FIRST. Nothing is emitted to anyone until the
      // Messaging service has committed the row (or found the operation id's
      // earlier commit), so a frame never announces a message SQL does not hold.
      const result = await messaging.send(connection.actor, conversationId, {
        operationId,
        body,
        attachmentIds,
      });
      hub.stopTyping(connection, conversationId);
      const value: RealtimeSent = {
        message: toRealtimeMessage(result.message),
        replayed: result.replayed,
      };
      reply(accepted(value));
      // A replay created nothing new; its original commit was the one to
      // deliver, and anyone who missed that recovers it by catch-up.
      if (!result.replayed) {
        await hub.deliver(connection, conversationId, result.message.sequence);
      }
    },
  });

  const read = define({
    name: REALTIME_CLIENT_EVENTS.read,
    budget: 'read',
    schema: realtimeReadSchema,
    async run(connection, { conversationId, sequence }, reply) {
      reply(
        accepted(await messaging.markRead(connection.actor, conversationId, sequence)),
      );
    },
  });

  const typing = define({
    name: REALTIME_CLIENT_EVENTS.typing,
    budget: 'typing',
    schema: realtimeTypingSchema,
    async run(connection, { conversationId, typing: isTyping }, reply) {
      // Typing state belongs to a subscription — it is withdrawn when the
      // subscription ends — so there is none without one.
      if (!connection.subscriptions.has(conversationId))
        return reply(refused('not-found'));
      if (!isTyping) {
        hub.stopTyping(connection, conversationId);
        return reply(accepted(null));
      }
      // The send gate, asked NOW. It answers yes or no and names no reason,
      // so a refusal is the non-enumerating `not-found`.
      if (!(await messaging.canType(connection.actor, conversationId))) {
        hub.stopTyping(connection, conversationId);
        return reply(refused('not-found'));
      }
      if (!connection.socket.connected || !connection.subscriptions.has(conversationId)) {
        return reply(refused('unavailable'));
      }
      hub.startTyping(connection, conversationId);
      reply(accepted(null));
    },
  });

  return [subscribe, unsubscribe, catchUp, send, read, typing];
}

/**
 * Attaches every client event to one connection. An event name with no
 * handler here has no listener, so it is dropped by Socket.IO and allocates
 * nothing on this side.
 */
export function attachEvents(
  hub: Hub,
  connection: Connection,
  isClosing: () => boolean,
): void {
  for (const handler of handlersFor(hub)) {
    connection.socket.on(handler.name, (...args: unknown[]) => {
      const ack = args.at(-1);
      if (typeof ack !== 'function') return;
      hub.track(
        handle(handler, connection, args.slice(0, -1), (envelope) => {
          (ack as (envelope: RealtimeAck<unknown>) => void)(envelope);
        }),
      );
    });
  }

  async function handle(
    handler: EventHandler,
    connection: Connection,
    payloads: readonly unknown[],
    ack: Reply,
  ): Promise<void> {
    const startedAt = performance.now();
    let outcome: string | null = null;
    const reply: Reply = (envelope) => {
      if (outcome !== null) return;
      outcome = envelope.ok ? 'ok' : envelope.failure;
      try {
        ack(envelope);
      } catch {
        // The socket went away; the work it asked for stands.
      }
    };

    try {
      if (payloads.length !== 1) return reply(refused('invalid'));
      if (isClosing()) return reply(refused('unavailable'));
      const run = handler.parse(payloads[0]);
      if (run === null) return reply(refused('invalid'));
      if (!connection.budget.take(handler.budget)) return reply(refused('rate-limited'));

      let signedIn: boolean;
      try {
        signedIn = await connection.stillSignedIn();
      } catch {
        return reply(refused('unavailable'));
      }
      if (!signedIn) {
        reply(refused('signed-out'));
        hub.signOut(connection);
        return;
      }
      if (!connection.socket.connected) return reply(refused('unavailable'));

      try {
        await run(connection, reply);
      } catch (error) {
        if (outcome === null) {
          reply(refused(failureOf(error)));
        } else {
          // Failed AFTER the ack (a fan-out): what was committed and answered stands.
          connection.log('warn', {
            operation: `${handler.name}:after-ack`,
            outcome: 'failed',
          });
        }
      }
      if (outcome === null) reply(refused('unavailable'));
    } finally {
      connection.log('debug', {
        operation: handler.name,
        outcome: outcome ?? 'unanswered',
        durationMs: elapsedSince(startedAt),
      });
    }
  }
}
