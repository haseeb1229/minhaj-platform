import 'server-only';

import type {
  ApplicationStatus,
  ClosureSource,
  MembershipDispositionPort,
  MembershipExportPort,
  MembershipStatus,
  WithdrawalSource,
} from '@minhaj/contracts/membership';

import { getDatabaseClient } from '../../client.ts';
import {
  LOCKED_TRANSACTION,
  bounded,
  dateOf,
  later,
  maybeDate,
  refuse,
  serialise,
} from './shared.ts';

/**
 * Membership's part of a person's export and of their closed account's
 * disposition, coordinated at Layer 4.
 *
 * EVERY STATEMENT IS KEYED BY THE ACCOUNT. Nothing here decides whether the
 * account is closed — that is Identity's answer, asked by the caller — and
 * nothing here refuses: it reads or changes exactly the rows the account owns.
 *
 * THE EXPORT IS IDENTIFIERS AND INSTANTS. A type's words are the catalogue's,
 * so none is copied. Each list is in a fixed order — oldest first, then id —
 * so two exports of unchanged data are identical apart from `generatedAt`.
 *
 * CLOSING THE LOGIN ACCOUNT IS NOT RESIGNING THE MEMBERSHIP. Disposition
 * withdraws the account's OPEN applications as `account-closure` (owing no
 * mail) and abandons, then removes, the mail still owed to it. An active
 * Membership is left exactly as it is; no type, no decided application and no
 * other context's row is touched.
 *
 * BOUNDED, IDEMPOTENT AND RESUMABLE. Each call changes at most `limit` rows per
 * step and reports how many; the rows themselves are the pending work, so an
 * interruption leaves only what the next call finds (SECURITY_BASELINE.md
 * §19.1).
 */

const DISPOSAL_MAX = 1_000;

export function createMembershipExport(): MembershipExportPort {
  const db = getDatabaseClient();

  return {
    async collect(accountId) {
      try {
        const [applications, memberships] = await Promise.all([
          db.membershipApplication.findMany({
            where: { applicantUserId: accountId },
            select: {
              id: true,
              membershipTypeId: true,
              status: true,
              withdrawalSource: true,
              submittedAt: true,
              reviewStartedAt: true,
              decidedAt: true,
              withdrawnAt: true,
            },
            orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
          }),
          db.membership.findMany({
            where: { memberUserId: accountId },
            select: {
              id: true,
              membershipTypeId: true,
              sourceApplicationId: true,
              status: true,
              closureSource: true,
              activatedAt: true,
              closedAt: true,
            },
            orderBy: [{ activatedAt: 'asc' }, { id: 'asc' }],
          }),
        ]);
        const iso = (value: Date | null) => (value === null ? null : value.toISOString());
        return {
          applications: applications.map((row) => ({
            id: row.id,
            membershipTypeId: row.membershipTypeId,
            status: row.status as ApplicationStatus,
            withdrawalSource: row.withdrawalSource as WithdrawalSource | null,
            submittedAt: row.submittedAt.toISOString(),
            reviewStartedAt: iso(row.reviewStartedAt),
            decidedAt: iso(row.decidedAt),
            withdrawnAt: iso(row.withdrawnAt),
          })),
          memberships: memberships.map((row) => ({
            id: row.id,
            membershipTypeId: row.membershipTypeId,
            sourceApplicationId: row.sourceApplicationId,
            status: row.status as MembershipStatus,
            closureSource: row.closureSource as ClosureSource | null,
            activatedAt: row.activatedAt.toISOString(),
            closedAt: iso(row.closedAt),
          })),
        };
      } catch (error) {
        refuse(error);
      }
    },
  };
}

export function createMembershipDisposition(): MembershipDispositionPort {
  const db = getDatabaseClient();

  return {
    async disposeAccount(accountId, limit) {
      try {
        const size = bounded(limit, DISPOSAL_MAX);
        return await db.$transaction(async (tx) => {
          let removed = 0;

          // Each open application is withdrawn under its own account-and-type
          // lock, taken in type order so two dispositions cannot interleave.
          const open = await tx.$queryRaw<
            {
              id: string;
              membershipTypeId: string;
              submittedAt: Date | string;
              reviewStartedAt: Date | string | null;
            }[]
          >`
            SELECT TOP (${size}) [id], [membershipTypeId], [submittedAt], [reviewStartedAt]
            FROM [dbo].[MembershipApplication]
            WHERE [applicantUserId] = ${accountId} AND [status] IN (N'submitted', N'under_review')
            ORDER BY [membershipTypeId], [id]`;
          for (const application of open) {
            await serialise(tx, accountId, application.membershipTypeId);
            const now = later(
              new Date(),
              dateOf(application.submittedAt),
              maybeDate(application.reviewStartedAt),
            );
            removed += await tx.$executeRaw`
              UPDATE [dbo].[MembershipApplication]
              SET [status] = N'withdrawn', [withdrawalSource] = N'account-closure',
                  [withdrawnAt] = ${now}, [version] = [version] + 1, [updatedAt] = ${now}
              WHERE [id] = ${application.id} AND [applicantUserId] = ${accountId}
                AND [status] IN (N'submitted', N'under_review')`;
          }

          // What was owed to the person is owed no longer: abandoned (so a
          // dispatcher holding a claim relays nothing) and then removed.
          await tx.$executeRaw`
            UPDATE [dbo].[MembershipCommunicationIntent]
            SET [state] = N'abandoned', [claimedUntil] = NULL
            WHERE [recipientUserId] = ${accountId} AND [state] = N'pending'`;
          removed += await tx.$executeRaw`
            DELETE TOP (${size}) FROM [dbo].[MembershipCommunicationIntent]
            WHERE [recipientUserId] = ${accountId}`;
          return removed;
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async accountsWithData(after, limit) {
      try {
        const size = bounded(limit, DISPOSAL_MAX);
        const rows = await db.$queryRaw<{ userId: string }[]>`
          SELECT TOP (${size}) [userId] FROM (
            SELECT [applicantUserId] AS [userId] FROM [dbo].[MembershipApplication]
              WHERE [status] IN (N'submitted', N'under_review')
            UNION SELECT [recipientUserId] FROM [dbo].[MembershipCommunicationIntent]
          ) AS [owners]
          WHERE ${after} IS NULL OR [userId] > ${after}
          ORDER BY [userId]`;
        return rows.map((row) => row.userId);
      } catch (error) {
        refuse(error);
      }
    },
  };
}
