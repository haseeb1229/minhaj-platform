-- Disposable migration rehearsal only. Populated deployments require roll-forward or restored backup.
--
-- Quran Part 7 added the word-by-word work, its contributors and its glosses,
-- their four CHECKs, six foreign keys and two triggers. This removes them;
-- every other Quran table stays as it was.
BEGIN TRY
BEGIN TRAN;
DROP TRIGGER [dbo].[QuranWordByWordGlossKept];
DROP TRIGGER [dbo].[QuranWordByWordPublishedGlosses];
DROP TABLE [dbo].[QuranWordByWordGloss];
DROP TABLE [dbo].[QuranWordByWordContributor];
DROP TABLE [dbo].[QuranWordByWord];
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261110120000_r2_quran_word_by_word';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
