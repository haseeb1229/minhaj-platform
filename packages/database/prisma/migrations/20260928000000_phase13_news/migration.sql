-- ===========================================================================
-- Phase 13 — Editorial: NewsArticle, PressRelease, Statement, MediaCoverage
-- ===========================================================================
--
-- FOUR EDITORIAL AGGREGATES (DOMAIN_MODEL.md 7.1), each with its own record,
-- immutable revisions, localized revision translations, typed Topic and Person
-- references and a permanent slug namespace — the Phase-6 Article shape, four
-- times, never one content table with a type column. They share the Phase-6
-- workflow: the same lifecycle, the same approval of the exact current
-- revision by someone other than its creator or editor, and the same schedule
-- bound to that revision, enforced here by the same constraints and triggers.
--
-- WHAT DIFFERS IS WHAT IS GENUINELY DIFFERENT. A Statement's translation names
-- its issuing authority; a MediaCoverage revision names the outlet and, only
-- where known, an HTTPS address and a date for the coverage it describes.
--
-- NOTHING ELSE. No image, Asset, Photo or Gallery column; no Event, Centre or
-- Collection reference; no newsletter; no view count, popularity or featured
-- flag. News depends on Editorial and Search only.
--
-- ITS OWN REFUSAL NUMBERS. The triggers enforce the Phase-6 invariants and
-- refuse with 51130-51135, this migration's own block, in the same order as
-- Phase 6's 51060-51065: immutable history, no extension of a historical
-- revision, a valid current revision without self-approval, a reserved
-- canonical slug, revision sequence, and no rewind.
--
-- APPEND-ONLY. Nothing below edits an accepted migration. The Phase-17 search
-- vocabularies are WIDENED by exactly the four News kinds, each its own scope,
-- and the two editorial keys whose descriptions named only Article and Page are
-- re-described; no permission is added.

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[NewsArticle] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL,
    [currentRevision] INT,
    [approvedRevision] INT,
    [approvedById] NVARCHAR(36),
    [creatorId] NVARCHAR(36) NOT NULL,
    [scheduledRevision] INT,
    [scheduledAt] DATETIME2,
    [scheduledTimezone] NVARCHAR(64),
    [scheduledById] NVARCHAR(36),
    [scheduleStatus] NVARCHAR(32),
    [publishedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [NewsArticle_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [NewsArticle_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [NewsArticle_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[NewsArticleRevision] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [number] INT NOT NULL,
    [editorId] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLanguage] NVARCHAR(16) NOT NULL,
    [schemaVersion] INT NOT NULL CONSTRAINT [NewsArticleRevision_schemaVersion_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [NewsArticleRevision_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [NewsArticleRevision_pkey] PRIMARY KEY CLUSTERED ([ownerId],[number])
);

-- CreateTable
CREATE TABLE [dbo].[NewsArticleRevisionTranslation] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [excerpt] NVARCHAR(600) NOT NULL,
    [seoTitle] NVARCHAR(200) NOT NULL,
    [seoDescription] NVARCHAR(300) NOT NULL,
    [document] NVARCHAR(max) NOT NULL,
    [html] NVARCHAR(max) NOT NULL,
    CONSTRAINT [NewsArticleRevisionTranslation_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[languageCode])
);

-- CreateTable
CREATE TABLE [dbo].[NewsArticleTopic] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [NewsArticleTopic_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[topicId])
);

-- CreateTable
CREATE TABLE [dbo].[NewsArticleContributor] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(32) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [NewsArticleContributor_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[personId],[role])
);

-- CreateTable
CREATE TABLE [dbo].[NewsArticleSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [ownerId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [NewsArticleSlugHistory_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [NewsArticleSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[PressRelease] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL,
    [currentRevision] INT,
    [approvedRevision] INT,
    [approvedById] NVARCHAR(36),
    [creatorId] NVARCHAR(36) NOT NULL,
    [scheduledRevision] INT,
    [scheduledAt] DATETIME2,
    [scheduledTimezone] NVARCHAR(64),
    [scheduledById] NVARCHAR(36),
    [scheduleStatus] NVARCHAR(32),
    [publishedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PressRelease_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PressRelease_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PressRelease_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[PressReleaseRevision] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [number] INT NOT NULL,
    [editorId] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLanguage] NVARCHAR(16) NOT NULL,
    [schemaVersion] INT NOT NULL CONSTRAINT [PressReleaseRevision_schemaVersion_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PressReleaseRevision_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PressReleaseRevision_pkey] PRIMARY KEY CLUSTERED ([ownerId],[number])
);

-- CreateTable
CREATE TABLE [dbo].[PressReleaseRevisionTranslation] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [excerpt] NVARCHAR(600) NOT NULL,
    [seoTitle] NVARCHAR(200) NOT NULL,
    [seoDescription] NVARCHAR(300) NOT NULL,
    [document] NVARCHAR(max) NOT NULL,
    [html] NVARCHAR(max) NOT NULL,
    CONSTRAINT [PressReleaseRevisionTranslation_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[languageCode])
);

-- CreateTable
CREATE TABLE [dbo].[PressReleaseTopic] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [PressReleaseTopic_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[topicId])
);

-- CreateTable
CREATE TABLE [dbo].[PressReleaseContributor] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(32) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [PressReleaseContributor_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[personId],[role])
);

-- CreateTable
CREATE TABLE [dbo].[PressReleaseSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [ownerId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PressReleaseSlugHistory_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PressReleaseSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[Statement] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL,
    [currentRevision] INT,
    [approvedRevision] INT,
    [approvedById] NVARCHAR(36),
    [creatorId] NVARCHAR(36) NOT NULL,
    [scheduledRevision] INT,
    [scheduledAt] DATETIME2,
    [scheduledTimezone] NVARCHAR(64),
    [scheduledById] NVARCHAR(36),
    [scheduleStatus] NVARCHAR(32),
    [publishedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Statement_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Statement_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Statement_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[StatementRevision] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [number] INT NOT NULL,
    [editorId] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLanguage] NVARCHAR(16) NOT NULL,
    [schemaVersion] INT NOT NULL CONSTRAINT [StatementRevision_schemaVersion_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [StatementRevision_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [StatementRevision_pkey] PRIMARY KEY CLUSTERED ([ownerId],[number])
);

-- CreateTable
CREATE TABLE [dbo].[StatementRevisionTranslation] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [excerpt] NVARCHAR(600) NOT NULL,
    [issuer] NVARCHAR(200) NOT NULL,
    [seoTitle] NVARCHAR(200) NOT NULL,
    [seoDescription] NVARCHAR(300) NOT NULL,
    [document] NVARCHAR(max) NOT NULL,
    [html] NVARCHAR(max) NOT NULL,
    CONSTRAINT [StatementRevisionTranslation_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[languageCode])
);

-- CreateTable
CREATE TABLE [dbo].[StatementTopic] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [StatementTopic_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[topicId])
);

-- CreateTable
CREATE TABLE [dbo].[StatementContributor] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(32) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [StatementContributor_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[personId],[role])
);

-- CreateTable
CREATE TABLE [dbo].[StatementSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [ownerId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [StatementSlugHistory_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [StatementSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[MediaCoverage] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL,
    [currentRevision] INT,
    [approvedRevision] INT,
    [approvedById] NVARCHAR(36),
    [creatorId] NVARCHAR(36) NOT NULL,
    [scheduledRevision] INT,
    [scheduledAt] DATETIME2,
    [scheduledTimezone] NVARCHAR(64),
    [scheduledById] NVARCHAR(36),
    [scheduleStatus] NVARCHAR(32),
    [publishedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MediaCoverage_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [MediaCoverage_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MediaCoverage_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[MediaCoverageRevision] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [number] INT NOT NULL,
    [editorId] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLanguage] NVARCHAR(16) NOT NULL,
    [outletName] NVARCHAR(200) NOT NULL,
    [sourceUrl] NVARCHAR(2048),
    [sourcePublishedOn] DATE,
    [schemaVersion] INT NOT NULL CONSTRAINT [MediaCoverageRevision_schemaVersion_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MediaCoverageRevision_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [MediaCoverageRevision_pkey] PRIMARY KEY CLUSTERED ([ownerId],[number])
);

-- CreateTable
CREATE TABLE [dbo].[MediaCoverageRevisionTranslation] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [excerpt] NVARCHAR(600) NOT NULL,
    [seoTitle] NVARCHAR(200) NOT NULL,
    [seoDescription] NVARCHAR(300) NOT NULL,
    [document] NVARCHAR(max) NOT NULL,
    [html] NVARCHAR(max) NOT NULL,
    CONSTRAINT [MediaCoverageRevisionTranslation_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[languageCode])
);

-- CreateTable
CREATE TABLE [dbo].[MediaCoverageTopic] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [MediaCoverageTopic_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[topicId])
);

-- CreateTable
CREATE TABLE [dbo].[MediaCoverageContributor] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(32) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [MediaCoverageContributor_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[personId],[role])
);

-- CreateTable
CREATE TABLE [dbo].[MediaCoverageSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [ownerId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MediaCoverageSlugHistory_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [MediaCoverageSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NewsArticle_state_updatedAt_id_idx] ON [dbo].[NewsArticle]([state], [updatedAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NewsArticle_state_publishedAt_id_idx] ON [dbo].[NewsArticle]([state], [publishedAt] DESC, [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NewsArticle_scheduleStatus_scheduledAt_id_idx] ON [dbo].[NewsArticle]([scheduleStatus], [scheduledAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NewsArticleTopic_topicId_ownerId_idx] ON [dbo].[NewsArticleTopic]([topicId], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NewsArticleContributor_personId_ownerId_idx] ON [dbo].[NewsArticleContributor]([personId], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NewsArticleSlugHistory_ownerId_idx] ON [dbo].[NewsArticleSlugHistory]([ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PressRelease_state_updatedAt_id_idx] ON [dbo].[PressRelease]([state], [updatedAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PressRelease_state_publishedAt_id_idx] ON [dbo].[PressRelease]([state], [publishedAt] DESC, [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PressRelease_scheduleStatus_scheduledAt_id_idx] ON [dbo].[PressRelease]([scheduleStatus], [scheduledAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PressReleaseTopic_topicId_ownerId_idx] ON [dbo].[PressReleaseTopic]([topicId], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PressReleaseContributor_personId_ownerId_idx] ON [dbo].[PressReleaseContributor]([personId], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PressReleaseSlugHistory_ownerId_idx] ON [dbo].[PressReleaseSlugHistory]([ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Statement_state_updatedAt_id_idx] ON [dbo].[Statement]([state], [updatedAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Statement_state_publishedAt_id_idx] ON [dbo].[Statement]([state], [publishedAt] DESC, [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Statement_scheduleStatus_scheduledAt_id_idx] ON [dbo].[Statement]([scheduleStatus], [scheduledAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StatementTopic_topicId_ownerId_idx] ON [dbo].[StatementTopic]([topicId], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StatementContributor_personId_ownerId_idx] ON [dbo].[StatementContributor]([personId], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StatementSlugHistory_ownerId_idx] ON [dbo].[StatementSlugHistory]([ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MediaCoverage_state_updatedAt_id_idx] ON [dbo].[MediaCoverage]([state], [updatedAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MediaCoverage_state_publishedAt_id_idx] ON [dbo].[MediaCoverage]([state], [publishedAt] DESC, [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MediaCoverage_scheduleStatus_scheduledAt_id_idx] ON [dbo].[MediaCoverage]([scheduleStatus], [scheduledAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MediaCoverageTopic_topicId_ownerId_idx] ON [dbo].[MediaCoverageTopic]([topicId], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MediaCoverageContributor_personId_ownerId_idx] ON [dbo].[MediaCoverageContributor]([personId], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MediaCoverageSlugHistory_ownerId_idx] ON [dbo].[MediaCoverageSlugHistory]([ownerId]);

-- AddForeignKey
ALTER TABLE [dbo].[NewsArticle] ADD CONSTRAINT [NewsArticle_creatorId_fkey] FOREIGN KEY ([creatorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NewsArticle] ADD CONSTRAINT [NewsArticle_approvedById_fkey] FOREIGN KEY ([approvedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NewsArticle] ADD CONSTRAINT [NewsArticle_scheduledById_fkey] FOREIGN KEY ([scheduledById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NewsArticle] ADD CONSTRAINT [NewsArticle_id_currentRevision_fkey] FOREIGN KEY ([id], [currentRevision]) REFERENCES [dbo].[NewsArticleRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NewsArticle] ADD CONSTRAINT [NewsArticle_id_approvedRevision_fkey] FOREIGN KEY ([id], [approvedRevision]) REFERENCES [dbo].[NewsArticleRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NewsArticle] ADD CONSTRAINT [NewsArticle_id_scheduledRevision_fkey] FOREIGN KEY ([id], [scheduledRevision]) REFERENCES [dbo].[NewsArticleRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NewsArticleRevision] ADD CONSTRAINT [NewsArticleRevision_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[NewsArticle]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NewsArticleRevision] ADD CONSTRAINT [NewsArticleRevision_editorId_fkey] FOREIGN KEY ([editorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NewsArticleRevisionTranslation] ADD CONSTRAINT [NewsArticleRevisionTranslation_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[NewsArticleRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NewsArticleRevisionTranslation] ADD CONSTRAINT [NewsArticleRevisionTranslation_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NewsArticleTopic] ADD CONSTRAINT [NewsArticleTopic_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[NewsArticleRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NewsArticleTopic] ADD CONSTRAINT [NewsArticleTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NewsArticleContributor] ADD CONSTRAINT [NewsArticleContributor_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[NewsArticleRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NewsArticleContributor] ADD CONSTRAINT [NewsArticleContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NewsArticleSlugHistory] ADD CONSTRAINT [NewsArticleSlugHistory_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[NewsArticle]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PressRelease] ADD CONSTRAINT [PressRelease_creatorId_fkey] FOREIGN KEY ([creatorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PressRelease] ADD CONSTRAINT [PressRelease_approvedById_fkey] FOREIGN KEY ([approvedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PressRelease] ADD CONSTRAINT [PressRelease_scheduledById_fkey] FOREIGN KEY ([scheduledById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PressRelease] ADD CONSTRAINT [PressRelease_id_currentRevision_fkey] FOREIGN KEY ([id], [currentRevision]) REFERENCES [dbo].[PressReleaseRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PressRelease] ADD CONSTRAINT [PressRelease_id_approvedRevision_fkey] FOREIGN KEY ([id], [approvedRevision]) REFERENCES [dbo].[PressReleaseRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PressRelease] ADD CONSTRAINT [PressRelease_id_scheduledRevision_fkey] FOREIGN KEY ([id], [scheduledRevision]) REFERENCES [dbo].[PressReleaseRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PressReleaseRevision] ADD CONSTRAINT [PressReleaseRevision_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[PressRelease]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PressReleaseRevision] ADD CONSTRAINT [PressReleaseRevision_editorId_fkey] FOREIGN KEY ([editorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PressReleaseRevisionTranslation] ADD CONSTRAINT [PressReleaseRevisionTranslation_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[PressReleaseRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PressReleaseRevisionTranslation] ADD CONSTRAINT [PressReleaseRevisionTranslation_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PressReleaseTopic] ADD CONSTRAINT [PressReleaseTopic_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[PressReleaseRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PressReleaseTopic] ADD CONSTRAINT [PressReleaseTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PressReleaseContributor] ADD CONSTRAINT [PressReleaseContributor_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[PressReleaseRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PressReleaseContributor] ADD CONSTRAINT [PressReleaseContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PressReleaseSlugHistory] ADD CONSTRAINT [PressReleaseSlugHistory_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[PressRelease]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Statement] ADD CONSTRAINT [Statement_creatorId_fkey] FOREIGN KEY ([creatorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Statement] ADD CONSTRAINT [Statement_approvedById_fkey] FOREIGN KEY ([approvedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Statement] ADD CONSTRAINT [Statement_scheduledById_fkey] FOREIGN KEY ([scheduledById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Statement] ADD CONSTRAINT [Statement_id_currentRevision_fkey] FOREIGN KEY ([id], [currentRevision]) REFERENCES [dbo].[StatementRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Statement] ADD CONSTRAINT [Statement_id_approvedRevision_fkey] FOREIGN KEY ([id], [approvedRevision]) REFERENCES [dbo].[StatementRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Statement] ADD CONSTRAINT [Statement_id_scheduledRevision_fkey] FOREIGN KEY ([id], [scheduledRevision]) REFERENCES [dbo].[StatementRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StatementRevision] ADD CONSTRAINT [StatementRevision_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[Statement]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StatementRevision] ADD CONSTRAINT [StatementRevision_editorId_fkey] FOREIGN KEY ([editorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StatementRevisionTranslation] ADD CONSTRAINT [StatementRevisionTranslation_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[StatementRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StatementRevisionTranslation] ADD CONSTRAINT [StatementRevisionTranslation_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StatementTopic] ADD CONSTRAINT [StatementTopic_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[StatementRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StatementTopic] ADD CONSTRAINT [StatementTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StatementContributor] ADD CONSTRAINT [StatementContributor_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[StatementRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StatementContributor] ADD CONSTRAINT [StatementContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StatementSlugHistory] ADD CONSTRAINT [StatementSlugHistory_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[Statement]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MediaCoverage] ADD CONSTRAINT [MediaCoverage_creatorId_fkey] FOREIGN KEY ([creatorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MediaCoverage] ADD CONSTRAINT [MediaCoverage_approvedById_fkey] FOREIGN KEY ([approvedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MediaCoverage] ADD CONSTRAINT [MediaCoverage_scheduledById_fkey] FOREIGN KEY ([scheduledById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MediaCoverage] ADD CONSTRAINT [MediaCoverage_id_currentRevision_fkey] FOREIGN KEY ([id], [currentRevision]) REFERENCES [dbo].[MediaCoverageRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MediaCoverage] ADD CONSTRAINT [MediaCoverage_id_approvedRevision_fkey] FOREIGN KEY ([id], [approvedRevision]) REFERENCES [dbo].[MediaCoverageRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MediaCoverage] ADD CONSTRAINT [MediaCoverage_id_scheduledRevision_fkey] FOREIGN KEY ([id], [scheduledRevision]) REFERENCES [dbo].[MediaCoverageRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MediaCoverageRevision] ADD CONSTRAINT [MediaCoverageRevision_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[MediaCoverage]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MediaCoverageRevision] ADD CONSTRAINT [MediaCoverageRevision_editorId_fkey] FOREIGN KEY ([editorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MediaCoverageRevisionTranslation] ADD CONSTRAINT [MediaCoverageRevisionTranslation_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[MediaCoverageRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MediaCoverageRevisionTranslation] ADD CONSTRAINT [MediaCoverageRevisionTranslation_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MediaCoverageTopic] ADD CONSTRAINT [MediaCoverageTopic_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[MediaCoverageRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MediaCoverageTopic] ADD CONSTRAINT [MediaCoverageTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MediaCoverageContributor] ADD CONSTRAINT [MediaCoverageContributor_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[MediaCoverageRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MediaCoverageContributor] ADD CONSTRAINT [MediaCoverageContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MediaCoverageSlugHistory] ADD CONSTRAINT [MediaCoverageSlugHistory_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[MediaCoverage]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- NewsArticle: the Article's workflow invariants, refused by the database
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[NewsArticle] ADD CONSTRAINT [NewsArticle_state_ck] CHECK ([state] IN ('draft','in-review','scheduled','published','archived'));
ALTER TABLE [dbo].[NewsArticle] ADD CONSTRAINT [NewsArticle_version_ck] CHECK ([version]>0 AND ([currentRevision] IS NULL OR [currentRevision]>0));
ALTER TABLE [dbo].[NewsArticle] ADD CONSTRAINT [NewsArticle_approval_ck] CHECK (([approvedRevision] IS NULL AND [approvedById] IS NULL) OR ([approvedRevision] IS NOT NULL AND [approvedById] IS NOT NULL AND [currentRevision] IS NOT NULL AND [approvedRevision]=[currentRevision] AND [approvedById]<>[creatorId]));
ALTER TABLE [dbo].[NewsArticle] ADD CONSTRAINT [NewsArticle_publication_ck] CHECK ([state] NOT IN ('scheduled','published') OR ([approvedRevision] IS NOT NULL AND [currentRevision] IS NOT NULL AND [approvedRevision]=[currentRevision]));
ALTER TABLE [dbo].[NewsArticle] ADD CONSTRAINT [NewsArticle_published_date_ck] CHECK ([state]<>'published' OR [publishedAt] IS NOT NULL);
ALTER TABLE [dbo].[NewsArticle] ADD CONSTRAINT [NewsArticle_schedule_ck] CHECK ([state]<>'scheduled' OR ([scheduledRevision] IS NOT NULL AND [scheduledRevision]=[currentRevision] AND [scheduledAt] IS NOT NULL AND [scheduledById] IS NOT NULL AND [scheduledTimezone] IS NOT NULL AND [scheduleStatus] IN ('pending','authority-revoked','execution-failed')));
ALTER TABLE [dbo].[NewsArticleRevision] ADD CONSTRAINT [NewsArticleRevision_schema_ck] CHECK ([schemaVersion]=1 AND [number]>0);
ALTER TABLE [dbo].[NewsArticleRevisionTranslation] ADD CONSTRAINT [NewsArticleTranslation_size_ck] CHECK (DATALENGTH([document])<=400000 AND DATALENGTH([html])<=800000 AND ISJSON([document])=1);
ALTER TABLE [dbo].[NewsArticleContributor] ADD CONSTRAINT [NewsArticleContributor_role_ck] CHECK ([role] IN (N'author',N'translator',N'editor',N'compiler',N'narrator',N'reciter',N'speaker'));
ALTER TABLE [dbo].[NewsArticleContributor] ADD CONSTRAINT [NewsArticleContributor_position_ck] CHECK ([position] BETWEEN 0 AND 11);
-- A NewsArticle can never claim a static sibling of `/news/{slug}`, whether as
-- its current slug or as a former one.
ALTER TABLE [dbo].[NewsArticle] ADD CONSTRAINT [NewsArticle_slug_ck] CHECK ([slug] NOT IN (N'archive',N'press-releases',N'statements',N'media-coverage'));
ALTER TABLE [dbo].[NewsArticleSlugHistory] ADD CONSTRAINT [NewsArticleSlugHistory_slug_ck] CHECK ([slug] NOT IN (N'archive',N'press-releases',N'statements',N'media-coverage'));
EXEC sp_executesql N'CREATE TRIGGER [dbo].[NewsArticleRevisionImmutable] ON [dbo].[NewsArticleRevision] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[NewsArticleRevisionTranslationImmutable] ON [dbo].[NewsArticleRevisionTranslation] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[NewsArticleTopicImmutable] ON [dbo].[NewsArticleTopic] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[NewsArticleContributorImmutable] ON [dbo].[NewsArticleContributor] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[NewsArticleSlugHistoryImmutable] ON [dbo].[NewsArticleSlugHistory] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[NewsArticleRevisionTranslationAppend] ON [dbo].[NewsArticleRevisionTranslation] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[NewsArticle] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51131, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[NewsArticleTopicAppend] ON [dbo].[NewsArticleTopic] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[NewsArticle] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51131, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[NewsArticleContributorAppend] ON [dbo].[NewsArticleContributor] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[NewsArticle] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51131, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[NewsArticleCurrentIntegrity] ON [dbo].[NewsArticle] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[NewsArticleRevision] r ON r.ownerId=i.id AND r.number=i.currentRevision WHERE r.slug<>i.slug OR NOT EXISTS (SELECT 1 FROM [dbo].[NewsArticleRevisionTranslation] t WHERE t.ownerId=r.ownerId AND t.revisionNumber=r.number AND t.languageCode=r.primaryLanguage) OR (i.approvedById IS NOT NULL AND i.approvedById=r.editorId)) THROW 51132, ''Invalid current revision or self approval.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE i.currentRevision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [dbo].[NewsArticleSlugHistory] h WHERE h.ownerId=i.id AND h.slug=i.slug )) THROW 51133, ''Canonical slug must be reserved.'', 1;
 END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[NewsArticleRevisionSequence] ON [dbo].[NewsArticleRevision] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[NewsArticle] a ON a.id=i.ownerId WHERE i.number<>COALESCE(a.currentRevision,0)+1) THROW 51134, ''Revision must follow the current snapshot.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[NewsArticleRevisionForward] ON [dbo].[NewsArticle] AFTER UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id WHERE (d.currentRevision IS NOT NULL AND (i.currentRevision IS NULL OR i.currentRevision<d.currentRevision))) THROW 51135, ''Revision history cannot be rewritten.'', 1; END;';

-- ---------------------------------------------------------------------------
-- PressRelease: the Article's workflow invariants, refused by the database
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[PressRelease] ADD CONSTRAINT [PressRelease_state_ck] CHECK ([state] IN ('draft','in-review','scheduled','published','archived'));
ALTER TABLE [dbo].[PressRelease] ADD CONSTRAINT [PressRelease_version_ck] CHECK ([version]>0 AND ([currentRevision] IS NULL OR [currentRevision]>0));
ALTER TABLE [dbo].[PressRelease] ADD CONSTRAINT [PressRelease_approval_ck] CHECK (([approvedRevision] IS NULL AND [approvedById] IS NULL) OR ([approvedRevision] IS NOT NULL AND [approvedById] IS NOT NULL AND [currentRevision] IS NOT NULL AND [approvedRevision]=[currentRevision] AND [approvedById]<>[creatorId]));
ALTER TABLE [dbo].[PressRelease] ADD CONSTRAINT [PressRelease_publication_ck] CHECK ([state] NOT IN ('scheduled','published') OR ([approvedRevision] IS NOT NULL AND [currentRevision] IS NOT NULL AND [approvedRevision]=[currentRevision]));
ALTER TABLE [dbo].[PressRelease] ADD CONSTRAINT [PressRelease_published_date_ck] CHECK ([state]<>'published' OR [publishedAt] IS NOT NULL);
ALTER TABLE [dbo].[PressRelease] ADD CONSTRAINT [PressRelease_schedule_ck] CHECK ([state]<>'scheduled' OR ([scheduledRevision] IS NOT NULL AND [scheduledRevision]=[currentRevision] AND [scheduledAt] IS NOT NULL AND [scheduledById] IS NOT NULL AND [scheduledTimezone] IS NOT NULL AND [scheduleStatus] IN ('pending','authority-revoked','execution-failed')));
ALTER TABLE [dbo].[PressReleaseRevision] ADD CONSTRAINT [PressReleaseRevision_schema_ck] CHECK ([schemaVersion]=1 AND [number]>0);
ALTER TABLE [dbo].[PressReleaseRevisionTranslation] ADD CONSTRAINT [PressReleaseTranslation_size_ck] CHECK (DATALENGTH([document])<=400000 AND DATALENGTH([html])<=800000 AND ISJSON([document])=1);
ALTER TABLE [dbo].[PressReleaseContributor] ADD CONSTRAINT [PressReleaseContributor_role_ck] CHECK ([role] IN (N'author',N'translator',N'editor',N'compiler',N'narrator',N'reciter',N'speaker'));
ALTER TABLE [dbo].[PressReleaseContributor] ADD CONSTRAINT [PressReleaseContributor_position_ck] CHECK ([position] BETWEEN 0 AND 11);
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PressReleaseRevisionImmutable] ON [dbo].[PressReleaseRevision] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PressReleaseRevisionTranslationImmutable] ON [dbo].[PressReleaseRevisionTranslation] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PressReleaseTopicImmutable] ON [dbo].[PressReleaseTopic] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PressReleaseContributorImmutable] ON [dbo].[PressReleaseContributor] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PressReleaseSlugHistoryImmutable] ON [dbo].[PressReleaseSlugHistory] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PressReleaseRevisionTranslationAppend] ON [dbo].[PressReleaseRevisionTranslation] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[PressRelease] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51131, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PressReleaseTopicAppend] ON [dbo].[PressReleaseTopic] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[PressRelease] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51131, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PressReleaseContributorAppend] ON [dbo].[PressReleaseContributor] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[PressRelease] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51131, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PressReleaseCurrentIntegrity] ON [dbo].[PressRelease] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[PressReleaseRevision] r ON r.ownerId=i.id AND r.number=i.currentRevision WHERE r.slug<>i.slug OR NOT EXISTS (SELECT 1 FROM [dbo].[PressReleaseRevisionTranslation] t WHERE t.ownerId=r.ownerId AND t.revisionNumber=r.number AND t.languageCode=r.primaryLanguage) OR (i.approvedById IS NOT NULL AND i.approvedById=r.editorId)) THROW 51132, ''Invalid current revision or self approval.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE i.currentRevision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [dbo].[PressReleaseSlugHistory] h WHERE h.ownerId=i.id AND h.slug=i.slug )) THROW 51133, ''Canonical slug must be reserved.'', 1;
 END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PressReleaseRevisionSequence] ON [dbo].[PressReleaseRevision] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[PressRelease] a ON a.id=i.ownerId WHERE i.number<>COALESCE(a.currentRevision,0)+1) THROW 51134, ''Revision must follow the current snapshot.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PressReleaseRevisionForward] ON [dbo].[PressRelease] AFTER UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id WHERE (d.currentRevision IS NOT NULL AND (i.currentRevision IS NULL OR i.currentRevision<d.currentRevision))) THROW 51135, ''Revision history cannot be rewritten.'', 1; END;';

-- ---------------------------------------------------------------------------
-- Statement: the Article's workflow invariants, refused by the database
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[Statement] ADD CONSTRAINT [Statement_state_ck] CHECK ([state] IN ('draft','in-review','scheduled','published','archived'));
ALTER TABLE [dbo].[Statement] ADD CONSTRAINT [Statement_version_ck] CHECK ([version]>0 AND ([currentRevision] IS NULL OR [currentRevision]>0));
ALTER TABLE [dbo].[Statement] ADD CONSTRAINT [Statement_approval_ck] CHECK (([approvedRevision] IS NULL AND [approvedById] IS NULL) OR ([approvedRevision] IS NOT NULL AND [approvedById] IS NOT NULL AND [currentRevision] IS NOT NULL AND [approvedRevision]=[currentRevision] AND [approvedById]<>[creatorId]));
ALTER TABLE [dbo].[Statement] ADD CONSTRAINT [Statement_publication_ck] CHECK ([state] NOT IN ('scheduled','published') OR ([approvedRevision] IS NOT NULL AND [currentRevision] IS NOT NULL AND [approvedRevision]=[currentRevision]));
ALTER TABLE [dbo].[Statement] ADD CONSTRAINT [Statement_published_date_ck] CHECK ([state]<>'published' OR [publishedAt] IS NOT NULL);
ALTER TABLE [dbo].[Statement] ADD CONSTRAINT [Statement_schedule_ck] CHECK ([state]<>'scheduled' OR ([scheduledRevision] IS NOT NULL AND [scheduledRevision]=[currentRevision] AND [scheduledAt] IS NOT NULL AND [scheduledById] IS NOT NULL AND [scheduledTimezone] IS NOT NULL AND [scheduleStatus] IN ('pending','authority-revoked','execution-failed')));
ALTER TABLE [dbo].[StatementRevision] ADD CONSTRAINT [StatementRevision_schema_ck] CHECK ([schemaVersion]=1 AND [number]>0);
ALTER TABLE [dbo].[StatementRevisionTranslation] ADD CONSTRAINT [StatementTranslation_size_ck] CHECK (DATALENGTH([document])<=400000 AND DATALENGTH([html])<=800000 AND ISJSON([document])=1);
ALTER TABLE [dbo].[StatementContributor] ADD CONSTRAINT [StatementContributor_role_ck] CHECK ([role] IN (N'author',N'translator',N'editor',N'compiler',N'narrator',N'reciter',N'speaker'));
ALTER TABLE [dbo].[StatementContributor] ADD CONSTRAINT [StatementContributor_position_ck] CHECK ([position] BETWEEN 0 AND 11);
-- Every translation of a Statement names the authority it is issued in the name of.
ALTER TABLE [dbo].[StatementRevisionTranslation] ADD CONSTRAINT [StatementRevisionTranslation_issuer_ck] CHECK (LEN([issuer])>0);
EXEC sp_executesql N'CREATE TRIGGER [dbo].[StatementRevisionImmutable] ON [dbo].[StatementRevision] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[StatementRevisionTranslationImmutable] ON [dbo].[StatementRevisionTranslation] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[StatementTopicImmutable] ON [dbo].[StatementTopic] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[StatementContributorImmutable] ON [dbo].[StatementContributor] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[StatementSlugHistoryImmutable] ON [dbo].[StatementSlugHistory] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[StatementRevisionTranslationAppend] ON [dbo].[StatementRevisionTranslation] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Statement] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51131, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[StatementTopicAppend] ON [dbo].[StatementTopic] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Statement] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51131, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[StatementContributorAppend] ON [dbo].[StatementContributor] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Statement] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51131, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[StatementCurrentIntegrity] ON [dbo].[Statement] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[StatementRevision] r ON r.ownerId=i.id AND r.number=i.currentRevision WHERE r.slug<>i.slug OR NOT EXISTS (SELECT 1 FROM [dbo].[StatementRevisionTranslation] t WHERE t.ownerId=r.ownerId AND t.revisionNumber=r.number AND t.languageCode=r.primaryLanguage) OR (i.approvedById IS NOT NULL AND i.approvedById=r.editorId)) THROW 51132, ''Invalid current revision or self approval.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE i.currentRevision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [dbo].[StatementSlugHistory] h WHERE h.ownerId=i.id AND h.slug=i.slug )) THROW 51133, ''Canonical slug must be reserved.'', 1;
 END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[StatementRevisionSequence] ON [dbo].[StatementRevision] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Statement] a ON a.id=i.ownerId WHERE i.number<>COALESCE(a.currentRevision,0)+1) THROW 51134, ''Revision must follow the current snapshot.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[StatementRevisionForward] ON [dbo].[Statement] AFTER UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id WHERE (d.currentRevision IS NOT NULL AND (i.currentRevision IS NULL OR i.currentRevision<d.currentRevision))) THROW 51135, ''Revision history cannot be rewritten.'', 1; END;';

-- ---------------------------------------------------------------------------
-- MediaCoverage: the Article's workflow invariants, refused by the database
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[MediaCoverage] ADD CONSTRAINT [MediaCoverage_state_ck] CHECK ([state] IN ('draft','in-review','scheduled','published','archived'));
ALTER TABLE [dbo].[MediaCoverage] ADD CONSTRAINT [MediaCoverage_version_ck] CHECK ([version]>0 AND ([currentRevision] IS NULL OR [currentRevision]>0));
ALTER TABLE [dbo].[MediaCoverage] ADD CONSTRAINT [MediaCoverage_approval_ck] CHECK (([approvedRevision] IS NULL AND [approvedById] IS NULL) OR ([approvedRevision] IS NOT NULL AND [approvedById] IS NOT NULL AND [currentRevision] IS NOT NULL AND [approvedRevision]=[currentRevision] AND [approvedById]<>[creatorId]));
ALTER TABLE [dbo].[MediaCoverage] ADD CONSTRAINT [MediaCoverage_publication_ck] CHECK ([state] NOT IN ('scheduled','published') OR ([approvedRevision] IS NOT NULL AND [currentRevision] IS NOT NULL AND [approvedRevision]=[currentRevision]));
ALTER TABLE [dbo].[MediaCoverage] ADD CONSTRAINT [MediaCoverage_published_date_ck] CHECK ([state]<>'published' OR [publishedAt] IS NOT NULL);
ALTER TABLE [dbo].[MediaCoverage] ADD CONSTRAINT [MediaCoverage_schedule_ck] CHECK ([state]<>'scheduled' OR ([scheduledRevision] IS NOT NULL AND [scheduledRevision]=[currentRevision] AND [scheduledAt] IS NOT NULL AND [scheduledById] IS NOT NULL AND [scheduledTimezone] IS NOT NULL AND [scheduleStatus] IN ('pending','authority-revoked','execution-failed')));
ALTER TABLE [dbo].[MediaCoverageRevision] ADD CONSTRAINT [MediaCoverageRevision_schema_ck] CHECK ([schemaVersion]=1 AND [number]>0);
ALTER TABLE [dbo].[MediaCoverageRevisionTranslation] ADD CONSTRAINT [MediaCoverageTranslation_size_ck] CHECK (DATALENGTH([document])<=400000 AND DATALENGTH([html])<=800000 AND ISJSON([document])=1);
ALTER TABLE [dbo].[MediaCoverageContributor] ADD CONSTRAINT [MediaCoverageContributor_role_ck] CHECK ([role] IN (N'author',N'translator',N'editor',N'compiler',N'narrator',N'reciter',N'speaker'));
ALTER TABLE [dbo].[MediaCoverageContributor] ADD CONSTRAINT [MediaCoverageContributor_position_ck] CHECK ([position] BETWEEN 0 AND 11);
-- The outlet is named; its address, where known, is HTTPS; its date, where
-- known, is a real calendar date. Nothing about the outlet is ever fetched.
ALTER TABLE [dbo].[MediaCoverageRevision] ADD CONSTRAINT [MediaCoverageRevision_outlet_ck] CHECK (LEN([outletName])>0);
ALTER TABLE [dbo].[MediaCoverageRevision] ADD CONSTRAINT [MediaCoverageRevision_source_ck] CHECK (([sourceUrl] IS NULL OR [sourceUrl] LIKE N'https://_%') AND ([sourcePublishedOn] IS NULL OR [sourcePublishedOn]>='1900-01-01'));
EXEC sp_executesql N'CREATE TRIGGER [dbo].[MediaCoverageRevisionImmutable] ON [dbo].[MediaCoverageRevision] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[MediaCoverageRevisionTranslationImmutable] ON [dbo].[MediaCoverageRevisionTranslation] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[MediaCoverageTopicImmutable] ON [dbo].[MediaCoverageTopic] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[MediaCoverageContributorImmutable] ON [dbo].[MediaCoverageContributor] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[MediaCoverageSlugHistoryImmutable] ON [dbo].[MediaCoverageSlugHistory] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51130, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[MediaCoverageRevisionTranslationAppend] ON [dbo].[MediaCoverageRevisionTranslation] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[MediaCoverage] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51131, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[MediaCoverageTopicAppend] ON [dbo].[MediaCoverageTopic] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[MediaCoverage] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51131, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[MediaCoverageContributorAppend] ON [dbo].[MediaCoverageContributor] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[MediaCoverage] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51131, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[MediaCoverageCurrentIntegrity] ON [dbo].[MediaCoverage] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[MediaCoverageRevision] r ON r.ownerId=i.id AND r.number=i.currentRevision WHERE r.slug<>i.slug OR NOT EXISTS (SELECT 1 FROM [dbo].[MediaCoverageRevisionTranslation] t WHERE t.ownerId=r.ownerId AND t.revisionNumber=r.number AND t.languageCode=r.primaryLanguage) OR (i.approvedById IS NOT NULL AND i.approvedById=r.editorId)) THROW 51132, ''Invalid current revision or self approval.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE i.currentRevision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [dbo].[MediaCoverageSlugHistory] h WHERE h.ownerId=i.id AND h.slug=i.slug )) THROW 51133, ''Canonical slug must be reserved.'', 1;
 END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[MediaCoverageRevisionSequence] ON [dbo].[MediaCoverageRevision] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[MediaCoverage] a ON a.id=i.ownerId WHERE i.number<>COALESCE(a.currentRevision,0)+1) THROW 51134, ''Revision must follow the current snapshot.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[MediaCoverageRevisionForward] ON [dbo].[MediaCoverage] AFTER UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id WHERE (d.currentRevision IS NOT NULL AND (i.currentRevision IS NULL OR i.currentRevision<d.currentRevision))) THROW 51135, ''Revision history cannot be rewritten.'', 1; END;';

-- ---------------------------------------------------------------------------
-- Permissions: the same editorial keys now govern the News families.
-- ---------------------------------------------------------------------------
UPDATE [dbo].[Permission]
SET [description] = N'Read private Article, Page, news, press release, statement and media coverage drafts and revisions.'
WHERE [key] = N'content.read';
UPDATE [dbo].[Permission]
SET [description] = N'Create and revise Article, Page, news, press release, statement and media coverage drafts and submit them for review.'
WHERE [key] = N'content.author';

-- ---------------------------------------------------------------------------
-- Search (Phase 17) — the four News kinds, each its own kind and its own scope.
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[SearchIndexRequest] DROP CONSTRAINT [SearchIndexRequest_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexRequest] ADD CONSTRAINT [SearchIndexRequest_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage'));
ALTER TABLE [dbo].[SearchIndexScope] DROP CONSTRAINT [SearchIndexScope_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage'));
ALTER TABLE [dbo].[SearchDocument] DROP CONSTRAINT [SearchDocument_kind_ck];
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_kind_ck] CHECK ([kind] IN (N'topic',N'person',N'article',N'page',N'work',N'edition',N'book-translation',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage'));
-- `SearchDocument_scope_ck` needs no change: each News kind is projected only
-- within its own scope, which that constraint already requires of every such kind.

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
