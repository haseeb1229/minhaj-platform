import 'server-only';

import {
  OPEN_APPLICATION_STATUSES,
  OWN_HISTORY,
  type MembershipApplicantPort,
} from '@minhaj/contracts/membership';

import { getDatabaseClient } from '../../client.ts';
import {
  APPLICATION_SELECT,
  BY_DISPLAY_ORDER,
  LOCKED_TRANSACTION,
  MEMBERSHIP_SELECT,
  MembershipDataError,
  OPEN_APPLICATION_KEY,
  TYPE_REFERENCE_SELECT,
  applicationRow,
  claimApplication,
  claimMembership,
  commitIntent,
  holdsActiveMembership,
  isUniqueViolationOn,
  later,
  membershipRow,
  PUBLISHED_TYPES,
  refuse,
  serialise,
  toApplication,
  toMembership,
  toPublicType,
  toTypeReference,
  type Client,
} from './shared.ts';

/**
 * The applicant's own surface — `/my/membership`.
 *
 * EVERY STATEMENT CARRIES THE ACCOUNT. Each read and each write names the
 * signed-in account in its own predicate, so another person's application or
 * Membership resolves to nothing — `not-found`, the same answer an identifier
 * that does not exist gets. Nothing here is audited: these are the person's
 * own acts on their own records.
 *
 * SERIALISED ON THE ACCOUNT AND THE TYPE. A submission, a withdrawal and a
 * self-closure each take `membership:{account}:{type}` and read the type
 * `HOLDLOCK` before their first protected write, then ask their question —
 * an open application, a published type, an active Membership — under that
 * lock. The filtered keys and the triggers are the floor beneath each answer.
 */

/** An open application of the account and type, read under lock. */
async function openApplication(
  tx: Client,
  accountId: string,
  membershipTypeId: string,
): Promise<string | null> {
  const [row] = await tx.$queryRaw<{ id: string }[]>`
    SELECT TOP (1) [id] FROM [dbo].[MembershipApplication] WITH (UPDLOCK, HOLDLOCK)
    WHERE [applicantUserId] = ${accountId} AND [membershipTypeId] = ${membershipTypeId}
      AND [status] IN (N'submitted', N'under_review')
    ORDER BY [id]`;
  return row?.id ?? null;
}

