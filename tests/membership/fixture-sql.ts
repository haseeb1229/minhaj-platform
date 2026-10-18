import { randomUUID } from 'node:crypto';

import type {
  MembershipApplicantPort,
  MembershipCatalogueReaderPort,
  MembershipCataloguePort,
  MembershipCommunicationPort,
  MembershipDispositionPort,
  MembershipExportPort,
  MembershipStaffPort,
  MembershipTypeLabelInput,
} from '../../packages/contracts/src/membership/index.ts';
import {
  getApplicationPrincipalCredentials,
  getDatabaseRuntimeUrl,
} from '../../packages/database/src/config.ts';
import { provisionApplicationPrincipal } from '../../packages/database/src/lifecycle/application-principal.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import {
  openSession,
  parseSqlServerUrl,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import { createProofDatabase, type DisposableDatabase } from '../identity/harness.ts';
import { count, n } from '../learning/fixture-sql.ts';

export { count, n } from '../learning/fixture-sql.ts';

/**
 * Phase 26 fixture rows that ONLY the owner — or another context — may write:
 * accounts (Identity's), and the owner-side states a proof must reach that no
 * Membership act produces (a type row without its words, an application the
 * owner moved, a Membership the owner inserted). Every such statement runs on
 * the MIGRATION (owner) session. Everything Membership itself does is done
 * through Membership's own adapter, as the provisioned RUNTIME principal.
 *
 * NOTHING HERE IS CONTENT. Every title, summary, description and name is an
 * unmistakable `NON_MEMBERSHIP_FIXTURE_…` sentinel, and every account address
 * sits on the reserved `.invalid` TLD (`@membership-proof.invalid`).
 */

/** A sentinel no real type's words or a person's name could be mistaken for. */
export const sentinel = (kind: string, index: number | string) =>
  `NON_MEMBERSHIP_FIXTURE_${kind}_${index}`;

/** The reserved address domain every fixture account sits on. */
export const PROOF_DOMAIN = '@membership-proof.invalid';

let sequence = 0;

/* ===========================================================================
 * Identity
 * ========================================================================= */

/**
 * A synthetic account, `…@membership-proof.invalid`. The id fits Membership's
 * account bound (36) and is plain ASCII, so SQL and JavaScript ordering agree.
 */
export async function account(
  admin: SqlSession,
  status: 'active' | 'closed' = 'active',
): Promise<string> {
  sequence += 1;
  const id = `mbr-${String(sequence).padStart(4, '0')}-${randomUUID().slice(0, 8)}`;
  await admin.query(`
    INSERT INTO [dbo].[User]
      ([id], [name], [email], [emailVerified], [createdAt], [updatedAt],
       [locale], [status], [twoFactorEnabled])
    VALUES
      (${n(id)}, ${n(sentinel('ACCOUNT', id))}, ${n(`${id}${PROOF_DOMAIN}`)}, 0,
       SYSUTCDATETIME(), SYSUTCDATETIME(), N'en', ${n(status)}, 0);
  `);
  return id;
}

/* ===========================================================================
 * Words
 * ========================================================================= */

export function label(
  locale: MembershipTypeLabelInput['locale'],
  tag: string,
): MembershipTypeLabelInput {
  return {
    locale,
    title: sentinel(`TITLE_${locale}`, tag),
    summary: sentinel(`SUMMARY_${locale}`, tag),
    description: sentinel(`DESCRIPTION_${locale}`, tag),
    guidance: null,
  };
}

/* ===========================================================================
 * Owner-side states no Membership act produces
 * ========================================================================= */

/** A draft type row WITHOUT its primary locale's words — only the owner can make one. */
export async function wordlessDraft(admin: SqlSession): Promise<string> {
  const id = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[MembershipType] ([id],[state],[primaryLocale],[displayOrder],[version])
    VALUES (${n(id)}, N'draft', N'en', 9000, 1);
  `);
  return id;
}

/**
 * An application the OWNER submitted and moved to `status` step by step —
 * each step the lifecycle the trigger allows — writing no Membership and no
 * intent. The state a proof needs when no Membership act could reach it.
 */
export async function ownerApplication(
  admin: SqlSession,
  accountId: string,
  membershipTypeId: string,
  status: 'submitted' | 'under_review' | 'approved',
): Promise<string> {
  const id = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[MembershipApplication]
      ([id],[applicantUserId],[membershipTypeId],[status],[version],[submittedAt])
    VALUES (${n(id)}, ${n(accountId)}, ${n(membershipTypeId)}, N'submitted', 1, SYSUTCDATETIME());
  `);
  if (status === 'submitted') return id;
  await admin.query(`
    UPDATE [dbo].[MembershipApplication]
    SET [status] = N'under_review', [reviewStartedAt] = SYSUTCDATETIME(), [version] = 2
    WHERE [id] = ${n(id)};
  `);
  if (status === 'under_review') return id;
  await admin.query(`
    UPDATE [dbo].[MembershipApplication]
    SET [status] = N'approved', [decidedAt] = SYSUTCDATETIME(), [version] = 3
    WHERE [id] = ${n(id)};
  `);
  return id;
}

