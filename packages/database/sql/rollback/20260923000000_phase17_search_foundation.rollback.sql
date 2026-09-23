-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Full-text DDL is refused inside a user transaction, so the index and catalogue go first, guarded.
IF EXISTS (SELECT 1 FROM sys.fulltext_indexes WHERE [object_id] = OBJECT_ID(N'[dbo].[SearchDocument]'))
    DROP FULLTEXT INDEX ON [dbo].[SearchDocument];
IF EXISTS (SELECT 1 FROM sys.fulltext_catalogs WHERE [name] = N'SearchCatalog')
    DROP FULLTEXT CATALOG [SearchCatalog];
BEGIN TRY
BEGIN TRAN;
DELETE FROM [dbo].[StepUpGrant] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'search.read',N'search.operate') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[Session] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'search.read',N'search.operate') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[RolePermission] WHERE [permissionKey] IN (N'search.read',N'search.operate');
DELETE FROM [dbo].[Permission] WHERE [key] IN (N'search.read',N'search.operate');
DROP TABLE IF EXISTS [dbo].[SearchDocumentTopic];
DROP TABLE IF EXISTS [dbo].[SearchDocument];
DROP TABLE IF EXISTS [dbo].[SearchIndexScope];
DROP TABLE IF EXISTS [dbo].[SearchIndexRequest];
DELETE FROM [dbo].[AuditLog] WHERE [action]=N'search.permissions.provisioned' AND [authorisingSource]=N'20260923000000_phase17_search_foundation';
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20260923000000_phase17_search_foundation';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
