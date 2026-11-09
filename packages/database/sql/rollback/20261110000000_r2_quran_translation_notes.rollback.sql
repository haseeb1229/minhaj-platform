-- Disposable migration rehearsal only. Populated deployments require roll-forward or restored backup.
--
-- Quran Part 6 added the translator's-notes table, its two CHECKs, its key to
-- the translation text and its shape trigger. This removes them; every
-- translation, text and contributor stays as it was.
BEGIN TRY
BEGIN TRAN;
DROP TRIGGER [dbo].[QuranTranslationNoteShape];
DROP TABLE [dbo].[QuranTranslationNote];
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261110000000_r2_quran_translation_notes';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
