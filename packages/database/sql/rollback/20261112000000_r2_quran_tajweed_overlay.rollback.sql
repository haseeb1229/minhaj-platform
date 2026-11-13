-- Disposable migration rehearsal only. Populated deployments require roll-forward or restored backup.
--
-- Quran Part 9 added the tajweed overlay, its recorded ayat and its spans,
-- their four CHECKs, four foreign keys, three indexes and three triggers. This
-- removes them; the canonical Ayah and every other layered work stay as they were.
BEGIN TRY
BEGIN TRAN;
DROP TRIGGER [dbo].[QuranTajweedSpanRules];
DROP TRIGGER [dbo].[QuranTajweedOverlayAyahRules];
DROP TRIGGER [dbo].[QuranTajweedOverlayPublishedAyat];
DROP TABLE [dbo].[QuranTajweedSpan];
DROP TABLE [dbo].[QuranTajweedOverlayAyah];
DROP TABLE [dbo].[QuranTajweedOverlay];
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261112000000_r2_quran_tajweed_overlay';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
