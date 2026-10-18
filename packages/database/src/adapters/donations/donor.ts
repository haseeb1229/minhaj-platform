import 'server-only';

import {
  CURRENCY_EXPONENTS,
  activationPermits,
  checkRequestedMoney,
  deriveDonationState,
  type DonationActivationAuthority,
  type DonationBeginInput,
  type DonationCurrency,
  type DonationDonorPort,
  type DonationRecord,
  type DonationState,
  type DonationStatusView,
  type PaymentEnvironment,
} from '@minhaj/contracts/donations';

import { getDatabaseClient } from '../../client.ts';
import {
  AMBIGUOUS_RETRY_MS,
  BEGIN_RECOVERY_MS,
  CAMPAIGN_LABEL_SELECT,
  DONATION_OPERATION_KEY,
  DONATION_SELECT,
  DonationsDataError,
  LOCKED_TRANSACTION,
  POLICY_SELECT,
  donationRow,
  factsOf,
  firstCheckoutCheck,
  isUniqueViolationOn,
  later,
  lockCampaign,
  lockDonation,
  refuse,
  scopeOf,
  toCampaignLabel,
  toDonationRecord,
  toPolicy,
  type DonationRow,
} from './shared.ts';

/**
 * The donor's surface: initiation, the provider checkout's creation record,
 * the anonymous status token, and cancellation.
 *
 * INITIATION IS SERIALISED WITH THE CAMPAIGN. `begin` takes the campaign lock
 * every campaign change takes, then asks — under it — whether the campaign is
 * published, whether its CURRENT policy admits the exact money
 * (`checkRequestedMoney`) and whether the activation permits the scope
 * (`activationPermits`). The admission trigger asks the same questions, and
 * whether a linked account is active, beneath the insert (51343–51346).
 *
 * IDEMPOTENT BY OPERATION ID. The same operation with the same request digest
 * is the same donation (`created: false`); a different digest is
 * `operation-conflict`. The unique key is the floor beneath a race.
 *
 * THE STATUS TOKEN IS NEVER HERE. Only its SHA-256 digest is stored and looked
 * up; the token itself reads one donation's status and nothing else.
 */

/** The existing donation an operation id already names, or a conflict. */
function replay(
  row: DonationRow,
  requestDigest: string,
): { readonly donation: DonationRecord; readonly created: boolean } {
  if (row.requestDigest !== requestDigest)
    throw new DonationsDataError('operation-conflict');
  return { donation: toDonationRecord(row), created: false };
}

