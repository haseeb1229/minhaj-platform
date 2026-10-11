-- ===========================================================================
-- Phase 18 — Quran
-- ===========================================================================
--
-- THE QURAN CONTEXT (DOMAIN_MODEL.md 8): canonical structure and Arabic text,
-- the layered works over it, recitations and tajweed guidance, and typed topic
-- assignment. Nothing below names Editorial, Library, Media, Hadith or any
-- other content context, and no table of theirs is touched except Search's
-- derived vocabulary.
--
-- NO QURAN CONTENT IS SEEDED. Not a Surah, not an Ayah, not a name, not a count.
-- The authoritative source is an open external decision (OPEN_DECISIONS.md
-- 1.1, 1.2, 2.4); a database migrated by this file holds an EMPTY corpus and
-- every public Quran surface says so.
--
-- FOUR GROUPS OF TABLES, FOUR POSTURES FOR THE APPLICATION PRINCIPAL:
--
--   SOURCE        QuranSource, QuranSourceSurah, QuranSourceAyah, QuranActivation
--                 — registered by the owner/operator only. The runtime may READ
--                 them and nothing else, so no permission, label or checkbox can
--                 create an authority, turn a fixture into one, or activate a
--                 corpus. Sources are immutable once registered.
--
--   CANONICAL     Juz, Surah, Ayah, QuranAyahRevision, QuranVerificationRun
--                 — written ONLY by three procedures. The runtime holds SELECT
--                 and EXECUTE, never INSERT, UPDATE or DELETE on these tables.
--                 Canonical text is only ever COPIED from a registered source's
--                 own rows, after the database itself compares the candidate
--                 byte for byte; a correction re-checks the actor's live
--                 `quran.editCanonical` grant and purpose-bound step-up grant in
--                 SQL before it writes, and appends an immutable revision.
--
--   LAYERED       translations, transliterations, tafsir, recitations and
--                 their segments, tajweed rules, Surah display names, Ayah
--                 topics — administered through the Quran service under
--                 `quran.administer`. A layered work is public only while the
--                 corpus is active, it is published, and it names a REGISTERED
--                 source — which the runtime cannot create.
--
--   DERIVED       Search's `quran-ayah` vocabulary.
--
-- REFUSALS 51180-51199, distinct from every earlier phase's.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.

BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- SOURCE — registered by the owner/operator, read by everyone else
-- ===========================================================================

