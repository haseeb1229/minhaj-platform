-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- The Phase-10 search rows go first, so the Phase-9 vocabularies can be restored exactly.
BEGIN TRY
BEGIN TRAN;
DELETE FROM [dbo].[SearchDocument] WHERE [scopeKind] = N'video';
DELETE FROM [dbo].[SearchIndexScope] WHERE [scopeKind] = N'video';
DELETE FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'video';
ALTER TABLE [dbo].[SearchIndexRequest] DROP CONSTRAINT [SearchIndexRequest_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexRequest] ADD CONSTRAINT [SearchIndexRequest_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia'));
ALTER TABLE [dbo].[SearchIndexScope] DROP CONSTRAINT [SearchIndexScope_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia'));
ALTER TABLE [dbo].[SearchDocument] DROP CONSTRAINT [SearchDocument_kind_ck];
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_kind_ck] CHECK ([kind] IN (N'topic',N'person',N'article',N'page',N'work',N'edition',N'book-translation',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia'));
DELETE FROM [dbo].[StepUpGrant] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'media.read',N'media.administer') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[Session] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'media.read',N'media.administer') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[RolePermission] WHERE [permissionKey] IN (N'media.read',N'media.administer');
DELETE FROM [dbo].[Permission] WHERE [key] IN (N'media.read',N'media.administer');
DROP TRIGGER IF EXISTS [dbo].[MediaReserveVideoSlug];
DROP TRIGGER IF EXISTS [dbo].[MediaReserveSeriesSlug];
DROP TRIGGER IF EXISTS [dbo].[MediaReservePlaylistSlug];
DROP TABLE IF EXISTS [dbo].[PlaylistVideo];
DROP TABLE IF EXISTS [dbo].[PlaylistLabel];
DROP TABLE IF EXISTS [dbo].[PlaylistSlugHistory];
DROP TABLE IF EXISTS [dbo].[Playlist];
DROP TABLE IF EXISTS [dbo].[VideoLabel];
DROP TABLE IF EXISTS [dbo].[VideoSpeaker];
DROP TABLE IF EXISTS [dbo].[VideoTopic];
DROP TABLE IF EXISTS [dbo].[VideoSlugHistory];
DROP TABLE IF EXISTS [dbo].[Video];
DROP TABLE IF EXISTS [dbo].[SeriesLabel];
DROP TABLE IF EXISTS [dbo].[SeriesSlugHistory];
DROP TABLE IF EXISTS [dbo].[Series];
DELETE FROM [dbo].[AuditLog] WHERE [action]=N'media.permissions.provisioned' AND [authorisingSource]=N'20260925000000_phase10_media_video';
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20260925000000_phase10_media_video';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
