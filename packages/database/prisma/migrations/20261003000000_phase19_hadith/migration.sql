-- ===========================================================================
-- Phase 19 — Hadith
-- ===========================================================================
--
-- THE HADITH CONTEXT (DOMAIN_MODEL.md 9): the Collection -> Book -> Chapter ->
-- Hadith hierarchy, source-qualified records with their sourced chain and
-- gradings, human verification, the public citation mapping, conflict
-- evidence, the layered translations, commentary and sciences study material,
-- and typed topic assignment. Nothing below names Quran, Editorial, Library,
-- Media or any other content context, and no table of theirs is touched except
-- Search's derived vocabulary.
--
-- NO HADITH CONTENT IS SEEDED. Not a collection, not an edition, not a number,
-- not a grading. The authoritative collections, editions, numbering policy,
-- grading authority and rights are open external decisions (OPEN_DECISIONS.md
-- 1.3, 1.5, 1.6, 2.4); a database migrated by this file holds NO corpus and
-- every public Hadith surface says so.
--
-- IDENTITY. A Hadith record is identified by its source: COLLECTION, SOURCE
-- SYSTEM, EDITION and the source's own REFERENCE, exactly as supplied. A bare
-- number is never a platform-wide key. The public citation
-- `/hadith/{collectionSlug}/{hadithNumber}` is a SEPARATE reviewed mapping from
-- a collection-local number to exactly one source-qualified record that
-- declares that number as its intended citation.
--
-- FOUR GROUPS OF TABLES, FOUR POSTURES FOR THE APPLICATION PRINCIPAL:
--
--   SOURCE        HadithSourceSystem, HadithEdition, HadithActivation
--                 — registered by the owner/operator only. The runtime may READ
--                 them and nothing else, so no permission, label or checkbox can
--                 create an authority, turn a fixture into one, or make a
--                 collection public. Sources and editions are immutable.
--
--   CANONICAL     HadithCollection, HadithBook, HadithChapter, Hadith,
--                 HadithRevision, HadithGrading, HadithVerification,
--                 HadithCitation, HadithCitationRevision, HadithConflict
--                 — written ONLY by the procedures below, each of which
--                 re-checks the actor's live `hadith.editCanonical` grant and
--                 purpose-bound step-up grant in SQL. The runtime holds SELECT
--                 and EXECUTE, and an UPDATE on nothing but display-name
--                 versions.
--
--   LAYERED       display names, translations, commentary, sciences, topics
--                 — administered through the Hadith service under
--                 `hadith.administer`. A layered record is public only while
--                 its parent is public and it names a REGISTERED source system
--                 — which the runtime cannot create.
--
--   DERIVED       Search's `hadith` vocabulary.
--
-- REFUSALS 51200-51229, distinct from every earlier phase's.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.

BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- SOURCE — registered by the owner/operator, read by everyone else
-- ===========================================================================