CREATE TABLE [dbo].[QuranSource] (
    [id] NVARCHAR(36) NOT NULL,
    [code] NVARCHAR(64) NOT NULL,
    [authority] NVARCHAR(16) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [version] NVARCHAR(64) NOT NULL,
    [encoding] NVARCHAR(32) NOT NULL,
    [script] NVARCHAR(64),
    [reference] NVARCHAR(400),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [QuranSource_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [QuranSource_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [QuranSource_code_key] UNIQUE NONCLUSTERED ([code])
);

CREATE TABLE [dbo].[QuranSourceSurah] (
    [sourceId] NVARCHAR(36) NOT NULL,
    [number] INT NOT NULL,
    [ayahCount] INT NOT NULL,
    [revelation] NVARCHAR(16),
    [nameArabic] NVARCHAR(100),
    CONSTRAINT [QuranSourceSurah_pkey] PRIMARY KEY CLUSTERED ([sourceId],[number])
);

CREATE TABLE [dbo].[QuranSourceAyah] (
    [sourceId] NVARCHAR(36) NOT NULL,
    [surahNumber] INT NOT NULL,
    [ayahNumber] INT NOT NULL,
    [juzNumber] INT NOT NULL,
    [hizb] INT,
    [page] INT,
    [sajdah] NVARCHAR(16),
    [text] NVARCHAR(4000) NOT NULL,
    CONSTRAINT [QuranSourceAyah_pkey] PRIMARY KEY CLUSTERED ([sourceId],[surahNumber],[ayahNumber])
);

-- The corpus is public if and only if this single row exists.
CREATE TABLE [dbo].[QuranActivation] (
    [id] INT NOT NULL,
    [sourceId] NVARCHAR(36) NOT NULL,
    [activatedAt] DATETIME2 NOT NULL CONSTRAINT [QuranActivation_activatedAt_df] DEFAULT SYSUTCDATETIME(),
    [authorisedBy] NVARCHAR(200) NOT NULL,
    CONSTRAINT [QuranActivation_pkey] PRIMARY KEY CLUSTERED ([id])
);

ALTER TABLE [dbo].[QuranSourceSurah] ADD CONSTRAINT [QuranSourceSurah_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[QuranSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranSourceAyah] ADD CONSTRAINT [QuranSourceAyah_surah_fkey] FOREIGN KEY ([sourceId],[surahNumber]) REFERENCES [dbo].[QuranSourceSurah]([sourceId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranActivation] ADD CONSTRAINT [QuranActivation_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[QuranSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[QuranSource] ADD CONSTRAINT [QuranSource_authority_ck] CHECK ([authority] IN (N'fixture',N'approved'));
-- An approved source carries the reference to the authority's evidence. The
-- platform records it; it never invents it.
ALTER TABLE [dbo].[QuranSource] ADD CONSTRAINT [QuranSource_evidence_ck] CHECK ([authority]<>N'approved' OR ([reference] IS NOT NULL AND LEN([reference])>0));
-- The one transport encoding the verifier implements. Another arrives with the
-- source that needs it, and with its decoder.
ALTER TABLE [dbo].[QuranSource] ADD CONSTRAINT [QuranSource_encoding_ck] CHECK ([encoding]=N'utf-8');
ALTER TABLE [dbo].[QuranSource] ADD CONSTRAINT [QuranSource_code_ck] CHECK (LEN([code])>0 AND LEN([title])>0 AND LEN([version])>0);
ALTER TABLE [dbo].[QuranSourceSurah] ADD CONSTRAINT [QuranSourceSurah_number_ck] CHECK ([number] BETWEEN 1 AND 114 AND [ayahCount] BETWEEN 1 AND 999);
ALTER TABLE [dbo].[QuranSourceSurah] ADD CONSTRAINT [QuranSourceSurah_revelation_ck] CHECK ([revelation] IS NULL OR [revelation] IN (N'meccan',N'medinan'));
ALTER TABLE [dbo].[QuranSourceAyah] ADD CONSTRAINT [QuranSourceAyah_structure_ck] CHECK ([ayahNumber] BETWEEN 1 AND 999 AND [juzNumber] BETWEEN 1 AND 30 AND ([hizb] IS NULL OR [hizb] BETWEEN 1 AND 60) AND ([page] IS NULL OR [page] BETWEEN 1 AND 9999));
ALTER TABLE [dbo].[QuranSourceAyah] ADD CONSTRAINT [QuranSourceAyah_sajdah_ck] CHECK ([sajdah] IS NULL OR [sajdah] IN (N'recommended',N'obligatory'));
ALTER TABLE [dbo].[QuranSourceAyah] ADD CONSTRAINT [QuranSourceAyah_text_ck] CHECK (DATALENGTH([text])>0);
ALTER TABLE [dbo].[QuranActivation] ADD CONSTRAINT [QuranActivation_singleton_ck] CHECK ([id]=1 AND LEN([authorisedBy])>0);

-- A registered source is a fact about an external text. It is never edited:
-- a corrected source is a NEW source with its own version.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranSourceImmutable] ON [dbo].[QuranSource] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51180, ''A registered Quran source is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranSourceSurahImmutable] ON [dbo].[QuranSourceSurah] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51180, ''A registered Quran source is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranSourceAyahImmutable] ON [dbo].[QuranSourceAyah] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51180, ''A registered Quran source is immutable.'', 1; END;';
-- No source Ayah beyond its Surah's own count.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranSourceAyahWithinSurah] ON [dbo].[QuranSourceAyah] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[QuranSourceSurah] s ON s.sourceId=i.sourceId AND s.number=i.surahNumber WHERE i.ayahNumber>s.ayahCount) THROW 51180, ''A source Ayah lies outside its Surah.'', 1; END;';

-- ===========================================================================
-- CANONICAL — written only by the procedures below
-- ===========================================================================

CREATE TABLE [dbo].[Juz] (
    [number] INT NOT NULL,
    [sourceId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Juz_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Juz_pkey] PRIMARY KEY CLUSTERED ([number])
);

CREATE TABLE [dbo].[Surah] (
    [number] INT NOT NULL,
    [ayahCount] INT NOT NULL,
    [revelation] NVARCHAR(16),
    [nameArabic] NVARCHAR(100),
    [sourceId] NVARCHAR(36) NOT NULL,
    -- The version of the Surah's DISPLAY NAMES, the only thing about a Surah
    -- the application may change. Its canonical facts never change.
    [namesVersion] INT NOT NULL CONSTRAINT [Surah_namesVersion_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Surah_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Surah_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Surah_pkey] PRIMARY KEY CLUSTERED ([number])
);

-- The canonical citation `(surahNumber, ayahNumber)` IS the identity. There is
-- no surrogate key that could drift from it, and the Juz is a direct reference:
-- a Juz's range is DERIVED from its ayat, never stored beside them where the two
-- could disagree.
CREATE TABLE [dbo].[Ayah] (
    [surahNumber] INT NOT NULL,
    [ayahNumber] INT NOT NULL,
    [juzNumber] INT NOT NULL,
    [hizb] INT,
    [page] INT,
    [sajdah] NVARCHAR(16),
    [text] NVARCHAR(4000) NOT NULL,
    [sourceId] NVARCHAR(36) NOT NULL,
    [version] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Ayah_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Ayah_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Ayah_pkey] PRIMARY KEY CLUSTERED ([surahNumber],[ayahNumber])
);

-- Immutable evidence of every verification, passed or failed. Content-free: it
-- names references and positions, never text.
CREATE TABLE [dbo].[QuranVerificationRun] (
    [id] NVARCHAR(36) NOT NULL,
    [kind] NVARCHAR(24) NOT NULL,
    [outcome] NVARCHAR(16) NOT NULL,
    [sourceId] NVARCHAR(36) NOT NULL,
    [checked] INT NOT NULL,
    [mismatches] INT NOT NULL,
    [firstSurah] INT,
    [firstAyah] INT,
    [firstOffset] INT,
    [firstReason] NVARCHAR(32),
    [actorId] NVARCHAR(36),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [QuranVerificationRun_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [QuranVerificationRun_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- Every canonical version of every Ayah, version 1 included. The actor and the
-- step-up grant are HISTORICAL identifiers (DOMAIN_MODEL.md 6.2.1): a grant row
-- is deleted when it expires or its session ends, and the evidence must outlive
-- it, so they carry no foreign key.
CREATE TABLE [dbo].[QuranAyahRevision] (
    [surahNumber] INT NOT NULL,
    [ayahNumber] INT NOT NULL,
    [version] INT NOT NULL,
    [text] NVARCHAR(4000) NOT NULL,
    [sourceId] NVARCHAR(36) NOT NULL,
    [verificationRunId] NVARCHAR(36) NOT NULL,
    [actorId] NVARCHAR(36),
    [stepUpGrantId] NVARCHAR(36),
    [reason] NVARCHAR(500),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [QuranAyahRevision_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [QuranAyahRevision_pkey] PRIMARY KEY CLUSTERED ([surahNumber],[ayahNumber],[version])
);

CREATE NONCLUSTERED INDEX [Ayah_juzNumber_surahNumber_ayahNumber_idx] ON [dbo].[Ayah]([juzNumber],[surahNumber],[ayahNumber]);
CREATE NONCLUSTERED INDEX [QuranVerificationRun_createdAt_idx] ON [dbo].[QuranVerificationRun]([createdAt] DESC, [id]);

ALTER TABLE [dbo].[Juz] ADD CONSTRAINT [Juz_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[QuranSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Surah] ADD CONSTRAINT [Surah_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[QuranSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Ayah] ADD CONSTRAINT [Ayah_surahNumber_fkey] FOREIGN KEY ([surahNumber]) REFERENCES [dbo].[Surah]([number]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Ayah] ADD CONSTRAINT [Ayah_juzNumber_fkey] FOREIGN KEY ([juzNumber]) REFERENCES [dbo].[Juz]([number]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Ayah] ADD CONSTRAINT [Ayah_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[QuranSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranVerificationRun] ADD CONSTRAINT [QuranVerificationRun_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[QuranSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranAyahRevision] ADD CONSTRAINT [QuranAyahRevision_ayah_fkey] FOREIGN KEY ([surahNumber],[ayahNumber]) REFERENCES [dbo].[Ayah]([surahNumber],[ayahNumber]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranAyahRevision] ADD CONSTRAINT [QuranAyahRevision_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[QuranSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranAyahRevision] ADD CONSTRAINT [QuranAyahRevision_run_fkey] FOREIGN KEY ([verificationRunId]) REFERENCES [dbo].[QuranVerificationRun]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[Juz] ADD CONSTRAINT [Juz_number_ck] CHECK ([number] BETWEEN 1 AND 30);
ALTER TABLE [dbo].[Surah] ADD CONSTRAINT [Surah_number_ck] CHECK ([number] BETWEEN 1 AND 114 AND [ayahCount] BETWEEN 1 AND 999 AND [namesVersion]>0);
ALTER TABLE [dbo].[Surah] ADD CONSTRAINT [Surah_revelation_ck] CHECK ([revelation] IS NULL OR [revelation] IN (N'meccan',N'medinan'));
ALTER TABLE [dbo].[Ayah] ADD CONSTRAINT [Ayah_structure_ck] CHECK ([ayahNumber] BETWEEN 1 AND 999 AND ([hizb] IS NULL OR [hizb] BETWEEN 1 AND 60) AND ([page] IS NULL OR [page] BETWEEN 1 AND 9999) AND [version]>0);
ALTER TABLE [dbo].[Ayah] ADD CONSTRAINT [Ayah_sajdah_ck] CHECK ([sajdah] IS NULL OR [sajdah] IN (N'recommended',N'obligatory'));
ALTER TABLE [dbo].[Ayah] ADD CONSTRAINT [Ayah_text_ck] CHECK (DATALENGTH([text])>0);
ALTER TABLE [dbo].[QuranAyahRevision] ADD CONSTRAINT [QuranAyahRevision_ck] CHECK ([version]>0 AND DATALENGTH([text])>0 AND ([version]=1 OR ([actorId] IS NOT NULL AND [stepUpGrantId] IS NOT NULL AND [reason] IS NOT NULL AND LEN([reason])>0)));
ALTER TABLE [dbo].[QuranVerificationRun] ADD CONSTRAINT [QuranVerificationRun_kind_ck] CHECK ([kind] IN (N'corpus-acceptance',N'ayah-correction'));
ALTER TABLE [dbo].[QuranVerificationRun] ADD CONSTRAINT [QuranVerificationRun_outcome_ck] CHECK (([outcome]=N'passed' AND [mismatches]=0 AND [firstReason] IS NULL AND [firstSurah] IS NULL AND [firstAyah] IS NULL AND [firstOffset] IS NULL) OR ([outcome]=N'failed' AND [mismatches]>0 AND [firstReason] IS NOT NULL));
ALTER TABLE [dbo].[QuranVerificationRun] ADD CONSTRAINT [QuranVerificationRun_counts_ck] CHECK ([checked]>=0 AND [mismatches]>=0 AND ([firstOffset] IS NULL OR [firstOffset]>=0));
ALTER TABLE [dbo].[QuranVerificationRun] ADD CONSTRAINT [QuranVerificationRun_reason_ck] CHECK ([firstReason] IS NULL OR [firstReason] IN (N'malformed-encoding',N'unsupported-encoding',N'unknown-reference',N'duplicate-reference',N'missing-reference',N'juz-mismatch',N'text-mismatch'));

-- Structure never changes and is never removed. Juz and Surah facts are fixed
-- once accepted; an Ayah's identity, Juz and source-supplied markers likewise.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[JuzImmutable] ON [dbo].[Juz] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51181, ''Canonical Quran structure is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[SurahImmutable] ON [dbo].[Surah] AFTER UPDATE, DELETE AS BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted) THROW 51181, ''Canonical Quran structure is immutable.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.number=i.number WHERE i.ayahCount<>d.ayahCount OR i.sourceId<>d.sourceId OR ISNULL(i.revelation,N'''')<>ISNULL(d.revelation,N'''') OR CAST(ISNULL(i.nameArabic,N'''') AS VARBINARY(200))<>CAST(ISNULL(d.nameArabic,N'''') AS VARBINARY(200)) OR i.namesVersion<>d.namesVersion+1) THROW 51181, ''Canonical Quran structure is immutable.'', 1;
 END;';
-- An Ayah changes only by a correction: text, source and version together, the
-- version by exactly one, and only once its revision for that version exists.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[AyahCanonicalChange] ON [dbo].[Ayah] AFTER UPDATE, DELETE AS BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted) THROW 51181, ''Canonical Quran structure is immutable.'', 1;
 IF UPDATE(surahNumber) OR UPDATE(ayahNumber) OR UPDATE(juzNumber) OR UPDATE(hizb) OR UPDATE(page) OR UPDATE(sajdah) THROW 51181, ''Canonical Quran structure is immutable.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.surahNumber=i.surahNumber AND d.ayahNumber=i.ayahNumber WHERE i.version<>d.version+1) THROW 51182, ''A canonical change must advance the version by one.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM [dbo].[QuranAyahRevision] r WHERE r.surahNumber=i.surahNumber AND r.ayahNumber=i.ayahNumber AND r.version=i.version AND r.sourceId=i.sourceId AND CAST(r.text AS VARBINARY(8000))=CAST(i.text AS VARBINARY(8000)))) THROW 51182, ''A canonical change must be recorded in its history.'', 1;
 END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranAyahRevisionImmutable] ON [dbo].[QuranAyahRevision] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51183, ''Canonical Quran history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranVerificationRunImmutable] ON [dbo].[QuranVerificationRun] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51183, ''Canonical Quran history is immutable.'', 1; END;';
-- While a corpus is public it is FROZEN: no structure is added beneath it, and a
-- change is a correction or nothing.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranCorpusFrozen] ON [dbo].[Ayah] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM [dbo].[QuranActivation]) THROW 51184, ''An active Quran corpus cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranSurahFrozen] ON [dbo].[Surah] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM [dbo].[QuranActivation]) THROW 51184, ''An active Quran corpus cannot be extended.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranJuzFrozen] ON [dbo].[Juz] AFTER INSERT AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM [dbo].[QuranActivation]) THROW 51184, ''An active Quran corpus cannot be extended.'', 1; END;';

