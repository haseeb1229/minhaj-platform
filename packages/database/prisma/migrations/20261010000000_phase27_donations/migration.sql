-- ===========================================================================
-- Phase 27 — Donations
-- ===========================================================================
--
-- THE DONATIONS CONTEXT (DOMAIN_MODEL.md 17.3): DonationCampaign with its
-- localized words and its per-currency policy, the owner's fail-closed
-- provider activation, Donation (one payment attempt), the provider-event
-- dedup record, DonationRefund, and the linked donor's durable service-mail
-- intent.
--
-- EXACT MONEY. Every amount is a BIGINT count of its currency's ISO 4217
-- minor unit, carried beside its currency AND the exponent it was written
-- under; the (currency, exponent) pair must be one of the server's allowlist
-- (CURRENCY_EXPONENTS). No FLOAT, REAL, MONEY or DECIMAL column exists, and no
-- amount is ever negative or above 999 999 999 999 minor units.
--
-- PROVIDER TRUTH, NOT BROWSER CLAIMS. A donation's state is DERIVED from its
-- monotonic facts — captured (set once, exactly the expected amount),
-- refunded (never decreases, never above captured), dispute (none -> open ->
-- won | lost), closure (only while nothing is captured) and the donor's
-- cancellation request — and a CHECK refuses any row whose state is not
-- exactly that derivation. Provider references are scoped by provider,
-- environment and account, unique within that scope, and set once.
--
-- NO PAYMENT CREDENTIAL. No card, security code, expiry, wallet, bank,
-- billing address, payer email, shopper identity or raw provider payload is
-- stored anywhere below: an event keeps its id, type, instants and the
-- SHA-256 of its verified bytes, never the bytes.
--
-- FAIL CLOSED UNTIL ACTIVATED. `DonationActivation` holds at most one row,
-- written by the owner only, immutable once written; with no row no donation
-- can be created. A non-production environment needs `fixture` authority and
-- production needs `approved` authority with recorded evidence. This
-- migration writes NO activation.
--
-- REFUND AUTHORITY IS RE-CHECKED IN SQL. A refund row is admitted only for a
-- requester who holds `donations.refund` NOW, through a live assignment of an
-- active role on an active account, AND a live `donation-refund` step-up
-- grant bound to a live session of that account — never on the caller's word.
--
-- TYPED REFERENCES, NEVER A TARGET PAIR. An intent names its donation by a
-- composite key that carries the donor, and a refund intent names its refund
-- by a composite key that carries the donation. No `targetType` / `targetId`
-- column exists anywhere.
--
-- NOTHING CASCADES, AND NOTHING FINANCIAL IS DELETED. Every foreign key is NO
-- ACTION. A donation, an event and a refund are never deleted by the runtime;
-- a closed account's disposition releases the donor link (the donation becomes
-- anonymous, its money and history untouched) and removes only owed mail. A
-- campaign's currency policy may be removed by an operator.
--
-- REFUSALS 51340-51358 (within the 51340-51369 range reserved for this phase):
--   51340  a campaign created other than as a draft, re-keyed, returned to
--          draft or moved off one version at a time; its words or currency
--          policy re-keyed
--   51341  a campaign published without its primary locale's words or any
--          currency, or a published campaign left without either
--   51342  the activation changed or removed
--   51343  a donation for a campaign that is not published
--   51344  a donation whose amount the campaign's current policy refuses
--   51345  a donation outside the activated provider scope
--   51346  a linked donation for an account that is not active
--   51347  a donation created other than pending, uncaptured, version 1
--   51348  a donation's identity, request or expected money rewritten
--   51349  a donation's facts regressed, its state moved without a version,
--          or its reservation not the sum of its live refunds
--   51350  a donor link changed other than released for a closed account
--   51351  a provider event re-keyed or completed twice
--   51352  a refund of a donation not captured, or charged back
--   51353  a refund in another currency or provider scope than its donation
--   51354  a refund requested without `donations.refund` and a live
--          `donation-refund` step-up
--   51355  refunds reserved beyond the captured amount
--   51356  a refund moved backwards, re-keyed or its reference reset
--   51357  a relayed or abandoned intent reopened, or an intent re-keyed
--   51358  a refund created other than requested, version 1
--
-- POSTURES FOR THE APPLICATION PRINCIPAL (grant-application-principal.sql):
--
--   CAMPAIGN     DonationCampaign: SELECT, INSERT, UPDATE; never DELETE, and
--                never its identity, primary locale or creation instant.
--   WORDS        DonationCampaignTranslation: SELECT, INSERT, UPDATE; never
--                DELETE, and never its campaign or locale.
--   POLICY       DonationCampaignCurrency: SELECT, INSERT, UPDATE, DELETE;
--                never its campaign, currency or exponent.
--   ACTIVATION   DonationActivation: SELECT only.
--   DONATION     Donation: SELECT, INSERT, UPDATE; never DELETE, and never its
--                identity, request, token digest, locale, label, expected
--                money, provider scope or creation instant.
--   EVENT        DonationProviderEvent: SELECT, INSERT, UPDATE; never DELETE,
--                and never what identifies it.
--   REFUND       DonationRefund: SELECT, INSERT, UPDATE; never DELETE, and
--                never its donation, request, money, scope, requester or
--                request instant.
--   INTENT       DonationCommunicationIntent: SELECT, INSERT, UPDATE of
--                state/claim/relay, DELETE (a closed account's owed mail).
--
-- TWO ORDINARY KEYS AND ONE GATED KEY: `donations.read` and
-- `donations.administer` join the protected Platform Administrator bundle by
-- the convention every earlier phase used, invalidating its holders' sessions
-- and step-up grants in the same transaction. `donations.refund` is
-- catalogued only: externally gated, bundled into no role, held by nobody.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.
-- ===========================================================================

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[DonationCampaign] (
    [id] NVARCHAR(36) NOT NULL,
    [state] NVARCHAR(16) NOT NULL CONSTRAINT [DonationCampaign_state_df] DEFAULT N'draft',
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [displayOrder] INT NOT NULL,
    [version] INT NOT NULL CONSTRAINT [DonationCampaign_version_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DonationCampaign_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [DonationCampaign_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    [publishedAt] DATETIME2,
    [archivedAt] DATETIME2,
    CONSTRAINT [DonationCampaign_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[DonationCampaignTranslation] (
    [campaignId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(160) NOT NULL,
    [summary] NVARCHAR(600) NOT NULL,
    [description] NVARCHAR(4000) NOT NULL,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [DonationCampaignTranslation_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [DonationCampaignTranslation_pkey] PRIMARY KEY CLUSTERED ([campaignId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[DonationCampaignCurrency] (
    [campaignId] NVARCHAR(36) NOT NULL,
    [currency] CHAR(3) NOT NULL,
    [currencyExponent] TINYINT NOT NULL,
    [minimumMinor] BIGINT NOT NULL,
    [maximumMinor] BIGINT NOT NULL,
    [suggested1Minor] BIGINT,
    [suggested2Minor] BIGINT,
    [suggested3Minor] BIGINT,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [DonationCampaignCurrency_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [DonationCampaignCurrency_pkey] PRIMARY KEY CLUSTERED ([campaignId],[currency])
);

-- CreateTable
CREATE TABLE [dbo].[DonationActivation] (
    [id] TINYINT NOT NULL,
    [provider] NVARCHAR(16) NOT NULL,
    [environment] NVARCHAR(16) NOT NULL,
    [accountKey] NVARCHAR(64) NOT NULL,
    [authority] NVARCHAR(16) NOT NULL,
    [authorisedBy] NVARCHAR(200) NOT NULL,
    [reference] NVARCHAR(400),
    [activatedAt] DATETIME2 NOT NULL CONSTRAINT [DonationActivation_activatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [DonationActivation_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Donation] (
    [id] NVARCHAR(36) NOT NULL,
    [campaignId] NVARCHAR(36) NOT NULL,
    [donorUserId] NVARCHAR(36),
    [donorReleasedAt] DATETIME2,
    [operationId] NVARCHAR(36) NOT NULL,
    [requestDigest] CHAR(64) NOT NULL,
    [statusTokenDigest] CHAR(64) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [checkoutLabel] NVARCHAR(160) NOT NULL,
    [currency] CHAR(3) NOT NULL,
    [currencyExponent] TINYINT NOT NULL,
    [expectedMinor] BIGINT NOT NULL,
    [provider] NVARCHAR(16) NOT NULL,
    [environment] NVARCHAR(16) NOT NULL,
    [accountKey] NVARCHAR(64) NOT NULL,
    [createState] NVARCHAR(16) NOT NULL CONSTRAINT [Donation_createState_df] DEFAULT N'pending',
    [checkoutReference] NVARCHAR(255) COLLATE Latin1_General_100_BIN2,
    [checkoutExpiresAt] DATETIME2,
    [paymentReference] NVARCHAR(255) COLLATE Latin1_General_100_BIN2,
    [state] NVARCHAR(24) NOT NULL CONSTRAINT [Donation_state_df] DEFAULT N'pending',
    [capturedMinor] BIGINT,
    [refundedMinor] BIGINT NOT NULL CONSTRAINT [Donation_refundedMinor_df] DEFAULT 0,
    [refundReservedMinor] BIGINT NOT NULL CONSTRAINT [Donation_refundReservedMinor_df] DEFAULT 0,
    [dispute] NVARCHAR(8) NOT NULL CONSTRAINT [Donation_dispute_df] DEFAULT N'none',
    [closure] NVARCHAR(16),
    [cancelRequestedAt] DATETIME2,
    [attention] NVARCHAR(24),
    [reconcileDueAt] DATETIME2,
    [reconcileAttempts] INT NOT NULL CONSTRAINT [Donation_reconcileAttempts_df] DEFAULT 0,
    [reconcileLeaseUntil] DATETIME2,
    [version] INT NOT NULL CONSTRAINT [Donation_version_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Donation_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Donation_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    [succeededAt] DATETIME2,
    CONSTRAINT [Donation_pkey] PRIMARY KEY CLUSTERED ([id]),
    -- ONE DONATION PER OPERATION: a duplicate submit is the same donation.
    CONSTRAINT [Donation_operationId_key] UNIQUE NONCLUSTERED ([operationId]),
    CONSTRAINT [Donation_statusTokenDigest_key] UNIQUE NONCLUSTERED ([statusTokenDigest]),
    -- The key an intent's composite reference needs: a donation's id together
    -- with its donor, so owed mail can only ever name that donation's donor.
    CONSTRAINT [Donation_donor_key] UNIQUE NONCLUSTERED ([id],[donorUserId])
);

-- CreateTable
CREATE TABLE [dbo].[DonationProviderEvent] (
    [id] NVARCHAR(36) NOT NULL,
    [provider] NVARCHAR(16) NOT NULL,
    [environment] NVARCHAR(16) NOT NULL,
    [accountKey] NVARCHAR(64) NOT NULL,
    [eventId] NVARCHAR(255) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [eventType] NVARCHAR(64) NOT NULL,
    [occurredAt] DATETIME2 NOT NULL,
    [receivedAt] DATETIME2 NOT NULL,
    [payloadDigest] CHAR(64) NOT NULL,
    [donationId] NVARCHAR(36),
    [result] NVARCHAR(16),
    [processedAt] DATETIME2,
    CONSTRAINT [DonationProviderEvent_pkey] PRIMARY KEY CLUSTERED ([id]),
    -- DURABLE DEDUP: one record per event within its provider scope.
    CONSTRAINT [DonationProviderEvent_event_key] UNIQUE NONCLUSTERED ([provider],[environment],[accountKey],[eventId])
);

-- CreateTable
CREATE TABLE [dbo].[DonationRefund] (
    [id] NVARCHAR(36) NOT NULL,
    [donationId] NVARCHAR(36) NOT NULL,
    [operationId] NVARCHAR(36) NOT NULL,
    [requestDigest] CHAR(64) NOT NULL,
    [currency] CHAR(3) NOT NULL,
    [currencyExponent] TINYINT NOT NULL,
    [amountMinor] BIGINT NOT NULL,
    [state] NVARCHAR(16) NOT NULL CONSTRAINT [DonationRefund_state_df] DEFAULT N'requested',
    [provider] NVARCHAR(16) NOT NULL,
    [environment] NVARCHAR(16) NOT NULL,
    [accountKey] NVARCHAR(64) NOT NULL,
    [refundReference] NVARCHAR(255) COLLATE Latin1_General_100_BIN2,
    [requestedByUserId] NVARCHAR(36) NOT NULL,
    [requestedAt] DATETIME2 NOT NULL,
    [completedAt] DATETIME2,
    [reconcileDueAt] DATETIME2,
    [reconcileAttempts] INT NOT NULL CONSTRAINT [DonationRefund_reconcileAttempts_df] DEFAULT 0,
    [reconcileLeaseUntil] DATETIME2,
    [version] INT NOT NULL CONSTRAINT [DonationRefund_version_df] DEFAULT 1,
    CONSTRAINT [DonationRefund_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [DonationRefund_operationId_key] UNIQUE NONCLUSTERED ([operationId]),
    -- The key a refund intent's composite reference needs.
    CONSTRAINT [DonationRefund_donation_key] UNIQUE NONCLUSTERED ([id],[donationId])
);

-- CreateTable
CREATE TABLE [dbo].[DonationCommunicationIntent] (
    [id] NVARCHAR(36) NOT NULL,
    [purpose] NVARCHAR(64) NOT NULL,
    [donationId] NVARCHAR(36) NOT NULL,
    [refundId] NVARCHAR(36),
    [recipientUserId] NVARCHAR(36) NOT NULL,
    [dueAt] DATETIME2 NOT NULL,
    [state] NVARCHAR(16) NOT NULL CONSTRAINT [DonationCommunicationIntent_state_df] DEFAULT N'pending',
    [idempotencyKey] NVARCHAR(200) NOT NULL,
    [claimedUntil] DATETIME2,
    [relayedAt] DATETIME2,
    [abandonedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [DonationCommunicationIntent_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [DonationCommunicationIntent_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [DonationCommunicationIntent_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [DonationCampaign_state_displayOrder_id_idx] ON [dbo].[DonationCampaign]([state], [displayOrder], [id]);
-- SCOPED PROVIDER REFERENCES: a checkout, a payment and a refund reference are
-- each unique within their provider, environment and account — so a sandbox
-- identifier can never be mistaken for a production one, nor one account's for
-- another's — and two donations can never claim the same provider object.
CREATE UNIQUE NONCLUSTERED INDEX [Donation_checkout_key] ON [dbo].[Donation]([provider], [environment], [accountKey], [checkoutReference]) WHERE [checkoutReference] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [Donation_payment_key] ON [dbo].[Donation]([provider], [environment], [accountKey], [paymentReference]) WHERE [paymentReference] IS NOT NULL;
CREATE NONCLUSTERED INDEX [Donation_donorUserId_createdAt_idx] ON [dbo].[Donation]([donorUserId], [createdAt]);
CREATE NONCLUSTERED INDEX [Donation_reconcileDueAt_id_idx] ON [dbo].[Donation]([reconcileDueAt], [id]);
CREATE NONCLUSTERED INDEX [Donation_createdAt_id_idx] ON [dbo].[Donation]([createdAt], [id]);
CREATE NONCLUSTERED INDEX [Donation_state_createdAt_idx] ON [dbo].[Donation]([state], [createdAt]);
CREATE NONCLUSTERED INDEX [Donation_campaignId_createdAt_idx] ON [dbo].[Donation]([campaignId], [createdAt]);
CREATE NONCLUSTERED INDEX [Donation_environment_createdAt_idx] ON [dbo].[Donation]([environment], [createdAt]);
CREATE NONCLUSTERED INDEX [Donation_attention_createdAt_idx] ON [dbo].[Donation]([attention], [createdAt]);
CREATE NONCLUSTERED INDEX [DonationProviderEvent_donationId_idx] ON [dbo].[DonationProviderEvent]([donationId]);
CREATE UNIQUE NONCLUSTERED INDEX [DonationRefund_reference_key] ON [dbo].[DonationRefund]([provider], [environment], [accountKey], [refundReference]) WHERE [refundReference] IS NOT NULL;
CREATE NONCLUSTERED INDEX [DonationRefund_donationId_state_idx] ON [dbo].[DonationRefund]([donationId], [state]);
CREATE NONCLUSTERED INDEX [DonationRefund_reconcileDueAt_id_idx] ON [dbo].[DonationRefund]([reconcileDueAt], [id]);
CREATE NONCLUSTERED INDEX [DonationRefund_requestedByUserId_idx] ON [dbo].[DonationRefund]([requestedByUserId]);
CREATE NONCLUSTERED INDEX [DonationCommunicationIntent_state_dueAt_idx] ON [dbo].[DonationCommunicationIntent]([state], [dueAt]);
CREATE NONCLUSTERED INDEX [DonationCommunicationIntent_recipientUserId_state_idx] ON [dbo].[DonationCommunicationIntent]([recipientUserId], [state]);
CREATE NONCLUSTERED INDEX [DonationCommunicationIntent_donationId_idx] ON [dbo].[DonationCommunicationIntent]([donationId]);
CREATE NONCLUSTERED INDEX [DonationCommunicationIntent_refundId_idx] ON [dbo].[DonationCommunicationIntent]([refundId]);

-- AddForeignKey
ALTER TABLE [dbo].[DonationCampaignTranslation] ADD CONSTRAINT [DonationCampaignTranslation_campaignId_fkey] FOREIGN KEY ([campaignId]) REFERENCES [dbo].[DonationCampaign]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[DonationCampaignCurrency] ADD CONSTRAINT [DonationCampaignCurrency_campaignId_fkey] FOREIGN KEY ([campaignId]) REFERENCES [dbo].[DonationCampaign]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Donation] ADD CONSTRAINT [Donation_campaignId_fkey] FOREIGN KEY ([campaignId]) REFERENCES [dbo].[DonationCampaign]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Donation] ADD CONSTRAINT [Donation_donorUserId_fkey] FOREIGN KEY ([donorUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[DonationProviderEvent] ADD CONSTRAINT [DonationProviderEvent_donationId_fkey] FOREIGN KEY ([donationId]) REFERENCES [dbo].[Donation]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[DonationRefund] ADD CONSTRAINT [DonationRefund_donationId_fkey] FOREIGN KEY ([donationId]) REFERENCES [dbo].[Donation]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[DonationRefund] ADD CONSTRAINT [DonationRefund_requestedByUserId_fkey] FOREIGN KEY ([requestedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[DonationCommunicationIntent] ADD CONSTRAINT [DonationCommunicationIntent_donationId_fkey] FOREIGN KEY ([donationId]) REFERENCES [dbo].[Donation]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[DonationCommunicationIntent] ADD CONSTRAINT [DonationCommunicationIntent_refundId_fkey] FOREIGN KEY ([refundId]) REFERENCES [dbo].[DonationRefund]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[DonationCommunicationIntent] ADD CONSTRAINT [DonationCommunicationIntent_recipientUserId_fkey] FOREIGN KEY ([recipientUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
-- Owed mail goes to the LINKED donor of the donation it describes, and to
-- nobody else; a refund intent names a refund of that same donation.
ALTER TABLE [dbo].[DonationCommunicationIntent] ADD CONSTRAINT [DonationCommunicationIntent_donor_fkey] FOREIGN KEY ([donationId], [recipientUserId]) REFERENCES [dbo].[Donation]([id],[donorUserId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[DonationCommunicationIntent] ADD CONSTRAINT [DonationCommunicationIntent_refund_fkey] FOREIGN KEY ([refundId], [donationId]) REFERENCES [dbo].[DonationRefund]([id],[donationId]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ===========================================================================
-- Value constraints
-- ===========================================================================

-- A campaign: draft, published or archived, each with exactly the instants
-- its state implies; a primary locale of the three; a bounded position.
ALTER TABLE [dbo].[DonationCampaign] ADD CONSTRAINT [DonationCampaign_ck] CHECK (
    [state] IN (N'draft',N'published',N'archived')
    AND [primaryLocale] IN (N'en',N'ur',N'ar')
    AND [displayOrder] BETWEEN 0 AND 9999
    AND [version] > 0
    AND (([state] = N'draft' AND [publishedAt] IS NULL AND [archivedAt] IS NULL)
         OR ([state] = N'published' AND [publishedAt] IS NOT NULL AND [archivedAt] IS NULL)
         OR ([state] = N'archived' AND [publishedAt] IS NOT NULL AND [archivedAt] IS NOT NULL))
);

-- Words: one of the three locales, never blank.
ALTER TABLE [dbo].[DonationCampaignTranslation] ADD CONSTRAINT [DonationCampaignTranslation_ck] CHECK (
    [locale] IN (N'en',N'ur',N'ar')
    AND LEN([title]) > 0
    AND LEN([summary]) > 0
    AND LEN([description]) > 0
);

-- A currency policy: an allowlisted currency AT ITS OWN exponent, inclusive
-- positive bounds within the engineering maximum, and up to three DENSE,
-- DISTINCT suggestions inside them.
ALTER TABLE [dbo].[DonationCampaignCurrency] ADD CONSTRAINT [DonationCampaignCurrency_ck] CHECK (
    ([currency] COLLATE Latin1_General_BIN2) + N':' + CONVERT(NVARCHAR(1), [currencyExponent]) IN (
        N'AED:2',N'AUD:2',N'BHD:3',N'CAD:2',N'CHF:2',N'DKK:2',N'EUR:2',N'GBP:2',N'JOD:3',N'JPY:0',N'KRW:0',
        N'KWD:3',N'MYR:2',N'NOK:2',N'OMR:3',N'PKR:2',N'QAR:2',N'SAR:2',N'SEK:2',N'TND:3',N'USD:2',N'ZAR:2')
    AND [minimumMinor] > 0
    AND [maximumMinor] <= 999999999999
    AND [minimumMinor] <= [maximumMinor]
    AND ([suggested2Minor] IS NULL OR [suggested1Minor] IS NOT NULL)
    AND ([suggested3Minor] IS NULL OR [suggested2Minor] IS NOT NULL)
    AND ([suggested1Minor] IS NULL OR [suggested1Minor] BETWEEN [minimumMinor] AND [maximumMinor])
    AND ([suggested2Minor] IS NULL OR [suggested2Minor] BETWEEN [minimumMinor] AND [maximumMinor])
    AND ([suggested3Minor] IS NULL OR [suggested3Minor] BETWEEN [minimumMinor] AND [maximumMinor])
    AND ([suggested2Minor] IS NULL OR [suggested2Minor] <> [suggested1Minor])
    AND ([suggested3Minor] IS NULL OR ([suggested3Minor] <> [suggested1Minor] AND [suggested3Minor] <> [suggested2Minor]))
);

-- The activation: the single row, a known provider, environment and
-- authority, a non-secret account key, and the only two lawful pairings —
-- production only with approved authority and its recorded evidence, every
-- other environment only with fixture authority.
ALTER TABLE [dbo].[DonationActivation] ADD CONSTRAINT [DonationActivation_ck] CHECK (
    [id] = 1
    AND [provider] IN (N'stripe')
    AND [environment] IN (N'fixture',N'sandbox',N'production')
    AND [authority] IN (N'fixture',N'approved')
    AND LEN([accountKey]) >= 3
    AND [accountKey] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^-A-Za-z0-9_]%'
    AND LEN([authorisedBy]) > 0
    AND (([environment] = N'production' AND [authority] = N'approved' AND [reference] IS NOT NULL AND LEN([reference]) > 0)
         OR ([environment] <> N'production' AND [authority] = N'fixture'))
);

-- A donation's vocabulary, request and scope.
ALTER TABLE [dbo].[Donation] ADD CONSTRAINT [Donation_vocabulary_ck] CHECK (
    [locale] IN (N'en',N'ur',N'ar')
    AND LEN([checkoutLabel]) > 0
    AND [provider] IN (N'stripe')
    AND [environment] IN (N'fixture',N'sandbox',N'production')
    AND LEN([accountKey]) >= 3
    AND [accountKey] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^-A-Za-z0-9_]%'
    AND [createState] IN (N'pending',N'created',N'ambiguous',N'rejected')
    AND [state] IN (N'pending',N'succeeded',N'failed',N'cancelled',N'expired',N'partially_refunded',N'refunded',N'disputed',N'charged_back')
    AND [dispute] IN (N'none',N'open',N'won',N'lost')
    AND ([closure] IS NULL OR [closure] IN (N'failed',N'expired',N'cancelled'))
    AND ([attention] IS NULL OR [attention] IN (N'amount-mismatch',N'provider-mismatch',N'unresolved',N'external-refund'))
    AND LEN([requestDigest]) = 64 AND [requestDigest] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^0-9a-f]%'
    AND LEN([statusTokenDigest]) = 64 AND [statusTokenDigest] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^0-9a-f]%'
    AND [reconcileAttempts] >= 0
    AND [version] > 0
);

-- Exact money: an allowlisted currency at its own exponent; a positive
-- expected amount within the bound; captured exactly the expected amount or
-- nothing; refunded and reserved never negative and never above captured.
ALTER TABLE [dbo].[Donation] ADD CONSTRAINT [Donation_money_ck] CHECK (
    ([currency] COLLATE Latin1_General_BIN2) + N':' + CONVERT(NVARCHAR(1), [currencyExponent]) IN (
        N'AED:2',N'AUD:2',N'BHD:3',N'CAD:2',N'CHF:2',N'DKK:2',N'EUR:2',N'GBP:2',N'JOD:3',N'JPY:0',N'KRW:0',
        N'KWD:3',N'MYR:2',N'NOK:2',N'OMR:3',N'PKR:2',N'QAR:2',N'SAR:2',N'SEK:2',N'TND:3',N'USD:2',N'ZAR:2')
    AND [expectedMinor] > 0 AND [expectedMinor] <= 999999999999
    AND ([capturedMinor] IS NULL OR [capturedMinor] = [expectedMinor])
    AND [refundedMinor] >= 0 AND [refundedMinor] <= ISNULL([capturedMinor], 0)
    AND [refundReservedMinor] >= 0 AND [refundReservedMinor] <= ISNULL([capturedMinor], 0)
);

-- The facts agree with each other: a closure and a dispute only where they
-- can exist, a checkout exactly when created, a rejected create closed as
-- failed, a capture only of a created checkout and with its instant, and a
-- released donor link no longer naming anyone.
ALTER TABLE [dbo].[Donation] ADD CONSTRAINT [Donation_facts_ck] CHECK (
    ([closure] IS NULL OR [capturedMinor] IS NULL)
    AND ([capturedMinor] IS NOT NULL OR [dispute] = N'none')
    AND (([createState] = N'created' AND [checkoutReference] IS NOT NULL)
         OR ([createState] <> N'created' AND [checkoutReference] IS NULL))
    AND (([checkoutReference] IS NULL AND [checkoutExpiresAt] IS NULL)
         OR ([checkoutReference] IS NOT NULL AND [checkoutExpiresAt] IS NOT NULL))
    -- ISNULL, because a CHECK passes on UNKNOWN: `[closure] = N'failed'` alone
    -- would admit a rejected create whose closure is NULL.
    AND ([createState] <> N'rejected' OR ISNULL([closure], N'') = N'failed')
    AND ([capturedMinor] IS NULL OR [createState] = N'created')
    AND (([succeededAt] IS NULL AND [capturedMinor] IS NULL)
         OR ([succeededAt] IS NOT NULL AND [capturedMinor] IS NOT NULL))
    AND ([donorReleasedAt] IS NULL OR [donorUserId] IS NULL)
);

-- THE STATE IS THE DERIVATION OF THE FACTS (`deriveDonationState`), and the
-- database refuses any row where it is not.
ALTER TABLE [dbo].[Donation] ADD CONSTRAINT [Donation_state_ck] CHECK (
    [state] = CASE
        WHEN [capturedMinor] IS NOT NULL THEN
            CASE
                WHEN [dispute] = N'lost' THEN N'charged_back'
                WHEN [dispute] = N'open' THEN N'disputed'
                WHEN [refundedMinor] > 0 AND [refundedMinor] >= [capturedMinor] THEN N'refunded'
                WHEN [refundedMinor] > 0 THEN N'partially_refunded'
                ELSE N'succeeded'
            END
        WHEN [closure] = N'expired' AND [cancelRequestedAt] IS NOT NULL THEN N'cancelled'
        WHEN [closure] IS NOT NULL THEN [closure]
        ELSE N'pending'
    END
);

-- An event: a known scope, a bounded type, the digest of its verified bytes,
-- and a result exactly when processed.
ALTER TABLE [dbo].[DonationProviderEvent] ADD CONSTRAINT [DonationProviderEvent_ck] CHECK (
    [provider] IN (N'stripe')
    AND [environment] IN (N'fixture',N'sandbox',N'production')
    AND LEN([accountKey]) >= 3
    AND LEN([eventId]) > 0
    AND LEN([eventType]) > 0
    AND LEN([payloadDigest]) = 64 AND [payloadDigest] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^0-9a-f]%'
    AND ([result] IS NULL OR [result] IN (N'applied',N'unchanged',N'ignored',N'unmatched',N'attention'))
    AND (([result] IS NULL AND [processedAt] IS NULL) OR ([result] IS NOT NULL AND [processedAt] IS NOT NULL))
);

-- A refund: positive exact money in an allowlisted currency at its exponent,
-- a known scope and state, and a completion instant exactly when final.
ALTER TABLE [dbo].[DonationRefund] ADD CONSTRAINT [DonationRefund_ck] CHECK (
    ([currency] COLLATE Latin1_General_BIN2) + N':' + CONVERT(NVARCHAR(1), [currencyExponent]) IN (
        N'AED:2',N'AUD:2',N'BHD:3',N'CAD:2',N'CHF:2',N'DKK:2',N'EUR:2',N'GBP:2',N'JOD:3',N'JPY:0',N'KRW:0',
        N'KWD:3',N'MYR:2',N'NOK:2',N'OMR:3',N'PKR:2',N'QAR:2',N'SAR:2',N'SEK:2',N'TND:3',N'USD:2',N'ZAR:2')
    AND [amountMinor] > 0 AND [amountMinor] <= 999999999999
    AND [state] IN (N'requested',N'pending',N'succeeded',N'failed')
    AND [provider] IN (N'stripe')
    AND [environment] IN (N'fixture',N'sandbox',N'production')
    AND LEN([requestDigest]) = 64 AND [requestDigest] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^0-9a-f]%'
    AND ([refundReference] IS NULL OR LEN([refundReference]) > 0)
    AND (([state] IN (N'succeeded',N'failed') AND [completedAt] IS NOT NULL)
         OR ([state] IN (N'requested',N'pending') AND [completedAt] IS NULL))
    AND [reconcileAttempts] >= 0
    AND [version] > 0
);

-- An intent: one of the three purposes, naming a refund exactly when it
-- announces one, relayed or abandoned with its instant.
ALTER TABLE [dbo].[DonationCommunicationIntent] ADD CONSTRAINT [DonationCommunicationIntent_ck] CHECK (
    [purpose] IN (N'donation.succeeded',N'donation.partially-refunded',N'donation.refunded')
    AND [state] IN (N'pending',N'relayed',N'abandoned')
    AND LEN([idempotencyKey]) > 0
    AND ([state] <> N'relayed' OR [relayedAt] IS NOT NULL)
    AND ([state] <> N'abandoned' OR [abandonedAt] IS NOT NULL)
    AND (([purpose] = N'donation.succeeded' AND [refundId] IS NULL)
         OR ([purpose] <> N'donation.succeeded' AND [refundId] IS NOT NULL))
);

-- ===========================================================================
-- A campaign begins as a draft, keeps its identity, primary locale and
-- creation instant, moves one version at a time and never returns to draft
-- once public (51340); it is published only with its primary locale's words
-- and at least one currency (51341).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[DonationCampaignIntegrity] ON [dbo].[DonationCampaign] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id])
     AND (i.[state] <> N''draft'' OR i.[version] <> 1 OR EXISTS (SELECT 1 FROM deleted))
 )
   THROW 51340, ''A donation campaign begins as a draft and keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[primaryLocale] <> i.[primaryLocale] OR d.[createdAt] <> i.[createdAt]
      OR (d.[state] <> N''draft'' AND i.[state] = N''draft'')
      OR (d.[state] = N''draft'' AND i.[state] = N''archived'')
      OR i.[version] <> d.[version] + 1
 )
   THROW 51340, ''A donation campaign keeps its identity and never returns to draft.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE i.[state] = N''published''
     AND (NOT EXISTS (
            SELECT 1 FROM [dbo].[DonationCampaignTranslation] t
            WHERE t.[campaignId] = i.[id] AND t.[locale] = i.[primaryLocale])
          OR NOT EXISTS (
            SELECT 1 FROM [dbo].[DonationCampaignCurrency] c WHERE c.[campaignId] = i.[id]))
 )
   THROW 51341, ''A donation campaign is published only with its primary locale''''s words and a currency.'', 1;
END');

-- Words never change campaign or locale (51340), and a published campaign
-- never loses its primary locale's words (51341).
EXEC(N'CREATE TRIGGER [dbo].[DonationCampaignTranslationIntegrity] ON [dbo].[DonationCampaignTranslation] AFTER UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (
   SELECT 1 FROM inserted i
   WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[campaignId] = i.[campaignId] AND d.[locale] = i.[locale])
 )
   THROW 51340, ''A campaign translation never changes its campaign or locale.'', 1;
 IF EXISTS (
   SELECT 1 FROM deleted d JOIN [dbo].[DonationCampaign] c ON c.[id] = d.[campaignId]
   WHERE c.[state] = N''published''
     AND NOT EXISTS (
       SELECT 1 FROM [dbo].[DonationCampaignTranslation] t
       WHERE t.[campaignId] = c.[id] AND t.[locale] = c.[primaryLocale])
 )
   THROW 51341, ''A published campaign keeps its primary locale''''s words.'', 1;
END');

-- A currency policy never changes campaign, currency or exponent (51340); a
-- published campaign keeps at least one currency (51341).
EXEC(N'CREATE TRIGGER [dbo].[DonationCampaignCurrencyIntegrity] ON [dbo].[DonationCampaignCurrency] AFTER UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (
   SELECT 1 FROM inserted i
   WHERE NOT EXISTS (
     SELECT 1 FROM deleted d
     WHERE d.[campaignId] = i.[campaignId] AND d.[currency] = i.[currency]
       AND d.[currencyExponent] = i.[currencyExponent])
 )
   THROW 51340, ''A currency policy never changes its campaign, currency or exponent.'', 1;
 IF EXISTS (
   SELECT 1 FROM deleted d JOIN [dbo].[DonationCampaign] c ON c.[id] = d.[campaignId]
   WHERE c.[state] = N''published''
     AND NOT EXISTS (SELECT 1 FROM [dbo].[DonationCampaignCurrency] k WHERE k.[campaignId] = c.[id])
 )
   THROW 51341, ''A published campaign keeps at least one currency.'', 1;
END');

-- ===========================================================================
-- The activation is immutable (51342). Written by the owner only.
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[DonationActivationImmutable] ON [dbo].[DonationActivation] AFTER UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM deleted) RETURN;
 THROW 51342, ''The donation activation is immutable.'', 1;
END');

-- ===========================================================================
-- A donation is admitted only as a fresh, uncaptured attempt (51347), for a
-- PUBLISHED campaign (51343) whose current policy admits its exact money at
-- the currency's own exponent (51344), inside the activated provider scope
-- with the authority that environment needs (51345), and — when linked — for
-- an ACTIVE account (51346).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[DonationAdmission] ON [dbo].[Donation] AFTER INSERT AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE i.[state] <> N''pending'' OR i.[createState] <> N''pending'' OR i.[version] <> 1
      OR i.[capturedMinor] IS NOT NULL OR i.[refundedMinor] <> 0 OR i.[refundReservedMinor] <> 0
      OR i.[dispute] <> N''none'' OR i.[closure] IS NOT NULL OR i.[cancelRequestedAt] IS NOT NULL
      OR i.[checkoutReference] IS NOT NULL OR i.[paymentReference] IS NOT NULL
      OR i.[succeededAt] IS NOT NULL OR i.[donorReleasedAt] IS NOT NULL OR i.[attention] IS NOT NULL
 )
   THROW 51347, ''A donation begins pending, uncaptured, at version 1.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE NOT EXISTS (SELECT 1 FROM [dbo].[DonationCampaign] c WHERE c.[id] = i.[campaignId] AND c.[state] = N''published'')
 )
   THROW 51343, ''A donation needs a published campaign.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE NOT EXISTS (
     SELECT 1 FROM [dbo].[DonationCampaignCurrency] p
     WHERE p.[campaignId] = i.[campaignId] AND p.[currency] = i.[currency]
       AND p.[currencyExponent] = i.[currencyExponent]
       AND i.[expectedMinor] BETWEEN p.[minimumMinor] AND p.[maximumMinor])
 )
   THROW 51344, ''The campaign''''s policy does not admit this amount.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE NOT EXISTS (
     SELECT 1 FROM [dbo].[DonationActivation] a
     WHERE a.[provider] = i.[provider] AND a.[environment] = i.[environment]
       AND a.[accountKey] COLLATE Latin1_General_BIN2 = i.[accountKey] COLLATE Latin1_General_BIN2
       AND ((a.[environment] = N''production'' AND a.[authority] = N''approved'')
            OR (a.[environment] <> N''production'' AND a.[authority] = N''fixture'')))
 )
   THROW 51345, ''Donations are not activated for this provider scope.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE i.[donorUserId] IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM [dbo].[User] u WHERE u.[id] = i.[donorUserId] AND u.[status] = N''active'')
 )
   THROW 51346, ''A linked donation needs an active account.'', 1;
END');

-- ===========================================================================
-- A donation keeps its identity, request and expected money (51348). Its
-- facts only move forward — a checkout, payment reference, capture, expiry,
-- cancellation and success instant set once; refunded never decreases; a
-- dispute never moves back and never from won to lost; a closure only while
-- nothing is captured; a finished create never reopens — and any change to a
-- fact moves the version by exactly one, while a scheduling-only change
-- (reconcile due, attempts, lease) leaves it; its reservation is always the
-- sum of its live refunds (51349). A donor link is only ever released, and
-- only for a CLOSED account (51350).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[DonationIntegrity] ON [dbo].[Donation] AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51348, ''A donation keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[campaignId] <> i.[campaignId] OR d.[operationId] <> i.[operationId]
      OR d.[requestDigest] <> i.[requestDigest] OR d.[statusTokenDigest] <> i.[statusTokenDigest]
      OR d.[locale] <> i.[locale]
      OR d.[checkoutLabel] COLLATE Latin1_General_BIN2 <> i.[checkoutLabel] COLLATE Latin1_General_BIN2
      OR d.[currency] <> i.[currency] OR d.[currencyExponent] <> i.[currencyExponent]
      OR d.[expectedMinor] <> i.[expectedMinor]
      OR d.[provider] <> i.[provider] OR d.[environment] <> i.[environment]
      OR d.[accountKey] COLLATE Latin1_General_BIN2 <> i.[accountKey] COLLATE Latin1_General_BIN2
      OR d.[createdAt] <> i.[createdAt]
 )
   THROW 51348, ''A donation keeps its identity, request and expected money.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE (d.[checkoutReference] IS NOT NULL AND (i.[checkoutReference] IS NULL
            OR d.[checkoutReference] COLLATE Latin1_General_BIN2 <> i.[checkoutReference] COLLATE Latin1_General_BIN2))
      OR (d.[checkoutExpiresAt] IS NOT NULL AND (i.[checkoutExpiresAt] IS NULL OR i.[checkoutExpiresAt] <> d.[checkoutExpiresAt]))
      OR (d.[paymentReference] IS NOT NULL AND (i.[paymentReference] IS NULL
            OR d.[paymentReference] COLLATE Latin1_General_BIN2 <> i.[paymentReference] COLLATE Latin1_General_BIN2))
      OR (d.[capturedMinor] IS NOT NULL AND (i.[capturedMinor] IS NULL OR i.[capturedMinor] <> d.[capturedMinor]))
      OR i.[refundedMinor] < d.[refundedMinor]
      OR (CASE i.[dispute] WHEN N''none'' THEN 0 WHEN N''open'' THEN 1 ELSE 2 END)
         < (CASE d.[dispute] WHEN N''none'' THEN 0 WHEN N''open'' THEN 1 ELSE 2 END)
      OR (d.[dispute] IN (N''won'',N''lost'') AND i.[dispute] <> d.[dispute])
      OR (d.[closure] IS NOT NULL AND ((i.[closure] IS NOT NULL AND i.[closure] <> d.[closure])
                                       OR (i.[closure] IS NULL AND i.[capturedMinor] IS NULL)))
      OR (d.[cancelRequestedAt] IS NOT NULL AND (i.[cancelRequestedAt] IS NULL OR i.[cancelRequestedAt] <> d.[cancelRequestedAt]))
      OR (d.[succeededAt] IS NOT NULL AND (i.[succeededAt] IS NULL OR i.[succeededAt] <> d.[succeededAt]))
      OR (d.[createState] IN (N''created'',N''rejected'') AND i.[createState] <> d.[createState])
      OR (d.[createState] <> N''pending'' AND i.[createState] = N''pending'')
      OR (i.[version] <> d.[version] + 1
          AND NOT (i.[version] = d.[version] AND NOT EXISTS (
            SELECT i.[state], i.[createState], i.[checkoutReference], i.[checkoutExpiresAt], i.[paymentReference],
                   i.[capturedMinor], i.[refundedMinor], i.[refundReservedMinor], i.[dispute], i.[closure],
                   i.[cancelRequestedAt], i.[attention], i.[donorUserId], i.[donorReleasedAt], i.[succeededAt]
            EXCEPT
            SELECT d.[state], d.[createState], d.[checkoutReference], d.[checkoutExpiresAt], d.[paymentReference],
                   d.[capturedMinor], d.[refundedMinor], d.[refundReservedMinor], d.[dispute], d.[closure],
                   d.[cancelRequestedAt], d.[attention], d.[donorUserId], d.[donorReleasedAt], d.[succeededAt])))
      OR (i.[refundReservedMinor] <> d.[refundReservedMinor]
          AND i.[refundReservedMinor] <> ISNULL((
            SELECT SUM(r.[amountMinor]) FROM [dbo].[DonationRefund] r
            WHERE r.[donationId] = i.[id] AND r.[state] IN (N''requested'',N''pending'',N''succeeded'')), 0))
 )
   THROW 51349, ''A donation''''s facts only move forward, one version at a time.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE (d.[donorUserId] IS NULL AND i.[donorUserId] IS NOT NULL)
      OR (d.[donorUserId] IS NOT NULL AND i.[donorUserId] IS NOT NULL AND i.[donorUserId] <> d.[donorUserId])
      OR (d.[donorUserId] IS NOT NULL AND i.[donorUserId] IS NULL
          AND (i.[donorReleasedAt] IS NULL
               OR NOT EXISTS (SELECT 1 FROM [dbo].[User] u WHERE u.[id] = d.[donorUserId] AND u.[status] = N''closed'')))
      OR (d.[donorReleasedAt] IS NOT NULL AND (i.[donorReleasedAt] IS NULL OR i.[donorReleasedAt] <> d.[donorReleasedAt]))
      OR (d.[donorReleasedAt] IS NULL AND i.[donorReleasedAt] IS NOT NULL AND d.[donorUserId] IS NULL)
 )
   THROW 51350, ''A donor link is only released, and only for a closed account.'', 1;
END');

-- ===========================================================================
-- An event keeps what identifies it, is linked to a donation at most once and
-- completed once (51351).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[DonationProviderEventIntegrity] ON [dbo].[DonationProviderEvent] AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51351, ''A provider event keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[provider] <> i.[provider] OR d.[environment] <> i.[environment]
      OR d.[accountKey] COLLATE Latin1_General_BIN2 <> i.[accountKey] COLLATE Latin1_General_BIN2
      OR d.[eventId] COLLATE Latin1_General_BIN2 <> i.[eventId] COLLATE Latin1_General_BIN2
      OR d.[eventType] COLLATE Latin1_General_BIN2 <> i.[eventType] COLLATE Latin1_General_BIN2
      OR d.[occurredAt] <> i.[occurredAt] OR d.[receivedAt] <> i.[receivedAt]
      OR d.[payloadDigest] <> i.[payloadDigest]
      OR (d.[donationId] IS NOT NULL AND (i.[donationId] IS NULL OR i.[donationId] <> d.[donationId]))
      OR (d.[processedAt] IS NOT NULL AND (i.[processedAt] IS NULL OR i.[processedAt] <> d.[processedAt]
                                           OR i.[result] <> d.[result]
                                           OR ISNULL(i.[donationId], N'''') <> ISNULL(d.[donationId], N'''')))
 )
   THROW 51351, ''A provider event is completed once and never re-keyed.'', 1;
END');

-- ===========================================================================
-- A refund is admitted only as a fresh request (51358), of a CAPTURED donation
-- that is not charged back (51352), in that donation's own currency and
-- provider scope (51353), by a requester who holds `donations.refund` NOW and
-- a live `donation-refund` step-up bound to a live session (51354), and only
-- while the donation's live refunds stay within its captured amount (51355).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[DonationRefundAdmission] ON [dbo].[DonationRefund] AFTER INSERT AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE i.[state] <> N''requested'' OR i.[version] <> 1 OR i.[refundReference] IS NOT NULL OR i.[completedAt] IS NOT NULL
 )
   THROW 51358, ''A refund begins requested, at version 1.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE NOT EXISTS (
     SELECT 1 FROM [dbo].[Donation] d
     WHERE d.[id] = i.[donationId] AND d.[capturedMinor] IS NOT NULL AND d.[state] <> N''charged_back'')
 )
   THROW 51352, ''Only a captured donation that is not charged back is refunded.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN [dbo].[Donation] d ON d.[id] = i.[donationId]
   WHERE d.[currency] <> i.[currency] OR d.[currencyExponent] <> i.[currencyExponent]
      OR d.[provider] <> i.[provider] OR d.[environment] <> i.[environment]
      OR d.[accountKey] COLLATE Latin1_General_BIN2 <> i.[accountKey] COLLATE Latin1_General_BIN2
 )
   THROW 51353, ''A refund is in its donation''''s own currency and provider scope.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE NOT EXISTS (
     SELECT 1 FROM [dbo].[RoleAssignment] ra
     JOIN [dbo].[Role] r ON r.[id] = ra.[roleId] AND r.[deactivatedAt] IS NULL
     JOIN [dbo].[RolePermission] rp ON rp.[roleId] = r.[id] AND rp.[permissionKey] = N''donations.refund''
     JOIN [dbo].[User] u ON u.[id] = ra.[userId] AND u.[status] = N''active''
     WHERE ra.[userId] = i.[requestedByUserId] AND ra.[revokedAt] IS NULL)
   OR NOT EXISTS (
     SELECT 1 FROM [dbo].[StepUpGrant] g
     JOIN [dbo].[Session] s ON s.[id] = g.[sessionId] AND s.[userId] = g.[userId] AND s.[expiresAt] > SYSUTCDATETIME()
     WHERE g.[userId] = i.[requestedByUserId] AND g.[purpose] = N''donation-refund''
       AND g.[expiresAt] > SYSUTCDATETIME())
 )
   THROW 51354, ''Refund authority is not held now.'', 1;
 IF EXISTS (
   SELECT 1 FROM [dbo].[Donation] d
   WHERE d.[id] IN (SELECT [donationId] FROM inserted)
     AND (SELECT SUM(r.[amountMinor]) FROM [dbo].[DonationRefund] r
          WHERE r.[donationId] = d.[id] AND r.[state] IN (N''requested'',N''pending'',N''succeeded'')) > d.[capturedMinor]
 )
   THROW 51355, ''Refunds may not exceed the captured amount.'', 1;
END');

-- ===========================================================================
-- A refund keeps its identity, request, money, scope and requester; moves only
-- forward (requested -> pending | succeeded | failed; pending -> succeeded |
-- failed); its reference and completion are set once; and any change to its
-- state or reference moves its version by exactly one, while a
-- scheduling-only change leaves it (51356).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[DonationRefundIntegrity] ON [dbo].[DonationRefund] AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51356, ''A refund keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[donationId] <> i.[donationId] OR d.[operationId] <> i.[operationId]
      OR d.[requestDigest] <> i.[requestDigest]
      OR d.[currency] <> i.[currency] OR d.[currencyExponent] <> i.[currencyExponent]
      OR d.[amountMinor] <> i.[amountMinor]
      OR d.[provider] <> i.[provider] OR d.[environment] <> i.[environment]
      OR d.[accountKey] COLLATE Latin1_General_BIN2 <> i.[accountKey] COLLATE Latin1_General_BIN2
      OR d.[requestedByUserId] <> i.[requestedByUserId] OR d.[requestedAt] <> i.[requestedAt]
      OR (d.[refundReference] IS NOT NULL AND (i.[refundReference] IS NULL
            OR d.[refundReference] COLLATE Latin1_General_BIN2 <> i.[refundReference] COLLATE Latin1_General_BIN2))
      OR (d.[completedAt] IS NOT NULL AND (i.[completedAt] IS NULL OR i.[completedAt] <> d.[completedAt]))
      OR NOT (i.[state] = d.[state]
              OR (d.[state] = N''requested'' AND i.[state] IN (N''pending'',N''succeeded'',N''failed''))
              OR (d.[state] = N''pending'' AND i.[state] IN (N''succeeded'',N''failed'')))
      OR (i.[version] <> d.[version] + 1
          AND NOT (i.[version] = d.[version] AND i.[state] = d.[state]
                   AND ISNULL(i.[refundReference], N'''') = ISNULL(d.[refundReference], N'''')))
 )
   THROW 51356, ''A refund only moves forward and keeps its identity.'', 1;
END');

-- ===========================================================================
-- An intent is relayed or abandoned once and never re-keyed (51357).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[DonationIntentIntegrity] ON [dbo].[DonationCommunicationIntent] AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51357, ''A donation communication intent keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[purpose] <> i.[purpose] OR d.[recipientUserId] <> i.[recipientUserId]
      OR d.[donationId] <> i.[donationId]
      OR ISNULL(d.[refundId], N'''') <> ISNULL(i.[refundId], N'''')
      OR d.[idempotencyKey] <> i.[idempotencyKey] OR d.[dueAt] <> i.[dueAt]
      OR (d.[state] <> N''pending'' AND i.[state] <> d.[state])
 )
   THROW 51357, ''A donation communication intent is relayed or abandoned once and never re-keyed.'', 1;
END');

-- ===========================================================================
-- Permissions
-- ===========================================================================
INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'donations.read', N'View donation campaigns, donation records, refunds and reconciliation state, and export the bounded financial record. Every listing, detail and export is audited. Changes nothing.'),
    (N'donations.administer', N'Create, edit, publish and archive donation campaigns and their currency policy, and ask the provider for the current state of a donation. Moves no money and grants no refund.'),
    (N'donations.refund', N'Request a full or partial refund of a captured donation, within what remains refundable, after a fresh donation-refund step-up. Every request is audited.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

-- EXTENDING THE PROTECTED PLATFORM ADMINISTRATOR BUNDLE by the two ORDINARY
-- Donations keys — a privilege change, so the holders' sessions and step-up
-- grants are revoked in this same transaction (SECURITY_BASELINE.md 8.1).
-- `donations.refund` is externally gated: catalogued above, bundled nowhere.
DECLARE @donationsAdminRoleId NVARCHAR(36);
DECLARE @donationsAddedKeys NVARCHAR(200);

SELECT @donationsAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @donationsAdminRoleId IS NOT NULL
BEGIN
    SELECT @donationsAddedKeys = STRING_AGG(p.[key], N' ') WITHIN GROUP (ORDER BY p.[key])
    FROM [dbo].[Permission] p
    WHERE p.[key] IN (N'donations.read', N'donations.administer')
      AND NOT EXISTS (
          SELECT 1 FROM [dbo].[RolePermission] rp
          WHERE rp.[roleId] = @donationsAdminRoleId AND rp.[permissionKey] = p.[key]
      );

    IF @donationsAddedKeys IS NOT NULL AND LEN(@donationsAddedKeys) > 0
    BEGIN
        INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
        SELECT @donationsAdminRoleId, p.[key]
        FROM [dbo].[Permission] p
        WHERE p.[key] IN (N'donations.read', N'donations.administer')
          AND NOT EXISTS (
              SELECT 1 FROM [dbo].[RolePermission] rp
              WHERE rp.[roleId] = @donationsAdminRoleId AND rp.[permissionKey] = p.[key]
          );

        -- Grants before sessions, so the count each statement reports is the
        -- one it actually removed rather than whatever a cascade took first.
        DELETE FROM [dbo].[StepUpGrant]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @donationsAdminRoleId AND ra.[revokedAt] IS NULL
        );

        DELETE FROM [dbo].[Session]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @donationsAdminRoleId AND ra.[revokedAt] IS NULL
        );

        -- WHICH KEYS WERE ADDED, and nothing else (SECURITY_BASELINE.md 13.4).
        INSERT INTO [dbo].[AuditLog]
            ([id], [actorType], [actorId], [action], [targetType], [targetId],
             [afterState], [authorisingSource])
        VALUES
            (NEWID(), N'migration', NULL, N'donations.permissions.provisioned', N'role',
             @donationsAdminRoleId,
             N'{"added":"' + @donationsAddedKeys + N'"}',
             N'20261010000000_phase27_donations');
    END;
END;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
