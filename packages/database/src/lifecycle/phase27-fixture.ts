import 'server-only';

import { createHash, randomUUID } from 'node:crypto';
import { deepStrictEqual } from 'node:assert';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-27 STATE for the recovery rehearsals.
 *
 * WHAT THE RECOVERY FIXTURE PROVES THAT A SCHEMA CHECK DOES NOT. That what was
 * given, captured and refunded came back EXACTLY — every amount the same count
 * of minor units at the same exponent, every provider reference in the same
 * scope, every refund still counted once against its own capture, every
 * processed provider event still deduplicated so a redelivery cannot apply it
 * twice — and that the activation, the linked donor and the refund authority
 * came back as they were:
 *
 *   - four campaigns: a published English-primary campaign with words in all
 *     three locales and USD, JPY (exponent 0) and KWD (exponent 3) policies; a
 *     published Urdu-primary campaign with a PKR policy; an archived campaign;
 *     and a draft with only its Arabic primary words;
 *   - the FIXTURE activation for one synthetic provider account;
 *   - an ANONYMOUS PENDING donation with its checkout created; a LINKED donation
 *     captured and then PARTIALLY REFUNDED by a succeeded refund; an anonymous
 *     JPY donation captured at exponent 0; and an anonymous KWD donation whose
 *     create was AMBIGUOUS and is DUE for reconciliation;
 *   - one PROCESSED provider event applied to the linked donation, and one
 *     ADMITTED-but-never-completed event (a crash between admit and complete);
 *   - a synthetic refund authority (a role holding `donations.refund`, its
 *     assignment, a live session and a live `donation-refund` step-up) — which
 *     the refund-admission trigger demands of the refund row written here;
 *   - a RELAYED success acknowledgement and a PENDING partial-refund one, both
 *     owed to the linked donor.
 *
 * NOTHING HERE IS ANYBODY'S DATA OR MONEY. Every name and title is a
 * `NON_DONATION_FIXTURE_…` sentinel, every address `@donations-proof.invalid`,
 * every provider reference a `…_recovery_…` sentinel in the `fixture`
 * environment, every key a `recovery-donations-…` sentinel. Rows are written
 * directly by the owner — the recovery databases are disposable and created by
 * the run that writes them — and the adapters' own write paths are proved by
 * `db:test:permissions` and the integration suites.
 */

const TEXT = {
  donor: 'NON_DONATION_FIXTURE_ACCOUNT donor',
  refunder: 'NON_DONATION_FIXTURE_ACCOUNT refunder',
  title: 'NON_DONATION_FIXTURE_CAMPAIGN title',
  urdu: 'NON_DONATION_FIXTURE_CAMPAIGN عنوان',
  arabic: 'NON_DONATION_FIXTURE_CAMPAIGN عنوان عربي',
} as const;

/** The fixture's one synthetic provider account, in the `fixture` environment. */
const ACCOUNT_KEY = 'acct_recovery_fixture';

export interface Phase27Fixture {
  readonly runId: string;
  readonly donorId: string;
  readonly refunderId: string;
  readonly roleId: string;
  readonly sessionId: string;
  readonly grantId: string;
  readonly campaignEnId: string;
  readonly campaignUrId: string;
  readonly campaignArchivedId: string;
  readonly campaignDraftId: string;
  readonly pendingId: string;
  readonly linkedId: string;
  readonly yenId: string;
  readonly dueId: string;
  readonly processedEventId: string;
  readonly admittedEventId: string;
  readonly refundId: string;
  readonly succeededIntentId: string;
  readonly refundIntentId: string;
}

export function newPhase27Fixture(): Phase27Fixture {
  return {
    runId: randomUUID().replaceAll('-', ''),
    donorId: randomUUID(),
    refunderId: randomUUID(),
    roleId: randomUUID(),
    sessionId: randomUUID(),
    grantId: randomUUID(),
    campaignEnId: randomUUID(),
    campaignUrId: randomUUID(),
    campaignArchivedId: randomUUID(),
    campaignDraftId: randomUUID(),
    pendingId: randomUUID(),
    linkedId: randomUUID(),
    yenId: randomUUID(),
    dueId: randomUUID(),
    processedEventId: randomUUID(),
    admittedEventId: randomUUID(),
    refundId: randomUUID(),
    succeededIntentId: randomUUID(),
    refundIntentId: randomUUID(),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase27Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId))
    throw new Error('Phase-27 fixture runId does not match the expected pattern.');
  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (!/^[0-9a-f-]{36}$/.test(value))
      throw new Error(`Phase-27 fixture field '${name}' is not a generated identifier.`);
  }
}

