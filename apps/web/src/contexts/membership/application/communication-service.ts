import 'server-only';

import type { Locale } from '@minhaj/contracts';
import {
  MEMBERSHIP_COMMUNICATION_PURPOSES,
  type MembershipCommunicationPort,
  type MembershipCommunicationPurpose,
  type MembershipRecipientPort,
  type MembershipTypeReference,
} from '@minhaj/contracts/membership';
import type { DeliveryRecord, DeliveryResolution } from '@minhaj/contracts/platform';

import { membershipMailLocale, renderMembershipMail } from './membership-mail.ts';

/**
 * Membership's half of the ONE outbound-communication architecture
 * (ARCHITECTURE.md §4.6.1): the durable intent a committed application or
 * Membership transition owes, relayed into the shared delivery rows by the
 * Layer-4 dispatcher, and resolved to a recipient and words at send time.
 *
 * WHAT MEMBERSHIP KNOWS AND WHAT IT DOES NOT. Membership knows WHY a message is
 * owed (an application received, under review, decided or withdrawn; a
 * Membership closed), to WHICH account and about WHICH record — all typed
 * identifiers. It holds no address: Identity resolves the account to its
 * CURRENT address and interface locale, through the port Layer 4 hands in,
 * both when the intent is relayed (the delivery row needs the address digest)
 * and again when the message is rendered. A closed, disabled or suspended
 * account is absent from that answer and is owed nothing.
 *
 * NOTHING STALE IS SENT. At relay AND at send time the intent is re-read: the
 * application must still stand at the status the message describes (a
 * withdrawal only when the applicant made it), or the Membership must be
 * closed. A later transition owes its own, newer message; anything no longer
 * owed is abandoned, never deferred.
 *
 * TRANSACTIONAL, NEVER MARKETING. These are service messages about an
 * application the person made; the dispatcher withholds them only on a
 * transactional suppression.
 */

const MEMBERSHIP_PURPOSES: ReadonlySet<string> = new Set<string>(
  MEMBERSHIP_COMMUNICATION_PURPOSES,
);

export function isMembershipDeliveryPurpose(
  purpose: string,
): purpose is MembershipCommunicationPurpose {
  return MEMBERSHIP_PURPOSES.has(purpose);
}

/** The opaque handle a delivery carries back to its intent. */
const SOURCE = /^membership:([0-9a-f-]{36})$/;

/** Comfortably longer than one relay pass. */
const LEASE_SECONDS = 120;

/** The type's title in the reader's locale, else in its primary locale, with that locale. */
function titleOf(
  type: MembershipTypeReference,
  locale: Locale,
): { readonly text: string; readonly locale: Locale } {
  const label =
    type.labels.find((entry) => entry.locale === locale) ??
    type.labels.find((entry) => entry.locale === type.primaryLocale) ??
    type.labels[0];
  return label === undefined
    ? { text: '', locale }
    : { text: label.title, locale: label.locale };
}

export function createMembershipCommunicationService(deps: {
  readonly communication: MembershipCommunicationPort;
  readonly recipients: MembershipRecipientPort;
  /** The shared delivery concern's enqueue, handed in by Layer 4. */
  readonly enqueue: (delivery: {
    readonly purpose: MembershipCommunicationPurpose;
    readonly recipient: string;
    readonly sourceReference: string;
    readonly idempotencyKey: string;
  }) => Promise<void>;
  readonly baseUrl: string;
  readonly clock?: () => Date;
}) {
  const now = deps.clock ?? (() => new Date());

  /** The person's own private Membership page, in their interface locale. */
  const membershipUrl = (locale: Locale): string =>
    new URL(`/${locale}/my/membership`, deps.baseUrl).toString();

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
        const [recipient] = await deps.recipients.recipients([intent.recipientAccountId]);
        if (recipient === undefined) {
          await deps.communication.markAbandoned(intent.id);
          continue;
        }
        await deps.enqueue({
          purpose: intent.purpose,
          recipient: recipient.email,
          sourceReference: `membership:${intent.id}`,
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
      if (!isMembershipDeliveryPurpose(delivery.purpose))
        return { outcome: 'nothing-owed' };
      const intentId = SOURCE.exec(delivery.sourceReference)?.[1];
      if (intentId === undefined) return { outcome: 'nothing-owed' };
      const source = await deps.communication.deliverySource(intentId);
      if (
        source === null ||
        source.intent.state === 'abandoned' ||
        source.intent.purpose !== delivery.purpose
      )
        return { outcome: 'nothing-owed' };
      // A relayed intent is what a delivery normally finds; `owed` is the live
      // re-check of the record's current state behind it.
      if (!source.owed) return { outcome: 'nothing-owed' };
      const [recipient] = await deps.recipients.recipients([
        source.intent.recipientAccountId,
      ]);
      if (recipient === undefined) return { outcome: 'nothing-owed' };
      const locale = membershipMailLocale(recipient.locale);
      return {
        outcome: 'send',
        message: renderMembershipMail({
          purpose: source.intent.purpose,
          locale,
          recipient: recipient.email,
          typeTitle: titleOf(source.type, locale),
          membershipUrl: membershipUrl(locale),
        }),
      };
    },
  };
}

export type MembershipCommunicationService = ReturnType<
  typeof createMembershipCommunicationService
>;
