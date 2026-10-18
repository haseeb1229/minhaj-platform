import 'server-only';

import { randomUUID } from 'node:crypto';

import { Prisma } from '@prisma/client';

import {
  DONATION_REFUND_TRANSITIONS,
  deriveDonationState,
  mergeProviderTruth,
  sameScope,
  type DonationAttention,
  type DonationCurrency,
  type DonationLedgerPort,
  type DonationRefundState,
  type DonationTruthResult,
  type PaymentScope,
} from '@minhaj/contracts/donations';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import {
  DONATION_SELECT,
  DonationsDataError,
  EVENT_KEY,
  EXPIRY_GRACE_MS,
  LOCKED_TRANSACTION,
  PENDING_FIRST_CHECK_MS,
  REFUND_PENDING_CHECK_MS,
  REFUND_SELECT,
  backoff,
  bounded,
  commitIntent,
  donationRow,
  factsOf,
  isUniqueViolationOn,
  later,
  lockDonation,
  lockRefund,
  lockRefundLedger,
  ownRefundTotals,
  refundRow,
  refuse,
  scopeOf,
  tail,
  toDonationRecord,
  toRefundRecord,
  type Client,
  type DonationRow,
  type RefundRow,
} from './shared.ts';

/**
 * The ledger: verified provider truth from webhooks, reconciliation, the
 * donor's own "check again" and an operator's reconcile, applied by ONE rule.
 *
 * THE CONTRACT DECIDES, THIS WRITES. Every observation goes through
 * `mergeProviderTruth` and every state through `deriveDonationState` — the
 * contract's own functions, never a re-implementation — under the donation's
 * row lock, and the database's CHECK refuses any row whose state is not the
 * derivation of its facts. Captured is set once, refunded only grows,
 * disputes only move forward; a late "pending" or "failed" can never regress
 * verified success, in any order of arrival.
 *
 * NEVER SUCCEEDS ON A MISMATCH. A scope, checkout, client reference, amount or
 * payment reference that does not agree raises `attention` and changes no
 * fact; the flag stops automatic reconciliation of that donation (no due
 * instant) until a person asks again.
 *
 * DEDUP IS DURABLE. A provider event is recorded by scope and id before it is
 * acted on and completed after; a duplicate delivery of a completed event is
 * `already-processed`, and one an earlier attempt never completed is
 * processed again rather than lost. No payload is ever stored.
 *
 * LOCK ORDER: the refund ledger lock (every refund writer), then the donation
 * row, then its refund rows — the order every refund writer also takes.
 */

/** Rows one sweep tick claims at most. */
const CLAIM_MAX = 100;

const EVENT_TYPE_MAX = 64;

type Truth = Extract<DonationTruthResult, { readonly verdict: 'apply' }>;

/**
 * An attention verdict: the flag alone, and automatic reconciliation of the
 * donation stops (a person's question). No fact moves.
 */
async function flagAttention(
  tx: Client,
  row: DonationRow,
  attention: DonationAttention,
  now: Date,
): Promise<{ readonly row: DonationRow; readonly changed: boolean }> {
  const changed = row.attention !== attention;
  if (!changed && row.reconcileDueAt === null) return { row, changed: false };
  const claimed = await tx.donation.updateMany({
    where: { id: row.id, version: row.version },
    data: {
      attention,
      reconcileDueAt: null,
      reconcileLeaseUntil: null,
      ...(changed ? { version: { increment: 1 }, updatedAt: now } : {}),
    },
  });
  if (claimed.count !== 1) throw new DonationsDataError('conflict');
  return { row: await donationRow(tx, row.id), changed };
}

/**
 * When a still-pending donation is next re-read. Before its checkout's expiry
 * grace: within fifteen minutes, never later than the grace. After it — a
 * provider that still reports an open checkout — the bounded backoff, and once
 * that is spent, `unresolved`.
 */
function pendingSchedule(
  row: DonationRow,
  now: Date,
): { readonly reconcileDueAt: Date | null; readonly reconcileAttempts: number } {
  const grace =
    row.checkoutExpiresAt === null ? null : later(row.checkoutExpiresAt, EXPIRY_GRACE_MS);
  if (grace !== null && now.getTime() < grace.getTime())
    return {
      reconcileDueAt: new Date(
        Math.min(now.getTime() + PENDING_FIRST_CHECK_MS, grace.getTime()),
      ),
      reconcileAttempts: 0,
    };
  const next = backoff(now, row.reconcileAttempts);
  return { reconcileDueAt: next.dueAt, reconcileAttempts: next.attempts };
}

