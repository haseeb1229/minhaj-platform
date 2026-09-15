import 'server-only';

import type {
  AccountIdentity,
  AccountStatus,
  CommunicationIntentInput,
  IdentityNotificationPurpose,
  IdentityPersistencePort,
  IdentitySecurityOperationKind,
  PendingIntent,
  PreparedIdentitySecurityOperation,
} from '@minhaj/contracts/identity';
import type { Prisma } from '@prisma/client';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import { toAccountIdentity, type AuthUserRow } from './projection.ts';

/**
 * Identity's OWN persistence — the state Better Auth neither owns nor knows
 * about, plus the transactional closure the account lifecycle depends on.
 *
 * Semantic owner: `identity-access`. Physically here because it needs the
 * private Prisma client; owned by the context, which is the only place its
 * rules may change (ARCHITECTURE.md §4.1, §6.3 rule 14).
 *
 * IT DECIDES NOTHING. Whether an account may be closed, what status a request
 * should produce, whether a notification is warranted — all Identity's. This
 * module performs the writes those decisions imply.
 */

/**
 * The reserved domain for a closed account's address.
 *
 * `.invalid` is reserved by RFC 2606 precisely so it can never resolve, so a
 * tombstone can never be written to by accident — including by an operator
 * pasting it into a mail client.
 */
const TOMBSTONE_DOMAIN = 'closed.invalid';

/**
 * The address a closed account keeps.
 *
 * Deterministic from the account id, so closing twice is idempotent and the
 * value is reproducible during an investigation. It contains NO part of the
 * original address — the point of closure is that the original becomes
 * available again and unlinkable to the closed row (DOMAIN_MODEL.md §4.6).
 */
export function tombstoneEmail(accountId: string): string {
  return `closed-${accountId}@${TOMBSTONE_DOMAIN}`;
}

/** What a pseudonymised account displays as. Carries no personal data. */
const PSEUDONYM = 'Closed account';

const ABANDONED_OPERATION_AFTER_MS = 15 * 60 * 1000;

interface LockedSecurityOperation {
  readonly id: string;
  readonly kind: IdentitySecurityOperationKind;
  readonly userId: string;
  readonly initiatingSessionId: string | null;
  readonly replacementSessionId: string | null;
  readonly committedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly completedAt: Date | null;
}

function securityFollowUp(kind: IdentitySecurityOperationKind): {
  readonly purpose: IdentityNotificationPurpose;
  readonly action: string;
  readonly before?: Readonly<Record<string, string>>;
  readonly after?: Readonly<Record<string, string>>;
} {
  if (kind === 'password-reset') {
    return { purpose: 'identity.password-changed', action: 'identity.password.reset' };
  }
  if (kind === 'password-change') {
    return { purpose: 'identity.password-changed', action: 'identity.password.changed' };
  }
  return {
    purpose: 'identity.email-changed',
    action: 'identity.email.changed',
    before: { emailChanged: 'true' },
    after: { emailVerified: 'true' },
  };
}

async function lockSecurityOperation(
  tx: Prisma.TransactionClient,
  operationId: string,
): Promise<LockedSecurityOperation | null> {
  const rows = await tx.$queryRaw<LockedSecurityOperation[]>`
    SELECT [id], [kind], [userId], [initiatingSessionId],
           [replacementSessionId], [committedAt], [cancelledAt], [completedAt]
    FROM [dbo].[IdentitySecurityOperation] WITH (UPDLOCK, HOLDLOCK)
    WHERE [id] = ${operationId}
  `;
  return rows[0] ?? null;
}

