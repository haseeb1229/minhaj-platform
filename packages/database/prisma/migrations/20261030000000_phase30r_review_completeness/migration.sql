-- ===========================================================================
-- Phase 30 — Stage-1A review completeness (operational macro "30-R")
-- ===========================================================================
--
-- AN OWNER PRODUCT DECISION, NOT A NEW PHASE (OPEN_DECISIONS.md §3.7). The
-- pre-adoption review build carries real first-party visuals and the
-- historical dates its sources state. Every change below is a typed,
-- referentially safe relation or a closed vocabulary; nothing is a remote URL
-- and nothing is a generic target pair.
--
-- OPTIONAL VISUALS, EACH AN APPLICATION-OWNED STORED ASSET. A lead image on an
-- Article, NewsArticle, PressRelease or Page REVISION (so changing it is an
-- ordinary reviewed edit), a portrait on a Person, a cover on an Edition and on
-- a MagazineIssue, and a poster on a Video. Each is one NO ACTION foreign key
-- to [Asset] with the image's measured dimensions, so a page reserves its box
-- and never shifts; the alternative text of a lead image is per translation.
-- The bytes are served only through the owning domain's own route and policy.
--
-- SOURCE CHRONOLOGY. Article, NewsArticle and PressRelease revisions record
-- the ORIGINAL publication date their source states, and each root keeps
-- `chronologyAt`: the reader-facing date, set by the workflow at publication
-- to that source date when there is one and to the platform's own first
-- publication otherwise. `publishedAt` stays the workflow fact it always was.
--
-- MIGRATION. Four more kinds — `editorial.page`, `editorial.press-release`
-- (publishable through Editorial's own workflow), `people.person` (People) and
-- `global.country` (Global Network) — each with its typed target column. A
-- manifest entry is a `create` or a `refresh`: a refresh carries a newer
-- approved revision of an already-published record into its existing target
-- through the owning domain, makes no new legacy mapping, and is never rolled
-- back by migration (MIGRATION_STRATEGY.md §7.2). A source host is a `page`
-- host or an `asset` host — an exact, first-party host the source's own pages
-- name for their images, fetched only as an asset. An acquired image keeps its
-- evidence bytes AND records the metadata-stripped public copy Storage made
-- of them, with that copy's checksum and dimensions.
--
-- REFUSALS: 51379/51380 extended; no new number.
--
-- POSTURES FOR THE APPLICATION PRINCIPAL (grant-application-principal.sql):
--   the new legacy-mapping target columns and the acquisition's public-copy
--   columns join the columns it may never UPDATE.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.
-- ===========================================================================

BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- Editorial — lead image and source chronology
-- ===========================================================================
ALTER TABLE [dbo].[ArticleRevision] ADD
    [sourcePublishedOn] DATE,
    [leadAssetId] NVARCHAR(36),
    [leadWidth] INT,
    [leadHeight] INT,
    [leadCredit] NVARCHAR(200);
ALTER TABLE [dbo].[NewsArticleRevision] ADD
    [sourcePublishedOn] DATE,
    [leadAssetId] NVARCHAR(36),
    [leadWidth] INT,
    [leadHeight] INT,
    [leadCredit] NVARCHAR(200);
ALTER TABLE [dbo].[PressReleaseRevision] ADD
    [sourcePublishedOn] DATE,
    [leadAssetId] NVARCHAR(36),
    [leadWidth] INT,
    [leadHeight] INT,
    [leadCredit] NVARCHAR(200);
ALTER TABLE [dbo].[PageRevision] ADD
    [leadAssetId] NVARCHAR(36),
    [leadWidth] INT,
    [leadHeight] INT,
    [leadCredit] NVARCHAR(200);

ALTER TABLE [dbo].[ArticleRevisionTranslation] ADD [leadAlt] NVARCHAR(300) NOT NULL CONSTRAINT [ArticleRevisionTranslation_leadAlt_df] DEFAULT N'';
ALTER TABLE [dbo].[NewsArticleRevisionTranslation] ADD [leadAlt] NVARCHAR(300) NOT NULL CONSTRAINT [NewsArticleRevisionTranslation_leadAlt_df] DEFAULT N'';
ALTER TABLE [dbo].[PressReleaseRevisionTranslation] ADD [leadAlt] NVARCHAR(300) NOT NULL CONSTRAINT [PressReleaseRevisionTranslation_leadAlt_df] DEFAULT N'';
ALTER TABLE [dbo].[PageRevisionTranslation] ADD [leadAlt] NVARCHAR(300) NOT NULL CONSTRAINT [PageRevisionTranslation_leadAlt_df] DEFAULT N'';

ALTER TABLE [dbo].[Article] ADD [chronologyAt] DATETIME2;
ALTER TABLE [dbo].[NewsArticle] ADD [chronologyAt] DATETIME2;
ALTER TABLE [dbo].[PressRelease] ADD [chronologyAt] DATETIME2;

ALTER TABLE [dbo].[ArticleRevision] ADD CONSTRAINT [ArticleRevision_leadAssetId_fkey] FOREIGN KEY ([leadAssetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[NewsArticleRevision] ADD CONSTRAINT [NewsArticleRevision_leadAssetId_fkey] FOREIGN KEY ([leadAssetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[PressReleaseRevision] ADD CONSTRAINT [PressReleaseRevision_leadAssetId_fkey] FOREIGN KEY ([leadAssetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[PageRevision] ADD CONSTRAINT [PageRevision_leadAssetId_fkey] FOREIGN KEY ([leadAssetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- A lead image is an asset WITH its measured box, or nothing at all; a credit
-- only ever accompanies an image.
EXEC(N'ALTER TABLE [dbo].[ArticleRevision] ADD CONSTRAINT [ArticleRevision_lead_ck] CHECK (
    (CASE WHEN [leadAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [leadWidth] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [leadAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [leadHeight] IS NULL THEN 1 ELSE 0 END)
    AND ([leadAssetId] IS NOT NULL OR [leadCredit] IS NULL)
    AND ([leadWidth] IS NULL OR [leadWidth] BETWEEN 1 AND 16384)
    AND ([leadHeight] IS NULL OR [leadHeight] BETWEEN 1 AND 16384)
    AND ([leadCredit] IS NULL OR LEN([leadCredit]) BETWEEN 1 AND 200)
);');
EXEC(N'ALTER TABLE [dbo].[NewsArticleRevision] ADD CONSTRAINT [NewsArticleRevision_lead_ck] CHECK (
    (CASE WHEN [leadAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [leadWidth] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [leadAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [leadHeight] IS NULL THEN 1 ELSE 0 END)
    AND ([leadAssetId] IS NOT NULL OR [leadCredit] IS NULL)
    AND ([leadWidth] IS NULL OR [leadWidth] BETWEEN 1 AND 16384)
    AND ([leadHeight] IS NULL OR [leadHeight] BETWEEN 1 AND 16384)
    AND ([leadCredit] IS NULL OR LEN([leadCredit]) BETWEEN 1 AND 200)
);');
EXEC(N'ALTER TABLE [dbo].[PressReleaseRevision] ADD CONSTRAINT [PressReleaseRevision_lead_ck] CHECK (
    (CASE WHEN [leadAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [leadWidth] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [leadAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [leadHeight] IS NULL THEN 1 ELSE 0 END)
    AND ([leadAssetId] IS NOT NULL OR [leadCredit] IS NULL)
    AND ([leadWidth] IS NULL OR [leadWidth] BETWEEN 1 AND 16384)
    AND ([leadHeight] IS NULL OR [leadHeight] BETWEEN 1 AND 16384)
    AND ([leadCredit] IS NULL OR LEN([leadCredit]) BETWEEN 1 AND 200)
);');
EXEC(N'ALTER TABLE [dbo].[PageRevision] ADD CONSTRAINT [PageRevision_lead_ck] CHECK (
    (CASE WHEN [leadAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [leadWidth] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [leadAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [leadHeight] IS NULL THEN 1 ELSE 0 END)
    AND ([leadAssetId] IS NOT NULL OR [leadCredit] IS NULL)
    AND ([leadWidth] IS NULL OR [leadWidth] BETWEEN 1 AND 16384)
    AND ([leadHeight] IS NULL OR [leadHeight] BETWEEN 1 AND 16384)
    AND ([leadCredit] IS NULL OR LEN([leadCredit]) BETWEEN 1 AND 200)
);');

-- The reader-facing date exists exactly when the platform has published the
-- record. Every record published before this migration had no source date
-- recorded, so its chronology IS its first publication: a backfill of a fact,
-- not an operator act.
EXEC(N'UPDATE [dbo].[Article] SET [chronologyAt] = [publishedAt] WHERE [publishedAt] IS NOT NULL;');
EXEC(N'UPDATE [dbo].[NewsArticle] SET [chronologyAt] = [publishedAt] WHERE [publishedAt] IS NOT NULL;');
EXEC(N'UPDATE [dbo].[PressRelease] SET [chronologyAt] = [publishedAt] WHERE [publishedAt] IS NOT NULL;');
EXEC(N'ALTER TABLE [dbo].[Article] ADD CONSTRAINT [Article_chronology_ck] CHECK ((CASE WHEN [publishedAt] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [chronologyAt] IS NULL THEN 1 ELSE 0 END));');
EXEC(N'ALTER TABLE [dbo].[NewsArticle] ADD CONSTRAINT [NewsArticle_chronology_ck] CHECK ((CASE WHEN [publishedAt] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [chronologyAt] IS NULL THEN 1 ELSE 0 END));');
EXEC(N'ALTER TABLE [dbo].[PressRelease] ADD CONSTRAINT [PressRelease_chronology_ck] CHECK ((CASE WHEN [publishedAt] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [chronologyAt] IS NULL THEN 1 ELSE 0 END));');

EXEC(N'CREATE NONCLUSTERED INDEX [Article_state_chronologyAt_id_idx] ON [dbo].[Article]([state], [chronologyAt] DESC, [id]);');
EXEC(N'CREATE NONCLUSTERED INDEX [NewsArticle_state_chronologyAt_id_idx] ON [dbo].[NewsArticle]([state], [chronologyAt] DESC, [id]);');
EXEC(N'CREATE NONCLUSTERED INDEX [PressRelease_state_chronologyAt_id_idx] ON [dbo].[PressRelease]([state], [chronologyAt] DESC, [id]);');

-- ===========================================================================
-- People, Library, Media — portrait, covers, poster
-- ===========================================================================
ALTER TABLE [dbo].[Person] ADD [portraitAssetId] NVARCHAR(36), [portraitWidth] INT, [portraitHeight] INT, [portraitCredit] NVARCHAR(200);
ALTER TABLE [dbo].[Edition] ADD [coverAssetId] NVARCHAR(36), [coverWidth] INT, [coverHeight] INT;
ALTER TABLE [dbo].[MagazineIssue] ADD [coverAssetId] NVARCHAR(36), [coverWidth] INT, [coverHeight] INT;
ALTER TABLE [dbo].[Video] ADD [posterAssetId] NVARCHAR(36), [posterWidth] INT, [posterHeight] INT;

ALTER TABLE [dbo].[Person] ADD CONSTRAINT [Person_portraitAssetId_fkey] FOREIGN KEY ([portraitAssetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Edition] ADD CONSTRAINT [Edition_coverAssetId_fkey] FOREIGN KEY ([coverAssetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MagazineIssue] ADD CONSTRAINT [MagazineIssue_coverAssetId_fkey] FOREIGN KEY ([coverAssetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Video] ADD CONSTRAINT [Video_posterAssetId_fkey] FOREIGN KEY ([posterAssetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

EXEC(N'ALTER TABLE [dbo].[Person] ADD CONSTRAINT [Person_portrait_ck] CHECK (
    (CASE WHEN [portraitAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [portraitWidth] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [portraitAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [portraitHeight] IS NULL THEN 1 ELSE 0 END)
    AND ([portraitAssetId] IS NOT NULL OR [portraitCredit] IS NULL)
    AND ([portraitWidth] IS NULL OR [portraitWidth] BETWEEN 1 AND 16384)
    AND ([portraitHeight] IS NULL OR [portraitHeight] BETWEEN 1 AND 16384)
    AND ([portraitCredit] IS NULL OR LEN([portraitCredit]) BETWEEN 1 AND 200)
);');
EXEC(N'ALTER TABLE [dbo].[Edition] ADD CONSTRAINT [Edition_cover_ck] CHECK (
    (CASE WHEN [coverAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [coverWidth] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [coverAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [coverHeight] IS NULL THEN 1 ELSE 0 END)
    AND ([coverWidth] IS NULL OR [coverWidth] BETWEEN 1 AND 16384)
    AND ([coverHeight] IS NULL OR [coverHeight] BETWEEN 1 AND 16384)
);');
EXEC(N'ALTER TABLE [dbo].[MagazineIssue] ADD CONSTRAINT [MagazineIssue_cover_ck] CHECK (
    (CASE WHEN [coverAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [coverWidth] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [coverAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [coverHeight] IS NULL THEN 1 ELSE 0 END)
    AND ([coverWidth] IS NULL OR [coverWidth] BETWEEN 1 AND 16384)
    AND ([coverHeight] IS NULL OR [coverHeight] BETWEEN 1 AND 16384)
);');
EXEC(N'ALTER TABLE [dbo].[Video] ADD CONSTRAINT [Video_poster_ck] CHECK (
    (CASE WHEN [posterAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [posterWidth] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [posterAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [posterHeight] IS NULL THEN 1 ELSE 0 END)
    AND ([posterWidth] IS NULL OR [posterWidth] BETWEEN 1 AND 16384)
    AND ([posterHeight] IS NULL OR [posterHeight] BETWEEN 1 AND 16384)
);');

-- ===========================================================================
-- Migration — hosts, acquisitions, entries, targets
-- ===========================================================================

-- A host is a PAGE host (discovery, items, links) or an ASSET host (images
-- the source's own pages name). Every existing host is a page host.
ALTER TABLE [dbo].[MigrationSourceHost] ADD [role] NVARCHAR(8) NOT NULL CONSTRAINT [MigrationSourceHost_role_df] DEFAULT N'page';
EXEC(N'ALTER TABLE [dbo].[MigrationSourceHost] ADD CONSTRAINT [MigrationSourceHost_role_ck] CHECK ([role] IN (N''page'', N''asset''));');

-- An acquired image's public copy: the metadata-stripped bytes Storage made of
-- the evidence, their own checksum and measured box — all of it, or none.
ALTER TABLE [dbo].[MigrationAssetProvenance] ADD
    [publicAssetId] NVARCHAR(36),
    [publicChecksum] NVARCHAR(64),
    [width] INT,
    [height] INT;
ALTER TABLE [dbo].[MigrationAssetProvenance] ADD CONSTRAINT [MigrationAssetProvenance_publicAssetId_fkey] FOREIGN KEY ([publicAssetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
EXEC(N'ALTER TABLE [dbo].[MigrationAssetProvenance] ADD CONSTRAINT [MigrationAssetProvenance_public_ck] CHECK (
    (CASE WHEN [publicAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [publicChecksum] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [publicAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [width] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [publicAssetId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [height] IS NULL THEN 1 ELSE 0 END)
    AND ([publicChecksum] IS NULL OR (LEN([publicChecksum]) = 64 AND [publicChecksum] COLLATE Latin1_General_BIN2 NOT LIKE N''%[^0-9a-f]%''))
    AND ([width] IS NULL OR [width] BETWEEN 1 AND 16384)
    AND ([height] IS NULL OR [height] BETWEEN 1 AND 16384)
);');

ALTER TABLE [dbo].[MigrationManifestEntry] ADD
    [pageId] NVARCHAR(36),
    [pressReleaseId] NVARCHAR(36),
    [personId] NVARCHAR(36),
    [countryId] NVARCHAR(36),
    [mode] NVARCHAR(8) NOT NULL CONSTRAINT [MigrationManifestEntry_mode_df] DEFAULT N'create';
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD
    [pageId] NVARCHAR(36),
    [pressReleaseId] NVARCHAR(36),
    [personId] NVARCHAR(36),
    [countryId] NVARCHAR(36);

ALTER TABLE [dbo].[MigrationManifestEntry] ADD CONSTRAINT [MigrationManifestEntry_pageId_fkey] FOREIGN KEY ([pageId]) REFERENCES [dbo].[Page]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationManifestEntry] ADD CONSTRAINT [MigrationManifestEntry_pressReleaseId_fkey] FOREIGN KEY ([pressReleaseId]) REFERENCES [dbo].[PressRelease]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationManifestEntry] ADD CONSTRAINT [MigrationManifestEntry_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationManifestEntry] ADD CONSTRAINT [MigrationManifestEntry_countryId_fkey] FOREIGN KEY ([countryId]) REFERENCES [dbo].[Country]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_pageId_fkey] FOREIGN KEY ([pageId]) REFERENCES [dbo].[Page]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_pressReleaseId_fkey] FOREIGN KEY ([pressReleaseId]) REFERENCES [dbo].[PressRelease]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_countryId_fkey] FOREIGN KEY ([countryId]) REFERENCES [dbo].[Country]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE [dbo].[MigrationSource] DROP CONSTRAINT [MigrationSource_ck];
ALTER TABLE [dbo].[MigrationRecord] DROP CONSTRAINT [MigrationRecord_ck];
ALTER TABLE [dbo].[MigrationStagedRecord] DROP CONSTRAINT [MigrationStagedRecord_ck];
ALTER TABLE [dbo].[MigrationLegacyMapping] DROP CONSTRAINT [MigrationLegacyMapping_ck];
ALTER TABLE [dbo].[MigrationManifestEntry] DROP CONSTRAINT [MigrationManifestEntry_ck];

EXEC(N'ALTER TABLE [dbo].[MigrationSource] ADD CONSTRAINT [MigrationSource_ck] CHECK (
    [key] COLLATE Latin1_General_BIN2 NOT LIKE N''%[^-a-z0-9]%'' AND LEN([key]) BETWEEN 3 AND 64
    AND LEN([name]) BETWEEN 1 AND 200
    AND [authorityKind] IN (N''fixture'', N''authorised'')
    AND [accessMethod] IN (N''http'', N''export'')
    AND [contentKind] IN (N''media.video'', N''library.work'', N''library.magazine'', N''library.magazine-issue'', N''editorial.news'', N''editorial.article'', N''editorial.press-release'', N''editorial.page'', N''people.person'', N''global.country'', N''fatwa.ruling'', N''quran.translation'')
    AND [state] IN (N''active'', N''inactive'')
    AND [minIntervalMs] BETWEEN 0 AND 600000
    AND [maxConcurrency] BETWEEN 1 AND 4
    AND [maxAttempts] BETWEEN 1 AND 6
    AND [timeoutMs] BETWEEN 1000 AND 60000
    AND [maxBodyBytes] BETWEEN 1024 AND 8388608
    AND [maxRedirects] BETWEEN 0 AND 5
    AND [version] >= 1
    AND (([accessMethod] = N''http'' AND [baseUrl] IS NOT NULL)
         OR ([accessMethod] = N''export'' AND [baseUrl] IS NULL))
    AND (([authorityKind] = N''fixture'' AND [authorisationReference] IS NULL AND [authorisedOn] IS NULL
          AND ([baseUrl] IS NULL
               OR ([baseUrl] COLLATE Latin1_General_BIN2 LIKE N''http://%''
                   AND (CASE WHEN CHARINDEX(N''/'', [baseUrl], 8) > 8 THEN SUBSTRING([baseUrl], 8, CHARINDEX(N''/'', [baseUrl], 8) - 8) ELSE N'''' END) COLLATE Latin1_General_BIN2 LIKE N''%_.fixture.invalid''
                   AND (CASE WHEN CHARINDEX(N''/'', [baseUrl], 8) > 8 THEN SUBSTRING([baseUrl], 8, CHARINDEX(N''/'', [baseUrl], 8) - 8) ELSE N'''' END) COLLATE Latin1_General_BIN2 NOT LIKE N''%[^-a-z0-9.]%'')
               OR ([baseUrl] COLLATE Latin1_General_BIN2 LIKE N''https://%''
                   AND (CASE WHEN CHARINDEX(N''/'', [baseUrl], 9) > 9 THEN SUBSTRING([baseUrl], 9, CHARINDEX(N''/'', [baseUrl], 9) - 9) ELSE N'''' END) COLLATE Latin1_General_BIN2 LIKE N''%_.fixture.invalid''
                   AND (CASE WHEN CHARINDEX(N''/'', [baseUrl], 9) > 9 THEN SUBSTRING([baseUrl], 9, CHARINDEX(N''/'', [baseUrl], 9) - 9) ELSE N'''' END) COLLATE Latin1_General_BIN2 NOT LIKE N''%[^-a-z0-9.]%'')))
         OR ([authorityKind] = N''authorised'' AND [authorisationReference] IS NOT NULL AND [authorisedOn] IS NOT NULL
             AND [minIntervalMs] >= 1000 AND [maxConcurrency] = 1
             AND ([baseUrl] IS NULL
                  OR ([baseUrl] COLLATE Latin1_General_BIN2 LIKE N''https://%''
                      AND (CASE WHEN CHARINDEX(N''/'', [baseUrl], 9) > 9 THEN SUBSTRING([baseUrl], 9, CHARINDEX(N''/'', [baseUrl], 9) - 9) ELSE N'''' END) COLLATE Latin1_General_BIN2 NOT LIKE N''%[^-a-z0-9.]%''
                      AND (CASE WHEN CHARINDEX(N''/'', [baseUrl], 9) > 9 THEN SUBSTRING([baseUrl], 9, CHARINDEX(N''/'', [baseUrl], 9) - 9) ELSE N'''' END) COLLATE Latin1_General_BIN2 LIKE N''%_.%''
                      AND (CASE WHEN CHARINDEX(N''/'', [baseUrl], 9) > 9 THEN SUBSTRING([baseUrl], 9, CHARINDEX(N''/'', [baseUrl], 9) - 9) ELSE N'''' END) COLLATE Latin1_General_BIN2 NOT LIKE N''.%''
                      AND (CASE WHEN CHARINDEX(N''/'', [baseUrl], 9) > 9 THEN SUBSTRING([baseUrl], 9, CHARINDEX(N''/'', [baseUrl], 9) - 9) ELSE N'''' END) COLLATE Latin1_General_BIN2 NOT LIKE N''%.''
                      AND (CASE WHEN CHARINDEX(N''/'', [baseUrl], 9) > 9 THEN SUBSTRING([baseUrl], 9, CHARINDEX(N''/'', [baseUrl], 9) - 9) ELSE N'''' END) COLLATE Latin1_General_BIN2 NOT LIKE N''%..%''
                      AND (CASE WHEN CHARINDEX(N''/'', [baseUrl], 9) > 9 THEN SUBSTRING([baseUrl], 9, CHARINDEX(N''/'', [baseUrl], 9) - 9) ELSE N'''' END) COLLATE Latin1_General_BIN2 NOT LIKE N''%.invalid''))))
);');

EXEC(N'ALTER TABLE [dbo].[MigrationRecord] ADD CONSTRAINT [MigrationRecord_ck] CHECK (
    [contentKind] IN (N''media.video'', N''library.work'', N''library.magazine'', N''library.magazine-issue'', N''editorial.news'', N''editorial.article'', N''editorial.press-release'', N''editorial.page'', N''people.person'', N''global.country'', N''fatwa.ruling'', N''quran.translation'')
    AND [status] IN (N''discovered'', N''fetched'', N''staged'', N''rejected'', N''errored'', N''excluded'', N''approved'', N''published'', N''merged'')
    AND [observed] IN (N''present'', N''missing'')
    AND ([disappearance] IS NULL OR [disappearance] IN (N''withdrawn'', N''moved'', N''source-error'', N''transient-failure'', N''access-failure'', N''unresolved''))
    AND ([observed] = N''missing'' OR ([disappearance] IS NULL AND [classifiedByUserId] IS NULL))
    AND (CASE WHEN [disappearance] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [classifiedByUserId] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [classifiedByUserId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [classifiedAt] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [status] = N''merged'' THEN 1 ELSE 0 END) = (CASE WHEN [mergedIntoRecordId] IS NOT NULL THEN 1 ELSE 0 END)
    AND ([mergedIntoRecordId] IS NULL OR [mergedIntoRecordId] <> [id])
    AND LEN([externalKey]) BETWEEN 1 AND 400
    AND [version] >= 1
);');

EXEC(N'ALTER TABLE [dbo].[MigrationStagedRecord] ADD CONSTRAINT [MigrationStagedRecord_ck] CHECK (
    [revision] >= 1
    AND [contentKind] IN (N''media.video'', N''library.work'', N''library.magazine'', N''library.magazine-issue'', N''editorial.news'', N''editorial.article'', N''editorial.press-release'', N''editorial.page'', N''people.person'', N''global.country'', N''fatwa.ruling'', N''quran.translation'')
    AND LEN([title]) BETWEEN 1 AND 240
    AND ISJSON([payload]) = 1
    AND LEN([payload]) <= 200000
    AND [payloadChecksum] COLLATE Latin1_General_BIN2 NOT LIKE N''%[^0-9a-f]%''
    AND [inputChecksum] COLLATE Latin1_General_BIN2 NOT LIKE N''%[^0-9a-f]%''
    AND [validation] IN (N''valid'', N''invalid'')
    AND ([issues] IS NULL OR ISJSON([issues]) = 1)
    AND [personalData] IN (N''none'', N''flagged'')
    AND [review] IN (N''pending'', N''approved'', N''rejected'', N''superseded'')
    AND ([review] <> N''approved'' OR ([validation] = N''valid'' AND [personalData] = N''none''))
    AND ([review] NOT IN (N''approved'', N''rejected'') OR ([reviewedByUserId] IS NOT NULL AND [reviewedAt] IS NOT NULL))
    AND [version] >= 1
);');

EXEC(N'ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_ck] CHECK (
    (CASE WHEN [videoId] IS NULL THEN 0 ELSE 1 END
     + CASE WHEN [workId] IS NULL THEN 0 ELSE 1 END
     + CASE WHEN [magazineId] IS NULL THEN 0 ELSE 1 END
     + CASE WHEN [magazineIssueId] IS NULL THEN 0 ELSE 1 END
     + CASE WHEN [newsArticleId] IS NULL THEN 0 ELSE 1 END
     + CASE WHEN [articleId] IS NULL THEN 0 ELSE 1 END
     + CASE WHEN [pageId] IS NULL THEN 0 ELSE 1 END
     + CASE WHEN [pressReleaseId] IS NULL THEN 0 ELSE 1 END
     + CASE WHEN [personId] IS NULL THEN 0 ELSE 1 END
     + CASE WHEN [countryId] IS NULL THEN 0 ELSE 1 END) = 1
    AND [state] IN (N''active'', N''disabled'')
    AND [canonicalPath] LIKE N''/%'' AND [canonicalPath] NOT LIKE N''//%''
    AND [legacyUrlDigest] COLLATE Latin1_General_BIN2 NOT LIKE N''%[^0-9a-f]%''
    AND (CASE WHEN [changedAt] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [changedByUserId] IS NULL THEN 1 ELSE 0 END)
    AND ([state] = N''active'' OR [changedAt] IS NOT NULL)
    AND [version] >= 1
);');

-- An entry: at most one typed target, a stage exactly when it names one, and
-- a mode. A refresh entry is never rolled back by migration: what it changed
-- in a record people already had is a person's to undo.
EXEC(N'ALTER TABLE [dbo].[MigrationManifestEntry] ADD CONSTRAINT [MigrationManifestEntry_ck] CHECK (
    [position] >= 0
    AND [state] IN (N''pending'', N''publishing'', N''published'', N''refused'', N''rolled-back'', N''rollback-refused'')
    AND [mode] IN (N''create'', N''refresh'')
    AND ([mode] = N''create'' OR [state] <> N''rolled-back'')
    AND (CASE WHEN [videoId] IS NULL THEN 0 ELSE 1 END
         + CASE WHEN [workId] IS NULL THEN 0 ELSE 1 END
         + CASE WHEN [magazineId] IS NULL THEN 0 ELSE 1 END
         + CASE WHEN [magazineIssueId] IS NULL THEN 0 ELSE 1 END
         + CASE WHEN [newsArticleId] IS NULL THEN 0 ELSE 1 END
         + CASE WHEN [articleId] IS NULL THEN 0 ELSE 1 END
         + CASE WHEN [pageId] IS NULL THEN 0 ELSE 1 END
         + CASE WHEN [pressReleaseId] IS NULL THEN 0 ELSE 1 END
         + CASE WHEN [personId] IS NULL THEN 0 ELSE 1 END
         + CASE WHEN [countryId] IS NULL THEN 0 ELSE 1 END) <= 1
    AND ([targetStage] IS NULL OR [targetStage] IN (N''public'', N''in-review''))
    AND (CASE WHEN [targetStage] IS NULL THEN 1 ELSE 0 END)
        = (CASE WHEN [videoId] IS NULL AND [workId] IS NULL AND [magazineId] IS NULL
                     AND [magazineIssueId] IS NULL AND [newsArticleId] IS NULL AND [articleId] IS NULL
                     AND [pageId] IS NULL AND [pressReleaseId] IS NULL AND [personId] IS NULL
                     AND [countryId] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [state] IN (N''published'', N''rolled-back'', N''rollback-refused'') THEN 1 ELSE 0 END)
        = (CASE WHEN (CASE WHEN [videoId] IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN [workId] IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN [magazineId] IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN [magazineIssueId] IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN [newsArticleId] IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN [articleId] IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN [pageId] IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN [pressReleaseId] IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN [personId] IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN [countryId] IS NULL THEN 0 ELSE 1 END) = 1
                     AND [targetStage] IS NOT NULL AND [targetVersion] IS NOT NULL
                     AND [canonicalPath] IS NOT NULL AND [publishedAt] IS NOT NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [state] = N''refused'' THEN 1 ELSE 0 END) = (CASE WHEN [refusal] IS NOT NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [state] = N''rolled-back'' THEN 1 ELSE 0 END) = (CASE WHEN [rolledBackAt] IS NOT NULL THEN 1 ELSE 0 END)
    AND ([canonicalPath] IS NULL OR ([canonicalPath] LIKE N''/%'' AND [canonicalPath] NOT LIKE N''//%''))
    AND ([targetVersion] IS NULL OR [targetVersion] >= 1)
    AND [version] >= 1
);');

-- ===========================================================================
-- A legacy mapping names exactly its entry's target, keeps its address and
-- target, and only its state moves (51380). A refresh entry makes none.
-- ===========================================================================
EXEC(N'ALTER TRIGGER [dbo].[MigrationLegacyMappingIntegrity] ON [dbo].[MigrationLegacyMapping] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM deleted)
 BEGIN
   IF EXISTS (
     SELECT 1 FROM inserted i
     JOIN [dbo].[MigrationManifestEntry] e ON e.[id] = i.[manifestEntryId]
     JOIN [dbo].[MigrationRecord] c ON c.[id] = i.[recordId]
     WHERE e.[recordId] <> i.[recordId] AND ISNULL(c.[mergedIntoRecordId], N'''') <> e.[recordId]
   )
     THROW 51380, ''A legacy mapping names its entry''''s record, or a record merged into it.'', 1;
   IF EXISTS (
     SELECT 1 FROM inserted i
     JOIN [dbo].[MigrationManifestEntry] e ON e.[id] = i.[manifestEntryId]
     WHERE e.[mode] <> N''create''
   )
     THROW 51380, ''Only a create entry makes a legacy mapping.'', 1;
   IF EXISTS (
     SELECT 1 FROM inserted i
     JOIN [dbo].[MigrationManifestEntry] e ON e.[id] = i.[manifestEntryId]
     WHERE ISNULL(e.[videoId], N'''') <> ISNULL(i.[videoId], N'''')
        OR ISNULL(e.[workId], N'''') <> ISNULL(i.[workId], N'''')
        OR ISNULL(e.[magazineId], N'''') <> ISNULL(i.[magazineId], N'''')
        OR ISNULL(e.[magazineIssueId], N'''') <> ISNULL(i.[magazineIssueId], N'''')
        OR ISNULL(e.[newsArticleId], N'''') <> ISNULL(i.[newsArticleId], N'''')
        OR ISNULL(e.[articleId], N'''') <> ISNULL(i.[articleId], N'''')
        OR ISNULL(e.[pageId], N'''') <> ISNULL(i.[pageId], N'''')
        OR ISNULL(e.[pressReleaseId], N'''') <> ISNULL(i.[pressReleaseId], N'''')
        OR ISNULL(e.[personId], N'''') <> ISNULL(i.[personId], N'''')
        OR ISNULL(e.[countryId], N'''') <> ISNULL(i.[countryId], N'''')
   )
     THROW 51380, ''A legacy mapping names exactly what its entry made.'', 1;
   RETURN;
 END;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51380, ''A legacy mapping keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[sourceId] <> i.[sourceId] OR d.[recordId] <> i.[recordId]
      OR d.[legacyUrl] COLLATE Latin1_General_BIN2 <> i.[legacyUrl] COLLATE Latin1_General_BIN2
      OR d.[legacyUrlDigest] <> i.[legacyUrlDigest]
      OR ISNULL(d.[videoId], N'''') <> ISNULL(i.[videoId], N'''')
      OR ISNULL(d.[workId], N'''') <> ISNULL(i.[workId], N'''')
      OR ISNULL(d.[magazineId], N'''') <> ISNULL(i.[magazineId], N'''')
      OR ISNULL(d.[magazineIssueId], N'''') <> ISNULL(i.[magazineIssueId], N'''')
      OR ISNULL(d.[newsArticleId], N'''') <> ISNULL(i.[newsArticleId], N'''')
      OR ISNULL(d.[articleId], N'''') <> ISNULL(i.[articleId], N'''')
      OR ISNULL(d.[pageId], N'''') <> ISNULL(i.[pageId], N'''')
      OR ISNULL(d.[pressReleaseId], N'''') <> ISNULL(i.[pressReleaseId], N'''')
      OR ISNULL(d.[personId], N'''') <> ISNULL(i.[personId], N'''')
      OR ISNULL(d.[countryId], N'''') <> ISNULL(i.[countryId], N'''')
      OR d.[canonicalPath] COLLATE Latin1_General_BIN2 <> i.[canonicalPath] COLLATE Latin1_General_BIN2
      OR ISNULL(d.[manifestEntryId], N'''') <> ISNULL(i.[manifestEntryId], N'''')
      OR d.[createdAt] <> i.[createdAt] OR d.[createdByUserId] <> i.[createdByUserId]
      OR i.[version] <> d.[version] + 1
 )
   THROW 51380, ''A legacy mapping keeps its address and target; only its state moves.'', 1;
END');

-- ===========================================================================
-- An entry names an APPROVED, valid revision of a PUBLISHABLE kind and is
-- added only to a draft; its target is in its revision's OWN kind's column;
-- its mode is fixed at creation; it is published only while its manifest is
-- publishing and rolled back only while it is rolling back; what it made is
-- recorded once (51379).
-- ===========================================================================
EXEC(N'ALTER TRIGGER [dbo].[MigrationManifestEntryIntegrity] ON [dbo].[MigrationManifestEntry] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN [dbo].[MigrationStagedRecord] s ON s.[id] = i.[stagedRecordId]
   WHERE (i.[videoId] IS NOT NULL AND s.[contentKind] <> N''media.video'')
      OR (i.[workId] IS NOT NULL AND s.[contentKind] <> N''library.work'')
      OR (i.[magazineId] IS NOT NULL AND s.[contentKind] <> N''library.magazine'')
      OR (i.[magazineIssueId] IS NOT NULL AND s.[contentKind] <> N''library.magazine-issue'')
      OR (i.[newsArticleId] IS NOT NULL AND s.[contentKind] <> N''editorial.news'')
      OR (i.[articleId] IS NOT NULL AND s.[contentKind] <> N''editorial.article'')
      OR (i.[pageId] IS NOT NULL AND s.[contentKind] <> N''editorial.page'')
      OR (i.[pressReleaseId] IS NOT NULL AND s.[contentKind] <> N''editorial.press-release'')
      OR (i.[personId] IS NOT NULL AND s.[contentKind] <> N''people.person'')
      OR (i.[countryId] IS NOT NULL AND s.[contentKind] <> N''global.country'')
 )
   THROW 51379, ''An entry names a target of its own revision''''s kind.'', 1;
 IF NOT EXISTS (SELECT 1 FROM deleted)
 BEGIN
   IF EXISTS (
     SELECT 1 FROM inserted i
     WHERE i.[state] <> N''pending'' OR i.[version] <> 1
        OR NOT EXISTS (SELECT 1 FROM [dbo].[MigrationPublishManifest] m WHERE m.[id] = i.[manifestId] AND m.[state] = N''draft'')
        OR NOT EXISTS (
          SELECT 1 FROM [dbo].[MigrationStagedRecord] s
          JOIN [dbo].[MigrationPublishManifest] m ON m.[id] = i.[manifestId]
          JOIN [dbo].[MigrationRecord] c ON c.[id] = s.[recordId] AND c.[sourceId] = m.[sourceId]
          WHERE s.[id] = i.[stagedRecordId] AND s.[review] = N''approved'' AND s.[validation] = N''valid''
            AND s.[contentKind] IN (N''media.video'', N''library.work'', N''library.magazine'', N''library.magazine-issue'', N''editorial.news'', N''editorial.article'', N''editorial.press-release'', N''editorial.page'', N''people.person'', N''global.country''))
   )
     THROW 51379, ''An entry names an approved revision of a publishable kind of the manifest''''s source and joins only a draft.'', 1;
   RETURN;
 END;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51379, ''An entry keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   JOIN [dbo].[MigrationPublishManifest] m ON m.[id] = i.[manifestId]
   WHERE d.[manifestId] <> i.[manifestId] OR d.[position] <> i.[position]
      OR d.[stagedRecordId] <> i.[stagedRecordId] OR d.[recordId] <> i.[recordId]
      OR d.[mode] <> i.[mode]
      OR (d.[videoId] IS NOT NULL AND ISNULL(i.[videoId], N'''') <> d.[videoId])
      OR (d.[workId] IS NOT NULL AND ISNULL(i.[workId], N'''') <> d.[workId])
      OR (d.[magazineId] IS NOT NULL AND ISNULL(i.[magazineId], N'''') <> d.[magazineId])
      OR (d.[magazineIssueId] IS NOT NULL AND ISNULL(i.[magazineIssueId], N'''') <> d.[magazineIssueId])
      OR (d.[newsArticleId] IS NOT NULL AND ISNULL(i.[newsArticleId], N'''') <> d.[newsArticleId])
      OR (d.[articleId] IS NOT NULL AND ISNULL(i.[articleId], N'''') <> d.[articleId])
      OR (d.[pageId] IS NOT NULL AND ISNULL(i.[pageId], N'''') <> d.[pageId])
      OR (d.[pressReleaseId] IS NOT NULL AND ISNULL(i.[pressReleaseId], N'''') <> d.[pressReleaseId])
      OR (d.[personId] IS NOT NULL AND ISNULL(i.[personId], N'''') <> d.[personId])
      OR (d.[countryId] IS NOT NULL AND ISNULL(i.[countryId], N'''') <> d.[countryId])
      OR (d.[targetStage] IS NOT NULL AND ISNULL(i.[targetStage], N'''') <> d.[targetStage])
      OR (d.[targetVersion] IS NOT NULL AND ISNULL(i.[targetVersion], -1) <> d.[targetVersion])
      OR (d.[canonicalPath] IS NOT NULL AND ISNULL(i.[canonicalPath], N'''') COLLATE Latin1_General_BIN2 <> d.[canonicalPath] COLLATE Latin1_General_BIN2)
      OR i.[version] <> d.[version] + 1
      OR NOT ((d.[state] IN (N''pending'', N''publishing'') AND i.[state] IN (N''publishing'', N''published'', N''refused'') AND m.[state] = N''publishing'')
              OR (d.[state] IN (N''published'', N''rollback-refused'') AND i.[state] IN (N''rolled-back'', N''rollback-refused'') AND m.[state] = N''rolling-back''))
 )
   THROW 51379, ''An entry moves only in its manifest''''s own phase, and what it made is recorded once.'', 1;
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
