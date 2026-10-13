-- ===========================================================================
-- Phase 20 — Fatwa
-- ===========================================================================
--
-- THE FATWA CONTEXT (DOMAIN_MODEL.md 12): FatwaCategory, the private Question,
-- the Fatwa with its immutable revisions, publications and review decisions,
-- typed topic assignment, an anonymous read tally, and Search's `fatwa`
-- vocabulary. Nothing below names Editorial, Quran, Hadith or any other
-- content context. Identity's tables are READ by the authority checks and
-- People's `Person` link by the attribution lookup; neither is written.
--
-- NOTHING IS SEEDED. Not a category, not a question, not a ruling, not an
-- activation, and NOT A GRANT. Which named individuals may triage, answer and
-- publish, and by which process, are open external decisions
-- (OPEN_DECISIONS.md 1.4, 6.3). The three permission keys are catalogued here
-- and bundled into NO role: the protected Platform Administrator bundle is
-- deliberately NOT extended, so a database migrated by this file has no holder
-- of any of them, and no session is invalidated because no authority changed.
--
-- TWO KINDS OF DATA. A QUESTION is private personal data: the runtime reads it
-- only through queries scoped to its asker or to the stage that needs it now,
-- and no public table, search row or audit payload ever holds its text. A
-- FATWA is the public ruling, a sequence of IMMUTABLE revisions each carrying a
-- separate, human-written anonymised public question.
--
-- POSTURES FOR THE APPLICATION PRINCIPAL:
--
--   OPERATOR      FatwaActivation — written by the owner/operator only. With no
--                 row the service accepts no question and publishes nothing.
--
--   WORKFLOW      FatwaQuestion, Fatwa, FatwaRevision, FatwaRevisionTopic,
--                 FatwaPublication, FatwaReviewDecision — written ONLY by the
--                 procedures below, each re-checking the actor's live
--                 permission in SQL; publication and withdrawal also re-check a
--                 live `fatwa-publication` step-up grant. The runtime holds
--                 SELECT and EXECUTE, and no INSERT, UPDATE or DELETE.
--
--   CLASSIFICATION FatwaCategory, FatwaCategoryName — administered through the
--                 Fatwa service under `fatwa.publish`. The slug never changes
--                 and nothing is deleted.
--
--   TALLY         FatwaReadTally — a per-ruling, per-day count, written only by
--                 `FatwaRecordRead`. No account, address or cookie.
--
--   DERIVED       Search's `fatwa` vocabulary.
--
-- REFUSALS 51230-51259, distinct from every earlier phase's.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.

BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- OPERATOR — the service is open only by the operator's activation
-- ===========================================================================

