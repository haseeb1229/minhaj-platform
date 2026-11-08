-- ===========================================================================
-- Rebaseline R2 — the Quran REFERENCE authority (staging reference preview)
-- ===========================================================================
--
-- OWNER DECISION, NOT A NEW PHASE (2026-11-06). The password-protected,
-- non-indexable staging deployment may show a REAL Quran text for review: the
-- Tanzil Project's Uthmani text, verbatim, under its own licence, beside
-- Minhaj-ul-Quran's own Irfan-ul-Quran translation. It is never Minhaj's
-- religious approval of anything, and the production approval path
-- (OPEN_DECISIONS.md 1.1) is unchanged.
--
-- A THIRD AUTHORITY, `reference`, so the text is never mislabelled:
--
--   fixture    synthetic engineering text that proves mechanisms;
--   reference  a real, licensed, verbatim external text, NOT reviewed by
--              Minhaj-ul-Quran's religious authority for this platform;
--   approved   a source an external religious authority approved.
--
-- What this migration changes, and nothing else:
--
--   1. QuranSource_authority_ck admits `reference`; QuranSource_evidence_ck
--      requires a reference source to carry its evidence (licence, version,
--      digest and the source's own notice) exactly as an approved one does,
--      and `reference` widens to hold the source's notice verbatim.
--   2. The activation integrity trigger keeps every rule it had, so an
--      APPROVED activation still refuses any Ayah whose source is not
--      approved (reference text can never enter an approved corpus), and
--      gains two: a reference activation refuses fixture text and a fixture
--      activation refuses reference text (refusal 51185).
--   3. The canonical-change trigger keeps every rule it had and gains the same
--      separation for a correction made beneath an active fixture or
--      reference corpus (refusal 51198, the authority-mixing refusal).
--
-- WHAT IT DOES NOT CHANGE. No grant: the runtime principal still reads the
-- source and activation tables and writes neither, and canonical text is still
-- written only by the three procedures. Hadith and Fatwa are untouched. A
-- deployment shows a reference corpus only when it ALSO admits it
-- (`RELIGIOUS_REFERENCE_PREVIEW`), which configuration refuses beside public
-- indexing; without that admission the corpus is inactive everywhere.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.

BEGIN TRY

BEGIN TRAN;

ALTER TABLE [dbo].[QuranSource] DROP CONSTRAINT [QuranSource_evidence_ck];
ALTER TABLE [dbo].[QuranSource] DROP CONSTRAINT [QuranSource_authority_ck];

-- The source's own notice is kept verbatim with the source (a licence such as
-- Tanzil's requires its copyright block in every copy), so the evidence column
-- is wide enough to hold it beside the version and digest.
ALTER TABLE [dbo].[QuranSource] ALTER COLUMN [reference] NVARCHAR(2000) NULL;

ALTER TABLE [dbo].[QuranSource] ADD CONSTRAINT [QuranSource_authority_ck] CHECK ([authority] IN (N'fixture',N'approved',N'reference'));
-- An approved or reference source carries its evidence. The platform records
-- it; it never invents it.
ALTER TABLE [dbo].[QuranSource] ADD CONSTRAINT [QuranSource_evidence_ck] CHECK ([authority] NOT IN (N'approved',N'reference') OR ([reference] IS NOT NULL AND LEN([reference])>0));

-- ACTIVATION, with the three authorities kept apart. Every Phase-18 rule stands
-- unchanged; the last two are new.
EXEC(N'ALTER TRIGGER [dbo].[QuranActivationIntegrity] ON [dbo].[QuranActivation] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF UPDATE(sourceId) AND EXISTS (SELECT 1 FROM deleted) THROW 51185, ''Activation is replaced, never edited.'', 1;
 DECLARE @sourceId NVARCHAR(36) = (SELECT TOP 1 sourceId FROM inserted);
 IF NOT EXISTS (SELECT 1 FROM [dbo].[Ayah]) THROW 51185, ''An empty Quran corpus cannot be activated.'', 1;
 IF EXISTS (SELECT 1 FROM [dbo].[QuranSourceAyah] s WHERE s.sourceId=@sourceId AND NOT EXISTS (SELECT 1 FROM [dbo].[Ayah] a WHERE a.surahNumber=s.surahNumber AND a.ayahNumber=s.ayahNumber AND a.juzNumber=s.juzNumber))
   OR EXISTS (SELECT 1 FROM [dbo].[Ayah] a WHERE NOT EXISTS (SELECT 1 FROM [dbo].[QuranSourceAyah] s WHERE s.sourceId=@sourceId AND s.surahNumber=a.surahNumber AND s.ayahNumber=a.ayahNumber))
   OR EXISTS (SELECT 1 FROM [dbo].[Surah] h WHERE h.ayahCount<>(SELECT COUNT(*) FROM [dbo].[Ayah] a WHERE a.surahNumber=h.number))
   THROW 51185, ''The canonical corpus does not match the activating source.'', 1;
 IF EXISTS (SELECT 1 FROM [dbo].[QuranSource] q WHERE q.id=@sourceId AND q.authority=N''approved'')
    AND EXISTS (SELECT 1 FROM [dbo].[Ayah] a JOIN [dbo].[QuranSource] q ON q.id=a.sourceId WHERE q.authority<>N''approved'')
   THROW 51185, ''An approved corpus cannot carry text that is not approved.'', 1;
 IF EXISTS (SELECT 1 FROM [dbo].[QuranSource] q WHERE q.id=@sourceId AND q.authority=N''reference'')
    AND EXISTS (SELECT 1 FROM [dbo].[Ayah] a JOIN [dbo].[QuranSource] q ON q.id=a.sourceId WHERE q.authority=N''fixture'')
   THROW 51185, ''A reference corpus cannot carry fixture text.'', 1;
 IF EXISTS (SELECT 1 FROM [dbo].[QuranSource] q WHERE q.id=@sourceId AND q.authority=N''fixture'')
    AND EXISTS (SELECT 1 FROM [dbo].[Ayah] a JOIN [dbo].[QuranSource] q ON q.id=a.sourceId WHERE q.authority=N''reference'')
   THROW 51185, ''A fixture corpus cannot carry reference text.'', 1;
END');

-- A CORRECTION beneath an active corpus keeps the same separation: fixture
-- text never enters an active reference corpus and reference text never enters
-- an active fixture corpus. (Beneath an approved corpus the procedure already
-- accepts approved text only.) Every Phase-18 rule stands unchanged.
EXEC(N'ALTER TRIGGER [dbo].[AyahCanonicalChange] ON [dbo].[Ayah] AFTER UPDATE, DELETE AS BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted) THROW 51181, ''Canonical Quran structure is immutable.'', 1;
 IF UPDATE(surahNumber) OR UPDATE(ayahNumber) OR UPDATE(juzNumber) OR UPDATE(hizb) OR UPDATE(page) OR UPDATE(sajdah) THROW 51181, ''Canonical Quran structure is immutable.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.surahNumber=i.surahNumber AND d.ayahNumber=i.ayahNumber WHERE i.version<>d.version+1) THROW 51182, ''A canonical change must advance the version by one.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM [dbo].[QuranAyahRevision] r WHERE r.surahNumber=i.surahNumber AND r.ayahNumber=i.ayahNumber AND r.version=i.version AND r.sourceId=i.sourceId AND CAST(r.text AS VARBINARY(8000))=CAST(i.text AS VARBINARY(8000)))) THROW 51182, ''A canonical change must be recorded in its history.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN [dbo].[QuranSource] s ON s.id=i.sourceId
   JOIN [dbo].[QuranActivation] v ON v.id=1
   JOIN [dbo].[QuranSource] q ON q.id=v.sourceId
   WHERE (q.authority=N''reference'' AND s.authority=N''fixture'') OR (q.authority=N''fixture'' AND s.authority=N''reference''))
   THROW 51198, ''A correction cannot mix fixture and reference text.'', 1;
END');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
