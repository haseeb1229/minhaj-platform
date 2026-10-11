-- ===========================================================================
-- Phase 15 — Editorial: Collection
-- ===========================================================================
--
-- ONE EDITORIAL AGGREGATE (DOMAIN_MODEL.md 7.1, 7.3) with the Article's shape
-- of tables — record, immutable revisions, localized revision translations,
-- typed Topic and Person references and a permanent slug namespace — governed by
-- the shared workflow and refused by the same constraints and triggers as Phase
-- 6, Phase 13 and Phase 14. A Collection is public and curated; a user's
-- private saved list is Personalisation's and shares nothing with it.
--
-- WHAT A COLLECTION OWNS IS ITS ORDERED MEMBERSHIP, AS REVISION STATE. Each
-- CollectionItem is one place in a revision's SINGLE mixed order and holds
-- EXACTLY ONE member, in one of seven typed, nullable, foreign-keyed columns —
-- the content records the phase's prerequisites delivered: Article (6), Work
-- (8), Video (10) and the four News families (13). There is no
-- `targetType + targetId`: a type with no column cannot be a member, and a
-- member's identity is always a real row of its owner's table.
--
--   one place, one member  — a CHECK counts the seven references: exactly one
--   one order, all types   — the place is the item's primary key, so two
--                            members of ANY types can never share a position
--   one record, once       — a FILTERED unique index per typed column
--   bounded                — a position is 0..99, so a revision holds at most
--                            one hundred members
--   never empty            — 51156: a current Collection revision has at least
--                            one member, so no empty set is ever reviewed,
--                            scheduled or published
--
-- SEVEN TYPED REFERENCES INTO OTHER RECORDS, AND NONE CASCADES. Every member
-- key is NO ACTION: removing a member, revising a Collection or archiving it
-- touches no target, and no target's lifecycle touches a Collection. Editorial
-- owns the item rows; Library and Media own no Collection schema.
--
-- ITS OWN REFUSAL NUMBERS, 51150-51156, in Phase 6's order: immutable history,
-- no extension of a historical revision, a valid current revision without
-- self-approval, a reserved canonical slug, revision sequence, no rewind — and
-- 51156, a current revision is never empty.
--
-- APPEND-ONLY. Nothing below edits an accepted migration. No search vocabulary
-- is widened — Collections are not searchable in this phase — and no permission
-- is added: the two editorial keys whose descriptions name the families now
-- name Collections too.

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Collection] (
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
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Collection_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Collection_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Collection_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[CollectionRevision] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [number] INT NOT NULL,
    [editorId] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLanguage] NVARCHAR(16) NOT NULL,
    [schemaVersion] INT NOT NULL CONSTRAINT [CollectionRevision_schemaVersion_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CollectionRevision_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [CollectionRevision_pkey] PRIMARY KEY CLUSTERED ([ownerId],[number])
);

-- CreateTable
CREATE TABLE [dbo].[CollectionRevisionTranslation] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [excerpt] NVARCHAR(600) NOT NULL,
    [seoTitle] NVARCHAR(200) NOT NULL,
    [seoDescription] NVARCHAR(300) NOT NULL,
    [document] NVARCHAR(max) NOT NULL,
    [html] NVARCHAR(max) NOT NULL,
    CONSTRAINT [CollectionRevisionTranslation_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[languageCode])
);

-- CreateTable
CREATE TABLE [dbo].[CollectionTopic] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [CollectionTopic_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[topicId])
);

-- CreateTable
CREATE TABLE [dbo].[CollectionContributor] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(32) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [CollectionContributor_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[personId],[role])
);

-- CreateTable
CREATE TABLE [dbo].[CollectionItem] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [position] INT NOT NULL,
    [articleId] NVARCHAR(36),
    [newsArticleId] NVARCHAR(36),
    [pressReleaseId] NVARCHAR(36),
    [statementId] NVARCHAR(36),
    [mediaCoverageId] NVARCHAR(36),
    [workId] NVARCHAR(36),
    [videoId] NVARCHAR(36),
    CONSTRAINT [CollectionItem_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[position])
);

