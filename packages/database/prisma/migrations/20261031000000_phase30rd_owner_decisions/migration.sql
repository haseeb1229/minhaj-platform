-- ===========================================================================
-- Phase 30 — two owner decisions for the Stage-1A review build ("30-RD")
-- ===========================================================================
--
-- OWNER DECISIONS, NOT A NEW PHASE (OPEN_DECISIONS.md §3.8). Both are decided
-- for the pre-adoption review build on staging; neither is Minhaj's
-- acceptance of anything.
--
-- 1. A PERSON MAY CLEAR A FALSE POSITIVE OF THE PERSONAL-DATA DETECTOR, AND
--    ONLY THAT. The detector stays as conservative as it was: an email or a
--    phone-like run still flags a revision and is still redacted, and a
--    flagged revision still can never be approved. What is new is evidence
--    and a narrow, audited human classification of it:
--
--      MigrationPersonalDataFinding — each DISTINCT match the detector found
--      in one flagged revision, recorded once, all together, by the run that
--      staged it: its type, a SHA-256 digest over the exact input bytes'
--      checksum, the type and the matched text (never the text itself), and
--      the words around it taken from the ALREADY-REDACTED text. A person
--      holding `migration.clearPersonalData` with a live
--      `migration-personal-data` step-up classifies each one, with
--      a reason, at the version they saw, while the revision is pending.
--
--    A revision may then be staged `cleared` — from exactly the same bytes,
--    by exactly the same normaliser — only when it names that flagged
--    revision and EVERY finding of it is classified public organisational.
--    The flagged revision is never changed; the cleared one is a new revision
--    re-read from the retained snapshot. It is approved only by someone who
--    decided none of its findings, and only while every finding still stands
--    cleared. Changed bytes or a changed normaliser match no clearance.
--
-- 2. THE SOURCE'S CURATED ARCHIVES MAY BECOME EDITORIAL COLLECTIONS. One more
--    publishable kind, `editorial.collection`, with its typed target column
--    `collectionId` on an entry and on a legacy mapping — never a target pair.
--
-- REFUSALS (within 51370-51399, reserved for Migration):
--   51385  a finding recorded other than unresolved at version 1, for a
--          revision that is not a pending flagged one of exactly its bytes
--          and normaliser, or not as one complete set; its evidence
--          rewritten; decided without `migration.clearPersonalData` and a
--          live `migration-personal-data` step-up, or after its
--          revision left review; or deleted
--   51386  a revision staged `cleared` without a complete, wholly
--          public-organisational clearance of the flagged revision of the
--          same bytes and normaliser it names; or a cleared revision approved
--          by one of the people who cleared it, or after a finding of it was
--          reclassified
--   51374, 51379, 51380 extended to the new column and kind; no other number.
--
-- POSTURES FOR THE APPLICATION PRINCIPAL (grant-application-principal.sql):
--   FINDING   MigrationPersonalDataFinding: SELECT, INSERT, and UPDATE of the
--             decision columns only; never DELETE.
--   STAGED    `clearanceOfStagedRecordId` joins the columns it may never
--             UPDATE; MAPPING `collectionId` likewise.
--
-- ONE GATED KEY: `migration.clearPersonalData` is catalogued and externally
-- gated — bundled into no role, held by nobody — so no bundle changes and no
-- session is invalidated.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.
-- ===========================================================================

BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- The findings of the personal-data detector, and a person's classification
-- ===========================================================================
CREATE TABLE [dbo].[MigrationPersonalDataFinding] (
    [id] NVARCHAR(36) NOT NULL,
    [stagedRecordId] NVARCHAR(36) NOT NULL,
    [recordId] NVARCHAR(36) NOT NULL,
    [inputChecksum] CHAR(64) NOT NULL,
    [normalizerVersion] NVARCHAR(32) NOT NULL,
    [position] INT NOT NULL,
    [findingCount] INT NOT NULL,
    [findingType] NVARCHAR(16) NOT NULL,
    [findingDigest] CHAR(64) NOT NULL,
    [context] NVARCHAR(400) NOT NULL,
    [classification] NVARCHAR(40) NOT NULL CONSTRAINT [MigrationPersonalDataFinding_classification_df] DEFAULT N'unresolved',
    [note] NVARCHAR(500),
    [decidedByUserId] NVARCHAR(36),
    [decidedAt] DATETIME2,
    [version] INT NOT NULL CONSTRAINT [MigrationPersonalDataFinding_version_df] DEFAULT 1,
    CONSTRAINT [MigrationPersonalDataFinding_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MigrationPersonalDataFinding_staged_position_key] UNIQUE NONCLUSTERED ([stagedRecordId], [position]),
    CONSTRAINT [MigrationPersonalDataFinding_staged_digest_key] UNIQUE NONCLUSTERED ([stagedRecordId], [findingDigest])
);