const AT = '2026-10-10T06:00:00';
const CREATED = '2026-10-10T06:01:00';
const EXPIRES = '2026-10-10T07:01:00';
const CAPTURED = '2026-10-10T06:10:00';
const REFUNDED = '2026-10-10T08:00:00';
const DUE = '2026-10-10T06:05:00';

/** A synthetic digest: the hex SHA-256 of a sentinel, never of a real token or body. */
function digest(stem: string, label: string): string {
  return createHash('sha256').update(`recovery-donations-${stem}-${label}`).digest('hex');
}

/**
 * Writes the populated Phase-27 state into the SOURCE database, before backup,
 * with the MIGRATION principal, so the real keys, CHECKs and triggers are
 * exercised: each campaign a draft at version one, published only with its
 * primary words and a currency; each donation admitted pending for a published
 * campaign, inside the activated scope, at its policy's exact money, and moved
 * forward one version at a time with its state the derivation of its facts;
 * the refund admitted only because its requester holds `donations.refund` with
 * a live `donation-refund` step-up, and the reservation always the sum of the
 * donation's live refunds; each intent owed to the linked donor of its own
 * donation and refund.
 */
export async function writePhase27Fixture(
  sql: SqlSession,
  fixture: Phase27Fixture,
): Promise<void> {
  assertSafe(fixture);
  const f = fixture;
  const stem = f.runId.slice(0, 16);
  const account = (id: string, label: string, name: string): string =>
    `(N'${id}', N'${name}', N'${label}-${stem}@donations-proof.invalid', 0, '${AT}', '${AT}', N'en', N'active', 0)`;
  const words = (campaignId: string, locale: string, title: string): string =>
    `(N'${campaignId}', N'${locale}', N'${title}', N'NON_DONATION_FIXTURE_CAMPAIGN summary', N'NON_DONATION_FIXTURE_CAMPAIGN description', '${AT}')`;

  // ---- accounts, the refund authority, campaigns, policy and the activation ----
  await sql.query(`
    INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES
      ${account(f.donorId, 'donor', TEXT.donor)},
      ${account(f.refunderId, 'refunder', TEXT.refunder)};
    INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system])
      VALUES (N'${f.roleId}', N'recovery-donations-refund-${stem}', N'NON_DONATION_FIXTURE refund role', N'Holds donations.refund for the recovery proof only.', 0);
    INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (N'${f.roleId}', N'donations.refund');
    INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId]) VALUES (N'${f.refunderId}', N'${f.roleId}');
    INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt])
      VALUES (N'${f.sessionId}', N'recovery-donations-${f.sessionId}', N'${f.refunderId}', DATEADD(day,1,SYSUTCDATETIME()), SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[StepUpGrant] ([id],[userId],[sessionId],[purpose],[expiresAt])
      VALUES (N'${f.grantId}', N'${f.refunderId}', N'${f.sessionId}', N'donation-refund', DATEADD(hour,2,SYSUTCDATETIME()));
    INSERT INTO [dbo].[DonationCampaign] ([id],[state],[primaryLocale],[displayOrder],[version],[createdAt],[updatedAt]) VALUES
      (N'${f.campaignEnId}', N'draft', N'en', 0, 1, '${AT}', '${AT}'),
      (N'${f.campaignUrId}', N'draft', N'ur', 1, 1, '${AT}', '${AT}'),
      (N'${f.campaignArchivedId}', N'draft', N'en', 2, 1, '${AT}', '${AT}'),
      (N'${f.campaignDraftId}', N'draft', N'ar', 3, 1, '${AT}', '${AT}');
    INSERT INTO [dbo].[DonationCampaignTranslation] ([campaignId],[locale],[title],[summary],[description],[updatedAt]) VALUES
      ${words(f.campaignEnId, 'en', TEXT.title)},
      ${words(f.campaignEnId, 'ur', TEXT.urdu)},
      ${words(f.campaignEnId, 'ar', TEXT.arabic)},
      ${words(f.campaignUrId, 'ur', TEXT.urdu)},
      ${words(f.campaignArchivedId, 'en', TEXT.title)},
      ${words(f.campaignDraftId, 'ar', TEXT.arabic)};
    INSERT INTO [dbo].[DonationCampaignCurrency] ([campaignId],[currency],[currencyExponent],[minimumMinor],[maximumMinor],[suggested1Minor],[suggested2Minor],[suggested3Minor],[updatedAt]) VALUES
      (N'${f.campaignEnId}', 'USD', 2, 100, 999999999999, 500, 2500, 10000, '${AT}'),
      (N'${f.campaignEnId}', 'JPY', 0, 100, 10000000, 1000, 5000, NULL, '${AT}'),
      (N'${f.campaignEnId}', 'KWD', 3, 1000, 500000, 1250, NULL, NULL, '${AT}'),
      (N'${f.campaignUrId}', 'PKR', 2, 10000, 100000000, NULL, NULL, NULL, '${AT}'),
      (N'${f.campaignArchivedId}', 'EUR', 2, 100, 100000, NULL, NULL, NULL, '${AT}');
    UPDATE [dbo].[DonationCampaign] SET [state]=N'published', [publishedAt]='${AT}', [version]=2
      WHERE [id] IN (N'${f.campaignEnId}', N'${f.campaignUrId}', N'${f.campaignArchivedId}');
    UPDATE [dbo].[DonationCampaign] SET [state]=N'archived', [archivedAt]='${CREATED}', [version]=3, [updatedAt]='${CREATED}'
      WHERE [id]=N'${f.campaignArchivedId}';
    INSERT INTO [dbo].[DonationActivation] ([id],[provider],[environment],[accountKey],[authority],[authorisedBy],[reference],[activatedAt])
      VALUES (1, N'stripe', N'fixture', N'${ACCOUNT_KEY}', N'fixture', N'NON_DONATION_FIXTURE_OWNER', NULL, '${AT}');
  `);

  // ---- the donations, each admitted fresh and moved forward one version at a time ----
  const donation = (
    id: string,
    donor: string | null,
    currency: string,
    exponent: number,
    minor: string,
    label: string,
  ): string =>
    `(N'${id}', N'${f.campaignEnId}', ${donor === null ? 'NULL' : `N'${donor}'`}, N'${randomUUID()}', '${digest(stem, `request-${label}`)}', '${digest(stem, `token-${label}`)}', N'en', N'${TEXT.title}', '${currency}', ${String(exponent)}, ${minor}, N'stripe', N'fixture', N'${ACCOUNT_KEY}', '${AT}', '${AT}')`;
  const checkout = (id: string, label: string): string =>
    `UPDATE [dbo].[Donation] SET [createState]=N'created', [checkoutReference]=N'cs_recovery_${stem}_${label}', [checkoutExpiresAt]='${EXPIRES}', [reconcileDueAt]='${DUE}', [version]=2, [updatedAt]='${CREATED}' WHERE [id]=N'${id}';`;
  const capture = (id: string, minor: string, label: string): string =>
    `UPDATE [dbo].[Donation] SET [capturedMinor]=${minor}, [paymentReference]=N'pi_recovery_${stem}_${label}', [succeededAt]='${CAPTURED}', [state]=N'succeeded', [reconcileDueAt]=NULL, [version]=3, [updatedAt]='${CAPTURED}' WHERE [id]=N'${id}';`;
  await sql.query(`
    INSERT INTO [dbo].[Donation] ([id],[campaignId],[donorUserId],[operationId],[requestDigest],[statusTokenDigest],[locale],[checkoutLabel],[currency],[currencyExponent],[expectedMinor],[provider],[environment],[accountKey],[createdAt],[updatedAt]) VALUES
      ${donation(f.pendingId, null, 'USD', 2, '2500', 'pending')},
      ${donation(f.linkedId, f.donorId, 'USD', 2, '2500', 'linked')},
      ${donation(f.yenId, null, 'JPY', 0, '5000', 'yen')},
      ${donation(f.dueId, null, 'KWD', 3, '1250', 'due')};
    ${checkout(f.pendingId, 'pending')}
    ${checkout(f.linkedId, 'linked')}
    ${checkout(f.yenId, 'yen')}
    ${capture(f.linkedId, '2500', 'linked')}
    ${capture(f.yenId, '5000', 'yen')}
    UPDATE [dbo].[Donation] SET [createState]=N'ambiguous', [reconcileDueAt]='${DUE}', [version]=2, [updatedAt]='${CREATED}' WHERE [id]=N'${f.dueId}';
    UPDATE [dbo].[Donation] SET [reconcileAttempts]=2, [reconcileDueAt]='${DUE}' WHERE [id]=N'${f.dueId}';
  `);

  // ---- provider events, the partial refund, and the owed mail -----------------------
  await sql.query(`
    INSERT INTO [dbo].[DonationProviderEvent] ([id],[provider],[environment],[accountKey],[eventId],[eventType],[occurredAt],[receivedAt],[payloadDigest],[donationId],[result],[processedAt]) VALUES
      (N'${f.processedEventId}', N'stripe', N'fixture', N'${ACCOUNT_KEY}', N'evt_recovery_${stem}_processed', N'checkout.session.completed', '${CAPTURED}', '${CAPTURED}', '${digest(stem, 'event-processed')}', NULL, NULL, NULL),
      (N'${f.admittedEventId}', N'stripe', N'fixture', N'${ACCOUNT_KEY}', N'evt_recovery_${stem}_admitted', N'charge.refunded', '${REFUNDED}', '${REFUNDED}', '${digest(stem, 'event-admitted')}', NULL, NULL, NULL);
    UPDATE [dbo].[DonationProviderEvent] SET [result]=N'applied', [processedAt]='${CAPTURED}', [donationId]=N'${f.linkedId}'
      WHERE [id]=N'${f.processedEventId}';
    INSERT INTO [dbo].[DonationRefund] ([id],[donationId],[operationId],[requestDigest],[currency],[currencyExponent],[amountMinor],[provider],[environment],[accountKey],[requestedByUserId],[requestedAt],[reconcileDueAt])
      VALUES (N'${f.refundId}', N'${f.linkedId}', N'${randomUUID()}', '${digest(stem, 'refund')}', 'USD', 2, 1000, N'stripe', N'fixture', N'${ACCOUNT_KEY}', N'${f.refunderId}', '${REFUNDED}', '${REFUNDED}');
    UPDATE [dbo].[Donation] SET [refundReservedMinor]=1000, [version]=4, [updatedAt]='${REFUNDED}' WHERE [id]=N'${f.linkedId}';
    UPDATE [dbo].[DonationRefund] SET [state]=N'pending', [refundReference]=N're_recovery_${stem}_partial', [version]=2 WHERE [id]=N'${f.refundId}';
    UPDATE [dbo].[DonationRefund] SET [state]=N'succeeded', [completedAt]='${REFUNDED}', [reconcileDueAt]=NULL, [version]=3 WHERE [id]=N'${f.refundId}';
    UPDATE [dbo].[Donation] SET [refundedMinor]=1000, [state]=N'partially_refunded', [version]=5, [updatedAt]='${REFUNDED}' WHERE [id]=N'${f.linkedId}';
    INSERT INTO [dbo].[DonationCommunicationIntent] ([id],[purpose],[donationId],[refundId],[recipientUserId],[dueAt],[state],[idempotencyKey],[createdAt]) VALUES
      (N'${f.succeededIntentId}', N'donation.succeeded', N'${f.linkedId}', NULL, N'${f.donorId}', '${CAPTURED}', N'pending', N'recovery-donations-${stem}-succeeded', '${CAPTURED}'),
      (N'${f.refundIntentId}', N'donation.partially-refunded', N'${f.linkedId}', N'${f.refundId}', N'${f.donorId}', '${REFUNDED}', N'pending', N'recovery-donations-${stem}-refunded', '${REFUNDED}');
    UPDATE [dbo].[DonationCommunicationIntent] SET [state]=N'relayed', [relayedAt]='${REFUNDED}'
      WHERE [id]=N'${f.succeededIntentId}';
  `);
}

