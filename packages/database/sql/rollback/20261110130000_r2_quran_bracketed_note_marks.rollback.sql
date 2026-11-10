-- Disposable migration rehearsal only. Populated deployments require roll-forward or restored backup.
--
-- The external reference translations' migration widened one CHECK: a
-- translator's note may also open with a bracketed number "[n]". This restores
-- Quran Part 6's CHECK exactly; while any note opens with a bracketed number
-- the restored CHECK fails and nothing changes.
BEGIN TRY
BEGIN TRAN;
ALTER TABLE [dbo].[QuranTranslationNote] DROP CONSTRAINT [QuranTranslationNote_marker_ck];
ALTER TABLE [dbo].[QuranTranslationNote] ADD CONSTRAINT [QuranTranslationNote_marker_ck]
    CHECK (DATALENGTH([marker]) = 0
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[٭*]'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[٭*]:'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[٭*][٭*]'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[٭*][٭*]:'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[٭*][٭*][٭*]'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[٭*][٭*][٭*]:'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[٭*][٭*][٭*][٭*]'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[٭*][٭*][٭*][٭*]:'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[1-9]:-'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[1-9][0-9]:-');
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261110130000_r2_quran_bracketed_note_marks';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
