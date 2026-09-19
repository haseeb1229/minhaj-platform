BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- Phase 5 - People & Contributors
-- ===========================================================================
--
-- Person, its per-interface-locale translations, its name variants, and the
-- FOUR DISTINCT PROFILE AGGREGATES with the child rows two of them carry.
--
-- SIX DISTINCT MODELS. DOMAIN_MODEL.md 5.2: "Person, AuthorProfile,
-- SpeakerProfile, ScholarProfile, TeacherProfile and User are six distinct
-- models and are never merged." There is therefore no `Profile` table with a
-- `type` column anywhere below, and no `isAuthor` / `isTeacher` column on
-- Person. Four tables and four unique indexes are what make "a Person may hold
-- all four" and "at most one of each" both properties of the schema.
--
-- NO CONTRIBUTION JUNCTION, and none is coming from this migration. 5.3 puts
-- the relationship row in the context that owns the TARGET; 6.2 prohibits the
-- `targetType` + `targetId` pair a generic one would need. The role vocabulary
-- is code, in `packages/contracts/src/people/values.ts`.
--
-- NO FOREIGN KEY TO TAXONOMY. People's allowlist row is "Layer 0; Identity &
-- Access" (3.1). Profile languages are validated scalar codes.
--
-- NO CAPABILITY COLUMN. `canTeach` and its three siblings are projections of
-- Identity grants (4.5). Nothing here stores one, which is what makes "a
-- profile alone grants nothing" unable to be contradicted by data.

-- CreateTable
CREATE TABLE [dbo].[Person] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [Person_id_df] DEFAULT CONVERT(nvarchar(36), NEWID()),
    [slug] NVARCHAR(160) NOT NULL,
    [userId] NVARCHAR(36),
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [status] NVARCHAR(16) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Person_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Person_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Person_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Person_slug_key] UNIQUE NONCLUSTERED ([slug]),
    -- The lifecycle, refused by the DATABASE rather than by a validator. It
    -- costs nothing and holds for every writer, including a migration and an
    -- operator session, so a status nobody defined cannot enter the table by a
    -- route the application does not own.
    CONSTRAINT [Person_status_ck] CHECK ([status] IN (N'draft', N'published', N'archived'))
);

-- THE ONE-TO-ONE HALF OF THE OPTIONAL ACCOUNT LINK, and the reason the race is
-- not an application concern. Without it two administrators could each attach
-- the same account to a different Person and both commit; with it, exactly one
-- does and the other is refused by the database.
--
-- `WHERE [userId] IS NOT NULL` is load-bearing. SQL Server's UNIQUE treats two
-- NULLs as equal, so an unfiltered unique index would let the platform hold
-- exactly ONE Person without an account - the precise opposite of
-- DOMAIN_MODEL.md 5.1, where a Person with no User is the ordinary case. This
-- is also why it is an INDEX rather than a constraint: a filtered UNIQUE
-- constraint is not expressible in SQL Server.
CREATE UNIQUE NONCLUSTERED INDEX [Person_userId_key]
    ON [dbo].[Person]([userId]) WHERE [userId] IS NOT NULL;

