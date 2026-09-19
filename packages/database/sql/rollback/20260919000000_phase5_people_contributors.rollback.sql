-- =============================================================================
-- ROLLBACK - 20260919000000_phase5_people_contributors
-- =============================================================================
--
-- Prisma Migrate has no down migration: `migrate deploy` only rolls forward.
-- Rollback is therefore an EXPLICIT, REVIEWED artifact, paired to exactly one
-- forward migration by the identifier in this file name
-- (SECURITY_BASELINE.md 18.2).
--
-- Pairing is enforced mechanically: `db:migrate:test` fails when a forward
-- migration has no rollback of the same identifier, so the two cannot drift.
--
-- SCOPE OF VALIDITY - read this before running it anywhere real.
--
-- This artifact is a MIGRATION-CORRECTNESS PROOF, exercised against a
-- disposable database that holds no accepted data.
--
-- It is NOT a production rollback. It DROPS the contributor tables, which for a
-- populated database would destroy every Person, every translation, every name
-- variant and all four profile aggregates - public records that later content
-- domains will reference. It also narrows the protected Platform Administrator
-- bundle, which is a privilege change. For a populated database the answer is a
-- FORWARD fix.
--
-- Run as the MIGRATION principal. Neither the least-privilege runtime principal
-- nor the operator principal can execute any of it.

BEGIN TRY

BEGIN TRAN;

-- ---------------------------------------------------------------------------
-- The privilege change, reversed - and paid for the same way
-- ---------------------------------------------------------------------------
--
-- Removing permissions from the protected bundle NARROWS what a live
-- administrator may do. Live authorisation would refuse the removed capability
-- on the next request anyway; the sessions and step-up grants are revoked here
-- for the same reason the forward migration revokes them, so that a privilege
-- change never leaves a session that was issued under a different bundle.

DECLARE @peopleAdminRoleId NVARCHAR(36);

SELECT @peopleAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @peopleAdminRoleId IS NOT NULL
   AND EXISTS (
       SELECT 1 FROM [dbo].[RolePermission]
       WHERE [roleId] = @peopleAdminRoleId
         AND [permissionKey] IN (N'people.read', N'people.administer')
   )
BEGIN
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
END;

-- Bundle memberships before the catalogue rows they reference. This removes the
-- keys from EVERY role that holds them, custom roles included: a
-- `RolePermission` row pointing at a catalogue key that no longer exists is a
-- dangling grant.
IF OBJECT_ID(N'[dbo].[RolePermission]', N'U') IS NOT NULL
  DELETE FROM [dbo].[RolePermission]
  WHERE [permissionKey] IN (N'people.read', N'people.administer');

IF OBJECT_ID(N'[dbo].[Permission]', N'U') IS NOT NULL
  DELETE FROM [dbo].[Permission]
  WHERE [key] IN (N'people.read', N'people.administer');

-- ---------------------------------------------------------------------------
-- The invariant triggers
-- ---------------------------------------------------------------------------
--
-- Dropped BEFORE the tables they sit on, so the drop order is explicit rather
-- than relying on what a table drop happens to take with it. A trigger left
-- behind pointing at a table that no longer exists is not a state any
-- re-deploy should have to reason about.

IF OBJECT_ID(N'[dbo].[PeopleNameVariantBound]', N'TR') IS NOT NULL
  DROP TRIGGER [dbo].[PeopleNameVariantBound];

IF OBJECT_ID(N'[dbo].[PeoplePersonPrimaryLocale]', N'TR') IS NOT NULL
  DROP TRIGGER [dbo].[PeoplePersonPrimaryLocale];

IF OBJECT_ID(N'[dbo].[PeoplePersonPrimaryName]', N'TR') IS NOT NULL
  DROP TRIGGER [dbo].[PeoplePersonPrimaryName];

IF OBJECT_ID(N'[dbo].[PeopleCreatePerson]', N'P') IS NOT NULL
  DROP PROCEDURE [dbo].[PeopleCreatePerson];

IF OBJECT_ID(N'[dbo].[PeopleAddNameVariant]', N'P') IS NOT NULL
  DROP PROCEDURE [dbo].[PeopleAddNameVariant];

-- ---------------------------------------------------------------------------
-- The schema
-- ---------------------------------------------------------------------------
--
-- CHILD TABLES FIRST, in strict dependency order. Every one of these has a real
-- foreign key, and dropping a parent before its children is refused by the
-- database - which is the correct behaviour and the reason the order is written
-- out rather than left to chance.

IF OBJECT_ID(N'[dbo].[TeacherProfileLanguage]', N'U') IS NOT NULL
  DROP TABLE [dbo].[TeacherProfileLanguage];

IF OBJECT_ID(N'[dbo].[TeacherProfileTranslation]', N'U') IS NOT NULL
  DROP TABLE [dbo].[TeacherProfileTranslation];

IF OBJECT_ID(N'[dbo].[ScholarProfileLanguage]', N'U') IS NOT NULL
  DROP TABLE [dbo].[ScholarProfileLanguage];

IF OBJECT_ID(N'[dbo].[ScholarProfileTranslation]', N'U') IS NOT NULL
  DROP TABLE [dbo].[ScholarProfileTranslation];

IF OBJECT_ID(N'[dbo].[TeacherProfile]', N'U') IS NOT NULL
  DROP TABLE [dbo].[TeacherProfile];

IF OBJECT_ID(N'[dbo].[ScholarProfile]', N'U') IS NOT NULL
  DROP TABLE [dbo].[ScholarProfile];

IF OBJECT_ID(N'[dbo].[SpeakerProfile]', N'U') IS NOT NULL
  DROP TABLE [dbo].[SpeakerProfile];

IF OBJECT_ID(N'[dbo].[AuthorProfile]', N'U') IS NOT NULL
  DROP TABLE [dbo].[AuthorProfile];

IF OBJECT_ID(N'[dbo].[PersonNameVariant]', N'U') IS NOT NULL
  DROP TABLE [dbo].[PersonNameVariant];

IF OBJECT_ID(N'[dbo].[PersonTranslation]', N'U') IS NOT NULL
  DROP TABLE [dbo].[PersonTranslation];

-- `Person` last. Its own foreign key to `User` is dropped with it; the `User`
-- table is Phase 2's and is untouched here, which is what makes this rollback
-- reverse ONE migration rather than reaching into another phase's schema.
IF OBJECT_ID(N'[dbo].[Person]', N'U') IS NOT NULL
  DROP TABLE [dbo].[Person];

-- The migration-time privilege-change record is REMOVED here, and this is the
-- boundary of the append-only discipline rather than an exception to it. The
-- row is written by this migration and names this migration as its authorising
-- source; rolling the migration back means the event it records did not happen.
-- Nothing the application can reach may do this: the runtime principal is
-- DENIED DELETE on AuditLog, and only the migration principal executes this
-- file.
IF OBJECT_ID(N'[dbo].[AuditLog]', N'U') IS NOT NULL
  DELETE FROM [dbo].[AuditLog]
  WHERE [action] = N'people.permissions.provisioned'
    AND [authorisingSource] = N'20260919000000_phase5_people_contributors';

-- Forget the forward migration so `migrate deploy` re-applies it. The schema is
-- gone; a history entry claiming otherwise is the one state that would make the
-- re-apply a silent no-op.
IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations]
  WHERE [migration_name] = N'20260919000000_phase5_people_contributors';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
