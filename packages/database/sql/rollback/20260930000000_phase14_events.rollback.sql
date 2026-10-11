-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Phase 14 widened no search vocabulary and added no permission. The two editorial descriptions return to their Phase-13 wording, then every Event object goes; no Centre, Gallery or other owner's row is touched.
BEGIN TRY
BEGIN TRAN;
UPDATE [dbo].[Permission] SET [description] = N'Read private Article, Page, news, press release, statement and media coverage drafts and revisions.' WHERE [key] = N'content.read';
UPDATE [dbo].[Permission] SET [description] = N'Create and revise Article, Page, news, press release, statement and media coverage drafts and submit them for review.' WHERE [key] = N'content.author';
ALTER TABLE [dbo].[Event] DROP CONSTRAINT [Event_id_currentRevision_fkey];
ALTER TABLE [dbo].[Event] DROP CONSTRAINT [Event_id_approvedRevision_fkey];
ALTER TABLE [dbo].[Event] DROP CONSTRAINT [Event_id_scheduledRevision_fkey];
DROP TABLE [dbo].[EventGallery];
DROP TABLE [dbo].[EventSchedule];
DROP TABLE [dbo].[EventContributor];
DROP TABLE [dbo].[EventTopic];
DROP TABLE [dbo].[EventRevisionTranslation];
DROP TABLE [dbo].[EventRevision];
DROP TABLE [dbo].[EventSlugHistory];
DROP TABLE [dbo].[Event];
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20260930000000_phase14_events';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
