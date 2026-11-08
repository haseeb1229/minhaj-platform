BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- Rebaseline R2 - Storage image derivatives
-- ===========================================================================
--
-- ONE TABLE, and it is Storage's, Layer 0 like Asset (ARCHITECTURE.md 4.2). A
-- public still image may be rendered at a few narrower WebP widths so a card
-- does not download a sixteen-megabyte original. Each width is its OWN Asset
-- row - stored through the same custody as an upload: sniffed, scanned,
-- cleared by checksum - and this table is only the link from a source to the
-- Asset holding one of its widths.
--
-- STILL NO OWNER. No context's key appears here: a derivative is served only
-- while the owning context's PUBLIC policy would serve its source, asked about
-- the source asset its own record names. Storage still reads no consumer table.
--
-- NOTHING CASCADES. Both keys are NO ACTION; a source's derivatives are
-- withdrawn, their bytes removed and their links and records deleted, in that
-- order, by Storage itself when the source is released.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.

-- CreateTable
CREATE TABLE [dbo].[AssetDerivative] (
    [sourceAssetId] NVARCHAR(36) NOT NULL,
    [width] INT NOT NULL,
    [assetId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AssetDerivative_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [AssetDerivative_pkey] PRIMARY KEY CLUSTERED ([sourceAssetId], [width])
);

-- A derivative Asset is one width of exactly one source.
CREATE UNIQUE NONCLUSTERED INDEX [AssetDerivative_assetId_key] ON [dbo].[AssetDerivative]([assetId]);

-- The widths Storage renders (IMAGE_DERIVATIVE_WIDTHS), and no other.
ALTER TABLE [dbo].[AssetDerivative] ADD CONSTRAINT [AssetDerivative_width_ck]
    CHECK ([width] IN (320, 640, 960, 1440));

-- An asset is never its own derivative.
ALTER TABLE [dbo].[AssetDerivative] ADD CONSTRAINT [AssetDerivative_distinct_ck]
    CHECK ([assetId] <> [sourceAssetId]);

-- AddForeignKey
ALTER TABLE [dbo].[AssetDerivative] ADD CONSTRAINT [AssetDerivative_sourceAssetId_fkey] FOREIGN KEY ([sourceAssetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AssetDerivative] ADD CONSTRAINT [AssetDerivative_assetId_fkey] FOREIGN KEY ([assetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;

THROW

END CATCH
