BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- Rebaseline R2 - Quran Part 2: the meaning beside a Surah's display name
-- ===========================================================================
--
-- PRESENTATION, NOT IDENTITY (DOMAIN_MODEL.md 8.3). A Surah's display name per
-- interface locale already lives in SurahName; a reader of the Surah index
-- also wants what the name MEANS in that locale ("The Opening" beside
-- "Al-Faatiha"). It is recorded beside the name it explains, in the same row,
-- written by the same administrative service under the same version and the
-- same `quran.administer` authority - never a new table, never a Surah column.
--
-- ONE NULLABLE COLUMN. A name with no recorded meaning keeps NULL; an empty
-- meaning is refused, as an empty name already is. Nothing is backfilled: no
-- meaning is written by this migration, and none is invented anywhere.
--
-- WHAT IT DOES NOT CHANGE. No canonical table, trigger, procedure or grant:
-- the runtime principal's SELECT, INSERT, UPDATE and DELETE on SurahName are
-- table grants and already cover the new column.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.

ALTER TABLE [dbo].[SurahName] ADD [meaning] NVARCHAR(100) NULL
    CONSTRAINT [SurahName_meaning_ck] CHECK ([meaning] IS NULL OR LEN([meaning]) > 0);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;

THROW

END CATCH