/** An ACTIVE Membership the owner inserts for an approved application. */
export function ownerMembership(
  admin: SqlSession,
  input: {
    readonly id: string;
    readonly accountId: string;
    readonly membershipTypeId: string;
    readonly applicationId: string;
  },
): Promise<unknown> {
  return admin.query(`
    INSERT INTO [dbo].[Membership]
      ([id],[memberUserId],[membershipTypeId],[sourceApplicationId],[status],[version],[activatedAt])
    VALUES (${n(input.id)}, ${n(input.accountId)}, ${n(input.membershipTypeId)},
            ${n(input.applicationId)}, N'active', 1, SYSUTCDATETIME());
  `);
}

/* ===========================================================================
 * Observations
 * ========================================================================= */

export interface IntentRow {
  readonly id: string;
  readonly purpose: string;
  readonly recipientUserId: string;
  readonly applicationId: string | null;
  readonly membershipId: string | null;
  readonly state: string;
  readonly idempotencyKey: string;
}

/** The intents naming one application or Membership, in purpose order. */
export function intentsFor(admin: SqlSession, recordId: string): Promise<IntentRow[]> {
  return admin.query<IntentRow>(`
    SELECT [id],[purpose],[recipientUserId],[applicationId],[membershipId],[state],[idempotencyKey]
    FROM [dbo].[MembershipCommunicationIntent]
    WHERE [applicationId] = ${n(recordId)} OR [membershipId] = ${n(recordId)}
    ORDER BY [purpose], [id];
  `);
}

export interface AuditRow {
  readonly action: string;
  readonly actorId: string | null;
  readonly targetType: string | null;
  readonly targetId: string | null;
  readonly authorisingSource: string | null;
  readonly beforeState: string | null;
  readonly afterState: string | null;
}

/** The audit rows one target received, oldest first. */
export function auditFor(admin: SqlSession, targetId: string): Promise<AuditRow[]> {
  return admin.query<AuditRow>(`
    SELECT [action],[actorId],[targetType],[targetId],[authorisingSource],[beforeState],[afterState]
    FROM [dbo].[AuditLog] WHERE [targetId] = ${n(targetId)} ORDER BY [occurredAt], [id];
  `);
}

/** One application's stored columns. */
export async function applicationColumns(
  admin: SqlSession,
  id: string,
): Promise<
  | {
      readonly status: string;
      readonly version: number;
      readonly withdrawalSource: string | null;
      readonly withdrawnAt: Date | null;
    }
  | undefined
> {
  const [row] = await admin.query<{
    status: string;
    version: number;
    withdrawalSource: string | null;
    withdrawnAt: Date | null;
  }>(`
    SELECT [status],[version],[withdrawalSource],[withdrawnAt]
    FROM [dbo].[MembershipApplication] WHERE [id] = ${n(id)};
  `);
  return row;
}

/* ===========================================================================
 * The world: one disposable database and Membership's REAL adapter over it
 * ========================================================================= */

export interface MembershipWorld {
  readonly db: DisposableDatabase;
  /** A session as the provisioned RUNTIME principal, for grant-floor proofs. */
  readonly app: SqlSession;
  readonly reader: MembershipCatalogueReaderPort;
  readonly catalogue: MembershipCataloguePort;
  readonly applicant: MembershipApplicantPort;
  readonly staff: MembershipStaffPort;
  readonly communication: MembershipCommunicationPort;
  readonly exporter: MembershipExportPort;
  readonly disposition: MembershipDispositionPort;
  close(): Promise<void>;
}

/**
 * Creates the disposable database, provisions the runtime principal, repoints
 * the runtime URL at it and builds Membership's own adapter factories from the
 * package entry the web composition imports — so every write below runs as the
 * least-privilege principal under the real grants, keys and triggers.
 */
