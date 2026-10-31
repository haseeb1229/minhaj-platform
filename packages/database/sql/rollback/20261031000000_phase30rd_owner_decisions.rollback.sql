-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Phase 30-RD added the personal-data findings and their human classification, a `cleared` staged revision naming the flagged revision it clears, the `editorial.collection` kind with its typed `collectionId` target, and the externally gated `migration.clearPersonalData` key. It REFUSES while any row uses them — a finding, a cleared revision, a collection record, entry or mapping, or a role granting the key — because migration evidence and authority are never discarded to make a rollback fit; then it restores the Phase-30-R trigger bodies and CHECKs exactly, drops what it added, then the migration record. No other row moves.
BEGIN TRY
BEGIN TRAN;
IF EXISTS (SELECT 1 FROM [dbo].[MigrationPersonalDataFinding])
   OR EXISTS (SELECT 1 FROM [dbo].[MigrationStagedRecord] WHERE [personalData] = N'cleared' OR [clearanceOfStagedRecordId] IS NOT NULL OR [contentKind] = N'editorial.collection')
   OR EXISTS (SELECT 1 FROM [dbo].[MigrationSource] WHERE [contentKind] = N'editorial.collection')
   OR EXISTS (SELECT 1 FROM [dbo].[MigrationRecord] WHERE [contentKind] = N'editorial.collection')
   OR EXISTS (SELECT 1 FROM [dbo].[MigrationManifestEntry] WHERE [collectionId] IS NOT NULL)
   OR EXISTS (SELECT 1 FROM [dbo].[MigrationLegacyMapping] WHERE [collectionId] IS NOT NULL)
   OR EXISTS (SELECT 1 FROM [dbo].[RolePermission] WHERE [permissionKey] = N'migration.clearPersonalData')
  THROW 50000, 'Phase-30-RD rows exist: a personal-data finding, a cleared revision, a collection record, entry or mapping, or a role granting migration.clearPersonalData. This disposable-proof rollback never discards migration evidence or authority.', 1;
-- The Phase-30-R trigger bodies, exactly as Phase 30-R left them (the staged
-- revision's, exactly as Phase 29 left it).
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
      OR i.[version] <> d.[version] + 1
      OR NOT ((d.[review] = N''pending'' AND i.[review] IN (N''approved'', N''rejected'', N''superseded''))
              OR (d.[review] = N''approved'' AND i.[review] IN (N''pending'', N''superseded''))
              OR (d.[review] = N''rejected'' AND i.[review] = N''superseded''))
 )
   THROW 51374, ''A staged revision keeps its payload and provenance, and its review moves only forward.'', 1;
END');
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
-- The Phase-30-R value constraints, exactly.
ALTER TABLE [dbo].[MigrationSource] DROP CONSTRAINT [MigrationSource_ck];
ALTER TABLE [dbo].[MigrationRecord] DROP CONSTRAINT [MigrationRecord_ck];
ALTER TABLE [dbo].[MigrationStagedRecord] DROP CONSTRAINT [MigrationStagedRecord_ck];
ALTER TABLE [dbo].[MigrationLegacyMapping] DROP CONSTRAINT [MigrationLegacyMapping_ck];
ALTER TABLE [dbo].[MigrationManifestEntry] DROP CONSTRAINT [MigrationManifestEntry_ck];
-- Phase-30-RD additions.
DROP TRIGGER [dbo].[MigrationPersonalDataFindingIntegrity];
DROP TABLE [dbo].[MigrationPersonalDataFinding];
ALTER TABLE [dbo].[MigrationStagedRecord] DROP CONSTRAINT [MigrationStagedRecord_clearanceOf_fkey];
ALTER TABLE [dbo].[MigrationStagedRecord] DROP COLUMN [clearanceOfStagedRecordId];
ALTER TABLE [dbo].[MigrationLegacyMapping] DROP CONSTRAINT [MigrationLegacyMapping_collectionId_fkey];
ALTER TABLE [dbo].[MigrationLegacyMapping] DROP COLUMN [collectionId];
ALTER TABLE [dbo].[MigrationManifestEntry] DROP CONSTRAINT [MigrationManifestEntry_collectionId_fkey];
ALTER TABLE [dbo].[MigrationManifestEntry] DROP COLUMN [collectionId];
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
DELETE FROM [dbo].[Permission] WHERE [key] = N'migration.clearPersonalData';
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261031000000_phase30rd_owner_decisions';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
