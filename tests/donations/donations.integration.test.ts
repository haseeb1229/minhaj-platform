import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  DONATION_LIMITS,
  type DonationRecord,
} from '../../packages/contracts/src/donations/index.ts';
import type { SqlSession } from '../../packages/database/src/lifecycle/sql-connection.ts';
import { databaseConfigured } from '../identity/harness.ts';
import {
  PROOF_DOMAIN,
  SCOPE,
  account,
  activate,
  auditFor,
  auditOf,
  beginInput,
  capturedDonation,
  checkoutOf,
  count,
  createdDonation,
  digest,
  donationColumns,
  donationsWorld,
  intentsFor,
  n,
  observation,
  paymentOf,
  publishedCampaign,
  reasonOf,
  refunder,
  refundObservation,
  refundReferenceOf,
  reserveInput,
  sentinel,
  sqlNumber,
  type DonationsWorld,
} from './fixture-sql.ts';

/**
 * Phase 27 — Donations' persistence adapter over a REAL SQL Server, as the
 * provisioned RUNTIME principal, under the migration's real grants, keys and
 * triggers.
 *
 * WHAT ONLY THE DATABASE CAN PROVE HERE: that nothing begins without the
 * owner's activation and nothing begins outside its scope; that a donation is
 * one payment attempt per operation, in exact minor units at its currency's
 * own exponent, whose state only provider truth moves — forward, convergently,
 * and never on a mismatch; that a refund is reserved only by live refund
 * authority, never beyond the capture, and settles or releases exactly once;
 * that owed mail is committed once, only to the linked donor, in the same
 * transaction as the fact it announces; that an owner reads only their own
 * donations and a token holder only one status; that every operator read and
 * act is audited content-free; and that the runtime principal can neither
 * delete financial history nor rewrite what identifies it.
 */

const live = databaseConfigured ? describe : describe.skip;

/** A failure label for an override set that carries bigint money. */
function labelOf(value: unknown): string {
  return JSON.stringify(value, (_key, entry: unknown) =>
    typeof entry === 'bigint' ? entry.toString() : entry,
  );
}

