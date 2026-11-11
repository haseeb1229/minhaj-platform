-- Disposable migration rehearsal only. Populated deployments require roll-forward or restored backup.
--
-- Quran Part 8 added the Quran passages a Work and a Video explain: two
-- tables, their CHECKs, keys and indexes. This removes them; Work and Video
-- stay exactly as they were.
BEGIN TRY
BEGIN TRAN;
DROP TABLE [dbo].[VideoQuranPassage];
DROP TABLE [dbo].[WorkQuranPassage];
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261110150000_r2_quran_passages';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
