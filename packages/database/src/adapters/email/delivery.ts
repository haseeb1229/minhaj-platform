import 'server-only';

import type {
  DeliveryFailureClass,
  DeliveryOperatorRecord,
  DeliveryPurpose,
  DeliveryRecord,
  DeliveryStatus,
  DeliverySummary,
  EmailDeliveryStorePort,
  EmailSuppressionPort,
  EnqueueDelivery,
  ProviderEventAdmission,
  ProviderEventPort,
  SuppressionReason,
  SuppressionScope,
} from '@minhaj/contracts/platform';
import { Prisma } from '@prisma/client';

import { getDatabaseClient } from '../../client.ts';
import { recipientDigest, type DigestConfiguration } from './digest.ts';

/**
 * Durable delivery state for the Layer-0 `email` concern.
 *
 * WHY DURABLE AT ALL. A verification email that is lost because the process
 * died between committing the account and calling the provider leaves someone
 * unable to use an account they just created, and nothing in the system knows.
 * The intent is therefore committed as a row, and sending is derived work
 * dispatched afterwards — never described or tested as atomic with the
 * authoritative transaction (ARCHITECTURE.md §8.5, §4.6.1).
 *
 * WHAT IS NOT HERE. No queue product, no worker platform, no event bus, no
 * Redis. Durable rows plus bounded scheduled dispatch is the whole mechanism.
 */

/** Retry schedule, in seconds. The length of this array IS the retry budget. */
const BACKOFF_SECONDS = [60, 300, 1_500, 7_200, 36_000];

export interface DeliveryStoreConfiguration {
  readonly digest: DigestConfiguration;
}

function toRecord(row: {
  id: string;
  purpose: string;
  sourceReference: string;
  idempotencyKey: string;
  status: string;
  attemptCount: number;
}): DeliveryRecord {
  return {
    id: row.id,
    purpose: row.purpose as DeliveryPurpose,
    sourceReference: row.sourceReference,
    idempotencyKey: row.idempotencyKey,
    status: row.status as DeliveryStatus,
    attemptCount: row.attemptCount,
  };
}

/**
 * Adds jitter to a backoff delay.
 *
 * Without it, a provider outage that fails a hundred deliveries at once
 * retries all hundred at the same instant, repeatedly — the outage's own
 * thundering herd.
 */
function withJitter(seconds: number): number {
  return Math.round(seconds * (0.8 + Math.random() * 0.4));
}

