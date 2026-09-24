-- ===========================================================================
-- Phase 10 — Media: Video, Series, Playlist
-- ===========================================================================
--
-- THREE MEDIA AGGREGATES (DOMAIN_MODEL.md 11): Video, Series and Playlist, each
-- with its own table, its own permanent slug namespace and its own typed
-- relations. A Video belongs to at most one Series (a nullable foreign key) and
-- may appear in many Playlists (a typed, ordered, unique membership). Speakers
-- are People's Person and topics Taxonomy's Topic, each by a real foreign key;
-- no generic media table, no polymorphic reference, no Storage relation and no
-- video bytes. Audio, photos and galleries belong to Phases 11 and 12 and have
-- no schema here.
--
-- A PROVIDER IDENTIFIER IS CASE-SENSITIVE, so it is stored under a binary
-- collation: under the database's case-insensitive default, two different
-- YouTube videos whose identifiers differ only in case would collide on the
-- provider uniqueness key.
--
-- APPEND-ONLY. Nothing below edits an accepted migration. The Phase-17 search
-- vocabularies are WIDENED by replacing their CHECK constraints, which is how a
-- later searchable domain adds its own kind (DELIVERY_PLAN.md 3).

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Video] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [isFeatured] BIT NOT NULL CONSTRAINT [Video_isFeatured_df] DEFAULT 0,
    [provider] NVARCHAR(16) NOT NULL,
    [providerVideoId] VARCHAR(16) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [availability] NVARCHAR(16) NOT NULL,
    [format] NVARCHAR(16),
    [languageCode] NVARCHAR(16) NOT NULL,
    [durationSeconds] INT,
    [publishedOn] DATE,
    [thumbnailUrl] NVARCHAR(2000),
    [captions] BIT NOT NULL CONSTRAINT [Video_captions_df] DEFAULT 0,
    [transcript] NVARCHAR(max),
    [seriesId] NVARCHAR(36),
    [seriesPosition] INT,
    [version] INT NOT NULL CONSTRAINT [Video_version_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Video_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Video_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Video_slug_key] UNIQUE NONCLUSTERED ([slug]),
    CONSTRAINT [Video_provider_providerVideoId_key] UNIQUE NONCLUSTERED ([provider],[providerVideoId])
);

