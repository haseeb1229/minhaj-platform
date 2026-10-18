import 'server-only';

import type { Prisma } from '@prisma/client';

import {
  DONATION_EXPORT_ROWS,
  DONATION_PAGE,
  type DonationQuery,
  type DonationStaffPort,
} from '@minhaj/contracts/donations';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import {
  DonationsDataError,
  LOCKED_TRANSACTION,
  REFUND_SELECT,
  STAFF_DONATION_SELECT,
  boundedOffset,
  donationRow,
  lockDonation,
  refuse,
  toDonationRecord,
  toRefundRecord,
  toStaffDonation,
} from './shared.ts';

/**
 * The operator surface behind `donations.read` and `donations.administer` —
 * reached only through the Donations service, which re-checks the key live on
 * every call.
 *
 * EVERY FINANCIAL READ IS AN AUDITED ACCESS: a listing, a detail and an
 * export each commit their audit row in the SAME transaction as the read, and
 * nothing is recorded when nothing is returned. The audit row holds the
 * filters, counts, ids, states and versions — never a donor, an amount list,
 * a token or a provider reference.
 *
 * Newest first, then id, so a page and an export are deterministic.
 */

const READ = 'donations.read';
const ADMINISTER = 'donations.administer';

const NEWEST_FIRST = [{ createdAt: 'desc' }, { id: 'desc' }] as const;

function whereOf(query: Omit<DonationQuery, 'offset'>): Prisma.DonationWhereInput {
  return {
    ...(query.state === null ? {} : { state: query.state }),
    ...(query.campaignId === null ? {} : { campaignId: query.campaignId }),
    ...(query.environment === null ? {} : { environment: query.environment }),
    ...(query.donor === null
      ? {}
      : query.donor === 'linked'
        ? { donorUserId: { not: null } }
        : { donorUserId: null }),
    ...(query.attention ? { attention: { not: null } } : {}),
  };
}

/** The filters an audit row records: names and values of the query, no data. */
function filtersOf(query: Omit<DonationQuery, 'offset'>): Record<string, string> {
  return {
    state: query.state ?? 'all',
    campaignId: query.campaignId ?? 'all',
    environment: query.environment ?? 'all',
    donor: query.donor ?? 'all',
    attention: String(query.attention),
  };
}

export function createDonationStaff(): DonationStaffPort {
  const db = getDatabaseClient();

  return {
    async donations(actorId, query) {
      const where = whereOf(query);
      try {
        return await db.$transaction(async (tx) => {
          const [total, rows] = await Promise.all([
            tx.donation.count({ where }),
            tx.donation.findMany({
              where,
              select: STAFF_DONATION_SELECT,
              orderBy: [...NEWEST_FIRST],
              skip: boundedOffset(query.offset),
              take: DONATION_PAGE,
            }),
          ]);
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'donations.records.listed',
              targetType: 'donation',
              targetId: null,
              after: {
                count: String(rows.length),
                offset: String(query.offset),
                ...filtersOf(query),
              },
              authorisingSource: READ,
            }),
          });
          return { rows: rows.map(toStaffDonation), total };
        });
      } catch (error) {
        refuse(error);
      }
    },

    async donation(actorId, id) {
      try {
        return await db.$transaction(async (tx) => {
          const row = await tx.donation.findFirst({
            where: { id },
            select: {
              ...STAFF_DONATION_SELECT,
              refunds: {
                select: REFUND_SELECT,
                orderBy: [{ requestedAt: 'asc' }, { id: 'asc' }],
              },
            },
          });
          if (row === null) return null;
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'donations.record.accessed',
              targetType: 'donation',
              targetId: row.id,
              after: {
                state: row.state,
                version: String(row.version),
                environment: row.environment,
                refunds: String(row.refunds.length),
              },
              authorisingSource: READ,
            }),
          });
          return { ...toStaffDonation(row), refunds: row.refunds.map(toRefundRecord) };
        });
      } catch (error) {
        refuse(error);
      }
    },

    async exportRows(actorId, query) {
      const where = whereOf(query);
      try {
        return await db.$transaction(async (tx) => {
          const rows = await tx.donation.findMany({
            where,
            select: STAFF_DONATION_SELECT,
            orderBy: [...NEWEST_FIRST],
            take: DONATION_EXPORT_ROWS,
          });
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'donations.records.exported',
              targetType: 'donation',
              targetId: null,
              after: { count: String(rows.length), ...filtersOf(query) },
              authorisingSource: READ,
            }),
          });
          return rows.map(toStaffDonation);
        });
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Due now, at the expected version: the attempt count restarts, a lease
     * is dropped, and an `unresolved` flag (the reconciler had given up) is
     * cleared — a person asked again. A mismatch flag stays: it is a question
     * the provider's next answer must settle, not a scheduling state.
     */
    async requestReconcile({ actorId, id, expectedVersion, now }) {
      try {
        return toDonationRecord(
          await db.$transaction(async (tx) => {
            const row = await lockDonation(tx, id);
            if (row === null) throw new DonationsDataError('not-found');
            if (row.version !== expectedVersion) throw new DonationsDataError('conflict');
            const changed = await tx.donation.updateMany({
              where: { id, version: expectedVersion },
              data: {
                reconcileDueAt: now,
                reconcileAttempts: 0,
                reconcileLeaseUntil: null,
                ...(row.attention === 'unresolved' ? { attention: null } : {}),
                version: { increment: 1 },
                updatedAt: now,
              },
            });
            if (changed.count !== 1) throw new DonationsDataError('conflict');
            await tx.auditLog.create({
              data: auditRow({
                actorType: 'user',
                actorId,
                action: 'donations.reconcile.requested',
                targetType: 'donation',
                targetId: id,
                before: { state: row.state, version: String(row.version) },
                after: {
                  state: row.state,
                  version: String(row.version + 1),
                  environment: row.environment,
                },
                authorisingSource: ADMINISTER,
              }),
            });
            return donationRow(tx, id);
          }, LOCKED_TRANSACTION),
        );
      } catch (error) {
        refuse(error);
      }
    },
  };
}