-- ACTIVATION IS AN OPERATOR ACT, AND IT REFUSES AN INCOMPLETE CORPUS. The
-- canonical ayat must be exactly the activating source's ayat, every Surah's
-- count must match, and an APPROVED activation may not carry a single Ayah whose
-- text came from a fixture source.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranActivationIntegrity] ON [dbo].[QuranActivation] AFTER INSERT, UPDATE AS BEGIN
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
 END;';

-- ===========================================================================
-- LAYERED WORKS — administered under `quran.administer`
-- ===========================================================================

CREATE TABLE [dbo].[SurahName] (
    [surahNumber] INT NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [name] NVARCHAR(100) NOT NULL,
    CONSTRAINT [SurahName_pkey] PRIMARY KEY CLUSTERED ([surahNumber],[locale])
);

CREATE TABLE [dbo].[QuranTranslation] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(2000),
    [attribution] NVARCHAR(400),
    [sourceId] NVARCHAR(36),
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [QuranTranslation_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    [publishedAt] DATETIME2,
    CONSTRAINT [QuranTranslation_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [QuranTranslation_slug_key] UNIQUE NONCLUSTERED ([slug])
);

CREATE TABLE [dbo].[QuranTranslationContributor] (
    [translationId] NVARCHAR(36) NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(32) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [QuranTranslationContributor_pkey] PRIMARY KEY CLUSTERED ([translationId],[personId],[role])
);

CREATE TABLE [dbo].[QuranTranslationText] (
    [translationId] NVARCHAR(36) NOT NULL,
    [surahNumber] INT NOT NULL,
    [ayahNumber] INT NOT NULL,
    [text] NVARCHAR(MAX) NOT NULL,
    CONSTRAINT [QuranTranslationText_pkey] PRIMARY KEY CLUSTERED ([translationId],[surahNumber],[ayahNumber])
);

CREATE TABLE [dbo].[QuranTransliteration] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(2000),
    [scheme] NVARCHAR(2000),
    [attribution] NVARCHAR(400),
    [sourceId] NVARCHAR(36),
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [QuranTransliteration_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    [publishedAt] DATETIME2,
    CONSTRAINT [QuranTransliteration_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [QuranTransliteration_slug_key] UNIQUE NONCLUSTERED ([slug])
);

CREATE TABLE [dbo].[QuranTransliterationText] (
    [transliterationId] NVARCHAR(36) NOT NULL,
    [surahNumber] INT NOT NULL,
    [ayahNumber] INT NOT NULL,
    [text] NVARCHAR(MAX) NOT NULL,
    CONSTRAINT [QuranTransliterationText_pkey] PRIMARY KEY CLUSTERED ([transliterationId],[surahNumber],[ayahNumber])
);

CREATE TABLE [dbo].[QuranTafsir] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(2000),
    [attribution] NVARCHAR(400),
    [sourceId] NVARCHAR(36),
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [QuranTafsir_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    [publishedAt] DATETIME2,
    CONSTRAINT [QuranTafsir_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [QuranTafsir_slug_key] UNIQUE NONCLUSTERED ([slug])
);

CREATE TABLE [dbo].[QuranTafsirContributor] (
    [tafsirId] NVARCHAR(36) NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(32) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [QuranTafsirContributor_pkey] PRIMARY KEY CLUSTERED ([tafsirId],[personId],[role])
);

-- One entry covers ONE Surah's contiguous range. The Surah is a single column
-- shared by both ends' foreign keys, so a cross-Surah range is unrepresentable.
CREATE TABLE [dbo].[QuranTafsirText] (
    [id] NVARCHAR(36) NOT NULL,
    [tafsirId] NVARCHAR(36) NOT NULL,
    [surahNumber] INT NOT NULL,
    [startAyah] INT NOT NULL,
    [endAyah] INT NOT NULL,
    [text] NVARCHAR(MAX) NOT NULL,
    CONSTRAINT [QuranTafsirText_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [QuranTafsirText_start_key] UNIQUE NONCLUSTERED ([tafsirId],[surahNumber],[startAyah])
);

CREATE TABLE [dbo].[QuranRecitation] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [style] NVARCHAR(100),
    [attribution] NVARCHAR(400),
    [sourceId] NVARCHAR(36),
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [QuranRecitation_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    [publishedAt] DATETIME2,
    CONSTRAINT [QuranRecitation_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [QuranRecitation_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- One segment is one audio file over one Surah's contiguous range. The file is
-- Storage's and its meaning is Quran's: a never-cascading key to the Asset, and
-- one Asset serves at most one segment.
CREATE TABLE [dbo].[QuranRecitationSegment] (
    [id] NVARCHAR(36) NOT NULL,
    [recitationId] NVARCHAR(36) NOT NULL,
    [surahNumber] INT NOT NULL,
    [startAyah] INT NOT NULL,
    [endAyah] INT NOT NULL,
    [assetId] NVARCHAR(36),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [QuranRecitationSegment_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [QuranRecitationSegment_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [QuranRecitationSegment_start_key] UNIQUE NONCLUSTERED ([recitationId],[surahNumber],[startAyah])
);

CREATE TABLE [dbo].[QuranTajweedRule] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [position] INT NOT NULL,
    [attribution] NVARCHAR(400),
    [sourceId] NVARCHAR(36),
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [QuranTajweedRule_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    [publishedAt] DATETIME2,
    CONSTRAINT [QuranTajweedRule_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [QuranTajweedRule_slug_key] UNIQUE NONCLUSTERED ([slug])
);

CREATE TABLE [dbo].[QuranTajweedRuleText] (
    [ruleId] NVARCHAR(36) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [body] NVARCHAR(MAX) NOT NULL,
    CONSTRAINT [QuranTajweedRuleText_pkey] PRIMARY KEY CLUSTERED ([ruleId],[languageCode])
);

-- TYPED TOPIC ASSIGNMENT (DOMAIN_MODEL.md 6.2): a real foreign key to the Ayah
-- by its canonical citation and a real foreign key to the Topic. No
-- `targetType + targetId`.
CREATE TABLE [dbo].[QuranTopic] (
    [surahNumber] INT NOT NULL,
    [ayahNumber] INT NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [QuranTopic_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [QuranTopic_pkey] PRIMARY KEY CLUSTERED ([surahNumber],[ayahNumber],[topicId])
);

CREATE NONCLUSTERED INDEX [QuranTranslation_state_slug_idx] ON [dbo].[QuranTranslation]([state],[slug]);
CREATE NONCLUSTERED INDEX [QuranTranslationText_ayah_idx] ON [dbo].[QuranTranslationText]([surahNumber],[ayahNumber]);
CREATE NONCLUSTERED INDEX [QuranTranslationContributor_personId_idx] ON [dbo].[QuranTranslationContributor]([personId]);
CREATE NONCLUSTERED INDEX [QuranTransliteration_state_slug_idx] ON [dbo].[QuranTransliteration]([state],[slug]);
CREATE NONCLUSTERED INDEX [QuranTransliterationText_ayah_idx] ON [dbo].[QuranTransliterationText]([surahNumber],[ayahNumber]);
CREATE NONCLUSTERED INDEX [QuranTafsir_state_slug_idx] ON [dbo].[QuranTafsir]([state],[slug]);
CREATE NONCLUSTERED INDEX [QuranTafsirContributor_personId_idx] ON [dbo].[QuranTafsirContributor]([personId]);
CREATE NONCLUSTERED INDEX [QuranTafsirText_ayah_idx] ON [dbo].[QuranTafsirText]([surahNumber],[startAyah],[endAyah]);
CREATE NONCLUSTERED INDEX [QuranRecitation_state_slug_idx] ON [dbo].[QuranRecitation]([state],[slug]);
CREATE NONCLUSTERED INDEX [QuranRecitation_personId_idx] ON [dbo].[QuranRecitation]([personId],[state]);
CREATE NONCLUSTERED INDEX [QuranTajweedRule_state_position_idx] ON [dbo].[QuranTajweedRule]([state],[position],[slug]);
CREATE NONCLUSTERED INDEX [QuranTopic_topicId_idx] ON [dbo].[QuranTopic]([topicId],[surahNumber],[ayahNumber]);
-- UNIQUE treats two NULLs as equal, so the one-Asset-one-segment rule is FILTERED.
CREATE UNIQUE NONCLUSTERED INDEX [QuranRecitationSegment_assetId_key] ON [dbo].[QuranRecitationSegment]([assetId]) WHERE [assetId] IS NOT NULL;

ALTER TABLE [dbo].[SurahName] ADD CONSTRAINT [SurahName_surahNumber_fkey] FOREIGN KEY ([surahNumber]) REFERENCES [dbo].[Surah]([number]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTranslation] ADD CONSTRAINT [QuranTranslation_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTranslation] ADD CONSTRAINT [QuranTranslation_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[QuranSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTranslationContributor] ADD CONSTRAINT [QuranTranslationContributor_translationId_fkey] FOREIGN KEY ([translationId]) REFERENCES [dbo].[QuranTranslation]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTranslationContributor] ADD CONSTRAINT [QuranTranslationContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTranslationText] ADD CONSTRAINT [QuranTranslationText_translationId_fkey] FOREIGN KEY ([translationId]) REFERENCES [dbo].[QuranTranslation]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTranslationText] ADD CONSTRAINT [QuranTranslationText_ayah_fkey] FOREIGN KEY ([surahNumber],[ayahNumber]) REFERENCES [dbo].[Ayah]([surahNumber],[ayahNumber]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTransliteration] ADD CONSTRAINT [QuranTransliteration_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTransliteration] ADD CONSTRAINT [QuranTransliteration_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[QuranSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTransliterationText] ADD CONSTRAINT [QuranTransliterationText_transliterationId_fkey] FOREIGN KEY ([transliterationId]) REFERENCES [dbo].[QuranTransliteration]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTransliterationText] ADD CONSTRAINT [QuranTransliterationText_ayah_fkey] FOREIGN KEY ([surahNumber],[ayahNumber]) REFERENCES [dbo].[Ayah]([surahNumber],[ayahNumber]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTafsir] ADD CONSTRAINT [QuranTafsir_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTafsir] ADD CONSTRAINT [QuranTafsir_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[QuranSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTafsirContributor] ADD CONSTRAINT [QuranTafsirContributor_tafsirId_fkey] FOREIGN KEY ([tafsirId]) REFERENCES [dbo].[QuranTafsir]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTafsirContributor] ADD CONSTRAINT [QuranTafsirContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTafsirText] ADD CONSTRAINT [QuranTafsirText_tafsirId_fkey] FOREIGN KEY ([tafsirId]) REFERENCES [dbo].[QuranTafsir]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTafsirText] ADD CONSTRAINT [QuranTafsirText_start_fkey] FOREIGN KEY ([surahNumber],[startAyah]) REFERENCES [dbo].[Ayah]([surahNumber],[ayahNumber]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTafsirText] ADD CONSTRAINT [QuranTafsirText_end_fkey] FOREIGN KEY ([surahNumber],[endAyah]) REFERENCES [dbo].[Ayah]([surahNumber],[ayahNumber]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranRecitation] ADD CONSTRAINT [QuranRecitation_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranRecitation] ADD CONSTRAINT [QuranRecitation_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[QuranSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranRecitationSegment] ADD CONSTRAINT [QuranRecitationSegment_recitationId_fkey] FOREIGN KEY ([recitationId]) REFERENCES [dbo].[QuranRecitation]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranRecitationSegment] ADD CONSTRAINT [QuranRecitationSegment_start_fkey] FOREIGN KEY ([surahNumber],[startAyah]) REFERENCES [dbo].[Ayah]([surahNumber],[ayahNumber]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranRecitationSegment] ADD CONSTRAINT [QuranRecitationSegment_end_fkey] FOREIGN KEY ([surahNumber],[endAyah]) REFERENCES [dbo].[Ayah]([surahNumber],[ayahNumber]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranRecitationSegment] ADD CONSTRAINT [QuranRecitationSegment_assetId_fkey] FOREIGN KEY ([assetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTajweedRule] ADD CONSTRAINT [QuranTajweedRule_sourceId_fkey] FOREIGN KEY ([sourceId]) REFERENCES [dbo].[QuranSource]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTajweedRuleText] ADD CONSTRAINT [QuranTajweedRuleText_ruleId_fkey] FOREIGN KEY ([ruleId]) REFERENCES [dbo].[QuranTajweedRule]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTajweedRuleText] ADD CONSTRAINT [QuranTajweedRuleText_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTopic] ADD CONSTRAINT [QuranTopic_ayah_fkey] FOREIGN KEY ([surahNumber],[ayahNumber]) REFERENCES [dbo].[Ayah]([surahNumber],[ayahNumber]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[QuranTopic] ADD CONSTRAINT [QuranTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- A public address is lowercase ASCII words joined by single hyphens, as the
-- service validates; the database refuses any other spelling too.
ALTER TABLE [dbo].[QuranTranslation] ADD CONSTRAINT [QuranTranslation_slug_ck] CHECK (LEN([slug])>=2 AND [slug] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^a-z0-9-]%' AND [slug] NOT LIKE N'-%' AND [slug] NOT LIKE N'%-' AND [slug] NOT LIKE N'%--%');
ALTER TABLE [dbo].[QuranTransliteration] ADD CONSTRAINT [QuranTransliteration_slug_ck] CHECK (LEN([slug])>=2 AND [slug] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^a-z0-9-]%' AND [slug] NOT LIKE N'-%' AND [slug] NOT LIKE N'%-' AND [slug] NOT LIKE N'%--%');
ALTER TABLE [dbo].[QuranTafsir] ADD CONSTRAINT [QuranTafsir_slug_ck] CHECK (LEN([slug])>=2 AND [slug] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^a-z0-9-]%' AND [slug] NOT LIKE N'-%' AND [slug] NOT LIKE N'%-' AND [slug] NOT LIKE N'%--%');
ALTER TABLE [dbo].[QuranRecitation] ADD CONSTRAINT [QuranRecitation_slug_ck] CHECK (LEN([slug])>=2 AND [slug] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^a-z0-9-]%' AND [slug] NOT LIKE N'-%' AND [slug] NOT LIKE N'%-' AND [slug] NOT LIKE N'%--%');
ALTER TABLE [dbo].[QuranTajweedRule] ADD CONSTRAINT [QuranTajweedRule_slug_ck] CHECK (LEN([slug])>=2 AND [slug] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^a-z0-9-]%' AND [slug] NOT LIKE N'-%' AND [slug] NOT LIKE N'%-' AND [slug] NOT LIKE N'%--%');
ALTER TABLE [dbo].[SurahName] ADD CONSTRAINT [SurahName_ck] CHECK ([locale] IN (N'en',N'ur',N'ar') AND LEN([name])>0);
-- A layered work is draft, published or archived; a PUBLISHED one names a
-- registered source and when it was published. The source is what an operator
-- registered — so publication alone can never be an approval.
ALTER TABLE [dbo].[QuranTranslation] ADD CONSTRAINT [QuranTranslation_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived') AND [version]>0 AND ([state]<>N'published' OR ([sourceId] IS NOT NULL AND [publishedAt] IS NOT NULL)));
ALTER TABLE [dbo].[QuranTransliteration] ADD CONSTRAINT [QuranTransliteration_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived') AND [version]>0 AND ([state]<>N'published' OR ([sourceId] IS NOT NULL AND [publishedAt] IS NOT NULL)));
ALTER TABLE [dbo].[QuranTafsir] ADD CONSTRAINT [QuranTafsir_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived') AND [version]>0 AND ([state]<>N'published' OR ([sourceId] IS NOT NULL AND [publishedAt] IS NOT NULL)));
ALTER TABLE [dbo].[QuranRecitation] ADD CONSTRAINT [QuranRecitation_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived') AND [version]>0 AND ([state]<>N'published' OR ([sourceId] IS NOT NULL AND [publishedAt] IS NOT NULL)));
ALTER TABLE [dbo].[QuranTajweedRule] ADD CONSTRAINT [QuranTajweedRule_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived') AND [version]>0 AND [position] BETWEEN 0 AND 200 AND ([state]<>N'published' OR ([sourceId] IS NOT NULL AND [publishedAt] IS NOT NULL)));
ALTER TABLE [dbo].[QuranTranslationContributor] ADD CONSTRAINT [QuranTranslationContributor_ck] CHECK ([role] IN (N'translator',N'editor') AND [position] BETWEEN 0 AND 11);
ALTER TABLE [dbo].[QuranTafsirContributor] ADD CONSTRAINT [QuranTafsirContributor_ck] CHECK ([role] IN (N'author',N'translator',N'editor',N'compiler') AND [position] BETWEEN 0 AND 11);
ALTER TABLE [dbo].[QuranTranslationText] ADD CONSTRAINT [QuranTranslationText_ck] CHECK (DATALENGTH([text]) BETWEEN 1 AND 24000);
ALTER TABLE [dbo].[QuranTransliterationText] ADD CONSTRAINT [QuranTransliterationText_ck] CHECK (DATALENGTH([text]) BETWEEN 1 AND 24000);
ALTER TABLE [dbo].[QuranTafsirText] ADD CONSTRAINT [QuranTafsirText_ck] CHECK ([startAyah]<=[endAyah] AND DATALENGTH([text]) BETWEEN 1 AND 120000);
ALTER TABLE [dbo].[QuranRecitationSegment] ADD CONSTRAINT [QuranRecitationSegment_ck] CHECK ([startAyah]<=[endAyah]);
ALTER TABLE [dbo].[QuranTajweedRuleText] ADD CONSTRAINT [QuranTajweedRuleText_ck] CHECK (LEN([title])>0 AND DATALENGTH([body]) BETWEEN 1 AND 40000);

-- No two entries of one Tafsir, and no two segments of one Recitation, cover the
-- same Ayah: an overlap would make "which commentary is this Ayah's" or "which
-- file plays it" ambiguous.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranTafsirTextNoOverlap] ON [dbo].[QuranTafsirText] AFTER INSERT, UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[QuranTafsirText] t ON t.tafsirId=i.tafsirId AND t.surahNumber=i.surahNumber AND t.id<>i.id AND t.startAyah<=i.endAyah AND i.startAyah<=t.endAyah) THROW 51186, ''Tafsir entries of one work may not overlap.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranRecitationSegmentNoOverlap] ON [dbo].[QuranRecitationSegment] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF UPDATE(recitationId) OR UPDATE(surahNumber) OR UPDATE(startAyah) OR UPDATE(endAyah) BEGIN IF EXISTS (SELECT 1 FROM deleted) THROW 51187, ''A segment range is fixed once created.'', 1; END;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[QuranRecitationSegment] t ON t.recitationId=i.recitationId AND t.surahNumber=i.surahNumber AND t.id<>i.id AND t.startAyah<=i.endAyah AND i.startAyah<=t.endAyah) THROW 51187, ''Segments of one recitation may not overlap.'', 1;
 END;';
-- A published Recitation has at least one segment with audio, so a public
-- recitation page is never an empty shell.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranRecitationPublishedAudio] ON [dbo].[QuranRecitation] AFTER INSERT, UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i WHERE i.state=N''published'' AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranRecitationSegment] s WHERE s.recitationId=i.id AND s.assetId IS NOT NULL)) THROW 51188, ''A published recitation needs audio.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranRecitationSegmentKeepsAudio] ON [dbo].[QuranRecitationSegment] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM [dbo].[QuranRecitation] r WHERE r.state=N''published'' AND r.id IN (SELECT recitationId FROM deleted) AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranRecitationSegment] s WHERE s.recitationId=r.id AND s.assetId IS NOT NULL)) THROW 51188, ''A published recitation needs audio.'', 1; END;';
-- A published work has text to show.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranTranslationPublishedText] ON [dbo].[QuranTranslation] AFTER INSERT, UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i WHERE i.state=N''published'' AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranTranslationText] t WHERE t.translationId=i.id)) THROW 51189, ''A published work needs text.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranTransliterationPublishedText] ON [dbo].[QuranTransliteration] AFTER INSERT, UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i WHERE i.state=N''published'' AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranTransliterationText] t WHERE t.transliterationId=i.id)) THROW 51189, ''A published work needs text.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranTafsirPublishedText] ON [dbo].[QuranTafsir] AFTER INSERT, UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i WHERE i.state=N''published'' AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranTafsirText] t WHERE t.tafsirId=i.id)) THROW 51189, ''A published work needs text.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranTajweedPublishedText] ON [dbo].[QuranTajweedRule] AFTER INSERT, UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i WHERE i.state=N''published'' AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranTajweedRuleText] t WHERE t.ruleId=i.id)) THROW 51189, ''A published work needs text.'', 1; END;';

