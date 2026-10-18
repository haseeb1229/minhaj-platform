import 'server-only';

import type { Prisma } from '@prisma/client';

import {
  CURRENCY_EXPONENTS,
  DONATION_CAMPAIGN_TRANSITIONS,
  DONATION_LIMITS,
  type DonationCampaignPort,
  type DonationCampaignRecord,
  type DonationCampaignState,
  type DonationCatalogueReaderPort,
  type PublicDonationCampaign,
} from '@minhaj/contracts/donations';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import {
  DonationsDataError,
  LOCKED_TRANSACTION,
  POLICY_SELECT,
  lockCampaign,
  lockCatalogue,
  refuse,
  toPolicy,
  type Client,
  type Locale,
  type PolicyRow,
} from './shared.ts';

/**
 * The donation-campaign catalogue: the public reader (published campaigns
 * only, nothing personal, nothing financial beyond the server's own policy)
 * and the operator surface behind `donations.administer`.
 *
 * EVERY CAMPAIGN CHANGE IS ONE VERSION, UNDER THE CAMPAIGN LOCK. Words, policy
 * and transitions each take `donations:campaign:{id}` — the lock every
 * initiation of a donation for that campaign also takes — then the row
 * `WITH (UPDLOCK)`, check the expected version, move it by exactly one (the
 * trigger refuses anything else) and commit their audit row in the same
 * transaction. So an archive and an initiation, or a policy change and an
 * initiation, are ordered: whichever commits first decides what the other
 * sees. The audit names what changed — a field, a locale, a currency, a state
 * — never an operator's words.
 *
 * A POLICY CHANGE NEVER TOUCHES A DONATION. Each donation holds its own
 * immutable copy of its expected money; removing or narrowing a currency
 * affects only donations begun afterwards.
 */

const AUTHORITY = 'donations.administer';

const CAMPAIGN_PUBLIC_SELECT = {
  id: true,
  primaryLocale: true,
  displayOrder: true,
  translations: {
    select: { locale: true, title: true, summary: true, description: true },
    orderBy: { locale: 'asc' },
  },
  currencies: { select: POLICY_SELECT, orderBy: { currency: 'asc' } },
} as const satisfies Prisma.DonationCampaignSelect;

const CAMPAIGN_RECORD_SELECT = {
  ...CAMPAIGN_PUBLIC_SELECT,
  state: true,
  version: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  archivedAt: true,
  _count: { select: { donations: true } },
} as const satisfies Prisma.DonationCampaignSelect;

interface CampaignPublicRow {
  readonly id: string;
  readonly primaryLocale: string;
  readonly displayOrder: number;
  readonly translations: readonly {
    readonly locale: string;
    readonly title: string;
    readonly summary: string;
    readonly description: string;
  }[];
  readonly currencies: readonly PolicyRow[];
}

interface CampaignRecordRow extends CampaignPublicRow {
  readonly state: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
  readonly archivedAt: Date | null;
  readonly _count: { readonly donations: number };
}

function toPublicCampaign(row: CampaignPublicRow): PublicDonationCampaign {
  return {
    id: row.id,
    primaryLocale: row.primaryLocale as Locale,
    displayOrder: row.displayOrder,
    translations: row.translations.map((entry) => ({
      locale: entry.locale as Locale,
      title: entry.title,
      summary: entry.summary,
      description: entry.description,
    })),
    currencies: row.currencies.map(toPolicy),
  };
}

function toCampaignRecord(row: CampaignRecordRow): DonationCampaignRecord {
  return {
    ...toPublicCampaign(row),
    state: row.state as DonationCampaignState,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    referenced: row._count.donations > 0,
  };
}

/** One campaign re-read inside the writing transaction, after its change. */
async function changedCampaign(tx: Client, id: string): Promise<DonationCampaignRecord> {
  const row = await tx.donationCampaign.findFirst({
    where: { id },
    select: CAMPAIGN_RECORD_SELECT,
  });
  if (row === null) throw new DonationsDataError('conflict');
  return toCampaignRecord(row);
}

interface LockedCampaign {
  readonly state: DonationCampaignState;
  readonly primaryLocale: string;
  readonly version: number;
}

/**
 * The campaign lock, then the row under `UPDLOCK`. Missing → `not-found`;
 * stale → `conflict`.
 */
async function lockedCampaign(
  tx: Client,
  id: string,
  expectedVersion: number,
): Promise<LockedCampaign> {
  await lockCampaign(tx, id);
  const [row] = await tx.$queryRaw<
    { state: string; primaryLocale: string; version: number }[]
  >`
    SELECT [state], [primaryLocale], [version]
    FROM [dbo].[DonationCampaign] WITH (UPDLOCK, ROWLOCK)
    WHERE [id] = ${id}`;
  if (row === undefined) throw new DonationsDataError('not-found');
  if (Number(row.version) !== expectedVersion) throw new DonationsDataError('conflict');
  return {
    state: row.state as DonationCampaignState,
    primaryLocale: row.primaryLocale,
    version: Number(row.version),
  };
}

