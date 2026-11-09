-- Disposable migration rehearsal only. Populated deployments require roll-forward or restored backup.
--
-- Quran Part 2 added one nullable presentation column, the meaning beside a
-- Surah's display name, with its CHECK. This drops the CHECK and the column;
-- every name, its version and the Surah rows stay exactly as they were.
BEGIN TRY
BEGIN TRAN;
ALTER TABLE [dbo].[SurahName] DROP CONSTRAINT [SurahName_meaning_ck];
ALTER TABLE [dbo].[SurahName] DROP COLUMN [meaning];
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261109000000_r2_quran_surah_meaning';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
