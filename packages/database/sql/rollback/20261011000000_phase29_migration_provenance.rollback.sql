-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Phase 29 added Migration's two ordinary keys to the protected bundle and catalogued the externally gated `migration.publish`; every `migration-publication` step-up grant goes first, then the sessions and step-up grants of every live holder of any of the three keys, then the keys, then the eighteen tables children-first (their triggers, keys, CHECKs and filtered indexes go with them), then the provisioning record. No other owner's vocabulary or table moves.
BEGIN TRY
BEGIN TRAN;
DELETE FROM [dbo].[StepUpGrant] WHERE [purpose]=N'migration-publication';
DELETE FROM [dbo].[StepUpGrant] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'migration.read',N'migration.administer',N'migration.publish') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[Session] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'migration.read',N'migration.administer',N'migration.publish') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[RolePermission] WHERE [permissionKey] IN (N'migration.read',N'migration.administer',N'migration.publish');
DELETE FROM [dbo].[Permission] WHERE [key] IN (N'migration.read',N'migration.administer',N'migration.publish');
-- Circular references (record <-> snapshot, record <-> staged revision, run item -> error) are released before the tables go.
IF OBJECT_ID(N'[dbo].[MigrationRecord]',N'U') IS NOT NULL ALTER TABLE [dbo].[MigrationRecord] DROP CONSTRAINT IF EXISTS [MigrationRecord_latestSnapshotId_fkey], [MigrationRecord_currentStagedRecordId_fkey], [MigrationRecord_mergedIntoRecordId_fkey];
DROP TABLE IF EXISTS [dbo].[MigrationPromotionEntry];
DROP TABLE IF EXISTS [dbo].[MigrationPromotion];
DROP TABLE IF EXISTS [dbo].[MigrationStagedLink];
DROP TABLE IF EXISTS [dbo].[MigrationLegacyMapping];
DROP TABLE IF EXISTS [dbo].[MigrationManifestEntry];
DROP TABLE IF EXISTS [dbo].[MigrationPublishManifest];
DROP TABLE IF EXISTS [dbo].[MigrationAssetProvenance];
DROP TABLE IF EXISTS [dbo].[MigrationDuplicateCandidate];
DROP TABLE IF EXISTS [dbo].[MigrationRunItem];
DROP TABLE IF EXISTS [dbo].[MigrationError];
DROP TABLE IF EXISTS [dbo].[MigrationStagedCategory];
DROP TABLE IF EXISTS [dbo].[MigrationTopicMapping];
DROP TABLE IF EXISTS [dbo].[MigrationStagedRecord];
DROP TABLE IF EXISTS [dbo].[MigrationRawSnapshot];
DROP TABLE IF EXISTS [dbo].[MigrationRecord];
DROP TABLE IF EXISTS [dbo].[MigrationRun];
DROP TABLE IF EXISTS [dbo].[MigrationSourceHost];
DROP TABLE IF EXISTS [dbo].[MigrationSource];
DELETE FROM [dbo].[AuditLog] WHERE [action]=N'migration.permissions.provisioned' AND [authorisingSource]=N'20261011000000_phase29_migration_provenance';
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261011000000_phase29_migration_provenance';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
