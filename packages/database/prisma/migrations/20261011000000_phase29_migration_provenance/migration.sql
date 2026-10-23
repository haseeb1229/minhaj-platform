-- ===========================================================================
-- Phase 29 — Migration & Provenance Framework
-- ===========================================================================
--
-- THE MIGRATION & PROVENANCE CONTEXT (DOMAIN_MODEL.md 16): LegacySource
-- (MigrationSource, MigrationSourceHost), ImportRun (MigrationRun), the stable
-- identity and lifecycle of each legacy record (MigrationRecord — the
-- MigrationStatus of 16.1), its per-run accounting (MigrationRunItem),
-- RawSnapshot, StagedRecord (with its categories and extracted links),
-- the reviewable topic mapping, ImportError, duplicate candidates,
-- AssetProvenance, LegacyMapping, PublishManifest (with its entries) and the
-- reviewed promotion manifest (MIGRATION_STRATEGY.md 10.1.1).
--
-- FIXTURES ONLY. Phase 29 contacts no live source. A FIXTURE source names only
-- `*.fixture.invalid` hosts (RFC 6761: `.invalid` never resolves publicly) and
-- carries no authorisation evidence; its authority kind and access method are
-- fixed at creation, so a fixture can never become a real source by an edit.
-- The `authorised` kind exists for Phase 30, which must first record written
-- authorisation per source (OPEN_DECISIONS.md 3.1).
--
-- TYPED REFERENCES, NEVER A TARGET PAIR. A published record is named by a
-- typed, nullable foreign key per target (today `videoId`), exactly one of
-- which is present — the same pattern Personalisation's SavedItem uses. No
-- `targetType` / `targetId` column exists anywhere. Composite keys make every
-- snapshot, staged revision, run item, manifest entry and legacy mapping
-- provably belong to the same record and source as its parent.
--
-- EVIDENCE IS APPEND-ONLY. A raw snapshot's body is bound to its SHA-256 by a
-- CHECK, and the only change it accepts is a deliberate disposal of the body;
-- it is never deleted. A staged revision's payload and provenance never
-- change; only its review moves. NOTHING CASCADES: every foreign key is NO
-- ACTION.
--
-- REFUSALS 51370-51384 (within the 51370-51399 range reserved for this phase):
--   51370  a source re-keyed, its authority or access re-kinded, or its
--          version moved other than by one
--   51371  a source host changed or removed, or a fixture source given a host
--          outside `*.fixture.invalid`
--   51372  a raw snapshot rewritten or deleted (only the body may be disposed)
--   51373  a raw snapshot for another source's record or run
--   51374  a staged revision created other than pending at version 1, from a
--          snapshot whose checksum it does not carry or in another source's
--          run; its payload or provenance rewritten; its review moved
--          invalidly; or a category naming another source's topic mapping
--   51375  a run re-identified, or a finished run changed
--   51376  a record re-identified
--   51377  a run item re-identified, for another source's record, or moved
--          out of a terminal outcome other than an errored item's retry
--   51378  a manifest published or rolled back without `migration.publish`
--          and a live `migration-publication` step-up, re-identified, or
--          moved out of order
--   51379  a manifest entry for an unapproved revision, added outside a draft,
--          moved outside its manifest's phase, or its target rewritten
--   51380  a legacy mapping re-identified or re-targeted, or created for a
--          manifest entry of an unrelated record; a staged link rewritten by
--          another source's mapping
--   51381  a promotion approved without `migration.publish` and a live
--          `migration-publication` step-up, moved out of order, or carrying
--          an entry that is not published
--   51382  an asset acquisition re-identified
--   51383  an error re-identified or reopened; a duplicate pair re-identified
--   51384  a topic mapping re-identified
--
-- POSTURES FOR THE APPLICATION PRINCIPAL (grant-application-principal.sql):
--   SOURCE       MigrationSource: SELECT, INSERT, UPDATE; never DELETE, and
--                never its identity, key, authority, access, kind or creation.
--   HOST         MigrationSourceHost: SELECT, INSERT only.
--   RUN          MigrationRun: SELECT, INSERT, UPDATE; never DELETE, and never
--                its identity, source, operator, provenance or start.
--   RECORD       MigrationRecord: SELECT, INSERT, UPDATE; never DELETE, and
--                never its identity, source, key or kind.
--   ITEM         MigrationRunItem: SELECT, INSERT, UPDATE; never DELETE, and
--                never its run, record or position.
--   SNAPSHOT     MigrationRawSnapshot: SELECT, INSERT, and UPDATE of the
--                disposal columns only; never DELETE.
--   STAGED       MigrationStagedRecord: SELECT, INSERT, and UPDATE of the
--                review columns only; never DELETE.
--   CATEGORY     MigrationStagedCategory, MigrationStagedLink: SELECT, INSERT.
--   DECISIONS    MigrationTopicMapping, MigrationError,
--                MigrationDuplicateCandidate, MigrationAssetProvenance,
--                MigrationLegacyMapping: SELECT, INSERT, UPDATE of their
--                decision columns only; never DELETE.
--   MANIFEST     MigrationPublishManifest, MigrationManifestEntry,
--                MigrationPromotion, MigrationPromotionEntry: SELECT, INSERT,
--                UPDATE; never DELETE, and never their identity.
--
-- TWO ORDINARY KEYS AND ONE GATED KEY: `migration.read` and
-- `migration.administer` join the protected Platform Administrator bundle by
-- the convention every earlier phase used, invalidating its holders' sessions
-- and step-up grants in the same transaction. `migration.publish` is
-- catalogued only: externally gated (who may publish migrated content into
-- the live platform is the organisation's decision, OPEN_DECISIONS.md 3.4),
-- bundled into no role, held by nobody.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.
-- ===========================================================================

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[MigrationSource] (
    [id] NVARCHAR(36) NOT NULL,
    [key] NVARCHAR(64) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [authorityKind] NVARCHAR(16) NOT NULL,
    [accessMethod] NVARCHAR(16) NOT NULL,
    [contentKind] NVARCHAR(32) NOT NULL,
    [baseUrl] NVARCHAR(2000),
    [authorisationReference] NVARCHAR(400),
    [authorisedOn] DATE,
    [licensingEvidence] NVARCHAR(2000),
    [policyNotes] NVARCHAR(2000),
    [defaultLanguageCode] NVARCHAR(16),
    [minIntervalMs] INT NOT NULL,
    [maxConcurrency] INT NOT NULL,
    [maxAttempts] INT NOT NULL,
    [timeoutMs] INT NOT NULL,
    [maxBodyBytes] INT NOT NULL,
    [maxRedirects] INT NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [MigrationSource_version_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL,
    [createdByUserId] NVARCHAR(36) NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    [updatedByUserId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [MigrationSource_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MigrationSource_key_key] UNIQUE NONCLUSTERED ([key])
);

-- CreateTable
CREATE TABLE [dbo].[MigrationSourceHost] (
    [sourceId] NVARCHAR(36) NOT NULL,
    [host] NVARCHAR(253) NOT NULL,
    CONSTRAINT [MigrationSourceHost_pkey] PRIMARY KEY CLUSTERED ([sourceId],[host])
);

-- CreateTable
CREATE TABLE [dbo].[MigrationRun] (
    [id] NVARCHAR(36) NOT NULL,
    [sourceId] NVARCHAR(36) NOT NULL,
    [operatorUserId] NVARCHAR(36) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [adapterKey] NVARCHAR(64) NOT NULL,
    [adapterVersion] NVARCHAR(32) NOT NULL,
    [parserKey] NVARCHAR(64) NOT NULL,
    [parserVersion] NVARCHAR(32) NOT NULL,
    [normalizerVersion] NVARCHAR(32) NOT NULL,
    [codeRevision] NVARCHAR(64) NOT NULL,
    [discoveryCursor] NVARCHAR(400),
    [discoveryComplete] BIT NOT NULL CONSTRAINT [MigrationRun_discoveryComplete_df] DEFAULT 0,
    [leaseToken] NVARCHAR(36),
    [leaseExpiresAt] DATETIME2,
    [startedAt] DATETIME2 NOT NULL,
    [endedAt] DATETIME2,
    [reconciliation] NVARCHAR(16) NOT NULL CONSTRAINT [MigrationRun_reconciliation_df] DEFAULT N'pending',
    [reconciledAt] DATETIME2,
    [reconciliationDetail] NVARCHAR(2000),
    [version] INT NOT NULL CONSTRAINT [MigrationRun_version_df] DEFAULT 1,
    CONSTRAINT [MigrationRun_pkey] PRIMARY KEY CLUSTERED ([id]),
    -- The key a manifest's composite reference needs.
    CONSTRAINT [MigrationRun_source_key] UNIQUE NONCLUSTERED ([id],[sourceId])
);

-- CreateTable
CREATE TABLE [dbo].[MigrationRecord] (
    [id] NVARCHAR(36) NOT NULL,
    [sourceId] NVARCHAR(36) NOT NULL,
    [externalKey] NVARCHAR(400) NOT NULL,
    [originalUrl] NVARCHAR(2000),
    [legacyIdentifier] NVARCHAR(200),
    [contentKind] NVARCHAR(32) NOT NULL,
    [status] NVARCHAR(16) NOT NULL,
    [observed] NVARCHAR(16) NOT NULL CONSTRAINT [MigrationRecord_observed_df] DEFAULT N'present',
    [disappearance] NVARCHAR(24),
    [disappearanceNote] NVARCHAR(500),
    [classifiedByUserId] NVARCHAR(36),
    [classifiedAt] DATETIME2,
    [mergedIntoRecordId] NVARCHAR(36),
    [latestSnapshotId] NVARCHAR(36),
    [currentStagedRecordId] NVARCHAR(36),
    [firstObservedRunId] NVARCHAR(36) NOT NULL,
    [lastObservedRunId] NVARCHAR(36) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [MigrationRecord_version_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MigrationRecord_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MigrationRecord_source_key] UNIQUE NONCLUSTERED ([sourceId],[externalKey]),
    -- The key every child's same-source composite reference needs.
    CONSTRAINT [MigrationRecord_id_source_key] UNIQUE NONCLUSTERED ([id],[sourceId])
);

-- CreateTable
CREATE TABLE [dbo].[MigrationRunItem] (
    [id] NVARCHAR(36) NOT NULL,
    [runId] NVARCHAR(36) NOT NULL,
    [recordId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    [outcome] NVARCHAR(16) NOT NULL CONSTRAINT [MigrationRunItem_outcome_df] DEFAULT N'pending',
    [fetched] BIT NOT NULL CONSTRAINT [MigrationRunItem_fetched_df] DEFAULT 0,
    [parsed] BIT NOT NULL CONSTRAINT [MigrationRunItem_parsed_df] DEFAULT 0,
    [attempts] INT NOT NULL CONSTRAINT [MigrationRunItem_attempts_df] DEFAULT 0,
    [nextAttemptAt] DATETIME2,
    [snapshotId] NVARCHAR(36),
    [stagedRecordId] NVARCHAR(36),
    [errorId] NVARCHAR(36),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MigrationRunItem_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MigrationRunItem_run_record_key] UNIQUE NONCLUSTERED ([runId],[recordId]),
    CONSTRAINT [MigrationRunItem_run_position_key] UNIQUE NONCLUSTERED ([runId],[position])
);

-- CreateTable
CREATE TABLE [dbo].[MigrationRawSnapshot] (
    [id] NVARCHAR(36) NOT NULL,
    [sourceId] NVARCHAR(36) NOT NULL,
    [recordId] NVARCHAR(36) NOT NULL,
    [runId] NVARCHAR(36) NOT NULL,
    [requestedUrl] NVARCHAR(2000) NOT NULL,
    [finalUrl] NVARCHAR(2000) NOT NULL,
    [httpStatus] INT,
    [contentType] NVARCHAR(200),
    [headers] NVARCHAR(4000),
    [body] VARBINARY(MAX),
    [byteSize] INT NOT NULL,
    [checksum] CHAR(64) NOT NULL,
    [fetchedAt] DATETIME2 NOT NULL,
    [fetcherKey] NVARCHAR(64) NOT NULL,
    [fetcherVersion] NVARCHAR(32) NOT NULL,
    [personalData] NVARCHAR(16) NOT NULL,
    [disposedAt] DATETIME2,
    [disposedByUserId] NVARCHAR(36),
    [disposalReason] NVARCHAR(500),
    CONSTRAINT [MigrationRawSnapshot_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MigrationRawSnapshot_record_key] UNIQUE NONCLUSTERED ([id],[recordId])
);

-- CreateTable
CREATE TABLE [dbo].[MigrationStagedRecord] (
    [id] NVARCHAR(36) NOT NULL,
    [recordId] NVARCHAR(36) NOT NULL,
    [snapshotId] NVARCHAR(36) NOT NULL,
    [runId] NVARCHAR(36) NOT NULL,
    [revision] INT NOT NULL,
    [contentKind] NVARCHAR(32) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [titleKey] NVARCHAR(240) NOT NULL,
    [dedupeKey] NVARCHAR(200),
    [languageCode] NVARCHAR(16),
    [payload] NVARCHAR(MAX) NOT NULL,
    [payloadChecksum] CHAR(64) NOT NULL,
    [adapterKey] NVARCHAR(64) NOT NULL,
    [adapterVersion] NVARCHAR(32) NOT NULL,
    [parserKey] NVARCHAR(64) NOT NULL,
    [parserVersion] NVARCHAR(32) NOT NULL,
    [normalizerVersion] NVARCHAR(32) NOT NULL,
    [codeRevision] NVARCHAR(64) NOT NULL,
    [inputChecksum] CHAR(64) NOT NULL,
    [producedAt] DATETIME2 NOT NULL,
    [validation] NVARCHAR(16) NOT NULL,
    [issues] NVARCHAR(2000),
    [personalData] NVARCHAR(16) NOT NULL,
    [review] NVARCHAR(16) NOT NULL CONSTRAINT [MigrationStagedRecord_review_df] DEFAULT N'pending',
    [reviewedByUserId] NVARCHAR(36),
    [reviewedAt] DATETIME2,
    [reviewNote] NVARCHAR(500),
    [version] INT NOT NULL CONSTRAINT [MigrationStagedRecord_version_df] DEFAULT 1,
    CONSTRAINT [MigrationStagedRecord_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MigrationStagedRecord_record_revision_key] UNIQUE NONCLUSTERED ([recordId],[revision]),
    CONSTRAINT [MigrationStagedRecord_record_key] UNIQUE NONCLUSTERED ([id],[recordId])
);

-- CreateTable
CREATE TABLE [dbo].[MigrationStagedCategory] (
    [stagedRecordId] NVARCHAR(36) NOT NULL,
    [topicMappingId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [MigrationStagedCategory_pkey] PRIMARY KEY CLUSTERED ([stagedRecordId],[topicMappingId])
);

-- CreateTable
CREATE TABLE [dbo].[MigrationStagedLink] (
    [stagedRecordId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    [href] NVARCHAR(2000) NOT NULL,
    [disposition] NVARCHAR(16) NOT NULL,
    [rewrittenTo] NVARCHAR(400),
    [legacyMappingId] NVARCHAR(36),
    CONSTRAINT [MigrationStagedLink_pkey] PRIMARY KEY CLUSTERED ([stagedRecordId],[position])
);

-- CreateTable
CREATE TABLE [dbo].[MigrationTopicMapping] (
    [id] NVARCHAR(36) NOT NULL,
    [sourceId] NVARCHAR(36) NOT NULL,
    [categoryKey] NVARCHAR(200) NOT NULL,
    [label] NVARCHAR(200) NOT NULL,
    [state] NVARCHAR(16) NOT NULL CONSTRAINT [MigrationTopicMapping_state_df] DEFAULT N'unmapped',
    [topicId] NVARCHAR(36),
    [suggestedTopicId] NVARCHAR(36),
    [decidedByUserId] NVARCHAR(36),
    [decidedAt] DATETIME2,
    [version] INT NOT NULL CONSTRAINT [MigrationTopicMapping_version_df] DEFAULT 1,
    CONSTRAINT [MigrationTopicMapping_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MigrationTopicMapping_source_category_key] UNIQUE NONCLUSTERED ([sourceId],[categoryKey])
);

-- CreateTable
CREATE TABLE [dbo].[MigrationError] (
    [id] NVARCHAR(36) NOT NULL,
    [sourceId] NVARCHAR(36) NOT NULL,
    [runId] NVARCHAR(36) NOT NULL,
    [recordId] NVARCHAR(36),
    [stage] NVARCHAR(16) NOT NULL,
    [classification] NVARCHAR(32) NOT NULL,
    [retryEligible] BIT NOT NULL,
    [httpStatus] INT,
    [attempt] INT NOT NULL,
    [detail] NVARCHAR(500),
    [occurredAt] DATETIME2 NOT NULL,
    [resolution] NVARCHAR(16) NOT NULL CONSTRAINT [MigrationError_resolution_df] DEFAULT N'open',
    [resolvedByUserId] NVARCHAR(36),
    [resolvedAt] DATETIME2,
    [version] INT NOT NULL CONSTRAINT [MigrationError_version_df] DEFAULT 1,
    CONSTRAINT [MigrationError_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MigrationDuplicateCandidate] (
    [id] NVARCHAR(36) NOT NULL,
    [recordId] NVARCHAR(36) NOT NULL,
    [otherRecordId] NVARCHAR(36) NOT NULL,
    [signal] NVARCHAR(24) NOT NULL,
    [score] INT,
    [crossLanguage] BIT NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [decidedByUserId] NVARCHAR(36),
    [decidedAt] DATETIME2,
    [note] NVARCHAR(500),
    [version] INT NOT NULL CONSTRAINT [MigrationDuplicateCandidate_version_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL,
    CONSTRAINT [MigrationDuplicateCandidate_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MigrationDuplicateCandidate_pair_key] UNIQUE NONCLUSTERED ([recordId],[otherRecordId],[signal])
);

-- CreateTable
CREATE TABLE [dbo].[MigrationAssetProvenance] (
    [id] NVARCHAR(36) NOT NULL,
    [sourceId] NVARCHAR(36) NOT NULL,
    [recordId] NVARCHAR(36),
    [runId] NVARCHAR(36) NOT NULL,
    [originalUrl] NVARCHAR(2000) NOT NULL,
    [originalUrlDigest] CHAR(64) NOT NULL,
    [assetId] NVARCHAR(36) NOT NULL,
    [checksum] CHAR(64) NOT NULL,
    [byteSize] BIGINT NOT NULL,
    [mediaType] NVARCHAR(120) NOT NULL,
    [licence] NVARCHAR(24) NOT NULL,
    [licenceEvidence] NVARCHAR(1000),
    [rightsHolder] NVARCHAR(200),
    [visibility] NVARCHAR(16) NOT NULL CONSTRAINT [MigrationAssetProvenance_visibility_df] DEFAULT N'restricted',
    [acquiredAt] DATETIME2 NOT NULL,
    [decidedByUserId] NVARCHAR(36),
    [decidedAt] DATETIME2,
    [version] INT NOT NULL CONSTRAINT [MigrationAssetProvenance_version_df] DEFAULT 1,
    CONSTRAINT [MigrationAssetProvenance_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MigrationAssetProvenance_acquisition_key] UNIQUE NONCLUSTERED ([sourceId],[originalUrlDigest],[checksum])
);

-- CreateTable
CREATE TABLE [dbo].[MigrationLegacyMapping] (
    [id] NVARCHAR(36) NOT NULL,
    [sourceId] NVARCHAR(36) NOT NULL,
    [recordId] NVARCHAR(36) NOT NULL,
    [legacyUrl] NVARCHAR(2000) NOT NULL,
    [legacyUrlDigest] CHAR(64) NOT NULL,
    [videoId] NVARCHAR(36),
    [canonicalPath] NVARCHAR(400) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [manifestEntryId] NVARCHAR(36),
    [createdAt] DATETIME2 NOT NULL,
    [createdByUserId] NVARCHAR(36) NOT NULL,
    [changedAt] DATETIME2,
    [changedByUserId] NVARCHAR(36),
    [version] INT NOT NULL CONSTRAINT [MigrationLegacyMapping_version_df] DEFAULT 1,
    CONSTRAINT [MigrationLegacyMapping_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MigrationPublishManifest] (
    [id] NVARCHAR(36) NOT NULL,
    [sourceId] NVARCHAR(36) NOT NULL,
    [runId] NVARCHAR(36) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [createdByUserId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [publishedByUserId] NVARCHAR(36),
    [publishStartedAt] DATETIME2,
    [publishedAt] DATETIME2,
    [rollbackByUserId] NVARCHAR(36),
    [rollbackReason] NVARCHAR(500),
    [rollbackStartedAt] DATETIME2,
    [rolledBackAt] DATETIME2,
    [version] INT NOT NULL CONSTRAINT [MigrationPublishManifest_version_df] DEFAULT 1,
    CONSTRAINT [MigrationPublishManifest_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MigrationManifestEntry] (
    [id] NVARCHAR(36) NOT NULL,
    [manifestId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    [stagedRecordId] NVARCHAR(36) NOT NULL,
    [recordId] NVARCHAR(36) NOT NULL,
    [state] NVARCHAR(16) NOT NULL CONSTRAINT [MigrationManifestEntry_state_df] DEFAULT N'pending',
    [videoId] NVARCHAR(36),
    [targetVersion] INT,
    [canonicalPath] NVARCHAR(400),
    [refusal] NVARCHAR(32),
    [publishedAt] DATETIME2,
    [rolledBackAt] DATETIME2,
    [version] INT NOT NULL CONSTRAINT [MigrationManifestEntry_version_df] DEFAULT 1,
    CONSTRAINT [MigrationManifestEntry_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MigrationManifestEntry_manifest_position_key] UNIQUE NONCLUSTERED ([manifestId],[position]),
    CONSTRAINT [MigrationManifestEntry_manifest_staged_key] UNIQUE NONCLUSTERED ([manifestId],[stagedRecordId])
);

-- CreateTable
CREATE TABLE [dbo].[MigrationPromotion] (
    [id] NVARCHAR(36) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [destination] NVARCHAR(32) NOT NULL,
    [createdByUserId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [approvedByUserId] NVARCHAR(36),
    [approvedAt] DATETIME2,
    [withdrawnByUserId] NVARCHAR(36),
    [withdrawnAt] DATETIME2,
    [completedAt] DATETIME2,
    [version] INT NOT NULL CONSTRAINT [MigrationPromotion_version_df] DEFAULT 1,
    CONSTRAINT [MigrationPromotion_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MigrationPromotionEntry] (
    [id] NVARCHAR(36) NOT NULL,
    [promotionId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    [manifestEntryId] NVARCHAR(36) NOT NULL,
    [state] NVARCHAR(16) NOT NULL CONSTRAINT [MigrationPromotionEntry_state_df] DEFAULT N'pending',
    [promotedAt] DATETIME2,
    [destinationRef] NVARCHAR(200),
    CONSTRAINT [MigrationPromotionEntry_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MigrationPromotionEntry_promotion_position_key] UNIQUE NONCLUSTERED ([promotionId],[position]),
    CONSTRAINT [MigrationPromotionEntry_promotion_entry_key] UNIQUE NONCLUSTERED ([promotionId],[manifestEntryId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MigrationSource_state_key_idx] ON [dbo].[MigrationSource]([state], [key]);
-- At most ONE open run per source: a second runner resumes it, never forks it.
CREATE UNIQUE NONCLUSTERED INDEX [MigrationRun_open_key] ON [dbo].[MigrationRun]([sourceId]) WHERE [state] = N'open';
CREATE NONCLUSTERED INDEX [MigrationRun_sourceId_startedAt_id_idx] ON [dbo].[MigrationRun]([sourceId], [startedAt], [id]);
CREATE NONCLUSTERED INDEX [MigrationRun_state_startedAt_id_idx] ON [dbo].[MigrationRun]([state], [startedAt], [id]);
CREATE NONCLUSTERED INDEX [MigrationRecord_sourceId_status_id_idx] ON [dbo].[MigrationRecord]([sourceId], [status], [id]);
CREATE NONCLUSTERED INDEX [MigrationRecord_sourceId_observed_id_idx] ON [dbo].[MigrationRecord]([sourceId], [observed], [id]);
CREATE NONCLUSTERED INDEX [MigrationRunItem_runId_outcome_position_idx] ON [dbo].[MigrationRunItem]([runId], [outcome], [position]);
CREATE NONCLUSTERED INDEX [MigrationRawSnapshot_recordId_fetchedAt_id_idx] ON [dbo].[MigrationRawSnapshot]([recordId], [fetchedAt], [id]);
CREATE NONCLUSTERED INDEX [MigrationRawSnapshot_runId_idx] ON [dbo].[MigrationRawSnapshot]([runId]);
CREATE NONCLUSTERED INDEX [MigrationStagedRecord_review_producedAt_id_idx] ON [dbo].[MigrationStagedRecord]([review], [producedAt], [id]);
CREATE NONCLUSTERED INDEX [MigrationStagedRecord_runId_review_id_idx] ON [dbo].[MigrationStagedRecord]([runId], [review], [id]);
CREATE NONCLUSTERED INDEX [MigrationStagedRecord_contentKind_titleKey_idx] ON [dbo].[MigrationStagedRecord]([contentKind], [titleKey]);
CREATE NONCLUSTERED INDEX [MigrationStagedRecord_dedupeKey_idx] ON [dbo].[MigrationStagedRecord]([dedupeKey]) WHERE [dedupeKey] IS NOT NULL;
CREATE NONCLUSTERED INDEX [MigrationStagedCategory_topicMappingId_idx] ON [dbo].[MigrationStagedCategory]([topicMappingId]);
CREATE NONCLUSTERED INDEX [MigrationStagedLink_disposition_stagedRecordId_idx] ON [dbo].[MigrationStagedLink]([disposition], [stagedRecordId]);
CREATE NONCLUSTERED INDEX [MigrationTopicMapping_state_sourceId_id_idx] ON [dbo].[MigrationTopicMapping]([state], [sourceId], [id]);
CREATE NONCLUSTERED INDEX [MigrationError_resolution_occurredAt_id_idx] ON [dbo].[MigrationError]([resolution], [occurredAt], [id]);
CREATE NONCLUSTERED INDEX [MigrationError_runId_occurredAt_id_idx] ON [dbo].[MigrationError]([runId], [occurredAt], [id]);
CREATE NONCLUSTERED INDEX [MigrationDuplicateCandidate_state_createdAt_id_idx] ON [dbo].[MigrationDuplicateCandidate]([state], [createdAt], [id]);
CREATE NONCLUSTERED INDEX [MigrationDuplicateCandidate_otherRecordId_idx] ON [dbo].[MigrationDuplicateCandidate]([otherRecordId]);
CREATE NONCLUSTERED INDEX [MigrationAssetProvenance_checksum_idx] ON [dbo].[MigrationAssetProvenance]([checksum]);
CREATE NONCLUSTERED INDEX [MigrationAssetProvenance_assetId_idx] ON [dbo].[MigrationAssetProvenance]([assetId]);
CREATE NONCLUSTERED INDEX [MigrationAssetProvenance_recordId_idx] ON [dbo].[MigrationAssetProvenance]([recordId]);
CREATE NONCLUSTERED INDEX [MigrationLegacyMapping_sourceId_legacyUrlDigest_idx] ON [dbo].[MigrationLegacyMapping]([sourceId], [legacyUrlDigest]);
CREATE NONCLUSTERED INDEX [MigrationLegacyMapping_state_createdAt_id_idx] ON [dbo].[MigrationLegacyMapping]([state], [createdAt], [id]);
CREATE NONCLUSTERED INDEX [MigrationLegacyMapping_manifestEntryId_idx] ON [dbo].[MigrationLegacyMapping]([manifestEntryId]);
-- ONE ACTIVE MAPPING PER LEGACY ADDRESS: a legacy URL redirects to exactly one
-- canonical address; a disabled mapping stays as history.
CREATE UNIQUE NONCLUSTERED INDEX [MigrationLegacyMapping_active_key] ON [dbo].[MigrationLegacyMapping]([sourceId], [legacyUrlDigest]) WHERE [state] = N'active';
CREATE NONCLUSTERED INDEX [MigrationPublishManifest_state_createdAt_id_idx] ON [dbo].[MigrationPublishManifest]([state], [createdAt], [id]);
CREATE NONCLUSTERED INDEX [MigrationPublishManifest_runId_idx] ON [dbo].[MigrationPublishManifest]([runId]);
CREATE NONCLUSTERED INDEX [MigrationManifestEntry_stagedRecordId_idx] ON [dbo].[MigrationManifestEntry]([stagedRecordId]);
CREATE NONCLUSTERED INDEX [MigrationManifestEntry_state_manifestId_idx] ON [dbo].[MigrationManifestEntry]([state], [manifestId]);
-- A STAGED REVISION IS LIVE IN AT MOST ONE MANIFEST: re-publishing it through
-- a second manifest — or resuming one twice — cannot create a second target.
CREATE UNIQUE NONCLUSTERED INDEX [MigrationManifestEntry_live_key] ON [dbo].[MigrationManifestEntry]([stagedRecordId]) WHERE [state] IN (N'publishing', N'published', N'rollback-refused');
CREATE NONCLUSTERED INDEX [MigrationPromotion_state_createdAt_id_idx] ON [dbo].[MigrationPromotion]([state], [createdAt], [id]);
CREATE NONCLUSTERED INDEX [MigrationPromotionEntry_manifestEntryId_idx] ON [dbo].[MigrationPromotionEntry]([manifestEntryId]);

-- AddForeignKey
ALTER TABLE [dbo].[MigrationSource] ADD CONSTRAINT [MigrationSource_createdByUserId_fkey] FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationSource] ADD CONSTRAINT [MigrationSource_updatedByUserId_fkey] FOREIGN KEY ([updatedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationSourceHost] ADD CONSTRAINT [MigrationSourceHost_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[MigrationSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationRun] ADD CONSTRAINT [MigrationRun_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[MigrationSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationRun] ADD CONSTRAINT [MigrationRun_operatorUserId_fkey] FOREIGN KEY ([operatorUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationRecord] ADD CONSTRAINT [MigrationRecord_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[MigrationSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationRecord] ADD CONSTRAINT [MigrationRecord_classifiedByUserId_fkey] FOREIGN KEY ([classifiedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationRecord] ADD CONSTRAINT [MigrationRecord_mergedIntoRecordId_fkey] FOREIGN KEY ([mergedIntoRecordId]) REFERENCES [dbo].[MigrationRecord]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
-- A record's latest snapshot and current staged revision are ITS OWN.
ALTER TABLE [dbo].[MigrationRecord] ADD CONSTRAINT [MigrationRecord_latestSnapshotId_fkey] FOREIGN KEY ([latestSnapshotId], [id]) REFERENCES [dbo].[MigrationRawSnapshot]([id],[recordId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationRecord] ADD CONSTRAINT [MigrationRecord_currentStagedRecordId_fkey] FOREIGN KEY ([currentStagedRecordId], [id]) REFERENCES [dbo].[MigrationStagedRecord]([id],[recordId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
-- A record is first and last seen by runs of ITS OWN source.
ALTER TABLE [dbo].[MigrationRecord] ADD CONSTRAINT [MigrationRecord_firstObservedRunId_fkey] FOREIGN KEY ([firstObservedRunId], [sourceId]) REFERENCES [dbo].[MigrationRun]([id],[sourceId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationRecord] ADD CONSTRAINT [MigrationRecord_lastObservedRunId_fkey] FOREIGN KEY ([lastObservedRunId], [sourceId]) REFERENCES [dbo].[MigrationRun]([id],[sourceId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationRunItem] ADD CONSTRAINT [MigrationRunItem_runId_fkey] FOREIGN KEY ([runId]) REFERENCES [dbo].[MigrationRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationRunItem] ADD CONSTRAINT [MigrationRunItem_recordId_fkey] FOREIGN KEY ([recordId]) REFERENCES [dbo].[MigrationRecord]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationRunItem] ADD CONSTRAINT [MigrationRunItem_snapshotId_fkey] FOREIGN KEY ([snapshotId], [recordId]) REFERENCES [dbo].[MigrationRawSnapshot]([id],[recordId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationRunItem] ADD CONSTRAINT [MigrationRunItem_stagedRecordId_fkey] FOREIGN KEY ([stagedRecordId], [recordId]) REFERENCES [dbo].[MigrationStagedRecord]([id],[recordId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationRunItem] ADD CONSTRAINT [MigrationRunItem_errorId_fkey] FOREIGN KEY ([errorId]) REFERENCES [dbo].[MigrationError]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
-- A snapshot belongs to a record of its own source, from a run of that source.
ALTER TABLE [dbo].[MigrationRawSnapshot] ADD CONSTRAINT [MigrationRawSnapshot_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[MigrationSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationRawSnapshot] ADD CONSTRAINT [MigrationRawSnapshot_recordId_fkey] FOREIGN KEY ([recordId], [sourceId]) REFERENCES [dbo].[MigrationRecord]([id],[sourceId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationRawSnapshot] ADD CONSTRAINT [MigrationRawSnapshot_runId_fkey] FOREIGN KEY ([runId], [sourceId]) REFERENCES [dbo].[MigrationRun]([id],[sourceId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationRawSnapshot] ADD CONSTRAINT [MigrationRawSnapshot_disposedByUserId_fkey] FOREIGN KEY ([disposedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
-- A staged revision is produced from a snapshot of ITS OWN record.
ALTER TABLE [dbo].[MigrationStagedRecord] ADD CONSTRAINT [MigrationStagedRecord_recordId_fkey] FOREIGN KEY ([recordId]) REFERENCES [dbo].[MigrationRecord]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationStagedRecord] ADD CONSTRAINT [MigrationStagedRecord_snapshotId_fkey] FOREIGN KEY ([snapshotId], [recordId]) REFERENCES [dbo].[MigrationRawSnapshot]([id],[recordId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationStagedRecord] ADD CONSTRAINT [MigrationStagedRecord_runId_fkey] FOREIGN KEY ([runId]) REFERENCES [dbo].[MigrationRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationStagedRecord] ADD CONSTRAINT [MigrationStagedRecord_reviewedByUserId_fkey] FOREIGN KEY ([reviewedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationStagedCategory] ADD CONSTRAINT [MigrationStagedCategory_stagedRecordId_fkey] FOREIGN KEY ([stagedRecordId]) REFERENCES [dbo].[MigrationStagedRecord]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationStagedCategory] ADD CONSTRAINT [MigrationStagedCategory_topicMappingId_fkey] FOREIGN KEY ([topicMappingId]) REFERENCES [dbo].[MigrationTopicMapping]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationStagedLink] ADD CONSTRAINT [MigrationStagedLink_stagedRecordId_fkey] FOREIGN KEY ([stagedRecordId]) REFERENCES [dbo].[MigrationStagedRecord]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationStagedLink] ADD CONSTRAINT [MigrationStagedLink_legacyMappingId_fkey] FOREIGN KEY ([legacyMappingId]) REFERENCES [dbo].[MigrationLegacyMapping]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationTopicMapping] ADD CONSTRAINT [MigrationTopicMapping_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[MigrationSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationTopicMapping] ADD CONSTRAINT [MigrationTopicMapping_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationTopicMapping] ADD CONSTRAINT [MigrationTopicMapping_suggestedTopicId_fkey] FOREIGN KEY ([suggestedTopicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationTopicMapping] ADD CONSTRAINT [MigrationTopicMapping_decidedByUserId_fkey] FOREIGN KEY ([decidedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationError] ADD CONSTRAINT [MigrationError_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[MigrationSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationError] ADD CONSTRAINT [MigrationError_runId_fkey] FOREIGN KEY ([runId], [sourceId]) REFERENCES [dbo].[MigrationRun]([id],[sourceId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationError] ADD CONSTRAINT [MigrationError_recordId_fkey] FOREIGN KEY ([recordId], [sourceId]) REFERENCES [dbo].[MigrationRecord]([id],[sourceId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationError] ADD CONSTRAINT [MigrationError_resolvedByUserId_fkey] FOREIGN KEY ([resolvedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationDuplicateCandidate] ADD CONSTRAINT [MigrationDuplicateCandidate_recordId_fkey] FOREIGN KEY ([recordId]) REFERENCES [dbo].[MigrationRecord]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationDuplicateCandidate] ADD CONSTRAINT [MigrationDuplicateCandidate_otherRecordId_fkey] FOREIGN KEY ([otherRecordId]) REFERENCES [dbo].[MigrationRecord]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationDuplicateCandidate] ADD CONSTRAINT [MigrationDuplicateCandidate_decidedByUserId_fkey] FOREIGN KEY ([decidedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationAssetProvenance] ADD CONSTRAINT [MigrationAssetProvenance_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[MigrationSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationAssetProvenance] ADD CONSTRAINT [MigrationAssetProvenance_recordId_fkey] FOREIGN KEY ([recordId], [sourceId]) REFERENCES [dbo].[MigrationRecord]([id],[sourceId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationAssetProvenance] ADD CONSTRAINT [MigrationAssetProvenance_runId_fkey] FOREIGN KEY ([runId], [sourceId]) REFERENCES [dbo].[MigrationRun]([id],[sourceId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationAssetProvenance] ADD CONSTRAINT [MigrationAssetProvenance_assetId_fkey] FOREIGN KEY ([assetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationAssetProvenance] ADD CONSTRAINT [MigrationAssetProvenance_decidedByUserId_fkey] FOREIGN KEY ([decidedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[MigrationSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_recordId_fkey] FOREIGN KEY ([recordId], [sourceId]) REFERENCES [dbo].[MigrationRecord]([id],[sourceId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_videoId_fkey] FOREIGN KEY ([videoId]) REFERENCES [dbo].[Video]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_manifestEntryId_fkey] FOREIGN KEY ([manifestEntryId]) REFERENCES [dbo].[MigrationManifestEntry]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_createdByUserId_fkey] FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_changedByUserId_fkey] FOREIGN KEY ([changedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationPublishManifest] ADD CONSTRAINT [MigrationPublishManifest_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[MigrationSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationPublishManifest] ADD CONSTRAINT [MigrationPublishManifest_runId_fkey] FOREIGN KEY ([runId], [sourceId]) REFERENCES [dbo].[MigrationRun]([id],[sourceId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationPublishManifest] ADD CONSTRAINT [MigrationPublishManifest_createdByUserId_fkey] FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationPublishManifest] ADD CONSTRAINT [MigrationPublishManifest_publishedByUserId_fkey] FOREIGN KEY ([publishedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationPublishManifest] ADD CONSTRAINT [MigrationPublishManifest_rollbackByUserId_fkey] FOREIGN KEY ([rollbackByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationManifestEntry] ADD CONSTRAINT [MigrationManifestEntry_manifestId_fkey] FOREIGN KEY ([manifestId]) REFERENCES [dbo].[MigrationPublishManifest]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationManifestEntry] ADD CONSTRAINT [MigrationManifestEntry_stagedRecordId_fkey] FOREIGN KEY ([stagedRecordId], [recordId]) REFERENCES [dbo].[MigrationStagedRecord]([id],[recordId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationManifestEntry] ADD CONSTRAINT [MigrationManifestEntry_recordId_fkey] FOREIGN KEY ([recordId]) REFERENCES [dbo].[MigrationRecord]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationManifestEntry] ADD CONSTRAINT [MigrationManifestEntry_videoId_fkey] FOREIGN KEY ([videoId]) REFERENCES [dbo].[Video]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationPromotion] ADD CONSTRAINT [MigrationPromotion_createdByUserId_fkey] FOREIGN KEY ([createdByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationPromotion] ADD CONSTRAINT [MigrationPromotion_approvedByUserId_fkey] FOREIGN KEY ([approvedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationPromotion] ADD CONSTRAINT [MigrationPromotion_withdrawnByUserId_fkey] FOREIGN KEY ([withdrawnByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationPromotionEntry] ADD CONSTRAINT [MigrationPromotionEntry_promotionId_fkey] FOREIGN KEY ([promotionId]) REFERENCES [dbo].[MigrationPromotion]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationPromotionEntry] ADD CONSTRAINT [MigrationPromotionEntry_manifestEntryId_fkey] FOREIGN KEY ([manifestEntryId]) REFERENCES [dbo].[MigrationManifestEntry]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ===========================================================================
-- Value constraints
-- ===========================================================================

-- A source: a bounded key; an authority kind and access method from the two
-- vocabularies; one content kind; bounded politeness. A FIXTURE source carries
-- NO authorisation evidence and a `*.fixture.invalid` address; an AUTHORISED
-- source carries both its written authorisation reference and its date.
ALTER TABLE [dbo].[MigrationSource] ADD CONSTRAINT [MigrationSource_ck] CHECK (
    [key] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^-a-z0-9]%' AND LEN([key]) BETWEEN 3 AND 64
    AND LEN([name]) BETWEEN 1 AND 200
    AND [authorityKind] IN (N'fixture', N'authorised')
    AND [accessMethod] IN (N'http', N'export')
    AND [contentKind] IN (N'media.video')
    AND [state] IN (N'active', N'inactive')
    AND [minIntervalMs] BETWEEN 0 AND 600000
    AND [maxConcurrency] BETWEEN 1 AND 4
    AND [maxAttempts] BETWEEN 1 AND 6
    AND [timeoutMs] BETWEEN 1000 AND 60000
    AND [maxBodyBytes] BETWEEN 1024 AND 8388608
    AND [maxRedirects] BETWEEN 0 AND 5
    AND [version] >= 1
    AND (([accessMethod] = N'http' AND [baseUrl] IS NOT NULL)
         OR ([accessMethod] = N'export' AND [baseUrl] IS NULL))
    AND (([authorityKind] = N'fixture' AND [authorisationReference] IS NULL AND [authorisedOn] IS NULL
          AND ([baseUrl] IS NULL
               OR ([baseUrl] COLLATE Latin1_General_BIN2 LIKE N'http://%'
                   AND (CASE WHEN CHARINDEX(N'/', [baseUrl], 8) > 8 THEN SUBSTRING([baseUrl], 8, CHARINDEX(N'/', [baseUrl], 8) - 8) ELSE N'' END) COLLATE Latin1_General_BIN2 LIKE N'%_.fixture.invalid'
                   AND (CASE WHEN CHARINDEX(N'/', [baseUrl], 8) > 8 THEN SUBSTRING([baseUrl], 8, CHARINDEX(N'/', [baseUrl], 8) - 8) ELSE N'' END) COLLATE Latin1_General_BIN2 NOT LIKE N'%[^-a-z0-9.]%')
               OR ([baseUrl] COLLATE Latin1_General_BIN2 LIKE N'https://%'
                   AND (CASE WHEN CHARINDEX(N'/', [baseUrl], 9) > 9 THEN SUBSTRING([baseUrl], 9, CHARINDEX(N'/', [baseUrl], 9) - 9) ELSE N'' END) COLLATE Latin1_General_BIN2 LIKE N'%_.fixture.invalid'
                   AND (CASE WHEN CHARINDEX(N'/', [baseUrl], 9) > 9 THEN SUBSTRING([baseUrl], 9, CHARINDEX(N'/', [baseUrl], 9) - 9) ELSE N'' END) COLLATE Latin1_General_BIN2 NOT LIKE N'%[^-a-z0-9.]%')))
         OR ([authorityKind] = N'authorised' AND [authorisationReference] IS NOT NULL AND [authorisedOn] IS NOT NULL))
);

-- A host: lower-case DNS characters only, no port, no path.
ALTER TABLE [dbo].[MigrationSourceHost] ADD CONSTRAINT [MigrationSourceHost_ck] CHECK (
    LEN([host]) BETWEEN 1 AND 253
    AND [host] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^-a-z0-9.]%'
    AND [host] NOT LIKE N'.%' AND [host] NOT LIKE N'%.'
);

-- A run: open until it ends; reconciled only once it completed.
ALTER TABLE [dbo].[MigrationRun] ADD CONSTRAINT [MigrationRun_ck] CHECK (
    [state] IN (N'open', N'completed', N'cancelled')
    AND [reconciliation] IN (N'pending', N'balanced', N'unbalanced')
    AND (CASE WHEN [state] = N'open' THEN 1 ELSE 0 END) = (CASE WHEN [endedAt] IS NULL THEN 1 ELSE 0 END)
    AND ([state] = N'open' OR [leaseToken] IS NULL)
    AND ([state] <> N'completed' OR [discoveryComplete] = 1)
    AND ([reconciliation] = N'pending' OR ([state] = N'completed' AND [reconciledAt] IS NOT NULL))
    AND (CASE WHEN [leaseToken] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [leaseExpiresAt] IS NULL THEN 1 ELSE 0 END)
    AND [version] >= 1
);

-- A record: a lifecycle state from MigrationStatus; a disappearance only while
-- missing; merged exactly when it names the record it was merged into.
ALTER TABLE [dbo].[MigrationRecord] ADD CONSTRAINT [MigrationRecord_ck] CHECK (
    [contentKind] IN (N'media.video')
    AND [status] IN (N'discovered', N'fetched', N'staged', N'rejected', N'errored', N'excluded', N'approved', N'published', N'merged')
    AND [observed] IN (N'present', N'missing')
    AND ([disappearance] IS NULL OR [disappearance] IN (N'withdrawn', N'moved', N'source-error', N'transient-failure', N'access-failure', N'unresolved'))
    AND ([observed] = N'missing' OR ([disappearance] IS NULL AND [classifiedByUserId] IS NULL))
    AND (CASE WHEN [disappearance] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [classifiedByUserId] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [classifiedByUserId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [classifiedAt] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [status] = N'merged' THEN 1 ELSE 0 END) = (CASE WHEN [mergedIntoRecordId] IS NOT NULL THEN 1 ELSE 0 END)
    AND ([mergedIntoRecordId] IS NULL OR [mergedIntoRecordId] <> [id])
    AND LEN([externalKey]) BETWEEN 1 AND 400
    AND [version] >= 1
);

-- An item: a terminal outcome carries the evidence it claims.
ALTER TABLE [dbo].[MigrationRunItem] ADD CONSTRAINT [MigrationRunItem_ck] CHECK (
    [outcome] IN (N'pending', N'staged', N'unchanged', N'rejected', N'errored', N'excluded')
    AND [position] >= 0
    AND [attempts] BETWEEN 0 AND 100
    AND ([parsed] = 0 OR [fetched] = 1)
    AND ([outcome] <> N'staged' OR ([stagedRecordId] IS NOT NULL AND [parsed] = 1))
    AND ([outcome] <> N'rejected' OR ([stagedRecordId] IS NOT NULL AND [parsed] = 1))
    AND ([outcome] <> N'unchanged' OR ([fetched] = 1 AND [stagedRecordId] IS NULL))
    AND ([outcome] <> N'errored' OR [errorId] IS NOT NULL)
    AND ([fetched] = 0 OR [snapshotId] IS NOT NULL OR [outcome] = N'unchanged')
);

-- A snapshot: its body, while held, IS the bytes its checksum names; a
-- disposed snapshot has no body and says who disposed of it, when and why.
ALTER TABLE [dbo].[MigrationRawSnapshot] ADD CONSTRAINT [MigrationRawSnapshot_ck] CHECK (
    [byteSize] BETWEEN 0 AND 8388608
    AND [checksum] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^0-9a-f]%'
    AND ([httpStatus] IS NULL OR [httpStatus] BETWEEN 100 AND 599)
    AND [personalData] IN (N'none', N'flagged')
    AND ([body] IS NULL OR DATALENGTH([body]) = [byteSize])
    AND ([body] IS NULL OR LOWER(CONVERT(CHAR(64), HASHBYTES('SHA2_256', [body]), 2)) = [checksum])
    AND (CASE WHEN [body] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [disposedAt] IS NOT NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [disposedAt] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [disposedByUserId] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [disposedAt] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [disposalReason] IS NULL THEN 1 ELSE 0 END)
    AND ([headers] IS NULL OR ISJSON([headers]) = 1)
);

-- A staged revision: JSON payload within bounds; only a VALID revision free of
-- flagged personal data may be approved, and an approval names its reviewer.
ALTER TABLE [dbo].[MigrationStagedRecord] ADD CONSTRAINT [MigrationStagedRecord_ck] CHECK (
    [revision] >= 1
    AND [contentKind] IN (N'media.video')
    AND LEN([title]) BETWEEN 1 AND 240
    AND ISJSON([payload]) = 1
    AND LEN([payload]) <= 200000
    AND [payloadChecksum] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^0-9a-f]%'
    AND [inputChecksum] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^0-9a-f]%'
    AND [validation] IN (N'valid', N'invalid')
    AND ([issues] IS NULL OR ISJSON([issues]) = 1)
    AND [personalData] IN (N'none', N'flagged')
    AND [review] IN (N'pending', N'approved', N'rejected', N'superseded')
    AND ([review] <> N'approved' OR ([validation] = N'valid' AND [personalData] = N'none'))
    AND ([review] NOT IN (N'approved', N'rejected') OR ([reviewedByUserId] IS NOT NULL AND [reviewedAt] IS NOT NULL))
    AND [version] >= 1
);

ALTER TABLE [dbo].[MigrationStagedLink] ADD CONSTRAINT [MigrationStagedLink_ck] CHECK (
    [position] >= 0
    AND [disposition] IN (N'rewritten', N'unresolved', N'external', N'dropped')
    AND (CASE WHEN [disposition] = N'rewritten' THEN 1 ELSE 0 END) = (CASE WHEN [rewrittenTo] IS NOT NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [disposition] = N'rewritten' THEN 1 ELSE 0 END) = (CASE WHEN [legacyMappingId] IS NOT NULL THEN 1 ELSE 0 END)
    AND ([rewrittenTo] IS NULL OR [rewrittenTo] LIKE N'/%')
);

-- A topic mapping: confirmed exactly when it names a Topic and who decided.
ALTER TABLE [dbo].[MigrationTopicMapping] ADD CONSTRAINT [MigrationTopicMapping_ck] CHECK (
    [state] IN (N'unmapped', N'confirmed', N'excluded')
    AND (CASE WHEN [state] = N'confirmed' THEN 1 ELSE 0 END) = (CASE WHEN [topicId] IS NOT NULL THEN 1 ELSE 0 END)
    AND ([state] = N'unmapped' OR ([decidedByUserId] IS NOT NULL AND [decidedAt] IS NOT NULL))
    AND LEN([categoryKey]) BETWEEN 1 AND 200
    AND [version] >= 1
);

-- An error: a stage and classification from the vocabularies; a retry is
-- requested only for a retry-eligible error, and access failures are never
-- retry-eligible (MIGRATION_STRATEGY.md 4.2 — never worked around).
ALTER TABLE [dbo].[MigrationError] ADD CONSTRAINT [MigrationError_ck] CHECK (
    [stage] IN (N'discover', N'fetch', N'parse', N'normalize', N'validate', N'asset', N'publish', N'rollback', N'promote')
    AND [classification] IN (
        N'network', N'timeout', N'rate-limited', N'server-error', N'not-found', N'gone',
        N'access-denied', N'client-error', N'redirect-refused', N'address-refused',
        N'scope-refused', N'too-large', N'unsupported-type', N'parse-failed',
        N'validation-failed', N'asset-rejected', N'asset-unavailable',
        N'target-refused', N'target-unavailable', N'approval-withdrawn')
    AND ([classification] <> N'access-denied' OR [retryEligible] = 0)
    AND [resolution] IN (N'open', N'retry-requested', N'dismissed', N'resolved')
    AND ([resolution] <> N'retry-requested' OR [retryEligible] = 1)
    AND ([resolution] = N'open' OR ([resolvedByUserId] IS NOT NULL OR [resolution] = N'resolved'))
    AND (CASE WHEN [resolvedAt] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [resolution] = N'open' THEN 1 ELSE 0 END)
    AND ([httpStatus] IS NULL OR [httpStatus] BETWEEN 100 AND 599)
    AND [attempt] >= 1
    AND [version] >= 1
);

-- A duplicate candidate: two different records; only the SAME PROVIDER VIDEO
-- collapses automatically, and a cross-language pair is never merged.
ALTER TABLE [dbo].[MigrationDuplicateCandidate] ADD CONSTRAINT [MigrationDuplicateCandidate_ck] CHECK (
    [recordId] <> [otherRecordId]
    AND [signal] IN (N'provider-id', N'asset-checksum', N'identifier', N'title-similarity')
    AND [state] IN (N'open', N'collapsed', N'merged', N'distinct')
    AND ([score] IS NULL OR [score] BETWEEN 0 AND 100)
    AND ([state] <> N'collapsed' OR [signal] = N'provider-id')
    AND ([state] <> N'merged' OR [crossLanguage] = 0)
    AND ([state] NOT IN (N'merged', N'distinct') OR ([decidedByUserId] IS NOT NULL AND [decidedAt] IS NOT NULL))
    AND [version] >= 1
);

-- An acquisition: its own licence and visibility; only owned or licensed
-- material decided by a person may become eligible for public release.
ALTER TABLE [dbo].[MigrationAssetProvenance] ADD CONSTRAINT [MigrationAssetProvenance_ck] CHECK (
    [licence] IN (N'unknown', N'organisation-owned', N'licensed', N'third-party')
    AND [visibility] IN (N'restricted', N'public-eligible')
    AND ([visibility] = N'restricted'
         OR ([licence] IN (N'organisation-owned', N'licensed') AND [decidedByUserId] IS NOT NULL))
    AND (CASE WHEN [decidedByUserId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [decidedAt] IS NULL THEN 1 ELSE 0 END)
    AND [byteSize] >= 0
    AND [checksum] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^0-9a-f]%'
    AND [version] >= 1
);

-- A legacy mapping: EXACTLY ONE typed target (today, a Video), a site-relative
-- canonical path, and the change trail of a disabled mapping.
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_ck] CHECK (
    [videoId] IS NOT NULL
    AND [state] IN (N'active', N'disabled')
    AND [canonicalPath] LIKE N'/%' AND [canonicalPath] NOT LIKE N'//%'
    AND [legacyUrlDigest] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^0-9a-f]%'
    AND (CASE WHEN [changedAt] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [changedByUserId] IS NULL THEN 1 ELSE 0 END)
    AND ([state] = N'active' OR [changedAt] IS NOT NULL)
    AND [version] >= 1
);

-- A manifest: each phase carries exactly the instants and people it implies.
ALTER TABLE [dbo].[MigrationPublishManifest] ADD CONSTRAINT [MigrationPublishManifest_ck] CHECK (
    [state] IN (N'draft', N'publishing', N'published', N'rolling-back', N'rolled-back', N'discarded')
    AND (CASE WHEN [state] IN (N'draft', N'discarded') THEN 1 ELSE 0 END) = (CASE WHEN [publishedByUserId] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [publishedByUserId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [publishStartedAt] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [state] IN (N'published', N'rolling-back', N'rolled-back') THEN 1 ELSE 0 END) = (CASE WHEN [publishedAt] IS NOT NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [state] IN (N'rolling-back', N'rolled-back') THEN 1 ELSE 0 END) = (CASE WHEN [rollbackByUserId] IS NOT NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [rollbackByUserId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [rollbackStartedAt] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [rollbackByUserId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [rollbackReason] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [state] = N'rolled-back' THEN 1 ELSE 0 END) = (CASE WHEN [rolledBackAt] IS NOT NULL THEN 1 ELSE 0 END)
    AND [version] >= 1
);

-- An entry: what it made is recorded exactly when it made it.
ALTER TABLE [dbo].[MigrationManifestEntry] ADD CONSTRAINT [MigrationManifestEntry_ck] CHECK (
    [position] >= 0
    AND [state] IN (N'pending', N'publishing', N'published', N'refused', N'rolled-back', N'rollback-refused')
    AND (CASE WHEN [state] IN (N'published', N'rolled-back', N'rollback-refused') THEN 1 ELSE 0 END) = (CASE WHEN [videoId] IS NOT NULL AND [targetVersion] IS NOT NULL AND [canonicalPath] IS NOT NULL AND [publishedAt] IS NOT NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [state] = N'refused' THEN 1 ELSE 0 END) = (CASE WHEN [refusal] IS NOT NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [state] = N'rolled-back' THEN 1 ELSE 0 END) = (CASE WHEN [rolledBackAt] IS NOT NULL THEN 1 ELSE 0 END)
    AND ([canonicalPath] IS NULL OR ([canonicalPath] LIKE N'/%' AND [canonicalPath] NOT LIKE N'//%'))
    AND ([targetVersion] IS NULL OR [targetVersion] >= 1)
    AND [version] >= 1
);

ALTER TABLE [dbo].[MigrationPromotion] ADD CONSTRAINT [MigrationPromotion_ck] CHECK (
    [state] IN (N'draft', N'approved', N'promoting', N'promoted', N'withdrawn')
    AND [destination] IN (N'bundle')
    AND (CASE WHEN [approvedByUserId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [approvedAt] IS NULL THEN 1 ELSE 0 END)
    AND ([state] NOT IN (N'approved', N'promoting', N'promoted') OR [approvedByUserId] IS NOT NULL)
    AND (CASE WHEN [state] = N'withdrawn' THEN 1 ELSE 0 END) = (CASE WHEN [withdrawnByUserId] IS NOT NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [withdrawnByUserId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [withdrawnAt] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [state] = N'promoted' THEN 1 ELSE 0 END) = (CASE WHEN [completedAt] IS NOT NULL THEN 1 ELSE 0 END)
    AND [version] >= 1
);

ALTER TABLE [dbo].[MigrationPromotionEntry] ADD CONSTRAINT [MigrationPromotionEntry_ck] CHECK (
    [position] >= 0
    AND [state] IN (N'pending', N'promoted')
    AND (CASE WHEN [state] = N'promoted' THEN 1 ELSE 0 END) = (CASE WHEN [promotedAt] IS NOT NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [state] = N'promoted' THEN 1 ELSE 0 END) = (CASE WHEN [destinationRef] IS NOT NULL THEN 1 ELSE 0 END)
);

-- ===========================================================================
-- A source keeps its key, authority, access, kind and creation, and moves one
-- version at a time (51370).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MigrationSourceIntegrity] ON [dbo].[MigrationSource] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM deleted)
 BEGIN
   IF EXISTS (SELECT 1 FROM inserted WHERE [version] <> 1)
     THROW 51370, ''A source begins at version 1.'', 1;
   RETURN;
 END;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[key] COLLATE Latin1_General_BIN2 <> i.[key] COLLATE Latin1_General_BIN2
      OR d.[authorityKind] <> i.[authorityKind] OR d.[accessMethod] <> i.[accessMethod]
      OR d.[contentKind] <> i.[contentKind]
      OR d.[createdAt] <> i.[createdAt] OR d.[createdByUserId] <> i.[createdByUserId]
      OR i.[version] <> d.[version] + 1
 )
   THROW 51370, ''A source keeps its identity and authority, and moves one version at a time.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51370, ''A source keeps its identity.'', 1;
END');

-- ===========================================================================
-- A host is set once; a FIXTURE source names only `*.fixture.invalid` (51371).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MigrationSourceHostIntegrity] ON [dbo].[MigrationSourceHost] AFTER INSERT, UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM deleted)
   THROW 51371, ''A source host is never changed or removed.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN [dbo].[MigrationSource] s ON s.[id] = i.[sourceId]
   WHERE s.[authorityKind] = N''fixture''
     AND i.[host] COLLATE Latin1_General_BIN2 NOT LIKE N''%_.fixture.invalid''
 )
   THROW 51371, ''A fixture source names only *.fixture.invalid hosts.'', 1;
END');

-- ===========================================================================
-- A run keeps its source, operator, provenance and start; a finished run is
-- never changed (51375).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MigrationRunIntegrity] ON [dbo].[MigrationRun] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM deleted)
 BEGIN
   IF EXISTS (SELECT 1 FROM inserted WHERE [state] <> N''open'' OR [version] <> 1 OR [reconciliation] <> N''pending'')
     THROW 51375, ''A run begins open, unreconciled, at version 1.'', 1;
   RETURN;
 END;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51375, ''A run keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[sourceId] <> i.[sourceId] OR d.[operatorUserId] <> i.[operatorUserId]
      OR d.[adapterKey] <> i.[adapterKey] OR d.[adapterVersion] <> i.[adapterVersion]
      OR d.[parserKey] <> i.[parserKey] OR d.[parserVersion] <> i.[parserVersion]
      OR d.[normalizerVersion] <> i.[normalizerVersion] OR d.[codeRevision] <> i.[codeRevision]
      OR d.[startedAt] <> i.[startedAt]
      OR d.[state] <> N''open''
      OR (d.[discoveryComplete] = 1 AND i.[discoveryComplete] = 0)
 )
   THROW 51375, ''A run keeps its provenance, and a finished run is never changed.'', 1;
END');

-- ===========================================================================
-- A record keeps its source, key, kind and first sighting (51376).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MigrationRecordIntegrity] ON [dbo].[MigrationRecord] AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51376, ''A record keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[sourceId] <> i.[sourceId]
      OR d.[externalKey] COLLATE Latin1_General_BIN2 <> i.[externalKey] COLLATE Latin1_General_BIN2
      OR d.[contentKind] <> i.[contentKind]
      OR d.[firstObservedRunId] <> i.[firstObservedRunId] OR d.[createdAt] <> i.[createdAt]
 )
   THROW 51376, ''A record keeps its source, key, kind and first sighting.'', 1;
END');

-- ===========================================================================
-- An item belongs to a record of its run''s source; it keeps its run, record
-- and position, and leaves a terminal outcome only as an errored item''s
-- retry (51377).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MigrationRunItemIntegrity] ON [dbo].[MigrationRunItem] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN [dbo].[MigrationRun] r ON r.[id] = i.[runId]
   JOIN [dbo].[MigrationRecord] c ON c.[id] = i.[recordId]
   WHERE r.[sourceId] <> c.[sourceId]
 )
   THROW 51377, ''A run item is a record of its own run''''s source.'', 1;
 IF NOT EXISTS (SELECT 1 FROM deleted) RETURN;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51377, ''A run item keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[runId] <> i.[runId] OR d.[recordId] <> i.[recordId] OR d.[position] <> i.[position]
      OR (d.[outcome] <> N''pending'' AND d.[outcome] <> i.[outcome]
          AND NOT (d.[outcome] = N''errored'' AND i.[outcome] = N''pending''))
 )
   THROW 51377, ''A run item keeps its place, and leaves a terminal outcome only to retry an error.'', 1;
END');

-- ===========================================================================
-- A snapshot is evidence: of a record and run of its own source (the
-- composite keys), never rewritten, never deleted; the only change it accepts
-- is a deliberate disposal of its body (51372, 51373).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MigrationRawSnapshotIntegrity] ON [dbo].[MigrationRawSnapshot] AFTER INSERT, UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM deleted)
 BEGIN
   IF EXISTS (SELECT 1 FROM inserted WHERE [body] IS NULL)
     THROW 51373, ''A snapshot is created with its body.'', 1;
   RETURN;
 END;
 IF NOT EXISTS (SELECT 1 FROM inserted)
   THROW 51372, ''A raw snapshot is never deleted.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51372, ''A raw snapshot keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[disposedAt] IS NOT NULL
      OR i.[body] IS NOT NULL
      OR d.[sourceId] <> i.[sourceId] OR d.[recordId] <> i.[recordId] OR d.[runId] <> i.[runId]
      OR d.[requestedUrl] COLLATE Latin1_General_BIN2 <> i.[requestedUrl] COLLATE Latin1_General_BIN2
      OR d.[finalUrl] COLLATE Latin1_General_BIN2 <> i.[finalUrl] COLLATE Latin1_General_BIN2
      OR ISNULL(d.[httpStatus], -1) <> ISNULL(i.[httpStatus], -1)
      OR ISNULL(d.[contentType], N'''') COLLATE Latin1_General_BIN2 <> ISNULL(i.[contentType], N'''') COLLATE Latin1_General_BIN2
      OR ISNULL(d.[headers], N'''') COLLATE Latin1_General_BIN2 <> ISNULL(i.[headers], N'''') COLLATE Latin1_General_BIN2
      OR d.[byteSize] <> i.[byteSize] OR d.[checksum] <> i.[checksum] OR d.[fetchedAt] <> i.[fetchedAt]
      OR d.[fetcherKey] <> i.[fetcherKey] OR d.[fetcherVersion] <> i.[fetcherVersion]
      OR d.[personalData] <> i.[personalData]
 )
   THROW 51372, ''A raw snapshot is never rewritten; only its body may be disposed of.'', 1;
END');

-- ===========================================================================
-- A staged revision is produced pending at version 1 from a snapshot whose
-- bytes it names; its payload and provenance never change; its review moves
-- pending -> approved | rejected | superseded, approved -> pending (approval
-- withdrawn) | superseded, rejected -> superseded, one version at a time
-- (51374).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MigrationStagedRecordIntegrity] ON [dbo].[MigrationStagedRecord] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM deleted)
 BEGIN
   IF EXISTS (
     SELECT 1 FROM inserted i
     WHERE i.[review] <> N''pending'' OR i.[version] <> 1 OR i.[reviewedByUserId] IS NOT NULL
        OR NOT EXISTS (
          SELECT 1 FROM [dbo].[MigrationRawSnapshot] s
          WHERE s.[id] = i.[snapshotId] AND s.[checksum] = i.[inputChecksum])
        OR NOT EXISTS (
          SELECT 1 FROM [dbo].[MigrationRun] r
          JOIN [dbo].[MigrationRecord] c ON c.[id] = i.[recordId] AND c.[sourceId] = r.[sourceId]
          WHERE r.[id] = i.[runId])
   )
     THROW 51374, ''A staged revision begins pending at version 1, from a snapshot whose checksum it carries, in a run of its own source.'', 1;
   RETURN;
 END;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51374, ''A staged revision keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[recordId] <> i.[recordId] OR d.[snapshotId] <> i.[snapshotId] OR d.[runId] <> i.[runId]
      OR d.[revision] <> i.[revision] OR d.[contentKind] <> i.[contentKind]
      OR d.[title] COLLATE Latin1_General_BIN2 <> i.[title] COLLATE Latin1_General_BIN2
      OR d.[titleKey] COLLATE Latin1_General_BIN2 <> i.[titleKey] COLLATE Latin1_General_BIN2
      OR ISNULL(d.[dedupeKey], N'''') COLLATE Latin1_General_BIN2 <> ISNULL(i.[dedupeKey], N'''') COLLATE Latin1_General_BIN2
      OR ISNULL(d.[languageCode], N'''') <> ISNULL(i.[languageCode], N'''')
      OR d.[payload] COLLATE Latin1_General_BIN2 <> i.[payload] COLLATE Latin1_General_BIN2
      OR d.[payloadChecksum] <> i.[payloadChecksum]
      OR d.[adapterKey] <> i.[adapterKey] OR d.[adapterVersion] <> i.[adapterVersion]
      OR d.[parserKey] <> i.[parserKey] OR d.[parserVersion] <> i.[parserVersion]
      OR d.[normalizerVersion] <> i.[normalizerVersion] OR d.[codeRevision] <> i.[codeRevision]
      OR d.[inputChecksum] <> i.[inputChecksum] OR d.[producedAt] <> i.[producedAt]
      OR d.[validation] <> i.[validation]
      OR ISNULL(d.[issues], N'''') COLLATE Latin1_General_BIN2 <> ISNULL(i.[issues], N'''') COLLATE Latin1_General_BIN2
      OR d.[personalData] <> i.[personalData]
      OR i.[version] <> d.[version] + 1
      OR NOT ((d.[review] = N''pending'' AND i.[review] IN (N''approved'', N''rejected'', N''superseded''))
              OR (d.[review] = N''approved'' AND i.[review] IN (N''pending'', N''superseded''))
              OR (d.[review] = N''rejected'' AND i.[review] = N''superseded''))
 )
   THROW 51374, ''A staged revision keeps its payload and provenance, and its review moves only forward.'', 1;
END');

-- ===========================================================================
-- Topic mappings, errors, duplicate pairs, acquisitions and legacy mappings
-- keep what identifies them and move one version at a time (51380-51384).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MigrationTopicMappingIntegrity] ON [dbo].[MigrationTopicMapping] AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51384, ''A topic mapping keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[sourceId] <> i.[sourceId]
      OR d.[categoryKey] COLLATE Latin1_General_BIN2 <> i.[categoryKey] COLLATE Latin1_General_BIN2
      OR i.[version] <> d.[version] + 1
 )
   THROW 51384, ''A topic mapping keeps its source and category, and moves one version at a time.'', 1;
END');

EXEC(N'CREATE TRIGGER [dbo].[MigrationErrorIntegrity] ON [dbo].[MigrationError] AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51383, ''An error keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[sourceId] <> i.[sourceId] OR d.[runId] <> i.[runId]
      OR ISNULL(d.[recordId], N'''') <> ISNULL(i.[recordId], N'''')
      OR d.[stage] <> i.[stage] OR d.[classification] <> i.[classification]
      OR d.[retryEligible] <> i.[retryEligible] OR ISNULL(d.[httpStatus], -1) <> ISNULL(i.[httpStatus], -1)
      OR d.[attempt] <> i.[attempt] OR d.[occurredAt] <> i.[occurredAt]
      OR ISNULL(d.[detail], N'''') COLLATE Latin1_General_BIN2 <> ISNULL(i.[detail], N'''') COLLATE Latin1_General_BIN2
      OR i.[version] <> d.[version] + 1
      OR NOT ((d.[resolution] = N''open'' AND i.[resolution] IN (N''retry-requested'', N''dismissed'', N''resolved''))
              OR (d.[resolution] = N''retry-requested'' AND i.[resolution] = N''resolved''))
 )
   THROW 51383, ''An error keeps what happened, and its resolution moves only forward.'', 1;
END');

EXEC(N'CREATE TRIGGER [dbo].[MigrationDuplicateCandidateIntegrity] ON [dbo].[MigrationDuplicateCandidate] AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51383, ''A duplicate candidate keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[recordId] <> i.[recordId] OR d.[otherRecordId] <> i.[otherRecordId]
      OR d.[signal] <> i.[signal] OR d.[crossLanguage] <> i.[crossLanguage]
      OR ISNULL(d.[score], -1) <> ISNULL(i.[score], -1) OR d.[createdAt] <> i.[createdAt]
      OR i.[version] <> d.[version] + 1
 )
   THROW 51383, ''A duplicate candidate keeps its pair and evidence, and moves one version at a time.'', 1;
END');

EXEC(N'CREATE TRIGGER [dbo].[MigrationAssetProvenanceIntegrity] ON [dbo].[MigrationAssetProvenance] AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51382, ''An acquisition keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[sourceId] <> i.[sourceId] OR ISNULL(d.[recordId], N'''') <> ISNULL(i.[recordId], N'''')
      OR d.[runId] <> i.[runId]
      OR d.[originalUrl] COLLATE Latin1_General_BIN2 <> i.[originalUrl] COLLATE Latin1_General_BIN2
      OR d.[originalUrlDigest] <> i.[originalUrlDigest] OR d.[assetId] <> i.[assetId]
      OR d.[checksum] <> i.[checksum] OR d.[byteSize] <> i.[byteSize]
      OR d.[mediaType] <> i.[mediaType] OR d.[acquiredAt] <> i.[acquiredAt]
      OR i.[version] <> d.[version] + 1
 )
   THROW 51382, ''An acquisition keeps what it acquired; only its rights decision moves.'', 1;
END');

EXEC(N'CREATE TRIGGER [dbo].[MigrationLegacyMappingIntegrity] ON [dbo].[MigrationLegacyMapping] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM deleted)
 BEGIN
   IF EXISTS (
     SELECT 1 FROM inserted i
     JOIN [dbo].[MigrationManifestEntry] e ON e.[id] = i.[manifestEntryId]
     JOIN [dbo].[MigrationRecord] c ON c.[id] = i.[recordId]
     WHERE e.[recordId] <> i.[recordId] AND ISNULL(c.[mergedIntoRecordId], N'''') <> e.[recordId]
   )
     THROW 51380, ''A legacy mapping names its entry''''s record, or a record merged into it.'', 1;
   RETURN;
 END;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51380, ''A legacy mapping keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[sourceId] <> i.[sourceId] OR d.[recordId] <> i.[recordId]
      OR d.[legacyUrl] COLLATE Latin1_General_BIN2 <> i.[legacyUrl] COLLATE Latin1_General_BIN2
      OR d.[legacyUrlDigest] <> i.[legacyUrlDigest]
      OR ISNULL(d.[videoId], N'''') <> ISNULL(i.[videoId], N'''')
      OR d.[canonicalPath] COLLATE Latin1_General_BIN2 <> i.[canonicalPath] COLLATE Latin1_General_BIN2
      OR ISNULL(d.[manifestEntryId], N'''') <> ISNULL(i.[manifestEntryId], N'''')
      OR d.[createdAt] <> i.[createdAt] OR d.[createdByUserId] <> i.[createdByUserId]
      OR i.[version] <> d.[version] + 1
 )
   THROW 51380, ''A legacy mapping keeps its address and target; only its state moves.'', 1;
END');

-- ===========================================================================
-- A revision's categories and links are written once and name mappings of
-- the revision's OWN source (51374, 51380).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MigrationStagedCategoryIntegrity] ON [dbo].[MigrationStagedCategory] AFTER INSERT, UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM deleted)
   THROW 51374, ''A staged category is never changed or removed.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN [dbo].[MigrationStagedRecord] s ON s.[id] = i.[stagedRecordId]
   JOIN [dbo].[MigrationRecord] c ON c.[id] = s.[recordId]
   JOIN [dbo].[MigrationTopicMapping] m ON m.[id] = i.[topicMappingId]
   WHERE m.[sourceId] <> c.[sourceId]
 )
   THROW 51374, ''A staged category names a topic mapping of its own source.'', 1;
END');

EXEC(N'CREATE TRIGGER [dbo].[MigrationStagedLinkIntegrity] ON [dbo].[MigrationStagedLink] AFTER INSERT, UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM deleted)
   THROW 51380, ''A staged link is never changed or removed.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN [dbo].[MigrationStagedRecord] s ON s.[id] = i.[stagedRecordId]
   JOIN [dbo].[MigrationRecord] c ON c.[id] = s.[recordId]
   JOIN [dbo].[MigrationLegacyMapping] m ON m.[id] = i.[legacyMappingId]
   WHERE m.[sourceId] <> c.[sourceId]
 )
   THROW 51380, ''A staged link is rewritten only by a legacy mapping of its own source.'', 1;
END');

-- ===========================================================================
-- A manifest begins a draft; it is published, and rolled back, only by an
-- account that holds `migration.publish` NOW with a live
-- `migration-publication` step-up on a live session — checked HERE as well as
-- by the service — and its phases move only forward (51378).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MigrationPublishManifestIntegrity] ON [dbo].[MigrationPublishManifest] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM deleted)
 BEGIN
   IF EXISTS (SELECT 1 FROM inserted WHERE [state] <> N''draft'' OR [version] <> 1)
     THROW 51378, ''A manifest begins a draft, at version 1.'', 1;
   RETURN;
 END;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51378, ''A manifest keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[sourceId] <> i.[sourceId] OR d.[runId] <> i.[runId]
      OR d.[createdByUserId] <> i.[createdByUserId] OR d.[createdAt] <> i.[createdAt]
      OR (d.[publishedByUserId] IS NOT NULL AND ISNULL(i.[publishedByUserId], N'''') <> d.[publishedByUserId])
      OR (d.[rollbackByUserId] IS NOT NULL AND ISNULL(i.[rollbackByUserId], N'''') <> d.[rollbackByUserId])
      OR i.[version] <> d.[version] + 1
      OR NOT (i.[state] = d.[state]
              OR (d.[state] = N''draft'' AND i.[state] IN (N''publishing'', N''discarded''))
              OR (d.[state] = N''publishing'' AND i.[state] = N''published'')
              OR (d.[state] = N''published'' AND i.[state] = N''rolling-back'')
              OR (d.[state] = N''rolling-back'' AND i.[state] = N''rolled-back''))
      OR d.[state] IN (N''rolled-back'', N''discarded'')
 )
   THROW 51378, ''A manifest keeps its identity and moves only forward.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   CROSS APPLY (SELECT CASE
       WHEN d.[state] = N''draft'' AND i.[state] = N''publishing'' THEN i.[publishedByUserId]
       WHEN d.[state] = N''published'' AND i.[state] = N''rolling-back'' THEN i.[rollbackByUserId]
     END AS [actorId]) a
   WHERE a.[actorId] IS NOT NULL AND (
     NOT EXISTS (
       SELECT 1 FROM [dbo].[RoleAssignment] ra
       JOIN [dbo].[Role] r ON r.[id] = ra.[roleId] AND r.[deactivatedAt] IS NULL
       JOIN [dbo].[RolePermission] rp ON rp.[roleId] = r.[id] AND rp.[permissionKey] = N''migration.publish''
       JOIN [dbo].[User] u ON u.[id] = ra.[userId] AND u.[status] = N''active''
       WHERE ra.[userId] = a.[actorId] AND ra.[revokedAt] IS NULL)
     OR NOT EXISTS (
       SELECT 1 FROM [dbo].[StepUpGrant] g
       JOIN [dbo].[Session] s ON s.[id] = g.[sessionId] AND s.[userId] = g.[userId] AND s.[expiresAt] > SYSUTCDATETIME()
       WHERE g.[userId] = a.[actorId] AND g.[purpose] = N''migration-publication''
         AND g.[expiresAt] > SYSUTCDATETIME()))
 )
   THROW 51378, ''Migration publication authority is not held now.'', 1;
END');

-- ===========================================================================
-- An entry names an APPROVED, valid revision and is added only to a draft; it
-- is published only while its manifest is publishing and rolled back only
-- while it is rolling back; what it made is recorded once (51379).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MigrationManifestEntryIntegrity] ON [dbo].[MigrationManifestEntry] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM deleted)
 BEGIN
   IF EXISTS (
     SELECT 1 FROM inserted i
     WHERE i.[state] <> N''pending'' OR i.[version] <> 1
        OR NOT EXISTS (SELECT 1 FROM [dbo].[MigrationPublishManifest] m WHERE m.[id] = i.[manifestId] AND m.[state] = N''draft'')
        OR NOT EXISTS (
          SELECT 1 FROM [dbo].[MigrationStagedRecord] s
          JOIN [dbo].[MigrationPublishManifest] m ON m.[id] = i.[manifestId]
          JOIN [dbo].[MigrationRecord] c ON c.[id] = s.[recordId] AND c.[sourceId] = m.[sourceId]
          WHERE s.[id] = i.[stagedRecordId] AND s.[review] = N''approved'' AND s.[validation] = N''valid'')
   )
     THROW 51379, ''An entry names an approved revision of the manifest''''s source and joins only a draft.'', 1;
   RETURN;
 END;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51379, ''An entry keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   JOIN [dbo].[MigrationPublishManifest] m ON m.[id] = i.[manifestId]
   WHERE d.[manifestId] <> i.[manifestId] OR d.[position] <> i.[position]
      OR d.[stagedRecordId] <> i.[stagedRecordId] OR d.[recordId] <> i.[recordId]
      OR (d.[videoId] IS NOT NULL AND ISNULL(i.[videoId], N'''') <> d.[videoId])
      OR (d.[targetVersion] IS NOT NULL AND ISNULL(i.[targetVersion], -1) <> d.[targetVersion])
      OR (d.[canonicalPath] IS NOT NULL AND ISNULL(i.[canonicalPath], N'''') COLLATE Latin1_General_BIN2 <> d.[canonicalPath] COLLATE Latin1_General_BIN2)
      OR i.[version] <> d.[version] + 1
      OR NOT ((d.[state] IN (N''pending'', N''publishing'') AND i.[state] IN (N''publishing'', N''published'', N''refused'') AND m.[state] = N''publishing'')
              OR (d.[state] IN (N''published'', N''rollback-refused'') AND i.[state] IN (N''rolled-back'', N''rollback-refused'') AND m.[state] = N''rolling-back''))
 )
   THROW 51379, ''An entry moves only in its manifest''''s own phase, and what it made is recorded once.'', 1;
END');

-- ===========================================================================
-- A promotion is approved only by an account holding `migration.publish` NOW
-- with a live `migration-publication` step-up; it moves draft -> approved ->
-- promoting -> promoted, and an approval may be withdrawn until it completes.
-- Its entries are PUBLISHED manifest entries — content, never accounts or
-- configuration — promoted only while it is promoting (51381).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MigrationPromotionIntegrity] ON [dbo].[MigrationPromotion] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM deleted)
 BEGIN
   IF EXISTS (SELECT 1 FROM inserted WHERE [state] <> N''draft'' OR [version] <> 1)
     THROW 51381, ''A promotion begins a draft, at version 1.'', 1;
   RETURN;
 END;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51381, ''A promotion keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[destination] <> i.[destination]
      OR d.[createdByUserId] <> i.[createdByUserId] OR d.[createdAt] <> i.[createdAt]
      OR (d.[approvedByUserId] IS NOT NULL AND ISNULL(i.[approvedByUserId], N'''') <> d.[approvedByUserId])
      OR i.[version] <> d.[version] + 1
      OR d.[state] IN (N''promoted'', N''withdrawn'')
      OR NOT (i.[state] = d.[state]
              OR (d.[state] = N''draft'' AND i.[state] IN (N''approved'', N''withdrawn''))
              OR (d.[state] = N''approved'' AND i.[state] IN (N''promoting'', N''withdrawn''))
              OR (d.[state] = N''promoting'' AND i.[state] IN (N''promoted'', N''withdrawn'')))
 )
   THROW 51381, ''A promotion keeps its identity and moves only forward.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[state] = N''draft'' AND i.[state] = N''approved'' AND (
     NOT EXISTS (
       SELECT 1 FROM [dbo].[RoleAssignment] ra
       JOIN [dbo].[Role] r ON r.[id] = ra.[roleId] AND r.[deactivatedAt] IS NULL
       JOIN [dbo].[RolePermission] rp ON rp.[roleId] = r.[id] AND rp.[permissionKey] = N''migration.publish''
       JOIN [dbo].[User] u ON u.[id] = ra.[userId] AND u.[status] = N''active''
       WHERE ra.[userId] = i.[approvedByUserId] AND ra.[revokedAt] IS NULL)
     OR NOT EXISTS (
       SELECT 1 FROM [dbo].[StepUpGrant] g
       JOIN [dbo].[Session] s ON s.[id] = g.[sessionId] AND s.[userId] = g.[userId] AND s.[expiresAt] > SYSUTCDATETIME()
       WHERE g.[userId] = i.[approvedByUserId] AND g.[purpose] = N''migration-publication''
         AND g.[expiresAt] > SYSUTCDATETIME()))
 )
   THROW 51381, ''Promotion approval authority is not held now.'', 1;
END');

EXEC(N'CREATE TRIGGER [dbo].[MigrationPromotionEntryIntegrity] ON [dbo].[MigrationPromotionEntry] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM deleted)
 BEGIN
   IF EXISTS (
     SELECT 1 FROM inserted i
     WHERE i.[state] <> N''pending''
        OR NOT EXISTS (SELECT 1 FROM [dbo].[MigrationPromotion] p WHERE p.[id] = i.[promotionId] AND p.[state] = N''draft'')
        OR NOT EXISTS (SELECT 1 FROM [dbo].[MigrationManifestEntry] e WHERE e.[id] = i.[manifestEntryId] AND e.[state] = N''published'')
   )
     THROW 51381, ''A promotion carries only published entries, added while it is a draft.'', 1;
   RETURN;
 END;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51381, ''A promotion entry keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   JOIN [dbo].[MigrationPromotion] p ON p.[id] = i.[promotionId]
   WHERE d.[promotionId] <> i.[promotionId] OR d.[position] <> i.[position]
      OR d.[manifestEntryId] <> i.[manifestEntryId]
      OR d.[state] <> N''pending'' OR i.[state] <> N''promoted'' OR p.[state] <> N''promoting''
 )
   THROW 51381, ''A promotion entry is promoted once, while its promotion is promoting.'', 1;
END');

-- ===========================================================================
-- Permissions
-- ===========================================================================
INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'migration.read', N'View migration sources, runs, staged records, duplicates, mappings, errors, manifests, promotions and reconciliation. Never raw snapshot bodies. Changes nothing.'),
    (N'migration.administer', N'Operate fixture sources and runs; review staged records; decide duplicates, mappings, errors, disappearances and asset rights; read raw evidence (audited); prepare manifests. Publishes nothing.'),
    (N'migration.publish', N'Publish a reviewed migration manifest through its targets'' own interfaces, roll one back, and approve a promotion, after a migration-publication step-up. Never replaces target or religious approval.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

-- EXTENDING THE PROTECTED PLATFORM ADMINISTRATOR BUNDLE by the two ORDINARY
-- Migration keys — a privilege change, so the holders' sessions and step-up
-- grants are revoked in this same transaction (SECURITY_BASELINE.md 8.1).
-- `migration.publish` is externally gated: catalogued above, bundled nowhere.
DECLARE @migrationAdminRoleId NVARCHAR(36);
DECLARE @migrationAddedKeys NVARCHAR(200);

SELECT @migrationAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @migrationAdminRoleId IS NOT NULL
BEGIN
    SELECT @migrationAddedKeys = STRING_AGG(p.[key], N' ') WITHIN GROUP (ORDER BY p.[key])
    FROM [dbo].[Permission] p
    WHERE p.[key] IN (N'migration.read', N'migration.administer')
      AND NOT EXISTS (
          SELECT 1 FROM [dbo].[RolePermission] rp
          WHERE rp.[roleId] = @migrationAdminRoleId AND rp.[permissionKey] = p.[key]
      );

    IF @migrationAddedKeys IS NOT NULL AND LEN(@migrationAddedKeys) > 0
    BEGIN
        INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
        SELECT @migrationAdminRoleId, p.[key]
        FROM [dbo].[Permission] p
        WHERE p.[key] IN (N'migration.read', N'migration.administer')
          AND NOT EXISTS (
              SELECT 1 FROM [dbo].[RolePermission] rp
              WHERE rp.[roleId] = @migrationAdminRoleId AND rp.[permissionKey] = p.[key]
          );

        -- Grants before sessions, so the count each statement reports is the
        -- one it actually removed rather than whatever a cascade took first.
        DELETE FROM [dbo].[StepUpGrant]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @migrationAdminRoleId AND ra.[revokedAt] IS NULL
        );

        DELETE FROM [dbo].[Session]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @migrationAdminRoleId AND ra.[revokedAt] IS NULL
        );

        -- WHICH KEYS WERE ADDED, and nothing else (SECURITY_BASELINE.md 13.4).
        INSERT INTO [dbo].[AuditLog]
            ([id], [actorType], [actorId], [action], [targetType], [targetId],
             [afterState], [authorisingSource])
        VALUES
            (NEWID(), N'migration', NULL, N'migration.permissions.provisioned', N'role',
             @migrationAdminRoleId,
             N'{"added":"' + @migrationAddedKeys + N'"}',
             N'20261011000000_phase29_migration_provenance');
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
