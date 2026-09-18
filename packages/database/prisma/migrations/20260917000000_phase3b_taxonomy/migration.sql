BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- Phase 3B - Taxonomy
-- ===========================================================================
--
-- Topic, its per-interface-locale translations, the CONTENT language reference
-- data and Tag. No topic-assignment table of any kind: DOMAIN_MODEL.md 6.2
-- prohibits the polymorphic pair and requires a typed junction owned by the
-- context that owns the TARGET, and no such context has shipped.
--
-- WHAT IS NOT ASCII IN THIS FILE. The seeded `nativeName` values below are
-- written in Urdu and Arabic script, because a content-language catalogue that
-- can only name a language in English is unusable to the readers it exists for.
-- `db:migrate:test` reads them back and asserts the script survived, so an
-- encoding problem is a failing gate rather than three corrupted rows nobody
-- looks at.

-- CreateTable
CREATE TABLE [dbo].[Topic] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [Topic_id_df] DEFAULT CONVERT(nvarchar(36), NEWID()),
    [slug] NVARCHAR(160) NOT NULL,
    [parentId] NVARCHAR(36),
    [position] INT NOT NULL,
    [status] NVARCHAR(16) NOT NULL,
    [system] BIT NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Topic_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Topic_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Topic_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Topic_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- A self-parent is refused by the DATABASE, not by a validator.
--
-- It is the one cycle a CHECK constraint can express, it costs nothing, and it
-- holds for every writer including a migration and an operator session. The
-- longer cycles need to observe other rows, which a CHECK cannot do; the
-- trigger below covers those.
ALTER TABLE [dbo].[Topic] ADD CONSTRAINT [Topic_not_self_parent_ck]
    CHECK ([parentId] IS NULL OR [parentId] <> [id]);