CREATE TABLE [dbo].[HadithSourceSystem] (
    [id] NVARCHAR(36) NOT NULL,
    [code] NVARCHAR(64) NOT NULL,
    [authority] NVARCHAR(16) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [version] NVARCHAR(64) NOT NULL,
    [encoding] NVARCHAR(32) NOT NULL,
    [reference] NVARCHAR(400),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [HadithSourceSystem_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [HadithSourceSystem_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [HadithSourceSystem_code_key] UNIQUE NONCLUSTERED ([code])
);

-- The platform's own collection namespace: a source-independent slug chosen
-- once and never changed, so a citation URL never breaks. Its display names are
-- presentation (HadithCollectionName) and carry their own version.
CREATE TABLE [dbo].[HadithCollection] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [position] INT NOT NULL,
    [namesVersion] INT NOT NULL CONSTRAINT [HadithCollection_namesVersion_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [HadithCollection_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [HadithCollection_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [HadithCollection_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [HadithCollection_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- One edition of one collection as one source system carries it. The same
-- collection may arrive in several editions and through several systems, each
-- numbering and structuring it in its own way; none is merged into another.
CREATE TABLE [dbo].[HadithEdition] (
    [id] NVARCHAR(36) NOT NULL,
    [collectionId] NVARCHAR(36) NOT NULL,
    [sourceSystemId] NVARCHAR(36) NOT NULL,
    [code] NVARCHAR(64) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [reference] NVARCHAR(400),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [HadithEdition_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [HadithEdition_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [HadithEdition_code_key] UNIQUE NONCLUSTERED ([collectionId],[sourceSystemId],[code]),
    CONSTRAINT [HadithEdition_collection_key] UNIQUE NONCLUSTERED ([id],[collectionId]),
    CONSTRAINT [HadithEdition_identity_key] UNIQUE NONCLUSTERED ([id],[collectionId],[sourceSystemId])
);

-- A collection is public if and only if its activation row exists. Every row
-- shares one authority: the section is either fixture proof or approved.
CREATE TABLE [dbo].[HadithActivation] (
    [collectionId] NVARCHAR(36) NOT NULL,
    [authority] NVARCHAR(16) NOT NULL,
    [authorisedBy] NVARCHAR(200) NOT NULL,
    [activatedAt] DATETIME2 NOT NULL CONSTRAINT [HadithActivation_activatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [HadithActivation_pkey] PRIMARY KEY CLUSTERED ([collectionId])
);

ALTER TABLE [dbo].[HadithEdition] ADD CONSTRAINT [HadithEdition_collectionId_fkey] FOREIGN KEY ([collectionId]) REFERENCES [dbo].[HadithCollection]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithEdition] ADD CONSTRAINT [HadithEdition_sourceSystemId_fkey] FOREIGN KEY ([sourceSystemId]) REFERENCES [dbo].[HadithSourceSystem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithActivation] ADD CONSTRAINT [HadithActivation_collectionId_fkey] FOREIGN KEY ([collectionId]) REFERENCES [dbo].[HadithCollection]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[HadithSourceSystem] ADD CONSTRAINT [HadithSourceSystem_authority_ck] CHECK ([authority] IN (N'fixture',N'approved'));
-- An approved source system carries the reference to the authority's evidence.
-- The platform records it; it never invents it.
ALTER TABLE [dbo].[HadithSourceSystem] ADD CONSTRAINT [HadithSourceSystem_evidence_ck] CHECK ([authority]<>N'approved' OR ([reference] IS NOT NULL AND LEN([reference])>0));
ALTER TABLE [dbo].[HadithSourceSystem] ADD CONSTRAINT [HadithSourceSystem_encoding_ck] CHECK ([encoding]=N'utf-8');
ALTER TABLE [dbo].[HadithSourceSystem] ADD CONSTRAINT [HadithSourceSystem_code_ck] CHECK (LEN([code])>0 AND LEN([title])>0 AND LEN([version])>0);
ALTER TABLE [dbo].[HadithEdition] ADD CONSTRAINT [HadithEdition_code_ck] CHECK (LEN([code])>0 AND LEN([title])>0);
ALTER TABLE [dbo].[HadithActivation] ADD CONSTRAINT [HadithActivation_ck] CHECK ([authority] IN (N'fixture',N'approved') AND LEN([authorisedBy])>0);
-- A public address is lowercase ASCII words joined by single hyphens, and never
-- a word the Hadith section already uses as a path: `/hadith/{collectionSlug}/
-- {hadithNumber}` shares its first segment with the section's own pages.
ALTER TABLE [dbo].[HadithCollection] ADD CONSTRAINT [HadithCollection_slug_ck] CHECK (LEN([slug])>=2 AND [slug] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^a-z0-9-]%' AND [slug] NOT LIKE N'-%' AND [slug] NOT LIKE N'%-' AND [slug] NOT LIKE N'%--%' AND [slug] NOT IN (N'introduction',N'collections',N'browse',N'search',N'topics',N'sciences',N'commentary',N'books',N'videos',N'articles',N'research',N'courses',N'scholars'));
ALTER TABLE [dbo].[HadithCollection] ADD CONSTRAINT [HadithCollection_ck] CHECK ([position] BETWEEN 0 AND 10000 AND [namesVersion]>0);

-- A registered source system or edition is a fact about an external source. It
-- is never edited: a corrected source is a NEW registration.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithSourceSystemImmutable] ON [dbo].[HadithSourceSystem] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51200, ''A registered Hadith source is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithEditionImmutable] ON [dbo].[HadithEdition] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51200, ''A registered Hadith source is immutable.'', 1; END;';
-- A collection's identity is fixed once created; only its display-name version
-- moves, by exactly one.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithCollectionImmutable] ON [dbo].[HadithCollection] AFTER UPDATE, DELETE AS BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted) THROW 51201, ''Canonical Hadith structure is immutable.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id WHERE CAST(i.slug AS VARBINARY(240))<>CAST(d.slug AS VARBINARY(240)) OR i.position<>d.position OR i.namesVersion<>d.namesVersion+1) THROW 51201, ''Canonical Hadith structure is immutable.'', 1;
 END;';

-- ===========================================================================
-- CANONICAL — written only by the procedures below
-- ===========================================================================

-- A Book is a sourced structural unit of ONE edition: two editions that divide a
-- collection differently keep two structures, never one merged by display name.
-- The source's own reference and title are kept exactly; the slug is the
-- platform's address, chosen once.
CREATE TABLE [dbo].[HadithBook] (
    [id] NVARCHAR(36) NOT NULL,
    [collectionId] NVARCHAR(36) NOT NULL,
    [editionId] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [reference] NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [position] INT NOT NULL,
    [title] NVARCHAR(400),
    [titleLanguage] NVARCHAR(16),
    [namesVersion] INT NOT NULL CONSTRAINT [HadithBook_namesVersion_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [HadithBook_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [HadithBook_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [HadithBook_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [HadithBook_slug_key] UNIQUE NONCLUSTERED ([collectionId],[slug]),
    CONSTRAINT [HadithBook_reference_key] UNIQUE NONCLUSTERED ([editionId],[reference]),
    CONSTRAINT [HadithBook_position_key] UNIQUE NONCLUSTERED ([editionId],[position]),
    CONSTRAINT [HadithBook_edition_key] UNIQUE NONCLUSTERED ([id],[editionId])
);

CREATE TABLE [dbo].[HadithChapter] (
    [id] NVARCHAR(36) NOT NULL,
    [bookId] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [reference] NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [position] INT NOT NULL,
    [title] NVARCHAR(400),
    [titleLanguage] NVARCHAR(16),
    [namesVersion] INT NOT NULL CONSTRAINT [HadithChapter_namesVersion_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [HadithChapter_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [HadithChapter_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [HadithChapter_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [HadithChapter_slug_key] UNIQUE NONCLUSTERED ([bookId],[slug]),
    CONSTRAINT [HadithChapter_reference_key] UNIQUE NONCLUSTERED ([bookId],[reference]),
    CONSTRAINT [HadithChapter_position_key] UNIQUE NONCLUSTERED ([bookId],[position]),
    CONSTRAINT [HadithChapter_book_key] UNIQUE NONCLUSTERED ([id],[bookId])
);

-- THE SOURCE-QUALIFIED RECORD. Its identity is (collection, source system,
-- edition, source reference): the reference is the source's own text, kept
-- exactly and compared by its bytes, so the same apparent number may exist in
-- every edition of every collection without colliding. `citationNumber` is the
-- collection-local public number this record is a CANDIDATE for under the
-- numbering policy — never its identity; HadithCitation chooses one candidate.
CREATE TABLE [dbo].[Hadith] (
    [id] NVARCHAR(36) NOT NULL,
    [collectionId] NVARCHAR(36) NOT NULL,
    [sourceSystemId] NVARCHAR(36) NOT NULL,
    [editionId] NVARCHAR(36) NOT NULL,
    [sourceReference] NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [citationNumber] INT,
    [bookId] NVARCHAR(36) NOT NULL,
    [chapterId] NVARCHAR(36),
    [text] NVARCHAR(MAX) NOT NULL,
    [textLanguage] NVARCHAR(16) NOT NULL,
    [chain] NVARCHAR(MAX),
    [chainLanguage] NVARCHAR(16),
    [version] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Hadith_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Hadith_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Hadith_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Hadith_identity_key] UNIQUE NONCLUSTERED ([editionId],[sourceReference]),
    CONSTRAINT [Hadith_citation_key] UNIQUE NONCLUSTERED ([id],[collectionId],[citationNumber])
);

-- Every canonical version of every record, version 1 included: the complete
-- set of sourced facts, the evidence the change rests on, and who made it under
-- which step-up grant. The actor and the grant are HISTORICAL identifiers
-- (DOMAIN_MODEL.md 6.2.1) and carry no foreign key.
CREATE TABLE [dbo].[HadithRevision] (
    [hadithId] NVARCHAR(36) NOT NULL,
    [version] INT NOT NULL,
    [operation] NVARCHAR(16) NOT NULL,
    [sourceReference] NVARCHAR(64) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [citationNumber] INT,
    [bookId] NVARCHAR(36) NOT NULL,
    [chapterId] NVARCHAR(36),
    [text] NVARCHAR(MAX) NOT NULL,
    [textLanguage] NVARCHAR(16) NOT NULL,
    [chain] NVARCHAR(MAX),
    [chainLanguage] NVARCHAR(16),
    [evidence] NVARCHAR(400) NOT NULL,
    [reason] NVARCHAR(500),
    [actorId] NVARCHAR(36) NOT NULL,
    [stepUpGrantId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [HadithRevision_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [HadithRevision_pkey] PRIMARY KEY CLUSTERED ([hadithId],[version])
);

-- A grading is what a named grader said, where it was said, in the grader's own
-- words. It belongs to one version of one record and is never a platform
-- judgement: there is no grade vocabulary, no rank and no equivalence.
CREATE TABLE [dbo].[HadithGrading] (
    [hadithId] NVARCHAR(36) NOT NULL,
    [version] INT NOT NULL,
    [position] INT NOT NULL,
    [grader] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL,
    [label] NVARCHAR(400) NOT NULL,
    [labelLanguage] NVARCHAR(16) NOT NULL,
    [reference] NVARCHAR(400) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [HadithGrading_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [HadithGrading_pkey] PRIMARY KEY CLUSTERED ([hadithId],[version],[position]),
    CONSTRAINT [HadithGrading_grader_key] UNIQUE NONCLUSTERED ([hadithId],[version],[grader])
);

-- Human verification of ONE version. A correction creates a new version, which
-- this row does not cover: a stale verification never authorises changed text.
CREATE TABLE [dbo].[HadithVerification] (
    [id] NVARCHAR(36) NOT NULL,
    [hadithId] NVARCHAR(36) NOT NULL,
    [version] INT NOT NULL,
    [evidence] NVARCHAR(400) NOT NULL,
    [actorId] NVARCHAR(36) NOT NULL,
    [stepUpGrantId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [HadithVerification_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [HadithVerification_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [HadithVerification_version_key] UNIQUE NONCLUSTERED ([hadithId],[version])
);

-- THE PUBLIC CITATION. `(collection, number)` names exactly one source-qualified
-- record, and only a record that declared that number as its intended citation
-- (the composite foreign key). `id` is the citation's stable identity for
-- derived work such as search.
CREATE TABLE [dbo].[HadithCitation] (
    [collectionId] NVARCHAR(36) NOT NULL,
    [number] INT NOT NULL,
    [id] NVARCHAR(36) NOT NULL,
    [hadithId] NVARCHAR(36) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [HadithCitation_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [HadithCitation_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [HadithCitation_pkey] PRIMARY KEY CLUSTERED ([collectionId],[number]),
    CONSTRAINT [HadithCitation_id_key] UNIQUE NONCLUSTERED ([id])
);

CREATE TABLE [dbo].[HadithCitationRevision] (
    [collectionId] NVARCHAR(36) NOT NULL,
    [number] INT NOT NULL,
    [version] INT NOT NULL,
    [hadithId] NVARCHAR(36) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [evidence] NVARCHAR(400) NOT NULL,
    [reason] NVARCHAR(500),
    [actorId] NVARCHAR(36) NOT NULL,
    [stepUpGrantId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [HadithCitationRevision_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [HadithCitationRevision_pkey] PRIMARY KEY CLUSTERED ([collectionId],[number],[version])
);

-- CONFLICT EVIDENCE. Two candidates for one citation that disagree, byte for
-- byte, in text, chain, a shared grader's grading, or — within one edition —
-- structural placement.
-- Detected by the database whenever a candidate is written; never resolved by
-- the platform (OPEN_DECISIONS.md 1.6): there is no resolution column, no
-- resolution procedure, and while one row exists for a citation it cannot be
-- mapped and is not public.
CREATE TABLE [dbo].[HadithConflict] (
    [id] NVARCHAR(36) NOT NULL,
    [collectionId] NVARCHAR(36) NOT NULL,
    [citationNumber] INT NOT NULL,
    [hadithId] NVARCHAR(36) NOT NULL,
    [hadithVersion] INT NOT NULL,
    [otherHadithId] NVARCHAR(36) NOT NULL,
    [otherVersion] INT NOT NULL,
    [facets] NVARCHAR(64) NOT NULL,
    [detectedAt] DATETIME2 NOT NULL CONSTRAINT [HadithConflict_detectedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [HadithConflict_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE NONCLUSTERED INDEX [HadithEdition_sourceSystemId_idx] ON [dbo].[HadithEdition]([sourceSystemId]);
CREATE NONCLUSTERED INDEX [HadithCollection_position_idx] ON [dbo].[HadithCollection]([position],[slug]);
CREATE NONCLUSTERED INDEX [HadithBook_collection_position_idx] ON [dbo].[HadithBook]([collectionId],[position]);
CREATE NONCLUSTERED INDEX [Hadith_candidates_idx] ON [dbo].[Hadith]([collectionId],[citationNumber]);
CREATE NONCLUSTERED INDEX [Hadith_book_chapter_idx] ON [dbo].[Hadith]([bookId],[chapterId]);
CREATE NONCLUSTERED INDEX [HadithCitation_hadithId_idx] ON [dbo].[HadithCitation]([hadithId]);
CREATE NONCLUSTERED INDEX [HadithCitation_state_idx] ON [dbo].[HadithCitation]([state],[collectionId],[number]);
CREATE NONCLUSTERED INDEX [HadithConflict_citation_idx] ON [dbo].[HadithConflict]([collectionId],[citationNumber]);
CREATE NONCLUSTERED INDEX [HadithConflict_hadithId_idx] ON [dbo].[HadithConflict]([hadithId]);
CREATE NONCLUSTERED INDEX [HadithConflict_otherHadithId_idx] ON [dbo].[HadithConflict]([otherHadithId]);

ALTER TABLE [dbo].[HadithBook] ADD CONSTRAINT [HadithBook_edition_fkey] FOREIGN KEY ([editionId],[collectionId]) REFERENCES [dbo].[HadithEdition]([id],[collectionId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithBook] ADD CONSTRAINT [HadithBook_titleLanguage_fkey] FOREIGN KEY ([titleLanguage]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithChapter] ADD CONSTRAINT [HadithChapter_bookId_fkey] FOREIGN KEY ([bookId]) REFERENCES [dbo].[HadithBook]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithChapter] ADD CONSTRAINT [HadithChapter_titleLanguage_fkey] FOREIGN KEY ([titleLanguage]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Hadith] ADD CONSTRAINT [Hadith_edition_fkey] FOREIGN KEY ([editionId],[collectionId],[sourceSystemId]) REFERENCES [dbo].[HadithEdition]([id],[collectionId],[sourceSystemId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Hadith] ADD CONSTRAINT [Hadith_book_fkey] FOREIGN KEY ([bookId],[editionId]) REFERENCES [dbo].[HadithBook]([id],[editionId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Hadith] ADD CONSTRAINT [Hadith_chapter_fkey] FOREIGN KEY ([chapterId],[bookId]) REFERENCES [dbo].[HadithChapter]([id],[bookId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Hadith] ADD CONSTRAINT [Hadith_textLanguage_fkey] FOREIGN KEY ([textLanguage]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Hadith] ADD CONSTRAINT [Hadith_chainLanguage_fkey] FOREIGN KEY ([chainLanguage]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithRevision] ADD CONSTRAINT [HadithRevision_hadithId_fkey] FOREIGN KEY ([hadithId]) REFERENCES [dbo].[Hadith]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithGrading] ADD CONSTRAINT [HadithGrading_revision_fkey] FOREIGN KEY ([hadithId],[version]) REFERENCES [dbo].[HadithRevision]([hadithId],[version]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithGrading] ADD CONSTRAINT [HadithGrading_labelLanguage_fkey] FOREIGN KEY ([labelLanguage]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithVerification] ADD CONSTRAINT [HadithVerification_revision_fkey] FOREIGN KEY ([hadithId],[version]) REFERENCES [dbo].[HadithRevision]([hadithId],[version]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithCitation] ADD CONSTRAINT [HadithCitation_collectionId_fkey] FOREIGN KEY ([collectionId]) REFERENCES [dbo].[HadithCollection]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithCitation] ADD CONSTRAINT [HadithCitation_candidate_fkey] FOREIGN KEY ([hadithId],[collectionId],[number]) REFERENCES [dbo].[Hadith]([id],[collectionId],[citationNumber]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithCitationRevision] ADD CONSTRAINT [HadithCitationRevision_citation_fkey] FOREIGN KEY ([collectionId],[number]) REFERENCES [dbo].[HadithCitation]([collectionId],[number]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithCitationRevision] ADD CONSTRAINT [HadithCitationRevision_hadithId_fkey] FOREIGN KEY ([hadithId]) REFERENCES [dbo].[Hadith]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithConflict] ADD CONSTRAINT [HadithConflict_collectionId_fkey] FOREIGN KEY ([collectionId]) REFERENCES [dbo].[HadithCollection]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithConflict] ADD CONSTRAINT [HadithConflict_revision_fkey] FOREIGN KEY ([hadithId],[hadithVersion]) REFERENCES [dbo].[HadithRevision]([hadithId],[version]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithConflict] ADD CONSTRAINT [HadithConflict_otherRevision_fkey] FOREIGN KEY ([otherHadithId],[otherVersion]) REFERENCES [dbo].[HadithRevision]([hadithId],[version]) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[HadithBook] ADD CONSTRAINT [HadithBook_slug_ck] CHECK (LEN([slug])>=2 AND [slug] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^a-z0-9-]%' AND [slug] NOT LIKE N'-%' AND [slug] NOT LIKE N'%-' AND [slug] NOT LIKE N'%--%');
ALTER TABLE [dbo].[HadithChapter] ADD CONSTRAINT [HadithChapter_slug_ck] CHECK (LEN([slug])>=2 AND [slug] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^a-z0-9-]%' AND [slug] NOT LIKE N'-%' AND [slug] NOT LIKE N'%-' AND [slug] NOT LIKE N'%--%');
-- A source reference is the source's own text: present, unpadded and free of
-- control characters — refused, never trimmed.
ALTER TABLE [dbo].[HadithBook] ADD CONSTRAINT [HadithBook_ck] CHECK (DATALENGTH([reference])>0 AND DATALENGTH(LTRIM(RTRIM([reference])))=DATALENGTH([reference]) AND [reference] NOT LIKE N'%[' + NCHAR(0) + N'-' + NCHAR(31) + N']%' AND [position] BETWEEN 0 AND 100000 AND [namesVersion]>0 AND (([title] IS NULL AND [titleLanguage] IS NULL) OR (DATALENGTH([title])>0 AND [titleLanguage] IS NOT NULL)));
ALTER TABLE [dbo].[HadithChapter] ADD CONSTRAINT [HadithChapter_ck] CHECK (DATALENGTH([reference])>0 AND DATALENGTH(LTRIM(RTRIM([reference])))=DATALENGTH([reference]) AND [reference] NOT LIKE N'%[' + NCHAR(0) + N'-' + NCHAR(31) + N']%' AND [position] BETWEEN 0 AND 100000 AND [namesVersion]>0 AND (([title] IS NULL AND [titleLanguage] IS NULL) OR (DATALENGTH([title])>0 AND [titleLanguage] IS NOT NULL)));
ALTER TABLE [dbo].[Hadith] ADD CONSTRAINT [Hadith_ck] CHECK ([version]>0 AND DATALENGTH([sourceReference])>0 AND DATALENGTH(LTRIM(RTRIM([sourceReference])))=DATALENGTH([sourceReference]) AND [sourceReference] NOT LIKE N'%[' + NCHAR(0) + N'-' + NCHAR(31) + N']%' AND ([citationNumber] IS NULL OR [citationNumber] BETWEEN 1 AND 999999) AND DATALENGTH([text]) BETWEEN 2 AND 400000 AND (([chain] IS NULL AND [chainLanguage] IS NULL) OR (DATALENGTH([chain]) BETWEEN 2 AND 80000 AND [chainLanguage] IS NOT NULL)));
ALTER TABLE [dbo].[HadithRevision] ADD CONSTRAINT [HadithRevision_ck] CHECK ([version]>0 AND [operation] IN (N'created',N'corrected') AND (([operation]=N'created' AND [version]=1) OR ([operation]=N'corrected' AND [version]>1 AND [reason] IS NOT NULL AND LEN([reason])>0)) AND LEN([evidence])>0 AND DATALENGTH([text])>0 AND ([citationNumber] IS NULL OR [citationNumber] BETWEEN 1 AND 999999));
-- No grading without its grader, its label and the published reference it
-- comes from.
ALTER TABLE [dbo].[HadithGrading] ADD CONSTRAINT [HadithGrading_ck] CHECK ([position] BETWEEN 0 AND 31 AND DATALENGTH([grader])>0 AND DATALENGTH([label])>0 AND LEN([reference])>0);
ALTER TABLE [dbo].[HadithVerification] ADD CONSTRAINT [HadithVerification_ck] CHECK ([version]>0 AND LEN([evidence])>0);
ALTER TABLE [dbo].[HadithCitation] ADD CONSTRAINT [HadithCitation_ck] CHECK ([number] BETWEEN 1 AND 999999 AND [state] IN (N'mapped',N'withdrawn') AND [version]>0);
ALTER TABLE [dbo].[HadithCitationRevision] ADD CONSTRAINT [HadithCitationRevision_ck] CHECK ([version]>0 AND [state] IN (N'mapped',N'withdrawn') AND LEN([evidence])>0 AND ([version]=1 OR ([reason] IS NOT NULL AND LEN([reason])>0)));
ALTER TABLE [dbo].[HadithConflict] ADD CONSTRAINT [HadithConflict_ck] CHECK ([hadithId]<>[otherHadithId] AND LEN([facets])>0 AND [facets] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^a-z,]%');

-- Structure never changes and is never removed; only display-name versions move.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithBookImmutable] ON [dbo].[HadithBook] AFTER UPDATE, DELETE AS BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted) THROW 51201, ''Canonical Hadith structure is immutable.'', 1;
 IF UPDATE(collectionId) OR UPDATE(editionId) OR UPDATE(slug) OR UPDATE(reference) OR UPDATE(position) OR UPDATE(title) OR UPDATE(titleLanguage) THROW 51201, ''Canonical Hadith structure is immutable.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id WHERE i.namesVersion<>d.namesVersion+1) THROW 51201, ''Canonical Hadith structure is immutable.'', 1;
 END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithChapterImmutable] ON [dbo].[HadithChapter] AFTER UPDATE, DELETE AS BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted) THROW 51201, ''Canonical Hadith structure is immutable.'', 1;
 IF UPDATE(bookId) OR UPDATE(slug) OR UPDATE(reference) OR UPDATE(position) OR UPDATE(title) OR UPDATE(titleLanguage) THROW 51201, ''Canonical Hadith structure is immutable.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id WHERE i.namesVersion<>d.namesVersion+1) THROW 51201, ''Canonical Hadith structure is immutable.'', 1;
 END;';
-- A record changes only by a correction: never deleted, never moved to another
-- collection, edition or source system, its version advanced by exactly one and
-- only once its revision for that version holds exactly the new facts.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithCanonicalChange] ON [dbo].[Hadith] AFTER UPDATE, DELETE AS BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted) THROW 51201, ''Canonical Hadith structure is immutable.'', 1;
 IF UPDATE(id) OR UPDATE(collectionId) OR UPDATE(sourceSystemId) OR UPDATE(editionId) THROW 51201, ''Canonical Hadith structure is immutable.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.id=i.id WHERE i.version<>d.version+1) THROW 51202, ''A canonical change must advance the version by one.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (
   SELECT 1 FROM [dbo].[HadithRevision] r
   WHERE r.hadithId=i.id AND r.version=i.version
     AND CAST(r.sourceReference AS VARBINARY(128))=CAST(i.sourceReference AS VARBINARY(128))
     AND ISNULL(r.citationNumber,0)=ISNULL(i.citationNumber,0)
     AND r.bookId=i.bookId AND ISNULL(r.chapterId,N'''')=ISNULL(i.chapterId,N'''')
     AND CAST(r.[text] AS VARBINARY(MAX))=CAST(i.[text] AS VARBINARY(MAX)) AND r.textLanguage=i.textLanguage
     AND ISNULL(CAST(r.chain AS VARBINARY(MAX)),0x00)=ISNULL(CAST(i.chain AS VARBINARY(MAX)),0x00)
     AND ISNULL(r.chainLanguage,N'''')=ISNULL(i.chainLanguage,N'''')))
   THROW 51202, ''A canonical change must be recorded in its history.'', 1;
 END;';
-- A citation changes only by advancing its version with a matching revision.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithCitationChange] ON [dbo].[HadithCitation] AFTER UPDATE, DELETE AS BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted) THROW 51201, ''Canonical Hadith structure is immutable.'', 1;
 IF UPDATE(collectionId) OR UPDATE(number) OR UPDATE(id) THROW 51201, ''Canonical Hadith structure is immutable.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i JOIN deleted d ON d.collectionId=i.collectionId AND d.number=i.number WHERE i.version<>d.version+1) THROW 51202, ''A canonical change must advance the version by one.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM [dbo].[HadithCitationRevision] r WHERE r.collectionId=i.collectionId AND r.number=i.number AND r.version=i.version AND r.hadithId=i.hadithId AND r.state=i.state))
   THROW 51202, ''A canonical change must be recorded in its history.'', 1;
 END;';
-- History, gradings, verifications and conflict evidence are append-only.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithRevisionImmutable] ON [dbo].[HadithRevision] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51203, ''Canonical Hadith history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithGradingImmutable] ON [dbo].[HadithGrading] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51203, ''Canonical Hadith history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithVerificationImmutable] ON [dbo].[HadithVerification] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51203, ''Canonical Hadith history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithCitationRevisionImmutable] ON [dbo].[HadithCitationRevision] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51203, ''Canonical Hadith history is immutable.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithConflictImmutable] ON [dbo].[HadithConflict] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51203, ''Canonical Hadith history is immutable.'', 1; END;';
-- A conflicted citation is never mapped, and a record never enters an
-- activated collection under the other authority.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithCitationIntegrity] ON [dbo].[HadithCitation] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted i JOIN [dbo].[HadithConflict] c ON c.collectionId=i.collectionId AND c.citationNumber=i.number WHERE i.state=N''mapped'')
   THROW 51204, ''A conflicted citation cannot be mapped.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i
            JOIN [dbo].[HadithActivation] a ON a.collectionId=i.collectionId AND a.authority=N''approved''
            JOIN [dbo].[Hadith] h ON h.id=i.hadithId
            JOIN [dbo].[HadithSourceSystem] s ON s.id=h.sourceSystemId
            WHERE i.state=N''mapped'' AND s.authority<>N''approved'')
   THROW 51205, ''A fixture source cannot enter an approved collection.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i
            JOIN [dbo].[HadithActivation] a ON a.collectionId=i.collectionId AND a.authority=N''fixture''
            JOIN [dbo].[Hadith] h ON h.id=i.hadithId
            JOIN [dbo].[HadithSourceSystem] s ON s.id=h.sourceSystemId
            WHERE i.state=N''mapped'' AND s.authority<>N''fixture'')
   THROW 51208, ''An approved source cannot be shown as fixture text.'', 1;
 END;';

-- ACTIVATION IS AN OPERATOR ACT. It is never edited (only removed and made
-- again), every activation shares one authority, an empty collection cannot be
-- activated, and every mapped record's source must share the activation's
-- authority: an APPROVED activation refuses fixture text, and a FIXTURE
-- activation refuses approved text, which its non-authoritative banner would
-- otherwise misdescribe.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithActivationIntegrity] ON [dbo].[HadithActivation] AFTER INSERT, UPDATE AS BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM deleted) THROW 51206, ''Activation is replaced, never edited.'', 1;
 IF (SELECT COUNT(DISTINCT authority) FROM [dbo].[HadithActivation]) > 1 THROW 51206, ''Every Hadith activation shares one authority.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM [dbo].[HadithCitation] c WHERE c.collectionId=i.collectionId AND c.state=N''mapped''))
   THROW 51206, ''An empty Hadith collection cannot be activated.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i
            JOIN [dbo].[HadithCitation] c ON c.collectionId=i.collectionId AND c.state=N''mapped''
            JOIN [dbo].[Hadith] h ON h.id=c.hadithId
            JOIN [dbo].[HadithSourceSystem] s ON s.id=h.sourceSystemId
            WHERE i.authority=N''approved'' AND s.authority<>N''approved'')
   THROW 51205, ''A fixture source cannot enter an approved collection.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i
            JOIN [dbo].[HadithCitation] c ON c.collectionId=i.collectionId AND c.state=N''mapped''
            JOIN [dbo].[Hadith] h ON h.id=c.hadithId
            JOIN [dbo].[HadithSourceSystem] s ON s.id=h.sourceSystemId
            WHERE i.authority=N''fixture'' AND s.authority<>N''fixture'')
   THROW 51208, ''An approved source cannot be shown as fixture text.'', 1;
 END;';