-- CreateTable
CREATE TABLE [dbo].[CollectionSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [ownerId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [CollectionSlugHistory_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [CollectionSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Collection_state_updatedAt_id_idx] ON [dbo].[Collection]([state], [updatedAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Collection_state_publishedAt_id_idx] ON [dbo].[Collection]([state], [publishedAt] DESC, [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Collection_scheduleStatus_scheduledAt_id_idx] ON [dbo].[Collection]([scheduleStatus], [scheduledAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CollectionTopic_topicId_ownerId_idx] ON [dbo].[CollectionTopic]([topicId], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CollectionContributor_personId_ownerId_idx] ON [dbo].[CollectionContributor]([personId], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [CollectionSlugHistory_ownerId_idx] ON [dbo].[CollectionSlugHistory]([ownerId]);

-- One record is a member of one revision at most once. UNIQUE treats two NULLs
-- as equal, so each index is FILTERED to the rows that name that type.
CREATE UNIQUE NONCLUSTERED INDEX [CollectionItem_article_key] ON [dbo].[CollectionItem]([ownerId], [revisionNumber], [articleId]) WHERE [articleId] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [CollectionItem_newsArticle_key] ON [dbo].[CollectionItem]([ownerId], [revisionNumber], [newsArticleId]) WHERE [newsArticleId] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [CollectionItem_pressRelease_key] ON [dbo].[CollectionItem]([ownerId], [revisionNumber], [pressReleaseId]) WHERE [pressReleaseId] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [CollectionItem_statement_key] ON [dbo].[CollectionItem]([ownerId], [revisionNumber], [statementId]) WHERE [statementId] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [CollectionItem_mediaCoverage_key] ON [dbo].[CollectionItem]([ownerId], [revisionNumber], [mediaCoverageId]) WHERE [mediaCoverageId] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [CollectionItem_work_key] ON [dbo].[CollectionItem]([ownerId], [revisionNumber], [workId]) WHERE [workId] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [CollectionItem_video_key] ON [dbo].[CollectionItem]([ownerId], [revisionNumber], [videoId]) WHERE [videoId] IS NOT NULL;

-- AddForeignKey
ALTER TABLE [dbo].[Collection] ADD CONSTRAINT [Collection_creatorId_fkey] FOREIGN KEY ([creatorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Collection] ADD CONSTRAINT [Collection_approvedById_fkey] FOREIGN KEY ([approvedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Collection] ADD CONSTRAINT [Collection_scheduledById_fkey] FOREIGN KEY ([scheduledById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Collection] ADD CONSTRAINT [Collection_id_currentRevision_fkey] FOREIGN KEY ([id], [currentRevision]) REFERENCES [dbo].[CollectionRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Collection] ADD CONSTRAINT [Collection_id_approvedRevision_fkey] FOREIGN KEY ([id], [approvedRevision]) REFERENCES [dbo].[CollectionRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Collection] ADD CONSTRAINT [Collection_id_scheduledRevision_fkey] FOREIGN KEY ([id], [scheduledRevision]) REFERENCES [dbo].[CollectionRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CollectionRevision] ADD CONSTRAINT [CollectionRevision_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[Collection]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CollectionRevision] ADD CONSTRAINT [CollectionRevision_editorId_fkey] FOREIGN KEY ([editorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CollectionRevisionTranslation] ADD CONSTRAINT [CollectionRevisionTranslation_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[CollectionRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CollectionRevisionTranslation] ADD CONSTRAINT [CollectionRevisionTranslation_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CollectionTopic] ADD CONSTRAINT [CollectionTopic_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[CollectionRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CollectionTopic] ADD CONSTRAINT [CollectionTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CollectionContributor] ADD CONSTRAINT [CollectionContributor_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[CollectionRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CollectionContributor] ADD CONSTRAINT [CollectionContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CollectionItem] ADD CONSTRAINT [CollectionItem_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[CollectionRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey — the seven typed members, none cascading.
ALTER TABLE [dbo].[CollectionItem] ADD CONSTRAINT [CollectionItem_articleId_fkey] FOREIGN KEY ([articleId]) REFERENCES [dbo].[Article]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CollectionItem] ADD CONSTRAINT [CollectionItem_newsArticleId_fkey] FOREIGN KEY ([newsArticleId]) REFERENCES [dbo].[NewsArticle]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CollectionItem] ADD CONSTRAINT [CollectionItem_pressReleaseId_fkey] FOREIGN KEY ([pressReleaseId]) REFERENCES [dbo].[PressRelease]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CollectionItem] ADD CONSTRAINT [CollectionItem_statementId_fkey] FOREIGN KEY ([statementId]) REFERENCES [dbo].[Statement]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CollectionItem] ADD CONSTRAINT [CollectionItem_mediaCoverageId_fkey] FOREIGN KEY ([mediaCoverageId]) REFERENCES [dbo].[MediaCoverage]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CollectionItem] ADD CONSTRAINT [CollectionItem_workId_fkey] FOREIGN KEY ([workId]) REFERENCES [dbo].[Work]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CollectionItem] ADD CONSTRAINT [CollectionItem_videoId_fkey] FOREIGN KEY ([videoId]) REFERENCES [dbo].[Video]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[CollectionSlugHistory] ADD CONSTRAINT [CollectionSlugHistory_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[Collection]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- Collection: the Article's workflow invariants, refused by the database
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[Collection] ADD CONSTRAINT [Collection_state_ck] CHECK ([state] IN ('draft','in-review','scheduled','published','archived'));
ALTER TABLE [dbo].[Collection] ADD CONSTRAINT [Collection_version_ck] CHECK ([version]>0 AND ([currentRevision] IS NULL OR [currentRevision]>0));
ALTER TABLE [dbo].[Collection] ADD CONSTRAINT [Collection_approval_ck] CHECK (([approvedRevision] IS NULL AND [approvedById] IS NULL) OR ([approvedRevision] IS NOT NULL AND [approvedById] IS NOT NULL AND [currentRevision] IS NOT NULL AND [approvedRevision]=[currentRevision] AND [approvedById]<>[creatorId]));
ALTER TABLE [dbo].[Collection] ADD CONSTRAINT [Collection_publication_ck] CHECK ([state] NOT IN ('scheduled','published') OR ([approvedRevision] IS NOT NULL AND [currentRevision] IS NOT NULL AND [approvedRevision]=[currentRevision]));
ALTER TABLE [dbo].[Collection] ADD CONSTRAINT [Collection_published_date_ck] CHECK ([state]<>'published' OR [publishedAt] IS NOT NULL);
ALTER TABLE [dbo].[Collection] ADD CONSTRAINT [Collection_schedule_ck] CHECK ([state]<>'scheduled' OR ([scheduledRevision] IS NOT NULL AND [scheduledRevision]=[currentRevision] AND [scheduledAt] IS NOT NULL AND [scheduledById] IS NOT NULL AND [scheduledTimezone] IS NOT NULL AND [scheduleStatus] IN ('pending','authority-revoked','execution-failed')));
ALTER TABLE [dbo].[CollectionRevision] ADD CONSTRAINT [CollectionRevision_schema_ck] CHECK ([schemaVersion]=1 AND [number]>0);
ALTER TABLE [dbo].[CollectionRevisionTranslation] ADD CONSTRAINT [CollectionTranslation_size_ck] CHECK (DATALENGTH([document])<=400000 AND DATALENGTH([html])<=800000 AND ISJSON([document])=1);
ALTER TABLE [dbo].[CollectionContributor] ADD CONSTRAINT [CollectionContributor_role_ck] CHECK ([role] IN (N'author',N'translator',N'editor',N'compiler',N'narrator',N'reciter',N'speaker'));
ALTER TABLE [dbo].[CollectionContributor] ADD CONSTRAINT [CollectionContributor_position_ck] CHECK ([position] BETWEEN 0 AND 11);
-- One hundred places at most, in one order shared by every member type.
ALTER TABLE [dbo].[CollectionItem] ADD CONSTRAINT [CollectionItem_position_ck] CHECK ([position] BETWEEN 0 AND 99);
-- Exactly ONE typed member in every place — never none, never two.
ALTER TABLE [dbo].[CollectionItem] ADD CONSTRAINT [CollectionItem_one_member_ck] CHECK ((CASE WHEN [articleId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [newsArticleId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [pressReleaseId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [statementId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [mediaCoverageId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [workId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [videoId] IS NULL THEN 0 ELSE 1 END)=1);
EXEC sp_executesql N'CREATE TRIGGER [dbo].[CollectionRevisionImmutable] ON [dbo].[CollectionRevision] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51150, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[CollectionRevisionTranslationImmutable] ON [dbo].[CollectionRevisionTranslation] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51150, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[CollectionTopicImmutable] ON [dbo].[CollectionTopic] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51150, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[CollectionContributorImmutable] ON [dbo].[CollectionContributor] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51150, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[CollectionItemImmutable] ON [dbo].[CollectionItem] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51150, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[CollectionSlugHistoryImmutable] ON [dbo].[CollectionSlugHistory] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51150, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[CollectionRevisionTranslationAppend] ON [dbo].[CollectionRevisionTranslation] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Collection] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51151, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[CollectionTopicAppend] ON [dbo].[CollectionTopic] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Collection] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51151, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[CollectionContributorAppend] ON [dbo].[CollectionContributor] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Collection] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51151, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[CollectionItemAppend] ON [dbo].[CollectionItem] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Collection] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51151, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[CollectionCurrentIntegrity] ON [dbo].[Collection] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[CollectionRevision] r ON r.ownerId=i.id AND r.number=i.currentRevision WHERE r.slug<>i.slug OR NOT EXISTS (SELECT 1 FROM [dbo].[CollectionRevisionTranslation] t WHERE t.ownerId=r.ownerId AND t.revisionNumber=r.number AND t.languageCode=r.primaryLanguage) OR (i.approvedById IS NOT NULL AND i.approvedById=r.editorId)) THROW 51152, ''Invalid current revision or self approval.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE i.currentRevision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [dbo].[CollectionSlugHistory] h WHERE h.ownerId=i.id AND h.slug=i.slug )) THROW 51153, ''Canonical slug must be reserved.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE i.currentRevision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [dbo].[CollectionItem] m WHERE m.ownerId=i.id AND m.revisionNumber=i.currentRevision)) THROW 51156, ''A Collection revision must have a member.'', 1;
 END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[CollectionRevisionSequence] ON [dbo].[CollectionRevision] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Collection] a ON a.id=i.ownerId WHERE i.number<>COALESCE(a.currentRevision,0)+1) THROW 51154, ''Revision must follow the current snapshot.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[CollectionRevisionForward] ON [dbo].[Collection] AFTER UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id WHERE (d.currentRevision IS NOT NULL AND (i.currentRevision IS NULL OR i.currentRevision<d.currentRevision))) THROW 51155, ''Revision history cannot be rewritten.'', 1; END;';

-- ---------------------------------------------------------------------------
-- Permissions: the same editorial keys now govern Collections.
-- ---------------------------------------------------------------------------
UPDATE [dbo].[Permission]
SET [description] = N'Read private Article, Page, news, press release, statement, media coverage, event and collection drafts and revisions.'
WHERE [key] = N'content.read';
UPDATE [dbo].[Permission]
SET [description] = N'Create and revise Article, Page, news, press release, statement, media coverage, event and collection drafts and submit them for review.'
WHERE [key] = N'content.author';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
