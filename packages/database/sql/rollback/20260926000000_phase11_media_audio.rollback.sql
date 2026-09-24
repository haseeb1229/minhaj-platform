-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- The Phase-11 search rows go first, so the Phase-10 vocabularies can be restored exactly.
BEGIN TRY
BEGIN TRAN;
DELETE FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'audio';
DELETE FROM [dbo].[SearchIndexScope] WHERE [scopeKind] = N'audio';
DELETE FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'audio';
ALTER TABLE [dbo].[SearchIndexRequest] DROP CONSTRAINT [SearchIndexRequest_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexRequest] ADD CONSTRAINT [SearchIndexRequest_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video'));
ALTER TABLE [dbo].[SearchIndexScope] DROP CONSTRAINT [SearchIndexScope_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video'));
ALTER TABLE [dbo].[SearchDocument] DROP CONSTRAINT [SearchDocument_kind_ck];
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_kind_ck] CHECK ([kind] IN (N'topic',N'person',N'article',N'page',N'work',N'edition',N'book-translation',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video'));
UPDATE [dbo].[Permission] SET [description] = N'View Videos, Series and Playlists, including drafts.' WHERE [key] = N'media.read';
UPDATE [dbo].[Permission] SET [description] = N'Create, edit, publish and archive Videos, Series and Playlists, and order Playlists.' WHERE [key] = N'media.administer';
DROP TRIGGER IF EXISTS [dbo].[MediaReserveAudioTrackSlug];
DROP TRIGGER IF EXISTS [dbo].[MediaReserveAudioSeriesSlug];
DROP TABLE IF EXISTS [dbo].[AudioTrackLabel];
DROP TABLE IF EXISTS [dbo].[AudioTrackSpeaker];
DROP TABLE IF EXISTS [dbo].[AudioTrackTopic];
DROP TABLE IF EXISTS [dbo].[AudioTrackSlugHistory];
DROP TABLE IF EXISTS [dbo].[AudioTrack];
DROP TABLE IF EXISTS [dbo].[AudioSeriesLabel];
DROP TABLE IF EXISTS [dbo].[AudioSeriesSlugHistory];
DROP TABLE IF EXISTS [dbo].[AudioSeries];
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20260926000000_phase11_media_audio';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
