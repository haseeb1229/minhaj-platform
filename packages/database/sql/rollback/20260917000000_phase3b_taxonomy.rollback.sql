-- =============================================================================
-- ROLLBACK - 20260917000000_phase3b_taxonomy
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
-- It is NOT a production rollback. It destroys the canonical subject taxonomy
-- and every localisation of it, and it narrows the protected Platform
-- Administrator bundle - which is a privilege change, so it revokes the
-- holders' sessions and step-up grants exactly as the forward migration does.
-- For a populated database the answer is a FORWARD fix.
--
-- Run as the MIGRATION principal. Neither the least-privilege runtime principal
-- nor the operator principal can execute any of it.

BEGIN TRY

BEGIN TRAN;

-- Permissions reference the objects, so they go first. Dropping an object with
-- grants still attached leaves orphaned entries in sys.database_permissions
-- that reappear against whatever object next occupies that object_id.
IF DATABASE_PRINCIPAL_ID(N'minhaj_app') IS NOT NULL
BEGIN
  IF OBJECT_ID(N'[dbo].[Topic]', N'U') IS NOT NULL
  BEGIN
    REVOKE UPDATE ON OBJECT::[dbo].[Topic] ([slug]) FROM [minhaj_app];
    REVOKE SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Topic] FROM [minhaj_app];
  END;

  IF OBJECT_ID(N'[dbo].[TopicTranslation]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[TopicTranslation] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[Language]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Language] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[Tag]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Tag] FROM [minhaj_app];
END;

-- ---------------------------------------------------------------------------
-- The privilege change, reversed - and paid for the same way
-- ---------------------------------------------------------------------------
--
-- Removing a permission from the protected bundle NARROWS what a live
-- administrator may do. Live authorisation would refuse the removed capability
-- on the next request anyway; the sessions and step-up grants are revoked here
-- for the same reason the forward migration revokes them, so that a privilege
-- change never leaves a session that was issued under a different bundle.

DECLARE @taxonomyAdminRoleId NVARCHAR(36);

SELECT @taxonomyAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @taxonomyAdminRoleId IS NOT NULL
   AND EXISTS (
       SELECT 1 FROM [dbo].[RolePermission]
       WHERE [roleId] = @taxonomyAdminRoleId
         AND [permissionKey] IN (N'taxonomy.read', N'taxonomy.administer')
   )
BEGIN
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
END;

-- Bundle memberships before the catalogue rows they reference.
IF OBJECT_ID(N'[dbo].[RolePermission]', N'U') IS NOT NULL
  DELETE FROM [dbo].[RolePermission]
  WHERE [permissionKey] IN (N'taxonomy.read', N'taxonomy.administer');

IF OBJECT_ID(N'[dbo].[Permission]', N'U') IS NOT NULL
  DELETE FROM [dbo].[Permission]
  WHERE [key] IN (N'taxonomy.read', N'taxonomy.administer');

-- The migration-time privilege-change record is REMOVED here, and this is the
-- one place in the repository that deletes an audit row.
--
-- It is not an exception to the append-only discipline - it is the boundary of
-- it. The row is written by this migration and names this migration as its
-- authorising source; rolling the migration back means the event it records did
-- not happen. Nothing the application can reach may do this: the runtime
-- principal is DENIED DELETE on AuditLog, and only the migration principal
-- executes this file.
IF OBJECT_ID(N'[dbo].[AuditLog]', N'U') IS NOT NULL
  DELETE FROM [dbo].[AuditLog]
  WHERE [action] = N'taxonomy.permissions.provisioned'
    AND [authorisingSource] = N'20260917000000_phase3b_taxonomy';

-- DropTrigger
DROP TRIGGER IF EXISTS [dbo].[TaxonomyTopicFallback];
DROP TRIGGER IF EXISTS [dbo].[TaxonomyTopicHierarchy];

-- DropForeignKey
IF OBJECT_ID(N'[dbo].[TopicTranslation_topicId_fkey]', N'F') IS NOT NULL
  ALTER TABLE [dbo].[TopicTranslation] DROP CONSTRAINT [TopicTranslation_topicId_fkey];

IF OBJECT_ID(N'[dbo].[Topic_parentId_fkey]', N'F') IS NOT NULL
  ALTER TABLE [dbo].[Topic] DROP CONSTRAINT [Topic_parentId_fkey];

-- DropTable
--
-- Indexes, unique constraints and check constraints are dropped with their
-- table; naming them separately would only create a second place for the two
-- lists to disagree.
IF OBJECT_ID(N'[dbo].[Tag]', N'U') IS NOT NULL
  DROP TABLE [dbo].[Tag];

IF OBJECT_ID(N'[dbo].[Language]', N'U') IS NOT NULL
  DROP TABLE [dbo].[Language];

IF OBJECT_ID(N'[dbo].[TopicTranslation]', N'U') IS NOT NULL
  DROP TABLE [dbo].[TopicTranslation];

IF OBJECT_ID(N'[dbo].[Topic]', N'U') IS NOT NULL
  DROP TABLE [dbo].[Topic];

-- Forget the forward migration so `migrate deploy` re-applies it. The objects
-- are gone; a history row claiming otherwise is the one state that would make
-- the re-apply a silent no-op.
IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations]
  WHERE [migration_name] = N'20260917000000_phase3b_taxonomy';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
