-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Phase 16 widened no search vocabulary. The News revision's Centre reference goes first, then the two Global keys and every Global object.
BEGIN TRY
BEGIN TRAN;
DROP INDEX IF EXISTS [NewsArticleRevision_centreId_ownerId_number_idx] ON [dbo].[NewsArticleRevision];
ALTER TABLE [dbo].[NewsArticleRevision] DROP CONSTRAINT [NewsArticleRevision_centreId_fkey];
ALTER TABLE [dbo].[NewsArticleRevision] DROP COLUMN [centreId];
DELETE FROM [dbo].[StepUpGrant] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'global.read',N'global.administer') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[Session] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'global.read',N'global.administer') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[RolePermission] WHERE [permissionKey] IN (N'global.read',N'global.administer');
DELETE FROM [dbo].[Permission] WHERE [key] IN (N'global.read',N'global.administer');
DROP TRIGGER IF EXISTS [dbo].[GlobalReserveCountrySlug];
DROP TRIGGER IF EXISTS [dbo].[GlobalReserveRegionSlug];
DROP TRIGGER IF EXISTS [dbo].[GlobalReserveCitySlug];
DROP TRIGGER IF EXISTS [dbo].[GlobalReserveCentreSlug];
DROP TABLE IF EXISTS [dbo].[CentreContact];
DROP TABLE IF EXISTS [dbo].[CentreServiceCity];
DROP TABLE IF EXISTS [dbo].[CentreSlugHistory];
DROP TABLE IF EXISTS [dbo].[CentreLabel];
DROP TABLE IF EXISTS [dbo].[Centre];
DROP TABLE IF EXISTS [dbo].[CitySlugHistory];
DROP TABLE IF EXISTS [dbo].[CityLabel];
DROP TABLE IF EXISTS [dbo].[City];
DROP TABLE IF EXISTS [dbo].[RegionSlugHistory];
DROP TABLE IF EXISTS [dbo].[RegionLabel];
DROP TABLE IF EXISTS [dbo].[Region];
DROP TABLE IF EXISTS [dbo].[CountrySlugHistory];
DROP TABLE IF EXISTS [dbo].[CountryLabel];
DROP TABLE IF EXISTS [dbo].[Country];
DELETE FROM [dbo].[AuditLog] WHERE [action]=N'global.permissions.provisioned' AND [authorisingSource]=N'20260929000000_phase16_global_network';
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20260929000000_phase16_global_network';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