-- CreateTable
CREATE TABLE [dbo].[TopicTranslation] (
    [topicId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [description] NVARCHAR(500),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TopicTranslation_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [TopicTranslation_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [TopicTranslation_pkey] PRIMARY KEY CLUSTERED ([topicId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[Language] (
    [code] NVARCHAR(16) NOT NULL,
    [englishName] NVARCHAR(120) NOT NULL,
    [nativeName] NVARCHAR(120) NOT NULL,
    [direction] NVARCHAR(3) NOT NULL,
    [status] NVARCHAR(16) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Language_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Language_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Language_pkey] PRIMARY KEY CLUSTERED ([code])
);

-- CreateTable
CREATE TABLE [dbo].[Tag] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [Tag_id_df] DEFAULT CONVERT(nvarchar(36), NEWID()),
    [slug] NVARCHAR(120) NOT NULL,
    [label] NVARCHAR(120) NOT NULL,
    [status] NVARCHAR(16) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Tag_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Tag_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Tag_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Tag_slug_key] UNIQUE NONCLUSTERED ([slug])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Topic_parentId_position_idx] ON [dbo].[Topic]([parentId], [position]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Tag_status_slug_idx] ON [dbo].[Tag]([status], [slug]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Tag_status_label_idx] ON [dbo].[Tag]([status], [label]);

-- AddForeignKey
--
-- NO ACTION on the self-reference. SQL Server refuses a cascading one outright,
-- and NO ACTION is also what the model wants: nothing deletes a Topic, so there
-- is no subtree fate to decide.
ALTER TABLE [dbo].[Topic] ADD CONSTRAINT [Topic_parentId_fkey] FOREIGN KEY ([parentId]) REFERENCES [dbo].[Topic]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- The ONE cascade path in this migration, and it describes what a reviewed
-- rollback does rather than anything an administrator can cause.
ALTER TABLE [dbo].[TopicTranslation] ADD CONSTRAINT [TopicTranslation_topicId_fkey] FOREIGN KEY ([topicId]) REFERENCES [dbo].[Topic]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- ===========================================================================
-- HIERARCHY INTEGRITY
-- ===========================================================================
--
-- A cycle is not a property of one row, so no constraint can express it. Two
-- administrators moving A under B and B under A at the same moment each
-- validate against a tree that is about to stop being true, and an application
-- check — however careful — reads a state the other transaction is in the
-- middle of replacing.
--
-- The trigger takes the SAME transaction-owned application lock every hierarchy
-- write takes, so the two are serialised: the first holds it through commit,
-- and the second then evaluates the shape the first actually left behind. It is
-- the pattern the Phase-2 final-administrator invariant already uses.
--
-- 51030 is the cycle refusal. 51031 means the lock itself could not be obtained
-- and therefore fails closed. 51032 is the depth bound.
--
-- THE DEPTH BOUND IS AN ENGINEERING BOUND. No accepted document limits the
-- shape of the taxonomy; what the bound does is give the recursive reads a
-- known ceiling, so hierarchy query cost is a fact rather than a hope. It is
-- stated here and in `packages/contracts/src/taxonomy/values.ts`, and a test
-- asserts the two agree.

EXEC sp_executesql N'
CREATE TRIGGER [dbo].[TaxonomyTopicHierarchy]
ON [dbo].[Topic]
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM inserted)
        RETURN;

    DECLARE @maxDepth int = 8;

    DECLARE @lockResult int;
    EXEC @lockResult = sys.sp_getapplock
        @Resource = N''minhaj:taxonomy-topic-hierarchy'',
        @LockMode = ''Exclusive'',
        @LockOwner = ''Transaction'',
        @LockTimeout = 15000;

    IF @lockResult < 0
        THROW 51031, N''The Topic hierarchy lock could not be acquired.'', 1;

    DECLARE @cycles int;
    DECLARE @ancestors int;
    DECLARE @height int;

    -- UPWARD from every affected row. The walk stops the moment it reaches the
    -- row it started from, so a cycle TERMINATES and is then visible as a row
    -- whose ancestor is itself, rather than recursing until the server gives up.
    WITH [ancestry] AS (
        SELECT i.[id] AS [startId], p.[id] AS [ancestorId], p.[parentId], 1 AS [level]
        FROM inserted i
        INNER JOIN [dbo].[Topic] p ON p.[id] = i.[parentId]
        UNION ALL
        SELECT a.[startId], p.[id], p.[parentId], a.[level] + 1
        FROM [ancestry] a
        INNER JOIN [dbo].[Topic] p ON p.[id] = a.[parentId]
        WHERE a.[ancestorId] <> a.[startId] AND a.[level] <= @maxDepth
    )
    SELECT @cycles    = SUM(CASE WHEN [ancestorId] = [startId] THEN 1 ELSE 0 END),
           @ancestors = MAX([level])
    FROM [ancestry]
    OPTION (MAXRECURSION 100);

    IF ISNULL(@cycles, 0) > 0
        THROW 51030, N''A Topic cannot be moved beneath its own descendant.'', 1;

    -- DOWNWARD, because moving a SUBTREE deepens every node inside it. Checking
    -- only the moved row would accept a move that pushes its descendants past
    -- the bound.
    WITH [descent] AS (
        SELECT i.[id] AS [nodeId], 1 AS [height]
        FROM inserted i
        UNION ALL
        SELECT c.[id], d.[height] + 1
        FROM [descent] d
        INNER JOIN [dbo].[Topic] c ON c.[parentId] = d.[nodeId]
        WHERE d.[height] <= @maxDepth
    )
    SELECT @height = MAX([height])
    FROM [descent]
    OPTION (MAXRECURSION 100);

    -- The two maxima are combined across the affected rows. For a single-row
    -- move that is exact; for a reorder every affected row is a sibling at one
    -- depth, so it is exact there too. Any other multi-row shape can only
    -- OVER-report, which refuses rather than admits.
    IF ISNULL(@ancestors, 0) + ISNULL(@height, 1) > @maxDepth
        THROW 51032, N''The Topic hierarchy may not exceed the accepted depth.'', 1;
END;
';

-- ===========================================================================
-- THE FALLBACK TRANSLATION IS NOT OPTIONAL
-- ===========================================================================
--
-- Resolving a Topic in any interface locale must yield a name; that is only
-- TOTAL if the fallback row always exists. `en` is the fallback because
-- ROUTE_MAP.md 1.1 fixes it as the final step of locale resolution.
--
-- Enforced here as well as in the adapter because this is a property of the
-- DATA. An invariant enforced only by its caller is an invariant one new caller
-- removes, and the caller that removes it leaves topics that render as nothing
-- in a language the maintainer may not read.
--
-- The join to `Topic` is what keeps a reviewed rollback working: when the parent
-- row is gone the cascade is deleting the translations WITH it, and there is no
-- Topic left that needs a fallback.

EXEC sp_executesql N'
CREATE TRIGGER [dbo].[TaxonomyTopicFallback]
ON [dbo].[TopicTranslation]
AFTER DELETE, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (SELECT 1 FROM deleted)
        RETURN;

    IF EXISTS (
        SELECT 1
        FROM deleted d
        INNER JOIN [dbo].[Topic] t ON t.[id] = d.[topicId]
        WHERE NOT EXISTS (
            SELECT 1 FROM [dbo].[TopicTranslation] tr
            WHERE tr.[topicId] = d.[topicId] AND tr.[locale] = N''en''
        )
    )
        THROW 51033, N''A Topic must keep its fallback translation.'', 1;
END;
';

-- ===========================================================================
-- FOUNDATION DATA - the Taxonomy permission vocabulary
-- ===========================================================================
--
-- Appended by the OWNING phase, which is the rule the catalogue exists to
-- demonstrate. Phase 2 seeded Identity's and the system surfaces' vocabulary
-- and stopped there; these two keys arrive with the surfaces that need them.
-- `quran.*`, `hadith.*`, `fatwa.*` and the rest still belong to contexts that
-- do not exist.
--
-- INSERT ... WHERE NOT EXISTS rather than MERGE, exactly as Phase 2 does: MERGE
-- is not used anywhere in this repository, and a re-run of a migration is not a
-- concurrency scenario.

INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'taxonomy.read',       N'View canonical topics, content languages and tags.'),
    (N'taxonomy.administer', N'Create and change canonical topics, their translations, content languages and tags.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

-- ===========================================================================
-- EXTENDING THE PROTECTED PLATFORM ADMINISTRATOR BUNDLE
-- ===========================================================================
--
-- The protected bundle is the WHOLE catalogue, so appending a permission widens
-- what a live administrator may do. That is a privilege change, and Phase 2
-- fixed what a privilege change costs: the holders' sessions and step-up grants
-- are revoked in the SAME transaction that changes the bundle
-- (SECURITY_BASELINE.md 8.1).
--
-- Doing it here rather than leaving it to a runtime path is the point. The
-- protected role is runtime-immutable — no application code can re-bundle it —
-- so a migration is the only place this can happen, and it happens under review
-- rather than through a screen.
--
-- On a fresh database every count below is zero and nothing is revoked. On a
-- database with a live administrator, that administrator signs in again and
-- their next session carries the new authority. Live authorisation would refuse
-- a stale one anyway; revoking means there is nothing left to refuse.

DECLARE @taxonomyAdminRoleId NVARCHAR(36);
DECLARE @taxonomyAddedKeys NVARCHAR(200);

SELECT @taxonomyAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @taxonomyAdminRoleId IS NOT NULL
BEGIN
    SELECT @taxonomyAddedKeys = STRING_AGG(p.[key], N' ') WITHIN GROUP (ORDER BY p.[key])
    FROM [dbo].[Permission] p
    WHERE p.[key] IN (N'taxonomy.read', N'taxonomy.administer')
      AND NOT EXISTS (
          SELECT 1 FROM [dbo].[RolePermission] rp
          WHERE rp.[roleId] = @taxonomyAdminRoleId AND rp.[permissionKey] = p.[key]
      );

    IF @taxonomyAddedKeys IS NOT NULL AND LEN(@taxonomyAddedKeys) > 0
    BEGIN
        INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
        SELECT @taxonomyAdminRoleId, p.[key]
        FROM [dbo].[Permission] p
        WHERE p.[key] IN (N'taxonomy.read', N'taxonomy.administer')
          AND NOT EXISTS (
              SELECT 1 FROM [dbo].[RolePermission] rp
              WHERE rp.[roleId] = @taxonomyAdminRoleId AND rp.[permissionKey] = p.[key]
          );

        -- Grants before sessions, so the count each statement reports is the
        -- one it actually removed rather than whatever a cascade took first.
        DELETE FROM [dbo].[StepUpGrant]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @taxonomyAdminRoleId AND ra.[revokedAt] IS NULL
        );

        DELETE FROM [dbo].[Session]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @taxonomyAdminRoleId AND ra.[revokedAt] IS NULL
        );

        -- WHICH KEYS WERE ADDED, and nothing else. Not a snapshot of the whole
        -- bundle: an audit payload that carried every permission a role holds
        -- would be a second copy of the privilege model in a table with
        -- different retention (SECURITY_BASELINE.md 13.4).
        INSERT INTO [dbo].[AuditLog]
            ([id], [actorType], [actorId], [action], [targetType], [targetId],
             [afterState], [authorisingSource])
        VALUES
            (NEWID(), N'migration', NULL, N'taxonomy.permissions.provisioned', N'role',
             @taxonomyAdminRoleId,
             N'{"added":"' + @taxonomyAddedKeys + N'"}',
             N'20260917000000_phase3b_taxonomy');
    END;
