import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { DonationRecord } from '../../packages/contracts/src/donations/index.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import { databaseConfigured } from '../identity/harness.ts';
import {
  SCOPE,
  account,
  activate,
  beginInput,
  capturedDonation,
  closeAccount,
  count,
  createdDonation,
  digest,
  donationColumns,
  donationsWorld,
  intentsFor,
  n,
  observation,
  outcomes,
  publishedCampaign,
  reasonOf,
  refunder,
  refundObservation,
  reserveInput,
  type DonationsWorld,
} from './fixture-sql.ts';

/**
 * Phase 27 — Donations' money invariants under REAL concurrency, over a real
 * SQL Server, as the provisioned runtime principal. Every race below starts
 * its competitors together on separate pooled connections, each in its own
 * transaction, and asserts only the FINAL state — never who won or when.
 *
 * WHAT ONLY THE DATABASE CAN PROVE HERE: that the operation keys, the campaign
 * lock, the donation row lock and the refund triggers beneath them leave one
 * donation per operation, refunds that never exceed the capture, one effect
 * per refund operation, provider truth that converges to the capture whatever
 * order its observations commit in, one dedup record per event, a campaign
 * archive and an initiation that are ordered rather than half-applied, a
 * closed account that can never begin a linked donation, sweeper leases that
 * never overlap, and owed mail committed exactly once under retries.
 */

const live = databaseConfigured ? describe : describe.skip;

/** A row count as a number. */
function total(rows: readonly { total: number | string }[]): number {
  return Number(rows[0]?.total ?? -1);
}

