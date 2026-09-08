-- =============================================================================
-- ROLLBACK — 20260908000000_phase1_database_foundation
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
-- Applying this file reverses the forward migration and then removes that
-- migration's row from `_prisma_migrations`, so migration history reflects
-- reality. Leaving the row behind would tell `migrate deploy` the table still
-- exists and the re-apply would silently do nothing.
--
-- Run as the MIGRATION principal. The least-privilege runtime principal is
-- deliberately unable to execute any of this.
--
-- DESTRUCTIVE: dropping AuditLog discards audit rows. In an environment whose
-- audit data must survive, export before running (SECURITY_BASELINE.md 13.1,
-- "controlled export and backup"). Backup/restore tooling itself is Chunk 3.

BEGIN TRY

BEGIN TRAN;

-- Permissions reference the table, so they go first. Dropping the table with
-- grants still attached leaves orphaned entries in sys.database_permissions
-- that reappear against whatever object next occupies that object_id.
IF OBJECT_ID(N'[dbo].[AuditLog]', N'U') IS NOT NULL
  AND DATABASE_PRINCIPAL_ID(N'minhaj_app') IS NOT NULL
BEGIN
  REVOKE INSERT, SELECT ON OBJECT::[dbo].[AuditLog] FROM [minhaj_app];
END;

-- DropIndex
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'AuditLog_targetType_targetId_idx' AND object_id = OBJECT_ID(N'[dbo].[AuditLog]'))
  DROP INDEX [AuditLog_targetType_targetId_idx] ON [dbo].[AuditLog];

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'AuditLog_actorId_idx' AND object_id = OBJECT_ID(N'[dbo].[AuditLog]'))
  DROP INDEX [AuditLog_actorId_idx] ON [dbo].[AuditLog];

IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'AuditLog_occurredAt_idx' AND object_id = OBJECT_ID(N'[dbo].[AuditLog]'))
  DROP INDEX [AuditLog_occurredAt_idx] ON [dbo].[AuditLog];

-- DropTable
IF OBJECT_ID(N'[dbo].[AuditLog]', N'U') IS NOT NULL
  DROP TABLE [dbo].[AuditLog];

-- Forget the forward migration so `migrate deploy` re-applies it. The table is
-- gone; a history row claiming otherwise is the one state that would make the
-- re-apply a silent no-op.
IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
  DELETE FROM [dbo].[_prisma_migrations]
  WHERE [migration_name] = N'20260908000000_phase1_database_foundation';

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