/**
 * An `apply` verdict, written: the merged facts, their derived state, the
 * payment reference (set once, scoped-unique), the success instant, the
 * attention flag and the reconcile schedule; the version moves only when a
 * fact did. On the transition into captured, a LINKED donation's owed
 * acknowledgement is committed in the same transaction.
 */
async function applyTruth(
  tx: Client,
  row: DonationRow,
  truth: Truth,
  now: Date,
): Promise<{ readonly row: DonationRow; readonly changed: boolean }> {
  const facts = truth.facts;
  const state = deriveDonationState(facts);
  const paymentReference = row.paymentReference ?? truth.paymentReference;
  const capturedNow = row.capturedMinor === null && facts.capturedMinor !== null;
  const succeededAt = row.succeededAt ?? (facts.capturedMinor === null ? null : now);

  // The provider answered, so an earlier "could not answer" no longer stands.
  // A refund this platform did not request (refunded beyond every live refund
  // of its own) is flagged for a person, never hidden.
  let attention =
    row.attention === 'unresolved' ? null : (row.attention as DonationAttention | null);
  if (
    attention === null &&
    facts.refundedMinor > (await ownRefundTotals(tx, row.id)).live
  )
    attention = 'external-refund';

  let schedule: {
    readonly reconcileDueAt: Date | null;
    readonly reconcileAttempts: number;
  } = {
    reconcileDueAt: null,
    reconcileAttempts: 0,
  };
  if (state === 'pending') {
    schedule = pendingSchedule(row, now);
    if (schedule.reconcileDueAt === null && attention === null) attention = 'unresolved';
  }

  const changed =
    facts.capturedMinor !== row.capturedMinor ||
    facts.refundedMinor !== row.refundedMinor ||
    facts.dispute !== row.dispute ||
    facts.closure !== row.closure ||
    state !== row.state ||
    paymentReference !== row.paymentReference ||
    attention !== row.attention;

  const claimed = await tx.donation.updateMany({
    where: { id: row.id, version: row.version },
    data: {
      state,
      capturedMinor: facts.capturedMinor,
      refundedMinor: facts.refundedMinor,
      dispute: facts.dispute,
      closure: facts.closure,
      paymentReference,
      succeededAt,
      attention,
      ...schedule,
      reconcileLeaseUntil: null,
      ...(changed ? { version: { increment: 1 }, updatedAt: now } : {}),
    },
  });
  if (claimed.count !== 1) throw new DonationsDataError('conflict');

  if (capturedNow && row.donorUserId !== null)
    await commitIntent(tx, {
      purpose: 'donation.succeeded',
      donationId: row.id,
      refundId: null,
      recipientUserId: row.donorUserId,
      dueAt: now,
    });
  return { row: await donationRow(tx, row.id), changed };
}

/** Whether a refund observation agrees with the refund and its donation. */
function refundMismatch(
  refund: RefundRow,
  donation: DonationRow,
  observation: {
    readonly scope: PaymentScope;
    readonly refundReference: string;
    readonly refundId: string | null;
    readonly paymentReference: string;
    readonly amount: { readonly currency: DonationCurrency; readonly minor: bigint };
  },
): DonationAttention | null {
  if (!sameScope(scopeOf(refund), observation.scope)) return 'provider-mismatch';
  if (observation.refundId !== null && observation.refundId !== refund.id)
    return 'provider-mismatch';
  if (
    donation.paymentReference === null ||
    observation.paymentReference !== donation.paymentReference
  )
    return 'provider-mismatch';
  if (
    refund.refundReference !== null &&
    observation.refundReference !== refund.refundReference
  )
    return 'provider-mismatch';
  if (
    observation.amount.currency !== refund.currency ||
    observation.amount.minor !== refund.amountMinor
  )
    return 'amount-mismatch';
  return null;
}

