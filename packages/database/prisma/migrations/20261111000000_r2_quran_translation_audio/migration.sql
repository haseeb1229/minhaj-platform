BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- Rebaseline R2 - Quran translation audio: a narration's Arabic timed, and
-- where its translation of each passage is heard
-- ===========================================================================
--
-- TWO TABLES, OWNED BY QURAN (DOMAIN_MODEL.md 8.5). A first-party NARRATION
-- (a recitation whose language heard is a translation's, e.g. the
-- Irfan-ul-Quran Urdu narration) plays, Surah by Surah, an Arabic passage of
-- one or more contiguous ayat and then its translation. Once its audio has
-- been ALIGNED against a timed Arabic recitation, three facts are known for a
-- segment, and each is stored once, in the smallest shape that holds it:
--
--   1. WHEN EACH AYAH'S ARABIC IS HEARD - the existing per-Ayah
--      `QuranRecitationTiming` (Quran Part 5), inserted for the untimed
--      segment exactly once, every Ayah or none (51402, unchanged).
--
--   2. WHERE THE ALIGNMENT CAME FROM -
--      QuranRecitationAlignment (segmentId, sourceId, referenceRecitationId)
--      One row per aligned segment: the provenance source that records the
--      alignment file's digest and method (authority `reference` only - a
--      derived, staging-only alignment can never stand beside an approved
--      corpus), and the timed Arabic RECITATION whose audio the narration's
--      Arabic was matched against. That is a typed reference to a recording,
--      not a credit: it names no Person and adds no contributor.
--
--   3. WHERE EACH PASSAGE'S TRANSLATION IS HEARD -
--      QuranRecitationTranslationSpan (segmentId, startAyah, endAyah,
--                                      startMs, endMs)
--      The passages PARTITION the segment's range - every Ayah in exactly one
--      passage, or none at all - and each passage's translation, [startMs,
--      endMs) in the same file, lies after its last Ayah's Arabic ends and
--      before the next Ayah's Arabic begins.
--
-- WRITTEN ONCE, NEVER EDITED (trigger 51405, and the runtime is denied
-- UPDATE): an alignment, its spans and the timing it relies on are inserted
-- together and removed only with their segment, whose audio file is then
-- fixed - a different file would make every time here describe some other
-- recording. Typed keys throughout (NO ACTION); no polymorphic reference.
--
-- REFUSAL 51405 continues Quran Part 7's range (51400-51404).
--
-- APPEND-ONLY. Nothing below edits an accepted migration; the two triggers on
-- existing tables are new, never ALTERed.