live('Phase 27 Donations persistence against real SQL Server', () => {
  let world: DonationsWorld;
  let admin: SqlSession;
  let operator: string;
  let authority: string;

  beforeAll(async () => {
    world = await donationsWorld();
    admin = world.db.admin;
    operator = await account(admin);
    authority = await refunder(admin);
  }, 300_000);

  afterAll(async () => {
    await world?.close();
  });

  /* ===========================================================================
   * Activation — fail closed
   * ========================================================================= */

  it('admits no donation until the owner activates, and the runtime can never activate', async () => {
    const campaign = await publishedCampaign(world, operator);
    expect(await world.activation.activation()).toBeNull();
    expect(await reasonOf(world.donor.begin(beginInput(campaign.id)))).toBe(
      'not-activated',
    );
    expect(await count(admin, 'Donation')).toBe(0);

    // The runtime holds SELECT only: no INSERT, UPDATE or DELETE reaches it.
    expect(
      await sqlNumber(
        world.app.query(
          `INSERT INTO [dbo].[DonationActivation] ([id],[provider],[environment],[accountKey],[authority],[authorisedBy]) VALUES (1,N'stripe',N'fixture',N'${SCOPE.accountKey}',N'fixture',N'forged');`,
        ),
      ),
    ).toBe(229);

    await activate(admin);
    const activation = await world.activation.activation();
    expect(activation).toMatchObject({ ...SCOPE, authority: 'fixture' });
    expect(Object.keys(activation ?? {}).sort()).toEqual(
      ['accountKey', 'activatedAt', 'authority', 'environment', 'provider'].sort(),
    );
    for (const statement of [
      `UPDATE [dbo].[DonationActivation] SET [authority] = N'approved';`,
      'DELETE FROM [dbo].[DonationActivation];',
    ])
      expect(await sqlNumber(world.app.query(statement))).toBe(229);
    // And the owner cannot change it either: it is immutable.
    expect(
      await sqlNumber(
        admin.query(`UPDATE [dbo].[DonationActivation] SET [environment] = N'sandbox';`),
      ),
    ).toBe(51342);
  });

  /* ===========================================================================
   * Campaigns
   * ========================================================================= */

  it('creates a draft, publishes it only when complete, and audits every change content-free', async () => {
    const id = randomUUID();
    const created = await world.campaigns.createCampaign({
      id,
      actorId: operator,
      value: { primaryLocale: 'ur', displayOrder: 7 },
    });
    expect(created).toMatchObject({ id, state: 'draft', version: 1, referenced: false });
    expect(
      await reasonOf(
        world.campaigns.transitionCampaign({
          actorId: operator,
          id,
          expectedVersion: 1,
          to: 'published',
        }),
      ),
    ).toBe('incomplete');
    expect(
      await reasonOf(
        world.campaigns.transitionCampaign({
          actorId: operator,
          id,
          expectedVersion: 1,
          to: 'archived',
        }),
      ),
    ).toBe('invalid-state');

    // English words are not the Urdu primary's.
    let record = await world.campaigns.saveTranslation({
      actorId: operator,
      id,
      expectedVersion: 1,
      translation: {
        locale: 'en',
        title: sentinel('TITLE', 'en'),
        summary: sentinel('SUMMARY', 'en'),
        description: sentinel('DESCRIPTION', 'en'),
      },
    });
    record = await world.campaigns.saveCurrencyPolicy({
      actorId: operator,
      id,
      expectedVersion: record.version,
      policy: {
        currency: 'PKR',
        minimumMinor: 10_000n,
        maximumMinor: 999_999_999_999n,
        suggestedMinor: [],
      },
    });
    expect(
      await reasonOf(
        world.campaigns.transitionCampaign({
          actorId: operator,
          id,
          expectedVersion: record.version,
          to: 'published',
        }),
      ),
    ).toBe('incomplete');
    record = await world.campaigns.saveTranslation({
      actorId: operator,
      id,
      expectedVersion: record.version,
      translation: {
        locale: 'ur',
        title: sentinel('TITLE', 'عنوان'),
        summary: sentinel('SUMMARY', 'ur'),
        description: sentinel('DESCRIPTION', 'ur'),
      },
    });
    const published = await world.campaigns.transitionCampaign({
      actorId: operator,
      id,
      expectedVersion: record.version,
      to: 'published',
    });
    expect(published).toMatchObject({ state: 'published', version: 5 });
    expect(published.currencies).toEqual([
      {
        currency: 'PKR',
        minimumMinor: 10_000n,
        maximumMinor: 999_999_999_999n,
        suggestedMinor: [],
      },
    ]);
    expect(typeof published.currencies[0]?.maximumMinor).toBe('bigint');
    expect(published.translations.map((entry) => entry.locale)).toEqual(['en', 'ur']);

    // A stale version is a conflict; an unknown campaign is not-found.
    expect(
      await reasonOf(
        world.campaigns.reorderCampaign({
          actorId: operator,
          id,
          expectedVersion: 4,
          displayOrder: 1,
        }),
      ),
    ).toBe('conflict');
    expect(
      await reasonOf(
        world.campaigns.reorderCampaign({
          actorId: operator,
          id: randomUUID(),
          expectedVersion: 1,
          displayOrder: 1,
        }),
      ),
    ).toBe('not-found');

    // A published campaign keeps its last currency; an unoffered one is not-found.
    expect(
      await reasonOf(
        world.campaigns.removeCurrencyPolicy({
          actorId: operator,
          id,
          expectedVersion: 5,
          currency: 'PKR',
        }),
      ),
    ).toBe('incomplete');
    expect(
      await reasonOf(
        world.campaigns.removeCurrencyPolicy({
          actorId: operator,
          id,
          expectedVersion: 5,
          currency: 'USD',
        }),
      ),
    ).toBe('not-found');

    // Archived, then republished — never back to draft.
    const archived = await world.campaigns.transitionCampaign({
      actorId: operator,
      id,
      expectedVersion: 5,
      to: 'archived',
    });
    expect(archived).toMatchObject({ state: 'archived', version: 6 });
    expect(archived.archivedAt).not.toBeNull();
    const republished = await world.campaigns.transitionCampaign({
      actorId: operator,
      id,
      expectedVersion: 6,
      to: 'published',
    });
    expect(republished).toMatchObject({
      state: 'published',
      version: 7,
      archivedAt: null,
    });

    const audits = await auditFor(admin, id);
    expect(audits.map((row) => row.action)).toEqual([
      'donations.campaign.created',
      'donations.campaign.translation-saved',
      'donations.campaign.currency-saved',
      'donations.campaign.translation-saved',
      'donations.campaign.published',
      'donations.campaign.archived',
      'donations.campaign.published',
    ]);
    for (const row of audits) {
      expect(row.actorId).toBe(operator);
      expect(row.authorisingSource).toBe('donations.administer');
      expect(`${row.beforeState ?? ''}${row.afterState ?? ''}`).not.toContain(
        'NON_DONATION_FIXTURE',
      );
    }
    expect(JSON.parse(audits[2]?.afterState ?? '{}')).toMatchObject({
      currency: 'PKR',
      minimumMinor: '10000',
      maximumMinor: '999999999999',
    });
  });

  it('keeps currency policy exact at each currency’s own exponent, within its limit', async () => {
    const id = randomUUID();
    let record = await world.campaigns.createCampaign({
      id,
      actorId: operator,
      value: { primaryLocale: 'en', displayOrder: 8 },
    });
    const currencies = ['AED', 'BHD', 'CAD', 'JPY', 'KRW', 'KWD', 'USD', 'ZAR'] as const;
    for (const currency of currencies)
      record = await world.campaigns.saveCurrencyPolicy({
        actorId: operator,
        id,
        expectedVersion: record.version,
        policy: {
          currency,
          minimumMinor: 1000n,
          maximumMinor: 5_000_000n,
          suggestedMinor: [1000n, 4_999_999n],
        },
      });
    expect(record.currencies.map((policy) => policy.currency)).toEqual([...currencies]);
    expect(currencies.length).toBe(DONATION_LIMITS.currenciesPerCampaign);
    expect(
      await reasonOf(
        world.campaigns.saveCurrencyPolicy({
          actorId: operator,
          id,
          expectedVersion: record.version,
          policy: {
            currency: 'EUR',
            minimumMinor: 100n,
            maximumMinor: 200n,
            suggestedMinor: [],
          },
        }),
      ),
    ).toBe('limit');
    // Replacing an existing currency is not a new one.
    record = await world.campaigns.saveCurrencyPolicy({
      actorId: operator,
      id,
      expectedVersion: record.version,
      policy: {
        currency: 'USD',
        minimumMinor: 100n,
        maximumMinor: 200n,
        suggestedMinor: [150n],
      },
    });
    expect(record.currencies.find((policy) => policy.currency === 'USD')).toEqual({
      currency: 'USD',
      minimumMinor: 100n,
      maximumMinor: 200n,
      suggestedMinor: [150n],
    });
    const stored = await admin.query<{ currency: string; currencyExponent: number }>(
      `SELECT [currency], [currencyExponent] FROM [dbo].[DonationCampaignCurrency] WHERE [campaignId] = ${n(id)} ORDER BY [currency];`,
    );
    expect(
      stored.map((row) => `${row.currency}:${String(row.currencyExponent)}`),
    ).toEqual(['AED:2', 'BHD:3', 'CAD:2', 'JPY:0', 'KRW:0', 'KWD:3', 'USD:2', 'ZAR:2']);
    record = await world.campaigns.removeCurrencyPolicy({
      actorId: operator,
      id,
      expectedVersion: record.version,
      currency: 'ZAR',
    });
    expect(record.currencies).toHaveLength(7);
  });

  it('lists only published campaigns publicly, in display order, and marks referenced ones', async () => {
    const before = (await world.reader.publishedCampaigns()).map(
      (campaign) => campaign.id,
    );
    const first = await publishedCampaign(world, operator);
    const draftId = randomUUID();
    await world.campaigns.createCampaign({
      id: draftId,
      actorId: operator,
      value: { primaryLocale: 'en', displayOrder: 0 },
    });
    const listed = await world.reader.publishedCampaigns();
    expect(listed.map((campaign) => campaign.id)).toContain(first.id);
    expect(listed.map((campaign) => campaign.id)).not.toContain(draftId);
    expect(listed.length).toBe(before.length + 1);
    const orders = listed.map((campaign) => campaign.displayOrder);
    expect([...orders].sort((left, right) => left - right)).toEqual(orders);
    for (const campaign of listed)
      expect(Object.keys(campaign).sort()).toEqual(
        ['currencies', 'displayOrder', 'id', 'primaryLocale', 'translations'].sort(),
      );

    expect((await world.campaigns.campaign(first.id))?.referenced).toBe(false);
    await world.donor.begin(beginInput(first.id));
    expect((await world.campaigns.campaign(first.id))?.referenced).toBe(true);
    expect((await world.campaigns.campaigns()).map((campaign) => campaign.id)).toContain(
      draftId,
    );
    expect(await world.campaigns.campaign(randomUUID())).toBeNull();
  });

  /* ===========================================================================
   * Initiation
   * ========================================================================= */

  it('begins one pending donation per operation, exact money, refusing what policy, scope or account forbid', async () => {
    const campaign = await publishedCampaign(world, operator);
    const donor = await account(admin);
    const input = beginInput(campaign.id, {
      donorAccountId: donor,
      expected: { currency: 'KWD', minor: 1250n },
    });
    const before = Date.now();
    const begun = await world.donor.begin(input);
    expect(begun.created).toBe(true);
    expect(begun.donation).toMatchObject({
      id: input.id,
      state: 'pending',
      createState: 'pending',
      expected: { currency: 'KWD', minor: 1250n },
      linked: true,
      scope: SCOPE,
      checkoutReference: null,
      paymentReference: null,
      capturedMinor: null,
      refundedMinor: 0n,
      refundReservedMinor: 0n,
      dispute: 'none',
      attention: null,
      version: 1,
      locale: 'en',
      checkoutLabel: input.checkoutLabel,
    });
    // A crash before the provider create is recovered by reconciliation soon.
    const columns = await donationColumns(admin, input.id);
    expect(columns?.reconcileDueAt?.getTime()).toBeGreaterThanOrEqual(before + 110_000);
    expect(columns?.reconcileDueAt?.getTime()).toBeLessThanOrEqual(Date.now() + 130_000);
    const [stored] = await admin.query<{
      currency: string;
      currencyExponent: number;
      expected: string;
    }>(
      `SELECT [currency], [currencyExponent], CONVERT(NVARCHAR(20), [expectedMinor]) AS [expected] FROM [dbo].[Donation] WHERE [id] = ${n(input.id)};`,
    );
    expect(stored).toEqual({ currency: 'KWD', currencyExponent: 3, expected: '1250' });

    // The same operation is the same donation; a different request is refused.
    const replay = await world.donor.begin({
      ...input,
      id: randomUUID(),
      statusTokenDigest: digest(randomUUID()),
    });
    expect(replay).toMatchObject({ created: false, donation: { id: input.id } });
    expect(
      await reasonOf(
        world.donor.begin({ ...input, id: randomUUID(), requestDigest: digest('other') }),
      ),
    ).toBe('operation-conflict');
    expect(
      await count(admin, 'Donation', `[operationId] = ${n(input.operationId)}`),
    ).toBe(1);

    const draftId = randomUUID();
    await world.campaigns.createCampaign({
      id: draftId,
      actorId: operator,
      value: { primaryLocale: 'en', displayOrder: 1 },
    });
    const closed = await account(admin, 'closed');
    const suspended = await account(admin, 'suspended');
    for (const [overrides, reason] of [
      [{ campaignId: draftId }, 'campaign-unavailable'],
      [{ campaignId: randomUUID() }, 'campaign-unavailable'],
      [{ expected: { currency: 'USD', minor: 99n } }, 'amount-refused'],
      [{ expected: { currency: 'USD', minor: 1_000_001n } }, 'amount-refused'],
      [{ expected: { currency: 'EUR', minor: 2500n } }, 'amount-refused'],
      [{ expected: { currency: 'JPY', minor: 99n } }, 'amount-refused'],
      [{ scope: { ...SCOPE, environment: 'sandbox' } }, 'not-activated'],
      [{ scope: { ...SCOPE, accountKey: 'acct_integration_other' } }, 'not-activated'],
      [{ scope: { ...SCOPE, environment: 'production' } }, 'not-activated'],
      [{ donorAccountId: closed }, 'account-closed'],
      [{ donorAccountId: suspended }, 'account-closed'],
    ] as const) {
      const refused = beginInput(campaign.id, overrides);
      expect(await reasonOf(world.donor.begin(refused)), labelOf(overrides)).toBe(reason);
      expect(await count(admin, 'Donation', `[id] = ${n(refused.id)}`)).toBe(0);
    }
  });

  it('records the checkout once, scoped and unique, and closes a refused create as failed', async () => {
    const campaign = await publishedCampaign(world, operator);
    const { donation } = await world.donor.begin(beginInput(campaign.id));
    const expiresAt = new Date(donation.createdAt.getTime() + 3_600_000);
    const recorded = await world.donor.recordCheckout({
      id: donation.id,
      checkoutReference: checkoutOf(donation.id),
      expiresAt,
      now: new Date(),
    });
    expect(recorded).toMatchObject({
      createState: 'created',
      checkoutReference: checkoutOf(donation.id),
      version: 2,
      state: 'pending',
    });
    // First re-read: fifteen minutes after creation, inside the expiry grace.
    expect((await donationColumns(admin, donation.id))?.reconcileDueAt?.getTime()).toBe(
      donation.createdAt.getTime() + 15 * 60_000,
    );
    const again = await world.donor.recordCheckout({
      id: donation.id,
      checkoutReference: checkoutOf(donation.id),
      expiresAt,
      now: new Date(),
    });
    expect(again.version).toBe(2);
    expect(
      await reasonOf(
        world.donor.recordCheckout({
          id: donation.id,
          checkoutReference: `${checkoutOf(donation.id)}x`,
          expiresAt,
          now: new Date(),
        }),
      ),
    ).toBe('conflict');
    // Another donation can never claim the same provider checkout in scope.
    const { donation: other } = await world.donor.begin(beginInput(campaign.id));
    expect(
      await reasonOf(
        world.donor.recordCheckout({
          id: other.id,
          checkoutReference: checkoutOf(donation.id),
          expiresAt,
          now: new Date(),
        }),
      ),
    ).toBe('conflict');
    expect(
      await reasonOf(
        world.donor.recordCheckout({
          id: randomUUID(),
          checkoutReference: 'cs_fixture_missing',
          expiresAt,
          now: new Date(),
        }),
      ),
    ).toBe('not-found');

    // An ambiguous create is re-asked within a minute, once; a later answer of
    // `created` still lands; a definitive one is final.
    const now = new Date();
    const ambiguous = await world.donor.recordCreateOutcome({
      id: other.id,
      outcome: 'ambiguous',
      now,
    });
    expect(ambiguous).toMatchObject({
      createState: 'ambiguous',
      state: 'pending',
      version: 2,
    });
    expect((await donationColumns(admin, other.id))?.reconcileDueAt?.getTime()).toBe(
      now.getTime() + 60_000,
    );
    expect(
      (
        await world.donor.recordCreateOutcome({
          id: other.id,
          outcome: 'ambiguous',
          now: new Date(),
        })
      ).version,
    ).toBe(2);
    const late = await world.donor.recordCheckout({
      id: other.id,
      checkoutReference: checkoutOf(other.id),
      expiresAt,
      now: new Date(),
    });
    expect(late).toMatchObject({ createState: 'created', version: 3 });
    expect(
      (
        await world.donor.recordCreateOutcome({
          id: other.id,
          outcome: 'rejected',
          now: new Date(),
        })
      ).createState,
    ).toBe('created');

    const { donation: refused } = await world.donor.begin(beginInput(campaign.id));
    const failed = await world.donor.recordCreateOutcome({
      id: refused.id,
      outcome: 'rejected',
      now: new Date(),
    });
    expect(failed).toMatchObject({
      createState: 'rejected',
      state: 'failed',
      version: 2,
    });
    expect((await donationColumns(admin, refused.id))?.reconcileDueAt).toBeNull();
    expect(
      await reasonOf(
        world.donor.recordCheckout({
          id: refused.id,
          checkoutReference: checkoutOf(refused.id),
          expiresAt,
          now: new Date(),
        }),
      ),
    ).toBe('invalid-state');
  });

  it('answers a status token with that one donation’s status and nothing else', async () => {
    const campaign = await publishedCampaign(world, operator);
    const donor = await account(admin);
    const input = beginInput(campaign.id, { donorAccountId: donor });
    await world.donor.begin(input);
    const otherInput = beginInput(campaign.id, {
      expected: { currency: 'JPY', minor: 5000n },
    });
    await world.donor.begin(otherInput);

    const view = await world.donor.statusByToken(input.statusTokenDigest);
    expect(Object.keys(view ?? {}).sort()).toEqual(
      [
        'campaign',
        'cancellable',
        'createdAt',
        'environment',
        'expected',
        'refundedMinor',
        'state',
        'updatedAt',
      ].sort(),
    );
    expect(view).toMatchObject({
      state: 'pending',
      expected: { currency: 'USD', minor: 2500n },
      refundedMinor: 0n,
      environment: 'fixture',
      cancellable: false,
      campaign: { campaignId: campaign.id, primaryLocale: 'en' },
    });
    // Nothing personal and no provider reference leaves through it.
    const serialised = JSON.stringify(view, (_key, value: unknown) =>
      typeof value === 'bigint' ? value.toString() : value,
    );
    for (const secret of [
      donor,
      input.id,
      input.statusTokenDigest,
      input.requestDigest,
      PROOF_DOMAIN,
    ])
      expect(serialised).not.toContain(secret);

    expect(await world.donor.statusByToken(digest('unknown-token'))).toBeNull();
    expect(
      (await world.donor.statusByToken(otherInput.statusTokenDigest))?.expected,
    ).toEqual({
      currency: 'JPY',
      minor: 5000n,
    });
    expect((await world.donor.donationByToken(input.statusTokenDigest))?.id).toBe(
      input.id,
    );
    expect(await world.donor.donationByToken(digest('unknown-token'))).toBeNull();

    // Cancellable only while the checkout is open and no cancellation was asked.
    await world.donor.recordCheckout({
      id: input.id,
      checkoutReference: checkoutOf(input.id),
      expiresAt: new Date(Date.now() + 3_600_000),
      now: new Date(),
    });
    expect((await world.donor.statusByToken(input.statusTokenDigest))?.cancellable).toBe(
      true,
    );
    const asked = await world.donor.markCancelRequested({
      id: input.id,
      now: new Date(),
    });
    expect(asked).toMatchObject({ state: 'pending', version: 3 });
    expect(
      (await world.donor.markCancelRequested({ id: input.id, now: new Date() })).version,
    ).toBe(3);
    expect((await world.donor.statusByToken(input.statusTokenDigest))?.cancellable).toBe(
      false,
    );

    // The provider's expiry after a cancellation reads as cancelled.
    const created = (await world.ledger.donation(input.id)) as DonationRecord;
    const expired = await world.ledger.applyObservation({
      donationId: input.id,
      observation: observation(created, {
        checkout: 'expired',
        payment: 'none',
        paymentReference: null,
        capturedMinor: null,
      }),
      source: 'donor-check',
      actorId: null,
      now: new Date(),
    });
    expect(expired).toMatchObject({ changed: true, donation: { state: 'cancelled' } });
    expect((await donationColumns(admin, input.id))?.reconcileDueAt).toBeNull();
    expect(
      await reasonOf(
        world.donor.markCancelRequested({ id: otherInput.id, now: new Date() }),
      ),
    ).toBe('accepted');
    const succeeded = await capturedDonation(world, campaign.id);
    expect(
      await reasonOf(
        world.donor.markCancelRequested({ id: succeeded.id, now: new Date() }),
      ),
    ).toBe('invalid-state');
  });

  /* ===========================================================================
   * Ledger — provider truth
   * ========================================================================= */

  it('applies verified provider truth convergently, owing the linked donor one acknowledgement', async () => {
    const campaign = await publishedCampaign(world, operator);
    const donor = await account(admin);
    const linked = await createdDonation(world, campaign.id, { donorAccountId: donor });

    // A pending answer moves nothing but the schedule.
    const pending = await world.ledger.applyObservation({
      donationId: linked.id,
      observation: observation(linked, {
        checkout: 'open',
        payment: 'none',
        paymentReference: null,
        capturedMinor: null,
      }),
      source: 'reconcile',
      actorId: null,
      now: new Date(),
    });
    expect(pending).toMatchObject({
      changed: false,
      donation: { state: 'pending', version: 2 },
    });
    expect((await donationColumns(admin, linked.id))?.reconcileDueAt).not.toBeNull();

    // A mismatch flags attention and moves no fact — on a donation of its own.
    const suspicious = await createdDonation(world, campaign.id);
    for (const [overrides, attention] of [
      [{ amount: { currency: 'USD', minor: 2501n } }, 'amount-mismatch'],
      [{ capturedMinor: 2400n }, 'amount-mismatch'],
      [{ scope: { ...SCOPE, environment: 'sandbox' } }, 'provider-mismatch'],
      [{ donationReference: randomUUID() }, 'provider-mismatch'],
      [{ checkoutReference: 'cs_fixture_other' }, 'provider-mismatch'],
    ] as const) {
      const flagged = await world.ledger.applyObservation({
        donationId: suspicious.id,
        observation: observation(suspicious, overrides),
        source: 'webhook',
        actorId: null,
        now: new Date(),
      });
      expect(flagged.donation, labelOf(overrides)).toMatchObject({
        attention,
        state: 'pending',
        capturedMinor: null,
      });
      expect((await donationColumns(admin, suspicious.id))?.reconcileDueAt).toBeNull();
    }
    // Only `unresolved` clears on a matching answer. A mismatch is a person's
    // question: verified truth still lands, and the flag stays for review —
    // even an operator's reconcile request re-arms the schedule, not the flag.
    const reviewed = await world.ledger.applyObservation({
      donationId: suspicious.id,
      observation: observation(suspicious),
      source: 'webhook',
      actorId: null,
      now: new Date(),
    });
    expect(reviewed.donation).toMatchObject({
      state: 'succeeded',
      capturedMinor: 2500n,
      attention: 'provider-mismatch',
    });
    const rearmed = await world.staff.requestReconcile({
      actorId: operator,
      id: suspicious.id,
      expectedVersion: reviewed.donation.version,
      now: new Date(),
    });
    expect(rearmed.attention).toBe('provider-mismatch');
    expect((await donationColumns(admin, suspicious.id))?.reconcileDueAt).not.toBeNull();

    // Verified success: captured exactly, succeeded once, the intent once.
    const applied = await world.ledger.applyObservation({
      donationId: linked.id,
      observation: observation(linked),
      source: 'webhook',
      actorId: null,
      now: new Date(),
    });
    expect(applied.changed).toBe(true);
    expect(applied.donation).toMatchObject({
      state: 'succeeded',
      capturedMinor: 2500n,
      paymentReference: paymentOf(linked.id),
      attention: null,
    });
    expect(applied.donation.succeededAt).not.toBeNull();
    for (const late of [
      { checkout: 'expired', payment: 'canceled', capturedMinor: null },
      { checkout: 'open', payment: 'processing', capturedMinor: null },
      { checkout: 'complete', payment: 'failed', capturedMinor: null },
    ] as const) {
      const stale = await world.ledger.applyObservation({
        donationId: linked.id,
        observation: observation(linked, late),
        source: 'reconcile',
        actorId: null,
        now: new Date(),
      });
      expect(stale).toMatchObject({
        changed: false,
        donation: { state: 'succeeded', capturedMinor: 2500n },
      });
    }
    expect(
      (await intentsFor(admin, linked.id)).map((intent) => [
        intent.purpose,
        intent.recipientUserId,
        intent.idempotencyKey,
      ]),
    ).toEqual([['donation.succeeded', donor, `donation.succeeded:${linked.id}`]]);

    // A different payment reference for the same checkout is the provider disagreeing with itself.
    const disagreeing = await world.ledger.applyObservation({
      donationId: linked.id,
      observation: observation(linked, { paymentReference: 'pi_fixture_other' }),
      source: 'webhook',
      actorId: null,
      now: new Date(),
    });
    expect(disagreeing.donation).toMatchObject({
      attention: 'provider-mismatch',
      paymentReference: paymentOf(linked.id),
    });

    // An anonymous capture owes no mail; a dispute moves forward only.
    const anonymous = await capturedDonation(world, campaign.id);
    expect(await intentsFor(admin, anonymous.id)).toEqual([]);
    const disputed = await world.ledger.applyObservation({
      donationId: anonymous.id,
      observation: observation(anonymous, { dispute: 'open' }),
      source: 'webhook',
      actorId: null,
      now: new Date(),
    });
    expect(disputed.donation.state).toBe('disputed');
    const won = await world.ledger.applyObservation({
      donationId: anonymous.id,
      observation: observation(anonymous, { dispute: 'won' }),
      source: 'webhook',
      actorId: null,
      now: new Date(),
    });
    expect(won.donation).toMatchObject({ state: 'succeeded', dispute: 'won' });
    const reopened = await world.ledger.applyObservation({
      donationId: anonymous.id,
      observation: observation(anonymous, { dispute: 'open' }),
      source: 'webhook',
      actorId: null,
      now: new Date(),
    });
    expect(reopened).toMatchObject({ changed: false, donation: { dispute: 'won' } });

    // A refund this platform did not make is counted and flagged for a person.
    const external = await capturedDonation(world, campaign.id);
    const counted = await world.ledger.applyObservation({
      donationId: external.id,
      observation: observation(external, { refundedMinor: 500n }),
      source: 'reconcile',
      actorId: null,
      now: new Date(),
    });
    expect(counted.donation).toMatchObject({
      state: 'partially_refunded',
      refundedMinor: 500n,
      attention: 'external-refund',
    });

    // An expiry without a cancellation reads as expired; only the operator path is audited.
    const lapsed = await createdDonation(world, campaign.id);
    const expiredRun = await world.ledger.applyObservation({
      donationId: lapsed.id,
      observation: observation(lapsed, {
        checkout: 'expired',
        payment: 'none',
        paymentReference: null,
        capturedMinor: null,
      }),
      source: 'operator',
      actorId: operator,
      now: new Date(),
    });
    expect(expiredRun.donation.state).toBe('expired');
    expect((await auditFor(admin, lapsed.id)).map((row) => row.action)).toEqual([
      'donations.observation.applied',
    ]);
    expect(await auditFor(admin, linked.id)).toEqual([]);
    const [operatorAudit] = await auditFor(admin, lapsed.id);
    expect(JSON.parse(operatorAudit?.afterState ?? '{}')).toEqual({
      state: 'expired',
      version: '3',
      environment: 'fixture',
      changed: 'true',
    });
    expect(
      await reasonOf(
        world.ledger.applyObservation({
          donationId: randomUUID(),
          observation: observation(lapsed),
          source: 'webhook',
          actorId: null,
          now: new Date(),
        }),
      ),
    ).toBe('not-found');
  });

  it('locates an event’s subject only within its scope and exactly, and deduplicates events durably', async () => {
    const campaign = await publishedCampaign(world, operator);
    const donation = await capturedDonation(world, campaign.id);
    const subject = {
      checkoutReference: null,
      paymentReference: null,
      refundReference: null,
    };
    expect(
      await world.ledger.locate({
        scope: SCOPE,
        subject: { ...subject, checkoutReference: checkoutOf(donation.id) },
      }),
    ).toEqual({ donationId: donation.id, refundId: null });
    expect(
      await world.ledger.locate({
        scope: SCOPE,
        subject: { ...subject, paymentReference: paymentOf(donation.id) },
      }),
    ).toEqual({ donationId: donation.id, refundId: null });
    for (const located of [
      {
        scope: { ...SCOPE, environment: 'sandbox' as const },
        subject: { ...subject, checkoutReference: checkoutOf(donation.id) },
      },
      {
        scope: { ...SCOPE, accountKey: 'acct_integration_other' },
        subject: { ...subject, paymentReference: paymentOf(donation.id) },
      },
      {
        scope: SCOPE,
        subject: { ...subject, checkoutReference: checkoutOf(donation.id).toUpperCase() },
      },
      { scope: SCOPE, subject: { ...subject, paymentReference: 'pi_fixture_unknown' } },
      { scope: SCOPE, subject },
    ])
      expect(await world.ledger.locate(located)).toBeNull();

    const reserved = await world.refunds.reserve(reserveInput(donation, authority, 100n));
    await world.ledger.applyRefundObservation({
      refundId: reserved.refund.id,
      observation: refundObservation(donation, reserved.refund.id, 100n, {
        state: 'pending',
      }),
      now: new Date(),
    });
    expect(
      await world.ledger.locate({
        scope: SCOPE,
        subject: {
          ...subject,
          refundReference: refundReferenceOf(reserved.refund.id),
          paymentReference: paymentOf(donation.id),
        },
      }),
    ).toEqual({ donationId: donation.id, refundId: reserved.refund.id });

    const notice = {
      scope: SCOPE,
      eventId: `evt_fixture_${randomUUID()}`,
      eventType: 'checkout.session.completed',
      occurredAt: new Date(),
      payloadDigest: digest('event-body'),
    };
    expect(await world.ledger.admitEvent({ notice, receivedAt: new Date() })).toBe(
      'process',
    );
    // An attempt that never completed is processed again, never lost.
    expect(await world.ledger.admitEvent({ notice, receivedAt: new Date() })).toBe(
      'process',
    );
    await world.ledger.completeEvent({
      scope: SCOPE,
      eventId: notice.eventId,
      donationId: donation.id,
      result: 'applied',
      now: new Date(),
    });
    expect(await world.ledger.admitEvent({ notice, receivedAt: new Date() })).toBe(
      'already-processed',
    );
    // A second completion changes nothing.
    await world.ledger.completeEvent({
      scope: SCOPE,
      eventId: notice.eventId,
      donationId: null,
      result: 'ignored',
      now: new Date(),
    });
    const [event] = await admin.query<{
      result: string;
      donationId: string | null;
      total: number;
    }>(
      `SELECT [result], [donationId], (SELECT COUNT(*) FROM [dbo].[DonationProviderEvent] WHERE [eventId] = ${n(notice.eventId)}) AS [total]
       FROM [dbo].[DonationProviderEvent] WHERE [eventId] = ${n(notice.eventId)};`,
    );
    expect(event).toEqual({ result: 'applied', donationId: donation.id, total: 1 });
    // The same id in another scope is another event.
    expect(
      await world.ledger.admitEvent({
        notice: { ...notice, scope: { ...SCOPE, environment: 'sandbox' } },
        receivedAt: new Date(),
      }),
    ).toBe('process');
    // No payload is stored: the dedup record holds the digest of the bytes alone.
    const columns = await admin.query<{ name: string }>(
      `SELECT [name] FROM sys.columns WHERE [object_id] = OBJECT_ID(N'[dbo].[DonationProviderEvent]') ORDER BY [column_id];`,
    );
    expect(columns.map((column) => column.name)).not.toContain('payload');
  });

  /* ===========================================================================
   * Refunds
   * ========================================================================= */

  it('reserves refunds only under live authority, never beyond the capture, and settles them once', async () => {
    const campaign = await publishedCampaign(world, operator);
    const donor = await account(admin);
    let donation = await capturedDonation(world, campaign.id, { donorAccountId: donor });

    // The database, not the caller, decides authority.
    const denied = reserveInput(donation, operator, 1000n);
    expect(await reasonOf(world.refunds.reserve(denied))).toBe('denied');
    expect(await count(admin, 'DonationRefund', `[donationId] = ${n(donation.id)}`)).toBe(
      0,
    );
    expect((await donationColumns(admin, donation.id))?.refundReservedMinor).toBe('0');

    expect(
      await reasonOf(world.refunds.reserve(reserveInput(donation, authority, 2501n))),
    ).toBe('over-refund');
    expect(
      await reasonOf(
        world.refunds.reserve(
          reserveInput(donation, authority, 100n, {
            amount: { currency: 'JPY', minor: 100n },
          }),
        ),
      ),
    ).toBe('invalid');
    expect(
      await reasonOf(
        world.refunds.reserve(
          reserveInput(donation, authority, 100n, {
            expectedVersion: donation.version - 1,
          }),
        ),
      ),
    ).toBe('conflict');
    const uncaptured = await createdDonation(world, campaign.id);
    expect(
      await reasonOf(world.refunds.reserve(reserveInput(uncaptured, authority, 100n))),
    ).toBe('invalid-state');

    const first = reserveInput(donation, authority, 1000n);
    const reserved = await world.refunds.reserve(first);
    expect(reserved).toMatchObject({
      created: true,
      refund: {
        id: first.refundId,
        state: 'requested',
        amount: { currency: 'USD', minor: 1000n },
        version: 1,
      },
    });
    expect((await donationColumns(admin, donation.id))?.refundReservedMinor).toBe('1000');
    // The same operation is the same refund; a different request is refused.
    expect(
      await world.refunds.reserve({ ...first, refundId: randomUUID() }),
    ).toMatchObject({
      created: false,
      refund: { id: first.refundId },
    });
    expect(
      await reasonOf(
        world.refunds.reserve({
          ...first,
          refundId: randomUUID(),
          requestDigest: digest('x'),
        }),
      ),
    ).toBe('operation-conflict');
    const [audit] = await auditFor(admin, first.refundId);
    expect(audit).toMatchObject({
      action: 'donations.refund.requested',
      actorId: authority,
      authorisingSource: 'donations.refund',
    });
    expect(JSON.parse(audit?.afterState ?? '{}')).toEqual({
      donationId: donation.id,
      state: 'requested',
      version: '1',
      currency: 'USD',
      amountMinor: '1000',
      environment: 'fixture',
      donationVersion: String(donation.version + 1),
    });

    donation = (await world.ledger.donation(donation.id)) as DonationRecord;
    expect(
      await reasonOf(world.refunds.reserve(reserveInput(donation, authority, 1501n))),
    ).toBe('over-refund');

    // An unanswered submission stays requested and is re-read soon; a refused one fails and releases.
    const now = new Date();
    const unknown = await world.refunds.recordSubmission({
      refundId: first.refundId,
      outcome: 'unknown',
      now,
    });
    expect(unknown).toMatchObject({ state: 'requested', version: 1 });
    const [scheduled] = await admin.query<{ due: Date }>(
      `SELECT [reconcileDueAt] AS [due] FROM [dbo].[DonationRefund] WHERE [id] = ${n(first.refundId)};`,
    );
    expect(scheduled?.due.getTime()).toBe(now.getTime() + 60_000);
    const rejected = await world.refunds.recordSubmission({
      refundId: first.refundId,
      outcome: 'rejected',
      now: new Date(),
    });
    expect(rejected).toMatchObject({ state: 'failed', version: 2 });
    expect(rejected.completedAt).not.toBeNull();
    expect((await donationColumns(admin, donation.id))?.refundReservedMinor).toBe('0');
    expect((await auditFor(admin, first.refundId)).map((row) => row.action)).toEqual([
      'donations.refund.requested',
      'donations.refund.failed',
    ]);
    expect(
      (
        await world.refunds.recordSubmission({
          refundId: first.refundId,
          outcome: 'unknown',
          now: new Date(),
        })
      ).state,
    ).toBe('failed');
    expect(
      await reasonOf(
        world.refunds.recordSubmission({
          refundId: randomUUID(),
          outcome: 'unknown',
          now: new Date(),
        }),
      ),
    ).toBe('not-found');

    // A partial refund settles: refunded raised, partially refunded, one intent.
    donation = (await world.ledger.donation(donation.id)) as DonationRecord;
    const partial = await world.refunds.reserve(reserveInput(donation, authority, 1000n));
    const accepted = await world.ledger.applyRefundObservation({
      refundId: partial.refund.id,
      observation: refundObservation(donation, partial.refund.id, 1000n, {
        state: 'pending',
      }),
      now: new Date(),
    });
    expect(accepted).toMatchObject({
      changed: true,
      refund: { state: 'pending', version: 2 },
    });
    const settled = await world.ledger.applyRefundObservation({
      refundId: partial.refund.id,
      observation: refundObservation(donation, partial.refund.id, 1000n),
      now: new Date(),
    });
    expect(settled).toMatchObject({
      changed: true,
      refund: {
        state: 'succeeded',
        refundReference: refundReferenceOf(partial.refund.id),
      },
      donation: {
        state: 'partially_refunded',
        refundedMinor: 1000n,
        refundReservedMinor: 1000n,
      },
    });
    const replayed = await world.ledger.applyRefundObservation({
      refundId: partial.refund.id,
      observation: refundObservation(donation, partial.refund.id, 1000n),
      now: new Date(),
    });
    expect(replayed).toMatchObject({
      changed: false,
      donation: { refundedMinor: 1000n },
    });
    // A stale earlier state never moves it back.
    expect(
      (
        await world.ledger.applyRefundObservation({
          refundId: partial.refund.id,
          observation: refundObservation(donation, partial.refund.id, 1000n, {
            state: 'pending',
          }),
          now: new Date(),
        })
      ).refund.state,
    ).toBe('succeeded');

    // A provider answer contradicting the settled refund is never applied
    // backwards: the refund and the refunded total stay, and the donation is flagged.
    const reversed = await world.ledger.applyRefundObservation({
      refundId: partial.refund.id,
      observation: refundObservation(donation, partial.refund.id, 1000n, {
        state: 'failed',
      }),
      now: new Date(),
    });
    expect(reversed).toMatchObject({
      changed: false,
      refund: { state: 'succeeded' },
      donation: {
        state: 'partially_refunded',
        refundedMinor: 1000n,
        attention: 'provider-mismatch',
      },
    });

    // The rest: fully refunded, a second intent.
    donation = (await world.ledger.donation(donation.id)) as DonationRecord;
    const rest = await world.refunds.reserve(reserveInput(donation, authority, 1500n));
    const full = await world.ledger.applyRefundObservation({
      refundId: rest.refund.id,
      observation: refundObservation(donation, rest.refund.id, 1500n),
      now: new Date(),
    });
    expect(full.donation).toMatchObject({
      state: 'refunded',
      refundedMinor: 2500n,
      refundReservedMinor: 2500n,
    });
    expect(
      (await intentsFor(admin, donation.id)).map((intent) => intent.purpose),
    ).toEqual(['donation.partially-refunded', 'donation.refunded', 'donation.succeeded']);
    expect((await auditFor(admin, rest.refund.id)).map((row) => row.action)).toEqual([
      'donations.refund.requested',
      'donations.refund.completed',
    ]);
    // Nothing remains to refund.
    donation = (await world.ledger.donation(donation.id)) as DonationRecord;
    expect(
      await reasonOf(world.refunds.reserve(reserveInput(donation, authority, 1n))),
    ).toBe('over-refund');

    // A mismatched refund observation flags the donation and moves nothing.
    const other = await capturedDonation(world, campaign.id);
    const pendingRefund = await world.refunds.reserve(
      reserveInput(other, authority, 500n),
    );
    const mismatched = await world.ledger.applyRefundObservation({
      refundId: pendingRefund.refund.id,
      observation: refundObservation(other, pendingRefund.refund.id, 400n),
      now: new Date(),
    });
    expect(mismatched).toMatchObject({
      changed: false,
      refund: { state: 'requested' },
      donation: { attention: 'amount-mismatch', refundedMinor: 0n },
    });

    // A charged-back donation is never refunded.
    const lost = await capturedDonation(world, campaign.id);
    await world.ledger.applyObservation({
      donationId: lost.id,
      observation: observation(lost, { dispute: 'lost' }),
      source: 'webhook',
      actorId: null,
      now: new Date(),
    });
    const chargedBack = (await world.ledger.donation(lost.id)) as DonationRecord;
    expect(chargedBack.state).toBe('charged_back');
    expect(
      await reasonOf(world.refunds.reserve(reserveInput(chargedBack, authority, 100n))),
    ).toBe('invalid-state');
  });

  /* ===========================================================================
   * Reconciliation
   * ========================================================================= */

  it('leases due work exclusively and backs off to a person’s question', async () => {
    const campaign = await publishedCampaign(world, operator);
    const { donation } = await world.donor.begin(beginInput(campaign.id));
    const due = new Date(Date.now() + 3 * 60_000);
    const claimed = await world.ledger.claimDueDonations(due, 100, 120);
    const mine = claimed.find((claim) => claim.donationId === donation.id);
    // A claim names the donation only; the reconciler re-reads the row itself.
    expect(mine).toEqual({ donationId: donation.id });
    // Leased: a second sweeper inside the lease gets nothing of it.
    expect(
      (await world.ledger.claimDueDonations(due, 100, 120)).map(
        (claim) => claim.donationId,
      ),
    ).not.toContain(donation.id);
    // After the lease, it is due again.
    expect(
      (
        await world.ledger.claimDueDonations(new Date(due.getTime() + 121_000), 100, 120)
      ).map((claim) => claim.donationId),
    ).toContain(donation.id);

    // Eight bounded waits, then a person's question — the version moves only then.
    const now = new Date();
    const waits = [1, 5, 15, 60, 180, 360, 720, 1440];
    for (const [index, minutes] of waits.entries()) {
      await world.ledger.deferDonation({ donationId: donation.id, now });
      const columns = await donationColumns(admin, donation.id);
      expect(columns).toMatchObject({
        reconcileAttempts: index + 1,
        version: 1,
        attention: null,
      });
      expect(columns?.reconcileDueAt?.getTime()).toBe(now.getTime() + minutes * 60_000);
    }
    await world.ledger.deferDonation({ donationId: donation.id, now });
    expect(await donationColumns(admin, donation.id)).toMatchObject({
      reconcileAttempts: 9,
      reconcileDueAt: null,
      attention: 'unresolved',
      version: 2,
    });

    // An operator asks again: due now, attempts restart, the flag cleared, audited.
    expect(
      await reasonOf(
        world.staff.requestReconcile({
          actorId: operator,
          id: donation.id,
          expectedVersion: 1,
          now: new Date(),
        }),
      ),
    ).toBe('conflict');
    const asked = new Date();
    const requested = await world.staff.requestReconcile({
      actorId: operator,
      id: donation.id,
      expectedVersion: 2,
      now: asked,
    });
    expect(requested).toMatchObject({ version: 3, attention: null });
    expect(await donationColumns(admin, donation.id)).toMatchObject({
      reconcileAttempts: 0,
      reconcileLeaseUntil: null,
    });
    expect((await donationColumns(admin, donation.id))?.reconcileDueAt?.getTime()).toBe(
      asked.getTime(),
    );
    expect((await auditFor(admin, donation.id)).map((row) => row.action)).toEqual([
      'donations.reconcile.requested',
    ]);

    // Refunds: leased with their payment, requested instant and amount.
    const captured = await capturedDonation(world, campaign.id);
    const refund = await world.refunds.reserve(reserveInput(captured, authority, 700n));
    const refundClaims = await world.ledger.claimDueRefunds(
      new Date(Date.now() + 3 * 60_000),
      100,
      120,
    );
    const claim = refundClaims.find((entry) => entry.refundId === refund.refund.id);
    expect(claim).toEqual({
      refundId: refund.refund.id,
      donationId: captured.id,
      refundReference: null,
      paymentReference: paymentOf(captured.id),
      amount: { currency: 'USD', minor: 700n },
      requestedAt: refund.refund.requestedAt,
    });
    expect(
      (
        await world.ledger.claimDueRefunds(new Date(Date.now() + 3 * 60_000), 100, 120)
      ).map((entry) => entry.refundId),
    ).not.toContain(refund.refund.id);
    for (let attempt = 0; attempt < 8; attempt += 1)
      await world.ledger.deferRefund({ refundId: refund.refund.id, now: new Date() });
    expect((await donationColumns(admin, captured.id))?.attention).toBeNull();
    await world.ledger.deferRefund({ refundId: refund.refund.id, now: new Date() });
    expect((await donationColumns(admin, captured.id))?.attention).toBe('unresolved');
    const [deferred] = await admin.query<{
      due: Date | null;
      attempts: number;
      state: string;
    }>(
      `SELECT [reconcileDueAt] AS [due], [reconcileAttempts] AS [attempts], [state] FROM [dbo].[DonationRefund] WHERE [id] = ${n(refund.refund.id)};`,
    );
    expect(deferred).toEqual({ due: null, attempts: 9, state: 'requested' });
  });

  /* ===========================================================================
   * Operator records, owner reads, export
   * ========================================================================= */

  it('lists, details and exports records under audit, filtered and bounded', async () => {
    const campaign = await publishedCampaign(world, operator);
    const donor = await account(admin);
    const linked = await capturedDonation(world, campaign.id, { donorAccountId: donor });
    const anonymous = await createdDonation(world, campaign.id, {
      expected: { currency: 'JPY', minor: 5000n },
    });
    const query = {
      state: null,
      campaignId: campaign.id,
      environment: null,
      donor: null,
      attention: false,
      offset: 0,
    } as const;

    const page = await world.staff.donations(operator, query);
    expect(page.total).toBe(2);
    expect(page.rows.map((row) => row.id)).toEqual([anonymous.id, linked.id]);
    expect(page.rows[1]).toMatchObject({
      donorAccountId: donor,
      linked: true,
      campaign: { campaignId: campaign.id },
      expected: { currency: 'USD', minor: 2500n },
    });
    expect(
      (await world.staff.donations(operator, { ...query, donor: 'linked' })).rows.map(
        (row) => row.id,
      ),
    ).toEqual([linked.id]);
    expect(
      (await world.staff.donations(operator, { ...query, donor: 'anonymous' })).total,
    ).toBe(1);
    expect(
      (await world.staff.donations(operator, { ...query, state: 'succeeded' })).total,
    ).toBe(1);
    expect(
      (await world.staff.donations(operator, { ...query, environment: 'sandbox' })).total,
    ).toBe(0);
    expect(
      (await world.staff.donations(operator, { ...query, attention: true })).total,
    ).toBe(0);
    expect(
      (await world.staff.donations(operator, { ...query, offset: 1 })).rows.map(
        (row) => row.id,
      ),
    ).toEqual([linked.id]);
    const listed = (await auditOf(admin, 'donations.records.listed')).filter(
      (row) => row.actorId === operator,
    );
    expect(JSON.parse(listed[0]?.afterState ?? '{}')).toEqual({
      count: '2',
      offset: '0',
      state: 'all',
      campaignId: campaign.id,
      environment: 'all',
      donor: 'all',
      attention: 'false',
    });

    const detail = await world.staff.donation(operator, linked.id);
    expect(detail).toMatchObject({ id: linked.id, refunds: [], reconcileAttempts: 0 });
    expect((await auditFor(admin, linked.id)).map((row) => row.action)).toEqual([
      'donations.record.accessed',
    ]);
    expect(await world.staff.donation(operator, randomUUID())).toBeNull();

    const exported = await world.staff.exportRows(operator, {
      state: null,
      campaignId: campaign.id,
      environment: 'fixture',
      donor: null,
      attention: false,
    });
    expect(exported.map((row) => row.id)).toEqual([anonymous.id, linked.id]);
    const exportAudit = await auditOf(admin, 'donations.records.exported');
    expect(JSON.parse(exportAudit.at(-1)?.afterState ?? '{}')).toMatchObject({
      count: '2',
      environment: 'fixture',
    });
  });

  it('gives an owner only their own linked donations, exact money as decimal text', async () => {
    const campaign = await publishedCampaign(world, operator);
    const alice = await account(admin);
    const bob = await account(admin);
    const usd = await capturedDonation(world, campaign.id, { donorAccountId: alice });
    const yen = await capturedDonation(world, campaign.id, {
      donorAccountId: alice,
      expected: { currency: 'JPY', minor: 5000n },
    });
    const dinar = await createdDonation(world, campaign.id, {
      donorAccountId: alice,
      expected: { currency: 'KWD', minor: 1250n },
    });
    const bobs = await capturedDonation(world, campaign.id, { donorAccountId: bob });
    await capturedDonation(world, campaign.id);
    const refund = await world.refunds.reserve(reserveInput(usd, authority, 1n));
    await world.ledger.applyRefundObservation({
      refundId: refund.refund.id,
      observation: refundObservation(usd, refund.refund.id, 1n),
      now: new Date(),
    });

    const history = await world.owner.history(alice, 50);
    expect(history.map((row) => row.id).sort()).toEqual(
      [usd.id, yen.id, dinar.id].sort(),
    );
    expect(history.map((row) => row.id)).not.toContain(bobs.id);
    expect(history.find((row) => row.id === usd.id)).toMatchObject({
      state: 'partially_refunded',
      expected: { currency: 'USD', minor: 2500n },
      refundedMinor: 1n,
      environment: 'fixture',
      campaign: { campaignId: campaign.id },
    });
    for (const row of history)
      expect(Object.keys(row).sort()).toEqual(
        [
          'campaign',
          'createdAt',
          'environment',
          'expected',
          'id',
          'refundedMinor',
          'state',
          'succeededAt',
          'updatedAt',
        ].sort(),
      );
    expect((await world.owner.history(bob, 50)).map((row) => row.id)).toEqual([bobs.id]);
    expect(await world.owner.history(await account(admin), 50)).toEqual([]);
    expect((await world.owner.history(alice, 1)).length).toBe(1);

    const rows = await world.owner.exportRows(alice);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(usd.id)).toMatchObject({
      currency: 'USD',
      amount: '25.00',
      refunded: '0.01',
      state: 'partially_refunded',
    });
    expect(byId.get(yen.id)).toMatchObject({
      currency: 'JPY',
      amount: '5000',
      refunded: '0',
      state: 'succeeded',
    });
    expect(byId.get(dinar.id)).toMatchObject({
      currency: 'KWD',
      amount: '1.250',
      refunded: '0.000',
      state: 'pending',
      succeededAt: null,
    });
    for (const row of rows) {
      expect(typeof row.createdAt).toBe('string');
      expect(Object.keys(row).sort()).toEqual(
        [
          'amount',
          'campaignId',
          'createdAt',
          'currency',
          'environment',
          'id',
          'refunded',
          'state',
          'succeededAt',
          'updatedAt',
        ].sort(),
      );
    }
    expect((await world.owner.exportRows(bob)).map((row) => row.id)).toEqual([bobs.id]);
  });

  /* ===========================================================================
   * Service communication
   * ========================================================================= */

  it('relays each owed acknowledgement once, and owes it only while its fact holds', async () => {
    const campaign = await publishedCampaign(world, operator);
    const donor = await account(admin);
    const donation = await capturedDonation(world, campaign.id, {
      donorAccountId: donor,
    });
    const [intent] = await intentsFor(admin, donation.id);
    const later = new Date(Date.now() + 60_000);
    const claimed = await world.communication.claimDue(later, 100, 600);
    expect(claimed.map((entry) => entry.id)).toContain(intent?.id);
    expect(
      (await world.communication.claimDue(later, 100, 600)).map((entry) => entry.id),
    ).not.toContain(intent?.id);
    const source = await world.communication.deliverySource(intent?.id ?? '');
    expect(source).toMatchObject({
      owed: true,
      expected: { currency: 'USD', minor: 2500n },
      refundAmount: null,
      intent: {
        recipientAccountId: donor,
        purpose: 'donation.succeeded',
        state: 'pending',
      },
      campaign: { campaignId: campaign.id },
    });
    await world.communication.markRelayed(intent?.id ?? '', new Date());
    await world.communication.markAbandoned(intent?.id ?? '', new Date());
    const [relayed] = await intentsFor(admin, donation.id);
    expect(relayed?.state).toBe('relayed');
    expect(await world.communication.deliverySource(randomUUID())).toBeNull();
    // The relayed intent is never claimed again.
    expect(
      (
        await world.communication.claimDue(new Date(Date.now() + 3_600_000), 100, 600)
      ).map((entry) => entry.id),
    ).not.toContain(intent?.id);

    // A refund intent carries its own amount.
    const refund = await world.refunds.reserve(reserveInput(donation, authority, 300n));
    await world.ledger.applyRefundObservation({
      refundId: refund.refund.id,
      observation: refundObservation(donation, refund.refund.id, 300n),
      now: new Date(),
    });
    const refundIntent = (await intentsFor(admin, donation.id)).find(
      (entry) => entry.refundId === refund.refund.id,
    );
    expect(
      await world.communication.deliverySource(refundIntent?.id ?? ''),
    ).toMatchObject({
      owed: true,
      refundAmount: { currency: 'USD', minor: 300n },
      intent: { purpose: 'donation.partially-refunded' },
    });
    await world.communication.markAbandoned(refundIntent?.id ?? '', new Date());
    expect(
      (await world.communication.deliverySource(refundIntent?.id ?? ''))?.intent.state,
    ).toBe('abandoned');
  });

  /* ===========================================================================
   * Audit and the runtime floor
   * ========================================================================= */

  it('keeps every Donations audit row free of tokens, full references, addresses and words', async () => {
    const tokens = await admin.query<{
      token: string;
      request: string;
      checkout: string | null;
      payment: string | null;
    }>(
      `SELECT [statusTokenDigest] AS [token], [requestDigest] AS [request], [checkoutReference] AS [checkout], [paymentReference] AS [payment] FROM [dbo].[Donation];`,
    );
    const references = await admin.query<{ reference: string | null }>(
      `SELECT [refundReference] AS [reference] FROM [dbo].[DonationRefund];`,
    );
    const audits = await admin.query<{
      action: string;
      before: string | null;
      after: string | null;
    }>(
      `SELECT [action], [beforeState] AS [before], [afterState] AS [after] FROM [dbo].[AuditLog]
       WHERE [action] LIKE N'donations.%' AND [action] <> N'donations.permissions.provisioned';`,
    );
    expect(tokens.length).toBeGreaterThan(10);
    expect(new Set(audits.map((row) => row.action)).size).toBeGreaterThanOrEqual(10);
    const forbidden = [
      ...tokens.flatMap((row) => [row.token, row.request, row.checkout, row.payment]),
      ...references.map((row) => row.reference),
    ].filter((value): value is string => value !== null);
    for (const row of audits) {
      const text = `${row.before ?? ''}${row.after ?? ''}`;
      for (const value of forbidden) expect(text, row.action).not.toContain(value);
      expect(text, row.action).not.toContain(PROOF_DOMAIN);
      expect(text, row.action).not.toContain('NON_DONATION_FIXTURE');
      expect(text, row.action).not.toMatch(/(?:cs|pi|re)_fixture_/u);
    }
  });

  it('lets the runtime delete no financial history and rewrite nothing that identifies it', async () => {
    for (const statement of [
      'DELETE FROM [dbo].[Donation];',
      'DELETE FROM [dbo].[DonationRefund];',
      'DELETE FROM [dbo].[DonationProviderEvent];',
      'DELETE FROM [dbo].[DonationCampaign];',
      'DELETE FROM [dbo].[DonationCampaignTranslation];',
      'UPDATE [dbo].[Donation] SET [expectedMinor] = [expectedMinor];',
      'UPDATE [dbo].[Donation] SET [statusTokenDigest] = [statusTokenDigest];',
      'UPDATE [dbo].[Donation] SET [accountKey] = [accountKey];',
      'UPDATE [dbo].[DonationRefund] SET [amountMinor] = [amountMinor];',
      'UPDATE [dbo].[DonationRefund] SET [requestedByUserId] = [requestedByUserId];',
      'UPDATE [dbo].[DonationProviderEvent] SET [payloadDigest] = [payloadDigest];',
      'UPDATE [dbo].[DonationCommunicationIntent] SET [recipientUserId] = [recipientUserId];',
    ])
      expect(await sqlNumber(world.app.query(statement)), statement).toBe(
        statement.startsWith('DELETE') ? 229 : 230,
      );
    // And the triggers hold the runtime as they hold the owner.
    const campaign = await publishedCampaign(world, operator);
    const donation = await capturedDonation(world, campaign.id);
    expect(
      await sqlNumber(
        world.app.query(
          `UPDATE [dbo].[Donation] SET [capturedMinor] = NULL, [succeededAt] = NULL, [state] = N'pending', [version] = [version] + 1 WHERE [id] = ${n(donation.id)};`,
        ),
      ),
    ).toBe(51349);
  });

  it('refuses a campaign beyond the catalogue limit', async () => {
    const existing = await count(admin, 'DonationCampaign');
    for (let index = existing; index < DONATION_LIMITS.campaigns; index += 1)
      await world.campaigns.createCampaign({
        id: randomUUID(),
        actorId: operator,
        value: { primaryLocale: 'en', displayOrder: 9000 + index },
      });
    expect(await count(admin, 'DonationCampaign')).toBe(DONATION_LIMITS.campaigns);
    expect(
      await reasonOf(
        world.campaigns.createCampaign({
          id: randomUUID(),
          actorId: operator,
          value: { primaryLocale: 'en', displayOrder: 1 },
        }),
      ),
    ).toBe('limit');
    expect(await count(admin, 'DonationCampaign')).toBe(DONATION_LIMITS.campaigns);
  }, 300_000);
});
