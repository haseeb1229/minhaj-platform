BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- Rebaseline R2 - Quran Part 5: recitations that are heard, followed and streamed
-- ===========================================================================
--
-- THREE FACTS A RECITATION NOW CARRIES (DOMAIN_MODEL.md 8.5), each the smallest
-- shape that holds it, all owned by Quran (8.1):
--
--   1. THE LANGUAGE HEARD. `QuranRecitation.languageCode`, a content Language
--      (Taxonomy) exactly as every layered work names one: `ar` for a
--      recitation of the Arabic, `ur` for a narration of an Urdu translation.
--      NULLABLE only because a recitation recorded before this migration has
--      none; nothing is backfilled and nothing is inferred.
--
--   2. WHERE A STREAMED RECITATION'S AUDIO LIVES. `streamProvider` and
--      `streamPath` - never a URL. The provider is an allowlisted key
--      (`mp3quran`, the one the owner admitted for staging on 2026-11-09) and
--      the path a folder of that provider's CDN; the application DERIVES the one
--      address of each Surah's file from them (`recitationStreamUrl`). Fixed
--      when the recitation is created (a trigger, and the runtime principal is
--      denied UPDATE on both columns), named only beside a `reference` source -
--      so it can never stand beside an approved corpus - and a streamed
--      recitation's segments hold no Storage asset and each covers one whole
--      Surah, because the provider serves one file per Surah.
--
--   3. WHEN EACH AYAH IS HEARD. `QuranRecitationTiming`, one row per Ayah of a
--      segment: `[startMs, endMs)` in that segment's audio. A segment is timed
--      for EVERY Ayah of its range or for none, each span is non-empty, and the
--      spans are monotonic - gaps (the opening isti'adha and basmala) allowed,
--      overlaps refused. Written once with its segment, never edited; removed
--      only with it. A typed key to the segment - no polymorphic reference.
--
-- "A PUBLISHED RECITATION HAS AUDIO" KEEPS ITS MEANING. Its two triggers are
-- redefined so a streamed recitation's segment counts as audio - the stream is
-- its audio - and a first-party one still needs its asset (51188, unchanged).
--
-- REFUSALS 51400-51402, a new range for Quran Part 5 (Phase 18's 51180-51199 is
-- full).
--
-- APPEND-ONLY. Nothing below edits an accepted migration; the two triggers are
-- re-created with CREATE OR ALTER, and the rollback restores Phase 18's text.

-- 1. The language heard -------------------------------------------------------

ALTER TABLE [dbo].[QuranRecitation] ADD [languageCode] NVARCHAR(16) NULL;
ALTER TABLE [dbo].[QuranRecitation] ADD CONSTRAINT [QuranRecitation_languageCode_fkey]
    FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- 2. The stream ---------------------------------------------------------------

ALTER TABLE [dbo].[QuranRecitation] ADD [streamProvider] NVARCHAR(16) NULL, [streamPath] NVARCHAR(200) NULL;
-- Both NOT NULL tests are explicit: a CHECK passes on UNKNOWN, so a lone NULL
-- would otherwise slip through the second branch.
EXEC sp_executesql N'ALTER TABLE [dbo].[QuranRecitation] ADD CONSTRAINT [QuranRecitation_stream_ck] CHECK (
    ([streamProvider] IS NULL AND [streamPath] IS NULL)
    OR ([streamProvider] IS NOT NULL AND [streamPath] IS NOT NULL
        AND [streamProvider] = N''mp3quran''
        AND [streamPath] COLLATE Latin1_General_100_BIN2 LIKE N''audio/%''
        AND [streamPath] COLLATE Latin1_General_100_BIN2 NOT LIKE N''%[^-a-z0-9/]%''
        AND [streamPath] NOT LIKE N''%//%''
        AND [streamPath] NOT LIKE N''%/''))';

EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranRecitationStreamRules] ON [dbo].[QuranRecitation] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id
   WHERE ISNULL(i.streamProvider,N'''') COLLATE Latin1_General_100_BIN2 <> ISNULL(d.streamProvider,N'''') COLLATE Latin1_General_100_BIN2
      OR ISNULL(i.streamPath,N'''') COLLATE Latin1_General_100_BIN2 <> ISNULL(d.streamPath,N'''') COLLATE Latin1_General_100_BIN2)
   THROW 51400, ''A recitation''''s stream is fixed when it is created.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[QuranSource] s ON s.id=i.sourceId
   WHERE i.streamProvider IS NOT NULL AND s.authority<>N''reference'')
   THROW 51401, ''A streamed recitation names a reference source only.'', 1;
 END;';

EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranRecitationSegmentStreamed] ON [dbo].[QuranRecitationSegment] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i
   JOIN [dbo].[QuranRecitation] r ON r.id=i.recitationId
   JOIN [dbo].[Surah] s ON s.number=i.surahNumber
   WHERE r.streamProvider IS NOT NULL AND (i.assetId IS NOT NULL OR i.startAyah<>1 OR i.endAyah<>s.ayahCount))
   THROW 51401, ''A streamed recitation''''s segment is one whole Surah, with no stored file.'', 1;
 END;';

-- A published recitation has audio: a segment with its file, or a segment of a
-- streamed recitation. Phase 18's rule otherwise unchanged.
EXEC sp_executesql N'CREATE OR ALTER TRIGGER [dbo].[QuranRecitationPublishedAudio] ON [dbo].[QuranRecitation] AFTER INSERT, UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i WHERE i.state=N''published'' AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranRecitationSegment] s WHERE s.recitationId=i.id AND (s.assetId IS NOT NULL OR i.streamProvider IS NOT NULL))) THROW 51188, ''A published recitation needs audio.'', 1; END;';
EXEC sp_executesql N'CREATE OR ALTER TRIGGER [dbo].[QuranRecitationSegmentKeepsAudio] ON [dbo].[QuranRecitationSegment] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM [dbo].[QuranRecitation] r WHERE r.state=N''published'' AND r.id IN (SELECT recitationId FROM deleted) AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranRecitationSegment] s WHERE s.recitationId=r.id AND (s.assetId IS NOT NULL OR r.streamProvider IS NOT NULL))) THROW 51188, ''A published recitation needs audio.'', 1; END;';

-- 3. The timing ---------------------------------------------------------------

CREATE TABLE [dbo].[QuranRecitationTiming] (
    [segmentId] NVARCHAR(36) NOT NULL,
    [ayahNumber] INT NOT NULL,
    [startMs] INT NOT NULL,
    [endMs] INT NOT NULL,
    CONSTRAINT [QuranRecitationTiming_pkey] PRIMARY KEY CLUSTERED ([segmentId],[ayahNumber])
);
ALTER TABLE [dbo].[QuranRecitationTiming] ADD CONSTRAINT [QuranRecitationTiming_segmentId_fkey]
    FOREIGN KEY ([segmentId]) REFERENCES [dbo].[QuranRecitationSegment]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
-- Non-empty, from the start of the file, within the twelve-hour structural
-- ceiling (RECITATION_TIMING_MAX_MS); the file's own length is the player's.
ALTER TABLE [dbo].[QuranRecitationTiming] ADD CONSTRAINT [QuranRecitationTiming_ck]
    CHECK ([startMs]>=0 AND [endMs]>[startMs] AND [endMs]<=43200000);

EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranRecitationTimingShape] ON [dbo].[QuranRecitationTiming] AFTER INSERT, UPDATE, DELETE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
   THROW 51402, ''A segment''''s timing is written once, never edited.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[QuranRecitationSegment] g ON g.id=i.segmentId
   WHERE i.ayahNumber<g.startAyah OR i.ayahNumber>g.endAyah)
   THROW 51402, ''A timing lies outside its segment.'', 1;
 IF EXISTS (SELECT 1 FROM [dbo].[QuranRecitationSegment] g
   WHERE g.id IN (SELECT segmentId FROM inserted UNION SELECT segmentId FROM deleted)
     AND (SELECT COUNT(*) FROM [dbo].[QuranRecitationTiming] t WHERE t.segmentId=g.id) NOT IN (0, g.endAyah-g.startAyah+1))
   THROW 51402, ''A segment is timed for every Ayah or for none.'', 1;
 IF EXISTS (SELECT 1 FROM (
     SELECT t.startMs, LAG(t.endMs) OVER (PARTITION BY t.segmentId ORDER BY t.ayahNumber) AS previousEnd
     FROM [dbo].[QuranRecitationTiming] t
     WHERE t.segmentId IN (SELECT segmentId FROM inserted)) x
   WHERE x.startMs < x.previousEnd)
   THROW 51402, ''An Ayah''''s timing overlaps the one before it.'', 1;
 END;';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;

THROW

END CATCH
