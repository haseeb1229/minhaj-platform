-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Phase 20 widened Search's vocabulary by `fatwa`: its derived rows go first and the three CHECKs return to their Phase-19 lists, then the three Fatwa keys (never bundled, so no protected-role row is touched), every grant of them, the purpose's step-up grants and every Fatwa object.
BEGIN TRY
BEGIN TRAN;
DELETE t FROM [dbo].[SearchDocumentTopic] t JOIN [dbo].[SearchDocument] d ON d.[id]=t.[documentId] WHERE d.[kind]=N'fatwa';
DELETE FROM [dbo].[SearchDocument] WHERE [kind]=N'fatwa';
DELETE FROM [dbo].[SearchIndexRequest] WHERE [scopeKind]=N'fatwa';
DELETE FROM [dbo].[SearchIndexScope] WHERE [scopeKind]=N'fatwa';
ALTER TABLE [dbo].[SearchIndexRequest] DROP CONSTRAINT [SearchIndexRequest_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexRequest] ADD CONSTRAINT [SearchIndexRequest_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah',N'hadith'));
ALTER TABLE [dbo].[SearchIndexScope] DROP CONSTRAINT [SearchIndexScope_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah',N'hadith'));
ALTER TABLE [dbo].[SearchDocument] DROP CONSTRAINT [SearchDocument_kind_ck];
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_kind_ck] CHECK ([kind] IN (N'topic',N'person',N'article',N'page',N'work',N'edition',N'book-translation',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah',N'hadith'));
DELETE FROM [dbo].[StepUpGrant] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'question.receive',N'fatwa.answer',N'fatwa.publish') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[StepUpGrant] WHERE [purpose]=N'fatwa-publication';
DELETE FROM [dbo].[Session] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'question.receive',N'fatwa.answer',N'fatwa.publish') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[RolePermission] WHERE [permissionKey] IN (N'question.receive',N'fatwa.answer',N'fatwa.publish');
DELETE FROM [dbo].[Permission] WHERE [key] IN (N'question.receive',N'fatwa.answer',N'fatwa.publish');
DROP PROCEDURE IF EXISTS [dbo].[FatwaRecordRead];
DROP PROCEDURE IF EXISTS [dbo].[FatwaDisposeQuestions];
DROP PROCEDURE IF EXISTS [dbo].[FatwaWithdraw];
DROP PROCEDURE IF EXISTS [dbo].[FatwaPublishRevision];
DROP PROCEDURE IF EXISTS [dbo].[FatwaReturnForRevision];
DROP PROCEDURE IF EXISTS [dbo].[FatwaSubmitForReview];
DROP PROCEDURE IF EXISTS [dbo].[FatwaSaveDraft];
DROP PROCEDURE IF EXISTS [dbo].[FatwaDeclineQuestion];
DROP PROCEDURE IF EXISTS [dbo].[FatwaAssignQuestion];
DROP PROCEDURE IF EXISTS [dbo].[FatwaTriageQuestion];
DROP PROCEDURE IF EXISTS [dbo].[FatwaSubmitQuestion];
DROP PROCEDURE IF EXISTS [dbo].[FatwaAssertPublicationAuthority];
DROP PROCEDURE IF EXISTS [dbo].[FatwaAssertPermission];
-- The ruling and its revisions reference each other; the ruling's pointers go first.
IF OBJECT_ID(N'[dbo].[Fatwa]',N'U') IS NOT NULL ALTER TABLE [dbo].[Fatwa] DROP CONSTRAINT [Fatwa_pendingRevision_fkey], [Fatwa_publishedRevision_fkey];
DROP TABLE IF EXISTS [dbo].[FatwaReadTally];
DROP TABLE IF EXISTS [dbo].[FatwaReviewDecision];
DROP TABLE IF EXISTS [dbo].[FatwaPublication];
DROP TABLE IF EXISTS [dbo].[FatwaRevisionTopic];
DROP TABLE IF EXISTS [dbo].[FatwaRevision];
DROP TABLE IF EXISTS [dbo].[Fatwa];
DROP TABLE IF EXISTS [dbo].[FatwaQuestion];
DROP TABLE IF EXISTS [dbo].[FatwaCategoryName];
DROP TABLE IF EXISTS [dbo].[FatwaCategory];
DROP TABLE IF EXISTS [dbo].[FatwaActivation];
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261004000000_phase20_fatwa';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
