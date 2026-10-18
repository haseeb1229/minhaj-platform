-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Phase 27 added Donations' two ordinary keys to the protected bundle and catalogued the externally gated `donations.refund`; every `donation-refund` step-up grant goes first, then the sessions and step-up grants of every live holder of any of the three keys, then the keys, then the eight tables children-first (their triggers, keys, CHECKs and filtered indexes go with them), then the provisioning record. No other owner's vocabulary or table moves.
BEGIN TRY
BEGIN TRAN;
DELETE FROM [dbo].[StepUpGrant] WHERE [purpose]=N'donation-refund';
DELETE FROM [dbo].[StepUpGrant] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'donations.read',N'donations.administer',N'donations.refund') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[Session] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'donations.read',N'donations.administer',N'donations.refund') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[RolePermission] WHERE [permissionKey] IN (N'donations.read',N'donations.administer',N'donations.refund');
DELETE FROM [dbo].[Permission] WHERE [key] IN (N'donations.read',N'donations.administer',N'donations.refund');
DROP TABLE IF EXISTS [dbo].[DonationCommunicationIntent];
DROP TABLE IF EXISTS [dbo].[DonationRefund];
DROP TABLE IF EXISTS [dbo].[DonationProviderEvent];
DROP TABLE IF EXISTS [dbo].[Donation];
DROP TABLE IF EXISTS [dbo].[DonationActivation];
DROP TABLE IF EXISTS [dbo].[DonationCampaignCurrency];
DROP TABLE IF EXISTS [dbo].[DonationCampaignTranslation];
DROP TABLE IF EXISTS [dbo].[DonationCampaign];
DELETE FROM [dbo].[AuditLog] WHERE [action]=N'donations.permissions.provisioned' AND [authorisingSource]=N'20261010000000_phase27_donations';
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261010000000_phase27_donations';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
