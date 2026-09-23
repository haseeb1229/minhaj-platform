-- ===========================================================================
-- Phase 17 — Search Foundation
-- ===========================================================================
--
-- DERIVED STATE. These tables hold a rebuildable projection of what Taxonomy,
-- People & Contributors, Editorial and Library already publish, and the durable
-- operational state of keeping it current (ARCHITECTURE.md 8.5). Nothing here is
-- authoritative for any business fact.
--
-- FAILS CLOSED ON AN ENGINE WITHOUT FULL-TEXT SEARCH. The official SQL Server
-- container images ship without the component; `docker/sqlserver/Dockerfile`
-- adds it. Refusing here, before anything is created, is what stops a database
-- from acquiring half of this schema and a search that can never answer.
IF CAST(FULLTEXTSERVICEPROPERTY('IsFullTextInstalled') AS INT) <> 1
    THROW 50017, N'SQL Server Full-Text Search is not installed on this instance. Phase 17 requires it (docker/sqlserver/Dockerfile).', 1;

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[SearchIndexRequest] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [scopeKind] NVARCHAR(16) NOT NULL,
    [scopeId] NVARCHAR(36) NOT NULL,
    [requestedAt] DATETIME2 NOT NULL CONSTRAINT [SearchIndexRequest_requestedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [SearchIndexRequest_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[SearchIndexScope] (
    [scopeKind] NVARCHAR(16) NOT NULL,
    [scopeId] NVARCHAR(36) NOT NULL,
    [status] NVARCHAR(16) NOT NULL,
    [generation] INT NOT NULL,
    [attempts] INT NOT NULL,
    [dueAt] DATETIME2 NOT NULL,
    [requestedAt] DATETIME2,
    [leaseToken] NVARCHAR(36),
    [leaseUntil] DATETIME2,
    [indexedAt] DATETIME2,
    [indexedStamp] NVARCHAR(64),
    [failureCategory] NVARCHAR(32),
    [failedAt] DATETIME2,
    CONSTRAINT [SearchIndexScope_pkey] PRIMARY KEY CLUSTERED ([scopeKind],[scopeId])
);

-- CreateTable
CREATE TABLE [dbo].[SearchDocument] (
    [id] INT NOT NULL IDENTITY(1,1),
    [scopeKind] NVARCHAR(16) NOT NULL,
    [scopeId] NVARCHAR(36) NOT NULL,
    [kind] NVARCHAR(24) NOT NULL,
    [resourceId] NVARCHAR(36) NOT NULL,
    [textLanguage] NVARCHAR(16) NOT NULL,
    [contentLanguage] NVARCHAR(16),
    [title] NVARCHAR(300) NOT NULL,
    [summary] NVARCHAR(600) NOT NULL,
    [matchEnglish] NVARCHAR(max),
    [matchArabic] NVARCHAR(max),
    [matchUrdu] NVARCHAR(max),
    [matchOther] NVARCHAR(max),
    [year] SMALLINT,
    [checksum] CHAR(64) NOT NULL,
    [indexedAt] DATETIME2 NOT NULL,
    CONSTRAINT [SearchDocument_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SearchDocument_kind_resourceId_textLanguage_key] UNIQUE NONCLUSTERED ([kind],[resourceId],[textLanguage])
);

-- CreateTable
CREATE TABLE [dbo].[SearchDocumentTopic] (
    [documentId] INT NOT NULL,
    [topicId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [SearchDocumentTopic_pkey] PRIMARY KEY CLUSTERED ([documentId],[topicId])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SearchIndexScope_status_dueAt_scopeKind_scopeId_idx] ON [dbo].[SearchIndexScope]([status], [dueAt], [scopeKind], [scopeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SearchDocument_scopeKind_scopeId_idx] ON [dbo].[SearchDocument]([scopeKind], [scopeId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SearchDocumentTopic_topicId_documentId_idx] ON [dbo].[SearchDocumentTopic]([topicId], [documentId]);

-- AddForeignKey
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_scopeKind_scopeId_fkey] FOREIGN KEY ([scopeKind], [scopeId]) REFERENCES [dbo].[SearchIndexScope]([scopeKind],[scopeId]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SearchDocumentTopic] ADD CONSTRAINT [SearchDocumentTopic_documentId_fkey] FOREIGN KEY ([documentId]) REFERENCES [dbo].[SearchDocument]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- ---------------------------------------------------------------------------
-- The closed vocabularies, held by the database rather than by the writer.
--
-- The kinds are EXACTLY the Phase-17 inventory. A later searchable domain adds
-- its own kind in its own migration; nothing here is pre-created for it.
-- ---------------------------------------------------------------------------
ALTER TABLE [dbo].[SearchIndexRequest] ADD CONSTRAINT [SearchIndexRequest_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work'));
ALTER TABLE [dbo].[SearchIndexRequest] ADD CONSTRAINT [SearchIndexRequest_scopeId_ck] CHECK (LEN([scopeId]) > 0);
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_scopeKind_ck] CHECK ([scopeKind] IN (N'topic',N'person',N'article',N'page',N'work'));
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_status_ck] CHECK ([status] IN (N'pending',N'current',N'failed'));
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_generation_ck] CHECK ([generation] > 0);
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_attempts_ck] CHECK ([attempts] >= 0);
-- A lease is a token AND an expiry, or neither: half of one could never be
-- settled by anybody and would never expire.
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_lease_ck] CHECK (([leaseToken] IS NULL AND [leaseUntil] IS NULL) OR ([leaseToken] IS NOT NULL AND [leaseUntil] IS NOT NULL));
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_failure_ck] CHECK ([failureCategory] IS NULL OR [failureCategory] IN (N'source-unavailable',N'invalid-projection',N'index-write-failed'));
-- An exhausted scope always says why.
ALTER TABLE [dbo].[SearchIndexScope] ADD CONSTRAINT [SearchIndexScope_failed_ck] CHECK ([status] <> N'failed' OR ([failureCategory] IS NOT NULL AND [failedAt] IS NOT NULL));
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_kind_ck] CHECK ([kind] IN (N'topic',N'person',N'article',N'page',N'work',N'edition',N'book-translation'));
-- A kind is projected only within its own scope: an Article can never be filed
-- under a Work's scope and survive that Work's removal.
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_scope_ck] CHECK (([kind] IN (N'edition',N'book-translation') AND [scopeKind] = N'work') OR ([kind] NOT IN (N'edition',N'book-translation') AND [scopeKind] = [kind]));
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_title_ck] CHECK (LEN([title]) > 0);
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_year_ck] CHECK ([year] IS NULL OR [year] BETWEEN 1 AND 9999);
-- EXACTLY ONE matching column, so a document is tokenised by exactly one word
-- breaker and can be neither unsearchable nor counted twice.
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_match_ck] CHECK (
    (CASE WHEN [matchEnglish] IS NULL THEN 0 ELSE 1 END)
  + (CASE WHEN [matchArabic] IS NULL THEN 0 ELSE 1 END)
  + (CASE WHEN [matchUrdu] IS NULL THEN 0 ELSE 1 END)
  + (CASE WHEN [matchOther] IS NULL THEN 0 ELSE 1 END) = 1);