-- ===========================================================================
-- LAYERED — administered under `hadith.administer`
-- ===========================================================================

CREATE TABLE [dbo].[HadithCollectionName] (
    [collectionId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(2000),
    CONSTRAINT [HadithCollectionName_pkey] PRIMARY KEY CLUSTERED ([collectionId],[locale])
);

CREATE TABLE [dbo].[HadithBookName] (
    [bookId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    CONSTRAINT [HadithBookName_pkey] PRIMARY KEY CLUSTERED ([bookId],[locale])
);

CREATE TABLE [dbo].[HadithChapterName] (
    [chapterId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    CONSTRAINT [HadithChapterName_pkey] PRIMARY KEY CLUSTERED ([chapterId],[locale])
);

-- A translation is a separate record in its own content language. Several may
-- coexist for one record and one language; none is privileged.
CREATE TABLE [dbo].[HadithTranslation] (
    [id] NVARCHAR(36) NOT NULL,
    [hadithId] NVARCHAR(36) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [text] NVARCHAR(MAX) NOT NULL,
    [attribution] NVARCHAR(400),
    [sourceSystemId] NVARCHAR(36),
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [HadithTranslation_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    [publishedAt] DATETIME2,
    CONSTRAINT [HadithTranslation_pkey] PRIMARY KEY CLUSTERED ([id])
);

CREATE TABLE [dbo].[HadithTranslationContributor] (
    [translationId] NVARCHAR(36) NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(32) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [HadithTranslationContributor_pkey] PRIMARY KEY CLUSTERED ([translationId],[personId],[role])
);

-- A commentary is a scholarly work in one language with at most one entry per
-- record. Its entries are commentary, never canonical text.
CREATE TABLE [dbo].[HadithCommentary] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(2000),
    [attribution] NVARCHAR(400),
    [sourceSystemId] NVARCHAR(36),
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [HadithCommentary_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    [publishedAt] DATETIME2,
    CONSTRAINT [HadithCommentary_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [HadithCommentary_slug_key] UNIQUE NONCLUSTERED ([slug])
);

CREATE TABLE [dbo].[HadithCommentaryContributor] (
    [commentaryId] NVARCHAR(36) NOT NULL,
    [personId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(32) NOT NULL,
    [position] INT NOT NULL,
    CONSTRAINT [HadithCommentaryContributor_pkey] PRIMARY KEY CLUSTERED ([commentaryId],[personId],[role])
);

CREATE TABLE [dbo].[HadithCommentaryEntry] (
    [commentaryId] NVARCHAR(36) NOT NULL,
    [hadithId] NVARCHAR(36) NOT NULL,
    [text] NVARCHAR(MAX) NOT NULL,
    CONSTRAINT [HadithCommentaryEntry_pkey] PRIMARY KEY CLUSTERED ([commentaryId],[hadithId])
);

-- Study material on the sciences of Hadith: never a canonical record and never
-- a grading authority.
CREATE TABLE [dbo].[HadithScience] (
    [id] NVARCHAR(36) NOT NULL,
    [slug] NVARCHAR(120) NOT NULL,
    [position] INT NOT NULL,
    [attribution] NVARCHAR(400),
    [sourceSystemId] NVARCHAR(36),
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [HadithScience_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL,
    [publishedAt] DATETIME2,
    CONSTRAINT [HadithScience_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [HadithScience_slug_key] UNIQUE NONCLUSTERED ([slug])
);

CREATE TABLE [dbo].[HadithScienceText] (
    [scienceId] NVARCHAR(36) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    [title] NVARCHAR(200) NOT NULL,
    [body] NVARCHAR(MAX) NOT NULL,
    CONSTRAINT [HadithScienceText_pkey] PRIMARY KEY CLUSTERED ([scienceId],[languageCode])
);

-- TYPED TOPIC ASSIGNMENT (DOMAIN_MODEL.md 6.2): a real foreign key to the
-- source-qualified record and a real foreign key to the Topic.
CREATE TABLE [dbo].[HadithTopic] (
    [hadithId] NVARCHAR(36) NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [HadithTopic_pkey] PRIMARY KEY CLUSTERED ([hadithId],[topicId])
);

CREATE NONCLUSTERED INDEX [HadithTranslation_hadithId_idx] ON [dbo].[HadithTranslation]([hadithId],[state],[languageCode]);
CREATE NONCLUSTERED INDEX [HadithTranslationContributor_personId_idx] ON [dbo].[HadithTranslationContributor]([personId]);
CREATE NONCLUSTERED INDEX [HadithCommentary_state_slug_idx] ON [dbo].[HadithCommentary]([state],[slug]);
CREATE NONCLUSTERED INDEX [HadithCommentaryContributor_personId_idx] ON [dbo].[HadithCommentaryContributor]([personId]);
CREATE NONCLUSTERED INDEX [HadithCommentaryEntry_hadithId_idx] ON [dbo].[HadithCommentaryEntry]([hadithId]);
CREATE NONCLUSTERED INDEX [HadithScience_state_position_idx] ON [dbo].[HadithScience]([state],[position],[slug]);
CREATE NONCLUSTERED INDEX [HadithTopic_topicId_idx] ON [dbo].[HadithTopic]([topicId],[hadithId]);

ALTER TABLE [dbo].[HadithCollectionName] ADD CONSTRAINT [HadithCollectionName_collectionId_fkey] FOREIGN KEY ([collectionId]) REFERENCES [dbo].[HadithCollection]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithBookName] ADD CONSTRAINT [HadithBookName_bookId_fkey] FOREIGN KEY ([bookId]) REFERENCES [dbo].[HadithBook]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithChapterName] ADD CONSTRAINT [HadithChapterName_chapterId_fkey] FOREIGN KEY ([chapterId]) REFERENCES [dbo].[HadithChapter]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithTranslation] ADD CONSTRAINT [HadithTranslation_hadithId_fkey] FOREIGN KEY ([hadithId]) REFERENCES [dbo].[Hadith]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithTranslation] ADD CONSTRAINT [HadithTranslation_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithTranslation] ADD CONSTRAINT [HadithTranslation_sourceSystemId_fkey] FOREIGN KEY ([sourceSystemId]) REFERENCES [dbo].[HadithSourceSystem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithTranslationContributor] ADD CONSTRAINT [HadithTranslationContributor_translationId_fkey] FOREIGN KEY ([translationId]) REFERENCES [dbo].[HadithTranslation]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithTranslationContributor] ADD CONSTRAINT [HadithTranslationContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithCommentary] ADD CONSTRAINT [HadithCommentary_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithCommentary] ADD CONSTRAINT [HadithCommentary_sourceSystemId_fkey] FOREIGN KEY ([sourceSystemId]) REFERENCES [dbo].[HadithSourceSystem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithCommentaryContributor] ADD CONSTRAINT [HadithCommentaryContributor_commentaryId_fkey] FOREIGN KEY ([commentaryId]) REFERENCES [dbo].[HadithCommentary]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithCommentaryContributor] ADD CONSTRAINT [HadithCommentaryContributor_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithCommentaryEntry] ADD CONSTRAINT [HadithCommentaryEntry_commentaryId_fkey] FOREIGN KEY ([commentaryId]) REFERENCES [dbo].[HadithCommentary]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithCommentaryEntry] ADD CONSTRAINT [HadithCommentaryEntry_hadithId_fkey] FOREIGN KEY ([hadithId]) REFERENCES [dbo].[Hadith]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithScience] ADD CONSTRAINT [HadithScience_sourceSystemId_fkey] FOREIGN KEY ([sourceSystemId]) REFERENCES [dbo].[HadithSourceSystem]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithScienceText] ADD CONSTRAINT [HadithScienceText_scienceId_fkey] FOREIGN KEY ([scienceId]) REFERENCES [dbo].[HadithScience]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithScienceText] ADD CONSTRAINT [HadithScienceText_languageCode_fkey] FOREIGN KEY ([languageCode]) REFERENCES [dbo].[Language]([code]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithTopic] ADD CONSTRAINT [HadithTopic_hadithId_fkey] FOREIGN KEY ([hadithId]) REFERENCES [dbo].[Hadith]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[HadithTopic] ADD CONSTRAINT [HadithTopic_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[HadithCollectionName] ADD CONSTRAINT [HadithCollectionName_ck] CHECK ([locale] IN (N'en',N'ur',N'ar') AND LEN([name])>0);
ALTER TABLE [dbo].[HadithBookName] ADD CONSTRAINT [HadithBookName_ck] CHECK ([locale] IN (N'en',N'ur',N'ar') AND LEN([name])>0);
ALTER TABLE [dbo].[HadithChapterName] ADD CONSTRAINT [HadithChapterName_ck] CHECK ([locale] IN (N'en',N'ur',N'ar') AND LEN([name])>0);
ALTER TABLE [dbo].[HadithCommentary] ADD CONSTRAINT [HadithCommentary_slug_ck] CHECK (LEN([slug])>=2 AND [slug] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^a-z0-9-]%' AND [slug] NOT LIKE N'-%' AND [slug] NOT LIKE N'%-' AND [slug] NOT LIKE N'%--%');
ALTER TABLE [dbo].[HadithScience] ADD CONSTRAINT [HadithScience_slug_ck] CHECK (LEN([slug])>=2 AND [slug] COLLATE Latin1_General_100_BIN2 NOT LIKE N'%[^a-z0-9-]%' AND [slug] NOT LIKE N'-%' AND [slug] NOT LIKE N'%-' AND [slug] NOT LIKE N'%--%');
-- A layered record is draft, published or archived; a PUBLISHED one names a
-- registered source system and when it was published. The source is what an
-- operator registered — so publication alone can never be an approval.
ALTER TABLE [dbo].[HadithTranslation] ADD CONSTRAINT [HadithTranslation_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived') AND [version]>0 AND DATALENGTH([text]) BETWEEN 2 AND 400000 AND ([state]<>N'published' OR ([sourceSystemId] IS NOT NULL AND [publishedAt] IS NOT NULL)));
ALTER TABLE [dbo].[HadithCommentary] ADD CONSTRAINT [HadithCommentary_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived') AND [version]>0 AND LEN([name])>0 AND ([state]<>N'published' OR ([sourceSystemId] IS NOT NULL AND [publishedAt] IS NOT NULL)));
ALTER TABLE [dbo].[HadithScience] ADD CONSTRAINT [HadithScience_state_ck] CHECK ([state] IN (N'draft',N'published',N'archived') AND [version]>0 AND [position] BETWEEN 0 AND 200 AND ([state]<>N'published' OR ([sourceSystemId] IS NOT NULL AND [publishedAt] IS NOT NULL)));
ALTER TABLE [dbo].[HadithTranslationContributor] ADD CONSTRAINT [HadithTranslationContributor_ck] CHECK ([role] IN (N'translator',N'editor') AND [position] BETWEEN 0 AND 11);
ALTER TABLE [dbo].[HadithCommentaryContributor] ADD CONSTRAINT [HadithCommentaryContributor_ck] CHECK ([role] IN (N'author',N'translator',N'editor',N'compiler') AND [position] BETWEEN 0 AND 11);
ALTER TABLE [dbo].[HadithCommentaryEntry] ADD CONSTRAINT [HadithCommentaryEntry_ck] CHECK (DATALENGTH([text]) BETWEEN 2 AND 240000);
ALTER TABLE [dbo].[HadithScienceText] ADD CONSTRAINT [HadithScienceText_ck] CHECK (LEN([title])>0 AND DATALENGTH([body]) BETWEEN 2 AND 80000);

-- A published commentary or science has text to show, and keeps it.
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithCommentaryPublishedText] ON [dbo].[HadithCommentary] AFTER INSERT, UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i WHERE i.state=N''published'' AND NOT EXISTS (SELECT 1 FROM [dbo].[HadithCommentaryEntry] t WHERE t.commentaryId=i.id)) THROW 51207, ''A published work needs text.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithSciencePublishedText] ON [dbo].[HadithScience] AFTER INSERT, UPDATE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM inserted i WHERE i.state=N''published'' AND NOT EXISTS (SELECT 1 FROM [dbo].[HadithScienceText] t WHERE t.scienceId=i.id)) THROW 51207, ''A published work needs text.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithCommentaryEntryKept] ON [dbo].[HadithCommentaryEntry] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM [dbo].[HadithCommentary] w WHERE w.state=N''published'' AND w.id IN (SELECT commentaryId FROM deleted) AND NOT EXISTS (SELECT 1 FROM [dbo].[HadithCommentaryEntry] t WHERE t.commentaryId=w.id)) THROW 51207, ''A published work needs text.'', 1; END;';
EXEC sp_executesql N'CREATE TRIGGER [dbo].[HadithScienceTextKept] ON [dbo].[HadithScienceText] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; IF EXISTS (SELECT 1 FROM [dbo].[HadithScience] w WHERE w.state=N''published'' AND w.id IN (SELECT scienceId FROM deleted) AND NOT EXISTS (SELECT 1 FROM [dbo].[HadithScienceText] t WHERE t.scienceId=w.id)) THROW 51207, ''A published work needs text.'', 1; END;';

