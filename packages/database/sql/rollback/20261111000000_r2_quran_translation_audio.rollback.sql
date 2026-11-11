-- Disposable migration rehearsal only. Populated deployments require roll-forward or restored backup.
--
-- Quran translation audio added a narration segment's alignment and its
-- translation spans, their CHECK, four foreign keys and index, and four
-- triggers (two of them on the existing timing and segment tables). This
-- removes them; every recitation, segment and timing row stays as it was.
BEGIN TRY
BEGIN TRAN;
DROP TRIGGER [dbo].[QuranRecitationSegmentAlignedAudio];
DROP TRIGGER [dbo].[QuranRecitationTimingAligned];
DROP TRIGGER [dbo].[QuranRecitationTranslationSpanShape];
DROP TRIGGER [dbo].[QuranRecitationAlignmentRules];
DROP TABLE [dbo].[QuranRecitationTranslationSpan];
DROP TABLE [dbo].[QuranRecitationAlignment];
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261111000000_r2_quran_translation_audio';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