live('Phase 27 Donations concurrency against real SQL Server', () => {
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

  /** The live (requested, pending, succeeded) refunds of one donation, as minor units. */
  async function liveRefunds(donationId: string): Promise<bigint> {
    const rows = await admin.query<{ total: string | null }>(
      `SELECT CONVERT(NVARCHAR(20), SUM([amountMinor])) AS [total] FROM [dbo].[DonationRefund]
       WHERE [donationId] = ${n(donationId)} AND [state] IN (N'requested', N'pending', N'succeeded');`,
    );
    return BigInt(rows[0]?.total ?? '0');
  }

  it('leaves one donation when duplicate submissions of one operation race', async () => {
    const input = beginInput(campaign);
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        world.donor.begin({
          ...input,
          id: randomUUID(),
          statusTokenDigest: digest(randomUUID()),
        }),
      ),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.donation.id)).size).toBe(1);
    expect(
      await count(admin, 'Donation', `[operationId] = ${n(input.operationId)}`),
    ).toBe(1);
  });

  it('never lets two partial refunds exceed the capture', async () => {
    const donation = await capturedDonation(world, campaign);
    // Both at the current version: one wins, the other is told why.
    const first = await outcomes([
      world.refunds.reserve(reserveInput(donation, authority, 1500n)),
      world.refunds.reserve(reserveInput(donation, authority, 1500n)),
    ]);
    expect(first.filter((result) => result === 'accepted')).toHaveLength(1);
    expect(['conflict', 'over-refund']).toContain(
      first.find((result) => result !== 'accepted'),
    );
    // Both at the NEW version: whichever lands, the second cannot exceed what remains.
    const current = (await world.ledger.donation(donation.id)) as DonationRecord;
    const second = await outcomes([
      world.refunds.reserve(reserveInput(current, authority, 1000n)),
      world.refunds.reserve(reserveInput(current, authority, 1000n)),
      world.refunds.reserve(reserveInput(current, authority, 1000n)),
    ]);
    expect(second.filter((result) => result === 'accepted')).toHaveLength(1);
    const reserved = await liveRefunds(donation.id);
    expect(reserved).toBe(2500n);
    expect((await donationColumns(admin, donation.id))?.refundReservedMinor).toBe('2500');
    const settled = (await world.ledger.donation(donation.id)) as DonationRecord;
    expect(
      await reasonOf(world.refunds.reserve(reserveInput(settled, authority, 1n))),
    ).toBe('over-refund');
  });

  it('never lets a full refund racing a partial one exceed the capture', async () => {
    const donation = await capturedDonation(world, campaign);
    const results = await outcomes([
      world.refunds.reserve(reserveInput(donation, authority, 2500n)),
      world.refunds.reserve(reserveInput(donation, authority, 1000n)),
    ]);
    expect(results.filter((result) => result === 'accepted')).toHaveLength(1);
    const reserved = await liveRefunds(donation.id);
    expect([2500n, 1000n]).toContain(reserved);
    expect(reserved).toBeLessThanOrEqual(2500n);
    expect((await donationColumns(admin, donation.id))?.refundReservedMinor).toBe(
      reserved.toString(),
    );
  });

  it('gives a duplicated refund operation one effect', async () => {
    const donation = await capturedDonation(world, campaign);
    const input = reserveInput(donation, authority, 700n);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        world.refunds.reserve({ ...input, refundId: randomUUID() }),
      ),
    );
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(new Set(results.map((result) => result.refund.id)).size).toBe(1);
    expect(
      await count(admin, 'DonationRefund', `[operationId] = ${n(input.operationId)}`),
    ).toBe(1);
    expect((await donationColumns(admin, donation.id))?.refundReservedMinor).toBe('700');
  });

  it('converges racing success, expiry and stale pending observations to the capture', async () => {
    const donor = await account(admin);
    for (let round = 0; round < 3; round += 1) {
      const donation = await createdDonation(world, campaign, { donorAccountId: donor });
      const apply = (overrides: Parameters<typeof observation>[1]) =>
        world.ledger.applyObservation({
          donationId: donation.id,
          observation: observation(donation, overrides),
          source: 'webhook',
          actorId: null,
          now: new Date(),
        });
      const results = await outcomes([
        apply({
          checkout: 'expired',
          payment: 'none',
          paymentReference: null,
          capturedMinor: null,
        }),
        apply({}),
        apply({ checkout: 'open', payment: 'processing', capturedMinor: null }),
        apply({}),
        apply({ checkout: 'complete', payment: 'failed', capturedMinor: null }),
      ]);
      // Serialised on the donation's row lock: every application lands, in some order.
      expect(results).toEqual([
        'accepted',
        'accepted',
        'accepted',
        'accepted',
        'accepted',
      ]);
      // The provider's final truth, re-applied: converged on the capture.
      await apply({});
      const final = await donationColumns(admin, donation.id);
      expect(final).toMatchObject({
        state: 'succeeded',
        capturedMinor: '2500',
        attention: null,
      });
      expect(
        (await intentsFor(admin, donation.id)).map((intent) => intent.purpose),
      ).toEqual(['donation.succeeded']);
    }
  });

  it('admits one dedup record when duplicate deliveries of one event race', async () => {
    const notice = {
      scope: SCOPE,
      eventId: `evt_fixture_${randomUUID()}`,
      eventType: 'payment_intent.succeeded',
      occurredAt: new Date(),
      payloadDigest: digest('race-event'),
    };
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        world.ledger.admitEvent({ notice, receivedAt: new Date() }),
      ),
    );
    // None completed yet, so every delivery may proceed — onto ONE record.
    expect(new Set(results)).toEqual(new Set(['process']));
    expect(
      await count(admin, 'DonationProviderEvent', `[eventId] = ${n(notice.eventId)}`),
    ).toBe(1);
    // Completion races: one completion stands.
    await Promise.all(
      (['applied', 'unchanged', 'attention'] as const).map((result) =>
        world.ledger.completeEvent({
          scope: SCOPE,
          eventId: notice.eventId,
          donationId: null,
          result,
          now: new Date(),
        }),
      ),
    );
    const rows = await admin.query<{ result: string | null }>(
      `SELECT [result] FROM [dbo].[DonationProviderEvent] WHERE [eventId] = ${n(notice.eventId)};`,
    );
    expect(rows).toHaveLength(1);
    expect(['applied', 'unchanged', 'attention']).toContain(rows[0]?.result);
    expect(await world.ledger.admitEvent({ notice, receivedAt: new Date() })).toBe(
      'already-processed',
    );
  });

  it('orders an archive and an initiation: a donation stands only if it began first', async () => {
    for (let round = 0; round < 4; round += 1) {
      const { id, version } = await publishedCampaign(world, operator);
      const inputs = Array.from({ length: 3 }, () => beginInput(id));
      const results = await outcomes([
        world.campaigns.transitionCampaign({
          actorId: operator,
          id,
          expectedVersion: version,
          to: 'archived',
        }),
        ...inputs.map((input) => world.donor.begin(input)),
      ]);
      expect(results[0]).toBe('accepted');
      for (const result of results.slice(1))
        expect(['accepted', 'campaign-unavailable']).toContain(result);
      const begun = results.slice(1).filter((result) => result === 'accepted').length;
      expect(await count(admin, 'Donation', `[campaignId] = ${n(id)}`)).toBe(begun);
      // Every donation that stands was created before the archive committed.
      const [ordering] = await admin.query<{ late: number }>(
        `SELECT COUNT(*) AS [late] FROM [dbo].[Donation] d JOIN [dbo].[DonationCampaign] c ON c.[id] = d.[campaignId]
         WHERE c.[id] = ${n(id)} AND d.[createdAt] > c.[archivedAt];`,
      );
      expect(Number(ordering?.late)).toBe(0);
      // After the archive, nothing more begins.
      expect(await outcomes([world.donor.begin(beginInput(id))])).toEqual([
        'campaign-unavailable',
      ]);
    }
  });

  it('never begins a linked donation for an account once it is closed', async () => {
    for (let round = 0; round < 3; round += 1) {
      const donor = await account(admin);
      const inputs = Array.from({ length: 3 }, () =>
        beginInput(campaign, { donorAccountId: donor }),
      );
      const results = await outcomes([
        closeAccount(admin, donor),
        ...inputs.map((input) => world.donor.begin(input)),
      ]);
      for (const result of results.slice(1))
        expect(['accepted', 'account-closed']).toContain(result);
      expect(await count(admin, 'Donation', `[donorUserId] = ${n(donor)}`)).toBe(
        results.slice(1).filter((result) => result === 'accepted').length,
      );
      // Closed now: every further linked begin is refused, by the trigger if not the service.
      expect(
        await outcomes([
          world.donor.begin(beginInput(campaign, { donorAccountId: donor })),
        ]),
      ).toEqual(['account-closed']);
      expect(
        total(
          await admin.query<{ total: number }>(
            `SELECT COUNT(*) AS [total] FROM [dbo].[User] WHERE [id] = ${n(donor)} AND [status] = N'closed';`,
          ),
        ),
      ).toBe(1);
    }
  });

  it('never deadlocks refund writers racing on different donations', async () => {
    for (let round = 0; round < 3; round += 1) {
      const donations = await Promise.all(
        Array.from({ length: 4 }, () => capturedDonation(world, campaign)),
      );
      const reserved = await Promise.all(
        donations.map((donation) =>
          world.refunds.reserve(reserveInput(donation, authority, 100n)),
        ),
      );
      // Settlements, submissions, deferrals, sweeps, fresh reservations and
      // payment observations, all at once, each on its own donation.
      const fresh = await Promise.all(
        Array.from({ length: 2 }, () => capturedDonation(world, campaign)),
      );
      const results = await outcomes([
        world.ledger.applyRefundObservation({
          refundId: reserved[0]?.refund.id ?? '',
          observation: refundObservation(
            donations[0] as DonationRecord,
            reserved[0]?.refund.id ?? '',
            100n,
          ),
          now: new Date(),
        }),
        world.refunds.recordSubmission({
          refundId: reserved[1]?.refund.id ?? '',
          outcome: 'rejected',
          now: new Date(),
        }),
        world.ledger.deferRefund({
          refundId: reserved[2]?.refund.id ?? '',
          now: new Date(),
        }),
        world.ledger.claimDueRefunds(new Date(Date.now() + 3 * 60_000), 100, 120),
        ...fresh.map((donation) =>
          world.refunds.reserve(reserveInput(donation, authority, 200n)),
        ),
        world.ledger.applyObservation({
          donationId: donations[3]?.id ?? '',
          observation: observation(donations[3] as DonationRecord, { dispute: 'open' }),
          source: 'webhook',
          actorId: null,
          now: new Date(),
        }),
      ]);
      expect(results).toEqual(Array.from({ length: results.length }, () => 'accepted'));
      for (const donation of [...donations, ...fresh])
        expect((await donationColumns(admin, donation.id))?.refundReservedMinor).toBe(
          (await liveRefunds(donation.id)).toString(),
        );
    }
  });

  it('never lets two sweepers lease the same due donation or refund', async () => {
    const begun = await Promise.all(
      Array.from({ length: 12 }, () => world.donor.begin(beginInput(campaign))),
    );
    const mine = new Set(begun.map((result) => result.donation.id));
    const due = new Date(Date.now() + 3 * 60_000);
    const claims = await Promise.all(
      Array.from({ length: 4 }, () => world.ledger.claimDueDonations(due, 5, 120)),
    );
    const claimed = claims.flat().map((claim) => claim.donationId);
    expect(new Set(claimed).size).toBe(claimed.length);
    // Everything still due is claimable by the next sweep — each exactly once overall.
    const rest = await world.ledger.claimDueDonations(due, 100, 120);
    const all = [...claimed, ...rest.map((claim) => claim.donationId)];
    expect(new Set(all).size).toBe(all.length);
    for (const id of mine) expect(all).toContain(id);

    const captured = await Promise.all(
      Array.from({ length: 4 }, () => capturedDonation(world, campaign)),
    );
    const refunds = await Promise.all(
      captured.map((donation) =>
        world.refunds.reserve(reserveInput(donation, authority, 100n)),
      ),
    );
    const refundDue = new Date(Date.now() + 3 * 60_000);
    const refundClaims = (
      await Promise.all(
        Array.from({ length: 4 }, () => world.ledger.claimDueRefunds(refundDue, 2, 120)),
      )
    )
      .flat()
      .map((claim) => claim.refundId);
    expect(new Set(refundClaims).size).toBe(refundClaims.length);
    const refundRest = (await world.ledger.claimDueRefunds(refundDue, 100, 120)).map(
      (claim) => claim.refundId,
    );
    for (const refund of refunds)
      expect([...refundClaims, ...refundRest]).toContain(refund.refund.id);
    expect(new Set([...refundClaims, ...refundRest]).size).toBe(
      refundClaims.length + refundRest.length,
    );
  });

  it('commits each owed acknowledgement once under retried applications', async () => {
    const donor = await account(admin);
    const donation = await createdDonation(world, campaign, { donorAccountId: donor });
    await Promise.all(
      Array.from({ length: 6 }, () =>
        world.ledger
          .applyObservation({
            donationId: donation.id,
            observation: observation(donation),
            source: 'reconcile',
            actorId: null,
            now: new Date(),
          })
          .catch(() => null),
      ),
    );
    expect(await intentsFor(admin, donation.id)).toHaveLength(1);
    const captured = (await world.ledger.donation(donation.id)) as DonationRecord;
    expect(captured.state).toBe('succeeded');

    const refund = await world.refunds.reserve(reserveInput(captured, authority, 1000n));
    await Promise.all(
      Array.from({ length: 6 }, () =>
        world.ledger
          .applyRefundObservation({
            refundId: refund.refund.id,
            observation: refundObservation(captured, refund.refund.id, 1000n),
            now: new Date(),
          })
          .catch(() => null),
      ),
    );
    expect(
      (await intentsFor(admin, donation.id)).map((intent) => intent.purpose),
    ).toEqual(['donation.partially-refunded', 'donation.succeeded']);
    expect(await donationColumns(admin, donation.id)).toMatchObject({
      state: 'partially_refunded',
      refundedMinor: '1000',
      refundReservedMinor: '1000',
    });
    // Dispatchers racing for the owed mail lease each intent to exactly one.
    const later = new Date(Date.now() + 60_000);
    const leased = (
      await Promise.all(
        Array.from({ length: 4 }, () => world.communication.claimDue(later, 100, 600)),
      )
    )
      .flat()
      .map((intent) => intent.id)
      .filter((id) => id !== undefined);
    expect(new Set(leased).size).toBe(leased.length);
  });
});
