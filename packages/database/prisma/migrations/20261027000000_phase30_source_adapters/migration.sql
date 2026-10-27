-- ===========================================================================
-- Phase 30 — Source Adapters & Initial Migration
-- ===========================================================================
--
-- THE MIGRATION & PROVENANCE CONTEXT, WIDENED FROM ONE KIND TO ITS REAL ONES
-- (DOMAIN_MODEL.md 16.5–16.6). Nothing is created that a delivered phase owns;
-- no table is added; the eighteen Phase-29 tables gain only what the in-scope
-- content kinds need, and every accepted invariant is kept.
--
-- CONTENT KINDS. `media.video` is joined by the kinds the authorised sources
-- actually yield: PUBLISHABLE `library.work`, `library.magazine`,
-- `library.magazine-issue`, `editorial.news`, `editorial.article` — each with
-- a Layer-4 publisher over its owning domain's public service — and
-- REVIEW-ONLY `fatwa.ruling` and `quran.translation`: religious material that
-- is preserved, normalised and reviewed as evidence, and that migration never
-- publishes. A manifest entry for a review-only revision is refused here
-- (51379), beneath the service's own refusal.
--
-- TYPED TARGETS, NEVER A TARGET PAIR. A manifest entry and a legacy mapping
-- name what they made by one typed, nullable foreign key per target table —
-- `videoId` (Phase 29) and now `workId`, `magazineId`, `magazineIssueId`,
-- `newsArticleId` and `articleId` — the SavedItem pattern. A legacy mapping
-- names EXACTLY one; a made entry names exactly one, in its revision's OWN
-- kind's column (51379); each is written once.
-- `targetStage` records how far the owning domain carried the record: `public`,
-- or `in-review` where that domain's own workflow needs a second person
-- (Editorial refuses self-approval), so the record becomes public only by the
-- domain's own decision. Phase-29 Video entries were all made public.
--
-- AUTHORISED SOURCES. Phase 29 modelled `authorised` and created none. An
-- authorised source must carry its written authorisation reference and date
-- (unchanged); now it must also name a real `https` base and no `*.invalid`
-- host — a fixture name never becomes a real one — and run under the
-- politeness floor: at least one second between requests, one at a time.
--
-- REFUSALS: 51371 (host) and 51379/51380 (entries and mappings) are extended;
-- no new number is used.
--
-- POSTURES FOR THE APPLICATION PRINCIPAL (grant-application-principal.sql):
--   the new legacy-mapping target columns join the columns it may never
--   UPDATE; entry target columns are written once, by trigger.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.
-- ===========================================================================

BEGIN TRY

BEGIN TRAN;

-- AlterTable — what a manifest entry made, by typed target.
ALTER TABLE [dbo].[MigrationManifestEntry] ADD
    [workId] NVARCHAR(36),
    [magazineId] NVARCHAR(36),
    [magazineIssueId] NVARCHAR(36),
    [newsArticleId] NVARCHAR(36),
    [articleId] NVARCHAR(36),
    [targetStage] NVARCHAR(16);

-- AlterTable — what a legacy URL resolves to, by typed target.
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD
    [workId] NVARCHAR(36),
    [magazineId] NVARCHAR(36),
    [magazineIssueId] NVARCHAR(36),
    [newsArticleId] NVARCHAR(36),
    [articleId] NVARCHAR(36);

