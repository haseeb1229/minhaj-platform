-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Phase 19 widened Search's vocabulary by `hadith`: its derived rows go first and the three CHECKs return to their Phase-18 lists, then the three Hadith keys and every Hadith object.
BEGIN TRY
BEGIN TRAN;
DELETE t FROM [dbo].[SearchDocumentTopic] t JOIN [dbo].[SearchDocument] d ON d.[id]=t.[documentId] WHERE d.[kind]=N'hadith';
DELETE FROM [dbo].[SearchDocument] WHERE [kind]=N'hadith';
DELETE FROM [dbo].[SearchIndexRequest] WHERE [scopeKind]=N'hadith';
DELETE FROM [dbo].[SearchIndexScope] WHERE [scopeKind]=N'hadith';
ALTER TABLE [dbo].[SearchIndexRequest] DROP CONSTRAINT [SearchIndexRequest_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexRequest] ADD CONSTRAINT [SearchIndexRequest_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah'));
ALTER TABLE [dbo].[SearchIndexScope] DROP CONSTRAINT [SearchIndexScope_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah'));
ALTER TABLE [dbo].[SearchDocument] DROP CONSTRAINT [SearchDocument_kind_ck];
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_kind_ck] CHECK ([kind] IN (N'topic',N'person',N'article',N'page',N'work',N'edition',N'book-translation',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah'));
DELETE FROM [dbo].[StepUpGrant] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'hadith.read',N'hadith.administer',N'hadith.editCanonical') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[StepUpGrant] WHERE [purpose]=N'hadith-canonical-edit';
DELETE FROM [dbo].[Session] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'hadith.read',N'hadith.administer',N'hadith.editCanonical') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[RolePermission] WHERE [permissionKey] IN (N'hadith.read',N'hadith.administer',N'hadith.editCanonical');
DELETE FROM [dbo].[Permission] WHERE [key] IN (N'hadith.read',N'hadith.administer',N'hadith.editCanonical');
DROP PROCEDURE IF EXISTS [dbo].[HadithSetCitation];
DROP PROCEDURE IF EXISTS [dbo].[HadithVerifyRecord];
DROP PROCEDURE IF EXISTS [dbo].[HadithWriteRecord];
DROP PROCEDURE IF EXISTS [dbo].[HadithCreateChapter];
DROP PROCEDURE IF EXISTS [dbo].[HadithCreateBook];
DROP PROCEDURE IF EXISTS [dbo].[HadithCreateCollection];
DROP PROCEDURE IF EXISTS [dbo].[HadithDetectConflicts];
DROP PROCEDURE IF EXISTS [dbo].[HadithAssertCanonicalAuthority];
DROP TABLE IF EXISTS [dbo].[HadithTopic];
DROP TABLE IF EXISTS [dbo].[HadithScienceText];
DROP TABLE IF EXISTS [dbo].[HadithScience];
DROP TABLE IF EXISTS [dbo].[HadithCommentaryEntry];
DROP TABLE IF EXISTS [dbo].[HadithCommentaryContributor];
DROP TABLE IF EXISTS [dbo].[HadithCommentary];
DROP TABLE IF EXISTS [dbo].[HadithTranslationContributor];
DROP TABLE IF EXISTS [dbo].[HadithTranslation];
DROP TABLE IF EXISTS [dbo].[HadithChapterName];
DROP TABLE IF EXISTS [dbo].[HadithBookName];
DROP TABLE IF EXISTS [dbo].[HadithCollectionName];
DROP TABLE IF EXISTS [dbo].[HadithConflict];
DROP TABLE IF EXISTS [dbo].[HadithCitationRevision];
DROP TABLE IF EXISTS [dbo].[HadithCitation];
DROP TABLE IF EXISTS [dbo].[HadithVerification];
DROP TABLE IF EXISTS [dbo].[HadithGrading];
DROP TABLE IF EXISTS [dbo].[HadithRevision];
DROP TABLE IF EXISTS [dbo].[Hadith];
DROP TABLE IF EXISTS [dbo].[HadithChapter];
DROP TABLE IF EXISTS [dbo].[HadithBook];
DROP TABLE IF EXISTS [dbo].[HadithActivation];
DROP TABLE IF EXISTS [dbo].[HadithEdition];
DROP TABLE IF EXISTS [dbo].[HadithCollection];
DROP TABLE IF EXISTS [dbo].[HadithSourceSystem];
DELETE FROM [dbo].[AuditLog] WHERE [action]=N'hadith.permissions.provisioned' AND [authorisingSource]=N'20261003000000_phase19_hadith';
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261003000000_phase19_hadith';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
