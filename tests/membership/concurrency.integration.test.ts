import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import { databaseConfigured } from '../identity/harness.ts';
import {
  account,
  applicationColumns,
  approved,
  auditFor,
  count,
  intentsFor,
  membershipWorld,
  n,
  ownerApplication,
  ownerMembership,
  publishedType,
  reasonOf,
  sqlNumber,
  submitted,
  underReview,
  type MembershipWorld,
} from './fixture-sql.ts';

/**
 * Phase 26 — Membership's invariants under REAL concurrency, over a real SQL
 * Server, as the provisioned runtime principal. Every race below starts its
 * competitors together on separate pooled connections, each in its own
 * transaction, and asserts only the FINAL state — never who won or when.
 *
 * WHAT ONLY THE DATABASE CAN PROVE HERE: that the account-and-type lock and
 * the filtered keys beneath it leave one open application, one decision, one
 * active Membership and one owed message whatever interleaving the server
 * chose; that a type archive and a new application are ordered rather than
 * both half-applied; and that every loser is told a business answer
 * (`conflict`, `invalid-state`, `type-unavailable`) or, at worst, nothing
 * changed — never a second record.
 */

const live = databaseConfigured ? describe : describe.skip;

/** Every competitor's outcome: `accepted` or the refusal reason. */
function outcomes(promises: readonly Promise<unknown>[]): Promise<string[]> {
  return Promise.all(promises.map((promise) => reasonOf(promise)));
}