-- ...and keeps it: removing the last text of a published work is refused too,
-- whether by DELETE or by an UPDATE that moves the row to another work.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranTranslationTextKept] ON [dbo].[QuranTranslationText] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM [dbo].[QuranTranslation] w WHERE w.state=N''published'' AND w.id IN (SELECT translationId FROM deleted) AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranTranslationText] t WHERE t.translationId=w.id)) THROW 51189, ''A published work needs text.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranTransliterationTextKept] ON [dbo].[QuranTransliterationText] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM [dbo].[QuranTransliteration] w WHERE w.state=N''published'' AND w.id IN (SELECT transliterationId FROM deleted) AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranTransliterationText] t WHERE t.transliterationId=w.id)) THROW 51189, ''A published work needs text.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranTafsirTextKept] ON [dbo].[QuranTafsirText] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM [dbo].[QuranTafsir] w WHERE w.state=N''published'' AND w.id IN (SELECT tafsirId FROM deleted) AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranTafsirText] t WHERE t.tafsirId=w.id)) THROW 51189, ''A published work needs text.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[QuranTajweedTextKept] ON [dbo].[QuranTajweedRuleText] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM [dbo].[QuranTajweedRule] w WHERE w.state=N''published'' AND w.id IN (SELECT ruleId FROM deleted) AND NOT EXISTS (SELECT 1 FROM [dbo].[QuranTajweedRuleText] t WHERE t.ruleId=w.id)) THROW 51189, ''A published work needs text.'', 1; END;';