-- ===========================================================================
-- THE CANONICAL WRITE PATH — these procedures, and no other
-- ===========================================================================
--
-- DEFENCE IN DEPTH, NOT A SUBSTITUTE. The Hadith service already requires a
-- `PrivilegedActor` that Identity minted for `hadith.editCanonical` with the
-- `hadith-canonical-edit` purpose and re-verifies it live. Every procedure
-- checks the same facts again from the authoritative rows — a current
-- assignment of an active role carrying the permission, held by an active
-- account, and an unexpired grant for THIS purpose bound to a live session of
-- THIS account — so a caller holding nothing but the runtime principal cannot
-- reach canonical Hadith by naming an account.
--
-- EXACT COMPARISON. Text is compared as its UTF-16 bytes (`VARBINARY`), never
-- through a collation: no case, accent, width or normalisation equivalence, and
-- no trailing-space padding, can make two different texts compare equal.
--
-- SEARCH INTENT. Every procedure that changes what a public citation would show
-- records the affected citations' indexing intent in the same transaction.

EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[HadithAssertCanonicalAuthority]
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
    JOIN [dbo].[RolePermission] rp ON rp.roleId = r.id AND rp.permissionKey = N''hadith.editCanonical''
    JOIN [dbo].[User] u ON u.id = ra.userId AND u.status = N''active''
    WHERE ra.userId = @actorId AND ra.revokedAt IS NULL
  )
  OR NOT EXISTS (
    SELECT 1
    FROM [dbo].[StepUpGrant] g
    JOIN [dbo].[Session] s ON s.id = g.sessionId AND s.userId = g.userId AND s.expiresAt > SYSUTCDATETIME()
    WHERE g.id = @stepUpGrantId AND g.userId = @actorId AND g.sessionId = @sessionId
      AND g.purpose = N''hadith-canonical-edit'' AND g.expiresAt > SYSUTCDATETIME()
  )
    THROW 51210, ''Canonical Hadith authority is not held now.'', 1;
