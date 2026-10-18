-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Phase 26 added Membership's two ordinary keys to the protected bundle; the keys go first with the sessions and step-up grants of every live holder of either, then the five tables children-first (their triggers, keys, CHECKs and filtered indexes go with them), then the provisioning record. No other owner's vocabulary or table moves.
BEGIN TRY
BEGIN TRAN;
DELETE FROM [dbo].[StepUpGrant] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'membership.read',N'membership.administer') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[Session] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'membership.read',N'membership.administer') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[RolePermission] WHERE [permissionKey] IN (N'membership.read',N'membership.administer');
DELETE FROM [dbo].[Permission] WHERE [key] IN (N'membership.read',N'membership.administer');
DROP TABLE IF EXISTS [dbo].[MembershipCommunicationIntent];
DROP TABLE IF EXISTS [dbo].[Membership];
DROP TABLE IF EXISTS [dbo].[MembershipApplication];
DROP TABLE IF EXISTS [dbo].[MembershipTypeTranslation];
DROP TABLE IF EXISTS [dbo].[MembershipType];
DELETE FROM [dbo].[AuditLog] WHERE [action]=N'membership.permissions.provisioned' AND [authorisingSource]=N'20261009000000_phase26_membership';
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261009000000_phase26_membership';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