ALTER TABLE [dbo].[SearchDocument] ADD CONSTRAINT [SearchDocument_checksum_ck] CHECK (LEN([checksum]) = 64);

-- ---------------------------------------------------------------------------
-- Permissions — the two keys the search operations surface consumes.
--
-- READ AND OPERATE ARE SEPARATE, as every pair in the catalogue is: seeing
-- indexing lag and failures and changing what the indexer does next are
-- different authorities (packages/contracts/src/identity/permissions.ts).
-- ---------------------------------------------------------------------------
INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'search.read', N'View search indexing lag and failures.'),
    (N'search.operate', N'Retry failed search indexing, and rebuild or reconcile the search index.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

-- ===========================================================================
-- EXTENDING THE PROTECTED PLATFORM ADMINISTRATOR BUNDLE
-- ===========================================================================
--
-- The protected bundle is the WHOLE catalogue, so appending permissions widens
-- what a live administrator may do. That is a privilege change, and it costs
-- what every earlier phase paid: the holders' sessions and step-up grants are
-- revoked in the SAME transaction that changes the bundle
-- (SECURITY_BASELINE.md 8.1). On a fresh database every count is zero.

DECLARE @searchAdminRoleId NVARCHAR(36);
DECLARE @searchAddedKeys NVARCHAR(200);

SELECT @searchAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @searchAdminRoleId IS NOT NULL
BEGIN
    SELECT @searchAddedKeys = STRING_AGG(p.[key], N' ') WITHIN GROUP (ORDER BY p.[key])
    FROM [dbo].[Permission] p
    WHERE p.[key] IN (N'search.read', N'search.operate')
      AND NOT EXISTS (
          SELECT 1 FROM [dbo].[RolePermission] rp
          WHERE rp.[roleId] = @searchAdminRoleId AND rp.[permissionKey] = p.[key]
      );

    IF @searchAddedKeys IS NOT NULL AND LEN(@searchAddedKeys) > 0
    BEGIN
        INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
        SELECT @searchAdminRoleId, p.[key]
        FROM [dbo].[Permission] p
        WHERE p.[key] IN (N'search.read', N'search.operate')
          AND NOT EXISTS (
              SELECT 1 FROM [dbo].[RolePermission] rp
              WHERE rp.[roleId] = @searchAdminRoleId AND rp.[permissionKey] = p.[key]
          );

        -- Grants before sessions, so the count each statement reports is the
        -- one it actually removed rather than whatever a cascade took first.
        DELETE FROM [dbo].[StepUpGrant]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @searchAdminRoleId AND ra.[revokedAt] IS NULL
        );

        DELETE FROM [dbo].[Session]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @searchAdminRoleId AND ra.[revokedAt] IS NULL
        );

        -- WHICH KEYS WERE ADDED, and nothing else (SECURITY_BASELINE.md 13.4).
        INSERT INTO [dbo].[AuditLog]
            ([id], [actorType], [actorId], [action], [targetType], [targetId],
             [afterState], [authorisingSource])
        VALUES
            (NEWID(), N'migration', NULL, N'search.permissions.provisioned', N'role',
             @searchAdminRoleId,
             N'{"added":"' + @searchAddedKeys + N'"}',
             N'20260923000000_phase17_search_foundation');
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