-- CreateTable
CREATE TABLE [dbo].[VideoLabel] (
    [videoId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [description] NVARCHAR(4000) NOT NULL,
    CONSTRAINT [VideoLabel_pkey] PRIMARY KEY CLUSTERED ([videoId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[VideoSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [videoId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [VideoSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[VideoSpeaker] (
    [videoId] NVARCHAR(36) NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [VideoSpeaker_pkey] PRIMARY KEY CLUSTERED ([videoId],[personId])
);

-- CreateTable
CREATE TABLE [dbo].[VideoTopic] (
    [videoId] NVARCHAR(36) NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [VideoTopic_pkey] PRIMARY KEY CLUSTERED ([videoId],[topicId])
);

-- CreateTable
CREATE TABLE [dbo].[Series] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [kind] NVARCHAR(16) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [Series_version_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Series_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Series_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Series_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[SeriesLabel] (
    [seriesId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [description] NVARCHAR(4000) NOT NULL,
    CONSTRAINT [SeriesLabel_pkey] PRIMARY KEY CLUSTERED ([seriesId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[SeriesSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [seriesId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [SeriesSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[Playlist] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [Playlist_version_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Playlist_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Playlist_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Playlist_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[PlaylistLabel] (
    [playlistId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [description] NVARCHAR(4000) NOT NULL,
    CONSTRAINT [PlaylistLabel_pkey] PRIMARY KEY CLUSTERED ([playlistId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[PlaylistSlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [playlistId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [PlaylistSlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[PlaylistVideo] (
    [playlistId] NVARCHAR(36) NOT NULL,
    [videoId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [PlaylistVideo_pkey] PRIMARY KEY CLUSTERED ([playlistId],[videoId]),
    CONSTRAINT [PlaylistVideo_playlistId_position_key] UNIQUE NONCLUSTERED ([playlistId],[position])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Video_state_publishedOn_slug_idx] ON [dbo].[Video]([state], [publishedOn], [slug]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Video_state_isFeatured_publishedOn_idx] ON [dbo].[Video]([state], [isFeatured], [publishedOn]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Video_state_format_publishedOn_idx] ON [dbo].[Video]([state], [format], [publishedOn]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Video_languageCode_state_idx] ON [dbo].[Video]([languageCode], [state]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [VideoSlugHistory_videoId_idx] ON [dbo].[VideoSlugHistory]([videoId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [VideoSpeaker_personId_videoId_idx] ON [dbo].[VideoSpeaker]([personId], [videoId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [VideoTopic_topicId_videoId_idx] ON [dbo].[VideoTopic]([topicId], [videoId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Series_state_kind_slug_idx] ON [dbo].[Series]([state], [kind], [slug]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SeriesSlugHistory_seriesId_idx] ON [dbo].[SeriesSlugHistory]([seriesId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Playlist_state_slug_idx] ON [dbo].[Playlist]([state], [slug]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PlaylistSlugHistory_playlistId_idx] ON [dbo].[PlaylistSlugHistory]([playlistId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PlaylistVideo_videoId_playlistId_idx] ON [dbo].[PlaylistVideo]([videoId], [playlistId]);

-- AddForeignKey
ALTER TABLE [dbo].[Video] ADD CONSTRAINT [Video_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Video] ADD CONSTRAINT [Video_seriesId_fkey] FOREIGN KEY ([seriesId]) REFERENCES [dbo].[Series]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[VideoLabel] ADD CONSTRAINT [VideoLabel_videoId_fkey] FOREIGN KEY ([videoId]) REFERENCES [dbo].[Video]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[VideoSlugHistory] ADD CONSTRAINT [VideoSlugHistory_videoId_fkey] FOREIGN KEY ([videoId]) REFERENCES [dbo].[Video]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[VideoSpeaker] ADD CONSTRAINT [VideoSpeaker_videoId_fkey] FOREIGN KEY ([videoId]) REFERENCES [dbo].[Video]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[VideoSpeaker] ADD CONSTRAINT [VideoSpeaker_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[VideoTopic] ADD CONSTRAINT [VideoTopic_videoId_fkey] FOREIGN KEY ([videoId]) REFERENCES [dbo].[Video]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[VideoTopic] ADD CONSTRAINT [VideoTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SeriesLabel] ADD CONSTRAINT [SeriesLabel_seriesId_fkey] FOREIGN KEY ([seriesId]) REFERENCES [dbo].[Series]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SeriesSlugHistory] ADD CONSTRAINT [SeriesSlugHistory_seriesId_fkey] FOREIGN KEY ([seriesId]) REFERENCES [dbo].[Series]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PlaylistLabel] ADD CONSTRAINT [PlaylistLabel_playlistId_fkey] FOREIGN KEY ([playlistId]) REFERENCES [dbo].[Playlist]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PlaylistSlugHistory] ADD CONSTRAINT [PlaylistSlugHistory_playlistId_fkey] FOREIGN KEY ([playlistId]) REFERENCES [dbo].[Playlist]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PlaylistVideo] ADD CONSTRAINT [PlaylistVideo_playlistId_fkey] FOREIGN KEY ([playlistId]) REFERENCES [dbo].[Playlist]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PlaylistVideo] ADD CONSTRAINT [PlaylistVideo_videoId_fkey] FOREIGN KEY ([videoId]) REFERENCES [dbo].[Video]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- An episode's place is unique within its Series. FILTERED, because a Video in
-- no Series has no position, and two standalone Videos are not duplicates of
-- each other.
-- ---------------------------------------------------------------------------
CREATE UNIQUE NONCLUSTERED INDEX [Video_seriesId_seriesPosition_key]
    ON [dbo].[Video]([seriesId], [seriesPosition])
    WHERE [seriesId] IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Integrity refused by the database, whoever writes. Lifecycle, locales,
-- providers and their identifier grammars, bounds, a thumbnail on the
-- provider's own image host, an episode position exactly when there is a
-- Series, and a dense, bounded playlist order.
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[Video] ADD CONSTRAINT [Video_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[Video] ADD CONSTRAINT [Video_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[Video] ADD CONSTRAINT [Video_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[Video] ADD CONSTRAINT [Video_slug_ck] CHECK (LEN([slug]) >= 2);
ALTER TABLE [dbo].[Video] ADD CONSTRAINT [Video_provider_ck] CHECK (
    ([provider] = N'youtube' AND LEN([providerVideoId]) = 11 AND [providerVideoId] NOT LIKE '%[^A-Za-z0-9_-]%')
    OR ([provider] = N'vimeo' AND LEN([providerVideoId]) BETWEEN 1 AND 12 AND [providerVideoId] NOT LIKE '%[^0-9]%' AND [providerVideoId] NOT LIKE '0%'));
ALTER TABLE [dbo].[Video] ADD CONSTRAINT [Video_availability_ck] CHECK ([availability] IN (N'available',N'unavailable'));
ALTER TABLE [dbo].[Video] ADD CONSTRAINT [Video_format_ck] CHECK ([format] IS NULL OR [format] IN (N'lecture',N'event',N'highlight',N'interview',N'documentary'));
ALTER TABLE [dbo].[Video] ADD CONSTRAINT [Video_duration_ck] CHECK ([durationSeconds] IS NULL OR [durationSeconds] BETWEEN 1 AND 360000);
ALTER TABLE [dbo].[Video] ADD CONSTRAINT [Video_thumbnail_ck] CHECK (
    [thumbnailUrl] IS NULL
    OR ([provider] = N'youtube' AND [thumbnailUrl] LIKE N'https://i.ytimg.com/vi/_%')
    OR ([provider] = N'vimeo' AND [thumbnailUrl] LIKE N'https://i.vimeocdn.com/video/_%'));
ALTER TABLE [dbo].[Video] ADD CONSTRAINT [Video_series_ck] CHECK (
    ([seriesId] IS NULL AND [seriesPosition] IS NULL)
    OR ([seriesId] IS NOT NULL AND [seriesPosition] BETWEEN 1 AND 100000));
ALTER TABLE [dbo].[Video] ADD CONSTRAINT [Video_transcript_ck] CHECK ([transcript] IS NULL OR (LEN([transcript]) > 0 AND LEN([transcript]) <= 100000));
ALTER TABLE [dbo].[VideoLabel] ADD CONSTRAINT [VideoLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[VideoLabel] ADD CONSTRAINT [VideoLabel_title_ck] CHECK (LEN([title]) > 0);
ALTER TABLE [dbo].[VideoSpeaker] ADD CONSTRAINT [VideoSpeaker_position_ck] CHECK ([position] BETWEEN 0 AND 11);
ALTER TABLE [dbo].[Series] ADD CONSTRAINT [Series_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[Series] ADD CONSTRAINT [Series_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[Series] ADD CONSTRAINT [Series_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[Series] ADD CONSTRAINT [Series_slug_ck] CHECK (LEN([slug]) >= 2);
ALTER TABLE [dbo].[Series] ADD CONSTRAINT [Series_kind_ck] CHECK ([kind] IN (N'series',N'program'));
ALTER TABLE [dbo].[SeriesLabel] ADD CONSTRAINT [SeriesLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[SeriesLabel] ADD CONSTRAINT [SeriesLabel_title_ck] CHECK (LEN([title]) > 0);
ALTER TABLE [dbo].[Playlist] ADD CONSTRAINT [Playlist_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[Playlist] ADD CONSTRAINT [Playlist_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[Playlist] ADD CONSTRAINT [Playlist_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[Playlist] ADD CONSTRAINT [Playlist_slug_ck] CHECK (LEN([slug]) >= 2);
ALTER TABLE [dbo].[PlaylistLabel] ADD CONSTRAINT [PlaylistLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[PlaylistLabel] ADD CONSTRAINT [PlaylistLabel_title_ck] CHECK (LEN([title]) > 0);
ALTER TABLE [dbo].[PlaylistVideo] ADD CONSTRAINT [PlaylistVideo_position_ck] CHECK ([position] BETWEEN 0 AND 199);

-- ---------------------------------------------------------------------------
-- Permanent slug reservation (DOMAIN_MODEL.md 19.7), made by the DATABASE for
-- the reasons the Library triggers give: no writer can skip it, and the check
-- and the write cannot race. A slug returning to the SAME record is not reuse;
-- the same spelling on ANOTHER record is refused by the primary key.
--
-- A SERIES HAS ONE NAMESPACE WHATEVER ITS KIND. Becoming a programme moves its
-- address from /watch/series to /watch/programs but never frees its slug.
-- ---------------------------------------------------------------------------
EXEC(N'CREATE TRIGGER [dbo].[MediaReserveVideoSlug] ON [dbo].[Video] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[VideoSlugHistory] ([slug],[videoId])
 SELECT i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[VideoSlugHistory] h
     WHERE h.[slug] = i.[slug] AND h.[videoId] = i.[id]
   );
END');
EXEC(N'CREATE TRIGGER [dbo].[MediaReserveSeriesSlug] ON [dbo].[Series] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[SeriesSlugHistory] ([slug],[seriesId])
 SELECT i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[SeriesSlugHistory] h
     WHERE h.[slug] = i.[slug] AND h.[seriesId] = i.[id]
   );
END');
EXEC(N'CREATE TRIGGER [dbo].[MediaReservePlaylistSlug] ON [dbo].[Playlist] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[PlaylistSlugHistory] ([slug],[playlistId])
 SELECT i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[PlaylistSlugHistory] h
     WHERE h.[slug] = i.[slug] AND h.[playlistId] = i.[id]
   );
END');

-- ---------------------------------------------------------------------------
-- The Media vocabulary: two keys, read and administer (DELIVERY_PLAN.md
-- Phase 10). No key per aggregate and none for audio or galleries.
-- ---------------------------------------------------------------------------
INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'media.read', N'View Videos, Series and Playlists, including drafts.'),
    (N'media.administer', N'Create, edit, publish and archive Videos, Series and Playlists, and order Playlists.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

-- ===========================================================================
-- EXTENDING THE PROTECTED PLATFORM ADMINISTRATOR BUNDLE
-- ===========================================================================
--
-- The protected bundle is the WHOLE catalogue, so appending permissions widens
-- what a live administrator may do. The holders' sessions and step-up grants
-- are revoked in the SAME transaction that changes the bundle
-- (SECURITY_BASELINE.md 8.1), by the mechanism Phases 3B, 4, 5, 6, 8 and 17
-- used. On a fresh database every count below is zero and nothing is revoked.

DECLARE @mediaAdminRoleId NVARCHAR(36);
DECLARE @mediaAddedKeys NVARCHAR(200);

SELECT @mediaAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @mediaAdminRoleId IS NOT NULL
BEGIN
    SELECT @mediaAddedKeys = STRING_AGG(p.[key], N' ') WITHIN GROUP (ORDER BY p.[key])
    FROM [dbo].[Permission] p
    WHERE p.[key] IN (N'media.read', N'media.administer')
      AND NOT EXISTS (
          SELECT 1 FROM [dbo].[RolePermission] rp
          WHERE rp.[roleId] = @mediaAdminRoleId AND rp.[permissionKey] = p.[key]
      );

    IF @mediaAddedKeys IS NOT NULL AND LEN(@mediaAddedKeys) > 0
    BEGIN
        INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
        SELECT @mediaAdminRoleId, p.[key]
        FROM [dbo].[Permission] p
        WHERE p.[key] IN (N'media.read', N'media.administer')
          AND NOT EXISTS (
              SELECT 1 FROM [dbo].[RolePermission] rp
              WHERE rp.[roleId] = @mediaAdminRoleId AND rp.[permissionKey] = p.[key]
          );

        -- Grants before sessions, so the count each statement reports is the
        -- one it actually removed rather than whatever a cascade took first.
        DELETE FROM [dbo].[StepUpGrant]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @mediaAdminRoleId AND ra.[revokedAt] IS NULL
        );

        DELETE FROM [dbo].[Session]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @mediaAdminRoleId AND ra.[revokedAt] IS NULL
        );

        -- WHICH KEYS WERE ADDED, and nothing else (SECURITY_BASELINE.md 13.4).
        INSERT INTO [dbo].[AuditLog]
            ([id], [actorType], [actorId], [action], [targetType], [targetId],
             [afterState], [authorisingSource])
        VALUES
            (NEWID(), N'migration', NULL, N'media.permissions.provisioned', N'role',
             @mediaAdminRoleId,
             N'{"added":"' + @mediaAddedKeys + N'"}',
             N'20260925000000_phase10_media_video');
    END;
END;

-- ---------------------------------------------------------------------------
-- Search (Phase 17) — `video`, its own kind and its own scope. Series and
-- Playlist are groupings, not searchable resources, and add nothing here.
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[SearchIndexRequest] DROP CONSTRAINT [SearchIndexRequest_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexRequest] ADD CONSTRAINT [SearchIndexRequest_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video'));
ALTER TABLE [dbo].[SearchIndexScope] DROP CONSTRAINT [SearchIndexScope_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video'));
ALTER TABLE [dbo].[SearchDocument] DROP CONSTRAINT [SearchDocument_kind_ck];
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_kind_ck] CHECK ([kind] IN (N'topic',N'person',N'article',N'page',N'work',N'edition',N'book-translation',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video'));
-- `SearchDocument_scope_ck` needs no change: a Video is projected only within
-- its own scope, which that constraint already requires of every such kind.

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
