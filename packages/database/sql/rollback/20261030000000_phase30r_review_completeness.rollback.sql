-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Phase 30-R added optional visuals (lead images, a portrait, covers, a poster), source chronology, four more migration kinds with typed targets, entry modes, asset hosts and the public copy of an acquired image. It REFUSES while any row uses them, because content and migration evidence are never discarded to make a rollback fit; then it restores the Phase-30 trigger bodies and CHECKs exactly, drops what it added, then the migration record. No other row moves.
BEGIN TRY
BEGIN TRAN;
IF EXISTS (SELECT 1 FROM [dbo].[ArticleRevision] WHERE [leadAssetId] IS NOT NULL OR [sourcePublishedOn] IS NOT NULL)
   OR EXISTS (SELECT 1 FROM [dbo].[NewsArticleRevision] WHERE [leadAssetId] IS NOT NULL OR [sourcePublishedOn] IS NOT NULL)
   OR EXISTS (SELECT 1 FROM [dbo].[PressReleaseRevision] WHERE [leadAssetId] IS NOT NULL OR [sourcePublishedOn] IS NOT NULL)
   OR EXISTS (SELECT 1 FROM [dbo].[PageRevision] WHERE [leadAssetId] IS NOT NULL)
   OR EXISTS (SELECT 1 FROM [dbo].[Article] WHERE ISNULL([chronologyAt], '19000101') <> ISNULL([publishedAt], '19000101'))
   OR EXISTS (SELECT 1 FROM [dbo].[NewsArticle] WHERE ISNULL([chronologyAt], '19000101') <> ISNULL([publishedAt], '19000101'))
   OR EXISTS (SELECT 1 FROM [dbo].[PressRelease] WHERE ISNULL([chronologyAt], '19000101') <> ISNULL([publishedAt], '19000101'))
   OR EXISTS (SELECT 1 FROM [dbo].[Person] WHERE [portraitAssetId] IS NOT NULL)
   OR EXISTS (SELECT 1 FROM [dbo].[Edition] WHERE [coverAssetId] IS NOT NULL)
   OR EXISTS (SELECT 1 FROM [dbo].[MagazineIssue] WHERE [coverAssetId] IS NOT NULL)
   OR EXISTS (SELECT 1 FROM [dbo].[Video] WHERE [posterAssetId] IS NOT NULL)
   OR EXISTS (SELECT 1 FROM [dbo].[MigrationSource] WHERE [contentKind] IN (N'editorial.press-release', N'editorial.page', N'people.person', N'global.country'))
   OR EXISTS (SELECT 1 FROM [dbo].[MigrationRecord] WHERE [contentKind] IN (N'editorial.press-release', N'editorial.page', N'people.person', N'global.country'))
   OR EXISTS (SELECT 1 FROM [dbo].[MigrationStagedRecord] WHERE [contentKind] IN (N'editorial.press-release', N'editorial.page', N'people.person', N'global.country'))
   OR EXISTS (SELECT 1 FROM [dbo].[MigrationManifestEntry] WHERE [mode] <> N'create' OR [pageId] IS NOT NULL OR [pressReleaseId] IS NOT NULL OR [personId] IS NOT NULL OR [countryId] IS NOT NULL)
   OR EXISTS (SELECT 1 FROM [dbo].[MigrationLegacyMapping] WHERE [pageId] IS NOT NULL OR [pressReleaseId] IS NOT NULL OR [personId] IS NOT NULL OR [countryId] IS NOT NULL)
   OR EXISTS (SELECT 1 FROM [dbo].[MigrationSourceHost] WHERE [role] <> N'page')
   OR EXISTS (SELECT 1 FROM [dbo].[MigrationAssetProvenance] WHERE [publicAssetId] IS NOT NULL)
  THROW 50000, 'Phase-30-R rows exist: a visual, a source date, a new kind or target, a refresh entry, an asset host or a public copy. This disposable-proof rollback never discards content or migration evidence.', 1;