-- ===========================================================================
-- THE FULL-TEXT CATALOGUE AND INDEX
-- ===========================================================================
--
-- OUTSIDE THE TRANSACTION, because SQL Server refuses full-text DDL inside a
-- user transaction. Each statement is guarded, so re-running this migration
-- after a failure between the two halves completes it rather than colliding
-- with what the first attempt already created.
--
-- ACCENT INSENSITIVE, so "cafe" finds "café" and a diacritic typed or omitted
-- does not decide whether Arabic-script text matches.
--
-- ONE COLUMN PER WORD BREAKER, measured rather than assumed (DELIVERY_PLAN.md
-- Phase 17 tokenisation gate; the findings are recorded in TECH_STACK.md §10):
--
--   matchEnglish  1033  English  — inflection (library ↔ libraries)
--   matchArabic   1025  Arabic   — clitics, the definite article, ة/ه, harakat
--   matchUrdu     1056  Urdu     — Urdu-script tokenisation
--   matchOther       0  Neutral  — any other content language, by whitespace
--
-- STOPLIST OFF. The system stoplist treats common Urdu words as noise, and a
-- query made only of noise words matches nothing at all; with no stoplist a
-- query means what it says, in every language equally.
--
-- CHANGE TRACKING AUTO. Population is asynchronous by nature, and this is the
-- staleness window the stale-index rule exists to handle (ARCHITECTURE.md 8.5).
IF NOT EXISTS (SELECT 1 FROM sys.fulltext_catalogs WHERE [name] = N'SearchCatalog')
    CREATE FULLTEXT CATALOG [SearchCatalog] WITH ACCENT_SENSITIVITY = OFF;

IF NOT EXISTS (SELECT 1 FROM sys.fulltext_indexes WHERE [object_id] = OBJECT_ID(N'[dbo].[SearchDocument]'))
    CREATE FULLTEXT INDEX ON [dbo].[SearchDocument] (
        [matchEnglish] LANGUAGE 1033,
        [matchArabic] LANGUAGE 1025,
        [matchUrdu] LANGUAGE 1056,
        [matchOther] LANGUAGE 0
    )
    KEY INDEX [SearchDocument_pkey] ON [SearchCatalog]
    WITH CHANGE_TRACKING = AUTO, STOPLIST = OFF;
