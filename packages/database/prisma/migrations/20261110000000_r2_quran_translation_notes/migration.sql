BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- Rebaseline R2 - Quran Part 6: a translation's own translator's notes
-- ===========================================================================
--
-- ONE TABLE, OWNED BY QURAN (DOMAIN_MODEL.md 8.6). A Translation's text of an
-- Ayah may carry the translator's own notes - the words a mark in that text
-- ("٭", "*", "(1)") points to - and each is held exactly as its source wrote
-- it, beside the text it belongs to and never inside it:
--
--   QuranTranslationNote (translationId, surahNumber, ayahNumber, ordinal,
--                         marker, text)
--
--   - A TYPED KEY TO ITS TEXT. The note's work and Ayah are the composite key
--     of the QuranTranslationText row it annotates (NO ACTION), so a note can
--     exist only beside its text, and a text that carries notes cannot be
--     removed until its notes are - no polymorphic reference, nothing orphaned.
--   - ITS ORDER IS ITS IDENTITY. `ordinal` numbers an Ayah's notes 1..n in the
--     source's order, with no gap (trigger 51403), at most twenty to one text.
--   - THE MARKER AS WRITTEN. What the note opens with: nothing (''), a run of
--     one to four stars - Urdu "٭" or ASCII "*", optionally followed by ":" -
--     or a numbered entry "1:-" .. "99:-" (`TRANSLATION_NOTE_MARKER`,
--     `@minhaj/contracts/quran`). Whether a note answers a mark of its text is
--     the service's one pure rule (`tieTranslationNotes`); the schema holds
--     only the shapes.
--   - WRITTEN ONCE. A note is inserted with its text's save and never edited
--     in place: a change replaces the Ayah's notes whole (trigger 51403, and
--     the runtime principal holds SELECT, INSERT and DELETE only).
--
-- REFUSAL 51403 continues Quran Part 5's range (51400-51402).
--
-- APPEND-ONLY. Nothing below edits an accepted migration.

CREATE TABLE [dbo].[QuranTranslationNote] (
    [translationId] NVARCHAR(36) NOT NULL,
    [surahNumber] INT NOT NULL,
    [ayahNumber] INT NOT NULL,
    [ordinal] INT NOT NULL,
    [marker] NVARCHAR(8) NOT NULL,
    [text] NVARCHAR(MAX) NOT NULL,
    CONSTRAINT [QuranTranslationNote_pkey] PRIMARY KEY CLUSTERED ([translationId],[surahNumber],[ayahNumber],[ordinal])
);
ALTER TABLE [dbo].[QuranTranslationNote] ADD CONSTRAINT [QuranTranslationNote_text_fkey]
    FOREIGN KEY ([translationId],[surahNumber],[ayahNumber])
    REFERENCES [dbo].[QuranTranslationText]([translationId],[surahNumber],[ayahNumber])
    ON DELETE NO ACTION ON UPDATE NO ACTION;

-- At most twenty notes to one text, each non-empty and within 20,000 UTF-16
-- units (QURAN_LIMITS.notesPerAyah, QURAN_LIMITS.noteText).
ALTER TABLE [dbo].[QuranTranslationNote] ADD CONSTRAINT [QuranTranslationNote_ck]
    CHECK ([ordinal] BETWEEN 1 AND 20 AND DATALENGTH([text]) BETWEEN 1 AND 40000);

-- The marker's exact shapes under a binary collation: LIKE with no `%` matches
-- the whole value, and DATALENGTH (not `= N''`, which pads trailing spaces)
-- is the only test for none.
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
        OR [marker] COLLATE Latin1_General_100_BIN2 LIKE N'[1-9][0-9]:-');

EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranTranslationNoteShape] ON [dbo].[QuranTranslationNote] AFTER INSERT, UPDATE, DELETE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
   THROW 51403, ''A translator''''s note is written once, never edited.'', 1;
 IF EXISTS (SELECT 1 FROM (
     SELECT n.translationId, n.surahNumber, n.ayahNumber, COUNT(*) AS held, MAX(n.ordinal) AS last
     FROM [dbo].[QuranTranslationNote] n
     JOIN (SELECT translationId, surahNumber, ayahNumber FROM inserted
           UNION SELECT translationId, surahNumber, ayahNumber FROM deleted) a
       ON a.translationId=n.translationId AND a.surahNumber=n.surahNumber AND a.ayahNumber=n.ayahNumber
     GROUP BY n.translationId, n.surahNumber, n.ayahNumber) x
   WHERE x.held<>x.last)
   THROW 51403, ''An Ayah''''s notes are numbered from 1 without a gap.'', 1;
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
