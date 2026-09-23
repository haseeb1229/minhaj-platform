BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Work] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [isFeatured] BIT NOT NULL CONSTRAINT [Work_isFeatured_df] DEFAULT 0,
    [version] INT NOT NULL CONSTRAINT [Work_version_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Work_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Work_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Work_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[WorkLabel] (
    [workId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [description] NVARCHAR(4000) NOT NULL,
    CONSTRAINT [WorkLabel_pkey] PRIMARY KEY CLUSTERED ([workId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[WorkSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [workId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [WorkSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[WorkContributor] (
    [workId] NVARCHAR(36) NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(24) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [WorkContributor_pkey] PRIMARY KEY CLUSTERED ([workId],[personId],[role])
);

-- CreateTable
CREATE TABLE [dbo].[WorkTopic] (
    [workId] NVARCHAR(36) NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [WorkTopic_pkey] PRIMARY KEY CLUSTERED ([workId],[topicId])
);

-- CreateTable
CREATE TABLE [dbo].[Edition] (
    [id] NVARCHAR(36) NOT NULL,
    [workId] NVARCHAR(36) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [label] NVARCHAR(160) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [publisher] NVARCHAR(240),
    [publicationYear] INT,
    [isbn] NVARCHAR(13),
    [pageCount] INT,
    [reading] NVARCHAR(16) NOT NULL,
    [download] NVARCHAR(16) NOT NULL,
    [readableAssetId] NVARCHAR(36),
    [downloadAssetId] NVARCHAR(36),
    [document] NVARCHAR(max),
    [contentVersion] NVARCHAR(64),
    [version] INT NOT NULL CONSTRAINT [Edition_version_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Edition_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Edition_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Edition_id_workId_key] UNIQUE NONCLUSTERED ([id],[workId])
);

-- CreateTable
CREATE TABLE [dbo].[BookTranslation] (
    [editionId] NVARCHAR(36) NOT NULL,
    [workId] NVARCHAR(36) NOT NULL,
    [sourceEditionId] NVARCHAR(36),
    CONSTRAINT [BookTranslation_pkey] PRIMARY KEY CLUSTERED ([editionId]),
    CONSTRAINT [BookTranslation_editionId_workId_key] UNIQUE NONCLUSTERED ([editionId],[workId])
);

-- CreateTable
CREATE TABLE [dbo].[BookTranslator] (
    [editionId] NVARCHAR(36) NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [BookTranslator_pkey] PRIMARY KEY CLUSTERED ([editionId],[personId])
);

-- CreateTable
CREATE TABLE [dbo].[SalePoint] (
    [id] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [address] NVARCHAR(1000) NOT NULL,
    [contact] NVARCHAR(200) NOT NULL,
    [url] NVARCHAR(2000),
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [SalePoint_version_df] DEFAULT 1,
    CONSTRAINT [SalePoint_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[WorkSalePoint] (
    [workId] NVARCHAR(36) NOT NULL,
    [salePointId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [WorkSalePoint_pkey] PRIMARY KEY CLUSTERED ([workId],[salePointId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Work_state_slug_idx] ON [dbo].[Work]([state], [slug]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WorkSlugHistory_workId_idx] ON [dbo].[WorkSlugHistory]([workId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WorkContributor_personId_workId_idx] ON [dbo].[WorkContributor]([personId], [workId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WorkTopic_topicId_workId_idx] ON [dbo].[WorkTopic]([topicId], [workId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Edition_workId_state_id_idx] ON [dbo].[Edition]([workId], [state], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Edition_languageCode_publicationYear_workId_idx] ON [dbo].[Edition]([languageCode], [publicationYear], [workId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Edition_readableAssetId_idx] ON [dbo].[Edition]([readableAssetId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Edition_downloadAssetId_idx] ON [dbo].[Edition]([downloadAssetId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BookTranslation_sourceEditionId_workId_idx] ON [dbo].[BookTranslation]([sourceEditionId], [workId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [BookTranslator_personId_idx] ON [dbo].[BookTranslator]([personId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SalePoint_state_name_id_idx] ON [dbo].[SalePoint]([state], [name], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WorkSalePoint_salePointId_idx] ON [dbo].[WorkSalePoint]([salePointId]);

-- AddForeignKey
ALTER TABLE [dbo].[WorkLabel] ADD CONSTRAINT [WorkLabel_workId_fkey] FOREIGN KEY ([workId]) REFERENCES [dbo].[Work]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[WorkSlugHistory] ADD CONSTRAINT [WorkSlugHistory_workId_fkey] FOREIGN KEY ([workId]) REFERENCES [dbo].[Work]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[WorkContributor] ADD CONSTRAINT [WorkContributor_workId_fkey] FOREIGN KEY ([workId]) REFERENCES [dbo].[Work]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[WorkContributor] ADD CONSTRAINT [WorkContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[WorkTopic] ADD CONSTRAINT [WorkTopic_workId_fkey] FOREIGN KEY ([workId]) REFERENCES [dbo].[Work]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[WorkTopic] ADD CONSTRAINT [WorkTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Edition] ADD CONSTRAINT [Edition_workId_fkey] FOREIGN KEY ([workId]) REFERENCES [dbo].[Work]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Edition] ADD CONSTRAINT [Edition_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Edition] ADD CONSTRAINT [Edition_readableAssetId_fkey] FOREIGN KEY ([readableAssetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Edition] ADD CONSTRAINT [Edition_downloadAssetId_fkey] FOREIGN KEY ([downloadAssetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BookTranslation] ADD CONSTRAINT [BookTranslation_editionId_workId_fkey] FOREIGN KEY ([editionId], [workId]) REFERENCES [dbo].[Edition]([id],[workId]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BookTranslation] ADD CONSTRAINT [BookTranslation_sourceEditionId_workId_fkey] FOREIGN KEY ([sourceEditionId], [workId]) REFERENCES [dbo].[Edition]([id],[workId]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BookTranslator] ADD CONSTRAINT [BookTranslator_editionId_fkey] FOREIGN KEY ([editionId]) REFERENCES [dbo].[BookTranslation]([editionId]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[BookTranslator] ADD CONSTRAINT [BookTranslator_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[WorkSalePoint] ADD CONSTRAINT [WorkSalePoint_workId_fkey] FOREIGN KEY ([workId]) REFERENCES [dbo].[Work]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[WorkSalePoint] ADD CONSTRAINT [WorkSalePoint_salePointId_fkey] FOREIGN KEY ([salePointId]) REFERENCES [dbo].[SalePoint]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;


-- Library integrity: explicit availability decisions are not legal conclusions.
ALTER TABLE [dbo].[Work] ADD CONSTRAINT [Work_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[Work] ADD CONSTRAINT [Work_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[Work] ADD CONSTRAINT [Work_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[WorkLabel] ADD CONSTRAINT [WorkLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[WorkLabel] ADD CONSTRAINT [WorkLabel_title_ck] CHECK (LEN([title]) > 0);
ALTER TABLE [dbo].[WorkContributor] ADD CONSTRAINT [WorkContributor_role_ck] CHECK ([role] IN (N'author',N'translator',N'editor',N'compiler',N'narrator',N'reciter',N'speaker'));
ALTER TABLE [dbo].[WorkContributor] ADD CONSTRAINT [WorkContributor_position_ck] CHECK ([position] >= 0);
ALTER TABLE [dbo].[Edition] ADD CONSTRAINT [Edition_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[Edition] ADD CONSTRAINT [Edition_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[Edition] ADD CONSTRAINT [Edition_reading_ck] CHECK ([reading] IN (N'allowed',N'unavailable') AND ([reading] <> N'allowed' OR [document] IS NOT NULL OR [readableAssetId] IS NOT NULL));
ALTER TABLE [dbo].[Edition] ADD CONSTRAINT [Edition_download_ck] CHECK ([download] IN (N'allowed',N'denied') AND ([download] <> N'allowed' OR [downloadAssetId] IS NOT NULL));
ALTER TABLE [dbo].[Edition] ADD CONSTRAINT [Edition_pageCount_ck] CHECK ([pageCount] IS NULL OR [pageCount] BETWEEN 1 AND 1000000);
ALTER TABLE [dbo].[Edition] ADD CONSTRAINT [Edition_year_ck] CHECK ([publicationYear] IS NULL OR [publicationYear] BETWEEN 1 AND 9999);
ALTER TABLE [dbo].[Edition] ADD CONSTRAINT [Edition_document_ck] CHECK (([document] IS NULL AND [contentVersion] IS NULL) OR ([document] IS NOT NULL AND ISJSON([document]) = 1 AND DATALENGTH([document]) <= 1000000 AND LEN([contentVersion]) = 64));
ALTER TABLE [dbo].[BookTranslation] ADD CONSTRAINT [BookTranslation_source_ck] CHECK ([sourceEditionId] IS NULL OR [sourceEditionId] <> [editionId]);
ALTER TABLE [dbo].[SalePoint] ADD CONSTRAINT [SalePoint_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[SalePoint] ADD CONSTRAINT [SalePoint_version_ck] CHECK ([version] > 0);

-- Reserve the current and every former slug in one unique, append-only namespace
-- (DOMAIN_MODEL.md 19.7). The reservation is made by the DATABASE rather than by
-- the adapter, so a slug cannot be taken by any writer that skips the service --
-- including a future import path -- and the check and the write cannot separate
-- into a race.
--
-- WHY THE ROW IS SKIPPED WHEN THIS WORK ALREADY RESERVED THIS SLUG, and refused
-- when another Work did. Both cases reach the same statement and the difference
-- is the whole rule:
--
--   * a-to-b-to-a on ONE Work is not reuse. The reservation already names this
--     Work, the live slug is unique again, and the resolver prefers the live row
--     -- so nothing redirects to itself. Re-inserting would raise a primary-key
--     violation and turn a legitimate correction into a refusal.
--   * the same spelling on a DIFFERENT Work is reuse, and it is the case the
--     namespace exists to stop. NOT EXISTS is then true, the INSERT is attempted,
--     and the primary key refuses it -- surfacing as the adapter's
--     `duplicate-slug` rather than as a silently skipped reservation that would
--     leave two Works answering one address.
EXEC(N'CREATE TRIGGER [dbo].[LibraryReserveWorkSlug] ON [dbo].[Work] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[WorkSlugHistory] ([slug],[workId])
 SELECT i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[WorkSlugHistory] h
     WHERE h.[slug] = i.[slug] AND h.[workId] = i.[id]
   );
END');
INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'library.read', N'View Library records.'),
    (N'library.administer', N'Create, edit, link and archive Library records.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

-- ===========================================================================
-- EXTENDING THE PROTECTED PLATFORM ADMINISTRATOR BUNDLE
-- ===========================================================================
--
-- The protected bundle is the WHOLE catalogue, so appending permissions widens
-- what a live administrator may do. That is a privilege change, and Phase 2
-- fixed what a privilege change costs: the holders' sessions and step-up grants
-- are revoked in the SAME transaction that changes the bundle
-- (SECURITY_BASELINE.md 8.1). Phase 3B paid it for two keys and Phase 4 for
-- one; this pays it for two, by the same mechanism rather than a variation.
--
-- The protected role is runtime-immutable, so a migration is the only place
-- this can happen, and it happens under review rather than through a screen.
--
-- On a fresh database every count below is zero and nothing is revoked.

DECLARE @libraryAdminRoleId NVARCHAR(36);
DECLARE @libraryAddedKeys NVARCHAR(200);

SELECT @libraryAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @libraryAdminRoleId IS NOT NULL
BEGIN
    SELECT @libraryAddedKeys = STRING_AGG(p.[key], N' ') WITHIN GROUP (ORDER BY p.[key])
    FROM [dbo].[Permission] p
    WHERE p.[key] IN (N'library.read', N'library.administer')
      AND NOT EXISTS (
          SELECT 1 FROM [dbo].[RolePermission] rp
          WHERE rp.[roleId] = @libraryAdminRoleId AND rp.[permissionKey] = p.[key]
      );

    IF @libraryAddedKeys IS NOT NULL AND LEN(@libraryAddedKeys) > 0
    BEGIN
        INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
        SELECT @libraryAdminRoleId, p.[key]
        FROM [dbo].[Permission] p
        WHERE p.[key] IN (N'library.read', N'library.administer')
          AND NOT EXISTS (
              SELECT 1 FROM [dbo].[RolePermission] rp
              WHERE rp.[roleId] = @libraryAdminRoleId AND rp.[permissionKey] = p.[key]
          );

        -- Grants before sessions, so the count each statement reports is the
        -- one it actually removed rather than whatever a cascade took first.
        DELETE FROM [dbo].[StepUpGrant]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @libraryAdminRoleId AND ra.[revokedAt] IS NULL
        );

        DELETE FROM [dbo].[Session]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @libraryAdminRoleId AND ra.[revokedAt] IS NULL
        );

        -- WHICH KEYS WERE ADDED, and nothing else. Not a snapshot of the whole
        -- bundle: an audit payload carrying every permission a role holds would
        -- be a second copy of the privilege model in a table with different
        -- retention (SECURITY_BASELINE.md 13.4).
        INSERT INTO [dbo].[AuditLog]
            ([id], [actorType], [actorId], [action], [targetType], [targetId],
             [afterState], [authorisingSource])
        VALUES
            (NEWID(), N'migration', NULL, N'library.permissions.provisioned', N'role',
             @libraryAdminRoleId,
             N'{"added":"' + @libraryAddedKeys + N'"}',
             N'20260922000000_phase8_library');
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
