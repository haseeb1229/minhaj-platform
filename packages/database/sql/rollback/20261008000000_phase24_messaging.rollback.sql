-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Phase 24 catalogued the two externally gated Messaging keys (bundled into no role and provisioned without an audit row, the Phase-20 precedent); they go first with the sessions of every live holder of either, then the nine tables children-first (their triggers, keys, CHECKs and filtered indexes go with them), then Storage's release digest, then the migration record.
BEGIN TRY
BEGIN TRAN;
DELETE FROM [dbo].[StepUpGrant] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'messaging.support',N'messaging.moderate') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[Session] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'messaging.support',N'messaging.moderate') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[RolePermission] WHERE [permissionKey] IN (N'messaging.support',N'messaging.moderate');
DELETE FROM [dbo].[Permission] WHERE [key] IN (N'messaging.support',N'messaging.moderate');
DROP TABLE IF EXISTS [dbo].[MessagingModerationDecision];
DROP TABLE IF EXISTS [dbo].[MessagingReport];
DROP TABLE IF EXISTS [dbo].[MessageReadState];
DROP TABLE IF EXISTS [dbo].[MessageAttachment];
DROP TABLE IF EXISTS [dbo].[Message];
DROP TABLE IF EXISTS [dbo].[ConversationParticipant];
DROP TABLE IF EXISTS [dbo].[MessagingBlock];
DROP TABLE IF EXISTS [dbo].[Conversation];
DROP TABLE IF EXISTS [dbo].[MessagingActivation];
DROP INDEX IF EXISTS [Asset_releaseDigest_key] ON [dbo].[Asset];
ALTER TABLE [dbo].[Asset] DROP CONSTRAINT IF EXISTS [Asset_releaseDigest_ck];
IF COL_LENGTH(N'dbo.Asset', N'releaseDigest') IS NOT NULL ALTER TABLE [dbo].[Asset] DROP COLUMN [releaseDigest];
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261008000000_phase24_messaging';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