ALTER TABLE [dbo].[MigrationPersonalDataFinding] ADD CONSTRAINT [MigrationPersonalDataFinding_stagedRecordId_fkey] FOREIGN KEY ([stagedRecordId], [recordId]) REFERENCES [dbo].[MigrationStagedRecord]([id], [recordId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationPersonalDataFinding] ADD CONSTRAINT [MigrationPersonalDataFinding_decidedByUserId_fkey] FOREIGN KEY ([decidedByUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE NONCLUSTERED INDEX [MigrationPersonalDataFinding_recordId_idx] ON [dbo].[MigrationPersonalDataFinding]([recordId]);

-- A finding's evidence is bounded and typed; a decision carries its person,
-- time and reason together, and only a decision moves it off `unresolved`.
EXEC(N'ALTER TABLE [dbo].[MigrationPersonalDataFinding] ADD CONSTRAINT [MigrationPersonalDataFinding_ck] CHECK (
    [findingCount] BETWEEN 1 AND 200
    AND [position] >= 0 AND [position] < [findingCount]
    AND [findingType] IN (N''email'', N''phone'')
    AND LEN([findingDigest]) = 64 AND [findingDigest] COLLATE Latin1_General_BIN2 NOT LIKE N''%[^0-9a-f]%''
    AND [inputChecksum] COLLATE Latin1_General_BIN2 NOT LIKE N''%[^0-9a-f]%''
    AND LEN([context]) BETWEEN 1 AND 400
    AND [classification] IN (N''unresolved'', N''public-organisational-contact'', N''public-organisational-identifier'', N''personal-or-private'')
    AND (CASE WHEN [decidedByUserId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [decidedAt] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [decidedByUserId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [note] IS NULL THEN 1 ELSE 0 END)
    AND ([note] IS NULL OR LEN([note]) BETWEEN 1 AND 500)
    AND ([classification] = N''unresolved'' OR [decidedByUserId] IS NOT NULL)
    AND [version] >= 1
);');

-- ===========================================================================
-- A staged revision may be `cleared`, naming the flagged revision of the same
-- bytes whose findings a person cleared.
-- ===========================================================================
ALTER TABLE [dbo].[MigrationStagedRecord] ADD [clearanceOfStagedRecordId] NVARCHAR(36);
ALTER TABLE [dbo].[MigrationStagedRecord] ADD CONSTRAINT [MigrationStagedRecord_clearanceOf_fkey] FOREIGN KEY ([clearanceOfStagedRecordId], [recordId]) REFERENCES [dbo].[MigrationStagedRecord]([id], [recordId]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ===========================================================================
-- Collections — the typed target, on an entry and on a legacy mapping
-- ===========================================================================
ALTER TABLE [dbo].[MigrationManifestEntry] ADD [collectionId] NVARCHAR(36);
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD [collectionId] NVARCHAR(36);
ALTER TABLE [dbo].[MigrationManifestEntry] ADD CONSTRAINT [MigrationManifestEntry_collectionId_fkey] FOREIGN KEY ([collectionId]) REFERENCES [dbo].[Collection]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_collectionId_fkey] FOREIGN KEY ([collectionId]) REFERENCES [dbo].[Collection]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

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
    AND [contentKind] IN (N''media.video'', N''library.work'', N''library.magazine'', N''library.magazine-issue'', N''editorial.news'', N''editorial.article'', N''editorial.press-release'', N''editorial.page'', N''editorial.collection'', N''people.person'', N''global.country'', N''fatwa.ruling'', N''quran.translation'')
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
    [contentKind] IN (N''media.video'', N''library.work'', N''library.magazine'', N''library.magazine-issue'', N''editorial.news'', N''editorial.article'', N''editorial.press-release'', N''editorial.page'', N''editorial.collection'', N''people.person'', N''global.country'', N''fatwa.ruling'', N''quran.translation'')
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

-- `cleared` exactly when the revision names the flagged revision it clears;
-- an approved revision is valid and carries no UNCLEARED personal data.
EXEC(N'ALTER TABLE [dbo].[MigrationStagedRecord] ADD CONSTRAINT [MigrationStagedRecord_ck] CHECK (
    [revision] >= 1
    AND [contentKind] IN (N''media.video'', N''library.work'', N''library.magazine'', N''library.magazine-issue'', N''editorial.news'', N''editorial.article'', N''editorial.press-release'', N''editorial.page'', N''editorial.collection'', N''people.person'', N''global.country'', N''fatwa.ruling'', N''quran.translation'')
    AND LEN([title]) BETWEEN 1 AND 240
    AND ISJSON([payload]) = 1
    AND LEN([payload]) <= 200000
    AND [payloadChecksum] COLLATE Latin1_General_BIN2 NOT LIKE N''%[^0-9a-f]%''
    AND [inputChecksum] COLLATE Latin1_General_BIN2 NOT LIKE N''%[^0-9a-f]%''
    AND [validation] IN (N''valid'', N''invalid'')
    AND ([issues] IS NULL OR ISJSON([issues]) = 1)
    AND [personalData] IN (N''none'', N''flagged'', N''cleared'')
    AND (CASE WHEN [personalData] = N''cleared'' THEN 1 ELSE 0 END) = (CASE WHEN [clearanceOfStagedRecordId] IS NOT NULL THEN 1 ELSE 0 END)
    AND ([clearanceOfStagedRecordId] IS NULL OR [clearanceOfStagedRecordId] <> [id])
    AND [review] IN (N''pending'', N''approved'', N''rejected'', N''superseded'')
    AND ([review] <> N''approved'' OR ([validation] = N''valid'' AND [personalData] IN (N''none'', N''cleared'')))
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
     + CASE WHEN [countryId] IS NULL THEN 0 ELSE 1 END
     + CASE WHEN [collectionId] IS NULL THEN 0 ELSE 1 END) = 1
    AND [state] IN (N''active'', N''disabled'')
    AND [canonicalPath] LIKE N''/%'' AND [canonicalPath] NOT LIKE N''//%''
    AND [legacyUrlDigest] COLLATE Latin1_General_BIN2 NOT LIKE N''%[^0-9a-f]%''
    AND (CASE WHEN [changedAt] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [changedByUserId] IS NULL THEN 1 ELSE 0 END)
    AND ([state] = N''active'' OR [changedAt] IS NOT NULL)
    AND [version] >= 1
);');

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
         + CASE WHEN [countryId] IS NULL THEN 0 ELSE 1 END
         + CASE WHEN [collectionId] IS NULL THEN 0 ELSE 1 END) <= 1
    AND ([targetStage] IS NULL OR [targetStage] IN (N''public'', N''in-review''))
    AND (CASE WHEN [targetStage] IS NULL THEN 1 ELSE 0 END)
        = (CASE WHEN [videoId] IS NULL AND [workId] IS NULL AND [magazineId] IS NULL
                     AND [magazineIssueId] IS NULL AND [newsArticleId] IS NULL AND [articleId] IS NULL
                     AND [pageId] IS NULL AND [pressReleaseId] IS NULL AND [personId] IS NULL
                     AND [countryId] IS NULL AND [collectionId] IS NULL THEN 1 ELSE 0 END)
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
                      + CASE WHEN [countryId] IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN [collectionId] IS NULL THEN 0 ELSE 1 END) = 1
                     AND [targetStage] IS NOT NULL AND [targetVersion] IS NOT NULL
                     AND [canonicalPath] IS NOT NULL AND [publishedAt] IS NOT NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [state] = N''refused'' THEN 1 ELSE 0 END) = (CASE WHEN [refusal] IS NOT NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [state] = N''rolled-back'' THEN 1 ELSE 0 END) = (CASE WHEN [rolledBackAt] IS NOT NULL THEN 1 ELSE 0 END)
    AND ([canonicalPath] IS NULL OR ([canonicalPath] LIKE N''/%'' AND [canonicalPath] NOT LIKE N''//%''))
    AND ([targetVersion] IS NULL OR [targetVersion] >= 1)
    AND [version] >= 1
);');

-- ===========================================================================
-- A finding is recorded once, with its whole set, for a pending flagged
-- revision of exactly its bytes and normaliser; its evidence never changes;
-- only a holder of `migration.clearPersonalData` with a live
-- `migration-personal-data` step-up decides it, at one version
-- more, while its revision is still pending; it is never deleted (51385).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MigrationPersonalDataFindingIntegrity] ON [dbo].[MigrationPersonalDataFinding] AFTER INSERT, UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM inserted) AND EXISTS (SELECT 1 FROM deleted)
   THROW 51385, ''A personal-data finding is never deleted.'', 1;
 IF NOT EXISTS (SELECT 1 FROM deleted)
 BEGIN
   IF EXISTS (
     SELECT 1 FROM inserted i
     WHERE i.[classification] <> N''unresolved'' OR i.[decidedByUserId] IS NOT NULL OR i.[version] <> 1
        OR NOT EXISTS (
          SELECT 1 FROM [dbo].[MigrationStagedRecord] s
          WHERE s.[id] = i.[stagedRecordId] AND s.[recordId] = i.[recordId]
            AND s.[personalData] = N''flagged'' AND s.[review] = N''pending''
            AND s.[inputChecksum] = i.[inputChecksum]
            AND s.[normalizerVersion] = i.[normalizerVersion])
   )
     THROW 51385, ''A finding is recorded unresolved, at version 1, for a pending flagged revision of exactly its bytes and normaliser.'', 1;
   IF EXISTS (
     SELECT 1 FROM (SELECT DISTINCT [stagedRecordId] FROM inserted) n
     WHERE (SELECT COUNT(*) FROM [dbo].[MigrationPersonalDataFinding] f WHERE f.[stagedRecordId] = n.[stagedRecordId])
             <> (SELECT COUNT(*) FROM inserted i WHERE i.[stagedRecordId] = n.[stagedRecordId])
        OR EXISTS (
          SELECT 1 FROM inserted i
          WHERE i.[stagedRecordId] = n.[stagedRecordId]
            AND i.[findingCount] <> (SELECT COUNT(*) FROM inserted j WHERE j.[stagedRecordId] = n.[stagedRecordId]))
   )
     THROW 51385, ''A revision''''s findings are recorded once, every one of them together.'', 1;
   RETURN;
 END;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51385, ''A finding keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[stagedRecordId] <> i.[stagedRecordId] OR d.[recordId] <> i.[recordId]
      OR d.[inputChecksum] <> i.[inputChecksum] OR d.[normalizerVersion] <> i.[normalizerVersion]
      OR d.[position] <> i.[position] OR d.[findingCount] <> i.[findingCount]
      OR d.[findingType] <> i.[findingType] OR d.[findingDigest] <> i.[findingDigest]
      OR d.[context] COLLATE Latin1_General_BIN2 <> i.[context] COLLATE Latin1_General_BIN2
      OR i.[version] <> d.[version] + 1
      OR i.[decidedByUserId] IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM [dbo].[MigrationStagedRecord] s
        WHERE s.[id] = i.[stagedRecordId] AND s.[review] = N''pending'')
 )
   THROW 51385, ''A finding keeps its evidence, and is decided one version at a time while its revision is pending.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE NOT EXISTS (
       SELECT 1 FROM [dbo].[RoleAssignment] ra
       JOIN [dbo].[Role] r ON r.[id] = ra.[roleId] AND r.[deactivatedAt] IS NULL
       JOIN [dbo].[RolePermission] rp ON rp.[roleId] = r.[id] AND rp.[permissionKey] = N''migration.clearPersonalData''
       JOIN [dbo].[User] u ON u.[id] = ra.[userId] AND u.[status] = N''active''
       WHERE ra.[userId] = i.[decidedByUserId] AND ra.[revokedAt] IS NULL)
     OR NOT EXISTS (
       SELECT 1 FROM [dbo].[StepUpGrant] g
       JOIN [dbo].[Session] s ON s.[id] = g.[sessionId] AND s.[userId] = g.[userId] AND s.[expiresAt] > SYSUTCDATETIME()
       WHERE g.[userId] = i.[decidedByUserId] AND g.[purpose] = N''migration-personal-data''
         AND g.[expiresAt] > SYSUTCDATETIME())
 )
   THROW 51385, ''Personal-data clearance authority is not held now.'', 1;
END');

-- ===========================================================================
-- A staged revision is produced pending at version 1 from a snapshot whose
-- bytes it names; its payload and provenance never change; its review moves
-- pending -> approved | rejected | superseded, approved -> pending (approval
-- withdrawn) | superseded, rejected -> superseded, one version at a time
-- (51374). Phase 30-RD: a `cleared` revision names the flagged revision of
-- the same bytes and normaliser whose every finding a person classified
-- public organisational, and is approved only by someone who decided none of
-- them, while each still stands (51386).
-- ===========================================================================
EXEC(N'ALTER TRIGGER [dbo].[MigrationStagedRecordIntegrity] ON [dbo].[MigrationStagedRecord] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF NOT EXISTS (SELECT 1 FROM deleted)
 BEGIN
   IF EXISTS (
     SELECT 1 FROM inserted i
     WHERE i.[review] <> N''pending'' OR i.[version] <> 1 OR i.[reviewedByUserId] IS NOT NULL
        OR NOT EXISTS (
          SELECT 1 FROM [dbo].[MigrationRawSnapshot] s
          WHERE s.[id] = i.[snapshotId] AND s.[checksum] = i.[inputChecksum])
        OR NOT EXISTS (
          SELECT 1 FROM [dbo].[MigrationRun] r
          JOIN [dbo].[MigrationRecord] c ON c.[id] = i.[recordId] AND c.[sourceId] = r.[sourceId]
          WHERE r.[id] = i.[runId])
   )
     THROW 51374, ''A staged revision begins pending at version 1, from a snapshot whose checksum it carries, in a run of its own source.'', 1;
   IF EXISTS (
     SELECT 1 FROM inserted i
     WHERE i.[personalData] = N''cleared'' AND (
       NOT EXISTS (
         SELECT 1 FROM [dbo].[MigrationStagedRecord] o
         WHERE o.[id] = i.[clearanceOfStagedRecordId] AND o.[recordId] = i.[recordId]
           AND o.[personalData] = N''flagged''
           AND o.[inputChecksum] = i.[inputChecksum]
           AND o.[normalizerVersion] = i.[normalizerVersion])
       OR NOT EXISTS (
         SELECT 1 FROM [dbo].[MigrationPersonalDataFinding] f
         WHERE f.[stagedRecordId] = i.[clearanceOfStagedRecordId])
       OR EXISTS (
         SELECT 1 FROM [dbo].[MigrationPersonalDataFinding] f
         WHERE f.[stagedRecordId] = i.[clearanceOfStagedRecordId]
           AND f.[classification] NOT IN (N''public-organisational-contact'', N''public-organisational-identifier'')))
   )
     THROW 51386, ''A revision is cleared only from the flagged revision of the same bytes and normaliser, every finding of which a person cleared.'', 1;
   RETURN;
 END;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51374, ''A staged revision keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[recordId] <> i.[recordId] OR d.[snapshotId] <> i.[snapshotId] OR d.[runId] <> i.[runId]
      OR d.[revision] <> i.[revision] OR d.[contentKind] <> i.[contentKind]
      OR d.[title] COLLATE Latin1_General_BIN2 <> i.[title] COLLATE Latin1_General_BIN2
      OR d.[titleKey] COLLATE Latin1_General_BIN2 <> i.[titleKey] COLLATE Latin1_General_BIN2
      OR ISNULL(d.[dedupeKey], N'''') COLLATE Latin1_General_BIN2 <> ISNULL(i.[dedupeKey], N'''') COLLATE Latin1_General_BIN2
      OR ISNULL(d.[languageCode], N'''') <> ISNULL(i.[languageCode], N'''')
      OR d.[payload] COLLATE Latin1_General_BIN2 <> i.[payload] COLLATE Latin1_General_BIN2
      OR d.[payloadChecksum] <> i.[payloadChecksum]
      OR d.[adapterKey] <> i.[adapterKey] OR d.[adapterVersion] <> i.[adapterVersion]
      OR d.[parserKey] <> i.[parserKey] OR d.[parserVersion] <> i.[parserVersion]
      OR d.[normalizerVersion] <> i.[normalizerVersion] OR d.[codeRevision] <> i.[codeRevision]
      OR d.[inputChecksum] <> i.[inputChecksum] OR d.[producedAt] <> i.[producedAt]
      OR d.[validation] <> i.[validation]
      OR ISNULL(d.[issues], N'''') COLLATE Latin1_General_BIN2 <> ISNULL(i.[issues], N'''') COLLATE Latin1_General_BIN2
      OR d.[personalData] <> i.[personalData]
      OR ISNULL(d.[clearanceOfStagedRecordId], N'''') <> ISNULL(i.[clearanceOfStagedRecordId], N'''')
      OR i.[version] <> d.[version] + 1
      OR NOT ((d.[review] = N''pending'' AND i.[review] IN (N''approved'', N''rejected'', N''superseded''))
              OR (d.[review] = N''approved'' AND i.[review] IN (N''pending'', N''superseded''))
              OR (d.[review] = N''rejected'' AND i.[review] = N''superseded''))
 )
   THROW 51374, ''A staged revision keeps its payload and provenance, and its review moves only forward.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE i.[review] = N''approved'' AND d.[review] <> N''approved'' AND i.[personalData] = N''cleared''
     AND EXISTS (
       SELECT 1 FROM [dbo].[MigrationPersonalDataFinding] f
       WHERE f.[stagedRecordId] = i.[clearanceOfStagedRecordId]
         AND (f.[decidedByUserId] = i.[reviewedByUserId]
              OR f.[classification] NOT IN (N''public-organisational-contact'', N''public-organisational-identifier'')))
 )
   THROW 51386, ''A cleared revision is approved by someone who cleared none of its findings, while every one still stands cleared.'', 1;
END');

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
        OR ISNULL(e.[collectionId], N'''') <> ISNULL(i.[collectionId], N'''')
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
      OR ISNULL(d.[collectionId], N'''') <> ISNULL(i.[collectionId], N'''')
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
      OR (i.[collectionId] IS NOT NULL AND s.[contentKind] <> N''editorial.collection'')
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
            AND s.[contentKind] IN (N''media.video'', N''library.work'', N''library.magazine'', N''library.magazine-issue'', N''editorial.news'', N''editorial.article'', N''editorial.press-release'', N''editorial.page'', N''editorial.collection'', N''people.person'', N''global.country''))
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
      OR (d.[collectionId] IS NOT NULL AND ISNULL(i.[collectionId], N'''') <> d.[collectionId])
      OR (d.[targetStage] IS NOT NULL AND ISNULL(i.[targetStage], N'''') <> d.[targetStage])
      OR (d.[targetVersion] IS NOT NULL AND ISNULL(i.[targetVersion], -1) <> d.[targetVersion])
      OR (d.[canonicalPath] IS NOT NULL AND ISNULL(i.[canonicalPath], N'''') COLLATE Latin1_General_BIN2 <> d.[canonicalPath] COLLATE Latin1_General_BIN2)
      OR i.[version] <> d.[version] + 1
      OR NOT ((d.[state] IN (N''pending'', N''publishing'') AND i.[state] IN (N''publishing'', N''published'', N''refused'') AND m.[state] = N''publishing'')
              OR (d.[state] IN (N''published'', N''rollback-refused'') AND i.[state] IN (N''rolled-back'', N''rollback-refused'') AND m.[state] = N''rolling-back''))
 )
   THROW 51379, ''An entry moves only in its manifest''''s own phase, and what it made is recorded once.'', 1;
END');

-- ===========================================================================
-- Permissions — one externally gated key, bundled into no role
-- ===========================================================================
INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'migration.clearPersonalData', N'Classify each personal-data finding of a migrated record as public organisational or not, with a reason, after a migration-personal-data step-up. Clears no private data; publishes nothing.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
