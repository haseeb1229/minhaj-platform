import 'server-only';

import {
  DONATION_EXPORT_ROWS,
  OWN_DONATION_HISTORY,
  formatExactAmount,
  type DonationCurrency,
  type DonationOwnerPort,
  type DonationState,
  type PaymentEnvironment,
} from '@minhaj/contracts/donations';

import { getDatabaseClient } from '../../client.ts';
import { CAMPAIGN_LABEL_SELECT, bounded, refuse, toCampaignLabel } from './shared.ts';

/**
 * The account's own linked donations — `/my/donations` and the person's
 * export.
 *
 * EVERY STATEMENT CARRIES THE ACCOUNT. Each read names the signed-in account
 * in its own predicate, so another person's donation, and every anonymous
 * one, resolves to nothing. Nothing here is audited: these are the person's
 * own reads of their own records. No provider reference, token digest or
 * scope beyond the environment is returned.
 *
 * Money leaves as `bigint` (history) or as its exact decimal text in the
 * currency's own unit (`formatExactAmount`, export) — never a float.
 */

const OWN_SELECT = {
  id: true,
  campaignId: true,
  state: true,
  currency: true,
  expectedMinor: true,
  refundedMinor: true,
  environment: true,
  createdAt: true,
  updatedAt: true,
  succeededAt: true,
} as const;

export function createDonationOwner(): DonationOwnerPort {
  const db = getDatabaseClient();

  return {
    async history(accountId, limit) {
      try {
        const rows = await db.donation.findMany({
          where: { donorUserId: accountId },
          select: { ...OWN_SELECT, campaign: { select: CAMPAIGN_LABEL_SELECT } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: bounded(limit, OWN_DONATION_HISTORY),
        });
        return rows.map((row) => ({
          id: row.id,
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
          succeededAt: row.succeededAt,
        }));
      } catch (error) {
        refuse(error);
      }
    },

    /** Oldest first, then id: two exports of unchanged data are identical. */
    async exportRows(accountId) {
      try {
        const rows = await db.donation.findMany({
          where: { donorUserId: accountId },
          select: OWN_SELECT,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          take: DONATION_EXPORT_ROWS,
        });
        return rows.map((row) => {
          const currency = row.currency as DonationCurrency;
          return {
            id: row.id,
            campaignId: row.campaignId,
            currency,
            amount: formatExactAmount(row.expectedMinor, currency),
            refunded: formatExactAmount(row.refundedMinor, currency),
            state: row.state as DonationState,
            environment: row.environment as PaymentEnvironment,
            createdAt: row.createdAt.toISOString(),
            succeededAt: row.succeededAt === null ? null : row.succeededAt.toISOString(),
            updatedAt: row.updatedAt.toISOString(),
          };
        });
      } catch (error) {
        refuse(error);
      }
    },
  };
}
