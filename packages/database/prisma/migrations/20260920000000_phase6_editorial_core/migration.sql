BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Article] (
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
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Article_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Article_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Article_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[ArticleRevision] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [number] INT NOT NULL,
    [editorId] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLanguage] NVARCHAR(16) NOT NULL,
    [schemaVersion] INT NOT NULL CONSTRAINT [ArticleRevision_schemaVersion_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ArticleRevision_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [ArticleRevision_pkey] PRIMARY KEY CLUSTERED ([ownerId],[number])
);

-- CreateTable
CREATE TABLE [dbo].[ArticleRevisionTranslation] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [excerpt] NVARCHAR(600) NOT NULL,
    [seoTitle] NVARCHAR(200) NOT NULL,
    [seoDescription] NVARCHAR(300) NOT NULL,
    [document] NVARCHAR(max) NOT NULL,
    [html] NVARCHAR(max) NOT NULL,
    CONSTRAINT [ArticleRevisionTranslation_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[languageCode])
);

-- CreateTable
CREATE TABLE [dbo].[ArticleTopic] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [ArticleTopic_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[topicId])
);

-- CreateTable
CREATE TABLE [dbo].[ArticleContributor] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(32) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [ArticleContributor_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[personId],[role])
);

-- CreateTable
CREATE TABLE [dbo].[ArticleSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [ownerId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ArticleSlugHistory_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [ArticleSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[Page] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [routeBinding] NVARCHAR(100) NOT NULL,
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
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Page_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Page_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Page_routeBinding_slug_key] UNIQUE NONCLUSTERED ([routeBinding],[slug])
);

-- CreateTable
CREATE TABLE [dbo].[PageRevision] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [number] INT NOT NULL,
    [editorId] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLanguage] NVARCHAR(16) NOT NULL,
    [schemaVersion] INT NOT NULL CONSTRAINT [PageRevision_schemaVersion_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PageRevision_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PageRevision_pkey] PRIMARY KEY CLUSTERED ([ownerId],[number])
);

-- CreateTable
CREATE TABLE [dbo].[PageRevisionTranslation] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [excerpt] NVARCHAR(600) NOT NULL,
    [seoTitle] NVARCHAR(200) NOT NULL,
    [seoDescription] NVARCHAR(300) NOT NULL,
    [document] NVARCHAR(max) NOT NULL,
    [html] NVARCHAR(max) NOT NULL,
    CONSTRAINT [PageRevisionTranslation_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[languageCode])
);

-- CreateTable
CREATE TABLE [dbo].[PageTopic] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [PageTopic_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[topicId])
);

-- CreateTable
CREATE TABLE [dbo].[PageContributor] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(32) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [PageContributor_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[personId],[role])
);

-- CreateTable
CREATE TABLE [dbo].[PageSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [routeBinding] NVARCHAR(100) NOT NULL,
    [ownerId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PageSlugHistory_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PageSlugHistory_pkey] PRIMARY KEY CLUSTERED ([routeBinding],[slug])
);

