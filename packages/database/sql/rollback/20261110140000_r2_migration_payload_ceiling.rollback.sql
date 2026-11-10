-- Disposable migration rehearsal only. Populated deployments require roll-forward or restored backup.
--
-- The payload-ceiling migration raised `MigrationStagedRecord_ck`'s payload
-- bound from 200,000 to 400,000 characters. This restores Phase 30-RD's CHECK
-- exactly. It REFUSES while any staged revision's payload is longer than
-- 200,000 characters — migration evidence is never discarded to make a
-- rollback fit; then it restates the CHECK and removes the migration record.
-- No other row moves.
BEGIN TRY
BEGIN TRAN;
IF EXISTS (SELECT 1 FROM [dbo].[MigrationStagedRecord] WHERE LEN([payload]) > 200000)
  THROW 50000, 'Staged revisions longer than 200,000 characters exist. This disposable-proof rollback never discards migration evidence.', 1;
ALTER TABLE [dbo].[MigrationStagedRecord] DROP CONSTRAINT [MigrationStagedRecord_ck];
EXEC(N'ALTER TABLE [dbo].[MigrationStagedRecord] ADD CONSTRAINT [MigrationStagedRecord_ck] CHECK (
    [revision] >= 1
    AND [contentKind] IN (N''media.video'', N''library.work'', N''library.magazine'', N''library.magazine-issue'', N''editorial.news'', N''editorial.article'', N''editorial.press-release'', N''editorial.page'', N''editorial.collection'', N''people.person'', N''global.country'', N''fatwa.ruling'', N''quran.translation'')
    AND LEN([title]) BETWEEN 1 AND 240
    AND ISJSON([payload]) = 1
    AND LEN([payload]) <= 200000
    AND [payloadChecksum] COLLATE Latin1_General_BIN2 NOT LIKE N''%[^0-9a-f]%''
    AND [inputChecksum] COLLATE Latin1_General_BIN2 NOT LIKE N''%[^0-9a-f]%''
    AND [validation] IN (N''valid'', N''invalid'')
    AND ([issues] IS NULL OR ISJSON([issues]) = 1)
    AND [personalData] IN (N''none'', N''flagged'', N''cleared'')
    AND (CASE WHEN [personalData] = N''cleared'' THEN 1 ELSE 0 END) = (CASE WHEN [clearanceOfStagedRecordId] IS NOT NULL THEN 1 ELSE 0 END)
    AND ([clearanceOfStagedRecordId] IS NULL OR [clearanceOfStagedRecordId] <> [id])
    AND [review] IN (N''pending'', N''approved'', N''rejected'', N''superseded'')
    AND ([review] <> N''approved'' OR ([validation] = N''valid'' AND [personalData] IN (N''none'', N''cleared'')))
    AND ([review] NOT IN (N''approved'', N''rejected'') OR ([reviewedByUserId] IS NOT NULL AND [reviewedAt] IS NOT NULL))
    AND [version] >= 1
);');
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261110140000_r2_migration_payload_ceiling';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
