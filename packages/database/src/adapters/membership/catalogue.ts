import 'server-only';

import type { Prisma } from '@prisma/client';

import {
  MEMBERSHIP_LIMITS,
  MEMBERSHIP_TYPE_TRANSITIONS,
  OPEN_APPLICATION_STATUSES,
  type MembershipCatalogueReaderPort,
  type MembershipCataloguePort,
  type MembershipTypeRecord,
  type MembershipTypeState,
} from '@minhaj/contracts/membership';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import {
  BY_DISPLAY_ORDER,
  LOCKED_TRANSACTION,
  MembershipDataError,
  TYPE_REFERENCE_SELECT,
  lockCatalogue,
  PUBLISHED_TYPES,
  refuse,
  toPublicType,
  toTypeReference,
  type Client,
  type TypeReferenceRow,
} from './shared.ts';

/**
 * The membership-type catalogue: the public reader (published types only,
 * nothing personal) and the operator surface behind `membership.administer`.
 *
 * EVERY TYPE CHANGE IS ONE VERSION. A reorder, a label save and a transition
 * each take the type row `WITH (UPDLOCK)`, check the expected version, move it
 * by exactly one (the trigger refuses anything else) and commit their audit
 * row in the same transaction. The audit names what changed — a field, a
 * locale, a state — never an operator's words.
 *
 * A TYPE THAT HAS BEEN PUBLIC NEVER RETURNS TO DRAFT, and is published only
 * with its primary locale's words. The adapter asks both questions itself so
 * the operator is told `invalid-state` or `incomplete`; the trigger (51320,
 * 51321) is the floor beneath it.
 */

const AUTHORITY = 'membership.administer';

/** A mutable copy, as a Prisma filter takes it. */
const OPEN_STATUSES: string[] = [...OPEN_APPLICATION_STATUSES];

const TYPE_RECORD_SELECT = {
  ...TYPE_REFERENCE_SELECT,
  version: true,
  createdAt: true,
  updatedAt: true,
  publishedAt: true,
  archivedAt: true,
  _count: {
    select: {
      applications: { where: { status: { in: OPEN_STATUSES } } },
      memberships: { where: { status: 'active' } },
    },
  },
} as const satisfies Prisma.MembershipTypeSelect;

interface TypeRecordRow extends TypeReferenceRow {
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
  readonly archivedAt: Date | null;
  readonly _count: { readonly applications: number; readonly memberships: number };
}

function toTypeRecord(row: TypeRecordRow): MembershipTypeRecord {
  return {
    ...toTypeReference(row),
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    publishedAt: row.publishedAt,
    archivedAt: row.archivedAt,
    openApplications: row._count.applications,
    activeMemberships: row._count.memberships,
  };
}

/** One type re-read inside the writing transaction, after its change. */
async function changedType(tx: Client, id: string): Promise<MembershipTypeRecord> {
  const row = await tx.membershipType.findFirst({
    where: { id },
    select: TYPE_RECORD_SELECT,
  });
  if (row === null) throw new MembershipDataError('conflict');
  return toTypeRecord(row);
}

/** The columns one type change may move beside its version. */
interface TypeChange {
  readonly displayOrder?: number;
  readonly state?: 'published' | 'archived';
  readonly publishedAt?: Date;
  readonly archivedAt?: Date | null;
}

interface LockedType {
  readonly state: MembershipTypeState;
  readonly primaryLocale: string;
  readonly version: number;
  readonly displayOrder: number;
}

/**
 * The type row under `UPDLOCK` — a lock no other type change can share, and
 * which a write holding the row `HOLDLOCK` (a submission, an approval) makes
 * wait until it commits. Missing → `not-found`; stale → `conflict`.
 */
async function lockedType(
  tx: Client,
  id: string,
  expectedVersion: number,
): Promise<LockedType> {
  const [row] = await tx.$queryRaw<
    { state: string; primaryLocale: string; version: number; displayOrder: number }[]
  >`
    SELECT [state], [primaryLocale], [version], [displayOrder]
    FROM [dbo].[MembershipType] WITH (UPDLOCK, ROWLOCK)
    WHERE [id] = ${id}`;
  if (row === undefined) throw new MembershipDataError('not-found');
  if (Number(row.version) !== expectedVersion) throw new MembershipDataError('conflict');
  return {
    state: row.state as MembershipTypeState,
    primaryLocale: row.primaryLocale,
    version: Number(row.version),
    displayOrder: Number(row.displayOrder),
  };
}

/** What one type change moves, and the field names its audit row records. */
type TypeWork = (
  tx: Client,
  locked: LockedType,
  now: Date,
) => Promise<{
  readonly data: TypeChange;
  readonly after: Readonly<Record<string, string>>;
}>;

/**
 * One version-checked type change, inside the caller's transaction: the row
 * locked, the work done, the version moved by one in the SAME statement as the
 * change (the trigger requires every update of a type to move its version by
 * exactly one), and the audit row committed beside it.
 */