-- CreateTable
CREATE TABLE [dbo].[ContactInquiry] (
    [id] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(120) NOT NULL,
    [email] NVARCHAR(320) NOT NULL,
    [subject] NVARCHAR(200) NOT NULL,
    [body] NVARCHAR(max) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL,
    [note] NVARCHAR(2000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ContactInquiry_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    [retainUntil] DATETIME2 NOT NULL,
    CONSTRAINT [ContactInquiry_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Feedback] (
    [id] NVARCHAR(36) NOT NULL,
    [category] NVARCHAR(32) NOT NULL,
    [body] NVARCHAR(max) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL,
    [note] NVARCHAR(2000) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Feedback_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    [retainUntil] DATETIME2 NOT NULL,
    CONSTRAINT [Feedback_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Article_state_publishedAt_id_idx] ON [dbo].[Article]([state], [publishedAt] DESC, [id]);

CREATE NONCLUSTERED INDEX [Article_state_updatedAt_id_idx] ON [dbo].[Article]([state], [updatedAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Article_scheduleStatus_scheduledAt_id_idx] ON [dbo].[Article]([scheduleStatus], [scheduledAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ArticleTopic_topicId_ownerId_idx] ON [dbo].[ArticleTopic]([topicId], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ArticleContributor_personId_ownerId_idx] ON [dbo].[ArticleContributor]([personId], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ArticleSlugHistory_ownerId_idx] ON [dbo].[ArticleSlugHistory]([ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Page_state_updatedAt_id_idx] ON [dbo].[Page]([state], [updatedAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Page_scheduleStatus_scheduledAt_id_idx] ON [dbo].[Page]([scheduleStatus], [scheduledAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PageTopic_topicId_ownerId_idx] ON [dbo].[PageTopic]([topicId], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PageContributor_personId_ownerId_idx] ON [dbo].[PageContributor]([personId], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PageSlugHistory_ownerId_idx] ON [dbo].[PageSlugHistory]([ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ContactInquiry_state_createdAt_id_idx] ON [dbo].[ContactInquiry]([state], [createdAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ContactInquiry_retainUntil_id_idx] ON [dbo].[ContactInquiry]([retainUntil], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Feedback_state_createdAt_id_idx] ON [dbo].[Feedback]([state], [createdAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Feedback_retainUntil_id_idx] ON [dbo].[Feedback]([retainUntil], [id]);

-- AddForeignKey
ALTER TABLE [dbo].[Article] ADD CONSTRAINT [Article_creatorId_fkey] FOREIGN KEY ([creatorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Article] ADD CONSTRAINT [Article_approvedById_fkey] FOREIGN KEY ([approvedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Article] ADD CONSTRAINT [Article_scheduledById_fkey] FOREIGN KEY ([scheduledById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Article] ADD CONSTRAINT [Article_id_currentRevision_fkey] FOREIGN KEY ([id], [currentRevision]) REFERENCES [dbo].[ArticleRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Article] ADD CONSTRAINT [Article_id_approvedRevision_fkey] FOREIGN KEY ([id], [approvedRevision]) REFERENCES [dbo].[ArticleRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Article] ADD CONSTRAINT [Article_id_scheduledRevision_fkey] FOREIGN KEY ([id], [scheduledRevision]) REFERENCES [dbo].[ArticleRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ArticleRevision] ADD CONSTRAINT [ArticleRevision_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[Article]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ArticleRevision] ADD CONSTRAINT [ArticleRevision_editorId_fkey] FOREIGN KEY ([editorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ArticleRevisionTranslation] ADD CONSTRAINT [ArticleRevisionTranslation_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[ArticleRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ArticleRevisionTranslation] ADD CONSTRAINT [ArticleRevisionTranslation_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ArticleTopic] ADD CONSTRAINT [ArticleTopic_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[ArticleRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ArticleTopic] ADD CONSTRAINT [ArticleTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ArticleContributor] ADD CONSTRAINT [ArticleContributor_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[ArticleRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ArticleContributor] ADD CONSTRAINT [ArticleContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ArticleSlugHistory] ADD CONSTRAINT [ArticleSlugHistory_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[Article]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Page] ADD CONSTRAINT [Page_creatorId_fkey] FOREIGN KEY ([creatorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Page] ADD CONSTRAINT [Page_approvedById_fkey] FOREIGN KEY ([approvedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Page] ADD CONSTRAINT [Page_scheduledById_fkey] FOREIGN KEY ([scheduledById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Page] ADD CONSTRAINT [Page_id_currentRevision_fkey] FOREIGN KEY ([id], [currentRevision]) REFERENCES [dbo].[PageRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Page] ADD CONSTRAINT [Page_id_approvedRevision_fkey] FOREIGN KEY ([id], [approvedRevision]) REFERENCES [dbo].[PageRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Page] ADD CONSTRAINT [Page_id_scheduledRevision_fkey] FOREIGN KEY ([id], [scheduledRevision]) REFERENCES [dbo].[PageRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PageRevision] ADD CONSTRAINT [PageRevision_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[Page]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PageRevision] ADD CONSTRAINT [PageRevision_editorId_fkey] FOREIGN KEY ([editorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PageRevisionTranslation] ADD CONSTRAINT [PageRevisionTranslation_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[PageRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PageRevisionTranslation] ADD CONSTRAINT [PageRevisionTranslation_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PageTopic] ADD CONSTRAINT [PageTopic_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[PageRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PageTopic] ADD CONSTRAINT [PageTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PageContributor] ADD CONSTRAINT [PageContributor_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[PageRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PageContributor] ADD CONSTRAINT [PageContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PageSlugHistory] ADD CONSTRAINT [PageSlugHistory_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[Page]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;


-- Current-revision publication, immutable evidence, and durable scheduling.
ALTER TABLE [dbo].[Article] ADD CONSTRAINT [Article_state_ck] CHECK ([state] IN ('draft','in-review','scheduled','published','archived'));
ALTER TABLE [dbo].[Article] ADD CONSTRAINT [Article_version_ck] CHECK ([version]>0 AND ([currentRevision] IS NULL OR [currentRevision]>0));
ALTER TABLE [dbo].[Article] ADD CONSTRAINT [Article_approval_ck] CHECK (([approvedRevision] IS NULL AND [approvedById] IS NULL) OR ([approvedRevision] IS NOT NULL AND [approvedById] IS NOT NULL AND [currentRevision] IS NOT NULL AND [approvedRevision]=[currentRevision] AND [approvedById]<>[creatorId]));
ALTER TABLE [dbo].[Article] ADD CONSTRAINT [Article_publication_ck] CHECK ([state] NOT IN ('scheduled','published') OR ([approvedRevision] IS NOT NULL AND [currentRevision] IS NOT NULL AND [approvedRevision]=[currentRevision]));
ALTER TABLE [dbo].[Article] ADD CONSTRAINT [Article_published_date_ck] CHECK ([state]<>'published' OR [publishedAt] IS NOT NULL);
ALTER TABLE [dbo].[Article] ADD CONSTRAINT [Article_schedule_ck] CHECK ([state]<>'scheduled' OR ([scheduledRevision] IS NOT NULL AND [scheduledRevision]=[currentRevision] AND [scheduledAt] IS NOT NULL AND [scheduledById] IS NOT NULL AND [scheduledTimezone] IS NOT NULL AND [scheduleStatus] IN ('pending','authority-revoked','execution-failed')));
ALTER TABLE [dbo].[ArticleRevision] ADD CONSTRAINT [ArticleRevision_schema_ck] CHECK ([schemaVersion]=1 AND [number]>0);
ALTER TABLE [dbo].[ArticleRevisionTranslation] ADD CONSTRAINT [ArticleTranslation_size_ck] CHECK (DATALENGTH([document])<=400000 AND DATALENGTH([html])<=800000 AND ISJSON([document])=1);
EXEC sp_executesql N'CREATE TRIGGER [dbo].[ArticleRevisionImmutable] ON [dbo].[ArticleRevision] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51060, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[ArticleRevisionTranslationImmutable] ON [dbo].[ArticleRevisionTranslation] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51060, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[ArticleTopicImmutable] ON [dbo].[ArticleTopic] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51060, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[ArticleContributorImmutable] ON [dbo].[ArticleContributor] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51060, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[ArticleSlugHistoryImmutable] ON [dbo].[ArticleSlugHistory] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51060, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[ArticleRevisionTranslationAppend] ON [dbo].[ArticleRevisionTranslation] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Article] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51061, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[ArticleTopicAppend] ON [dbo].[ArticleTopic] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Article] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51061, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[ArticleContributorAppend] ON [dbo].[ArticleContributor] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Article] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51061, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[ArticleCurrentIntegrity] ON [dbo].[Article] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[ArticleRevision] r ON r.ownerId=i.id AND r.number=i.currentRevision WHERE r.slug<>i.slug OR NOT EXISTS (SELECT 1 FROM [dbo].[ArticleRevisionTranslation] t WHERE t.ownerId=r.ownerId AND t.revisionNumber=r.number AND t.languageCode=r.primaryLanguage) OR (i.approvedById IS NOT NULL AND i.approvedById=r.editorId)) THROW 51062, ''Invalid current revision or self approval.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE i.currentRevision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [dbo].[ArticleSlugHistory] h WHERE h.ownerId=i.id AND h.slug=i.slug )) THROW 51063, ''Canonical slug must be reserved.'', 1;
 END;';
ALTER TABLE [dbo].[Page] ADD CONSTRAINT [Page_state_ck] CHECK ([state] IN ('draft','in-review','scheduled','published','archived'));
ALTER TABLE [dbo].[Page] ADD CONSTRAINT [Page_version_ck] CHECK ([version]>0 AND ([currentRevision] IS NULL OR [currentRevision]>0));
ALTER TABLE [dbo].[Page] ADD CONSTRAINT [Page_approval_ck] CHECK (([approvedRevision] IS NULL AND [approvedById] IS NULL) OR ([approvedRevision] IS NOT NULL AND [approvedById] IS NOT NULL AND [currentRevision] IS NOT NULL AND [approvedRevision]=[currentRevision] AND [approvedById]<>[creatorId]));
ALTER TABLE [dbo].[Page] ADD CONSTRAINT [Page_publication_ck] CHECK ([state] NOT IN ('scheduled','published') OR ([approvedRevision] IS NOT NULL AND [currentRevision] IS NOT NULL AND [approvedRevision]=[currentRevision]));
ALTER TABLE [dbo].[Page] ADD CONSTRAINT [Page_published_date_ck] CHECK ([state]<>'published' OR [publishedAt] IS NOT NULL);
ALTER TABLE [dbo].[Page] ADD CONSTRAINT [Page_schedule_ck] CHECK ([state]<>'scheduled' OR ([scheduledRevision] IS NOT NULL AND [scheduledRevision]=[currentRevision] AND [scheduledAt] IS NOT NULL AND [scheduledById] IS NOT NULL AND [scheduledTimezone] IS NOT NULL AND [scheduleStatus] IN ('pending','authority-revoked','execution-failed')));
ALTER TABLE [dbo].[PageRevision] ADD CONSTRAINT [PageRevision_schema_ck] CHECK ([schemaVersion]=1 AND [number]>0);
ALTER TABLE [dbo].[PageRevisionTranslation] ADD CONSTRAINT [PageTranslation_size_ck] CHECK (DATALENGTH([document])<=400000 AND DATALENGTH([html])<=800000 AND ISJSON([document])=1);
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PageRevisionImmutable] ON [dbo].[PageRevision] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51060, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PageRevisionTranslationImmutable] ON [dbo].[PageRevisionTranslation] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51060, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PageTopicImmutable] ON [dbo].[PageTopic] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51060, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PageContributorImmutable] ON [dbo].[PageContributor] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51060, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PageSlugHistoryImmutable] ON [dbo].[PageSlugHistory] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51060, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PageRevisionTranslationAppend] ON [dbo].[PageRevisionTranslation] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Page] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51061, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PageTopicAppend] ON [dbo].[PageTopic] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Page] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51061, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PageContributorAppend] ON [dbo].[PageContributor] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Page] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51061, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PageCurrentIntegrity] ON [dbo].[Page] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[PageRevision] r ON r.ownerId=i.id AND r.number=i.currentRevision WHERE r.slug<>i.slug OR NOT EXISTS (SELECT 1 FROM [dbo].[PageRevisionTranslation] t WHERE t.ownerId=r.ownerId AND t.revisionNumber=r.number AND t.languageCode=r.primaryLanguage) OR (i.approvedById IS NOT NULL AND i.approvedById=r.editorId)) THROW 51062, ''Invalid current revision or self approval.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE i.currentRevision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [dbo].[PageSlugHistory] h WHERE h.ownerId=i.id AND h.slug=i.slug AND h.routeBinding=i.routeBinding)) THROW 51063, ''Canonical slug must be reserved.'', 1;
 END;';
ALTER TABLE [dbo].[ContactInquiry] ADD CONSTRAINT [ContactInquiry_state_ck] CHECK ([state] IN ('submitted','triaged','in-progress','resolved','closed','spam'));
ALTER TABLE [dbo].[ContactInquiry] ADD CONSTRAINT [ContactInquiry_retention_ck] CHECK ([retainUntil]>[createdAt] AND [version]>0 AND DATALENGTH([body])<=16000);
ALTER TABLE [dbo].[Feedback] ADD CONSTRAINT [Feedback_state_ck] CHECK ([state] IN ('submitted','triaged','in-progress','resolved','closed','spam'));
ALTER TABLE [dbo].[Feedback] ADD CONSTRAINT [Feedback_retention_ck] CHECK ([retainUntil]>[createdAt] AND [version]>0 AND DATALENGTH([body])<=16000);

ALTER TABLE [dbo].[Page] ADD CONSTRAINT [Page_binding_ck] CHECK (([routeBinding]=N'help-article') OR ([routeBinding] IN (N'/help',N'/contact',N'/volunteer',N'/legal/privacy',N'/legal/terms',N'/legal/cookies',N'/legal/accessibility',N'/explore/about',N'/explore/leadership',N'/explore/shaykh-ul-islam',N'/explore/organization',N'/explore/our-work',N'/explore/community',N'/explore/digital-resources',N'/explore/about/introduction',N'/explore/about/vision',N'/explore/about/mission',N'/explore/about/values',N'/explore/about/objectives',N'/explore/about/history',N'/explore/about/timeline',N'/explore/about/global-impact',N'/explore/shaykh-ul-islam/biography',N'/explore/shaykh-ul-islam/early-life',N'/explore/shaykh-ul-islam/education',N'/explore/shaykh-ul-islam/academic-work',N'/explore/shaykh-ul-islam/achievements',N'/explore/shaykh-ul-islam/works',N'/explore/shaykh-ul-islam/isnad',N'/explore/shaykh-ul-islam/views-of-dignitaries',N'/explore/organization/governance',N'/explore/organization/departments',N'/explore/organization/forums',N'/explore/organization/wings',N'/explore/organization/institutions',N'/explore/organization/annual-reports',N'/explore/organization/un-recognition',N'/explore/organization/awards',N'/explore/our-work/education',N'/explore/our-work/research',N'/explore/our-work/welfare',N'/explore/our-work/women',N'/explore/our-work/youth',N'/explore/our-work/students',N'/explore/our-work/interfaith',N'/explore/our-work/human-rights',N'/explore/our-work/peace',N'/explore/digital-resources/mobile-apps',N'/explore/digital-resources/social-media') AND [slug]=N'page'));
EXEC sp_executesql N'CREATE TRIGGER [dbo].[ArticleRevisionSequence] ON [dbo].[ArticleRevision] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Article] a ON a.id=i.ownerId WHERE i.number<>COALESCE(a.currentRevision,0)+1) THROW 51064, ''Revision must follow the current snapshot.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[ArticleRevisionForward] ON [dbo].[Article] AFTER UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id WHERE (d.currentRevision IS NOT NULL AND (i.currentRevision IS NULL OR i.currentRevision<d.currentRevision))) THROW 51065, ''Revision history and route ownership cannot be rewritten.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PageRevisionSequence] ON [dbo].[PageRevision] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Page] a ON a.id=i.ownerId WHERE i.number<>COALESCE(a.currentRevision,0)+1) THROW 51064, ''Revision must follow the current snapshot.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[PageRevisionForward] ON [dbo].[Page] AFTER UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id WHERE (d.currentRevision IS NOT NULL AND (i.currentRevision IS NULL OR i.currentRevision<d.currentRevision)) OR i.routeBinding<>d.routeBinding) THROW 51065, ''Revision history and route ownership cannot be rewritten.'', 1; END;';
ALTER TABLE [dbo].[Feedback] ADD CONSTRAINT [Feedback_category_ck] CHECK ([category] IN (N'suggestion',N'problem',N'accessibility'));

INSERT INTO [dbo].[Permission] ([key],[description]) VALUES (N'content.read',N'Read private Article and Page drafts and revisions.'),
(N'content.author',N'Create and revise Article and Page drafts and submit them for review.'),
(N'content.review',N'Approve or return an independently authored editorial revision.'),
(N'content.publish',N'Publish, schedule, cancel and archive reviewed editorial content.'),
(N'correspondence.read',N'Read private ContactInquiry and Feedback submissions.'),
(N'correspondence.administer',N'Triage private correspondence and dispose of expired submissions.');
DECLARE @editorialAdminRoleId NVARCHAR(36);
DECLARE @editorialAddedKeys NVARCHAR(1000);

SELECT @editorialAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @editorialAdminRoleId IS NOT NULL
BEGIN
    SELECT @editorialAddedKeys = STRING_AGG(p.[key], N' ') WITHIN GROUP (ORDER BY p.[key])
    FROM [dbo].[Permission] p
    WHERE p.[key] IN (N'content.read',N'content.author',N'content.review',N'content.publish',N'correspondence.read',N'correspondence.administer')
      AND NOT EXISTS (
          SELECT 1 FROM [dbo].[RolePermission] rp
          WHERE rp.[roleId] = @editorialAdminRoleId AND rp.[permissionKey] = p.[key]
      );

    IF @editorialAddedKeys IS NOT NULL AND LEN(@editorialAddedKeys) > 0
    BEGIN
        INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
        SELECT @editorialAdminRoleId, p.[key]
        FROM [dbo].[Permission] p
        WHERE p.[key] IN (N'content.read',N'content.author',N'content.review',N'content.publish',N'correspondence.read',N'correspondence.administer')
          AND NOT EXISTS (
              SELECT 1 FROM [dbo].[RolePermission] rp
              WHERE rp.[roleId] = @editorialAdminRoleId AND rp.[permissionKey] = p.[key]
          );

        -- Grants before sessions, so the count each statement reports is the
        -- one it actually removed rather than whatever a cascade took first.
        DELETE FROM [dbo].[StepUpGrant]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @editorialAdminRoleId AND ra.[revokedAt] IS NULL
        );

        DELETE FROM [dbo].[Session]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @editorialAdminRoleId AND ra.[revokedAt] IS NULL
        );

        -- WHICH KEYS WERE ADDED, and nothing else. Not a snapshot of the whole
        -- bundle: an audit payload carrying every permission a role holds would
        -- be a second copy of the privilege model in a table with different
        -- retention (SECURITY_BASELINE.md 13.4).
        INSERT INTO [dbo].[AuditLog]
            ([id], [actorType], [actorId], [action], [targetType], [targetId],
             [afterState], [authorisingSource])
        VALUES
            (NEWID(), N'migration', NULL, N'editorial.permissions.provisioned', N'role',
             @editorialAdminRoleId,
             N'{"added":"' + @editorialAddedKeys + N'"}',
             N'20260920000000_phase6_editorial_core');
    END;
END;


COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