-- CreateTable
CREATE TABLE [dbo].[PersonTranslation] (
    [personId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [biography] NVARCHAR(4000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PersonTranslation_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [PersonTranslation_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PersonTranslation_pkey] PRIMARY KEY CLUSTERED ([personId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[PersonNameVariant] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [PersonNameVariant_id_df] DEFAULT CONVERT(nvarchar(36), NEWID()),
    [personId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [value] NVARCHAR(200) NOT NULL,
    [normalised] NVARCHAR(200) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [PersonNameVariant_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PersonNameVariant_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PersonNameVariant_personId_locale_normalised_key] UNIQUE NONCLUSTERED ([personId],[locale],[normalised])
);

-- CreateTable
CREATE TABLE [dbo].[AuthorProfile] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [AuthorProfile_id_df] DEFAULT CONVERT(nvarchar(36), NEWID()),
    [personId] NVARCHAR(36) NOT NULL,
    [status] NVARCHAR(16) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [AuthorProfile_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [AuthorProfile_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [AuthorProfile_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [AuthorProfile_personId_key] UNIQUE NONCLUSTERED ([personId]),
    CONSTRAINT [AuthorProfile_status_ck] CHECK ([status] IN (N'draft', N'active', N'archived'))
);

-- CreateTable
CREATE TABLE [dbo].[SpeakerProfile] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [SpeakerProfile_id_df] DEFAULT CONVERT(nvarchar(36), NEWID()),
    [personId] NVARCHAR(36) NOT NULL,
    [status] NVARCHAR(16) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [SpeakerProfile_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [SpeakerProfile_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [SpeakerProfile_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SpeakerProfile_personId_key] UNIQUE NONCLUSTERED ([personId]),
    CONSTRAINT [SpeakerProfile_status_ck] CHECK ([status] IN (N'draft', N'active', N'archived'))
);

-- CreateTable
CREATE TABLE [dbo].[ScholarProfile] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [ScholarProfile_id_df] DEFAULT CONVERT(nvarchar(36), NEWID()),
    [personId] NVARCHAR(36) NOT NULL,
    [status] NVARCHAR(16) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ScholarProfile_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [ScholarProfile_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [ScholarProfile_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ScholarProfile_personId_key] UNIQUE NONCLUSTERED ([personId]),
    CONSTRAINT [ScholarProfile_status_ck] CHECK ([status] IN (N'draft', N'active', N'archived'))
);

-- CreateTable
CREATE TABLE [dbo].[ScholarProfileTranslation] (
    [scholarProfileId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [qualifications] NVARCHAR(2000),
    [expertise] NVARCHAR(2000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ScholarProfileTranslation_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [ScholarProfileTranslation_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [ScholarProfileTranslation_pkey] PRIMARY KEY CLUSTERED ([scholarProfileId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[ScholarProfileLanguage] (
    [scholarProfileId] NVARCHAR(36) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    CONSTRAINT [ScholarProfileLanguage_pkey] PRIMARY KEY CLUSTERED ([scholarProfileId],[languageCode])
);

-- CreateTable
CREATE TABLE [dbo].[TeacherProfile] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [TeacherProfile_id_df] DEFAULT CONVERT(nvarchar(36), NEWID()),
    [personId] NVARCHAR(36) NOT NULL,
    [status] NVARCHAR(16) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TeacherProfile_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [TeacherProfile_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [TeacherProfile_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [TeacherProfile_personId_key] UNIQUE NONCLUSTERED ([personId]),
    CONSTRAINT [TeacherProfile_status_ck] CHECK ([status] IN (N'draft', N'active', N'archived'))
);

-- CreateTable
CREATE TABLE [dbo].[TeacherProfileTranslation] (
    [teacherProfileId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [biography] NVARCHAR(2000),
    [subjects] NVARCHAR(2000),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TeacherProfileTranslation_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [TeacherProfileTranslation_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [TeacherProfileTranslation_pkey] PRIMARY KEY CLUSTERED ([teacherProfileId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[TeacherProfileLanguage] (
    [teacherProfileId] NVARCHAR(36) NOT NULL,
    [languageCode] NVARCHAR(16) NOT NULL,
    CONSTRAINT [TeacherProfileLanguage_pkey] PRIMARY KEY CLUSTERED ([teacherProfileId],[languageCode])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Person_status_slug_idx] ON [dbo].[Person]([status], [slug]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Person_status_updatedAt_idx] ON [dbo].[Person]([status], [updatedAt]);

-- CreateIndex
--
-- The administrative directory searches contributors by NAME, and a name lives
-- in the translation table rather than on `Person` - so without this index the
-- search predicate is a scan of every translation in every language. The query
-- offers `startsWith` and not `contains` for the same reason: a leading
-- wildcard cannot seek an index, so offering it would make the index decorative.
CREATE NONCLUSTERED INDEX [PersonTranslation_name_idx] ON [dbo].[PersonTranslation]([name]);

-- AddForeignKey
--
-- NO ACTION, and it is the single most consequential edge in this migration.
--
-- Account closure RETAINS the `User` row - pseudonymised, with a tombstone
-- address (DOMAIN_MODEL.md 4.6) - so there is no delete for a cascade to
-- follow. If one ever occurred, a cascade would destroy a PUBLIC contributor
-- record because a PRIVATE account disappeared, which inverts the ownership the
-- whole model rests on: a Person is a public record with its own lifecycle, and
-- a historical author who never had an account is the ordinary case.
--
-- The constraint still does real work: a forged account identifier submitted
-- through the admin link form is refused by the DATABASE, not by whichever
-- application lookup happened to run first.
ALTER TABLE [dbo].[Person] ADD CONSTRAINT [Person_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- The cascades INSIDE the context. Each describes what a reviewed rollback
-- does, not anything an administrator can cause: the runtime principal holds no
-- DELETE on `Person` or on any of the four profile tables.
ALTER TABLE [dbo].[PersonTranslation] ADD CONSTRAINT [PersonTranslation_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE [dbo].[PersonNameVariant] ADD CONSTRAINT [PersonNameVariant_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE [dbo].[AuthorProfile] ADD CONSTRAINT [AuthorProfile_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE [dbo].[SpeakerProfile] ADD CONSTRAINT [SpeakerProfile_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ScholarProfile] ADD CONSTRAINT [ScholarProfile_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE [dbo].[TeacherProfile] ADD CONSTRAINT [TeacherProfile_personId_fkey] FOREIGN KEY ([personId]) REFERENCES [dbo].[Person]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ScholarProfileTranslation] ADD CONSTRAINT [ScholarProfileTranslation_scholarProfileId_fkey] FOREIGN KEY ([scholarProfileId]) REFERENCES [dbo].[ScholarProfile]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ScholarProfileLanguage] ADD CONSTRAINT [ScholarProfileLanguage_scholarProfileId_fkey] FOREIGN KEY ([scholarProfileId]) REFERENCES [dbo].[ScholarProfile]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE [dbo].[TeacherProfileTranslation] ADD CONSTRAINT [TeacherProfileTranslation_teacherProfileId_fkey] FOREIGN KEY ([teacherProfileId]) REFERENCES [dbo].[TeacherProfile]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE [dbo].[TeacherProfileLanguage] ADD CONSTRAINT [TeacherProfileLanguage_teacherProfileId_fkey] FOREIGN KEY ([teacherProfileId]) REFERENCES [dbo].[TeacherProfile]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- ===========================================================================
-- ATOMIC PERSON CREATION
-- ===========================================================================
--
-- SQL Server cannot defer a foreign key or trigger check until COMMIT. A
-- Person-level INSERT trigger would therefore reject the valid first statement
-- before its primary translation could be inserted. The runtime is instead
-- denied direct Person INSERT and executes this narrow procedure, which creates
-- both rows in one transaction. No runtime SQL path can commit the invalid
-- parent-only state.

EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[PeopleCreatePerson]
  @id NVARCHAR(36),
  @slug NVARCHAR(160),
  @primaryLocale NVARCHAR(8),
  @name NVARCHAR(200),
  @biography NVARCHAR(4000) = NULL,
  @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  BEGIN TRY
    BEGIN TRAN;

    INSERT INTO [dbo].[Person]
      ([id], [slug], [primaryLocale], [status], [createdAt], [updatedAt])
    VALUES
      (@id, @slug, @primaryLocale, N''draft'', @at, @at);

    INSERT INTO [dbo].[PersonTranslation]
      ([personId], [locale], [name], [biography], [createdAt], [updatedAt])
    VALUES
      (@id, @primaryLocale, @name, @biography, @at, @at);

    COMMIT TRAN;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    IF ERROR_NUMBER() IN (2601, 2627)
      THROW 51043, ''A contributor with this slug already exists.'', 1;
    THROW;
  END CATCH;
END;
';

-- ===========================================================================
-- THE PRIMARY-LOCALE TRANSLATION CANNOT BE REMOVED
-- ===========================================================================
--
-- WHY THIS IS AN INVARIANT AND NOT A VALIDATION.
--
-- ROUTE_MAP.md 9.3 permits a page whose content is missing in the requested
-- locale to render another language WITH a visible notice, and requires the
-- canonical URL to point at the EXISTING-language URL. That only works while
-- some genuine language version exists. A Person with no translation at all has
-- no name to render, no canonical URL that is true, and no `hreflang` target -
-- so the page would be indexable and empty.
--
-- The primary locale is the one the Person's content was originally written in,
-- and the adapter writes the Person and that translation in ONE transaction. A
-- trigger is still required, because the transaction only covers CREATION: a
-- later delete, or an update that moves the row to another locale, is a
-- separate statement by a separate caller, and an invariant enforced only by
-- its original writer is an invariant one new caller removes.
--
-- 51040 is the refusal. It is distinct from every Phase-3B signature so the
-- adapter can tell a People invariant from a Taxonomy one.

EXEC sp_executesql N'
CREATE TRIGGER [dbo].[PeoplePersonPrimaryName]
ON [dbo].[PersonTranslation]
AFTER DELETE, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    -- Every Person touched by this statement, from both pseudo-tables: an
    -- UPDATE that moved a row from one locale to another has to be judged on
    -- the locale it LEFT as well as the one it arrived at.
    IF EXISTS (
        SELECT 1
        FROM (
            SELECT [personId] FROM deleted
            UNION
            SELECT [personId] FROM inserted
        ) AS touched
        JOIN [dbo].[Person] p ON p.[id] = touched.[personId]
        WHERE NOT EXISTS (
            SELECT 1 FROM [dbo].[PersonTranslation] t
            WHERE t.[personId] = p.[id] AND t.[locale] = p.[primaryLocale]
        )
    )
    BEGIN
        THROW 51040, ''A Person must keep the translation for its primary locale.'', 1;
    END;
END;
';

-- Changing the parent-side primaryLocale is the other route to the same
-- invalid state. INSERT is intentionally absent: initial creation uses the
-- atomic procedure above, because an immediate INSERT trigger would fire
-- before the child row can legally exist.
EXEC sp_executesql N'
CREATE TRIGGER [dbo].[PeoplePersonPrimaryLocale]
ON [dbo].[Person]
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF UPDATE([primaryLocale]) AND EXISTS (
        SELECT 1
        FROM inserted p
        WHERE NOT EXISTS (
            SELECT 1 FROM [dbo].[PersonTranslation] t
            WHERE t.[personId] = p.[id] AND t.[locale] = p.[primaryLocale]
        )
    )
    BEGIN
        THROW 51040, ''A Person must keep the translation for its primary locale.'', 1;
    END;
END;
';

-- ===========================================================================
-- NAME VARIANTS ARE COUNT-BOUNDED BY THE DATABASE
-- ===========================================================================
--
-- The per-locale maximum is an ENGINEERING BOUND: it stops an "also known as"
-- list becoming an unbounded column of text on a public page. No accepted
-- document limits how many ways a name may be written, and the bound is
-- generous.
--
-- The runtime is denied direct INSERT and uses a narrow procedure. It obtains
-- a transaction-owned application lock BEFORE inserting, so two requests for
-- the same (Person, locale) cannot both observe the eighth slot as available.
-- The trigger remains as defence in depth for privileged migration/repair SQL.
--
-- The value is stated here and in `packages/contracts/src/people/values.ts`,
-- and a test asserts the two agree - the same arrangement the Phase-3B depth
-- bound uses.
--
-- 51041 is the bound refusal; 51042 is failure to acquire the serialisation
-- lock; 51044 is the procedure's stable duplicate-variant refusal.

EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[PeopleAddNameVariant]
  @id NVARCHAR(36),
  @personId NVARCHAR(36),
  @locale NVARCHAR(8),
  @value NVARCHAR(200),
  @normalised NVARCHAR(200),
  @at DATETIME2
AS
BEGIN
  SET NOCOUNT ON;
  SET XACT_ABORT ON;

  DECLARE @lockResult INT;
  DECLARE @lockResource NVARCHAR(255) =
    CONCAT(N''people-name-variant:'', @personId, N'':'', @locale);

  BEGIN TRY
    BEGIN TRAN;

    EXEC @lockResult = sys.sp_getapplock
      @Resource = @lockResource,
      @LockMode = N''Exclusive'',
      @LockOwner = N''Transaction'',
      @LockTimeout = 10000;

    IF @lockResult < 0
      THROW 51042, ''Could not serialise the Person name-variant invariant.'', 1;

    IF (
      SELECT COUNT_BIG(*) FROM [dbo].[PersonNameVariant]
      WHERE [personId] = @personId AND [locale] = @locale
    ) >= 8
      THROW 51041, ''A Person may hold at most 8 name variants per locale.'', 1;

    INSERT INTO [dbo].[PersonNameVariant]
      ([id], [personId], [locale], [value], [normalised], [createdAt])
    VALUES
      (@id, @personId, @locale, @value, @normalised, @at);

    COMMIT TRAN;
  END TRY
  BEGIN CATCH
    IF @@TRANCOUNT > 0 ROLLBACK TRAN;
    IF ERROR_NUMBER() IN (2601, 2627)
      THROW 51044, ''That name variant is already recorded for this language.'', 1;
    THROW;
  END CATCH;
END;
';

EXEC sp_executesql N'
CREATE TRIGGER [dbo].[PeopleNameVariantBound]
ON [dbo].[PersonNameVariant]
AFTER INSERT, UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (
        SELECT 1
        FROM [dbo].[PersonNameVariant] v
        JOIN (SELECT DISTINCT [personId], [locale] FROM inserted) AS touched
          ON touched.[personId] = v.[personId] AND touched.[locale] = v.[locale]
        GROUP BY v.[personId], v.[locale]
        HAVING COUNT_BIG(*) > 8
    )
    BEGIN
        THROW 51041, ''A Person may hold at most 8 name variants per locale.'', 1;
    END;
END;
';

-- ===========================================================================
-- Phase 5 permissions
-- ===========================================================================
--
-- TWO KEYS, READ AND ADMINISTER, for the same reason every other pair in this
-- catalogue is split: seeing the contributor directory and changing it are
-- different authorities, and an operator who must look up an author should not
-- thereby be able to publish a contributor record (SECURITY_BASELINE.md 4,
-- separation of duties).
--
-- TWO KEYS AND NOT FIVE. `people.authors.administer` beside
-- `people.teachers.administer` would be grantable authority nobody asked to
-- separate: the five admin routes ROUTE_MAP.md 7 lists are five VIEWS of one
-- administrative concern with one owner. A later phase may split them if a real
-- role needs it.
--
-- WHAT IS DELIBERATELY NOT SEEDED HERE: `teaching.perform`,
-- `question.receive`, `content.review`, `fatwa.answer` and `fatwa.publish`.
-- They are the four capability projections' sources (DOMAIN_MODEL.md 4.5) and
-- it would be trivially convenient to seed them so a projection test could
-- grant one. They belong to Learning, Fatwa and Editorial, which have not
-- shipped; seeding one now would fix another owner's vocabulary before that
-- owner can have an opinion about it, and would leave grantable authority over
-- nothing. OPEN_DECISIONS.md 6.3 separately reserves WHO receives them to the
-- organisation. The Phase-5 projection therefore reports all four as false
-- against a real database, which is the honest answer, and the mapping is
-- proved over a controlled permission set instead.
--
-- NO `people.*` STEP-UP PURPOSE EITHER. SECURITY_BASELINE.md 8.1 names the
-- operations that cost a step-up grant; administering a contributor record is
-- none of them, and 8.2 states the requirement is "deliberately not universal".

INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'people.read', N'View contributor records and their profiles.'),
    (N'people.administer', N'Create, edit, link and archive contributor records and their profiles.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

-- ===========================================================================
-- EXTENDING THE PROTECTED PLATFORM ADMINISTRATOR BUNDLE
-- ===========================================================================
--
-- The protected bundle is the WHOLE catalogue, so appending permissions widens
-- what a live administrator may do. That is a privilege change, and Phase 2
-- fixed what a privilege change costs: the holders' sessions and step-up grants
-- are revoked in the SAME transaction that changes the bundle
-- (SECURITY_BASELINE.md 8.1). Phase 3B paid it for two keys and Phase 4 for
-- one; this pays it for two, by the same mechanism rather than a variation.
--
-- The protected role is runtime-immutable, so a migration is the only place
-- this can happen, and it happens under review rather than through a screen.
--
-- On a fresh database every count below is zero and nothing is revoked.

DECLARE @peopleAdminRoleId NVARCHAR(36);
DECLARE @peopleAddedKeys NVARCHAR(200);

SELECT @peopleAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @peopleAdminRoleId IS NOT NULL
BEGIN
    SELECT @peopleAddedKeys = STRING_AGG(p.[key], N' ') WITHIN GROUP (ORDER BY p.[key])
    FROM [dbo].[Permission] p
    WHERE p.[key] IN (N'people.read', N'people.administer')
      AND NOT EXISTS (
          SELECT 1 FROM [dbo].[RolePermission] rp
          WHERE rp.[roleId] = @peopleAdminRoleId AND rp.[permissionKey] = p.[key]
      );

    IF @peopleAddedKeys IS NOT NULL AND LEN(@peopleAddedKeys) > 0
    BEGIN
        INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
        SELECT @peopleAdminRoleId, p.[key]
        FROM [dbo].[Permission] p
        WHERE p.[key] IN (N'people.read', N'people.administer')
          AND NOT EXISTS (
              SELECT 1 FROM [dbo].[RolePermission] rp
              WHERE rp.[roleId] = @peopleAdminRoleId AND rp.[permissionKey] = p.[key]
          );

        -- Grants before sessions, so the count each statement reports is the
        -- one it actually removed rather than whatever a cascade took first.
        DELETE FROM [dbo].[StepUpGrant]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @peopleAdminRoleId AND ra.[revokedAt] IS NULL
        );

        DELETE FROM [dbo].[Session]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @peopleAdminRoleId AND ra.[revokedAt] IS NULL
        );

        -- WHICH KEYS WERE ADDED, and nothing else. Not a snapshot of the whole
        -- bundle: an audit payload carrying every permission a role holds would
        -- be a second copy of the privilege model in a table with different
        -- retention (SECURITY_BASELINE.md 13.4).
        INSERT INTO [dbo].[AuditLog]
            ([id], [actorType], [actorId], [action], [targetType], [targetId],
             [afterState], [authorisingSource])
        VALUES
            (NEWID(), N'migration', NULL, N'people.permissions.provisioned', N'role',
             @peopleAdminRoleId,
             N'{"added":"' + @peopleAddedKeys + N'"}',
             N'20260919000000_phase5_people_contributors');
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