export function createEmailDeliveryStore(
  configuration: DeliveryStoreConfiguration,
): EmailDeliveryStorePort {
  const prisma = getDatabaseClient();

  return {
    async enqueue(delivery: EnqueueDelivery): Promise<DeliveryRecord> {
      const digest = recipientDigest(delivery.recipient, configuration.digest);

      // Idempotent on the key. A relay that retried after committing — or two
      // dispatchers racing on the same intent — yields ONE row, which is what
      // stops a duplicate message rather than a comment saying it will not
      // happen.
      const existing = await prisma.emailDelivery.findUnique({
        where: { idempotencyKey: delivery.idempotencyKey },
      });
      if (existing !== null) return toRecord(existing);

      try {
        const created = await prisma.emailDelivery.create({
          data: {
            purpose: delivery.purpose,
            recipientDigest: digest,
            digestKeyVersion: configuration.digest.keyVersion,
            sourceReference: delivery.sourceReference,
            idempotencyKey: delivery.idempotencyKey,
            status: 'pending',
            attemptCount: 0,
            nextAttemptAt: new Date(),
          },
        });
        return toRecord(created);
      } catch (error) {
        // Lost the insert race. The winner's row is the answer.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const winner = await prisma.emailDelivery.findUnique({
            where: { idempotencyKey: delivery.idempotencyKey },
          });
          if (winner !== null) return toRecord(winner);
        }
        throw error;
      }
    },

    async claimDue({ limit, leaseSeconds }): Promise<readonly DeliveryRecord[]> {
      const now = new Date();
      const leaseUntil = new Date(now.getTime() + leaseSeconds * 1000);
      const bounded = Math.max(1, Math.min(limit, 100));

      // THE LEASE, in one statement, at an isolation level this operation
      // STATES rather than inherits.
      //
      // `UPDATE ... WITH (READPAST, UPDLOCK, ROWLOCK) ... OUTPUT` claims and
      // returns in a single atomic step, so two dispatchers cannot claim the
      // same row: the second skips locked rows rather than blocking on them.
      // A crashed dispatcher's claim simply expires and the row becomes due
      // again — which is what makes restart safe without any coordination
      // (ARCHITECTURE.md §3.5.1).
      //
      // WHY AN EXPLICIT TRANSACTION AROUND ONE STATEMENT.
      //
      // `READPAST` is legal ONLY under READ COMMITTED or REPEATABLE READ;
      // anywhere else SQL Server raises error 650 and refuses the statement
      // outright. And `SET TRANSACTION ISOLATION LEVEL` is scoped in T-SQL to
      // the SESSION, not to the transaction that set it — so a pooled
      // connection last used by an operation needing a stricter level (the
      // rate limiter's SERIALIZABLE window) hands that level to whoever picks
      // the connection up next. Claiming would then fail on a connection's
      // HISTORY rather than on anything about the claim: intermittently, in
      // proportion to load, and reported as a driver error that names none of
      // this.
      //
      // Declaring the level here removes the dependency rather than
      // compensating for it. This claim runs at READ COMMITTED because it says
      // so, whatever the connection was doing beforehand — the general rule
      // that defect teaches being that an operation whose correctness depends
      // on an isolation level must establish that level itself.
      //
      // Nothing about the claim's semantics changes: one statement, the same
      // lock hints, and the lease still what makes two dispatchers disjoint.
      const claimed = await prisma.$transaction(
        async (tx) =>
          tx.$queryRaw<
            {
              id: string;
              purpose: string;
              sourceReference: string;
              idempotencyKey: string;
              status: string;
              attemptCount: number;
            }[]
          >`
            UPDATE TOP (${bounded}) d
            SET d.[status] = 'sending',
                d.[claimedUntil] = ${leaseUntil}
            OUTPUT inserted.[id], inserted.[purpose], inserted.[sourceReference],
                   inserted.[idempotencyKey], inserted.[status], inserted.[attemptCount]
            FROM [dbo].[EmailDelivery] AS d WITH (READPAST, UPDLOCK, ROWLOCK)
            WHERE d.[status] IN ('pending', 'sending')
              AND (d.[nextAttemptAt] IS NULL OR d.[nextAttemptAt] <= ${now})
              AND (d.[claimedUntil] IS NULL OR d.[claimedUntil] <= ${now});
          `,
        { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
      );

      return claimed.map(toRecord);
    },

    async markSent({ id, providerMessageId }): Promise<void> {
      await prisma.emailDelivery.update({
        where: { id },
        data: {
          status: 'sent',
          sentAt: new Date(),
          providerMessageId,
          claimedUntil: null,
          nextAttemptAt: null,
          failureClass: null,
          failureCode: null,
        },
      });
    },

    async markAttemptFailed({
      id,
      failureClass,
      failureCode,
      retryAfterSeconds,
    }): Promise<void> {
      const current = await prisma.emailDelivery.findUnique({ where: { id } });
      if (current === null) return;

      const attemptCount = current.attemptCount + 1;

      // A permanent rejection is never retried — retrying a rejected address
      // just spends the budget and keeps writing to a mailbox that said no.
      const exhausted = attemptCount >= BACKOFF_SECONDS.length;
      const giveUp = failureClass === 'permanent' || exhausted;

      const step =
        BACKOFF_SECONDS[Math.min(attemptCount, BACKOFF_SECONDS.length - 1)] ??
        BACKOFF_SECONDS[0] ??
        60;
      const delay = retryAfterSeconds ?? withJitter(step);

      await prisma.emailDelivery.update({
        where: { id },
        data: {
          status: giveUp ? 'failed' : 'pending',
          attemptCount,
          // Failure detail is a CLASS and a CODE. A provider message body can
          // echo the recipient or the content it rejected, and this value
          // reaches an operator surface (SECURITY_BASELINE.md §19.2).
          failureClass,
          failureCode,
          claimedUntil: null,
          nextAttemptAt: giveUp ? null : new Date(Date.now() + delay * 1000),
        },
      });
    },

    async markSuppressed(id: string): Promise<void> {
      await prisma.emailDelivery.update({
        where: { id },
        data: {
          status: 'suppressed',
          claimedUntil: null,
          nextAttemptAt: null,
          failureClass: 'permanent',
          failureCode: 'suppressed',
        },
      });
    },

    async markAbandoned({ id, reason }): Promise<void> {
      // The owner has nothing to send any more — the account closed, the
      // address changed, the token expired. That is a normal outcome, and
      // retrying it would only produce the same answer more slowly.
      await prisma.emailDelivery.update({
        where: { id },
        data: {
          status: 'failed',
          claimedUntil: null,
          nextAttemptAt: null,
          failureClass: 'permanent',
          failureCode: reason,
        },
      });
    },

    async findByIdempotencyKey(key: string): Promise<DeliveryRecord | null> {
      const row = await prisma.emailDelivery.findUnique({
        where: { idempotencyKey: key },
      });
      return row === null ? null : toRecord(row);
    },

    async summarise(): Promise<DeliverySummary> {
      const [pending, failed, suppressed] = await Promise.all([
        prisma.emailDelivery.count({ where: { status: { in: ['pending', 'sending'] } } }),
        prisma.emailDelivery.count({ where: { status: 'failed' } }),
        prisma.emailDelivery.count({ where: { status: 'suppressed' } }),
      ]);

      return { pending, failed, suppressed };
    },

    async listForOperator({ status, limit, offset }) {
      const take = Math.min(Math.max(Math.trunc(limit), 1), 100);
      const skip = Math.max(Math.trunc(offset), 0);

      const rows = await prisma.emailDelivery.findMany({
        where: status === null ? {} : { status },
        select: {
          id: true,
          purpose: true,
          status: true,
          attemptCount: true,
          nextAttemptAt: true,
          failureClass: true,
          failureCode: true,
          createdAt: true,
          sentAt: true,
          // `recipientDigest` is NOT selected. It is not an address, but it is
          // a stable per-person handle, and putting one on an operator screen
          // is how a list of people who bounced becomes a thing that exists.
        },
        // DETERMINISTIC, and indexed: `(status, nextAttemptAt)` already exists
        // for the dispatcher, and `createdAt` breaks ties with the id.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take: take + 1,
      });

      return {
        items: rows.slice(0, take).map((row): DeliveryOperatorRecord => ({
          id: row.id,
          purpose: row.purpose as DeliveryPurpose,
          status: row.status as DeliveryStatus,
          attemptCount: row.attemptCount,
          nextAttemptAt: row.nextAttemptAt,
          failureClass: row.failureClass as DeliveryFailureClass | null,
          failureCode: row.failureCode,
          createdAt: row.createdAt,
          sentAt: row.sentAt,
        })),
        more: rows.length > take,
      };
    },

    async rescheduleDelivery(id: string): Promise<boolean> {
      // Conditional on the status, so the operation cannot resurrect a message
      // that was SENT, and cannot overrule a SUPPRESSION — which is the
      // provider telling this platform not to write to that address again.
      const updated = await prisma.emailDelivery.updateMany({
        where: { id, status: { in: ['failed', 'pending', 'sending'] } },
        data: {
          status: 'pending',
          nextAttemptAt: new Date(),
          // The lease is released so the next dispatcher tick can claim it
          // rather than waiting out a lease held by a process that has gone.
          claimedUntil: null,
        },
      });

      return updated.count === 1;
    },
  };
}