async function changeType(
  tx: Client,
  input: {
    readonly actorId: string;
    readonly id: string;
    readonly expectedVersion: number;
  },
  action: string,
  work: TypeWork,
): Promise<MembershipTypeRecord> {
  const locked = await lockedType(tx, input.id, input.expectedVersion);
  const now = new Date();
  const { data, after } = await work(tx, locked, now);
  const claimed = await tx.membershipType.updateMany({
    where: { id: input.id, version: input.expectedVersion },
    data: { ...data, version: { increment: 1 }, updatedAt: now },
  });
  if (claimed.count !== 1) throw new MembershipDataError('conflict');
  const record = await changedType(tx, input.id);
  await tx.auditLog.create({
    data: auditRow({
      actorType: 'user',
      actorId: input.actorId,
      action,
      targetType: 'membership-type',
      targetId: input.id,
      before: { version: String(locked.version), state: locked.state },
      after: { version: String(record.version), state: record.state, ...after },
      authorisingSource: AUTHORITY,
    }),
  });
  return record;
}

export function createMembershipCatalogueReader(): MembershipCatalogueReaderPort {
  const db = getDatabaseClient();

  return {
    async publishedTypes() {
      try {
        const rows = await db.membershipType.findMany(PUBLISHED_TYPES);
        return rows.map(toPublicType);
      } catch (error) {
        refuse(error);
      }
    },
  };
}

export function createMembershipCatalogue(): MembershipCataloguePort {
  const db = getDatabaseClient();

  return {
    async types() {
      try {
        const rows = await db.membershipType.findMany({
          select: TYPE_RECORD_SELECT,
          orderBy: [...BY_DISPLAY_ORDER],
          take: MEMBERSHIP_LIMITS.types,
        });
        return rows.map(toTypeRecord);
      } catch (error) {
        refuse(error);
      }
    },

    async type(id) {
      try {
        const row = await db.membershipType.findFirst({
          where: { id },
          select: TYPE_RECORD_SELECT,
        });
        return row === null ? null : toTypeRecord(row);
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * Under the catalogue lock, so the count and the insert agree: refused
     * `limit` once `MEMBERSHIP_LIMITS.types` exist, in any state. A draft at
     * version 1 with its primary locale's words.
     */
    async createType({ id, actorId, value }) {
      try {
        return await db.$transaction(async (tx) => {
          await lockCatalogue(tx);
          if ((await tx.membershipType.count()) >= MEMBERSHIP_LIMITS.types)
            throw new MembershipDataError('limit');
          const now = new Date();
          await tx.membershipType.create({
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
          await tx.membershipTypeTranslation.create({
            data: {
              membershipTypeId: id,
              locale: value.label.locale,
              title: value.label.title,
              summary: value.label.summary,
              description: value.label.description,
              guidance: value.label.guidance,
              updatedAt: now,
            },
            select: { locale: true },
          });
          const record = await changedType(tx, id);
          await tx.auditLog.create({
            data: auditRow({
              actorType: 'user',
              actorId,
              action: 'membership.type.created',
              targetType: 'membership-type',
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

    async reorderType({ actorId, id, expectedVersion, displayOrder }) {
      try {
        return await db.$transaction(
          (tx) =>
            changeType(
              tx,
              { actorId, id, expectedVersion },
              'membership.type.updated',
              async () => ({
                data: { displayOrder },
                after: { changed: 'displayOrder', displayOrder: String(displayOrder) },
              }),
            ),
          LOCKED_TRANSACTION,
        );
      } catch (error) {
        refuse(error);
      }
    },

    /**
     * One locale's words, replaced or added — never removed. Every writer of
     * a type's words holds the type row first, so the update-or-insert below
     * cannot race another for the same locale.
     */
    async saveLabel({ actorId, id, expectedVersion, label }) {
      try {
        return await db.$transaction(
          (tx) =>
            changeType(
              tx,
              { actorId, id, expectedVersion },
              'membership.type.updated',
              async (tx, _locked, now) => {
                const words = {
                  title: label.title,
                  summary: label.summary,
                  description: label.description,
                  guidance: label.guidance,
                  updatedAt: now,
                };
                const replaced = await tx.membershipTypeTranslation.updateMany({
                  where: { membershipTypeId: id, locale: label.locale },
                  data: words,
                });
                if (replaced.count === 0)
                  await tx.membershipTypeTranslation.create({
                    data: { membershipTypeId: id, locale: label.locale, ...words },
                    select: { locale: true },
                  });
                return { data: {}, after: { changed: 'label', locale: label.locale } };
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
     * primary locale's words first (`incomplete`); any other move, and every
     * return to draft, is `invalid-state`.
     */
    async transitionType({ actorId, id, expectedVersion, to }) {
      try {
        return await db.$transaction(
          (tx) =>
            changeType(
              tx,
              { actorId, id, expectedVersion },
              to === 'published'
                ? 'membership.type.published'
                : 'membership.type.archived',
              async (tx, locked, now) => {
                if (!MEMBERSHIP_TYPE_TRANSITIONS[locked.state].includes(to))
                  throw new MembershipDataError('invalid-state');
                if (to === 'published') {
                  const words = await tx.membershipTypeTranslation.count({
                    where: { membershipTypeId: id, locale: locked.primaryLocale },
                  });
                  if (words === 0) throw new MembershipDataError('incomplete');
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
