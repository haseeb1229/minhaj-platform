-- ===========================================================================
-- Phase 14 — Editorial: Event and EventSchedule
-- ===========================================================================
--
-- ONE EDITORIAL AGGREGATE (DOMAIN_MODEL.md 7.1) with the Article's shape of
-- tables — record, immutable revisions, localized revision translations, typed
-- Topic and Person references and a permanent slug namespace — governed by the
-- shared workflow and refused by the same constraints and triggers as Phase 6
-- and Phase 13. An Event is not News: an Event occurs, News reports on it.
--
-- WHAT AN EVENT OWNS IS REVISION STATE. Its zone, its occurrences
-- (EventSchedule), the ONE Global Network Centre it is held at and its ordered
-- Media Galleries (EventGallery) belong to an immutable revision, so changing
-- when or where a published Event happens is an ordinary edit: a new
-- revision, back to draft, fresh independent review.
--
-- TIME. Each occurrence stores the intended LOCAL wall-clock time in the
-- revision's IANA zone — the fact — and the UTC instant the application derived
-- from it. An end, where there is one, is strictly after the start. No offset
-- is ever stored as a zone, and no date is faked as midnight UTC.
--
-- TWO TYPED REFERENCES INTO OTHER OWNERS, AND NEITHER CASCADES. The revision's
-- `centreId` names a Global-owned Centre; `EventGallery.galleryId` names a
-- Media-owned Gallery. Both are real foreign keys with NO ACTION: archiving a
-- Centre or a Gallery changes no Event, and no Event row can delete either.
-- Editorial owns the association rows; Global and Media own no Event schema.
--
-- ITS OWN REFUSAL NUMBERS, 51140-51146, in Phase 6's order: immutable history,
-- no extension of a historical revision, a valid current revision without
-- self-approval, a reserved canonical slug, revision sequence, no rewind — and
-- 51146: a current Event revision always has at least one occurrence, so no
-- Event can be published or scheduled without a genuine schedule.
--
-- APPEND-ONLY. Nothing below edits an accepted migration. No search vocabulary
-- is widened — Events are not searchable in this phase — and no permission is
-- added: the two editorial keys whose descriptions name the families now name
-- Events too.

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Event] (
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
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Event_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Event_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Event_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[EventRevision] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [number] INT NOT NULL,
    [editorId] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLanguage] NVARCHAR(16) NOT NULL,
    [schemaVersion] INT NOT NULL CONSTRAINT [EventRevision_schemaVersion_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [EventRevision_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [timezone] NVARCHAR(64) NOT NULL,
    [centreId] NVARCHAR(36),
    CONSTRAINT [EventRevision_pkey] PRIMARY KEY CLUSTERED ([ownerId],[number])
);

-- CreateTable
CREATE TABLE [dbo].[EventRevisionTranslation] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [excerpt] NVARCHAR(600) NOT NULL,
    [seoTitle] NVARCHAR(200) NOT NULL,
    [seoDescription] NVARCHAR(300) NOT NULL,
    [document] NVARCHAR(max) NOT NULL,
    [html] NVARCHAR(max) NOT NULL,
    CONSTRAINT [EventRevisionTranslation_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[languageCode])
);

-- CreateTable
CREATE TABLE [dbo].[EventTopic] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [EventTopic_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[topicId])
);

-- CreateTable
CREATE TABLE [dbo].[EventContributor] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(32) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [EventContributor_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[personId],[role])
);

-- CreateTable
CREATE TABLE [dbo].[EventSchedule] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [position] INT NOT NULL,
    [startsLocal] DATETIME2 NOT NULL,
    [startsAt] DATETIME2 NOT NULL,
    [endsLocal] DATETIME2,
    [endsAt] DATETIME2,
    CONSTRAINT [EventSchedule_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[position]),
    CONSTRAINT [EventSchedule_ownerId_revisionNumber_startsAt_key] UNIQUE NONCLUSTERED ([ownerId],[revisionNumber],[startsAt])
);