-- AddForeignKey — NO ACTION, like every Migration key: nothing cascades.
ALTER TABLE [dbo].[MigrationManifestEntry] ADD CONSTRAINT [MigrationManifestEntry_workId_fkey] FOREIGN KEY ([workId]) REFERENCES [dbo].[Work]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationManifestEntry] ADD CONSTRAINT [MigrationManifestEntry_magazineId_fkey] FOREIGN KEY ([magazineId]) REFERENCES [dbo].[Magazine]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationManifestEntry] ADD CONSTRAINT [MigrationManifestEntry_magazineIssueId_fkey] FOREIGN KEY ([magazineIssueId]) REFERENCES [dbo].[MagazineIssue]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationManifestEntry] ADD CONSTRAINT [MigrationManifestEntry_newsArticleId_fkey] FOREIGN KEY ([newsArticleId]) REFERENCES [dbo].[NewsArticle]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationManifestEntry] ADD CONSTRAINT [MigrationManifestEntry_articleId_fkey] FOREIGN KEY ([articleId]) REFERENCES [dbo].[Article]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_workId_fkey] FOREIGN KEY ([workId]) REFERENCES [dbo].[Work]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_magazineId_fkey] FOREIGN KEY ([magazineId]) REFERENCES [dbo].[Magazine]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_magazineIssueId_fkey] FOREIGN KEY ([magazineIssueId]) REFERENCES [dbo].[MagazineIssue]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_newsArticleId_fkey] FOREIGN KEY ([newsArticleId]) REFERENCES [dbo].[NewsArticle]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MigrationLegacyMapping] ADD CONSTRAINT [MigrationLegacyMapping_articleId_fkey] FOREIGN KEY ([articleId]) REFERENCES [dbo].[Article]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- The Phase-29 value constraints that named one kind or one target go; their
-- widened successors (same names) follow once the new columns exist.
ALTER TABLE [dbo].[MigrationSource] DROP CONSTRAINT [MigrationSource_ck];
ALTER TABLE [dbo].[MigrationRecord] DROP CONSTRAINT [MigrationRecord_ck];
ALTER TABLE [dbo].[MigrationStagedRecord] DROP CONSTRAINT [MigrationStagedRecord_ck];
ALTER TABLE [dbo].[MigrationLegacyMapping] DROP CONSTRAINT [MigrationLegacyMapping_ck];
ALTER TABLE [dbo].[MigrationManifestEntry] DROP CONSTRAINT [MigrationManifestEntry_ck];

-- Every entry Phase 29 made, made a Video PUBLIC: the stage it would have
-- recorded, written once here with the entry trigger held, version unchanged
-- (a schema backfill, not an operator act). Statements naming the new
-- columns run through EXEC so they compile after the columns exist.
EXEC(N'DISABLE TRIGGER [dbo].[MigrationManifestEntryIntegrity] ON [dbo].[MigrationManifestEntry];');
EXEC(N'UPDATE [dbo].[MigrationManifestEntry] SET [targetStage] = N''public'' WHERE [videoId] IS NOT NULL AND [targetStage] IS NULL;');
EXEC(N'ENABLE TRIGGER [dbo].[MigrationManifestEntryIntegrity] ON [dbo].[MigrationManifestEntry];');

-- A source: the kinds in scope; an AUTHORISED source carries its written
-- reference and date, a real https base outside `*.invalid` (or none, for an
-- export), and the politeness floor — at least 1000 ms apart, one at a time.
-- Its host is a dotted lower-case DNS name with no empty label, so no
-- fully-qualified `x.invalid.` (trailing dot) slips past the `*.invalid` rule.
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

-- A legacy mapping: EXACTLY ONE typed target, a site-relative canonical path,
-- and the change trail of a disabled mapping.
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

-- An entry: at most one typed target, and a stage exactly when it names one;
-- what it made — its single target, the stage the domain carried it to, the
-- version and the path — is recorded exactly when it made it.
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

-- ===========================================================================
-- A host is set once; a FIXTURE source names only `*.fixture.invalid`, and an
-- AUTHORISED source never names a `*.invalid` host (51371).
-- ===========================================================================
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
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN [dbo].[MigrationSource] s ON s.[id] = i.[sourceId]
   WHERE s.[authorityKind] = N''authorised''
     AND (i.[host] COLLATE Latin1_General_BIN2 LIKE N''%.invalid''
          OR i.[host] COLLATE Latin1_General_BIN2 NOT LIKE N''%_.%''
          OR i.[host] COLLATE Latin1_General_BIN2 LIKE N''%[0-9]'')
 )
   THROW 51371, ''An authorised source names only real hosts, never *.invalid.'', 1;
END');

-- ===========================================================================
-- A legacy mapping names exactly its entry's target, keeps its address and
-- target, and only its state moves (51380).
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

-- ===========================================================================
-- An entry names an APPROVED, valid revision of a PUBLISHABLE kind and is
-- added only to a draft; its target is in its revision's OWN kind's column
-- (a Work for `library.work`, never a Video); it is published only while its
-- manifest is publishing and rolled back only while it is rolling back; what
-- it made is recorded once (51379).
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

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