/** The columns one campaign change may move beside its version. */
interface CampaignChange {
  readonly displayOrder?: number;
  readonly state?: 'published' | 'archived';
  readonly publishedAt?: Date;
  readonly archivedAt?: Date | null;
}

type CampaignWork = (
  tx: Client,
  locked: LockedCampaign,
  now: Date,
) => Promise<{
  readonly data: CampaignChange;
  readonly after: Readonly<Record<string, string>>;
}>;

/**
 * One version-checked campaign change inside the caller's transaction: the
 * lock and the row, the work, the version moved by one in the SAME statement
 * as the change, and the audit row beside it.
 */
async function changeCampaign(
  tx: Client,
  input: {
    readonly actorId: string;
    readonly id: string;
    readonly expectedVersion: number;
  },
  action: string,
  work: CampaignWork,
): Promise<DonationCampaignRecord> {
  const locked = await lockedCampaign(tx, input.id, input.expectedVersion);
  const now = new Date();
  const { data, after } = await work(tx, locked, now);
  const claimed = await tx.donationCampaign.updateMany({
    where: { id: input.id, version: input.expectedVersion },
    data: { ...data, version: { increment: 1 }, updatedAt: now },
  });
  if (claimed.count !== 1) throw new DonationsDataError('conflict');
  const record = await changedCampaign(tx, input.id);
  await tx.auditLog.create({
    data: auditRow({
      actorType: 'user',
      actorId: input.actorId,
      action,
      targetType: 'donation-campaign',
      targetId: input.id,
      before: { version: String(locked.version), state: locked.state },
      after: { version: String(record.version), state: record.state, ...after },
      authorisingSource: AUTHORITY,
    }),
  });
  return record;
}

export function createDonationCatalogueReader(): DonationCatalogueReaderPort {
  const db = getDatabaseClient();

  return {
    async publishedCampaigns() {
      try {
        const rows = await db.donationCampaign.findMany({
          where: { state: 'published' },
          select: CAMPAIGN_PUBLIC_SELECT,
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
          take: DONATION_LIMITS.campaigns,
        });
        return rows.map(toPublicCampaign);
      } catch (error) {
        refuse(error);
      }
    },
  };
}