END;

-- ===========================================================================
-- FOUNDATION DATA - the canonical top-level Topics
-- ===========================================================================
--
-- Exactly the nineteen DOMAIN_MODEL.md 6.1 names, in the order it names them,
-- all at the root, all `system`. No deeper taxonomy is invented to make a tree
-- look fuller: the accepted model names these and nothing below them.
--
-- SLUGS ARE ASCII AND STABLE. They are what `/topics/{slug}` will be built from
-- and what a later context's data will reference, so `&` becomes `and` and the
-- parenthetical in `Faith (Aqeedah)` is not carried into the identifier.
--
-- IDENTITY IS THE SLUG, not the generated id. Re-running the migration matches
-- on slug, so a second provisioning adds nothing and a restored database keeps
-- the ids it already had.

INSERT INTO [dbo].[Topic] ([id], [slug], [parentId], [position], [status], [system])
SELECT CONVERT(nvarchar(36), NEWID()), v.[slug], NULL, v.[position], N'active', 1
FROM (VALUES
    (N'quran',                  0),
    (N'hadith',                 1),
    (N'seerah',                 2),
    (N'aqeedah',                3),
    (N'fiqh',                   4),
    (N'worship',                5),
    (N'spirituality',           6),
    (N'ahl-al-bayt',            7),
    (N'sahabah',                8),
    (N'islamic-history',        9),
    (N'ethics',                10),
    (N'family-and-society',    11),
    (N'education',             12),
    (N'peace',                 13),
    (N'interfaith',            14),
    (N'human-rights',          15),
    (N'economics-and-finance', 16),
    (N'islam-and-science',     17),
    (N'contemporary-issues',   18)
) AS v([slug], [position])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Topic] t WHERE t.[slug] = v.[slug]);