END;
';

-- Conflict detection, shared by record creation and correction. Every OTHER
-- candidate for the same citation is compared with the record''s current
-- version, byte for byte, facet by facet; each disagreement is recorded, and
-- nothing is chosen, merged or normalised. Structure is compared only within
-- one edition: each edition keeps its own books and chapters, so two editions
-- dividing a collection differently is preserved difference, not conflict.
EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[HadithDetectConflicts]
  @hadithId NVARCHAR(36),
  @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  INSERT INTO [dbo].[HadithConflict] ([id],[collectionId],[citationNumber],[hadithId],[hadithVersion],[otherHadithId],[otherVersion],[facets],[detectedAt])
  SELECT CONVERT(NVARCHAR(36), NEWID()), h.collectionId, h.citationNumber, h.id, h.version, o.id, o.version, f.facets, @at
  FROM [dbo].[Hadith] h
  JOIN [dbo].[HadithBook] hb ON hb.id = h.bookId
  LEFT JOIN [dbo].[HadithChapter] hc ON hc.id = h.chapterId
  JOIN [dbo].[Hadith] o ON o.collectionId = h.collectionId AND o.citationNumber = h.citationNumber AND o.id <> h.id
  JOIN [dbo].[HadithBook] ob ON ob.id = o.bookId
  LEFT JOIN [dbo].[HadithChapter] oc ON oc.id = o.chapterId
  CROSS APPLY (SELECT STUFF(CONCAT(
      CASE WHEN CAST(o.[text] AS VARBINARY(MAX)) <> CAST(h.[text] AS VARBINARY(MAX)) OR o.textLanguage <> h.textLanguage THEN N'',text'' END,
      CASE WHEN (o.chain IS NULL AND h.chain IS NOT NULL) OR (o.chain IS NOT NULL AND h.chain IS NULL)
             OR CAST(o.chain AS VARBINARY(MAX)) <> CAST(h.chain AS VARBINARY(MAX)) OR ISNULL(o.chainLanguage, N'''') <> ISNULL(h.chainLanguage, N'''') THEN N'',chain'' END,
      CASE WHEN o.editionId = h.editionId AND (
                CAST(ob.reference AS VARBINARY(128)) <> CAST(hb.reference AS VARBINARY(128))
             OR (oc.id IS NULL AND hc.id IS NOT NULL) OR (oc.id IS NOT NULL AND hc.id IS NULL)
             OR CAST(oc.reference AS VARBINARY(128)) <> CAST(hc.reference AS VARBINARY(128))) THEN N'',structure'' END,
      CASE WHEN EXISTS (
             SELECT 1 FROM [dbo].[HadithGrading] gh
             JOIN [dbo].[HadithGrading] gx ON CAST(gx.grader AS VARBINARY(400)) = CAST(gh.grader AS VARBINARY(400))
             WHERE gh.hadithId = h.id AND gh.version = h.version AND gx.hadithId = o.id AND gx.version = o.version
               AND (CAST(gx.label AS VARBINARY(800)) <> CAST(gh.label AS VARBINARY(800)) OR gx.labelLanguage <> gh.labelLanguage)) THEN N'',grading'' END
    ), 1, 1, N'''') AS facets) f
  WHERE h.id = @hadithId AND h.citationNumber IS NOT NULL AND f.facets IS NOT NULL AND LEN(f.facets) > 0;
END;
';

EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[HadithCreateCollection]
  @id NVARCHAR(36),
  @slug NVARCHAR(120),
  @position INT,
  @actorId NVARCHAR(36),
  @sessionId NVARCHAR(36),
  @stepUpGrantId NVARCHAR(36),
  @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
  EXEC [dbo].[HadithAssertCanonicalAuthority] @actorId, @sessionId, @stepUpGrantId;
  INSERT INTO [dbo].[HadithCollection] ([id],[slug],[position],[namesVersion],[createdAt],[updatedAt])
  VALUES (@id, @slug, @position, 1, @at, @at);
  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[afterState],[authorisingSource])
  VALUES (NEWID(), N''user'', @actorId, N''hadith.collection.created'', N''hadith-collection'', @id,
          N''{"slug":"'' + STRING_ESCAPE(@slug, ''json'') + N''"}'', N''step-up:'' + @stepUpGrantId);
  COMMIT TRAN;
END;
';

EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[HadithCreateBook]
  @id NVARCHAR(36),
  @editionId NVARCHAR(36),
  @slug NVARCHAR(120),
  @reference NVARCHAR(64),
  @position INT,
  @title NVARCHAR(400),
  @titleLanguage NVARCHAR(16),
  @actorId NVARCHAR(36),
  @sessionId NVARCHAR(36),
  @stepUpGrantId NVARCHAR(36),
  @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
  EXEC [dbo].[HadithAssertCanonicalAuthority] @actorId, @sessionId, @stepUpGrantId;
  DECLARE @collectionId NVARCHAR(36) = (SELECT collectionId FROM [dbo].[HadithEdition] WHERE id = @editionId);
  IF @collectionId IS NULL THROW 51211, ''The Hadith edition is not registered.'', 1;
  INSERT INTO [dbo].[HadithBook] ([id],[collectionId],[editionId],[slug],[reference],[position],[title],[titleLanguage],[namesVersion],[createdAt],[updatedAt])
  VALUES (@id, @collectionId, @editionId, @slug, @reference, @position, @title, @titleLanguage, 1, @at, @at);
  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[afterState],[authorisingSource])
  VALUES (NEWID(), N''user'', @actorId, N''hadith.book.created'', N''hadith-book'', @id,
          N''{"edition":"'' + STRING_ESCAPE(@editionId, ''json'') + N''","slug":"'' + STRING_ESCAPE(@slug, ''json'') + N''"}'', N''step-up:'' + @stepUpGrantId);
  COMMIT TRAN;
END;
';

EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[HadithCreateChapter]
  @id NVARCHAR(36),
  @bookId NVARCHAR(36),
  @slug NVARCHAR(120),
  @reference NVARCHAR(64),
  @position INT,
  @title NVARCHAR(400),
  @titleLanguage NVARCHAR(16),
  @actorId NVARCHAR(36),
  @sessionId NVARCHAR(36),
  @stepUpGrantId NVARCHAR(36),
  @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
  EXEC [dbo].[HadithAssertCanonicalAuthority] @actorId, @sessionId, @stepUpGrantId;
  IF NOT EXISTS (SELECT 1 FROM [dbo].[HadithBook] WHERE id = @bookId) THROW 51212, ''The Hadith record does not exist.'', 1;
  INSERT INTO [dbo].[HadithChapter] ([id],[bookId],[slug],[reference],[position],[title],[titleLanguage],[namesVersion],[createdAt],[updatedAt])
  VALUES (@id, @bookId, @slug, @reference, @position, @title, @titleLanguage, 1, @at, @at);
  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[afterState],[authorisingSource])
  VALUES (NEWID(), N''user'', @actorId, N''hadith.chapter.created'', N''hadith-chapter'', @id,
          N''{"book":"'' + STRING_ESCAPE(@bookId, ''json'') + N''","slug":"'' + STRING_ESCAPE(@slug, ''json'') + N''"}'', N''step-up:'' + @stepUpGrantId);
  COMMIT TRAN;
END;
';

-- Creating or correcting a record carries the complete set of sourced facts for
-- the new version, the gradings as one JSON array, and the evidence the change
-- rests on. The gradings are accepted only if every element is well formed —
-- nothing is dropped silently.
EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[HadithWriteRecord]
  @hadithId NVARCHAR(36),
  @editionId NVARCHAR(36),
  @expectedVersion INT,
  @sourceReference NVARCHAR(64),
  @citationNumber INT,
  @bookId NVARCHAR(36),
  @chapterId NVARCHAR(36),
  @text NVARCHAR(MAX),
  @textLanguage NVARCHAR(16),
  @chain NVARCHAR(MAX),
  @chainLanguage NVARCHAR(16),
  @gradings NVARCHAR(MAX),
  @evidence NVARCHAR(400),
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
  EXEC [dbo].[HadithAssertCanonicalAuthority] @actorId, @sessionId, @stepUpGrantId;

  DECLARE @creating BIT = CASE WHEN @expectedVersion = 0 THEN 1 ELSE 0 END;
  DECLARE @collectionId NVARCHAR(36), @sourceSystemId NVARCHAR(36), @version INT, @currentCitation INT;

  IF @creating = 1
  BEGIN
    SELECT @collectionId = collectionId, @sourceSystemId = sourceSystemId FROM [dbo].[HadithEdition] WHERE id = @editionId;
    IF @collectionId IS NULL THROW 51211, ''The Hadith edition is not registered.'', 1;
    SET @version = 0;
  END
  ELSE
  BEGIN
    SELECT @collectionId = collectionId, @sourceSystemId = sourceSystemId, @version = version, @currentCitation = citationNumber
    FROM [dbo].[Hadith] WITH (UPDLOCK, HOLDLOCK) WHERE id = @hadithId AND editionId = @editionId;
    IF @version IS NULL THROW 51212, ''The Hadith record does not exist.'', 1;
    -- NO LAST WRITE WINS. A correction prepared against another version is refused.
    IF @version <> @expectedVersion THROW 51213, ''The Hadith record changed since it was reviewed.'', 1;
    -- A mapped citation keeps its record: re-pointing is the citation''s own act.
    IF ISNULL(@currentCitation, 0) <> ISNULL(@citationNumber, 0)
       AND EXISTS (SELECT 1 FROM [dbo].[HadithCitation] WHERE hadithId = @hadithId)
      THROW 51214, ''A mapped record keeps its citation.'', 1;
  END;

  -- The record sits in a structure of its OWN edition.
  IF NOT EXISTS (SELECT 1 FROM [dbo].[HadithBook] WHERE id = @bookId AND editionId = @editionId)
     OR (@chapterId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM [dbo].[HadithChapter] WHERE id = @chapterId AND bookId = @bookId))
    THROW 51215, ''The structure does not belong to the edition.'', 1;

  IF @evidence IS NULL OR LEN(@evidence) = 0 THROW 51216, ''A canonical change states its evidence.'', 1;
  IF @creating = 0 AND (@reason IS NULL OR LEN(@reason) = 0) THROW 51216, ''A correction states its reason.'', 1;
  IF ISNULL(ISJSON(@gradings), 0) <> 1 THROW 51217, ''The gradings are not well formed.'', 1;

  -- Every element is read whole and measured before it is kept: a value too
  -- long for its column is refused here, never truncated on the way in.
  DECLARE @g TABLE ([position] INT NOT NULL, [grader] NVARCHAR(200) COLLATE Latin1_General_100_BIN2 NOT NULL, [label] NVARCHAR(400) NOT NULL, [labelLanguage] NVARCHAR(16) NOT NULL, [reference] NVARCHAR(400) NOT NULL);
  INSERT INTO @g ([position],[grader],[label],[labelLanguage],[reference])
  SELECT TRY_CONVERT(INT, [key]), [grader], [label], [labelLanguage], [reference]
  FROM OPENJSON(@gradings) WITH ([grader] NVARCHAR(MAX) ''$.grader'', [label] NVARCHAR(MAX) ''$.label'', [labelLanguage] NVARCHAR(MAX) ''$.labelLanguage'', [reference] NVARCHAR(MAX) ''$.reference'', [key] NVARCHAR(MAX) ''$.position'')
  WHERE [grader] IS NOT NULL AND [label] IS NOT NULL AND [labelLanguage] IS NOT NULL AND [reference] IS NOT NULL
    AND TRY_CONVERT(INT, [key]) IS NOT NULL
    AND LEN([grader] + N''x'') <= 201 AND LEN([label] + N''x'') <= 401 AND LEN([labelLanguage] + N''x'') <= 17 AND LEN([reference] + N''x'') <= 401;
  IF (SELECT COUNT(*) FROM OPENJSON(@gradings)) <> (SELECT COUNT(*) FROM @g)
     OR (SELECT COUNT(*) FROM @g) > 32
     OR EXISTS (SELECT [position] FROM @g GROUP BY [position] HAVING COUNT(*) > 1)
    THROW 51217, ''The gradings are not well formed.'', 1;

  IF @creating = 0 AND EXISTS (
       SELECT 1 FROM [dbo].[Hadith] h
       WHERE h.id = @hadithId
         AND CAST(h.sourceReference AS VARBINARY(128)) = CAST(@sourceReference AS VARBINARY(128))
         AND ISNULL(h.citationNumber, 0) = ISNULL(@citationNumber, 0)
         AND h.bookId = @bookId AND ISNULL(h.chapterId, N'''') = ISNULL(@chapterId, N'''')
         AND CAST(h.[text] AS VARBINARY(MAX)) = CAST(@text AS VARBINARY(MAX)) AND h.textLanguage = @textLanguage
         AND ISNULL(CAST(h.chain AS VARBINARY(MAX)), 0x00) = ISNULL(CAST(@chain AS VARBINARY(MAX)), 0x00)
         AND ISNULL(h.chainLanguage, N'''') = ISNULL(@chainLanguage, N'''')
     )
     AND NOT EXISTS (
       SELECT [position], CAST([grader] AS VARBINARY(400)), CAST([label] AS VARBINARY(800)), [labelLanguage], CAST([reference] AS VARBINARY(800)) FROM @g
       EXCEPT
       SELECT [position], CAST([grader] AS VARBINARY(400)), CAST([label] AS VARBINARY(800)), [labelLanguage], CAST([reference] AS VARBINARY(800)) FROM [dbo].[HadithGrading] WHERE hadithId = @hadithId AND version = @version
     )
     AND NOT EXISTS (
       SELECT [position], CAST([grader] AS VARBINARY(400)), CAST([label] AS VARBINARY(800)), [labelLanguage], CAST([reference] AS VARBINARY(800)) FROM [dbo].[HadithGrading] WHERE hadithId = @hadithId AND version = @version
       EXCEPT
       SELECT [position], CAST([grader] AS VARBINARY(400)), CAST([label] AS VARBINARY(800)), [labelLanguage], CAST([reference] AS VARBINARY(800)) FROM @g
     )
    THROW 51218, ''The correction changes nothing.'', 1;

  IF @creating = 1
    INSERT INTO [dbo].[Hadith] ([id],[collectionId],[sourceSystemId],[editionId],[sourceReference],[citationNumber],[bookId],[chapterId],[text],[textLanguage],[chain],[chainLanguage],[version],[createdAt],[updatedAt])
    VALUES (@hadithId, @collectionId, @sourceSystemId, @editionId, @sourceReference, @citationNumber, @bookId, @chapterId, @text, @textLanguage, @chain, @chainLanguage, 1, @at, @at);

  INSERT INTO [dbo].[HadithRevision] ([hadithId],[version],[operation],[sourceReference],[citationNumber],[bookId],[chapterId],[text],[textLanguage],[chain],[chainLanguage],[evidence],[reason],[actorId],[stepUpGrantId],[createdAt])
  VALUES (@hadithId, @version + 1, CASE WHEN @creating = 1 THEN N''created'' ELSE N''corrected'' END, @sourceReference, @citationNumber, @bookId, @chapterId, @text, @textLanguage, @chain, @chainLanguage, @evidence, CASE WHEN @creating = 1 THEN NULL ELSE @reason END, @actorId, @stepUpGrantId, @at);

  INSERT INTO [dbo].[HadithGrading] ([hadithId],[version],[position],[grader],[label],[labelLanguage],[reference],[createdAt])
  SELECT @hadithId, @version + 1, [position], [grader], [label], [labelLanguage], [reference], @at FROM @g;

  IF @creating = 0
    UPDATE [dbo].[Hadith]
    SET sourceReference = @sourceReference, citationNumber = @citationNumber, bookId = @bookId, chapterId = @chapterId,
        [text] = @text, textLanguage = @textLanguage, chain = @chain, chainLanguage = @chainLanguage,
        version = @version + 1, updatedAt = @at
    WHERE id = @hadithId;

  EXEC [dbo].[HadithDetectConflicts] @hadithId, @at;

  INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId])
  SELECT N''hadith'', c.id FROM [dbo].[HadithCitation] c
  WHERE c.collectionId = @collectionId AND c.number IN (ISNULL(@citationNumber, 0), ISNULL(@currentCitation, 0));

  -- WHICH record, WHICH versions, WHICH evidence — never the text, chain or
  -- grading, which are held as the domain''s own revision records
  -- (SECURITY_BASELINE.md 13.4).
  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[beforeState],[afterState],[authorisingSource])
  VALUES (NEWID(), N''user'', @actorId,
          CASE WHEN @creating = 1 THEN N''hadith.record.created'' ELSE N''hadith.record.corrected'' END,
          N''hadith-record'', @hadithId,
          CASE WHEN @creating = 1 THEN NULL ELSE N''{"version":"'' + CONVERT(NVARCHAR(16), @version) + N''"}'' END,
          N''{"version":"'' + CONVERT(NVARCHAR(16), @version + 1) + N''","edition":"'' + STRING_ESCAPE(@editionId, ''json'') + N''","gradings":"''
            + CONVERT(NVARCHAR(16), (SELECT COUNT(*) FROM @g)) + N''","conflicts":"''
            + CONVERT(NVARCHAR(16), (SELECT COUNT(*) FROM [dbo].[HadithConflict] WHERE hadithId = @hadithId AND hadithVersion = @version + 1)) + N''"}'',
          N''step-up:'' + @stepUpGrantId);

  COMMIT TRAN;
END;
';

-- Human verification binds ONE version: the one the verifier reviewed.
EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[HadithVerifyRecord]
  @id NVARCHAR(36),
  @hadithId NVARCHAR(36),
  @expectedVersion INT,
  @evidence NVARCHAR(400),
  @actorId NVARCHAR(36),
  @sessionId NVARCHAR(36),
  @stepUpGrantId NVARCHAR(36),
  @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;
  BEGIN TRAN;
  EXEC [dbo].[HadithAssertCanonicalAuthority] @actorId, @sessionId, @stepUpGrantId;
  DECLARE @version INT, @collectionId NVARCHAR(36), @citationNumber INT;
  SELECT @version = version, @collectionId = collectionId, @citationNumber = citationNumber
  FROM [dbo].[Hadith] WITH (UPDLOCK, HOLDLOCK) WHERE id = @hadithId;
  IF @version IS NULL THROW 51212, ''The Hadith record does not exist.'', 1;
  IF @version <> @expectedVersion THROW 51213, ''The Hadith record changed since it was reviewed.'', 1;
  IF @evidence IS NULL OR LEN(@evidence) = 0 THROW 51216, ''A canonical change states its evidence.'', 1;
  IF EXISTS (SELECT 1 FROM [dbo].[HadithVerification] WHERE hadithId = @hadithId AND version = @version)
    THROW 51218, ''The correction changes nothing.'', 1;
  INSERT INTO [dbo].[HadithVerification] ([id],[hadithId],[version],[evidence],[actorId],[stepUpGrantId],[createdAt])
  VALUES (@id, @hadithId, @version, @evidence, @actorId, @stepUpGrantId, @at);
  INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId])
  SELECT N''hadith'', c.id FROM [dbo].[HadithCitation] c WHERE c.collectionId = @collectionId AND c.number = @citationNumber;
  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[afterState],[authorisingSource])
  VALUES (NEWID(), N''user'', @actorId, N''hadith.record.verified'', N''hadith-record'', @hadithId,
          N''{"version":"'' + CONVERT(NVARCHAR(16), @version) + N''","verification":"'' + STRING_ESCAPE(@id, ''json'') + N''"}'', N''step-up:'' + @stepUpGrantId);
  COMMIT TRAN;
END;
';

-- The reviewed mapping of a public citation to ONE candidate. Mapping needs a
-- candidate verified at its current version and a citation free of conflict
-- evidence; withdrawal is always possible. `@expectedVersion` 0 creates.
EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[HadithSetCitation]
  @id NVARCHAR(36),
  @collectionId NVARCHAR(36),
  @number INT,
  @hadithId NVARCHAR(36),
  @state NVARCHAR(16),
  @expectedVersion INT,
  @evidence NVARCHAR(400),
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
  EXEC [dbo].[HadithAssertCanonicalAuthority] @actorId, @sessionId, @stepUpGrantId;

  DECLARE @version INT, @citationId NVARCHAR(36), @currentHadith NVARCHAR(36), @currentState NVARCHAR(16);
  SELECT @version = version, @citationId = id, @currentHadith = hadithId, @currentState = [state]
  FROM [dbo].[HadithCitation] WITH (UPDLOCK, HOLDLOCK) WHERE collectionId = @collectionId AND number = @number;

  IF ISNULL(@version, 0) <> @expectedVersion THROW 51213, ''The Hadith record changed since it was reviewed.'', 1;
  IF @evidence IS NULL OR LEN(@evidence) = 0 THROW 51216, ''A canonical change states its evidence.'', 1;
  IF @version IS NOT NULL AND (@reason IS NULL OR LEN(@reason) = 0) THROW 51216, ''A correction states its reason.'', 1;
  IF @version IS NOT NULL AND @currentHadith = @hadithId AND @currentState = @state THROW 51218, ''The correction changes nothing.'', 1;
  IF @version IS NULL AND @state <> N''mapped'' THROW 51216, ''A new citation is mapped.'', 1;

  DECLARE @target INT = (SELECT version FROM [dbo].[Hadith] WITH (UPDLOCK, HOLDLOCK) WHERE id = @hadithId AND collectionId = @collectionId AND citationNumber = @number);
  IF @target IS NULL THROW 51220, ''The record is not a candidate for this citation.'', 1;

  IF @state = N''mapped''
  BEGIN
    IF EXISTS (SELECT 1 FROM [dbo].[HadithConflict] WHERE collectionId = @collectionId AND citationNumber = @number)
      THROW 51204, ''A conflicted citation cannot be mapped.'', 1;
    IF NOT EXISTS (SELECT 1 FROM [dbo].[HadithVerification] WHERE hadithId = @hadithId AND version = @target)
      THROW 51219, ''The record is not verified at its current version.'', 1;
  END;

  IF @version IS NULL
  BEGIN
    SET @citationId = @id;
    INSERT INTO [dbo].[HadithCitation] ([collectionId],[number],[id],[hadithId],[state],[version],[createdAt],[updatedAt])
    VALUES (@collectionId, @number, @citationId, @hadithId, @state, 1, @at, @at);
    INSERT INTO [dbo].[HadithCitationRevision] ([collectionId],[number],[version],[hadithId],[state],[evidence],[reason],[actorId],[stepUpGrantId],[createdAt])
    VALUES (@collectionId, @number, 1, @hadithId, @state, @evidence, NULL, @actorId, @stepUpGrantId, @at);
  END
  ELSE
  BEGIN
    INSERT INTO [dbo].[HadithCitationRevision] ([collectionId],[number],[version],[hadithId],[state],[evidence],[reason],[actorId],[stepUpGrantId],[createdAt])
    VALUES (@collectionId, @number, @version + 1, @hadithId, @state, @evidence, @reason, @actorId, @stepUpGrantId, @at);
    UPDATE [dbo].[HadithCitation] SET hadithId = @hadithId, [state] = @state, version = @version + 1, updatedAt = @at
    WHERE collectionId = @collectionId AND number = @number;
  END;

  INSERT INTO [dbo].[SearchIndexRequest] ([scopeKind],[scopeId]) VALUES (N''hadith'', @citationId);

  INSERT INTO [dbo].[AuditLog] ([id],[actorType],[actorId],[action],[targetType],[targetId],[beforeState],[afterState],[authorisingSource])
  VALUES (NEWID(), N''user'', @actorId, N''hadith.citation.set'', N''hadith-citation'', @citationId,
          CASE WHEN @version IS NULL THEN NULL ELSE N''{"version":"'' + CONVERT(NVARCHAR(16), @version) + N''","record":"'' + STRING_ESCAPE(@currentHadith, ''json'') + N''","state":"'' + STRING_ESCAPE(@currentState, ''json'') + N''"}'' END,
          N''{"version":"'' + CONVERT(NVARCHAR(16), ISNULL(@version, 0) + 1) + N''","record":"'' + STRING_ESCAPE(@hadithId, ''json'') + N''","state":"'' + STRING_ESCAPE(@state, ''json'') + N''"}'',
          N''step-up:'' + @stepUpGrantId);
  COMMIT TRAN;
END;
';

-- ===========================================================================
-- SEARCH — the `hadith` kind, one scope per public citation
-- ===========================================================================
ALTER TABLE [dbo].[SearchIndexRequest] DROP CONSTRAINT [SearchIndexRequest_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexRequest] ADD CONSTRAINT [SearchIndexRequest_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah',N'hadith'));
ALTER TABLE [dbo].[SearchIndexScope] DROP CONSTRAINT [SearchIndexScope_scopeKind_ck];
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah',N'hadith'));
ALTER TABLE [dbo].[SearchDocument] DROP CONSTRAINT [SearchDocument_kind_ck];
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_kind_ck] CHECK ([kind] IN (N'topic',N'person',N'article',N'page',N'work',N'edition',N'book-translation',N'research',N'research-paper',N'publication',N'magazine',N'magazine-issue',N'encyclopedia',N'video',N'audio',N'news-article',N'press-release',N'statement',N'media-coverage',N'quran-ayah',N'hadith'));

-- ===========================================================================
-- PERMISSIONS
-- ===========================================================================

INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'hadith.read', N'View Hadith administration: records and their history, sources and editions, verification, citation mapping, conflict evidence and draft layered records.'),
    (N'hadith.administer', N'Manage Hadith translations, commentary, sciences study material, display names and record topics. Never canonical records, gradings, chains or citations.'),
    (N'hadith.editCanonical', N'Create Hadith structure and source-qualified records, correct their sourced text, chain and gradings, verify them and map public citations, with step-up.')
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

DECLARE @hadithAdminRoleId NVARCHAR(36);
DECLARE @hadithAddedKeys NVARCHAR(200);

SELECT @hadithAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @hadithAdminRoleId IS NOT NULL
BEGIN
    SELECT @hadithAddedKeys = STRING_AGG(p.[key], N' ') WITHIN GROUP (ORDER BY p.[key])
    FROM [dbo].[Permission] p
    WHERE p.[key] IN (N'hadith.read', N'hadith.administer', N'hadith.editCanonical')
      AND NOT EXISTS (
          SELECT 1 FROM [dbo].[RolePermission] rp
          WHERE rp.[roleId] = @hadithAdminRoleId AND rp.[permissionKey] = p.[key]
      );

    IF @hadithAddedKeys IS NOT NULL AND LEN(@hadithAddedKeys) > 0
    BEGIN
        INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
        SELECT @hadithAdminRoleId, p.[key]
        FROM [dbo].[Permission] p
        WHERE p.[key] IN (N'hadith.read', N'hadith.administer', N'hadith.editCanonical')
          AND NOT EXISTS (
              SELECT 1 FROM [dbo].[RolePermission] rp
              WHERE rp.[roleId] = @hadithAdminRoleId AND rp.[permissionKey] = p.[key]
          );

        -- Grants before sessions, so the count each statement reports is the
        -- one it actually removed rather than whatever a cascade took first.
        DELETE FROM [dbo].[StepUpGrant]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @hadithAdminRoleId AND ra.[revokedAt] IS NULL
        );

        DELETE FROM [dbo].[Session]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @hadithAdminRoleId AND ra.[revokedAt] IS NULL
        );

        -- WHICH KEYS WERE ADDED, and nothing else (SECURITY_BASELINE.md 13.4).
        INSERT INTO [dbo].[AuditLog]
            ([id], [actorType], [actorId], [action], [targetType], [targetId],
             [afterState], [authorisingSource])
        VALUES
            (NEWID(), N'migration', NULL, N'hadith.permissions.provisioned', N'role',
             @hadithAdminRoleId,
             N'{"added":"' + @hadithAddedKeys + N'"}',
             N'20261003000000_phase19_hadith');
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