export function createDonationCampaigns(): DonationCampaignPort {
  const db = getDatabaseClient();

  return {
    async campaigns() {
      try {
        const rows = await db.donationCampaign.findMany({
          select: CAMPAIGN_RECORD_SELECT,
          orderBy: [{ displayOrder: 'asc' }, { id: 'asc' }],
          take: DONATION_LIMITS.campaigns,
        });
        return rows.map(toCampaignRecord);
      } catch (error) {
        refuse(error);
      }
    },

    async campaign(id) {
      try {
        const row = await db.donationCampaign.findFirst({
          where: { id },
          select: CAMPAIGN_RECORD_SELECT,
        });
        return row === null ? null : toCampaignRecord(row);
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Under the catalogue lock, so the count and the insert agree: refused
     * `limit` once `DONATION_LIMITS.campaigns` exist, in any state. A draft at
     * version 1, without words or policy yet.
     */
    async createCampaign({ id, actorId, value }) {
      try {
        return await db.$transaction(async (tx) => {
          await lockCatalogue(tx);
          if ((await tx.donationCampaign.count()) >= DONATION_LIMITS.campaigns)
            throw new DonationsDataError('limit');
          const now = new Date();
          await tx.donationCampaign.create({
            data: {
              id,
              state: 'draft',
              primaryLocale: value.primaryLocale,
              displayOrder: value.displayOrder,
              version: 1,
              createdAt: now,
              updatedAt: now,
            },
            select: { id: true },
          });
          const record = await changedCampaign(tx, id);
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'donations.campaign.created',
              targetType: 'donation-campaign',
              targetId: id,
              after: {
                version: String(record.version),
                state: record.state,
                primaryLocale: record.primaryLocale,
                displayOrder: String(record.displayOrder),
              },
              authorisingSource: AUTHORITY,
            }),
          });
          return record;
        }, LOCKED_TRANSACTION);
      } catch (error) {
        refuse(error);
      }
    },

    async reorderCampaign({ actorId, id, expectedVersion, displayOrder }) {
      try {
        return await db.$transaction(
          (tx) =>
            changeCampaign(
              tx,
              { actorId, id, expectedVersion },
              'donations.campaign.reordered',
              async () => ({
                data: { displayOrder },
                after: { displayOrder: String(displayOrder) },
              }),
            ),
          LOCKED_TRANSACTION,
        );
      } catch (error) {
        refuse(error);
      }
    },

    /** One locale's words, replaced or added — never removed. */
    async saveTranslation({ actorId, id, expectedVersion, translation }) {
      try {
        return await db.$transaction(
          (tx) =>
            changeCampaign(
              tx,
              { actorId, id, expectedVersion },
              'donations.campaign.translation-saved',
              async (tx, _locked, now) => {
                const words = {
                  title: translation.title,
                  summary: translation.summary,
                  description: translation.description,
                  updatedAt: now,
                };
                const replaced = await tx.donationCampaignTranslation.updateMany({
                  where: { campaignId: id, locale: translation.locale },
                  data: words,
                });
                if (replaced.count === 0)
                  await tx.donationCampaignTranslation.create({
                    data: { campaignId: id, locale: translation.locale, ...words },
                    select: { locale: true },
                  });
                return { data: {}, after: { locale: translation.locale } };
              },
            ),
          LOCKED_TRANSACTION,
        );
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * One currency's policy, replaced or added. A NEW currency beyond
     * `DONATION_LIMITS.currenciesPerCampaign` is refused `limit`. The exponent
     * is the server's own (`CURRENCY_EXPONENTS`), never the caller's.
     */
    async saveCurrencyPolicy({ actorId, id, expectedVersion, policy }) {
      const [first = null, second = null, third = null] = policy.suggestedMinor;
      try {
        return await db.$transaction(
          (tx) =>
            changeCampaign(
              tx,
              { actorId, id, expectedVersion },
              'donations.campaign.currency-saved',
              async (tx, _locked, now) => {
                const bounds = {
                  minimumMinor: policy.minimumMinor,
                  maximumMinor: policy.maximumMinor,
                  suggested1Minor: first,
                  suggested2Minor: second,
                  suggested3Minor: third,
                  updatedAt: now,
                };
                const replaced = await tx.donationCampaignCurrency.updateMany({
                  where: { campaignId: id, currency: policy.currency },
                  data: bounds,
                });
                if (replaced.count === 0) {
                  const held = await tx.donationCampaignCurrency.count({
                    where: { campaignId: id },
                  });
                  if (held >= DONATION_LIMITS.currenciesPerCampaign)
                    throw new DonationsDataError('limit');
                  await tx.donationCampaignCurrency.create({
                    data: {
                      campaignId: id,
                      currency: policy.currency,
                      currencyExponent: CURRENCY_EXPONENTS[policy.currency],
                      ...bounds,
                    },
                    select: { currency: true },
                  });
                }
                return {
                  data: {},
                  after: {
                    currency: policy.currency,
                    minimumMinor: policy.minimumMinor.toString(),
                    maximumMinor: policy.maximumMinor.toString(),
                    suggestions: String(policy.suggestedMinor.length),
                  },
                };
              },
            ),
          LOCKED_TRANSACTION,
        );
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Removes one currency. A published campaign keeps at least one
     * (`incomplete`, also the trigger's 51341); a currency the campaign does
     * not offer is `not-found`.
     */
    async removeCurrencyPolicy({ actorId, id, expectedVersion, currency }) {
      try {
        return await db.$transaction(
          (tx) =>
            changeCampaign(
              tx,
              { actorId, id, expectedVersion },
              'donations.campaign.currency-removed',
              async (tx, locked) => {
                const held = await tx.donationCampaignCurrency.findMany({
                  where: { campaignId: id },
                  select: { currency: true },
                });
                if (!held.some((row) => row.currency === currency))
                  throw new DonationsDataError('not-found');
                if (locked.state === 'published' && held.length <= 1)
                  throw new DonationsDataError('incomplete');
                await tx.donationCampaignCurrency.deleteMany({
                  where: { campaignId: id, currency },
                });
                return { data: {}, after: { currency } };
              },
            ),
          LOCKED_TRANSACTION,
        );
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * draft → published → archived → published. Publication asks for the
     * primary locale's words and a currency first (`incomplete`); any other
     * move, and every return to draft, is `invalid-state`.
     */
    async transitionCampaign({ actorId, id, expectedVersion, to }) {
      try {
        return await db.$transaction(
          (tx) =>
            changeCampaign(
              tx,
              { actorId, id, expectedVersion },
              to === 'published'
                ? 'donations.campaign.published'
                : 'donations.campaign.archived',
              async (tx, locked, now) => {
                if (!DONATION_CAMPAIGN_TRANSITIONS[locked.state].includes(to))
                  throw new DonationsDataError('invalid-state');
                if (to === 'published') {
                  const [words, currencies] = await Promise.all([
                    tx.donationCampaignTranslation.count({
                      where: { campaignId: id, locale: locked.primaryLocale },
                    }),
                    tx.donationCampaignCurrency.count({ where: { campaignId: id } }),
                  ]);
                  if (words === 0 || currencies === 0)
                    throw new DonationsDataError('incomplete');
                }
                return {
                  data:
                    to === 'published'
                      ? { state: 'published', publishedAt: now, archivedAt: null }
                      : { state: 'archived', archivedAt: now },
                  after: {},
                };
              },
            ),
          LOCKED_TRANSACTION,
        );
      } catch (error) {
        refuse(error);
      }
    },
  };
}