-- ===========================================================================
-- THE CANONICAL WRITE PATH — three procedures, and no other
-- ===========================================================================
--
-- DEFENCE IN DEPTH, NOT A SUBSTITUTE. The Quran service already requires a
-- `PrivilegedActor` that Identity minted for `quran.editCanonical` with the
-- `quran-canonical-edit` purpose and re-verifies it live. The procedures check
-- the same facts again from the authoritative rows — a current assignment of an
-- active role carrying the permission, held by an active account, and an
-- unexpired grant for THIS purpose bound to a live session of THIS account — so
-- a caller holding nothing but the runtime principal cannot reach canonical
-- text by naming an account.
--
-- EXACT COMPARISON. Text is compared as its UTF-16 bytes (`VARBINARY`), never
-- through a collation: no case, accent, kana, width or normalisation
-- equivalence, and no trailing-space padding, can make two different texts
-- compare equal.

EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[QuranAssertCanonicalAuthority]
  @actorId NVARCHAR(36),
  @sessionId NVARCHAR(36),
  @stepUpGrantId NVARCHAR(36)
AS
BEGIN
  SET NOCOUNT ON;
  IF NOT EXISTS (
    SELECT 1
    FROM [dbo].[RoleAssignment] ra
    JOIN [dbo].[Role] r ON r.id = ra.roleId AND r.deactivatedAt IS NULL
    JOIN [dbo].[RolePermission] rp ON rp.roleId = r.id AND rp.permissionKey = N''quran.editCanonical''
    JOIN [dbo].[User] u ON u.id = ra.userId AND u.status = N''active''
    WHERE ra.userId = @actorId AND ra.revokedAt IS NULL
  )
  OR NOT EXISTS (
    SELECT 1
    FROM [dbo].[StepUpGrant] g
    JOIN [dbo].[Session] s ON s.id = g.sessionId AND s.userId = g.userId AND s.expiresAt > SYSUTCDATETIME()
    WHERE g.id = @stepUpGrantId AND g.userId = @actorId AND g.sessionId = @sessionId
      AND g.purpose = N''quran-canonical-edit'' AND g.expiresAt > SYSUTCDATETIME()
  )
    THROW 51190, ''Canonical Quran authority is not held now.'', 1;
