import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DonationRecord } from '../../packages/contracts/src/donations/index.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import { databaseConfigured } from '../identity/harness.ts';
import {
  PROOF_DOMAIN,
  account,
  activate,
  beginInput,
  capturedDonation,
  closeAccount,
  count,
  createdDonation,
  donationColumns,
  donationsWorld,
  intentsFor,
  n,
  ownedRows,
  publishedCampaign,
  reasonOf,
  refunder,
  refundObservation,
  reserveInput,
  sqlNumber,
  type DonationsWorld,
} from './fixture-sql.ts';

/**
 * Phase 27 — Donations' part of account closure, over a real SQL Server, as the
 * provisioned runtime principal. Whether the account is closed is Identity's
 * answer, asked by the service; these proofs drive the adapter's disposition
 * directly and observe exactly what it changed.
 *
 * FINANCIAL HISTORY IS RETAINED; THE LINK IS RELEASED. What only the database
 * can prove here: that a closed account's owed mail is abandoned and removed;
 * that each of its donations stops naming it — becoming anonymous — while its
 * money, state, provider references, events and refunds stay exactly as they
 * were; that nothing ever re-links a released donation, by address or
 * otherwise; that an account that is not closed is never released; that every
 * other account's rows are untouched; and that the work is bounded, resumable
 * and idempotent, its pending accounts paged by a stable cursor.
 */

const live = databaseConfigured ? describe : describe.skip;

/** Everything a donation holds of money and provider truth, as exact text. */
async function financial(admin: SqlSession, donationId: string): Promise<string> {
  const rows = await admin.query(`
    SELECT [state], CONVERT(NVARCHAR(20), [expectedMinor]) AS [expected],
      CONVERT(NVARCHAR(20), [capturedMinor]) AS [captured],
      CONVERT(NVARCHAR(20), [refundedMinor]) AS [refunded],
      CONVERT(NVARCHAR(20), [refundReservedMinor]) AS [reserved],
      [currency], [checkoutReference], [paymentReference], [dispute], [succeededAt],
      (SELECT COUNT(*) FROM [dbo].[DonationRefund] r WHERE r.[donationId] = d.[id]) AS [refunds],
      (SELECT COUNT(*) FROM [dbo].[DonationProviderEvent] e WHERE e.[donationId] = d.[id]) AS [events]
    FROM [dbo].[Donation] d WHERE d.[id] = ${n(donationId)};
  `);
  return JSON.stringify(rows);
}

