-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Phase 18 widened Search's vocabulary by `quran-ayah`: its derived rows go first and the three CHECKs return to their Phase-13 lists, then the three Quran keys and every Quran object.
BEGIN TRY
BEGIN TRAN;
DELETE t FROM [dbo].[SearchDocumentTopic] t JOIN [dbo].[SearchDocument] d ON d.[id]=t.[documentId] WHERE d.[kind]=N'quran-ayah';
DELETE FROM [dbo].[SearchDocument] WHERE [kind]=N'quran-ayah';
DELETE FROM [dbo].[SearchIndexRequest] WHERE [scopeKind]=N'quran-ayah';
DELETE FROM [dbo].[SearchIndexScope] WHERE [scopeKind]=N'quran-ayah';
ALTER TABLE [dbo].[SearchIndexRequest] DROP CONSTRAINT [SearchIndexRequest_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexRequest] ADD CONSTRAINT [SearchIndexRequest_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage'));
ALTER TABLE [dbo].[SearchIndexScope] DROP CONSTRAINT [SearchIndexScope_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage'));
ALTER TABLE [dbo].[SearchDocument] DROP CONSTRAINT [SearchDocument_kind_ck];
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_kind_ck] CHECK ([kind] IN (N'topic',N'person',N'article',N'page',N'work',N'edition',N'book-translation',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage'));
DELETE FROM [dbo].[StepUpGrant] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'quran.read',N'quran.administer',N'quran.editCanonical') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[StepUpGrant] WHERE [purpose]=N'quran-canonical-edit';
DELETE FROM [dbo].[Session] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'quran.read',N'quran.administer',N'quran.editCanonical') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[RolePermission] WHERE [permissionKey] IN (N'quran.read',N'quran.administer',N'quran.editCanonical');
DELETE FROM [dbo].[Permission] WHERE [key] IN (N'quran.read',N'quran.administer',N'quran.editCanonical');
DROP PROCEDURE IF EXISTS [dbo].[QuranRecordVerificationFailure];
DROP PROCEDURE IF EXISTS [dbo].[QuranCorrectAyah];
DROP PROCEDURE IF EXISTS [dbo].[QuranAcceptCorpus];
DROP PROCEDURE IF EXISTS [dbo].[QuranAssertCanonicalAuthority];
DROP TABLE IF EXISTS [dbo].[QuranTopic];
DROP TABLE IF EXISTS [dbo].[QuranTajweedRuleText];
DROP TABLE IF EXISTS [dbo].[QuranTajweedRule];
DROP TABLE IF EXISTS [dbo].[QuranRecitationSegment];
DROP TABLE IF EXISTS [dbo].[QuranRecitation];
DROP TABLE IF EXISTS [dbo].[QuranTafsirText];
DROP TABLE IF EXISTS [dbo].[QuranTafsirContributor];
DROP TABLE IF EXISTS [dbo].[QuranTafsir];
DROP TABLE IF EXISTS [dbo].[QuranTransliterationText];
DROP TABLE IF EXISTS [dbo].[QuranTransliteration];
DROP TABLE IF EXISTS [dbo].[QuranTranslationText];
DROP TABLE IF EXISTS [dbo].[QuranTranslationContributor];
DROP TABLE IF EXISTS [dbo].[QuranTranslation];
DROP TABLE IF EXISTS [dbo].[SurahName];
DROP TABLE IF EXISTS [dbo].[QuranAyahRevision];
DROP TABLE IF EXISTS [dbo].[QuranVerificationRun];
DROP TABLE IF EXISTS [dbo].[QuranActivation];
DROP TABLE IF EXISTS [dbo].[Ayah];
DROP TABLE IF EXISTS [dbo].[Surah];
DROP TABLE IF EXISTS [dbo].[Juz];
DROP TABLE IF EXISTS [dbo].[QuranSourceAyah];
DROP TABLE IF EXISTS [dbo].[QuranSourceSurah];
DROP TABLE IF EXISTS [dbo].[QuranSource];
DELETE FROM [dbo].[AuditLog] WHERE [action]=N'quran.permissions.provisioned' AND [authorisingSource]=N'20261002000000_phase18_quran';
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261002000000_phase18_quran';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
