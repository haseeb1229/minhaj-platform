-- Disposable migration rehearsal only. Populated deployments require roll-forward or restored backup.
--
-- Quran Part 5 added a recitation's language and stream, the per-Ayah timing
-- table, three triggers, and redefined Phase 18's two "a published recitation
-- has audio" triggers. This removes the timing table and its trigger, the
-- stream rules, the two columns' CHECK and the three columns, and restores the
-- two triggers to Phase 18's exact text; every recitation, segment and asset
-- reference stays as it was.
BEGIN TRY
BEGIN TRAN;
DROP TRIGGER [dbo].[QuranRecitationTimingShape];
DROP TABLE [dbo].[QuranRecitationTiming];
DROP TRIGGER [dbo].[QuranRecitationSegmentStreamed];
DROP TRIGGER [dbo].[QuranRecitationStreamRules];
DROP TRIGGER [dbo].[QuranRecitationPublishedAudio];
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranRecitationPublishedAudio] ON [dbo].[QuranRecitation] AFTER INSERT, UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i WHERE i.state=N''published'' AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranRecitationSegment] s WHERE s.recitationId=i.id AND s.assetId IS NOT NULL)) THROW 51188, ''A published recitation needs audio.'', 1; END;';
DROP TRIGGER [dbo].[QuranRecitationSegmentKeepsAudio];
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranRecitationSegmentKeepsAudio] ON [dbo].[QuranRecitationSegment] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM [dbo].[QuranRecitation] r WHERE r.state=N''published'' AND r.id IN (SELECT recitationId FROM deleted) AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranRecitationSegment] s WHERE s.recitationId=r.id AND s.assetId IS NOT NULL)) THROW 51188, ''A published recitation needs audio.'', 1; END;';
ALTER TABLE [dbo].[QuranRecitation] DROP CONSTRAINT [QuranRecitation_stream_ck];
ALTER TABLE [dbo].[QuranRecitation] DROP CONSTRAINT [QuranRecitation_languageCode_fkey];
ALTER TABLE [dbo].[QuranRecitation] DROP COLUMN [streamPath], [streamProvider], [languageCode];
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261109120000_r2_quran_recitation_timing';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
