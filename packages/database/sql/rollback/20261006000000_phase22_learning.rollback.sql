-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Phase 22 added the two Learning keys to the protected bundle, the course and learning-path search kinds and every Learning object; the keys go first with the sessions they widened, then the derived search rows and vocabulary, then the tables children-first.
BEGIN TRY
BEGIN TRAN;
DELETE FROM [dbo].[StepUpGrant] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'learning.read',N'learning.administer') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[Session] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'learning.read',N'learning.administer') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[RolePermission] WHERE [permissionKey] IN (N'learning.read',N'learning.administer');
DELETE FROM [dbo].[Permission] WHERE [key] IN (N'learning.read',N'learning.administer');
DELETE FROM [dbo].[SearchDocumentTopic] WHERE [documentId] IN (SELECT [id] FROM [dbo].[SearchDocument] WHERE [kind] IN (N'course',N'learning-path'));
DELETE FROM [dbo].[SearchDocument] WHERE [kind] IN (N'course',N'learning-path');
DELETE FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] IN (N'course',N'learning-path');
DELETE FROM [dbo].[SearchIndexScope] WHERE [scopeKind] IN (N'course',N'learning-path');
ALTER TABLE [dbo].[SearchIndexRequest] DROP CONSTRAINT [SearchIndexRequest_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexRequest] ADD CONSTRAINT [SearchIndexRequest_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah',N'hadith',N'fatwa'));
ALTER TABLE [dbo].[SearchIndexScope] DROP CONSTRAINT [SearchIndexScope_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah',N'hadith',N'fatwa'));
ALTER TABLE [dbo].[SearchDocument] DROP CONSTRAINT [SearchDocument_kind_ck];
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_kind_ck] CHECK ([kind] IN (N'topic',N'person',N'article',N'page',N'work',N'edition',N'book-translation',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah',N'hadith',N'fatwa'));
DROP TABLE IF EXISTS [dbo].[TrialClassRequest];
DROP TABLE IF EXISTS [dbo].[LessonProgress];
DROP TABLE IF EXISTS [dbo].[Enrolment];
DROP TABLE IF EXISTS [dbo].[LearningPathCourse];
DROP TABLE IF EXISTS [dbo].[LearningPathSlugHistory];
DROP TABLE IF EXISTS [dbo].[LearningPathLabel];
DROP TABLE IF EXISTS [dbo].[LearningPath];
DROP TABLE IF EXISTS [dbo].[LessonLabel];
DROP TABLE IF EXISTS [dbo].[Lesson];
DROP TABLE IF EXISTS [dbo].[CourseModuleLabel];
DROP TABLE IF EXISTS [dbo].[CourseModule];
DROP TABLE IF EXISTS [dbo].[CourseTeacher];
DROP TABLE IF EXISTS [dbo].[CourseTopic];
DROP TABLE IF EXISTS [dbo].[CourseSlugHistory];
DROP TABLE IF EXISTS [dbo].[CourseLabel];
DROP TABLE IF EXISTS [dbo].[Course];
DELETE FROM [dbo].[AuditLog] WHERE [action]=N'learning.permissions.provisioned' AND [authorisingSource]=N'20261006000000_phase22_learning';
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261006000000_phase22_learning';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
