import 'server-only';

import {
  MEMBERSHIP_PAGE,
  OPEN_APPLICATION_STATUSES,
  type MembershipStaffPort,
} from '@minhaj/contracts/membership';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import {
  APPLICATION_SELECT,
  LOCKED_TRANSACTION,
  MEMBERSHIP_SELECT,
  MembershipDataError,
  applicationRow,
  boundedOffset,
  claimApplication,
  claimMembership,
  commitIntent,
  holdsActiveMembership,
  later,
  membershipRow,
  refuse,
  toStaffApplication,
  toStaffMembership,
} from './shared.ts';

/**
 * The operator surface behind `membership.read` and `membership.administer`
 * — reached only through the Membership service, which re-checks the key
 * live on every call and asks Identity whether the applicant's account is
 * closed before a review or an approval.
 *
 * EVERY READ THAT NAMES AN APPLICANT OR A MEMBER IS AN AUDITED ACCESS, its
 * audit row committed in the SAME transaction as the read, and nothing is
 * recorded when nothing is returned. EVERY DECISION commits its audit row and
 * the applicant's intent in the same transaction as the change.
 *
 * AN APPROVAL IS ONE TRANSACTION. Under the account-and-type lock, with the
 * type read `HOLDLOCK` and the application `UPDLOCK, HOLDLOCK`: still under
 * review at the expected version, the type still published, no active
 * Membership of it — then the decision, the Membership, the audit row and the
 * intent. Any refusal, at any step, leaves none of them.
 *
 * Audit rows hold identifiers, states and versions — never an address, a
 * name or a type's words.
 */

const READ = 'membership.read';
const ADMINISTER = 'membership.administer';