/**
 * Provider-safety suppression — the READ side.
 *
 * Separate from any future marketing preference by construction: the scope is
 * part of the row, so a marketing unsubscribe can never suppress verification,
 * password reset or account-security mail (ARCHITECTURE.md §4.6.1).
 *
 * WRITING happens in `createProviderEventStore().complete`, atomically with
 * the provider event that caused it, and nowhere else. A standalone write here
 * would be a second path into security-relevant state without that atomicity
 * — and, since the webhook became the only caller, without any caller at all.
 */
export function createEmailSuppression(
  configuration: DeliveryStoreConfiguration,
): EmailSuppressionPort {
  const prisma = getDatabaseClient();

  return {
    async summarise() {
      const rows = await prisma.emailSuppression.groupBy({
        by: ['reason', 'scope'],
        _count: { _all: true },
      });

      return rows.map((row) => ({
        reason: row.reason as SuppressionReason,
        scope: row.scope as SuppressionScope,
        count: row._count._all,
      }));
    },

    async isSuppressed({ recipient, scope }): Promise<boolean> {
      const digest = recipientDigest(recipient, configuration.digest);
      const row = await prisma.emailSuppression.findUnique({
        where: { recipientDigest: digest },
      });

      if (row === null) return false;

      // A marketing suppression never suppresses transactional mail. The
      // reverse DOES hold: an address the provider hard-bounced should not be
      // written to at all.
      if (scope === 'transactional') return row.scope === 'transactional';
      return true;
    },
  };
}

