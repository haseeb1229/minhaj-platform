BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- Rebaseline R2 - Quran Part 7: word by word
-- ===========================================================================
--
-- THREE TABLES, OWNED BY QURAN (DOMAIN_MODEL.md 8.7). A word-by-word work is
-- a layered work like a Translation - its own identity, immutable slug,
-- content Language, lifecycle, version, registered source and contributors -
-- whose content is one gloss per word of the Arabic, exactly as its source
-- wrote it. Nothing here derives a gloss, or a word, from the Arabic:
--
--   QuranWordByWord            (id, slug, languageCode, name, description,
--                               attribution, sourceId, state, version, ...)
--   QuranWordByWordContributor (wordByWordId, personId, role, position)
--   QuranWordByWordGloss       (wordByWordId, surahNumber, ayahNumber,
--                               position, text)
--
--   - A TYPED KEY TO THE AYAH. A gloss names its Ayah by the canonical
--     citation, a real foreign key (NO ACTION) - no polymorphic reference.
--   - THE WORD IS ITS POSITION, from 1, in the Ayah's stored text as the one
--     segmentation cuts it (`ayahWords`, `@minhaj/contracts/quran`). The
--     schema holds the structural ceiling (1..999); whether a position is one
--     of the Ayah's words is the service's question, asked against the
--     stored text. One gloss per (work, Surah, Ayah, position).
--   - A PUBLISHED WORK KEEPS A GLOSS (trigger 51404), exactly as a published
--     Translation keeps text (51189).
--
-- REFUSAL 51404 continues Quran Part 6's range (51400-51403).
--
-- APPEND-ONLY. Nothing below edits an accepted migration.

CREATE TABLE [dbo].[QuranWordByWord] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(2000),
    [attribution] NVARCHAR(400),
    [sourceId] NVARCHAR(36),
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [QuranWordByWord_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    [publishedAt] DATETIME2,
    CONSTRAINT [QuranWordByWord_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [QuranWordByWord_slug_key] UNIQUE NONCLUSTERED ([slug])
);

CREATE TABLE [dbo].[QuranWordByWordContributor] (
    [wordByWordId] NVARCHAR(36) NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(32) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [QuranWordByWordContributor_pkey] PRIMARY KEY CLUSTERED ([wordByWordId],[personId],[role])
);

CREATE TABLE [dbo].[QuranWordByWordGloss] (
    [wordByWordId] NVARCHAR(36) NOT NULL,
    [surahNumber] INT NOT NULL,
    [ayahNumber] INT NOT NULL,
    [position] INT NOT NULL,
    [text] NVARCHAR(200) NOT NULL,
    CONSTRAINT [QuranWordByWordGloss_pkey] PRIMARY KEY CLUSTERED ([wordByWordId],[surahNumber],[ayahNumber],[position])
);

CREATE NONCLUSTERED INDEX [QuranWordByWord_state_slug_idx] ON [dbo].[QuranWordByWord]([state],[slug]);
CREATE NONCLUSTERED INDEX [QuranWordByWordContributor_personId_idx] ON [dbo].[QuranWordByWordContributor]([personId]);
CREATE NONCLUSTERED INDEX [QuranWordByWordGloss_ayah_idx] ON [dbo].[QuranWordByWordGloss]([surahNumber],[ayahNumber]);

ALTER TABLE [dbo].[QuranWordByWord] ADD CONSTRAINT [QuranWordByWord_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranWordByWord] ADD CONSTRAINT [QuranWordByWord_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[QuranSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranWordByWordContributor] ADD CONSTRAINT [QuranWordByWordContributor_wordByWordId_fkey] FOREIGN KEY ([wordByWordId]) REFERENCES [dbo].[QuranWordByWord]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranWordByWordContributor] ADD CONSTRAINT [QuranWordByWordContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranWordByWordGloss] ADD CONSTRAINT [QuranWordByWordGloss_wordByWordId_fkey] FOREIGN KEY ([wordByWordId]) REFERENCES [dbo].[QuranWordByWord]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranWordByWordGloss] ADD CONSTRAINT [QuranWordByWordGloss_ayah_fkey] FOREIGN KEY ([surahNumber],[ayahNumber]) REFERENCES [dbo].[Ayah]([surahNumber],[ayahNumber]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- The slug and lifecycle rules every layered work keeps (Phase 18).
ALTER TABLE [dbo].[QuranWordByWord] ADD CONSTRAINT [QuranWordByWord_slug_ck] CHECK (LEN([slug])>=2 AND [slug] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^a-z0-9-]%' AND [slug] NOT LIKE N'-%' AND [slug] NOT LIKE N'%-' AND [slug] NOT LIKE N'%--%');
ALTER TABLE [dbo].[QuranWordByWord] ADD CONSTRAINT [QuranWordByWord_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived') AND [version]>0 AND ([state]<>N'published' OR ([sourceId] IS NOT NULL AND [publishedAt] IS NOT NULL)));
-- A Translation's contributor roles: a gloss renders a word, as a translator does.
ALTER TABLE [dbo].[QuranWordByWordContributor] ADD CONSTRAINT [QuranWordByWordContributor_ck] CHECK ([role] IN (N'translator',N'editor') AND [position] BETWEEN 0 AND 11);
-- A word's place from 1 within the structural ceiling (QURAN_WORD_POSITION_MAX),
-- and a non-empty gloss within 200 UTF-16 units (QURAN_LIMITS.gloss).
ALTER TABLE [dbo].[QuranWordByWordGloss] ADD CONSTRAINT [QuranWordByWordGloss_ck] CHECK ([position] BETWEEN 1 AND 999 AND DATALENGTH([text]) BETWEEN 1 AND 400);

EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranWordByWordPublishedGlosses] ON [dbo].[QuranWordByWord] AFTER INSERT, UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i WHERE i.state=N''published'' AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranWordByWordGloss] g WHERE g.wordByWordId=i.id)) THROW 51404, ''A published word-by-word work needs a gloss.'', 1; END;';

EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranWordByWordGlossKept] ON [dbo].[QuranWordByWordGloss] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM [dbo].[QuranWordByWord] w WHERE w.state=N''published'' AND w.id IN (SELECT wordByWordId FROM deleted) AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranWordByWordGloss] g WHERE g.wordByWordId=w.id)) THROW 51404, ''A published word-by-word work needs a gloss.'', 1; END;';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;

THROW

END CATCH
