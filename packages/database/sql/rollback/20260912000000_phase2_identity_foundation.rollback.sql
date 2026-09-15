-- =============================================================================
-- ROLLBACK — 20260912000000_phase2_identity_foundation
-- =============================================================================
--
-- Prisma Migrate has no down migration: `migrate deploy` only rolls forward.
-- Rollback is therefore an EXPLICIT, REVIEWED artifact, paired to exactly one
-- forward migration by the identifier in this file name
-- (SECURITY_BASELINE.md 18.2: migrations reviewed and applied deliberately).
--
-- Pairing is enforced mechanically: `db:migrate:test` fails when a forward
-- migration has no rollback of the same identifier, so the two cannot drift.
--
-- SCOPE OF VALIDITY — read this before running it anywhere real.
--
-- This artifact is a MIGRATION-CORRECTNESS PROOF. It is exercised against a
-- disposable database that holds no accepted data, where dropping the objects
-- and deleting the history row costs nothing (packages/database/README.md).
--
-- It is NOT a production rollback. These tables are the first POPULATED
-- business schema in the platform: real accounts, real credentials, real
-- sessions and real security state. Running this against a populated database
-- destroys every account on it. For a populated database the answer is a
-- FORWARD fix, not this file.
--
-- Run as the MIGRATION principal. The least-privilege runtime principal is
-- deliberately unable to execute any of it.

BEGIN TRY

BEGIN TRAN;

-- Permissions reference the tables, so they go first. Dropping a table with
-- grants still attached leaves orphaned entries in sys.database_permissions
-- that reappear against whatever object next occupies that object_id.
IF DATABASE_PRINCIPAL_ID(N'minhaj_app') IS NOT NULL
BEGIN
  IF OBJECT_ID(N'[dbo].[Session]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[Session] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[Account]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[Account] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[Verification]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[Verification] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[User]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, UPDATE ON OBJECT::[dbo].[User] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[IdentityCommunicationIntent]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, UPDATE ON OBJECT::[dbo].[IdentityCommunicationIntent] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[IdentitySecurityOperation]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, UPDATE ON OBJECT::[dbo].[IdentitySecurityOperation] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[EmailDelivery]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, UPDATE ON OBJECT::[dbo].[EmailDelivery] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[EmailSuppression]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT ON OBJECT::[dbo].[EmailSuppression] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[ProviderEvent]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, UPDATE ON OBJECT::[dbo].[ProviderEvent] FROM [minhaj_app];

  IF OBJECT_ID(N'[dbo].[RateLimitCounter]', N'U') IS NOT NULL
    REVOKE SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[RateLimitCounter] FROM [minhaj_app];
END;

-- DropForeignKey
--
-- Before the tables, so the drop order below cannot be defeated by a
-- constraint SQL Server would otherwise refuse to leave dangling.
IF OBJECT_ID(N'[dbo].[IdentityCommunicationIntent_userId_fkey]', N'F') IS NOT NULL
  ALTER TABLE [dbo].[IdentityCommunicationIntent] DROP CONSTRAINT [IdentityCommunicationIntent_userId_fkey];

IF OBJECT_ID(N'[dbo].[IdentitySecurityOperation_userId_fkey]', N'F') IS NOT NULL
  ALTER TABLE [dbo].[IdentitySecurityOperation] DROP CONSTRAINT [IdentitySecurityOperation_userId_fkey];

IF OBJECT_ID(N'[dbo].[Account_userId_fkey]', N'F') IS NOT NULL
  ALTER TABLE [dbo].[Account] DROP CONSTRAINT [Account_userId_fkey];

IF OBJECT_ID(N'[dbo].[Session_userId_fkey]', N'F') IS NOT NULL
  ALTER TABLE [dbo].[Session] DROP CONSTRAINT [Session_userId_fkey];

-- DropTable
--
-- Indexes and unique constraints are dropped with their table; naming them
-- separately would only create a second place for the two lists to disagree.
IF OBJECT_ID(N'[dbo].[RateLimitCounter]', N'U') IS NOT NULL
  DROP TABLE [dbo].[RateLimitCounter];

IF OBJECT_ID(N'[dbo].[ProviderEvent]', N'U') IS NOT NULL
  DROP TABLE [dbo].[ProviderEvent];

IF OBJECT_ID(N'[dbo].[EmailSuppression]', N'U') IS NOT NULL
  DROP TABLE [dbo].[EmailSuppression];

IF OBJECT_ID(N'[dbo].[EmailDelivery]', N'U') IS NOT NULL
  DROP TABLE [dbo].[EmailDelivery];

IF OBJECT_ID(N'[dbo].[IdentityCommunicationIntent]', N'U') IS NOT NULL
  DROP TABLE [dbo].[IdentityCommunicationIntent];

IF OBJECT_ID(N'[dbo].[IdentitySecurityOperation]', N'U') IS NOT NULL
  DROP TABLE [dbo].[IdentitySecurityOperation];

IF OBJECT_ID(N'[dbo].[Verification]', N'U') IS NOT NULL
  DROP TABLE [dbo].[Verification];

IF OBJECT_ID(N'[dbo].[Account]', N'U') IS NOT NULL
  DROP TABLE [dbo].[Account];

IF OBJECT_ID(N'[dbo].[Session]', N'U') IS NOT NULL
  DROP TABLE [dbo].[Session];

IF OBJECT_ID(N'[dbo].[User]', N'U') IS NOT NULL
  DROP TABLE [dbo].[User];

-- Forget the forward migration so `migrate deploy` re-applies it. The tables
-- are gone; a history row claiming otherwise is the one state that would make
-- the re-apply a silent no-op.
IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations]
  WHERE [migration_name] = N'20260912000000_phase2_identity_foundation';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