/** Every authoritative Phase-27 row this fixture wrote, in a stable order. */
export async function capturePhase27Fixture(
  sql: SqlSession,
  fixture: Phase27Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const f = fixture;
  const accounts = `N'${f.donorId}',N'${f.refunderId}'`;
  const campaigns = `N'${f.campaignEnId}',N'${f.campaignUrId}',N'${f.campaignArchivedId}',N'${f.campaignDraftId}'`;
  const donations = `N'${f.pendingId}',N'${f.linkedId}',N'${f.yenId}',N'${f.dueId}'`;
  const rows: Record<string, string> = {};

  // Every BIGINT is read back as its exact decimal TEXT beside the row, so a
  // restore that lost precision anywhere differs here even if a driver were to
  // round a large value on the way out.
  for (const [name, statement, expected] of [
    [
      'User',
      `SELECT * FROM [dbo].[User] WHERE [id] IN (${accounts}) ORDER BY [email]`,
      2,
    ],
    [
      'RefundAuthority',
      `SELECT rp.[permissionKey], ra.[userId], ra.[revokedAt], r.[deactivatedAt]
         FROM [dbo].[Role] r JOIN [dbo].[RolePermission] rp ON rp.[roleId] = r.[id]
         JOIN [dbo].[RoleAssignment] ra ON ra.[roleId] = r.[id]
        WHERE r.[id] = N'${f.roleId}'`,
      1,
    ],
    [
      'DonationCampaign',
      `SELECT * FROM [dbo].[DonationCampaign] WHERE [id] IN (${campaigns}) ORDER BY [displayOrder]`,
      4,
    ],
    [
      'DonationCampaignTranslation',
      `SELECT * FROM [dbo].[DonationCampaignTranslation] WHERE [campaignId] IN (${campaigns}) ORDER BY [campaignId], [locale]`,
      6,
    ],
    [
      'DonationCampaignCurrency',
      `SELECT *, CONVERT(NVARCHAR(20), [minimumMinor]) AS [minimumText], CONVERT(NVARCHAR(20), [maximumMinor]) AS [maximumText]
         FROM [dbo].[DonationCampaignCurrency] WHERE [campaignId] IN (${campaigns}) ORDER BY [campaignId], [currency]`,
      5,
    ],
    ['DonationActivation', 'SELECT * FROM [dbo].[DonationActivation]', 1],
    [
      'Donation',
      `SELECT *, CONVERT(NVARCHAR(20), [expectedMinor]) AS [expectedText],
              CONVERT(NVARCHAR(20), [capturedMinor]) AS [capturedText],
              CONVERT(NVARCHAR(20), [refundedMinor]) AS [refundedText]
         FROM [dbo].[Donation] WHERE [id] IN (${donations}) ORDER BY [id]`,
      4,
    ],
    [
      'DonationProviderEvent',
      `SELECT * FROM [dbo].[DonationProviderEvent] WHERE [accountKey] = N'${ACCOUNT_KEY}' ORDER BY [eventId]`,
      2,
    ],
    [
      'DonationRefund',
      `SELECT *, CONVERT(NVARCHAR(20), [amountMinor]) AS [amountText]
         FROM [dbo].[DonationRefund] WHERE [donationId] IN (${donations}) ORDER BY [id]`,
      1,
    ],
    [
      'DonationCommunicationIntent',
      `SELECT * FROM [dbo].[DonationCommunicationIntent] WHERE [recipientUserId] IN (${accounts}) ORDER BY [purpose]`,
      2,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected) {
      throw new Error(
        `Phase-27 recovery expected ${String(expected)} ${name} row(s), found ${String(data.length)}.`,
      );
    }
    rows[name] = JSON.stringify(data, (_key, value: unknown) =>
      typeof value === 'bigint' ? `${value.toString()}n` : value,
    );
  }

  return rows;
}

/** The Phase-27 tables whose constraints and triggers must return intact. */
const PHASE27_TABLES = [
  'DonationCampaign',
  'DonationCampaignTranslation',
  'DonationCampaignCurrency',
  'DonationActivation',
  'Donation',
  'DonationProviderEvent',
  'DonationRefund',
  'DonationCommunicationIntent',
] as const;

/** Every Donations trigger, exactly. */
const PHASE27_TRIGGERS = [
  'DonationActivationImmutable',
  'DonationAdmission',
  'DonationCampaignCurrencyIntegrity',
  'DonationCampaignIntegrity',
  'DonationCampaignTranslationIntegrity',
  'DonationIntegrity',
  'DonationIntentIntegrity',
  'DonationProviderEventIntegrity',
  'DonationRefundAdmission',
  'DonationRefundIntegrity',
].join(',');

/**
 * The three scoped provider references, exactly — compared as a set, because
 * the server's collation and JavaScript order an underscore differently.
 */
const PHASE27_FILTERED = [
  'DonationRefund_reference_key',
  'Donation_checkout_key',
  'Donation_payment_key',
]
  .sort()
  .join(',');

/**
 * Verifies the restored Donations state and returns one line of what was
 * proved.
 *
 * BEYOND ROW EQUALITY: every name, address, title, reference and key is still
 * an unmistakable sentinel, the Urdu and Arabic words intact; EXACT MONEY —
 * each amount the same minor units at its currency's own exponent (USD 2, JPY
 * 0, KWD 3), every capture exactly its expected amount, and each donation's
 * refunded total exactly its own succeeded refunds and its reservation exactly
 * its live ones; every state the derivation of its facts; every donation,
 * event and refund inside the one activated scope; the processed event still
 * completed once and the crashed one still admitted for a retry, under the
 * scoped dedup key; the linked donation still its donor's own and its mail
 * still owed only to them, the anonymous ones naming nobody; the ambiguous
 * create still due for reconciliation; LEAST PRIVILEGE — the two ordinary keys
 * bundled, `donations.refund` held by the synthetic role alone and never by
 * the protected one; no card, payload or float artifact anywhere; and every
 * Phase-27 CHECK, foreign key, trigger and filtered key enabled and trusted,
 * with no key cascading at all.
 */
export async function verifyRestoredPhase27(
  sql: SqlSession,
  fixture: Phase27Fixture,
  expected: Readonly<Record<string, string>>,
): Promise<string> {
  deepStrictEqual(
    await capturePhase27Fixture(sql, fixture),
    expected,
    'Phase-27 Donations authoritative values changed during recovery.',
  );
  const f = fixture;
  const accounts = `N'${f.donorId}',N'${f.refunderId}'`;
  const campaigns = `N'${f.campaignEnId}',N'${f.campaignUrId}',N'${f.campaignArchivedId}',N'${f.campaignDraftId}'`;
  const donations = `N'${f.pendingId}',N'${f.linkedId}',N'${f.yenId}',N'${f.dueId}'`;

  const [labelled] = await sql.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[User] WHERE [id] IN (${accounts})
         AND ([name] NOT LIKE N'NON[_]DONATION[_]FIXTURE[_]%' OR [email] NOT LIKE N'%@donations-proof.invalid')) AS [accounts],
      (SELECT COUNT(*) FROM [dbo].[DonationCampaignTranslation] WHERE [campaignId] IN (${campaigns})
         AND ([title] NOT LIKE N'NON[_]DONATION[_]FIXTURE[_]%' OR [summary] NOT LIKE N'NON[_]DONATION[_]FIXTURE[_]%')) AS [words],
      (SELECT COUNT(*) FROM [dbo].[DonationCampaignTranslation] WHERE [campaignId] IN (${campaigns})
         AND [locale] IN (N'ur', N'ar') AND [title] NOT LIKE N'%' + NCHAR(1593) + N'%') AS [script],
      (SELECT COUNT(*) FROM [dbo].[Donation] WHERE [id] IN (${donations})
         AND (([checkoutReference] IS NOT NULL AND [checkoutReference] NOT LIKE N'cs[_]recovery[_]%')
              OR ([paymentReference] IS NOT NULL AND [paymentReference] NOT LIKE N'pi[_]recovery[_]%')
              OR [checkoutLabel] NOT LIKE N'NON[_]DONATION[_]FIXTURE[_]%')) AS [references],
      (SELECT COUNT(*) FROM [dbo].[DonationCommunicationIntent] WHERE [recipientUserId] IN (${accounts})
         AND [idempotencyKey] NOT LIKE N'recovery-donations-%') AS [keys];
  `);
  if (
    JSON.stringify(labelled) !==
    '{"accounts":0,"words":0,"script":0,"references":0,"keys":0}'
  ) {
    throw new Error(
      `Restored Phase-27 fixture is no longer unmistakably labelled: ${JSON.stringify(labelled)}.`,
    );
  }

  // Exact money, derivation, scope, dedup, ownership and the reconcile schedule —
  // through the same columns and predicates the adapter reads by.
  const [state] = await sql.query<Record<string, number | string | null>>(`
    SELECT
      (SELECT STRING_AGG([state], N',') WITHIN GROUP (ORDER BY [displayOrder])
         FROM [dbo].[DonationCampaign] WHERE [id] IN (${campaigns})) AS [campaigns],
      (SELECT STRING_AGG([currency] + N':' + CONVERT(NVARCHAR(1), [currencyExponent]) + N':'
                + CONVERT(NVARCHAR(20), [expectedMinor]) + N':' + ISNULL(CONVERT(NVARCHAR(20), [capturedMinor]), N'-')
                + N':' + CONVERT(NVARCHAR(20), [refundedMinor]) + N':' + CONVERT(NVARCHAR(20), [refundReservedMinor])
                + N':' + [state] + N':' + [createState], N',') WITHIN GROUP (ORDER BY [currency], [state])
         FROM [dbo].[Donation] WHERE [id] IN (${donations})) AS [money],
      (SELECT COUNT(*) FROM [dbo].[Donation] d
        WHERE d.[id] IN (${donations})
          AND (d.[refundedMinor] <> ISNULL((SELECT SUM(r.[amountMinor]) FROM [dbo].[DonationRefund] r
                                             WHERE r.[donationId] = d.[id] AND r.[state] = N'succeeded'), 0)
               OR d.[refundReservedMinor] <> ISNULL((SELECT SUM(r.[amountMinor]) FROM [dbo].[DonationRefund] r
                                                    WHERE r.[donationId] = d.[id]
                                                      AND r.[state] IN (N'requested', N'pending', N'succeeded')), 0)
               OR (d.[capturedMinor] IS NOT NULL AND d.[capturedMinor] <> d.[expectedMinor]))) AS [unbalanced],
      (SELECT COUNT(*) FROM [dbo].[Donation] d
         LEFT JOIN [dbo].[DonationActivation] a ON a.[provider] = d.[provider] AND a.[environment] = d.[environment]
           AND a.[accountKey] COLLATE Latin1_General_BIN2 = d.[accountKey] COLLATE Latin1_General_BIN2
           AND a.[authority] = N'fixture'
        WHERE d.[id] IN (${donations}) AND a.[id] IS NULL) AS [outOfScope],
      (SELECT STRING_AGG([eventType] + N':' + ISNULL([result], N'-') + N':'
                + CASE WHEN [donationId] = N'${f.linkedId}' THEN N'linked' WHEN [donationId] IS NULL THEN N'none' ELSE N'other' END,
                N',') WITHIN GROUP (ORDER BY [eventType])
         FROM [dbo].[DonationProviderEvent] WHERE [accountKey] = N'${ACCOUNT_KEY}') AS [events],
      (SELECT COUNT(*) FROM [dbo].[DonationProviderEvent]
        WHERE [provider] = N'stripe' AND [environment] = N'fixture' AND [accountKey] = N'${ACCOUNT_KEY}'
          AND [eventId] = N'evt_recovery_${f.runId.slice(0, 16)}_processed') AS [deduplicated],
      (SELECT STRING_AGG(r.[state] + N':' + CONVERT(NVARCHAR(20), r.[amountMinor]) + N':'
                + CASE WHEN r.[requestedByUserId] = N'${f.refunderId}' THEN N'refunder' ELSE N'other' END, N',')
         FROM [dbo].[DonationRefund] r WHERE r.[donationId] = N'${f.linkedId}') AS [refunds],
      (SELECT STRING_AGG(CASE WHEN [donorUserId] IS NULL THEN N'anonymous'
                              WHEN [donorUserId] = N'${f.donorId}' THEN N'donor' ELSE N'other' END, N',')
                WITHIN GROUP (ORDER BY [currency], [state])
         FROM [dbo].[Donation] WHERE [id] IN (${donations})) AS [ownership],
      (SELECT STRING_AGG(i.[purpose] + N':' + i.[state], N',') WITHIN GROUP (ORDER BY i.[purpose])
         FROM [dbo].[DonationCommunicationIntent] i
         JOIN [dbo].[Donation] d ON d.[id] = i.[donationId] AND d.[donorUserId] = i.[recipientUserId]
        WHERE i.[recipientUserId] = N'${f.donorId}') AS [owed],
      (SELECT COUNT(*) FROM [dbo].[Donation]
        WHERE [id] = N'${f.dueId}' AND [reconcileDueAt] IS NOT NULL AND [reconcileAttempts] = 2
          AND [createState] = N'ambiguous' AND [checkoutReference] IS NULL) AS [due],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] o ON o.[id] = rp.[roleId]
        WHERE o.[key] = N'platform-administrator'
          AND rp.[permissionKey] IN (N'donations.read', N'donations.administer')) AS [bundled],
      (SELECT STRING_AGG(o.[key], N',') FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] o ON o.[id] = rp.[roleId]
        WHERE rp.[permissionKey] = N'donations.refund') AS [refundHeldBy],
      (SELECT COUNT(*) FROM [dbo].[Permission] WHERE [key] LIKE N'donations.%') AS [catalogued];
  `);
  const stem = f.runId.slice(0, 16);
  const expectedState = {
    campaigns: 'published,published,archived,draft',
    money:
      'JPY:0:5000:5000:0:0:succeeded:created,' +
      'KWD:3:1250:-:0:0:pending:ambiguous,' +
      'USD:2:2500:2500:1000:1000:partially_refunded:created,' +
      'USD:2:2500:-:0:0:pending:created',
    unbalanced: 0,
    outOfScope: 0,
    events: 'charge.refunded:-:none,checkout.session.completed:applied:linked',
    deduplicated: 1,
    refunds: 'succeeded:1000:refunder',
    ownership: 'anonymous,anonymous,donor,anonymous',
    owed: 'donation.partially-refunded:pending,donation.succeeded:relayed',
    due: 1,
    bundled: 2,
    refundHeldBy: `recovery-donations-refund-${stem}`,
    catalogued: 3,
  };
  if (JSON.stringify(state) !== JSON.stringify(expectedState)) {
    throw new Error(
      `Restored Phase-27 Donations state is broken: ${JSON.stringify(state)}.`,
    );
  }

  // NO CREDENTIAL, PAYLOAD OR FLOAT survived or arrived with the restore, and no
  // table beyond the eight is a Donations record.
  const tables = PHASE27_TABLES.map((table) => `OBJECT_ID(N'${table}')`).join(',');
  const [artifacts] = await sql.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM sys.columns c JOIN sys.types t ON t.[user_type_id] = c.[user_type_id]
        WHERE c.[object_id] IN (${tables})
          AND (t.[name] IN (N'float', N'real', N'money', N'smallmoney', N'decimal', N'numeric')
               OR c.[name] LIKE N'%card%' OR c.[name] LIKE N'%cvc%' OR c.[name] LIKE N'%iban%'
               OR c.[name] LIKE N'%billing%' OR c.[name] LIKE N'%email%' OR c.[name] LIKE N'%url%'
               OR (c.[name] LIKE N'%payload%' AND c.[name] <> N'payloadDigest')
               OR (c.[name] LIKE N'%token%' AND c.[name] <> N'statusTokenDigest')
               OR c.[name] IN (N'targetType', N'targetId'))) AS [columns],
      (SELECT COUNT(*) FROM sys.tables
        WHERE [name] LIKE N'Donation%' AND [name] NOT IN (${PHASE27_TABLES.map((table) => `N'${table}'`).join(',')})) AS [tables],
      (SELECT COUNT(*) FROM [dbo].[Permission]
        WHERE [key] LIKE N'donations.%'
          AND [key] NOT IN (N'donations.read', N'donations.administer', N'donations.refund')) AS [keys];
  `);
  if (JSON.stringify(artifacts) !== '{"columns":0,"tables":0,"keys":0}') {
    throw new Error(
      `Restored Phase-27 schema carries a credential, payload, float or foreign artifact: ${JSON.stringify(artifacts)}.`,
    );
  }

  const broken = await sql.query<{ name: string }>(
    `SELECT [name] FROM sys.check_constraints
     WHERE parent_object_id IN (${tables}) AND (is_disabled=1 OR is_not_trusted=1)
     UNION ALL
     SELECT [name] FROM sys.foreign_keys
     WHERE parent_object_id IN (${tables})
       AND (is_disabled=1 OR is_not_trusted=1 OR delete_referential_action<>0 OR update_referential_action<>0)
     UNION ALL
     SELECT [name] FROM sys.triggers WHERE parent_id IN (${tables}) AND is_disabled=1;`,
  );
  if (broken.length > 0) {
    throw new Error(
      `Restored Phase-27 constraints or triggers are not intact: ${broken.map((row) => row.name).join(', ')}`,
    );
  }

  const [counts] = await sql.query<{
    checks: number;
    keys: number;
    triggers: string | null;
    filtered: string | null;
  }>(
    `SELECT
       (SELECT COUNT_BIG(*) FROM sys.check_constraints WHERE parent_object_id IN (${tables})) AS [checks],
       (SELECT COUNT_BIG(*) FROM sys.foreign_keys WHERE parent_object_id IN (${tables})) AS [keys],
       (SELECT STRING_AGG([name], N',') WITHIN GROUP (ORDER BY [name]) FROM sys.triggers
         WHERE parent_id IN (${tables})) AS [triggers],
       (SELECT STRING_AGG([name], N',') WITHIN GROUP (ORDER BY [name]) FROM sys.indexes
         WHERE [object_id] IN (${tables}) AND has_filter=1 AND is_unique=1) AS [filtered];`,
  );
  // 11 CHECKs, 12 foreign keys none of which cascades, the 10 triggers and the
  // three filtered provider references, exactly as the migration creates them:
  // a restore that silently lost one would otherwise read as "none untrusted".
  if (
    Number(counts?.checks ?? 0) !== 11 ||
    Number(counts?.keys ?? 0) !== 12 ||
    counts?.triggers !== PHASE27_TRIGGERS ||
    (counts.filtered ?? '').split(',').sort().join(',') !== PHASE27_FILTERED
  ) {
    throw new Error(
      `Restored Phase-27 objects are incomplete: ${JSON.stringify(counts ?? null)}.`,
    );
  }

  return 'published, archived and draft campaigns with their Urdu and Arabic words and USD, JPY (exponent 0), KWD (exponent 3) and PKR policies, the fixture activation, an anonymous pending donation, a linked donation captured and partially refunded with its refunded total and reservation exactly its own refunds, an anonymous JPY capture, an ambiguous KWD create still due for reconciliation, every donation inside the activated scope, the processed provider event completed once under its scoped dedup key beside a crashed one still admitted, a relayed and a pending acknowledgement owed only to the linked donor, both ordinary keys bundled and donations.refund held by the synthetic role alone, no credential, payload or float column, and every key, CHECK, trigger and filtered reference trusted with no cascade';
}