export function createDonationDonor(): DonationDonorPort {
  const db = getDatabaseClient();

  return {
    async begin(input: DonationBeginInput) {
      try {
        return await db.$transaction(async (tx) => {
          await lockCampaign(tx, input.campaignId);
          const existing = await tx.donation.findFirst({
            where: { operationId: input.operationId },
            select: DONATION_SELECT,
          });
          if (existing !== null) return replay(existing, input.requestDigest);

          // A missing campaign and an unpublished one get the same answer: a
          // draft is not public, so its existence is not disclosed.
          const campaign = await tx.donationCampaign.findFirst({
            where: { id: input.campaignId },
            select: { state: true, currencies: { select: POLICY_SELECT } },
          });
          if (campaign === null || campaign.state !== 'published')
            throw new DonationsDataError('campaign-unavailable');
          if (
            checkRequestedMoney(campaign.currencies.map(toPolicy), input.expected) !==
            'ok'
          )
            throw new DonationsDataError('amount-refused');

          const activation = await tx.donationActivation.findFirst({
            where: { id: 1 },
            select: {
              provider: true,
              environment: true,
              accountKey: true,
              authority: true,
              activatedAt: true,
            },
          });
          const permitted = activationPermits(
            activation === null
              ? null
              : {
                  ...scopeOf(activation),
                  authority: activation.authority as DonationActivationAuthority,
                  activatedAt: activation.activatedAt,
                },
            input.scope,
          );
          if (!permitted) throw new DonationsDataError('not-activated');

          const now = new Date();
          await tx.donation.create({
            data: {
              id: input.id,
              campaignId: input.campaignId,
              donorUserId: input.donorAccountId,
              operationId: input.operationId,
              requestDigest: input.requestDigest,
              statusTokenDigest: input.statusTokenDigest,
              locale: input.locale,
              checkoutLabel: input.checkoutLabel,
              currency: input.expected.currency,
              currencyExponent: CURRENCY_EXPONENTS[input.expected.currency],
              expectedMinor: input.expected.minor,
              provider: input.scope.provider,
              environment: input.scope.environment,
              accountKey: input.scope.accountKey,
              createState: 'pending',
              state: 'pending',
              version: 1,
              // A crash between this commit and the provider create is found
              // by reconciliation, which repeats the create under the SAME
              // idempotency key — never a second checkout.
              reconcileDueAt: later(now, BEGIN_RECOVERY_MS),
              reconcileAttempts: 0,
              createdAt: now,
              updatedAt: now,
            },
            select: { id: true },
          });
          return {
            donation: toDonationRecord(await donationRow(tx, input.id)),
            created: true,
          };
        }, LOCKED_TRANSACTION);
      } catch (error) {
        if (isUniqueViolationOn(error, DONATION_OPERATION_KEY)) {
          const winner = await db.donation.findFirst({
            where: { operationId: input.operationId },
            select: DONATION_SELECT,
          });
          if (winner !== null) return replay(winner, input.requestDigest);
        }
        refuse(error);
      }
    },

    /**
     * `pending | ambiguous → created`, once. Repeating it with the SAME
     * reference (a reconciliation and a donor racing the same idempotent
     * create) is the same answer; a different reference is `conflict`. The
     * reference is unique within its provider scope (`Donation_checkout_key`).
     */
    async recordCheckout({ id, checkoutReference, expiresAt, now }) {
      try {
        return toDonationRecord(
          await db.$transaction(async (tx) => {
            const row = await lockDonation(tx, id);
            if (row === null) throw new DonationsDataError('not-found');
            if (row.createState === 'created') {
              if (row.checkoutReference === checkoutReference) return row;
              throw new DonationsDataError('conflict');
            }
            if (row.createState === 'rejected')
              throw new DonationsDataError('invalid-state');
            const changed = await tx.donation.updateMany({
              where: { id, version: row.version },
              data: {
                createState: 'created',
                checkoutReference,
                checkoutExpiresAt: expiresAt,
                reconcileDueAt: firstCheckoutCheck(row.createdAt, expiresAt),
                reconcileAttempts: 0,
                reconcileLeaseUntil: null,
                version: { increment: 1 },
                updatedAt: now,
              },
            });
            if (changed.count !== 1) throw new DonationsDataError('conflict');
            return donationRow(tx, id);
          }, LOCKED_TRANSACTION),
        );
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * The create was not answered `created`. `ambiguous` (from `pending`)
     * schedules a re-ask under the same key; `rejected` closes the donation
     * `failed`, since nothing exists at the provider. A create already
     * `created` or `rejected` is final and is returned unchanged, so a stale
     * answer racing a definitive one never regresses it; a repeated
     * `ambiguous` changes nothing (its schedule is the reconciler's).
     */
    async recordCreateOutcome({ id, outcome, now }) {
      try {
        return toDonationRecord(
          await db.$transaction(async (tx) => {
            const row = await lockDonation(tx, id);
            if (row === null) throw new DonationsDataError('not-found');
            if (row.createState === 'created' || row.createState === 'rejected')
              return row;
            if (outcome === 'ambiguous' && row.createState === 'ambiguous') return row;
            const data =
              outcome === 'ambiguous'
                ? {
                    createState: 'ambiguous',
                    reconcileDueAt: later(now, AMBIGUOUS_RETRY_MS),
                    reconcileLeaseUntil: null,
                  }
                : {
                    createState: 'rejected',
                    closure: 'failed',
                    state: deriveDonationState({ ...factsOf(row), closure: 'failed' }),
                    reconcileDueAt: null,
                    reconcileAttempts: 0,
                    reconcileLeaseUntil: null,
                  };
            const changed = await tx.donation.updateMany({
              where: { id, version: row.version },
              data: { ...data, version: { increment: 1 }, updatedAt: now },
            });
            if (changed.count !== 1) throw new DonationsDataError('conflict');
            return donationRow(tx, id);
          }, LOCKED_TRANSACTION),
        );
      } catch (error) {
        refuse(error);
      }
    },

    async donationByToken(statusTokenDigest) {
      try {
        const row = await db.donation.findFirst({
          where: { statusTokenDigest },
          select: DONATION_SELECT,
        });
        return row === null ? null : toDonationRecord(row);
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * What the token holder may read: state, money, environment and the
     * campaign's words — nothing personal and no provider reference.
     * Cancellable only while the checkout is open at the provider and no
     * cancellation was asked for yet.
     */
    async statusByToken(statusTokenDigest): Promise<DonationStatusView | null> {
      try {
        const row = await db.donation.findFirst({
          where: { statusTokenDigest },
          select: {
            state: true,
            currency: true,
            expectedMinor: true,
            refundedMinor: true,
            environment: true,
            createState: true,
            cancelRequestedAt: true,
            createdAt: true,
            updatedAt: true,
            campaign: { select: CAMPAIGN_LABEL_SELECT },
          },
        });
        if (row === null) return null;
        return {
          state: row.state as DonationState,
          expected: {
            currency: row.currency as DonationCurrency,
            minor: row.expectedMinor,
          },
          refundedMinor: row.refundedMinor,
          environment: row.environment as PaymentEnvironment,
          campaign: toCampaignLabel(row.campaign),
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          cancellable:
            row.state === 'pending' &&
            row.createState === 'created' &&
            row.cancelRequestedAt === null,
        };
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * The donor asked to abandon a still-pending checkout. Idempotent: a
     * second ask changes nothing. A donation that is no longer pending is
     * `invalid-state` — provider truth already decided it.
     */
    async markCancelRequested({ id, now }) {
      try {
        return toDonationRecord(
          await db.$transaction(async (tx) => {
            const row = await lockDonation(tx, id);
            if (row === null) throw new DonationsDataError('not-found');
            if (row.cancelRequestedAt !== null) return row;
            if (row.state !== 'pending') throw new DonationsDataError('invalid-state');
            const changed = await tx.donation.updateMany({
              where: { id, version: row.version },
              data: {
                cancelRequestedAt: now,
                state: deriveDonationState({ ...factsOf(row), cancelRequested: true }),
                version: { increment: 1 },
                updatedAt: now,
              },
            });
            if (changed.count !== 1) throw new DonationsDataError('conflict');
            return donationRow(tx, id);
          }, LOCKED_TRANSACTION),
        );
      } catch (error) {
        refuse(error);
      }
    },
  };
}