async function finalizeSecurityOperation(
  tx: Prisma.TransactionClient,
  operationId: string,
): Promise<boolean> {
  const operation = await lockSecurityOperation(tx, operationId);
  if (operation === null || operation.committedAt === null) {
    return false;
  }
  if (operation.completedAt !== null) return true;

  const account = await tx.user.findUnique({ where: { id: operation.userId } });
  if (account === null) {
    throw new Error('Committed Identity security operation has no owning account.');
  }

  if (operation.kind === 'password-reset') {
    await tx.session.deleteMany({
      where: { userId: operation.userId, createdAt: { lte: operation.committedAt } },
    });
    await tx.user.update({
      where: { id: operation.userId },
      data: { emailVerified: true, updatedAt: new Date() },
    });
  } else if (operation.kind === 'password-change') {
    await tx.session.deleteMany({
      where: {
        userId: operation.userId,
        createdAt: { lte: operation.committedAt },
        ...(operation.replacementSessionId === null
          ? {}
          : { id: { not: operation.replacementSessionId } }),
      },
    });
  } else {
    await tx.session.deleteMany({
      where: {
        userId: operation.userId,
        createdAt: { lte: operation.committedAt },
        ...(operation.initiatingSessionId === null
          ? {}
          : { id: { not: operation.initiatingSessionId } }),
      },
    });
  }

  const followUp = securityFollowUp(operation.kind);
  await tx.auditLog.create({
    data: auditRow({
      action: followUp.action,
      actorType: 'user',
      actorId: operation.userId,
      targetType: 'user',
      targetId: operation.userId,
      ...(followUp.before === undefined ? {} : { before: followUp.before }),
      ...(followUp.after === undefined ? {} : { after: followUp.after }),
    }),
  });

  const idempotencyKey = `${followUp.purpose}:${operation.userId}:operation:${operation.id}`;
  await tx.identityCommunicationIntent.upsert({
    where: { idempotencyKey },
    update: {},
    create: {
      purpose: followUp.purpose,
      userId: operation.userId,
      locale: account.locale,
      idempotencyKey,
      status: 'pending',
    },
  });

  await tx.identitySecurityOperation.update({
    where: { id: operation.id },
    data: { completedAt: new Date() },
  });
  return true;
}