live('Phase 26 Membership concurrency against real SQL Server', () => {
  let world: MembershipWorld;
  let admin: SqlSession;
  let operator: string;

  beforeAll(async () => {
    world = await membershipWorld();
    admin = world.db.admin;
    operator = await account(admin);
  }, 300_000);

  afterAll(async () => {
    await world?.close();
  });

  it('leaves one open application when duplicate submissions race', async () => {
    const type = await publishedType(world, operator);
    const person = await account(admin);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        world.applicant.submit({
          id: randomUUID(),
          accountId: person,
          membershipTypeId: type,
        }),
      ),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.applicationId)).size).toBe(1);
    expect(
      await count(admin, 'MembershipApplication', `[applicantUserId] = ${n(person)}`),
    ).toBe(1);
    expect(
      await count(
        admin,
        'MembershipCommunicationIntent',
        `[recipientUserId] = ${n(person)}`,
      ),
    ).toBe(1);
  });

  it('lets one of a withdrawal and a review start win', async () => {
    const type = await publishedType(world, operator);
    const person = await account(admin);
    const id = await submitted(world, person, type);
    const results = await outcomes([
      world.applicant.withdraw({ accountId: person, id, expectedVersion: 1 }),
      world.staff.startReview({ actorId: operator, id, expectedVersion: 1 }),
    ]);
    expect(results.filter((result) => result === 'accepted')).toHaveLength(1);
    expect(results.filter((result) => result !== 'accepted')).toEqual(['conflict']);
    const row = await applicationColumns(admin, id);
    expect(row?.version).toBe(2);
    expect(['withdrawn', 'under_review']).toContain(row?.status);
    const purposes = (await intentsFor(admin, id)).map((intent) => intent.purpose);
    expect(purposes).toHaveLength(2);
    expect(purposes).toContain(
      row?.status === 'withdrawn'
        ? 'membership.application.withdrawn'
        : 'membership.application.under-review',
    );
  });

  it('lets one of a withdrawal and an approval win, with a Membership only for the approval', async () => {
    const type = await publishedType(world, operator);
    const person = await account(admin);
    const id = await underReview(world, operator, person, type);
    const results = await outcomes([
      world.applicant.withdraw({ accountId: person, id, expectedVersion: 2 }),
      world.staff.decide({
        actorId: operator,
        id,
        expectedVersion: 2,
        decision: 'approve',
        membershipId: randomUUID(),
      }),
    ]);
    expect(results.filter((result) => result === 'accepted')).toHaveLength(1);
    expect(results.filter((result) => result !== 'accepted')).toEqual(['conflict']);
    const row = await applicationColumns(admin, id);
    expect(row?.version).toBe(3);
    expect(await count(admin, 'Membership', `[sourceApplicationId] = ${n(id)}`)).toBe(
      row?.status === 'approved' ? 1 : 0,
    );
    expect(['withdrawn', 'approved']).toContain(row?.status);
  });

  it('creates one Membership when two approvals race', async () => {
    const type = await publishedType(world, operator);
    const person = await account(admin);
    const id = await underReview(world, operator, person, type);
    const results = await outcomes(
      [randomUUID(), randomUUID(), randomUUID()].map((membershipId) =>
        world.staff.decide({
          actorId: operator,
          id,
          expectedVersion: 2,
          decision: 'approve',
          membershipId,
        }),
      ),
    );
    expect(results.filter((result) => result === 'accepted')).toHaveLength(1);
    expect(results.filter((result) => result !== 'accepted')).toEqual([
      'conflict',
      'conflict',
    ]);
    expect(await count(admin, 'Membership', `[memberUserId] = ${n(person)}`)).toBe(1);
    expect(
      (await intentsFor(admin, id)).filter(
        (intent) => intent.purpose === 'membership.application.approved',
      ),
    ).toHaveLength(1);
    expect(
      (await auditFor(admin, id)).filter(
        (row) => row.action === 'membership.application.approved',
      ),
    ).toHaveLength(1);
  });

  it('records one decision when an approval and a rejection race', async () => {
    const type = await publishedType(world, operator);
    const person = await account(admin);
    const id = await underReview(world, operator, person, type);
    const results = await outcomes(
      (['approve', 'reject'] as const).map((decision) =>
        world.staff.decide({
          actorId: operator,
          id,
          expectedVersion: 2,
          decision,
          membershipId: randomUUID(),
        }),
      ),
    );
    expect(results.filter((result) => result === 'accepted')).toHaveLength(1);
    const row = await applicationColumns(admin, id);
    expect(row?.version).toBe(3);
    expect(await count(admin, 'Membership', `[sourceApplicationId] = ${n(id)}`)).toBe(
      row?.status === 'approved' ? 1 : 0,
    );
    const decided = (await auditFor(admin, id)).filter((audit) =>
      ['membership.application.approved', 'membership.application.rejected'].includes(
        audit.action,
      ),
    );
    expect(decided.map((audit) => audit.action)).toEqual([
      `membership.application.${row?.status}`,
    ]);
  });

  it('creates nothing more when an approval is replayed, alone or in a burst', async () => {
    const type = await publishedType(world, operator);
    const person = await account(admin);
    const { applicationId } = await approved(world, operator, person, type);
    const results = await outcomes(
      Array.from({ length: 3 }, () =>
        world.staff.decide({
          actorId: operator,
          id: applicationId,
          expectedVersion: 2,
          decision: 'approve',
          membershipId: randomUUID(),
        }),
      ),
    );
    expect(results).toEqual(['conflict', 'conflict', 'conflict']);
    expect(await count(admin, 'Membership', `[memberUserId] = ${n(person)}`)).toBe(1);
    expect(await intentsFor(admin, applicationId)).toHaveLength(3);
  });

  it('closes a Membership once when the member and an operator close it together', async () => {
    const type = await publishedType(world, operator);
    const person = await account(admin);
    const { membershipId } = await approved(world, operator, person, type);
    const results = await outcomes([
      world.applicant.closeOwn({
        accountId: person,
        id: membershipId,
        expectedVersion: 1,
      }),
      world.staff.closeMembership({
        actorId: operator,
        id: membershipId,
        expectedVersion: 1,
      }),
      world.applicant.closeOwn({
        accountId: person,
        id: membershipId,
        expectedVersion: 1,
      }),
    ]);
    expect(results.filter((result) => result === 'accepted')).toHaveLength(1);
    expect(results.filter((result) => result !== 'accepted')).toEqual([
      'conflict',
      'conflict',
    ]);
    const [row] = await admin.query<{
      status: string;
      version: number;
      closureSource: string;
    }>(
      `SELECT [status],[version],[closureSource] FROM [dbo].[Membership] WHERE [id] = ${n(membershipId)};`,
    );
    expect(row).toMatchObject({ status: 'closed', version: 2 });
    // One closure message, and an audit row exactly when the operator won.
    expect(await intentsFor(admin, membershipId)).toHaveLength(1);
    expect((await auditFor(admin, membershipId)).length).toBe(
      row?.closureSource === 'operator' ? 1 : 0,
    );
  });

  it('orders a type archive and a new application rather than half-applying either', async () => {
    for (let round = 0; round < 3; round += 1) {
      const type = await publishedType(world, operator);
      const person = await account(admin);
      const [submission, archive] = await outcomes([
        world.applicant.submit({
          id: randomUUID(),
          accountId: person,
          membershipTypeId: type,
        }),
        world.catalogue.transitionType({
          actorId: operator,
          id: type,
          expectedVersion: 2,
          to: 'archived',
        }),
      ]);
      expect(archive).toBe('accepted');
      expect(['accepted', 'type-unavailable']).toContain(submission);
      expect(
        await count(admin, 'MembershipApplication', `[applicantUserId] = ${n(person)}`),
      ).toBe(submission === 'accepted' ? 1 : 0);
      expect(
        await count(
          admin,
          'MembershipCommunicationIntent',
          `[recipientUserId] = ${n(person)}`,
        ),
      ).toBe(submission === 'accepted' ? 1 : 0);
      expect((await world.catalogue.type(type))?.state).toBe('archived');
    }
  });

  it('refuses a second ACTIVE Membership of one account and type at the key, even for the owner', async () => {
    const type = await publishedType(world, operator);
    const person = await account(admin);
    const first = await ownerApplication(admin, person, type, 'approved');
    const second = await ownerApplication(admin, person, type, 'approved');
    await ownerMembership(admin, {
      id: randomUUID(),
      accountId: person,
      membershipTypeId: type,
      applicationId: first,
    });
    let refusal: { number?: unknown; message?: unknown } | null = null;
    try {
      await ownerMembership(admin, {
        id: randomUUID(),
        accountId: person,
        membershipTypeId: type,
        applicationId: second,
      });
    } catch (error) {
      refusal = error as { number?: unknown; message?: unknown };
    }
    expect(refusal?.number).toBe(2601);
    expect(String(refusal?.message)).toContain('Membership_active_key');
    expect(
      await count(
        admin,
        'Membership',
        `[memberUserId] = ${n(person)} AND [status] = N'active'`,
      ),
    ).toBe(1);
    // The same floor beneath an open application.
    expect(
      await sqlNumber(
        admin.query(`
          INSERT INTO [dbo].[MembershipApplication] ([id],[applicantUserId],[membershipTypeId],[status],[version],[submittedAt])
          SELECT NEWID(), ${n(person)}, ${n(type)}, N'submitted', 1, SYSUTCDATETIME();`),
      ),
    ).toBe(51323);
  });

  it('reports a lock it could not get as unavailable — never a business refusal — and writes nothing', async () => {
    const type = await publishedType(world, operator);
    const person = await account(admin);
    const resource = `membership:${person}:${type}`;
    // The owner holds the account-and-type lock in one batch, long enough to
    // outlast the adapter's own wait.
    const holder = admin.query(`
      BEGIN TRAN;
      EXEC sys.sp_getapplock @Resource = ${n(resource)}, @LockMode = 'Exclusive',
        @LockOwner = 'Transaction', @LockTimeout = 0;
      WAITFOR DELAY '00:00:12';
      ROLLBACK;`);
    // Wait until it is HELD — asked of the database, not guessed from a clock.
    const held = async () => {
      const [row] = await world.app.query<{ granted: number }>(`
        BEGIN TRAN;
        DECLARE @granted int;
        EXEC @granted = sys.sp_getapplock @Resource = ${n(resource)}, @LockMode = 'Exclusive',
          @LockOwner = 'Transaction', @LockTimeout = 0;
        ROLLBACK;
        SELECT @granted AS [granted];`);
      return Number(row?.granted) < 0;
    };
    for (let attempt = 0; !(await held()); attempt += 1)
      if (attempt > 200) throw new Error('The fixture lock was never taken.');

    expect(
      await reasonOf(
        world.applicant.submit({
          id: randomUUID(),
          accountId: person,
          membershipTypeId: type,
        }),
      ),
    ).toBe('unavailable');
    await holder;
    expect(
      await count(admin, 'MembershipApplication', `[applicantUserId] = ${n(person)}`),
    ).toBe(0);
    // Once the lock is free, the same act succeeds.
    expect(
      (
        await world.applicant.submit({
          id: randomUUID(),
          accountId: person,
          membershipTypeId: type,
        })
      ).created,
    ).toBe(true);
  }, 60_000);

  it('owes each message once however often its transition is retried', async () => {
    const type = await publishedType(world, operator);
    const person = await account(admin);
    const id = await submitted(world, person, type);
    const reviews = await outcomes(
      Array.from({ length: 4 }, () =>
        world.staff.startReview({ actorId: operator, id, expectedVersion: 1 }),
      ),
    );
    expect(reviews.filter((result) => result === 'accepted')).toHaveLength(1);
    const withdrawals = await outcomes(
      Array.from({ length: 4 }, () =>
        world.applicant.withdraw({ accountId: person, id, expectedVersion: 2 }),
      ),
    );
    expect(withdrawals.filter((result) => result === 'accepted')).toHaveLength(1);
    const purposes = (await intentsFor(admin, id)).map((intent) => intent.purpose);
    expect(purposes).toEqual([
      'membership.application.submitted',
      'membership.application.under-review',
      'membership.application.withdrawn',
    ]);
  });
});
