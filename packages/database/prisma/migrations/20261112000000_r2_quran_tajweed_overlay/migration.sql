BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- Rebaseline R2 - Quran Part 9: tajweed colours
-- ===========================================================================
--
-- THREE TABLES, OWNED BY QURAN (DOMAIN_MODEL.md 8.9). A tajweed OVERLAY marks
-- stretches of the canonical Arabic with the tajweed rule each shows - an
-- overlay of rule spans over UNCHANGED canonical text, never a change to it:
--
--   QuranTajweedOverlay     (id, slug, name, description, attribution,
--                            sourceId, state, version, ...)
--     A layered work like a Translation - its own identity, immutable slug,
--     lifecycle, version and registered source - with no content Language
--     (it marks the Arabic itself) and no contributor (its source's credit is
--     its attribution).
--
--   QuranTajweedOverlayAyah (overlayId, surahNumber, ayahNumber, textSha256,
--                            spanCount)
--     One row per Ayah the overlay colours: the SHA-256 of the canonical text
--     its spans were aligned to - the stored NVARCHAR text as HASHBYTES sees
--     it (UTF-16LE) - and how many spans it has (0 when the Ayah was aligned
--     and no rule is marked in it). The digest must be the Ayah's CURRENT
--     text's when it is recorded, and the public reader shows the spans only
--     while it still is: after any canonical correction they describe another
--     text and are not shown (fail closed).
--
--   QuranTajweedSpan        (overlayId, surahNumber, ayahNumber, ordinal,
--                            rule, startCodepoint, endCodepoint)
--     [start, end) in Unicode CODE POINTS of the Ayah's stored text, and the
--     rule - one of a closed vocabulary (QURAN_TAJWEED_RULES in
--     `@minhaj/contracts/quran`). Spans MAY overlap or nest: the source marks
--     two rules on one letter where they meet. They come in order of their
--     start (`ordinal` from 1). That a span ends within the Ayah's code points
--     is the service's question, asked against the stored text; the database
--     holds the structural ceiling and that it ends within the text's UTF-16
--     length.
--
--   - TYPED KEYS. A recorded Ayah names its canonical Ayah by the citation, a
--     real foreign key (NO ACTION); a span names its recorded Ayah. No
--     polymorphic reference.
--   - WRITTEN ONCE (trigger 51407, and the runtime holds no UPDATE or DELETE):
--     an Ayah and its spans are inserted together and never edited; an Ayah
--     never gains spans beyond its `spanCount`.
--   - A PUBLISHED OVERLAY COLOURS AN AYAH (trigger 51406), as a published
--     Translation keeps text.
--
-- REFUSALS 51406-51407 continue translation audio's range (51400-51405).
--
-- APPEND-ONLY. Nothing below edits an accepted migration.

