-- =============================================================================
-- ROLLBACK - 20260918000000_phase4_navigation_permission
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
-- It is NOT a production rollback. It narrows the protected Platform
-- Administrator bundle - a privilege change - and removes a permission key that
-- a custom role may by then have been granted. For a populated database the
-- answer is a FORWARD fix.
--
-- Run as the MIGRATION principal. Neither the least-privilege runtime principal
-- nor the operator principal can execute any of it.
--
-- THERE IS NO SCHEMA TO DROP. The forward migration creates no table, no index,
-- no procedure and no trigger, because Phase 4 introduces no business schema at
-- all. This file therefore reverses exactly one thing: a catalogue row and the
-- bundle membership that came with it.

BEGIN TRY

BEGIN TRAN;

-- ---------------------------------------------------------------------------
-- The privilege change, reversed - and paid for the same way
-- ---------------------------------------------------------------------------
--
-- Removing a permission from the protected bundle NARROWS what a live
-- administrator may do. Live authorisation would refuse the removed capability
-- on the next request anyway; the sessions and step-up grants are revoked here
-- for the same reason the forward migration revokes them, so that a privilege
-- change never leaves a session that was issued under a different bundle.

DECLARE @navigationAdminRoleId NVARCHAR(36);

SELECT @navigationAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @navigationAdminRoleId IS NOT NULL
   AND EXISTS (
       SELECT 1 FROM [dbo].[RolePermission]
       WHERE [roleId] = @navigationAdminRoleId
         AND [permissionKey] IN (N'navigation.read')
   )
BEGIN
  DELETE FROM [dbo].[StepUpGrant]
  WHERE [userId] IN (
      SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
      WHERE ra.[roleId] = @navigationAdminRoleId AND ra.[revokedAt] IS NULL
  );

  DELETE FROM [dbo].[Session]
  WHERE [userId] IN (
      SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
      WHERE ra.[roleId] = @navigationAdminRoleId AND ra.[revokedAt] IS NULL
  );
END;

-- Bundle memberships before the catalogue rows they reference. This removes the
-- key from EVERY role that holds it, custom roles included: a `RolePermission`
-- row pointing at a catalogue key that no longer exists is a dangling grant.
IF OBJECT_ID(N'[dbo].[RolePermission]', N'U') IS NOT NULL
  DELETE FROM [dbo].[RolePermission]
  WHERE [permissionKey] IN (N'navigation.read');

IF OBJECT_ID(N'[dbo].[Permission]', N'U') IS NOT NULL
  DELETE FROM [dbo].[Permission]
  WHERE [key] IN (N'navigation.read');

-- The migration-time privilege-change record is REMOVED here, and this is the
-- boundary of the append-only discipline rather than an exception to it. The
-- row is written by this migration and names this migration as its authorising
-- source; rolling the migration back means the event it records did not happen.
-- Nothing the application can reach may do this: the runtime principal is
-- DENIED DELETE on AuditLog, and only the migration principal executes this
-- file.
IF OBJECT_ID(N'[dbo].[AuditLog]', N'U') IS NOT NULL
  DELETE FROM [dbo].[AuditLog]
  WHERE [action] = N'navigation.permissions.provisioned'
    AND [authorisingSource] = N'20260918000000_phase4_navigation_permission';

-- Forget the forward migration so `migrate deploy` re-applies it. The row is
-- gone; a history entry claiming otherwise is the one state that would make the
-- re-apply a silent no-op.
IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations]
  WHERE [migration_name] = N'20260918000000_phase4_navigation_permission';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