END;
';

EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[QuranAcceptCorpus]
  @runId NVARCHAR(36),
  @sourceId NVARCHAR(36),
  @candidate NVARCHAR(MAX),
  @actorId NVARCHAR(36),
  @sessionId NVARCHAR(36),
  @stepUpGrantId NVARCHAR(36),
  @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  BEGIN TRAN;

  EXEC [dbo].[QuranAssertCanonicalAuthority] @actorId, @sessionId, @stepUpGrantId;

  -- ONE corpus. Acceptance materialises an empty canonical store; it never
  -- replaces or merges into an existing one.
  IF EXISTS (SELECT 1 FROM [dbo].[Ayah] WITH (UPDLOCK, HOLDLOCK)) OR EXISTS (SELECT 1 FROM [dbo].[Surah]) OR EXISTS (SELECT 1 FROM [dbo].[Juz])
    THROW 51191, ''A canonical Quran corpus already exists.'', 1;
  IF NOT EXISTS (SELECT 1 FROM [dbo].[QuranSource] WHERE id = @sourceId)
    THROW 51192, ''The Quran source is not registered.'', 1;
  IF ISJSON(@candidate) <> 1
    THROW 51193, ''The candidate does not match the source.'', 1;

  DECLARE @c TABLE ([surah] INT NOT NULL, [ayah] INT NOT NULL, [juz] INT NOT NULL, [text] NVARCHAR(4000) NOT NULL);
  INSERT INTO @c ([surah],[ayah],[juz],[text])
  SELECT [surah],[ayah],[juz],[text]
  FROM OPENJSON(@candidate) WITH ([surah] INT ''$.surah'', [ayah] INT ''$.ayah'', [juz] INT ''$.juz'', [text] NVARCHAR(4000) ''$.text'')
  WHERE [surah] IS NOT NULL AND [ayah] IS NOT NULL AND [juz] IS NOT NULL AND [text] IS NOT NULL;

  -- Exactly the source''s ayat, once each, in the source''s Juz, with the
  -- source''s exact text — or nothing at all.
  IF (SELECT COUNT(*) FROM OPENJSON(@candidate)) <> (SELECT COUNT(*) FROM @c)
     OR EXISTS (SELECT [surah],[ayah] FROM @c GROUP BY [surah],[ayah] HAVING COUNT(*) > 1)
     OR (SELECT COUNT(*) FROM @c) <> (SELECT COUNT(*) FROM [dbo].[QuranSourceAyah] WHERE sourceId = @sourceId)
     OR EXISTS (
       SELECT 1 FROM @c c
       WHERE NOT EXISTS (
         SELECT 1 FROM [dbo].[QuranSourceAyah] s
         WHERE s.sourceId = @sourceId AND s.surahNumber = c.[surah] AND s.ayahNumber = c.[ayah]
           AND s.juzNumber = c.[juz]
           AND CAST(s.[text] AS VARBINARY(8000)) = CAST(c.[text] AS VARBINARY(8000))
       )
     )
    THROW 51193, ''The candidate does not match the source.'', 1;

  -- The source itself must be a complete, contiguous structure: every Surah it
  -- names has ayat 1..ayahCount, and Juz never decrease in canonical order.
  IF EXISTS (
       SELECT 1 FROM [dbo].[QuranSourceSurah] h
       WHERE h.sourceId = @sourceId
         AND h.ayahCount <> (SELECT COUNT(*) FROM [dbo].[QuranSourceAyah] a WHERE a.sourceId = h.sourceId AND a.surahNumber = h.number)
     )
     OR EXISTS (
       SELECT 1 FROM (
         SELECT juzNumber, LAG(juzNumber) OVER (ORDER BY surahNumber, ayahNumber) AS previousJuz
         FROM [dbo].[QuranSourceAyah] WHERE sourceId = @sourceId
       ) ordered
       WHERE ordered.previousJuz IS NOT NULL AND ordered.juzNumber < ordered.previousJuz
     )
    THROW 51194, ''The Quran source is not a complete structure.'', 1;

  INSERT INTO [dbo].[QuranVerificationRun] ([id],[kind],[outcome],[sourceId],[checked],[mismatches],[actorId],[createdAt])
  VALUES (@runId, N''corpus-acceptance'', N''passed'', @sourceId, (SELECT COUNT(*) FROM @c), 0, @actorId, @at);

  INSERT INTO [dbo].[Juz] ([number],[sourceId],[createdAt])
  SELECT DISTINCT juzNumber, @sourceId, @at FROM [dbo].[QuranSourceAyah] WHERE sourceId = @sourceId;

  INSERT INTO [dbo].[Surah] ([number],[ayahCount],[revelation],[nameArabic],[sourceId],[createdAt],[updatedAt])
  SELECT number, ayahCount, revelation, nameArabic, @sourceId, @at, @at
  FROM [dbo].[QuranSourceSurah] WHERE sourceId = @sourceId;

  -- COPIED FROM THE SOURCE, never from the candidate: what becomes canonical is
  -- the registered text itself, which the candidate has just been proved equal to.
  INSERT INTO [dbo].[Ayah] ([surahNumber],[ayahNumber],[juzNumber],[hizb],[page],[sajdah],[text],[sourceId],[version],[createdAt],[updatedAt])
  SELECT surahNumber, ayahNumber, juzNumber, hizb, page, sajdah, [text], @sourceId, 1, @at, @at
  FROM [dbo].[QuranSourceAyah] WHERE sourceId = @sourceId;

  INSERT INTO [dbo].[QuranAyahRevision] ([surahNumber],[ayahNumber],[version],[text],[sourceId],[verificationRunId],[actorId],[stepUpGrantId],[reason],[createdAt])
  SELECT surahNumber, ayahNumber, 1, [text], @sourceId, @runId, @actorId, @stepUpGrantId, NULL, @at
  FROM [dbo].[QuranSourceAyah] WHERE sourceId = @sourceId;

  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[afterState],[authorisingSource])
  VALUES (NEWID(), N''user'', @actorId, N''quran.corpus.accepted'', N''quran-source'', @sourceId,
          N''{"ayat":"'' + CONVERT(NVARCHAR(16), (SELECT COUNT(*) FROM @c)) + N''","run":"'' + @runId + N''"}'',
          N''step-up:'' + @stepUpGrantId);

  COMMIT TRAN;