-- CreateTable
CREATE TABLE [dbo].[EventGallery] (
    [ownerId] NVARCHAR(36) NOT NULL,
    [revisionNumber] INT NOT NULL,
    [position] INT NOT NULL,
    [galleryId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [EventGallery_pkey] PRIMARY KEY CLUSTERED ([ownerId],[revisionNumber],[position]),
    CONSTRAINT [EventGallery_ownerId_revisionNumber_galleryId_key] UNIQUE NONCLUSTERED ([ownerId],[revisionNumber],[galleryId])
);

-- CreateTable
CREATE TABLE [dbo].[EventSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [ownerId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [EventSlugHistory_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [EventSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Event_state_updatedAt_id_idx] ON [dbo].[Event]([state], [updatedAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Event_state_publishedAt_id_idx] ON [dbo].[Event]([state], [publishedAt] DESC, [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Event_scheduleStatus_scheduledAt_id_idx] ON [dbo].[Event]([scheduleStatus], [scheduledAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EventRevision_centreId_ownerId_number_idx] ON [dbo].[EventRevision]([centreId], [ownerId], [number]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EventTopic_topicId_ownerId_idx] ON [dbo].[EventTopic]([topicId], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EventContributor_personId_ownerId_idx] ON [dbo].[EventContributor]([personId], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EventGallery_galleryId_ownerId_idx] ON [dbo].[EventGallery]([galleryId], [ownerId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EventSlugHistory_ownerId_idx] ON [dbo].[EventSlugHistory]([ownerId]);

-- AddForeignKey
ALTER TABLE [dbo].[Event] ADD CONSTRAINT [Event_creatorId_fkey] FOREIGN KEY ([creatorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Event] ADD CONSTRAINT [Event_approvedById_fkey] FOREIGN KEY ([approvedById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Event] ADD CONSTRAINT [Event_scheduledById_fkey] FOREIGN KEY ([scheduledById]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Event] ADD CONSTRAINT [Event_id_currentRevision_fkey] FOREIGN KEY ([id], [currentRevision]) REFERENCES [dbo].[EventRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Event] ADD CONSTRAINT [Event_id_approvedRevision_fkey] FOREIGN KEY ([id], [approvedRevision]) REFERENCES [dbo].[EventRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Event] ADD CONSTRAINT [Event_id_scheduledRevision_fkey] FOREIGN KEY ([id], [scheduledRevision]) REFERENCES [dbo].[EventRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EventRevision] ADD CONSTRAINT [EventRevision_centreId_fkey] FOREIGN KEY ([centreId]) REFERENCES [dbo].[Centre]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EventRevision] ADD CONSTRAINT [EventRevision_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[Event]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EventRevision] ADD CONSTRAINT [EventRevision_editorId_fkey] FOREIGN KEY ([editorId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EventRevisionTranslation] ADD CONSTRAINT [EventRevisionTranslation_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[EventRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EventRevisionTranslation] ADD CONSTRAINT [EventRevisionTranslation_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EventTopic] ADD CONSTRAINT [EventTopic_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[EventRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EventTopic] ADD CONSTRAINT [EventTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EventContributor] ADD CONSTRAINT [EventContributor_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[EventRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EventContributor] ADD CONSTRAINT [EventContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EventSchedule] ADD CONSTRAINT [EventSchedule_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[EventRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EventGallery] ADD CONSTRAINT [EventGallery_ownerId_revisionNumber_fkey] FOREIGN KEY ([ownerId], [revisionNumber]) REFERENCES [dbo].[EventRevision]([ownerId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EventGallery] ADD CONSTRAINT [EventGallery_galleryId_fkey] FOREIGN KEY ([galleryId]) REFERENCES [dbo].[Gallery]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[EventSlugHistory] ADD CONSTRAINT [EventSlugHistory_ownerId_fkey] FOREIGN KEY ([ownerId]) REFERENCES [dbo].[Event]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- Event: the Article's workflow invariants, refused by the database
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[Event] ADD CONSTRAINT [Event_state_ck] CHECK ([state] IN ('draft','in-review','scheduled','published','archived'));
ALTER TABLE [dbo].[Event] ADD CONSTRAINT [Event_version_ck] CHECK ([version]>0 AND ([currentRevision] IS NULL OR [currentRevision]>0));
ALTER TABLE [dbo].[Event] ADD CONSTRAINT [Event_approval_ck] CHECK (([approvedRevision] IS NULL AND [approvedById] IS NULL) OR ([approvedRevision] IS NOT NULL AND [approvedById] IS NOT NULL AND [currentRevision] IS NOT NULL AND [approvedRevision]=[currentRevision] AND [approvedById]<>[creatorId]));
ALTER TABLE [dbo].[Event] ADD CONSTRAINT [Event_publication_ck] CHECK ([state] NOT IN ('scheduled','published') OR ([approvedRevision] IS NOT NULL AND [currentRevision] IS NOT NULL AND [approvedRevision]=[currentRevision]));
ALTER TABLE [dbo].[Event] ADD CONSTRAINT [Event_published_date_ck] CHECK ([state]<>'published' OR [publishedAt] IS NOT NULL);
ALTER TABLE [dbo].[Event] ADD CONSTRAINT [Event_schedule_ck] CHECK ([state]<>'scheduled' OR ([scheduledRevision] IS NOT NULL AND [scheduledRevision]=[currentRevision] AND [scheduledAt] IS NOT NULL AND [scheduledById] IS NOT NULL AND [scheduledTimezone] IS NOT NULL AND [scheduleStatus] IN ('pending','authority-revoked','execution-failed')));
ALTER TABLE [dbo].[EventRevision] ADD CONSTRAINT [EventRevision_schema_ck] CHECK ([schemaVersion]=1 AND [number]>0);
-- A zone NAME — `UTC` or `Area/Location` — never an offset such as `+05:00`
-- or `GMT+5`. The application canonicalises it against the runtime's IANA data.
ALTER TABLE [dbo].[EventRevision] ADD CONSTRAINT [EventRevision_timezone_ck] CHECK ([timezone]=N'UTC' OR ([timezone] LIKE N'_%/_%' AND [timezone] NOT LIKE N'%[ :]%' AND [timezone] NOT LIKE N'Etc/%'));
ALTER TABLE [dbo].[EventRevisionTranslation] ADD CONSTRAINT [EventTranslation_size_ck] CHECK (DATALENGTH([document])<=400000 AND DATALENGTH([html])<=800000 AND ISJSON([document])=1);
ALTER TABLE [dbo].[EventContributor] ADD CONSTRAINT [EventContributor_role_ck] CHECK ([role] IN (N'author',N'translator',N'editor',N'compiler',N'narrator',N'reciter',N'speaker'));
ALTER TABLE [dbo].[EventContributor] ADD CONSTRAINT [EventContributor_position_ck] CHECK ([position] BETWEEN 0 AND 11);
-- An occurrence: twelve places at most; whole minutes; an end, where there is
-- one, as both a local time and an instant strictly after the start; and an
-- offset between local and UTC no zone on Earth exceeds.
ALTER TABLE [dbo].[EventSchedule] ADD CONSTRAINT [EventSchedule_position_ck] CHECK ([position] BETWEEN 0 AND 11);
ALTER TABLE [dbo].[EventSchedule] ADD CONSTRAINT [EventSchedule_minute_ck] CHECK (DATEPART(SECOND,[startsLocal])=0 AND DATEPART(NANOSECOND,[startsLocal])=0 AND DATEPART(SECOND,[startsAt])=0 AND DATEPART(NANOSECOND,[startsAt])=0 AND ([endsLocal] IS NULL OR (DATEPART(SECOND,[endsLocal])=0 AND DATEPART(NANOSECOND,[endsLocal])=0)) AND ([endsAt] IS NULL OR (DATEPART(SECOND,[endsAt])=0 AND DATEPART(NANOSECOND,[endsAt])=0)));
ALTER TABLE [dbo].[EventSchedule] ADD CONSTRAINT [EventSchedule_end_ck] CHECK (([endsLocal] IS NULL AND [endsAt] IS NULL) OR ([endsLocal] IS NOT NULL AND [endsAt] IS NOT NULL AND [endsAt]>[startsAt]));
ALTER TABLE [dbo].[EventSchedule] ADD CONSTRAINT [EventSchedule_offset_ck] CHECK (ABS(DATEDIFF(MINUTE,[startsAt],[startsLocal]))<=1080 AND ([endsAt] IS NULL OR ABS(DATEDIFF(MINUTE,[endsAt],[endsLocal]))<=1080));
ALTER TABLE [dbo].[EventGallery] ADD CONSTRAINT [EventGallery_position_ck] CHECK ([position] BETWEEN 0 AND 11);
EXEC sp_executesql N'CREATE TRIGGER [dbo].[EventRevisionImmutable] ON [dbo].[EventRevision] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51140, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[EventRevisionTranslationImmutable] ON [dbo].[EventRevisionTranslation] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51140, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[EventTopicImmutable] ON [dbo].[EventTopic] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51140, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[EventContributorImmutable] ON [dbo].[EventContributor] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51140, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[EventScheduleImmutable] ON [dbo].[EventSchedule] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51140, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[EventGalleryImmutable] ON [dbo].[EventGallery] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51140, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[EventSlugHistoryImmutable] ON [dbo].[EventSlugHistory] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51140, ''Editorial history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[EventRevisionTranslationAppend] ON [dbo].[EventRevisionTranslation] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Event] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51141, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[EventTopicAppend] ON [dbo].[EventTopic] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Event] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51141, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[EventContributorAppend] ON [dbo].[EventContributor] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Event] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51141, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[EventScheduleAppend] ON [dbo].[EventSchedule] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Event] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51141, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[EventGalleryAppend] ON [dbo].[EventGallery] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Event] a ON a.id=i.ownerId WHERE i.revisionNumber<=COALESCE(a.currentRevision,0)) THROW 51141, ''A historical revision cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[EventCurrentIntegrity] ON [dbo].[Event] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[EventRevision] r ON r.ownerId=i.id AND r.number=i.currentRevision WHERE r.slug<>i.slug OR NOT EXISTS (SELECT 1 FROM [dbo].[EventRevisionTranslation] t WHERE t.ownerId=r.ownerId AND t.revisionNumber=r.number AND t.languageCode=r.primaryLanguage) OR (i.approvedById IS NOT NULL AND i.approvedById=r.editorId)) THROW 51142, ''Invalid current revision or self approval.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE i.currentRevision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [dbo].[EventSlugHistory] h WHERE h.ownerId=i.id AND h.slug=i.slug )) THROW 51143, ''Canonical slug must be reserved.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE i.currentRevision IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [dbo].[EventSchedule] s WHERE s.ownerId=i.id AND s.revisionNumber=i.currentRevision)) THROW 51146, ''An Event revision must have an occurrence.'', 1;
 END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[EventRevisionSequence] ON [dbo].[EventRevision] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Event] a ON a.id=i.ownerId WHERE i.number<>COALESCE(a.currentRevision,0)+1) THROW 51144, ''Revision must follow the current snapshot.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[EventRevisionForward] ON [dbo].[Event] AFTER UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id WHERE (d.currentRevision IS NOT NULL AND (i.currentRevision IS NULL OR i.currentRevision<d.currentRevision))) THROW 51145, ''Revision history cannot be rewritten.'', 1; END;';

-- ---------------------------------------------------------------------------
-- Permissions: the same editorial keys now govern Events.
-- ---------------------------------------------------------------------------
UPDATE [dbo].[Permission]
SET [description] = N'Read private Article, Page, news, press release, statement, media coverage and event drafts and revisions.'
WHERE [key] = N'content.read';
UPDATE [dbo].[Permission]
SET [description] = N'Create and revise Article, Page, news, press release, statement, media coverage and event drafts and submit them for review.'
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
