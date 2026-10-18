import 'server-only';

import { CURRENCY_EXPONENTS, type DonationRefundPort } from '@minhaj/contracts/donations';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import {
  DonationsDataError,
  LOCKED_TRANSACTION,
  REFUND_FIRST_CHECK_MS,
  REFUND_OPERATION_KEY,
  REFUND_SELECT,
  REFUND_UNKNOWN_RETRY_MS,
  isUniqueViolationOn,
  later,
  lockDonation,
  lockRefund,
  lockRefundLedger,
  ownRefundTotals,
  refundRow,
  refuse,
  toRefundRecord,
  type RefundRow,
} from './shared.ts';

/**
 * Refunds — `donations.refund` with a live `donation-refund` step-up.
 *
 * THE AUTHORITY IS THE DATABASE'S. The service checks the key first only to
 * answer helpfully; the refund-admission trigger re-checks, inside the insert,
 * that the requester holds `donations.refund` NOW through a live assignment of
 * an active role on an active account AND a live `donation-refund` step-up
 * bound to a live session (51354). A caller cannot assert it.
 *
 * A RESERVATION, UNDER THE DONATION'S LOCK. The donation row is locked first;
 * its version must match; it must be captured and not charged back; the money
 * must be in its currency and within what remains:
 *
 *   captured − reserved − max(0, refunded − own succeeded)
 *
 * — what this platform has already reserved, and whatever the provider reports
 * refunded beyond this platform's own succeeded refunds (a refund made
 * elsewhere). The refund row and the raised reservation commit together, and
 * the trigger keeps every live refund within the captured amount (51355) and
 * the reservation equal to their sum (51349).
 *
 * NEVER A BLIND RETRY. A refused submission fails the refund and releases its
 * reservation in one transaction; an unanswered one stays `requested` and is
 * reconciled by reading the provider, never by asking it again blind.
 */

const AUTHORITY = 'donations.refund';

/** The existing refund an operation id already names, or a conflict. */
function replay(
  row: RefundRow,
  donationId: string,
  requestDigest: string,
): { readonly refund: ReturnType<typeof toRefundRecord>; readonly created: boolean } {
  if (row.donationId !== donationId || row.requestDigest !== requestDigest)
    throw new DonationsDataError('operation-conflict');
  return { refund: toRefundRecord(row), created: false };
}