-- A singleton. `fixture` is for disposable proof environments only; an
-- `approved` activation carries the reference to the organisation's evidence.
-- The platform records that reference; it never invents it.
CREATE TABLE [dbo].[FatwaActivation] (
    [id] TINYINT NOT NULL,
    [authority] NVARCHAR(16) NOT NULL,
    [authorisedBy] NVARCHAR(200) NOT NULL,
    [reference] NVARCHAR(400),
    [activatedAt] DATETIME2 NOT NULL CONSTRAINT [FatwaActivation_activatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [FatwaActivation_pkey] PRIMARY KEY CLUSTERED ([id])
);
ALTER TABLE [dbo].[FatwaActivation] ADD CONSTRAINT [FatwaActivation_ck] CHECK ([id]=1 AND [authority] IN (N'fixture',N'approved') AND LEN([authorisedBy])>0);
ALTER TABLE [dbo].[FatwaActivation] ADD CONSTRAINT [FatwaActivation_evidence_ck] CHECK ([authority]<>N'approved' OR ([reference] IS NOT NULL AND LEN([reference])>0));
EXEC sp_executesql N'CREATE TRIGGER [dbo].[FatwaActivationImmutable] ON [dbo].[FatwaActivation] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51230, ''Fatwa activation is immutable.'', 1; END;';

-- ===========================================================================
-- CLASSIFICATION — a domain classification that maps onto one canonical Topic
-- ===========================================================================

CREATE TABLE [dbo].[FatwaCategory] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    [status] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [FatwaCategory_version_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [FatwaCategory_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [FatwaCategory_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [FatwaCategory_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [FatwaCategory_slug_key] UNIQUE NONCLUSTERED ([slug])
);

CREATE TABLE [dbo].[FatwaCategoryName] (
    [categoryId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    CONSTRAINT [FatwaCategoryName_pkey] PRIMARY KEY CLUSTERED ([categoryId],[locale])
);

CREATE NONCLUSTERED INDEX [FatwaCategory_status_position_idx] ON [dbo].[FatwaCategory]([status],[position],[slug]);
CREATE NONCLUSTERED INDEX [FatwaCategory_topicId_idx] ON [dbo].[FatwaCategory]([topicId]);

ALTER TABLE [dbo].[FatwaCategory] ADD CONSTRAINT [FatwaCategory_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaCategoryName] ADD CONSTRAINT [FatwaCategoryName_categoryId_fkey] FOREIGN KEY ([categoryId]) REFERENCES [dbo].[FatwaCategory]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[FatwaCategory] ADD CONSTRAINT [FatwaCategory_slug_ck] CHECK (LEN([slug])>=2 AND [slug] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^a-z0-9-]%' AND [slug] NOT LIKE N'-%' AND [slug] NOT LIKE N'%-' AND [slug] NOT LIKE N'%--%');
ALTER TABLE [dbo].[FatwaCategory] ADD CONSTRAINT [FatwaCategory_ck] CHECK ([status] IN (N'active',N'archived') AND [position] BETWEEN 0 AND 100000 AND [version]>0);
ALTER TABLE [dbo].[FatwaCategoryName] ADD CONSTRAINT [FatwaCategoryName_ck] CHECK ([locale] IN (N'en',N'ur',N'ar') AND LEN([name])>0);

-- A category's identity is fixed once created, and nothing is ever deleted: a
-- published ruling keeps the category it was published under.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[FatwaCategoryIdentity] ON [dbo].[FatwaCategory] AFTER UPDATE, DELETE AS BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted) THROW 51240, ''A Fatwa category is never deleted.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id WHERE CAST(i.slug AS VARBINARY(240))<>CAST(d.slug AS VARBINARY(240)) OR i.version<>d.version+1) THROW 51240, ''A Fatwa category keeps its slug and moves one version at a time.'', 1;
 END;';

-- ===========================================================================
-- WORKFLOW — the private question
-- ===========================================================================

-- The asker's words and the facts the workflow needs, and nothing more: no name,
-- address, phone or other contact detail is copied from the account. The text
-- is erased (`body` NULL, `disposedAt` set) when the asker's account closes.
CREATE TABLE [dbo].[FatwaQuestion] (
    [id] NVARCHAR(36) NOT NULL,
    [askerId] NVARCHAR(36) NOT NULL,
    [body] NVARCHAR(4000),
    [status] NVARCHAR(16) NOT NULL,
    [categoryId] NVARCHAR(36),
    [assigneeId] NVARCHAR(36),
    [triagedById] NVARCHAR(36),
    [triagedAt] DATETIME2,
    [assignedById] NVARCHAR(36),
    [assignedAt] DATETIME2,
    [declinedById] NVARCHAR(36),
    [declinedAt] DATETIME2,
    [answeredAt] DATETIME2,
    [disposedAt] DATETIME2,
    [version] INT NOT NULL,
    [submittedAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [FatwaQuestion_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE NONCLUSTERED INDEX [FatwaQuestion_askerId_idx] ON [dbo].[FatwaQuestion]([askerId],[submittedAt] DESC,[id]);
CREATE NONCLUSTERED INDEX [FatwaQuestion_status_idx] ON [dbo].[FatwaQuestion]([status],[submittedAt],[id]);
CREATE NONCLUSTERED INDEX [FatwaQuestion_assigneeId_idx] ON [dbo].[FatwaQuestion]([assigneeId],[status],[submittedAt]);
CREATE NONCLUSTERED INDEX [FatwaQuestion_disposal_idx] ON [dbo].[FatwaQuestion]([disposedAt],[askerId]);

ALTER TABLE [dbo].[FatwaQuestion] ADD CONSTRAINT [FatwaQuestion_askerId_fkey] FOREIGN KEY ([askerId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaQuestion] ADD CONSTRAINT [FatwaQuestion_categoryId_fkey] FOREIGN KEY ([categoryId]) REFERENCES [dbo].[FatwaCategory]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaQuestion] ADD CONSTRAINT [FatwaQuestion_assigneeId_fkey] FOREIGN KEY ([assigneeId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaQuestion] ADD CONSTRAINT [FatwaQuestion_triagedById_fkey] FOREIGN KEY ([triagedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaQuestion] ADD CONSTRAINT [FatwaQuestion_assignedById_fkey] FOREIGN KEY ([assignedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaQuestion] ADD CONSTRAINT [FatwaQuestion_declinedById_fkey] FOREIGN KEY ([declinedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[FatwaQuestion] ADD CONSTRAINT [FatwaQuestion_status_ck] CHECK ([status] IN (N'submitted',N'triaged',N'assigned',N'answered',N'declined',N'closed'));
-- Text is present exactly until disposal, and is never an empty string.
ALTER TABLE [dbo].[FatwaQuestion] ADD CONSTRAINT [FatwaQuestion_body_ck] CHECK (([disposedAt] IS NULL AND [body] IS NOT NULL AND LEN([body])>0) OR ([disposedAt] IS NOT NULL AND [body] IS NULL));
-- Every status carries the facts that make it true.
ALTER TABLE [dbo].[FatwaQuestion] ADD CONSTRAINT [FatwaQuestion_facts_ck] CHECK (
    [version]>0
    AND ([status]=N'submitted' OR [status] IN (N'declined',N'closed') OR [categoryId] IS NOT NULL)
    AND ([status] NOT IN (N'assigned',N'answered') OR [assigneeId] IS NOT NULL)
    AND ([status]<>N'answered' OR [answeredAt] IS NOT NULL)
    AND ([status]<>N'declined' OR ([declinedAt] IS NOT NULL AND [declinedById] IS NOT NULL))
    AND ([status]<>N'closed' OR [disposedAt] IS NOT NULL)
    AND ([assigneeId] IS NULL OR [assigneeId]<>[askerId]));

-- ===========================================================================
-- WORKFLOW — the ruling, its immutable revisions and their publication
-- ===========================================================================

-- One ruling per question. `slug` may change while it has never been published
-- and freezes at first publication (FatwaSlugFrozen), so a public URL never
-- moves and no slug history is owed. `publishedRevisionId` is the current public
-- revision; `pendingRevisionId` is the one being drafted or reviewed.
CREATE TABLE [dbo].[Fatwa] (
    [id] NVARCHAR(36) NOT NULL,
    [questionId] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [reviewState] NVARCHAR(16),
    [pendingRevisionId] NVARCHAR(36),
    [publishedRevisionId] NVARCHAR(36),
    [firstPublishedAt] DATETIME2,
    [withdrawnAt] DATETIME2,
    [version] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Fatwa_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Fatwa_questionId_key] UNIQUE NONCLUSTERED ([questionId]),
    CONSTRAINT [Fatwa_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- Every revision ever saved, never edited. The original question is not here:
-- `publicQuestion` is a separately written anonymised statement of it.
CREATE TABLE [dbo].[FatwaRevision] (
    [id] NVARCHAR(36) NOT NULL,
    [fatwaId] NVARCHAR(36) NOT NULL,
    [number] INT NOT NULL,
    [title] NVARCHAR(300) NOT NULL,
    [publicQuestion] NVARCHAR(4000) NOT NULL,
    [ruling] NVARCHAR(MAX) NOT NULL,
    [language] NVARCHAR(16) NOT NULL,
    [categoryId] NVARCHAR(36) NOT NULL,
    [correctionReason] NVARCHAR(1000),
    [authorId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    CONSTRAINT [FatwaRevision_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [FatwaRevision_number_key] UNIQUE NONCLUSTERED ([fatwaId],[number]),
    CONSTRAINT [FatwaRevision_owner_key] UNIQUE NONCLUSTERED ([id],[fatwaId])
);

-- The typed FatwaTopic junction of DOMAIN_MODEL.md 6.2, held per revision so a
-- correction is reviewed with its topics and history keeps what was published.
CREATE TABLE [dbo].[FatwaRevisionTopic] (
    [revisionId] NVARCHAR(36) NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [FatwaRevisionTopic_pkey] PRIMARY KEY CLUSTERED ([revisionId],[topicId])
);

-- Each publication of a revision: who, when, under which step-up grant, and
-- the published contributor records the publisher's and the drafter's accounts
-- were linked to at that moment, if any. Never edited.
CREATE TABLE [dbo].[FatwaPublication] (
    [id] NVARCHAR(36) NOT NULL,
    [fatwaId] NVARCHAR(36) NOT NULL,
    [revisionId] NVARCHAR(36) NOT NULL,
    [sequence] INT NOT NULL,
    [publisherId] NVARCHAR(36) NOT NULL,
    [publisherPersonId] NVARCHAR(36),
    [authorPersonId] NVARCHAR(36),
    [stepUpGrantId] NVARCHAR(36) NOT NULL,
    [publishedAt] DATETIME2 NOT NULL,
    CONSTRAINT [FatwaPublication_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [FatwaPublication_sequence_key] UNIQUE NONCLUSTERED ([fatwaId],[sequence]),
    CONSTRAINT [FatwaPublication_revisionId_key] UNIQUE NONCLUSTERED ([revisionId])
);

-- Review decisions other than publication: a return to the drafter, or a
-- withdrawal. The note is private; it never reaches a public page or search.
CREATE TABLE [dbo].[FatwaReviewDecision] (
    [id] NVARCHAR(36) NOT NULL,
    [fatwaId] NVARCHAR(36) NOT NULL,
    [revisionId] NVARCHAR(36) NOT NULL,
    [decision] NVARCHAR(16) NOT NULL,
    [note] NVARCHAR(1000) NOT NULL,
    [actorId] NVARCHAR(36) NOT NULL,
    [stepUpGrantId] NVARCHAR(36),
    [decidedAt] DATETIME2 NOT NULL,
    CONSTRAINT [FatwaReviewDecision_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE NONCLUSTERED INDEX [Fatwa_reviewState_idx] ON [dbo].[Fatwa]([reviewState],[updatedAt],[id]);
CREATE NONCLUSTERED INDEX [Fatwa_public_idx] ON [dbo].[Fatwa]([withdrawnAt],[firstPublishedAt] DESC,[id]);
CREATE NONCLUSTERED INDEX [FatwaRevision_categoryId_idx] ON [dbo].[FatwaRevision]([categoryId]);
CREATE NONCLUSTERED INDEX [FatwaRevisionTopic_topicId_idx] ON [dbo].[FatwaRevisionTopic]([topicId],[revisionId]);
CREATE NONCLUSTERED INDEX [FatwaReviewDecision_fatwaId_idx] ON [dbo].[FatwaReviewDecision]([fatwaId],[decidedAt]);

ALTER TABLE [dbo].[Fatwa] ADD CONSTRAINT [Fatwa_questionId_fkey] FOREIGN KEY ([questionId]) REFERENCES [dbo].[FatwaQuestion]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Fatwa] ADD CONSTRAINT [Fatwa_pendingRevision_fkey] FOREIGN KEY ([pendingRevisionId],[id]) REFERENCES [dbo].[FatwaRevision]([id],[fatwaId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Fatwa] ADD CONSTRAINT [Fatwa_publishedRevision_fkey] FOREIGN KEY ([publishedRevisionId],[id]) REFERENCES [dbo].[FatwaRevision]([id],[fatwaId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaRevision] ADD CONSTRAINT [FatwaRevision_fatwaId_fkey] FOREIGN KEY ([fatwaId]) REFERENCES [dbo].[Fatwa]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaRevision] ADD CONSTRAINT [FatwaRevision_language_fkey] FOREIGN KEY ([language]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaRevision] ADD CONSTRAINT [FatwaRevision_categoryId_fkey] FOREIGN KEY ([categoryId]) REFERENCES [dbo].[FatwaCategory]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaRevision] ADD CONSTRAINT [FatwaRevision_authorId_fkey] FOREIGN KEY ([authorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaRevisionTopic] ADD CONSTRAINT [FatwaRevisionTopic_revisionId_fkey] FOREIGN KEY ([revisionId]) REFERENCES [dbo].[FatwaRevision]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaRevisionTopic] ADD CONSTRAINT [FatwaRevisionTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaPublication] ADD CONSTRAINT [FatwaPublication_revision_fkey] FOREIGN KEY ([revisionId],[fatwaId]) REFERENCES [dbo].[FatwaRevision]([id],[fatwaId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaPublication] ADD CONSTRAINT [FatwaPublication_publisherId_fkey] FOREIGN KEY ([publisherId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaPublication] ADD CONSTRAINT [FatwaPublication_publisherPersonId_fkey] FOREIGN KEY ([publisherPersonId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaPublication] ADD CONSTRAINT [FatwaPublication_authorPersonId_fkey] FOREIGN KEY ([authorPersonId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaReviewDecision] ADD CONSTRAINT [FatwaReviewDecision_revision_fkey] FOREIGN KEY ([revisionId],[fatwaId]) REFERENCES [dbo].[FatwaRevision]([id],[fatwaId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaReviewDecision] ADD CONSTRAINT [FatwaReviewDecision_actorId_fkey] FOREIGN KEY ([actorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- A public address is lowercase ASCII words joined by single hyphens, and never
-- a word the Fatwa section uses as a path — nor `latest` or `popular`, which
-- are query-based views and must never become paths (ROUTE_MAP.md 2.3).
ALTER TABLE [dbo].[Fatwa] ADD CONSTRAINT [Fatwa_slug_ck] CHECK (LEN([slug])>=2 AND [slug] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^a-z0-9-]%' AND [slug] NOT LIKE N'-%' AND [slug] NOT LIKE N'%-' AND [slug] NOT LIKE N'%--%' AND [slug] NOT IN (N'search',N'categories',N'topics',N'how-it-works',N'ask',N'latest',N'popular'));
ALTER TABLE [dbo].[Fatwa] ADD CONSTRAINT [Fatwa_ck] CHECK (
    [version]>0
    AND ([reviewState] IS NULL OR [reviewState] IN (N'drafting',N'in_review',N'returned'))
    AND (([reviewState] IS NULL AND [pendingRevisionId] IS NULL) OR ([reviewState] IS NOT NULL AND [pendingRevisionId] IS NOT NULL))
    AND (([publishedRevisionId] IS NULL AND [firstPublishedAt] IS NULL) OR ([publishedRevisionId] IS NOT NULL AND [firstPublishedAt] IS NOT NULL))
    AND ([withdrawnAt] IS NULL OR ([publishedRevisionId] IS NOT NULL AND [reviewState] IS NULL)));
ALTER TABLE [dbo].[FatwaRevision] ADD CONSTRAINT [FatwaRevision_ck] CHECK (
    [number]>0 AND LEN([title])>0 AND LEN([publicQuestion])>=20 AND LEN([ruling])>=20 AND LEN([ruling])<=40000
    AND ([correctionReason] IS NULL OR LEN([correctionReason])>0));
ALTER TABLE [dbo].[FatwaPublication] ADD CONSTRAINT [FatwaPublication_ck] CHECK ([sequence]>0 AND LEN([stepUpGrantId])>0);
ALTER TABLE [dbo].[FatwaReviewDecision] ADD CONSTRAINT [FatwaReviewDecision_ck] CHECK ([decision] IN (N'returned',N'withdrawn') AND LEN([note])>0 AND ([decision]<>N'withdrawn' OR [stepUpGrantId] IS NOT NULL));

-- History is never rewritten: revisions, their topics, publications and review
-- decisions refuse every UPDATE and DELETE. A correction is a NEW revision.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[FatwaRevisionImmutable] ON [dbo].[FatwaRevision] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51242, ''Fatwa history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[FatwaRevisionTopicImmutable] ON [dbo].[FatwaRevisionTopic] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51242, ''Fatwa history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[FatwaPublicationImmutable] ON [dbo].[FatwaPublication] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51242, ''Fatwa history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[FatwaReviewDecisionImmutable] ON [dbo].[FatwaReviewDecision] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51242, ''Fatwa history is immutable.'', 1; END;';
-- A topic joins only the revision being saved: once a later revision exists, or
-- the revision has been submitted or published, its topics are history.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[FatwaRevisionTopicAppend] ON [dbo].[FatwaRevisionTopic] AFTER INSERT AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[FatwaRevision] r ON r.id=i.revisionId
            JOIN [dbo].[Fatwa] f ON f.id=r.fatwaId
            WHERE f.pendingRevisionId IS NOT NULL AND f.pendingRevisionId<>r.id)
   THROW 51242, ''Fatwa history is immutable.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[FatwaPublication] p ON p.revisionId=i.revisionId)
   THROW 51242, ''Fatwa history is immutable.'', 1;
 END;';
-- A ruling is never deleted; its slug freezes at first publication; the current
-- public revision must be one that was actually published; and a ruling once
-- published or withdrawn never returns to unpublished.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[FatwaIntegrity] ON [dbo].[Fatwa] AFTER UPDATE, DELETE AS BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted) THROW 51242, ''Fatwa history is immutable.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id
            WHERE d.firstPublishedAt IS NOT NULL AND CAST(i.slug AS VARBINARY(240))<>CAST(d.slug AS VARBINARY(240)))
   THROW 51241, ''A published Fatwa keeps its address.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id
            WHERE i.questionId<>d.questionId OR i.version<>d.version+1
               OR (d.publishedRevisionId IS NOT NULL AND i.publishedRevisionId IS NULL)
               OR (d.firstPublishedAt IS NOT NULL AND (i.firstPublishedAt IS NULL OR i.firstPublishedAt<>d.firstPublishedAt))
               OR (d.withdrawnAt IS NOT NULL AND (i.withdrawnAt IS NULL OR i.withdrawnAt<>d.withdrawnAt)))
   THROW 51248, ''A Fatwa changes only through its workflow.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE i.publishedRevisionId IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM [dbo].[FatwaPublication] p WHERE p.revisionId=i.publishedRevisionId))
   THROW 51248, ''A Fatwa changes only through its workflow.'', 1;
 END;';

-- ===========================================================================
-- TALLY — anonymous reads, per ruling per UTC day
-- ===========================================================================

-- What `sort=popular` reads. A row is a count and nothing else: no account,
-- address, cookie, fingerprint or user agent is stored, here or anywhere.
CREATE TABLE [dbo].[FatwaReadTally] (
    [fatwaId] NVARCHAR(36) NOT NULL,
    [day] DATE NOT NULL,
    [reads] INT NOT NULL,
    CONSTRAINT [FatwaReadTally_pkey] PRIMARY KEY CLUSTERED ([fatwaId],[day])
);
CREATE NONCLUSTERED INDEX [FatwaReadTally_day_idx] ON [dbo].[FatwaReadTally]([day],[fatwaId]) INCLUDE ([reads]);
ALTER TABLE [dbo].[FatwaReadTally] ADD CONSTRAINT [FatwaReadTally_fatwaId_fkey] FOREIGN KEY ([fatwaId]) REFERENCES [dbo].[Fatwa]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[FatwaReadTally] ADD CONSTRAINT [FatwaReadTally_ck] CHECK ([reads]>0);

-- ===========================================================================
-- THE WRITE PATH — every workflow change, each re-checking authority in SQL
-- ===========================================================================

-- Does the actor hold this Fatwa permission NOW? A live, unrevoked assignment
-- of an active role carrying the key, held by an active account. Internal: the
-- runtime may not call it, only the procedures below.
EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[FatwaAssertPermission]
  @actorId NVARCHAR(36), @permission NVARCHAR(64)
AS
BEGIN
  SET NOCOUNT ON;
  IF @permission NOT IN (N''question.receive'', N''fatwa.answer'', N''fatwa.publish'')
  OR NOT EXISTS (
    SELECT 1 FROM [dbo].[RoleAssignment] ra
    JOIN [dbo].[Role] r ON r.id = ra.roleId AND r.deactivatedAt IS NULL
    JOIN [dbo].[RolePermission] rp ON rp.roleId = r.id AND rp.permissionKey = @permission
    JOIN [dbo].[User] u ON u.id = ra.userId AND u.status = N''active''
    WHERE ra.userId = @actorId AND ra.revokedAt IS NULL
  )
    THROW 51233, ''Fatwa authority is not held now.'', 1;
END;
';

-- Publication authority: `fatwa.publish` held now AND a live step-up grant for
-- the dedicated `fatwa-publication` purpose, bound to a live session of the
-- same account. No other purpose is accepted.
EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[FatwaAssertPublicationAuthority]
  @actorId NVARCHAR(36), @sessionId NVARCHAR(36), @stepUpGrantId NVARCHAR(36)
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (
    SELECT 1 FROM [dbo].[RoleAssignment] ra
    JOIN [dbo].[Role] r ON r.id = ra.roleId AND r.deactivatedAt IS NULL
    JOIN [dbo].[RolePermission] rp ON rp.roleId = r.id AND rp.permissionKey = N''fatwa.publish''
    JOIN [dbo].[User] u ON u.id = ra.userId AND u.status = N''active''
    WHERE ra.userId = @actorId AND ra.revokedAt IS NULL
  )
  OR NOT EXISTS (
    SELECT 1 FROM [dbo].[StepUpGrant] g
    JOIN [dbo].[Session] s ON s.id = g.sessionId AND s.userId = g.userId AND s.expiresAt > SYSUTCDATETIME()
    WHERE g.id = @stepUpGrantId AND g.userId = @actorId AND g.sessionId = @sessionId
      AND g.purpose = N''fatwa-publication'' AND g.expiresAt > SYSUTCDATETIME()
  )
    THROW 51235, ''Fatwa publication authority is not held now.'', 1;
END;
';

-- An authenticated, active account asks a question — only while the service is
-- activated. The audit names the question, never its words.
EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[FatwaSubmitQuestion]
  @id NVARCHAR(36), @askerId NVARCHAR(36), @body NVARCHAR(4000), @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
  IF NOT EXISTS (SELECT 1 FROM [dbo].[FatwaActivation]) THROW 51231, ''The Fatwa service is not accepting questions.'', 1;
  IF NOT EXISTS (SELECT 1 FROM [dbo].[User] WHERE id = @askerId AND status = N''active'') THROW 51232, ''The asking account is not active.'', 1;
  IF @body IS NULL OR LEN(@body) < 20 THROW 51247, ''The question is not acceptable.'', 1;
  INSERT INTO [dbo].[FatwaQuestion] ([id],[askerId],[body],[status],[version],[submittedAt],[updatedAt])
  VALUES (@id, @askerId, @body, N''submitted'', 1, @at, @at);
  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[afterState],[authorisingSource])
  VALUES (NEWID(), N''user'', @askerId, N''fatwa.question.submitted'', N''fatwa-question'', @id, N''{"status":"submitted"}'', N''asker'');
  COMMIT TRAN;
END;
';

-- Triage: categorise a question still in intake. `question.receive` only.
EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[FatwaTriageQuestion]
  @id NVARCHAR(36), @expectedVersion INT, @categoryId NVARCHAR(36), @actorId NVARCHAR(36), @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
  EXEC [dbo].[FatwaAssertPermission] @actorId, N''question.receive'';
  DECLARE @version INT, @status NVARCHAR(16), @current NVARCHAR(36);
  SELECT @version = version, @status = status, @current = categoryId
  FROM [dbo].[FatwaQuestion] WITH (UPDLOCK, HOLDLOCK) WHERE id = @id;
  IF @version IS NULL THROW 51236, ''The question does not exist.'', 1;
  IF @version <> @expectedVersion THROW 51237, ''The question changed since it was read.'', 1;
  IF @status NOT IN (N''submitted'', N''triaged'', N''assigned'') THROW 51238, ''That step is not open for this question.'', 1;
  IF NOT EXISTS (SELECT 1 FROM [dbo].[FatwaCategory] WHERE id = @categoryId AND status = N''active'') THROW 51240, ''The category is not available.'', 1;
  IF @status <> N''submitted'' AND @current = @categoryId THROW 51238, ''That step is not open for this question.'', 1;
  UPDATE [dbo].[FatwaQuestion]
  SET categoryId = @categoryId,
      status = CASE WHEN status = N''submitted'' THEN N''triaged'' ELSE status END,
      triagedById = @actorId, triagedAt = @at, version = version + 1, updatedAt = @at
  WHERE id = @id;
  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[beforeState],[afterState],[authorisingSource])
  VALUES (NEWID(), N''user'', @actorId, N''fatwa.question.triaged'', N''fatwa-question'', @id,
          N''{"status":"'' + @status + N''","category":"'' + STRING_ESCAPE(ISNULL(@current, N''''), ''json'') + N''"}'',
          N''{"category":"'' + STRING_ESCAPE(@categoryId, ''json'') + N''"}'', N''question.receive'');
  COMMIT TRAN;
END;
';

-- Assignment to an account that holds `fatwa.answer` NOW and is not the asker.
-- A question under scholar review cannot be reassigned mid-review.
EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[FatwaAssignQuestion]
  @id NVARCHAR(36), @expectedVersion INT, @assigneeId NVARCHAR(36), @actorId NVARCHAR(36), @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
  EXEC [dbo].[FatwaAssertPermission] @actorId, N''question.receive'';
  DECLARE @version INT, @status NVARCHAR(16), @current NVARCHAR(36), @askerId NVARCHAR(36);
  SELECT @version = version, @status = status, @current = assigneeId, @askerId = askerId
  FROM [dbo].[FatwaQuestion] WITH (UPDLOCK, HOLDLOCK) WHERE id = @id;
  IF @version IS NULL THROW 51236, ''The question does not exist.'', 1;
  IF @version <> @expectedVersion THROW 51237, ''The question changed since it was read.'', 1;
  IF @status NOT IN (N''triaged'', N''assigned'', N''answered'') THROW 51238, ''That step is not open for this question.'', 1;
  IF EXISTS (SELECT 1 FROM [dbo].[Fatwa] WITH (UPDLOCK, HOLDLOCK) WHERE questionId = @id AND (reviewState = N''in_review'' OR withdrawnAt IS NOT NULL))
    THROW 51238, ''That step is not open for this question.'', 1;
  IF @assigneeId IS NULL OR @assigneeId = @askerId OR (@current IS NOT NULL AND @current = @assigneeId)
    THROW 51239, ''That account cannot be assigned this question.'', 1;
  IF NOT EXISTS (
    SELECT 1 FROM [dbo].[RoleAssignment] ra
    JOIN [dbo].[Role] r ON r.id = ra.roleId AND r.deactivatedAt IS NULL
    JOIN [dbo].[RolePermission] rp ON rp.roleId = r.id AND rp.permissionKey = N''fatwa.answer''
    JOIN [dbo].[User] u ON u.id = ra.userId AND u.status = N''active''
    WHERE ra.userId = @assigneeId AND ra.revokedAt IS NULL
  )
    THROW 51239, ''That account cannot be assigned this question.'', 1;
  UPDATE [dbo].[FatwaQuestion]
  SET assigneeId = @assigneeId, assignedById = @actorId, assignedAt = @at,
      status = CASE WHEN status = N''answered'' THEN status ELSE N''assigned'' END,
      version = version + 1, updatedAt = @at
  WHERE id = @id;
  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[beforeState],[afterState],[authorisingSource])
  VALUES (NEWID(), N''user'', @actorId, N''fatwa.question.assigned'', N''fatwa-question'', @id,
          N''{"assignee":"'' + STRING_ESCAPE(ISNULL(@current, N''''), ''json'') + N''"}'', N''{"assignee":"'' + STRING_ESCAPE(@assigneeId, ''json'') + N''"}'', N''question.receive'');
  COMMIT TRAN;
END;
';

-- Decline a question that has not been answered and is not under review.
EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[FatwaDeclineQuestion]
  @id NVARCHAR(36), @expectedVersion INT, @actorId NVARCHAR(36), @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
  EXEC [dbo].[FatwaAssertPermission] @actorId, N''question.receive'';
  DECLARE @version INT, @status NVARCHAR(16);
  SELECT @version = version, @status = status FROM [dbo].[FatwaQuestion] WITH (UPDLOCK, HOLDLOCK) WHERE id = @id;
  IF @version IS NULL THROW 51236, ''The question does not exist.'', 1;
  IF @version <> @expectedVersion THROW 51237, ''The question changed since it was read.'', 1;
  IF @status NOT IN (N''submitted'', N''triaged'', N''assigned'') THROW 51238, ''That step is not open for this question.'', 1;
  IF EXISTS (SELECT 1 FROM [dbo].[Fatwa] WITH (UPDLOCK, HOLDLOCK) WHERE questionId = @id AND reviewState = N''in_review'')
    THROW 51238, ''That step is not open for this question.'', 1;
  UPDATE [dbo].[FatwaQuestion]
  SET status = N''declined'', declinedById = @actorId, declinedAt = @at, version = version + 1, updatedAt = @at
  WHERE id = @id;
  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[beforeState],[afterState],[authorisingSource])
  VALUES (NEWID(), N''user'', @actorId, N''fatwa.question.declined'', N''fatwa-question'', @id,
          N''{"status":"'' + @status + N''"}'', N''{"status":"declined"}'', N''question.receive'');
  COMMIT TRAN;
END;
';

-- Save a draft: a NEW immutable revision by the account the question is
-- assigned to NOW, holding `fatwa.answer` now. The first save creates the
-- ruling. A revision of an already-published ruling is a correction and must
-- state its public correction reason; a first draft must not.
EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[FatwaSaveDraft]
  @fatwaId NVARCHAR(36), @questionId NVARCHAR(36), @expectedVersion INT, @revisionId NVARCHAR(36),
  @slug NVARCHAR(120), @title NVARCHAR(300), @publicQuestion NVARCHAR(4000), @ruling NVARCHAR(MAX),
  @language NVARCHAR(16), @categoryId NVARCHAR(36), @topicIds NVARCHAR(MAX), @correctionReason NVARCHAR(1000),
  @actorId NVARCHAR(36), @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
  EXEC [dbo].[FatwaAssertPermission] @actorId, N''fatwa.answer'';
  DECLARE @questionStatus NVARCHAR(16), @assigneeId NVARCHAR(36);
  SELECT @questionStatus = status, @assigneeId = assigneeId FROM [dbo].[FatwaQuestion] WITH (UPDLOCK, HOLDLOCK) WHERE id = @questionId;
  IF @questionStatus IS NULL THROW 51236, ''The question does not exist.'', 1;
  IF @assigneeId IS NULL OR @assigneeId <> @actorId THROW 51234, ''The question is not assigned to this account.'', 1;
  IF @questionStatus NOT IN (N''assigned'', N''answered'') THROW 51238, ''That step is not open for this question.'', 1;

  DECLARE @existing NVARCHAR(36), @version INT, @state NVARCHAR(16), @firstPublishedAt DATETIME2, @withdrawnAt DATETIME2, @currentSlug NVARCHAR(120);
  SELECT @existing = id, @version = version, @state = reviewState, @firstPublishedAt = firstPublishedAt,
         @withdrawnAt = withdrawnAt, @currentSlug = slug
  FROM [dbo].[Fatwa] WITH (UPDLOCK, HOLDLOCK) WHERE questionId = @questionId;

  IF @existing IS NULL
  BEGIN
    IF @expectedVersion <> 0 THROW 51237, ''The ruling changed since it was read.'', 1;
    IF @questionStatus <> N''assigned'' THROW 51238, ''That step is not open for this question.'', 1;
  END
  ELSE
  BEGIN
    IF @existing <> @fatwaId OR @version <> @expectedVersion THROW 51237, ''The ruling changed since it was read.'', 1;
    IF @withdrawnAt IS NOT NULL OR @state = N''in_review'' THROW 51238, ''That step is not open for this question.'', 1;
    IF @firstPublishedAt IS NOT NULL AND CAST(@slug AS VARBINARY(240)) <> CAST(@currentSlug AS VARBINARY(240))
      THROW 51241, ''A published Fatwa keeps its address.'', 1;
  END;

  IF (@firstPublishedAt IS NULL AND @correctionReason IS NOT NULL)
  OR (@firstPublishedAt IS NOT NULL AND (@correctionReason IS NULL OR LEN(@correctionReason) = 0))
    THROW 51245, ''A correction states its reason, and only a correction does.'', 1;
  IF NOT EXISTS (SELECT 1 FROM [dbo].[FatwaCategory] WHERE id = @categoryId AND status = N''active'') THROW 51240, ''The category is not available.'', 1;
  IF NOT EXISTS (SELECT 1 FROM [dbo].[Language] WHERE code = @language AND status = N''active'') THROW 51247, ''The ruling is not acceptable.'', 1;
  IF @title IS NULL OR LEN(@title) = 0 OR @publicQuestion IS NULL OR LEN(@publicQuestion) < 20 OR @ruling IS NULL OR LEN(@ruling) < 20 OR LEN(@ruling) > 40000
    THROW 51247, ''The ruling is not acceptable.'', 1;
  IF @topicIds IS NULL OR ISJSON(@topicIds) <> 1 THROW 51247, ''The ruling is not acceptable.'', 1;
  DECLARE @topics TABLE ([topicId] NVARCHAR(36) NOT NULL);
  INSERT INTO @topics ([topicId]) SELECT [value] FROM OPENJSON(@topicIds) WHERE [type] = 1;
  IF (SELECT COUNT(*) FROM OPENJSON(@topicIds)) <> (SELECT COUNT(*) FROM @topics)
  OR (SELECT COUNT(*) FROM @topics) > 10
  OR (SELECT COUNT(DISTINCT topicId) FROM @topics) <> (SELECT COUNT(*) FROM @topics)
  OR EXISTS (SELECT 1 FROM @topics t WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Topic] p WHERE p.id = t.topicId AND p.status = N''active''))
    THROW 51247, ''The ruling is not acceptable.'', 1;

  IF @existing IS NULL
  BEGIN
    INSERT INTO [dbo].[Fatwa] ([id],[questionId],[slug],[version],[createdAt],[updatedAt])
    VALUES (@fatwaId, @questionId, @slug, 1, @at, @at);
    SET @version = 1;
  END;

  DECLARE @number INT = ISNULL((SELECT MAX(number) FROM [dbo].[FatwaRevision] WHERE fatwaId = @fatwaId), 0) + 1;
  INSERT INTO [dbo].[FatwaRevision] ([id],[fatwaId],[number],[title],[publicQuestion],[ruling],[language],[categoryId],[correctionReason],[authorId],[createdAt])
  VALUES (@revisionId, @fatwaId, @number, @title, @publicQuestion, @ruling, @language, @categoryId, @correctionReason, @actorId, @at);
  UPDATE [dbo].[Fatwa]
  SET pendingRevisionId = @revisionId, reviewState = N''drafting'', slug = @slug, version = version + 1, updatedAt = @at
  WHERE id = @fatwaId;
  INSERT INTO [dbo].[FatwaRevisionTopic] ([revisionId],[topicId]) SELECT @revisionId, topicId FROM @topics;

  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[afterState],[authorisingSource])
  VALUES (NEWID(), N''user'', @actorId, N''fatwa.revision.saved'', N''fatwa'', @fatwaId,
          N''{"revision":"'' + STRING_ESCAPE(@revisionId, ''json'') + N''","number":"'' + CONVERT(NVARCHAR(16), @number) + N''","question":"'' + STRING_ESCAPE(@questionId, ''json'') + N''"}'', N''fatwa.answer'');
  COMMIT TRAN;
END;
';

-- Submit the exact pending revision for scholar review.
EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[FatwaSubmitForReview]
  @fatwaId NVARCHAR(36), @expectedVersion INT, @revisionId NVARCHAR(36), @actorId NVARCHAR(36), @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
  EXEC [dbo].[FatwaAssertPermission] @actorId, N''fatwa.answer'';
  DECLARE @version INT, @state NVARCHAR(16), @pending NVARCHAR(36), @questionId NVARCHAR(36), @withdrawnAt DATETIME2;
  SELECT @version = version, @state = reviewState, @pending = pendingRevisionId, @questionId = questionId, @withdrawnAt = withdrawnAt
  FROM [dbo].[Fatwa] WITH (UPDLOCK, HOLDLOCK) WHERE id = @fatwaId;
  IF @version IS NULL THROW 51236, ''The ruling does not exist.'', 1;
  IF NOT EXISTS (SELECT 1 FROM [dbo].[FatwaQuestion] WITH (UPDLOCK, HOLDLOCK)
                 WHERE id = @questionId AND assigneeId = @actorId AND status IN (N''assigned'', N''answered''))
    THROW 51234, ''The question is not assigned to this account.'', 1;
  IF @version <> @expectedVersion THROW 51237, ''The ruling changed since it was read.'', 1;
  IF @withdrawnAt IS NOT NULL OR @state IS NULL OR @state <> N''drafting'' THROW 51238, ''That step is not open for this ruling.'', 1;
  IF @pending <> @revisionId THROW 51244, ''That is not the revision awaiting this step.'', 1;
  UPDATE [dbo].[Fatwa] SET reviewState = N''in_review'', version = version + 1, updatedAt = @at WHERE id = @fatwaId;
  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[afterState],[authorisingSource])
  VALUES (NEWID(), N''user'', @actorId, N''fatwa.revision.submitted'', N''fatwa'', @fatwaId,
          N''{"revision":"'' + STRING_ESCAPE(@revisionId, ''json'') + N''"}'', N''fatwa.answer'');
  COMMIT TRAN;
END;
';

-- Return the exact revision under review to its drafter, with a private note.
EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[FatwaReturnForRevision]
  @fatwaId NVARCHAR(36), @expectedVersion INT, @revisionId NVARCHAR(36), @decisionId NVARCHAR(36),
  @note NVARCHAR(1000), @actorId NVARCHAR(36), @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
  EXEC [dbo].[FatwaAssertPermission] @actorId, N''fatwa.publish'';
  DECLARE @version INT, @state NVARCHAR(16), @pending NVARCHAR(36);
  SELECT @version = version, @state = reviewState, @pending = pendingRevisionId FROM [dbo].[Fatwa] WITH (UPDLOCK, HOLDLOCK) WHERE id = @fatwaId;
  IF @version IS NULL THROW 51236, ''The ruling does not exist.'', 1;
  IF @version <> @expectedVersion THROW 51237, ''The ruling changed since it was read.'', 1;
  IF @state IS NULL OR @state <> N''in_review'' THROW 51238, ''That step is not open for this ruling.'', 1;
  IF @pending <> @revisionId THROW 51244, ''That is not the revision awaiting this step.'', 1;
  IF @note IS NULL OR LEN(@note) = 0 THROW 51247, ''A return states its note.'', 1;
  INSERT INTO [dbo].[FatwaReviewDecision] ([id],[fatwaId],[revisionId],[decision],[note],[actorId],[decidedAt])
  VALUES (@decisionId, @fatwaId, @revisionId, N''returned'', @note, @actorId, @at);
  UPDATE [dbo].[Fatwa] SET reviewState = N''returned'', version = version + 1, updatedAt = @at WHERE id = @fatwaId;
  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[afterState],[authorisingSource])
  VALUES (NEWID(), N''user'', @actorId, N''fatwa.revision.returned'', N''fatwa'', @fatwaId,
          N''{"revision":"'' + STRING_ESCAPE(@revisionId, ''json'') + N''"}'', N''fatwa.publish'');
  COMMIT TRAN;
END;
';

-- THE ONE PUBLICATION OPERATION. Every publication — first or correction, from
-- any surface, any future importer — is this procedure. It re-checks, in one
-- transaction: live `fatwa.publish` and a live `fatwa-publication` step-up
-- grant; an activated service; the expected version; the exact revision under
-- review; that the publisher did not author that revision; and the question's
-- state. Then it records the publication, advances the current public revision,
-- answers the question, owes Search an indexing pass and writes the audit.
EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[FatwaPublishRevision]
  @fatwaId NVARCHAR(36), @expectedVersion INT, @revisionId NVARCHAR(36), @publicationId NVARCHAR(36),
  @actorId NVARCHAR(36), @sessionId NVARCHAR(36), @stepUpGrantId NVARCHAR(36), @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
  EXEC [dbo].[FatwaAssertPublicationAuthority] @actorId, @sessionId, @stepUpGrantId;
  IF NOT EXISTS (SELECT 1 FROM [dbo].[FatwaActivation]) THROW 51231, ''The Fatwa service is not activated.'', 1;
  DECLARE @version INT, @state NVARCHAR(16), @pending NVARCHAR(36), @questionId NVARCHAR(36),
          @firstPublishedAt DATETIME2, @withdrawnAt DATETIME2;
  SELECT @version = version, @state = reviewState, @pending = pendingRevisionId, @questionId = questionId,
         @firstPublishedAt = firstPublishedAt, @withdrawnAt = withdrawnAt
  FROM [dbo].[Fatwa] WITH (UPDLOCK, HOLDLOCK) WHERE id = @fatwaId;
  IF @version IS NULL THROW 51236, ''The ruling does not exist.'', 1;
  IF @version <> @expectedVersion THROW 51237, ''The ruling changed since it was read.'', 1;
  IF @withdrawnAt IS NOT NULL OR @state IS NULL OR @state <> N''in_review'' THROW 51238, ''That step is not open for this ruling.'', 1;
  IF @pending <> @revisionId THROW 51244, ''That is not the revision awaiting this step.'', 1;
  DECLARE @authorId NVARCHAR(36), @categoryId NVARCHAR(36);
  SELECT @authorId = authorId, @categoryId = categoryId FROM [dbo].[FatwaRevision] WHERE id = @revisionId AND fatwaId = @fatwaId;
  IF @authorId = @actorId THROW 51243, ''The author of a revision cannot publish it.'', 1;
  IF NOT EXISTS (SELECT 1 FROM [dbo].[FatwaCategory] WHERE id = @categoryId AND status = N''active'') THROW 51240, ''The category is not available.'', 1;
  DECLARE @questionStatus NVARCHAR(16), @askerId NVARCHAR(36);
  SELECT @questionStatus = status, @askerId = askerId FROM [dbo].[FatwaQuestion] WITH (UPDLOCK, HOLDLOCK) WHERE id = @questionId;
  IF @askerId = @actorId THROW 51243, ''The asker cannot publish the ruling on their own question.'', 1;
  IF (@firstPublishedAt IS NULL AND @questionStatus <> N''assigned'')
  OR (@firstPublishedAt IS NOT NULL AND @questionStatus <> N''answered'')
    THROW 51238, ''That step is not open for this ruling.'', 1;

  DECLARE @publisherPersonId NVARCHAR(36) = (SELECT id FROM [dbo].[Person] WHERE userId = @actorId AND status = N''published'');
  DECLARE @authorPersonId NVARCHAR(36) = (SELECT id FROM [dbo].[Person] WHERE userId = @authorId AND status = N''published'');
  DECLARE @sequence INT = ISNULL((SELECT MAX(sequence) FROM [dbo].[FatwaPublication] WHERE fatwaId = @fatwaId), 0) + 1;

  INSERT INTO [dbo].[FatwaPublication] ([id],[fatwaId],[revisionId],[sequence],[publisherId],[publisherPersonId],[authorPersonId],[stepUpGrantId],[publishedAt])
  VALUES (@publicationId, @fatwaId, @revisionId, @sequence, @actorId, @publisherPersonId, @authorPersonId, @stepUpGrantId, @at);
  UPDATE [dbo].[Fatwa]
  SET publishedRevisionId = @revisionId, pendingRevisionId = NULL, reviewState = NULL,
      firstPublishedAt = ISNULL(firstPublishedAt, @at), version = version + 1, updatedAt = @at
  WHERE id = @fatwaId;
  IF @questionStatus = N''assigned''
    UPDATE [dbo].[FatwaQuestion] SET status = N''answered'', answeredAt = @at, version = version + 1, updatedAt = @at WHERE id = @questionId;
  INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N''fatwa'', @fatwaId);
  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[afterState],[authorisingSource])
  VALUES (NEWID(), N''user'', @actorId, N''fatwa.published'', N''fatwa'', @fatwaId,
          N''{"revision":"'' + STRING_ESCAPE(@revisionId, ''json'') + N''","sequence":"'' + CONVERT(NVARCHAR(16), @sequence) + N''","question":"'' + STRING_ESCAPE(@questionId, ''json'') + N''","permission":"fatwa.publish","stepUp":"fatwa-publication"}'',
          N''step-up:'' + @stepUpGrantId);
  COMMIT TRAN;
END;
';

-- Withdraw a published ruling from public view. History is preserved, the slug
-- stays reserved, Search is owed a pass and its resolver withholds the ruling
-- at once. Same authority as publication.
EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[FatwaWithdraw]
  @fatwaId NVARCHAR(36), @expectedVersion INT, @decisionId NVARCHAR(36), @reason NVARCHAR(1000),
  @actorId NVARCHAR(36), @sessionId NVARCHAR(36), @stepUpGrantId NVARCHAR(36), @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
  EXEC [dbo].[FatwaAssertPublicationAuthority] @actorId, @sessionId, @stepUpGrantId;
  DECLARE @version INT, @published NVARCHAR(36), @withdrawnAt DATETIME2;
  SELECT @version = version, @published = publishedRevisionId, @withdrawnAt = withdrawnAt
  FROM [dbo].[Fatwa] WITH (UPDLOCK, HOLDLOCK) WHERE id = @fatwaId;
  IF @version IS NULL THROW 51236, ''The ruling does not exist.'', 1;
  IF @version <> @expectedVersion THROW 51237, ''The ruling changed since it was read.'', 1;
  IF @published IS NULL OR @withdrawnAt IS NOT NULL THROW 51238, ''That step is not open for this ruling.'', 1;
  IF @reason IS NULL OR LEN(@reason) = 0 THROW 51247, ''A withdrawal states its reason.'', 1;
  INSERT INTO [dbo].[FatwaReviewDecision] ([id],[fatwaId],[revisionId],[decision],[note],[actorId],[stepUpGrantId],[decidedAt])
  VALUES (@decisionId, @fatwaId, @published, N''withdrawn'', @reason, @actorId, @stepUpGrantId, @at);
  UPDATE [dbo].[Fatwa]
  SET withdrawnAt = @at, pendingRevisionId = NULL, reviewState = NULL, version = version + 1, updatedAt = @at
  WHERE id = @fatwaId;
  INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N''fatwa'', @fatwaId);
  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[afterState],[authorisingSource])
  VALUES (NEWID(), N''user'', @actorId, N''fatwa.withdrawn'', N''fatwa'', @fatwaId,
          N''{"revision":"'' + STRING_ESCAPE(@published, ''json'') + N''","permission":"fatwa.publish","stepUp":"fatwa-publication"}'', N''step-up:'' + @stepUpGrantId);
  COMMIT TRAN;
END;
';

-- Fatwa's part of account closure: the private text of a CLOSED account's
-- questions is erased and those still open are closed. Published rulings are
-- untouched — they never held the question. Idempotent and resumable; refused
-- for a named account that is not closed. Returns the number disposed of.
EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[FatwaDisposeQuestions]
  @askerId NVARCHAR(36), @limit INT, @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
  IF @askerId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [dbo].[User] WHERE id = @askerId AND status = N''closed'')
    THROW 51246, ''Only a closed account''''s questions are disposed of.'', 1;
  IF @limit IS NULL OR @limit < 1 OR @limit > 1000 THROW 51247, ''The disposal batch is out of bounds.'', 1;
  DECLARE @disposed TABLE ([id] NVARCHAR(36) NOT NULL);
  UPDATE TOP (@limit) q
  SET body = NULL, disposedAt = @at,
      status = CASE WHEN q.status IN (N''submitted'', N''triaged'', N''assigned'') THEN N''closed'' ELSE q.status END,
      version = q.version + 1, updatedAt = @at
  OUTPUT inserted.id INTO @disposed ([id])
  FROM [dbo].[FatwaQuestion] q WITH (UPDLOCK, HOLDLOCK)
  JOIN [dbo].[User] u ON u.id = q.askerId AND u.status = N''closed''
  WHERE q.disposedAt IS NULL AND (@askerId IS NULL OR q.askerId = @askerId);
  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[afterState],[authorisingSource])
  SELECT NEWID(), N''system'', NULL, N''fatwa.question.disposed'', N''fatwa-question'', id, N''{"body":"erased"}'', N''account-closure''
  FROM @disposed;
  COMMIT TRAN;
  SELECT COUNT(*) AS [disposed] FROM @disposed;
END;
';

-- One anonymous read of a ruling public now, added to today's count. Nothing
-- but the count is stored, and nothing is counted for a ruling not public.
EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[FatwaRecordRead]
  @fatwaId NVARCHAR(36), @day DATE
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
  IF EXISTS (SELECT 1 FROM [dbo].[FatwaActivation])
  AND EXISTS (SELECT 1 FROM [dbo].[Fatwa] WHERE id = @fatwaId AND publishedRevisionId IS NOT NULL AND withdrawnAt IS NULL)
  BEGIN
    UPDATE [dbo].[FatwaReadTally] WITH (UPDLOCK, HOLDLOCK)
    SET reads = reads + 1
    WHERE fatwaId = @fatwaId AND [day] = @day AND reads < 2147483647;
    IF @@ROWCOUNT = 0 AND NOT EXISTS (SELECT 1 FROM [dbo].[FatwaReadTally] WITH (UPDLOCK, HOLDLOCK) WHERE fatwaId = @fatwaId AND [day] = @day)
      INSERT INTO [dbo].[FatwaReadTally] ([fatwaId],[day],[reads]) VALUES (@fatwaId, @day, 1);
  END;
  COMMIT TRAN;
END;
';

-- ===========================================================================
-- SEARCH — the `fatwa` kind, one scope per ruling, its current public revision
-- ===========================================================================
ALTER TABLE [dbo].[SearchIndexRequest] DROP CONSTRAINT [SearchIndexRequest_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexRequest] ADD CONSTRAINT [SearchIndexRequest_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah',N'hadith',N'fatwa'));
ALTER TABLE [dbo].[SearchIndexScope] DROP CONSTRAINT [SearchIndexScope_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah',N'hadith',N'fatwa'));
ALTER TABLE [dbo].[SearchDocument] DROP CONSTRAINT [SearchDocument_kind_ck];
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_kind_ck] CHECK ([kind] IN (N'topic',N'person',N'article',N'page',N'work',N'edition',N'book-translation',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah',N'hadith',N'fatwa'));

-- ===========================================================================
-- PERMISSIONS — catalogued, bundled into no role, granted to nobody
-- ===========================================================================

-- The three keys DOMAIN_MODEL.md 4.4 and OPEN_DECISIONS.md 1.4 / 6.3 name.
-- DELIBERATELY NOT added to the protected Platform Administrator bundle: who
-- holds them is the organisation's decision, so this migration inserts no
-- RolePermission and no RoleAssignment, and no authority changes for anyone.
INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'question.receive', N'Triage incoming private Fatwa questions: read those still in intake, categorise, assign to a current answerer, or decline. Never drafts or publishes.'),
    (N'fatwa.answer', N'Draft and revise the ruling and its separately written anonymised public question for a question currently assigned to you, and submit it for scholar review. Never publishes.'),
    (N'fatwa.publish', N'Review a submitted Fatwa revision, return it, publish it or a correction, or withdraw a ruling, with step-up; and maintain Fatwa categories.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
