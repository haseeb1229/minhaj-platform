import 'server-only';

import type {
  ClassCommunicationPort,
  LearningRecipientPort,
} from '@minhaj/contracts/learning';
import type {
  DeliveryRecord,
  DeliveryResolution,
  LearningDeliveryPurpose,
} from '@minhaj/contracts/platform';

import { renderClassMail } from './class-mail.ts';

/**
 * Learning's half of the ONE outbound-communication architecture
 * (ARCHITECTURE.md §4.6.1): the durable intent a committed class event owes,
 * relayed into the shared delivery rows by the Layer-4 dispatcher, and
 * resolved to a recipient and words at send time.
 *
 * WHAT LEARNING KNOWS AND WHAT IT DOES NOT. Learning knows WHY a message is
 * owed (a confirmed trial, a moved or cancelled class, a chosen reminder
 * instant), to WHICH account and for WHICH session — all typed identifiers.
 * It holds no address: Identity resolves the account to its CURRENT address
 * and interface locale, through the port Layer 4 hands in, both when the
 * intent is relayed (the delivery row needs the address digest) and again
 * when the message is rendered. A closed, disabled or suspended account is
 * absent from that answer and is owed nothing.
 *
 * NOTHING STALE IS SENT. At relay AND at send time the intent is re-read:
 * live learning must still be activated, the session still scheduled (a
 * cancellation notice is the one message owed about a closed session), and
 * the recipient still a current participant or the current teacher. A moved
 * class has already abandoned its old reminder intent, so the old time can
 * never fire. Anything no longer owed is abandoned, never deferred.
 *
 * NEVER A MEETING ADDRESS: the message links to the person's own private
 * class page (SECURITY_BASELINE.md §11).
 */

const LEARNING_PURPOSES: ReadonlySet<string> = new Set<LearningDeliveryPurpose>([
  'learning.booking-confirmed',
  'learning.session-rescheduled',
  'learning.session-cancelled',
  'learning.class-reminder',
]);

export function isLearningDeliveryPurpose(
  purpose: string,
): purpose is LearningDeliveryPurpose {
  return LEARNING_PURPOSES.has(purpose);
}

/** The opaque handle a delivery carries back to its intent. */
const SOURCE = /^learning:([0-9a-f-]{36})$/;

/** Comfortably longer than one relay pass. */
const LEASE_SECONDS = 120;

export function createClassCommunicationService(deps: {
  readonly communication: ClassCommunicationPort;
  readonly recipients: LearningRecipientPort;
  /** The shared delivery concern's enqueue, handed in by Layer 4. */
  readonly enqueue: (delivery: {
    readonly purpose: LearningDeliveryPurpose;
    readonly recipient: string;
    readonly sourceReference: string;
    readonly idempotencyKey: string;
  }) => Promise<void>;
  readonly baseUrl: string;
  readonly clock?: () => Date;
}) {
  const now = deps.clock ?? (() => new Date());

  /** The person's own private class page, in their interface locale. */
  function classUrl(
    locale: string,
    role: 'learner' | 'teacher',
    sessionId: string,
  ): string {
    const path =
      role === 'teacher'
        ? `/${locale}/teacher/classes/today/${sessionId}`
        : `/${locale}/my/classes/${sessionId}`;
    return new URL(path, deps.baseUrl).toString();
  }

  return {
    /**
     * Relays due intents into delivery rows. Called by the Layer-4 dispatcher
     * on every tick; bounded; safe to run concurrently (the claim is a lease).
     */
    async relayPendingIntents(limit: number): Promise<number> {
      const due = await deps.communication.claimDue(now(), limit, LEASE_SECONDS);
      let relayed = 0;
      for (const intent of due) {
        const source = await deps.communication.deliverySource(intent.id);
        if (source === null || !source.owed) {
          await deps.communication.markAbandoned(intent.id);
          continue;
        }
        const [recipient] = await deps.recipients.recipients([intent.accountId]);
        if (recipient === undefined) {
          await deps.communication.markAbandoned(intent.id);
          continue;
        }
        await deps.enqueue({
          purpose: intent.purpose,
          recipient: recipient.email,
          sourceReference: `learning:${intent.id}`,
          idempotencyKey: intent.idempotencyKey,
        });
        // AFTER the delivery exists, so a crash here replays the enqueue —
        // idempotent on the key — rather than losing the message.
        await deps.communication.markRelayed(intent.id);
        relayed += 1;
      }
      return relayed;
    },

    /** Renders one owed delivery at send time, or says nothing is owed any more. */
    async resolveDelivery(delivery: DeliveryRecord): Promise<DeliveryResolution> {
      if (!isLearningDeliveryPurpose(delivery.purpose))
        return { outcome: 'nothing-owed' };
      const intentId = SOURCE.exec(delivery.sourceReference)?.[1];
      if (intentId === undefined) return { outcome: 'nothing-owed' };
      const source = await deps.communication.deliverySource(intentId);
      if (source === null || source.intent.state === 'abandoned')
        return { outcome: 'nothing-owed' };
      // A relayed intent is what a delivery normally finds; `owed` is the live
      // re-check of session, activation and relationship behind it.
      if (!source.owed) return { outcome: 'nothing-owed' };
      const [recipient] = await deps.recipients.recipients([source.intent.accountId]);
      if (recipient === undefined) return { outcome: 'nothing-owed' };
      return {
        outcome: 'send',
        message: renderClassMail({
          purpose: delivery.purpose,
          audience: source.recipientRole,
          locale: recipient.locale,
          recipient: recipient.email,
          startsAt: source.session.session.startsAt,
          endsAt: source.session.session.endsAt,
          timeZone: source.session.session.timeZone,
          classUrl: classUrl(
            recipient.locale,
            source.recipientRole,
            source.session.session.id,
          ),
        }),
      };
    },

    /** Operator view of pending and abandoned intents by purpose. */
    summarise() {
      return deps.communication.summarise();
    },
  };
}

export type ClassCommunicationService = ReturnType<
  typeof createClassCommunicationService
>;