export async function membershipWorld(): Promise<MembershipWorld> {
  // Read BEFORE the database exists: creating it repoints `DATABASE_URL`.
  const runtimeSource = getDatabaseRuntimeUrl();
  const db = await createProofDatabase();
  // A failure while wiring must not orphan the database it just made.
  try {
    return await wire(db, runtimeSource);
  } catch (error) {
    await db.close();
    throw error;
  }
}

async function wire(
  db: DisposableDatabase,
  runtimeSource: string,
): Promise<MembershipWorld> {
  const runtimeTarget = parseSqlServerUrl(runtimeSource);
  const runtimeUrl = runtimeSource.replace(
    `database=${runtimeTarget.database}`,
    `database=${db.name}`,
  );
  if (runtimeUrl === runtimeSource)
    throw new Error('The runtime URL could not be repointed at the disposable database.');
  const connection = assertApprovedLocalTarget(
    runtimeUrl,
    localTargetPolicy(process.env, 'disposable', 'runtime'),
  );
  const principal = getApplicationPrincipalCredentials();
  await provisionApplicationPrincipal(
    db.admin,
    principal.DATABASE_APP_LOGIN,
    principal.DATABASE_APP_PASSWORD,
  );
  const app = await openSession(connection);
  process.env['DATABASE_URL'] = runtimeUrl;

  const database = await import('../../packages/database/src/index.ts');
  return {
    db,
    app,
    reader: database.createMembershipCatalogueReader(),
    catalogue: database.createMembershipCatalogue(),
    applicant: database.createMembershipApplicant(),
    staff: database.createMembershipStaff(),
    communication: database.createMembershipCommunication(),
    exporter: database.createMembershipExport(),
    disposition: database.createMembershipDisposition(),
    async close() {
      await app.close();
      await db.close();
    },
  };
}

/* ===========================================================================
 * Shared steps
 * ========================================================================= */

let order = 0;

/** A new PUBLISHED type, created and published through the adapter. */
export async function publishedType(
  world: MembershipWorld,
  actorId: string,
): Promise<string> {
  const id = randomUUID();
  order += 1;
  await world.catalogue.createType({
    id,
    actorId,
    value: { primaryLocale: 'en', displayOrder: order, label: label('en', id) },
  });
  await world.catalogue.transitionType({
    actorId,
    id,
    expectedVersion: 1,
    to: 'published',
  });
  return id;
}

/** A submitted application of the account on the type; its id. */
export async function submitted(
  world: MembershipWorld,
  accountId: string,
  membershipTypeId: string,
): Promise<string> {
  const result = await world.applicant.submit({
    id: randomUUID(),
    accountId,
    membershipTypeId,
  });
  return result.applicationId;
}

/** An application under review (version 2); its id. */
export async function underReview(
  world: MembershipWorld,
  actorId: string,
  accountId: string,
  membershipTypeId: string,
): Promise<string> {
  const id = await submitted(world, accountId, membershipTypeId);
  await world.staff.startReview({ actorId, id, expectedVersion: 1 });
  return id;
}

/** An approved application and the active Membership it created. */
export async function approved(
  world: MembershipWorld,
  actorId: string,
  accountId: string,
  membershipTypeId: string,
): Promise<{ readonly applicationId: string; readonly membershipId: string }> {
  const applicationId = await underReview(world, actorId, accountId, membershipTypeId);
  const membershipId = randomUUID();
  await world.staff.decide({
    actorId,
    id: applicationId,
    expectedVersion: 2,
    decision: 'approve',
    membershipId,
  });
  return { applicationId, membershipId };
}

/** A refusal's reason (`MembershipDataError`), `accepted`, or `unclassified`. */
export async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const named = error as { name?: unknown; reason?: unknown } | null;
    return named?.name === 'MembershipDataError' && typeof named.reason === 'string'
      ? named.reason
      : 'unclassified';
  }
  return 'accepted';
}

/** The SQL error number a raw statement met, or `null` when it succeeded. */
export async function sqlNumber(promise: Promise<unknown>): Promise<number | null> {
  try {
    await promise;
  } catch (error) {
    const number = (error as { number?: unknown } | null)?.number;
    return typeof number === 'number' ? number : -1;
  }
  return null;
}

/** Membership rows of every table, by account — for "nothing else changed" proofs. */
export async function ownedRows(admin: SqlSession, accountId: string): Promise<number> {
  return (
    (await count(admin, 'MembershipApplication', `[applicantUserId] = ${n(accountId)}`)) +
    (await count(admin, 'Membership', `[memberUserId] = ${n(accountId)}`)) +
    (await count(
      admin,
      'MembershipCommunicationIntent',
      `[recipientUserId] = ${n(accountId)}`,
    ))
  );
}
