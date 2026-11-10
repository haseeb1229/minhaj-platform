BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- Rebaseline R2 - external reference translations: a bracketed footnote mark
-- ===========================================================================
--
-- OWNER-DECISION-2026-11-10-EXTERNAL-REFERENCE-TRANSLATIONS (OPEN_DECISIONS.md
-- 1.2) admits QuranEnc's Urdu and English translations, whose footnotes open
-- with the mark they answer exactly as the translation writes it: "[8]". A
-- translator's note may therefore also open with a bracketed number "[1]" ..
-- "[9999]" (`TRANSLATION_NOTE_MARKER`, `@minhaj/contracts/quran`); whether it
-- answers its text's mark stays the service's one pure rule
-- (`tieTranslationNotes`). Every shape Quran Part 6 admitted stays admitted.
--
-- ONE CHECK REPLACED, NOTHING ELSE. No table, column, key, trigger or row
-- changes; the runtime principal's grants are untouched.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.

ALTER TABLE [dbo].[QuranTranslationNote] DROP CONSTRAINT [QuranTranslationNote_marker_ck];

-- The marker's exact shapes under a binary collation: LIKE with no `%` matches
-- the whole value ("[[]" is a literal "["), and DATALENGTH (not `= N''`, which
-- pads trailing spaces) is the only test for none.
ALTER TABLE [dbo].[QuranTranslationNote] ADD CONSTRAINT [QuranTranslationNote_marker_ck]
    CHECK (DATALENGTH([marker]) = 0
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[٭*]'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[٭*]:'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[٭*][٭*]'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[٭*][٭*]:'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[٭*][٭*][٭*]'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[٭*][٭*][٭*]:'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[٭*][٭*][٭*][٭*]'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[٭*][٭*][٭*][٭*]:'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[1-9]:-'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[1-9][0-9]:-'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[[][1-9]]'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[[][1-9][0-9]]'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[[][1-9][0-9][0-9]]'
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[[][1-9][0-9][0-9][0-9]]');

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;

THROW

END CATCH
