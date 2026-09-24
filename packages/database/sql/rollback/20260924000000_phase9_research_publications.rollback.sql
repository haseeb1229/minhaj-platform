-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- The Phase-9 search rows go first, so the Phase-17 vocabularies can be restored exactly.
BEGIN TRY
BEGIN TRAN;
DELETE FROM [dbo].[SearchDocument] WHERE [scopeKind] IN (N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia');
DELETE FROM [dbo].[SearchIndexScope] WHERE [scopeKind] IN (N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia');
DELETE FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] IN (N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia');
ALTER TABLE [dbo].[SearchIndexRequest] DROP CONSTRAINT [SearchIndexRequest_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexRequest] ADD CONSTRAINT [SearchIndexRequest_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work'));
ALTER TABLE [dbo].[SearchIndexScope] DROP CONSTRAINT [SearchIndexScope_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work'));
ALTER TABLE [dbo].[SearchDocument] DROP CONSTRAINT [SearchDocument_kind_ck];
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_kind_ck] CHECK ([kind] IN (N'topic',N'person',N'article',N'page',N'work',N'edition',N'book-translation'));
DROP TRIGGER IF EXISTS [dbo].[LibraryReserveResearchSlug];
DROP TRIGGER IF EXISTS [dbo].[LibraryReserveResearchPaperSlug];
DROP TRIGGER IF EXISTS [dbo].[LibraryReservePublicationSlug];
DROP TRIGGER IF EXISTS [dbo].[LibraryReserveMagazineSlug];
DROP TRIGGER IF EXISTS [dbo].[LibraryReserveMagazineIssueSlug];
DROP TRIGGER IF EXISTS [dbo].[LibraryReserveEncyclopediaSlug];
DROP TABLE IF EXISTS [dbo].[ResearchCitation];
DROP TABLE IF EXISTS [dbo].[ResearchPaperCitation];
DROP TABLE IF EXISTS [dbo].[ResearchLabel];
DROP TABLE IF EXISTS [dbo].[ResearchContributor];
DROP TABLE IF EXISTS [dbo].[ResearchTopic];
DROP TABLE IF EXISTS [dbo].[ResearchSlugHistory];
DROP TABLE IF EXISTS [dbo].[ResearchPaperLabel];
DROP TABLE IF EXISTS [dbo].[ResearchPaperContributor];
DROP TABLE IF EXISTS [dbo].[ResearchPaperTopic];
DROP TABLE IF EXISTS [dbo].[ResearchPaperSlugHistory];
DROP TABLE IF EXISTS [dbo].[PublicationLabel];
DROP TABLE IF EXISTS [dbo].[PublicationContributor];
DROP TABLE IF EXISTS [dbo].[PublicationTopic];
DROP TABLE IF EXISTS [dbo].[PublicationSlugHistory];
DROP TABLE IF EXISTS [dbo].[MagazineLabel];
DROP TABLE IF EXISTS [dbo].[MagazineContributor];
DROP TABLE IF EXISTS [dbo].[MagazineTopic];
DROP TABLE IF EXISTS [dbo].[MagazineSlugHistory];
DROP TABLE IF EXISTS [dbo].[MagazineIssueLabel];
DROP TABLE IF EXISTS [dbo].[MagazineIssueContributor];
DROP TABLE IF EXISTS [dbo].[MagazineIssueTopic];
DROP TABLE IF EXISTS [dbo].[MagazineIssueSlugHistory];
DROP TABLE IF EXISTS [dbo].[EncyclopediaLabel];
DROP TABLE IF EXISTS [dbo].[EncyclopediaContributor];
DROP TABLE IF EXISTS [dbo].[EncyclopediaTopic];
DROP TABLE IF EXISTS [dbo].[EncyclopediaSlugHistory];
DROP TABLE IF EXISTS [dbo].[MagazineIssue];
DROP TABLE IF EXISTS [dbo].[Research];
DROP TABLE IF EXISTS [dbo].[ResearchPaper];
DROP TABLE IF EXISTS [dbo].[Publication];
DROP TABLE IF EXISTS [dbo].[Magazine];
DROP TABLE IF EXISTS [dbo].[Encyclopedia];
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20260924000000_phase9_research_publications';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