export function createDonationRefunds(): DonationRefundPort {
  const db = getDatabaseClient();

  return {
    async reserve({
      refundId,
      operationId,
      requestDigest,
      donationId,
      expectedVersion,
      amount,
      actorId,
    }) {
      try {
        return await db.$transaction(async (tx) => {
          await lockRefundLedger(tx);
          const donation = await lockDonation(tx, donationId);
          // A duplicate submit of the same request answers the refund it
          // already reserved — before the version check, which the first
          // reservation moved on.
          const existing = await tx.donationRefund.findFirst({
            where: { operationId },
            select: REFUND_SELECT,
          });
          if (existing !== null) return replay(existing, donationId, requestDigest);
          if (donation === null) throw new DonationsDataError('not-found');
          if (donation.version !== expectedVersion)
            throw new DonationsDataError('conflict');
          if (
            donation.capturedMinor === null ||
            donation.state === 'charged_back' ||
            donation.paymentReference === null
          )
            throw new DonationsDataError('invalid-state');
          if (amount.currency !== donation.currency || amount.minor <= 0n)
            throw new DonationsDataError('invalid');
          const own = await ownRefundTotals(tx, donationId);
          const elsewhere =
            donation.refundedMinor > own.succeeded
              ? donation.refundedMinor - own.succeeded
              : 0n;
          const remaining =
            donation.capturedMinor - donation.refundReservedMinor - elsewhere;
          if (amount.minor > remaining) throw new DonationsDataError('over-refund');

          const now = new Date();
          await tx.donationRefund.create({
            data: {
              id: refundId,
              donationId,
              operationId,
              requestDigest,
              currency: amount.currency,
              currencyExponent: CURRENCY_EXPONENTS[amount.currency],
              amountMinor: amount.minor,
              state: 'requested',
              provider: donation.provider,
              environment: donation.environment,
              accountKey: donation.accountKey,
              requestedByUserId: actorId,
              requestedAt: now,
              reconcileDueAt: later(now, REFUND_FIRST_CHECK_MS),
              reconcileAttempts: 0,
              version: 1,
            },
            select: { id: true },
          });
          const raised = await tx.donation.updateMany({
            where: { id: donationId, version: donation.version },
            data: {
              refundReservedMinor: donation.refundReservedMinor + amount.minor,
              version: { increment: 1 },
              updatedAt: now,
            },
          });
          if (raised.count !== 1) throw new DonationsDataError('conflict');
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'donations.refund.requested',
              targetType: 'donation-refund',
              targetId: refundId,
              after: {
                donationId,
                state: 'requested',
                version: '1',
                currency: amount.currency,
                amountMinor: amount.minor.toString(),
                environment: donation.environment,
                donationVersion: String(donation.version + 1),
              },
              authorisingSource: AUTHORITY,
            }),
          });
          return { refund: toRefundRecord(await refundRow(tx, refundId)), created: true };
        }, LOCKED_TRANSACTION);
      } catch (error) {
        if (isUniqueViolationOn(error, REFUND_OPERATION_KEY)) {
          const winner = await db.donationRefund.findFirst({
            where: { operationId },
            select: REFUND_SELECT,
          });
          if (winner !== null) return replay(winner, donationId, requestDigest);
        }
        refuse(error);
      }
    },

    /**
     * `rejected`: the refund fails and its reservation is released, together.
     * `unknown`: it stays `requested` and is re-read soon. A refund no longer
     * `requested` already has the provider's answer and is returned unchanged.
     */
    async recordSubmission({ refundId, outcome, now }) {
      try {
        return toRefundRecord(
          await db.$transaction(async (tx) => {
            await lockRefundLedger(tx);
            const owner = await tx.donationRefund.findFirst({
              where: { id: refundId },
              select: { donationId: true },
            });
            if (owner === null) throw new DonationsDataError('not-found');
            const donation = await lockDonation(tx, owner.donationId);
            const refund = await lockRefund(tx, refundId);
            if (donation === null || refund === null)
              throw new DonationsDataError('not-found');
            if (refund.state !== 'requested') return refund;

            if (outcome === 'unknown') {
              const scheduled = await tx.donationRefund.updateMany({
                where: { id: refundId, version: refund.version },
                data: {
                  reconcileDueAt: later(now, REFUND_UNKNOWN_RETRY_MS),
                  reconcileLeaseUntil: null,
                },
              });
              if (scheduled.count !== 1) throw new DonationsDataError('conflict');
              return refundRow(tx, refundId);
            }

            const failed = await tx.donationRefund.updateMany({
              where: { id: refundId, version: refund.version, state: 'requested' },
              data: {
                state: 'failed',
                completedAt: now,
                reconcileDueAt: null,
                reconcileAttempts: 0,
                reconcileLeaseUntil: null,
                version: { increment: 1 },
              },
            });
            if (failed.count !== 1) throw new DonationsDataError('conflict');
            const released = await tx.donation.updateMany({
              where: { id: donation.id, version: donation.version },
              data: {
                refundReservedMinor: donation.refundReservedMinor - refund.amountMinor,
                version: { increment: 1 },
                updatedAt: now,
              },
            });
            if (released.count !== 1) throw new DonationsDataError('conflict');
            await tx.auditLog.create({
              data: auditRow({
                actorType: 'system',
                actorId: null,
                action: 'donations.refund.failed',
                targetType: 'donation-refund',
                targetId: refundId,
                before: { state: 'requested', version: String(refund.version) },
                after: {
                  state: 'failed',
                  version: String(refund.version + 1),
                  donationId: donation.id,
                  currency: refund.currency,
                  amountMinor: refund.amountMinor.toString(),
                  environment: refund.environment,
                },
                authorisingSource: 'provider',
              }),
            });
            return refundRow(tx, refundId);
          }, LOCKED_TRANSACTION),
        );
      } catch (error) {
        refuse(error);
      }
    },
  };
}
