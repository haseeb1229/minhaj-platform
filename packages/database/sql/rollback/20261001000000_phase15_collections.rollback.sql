-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Phase 15 widened no search vocabulary and added no permission. The two editorial descriptions return to their Phase-14 wording, then every Collection object goes; no Article, News, Work, Video or other owner's row is touched.
BEGIN TRY
BEGIN TRAN;
UPDATE [dbo].[Permission] SET [description] = N'Read private Article, Page, news, press release, statement, media coverage and event drafts and revisions.' WHERE [key] = N'content.read';
UPDATE [dbo].[Permission] SET [description] = N'Create and revise Article, Page, news, press release, statement, media coverage and event drafts and submit them for review.' WHERE [key] = N'content.author';
ALTER TABLE [dbo].[Collection] DROP CONSTRAINT [Collection_id_currentRevision_fkey];
ALTER TABLE [dbo].[Collection] DROP CONSTRAINT [Collection_id_approvedRevision_fkey];
ALTER TABLE [dbo].[Collection] DROP CONSTRAINT [Collection_id_scheduledRevision_fkey];
DROP TABLE [dbo].[CollectionItem];
DROP TABLE [dbo].[CollectionContributor];
DROP TABLE [dbo].[CollectionTopic];
DROP TABLE [dbo].[CollectionRevisionTranslation];
DROP TABLE [dbo].[CollectionRevision];
DROP TABLE [dbo].[CollectionSlugHistory];
DROP TABLE [dbo].[Collection];
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261001000000_phase15_collections';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