CREATE TABLE [dbo].[QuranRecitationAlignment] (
    [segmentId] NVARCHAR(36) NOT NULL,
    [sourceId] NVARCHAR(36) NOT NULL,
    [referenceRecitationId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [QuranRecitationAlignment_pkey] PRIMARY KEY CLUSTERED ([segmentId])
);

CREATE TABLE [dbo].[QuranRecitationTranslationSpan] (
    [segmentId] NVARCHAR(36) NOT NULL,
    [startAyah] INT NOT NULL,
    [endAyah] INT NOT NULL,
    [startMs] INT NOT NULL,
    [endMs] INT NOT NULL,
    CONSTRAINT [QuranRecitationTranslationSpan_pkey] PRIMARY KEY CLUSTERED ([segmentId],[startAyah])
);

-- "Which recitations were aligned against this one?" - the public reader's join.
CREATE NONCLUSTERED INDEX [QuranRecitationAlignment_referenceRecitationId_idx] ON [dbo].[QuranRecitationAlignment]([referenceRecitationId]);

ALTER TABLE [dbo].[QuranRecitationAlignment] ADD CONSTRAINT [QuranRecitationAlignment_segmentId_fkey]
    FOREIGN KEY ([segmentId]) REFERENCES [dbo].[QuranRecitationSegment]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranRecitationAlignment] ADD CONSTRAINT [QuranRecitationAlignment_sourceId_fkey]
    FOREIGN KEY ([sourceId]) REFERENCES [dbo].[QuranSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranRecitationAlignment] ADD CONSTRAINT [QuranRecitationAlignment_referenceRecitationId_fkey]
    FOREIGN KEY ([referenceRecitationId]) REFERENCES [dbo].[QuranRecitation]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranRecitationTranslationSpan] ADD CONSTRAINT [QuranRecitationTranslationSpan_segmentId_fkey]
    FOREIGN KEY ([segmentId]) REFERENCES [dbo].[QuranRecitationAlignment]([segmentId]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- A forward passage from Ayah 1, a non-empty span within the twelve-hour
-- structural ceiling (RECITATION_TIMING_MAX_MS), as every timing is bounded.
ALTER TABLE [dbo].[QuranRecitationTranslationSpan] ADD CONSTRAINT [QuranRecitationTranslationSpan_ck]
    CHECK ([startAyah]>=1 AND [endAyah]>=[startAyah] AND [startMs]>=0 AND [endMs]>[startMs] AND [endMs]<=43200000);

EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranRecitationAlignmentRules] ON [dbo].[QuranRecitationAlignment] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
   THROW 51405, ''A segment''''s alignment is written once, never edited.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i
   JOIN [dbo].[QuranRecitationSegment] g ON g.id=i.segmentId
   JOIN [dbo].[QuranRecitation] r ON r.id=g.recitationId
   WHERE g.assetId IS NULL OR r.streamProvider IS NOT NULL
      OR r.languageCode IS NULL OR r.languageCode=N''ar'')
   THROW 51405, ''An alignment belongs to a first-party narration of a translation, with its file.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i
   JOIN [dbo].[QuranRecitationSegment] g ON g.id=i.segmentId
   JOIN [dbo].[QuranRecitation] a ON a.id=i.referenceRecitationId
   WHERE a.id=g.recitationId OR a.languageCode IS NULL OR a.languageCode<>N''ar'')
   THROW 51405, ''An alignment is made against another recitation of the Arabic.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[QuranSource] s ON s.id=i.sourceId
   WHERE s.authority<>N''reference'')
   THROW 51405, ''An alignment names a reference source only.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[QuranRecitationSegment] g ON g.id=i.segmentId
   WHERE (SELECT COUNT(*) FROM [dbo].[QuranRecitationTiming] t WHERE t.segmentId=g.id) <> g.endAyah-g.startAyah+1)
   THROW 51405, ''An aligned segment is timed for every Ayah.'', 1;
 END;';

EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranRecitationTranslationSpanShape] ON [dbo].[QuranRecitationTranslationSpan] AFTER INSERT, UPDATE, DELETE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
   THROW 51405, ''A translation span is written once, never edited.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[QuranRecitationSegment] g ON g.id=i.segmentId
   WHERE i.startAyah<g.startAyah OR i.endAyah>g.endAyah)
   THROW 51405, ''A translation span lies outside its segment.'', 1;
 IF EXISTS (SELECT 1 FROM [dbo].[QuranRecitationSegment] g
   WHERE g.id IN (SELECT segmentId FROM inserted UNION SELECT segmentId FROM deleted)
     AND (SELECT ISNULL(SUM(x.endAyah-x.startAyah+1),0) FROM [dbo].[QuranRecitationTranslationSpan] x WHERE x.segmentId=g.id)
         NOT IN (0, g.endAyah-g.startAyah+1))
   THROW 51405, ''A segment''''s translation covers every Ayah or none.'', 1;
 IF EXISTS (SELECT 1 FROM (
     SELECT x.startAyah, x.startMs,
       LAG(x.endAyah) OVER (PARTITION BY x.segmentId ORDER BY x.startAyah) AS previousAyah,
       LAG(x.endMs) OVER (PARTITION BY x.segmentId ORDER BY x.startAyah) AS previousEnd
     FROM [dbo].[QuranRecitationTranslationSpan] x
     WHERE x.segmentId IN (SELECT segmentId FROM inserted)) y
   WHERE y.startAyah<=y.previousAyah OR y.startMs<y.previousEnd)
   THROW 51405, ''A translation span overlaps the one before it.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i
   LEFT JOIN [dbo].[QuranRecitationTiming] t ON t.segmentId=i.segmentId AND t.ayahNumber=i.endAyah
   LEFT JOIN [dbo].[QuranRecitationTiming] n ON n.segmentId=i.segmentId AND n.ayahNumber=i.endAyah+1
   WHERE t.segmentId IS NULL OR i.startMs<t.endMs OR i.endMs>n.startMs)
   THROW 51405, ''A passage''''s translation is heard after its Arabic and before the next Ayah.'', 1;
 END;';

-- The timing an alignment relies on stays while the alignment does.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranRecitationTimingAligned] ON [dbo].[QuranRecitationTiming] AFTER DELETE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM deleted d JOIN [dbo].[QuranRecitationAlignment] a ON a.segmentId=d.segmentId)
   THROW 51405, ''An aligned segment keeps its timing.'', 1;
 END;';

-- The file an alignment describes stays the segment's file.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranRecitationSegmentAlignedAudio] ON [dbo].[QuranRecitationSegment] AFTER UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id
   JOIN [dbo].[QuranRecitationAlignment] a ON a.segmentId=i.id
   WHERE ISNULL(i.assetId,N'''') COLLATE Latin1_General_100_BIN2 <> ISNULL(d.assetId,N'''') COLLATE Latin1_General_100_BIN2)
   THROW 51405, ''An aligned segment keeps its file.'', 1;
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
