import 'server-only';

import type {
  CatchUpPage,
  ConversationView,
  MessageView,
  MessagingActor,
  SendMessageInput,
} from '@minhaj/contracts/messaging';

import { createMessagingService } from './service.ts';
import { MessagingRefusal } from './types.ts';
import type { MessagingService, MessagingServiceDependencies } from './types.ts';

/**
 * The realtime transport's view of Messaging — Messaging's, hosted here
 * (ARCHITECTURE.md §3.1, §3.3; DELIVERY_PLAN.md Phase 25).
 *
 * THE SAME IMPLEMENTATION, NARROWED. Built over `createMessagingService` with
 * the dependencies the web process uses, so every answer below comes from the
 * one access decision, the one send path and the one idempotency key. It adds
 * no rule: it only CHOOSES which existing operations a socket may reach and
 * shapes their answers for a transport. Attachment bytes, starting a
 * conversation, blocking, reporting, support administration, moderation,
 * export and disposition are deliberately absent — they stay on their audited
 * web paths.
 *
 * PERSON-FACING ONLY. A support staff member's reading of a support
 * conversation is an AUDITED access on the administration surface
 * (`supportConversation`). The ordinary access decision also admits a claimed
 * staff participant, so a socket subscription would be a second, unaudited
 * door to the same content; this facade refuses the `support` role outright.
 * The person asking for support still receives the staff reply live.
 *
 * EVERY ANSWER IS FOR ONE PERSON, NOW. `deliveryFor` reads the committed
 * message from SQL AS ITS RECIPIENT, through the same decision, at the moment
 * of delivery — so a recipient whose relationship ended, who was blocked, or
 * whose conversation closed after they subscribed receives nothing, and what
 * a recipient does receive is exactly what the database holds for them.
 * Transport room membership is never consulted here.
 */

export interface RealtimeConversation {
  readonly conversationId: string;
  readonly lastSequence: number;
  readonly readSequence: number;
  readonly canSend: boolean;
}

export interface RealtimeMessaging {
  /** May this person follow this conversation now? Refuses like the web reads do. */
  open(actor: MessagingActor, conversationId: string): Promise<RealtimeConversation>;
  catchUp(
    actor: MessagingActor,
    conversationId: string,
    after: number,
  ): Promise<CatchUpPage>;
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
  /** May this person signal typing now — the send gate, without sending. */
  canType(actor: MessagingActor, conversationId: string): Promise<boolean>;
  /**
   * The committed message at `sequence`, as `recipient` may see it NOW, or
   * `null` when they may not — the only source of an outbound message.
   */
  deliveryFor(
    recipient: MessagingActor,
    conversationId: string,
    sequence: number,
  ): Promise<MessageView | null>;
  /** May `recipient` be told about the other person's presence or typing NOW? */
  mayObserve(recipient: MessagingActor, conversationId: string): Promise<boolean>;
}

/** A person-facing view the transport may act on, or a refusal. */
function personFacing(view: ConversationView): ConversationView {
  if (view.summary.role === 'support') throw new MessagingRefusal('not-found');
  return view;
}

/** `null` for a refusal Messaging chose; an outage still throws. */
async function orNull<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof MessagingRefusal) return null;
    throw error;
  }
}

export function createRealtimeMessaging(
  dependencies: MessagingServiceDependencies,
): RealtimeMessaging {
  return realtimeOver(createMessagingService(dependencies));
}

/** The facade over an already-built service — the same object the web process holds. */
export function realtimeOver(service: MessagingService): RealtimeMessaging {
  async function view(
    actor: MessagingActor,
    conversationId: string,
  ): Promise<ConversationView> {
    return personFacing(await service.conversation(actor, conversationId));
  }

  return {
    async open(actor, conversationId) {
      const current = await view(actor, conversationId);
      return {
        conversationId: current.summary.id,
        lastSequence: current.summary.lastSequence,
        readSequence: current.readSequence,
        canSend: current.canSend,
      };
    },

    async catchUp(actor, conversationId, after) {
      await view(actor, conversationId);
      return service.catchUp(actor, conversationId, after);
    },

    async send(actor, conversationId, input) {
      await view(actor, conversationId);
      return service.send(actor, conversationId, input);
    },

    async markRead(actor, conversationId, sequence) {
      await view(actor, conversationId);
      return service.markRead(actor, conversationId, sequence);
    },

    async canType(actor, conversationId) {
      const current = await orNull(() => view(actor, conversationId));
      return current !== null && current.canSend;
    },

    async deliveryFor(recipient, conversationId, sequence) {
      if (!Number.isSafeInteger(sequence) || sequence < 1) return null;
      return orNull(async () => {
        const current = await view(recipient, conversationId);
        // A NEW message reaches only a conversation that is live for this
        // person; terminal history is read, never streamed.
        if (current.summary.access !== 'available') return null;
        const page = await service.catchUp(recipient, conversationId, sequence - 1);
        return page.messages.find((message) => message.sequence === sequence) ?? null;
      });
    },

    async mayObserve(recipient, conversationId) {
      const current = await orNull(() => view(recipient, conversationId));
      // PRESENCE AND TYPING ARE CONTACT, so they follow the SEND gate, not the
      // read gate: a live, open conversation the recipient could write in now.
      // `canSend` is false while EITHER person has blocked the other (and for
      // a closed or terminal conversation), so a blocked pair learn nothing
      // more about each other — not that one is online, not that one types.
      return (
        current !== null &&
        current.summary.access === 'available' &&
        current.summary.state === 'open' &&
        current.canSend
      );
    },
  };
}
