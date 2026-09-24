-- ===========================================================================
-- Phase 12 — Media: Photo, Gallery, GalleryItem
-- ===========================================================================
--
-- THREE SHAPES (DOMAIN_MODEL.md 11). A Photo is one logical photograph whose
-- image is ONE Storage Asset, reached by a nullable foreign key that never
-- cascades. A Gallery is a curated grouping with its own permanent slug
-- namespace. A GalleryItem is a Photo's place in a Gallery: typed, ordered,
-- duplicate-free and bounded to 240 places.
--
-- NO EVENT, CENTRE OR COLLECTION REFERENCE. A Gallery exists independently;
-- the typed Event-Gallery association is Phase 14's, created there once both
-- ends exist. No column below reserves room for it, and no generic media,
-- image, album or asset-link table exists.
--
-- A PHOTO HAS NO SLUG: it has no public page of its own (ROUTE_MAP.md 3.9).
--
-- THE IMAGE STAYS STORAGE'S. The Asset relation never cascades, and no Photo
-- change deletes, rewrites or moves an Asset row; Storage in turn cannot remove
-- an Asset a Photo names. No bytes are stored in SQL.
--
-- SEARCH IS UNCHANGED. Phase 12's delivery contract promises no search
-- projection, so no kind, scope or vocabulary is widened here.
--
-- APPEND-ONLY. Nothing below edits an accepted migration. The two existing
-- Media keys are re-described to name what they now cover; no permission is
-- added.

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[Photo] (
    [id] NVARCHAR(36) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [credit] NVARCHAR(200),
    [takenYear] INT,
    [takenMonth] INT,
    [takenDay] INT,
    [assetId] NVARCHAR(36),
    [width] INT,
    [height] INT,
    [version] INT NOT NULL CONSTRAINT [Photo_version_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Photo_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Photo_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Photo_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PhotoLabel] (
    [photoId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [altText] NVARCHAR(500),
    [caption] NVARCHAR(1000),
    CONSTRAINT [PhotoLabel_pkey] PRIMARY KEY CLUSTERED ([photoId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[Gallery] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [Gallery_version_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Gallery_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Gallery_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Gallery_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Gallery_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[GalleryLabel] (
    [galleryId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(240) NOT NULL,
    [description] NVARCHAR(4000) NOT NULL,
    CONSTRAINT [GalleryLabel_pkey] PRIMARY KEY CLUSTERED ([galleryId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[GallerySlugHistory] (
    [slug] NVARCHAR(120) NOT NULL,
    [galleryId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [GallerySlugHistory_pkey] PRIMARY KEY CLUSTERED ([slug])
);

-- CreateTable
CREATE TABLE [dbo].[GalleryItem] (
    [galleryId] NVARCHAR(36) NOT NULL,
    [photoId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [GalleryItem_pkey] PRIMARY KEY CLUSTERED ([galleryId],[photoId]),
    CONSTRAINT [GalleryItem_galleryId_position_key] UNIQUE NONCLUSTERED ([galleryId],[position])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Photo_state_createdAt_id_idx] ON [dbo].[Photo]([state], [createdAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Photo_state_takenYear_takenMonth_takenDay_idx] ON [dbo].[Photo]([state], [takenYear], [takenMonth], [takenDay]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Gallery_state_createdAt_id_idx] ON [dbo].[Gallery]([state], [createdAt], [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [GallerySlugHistory_galleryId_idx] ON [dbo].[GallerySlugHistory]([galleryId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [GalleryItem_photoId_galleryId_idx] ON [dbo].[GalleryItem]([photoId], [galleryId]);

-- AddForeignKey
ALTER TABLE [dbo].[Photo] ADD CONSTRAINT [Photo_assetId_fkey] FOREIGN KEY ([assetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PhotoLabel] ADD CONSTRAINT [PhotoLabel_photoId_fkey] FOREIGN KEY ([photoId]) REFERENCES [dbo].[Photo]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[GalleryLabel] ADD CONSTRAINT [GalleryLabel_galleryId_fkey] FOREIGN KEY ([galleryId]) REFERENCES [dbo].[Gallery]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[GallerySlugHistory] ADD CONSTRAINT [GallerySlugHistory_galleryId_fkey] FOREIGN KEY ([galleryId]) REFERENCES [dbo].[Gallery]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[GalleryItem] ADD CONSTRAINT [GalleryItem_galleryId_fkey] FOREIGN KEY ([galleryId]) REFERENCES [dbo].[Gallery]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[GalleryItem] ADD CONSTRAINT [GalleryItem_photoId_fkey] FOREIGN KEY ([photoId]) REFERENCES [dbo].[Photo]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- An Asset serves at most one Photo. FILTERED: a Photo with no image yet names
-- no Asset, and two such Photos are not duplicates of each other.
-- ---------------------------------------------------------------------------
CREATE UNIQUE NONCLUSTERED INDEX [Photo_assetId_key]
    ON [dbo].[Photo]([assetId])
    WHERE [assetId] IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Integrity refused by the database, whoever writes:
--
--   * lifecycle, locale and version for both aggregates;
--   * a PUBLISHED Photo always has an image;
--   * the recorded dimensions exist exactly when an image does, and stay
--     within the admission bounds (16,384 px a side, 40 megapixels);
--   * a taken date is a year, optionally a month, optionally a day — never a
--     day without its month — and the day exists in that month. CASE fixes the
--     evaluation order, so an impossible month is refused by the CHECK rather
--     than by DATEFROMPARTS raising an error;
--   * a label says something: alternative text, a caption, or both;
--   * a Gallery place is between 0 and 239, which with the unique position
--     bounds a Gallery to 240 Photos.
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[Photo] ADD CONSTRAINT [Photo_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[Photo] ADD CONSTRAINT [Photo_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[Photo] ADD CONSTRAINT [Photo_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[Photo] ADD CONSTRAINT [Photo_credit_ck] CHECK ([credit] IS NULL OR LEN([credit]) > 0);
ALTER TABLE [dbo].[Photo] ADD CONSTRAINT [Photo_published_ck] CHECK ([state] <> N'published' OR [assetId] IS NOT NULL);
ALTER TABLE [dbo].[Photo] ADD CONSTRAINT [Photo_image_ck] CHECK (
    ([assetId] IS NULL AND [width] IS NULL AND [height] IS NULL)
    OR ([assetId] IS NOT NULL
        AND [width] BETWEEN 1 AND 16384
        AND [height] BETWEEN 1 AND 16384
        AND CAST([width] AS BIGINT) * [height] <= 40000000));
ALTER TABLE [dbo].[Photo] ADD CONSTRAINT [Photo_taken_ck] CHECK (
    CASE
        WHEN [takenYear] IS NULL THEN
            CASE WHEN [takenMonth] IS NULL AND [takenDay] IS NULL THEN 1 ELSE 0 END
        WHEN [takenYear] NOT BETWEEN 1826 AND 9999 THEN 0
        WHEN [takenMonth] IS NULL THEN
            CASE WHEN [takenDay] IS NULL THEN 1 ELSE 0 END
        WHEN [takenMonth] NOT BETWEEN 1 AND 12 THEN 0
        WHEN [takenDay] IS NULL THEN 1
        WHEN [takenDay] BETWEEN 1 AND DAY(EOMONTH(DATEFROMPARTS([takenYear], [takenMonth], 1))) THEN 1
        ELSE 0
    END = 1);
ALTER TABLE [dbo].[PhotoLabel] ADD CONSTRAINT [PhotoLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[PhotoLabel] ADD CONSTRAINT [PhotoLabel_text_ck] CHECK (
    ([altText] IS NULL OR LEN([altText]) > 0)
    AND ([caption] IS NULL OR LEN([caption]) > 0)
    AND ([altText] IS NOT NULL OR [caption] IS NOT NULL));
ALTER TABLE [dbo].[Gallery] ADD CONSTRAINT [Gallery_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived'));
ALTER TABLE [dbo].[Gallery] ADD CONSTRAINT [Gallery_version_ck] CHECK ([version] > 0);
ALTER TABLE [dbo].[Gallery] ADD CONSTRAINT [Gallery_locale_ck] CHECK ([primaryLocale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[Gallery] ADD CONSTRAINT [Gallery_slug_ck] CHECK (LEN([slug]) >= 2);
ALTER TABLE [dbo].[GalleryLabel] ADD CONSTRAINT [GalleryLabel_locale_ck] CHECK ([locale] IN (N'en',N'ur',N'ar'));
ALTER TABLE [dbo].[GalleryLabel] ADD CONSTRAINT [GalleryLabel_title_ck] CHECK (LEN([title]) > 0);
ALTER TABLE [dbo].[GalleryItem] ADD CONSTRAINT [GalleryItem_position_ck] CHECK ([position] BETWEEN 0 AND 239);

-- ---------------------------------------------------------------------------
-- Permanent Gallery slug reservation (DOMAIN_MODEL.md 19.7), made by the
-- DATABASE for the reasons the Library, Video and audio triggers give: no
-- writer can skip it, and the check and the write cannot race. A slug
-- returning to the SAME Gallery is not reuse; the same spelling on ANOTHER
-- Gallery is refused by the primary key.
-- ---------------------------------------------------------------------------
EXEC(N'CREATE TRIGGER [dbo].[MediaReserveGallerySlug] ON [dbo].[Gallery] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 INSERT INTO [dbo].[GallerySlugHistory] ([slug],[galleryId])
 SELECT i.[slug],i.[id] FROM inserted i LEFT JOIN deleted d ON d.[id]=i.[id]
 WHERE (d.[id] IS NULL OR d.[slug] <> i.[slug])
   AND NOT EXISTS (
     SELECT 1 FROM [dbo].[GallerySlugHistory] h
     WHERE h.[slug] = i.[slug] AND h.[galleryId] = i.[id]
   );
END');

-- ---------------------------------------------------------------------------
-- NO NEW PERMISSION. `media.read` and `media.administer` are Media's two
-- authorities and already sit in the protected bundle; photographs and
-- galleries are Media's, so they now govern them too. Only the DESCRIPTIONS
-- change. Nothing is added to any role, so no session or grant needs revoking.
-- ---------------------------------------------------------------------------
UPDATE [dbo].[Permission]
SET [description] = N'View Videos, Series, Playlists, audio tracks, audio series, photographs and galleries, including drafts.'
WHERE [key] = N'media.read';
UPDATE [dbo].[Permission]
SET [description] = N'Create, edit, publish and archive Videos, Series, Playlists, audio tracks, audio series, photographs and galleries, order Playlists and galleries, and upload audio files and photographs.'
WHERE [key] = N'media.administer';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