CREATE TABLE [dbo].[QuranTajweedOverlay] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(2000),
    [attribution] NVARCHAR(400),
    [sourceId] NVARCHAR(36),
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [QuranTajweedOverlay_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    [publishedAt] DATETIME2,
    CONSTRAINT [QuranTajweedOverlay_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [QuranTajweedOverlay_slug_key] UNIQUE NONCLUSTERED ([slug])
);

CREATE TABLE [dbo].[QuranTajweedOverlayAyah] (
    [overlayId] NVARCHAR(36) NOT NULL,
    [surahNumber] INT NOT NULL,
    [ayahNumber] INT NOT NULL,
    [textSha256] BINARY(32) NOT NULL,
    [spanCount] INT NOT NULL,
    CONSTRAINT [QuranTajweedOverlayAyah_pkey] PRIMARY KEY CLUSTERED ([overlayId],[surahNumber],[ayahNumber])
);

CREATE TABLE [dbo].[QuranTajweedSpan] (
    [overlayId] NVARCHAR(36) NOT NULL,
    [surahNumber] INT NOT NULL,
    [ayahNumber] INT NOT NULL,
    [ordinal] INT NOT NULL,
    [rule] NVARCHAR(32) NOT NULL,
    [startCodepoint] INT NOT NULL,
    [endCodepoint] INT NOT NULL,
    CONSTRAINT [QuranTajweedSpan_pkey] PRIMARY KEY CLUSTERED ([overlayId],[surahNumber],[ayahNumber],[ordinal])
);

CREATE NONCLUSTERED INDEX [QuranTajweedOverlay_state_slug_idx] ON [dbo].[QuranTajweedOverlay]([state],[slug]);
CREATE NONCLUSTERED INDEX [QuranTajweedOverlayAyah_ayah_idx] ON [dbo].[QuranTajweedOverlayAyah]([surahNumber],[ayahNumber]);
-- "Where does this rule occur?" - the Tajweed hub's and a rule page's read.
CREATE NONCLUSTERED INDEX [QuranTajweedSpan_rule_idx] ON [dbo].[QuranTajweedSpan]([overlayId],[rule]);

ALTER TABLE [dbo].[QuranTajweedOverlay] ADD CONSTRAINT [QuranTajweedOverlay_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[QuranSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTajweedOverlayAyah] ADD CONSTRAINT [QuranTajweedOverlayAyah_overlayId_fkey] FOREIGN KEY ([overlayId]) REFERENCES [dbo].[QuranTajweedOverlay]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTajweedOverlayAyah] ADD CONSTRAINT [QuranTajweedOverlayAyah_ayah_fkey] FOREIGN KEY ([surahNumber],[ayahNumber]) REFERENCES [dbo].[Ayah]([surahNumber],[ayahNumber]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTajweedSpan] ADD CONSTRAINT [QuranTajweedSpan_ayah_fkey] FOREIGN KEY ([overlayId],[surahNumber],[ayahNumber]) REFERENCES [dbo].[QuranTajweedOverlayAyah]([overlayId],[surahNumber],[ayahNumber]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- The slug and lifecycle rules every layered work keeps (Phase 18).
ALTER TABLE [dbo].[QuranTajweedOverlay] ADD CONSTRAINT [QuranTajweedOverlay_slug_ck] CHECK (LEN([slug])>=2 AND [slug] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^a-z0-9-]%' AND [slug] NOT LIKE N'-%' AND [slug] NOT LIKE N'%-' AND [slug] NOT LIKE N'%--%');
ALTER TABLE [dbo].[QuranTajweedOverlay] ADD CONSTRAINT [QuranTajweedOverlay_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived') AND [version]>0 AND ([state]<>N'published' OR ([sourceId] IS NOT NULL AND [publishedAt] IS NOT NULL)));
-- An Ayah's spans within the structural ceiling (QURAN_TAJWEED_SPANS_MAX).
ALTER TABLE [dbo].[QuranTajweedOverlayAyah] ADD CONSTRAINT [QuranTajweedOverlayAyah_ck] CHECK ([spanCount] BETWEEN 0 AND 999);
-- A known rule, a place from 1, and a non-empty stretch within the canonical
-- text's ceiling (QURAN_LIMITS.ayahText).
ALTER TABLE [dbo].[QuranTajweedSpan] ADD CONSTRAINT [QuranTajweedSpan_ck] CHECK ([rule] IN (N'ghunnah',N'idghaam-ghunnah',N'idghaam-no-ghunnah',N'idghaam-mutajanisayn',N'idghaam-mutaqaribayn',N'idghaam-shafawi',N'ikhfa',N'ikhfa-shafawi',N'iqlab',N'madd-2',N'madd-246',N'madd-muttasil',N'madd-munfasil',N'madd-6',N'qalqalah',N'hamzat-wasl',N'lam-shamsiyyah',N'silent') AND [ordinal] BETWEEN 1 AND 999 AND [startCodepoint]>=0 AND [endCodepoint]>[startCodepoint] AND [endCodepoint]<=4000);

EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranTajweedOverlayPublishedAyat] ON [dbo].[QuranTajweedOverlay] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i WHERE i.state=N''published''
   AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranTajweedOverlayAyah] a WHERE a.overlayId=i.id))
   THROW 51406, ''A published tajweed overlay colours an Ayah.'', 1;
 END;';

EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranTajweedOverlayAyahRules] ON [dbo].[QuranTajweedOverlayAyah] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
   THROW 51407, ''A tajweed Ayah is written once, never edited.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Ayah] a ON a.surahNumber=i.surahNumber AND a.ayahNumber=i.ayahNumber
   WHERE i.textSha256 <> HASHBYTES(''SHA2_256'', a.[text]))
   THROW 51407, ''A tajweed Ayah is aligned to the Ayah''''s current text.'', 1;
 END;';

EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranTajweedSpanRules] ON [dbo].[QuranTajweedSpan] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
   THROW 51407, ''A tajweed span is written once, never edited.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[Ayah] a ON a.surahNumber=i.surahNumber AND a.ayahNumber=i.ayahNumber
   WHERE i.endCodepoint > DATALENGTH(a.[text]) / 2)
   THROW 51407, ''A tajweed span ends within its Ayah''''s text.'', 1;
 IF EXISTS (SELECT 1 FROM [dbo].[QuranTajweedOverlayAyah] o
   WHERE EXISTS (SELECT 1 FROM inserted i WHERE i.overlayId=o.overlayId AND i.surahNumber=o.surahNumber AND i.ayahNumber=o.ayahNumber)
     AND (SELECT COUNT(*) FROM [dbo].[QuranTajweedSpan] s
          WHERE s.overlayId=o.overlayId AND s.surahNumber=o.surahNumber AND s.ayahNumber=o.ayahNumber) > o.spanCount)
   THROW 51407, ''A tajweed Ayah has no spans beyond its count.'', 1;
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
