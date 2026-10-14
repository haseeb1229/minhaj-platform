-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Phase 21 added the two newsletter keys to the protected bundle and every Personalisation object; the keys go first with the sessions they widened, then the tables children-first.
BEGIN TRY
BEGIN TRAN;
DELETE FROM [dbo].[StepUpGrant] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'newsletter.read',N'newsletter.operate') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[Session] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'newsletter.read',N'newsletter.operate') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[RolePermission] WHERE [permissionKey] IN (N'newsletter.read',N'newsletter.operate');
DELETE FROM [dbo].[Permission] WHERE [key] IN (N'newsletter.read',N'newsletter.operate');
DROP TABLE IF EXISTS [dbo].[NewsletterConsentEvent];
DROP TABLE IF EXISTS [dbo].[NewsletterSubscriber];
DROP TABLE IF EXISTS [dbo].[Notification];
DROP TABLE IF EXISTS [dbo].[NotificationPreference];
DROP TABLE IF EXISTS [dbo].[QuranReadingProgress];
DROP TABLE IF EXISTS [dbo].[WatchHistory];
DROP TABLE IF EXISTS [dbo].[ReadingHistory];
DROP TABLE IF EXISTS [dbo].[PrivateCollectionItem];
DROP TABLE IF EXISTS [dbo].[PrivateCollection];
DROP TABLE IF EXISTS [dbo].[Note];
DROP TABLE IF EXISTS [dbo].[Bookmark];
DROP TABLE IF EXISTS [dbo].[SavedItem];
DROP TABLE IF EXISTS [dbo].[PersonalisationGoal];
DROP TABLE IF EXISTS [dbo].[PersonalisationInterest];
DROP TABLE IF EXISTS [dbo].[PersonalisationProfile];
DELETE FROM [dbo].[AuditLog] WHERE [action]=N'newsletter.permissions.provisioned' AND [authorisingSource]=N'20261005000000_phase21_personalisation_notifications';
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261005000000_phase21_personalisation_notifications';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
