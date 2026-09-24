-- ===========================================================================
-- Phase 11 — Media: AudioTrack, AudioSeries
-- ===========================================================================
--
-- TWO MEDIA AGGREGATES (DOMAIN_MODEL.md 8.1, 11): AudioTrack and AudioSeries,
-- each with its own table, its own permanent slug namespace and its own typed
-- relations. A track belongs to at most one AudioSeries (a nullable foreign key
-- with a unique position) and serves at most one Storage Asset (a nullable
-- foreign key). Speakers are People's Person and topics Taxonomy's Topic, each
-- by a real foreign key.
--
-- NON-QURAN AUDIO ONLY. No column can describe a recitation: no reciter, no
-- Surah, Ayah or Juz, no recitation kind. Quran owns Recitation (8.1), and an
-- AudioTrack is never a second place to author one.
--
-- AN AUDIOSERIES IS NOT THE PHASE-10 VIDEO SERIES. It has its own table and its
-- own members; nothing here touches Video, Series or Playlist.
--
-- THE FILE STAYS STORAGE'S. The Asset relation never cascades and no track
-- change deletes, rewrites or moves an Asset row; Storage in turn cannot remove
-- an Asset a track names. No bytes are stored in SQL.
--
-- APPEND-ONLY. Nothing below edits an accepted migration. The Phase-17 search
-- vocabularies are WIDENED by exactly `audio`, as Phase 10 widened them by
-- `video`, and the two existing Media keys are re-described to name what they
-- now cover; no permission is added.

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[AudioTrack] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [durationSeconds] INT,
    [recordedOn] DATE,
    [transcript] NVARCHAR(max),
    [assetId] NVARCHAR(36),
    [seriesId] NVARCHAR(36),
    [seriesPosition] INT,
    [version] INT NOT NULL CONSTRAINT [AudioTrack_version_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [AudioTrack_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [AudioTrack_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AudioTrack_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[AudioTrackLabel] (
    [trackId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [description] NVARCHAR(4000) NOT NULL,
    CONSTRAINT [AudioTrackLabel_pkey] PRIMARY KEY CLUSTERED ([trackId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[AudioTrackSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [trackId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [AudioTrackSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[AudioTrackSpeaker] (
    [trackId] NVARCHAR(36) NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [AudioTrackSpeaker_pkey] PRIMARY KEY CLUSTERED ([trackId],[personId])
);

-- CreateTable
CREATE TABLE [dbo].[AudioTrackTopic] (
    [trackId] NVARCHAR(36) NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [AudioTrackTopic_pkey] PRIMARY KEY CLUSTERED ([trackId],[topicId])
);

-- CreateTable
CREATE TABLE [dbo].[AudioSeries] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [AudioSeries_version_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [AudioSeries_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [AudioSeries_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AudioSeries_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[AudioSeriesLabel] (
    [seriesId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [description] NVARCHAR(4000) NOT NULL,
    CONSTRAINT [AudioSeriesLabel_pkey] PRIMARY KEY CLUSTERED ([seriesId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[AudioSeriesSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [seriesId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [AudioSeriesSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AudioTrack_state_recordedOn_slug_idx] ON [dbo].[AudioTrack]([state], [recordedOn], [slug]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AudioTrack_languageCode_state_idx] ON [dbo].[AudioTrack]([languageCode], [state]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AudioTrackSlugHistory_trackId_idx] ON [dbo].[AudioTrackSlugHistory]([trackId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AudioTrackSpeaker_personId_trackId_idx] ON [dbo].[AudioTrackSpeaker]([personId], [trackId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AudioTrackTopic_topicId_trackId_idx] ON [dbo].[AudioTrackTopic]([topicId], [trackId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AudioSeries_state_slug_idx] ON [dbo].[AudioSeries]([state], [slug]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AudioSeriesSlugHistory_seriesId_idx] ON [dbo].[AudioSeriesSlugHistory]([seriesId]);

-- AddForeignKey
ALTER TABLE [dbo].[AudioTrack] ADD CONSTRAINT [AudioTrack_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AudioTrack] ADD CONSTRAINT [AudioTrack_assetId_fkey] FOREIGN KEY ([assetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AudioTrack] ADD CONSTRAINT [AudioTrack_seriesId_fkey] FOREIGN KEY ([seriesId]) REFERENCES [dbo].[AudioSeries]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AudioTrackLabel] ADD CONSTRAINT [AudioTrackLabel_trackId_fkey] FOREIGN KEY ([trackId]) REFERENCES [dbo].[AudioTrack]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AudioTrackSlugHistory] ADD CONSTRAINT [AudioTrackSlugHistory_trackId_fkey] FOREIGN KEY ([trackId]) REFERENCES [dbo].[AudioTrack]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AudioTrackSpeaker] ADD CONSTRAINT [AudioTrackSpeaker_trackId_fkey] FOREIGN KEY ([trackId]) REFERENCES [dbo].[AudioTrack]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AudioTrackSpeaker] ADD CONSTRAINT [AudioTrackSpeaker_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AudioTrackTopic] ADD CONSTRAINT [AudioTrackTopic_trackId_fkey] FOREIGN KEY ([trackId]) REFERENCES [dbo].[AudioTrack]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AudioTrackTopic] ADD CONSTRAINT [AudioTrackTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AudioSeriesLabel] ADD CONSTRAINT [AudioSeriesLabel_seriesId_fkey] FOREIGN KEY ([seriesId]) REFERENCES [dbo].[AudioSeries]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[AudioSeriesSlugHistory] ADD CONSTRAINT [AudioSeriesSlugHistory_seriesId_fkey] FOREIGN KEY ([seriesId]) REFERENCES [dbo].[AudioSeries]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- A track's place is unique within its AudioSeries, and an Asset serves at most
-- one track. Both FILTERED: a standalone track has no position, and a track
-- with no file yet names no Asset — neither is a duplicate of another.
-- ---------------------------------------------------------------------------
CREATE UNIQUE NONCLUSTERED INDEX [AudioTrack_seriesId_seriesPosition_key]
    ON [dbo].[AudioTrack]([seriesId], [seriesPosition])
    WHERE [seriesId] IS NOT NULL;

CREATE UNIQUE NONCLUSTERED INDEX [AudioTrack_assetId_key]
    ON [dbo].[AudioTrack]([assetId])
    WHERE [assetId] IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Integrity refused by the database, whoever writes: lifecycle, locales, slug,
-- bounds, a series position exactly when there is an AudioSeries, a bounded
-- speaker order — and a PUBLISHED track always has an audio file, so no public
-- track can be a page with nothing to hear.
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[AudioTrack] ADD CONSTRAINT [AudioTrack_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[AudioTrack] ADD CONSTRAINT [AudioTrack_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[AudioTrack] ADD CONSTRAINT [AudioTrack_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[AudioTrack] ADD CONSTRAINT [AudioTrack_slug_ck] CHECK (LEN([slug]) >= 2);
ALTER TABLE [dbo].[AudioTrack] ADD CONSTRAINT [AudioTrack_duration_ck] CHECK ([durationSeconds] IS NULL OR [durationSeconds] BETWEEN 1 AND 360000);
ALTER TABLE [dbo].[AudioTrack] ADD CONSTRAINT [AudioTrack_series_ck] CHECK (
    ([seriesId] IS NULL AND [seriesPosition] IS NULL)
    OR ([seriesId] IS NOT NULL AND [seriesPosition] BETWEEN 1 AND 100000));
ALTER TABLE [dbo].[AudioTrack] ADD CONSTRAINT [AudioTrack_transcript_ck] CHECK ([transcript] IS NULL OR (LEN([transcript]) > 0 AND LEN([transcript]) <= 100000));
ALTER TABLE [dbo].[AudioTrack] ADD CONSTRAINT [AudioTrack_published_ck] CHECK ([state] <> N'published' OR [assetId] IS NOT NULL);
ALTER TABLE [dbo].[AudioTrackLabel] ADD CONSTRAINT [AudioTrackLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[AudioTrackLabel] ADD CONSTRAINT [AudioTrackLabel_title_ck] CHECK (LEN([title]) > 0);
ALTER TABLE [dbo].[AudioTrackSpeaker] ADD CONSTRAINT [AudioTrackSpeaker_position_ck] CHECK ([position] BETWEEN 0 AND 11);
ALTER TABLE [dbo].[AudioSeries] ADD CONSTRAINT [AudioSeries_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[AudioSeries] ADD CONSTRAINT [AudioSeries_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[AudioSeries] ADD CONSTRAINT [AudioSeries_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[AudioSeries] ADD CONSTRAINT [AudioSeries_slug_ck] CHECK (LEN([slug]) >= 2);
ALTER TABLE [dbo].[AudioSeriesLabel] ADD CONSTRAINT [AudioSeriesLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[AudioSeriesLabel] ADD CONSTRAINT [AudioSeriesLabel_title_ck] CHECK (LEN([title]) > 0);

-- ---------------------------------------------------------------------------
-- Permanent slug reservation (DOMAIN_MODEL.md 19.7), made by the DATABASE for
-- the reasons the Library and Video triggers give: no writer can skip it, and
-- the check and the write cannot race. A slug returning to the SAME record is
-- not reuse; the same spelling on ANOTHER record is refused by the primary key.
-- ---------------------------------------------------------------------------
EXEC(N'CREATE TRIGGER [dbo].[MediaReserveAudioTrackSlug] ON [dbo].[AudioTrack] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[AudioTrackSlugHistory] ([slug],[trackId])
 SELECT i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[AudioTrackSlugHistory] h
     WHERE h.[slug] = i.[slug] AND h.[trackId] = i.[id]
   );
END');
EXEC(N'CREATE TRIGGER [dbo].[MediaReserveAudioSeriesSlug] ON [dbo].[AudioSeries] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[AudioSeriesSlugHistory] ([slug],[seriesId])
 SELECT i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[AudioSeriesSlugHistory] h
     WHERE h.[slug] = i.[slug] AND h.[seriesId] = i.[id]
   );
END');

-- ---------------------------------------------------------------------------
-- NO NEW PERMISSION. `media.read` and `media.administer` already are Media's
-- two authorities and already sit in the protected bundle; Audio is Media's, so
-- they now govern it too. Only their DESCRIPTIONS change, so the roles screen
-- tells an administrator the truth about what a key covers. Nothing is added to
-- any role, so no session or step-up grant needs revoking.
-- ---------------------------------------------------------------------------
UPDATE [dbo].[Permission]
SET [description] = N'View Videos, Series, Playlists, audio tracks and audio series, including drafts.'
WHERE [key] = N'media.read';
UPDATE [dbo].[Permission]
SET [description] = N'Create, edit, publish and archive Videos, Series, Playlists, audio tracks and audio series, order Playlists, and upload audio files.'
WHERE [key] = N'media.administer';

-- ---------------------------------------------------------------------------
-- Search (Phase 17) — `audio`, its own kind and its own scope. An AudioSeries
-- is a grouping, not a searchable resource, and adds nothing here.
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[SearchIndexRequest] DROP CONSTRAINT [SearchIndexRequest_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexRequest] ADD CONSTRAINT [SearchIndexRequest_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio'));
ALTER TABLE [dbo].[SearchIndexScope] DROP CONSTRAINT [SearchIndexScope_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio'));
ALTER TABLE [dbo].[SearchDocument] DROP CONSTRAINT [SearchDocument_kind_ck];
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_kind_ck] CHECK ([kind] IN (N'topic',N'person',N'article',N'page',N'work',N'edition',N'book-translation',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio'));
-- `SearchDocument_scope_ck` needs no change: an AudioTrack is projected only
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
