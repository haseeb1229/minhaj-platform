BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- Phase 7 - Storage Foundation
-- ===========================================================================
--
-- ONE TABLE, and it is infrastructure. Storage is Layer 0 (ARCHITECTURE.md
-- 6.1): "database, storage, search, email, logging, auditing, rate limiting".
-- It is NOT a bounded context and this migration creates no business model.
--
-- NO OWNER COLUMN OF ANY KIND. There is no `userId`, no `personId`, and no
-- `targetType` + `targetId` pair. The owning context declares its own typed
-- relation to an Asset when that context arrives; a polymorphic owner here
-- would make Layer 0 depend upward on every context that stores anything, and
-- would be the generic reference DOMAIN_MODEL.md 6.2 prohibits.
--
-- NO FILE BYTES. "Large PDFs are never database BLOBs - storage references and
-- checksums only" (DOMAIN_MODEL.md 10.1). There is no VARBINARY column below,
-- which is what makes that rule a property of the schema rather than a habit.
--
-- NO IDENTITY DEPENDENCY. No foreign key reaches User, Role or Permission.
-- Phase 7 delivers the default-deny serving MECHANISM; each Identity-aware
-- consuming phase supplies its own authorisation policy (DELIVERY_PLAN.md 3).
--
-- WHY THE MEASURED COLUMNS ARE NULLABLE. A row is created BEFORE the bytes
-- arrive, so that a crash mid-upload leaves a record that can be reconciled
-- rather than an orphaned file nobody knows about. Until the bytes are
-- measured there is honestly no media type, no size and no checksum, and a
-- placeholder would be a lie the serving path might later trust. `state`
-- carries the truth: only `clean` serves, and `clean` is unreachable until all
-- three are populated.

-- CreateTable
CREATE TABLE [dbo].[Asset] (
    [id] NVARCHAR(36) NOT NULL,
    [storageKey] NVARCHAR(80) NOT NULL,
    [mediaType] NVARCHAR(120),
    [byteSize] BIGINT,
    [checksum] NVARCHAR(64),
    [state] NVARCHAR(16) NOT NULL,
    [rejection] NVARCHAR(32),
    [displayName] NVARCHAR(200),
    [scanAttempts] INT NOT NULL CONSTRAINT [Asset_scanAttempts_df] DEFAULT 0,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Asset_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Asset_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Asset_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- A generated key names at most one object. Without this, a collision would
-- silently overwrite an existing asset instead of failing the insert.
CREATE UNIQUE NONCLUSTERED INDEX [Asset_storageKey_key] ON [dbo].[Asset]([storageKey]);

-- Serving reads by id; reconciliation sweeps by state and age. No speculative
-- index: there is no checksum index because nothing queries by checksum, and
-- adding one would imply a byte-dedup semantic this phase deliberately refuses.
CREATE NONCLUSTERED INDEX [Asset_state_updatedAt_id_idx] ON [dbo].[Asset]([state], [updatedAt], [id]);

-- The lifecycle is enforced in the DATABASE, not only in the service. A row
-- can never hold a state outside this set, whatever writes it.
ALTER TABLE [dbo].[Asset] ADD CONSTRAINT [Asset_state_ck]
    CHECK ([state] IN (N'uploading', N'quarantined', N'clean', N'rejected', N'failed'));

-- `clean` is the ONLY servable state, so `clean` must be fully measured. This
-- makes "an unmeasured asset can never be served" impossible to contradict by
-- any INSERT or UPDATE, including one issued outside the application.
ALTER TABLE [dbo].[Asset] ADD CONSTRAINT [Asset_clean_measured_ck]
    CHECK (
        [state] <> N'clean'
        OR ([mediaType] IS NOT NULL AND [byteSize] IS NOT NULL AND [checksum] IS NOT NULL)
    );

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;

THROW

END CATCH