live('Phase 27 Donations account-closure disposition against real SQL Server', () => {
  let world: DonationsWorld;
  let admin: SqlSession;
  let operator: string;
  let authority: string;
  let campaign: string;

  beforeAll(async () => {
    world = await donationsWorld();
    admin = world.db.admin;
    await activate(admin);
    operator = await account(admin);
    authority = await refunder(admin);
    campaign = (await publishedCampaign(world, operator)).id;
  }, 300_000);

  afterAll(async () => {
    await world?.close();
  });

  it('releases the link and removes owed mail, keeping every donation, event and refund', async () => {
    const closing = await account(admin);
    const other = await account(admin);

    // A refunded capture with its event, a pending attempt, and owed mail —
    // one intent already relayed, one held under a dispatcher's claim.
    const refunded = await capturedDonation(world, campaign, { donorAccountId: closing });
    const reserved = await world.refunds.reserve(reserveInput(refunded, authority, 500n));
    await world.ledger.applyRefundObservation({
      refundId: reserved.refund.id,
      observation: refundObservation(refunded, reserved.refund.id, 500n),
      now: new Date(),
    });
    await world.ledger.admitEvent({
      notice: {
        scope: refunded.scope,
        eventId: `evt_fixture_closure_${refunded.id}`,
        eventType: 'charge.refunded',
        occurredAt: new Date(),
        payloadDigest: '0'.repeat(64),
      },
      receivedAt: new Date(),
    });
    await world.ledger.completeEvent({
      scope: refunded.scope,
      eventId: `evt_fixture_closure_${refunded.id}`,
      donationId: refunded.id,
      result: 'applied',
      now: new Date(),
    });
    const pending = await createdDonation(world, campaign, { donorAccountId: closing });
    const [succeededIntent] = await intentsFor(admin, refunded.id);
    await world.communication.markRelayed(succeededIntent?.id ?? '', new Date());
    await world.communication.claimDue(new Date(Date.now() + 60_000), 100, 600);

    const theirs = await capturedDonation(world, campaign, { donorAccountId: other });
    const theirRows = await ownedRows(admin, other);
    const before = {
      refunded: await financial(admin, refunded.id),
      pending: await financial(admin, pending.id),
      theirs: await financial(admin, theirs.id),
    };
    const donationsBefore = await count(admin, 'Donation');
    const refundsBefore = await count(admin, 'DonationRefund');
    const eventsBefore = await count(admin, 'DonationProviderEvent');

    // Not closed: the release is refused and nothing moves.
    expect(await reasonOf(world.disposition.disposeAccount(closing, 100))).toBe(
      'invalid-state',
    );
    expect(await ownedRows(admin, closing)).toBe(4);

    await closeAccount(admin, closing);
    const changed = await world.disposition.disposeAccount(closing, 100);
    // Two intents removed, two donations released.
    expect(changed).toBe(4);

    for (const id of [refunded.id, pending.id]) {
      const columns = await donationColumns(admin, id);
      expect(columns?.donorUserId).toBeNull();
      expect(columns?.donorReleasedAt).not.toBeNull();
    }
    expect((await donationColumns(admin, refunded.id))?.version).toBe(
      refunded.version + 3,
    );
    expect(await financial(admin, refunded.id)).toBe(before.refunded);
    expect(await financial(admin, pending.id)).toBe(before.pending);
    expect(await intentsFor(admin, refunded.id)).toEqual([]);
    expect(await ownedRows(admin, closing)).toBe(0);
    expect(await count(admin, 'Donation')).toBe(donationsBefore);
    expect(await count(admin, 'DonationRefund')).toBe(refundsBefore);
    expect(await count(admin, 'DonationProviderEvent')).toBe(eventsBefore);

    // Everyone else's rows are untouched.
    expect(await ownedRows(admin, other)).toBe(theirRows);
    expect(await financial(admin, theirs.id)).toBe(before.theirs);
    expect((await donationColumns(admin, theirs.id))?.donorUserId).toBe(other);

    // The released donations are anonymous now, to their former owner too.
    expect(await world.owner.history(closing, 50)).toEqual([]);
    expect(await world.owner.exportRows(closing)).toEqual([]);
    const released = (await world.ledger.donation(refunded.id)) as DonationRecord;
    expect(released).toMatchObject({
      linked: false,
      state: 'partially_refunded',
      refundedMinor: 500n,
    });

    // Idempotent: nothing left to do.
    expect(await world.disposition.disposeAccount(closing, 100)).toBe(0);
  });

  it('never re-links a released donation, by address or otherwise', async () => {
    const closing = await account(admin);
    const donation = await capturedDonation(world, campaign, { donorAccountId: closing });
    const [{ email } = { email: '' }] = await admin.query<{ email: string }>(
      `SELECT [email] FROM [dbo].[User] WHERE [id] = ${n(closing)};`,
    );
    expect(email.endsWith(PROOF_DOMAIN)).toBe(true);
    await closeAccount(admin, closing);
    await world.disposition.disposeAccount(closing, 100);

    // The same person returns under a NEW account, at the same address once the
    // old one gave it up: nothing of the released donation follows them.
    await admin.query(
      `UPDATE [dbo].[User] SET [email] = ${n(`released-${closing}${PROOF_DOMAIN}`)} WHERE [id] = ${n(closing)};`,
    );
    const returning = await account(admin);
    await admin.query(
      `UPDATE [dbo].[User] SET [email] = ${n(email)} WHERE [id] = ${n(returning)};`,
    );
    expect(await world.owner.history(returning, 50)).toEqual([]);
    expect((await donationColumns(admin, donation.id))?.donorUserId).toBeNull();
    // A retried begin of the same operation for the new account is a different request.
    expect(
      await reasonOf(
        world.donor.begin(
          beginInput(campaign, { id: donation.id, donorAccountId: returning }),
        ),
      ),
    ).not.toBe('accepted');
    // And the database refuses any write that would name a donor again: with
    // its release instant kept, the facts CHECK; with it cleared, the trigger.
    expect(
      await sqlNumber(
        world.app.query(
          `UPDATE [dbo].[Donation] SET [donorUserId] = ${n(returning)}, [version] = [version] + 1 WHERE [id] = ${n(donation.id)};`,
        ),
      ),
    ).toBe(547);
    expect(
      await sqlNumber(
        world.app.query(
          `UPDATE [dbo].[Donation] SET [donorUserId] = ${n(returning)}, [donorReleasedAt] = NULL, [version] = [version] + 1 WHERE [id] = ${n(donation.id)};`,
        ),
      ),
    ).toBe(51350);
    expect((await donationColumns(admin, donation.id))?.donorUserId).toBeNull();
    expect(await world.disposition.accountsWithData(null, 1000)).not.toContain(closing);
  });

  it('works in bounded, resumable batches', async () => {
    const closing = await account(admin);
    const ids: string[] = [];
    for (let index = 0; index < 3; index += 1)
      ids.push((await capturedDonation(world, campaign, { donorAccountId: closing })).id);
    expect(await ownedRows(admin, closing)).toBe(6);
    await closeAccount(admin, closing);

    // One row per step: an interrupted disposal resumes from where it stopped.
    let steps = 0;
    let changed: number;
    do {
      changed = await world.disposition.disposeAccount(closing, 1);
      expect(changed).toBeLessThanOrEqual(2);
      steps += 1;
    } while (changed > 0 && steps < 20);
    expect(steps).toBeGreaterThan(2);
    expect(await ownedRows(admin, closing)).toBe(0);
    for (const id of ids)
      expect((await donationColumns(admin, id))?.donorReleasedAt).not.toBeNull();
  });

  it('pages the accounts that still hold data by a stable ascending cursor', async () => {
    const holders = [await account(admin), await account(admin), await account(admin)];
    for (const holder of holders)
      await createdDonation(world, campaign, { donorAccountId: holder });
    const seen: string[] = [];
    let after: string | null = null;
    for (let page = 0; page < 100; page += 1) {
      const batch = await world.disposition.accountsWithData(after, 2);
      if (batch.length === 0) break;
      expect(batch.length).toBeLessThanOrEqual(2);
      if (after !== null) for (const id of batch) expect(id > after).toBe(true);
      seen.push(...batch);
      after = batch.at(-1) ?? null;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect([...seen].sort()).toEqual(seen);
    for (const holder of holders) expect(seen).toContain(holder);

    // A disposed account leaves the list.
    const [first] = holders;
    await closeAccount(admin, first ?? '');
    await world.disposition.disposeAccount(first ?? '', 100);
    expect(await world.disposition.accountsWithData(null, 1000)).not.toContain(first);
  });
});