END;
';

EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[QuranCorrectAyah]
  @runId NVARCHAR(36),
  @surah INT,
  @ayah INT,
  @expectedVersion INT,
  @sourceId NVARCHAR(36),
  @reviewedText NVARCHAR(4000),
  @reason NVARCHAR(500),
  @actorId NVARCHAR(36),
  @sessionId NVARCHAR(36),
  @stepUpGrantId NVARCHAR(36),
  @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  BEGIN TRAN;

  EXEC [dbo].[QuranAssertCanonicalAuthority] @actorId, @sessionId, @stepUpGrantId;

  DECLARE @version INT, @currentSource NVARCHAR(36), @currentText NVARCHAR(4000), @juz INT;
  SELECT @version = version, @currentSource = sourceId, @currentText = [text], @juz = juzNumber
  FROM [dbo].[Ayah] WITH (UPDLOCK, HOLDLOCK)
  WHERE surahNumber = @surah AND ayahNumber = @ayah;

  IF @version IS NULL THROW 51195, ''The Ayah does not exist.'', 1;
  -- NO LAST WRITE WINS. A correction prepared against another version is refused.
  IF @version <> @expectedVersion THROW 51196, ''The Ayah changed since it was reviewed.'', 1;

  DECLARE @sourceText NVARCHAR(4000), @sourceJuz INT, @newAuthority NVARCHAR(16);
  SELECT @sourceText = a.[text], @sourceJuz = a.juzNumber, @newAuthority = q.authority
  FROM [dbo].[QuranSourceAyah] a JOIN [dbo].[QuranSource] q ON q.id = a.sourceId
  WHERE a.sourceId = @sourceId AND a.surahNumber = @surah AND a.ayahNumber = @ayah;

  IF @sourceText IS NULL OR @sourceJuz <> @juz THROW 51197, ''The source does not carry this Ayah.'', 1;

  -- A fixture never displaces approved text, and an approved public corpus
  -- accepts approved text only.
  IF @newAuthority <> N''approved'' AND (
       EXISTS (SELECT 1 FROM [dbo].[QuranSource] WHERE id = @currentSource AND authority = N''approved'')
       OR EXISTS (SELECT 1 FROM [dbo].[QuranActivation] v JOIN [dbo].[QuranSource] q ON q.id = v.sourceId WHERE q.authority = N''approved'')
     )
    THROW 51198, ''A fixture source cannot change approved canonical text.'', 1;

  -- The operator''s reviewed text must BE the source''s text, exactly.
  IF @reviewedText IS NULL OR CAST(@reviewedText AS VARBINARY(8000)) <> CAST(@sourceText AS VARBINARY(8000))
    THROW 51193, ''The candidate does not match the source.'', 1;

  IF @currentSource = @sourceId AND CAST(@currentText AS VARBINARY(8000)) = CAST(@sourceText AS VARBINARY(8000))
    THROW 51199, ''The correction changes nothing.'', 1;

  IF @reason IS NULL OR LEN(@reason) = 0 THROW 51199, ''A correction states its reason.'', 1;

  INSERT INTO [dbo].[QuranVerificationRun] ([id],[kind],[outcome],[sourceId],[checked],[mismatches],[actorId],[createdAt])
  VALUES (@runId, N''ayah-correction'', N''passed'', @sourceId, 1, 0, @actorId, @at);

  INSERT INTO [dbo].[QuranAyahRevision] ([surahNumber],[ayahNumber],[version],[text],[sourceId],[verificationRunId],[actorId],[stepUpGrantId],[reason],[createdAt])
  VALUES (@surah, @ayah, @version + 1, @sourceText, @sourceId, @runId, @actorId, @stepUpGrantId, @reason, @at);

  UPDATE [dbo].[Ayah]
  SET [text] = @sourceText, sourceId = @sourceId, version = @version + 1, updatedAt = @at
  WHERE surahNumber = @surah AND ayahNumber = @ayah;

  -- WHICH Ayah, WHICH versions, WHICH source and run — never the text, which is
  -- held as the domain''s own revision record (SECURITY_BASELINE.md 13.4).
  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[beforeState],[afterState],[authorisingSource])
  VALUES (NEWID(), N''user'', @actorId, N''quran.ayah.corrected'', N''quran-ayah'',
          CONVERT(NVARCHAR(8), @surah) + N'':'' + CONVERT(NVARCHAR(8), @ayah),
          N''{"version":"'' + CONVERT(NVARCHAR(16), @version) + N''","source":"'' + @currentSource + N''"}'',
          N''{"version":"'' + CONVERT(NVARCHAR(16), @version + 1) + N''","source":"'' + @sourceId + N''","run":"'' + @runId + N''"}'',
          N''step-up:'' + @stepUpGrantId);

  COMMIT TRAN;