-- ENGLISH ONLY, AND DELIBERATELY SO.
--
-- The fallback locale is seeded because every Topic must have one; `ur` and
-- `ar` are NOT, because no canonical translated copy has been supplied and
-- inventing Urdu and Arabic wording for nineteen religious and scholarly
-- subjects is editorial work for people qualified to do it. The administrative
-- surface shows which topics are still untranslated, so the gap is visible and
-- actionable rather than papered over with machine-made prose
-- (DELIVERY_PLAN.md, Phase 3B).
--
-- Descriptions are left NULL for the same reason.

INSERT INTO [dbo].[TopicTranslation] ([topicId], [locale], [name])
SELECT t.[id], N'en', v.[name]
FROM (VALUES
    (N'quran',                 N'Quran'),
    (N'hadith',                N'Hadith'),
    (N'seerah',                N'Seerah'),
    (N'aqeedah',               N'Faith (Aqeedah)'),
    (N'fiqh',                  N'Fiqh'),
    (N'worship',               N'Worship'),
    (N'spirituality',          N'Spirituality'),
    (N'ahl-al-bayt',           N'Ahl al-Bayt'),
    (N'sahabah',               N'Sahabah'),
    (N'islamic-history',       N'Islamic History'),
    (N'ethics',                N'Ethics'),
    (N'family-and-society',    N'Family & Society'),
    (N'education',             N'Education'),
    (N'peace',                 N'Peace'),
    (N'interfaith',            N'Interfaith'),
    (N'human-rights',          N'Human Rights'),
    (N'economics-and-finance', N'Economics & Finance'),
    (N'islam-and-science',     N'Islam & Science'),
    (N'contemporary-issues',   N'Contemporary Issues')
) AS v([slug], [name])
INNER JOIN [dbo].[Topic] t ON t.[slug] = v.[slug]
WHERE NOT EXISTS (
    SELECT 1 FROM [dbo].[TopicTranslation] tr
    WHERE tr.[topicId] = t.[id] AND tr.[locale] = N'en'
);

-- ===========================================================================
-- FOUNDATION DATA - content languages
-- ===========================================================================
--
-- THESE ARE CONTENT LANGUAGES, NOT INTERFACE LOCALES, and the fact that three
-- of them share codes with the three interface locales is a coincidence of
-- which languages this organisation publishes in - not a relationship.
-- PRODUCT_SCOPE.md 5 and 358 state that the platform serves English, Urdu and
-- Arabic, so seeding those three is evidence-backed; the catalogue is NOT
-- exhaustive and an administrator adds to it.
--
-- Nothing derives this list from `localeSchema`, and nothing derives
-- `localeSchema` from this table. Retiring `ar` here removes a content-language
-- option and leaves `/ar/...` routing untouched; a test proves both directions.

INSERT INTO [dbo].[Language] ([code], [englishName], [nativeName], [direction], [status])
SELECT v.[code], v.[englishName], v.[nativeName], v.[direction], N'active'
FROM (VALUES
    (N'en', N'English', N'English',  N'ltr'),
    (N'ur', N'Urdu',    N'اردو',     N'rtl'),
    (N'ar', N'Arabic',  N'العربية',  N'rtl')
) AS v([code], [englishName], [nativeName], [direction])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Language] l WHERE l.[code] = v.[code]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
