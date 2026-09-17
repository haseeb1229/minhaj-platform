-- =============================================================================
-- ROLLBACK — 20260916000000_phase2_authorization_privileged_security
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
-- SCOPE OF VALIDITY — read this before running it anywhere real.
--
-- This artifact is a MIGRATION-CORRECTNESS PROOF, exercised against a
-- disposable database that holds no accepted data.
--
-- It is NOT a production rollback. These tables hold live authorisation: who
-- may administer the platform, which second factors are enrolled, and the
-- one-time record that the initial administrator was provisioned. Running it
-- against a populated database destroys every role assignment on it and leaves
-- the platform with no administrator and no bootstrap left to perform, because
-- the forward migration would then re-seed a bootstrap that has already
-- happened. For a populated database the answer is a FORWARD fix.
--
-- Run as the MIGRATION principal. Neither the least-privilege runtime
-- principal nor the operator principal can execute any of it.

BEGIN TRY

BEGIN TRAN;

-- Permissions reference the objects, so they go first. Dropping an object with
-- grants still attached leaves orphaned entries in sys.database_permissions
-- that reappear against whatever object next occupies that object_id.
IF DATABASE_PRINCIPAL_ID(N'minhaj_operator') IS NOT NULL
BEGIN
  IF OBJECT_ID(N'[dbo].[IdentityBootstrapPlatformAdministrator]', N'P') IS NOT NULL
    REVOKE EXECUTE ON OBJECT::[dbo].[IdentityBootstrapPlatformAdministrator] FROM [minhaj_operator];

  IF OBJECT_ID(N'[dbo].[IdentityRecoverPrivilegedSecondFactor]', N'P') IS NOT NULL
    REVOKE EXECUTE ON OBJECT::[dbo].[IdentityRecoverPrivilegedSecondFactor] FROM [minhaj_operator];
END;

IF DATABASE_PRINCIPAL_ID(N'minhaj_app') IS NOT NULL
BEGIN
  IF OBJECT_ID(N'[dbo].[Permission]', N'U') IS NOT NULL
    REVOKE SELECT ON OBJECT::[dbo].[Permission] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[Role]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Role] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[RolePermission]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, DELETE ON OBJECT::[dbo].[RolePermission] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[RoleAssignment]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, UPDATE ON OBJECT::[dbo].[RoleAssignment] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[StepUpGrant]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, DELETE ON OBJECT::[dbo].[StepUpGrant] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[TwoFactor]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[TwoFactor] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[PrivilegedSecurityPosture]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, UPDATE ON OBJECT::[dbo].[PrivilegedSecurityPosture] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[IdentityBootstrap]', N'U') IS NOT NULL
    REVOKE SELECT ON OBJECT::[dbo].[IdentityBootstrap] FROM [minhaj_app];
END;

-- DropProcedure
IF OBJECT_ID(N'[dbo].[IdentityBootstrapPlatformAdministrator]', N'P') IS NOT NULL
  DROP PROCEDURE [dbo].[IdentityBootstrapPlatformAdministrator];

IF OBJECT_ID(N'[dbo].[IdentityRecoverPrivilegedSecondFactor]', N'P') IS NOT NULL
  DROP PROCEDURE [dbo].[IdentityRecoverPrivilegedSecondFactor];

-- DropTrigger
DROP TRIGGER IF EXISTS [dbo].[IdentityFinalAdministrator_Bootstrap];
DROP TRIGGER IF EXISTS [dbo].[IdentityFinalAdministrator_RoleAssignment];
DROP TRIGGER IF EXISTS [dbo].[IdentityFinalAdministrator_Role];
DROP TRIGGER IF EXISTS [dbo].[IdentityFinalAdministrator_User];

-- DropRole
--
-- Dropped only when no member remains. A role with members cannot be dropped,
-- and forcing it would mean removing somebody's membership as a side effect of
-- a schema rollback.
IF DATABASE_PRINCIPAL_ID(N'minhaj_operator') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM sys.database_role_members
     WHERE role_principal_id = DATABASE_PRINCIPAL_ID(N'minhaj_operator')
   )
  DROP ROLE [minhaj_operator];

-- DropForeignKey
IF OBJECT_ID(N'[dbo].[RolePermission_roleId_fkey]', N'F') IS NOT NULL
  ALTER TABLE [dbo].[RolePermission] DROP CONSTRAINT [RolePermission_roleId_fkey];

