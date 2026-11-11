BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- Rebaseline R2 - Quran Part 8: the Quran passages a Work or a Video explains
-- ===========================================================================
--
-- TWO TABLES, OWNED BY LIBRARY AND BY MEDIA (DOMAIN_MODEL.md 3.1, 10.1, 11).
-- The Tafsir hub links Shaykh-ul-Islam's tafsir books and Minhaj TV lectures
-- to the ayat they explain. The association belongs to the content that does
-- the explaining, never to Quran: the allowlist has no Library -> Quran or
-- Media -> Quran edge, so a passage is a CITATION VALUE - a Surah number and
-- an inclusive ayah range - with NO foreign key into Surah or Ayah:
--
--   WorkQuranPassage   (workId, position, surahNumber, ayahFrom, ayahTo)
--   VideoQuranPassage  (videoId, position, surahNumber, ayahFrom, ayahTo,
--                       startSeconds)
--
--   - ORDERED. The owner's editor gives the order; `position` runs from 0
--     within the ceiling QURAN_PASSAGES_MAX (40), unique per owner (the key).
--   - NO REPEATS. One owner never names the same passage twice (a unique
--     key on the citation).
--   - SHAPE IN SQL, STRUCTURE IN THE SERVICE. A CHECK holds what the database
--     can know - a Surah 1..114 and a forward range from Ayah 1. Whether the
--     range ends within its Surah (`SURAH_AYAH_COUNTS`, the neutral
--     `@minhaj/contracts/passage`) is the owning service's refusal.
--   - A LECTURE MAY BEGIN THE PASSAGE LATER: `startSeconds` is where in the
--     video, 0..86399, or NULL when unrecorded.
--   - THE OWNER'S KEY ONLY, NO ACTION. A Work or a Video is never deleted.
--
-- No trigger, no refusal number, no seed. The runtime writes a set by
-- clearing and inserting it under the owner's expected version (the
-- WorkTopic / VideoTopic posture: SELECT, INSERT, DELETE; UPDATE denied).
--
-- APPEND-ONLY. Nothing below edits an accepted migration.

CREATE TABLE [dbo].[WorkQuranPassage] (
    [workId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    [surahNumber] INT NOT NULL,
    [ayahFrom] INT NOT NULL,
    [ayahTo] INT NOT NULL,
    CONSTRAINT [WorkQuranPassage_pkey] PRIMARY KEY CLUSTERED ([workId],[position]),
    CONSTRAINT [WorkQuranPassage_citation_key] UNIQUE NONCLUSTERED ([workId],[surahNumber],[ayahFrom],[ayahTo])
);

CREATE TABLE [dbo].[VideoQuranPassage] (
    [videoId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    [surahNumber] INT NOT NULL,
    [ayahFrom] INT NOT NULL,
    [ayahTo] INT NOT NULL,
    [startSeconds] INT,
    CONSTRAINT [VideoQuranPassage_pkey] PRIMARY KEY CLUSTERED ([videoId],[position]),
    CONSTRAINT [VideoQuranPassage_citation_key] UNIQUE NONCLUSTERED ([videoId],[surahNumber],[ayahFrom],[ayahTo])
);

-- "What explains this passage?" reads by Surah and range.
CREATE NONCLUSTERED INDEX [WorkQuranPassage_surah_idx] ON [dbo].[WorkQuranPassage]([surahNumber],[ayahFrom],[ayahTo]);
CREATE NONCLUSTERED INDEX [VideoQuranPassage_surah_idx] ON [dbo].[VideoQuranPassage]([surahNumber],[ayahFrom],[ayahTo]);

ALTER TABLE [dbo].[WorkQuranPassage] ADD CONSTRAINT [WorkQuranPassage_workId_fkey] FOREIGN KEY ([workId]) REFERENCES [dbo].[Work]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[VideoQuranPassage] ADD CONSTRAINT [VideoQuranPassage_videoId_fkey] FOREIGN KEY ([videoId]) REFERENCES [dbo].[Video]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[WorkQuranPassage] ADD CONSTRAINT [WorkQuranPassage_ck] CHECK ([position] BETWEEN 0 AND 39 AND [surahNumber] BETWEEN 1 AND 114 AND [ayahFrom]>=1 AND [ayahFrom]<=[ayahTo]);
ALTER TABLE [dbo].[VideoQuranPassage] ADD CONSTRAINT [VideoQuranPassage_ck] CHECK ([position] BETWEEN 0 AND 39 AND [surahNumber] BETWEEN 1 AND 114 AND [ayahFrom]>=1 AND [ayahFrom]<=[ayahTo] AND ([startSeconds] IS NULL OR [startSeconds] BETWEEN 0 AND 86399));

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;

THROW

END CATCH
