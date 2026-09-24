-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Phase 12 widened no search vocabulary, so only its own objects and the two Media descriptions change back.
BEGIN TRY
BEGIN TRAN;
UPDATE [dbo].[Permission] SET [description] = N'View Videos, Series, Playlists, audio tracks and audio series, including drafts.' WHERE [key] = N'media.read';
UPDATE [dbo].[Permission] SET [description] = N'Create, edit, publish and archive Videos, Series, Playlists, audio tracks and audio series, order Playlists, and upload audio files.' WHERE [key] = N'media.administer';
DROP TRIGGER IF EXISTS [dbo].[MediaReserveGallerySlug];
DROP TABLE IF EXISTS [dbo].[GalleryItem];
DROP TABLE IF EXISTS [dbo].[GalleryLabel];
DROP TABLE IF EXISTS [dbo].[GallerySlugHistory];
DROP TABLE IF EXISTS [dbo].[Gallery];
DROP TABLE IF EXISTS [dbo].[PhotoLabel];
DROP TABLE IF EXISTS [dbo].[Photo];
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20260927000000_phase12_media_galleries';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
