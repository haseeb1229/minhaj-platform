-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
BEGIN TRY
BEGIN TRAN;
DELETE FROM [dbo].[StepUpGrant] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'library.read',N'library.administer') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[Session] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'library.read',N'library.administer') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[RolePermission] WHERE [permissionKey] IN (N'library.read',N'library.administer');
DELETE FROM [dbo].[Permission] WHERE [key] IN (N'library.read',N'library.administer');
DROP TRIGGER IF EXISTS [dbo].[LibraryReserveWorkSlug];
DROP TABLE IF EXISTS [dbo].[WorkSalePoint];
DROP TABLE IF EXISTS [dbo].[BookTranslator];
DROP TABLE IF EXISTS [dbo].[BookTranslation];
DROP TABLE IF EXISTS [dbo].[Edition];
DROP TABLE IF EXISTS [dbo].[WorkTopic];
DROP TABLE IF EXISTS [dbo].[WorkContributor];
DROP TABLE IF EXISTS [dbo].[WorkSlugHistory];
DROP TABLE IF EXISTS [dbo].[WorkLabel];
DROP TABLE IF EXISTS [dbo].[SalePoint];
DROP TABLE IF EXISTS [dbo].[Work];
DELETE FROM [dbo].[AuditLog] WHERE [action]=N'library.permissions.provisioned' AND [authorisingSource]=N'20260922000000_phase8_library';
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20260922000000_phase8_library';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
