-- ===========================================================================
-- Phase 9 — Research & Publications
-- ===========================================================================
--
-- SIX DISTINCT LIBRARY AGGREGATES (DOMAIN_MODEL.md 10.2): Research,
-- ResearchPaper, Publication, Magazine, MagazineIssue and Encyclopedia. Each has
-- its own table, its own permanent slug namespace and its own typed label,
-- contributor and topic relations; Research and ResearchPaper also have ordered
-- citations. No generic content table, no polymorphic reference, no Storage
-- relation and no new permission: `library.read` and `library.administer`
-- already cover the Library, and a profile or contributor credit grants nothing.
--
-- APPEND-ONLY. Nothing below edits an accepted migration. The Phase-17 search
-- vocabularies are WIDENED here by replacing their CHECK constraints, which is
-- how a later searchable domain adds its own kinds (DELIVERY_PLAN.md 3).

BEGIN TRY

BEGIN TRAN;


-- CreateTable
CREATE TABLE [dbo].[Research] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [publicationYear] INT,
    [publishedOn] DATE,
    [institutionalContext] NVARCHAR(500),
    [abstract] NVARCHAR(4000),
    [document] NVARCHAR(max),
    [version] INT NOT NULL CONSTRAINT [Research_version_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Research_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Research_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Research_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[ResearchLabel] (
    [researchId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [summary] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [ResearchLabel_pkey] PRIMARY KEY CLUSTERED ([researchId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[ResearchSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [researchId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [ResearchSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[ResearchContributor] (
    [researchId] NVARCHAR(36) NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(24) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [ResearchContributor_pkey] PRIMARY KEY CLUSTERED ([researchId],[personId],[role])
);

-- CreateTable
CREATE TABLE [dbo].[ResearchTopic] (
    [researchId] NVARCHAR(36) NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [ResearchTopic_pkey] PRIMARY KEY CLUSTERED ([researchId],[topicId])
);

-- CreateTable
CREATE TABLE [dbo].[ResearchCitation] (
    [researchId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    [text] NVARCHAR(1000) NOT NULL,
    [url] NVARCHAR(2000),
    [doi] NVARCHAR(200),
    CONSTRAINT [ResearchCitation_pkey] PRIMARY KEY CLUSTERED ([researchId],[position])
);

-- CreateTable
CREATE TABLE [dbo].[ResearchPaper] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [publicationYear] INT,
    [publishedOn] DATE,
    [institutionalContext] NVARCHAR(500),
    [abstract] NVARCHAR(4000),
    [venue] NVARCHAR(300),
    [doi] NVARCHAR(200),
    [document] NVARCHAR(max),
    [version] INT NOT NULL CONSTRAINT [ResearchPaper_version_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [ResearchPaper_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [ResearchPaper_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ResearchPaper_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[ResearchPaperLabel] (
    [researchPaperId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [summary] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [ResearchPaperLabel_pkey] PRIMARY KEY CLUSTERED ([researchPaperId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[ResearchPaperSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [researchPaperId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [ResearchPaperSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[ResearchPaperContributor] (
    [researchPaperId] NVARCHAR(36) NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(24) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [ResearchPaperContributor_pkey] PRIMARY KEY CLUSTERED ([researchPaperId],[personId],[role])
);

-- CreateTable
CREATE TABLE [dbo].[ResearchPaperTopic] (
    [researchPaperId] NVARCHAR(36) NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [ResearchPaperTopic_pkey] PRIMARY KEY CLUSTERED ([researchPaperId],[topicId])
);

-- CreateTable
CREATE TABLE [dbo].[ResearchPaperCitation] (
    [researchPaperId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    [text] NVARCHAR(1000) NOT NULL,
    [url] NVARCHAR(2000),
    [doi] NVARCHAR(200),
    CONSTRAINT [ResearchPaperCitation_pkey] PRIMARY KEY CLUSTERED ([researchPaperId],[position])
);

-- CreateTable
CREATE TABLE [dbo].[Publication] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [publicationYear] INT,
    [publishedOn] DATE,
    [publisher] NVARCHAR(240),
    [document] NVARCHAR(max),
    [version] INT NOT NULL CONSTRAINT [Publication_version_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Publication_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Publication_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Publication_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[PublicationLabel] (
    [publicationId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [summary] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [PublicationLabel_pkey] PRIMARY KEY CLUSTERED ([publicationId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[PublicationSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [publicationId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [PublicationSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[PublicationContributor] (
    [publicationId] NVARCHAR(36) NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(24) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [PublicationContributor_pkey] PRIMARY KEY CLUSTERED ([publicationId],[personId],[role])
);

-- CreateTable
CREATE TABLE [dbo].[PublicationTopic] (
    [publicationId] NVARCHAR(36) NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [PublicationTopic_pkey] PRIMARY KEY CLUSTERED ([publicationId],[topicId])
);

-- CreateTable
CREATE TABLE [dbo].[Magazine] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [Magazine_version_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Magazine_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Magazine_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Magazine_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[MagazineLabel] (
    [magazineId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [summary] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [MagazineLabel_pkey] PRIMARY KEY CLUSTERED ([magazineId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[MagazineSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [magazineId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [MagazineSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[MagazineContributor] (
    [magazineId] NVARCHAR(36) NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(24) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [MagazineContributor_pkey] PRIMARY KEY CLUSTERED ([magazineId],[personId],[role])
);

-- CreateTable
CREATE TABLE [dbo].[MagazineTopic] (
    [magazineId] NVARCHAR(36) NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [MagazineTopic_pkey] PRIMARY KEY CLUSTERED ([magazineId],[topicId])
);

-- CreateTable
CREATE TABLE [dbo].[MagazineIssue] (
    [id] NVARCHAR(36) NOT NULL,
    [magazineId] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [volume] INT,
    [issueNumber] INT,
    [publicationYear] INT,
    [publishedOn] DATE,
    [document] NVARCHAR(max),
    [version] INT NOT NULL CONSTRAINT [MagazineIssue_version_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [MagazineIssue_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [MagazineIssue_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MagazineIssue_magazineId_slug_key] UNIQUE NONCLUSTERED ([magazineId],[slug]),
    CONSTRAINT [MagazineIssue_id_magazineId_key] UNIQUE NONCLUSTERED ([id],[magazineId])
);

-- CreateTable
CREATE TABLE [dbo].[MagazineIssueLabel] (
    [magazineIssueId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [summary] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [MagazineIssueLabel_pkey] PRIMARY KEY CLUSTERED ([magazineIssueId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[MagazineIssueContributor] (
    [magazineIssueId] NVARCHAR(36) NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(24) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [MagazineIssueContributor_pkey] PRIMARY KEY CLUSTERED ([magazineIssueId],[personId],[role])
);

-- CreateTable
CREATE TABLE [dbo].[MagazineIssueTopic] (
    [magazineIssueId] NVARCHAR(36) NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [MagazineIssueTopic_pkey] PRIMARY KEY CLUSTERED ([magazineIssueId],[topicId])
);

-- CreateTable
CREATE TABLE [dbo].[MagazineIssueSlugHistory] (
    [magazineId] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [magazineIssueId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [MagazineIssueSlugHistory_pkey] PRIMARY KEY CLUSTERED ([magazineId],[slug])
);

-- CreateTable
CREATE TABLE [dbo].[Encyclopedia] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [publicationYear] INT,
    [publishedOn] DATE,
    [publisher] NVARCHAR(240),
    [document] NVARCHAR(max),
    [version] INT NOT NULL CONSTRAINT [Encyclopedia_version_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Encyclopedia_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Encyclopedia_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Encyclopedia_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[EncyclopediaLabel] (
    [encyclopediaId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [summary] NVARCHAR(1000) NOT NULL,
    CONSTRAINT [EncyclopediaLabel_pkey] PRIMARY KEY CLUSTERED ([encyclopediaId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[EncyclopediaSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [encyclopediaId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [EncyclopediaSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[EncyclopediaContributor] (
    [encyclopediaId] NVARCHAR(36) NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(24) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [EncyclopediaContributor_pkey] PRIMARY KEY CLUSTERED ([encyclopediaId],[personId],[role])
);

-- CreateTable
CREATE TABLE [dbo].[EncyclopediaTopic] (
    [encyclopediaId] NVARCHAR(36) NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [EncyclopediaTopic_pkey] PRIMARY KEY CLUSTERED ([encyclopediaId],[topicId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Research_state_publicationYear_slug_idx] ON [dbo].[Research]([state], [publicationYear], [slug]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Research_languageCode_publicationYear_id_idx] ON [dbo].[Research]([languageCode], [publicationYear], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ResearchSlugHistory_researchId_idx] ON [dbo].[ResearchSlugHistory]([researchId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ResearchContributor_personId_researchId_idx] ON [dbo].[ResearchContributor]([personId], [researchId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ResearchTopic_topicId_researchId_idx] ON [dbo].[ResearchTopic]([topicId], [researchId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ResearchPaper_state_publicationYear_slug_idx] ON [dbo].[ResearchPaper]([state], [publicationYear], [slug]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ResearchPaper_languageCode_publicationYear_id_idx] ON [dbo].[ResearchPaper]([languageCode], [publicationYear], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ResearchPaperSlugHistory_researchPaperId_idx] ON [dbo].[ResearchPaperSlugHistory]([researchPaperId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ResearchPaperContributor_personId_researchPaperId_idx] ON [dbo].[ResearchPaperContributor]([personId], [researchPaperId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ResearchPaperTopic_topicId_researchPaperId_idx] ON [dbo].[ResearchPaperTopic]([topicId], [researchPaperId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Publication_state_publicationYear_slug_idx] ON [dbo].[Publication]([state], [publicationYear], [slug]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Publication_languageCode_publicationYear_id_idx] ON [dbo].[Publication]([languageCode], [publicationYear], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PublicationSlugHistory_publicationId_idx] ON [dbo].[PublicationSlugHistory]([publicationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PublicationContributor_personId_publicationId_idx] ON [dbo].[PublicationContributor]([personId], [publicationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PublicationTopic_topicId_publicationId_idx] ON [dbo].[PublicationTopic]([topicId], [publicationId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Magazine_state_slug_idx] ON [dbo].[Magazine]([state], [slug]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MagazineSlugHistory_magazineId_idx] ON [dbo].[MagazineSlugHistory]([magazineId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MagazineContributor_personId_magazineId_idx] ON [dbo].[MagazineContributor]([personId], [magazineId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MagazineTopic_topicId_magazineId_idx] ON [dbo].[MagazineTopic]([topicId], [magazineId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MagazineIssue_magazineId_state_publicationYear_id_idx] ON [dbo].[MagazineIssue]([magazineId], [state], [publicationYear], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MagazineIssue_state_publicationYear_slug_idx] ON [dbo].[MagazineIssue]([state], [publicationYear], [slug]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MagazineIssue_languageCode_publicationYear_id_idx] ON [dbo].[MagazineIssue]([languageCode], [publicationYear], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MagazineIssueContributor_personId_magazineIssueId_idx] ON [dbo].[MagazineIssueContributor]([personId], [magazineIssueId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MagazineIssueTopic_topicId_magazineIssueId_idx] ON [dbo].[MagazineIssueTopic]([topicId], [magazineIssueId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MagazineIssueSlugHistory_magazineIssueId_magazineId_idx] ON [dbo].[MagazineIssueSlugHistory]([magazineIssueId], [magazineId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Encyclopedia_state_publicationYear_slug_idx] ON [dbo].[Encyclopedia]([state], [publicationYear], [slug]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Encyclopedia_languageCode_publicationYear_id_idx] ON [dbo].[Encyclopedia]([languageCode], [publicationYear], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EncyclopediaSlugHistory_encyclopediaId_idx] ON [dbo].[EncyclopediaSlugHistory]([encyclopediaId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EncyclopediaContributor_personId_encyclopediaId_idx] ON [dbo].[EncyclopediaContributor]([personId], [encyclopediaId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EncyclopediaTopic_topicId_encyclopediaId_idx] ON [dbo].[EncyclopediaTopic]([topicId], [encyclopediaId]);

-- AddForeignKey
ALTER TABLE [dbo].[Research] ADD CONSTRAINT [Research_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ResearchLabel] ADD CONSTRAINT [ResearchLabel_researchId_fkey] FOREIGN KEY ([researchId]) REFERENCES [dbo].[Research]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ResearchSlugHistory] ADD CONSTRAINT [ResearchSlugHistory_researchId_fkey] FOREIGN KEY ([researchId]) REFERENCES [dbo].[Research]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ResearchContributor] ADD CONSTRAINT [ResearchContributor_researchId_fkey] FOREIGN KEY ([researchId]) REFERENCES [dbo].[Research]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ResearchContributor] ADD CONSTRAINT [ResearchContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ResearchTopic] ADD CONSTRAINT [ResearchTopic_researchId_fkey] FOREIGN KEY ([researchId]) REFERENCES [dbo].[Research]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ResearchTopic] ADD CONSTRAINT [ResearchTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ResearchCitation] ADD CONSTRAINT [ResearchCitation_researchId_fkey] FOREIGN KEY ([researchId]) REFERENCES [dbo].[Research]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ResearchPaper] ADD CONSTRAINT [ResearchPaper_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ResearchPaperLabel] ADD CONSTRAINT [ResearchPaperLabel_researchPaperId_fkey] FOREIGN KEY ([researchPaperId]) REFERENCES [dbo].[ResearchPaper]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ResearchPaperSlugHistory] ADD CONSTRAINT [ResearchPaperSlugHistory_researchPaperId_fkey] FOREIGN KEY ([researchPaperId]) REFERENCES [dbo].[ResearchPaper]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ResearchPaperContributor] ADD CONSTRAINT [ResearchPaperContributor_researchPaperId_fkey] FOREIGN KEY ([researchPaperId]) REFERENCES [dbo].[ResearchPaper]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ResearchPaperContributor] ADD CONSTRAINT [ResearchPaperContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ResearchPaperTopic] ADD CONSTRAINT [ResearchPaperTopic_researchPaperId_fkey] FOREIGN KEY ([researchPaperId]) REFERENCES [dbo].[ResearchPaper]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ResearchPaperTopic] ADD CONSTRAINT [ResearchPaperTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ResearchPaperCitation] ADD CONSTRAINT [ResearchPaperCitation_researchPaperId_fkey] FOREIGN KEY ([researchPaperId]) REFERENCES [dbo].[ResearchPaper]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Publication] ADD CONSTRAINT [Publication_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PublicationLabel] ADD CONSTRAINT [PublicationLabel_publicationId_fkey] FOREIGN KEY ([publicationId]) REFERENCES [dbo].[Publication]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PublicationSlugHistory] ADD CONSTRAINT [PublicationSlugHistory_publicationId_fkey] FOREIGN KEY ([publicationId]) REFERENCES [dbo].[Publication]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PublicationContributor] ADD CONSTRAINT [PublicationContributor_publicationId_fkey] FOREIGN KEY ([publicationId]) REFERENCES [dbo].[Publication]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PublicationContributor] ADD CONSTRAINT [PublicationContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PublicationTopic] ADD CONSTRAINT [PublicationTopic_publicationId_fkey] FOREIGN KEY ([publicationId]) REFERENCES [dbo].[Publication]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PublicationTopic] ADD CONSTRAINT [PublicationTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MagazineLabel] ADD CONSTRAINT [MagazineLabel_magazineId_fkey] FOREIGN KEY ([magazineId]) REFERENCES [dbo].[Magazine]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MagazineSlugHistory] ADD CONSTRAINT [MagazineSlugHistory_magazineId_fkey] FOREIGN KEY ([magazineId]) REFERENCES [dbo].[Magazine]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MagazineContributor] ADD CONSTRAINT [MagazineContributor_magazineId_fkey] FOREIGN KEY ([magazineId]) REFERENCES [dbo].[Magazine]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MagazineContributor] ADD CONSTRAINT [MagazineContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MagazineTopic] ADD CONSTRAINT [MagazineTopic_magazineId_fkey] FOREIGN KEY ([magazineId]) REFERENCES [dbo].[Magazine]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MagazineTopic] ADD CONSTRAINT [MagazineTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MagazineIssue] ADD CONSTRAINT [MagazineIssue_magazineId_fkey] FOREIGN KEY ([magazineId]) REFERENCES [dbo].[Magazine]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MagazineIssue] ADD CONSTRAINT [MagazineIssue_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MagazineIssueLabel] ADD CONSTRAINT [MagazineIssueLabel_magazineIssueId_fkey] FOREIGN KEY ([magazineIssueId]) REFERENCES [dbo].[MagazineIssue]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MagazineIssueContributor] ADD CONSTRAINT [MagazineIssueContributor_magazineIssueId_fkey] FOREIGN KEY ([magazineIssueId]) REFERENCES [dbo].[MagazineIssue]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MagazineIssueContributor] ADD CONSTRAINT [MagazineIssueContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MagazineIssueTopic] ADD CONSTRAINT [MagazineIssueTopic_magazineIssueId_fkey] FOREIGN KEY ([magazineIssueId]) REFERENCES [dbo].[MagazineIssue]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MagazineIssueTopic] ADD CONSTRAINT [MagazineIssueTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[MagazineIssueSlugHistory] ADD CONSTRAINT [MagazineIssueSlugHistory_magazineIssueId_magazineId_fkey] FOREIGN KEY ([magazineIssueId], [magazineId]) REFERENCES [dbo].[MagazineIssue]([id],[magazineId]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Encyclopedia] ADD CONSTRAINT [Encyclopedia_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EncyclopediaLabel] ADD CONSTRAINT [EncyclopediaLabel_encyclopediaId_fkey] FOREIGN KEY ([encyclopediaId]) REFERENCES [dbo].[Encyclopedia]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EncyclopediaSlugHistory] ADD CONSTRAINT [EncyclopediaSlugHistory_encyclopediaId_fkey] FOREIGN KEY ([encyclopediaId]) REFERENCES [dbo].[Encyclopedia]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EncyclopediaContributor] ADD CONSTRAINT [EncyclopediaContributor_encyclopediaId_fkey] FOREIGN KEY ([encyclopediaId]) REFERENCES [dbo].[Encyclopedia]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EncyclopediaContributor] ADD CONSTRAINT [EncyclopediaContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EncyclopediaTopic] ADD CONSTRAINT [EncyclopediaTopic_encyclopediaId_fkey] FOREIGN KEY ([encyclopediaId]) REFERENCES [dbo].[Encyclopedia]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EncyclopediaTopic] ADD CONSTRAINT [EncyclopediaTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- One (volume, number) per Magazine, where both are genuinely known. FILTERED,
-- because an issue with no printed number is ordinary and two such issues are
-- not duplicates of each other.
-- ---------------------------------------------------------------------------
CREATE UNIQUE NONCLUSTERED INDEX [MagazineIssue_magazineId_volume_issueNumber_key]
    ON [dbo].[MagazineIssue]([magazineId], [volume], [issueNumber])
    WHERE [volume] IS NOT NULL AND [issueNumber] IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Integrity refused by the database, whoever writes. Lifecycle, locales, roles,
-- bounds, date-only facts that agree with their year, JSON documents within
-- their size, citations that are HTTPS and DOI-shaped where present.
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[Research] ADD CONSTRAINT [Research_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[Research] ADD CONSTRAINT [Research_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[Research] ADD CONSTRAINT [Research_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[Research] ADD CONSTRAINT [Research_slug_ck] CHECK (LEN([slug]) >= 2);
ALTER TABLE [dbo].[Research] ADD CONSTRAINT [Research_year_ck] CHECK ([publicationYear] IS NULL OR [publicationYear] BETWEEN 1 AND 9999);
ALTER TABLE [dbo].[Research] ADD CONSTRAINT [Research_date_ck] CHECK ([publishedOn] IS NULL OR [publicationYear] = YEAR([publishedOn]));
ALTER TABLE [dbo].[Research] ADD CONSTRAINT [Research_document_ck] CHECK ([document] IS NULL OR (ISJSON([document]) = 1 AND DATALENGTH([document]) <= 1000000));
ALTER TABLE [dbo].[ResearchLabel] ADD CONSTRAINT [ResearchLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[ResearchLabel] ADD CONSTRAINT [ResearchLabel_title_ck] CHECK (LEN([title]) > 0);
ALTER TABLE [dbo].[ResearchContributor] ADD CONSTRAINT [ResearchContributor_role_ck] CHECK ([role] IN (N'author',N'translator',N'editor',N'compiler',N'narrator',N'reciter',N'speaker'));
ALTER TABLE [dbo].[ResearchContributor] ADD CONSTRAINT [ResearchContributor_position_ck] CHECK ([position] BETWEEN 0 AND 23);
ALTER TABLE [dbo].[ResearchPaper] ADD CONSTRAINT [ResearchPaper_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[ResearchPaper] ADD CONSTRAINT [ResearchPaper_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[ResearchPaper] ADD CONSTRAINT [ResearchPaper_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[ResearchPaper] ADD CONSTRAINT [ResearchPaper_slug_ck] CHECK (LEN([slug]) >= 2);
ALTER TABLE [dbo].[ResearchPaper] ADD CONSTRAINT [ResearchPaper_year_ck] CHECK ([publicationYear] IS NULL OR [publicationYear] BETWEEN 1 AND 9999);
ALTER TABLE [dbo].[ResearchPaper] ADD CONSTRAINT [ResearchPaper_date_ck] CHECK ([publishedOn] IS NULL OR [publicationYear] = YEAR([publishedOn]));
ALTER TABLE [dbo].[ResearchPaper] ADD CONSTRAINT [ResearchPaper_document_ck] CHECK ([document] IS NULL OR (ISJSON([document]) = 1 AND DATALENGTH([document]) <= 1000000));
ALTER TABLE [dbo].[ResearchPaperLabel] ADD CONSTRAINT [ResearchPaperLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[ResearchPaperLabel] ADD CONSTRAINT [ResearchPaperLabel_title_ck] CHECK (LEN([title]) > 0);
ALTER TABLE [dbo].[ResearchPaperContributor] ADD CONSTRAINT [ResearchPaperContributor_role_ck] CHECK ([role] IN (N'author',N'translator',N'editor',N'compiler',N'narrator',N'reciter',N'speaker'));
ALTER TABLE [dbo].[ResearchPaperContributor] ADD CONSTRAINT [ResearchPaperContributor_position_ck] CHECK ([position] BETWEEN 0 AND 23);
ALTER TABLE [dbo].[Publication] ADD CONSTRAINT [Publication_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[Publication] ADD CONSTRAINT [Publication_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[Publication] ADD CONSTRAINT [Publication_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[Publication] ADD CONSTRAINT [Publication_slug_ck] CHECK (LEN([slug]) >= 2);
ALTER TABLE [dbo].[Publication] ADD CONSTRAINT [Publication_year_ck] CHECK ([publicationYear] IS NULL OR [publicationYear] BETWEEN 1 AND 9999);
ALTER TABLE [dbo].[Publication] ADD CONSTRAINT [Publication_date_ck] CHECK ([publishedOn] IS NULL OR [publicationYear] = YEAR([publishedOn]));
ALTER TABLE [dbo].[Publication] ADD CONSTRAINT [Publication_document_ck] CHECK ([document] IS NULL OR (ISJSON([document]) = 1 AND DATALENGTH([document]) <= 1000000));
ALTER TABLE [dbo].[PublicationLabel] ADD CONSTRAINT [PublicationLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[PublicationLabel] ADD CONSTRAINT [PublicationLabel_title_ck] CHECK (LEN([title]) > 0);
ALTER TABLE [dbo].[PublicationContributor] ADD CONSTRAINT [PublicationContributor_role_ck] CHECK ([role] IN (N'author',N'translator',N'editor',N'compiler',N'narrator',N'reciter',N'speaker'));
ALTER TABLE [dbo].[PublicationContributor] ADD CONSTRAINT [PublicationContributor_position_ck] CHECK ([position] BETWEEN 0 AND 23);
ALTER TABLE [dbo].[Magazine] ADD CONSTRAINT [Magazine_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[Magazine] ADD CONSTRAINT [Magazine_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[Magazine] ADD CONSTRAINT [Magazine_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[Magazine] ADD CONSTRAINT [Magazine_slug_ck] CHECK (LEN([slug]) >= 2);
ALTER TABLE [dbo].[MagazineLabel] ADD CONSTRAINT [MagazineLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[MagazineLabel] ADD CONSTRAINT [MagazineLabel_title_ck] CHECK (LEN([title]) > 0);
ALTER TABLE [dbo].[MagazineContributor] ADD CONSTRAINT [MagazineContributor_role_ck] CHECK ([role] IN (N'author',N'translator',N'editor',N'compiler',N'narrator',N'reciter',N'speaker'));
ALTER TABLE [dbo].[MagazineContributor] ADD CONSTRAINT [MagazineContributor_position_ck] CHECK ([position] BETWEEN 0 AND 23);
ALTER TABLE [dbo].[MagazineIssue] ADD CONSTRAINT [MagazineIssue_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[MagazineIssue] ADD CONSTRAINT [MagazineIssue_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[MagazineIssue] ADD CONSTRAINT [MagazineIssue_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[MagazineIssue] ADD CONSTRAINT [MagazineIssue_slug_ck] CHECK (LEN([slug]) >= 2);
ALTER TABLE [dbo].[MagazineIssue] ADD CONSTRAINT [MagazineIssue_year_ck] CHECK ([publicationYear] IS NULL OR [publicationYear] BETWEEN 1 AND 9999);
ALTER TABLE [dbo].[MagazineIssue] ADD CONSTRAINT [MagazineIssue_date_ck] CHECK ([publishedOn] IS NULL OR [publicationYear] = YEAR([publishedOn]));
ALTER TABLE [dbo].[MagazineIssue] ADD CONSTRAINT [MagazineIssue_document_ck] CHECK ([document] IS NULL OR (ISJSON([document]) = 1 AND DATALENGTH([document]) <= 1000000));
ALTER TABLE [dbo].[MagazineIssueLabel] ADD CONSTRAINT [MagazineIssueLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[MagazineIssueLabel] ADD CONSTRAINT [MagazineIssueLabel_title_ck] CHECK (LEN([title]) > 0);
ALTER TABLE [dbo].[MagazineIssueContributor] ADD CONSTRAINT [MagazineIssueContributor_role_ck] CHECK ([role] IN (N'author',N'translator',N'editor',N'compiler',N'narrator',N'reciter',N'speaker'));
ALTER TABLE [dbo].[MagazineIssueContributor] ADD CONSTRAINT [MagazineIssueContributor_position_ck] CHECK ([position] BETWEEN 0 AND 23);
ALTER TABLE [dbo].[Encyclopedia] ADD CONSTRAINT [Encyclopedia_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[Encyclopedia] ADD CONSTRAINT [Encyclopedia_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[Encyclopedia] ADD CONSTRAINT [Encyclopedia_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[Encyclopedia] ADD CONSTRAINT [Encyclopedia_slug_ck] CHECK (LEN([slug]) >= 2);
ALTER TABLE [dbo].[Encyclopedia] ADD CONSTRAINT [Encyclopedia_year_ck] CHECK ([publicationYear] IS NULL OR [publicationYear] BETWEEN 1 AND 9999);
ALTER TABLE [dbo].[Encyclopedia] ADD CONSTRAINT [Encyclopedia_date_ck] CHECK ([publishedOn] IS NULL OR [publicationYear] = YEAR([publishedOn]));
ALTER TABLE [dbo].[Encyclopedia] ADD CONSTRAINT [Encyclopedia_document_ck] CHECK ([document] IS NULL OR (ISJSON([document]) = 1 AND DATALENGTH([document]) <= 1000000));
ALTER TABLE [dbo].[EncyclopediaLabel] ADD CONSTRAINT [EncyclopediaLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[EncyclopediaLabel] ADD CONSTRAINT [EncyclopediaLabel_title_ck] CHECK (LEN([title]) > 0);
ALTER TABLE [dbo].[EncyclopediaContributor] ADD CONSTRAINT [EncyclopediaContributor_role_ck] CHECK ([role] IN (N'author',N'translator',N'editor',N'compiler',N'narrator',N'reciter',N'speaker'));
ALTER TABLE [dbo].[EncyclopediaContributor] ADD CONSTRAINT [EncyclopediaContributor_position_ck] CHECK ([position] BETWEEN 0 AND 23);
ALTER TABLE [dbo].[Research] ADD CONSTRAINT [Research_text_ck] CHECK (([abstract] IS NULL OR LEN([abstract]) > 0) AND ([institutionalContext] IS NULL OR LEN([institutionalContext]) > 0));
ALTER TABLE [dbo].[ResearchCitation] ADD CONSTRAINT [ResearchCitation_position_ck] CHECK ([position] BETWEEN 0 AND 99);
ALTER TABLE [dbo].[ResearchCitation] ADD CONSTRAINT [ResearchCitation_text_ck] CHECK (LEN([text]) > 0);
ALTER TABLE [dbo].[ResearchCitation] ADD CONSTRAINT [ResearchCitation_url_ck] CHECK ([url] IS NULL OR [url] LIKE N'https://_%');
ALTER TABLE [dbo].[ResearchCitation] ADD CONSTRAINT [ResearchCitation_doi_ck] CHECK ([doi] IS NULL OR [doi] LIKE N'10.%/_%');
ALTER TABLE [dbo].[ResearchPaper] ADD CONSTRAINT [ResearchPaper_text_ck] CHECK (([abstract] IS NULL OR LEN([abstract]) > 0) AND ([institutionalContext] IS NULL OR LEN([institutionalContext]) > 0));
ALTER TABLE [dbo].[ResearchPaperCitation] ADD CONSTRAINT [ResearchPaperCitation_position_ck] CHECK ([position] BETWEEN 0 AND 99);
ALTER TABLE [dbo].[ResearchPaperCitation] ADD CONSTRAINT [ResearchPaperCitation_text_ck] CHECK (LEN([text]) > 0);
ALTER TABLE [dbo].[ResearchPaperCitation] ADD CONSTRAINT [ResearchPaperCitation_url_ck] CHECK ([url] IS NULL OR [url] LIKE N'https://_%');
ALTER TABLE [dbo].[ResearchPaperCitation] ADD CONSTRAINT [ResearchPaperCitation_doi_ck] CHECK ([doi] IS NULL OR [doi] LIKE N'10.%/_%');
ALTER TABLE [dbo].[ResearchPaper] ADD CONSTRAINT [ResearchPaper_venue_ck] CHECK (([venue] IS NULL OR LEN([venue]) > 0) AND ([doi] IS NULL OR [doi] LIKE N'10.%/_%'));
ALTER TABLE [dbo].[Publication] ADD CONSTRAINT [Publication_publisher_ck] CHECK ([publisher] IS NULL OR LEN([publisher]) > 0);
ALTER TABLE [dbo].[Encyclopedia] ADD CONSTRAINT [Encyclopedia_publisher_ck] CHECK ([publisher] IS NULL OR LEN([publisher]) > 0);
ALTER TABLE [dbo].[MagazineIssue] ADD CONSTRAINT [MagazineIssue_numbers_ck] CHECK (([volume] IS NULL OR [volume] BETWEEN 1 AND 100000) AND ([issueNumber] IS NULL OR [issueNumber] BETWEEN 1 AND 100000));

-- ---------------------------------------------------------------------------
-- Permanent slug reservation (DOMAIN_MODEL.md 19.7), made by the DATABASE for
-- the same reasons the Work trigger gives (Phase 8): no writer can skip it, and
-- the check and the write cannot race. A slug returning to the SAME record is
-- not reuse; the same spelling on ANOTHER record is refused by the primary key.
--
-- AN ISSUE'S NAMESPACE IS ITS MAGAZINE, and the issue can never leave it: every
-- reservation carries a composite foreign key to (issue, Magazine), and an issue
-- always holds at least its first reservation, so moving it to another Magazine
-- is refused by referential integrity before anything else runs.
-- ---------------------------------------------------------------------------
EXEC(N'CREATE TRIGGER [dbo].[LibraryReserveResearchSlug] ON [dbo].[Research] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[ResearchSlugHistory] ([slug],[researchId])
 SELECT i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[ResearchSlugHistory] h
     WHERE h.[slug] = i.[slug] AND h.[researchId] = i.[id]
   );
END');
EXEC(N'CREATE TRIGGER [dbo].[LibraryReserveResearchPaperSlug] ON [dbo].[ResearchPaper] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[ResearchPaperSlugHistory] ([slug],[researchPaperId])
 SELECT i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[ResearchPaperSlugHistory] h
     WHERE h.[slug] = i.[slug] AND h.[researchPaperId] = i.[id]
   );
END');
EXEC(N'CREATE TRIGGER [dbo].[LibraryReservePublicationSlug] ON [dbo].[Publication] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[PublicationSlugHistory] ([slug],[publicationId])
 SELECT i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[PublicationSlugHistory] h
     WHERE h.[slug] = i.[slug] AND h.[publicationId] = i.[id]
   );
END');
EXEC(N'CREATE TRIGGER [dbo].[LibraryReserveMagazineSlug] ON [dbo].[Magazine] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[MagazineSlugHistory] ([slug],[magazineId])
 SELECT i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[MagazineSlugHistory] h
     WHERE h.[slug] = i.[slug] AND h.[magazineId] = i.[id]
   );
END');
EXEC(N'CREATE TRIGGER [dbo].[LibraryReserveEncyclopediaSlug] ON [dbo].[Encyclopedia] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[EncyclopediaSlugHistory] ([slug],[encyclopediaId])
 SELECT i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[EncyclopediaSlugHistory] h
     WHERE h.[slug] = i.[slug] AND h.[encyclopediaId] = i.[id]
   );
END');
EXEC(N'CREATE TRIGGER [dbo].[LibraryReserveMagazineIssueSlug] ON [dbo].[MagazineIssue] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[MagazineIssueSlugHistory] ([magazineId],[slug],[magazineIssueId])
 SELECT i.[magazineId],i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[MagazineIssueSlugHistory] h
     WHERE h.[magazineId] = i.[magazineId] AND h.[slug] = i.[slug] AND h.[magazineIssueId] = i.[id]
   );
END');

-- ---------------------------------------------------------------------------
-- Search (Phase 17) — the Phase-9 kinds, each its own scope.
--
-- The Phase-17 constraints named the initial inventory exactly; a later
-- searchable domain widens them in its own migration, never by pre-creation.
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[SearchIndexRequest] DROP CONSTRAINT [SearchIndexRequest_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexRequest] ADD CONSTRAINT [SearchIndexRequest_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia'));
ALTER TABLE [dbo].[SearchIndexScope] DROP CONSTRAINT [SearchIndexScope_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia'));
ALTER TABLE [dbo].[SearchDocument] DROP CONSTRAINT [SearchDocument_kind_ck];
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_kind_ck] CHECK ([kind] IN (N'topic',N'person',N'article',N'page',N'work',N'edition',N'book-translation',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia'));
-- `SearchDocument_scope_ck` needs no change: every kind added here is projected
-- only within its own scope, which is what that constraint already requires of
-- every kind other than an Edition or a translation.

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