END;
';

EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[QuranRecordVerificationFailure]
  @runId NVARCHAR(36),
  @kind NVARCHAR(24),
  @sourceId NVARCHAR(36),
  @checked INT,
  @mismatches INT,
  @firstSurah INT,
  @firstAyah INT,
  @firstOffset INT,
  @firstReason NVARCHAR(32),
  @actorId NVARCHAR(36),
  @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  -- ONLY A FAILURE is recordable here. A passed run is written exclusively by the
  -- procedure that performed the write it authorises.
  INSERT INTO [dbo].[QuranVerificationRun] ([id],[kind],[outcome],[sourceId],[checked],[mismatches],[firstSurah],[firstAyah],[firstOffset],[firstReason],[actorId],[createdAt])
  VALUES (@runId, @kind, N''failed'', @sourceId, @checked, @mismatches, @firstSurah, @firstAyah, @firstOffset, @firstReason, @actorId, @at);
END;
';

-- ===========================================================================
-- SEARCH — the `quran-ayah` kind, its own scope
-- ===========================================================================
ALTER TABLE [dbo].[SearchIndexRequest] DROP CONSTRAINT [SearchIndexRequest_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexRequest] ADD CONSTRAINT [SearchIndexRequest_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah'));
ALTER TABLE [dbo].[SearchIndexScope] DROP CONSTRAINT [SearchIndexScope_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah'));
ALTER TABLE [dbo].[SearchDocument] DROP CONSTRAINT [SearchDocument_kind_ck];
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_kind_ck] CHECK ([kind] IN (N'topic',N'person',N'article',N'page',N'work',N'edition',N'book-translation',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah'));
-- `SearchDocument_scope_ck` needs no change: a `quran-ayah` document is
-- projected only within its own scope, which that constraint already requires
-- of every kind other than an Edition or a translation.

-- ===========================================================================
-- PERMISSIONS
-- ===========================================================================

INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'quran.read', N'View Quran administration: canonical text and history, verification evidence, sources and draft layered works.'),
    (N'quran.administer', N'Manage Quran translations, transliterations, tafsir, recitations and audio, tajweed guidance, Surah display names and Ayah topics. Never canonical text.'),
    (N'quran.editCanonical', N'Accept a verified canonical Quran corpus and correct canonical Ayah text against a registered source, with step-up.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

-- ===========================================================================
-- EXTENDING THE PROTECTED PLATFORM ADMINISTRATOR BUNDLE
-- ===========================================================================
--
-- The protected bundle is the WHOLE catalogue, so appending permissions widens
-- what a live administrator may do. The holders' sessions and step-up grants
-- are revoked in the SAME transaction that changes the bundle
-- (SECURITY_BASELINE.md 8.1), by the mechanism every earlier phase used. On a
-- fresh database every count below is zero and nothing is revoked.

DECLARE @quranAdminRoleId NVARCHAR(36);
DECLARE @quranAddedKeys NVARCHAR(200);

SELECT @quranAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @quranAdminRoleId IS NOT NULL
BEGIN
    SELECT @quranAddedKeys = STRING_AGG(p.[key], N' ') WITHIN GROUP (ORDER BY p.[key])
    FROM [dbo].[Permission] p
    WHERE p.[key] IN (N'quran.read', N'quran.administer', N'quran.editCanonical')
      AND NOT EXISTS (
          SELECT 1 FROM [dbo].[RolePermission] rp
          WHERE rp.[roleId] = @quranAdminRoleId AND rp.[permissionKey] = p.[key]
      );

    IF @quranAddedKeys IS NOT NULL AND LEN(@quranAddedKeys) > 0
    BEGIN
        INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
        SELECT @quranAdminRoleId, p.[key]
        FROM [dbo].[Permission] p
        WHERE p.[key] IN (N'quran.read', N'quran.administer', N'quran.editCanonical')
          AND NOT EXISTS (
              SELECT 1 FROM [dbo].[RolePermission] rp
              WHERE rp.[roleId] = @quranAdminRoleId AND rp.[permissionKey] = p.[key]
          );

        -- Grants before sessions, so the count each statement reports is the
        -- one it actually removed rather than whatever a cascade took first.
        DELETE FROM [dbo].[StepUpGrant]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @quranAdminRoleId AND ra.[revokedAt] IS NULL
        );

        DELETE FROM [dbo].[Session]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @quranAdminRoleId AND ra.[revokedAt] IS NULL
        );

        -- WHICH KEYS WERE ADDED, and nothing else (SECURITY_BASELINE.md 13.4).
        INSERT INTO [dbo].[AuditLog]
            ([id], [actorType], [actorId], [action], [targetType], [targetId],
             [afterState], [authorisingSource])
        VALUES
            (NEWID(), N'migration', NULL, N'quran.permissions.provisioned', N'role',
             @quranAdminRoleId,
             N'{"added":"' + @quranAddedKeys + N'"}',
             N'20261002000000_phase18_quran');
    END;
END;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
