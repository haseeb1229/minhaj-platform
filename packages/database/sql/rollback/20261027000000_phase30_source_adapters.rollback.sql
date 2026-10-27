-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Phase 30 widened Migration & Provenance from one content kind to eight, gave manifest entries and legacy mappings five more typed targets and entries a target stage. It REFUSES while any row names a kind other than `media.video`, a target other than a Video or an `in-review` stage — migration evidence is never discarded to make a rollback fit, and the Phase-29 rules could not hold it — then restores the three Phase-29 trigger bodies and the five Phase-29 CHECKs exactly, drops the ten new keys and eleven new columns (a Video entry's `public` stage goes with its column), then the migration record. No other owner's table or row moves.
BEGIN TRY
BEGIN TRAN;
IF EXISTS (SELECT 1 FROM [dbo].[MigrationSource] WHERE [contentKind] <> N'media.video')
   OR EXISTS (SELECT 1 FROM [dbo].[MigrationRecord] WHERE [contentKind] <> N'media.video')
   OR EXISTS (SELECT 1 FROM [dbo].[MigrationStagedRecord] WHERE [contentKind] <> N'media.video')
   OR EXISTS (SELECT 1 FROM [dbo].[MigrationManifestEntry] WHERE [workId] IS NOT NULL OR [magazineId] IS NOT NULL OR [magazineIssueId] IS NOT NULL OR [newsArticleId] IS NOT NULL OR [articleId] IS NOT NULL
              OR ([targetStage] IS NOT NULL AND [targetStage] <> N'public'))
   OR EXISTS (SELECT 1 FROM [dbo].[MigrationLegacyMapping] WHERE [workId] IS NOT NULL OR [magazineId] IS NOT NULL OR [magazineIssueId] IS NOT NULL OR [newsArticleId] IS NOT NULL OR [articleId] IS NOT NULL)
  THROW 50000, 'Phase-30 Migration & Provenance rows exist: a kind other than media.video, a non-Video target or an in-review stage. This disposable-proof rollback never discards migration evidence.', 1;
-- The Phase-29 trigger bodies, exactly as Phase 29 created them.
EXEC(N'ALTER TRIGGER [dbo].[MigrationSourceHostIntegrity] ON [dbo].[MigrationSourceHost] AFTER INSERT, UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM deleted)
   THROW 51371, ''A source host is never changed or removed.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN [dbo].[MigrationSource] s ON s.[id] = i.[sourceId]
   WHERE s.[authorityKind] = N''fixture''
     AND i.[host] COLLATE Latin1_General_BIN2 NOT LIKE N''%_.fixture.invalid''
 )
   THROW 51371, ''A fixture source names only *.fixture.invalid hosts.'', 1;
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
          WHERE s.[id] = i.[stagedRecordId] AND s.[review] = N''approved'' AND s.[validation] = N''valid'')
   )
     THROW 51379, ''An entry names an approved revision of the manifest''''s source and joins only a draft.'', 1;
   RETURN;
 END;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
   THROW 51379, ''An entry keeps its identity.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   JOIN [dbo].[MigrationPublishManifest] m ON m.[id] = i.[manifestId]
   WHERE d.[manifestId] <> i.[manifestId] OR d.[position] <> i.[position]
      OR d.[stagedRecordId] <> i.[stagedRecordId] OR d.[recordId] <> i.[recordId]
      OR (d.[videoId] IS NOT NULL AND ISNULL(i.[videoId], N'''') <> d.[videoId])
      OR (d.[targetVersion] IS NOT NULL AND ISNULL(i.[targetVersion], -1) <> d.[targetVersion])
      OR (d.[canonicalPath] IS NOT NULL AND ISNULL(i.[canonicalPath], N'''') COLLATE Latin1_General_BIN2 <> d.[canonicalPath] COLLATE Latin1_General_BIN2)
      OR i.[version] <> d.[version] + 1
      OR NOT ((d.[state] IN (N''pending'', N''publishing'') AND i.[state] IN (N''publishing'', N''published'', N''refused'') AND m.[state] = N''publishing'')
              OR (d.[state] IN (N''published'', N''rollback-refused'') AND i.[state] IN (N''rolled-back'', N''rollback-refused'') AND m.[state] = N''rolling-back''))
 )
   THROW 51379, ''An entry moves only in its manifest''''s own phase, and what it made is recorded once.'', 1;
END');
-- The widened CHECKs and the new keys go before the columns they name.
ALTER TABLE [dbo].[MigrationSource] DROP CONSTRAINT [MigrationSource_ck];
ALTER TABLE [dbo].[MigrationRecord] DROP CONSTRAINT [MigrationRecord_ck];
ALTER TABLE [dbo].[MigrationStagedRecord] DROP CONSTRAINT [MigrationStagedRecord_ck];
ALTER TABLE [dbo].[MigrationLegacyMapping] DROP CONSTRAINT [MigrationLegacyMapping_ck];
ALTER TABLE [dbo].[MigrationManifestEntry] DROP CONSTRAINT [MigrationManifestEntry_ck];
ALTER TABLE [dbo].[MigrationManifestEntry] DROP CONSTRAINT [MigrationManifestEntry_workId_fkey], [MigrationManifestEntry_magazineId_fkey], [MigrationManifestEntry_magazineIssueId_fkey], [MigrationManifestEntry_newsArticleId_fkey], [MigrationManifestEntry_articleId_fkey];
ALTER TABLE [dbo].[MigrationLegacyMapping] DROP CONSTRAINT [MigrationLegacyMapping_workId_fkey], [MigrationLegacyMapping_magazineId_fkey], [MigrationLegacyMapping_magazineIssueId_fkey], [MigrationLegacyMapping_newsArticleId_fkey], [MigrationLegacyMapping_articleId_fkey];
ALTER TABLE [dbo].[MigrationManifestEntry] DROP COLUMN [workId], [magazineId], [magazineIssueId], [newsArticleId], [articleId], [targetStage];
ALTER TABLE [dbo].[MigrationLegacyMapping] DROP COLUMN [workId], [magazineId], [magazineIssueId], [newsArticleId], [articleId];
-- The Phase-29 CHECKs, exactly as Phase 29 created them, re-validated over every row.
ALTER TABLE [dbo].[MigrationSource] ADD CONSTRAINT [MigrationSource_ck] CHECK (
    [key] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^-a-z0-9]%' AND LEN([key]) BETWEEN 3 AND 64
    AND LEN([name]) BETWEEN 1 AND 200
    AND [authorityKind] IN (N'fixture', N'authorised')
    AND [accessMethod] IN (N'http', N'export')
    AND [contentKind] IN (N'media.video')
    AND [state] IN (N'active', N'inactive')
    AND [minIntervalMs] BETWEEN 0 AND 600000
    AND [maxConcurrency] BETWEEN 1 AND 4
    AND [maxAttempts] BETWEEN 1 AND 6
    AND [timeoutMs] BETWEEN 1000 AND 60000
    AND [maxBodyBytes] BETWEEN 1024 AND 8388608
    AND [maxRedirects] BETWEEN 0 AND 5
    AND [version] >= 1
    AND (([accessMethod] = N'http' AND [baseUrl] IS NOT NULL)
         OR ([accessMethod] = N'export' AND [baseUrl] IS NULL))
    AND (([authorityKind] = N'fixture' AND [authorisationReference] IS NULL AND [authorisedOn] IS NULL
          AND ([baseUrl] IS NULL
               OR ([baseUrl] COLLATE Latin1_General_BIN2 LIKE N'http://%'
                   AND (CASE WHEN CHARINDEX(N'/', [baseUrl], 8) > 8 THEN SUBSTRING([baseUrl], 8, CHARINDEX(N'/', [baseUrl], 8) - 8) ELSE N'' END) COLLATE Latin1_General_BIN2 LIKE N'%_.fixture.invalid'
                   AND (CASE WHEN CHARINDEX(N'/', [baseUrl], 8) > 8 THEN SUBSTRING([baseUrl], 8, CHARINDEX(N'/', [baseUrl], 8) - 8) ELSE N'' END) COLLATE Latin1_General_BIN2 NOT LIKE N'%[^-a-z0-9.]%')
               OR ([baseUrl] COLLATE Latin1_General_BIN2 LIKE N'https://%'
                   AND (CASE WHEN CHARINDEX(N'/', [baseUrl], 9) > 9 THEN SUBSTRING([baseUrl], 9, CHARINDEX(N'/', [baseUrl], 9) - 9) ELSE N'' END) COLLATE Latin1_General_BIN2 LIKE N'%_.fixture.invalid'
                   AND (CASE WHEN CHARINDEX(N'/', [baseUrl], 9) > 9 THEN SUBSTRING([baseUrl], 9, CHARINDEX(N'/', [baseUrl], 9) - 9) ELSE N'' END) COLLATE Latin1_General_BIN2 NOT LIKE N'%[^-a-z0-9.]%')))
         OR ([authorityKind] = N'authorised' AND [authorisationReference] IS NOT NULL AND [authorisedOn] IS NOT NULL))
);
ALTER TABLE [dbo].[MigrationRecord] ADD CONSTRAINT [MigrationRecord_ck] CHECK (
    [contentKind] IN (N'media.video')
    AND [status] IN (N'discovered', N'fetched', N'staged', N'rejected', N'errored', N'excluded', N'approved', N'published', N'merged')
    AND [observed] IN (N'present', N'missing')
    AND ([disappearance] IS NULL OR [disappearance] IN (N'withdrawn', N'moved', N'source-error', N'transient-failure', N'access-failure', N'unresolved'))
    AND ([observed] = N'missing' OR ([disappearance] IS NULL AND [classifiedByUserId] IS NULL))
    AND (CASE WHEN [disappearance] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [classifiedByUserId] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [classifiedByUserId] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [classifiedAt] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [status] = N'merged' THEN 1 ELSE 0 END) = (CASE WHEN [mergedIntoRecordId] IS NOT NULL THEN 1 ELSE 0 END)
    AND ([mergedIntoRecordId] IS NULL OR [mergedIntoRecordId] <> [id])
    AND LEN([externalKey]) BETWEEN 1 AND 400
    AND [version] >= 1
);
ALTER TABLE [dbo].[MigrationStagedRecord] ADD CONSTRAINT [MigrationStagedRecord_ck] CHECK (
    [revision] >= 1
    AND [contentKind] IN (N'media.video')
    AND LEN([title]) BETWEEN 1 AND 240
    AND ISJSON([payload]) = 1
    AND LEN([payload]) <= 200000
    AND [payloadChecksum] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^0-9a-f]%'
    AND [inputChecksum] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^0-9a-f]%'
    AND [validation] IN (N'valid', N'invalid')
    AND ([issues] IS NULL OR ISJSON([issues]) = 1)
    AND [personalData] IN (N'none', N'flagged')
    AND [review] IN (N'pending', N'approved', N'rejected', N'superseded')
    AND ([review] <> N'approved' OR ([validation] = N'valid' AND [personalData] = N'none'))
    AND ([review] NOT IN (N'approved', N'rejected') OR ([reviewedByUserId] IS NOT NULL AND [reviewedAt] IS NOT NULL))
    AND [version] >= 1
);
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_ck] CHECK (
    [videoId] IS NOT NULL
    AND [state] IN (N'active', N'disabled')
    AND [canonicalPath] LIKE N'/%' AND [canonicalPath] NOT LIKE N'//%'
    AND [legacyUrlDigest] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^0-9a-f]%'
    AND (CASE WHEN [changedAt] IS NULL THEN 1 ELSE 0 END) = (CASE WHEN [changedByUserId] IS NULL THEN 1 ELSE 0 END)
    AND ([state] = N'active' OR [changedAt] IS NOT NULL)
    AND [version] >= 1
);
ALTER TABLE [dbo].[MigrationManifestEntry] ADD CONSTRAINT [MigrationManifestEntry_ck] CHECK (
    [position] >= 0
    AND [state] IN (N'pending', N'publishing', N'published', N'refused', N'rolled-back', N'rollback-refused')
    AND (CASE WHEN [state] IN (N'published', N'rolled-back', N'rollback-refused') THEN 1 ELSE 0 END) = (CASE WHEN [videoId] IS NOT NULL AND [targetVersion] IS NOT NULL AND [canonicalPath] IS NOT NULL AND [publishedAt] IS NOT NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [state] = N'refused' THEN 1 ELSE 0 END) = (CASE WHEN [refusal] IS NOT NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [state] = N'rolled-back' THEN 1 ELSE 0 END) = (CASE WHEN [rolledBackAt] IS NOT NULL THEN 1 ELSE 0 END)
    AND ([canonicalPath] IS NULL OR ([canonicalPath] LIKE N'/%' AND [canonicalPath] NOT LIKE N'//%'))
    AND ([targetVersion] IS NULL OR [targetVersion] >= 1)
    AND [version] >= 1
);
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261027000000_phase30_source_adapters';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