export function createIdentityPersistence(): IdentityPersistencePort {
  const prisma = getDatabaseClient();

  return {
    async findAccountByEmail(email: string): Promise<AccountIdentity | null> {
      const row = await prisma.user.findUnique({ where: { email } });
      return row === null ? null : toAccountIdentity(row as AuthUserRow);
    },

    async findAccountById(id: string): Promise<AccountIdentity | null> {
      const row = await prisma.user.findUnique({ where: { id } });
      return row === null ? null : toAccountIdentity(row as AuthUserRow);
    },

    async updateAccountProfile({ accountId, name, locale, timezone }) {
      const updated = await prisma.user.update({
        where: { id: accountId },
        data: {
          ...(name === undefined ? {} : { name }),
          ...(locale === undefined ? {} : { locale }),
          ...(timezone === undefined ? {} : { timezone }),
          updatedAt: new Date(),
        },
      });

      return toAccountIdentity(updated as AuthUserRow);
    },

    async setAccountStatus({ accountId, status }): Promise<void> {
      await prisma.user.update({
        where: { id: accountId },
        data: { status: status satisfies AccountStatus, updatedAt: new Date() },
      });
    },

    async completeAccountSetup(accountId: string): Promise<AccountIdentity> {
      const updated = await prisma.user.update({
        where: { id: accountId },
        data: { accountSetupCompletedAt: new Date(), updatedAt: new Date() },
      });

      return toAccountIdentity(updated as AuthUserRow);
    },

    async countAuthenticationMethods(accountId: string): Promise<number> {
      return prisma.account.count({ where: { userId: accountId } });
    },

    async prepareSecurityOperation({
      kind,
      accountId,
      initiatingSessionId,
    }): Promise<PreparedIdentitySecurityOperation> {
      const operation = await prisma.identitySecurityOperation.create({
        data: {
          kind,
          userId: accountId,
          ...(initiatingSessionId === undefined ? {} : { initiatingSessionId }),
        },
        select: { id: true, userId: true },
      });
      return { id: operation.id, accountId: operation.userId };
    },

    async cancelSecurityOperation(operationId: string): Promise<void> {
      // Conditional cancellation is a fence. If the vendor transaction stamped
      // the row first, this matches nothing and reconciliation must finish it.
      // If cancellation wins, the private vendor client refuses the later write.
      await prisma.identitySecurityOperation.updateMany({
        where: {
          id: operationId,
          committedAt: null,
          cancelledAt: null,
          completedAt: null,
        },
        data: { cancelledAt: new Date() },
      });
    },

    async reconcileSecurityOperation(operationId: string): Promise<boolean> {
      return prisma.$transaction((tx) => finalizeSecurityOperation(tx, operationId));
    },

    async reconcileSecurityOperations(limit: number): Promise<number> {
      const bounded = Math.max(1, Math.min(limit, 100));

      // A request still alive after this bound loses the race deliberately:
      // cancellation and the vendor stamp contend on the same row, and the
      // loser observes the winner. No stale process can mutate after its marker
      // was abandoned.
      await prisma.identitySecurityOperation.updateMany({
        where: {
          committedAt: null,
          cancelledAt: null,
          completedAt: null,
          createdAt: { lte: new Date(Date.now() - ABANDONED_OPERATION_AFTER_MS) },
        },
        data: { cancelledAt: new Date() },
      });

      const pending = await prisma.identitySecurityOperation.findMany({
        where: { committedAt: { not: null }, completedAt: null },
        orderBy: { createdAt: 'asc' },
        take: bounded,
        select: { id: true },
      });

      let completed = 0;
      for (const operation of pending) {
        if (
          await prisma.$transaction((tx) => finalizeSecurityOperation(tx, operation.id))
        ) {
          completed += 1;
        }
      }
      return completed;
    },

    async closeAccount({ accountId, intent, audit }): Promise<void> {
      // ONE transaction, owned entirely by Identity.
      //
      // Everything below either happens or none of it does. A half-closed
      // account — credentials gone but the address still held, or sessions
      // revoked but the status unchanged — is the state that produces "I
      // can't sign in and I can't re-register either".
      //
      // The notification intent is committed HERE, alongside the change it
      // describes, because a closure the person is never told about is a
      // closure they cannot question. Layer 4 relays it AFTER commit; there is
      // no cross-owner transaction anywhere in this (ARCHITECTURE.md §3.1.2.1).
      await prisma.$transaction(async (tx) => {
        const closedAt = new Date();

        // Lock this account's complete operation-key range before touching the
        // User. A concurrent vendor stamp either commits first and is finalized
        // below, or waits and then observes its marker cancelled. HOLDLOCK also
        // prevents a new operation marker appearing halfway through closure.
        const operations = await tx.$queryRaw<{ id: string }[]>`
          SELECT [id]
          FROM [dbo].[IdentitySecurityOperation] WITH (UPDLOCK, HOLDLOCK)
          WHERE [userId] = ${accountId} AND [completedAt] IS NULL
          ORDER BY [createdAt]
        `;

        await tx.identitySecurityOperation.updateMany({
          where: {
            userId: accountId,
            committedAt: null,
            cancelledAt: null,
            completedAt: null,
          },
          data: { cancelledAt: closedAt },
        });

        for (const operation of operations) {
          await finalizeSecurityOperation(tx, operation.id);
        }

        const account = await tx.user.findUnique({ where: { id: accountId } });
        if (account === null || account.status === 'closed') {
          throw new Error('Account is not available for closure.');
        }

        // Any earlier unrelayed security notice now needs the same bounded
        // destination capture as the closure notice: the User address is about
        // to become a tombstone. Relay clears every override after enqueue.
        await tx.identityCommunicationIntent.updateMany({
          where: { userId: accountId, status: 'pending' },
          data: { recipientOverride: account.email },
        });

        // The former address travels WITH the intent, because the update
        // below is about to remove the only other copy of it. A closure notice
        // has exactly one correct destination and it is the address that is
        // being released; resolving the recipient at relay time — which every
        // other notification does, so that it follows an address change — would
        // resolve to the tombstone.
        //
        // It is carried here rather than left on the closed `User`, and it is
        // discarded when the intent is relayed, so the window in which the
        // platform still holds the address is the gap between this commit and
        // the next dispatch tick (DOMAIN_MODEL.md §4.6).
        await tx.identityCommunicationIntent.create({
          data: {
            purpose: intent.purpose,
            userId: intent.accountId,
            locale: intent.locale,
            idempotencyKey: intent.idempotencyKey,
            recipientOverride: intent.recipientOverride ?? null,
            status: 'pending',
          },
        });

        // Mandatory user-management evidence belongs in this same private
        // Identity transaction. AuditLog remains FK-free and append-only.
        await tx.auditLog.create({ data: auditRow(audit) });

        // Sessions first: while any of these live, the account is still usable.
        await tx.session.deleteMany({ where: { userId: accountId } });

        // Credentials and provider links. The row stays; the ability to
        // authenticate as it does not.
        await tx.account.deleteMany({ where: { userId: accountId } });

        // Outstanding verification and reset tokens for the OLD address.
        // Leaving one live would let a token minted before closure verify or
        // reset an address that is about to become available to someone else.
        await tx.verification.deleteMany({
          where: {
            OR: [
              { identifier: `email-verification-otp-${account.email}` },
              { identifier: `forget-password-otp-${account.email}` },
              {
                identifier: {
                  startsWith: `change-email-otp-${account.email}-`,
                },
              },
            ],
          },
        });

        // The row is RETAINED for historical attribution, pseudonymised, and
        // its address replaced by a deterministic non-routable tombstone — so
        // the original address becomes available again and a later signup
        // with it is a genuinely new account (DOMAIN_MODEL.md §4.6).
        await tx.user.update({
          where: { id: accountId },
          data: {
            status: 'closed' satisfies AccountStatus,
            closedAt,
            pseudonymisedAt: closedAt,
            email: tombstoneEmail(accountId),
            emailVerified: false,
            name: PSEUDONYM,
            image: null,
            timezone: null,
            updatedAt: closedAt,
          },
        });
      });
    },

    async commitCommunicationIntent(intent: CommunicationIntentInput): Promise<void> {
      // Idempotent on the key: a caller that retried after committing must not
      // produce a second message.
      await prisma.identityCommunicationIntent.upsert({
        where: { idempotencyKey: intent.idempotencyKey },
        update: {},
        create: {
          purpose: intent.purpose,
          userId: intent.accountId,
          locale: intent.locale,
          idempotencyKey: intent.idempotencyKey,
          status: 'pending',
        },
      });
    },

    async recordSecurityFollowUp({ audit, intent }): Promise<void> {
      // ONE transaction. The audit record and the notification are the two
      // halves of a security change's follow-up, and a crash between them
      // leaves either a change nobody was told about or a message no
      // investigation can corroborate.
      //
      // AuditLog stays what it is: append-only, FK-free, scalar identifiers.
      // Writing it here gives it the Identity transaction's durability without
      // giving it a relationship to anything (ARCHITECTURE.md §3.1.2.1).
      await prisma.$transaction(async (tx) => {
        await tx.auditLog.create({ data: auditRow(audit) });

        // Idempotent on the key, exactly as the standalone commit is: a caller
        // that retried after committing must not produce a second message.
        await tx.identityCommunicationIntent.upsert({
          where: { idempotencyKey: intent.idempotencyKey },
          update: {},
          create: {
            purpose: intent.purpose,
            userId: intent.accountId,
            locale: intent.locale,
            idempotencyKey: intent.idempotencyKey,
            recipientOverride: intent.recipientOverride ?? null,
            status: 'pending',
          },
        });
      });
    },

    async claimPendingIntents(limit: number): Promise<readonly PendingIntent[]> {
      const bounded = Math.max(1, Math.min(limit, 100));

      const rows = await prisma.identityCommunicationIntent.findMany({
        where: { status: 'pending' },
        orderBy: { createdAt: 'asc' },
        take: bounded,
        include: { user: { select: { email: true } } },
      });

      return rows.map((row) => ({
        id: row.id,
        purpose: row.purpose as PendingIntent['purpose'],
        accountId: row.userId,
        locale: row.locale,
        idempotencyKey: row.idempotencyKey,
        // The captured address WINS where closure recorded one, because the
        // account's own address is a tombstone by now. Everywhere else the
        // account is the answer, so a notification follows an address change.
        email: row.recipientOverride ?? row.user.email,
        ...(row.recipientOverride === null
          ? {}
          : { recipientOverride: row.recipientOverride }),
      }));
    },

    async markIntentRelayed(intentId: string): Promise<void> {
      await prisma.identityCommunicationIntent.update({
        where: { id: intentId },
        data: {
          status: 'relayed',
          relayedAt: new Date(),
          // THE RETENTION BOUND. The address was kept only to survive the gap
          // between the closure transaction and this relay; past that it is
          // personal data the platform has no remaining use for
          // (SECURITY_BASELINE.md §19.2).
          recipientOverride: null,
        },
      });
    },
  };
}
