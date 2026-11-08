-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Rebaseline R2 added the Quran `reference` authority: the widened authority and evidence CHECKs, a wider evidence column, and the fixture/reference separation in the activation and canonical-change triggers. It REFUSES while any reference source exists or any evidence is longer than Phase 18 allowed, because a registered source is immutable and is never discarded to make a rollback fit; then it restores the Phase-18 trigger bodies, CHECKs and column exactly, then the migration record. No other row moves.
BEGIN TRY
BEGIN TRAN;
IF EXISTS (SELECT 1 FROM [dbo].[QuranSource] WHERE [authority] = N'reference' OR LEN([reference]) > 400)
  THROW 50000, 'A reference Quran source, or evidence longer than Phase 18 allowed, exists. This disposable-proof rollback never discards a registered source.', 1;
EXEC(N'ALTER TRIGGER [dbo].[AyahCanonicalChange] ON [dbo].[Ayah] AFTER UPDATE, DELETE AS BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted) THROW 51181, ''Canonical Quran structure is immutable.'', 1;
 IF UPDATE(surahNumber) OR UPDATE(ayahNumber) OR UPDATE(juzNumber) OR UPDATE(hizb) OR UPDATE(page) OR UPDATE(sajdah) THROW 51181, ''Canonical Quran structure is immutable.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.surahNumber=i.surahNumber AND d.ayahNumber=i.ayahNumber WHERE i.version<>d.version+1) THROW 51182, ''A canonical change must advance the version by one.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM [dbo].[QuranAyahRevision] r WHERE r.surahNumber=i.surahNumber AND r.ayahNumber=i.ayahNumber AND r.version=i.version AND r.sourceId=i.sourceId AND CAST(r.text AS VARBINARY(8000))=CAST(i.text AS VARBINARY(8000)))) THROW 51182, ''A canonical change must be recorded in its history.'', 1;
 END;');
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
   THROW 51185, ''An approved corpus cannot carry fixture text.'', 1;
 END;');
ALTER TABLE [dbo].[QuranSource] DROP CONSTRAINT [QuranSource_evidence_ck];
ALTER TABLE [dbo].[QuranSource] DROP CONSTRAINT [QuranSource_authority_ck];
ALTER TABLE [dbo].[QuranSource] ALTER COLUMN [reference] NVARCHAR(400) NULL;
ALTER TABLE [dbo].[QuranSource] ADD CONSTRAINT [QuranSource_authority_ck] CHECK ([authority] IN (N'fixture',N'approved'));
ALTER TABLE [dbo].[QuranSource] ADD CONSTRAINT [QuranSource_evidence_ck] CHECK ([authority]<>N'approved' OR ([reference] IS NOT NULL AND LEN([reference])>0));
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261106000001_r2_quran_reference_preview';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