export function createDonationLedger(): DonationLedgerPort {
  const db = getDatabaseClient();

  return {
    /**
     * The donation (and refund) a verified event names, within its scope. A
     * refund reference names a refund; a checkout or payment reference names a
     * donation. The match is re-checked EXACTLY here, whatever the column
     * collation, so a reference differing only in case names nothing.
     */
    async locate({ scope, subject }) {
      const inScope = {
        provider: scope.provider,
        environment: scope.environment,
        accountKey: scope.accountKey,
      };
      try {
        if (subject.refundReference !== null) {
          const refund = await db.donationRefund.findFirst({
            where: { ...inScope, refundReference: subject.refundReference },
            select: { id: true, donationId: true, refundReference: true },
          });
          if (refund !== null && refund.refundReference === subject.refundReference)
            return { donationId: refund.donationId, refundId: refund.id };
        }
        if (subject.checkoutReference !== null) {
          const donation = await db.donation.findFirst({
            where: { ...inScope, checkoutReference: subject.checkoutReference },
            select: { id: true, checkoutReference: true },
          });
          if (
            donation !== null &&
            donation.checkoutReference === subject.checkoutReference
          )
            return { donationId: donation.id, refundId: null };
        }
        if (subject.paymentReference !== null) {
          const donation = await db.donation.findFirst({
            where: { ...inScope, paymentReference: subject.paymentReference },
            select: { id: true, paymentReference: true },
          });
          if (donation !== null && donation.paymentReference === subject.paymentReference)
            return { donationId: donation.id, refundId: null };
        }
        return null;
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Records the event (scope + id) before it is acted on. A new event and
     * one an earlier attempt admitted but never completed are `process`; a
     * completed one is `already-processed`. The unique key decides a race.
     */
    async admitEvent({ notice, receivedAt }) {
      const key = {
        provider: notice.scope.provider,
        environment: notice.scope.environment,
        accountKey: notice.scope.accountKey,
        eventId: notice.eventId,
      };
      try {
        await db.donationProviderEvent.create({
          data: {
            id: randomUUID(),
            ...key,
            eventType: notice.eventType.slice(0, EVENT_TYPE_MAX),
            occurredAt: notice.occurredAt,
            receivedAt,
            payloadDigest: notice.payloadDigest,
          },
          select: { id: true },
        });
        return 'process';
      } catch (error) {
        if (!isUniqueViolationOn(error, EVENT_KEY)) refuse(error);
      }
      try {
        const row = await db.donationProviderEvent.findFirst({
          where: key,
          select: { eventId: true, processedAt: true },
        });
        if (row === null || row.eventId !== notice.eventId)
          throw new DonationsDataError('conflict');
        return row.processedAt === null ? 'process' : 'already-processed';
      } catch (error) {
        refuse(error);
      }
    },

    /** Completed once: a second completion of the same event changes nothing. */
    async completeEvent({ scope, eventId, donationId, result, now }) {
      try {
        await db.donationProviderEvent.updateMany({
          where: {
            provider: scope.provider,
            environment: scope.environment,
            accountKey: scope.accountKey,
            eventId,
            processedAt: null,
          },
          data: { result, processedAt: now, donationId },
        });
      } catch (error) {
        refuse(error);
      }
    },

    async donation(id) {
      try {
        const row = await db.donation.findFirst({
          where: { id },
          select: DONATION_SELECT,
        });
        return row === null ? null : toDonationRecord(row);
      } catch (error) {
        refuse(error);
      }
    },

    async applyObservation({ donationId, observation, source, actorId, now }) {
      try {
        return await db.$transaction(async (tx) => {
          const row = await lockDonation(tx, donationId);
          if (row === null) throw new DonationsDataError('not-found');
          const truth = mergeProviderTruth(
            {
              donationId: row.id,
              scope: scopeOf(row),
              checkoutReference: row.checkoutReference,
              expected: {
                currency: row.currency as DonationCurrency,
                minor: row.expectedMinor,
              },
              facts: factsOf(row),
            },
            observation,
          );
          // A payment reference is set once: a different one for the same
          // checkout is the provider disagreeing with itself.
          const outcome =
            truth.verdict === 'attention'
              ? await flagAttention(tx, row, truth.attention, now)
              : row.paymentReference !== null &&
                  truth.paymentReference !== null &&
                  truth.paymentReference !== row.paymentReference
                ? await flagAttention(tx, row, 'provider-mismatch', now)
                : await applyTruth(tx, row, truth, now);

          if (source === 'operator')
            await tx.auditLog.create({
              data: auditRow({
                actorType: 'user',
                actorId,
                action: 'donations.observation.applied',
                targetType: 'donation',
                targetId: row.id,
                before: { state: row.state, version: String(row.version) },
                after: {
                  state: outcome.row.state,
                  version: String(outcome.row.version),
                  environment: outcome.row.environment,
                  changed: String(outcome.changed),
                  ...(outcome.row.attention === null
                    ? {}
                    : { attention: outcome.row.attention }),
                },
                authorisingSource: 'donations.administer',
              }),
            });
          return { donation: toDonationRecord(outcome.row), changed: outcome.changed };
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * The refund moves forward only. `failed` releases its reservation;
     * `succeeded` raises the donation's refunded total to at least what this
     * platform's own succeeded refunds amount to — never above captured, and
     * never by adding to a total the payment's own observation may already
     * include (the service re-observes the payment after a settlement, which
     * is how a refund made elsewhere is counted) — and owes the linked donor
     * an acknowledgement. Audited as the system's completion.
     */
    async applyRefundObservation({ refundId, observation, now }) {
      try {
        return await db.$transaction(async (tx) => {
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

          const mismatch = refundMismatch(refund, donation, observation);
          if (mismatch !== null) {
            const flagged = await flagAttention(tx, donation, mismatch, now);
            return {
              refund: toRefundRecord(refund),
              donation: toDonationRecord(flagged.row),
              changed: false,
            };
          }

          const current = refund.state as DonationRefundState;
          const target = observation.state;
          const moves =
            target !== current &&
            (DONATION_REFUND_TRANSITIONS[current] as readonly string[]).includes(target);
          const referenceNew = refund.refundReference === null;
          const finalState = moves ? target : current;
          const final = finalState === 'succeeded' || finalState === 'failed';

          // A provider answer that CONTRADICTS a refund already final here — a
          // settled refund reported failed, or a failed one reported settled — is
          // never applied backwards: the facts stay, and a person is told. A
          // stale `pending` read that lost a race is merely old news.
          if (
            (current === 'succeeded' && target === 'failed') ||
            (current === 'failed' && target === 'succeeded')
          ) {
            const flagged = await flagAttention(tx, donation, 'provider-mismatch', now);
            return {
              refund: toRefundRecord(refund),
              donation: toDonationRecord(flagged.row),
              changed: false,
            };
          }

          if (!moves && !referenceNew) {
            // Nothing new: an unsettled refund is simply re-read later.
            if (!final)
              await tx.donationRefund.updateMany({
                where: { id: refundId, version: refund.version },
                data: {
                  reconcileDueAt: later(now, REFUND_PENDING_CHECK_MS),
                  reconcileAttempts: 0,
                  reconcileLeaseUntil: null,
                },
              });
            return {
              refund: toRefundRecord(await refundRow(tx, refundId)),
              donation: toDonationRecord(donation),
              changed: false,
            };
          }

          const claimed = await tx.donationRefund.updateMany({
            where: { id: refundId, version: refund.version },
            data: {
              state: finalState,
              refundReference: refund.refundReference ?? observation.refundReference,
              ...(moves && final ? { completedAt: now } : {}),
              reconcileDueAt: final ? null : later(now, REFUND_PENDING_CHECK_MS),
              reconcileAttempts: 0,
              reconcileLeaseUntil: null,
              version: { increment: 1 },
            },
          });
          if (claimed.count !== 1) throw new DonationsDataError('conflict');

          if (moves && target === 'failed') {
            const released = await tx.donation.updateMany({
              where: { id: donation.id, version: donation.version },
              data: {
                refundReservedMinor: donation.refundReservedMinor - refund.amountMinor,
                version: { increment: 1 },
                updatedAt: now,
              },
            });
            if (released.count !== 1) throw new DonationsDataError('conflict');
          }

          if (moves && target === 'succeeded' && donation.capturedMinor !== null) {
            const captured = donation.capturedMinor;
            const own = await ownRefundTotals(tx, donation.id);
            let refunded =
              own.succeeded > donation.refundedMinor
                ? own.succeeded
                : donation.refundedMinor;
            if (refunded > captured) refunded = captured;
            if (refunded !== donation.refundedMinor) {
              const facts = { ...factsOf(donation), refundedMinor: refunded };
              const raised = await tx.donation.updateMany({
                where: { id: donation.id, version: donation.version },
                data: {
                  refundedMinor: refunded,
                  state: deriveDonationState(facts),
                  version: { increment: 1 },
                  updatedAt: now,
                },
              });
              if (raised.count !== 1) throw new DonationsDataError('conflict');
            }
            if (donation.donorUserId !== null)
              await commitIntent(tx, {
                purpose:
                  refunded >= captured
                    ? 'donation.refunded'
                    : 'donation.partially-refunded',
                donationId: donation.id,
                refundId,
                recipientUserId: donation.donorUserId,
                dueAt: now,
              });
          }

          const settled = await refundRow(tx, refundId);
          if (moves && final)
            await tx.auditLog.create({
              data: auditRow({
                actorType: 'system',
                actorId: null,
                action:
                  target === 'succeeded'
                    ? 'donations.refund.completed'
                    : 'donations.refund.failed',
                targetType: 'donation-refund',
                targetId: refundId,
                before: { state: refund.state, version: String(refund.version) },
                after: {
                  state: settled.state,
                  version: String(settled.version),
                  donationId: donation.id,
                  currency: settled.currency,
                  amountMinor: settled.amountMinor.toString(),
                  environment: settled.environment,
                  reference: tail(settled.refundReference),
                },
                authorisingSource: 'provider',
              }),
            });
          return {
            refund: toRefundRecord(settled),
            donation: toDonationRecord(await donationRow(tx, donation.id)),
            changed: true,
          };
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * THE LEASE, in one statement at an isolation level it STATES: the oldest
     * due donations not under a live lease, leased and returned in one atomic
     * step. `READPAST` skips rows another sweeper holds; a crashed sweeper's
     * lease expires and the row is due again. A lease is scheduling, not a
     * fact: the version does not move. `OUTPUT … INTO`, because the table
     * carries triggers.
     */
    async claimDueDonations(now, limit, leaseSeconds) {
      const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
      try {
        return await db.$transaction(
          async (tx) => {
            const claimed = await tx.$queryRaw<{ id: string }[]>`
              DECLARE @claimed TABLE ([id] NVARCHAR(36));
              UPDATE d SET d.[reconcileLeaseUntil] = ${leaseUntil}
              OUTPUT inserted.[id] INTO @claimed
              FROM [dbo].[Donation] AS d WITH (READPAST, UPDLOCK, ROWLOCK)
              WHERE d.[reconcileDueAt] <= ${now}
                AND (d.[reconcileLeaseUntil] IS NULL OR d.[reconcileLeaseUntil] < ${now})
                AND d.[id] IN (
                  SELECT TOP (${bounded(limit, CLAIM_MAX)}) x.[id]
                  FROM [dbo].[Donation] AS x WITH (READPAST, UPDLOCK, ROWLOCK)
                  WHERE x.[reconcileDueAt] <= ${now}
                    AND (x.[reconcileLeaseUntil] IS NULL OR x.[reconcileLeaseUntil] < ${now})
                  ORDER BY x.[reconcileDueAt] ASC, x.[id] ASC);
              SELECT [id] FROM @claimed;`;
            if (claimed.length === 0) return [];
            return claimed.map((row) => ({ donationId: row.id }));
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
        );
      } catch (error) {
        refuse(error);
      }
    },

    /** As above, for refunds whose provider outcome is not yet final. */
    async claimDueRefunds(now, limit, leaseSeconds) {
      const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
      try {
        // Leased under the refund ledger lock, touching no donation row: a
        // donation writer may hold that row while its trigger sums refunds, so
        // reading it here, after leasing refund rows, could close a cycle. The
        // payment reference is read after the lease commits — it is set once,
        // before any refund can exist.
        const rows = await db.$transaction(
          async (tx) => {
            await lockRefundLedger(tx);
            const claimed = await tx.$queryRaw<{ id: string }[]>`
              DECLARE @claimed TABLE ([id] NVARCHAR(36));
              UPDATE r SET r.[reconcileLeaseUntil] = ${leaseUntil}
              OUTPUT inserted.[id] INTO @claimed
              FROM [dbo].[DonationRefund] AS r WITH (READPAST, UPDLOCK, ROWLOCK)
              WHERE r.[state] IN (N'requested', N'pending')
                AND r.[reconcileDueAt] <= ${now}
                AND (r.[reconcileLeaseUntil] IS NULL OR r.[reconcileLeaseUntil] < ${now})
                AND r.[id] IN (
                  SELECT TOP (${bounded(limit, CLAIM_MAX)}) x.[id]
                  FROM [dbo].[DonationRefund] AS x WITH (READPAST, UPDLOCK, ROWLOCK)
                  WHERE x.[state] IN (N'requested', N'pending')
                    AND x.[reconcileDueAt] <= ${now}
                    AND (x.[reconcileLeaseUntil] IS NULL OR x.[reconcileLeaseUntil] < ${now})
                  ORDER BY x.[reconcileDueAt] ASC, x.[id] ASC);
              SELECT [id] FROM @claimed;`;
            if (claimed.length === 0) return [];
            return tx.donationRefund.findMany({
              where: { id: { in: claimed.map((row) => row.id) } },
              select: { ...REFUND_SELECT, reconcileDueAt: true },
              orderBy: [{ reconcileDueAt: 'asc' }, { id: 'asc' }],
            });
          },
          {
            ...LOCKED_TRANSACTION,
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
          },
        );
        if (rows.length === 0) return [];
        const payments = new Map(
          (
            await db.donation.findMany({
              where: { id: { in: [...new Set(rows.map((row) => row.donationId))] } },
              select: { id: true, paymentReference: true },
            })
          ).map((row) => [row.id, row.paymentReference]),
        );
        const claims = [];
        for (const row of rows) {
          const paymentReference = payments.get(row.donationId) ?? null;
          if (paymentReference === null) continue;
          claims.push({
            refundId: row.id,
            donationId: row.donationId,
            refundReference: row.refundReference,
            paymentReference,
            amount: {
              currency: row.currency as DonationCurrency,
              minor: row.amountMinor,
            },
            requestedAt: row.requestedAt,
          });
        }
        return claims;
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * The provider could not answer about a donation: the next bounded wait,
     * or — once all are spent — no due instant and `attention: unresolved`.
     */
    async deferDonation({ donationId, now }) {
      try {
        await db.$transaction(async (tx) => {
          const row = await lockDonation(tx, donationId);
          if (row === null) throw new DonationsDataError('not-found');
          const next = backoff(now, row.reconcileAttempts);
          const flag = next.dueAt === null && row.attention === null;
          const claimed = await tx.donation.updateMany({
            where: { id: donationId, version: row.version },
            data: {
              reconcileDueAt: next.dueAt,
              reconcileAttempts: next.attempts,
              reconcileLeaseUntil: null,
              ...(flag
                ? { attention: 'unresolved', version: { increment: 1 }, updatedAt: now }
                : {}),
            },
          });
          if (claimed.count !== 1) throw new DonationsDataError('conflict');
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * The provider could not answer about a refund: the refund's next bounded
     * wait, or — once all are spent — no due instant, and its donation flagged
     * `unresolved` for a person (a refund carries no flag of its own).
     */
    async deferRefund({ refundId, now }) {
      try {
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
          if (refund.state === 'succeeded' || refund.state === 'failed') return;
          const next = backoff(now, refund.reconcileAttempts);
          const claimed = await tx.donationRefund.updateMany({
            where: { id: refundId, version: refund.version },
            data: {
              reconcileDueAt: next.dueAt,
              reconcileAttempts: next.attempts,
              reconcileLeaseUntil: null,
            },
          });
          if (claimed.count !== 1) throw new DonationsDataError('conflict');
          if (next.dueAt === null && donation.attention === null) {
            const flagged = await tx.donation.updateMany({
              where: { id: donation.id, version: donation.version },
              data: {
                attention: 'unresolved',
                version: { increment: 1 },
                updatedAt: now,
              },
            });
            if (flagged.count !== 1) throw new DonationsDataError('conflict');
          }
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },
  };
}
