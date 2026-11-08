-- Disposable migration rehearsal only. Populated deployments require roll-forward or restored backup.
--
-- Rebaseline R2 created one table, Storage's derivative links. This drops the
-- LINKS ONLY: the derivative Asset rows and their files stay, as Phase 7's
-- rollback leaves files - SQL cannot reach the storage root, and removing bytes
-- is a deliberate filesystem operation, never a side effect of a rollback.
BEGIN TRY
BEGIN TRAN;
DROP TABLE [dbo].[AssetDerivative];
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261107000000_r2_storage_derivatives';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
