-- Disposable migration rehearsal only. Populated deployments require roll-forward or restored backup.
--
-- This drops METADATA ONLY. Files under the storage root are not touched: SQL
-- cannot reach them, and a rollback script that deleted a corpus would be a
-- far worse failure than the one it is undoing. Reconciling orphaned bytes
-- after a rehearsal is a filesystem operation, done deliberately.
BEGIN TRY
BEGIN TRAN;
DROP TABLE [dbo].[Asset];
DELETE FROM [dbo].[_prisma_migrations] WHERE migration_name=N'20260921000000_phase7_storage_foundation';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0
BEGIN
ROLLBACK TRAN;
END;
THROW
END CATCH
