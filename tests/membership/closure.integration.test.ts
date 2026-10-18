import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import { databaseConfigured } from '../identity/harness.ts';
import {
  account,
  applicationColumns,
  approved,
  count,
  intentsFor,
  membershipWorld,
  n,
  ownedRows,
  publishedType,
  submitted,
  underReview,
  type MembershipWorld,
} from './fixture-sql.ts';

/**
 * Phase 26 — Membership's part of account closure, over a real SQL Server, as
 * the provisioned runtime principal. Whether the account is closed is
 * Identity's answer, asked by the service; these proofs drive the adapter's
 * disposition directly and observe exactly what it changed.
 *
 * CLOSING THE LOGIN ACCOUNT IS NOT RESIGNING THE MEMBERSHIP. What only the
 * database can prove here: that the closed account's OPEN applications are
 * withdrawn as `account-closure` and owe no mail; that every intent still
 * owed to it is abandoned and then removed; that its active Membership, its
 * decided applications and every other account's rows are untouched; and
 * that the work is bounded, resumable from any interruption, and idempotent.
 */

const live = databaseConfigured ? describe : describe.skip;

live('Phase 26 Membership account-closure disposition against real SQL Server', () => {
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

  it('withdraws open applications and removes owed mail, never resigning a Membership', async () => {
    const one = await publishedType(world, operator);
    const two = await publishedType(world, operator);
    const three = await publishedType(world, operator);
    const four = await publishedType(world, operator);
    const closing = await account(admin, 'closed');
    const other = await account(admin);

    const open = await submitted(world, closing, one);
    const reviewing = await underReview(world, operator, closing, two);
    const membership = await approved(world, operator, closing, three);
    const rejected = await underReview(world, operator, closing, four);
    await world.staff.decide({
      actorId: operator,
      id: rejected,
      expectedVersion: 2,
      decision: 'reject',
      membershipId: randomUUID(),
    });
    // One intent the dispatcher already relayed, and one it holds under a claim.
    const [relayedIntent] = await intentsFor(admin, open);
    await world.communication.markRelayed(relayedIntent?.id ?? '');
    await world.communication.claimDue(new Date(Date.now() + 60_000), 100, 600);

    const theirs = await submitted(world, other, one);
    const theirMembership = await approved(world, operator, other, two);
    const theirRows = await ownedRows(admin, other);
    const intentsBefore = await count(
      admin,
      'MembershipCommunicationIntent',
      `[recipientUserId] = ${n(closing)}`,
    );
    expect(intentsBefore).toBeGreaterThan(2);

    const owners = await world.disposition.accountsWithData(null, 1_000);
    expect(owners).toContain(closing);
    expect(owners).toContain(other);
    expect(owners).toEqual([...owners].sort());

    // BOUNDED AND RESUMABLE: one row per step, as many steps as it takes.
    let steps = 0;
    let changed = 0;
    for (;;) {
      const step = await world.disposition.disposeAccount(closing, 1);
      expect(step).toBeLessThanOrEqual(2);
      if (step === 0) break;
      changed += step;
      steps += 1;
      expect(steps).toBeLessThan(50);
    }
    expect(steps).toBeGreaterThan(1);
    expect(changed).toBe(2 + intentsBefore);

    for (const id of [open, reviewing]) {
      const row = await applicationColumns(admin, id);
      expect(row).toMatchObject({
        status: 'withdrawn',
        withdrawalSource: 'account-closure',
      });
      expect(row?.withdrawnAt).not.toBeNull();
    }
    expect((await applicationColumns(admin, open))?.version).toBe(2);
    expect((await applicationColumns(admin, reviewing))?.version).toBe(3);
    // Account-closure owes nothing, and nothing owed remains.
    expect(
      await count(
        admin,
        'MembershipCommunicationIntent',
        `[recipientUserId] = ${n(closing)}`,
      ),
    ).toBe(0);
    // The Membership stands; the decided applications are as they were.
    expect(
      await count(
        admin,
        'Membership',
        `[id] = ${n(membership.membershipId)} AND [status] = N'active' AND [version] = 1`,
      ),
    ).toBe(1);
    expect(await applicationColumns(admin, rejected)).toMatchObject({
      status: 'rejected',
      version: 3,
    });
    expect(await applicationColumns(admin, membership.applicationId)).toMatchObject({
      status: 'approved',
      version: 3,
    });
    // The relayed intent is gone, so its later send finds nothing.
    expect(await world.communication.deliverySource(relayedIntent?.id ?? '')).toBeNull();

    // Another account is untouched.
    expect(await ownedRows(admin, other)).toBe(theirRows);
    expect((await applicationColumns(admin, theirs))?.status).toBe('submitted');
    expect(
      await count(
        admin,
        'Membership',
        `[id] = ${n(theirMembership.membershipId)} AND [status] = N'active'`,
      ),
    ).toBe(1);
    expect(
      await count(
        admin,
        'MembershipCommunicationIntent',
        `[recipientUserId] = ${n(other)} AND [state] <> N'abandoned'`,
      ),
    ).toBe(theirRows - 3);

    // IDEMPOTENT: a repeat finds nothing to do.
    expect(await world.disposition.disposeAccount(closing, 1_000)).toBe(0);
    expect(await world.disposition.disposeAccount(closing, 1)).toBe(0);
    // The account no longer holds disposable rows, though it is still a member.
    const after = await world.disposition.accountsWithData(null, 1_000);
    expect(after).not.toContain(closing);
    expect(after).toContain(other);
    // A re-application would be the account's own act; nothing of its history
    // is changed by the repeat.
    expect(await world.exporter.collect(closing)).toMatchObject({
      memberships: [
        expect.objectContaining({ id: membership.membershipId, status: 'active' }),
      ],
    });
  });

  it('lists accounts holding disposable rows in id order, resuming after a cursor', async () => {
    const type = await publishedType(world, operator);
    const accounts = [await account(admin), await account(admin), await account(admin)];
    for (const person of accounts) await submitted(world, person, type);
    // A member with no open application and no owed mail holds nothing disposable.
    const member = await account(admin);
    const { applicationId, membershipId } = await approved(world, operator, member, type);
    await admin.query(
      `DELETE FROM [dbo].[MembershipCommunicationIntent] WHERE [recipientUserId] = ${n(member)};`,
    );
    expect((await intentsFor(admin, applicationId)).length).toBe(0);
    expect((await intentsFor(admin, membershipId)).length).toBe(0);

    const all = await world.disposition.accountsWithData(null, 1_000);
    expect(all).toEqual([...all].sort());
    for (const person of accounts) expect(all).toContain(person);
    expect(all).not.toContain(member);

    const [first] = await world.disposition.accountsWithData(null, 1);
    expect(first).toBe(all[0]);
    const rest = await world.disposition.accountsWithData(first ?? null, 1_000);
    expect(rest).toEqual(all.slice(1));
  });
});