export function createMembershipStaff(): MembershipStaffPort {
  const db = getDatabaseClient();

  return {
    async applications(actorId, query) {
      const where = {
        ...(query.status === null
          ? {}
          : query.status === 'open'
            ? { status: { in: [...OPEN_APPLICATION_STATUSES] } }
            : { status: query.status }),
        ...(query.membershipTypeId === null
          ? {}
          : { membershipTypeId: query.membershipTypeId }),
      };
      try {
        return await db.$transaction(async (tx) => {
          const [total, rows] = await Promise.all([
            tx.membershipApplication.count({ where }),
            tx.membershipApplication.findMany({
              where,
              select: APPLICATION_SELECT,
              orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
              skip: boundedOffset(query.offset),
              take: MEMBERSHIP_PAGE,
            }),
          ]);
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'membership.applications.listed',
              targetType: 'membership-application',
              targetId: null,
              after: {
                count: String(rows.length),
                status: query.status ?? 'all',
                typeId: query.membershipTypeId ?? 'all',
              },
              authorisingSource: READ,
            }),
          });
          return { rows: rows.map(toStaffApplication), total };
        });
      } catch (error) {
        refuse(error);
      }
    },

    async application(actorId, id) {
      try {
        return await db.$transaction(async (tx) => {
          const row = await tx.membershipApplication.findFirst({
            where: { id },
            select: APPLICATION_SELECT,
          });
          if (row === null) return null;
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'membership.application.accessed',
              targetType: 'membership-application',
              targetId: row.id,
              after: { status: row.status, membershipTypeId: row.membershipTypeId },
              authorisingSource: READ,
            }),
          });
          return toStaffApplication(row);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * The applicant's account id alone — the identifier the service hands
     * Identity to ask whether that account is closed before a review or an
     * approval. It discloses nothing an operator sees, so it is not audited.
     */
    async applicantOf(id) {
      try {
        const row = await db.membershipApplication.findFirst({
          where: { id },
          select: { applicantUserId: true },
        });
        return row?.applicantUserId ?? null;
      } catch (error) {
        refuse(error);
      }
    },

    async startReview({ actorId, id, expectedVersion }) {
      try {
        return toStaffApplication(
          await db.$transaction(async (tx) => {
            const claimed = await claimApplication(tx, id, null);
            if (claimed === null) throw new MembershipDataError('not-found');
            const { row } = claimed;
            if (row.version !== expectedVersion)
              throw new MembershipDataError('conflict');
            if (row.status !== 'submitted')
              throw new MembershipDataError('invalid-state');
            const now = later(new Date(), row.submittedAt);
            const changed = await tx.membershipApplication.updateMany({
              where: { id, version: expectedVersion, status: 'submitted' },
              data: {
                status: 'under_review',
                reviewStartedAt: now,
                version: { increment: 1 },
                updatedAt: now,
              },
            });
            if (changed.count !== 1) throw new MembershipDataError('conflict');
            await commitIntent(tx, {
              purpose: 'membership.application.under-review',
              recipientUserId: row.applicantUserId,
              record: { applicationId: id },
              dueAt: now,
            });
            await tx.auditLog.create({
              data: auditRow({
                actorType: 'user',
                actorId,
                action: 'membership.application.review-started',
                targetType: 'membership-application',
                targetId: id,
                before: {
                  status: row.status,
                  version: String(row.version),
                  membershipTypeId: row.membershipTypeId,
                },
                after: {
                  status: 'under_review',
                  version: String(row.version + 1),
                  membershipTypeId: row.membershipTypeId,
                },
                authorisingSource: ADMINISTER,
              }),
            });
            return applicationRow(tx, id);
          }, LOCKED_TRANSACTION),
        );
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * A decision needs a review first. An approval also needs the type still
     * published (`type-unavailable`) and no active Membership of it
     * (`already-member`); a rejection is allowed whatever the type's state.
     */
    async decide({ actorId, id, expectedVersion, decision, membershipId }) {
      try {
        return toStaffApplication(
          await db.$transaction(async (tx) => {
            const claimed = await claimApplication(tx, id, null);
            if (claimed === null) throw new MembershipDataError('not-found');
            const { row, typeState } = claimed;
            if (row.version !== expectedVersion)
              throw new MembershipDataError('conflict');
            if (row.status !== 'under_review')
              throw new MembershipDataError('invalid-state');
            const approve = decision === 'approve';
            if (approve) {
              if (typeState !== 'published')
                throw new MembershipDataError('type-unavailable');
              if (
                await holdsActiveMembership(tx, row.applicantUserId, row.membershipTypeId)
              )
                throw new MembershipDataError('already-member');
            }
            const now = later(new Date(), row.reviewStartedAt);
            const status = approve ? 'approved' : 'rejected';
            const changed = await tx.membershipApplication.updateMany({
              where: { id, version: expectedVersion, status: 'under_review' },
              data: { status, decidedAt: now, version: { increment: 1 }, updatedAt: now },
            });
            if (changed.count !== 1) throw new MembershipDataError('conflict');
            if (approve)
              await tx.membership.create({
                data: {
                  id: membershipId,
                  memberUserId: row.applicantUserId,
                  membershipTypeId: row.membershipTypeId,
                  sourceApplicationId: id,
                  status: 'active',
                  version: 1,
                  activatedAt: now,
                  updatedAt: now,
                },
                select: { id: true },
              });
            await commitIntent(tx, {
              purpose: approve
                ? 'membership.application.approved'
                : 'membership.application.rejected',
              recipientUserId: row.applicantUserId,
              record: { applicationId: id },
              dueAt: now,
            });
            await tx.auditLog.create({
              data: auditRow({
                actorType: 'user',
                actorId,
                action: approve
                  ? 'membership.application.approved'
                  : 'membership.application.rejected',
                targetType: 'membership-application',
                targetId: id,
                before: {
                  status: row.status,
                  version: String(row.version),
                  membershipTypeId: row.membershipTypeId,
                },
                after: {
                  status,
                  version: String(row.version + 1),
                  membershipTypeId: row.membershipTypeId,
                  ...(approve ? { membershipId } : {}),
                },
                authorisingSource: ADMINISTER,
              }),
            });
            return applicationRow(tx, id);
          }, LOCKED_TRANSACTION),
        );
      } catch (error) {
        refuse(error);
      }
    },

    async memberships(actorId, query) {
      const where = {
        ...(query.status === null ? {} : { status: query.status }),
        ...(query.membershipTypeId === null
          ? {}
          : { membershipTypeId: query.membershipTypeId }),
      };
      try {
        return await db.$transaction(async (tx) => {
          const [total, rows] = await Promise.all([
            tx.membership.count({ where }),
            tx.membership.findMany({
              where,
              select: MEMBERSHIP_SELECT,
              orderBy: [{ activatedAt: 'desc' }, { id: 'asc' }],
              skip: boundedOffset(query.offset),
              take: MEMBERSHIP_PAGE,
            }),
          ]);
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'membership.memberships.listed',
              targetType: 'membership',
              targetId: null,
              after: {
                count: String(rows.length),
                status: query.status ?? 'all',
                typeId: query.membershipTypeId ?? 'all',
              },
              authorisingSource: READ,
            }),
          });
          return { rows: rows.map(toStaffMembership), total };
        });
      } catch (error) {
        refuse(error);
      }
    },

    async closeMembership({ actorId, id, expectedVersion }) {
      try {
        return toStaffMembership(
          await db.$transaction(async (tx) => {
            const row = await claimMembership(tx, id, null);
            if (row === null) throw new MembershipDataError('not-found');
            if (row.version !== expectedVersion)
              throw new MembershipDataError('conflict');
            if (row.status !== 'active') throw new MembershipDataError('invalid-state');
            const now = later(new Date(), row.activatedAt);
            const changed = await tx.membership.updateMany({
              where: { id, version: expectedVersion, status: 'active' },
              data: {
                status: 'closed',
                closureSource: 'operator',
                closedAt: now,
                version: { increment: 1 },
                updatedAt: now,
              },
            });
            if (changed.count !== 1) throw new MembershipDataError('conflict');
            await commitIntent(tx, {
              purpose: 'membership.closed',
              recipientUserId: row.memberUserId,
              record: { membershipId: id },
              dueAt: now,
            });
            await tx.auditLog.create({
              data: auditRow({
                actorType: 'user',
                actorId,
                action: 'membership.membership.closed',
                targetType: 'membership',
                targetId: id,
                before: { status: 'active', version: String(row.version) },
                after: {
                  status: 'closed',
                  version: String(row.version + 1),
                  membershipTypeId: row.membershipTypeId,
                  closureSource: 'operator',
                },
                authorisingSource: ADMINISTER,
              }),
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