export function createMembershipApplicant(): MembershipApplicantPort {
  const db = getDatabaseClient();

  return {
    async state(accountId) {
      try {
        const [available, applications, memberships] = await Promise.all([
          db.membershipType.findMany(PUBLISHED_TYPES),
          db.membershipApplication.findMany({
            where: { applicantUserId: accountId },
            select: APPLICATION_SELECT,
            orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
            take: OWN_HISTORY,
          }),
          db.membership.findMany({
            where: { memberUserId: accountId },
            select: MEMBERSHIP_SELECT,
            orderBy: [{ activatedAt: 'desc' }, { id: 'desc' }],
            take: OWN_HISTORY,
          }),
        ]);
        const named = [
          ...new Set([
            ...applications.map((row) => row.membershipTypeId),
            ...memberships.map((row) => row.membershipTypeId),
          ]),
        ];
        const types =
          named.length === 0
            ? []
            : await db.membershipType.findMany({
                where: { id: { in: named } },
                select: TYPE_REFERENCE_SELECT,
                orderBy: [...BY_DISPLAY_ORDER],
              });
        return {
          available: available.map(toPublicType),
          applications: applications.map(toApplication),
          memberships: memberships.map(toMembership),
          types: types.map(toTypeReference),
        };
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Under the account-and-type lock: an OPEN application already standing is
     * the answer (`created: false`, no second intent); otherwise the type must
     * be published and the account hold no active Membership of it. The
     * filtered key `MembershipApplication_open_key` is the floor: a twin that
     * somehow raced past the lock is answered by re-reading the winner.
     */
    async submit({ id, accountId, membershipTypeId }) {
      try {
        return await db.$transaction(async (tx) => {
          const typeState = await serialise(tx, accountId, membershipTypeId);
          const existing = await openApplication(tx, accountId, membershipTypeId);
          if (existing !== null) return { applicationId: existing, created: false };
          // A missing type and an unpublished one get the same answer: a draft
          // is not public, so its existence is not disclosed.
          if (typeState !== 'published')
            throw new MembershipDataError('type-unavailable');
          if (await holdsActiveMembership(tx, accountId, membershipTypeId))
            throw new MembershipDataError('already-member');
          const now = new Date();
          await tx.membershipApplication.create({
            data: {
              id,
              applicantUserId: accountId,
              membershipTypeId,
              status: 'submitted',
              version: 1,
              submittedAt: now,
              updatedAt: now,
            },
            select: { id: true },
          });
          await commitIntent(tx, {
            purpose: 'membership.application.submitted',
            recipientUserId: accountId,
            record: { applicationId: id },
            dueAt: now,
          });
          return { applicationId: id, created: true };
        }, LOCKED_TRANSACTION);
      } catch (error) {
        if (isUniqueViolationOn(error, OPEN_APPLICATION_KEY)) {
          const winner = await db.membershipApplication.findFirst({
            where: {
              applicantUserId: accountId,
              membershipTypeId,
              status: { in: [...OPEN_APPLICATION_STATUSES] },
            },
            select: { id: true },
          });
          if (winner !== null) return { applicationId: winner.id, created: false };
        }
        refuse(error);
      }
    },

    /** The account's own OPEN application, withdrawn at its expected version. */
    async withdraw({ accountId, id, expectedVersion }) {
      try {
        return toApplication(
          await db.$transaction(async (tx) => {
            const claimed = await claimApplication(tx, id, accountId);
            if (claimed === null) throw new MembershipDataError('not-found');
            const { row } = claimed;
            if (row.version !== expectedVersion)
              throw new MembershipDataError('conflict');
            if (row.status !== 'submitted' && row.status !== 'under_review')
              throw new MembershipDataError('invalid-state');
            const now = later(new Date(), row.submittedAt, row.reviewStartedAt);
            const changed = await tx.membershipApplication.updateMany({
              where: {
                id,
                applicantUserId: accountId,
                version: expectedVersion,
                status: { in: [...OPEN_APPLICATION_STATUSES] },
              },
              data: {
                status: 'withdrawn',
                withdrawalSource: 'applicant',
                withdrawnAt: now,
                version: { increment: 1 },
                updatedAt: now,
              },
            });
            if (changed.count !== 1) throw new MembershipDataError('conflict');
            await commitIntent(tx, {
              purpose: 'membership.application.withdrawn',
              recipientUserId: accountId,
              record: { applicationId: id },
              dueAt: now,
            });
            return applicationRow(tx, id);
          }, LOCKED_TRANSACTION),
        );
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * The member's own ACTIVE Membership, closed by them. Closing never edits
     * the application that created it.
     */
    async closeOwn({ accountId, id, expectedVersion }) {
      try {
        return toMembership(
          await db.$transaction(async (tx) => {
            const row = await claimMembership(tx, id, accountId);
            if (row === null) throw new MembershipDataError('not-found');
            if (row.version !== expectedVersion)
              throw new MembershipDataError('conflict');
            if (row.status !== 'active') throw new MembershipDataError('invalid-state');
            const now = later(new Date(), row.activatedAt);
            const changed = await tx.membership.updateMany({
              where: {
                id,
                memberUserId: accountId,
                version: expectedVersion,
                status: 'active',
              },
              data: {
                status: 'closed',
                closureSource: 'member',
                closedAt: now,
                version: { increment: 1 },
                updatedAt: now,
              },
            });
            if (changed.count !== 1) throw new MembershipDataError('conflict');
            await commitIntent(tx, {
              purpose: 'membership.closed',
              recipientUserId: accountId,
              record: { membershipId: id },
              dueAt: now,
            });
            return membershipRow(tx, id);
          }, LOCKED_TRANSACTION),
        );
      } catch (error) {
        refuse(error);
      }
    },
  };
}