/**
 * Provider event processing (protocol class B, SECURITY_BASELINE.md §7.2).
 *
 * "The same event delivered twice produces exactly one effect" is enforced by
 * a unique constraint, not by a check-then-act — two concurrent deliveries of
 * one event would both pass a check.
 *
 * WHAT THE UNIQUE CONSTRAINT DOES NOT SAY. It establishes that the event was
 * SEEN. It says nothing about whether what the event was for ever happened,
 * and the two were previously treated as the same fact: record the event,
 * apply the effect, mark it processed, as three separate steps in which only
 * the first was consulted on a replay. A process that died between the first
 * and the second left a row meaning "already handled" in front of work nobody
 * had done — and the provider's retry, the one mechanism that would have
 * repaired it, was the thing that got turned away.
 *
 * SO THERE ARE THREE STATES, and `processedAt` distinguishes them:
 *
 *   - NO ROW              — unseen; record it and do the work
 *   - row, `processedAt` NULL — accepted, NOT finished; do the work
 *   - row, `processedAt` set  — finished; do nothing
 *
 * An event this platform records but does not act on is finished the moment it
 * is admitted: its effect is nothing, and nothing succeeds atomically.
 *
 * NO LEASE, NO WORKER, NO QUEUE. Completion is atomic with the effect and the
 * effect is idempotent, so two deliveries racing produce one logical outcome
 * without any of them — the second either finds the work done or does it
 * again to the same end.
 */
export function createProviderEventStore(
  configuration: DeliveryStoreConfiguration,
): ProviderEventPort {
  const prisma = getDatabaseClient();

  return {
    async admit({ provider, eventId, type }): Promise<ProviderEventAdmission> {
      try {
        await prisma.providerEvent.create({ data: { provider, eventId, type } });
        return 'process';
      } catch (error) {
        if (!(
          error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
        )) {
          throw error;
        }

        // Seen before. Whether it was FINISHED before is the actual question.
        const existing = await prisma.providerEvent.findUnique({
          where: { provider_eventId: { provider, eventId } },
        });

        // Gone between the collision and the read. Nothing is recorded, so
        // nothing may be assumed done.
        if (existing === null) return 'process';

        return existing.processedAt === null ? 'process' : 'already-processed';
      }
    },

    async complete({ provider, eventId, effect }): Promise<void> {
      await prisma.$transaction(async (tx) => {
        if (effect !== null) {
          const digest = recipientDigest(effect.recipient, configuration.digest);

          // CONDITIONAL INSERT rather than an upsert or a caught collision.
          //
          // The runtime principal holds INSERT on this table and is DENIED
          // UPDATE, deliberately — a suppression is a fact that was reported,
          // not a value to revise — so there is no upsert to perform. And a
          // constraint violation caught INSIDE an interactive transaction is a
          // poor way to ask a question the statement can answer itself.
          //
          // `UPDLOCK, HOLDLOCK` makes the existence check and the insert one
          // step against a concurrent duplicate, the same statement-scoped
          // strictness the rate limiter uses, for the same reason.
          await tx.$executeRaw`
            INSERT INTO [dbo].[EmailSuppression]
              ([recipientDigest], [digestKeyVersion], [reason], [scope])
            SELECT ${digest}, ${configuration.digest.keyVersion},
                   ${effect.reason satisfies SuppressionReason},
                   ${effect.scope satisfies SuppressionScope}
            WHERE NOT EXISTS (
              SELECT 1 FROM [dbo].[EmailSuppression] WITH (UPDLOCK, HOLDLOCK)
              WHERE [recipientDigest] = ${digest}
            );
          `;
        }

        // IN THE SAME TRANSACTION as the effect above. A completion recorded
        // separately is a completion that can outlive a rolled-back effect,
        // which is the defect this whole shape exists to remove.
        await tx.providerEvent.update({
          where: { provider_eventId: { provider, eventId } },
          data: { processedAt: new Date() },
        });
      });
    },
  };
}

export type { DeliveryFailureClass };