IF OBJECT_ID(N'[dbo].[RolePermission_permissionKey_fkey]', N'F') IS NOT NULL
  ALTER TABLE [dbo].[RolePermission] DROP CONSTRAINT [RolePermission_permissionKey_fkey];

IF OBJECT_ID(N'[dbo].[RoleAssignment_userId_fkey]', N'F') IS NOT NULL
  ALTER TABLE [dbo].[RoleAssignment] DROP CONSTRAINT [RoleAssignment_userId_fkey];

IF OBJECT_ID(N'[dbo].[RoleAssignment_roleId_fkey]', N'F') IS NOT NULL
  ALTER TABLE [dbo].[RoleAssignment] DROP CONSTRAINT [RoleAssignment_roleId_fkey];

IF OBJECT_ID(N'[dbo].[StepUpGrant_userId_fkey]', N'F') IS NOT NULL
  ALTER TABLE [dbo].[StepUpGrant] DROP CONSTRAINT [StepUpGrant_userId_fkey];

IF OBJECT_ID(N'[dbo].[StepUpGrant_sessionId_fkey]', N'F') IS NOT NULL
  ALTER TABLE [dbo].[StepUpGrant] DROP CONSTRAINT [StepUpGrant_sessionId_fkey];

IF OBJECT_ID(N'[dbo].[TwoFactor_userId_fkey]', N'F') IS NOT NULL
  ALTER TABLE [dbo].[TwoFactor] DROP CONSTRAINT [TwoFactor_userId_fkey];

IF OBJECT_ID(N'[dbo].[PrivilegedSecurityPosture_userId_fkey]', N'F') IS NOT NULL
  ALTER TABLE [dbo].[PrivilegedSecurityPosture] DROP CONSTRAINT [PrivilegedSecurityPosture_userId_fkey];

-- DropTable
--
-- Indexes, filtered indexes and check constraints are dropped with their
-- table; naming them separately would only create a second place for the two
-- lists to disagree.
IF OBJECT_ID(N'[dbo].[IdentityBootstrap]', N'U') IS NOT NULL
  DROP TABLE [dbo].[IdentityBootstrap];

IF OBJECT_ID(N'[dbo].[PrivilegedSecurityPosture]', N'U') IS NOT NULL
  DROP TABLE [dbo].[PrivilegedSecurityPosture];

IF OBJECT_ID(N'[dbo].[TwoFactor]', N'U') IS NOT NULL
  DROP TABLE [dbo].[TwoFactor];

IF OBJECT_ID(N'[dbo].[StepUpGrant]', N'U') IS NOT NULL
  DROP TABLE [dbo].[StepUpGrant];

IF OBJECT_ID(N'[dbo].[RoleAssignment]', N'U') IS NOT NULL
  DROP TABLE [dbo].[RoleAssignment];

IF OBJECT_ID(N'[dbo].[RolePermission]', N'U') IS NOT NULL
  DROP TABLE [dbo].[RolePermission];

IF OBJECT_ID(N'[dbo].[Role]', N'U') IS NOT NULL
  DROP TABLE [dbo].[Role];

IF OBJECT_ID(N'[dbo].[Permission]', N'U') IS NOT NULL
  DROP TABLE [dbo].[Permission];

-- AlterTable — the column this migration added to an existing table.
IF COL_LENGTH(N'[dbo].[User]', N'twoFactorEnabled') IS NOT NULL
BEGIN
  IF OBJECT_ID(N'[dbo].[User_twoFactorEnabled_df]', N'D') IS NOT NULL
    ALTER TABLE [dbo].[User] DROP CONSTRAINT [User_twoFactorEnabled_df];

  ALTER TABLE [dbo].[User] DROP COLUMN [twoFactorEnabled];
END;

-- DropIndex — the one this migration added to a Chunk-1 table.
IF EXISTS (
  SELECT 1 FROM sys.indexes
  WHERE object_id = OBJECT_ID(N'[dbo].[AuditLog]')
    AND name = N'AuditLog_action_occurredAt_idx'
)
  DROP INDEX [AuditLog_action_occurredAt_idx] ON [dbo].[AuditLog];

-- Forget the forward migration so `migrate deploy` re-applies it. The objects
-- are gone; a history row claiming otherwise is the one state that would make
-- the re-apply a silent no-op.
IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations]
  WHERE [migration_name] = N'20260916000000_phase2_authorization_privileged_security';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
