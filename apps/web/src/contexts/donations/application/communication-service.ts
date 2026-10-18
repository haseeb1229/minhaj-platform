import 'server-only';

import type { Locale } from '@minhaj/contracts';
import {
  DONATION_COMMUNICATION_PURPOSES,
  type CampaignLabel,
  type DonationCommunicationPort,
  type DonationCommunicationPurpose,
  type DonationLedgerPort,
  type DonationRecipientPort,
} from '@minhaj/contracts/donations';
import type { DeliveryRecord, DeliveryResolution } from '@minhaj/contracts/platform';

import { donationMailLocale, renderDonationMail } from './donations-mail.ts';

/**
 * Donations' half of the ONE outbound-communication architecture
 * (ARCHITECTURE.md §4.6.1): the durable intent a verified capture or settled
 * refund of a LINKED donation owes, relayed into the shared delivery rows by
 * the Layer-4 dispatcher, and resolved to a recipient and words at send time.
 *
 * DONATIONS HOLDS NO ADDRESS. It knows why a message is owed, to which account
 * and about which donation or refund; Identity resolves the account to its
 * CURRENT address and locale, at relay and again at render. A closed or
 * disabled account is absent from that answer and is owed nothing; an
 * anonymous donation never had a recipient.
 *
 * NOTHING STALE IS SENT. At relay AND at send time the intent is re-read: the
 * fact it announces must still hold for the same linked donor (a released
 * link, or a donation no longer in that state, owes nothing). Anything no
 * longer owed is abandoned, never deferred.
 *
 * TRANSACTIONAL, NEVER MARKETING. A payment acknowledgement is service mail
 * about a payment the person made; only a transactional suppression withholds
 * it.
 */

const DONATION_PURPOSES: ReadonlySet<string> = new Set<string>(
  DONATION_COMMUNICATION_PURPOSES,
);

export function isDonationDeliveryPurpose(
  purpose: string,
): purpose is DonationCommunicationPurpose {
  return DONATION_PURPOSES.has(purpose);
}

/** The opaque handle a delivery carries back to its intent. */
const SOURCE = /^donation:([0-9a-f-]{36})$/u;

/** Comfortably longer than one relay pass. */
const LEASE_SECONDS = 120;

/** The campaign's title in the reader's locale, else in its primary locale, with that locale. */
function titleOf(
  campaign: CampaignLabel,
  locale: Locale,
): { readonly text: string; readonly locale: Locale } {
  const label =
    campaign.translations.find((entry) => entry.locale === locale) ??
    campaign.translations.find((entry) => entry.locale === campaign.primaryLocale) ??
    campaign.translations[0];
  return label === undefined
    ? { text: '', locale }
    : { text: label.title, locale: label.locale };
}

export function createDonationsCommunicationService(deps: {
  readonly communication: DonationCommunicationPort;
  readonly recipients: DonationRecipientPort;
  /** The donation's own environment, so a test payment's message says it is one. */
  readonly ledger: Pick<DonationLedgerPort, 'donation'>;
  /** The shared delivery concern's enqueue, handed in by Layer 4. */
  readonly enqueue: (delivery: {
    readonly purpose: DonationCommunicationPurpose;
    readonly recipient: string;
    readonly sourceReference: string;
    readonly idempotencyKey: string;
  }) => Promise<void>;
  readonly baseUrl: string;
  readonly clock?: () => Date;
}) {
  const now = deps.clock ?? (() => new Date());

  /** The person's own private donations page, in their interface locale. */
  const donationsUrl = (locale: Locale): string =>
    new URL(`/${locale}/my/donations`, deps.baseUrl).toString();

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
          await deps.communication.markAbandoned(intent.id, now());
          continue;
        }
        const [recipient] = await deps.recipients.recipients([intent.recipientAccountId]);
        if (recipient === undefined) {
          await deps.communication.markAbandoned(intent.id, now());
          continue;
        }
        await deps.enqueue({
          purpose: intent.purpose,
          recipient: recipient.email,
          sourceReference: `donation:${intent.id}`,
          idempotencyKey: intent.idempotencyKey,
        });
        // AFTER the delivery exists, so a crash here replays the enqueue —
        // idempotent on the key — rather than losing the message.
        await deps.communication.markRelayed(intent.id, now());
        relayed += 1;
      }
      return relayed;
    },

    /** Renders one owed delivery at send time, or says nothing is owed any more. */
    async resolveDelivery(delivery: DeliveryRecord): Promise<DeliveryResolution> {
      if (!isDonationDeliveryPurpose(delivery.purpose))
        return { outcome: 'nothing-owed' };
      const intentId = SOURCE.exec(delivery.sourceReference)?.[1];
      if (intentId === undefined) return { outcome: 'nothing-owed' };
      const source = await deps.communication.deliverySource(intentId);
      if (
        source === null ||
        source.intent.state === 'abandoned' ||
        source.intent.purpose !== delivery.purpose ||
        // The live re-check of the donation behind a relayed intent.
        !source.owed
      )
        return { outcome: 'nothing-owed' };
      if (source.intent.purpose !== 'donation.succeeded' && source.refundAmount === null)
        return { outcome: 'nothing-owed' };
      const donation = await deps.ledger.donation(source.intent.donationId);
      if (donation === null) return { outcome: 'nothing-owed' };
      const [recipient] = await deps.recipients.recipients([
        source.intent.recipientAccountId,
      ]);
      if (recipient === undefined) return { outcome: 'nothing-owed' };
      const locale = donationMailLocale(recipient.locale);
      return {
        outcome: 'send',
        message: renderDonationMail({
          purpose: source.intent.purpose,
          locale,
          recipient: recipient.email,
          campaignTitle: titleOf(source.campaign, locale),
          amount: source.expected,
          refunded: source.refundAmount,
          environment: donation.scope.environment,
          donationsUrl: donationsUrl(locale),
        }),
      };
    },
  };
}

export type DonationsCommunicationService = ReturnType<
  typeof createDonationsCommunicationService
>;