-- The Phase-30 trigger bodies, exactly as Phase 30 left them.
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
     WHERE ISNULL(e.[videoId], N'''') <> ISNULL(i.[videoId], N'''')
        OR ISNULL(e.[workId], N'''') <> ISNULL(i.[workId], N'''')
        OR ISNULL(e.[magazineId], N'''') <> ISNULL(i.[magazineId], N'''')
        OR ISNULL(e.[magazineIssueId], N'''') <> ISNULL(i.[magazineIssueId], N'''')
        OR ISNULL(e.[newsArticleId], N'''') <> ISNULL(i.[newsArticleId], N'''')
        OR ISNULL(e.[articleId], N'''') <> ISNULL(i.[articleId], N'''')
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
            AND s.[contentKind] IN (N''media.video'', N''library.work'', N''library.magazine'', N''library.magazine-issue'', N''editorial.news'', N''editorial.article''))
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
      OR (d.[videoId] IS NOT NULL AND ISNULL(i.[videoId], N'''') <> d.[videoId])
      OR (d.[workId] IS NOT NULL AND ISNULL(i.[workId], N'''') <> d.[workId])
      OR (d.[magazineId] IS NOT NULL AND ISNULL(i.[magazineId], N'''') <> d.[magazineId])
      OR (d.[magazineIssueId] IS NOT NULL AND ISNULL(i.[magazineIssueId], N'''') <> d.[magazineIssueId])
      OR (d.[newsArticleId] IS NOT NULL AND ISNULL(i.[newsArticleId], N'''') <> d.[newsArticleId])
      OR (d.[articleId] IS NOT NULL AND ISNULL(i.[articleId], N'''') <> d.[articleId])
      OR (d.[targetStage] IS NOT NULL AND ISNULL(i.[targetStage], N'''') <> d.[targetStage])
      OR (d.[targetVersion] IS NOT NULL AND ISNULL(i.[targetVersion], -1) <> d.[targetVersion])
      OR (d.[canonicalPath] IS NOT NULL AND ISNULL(i.[canonicalPath], N'''') COLLATE Latin1_General_BIN2 <> d.[canonicalPath] COLLATE Latin1_General_BIN2)
      OR i.[version] <> d.[version] + 1
      OR NOT ((d.[state] IN (N''pending'', N''publishing'') AND i.[state] IN (N''publishing'', N''published'', N''refused'') AND m.[state] = N''publishing'')
              OR (d.[state] IN (N''published'', N''rollback-refused'') AND i.[state] IN (N''rolled-back'', N''rollback-refused'') AND m.[state] = N''rolling-back''))
 )
   THROW 51379, ''An entry moves only in its manifest''''s own phase, and what it made is recorded once.'', 1;
END');
-- The Phase-30 value constraints, exactly.
ALTER TABLE [dbo].[MigrationSource] DROP CONSTRAINT [MigrationSource_ck];
ALTER TABLE [dbo].[MigrationRecord] DROP CONSTRAINT [MigrationRecord_ck];
ALTER TABLE [dbo].[MigrationStagedRecord] DROP CONSTRAINT [MigrationStagedRecord_ck];
ALTER TABLE [dbo].[MigrationLegacyMapping] DROP CONSTRAINT [MigrationLegacyMapping_ck];
ALTER TABLE [dbo].[MigrationManifestEntry] DROP CONSTRAINT [MigrationManifestEntry_ck];
-- Migration additions.
ALTER TABLE [dbo].[MigrationLegacyMapping] DROP CONSTRAINT [MigrationLegacyMapping_pageId_fkey], [MigrationLegacyMapping_pressReleaseId_fkey], [MigrationLegacyMapping_personId_fkey], [MigrationLegacyMapping_countryId_fkey];
ALTER TABLE [dbo].[MigrationLegacyMapping] DROP COLUMN [pageId], [pressReleaseId], [personId], [countryId];
ALTER TABLE [dbo].[MigrationManifestEntry] DROP CONSTRAINT [MigrationManifestEntry_pageId_fkey], [MigrationManifestEntry_pressReleaseId_fkey], [MigrationManifestEntry_personId_fkey], [MigrationManifestEntry_countryId_fkey], [MigrationManifestEntry_mode_df];
ALTER TABLE [dbo].[MigrationManifestEntry] DROP COLUMN [pageId], [pressReleaseId], [personId], [countryId], [mode];
EXEC(N'ALTER TABLE [dbo].[MigrationSource] ADD CONSTRAINT [MigrationSource_ck] CHECK (
    [key] COLLATE Latin1_General_BIN2 NOT LIKE N''%[^-a-z0-9]%'' AND LEN([key]) BETWEEN 3 AND 64
    AND LEN([name]) BETWEEN 1 AND 200
    AND [authorityKind] IN (N''fixture'', N''authorised'')
    AND [accessMethod] IN (N''http'', N''export'')
    AND [contentKind] IN (N''media.video'', N''library.work'', N''library.magazine'', N''library.magazine-issue'', N''editorial.news'', N''editorial.article'', N''fatwa.ruling'', N''quran.translation'')
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
    [contentKind] IN (N''media.video'', N''library.work'', N''library.magazine'', N''library.magazine-issue'', N''editorial.news'', N''editorial.article'', N''fatwa.ruling'', N''quran.translation'')
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
    AND [contentKind] IN (N''media.video'', N''library.work'', N''library.magazine'', N''library.magazine-issue'', N''editorial.news'', N''editorial.article'', N''fatwa.ruling'', N''quran.translation'')
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
     + CASE WHEN [articleId] IS NULL THEN 0 ELSE 1 END) = 1
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
    AND (CASE WHEN [videoId] IS NULL THEN 0 ELSE 1 END
         + CASE WHEN [workId] IS NULL THEN 0 ELSE 1 END
         + CASE WHEN [magazineId] IS NULL THEN 0 ELSE 1 END
         + CASE WHEN [magazineIssueId] IS NULL THEN 0 ELSE 1 END
         + CASE WHEN [newsArticleId] IS NULL THEN 0 ELSE 1 END
         + CASE WHEN [articleId] IS NULL THEN 0 ELSE 1 END) <= 1
    AND ([targetStage] IS NULL OR [targetStage] IN (N''public'', N''in-review''))
    AND (CASE WHEN [targetStage] IS NULL THEN 1 ELSE 0 END)
        = (CASE WHEN [videoId] IS NULL AND [workId] IS NULL AND [magazineId] IS NULL
                     AND [magazineIssueId] IS NULL AND [newsArticleId] IS NULL AND [articleId] IS NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [state] IN (N''published'', N''rolled-back'', N''rollback-refused'') THEN 1 ELSE 0 END)
        = (CASE WHEN (CASE WHEN [videoId] IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN [workId] IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN [magazineId] IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN [magazineIssueId] IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN [newsArticleId] IS NULL THEN 0 ELSE 1 END
                      + CASE WHEN [articleId] IS NULL THEN 0 ELSE 1 END) = 1
                     AND [targetStage] IS NOT NULL AND [targetVersion] IS NOT NULL
                     AND [canonicalPath] IS NOT NULL AND [publishedAt] IS NOT NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [state] = N''refused'' THEN 1 ELSE 0 END) = (CASE WHEN [refusal] IS NOT NULL THEN 1 ELSE 0 END)
    AND (CASE WHEN [state] = N''rolled-back'' THEN 1 ELSE 0 END) = (CASE WHEN [rolledBackAt] IS NOT NULL THEN 1 ELSE 0 END)
    AND ([canonicalPath] IS NULL OR ([canonicalPath] LIKE N''/%'' AND [canonicalPath] NOT LIKE N''//%''))
    AND ([targetVersion] IS NULL OR [targetVersion] >= 1)
    AND [version] >= 1
);');
ALTER TABLE [dbo].[MigrationAssetProvenance] DROP CONSTRAINT [MigrationAssetProvenance_public_ck], [MigrationAssetProvenance_publicAssetId_fkey];
ALTER TABLE [dbo].[MigrationAssetProvenance] DROP COLUMN [publicAssetId], [publicChecksum], [width], [height];
ALTER TABLE [dbo].[MigrationSourceHost] DROP CONSTRAINT [MigrationSourceHost_role_ck], [MigrationSourceHost_role_df];
ALTER TABLE [dbo].[MigrationSourceHost] DROP COLUMN [role];
-- Visuals.
ALTER TABLE [dbo].[Video] DROP CONSTRAINT [Video_poster_ck], [Video_posterAssetId_fkey];
ALTER TABLE [dbo].[Video] DROP COLUMN [posterAssetId], [posterWidth], [posterHeight];
ALTER TABLE [dbo].[MagazineIssue] DROP CONSTRAINT [MagazineIssue_cover_ck], [MagazineIssue_coverAssetId_fkey];
ALTER TABLE [dbo].[MagazineIssue] DROP COLUMN [coverAssetId], [coverWidth], [coverHeight];
ALTER TABLE [dbo].[Edition] DROP CONSTRAINT [Edition_cover_ck], [Edition_coverAssetId_fkey];
ALTER TABLE [dbo].[Edition] DROP COLUMN [coverAssetId], [coverWidth], [coverHeight];
ALTER TABLE [dbo].[Person] DROP CONSTRAINT [Person_portrait_ck], [Person_portraitAssetId_fkey];
ALTER TABLE [dbo].[Person] DROP COLUMN [portraitAssetId], [portraitWidth], [portraitHeight], [portraitCredit];
-- Editorial.
DROP INDEX [Article_state_chronologyAt_id_idx] ON [dbo].[Article];
ALTER TABLE [dbo].[Article] DROP CONSTRAINT [Article_chronology_ck];
ALTER TABLE [dbo].[Article] DROP COLUMN [chronologyAt];
DROP INDEX [NewsArticle_state_chronologyAt_id_idx] ON [dbo].[NewsArticle];
ALTER TABLE [dbo].[NewsArticle] DROP CONSTRAINT [NewsArticle_chronology_ck];
ALTER TABLE [dbo].[NewsArticle] DROP COLUMN [chronologyAt];
DROP INDEX [PressRelease_state_chronologyAt_id_idx] ON [dbo].[PressRelease];
ALTER TABLE [dbo].[PressRelease] DROP CONSTRAINT [PressRelease_chronology_ck];
ALTER TABLE [dbo].[PressRelease] DROP COLUMN [chronologyAt];
ALTER TABLE [dbo].[ArticleRevisionTranslation] DROP CONSTRAINT [ArticleRevisionTranslation_leadAlt_df];
ALTER TABLE [dbo].[ArticleRevisionTranslation] DROP COLUMN [leadAlt];
ALTER TABLE [dbo].[ArticleRevision] DROP CONSTRAINT [ArticleRevision_lead_ck], [ArticleRevision_leadAssetId_fkey];
ALTER TABLE [dbo].[ArticleRevision] DROP COLUMN [sourcePublishedOn], [leadAssetId], [leadWidth], [leadHeight], [leadCredit];
ALTER TABLE [dbo].[NewsArticleRevisionTranslation] DROP CONSTRAINT [NewsArticleRevisionTranslation_leadAlt_df];
ALTER TABLE [dbo].[NewsArticleRevisionTranslation] DROP COLUMN [leadAlt];
ALTER TABLE [dbo].[NewsArticleRevision] DROP CONSTRAINT [NewsArticleRevision_lead_ck], [NewsArticleRevision_leadAssetId_fkey];
ALTER TABLE [dbo].[NewsArticleRevision] DROP COLUMN [sourcePublishedOn], [leadAssetId], [leadWidth], [leadHeight], [leadCredit];
ALTER TABLE [dbo].[PressReleaseRevisionTranslation] DROP CONSTRAINT [PressReleaseRevisionTranslation_leadAlt_df];
ALTER TABLE [dbo].[PressReleaseRevisionTranslation] DROP COLUMN [leadAlt];
ALTER TABLE [dbo].[PressReleaseRevision] DROP CONSTRAINT [PressReleaseRevision_lead_ck], [PressReleaseRevision_leadAssetId_fkey];
ALTER TABLE [dbo].[PressReleaseRevision] DROP COLUMN [sourcePublishedOn], [leadAssetId], [leadWidth], [leadHeight], [leadCredit];
ALTER TABLE [dbo].[PageRevisionTranslation] DROP CONSTRAINT [PageRevisionTranslation_leadAlt_df];
ALTER TABLE [dbo].[PageRevisionTranslation] DROP COLUMN [leadAlt];
ALTER TABLE [dbo].[PageRevision] DROP CONSTRAINT [PageRevision_lead_ck], [PageRevision_leadAssetId_fkey];
ALTER TABLE [dbo].[PageRevision] DROP COLUMN [leadAssetId], [leadWidth], [leadHeight], [leadCredit];
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261030000000_phase30r_review_completeness';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
