-- Destructive schema reversal: disposable migration proof only. Populated recovery uses restore/roll-forward.
-- Phase 23 added the two class keys to the protected bundle and catalogued the externally gated `teaching.perform`; the three keys go first with the sessions of every live holder of any of them, then the seven tables children-first (their triggers, keys, CHECKs and filtered indexes go with them), then the provisioning record. Search's vocabulary was not widened, so nothing of Search's moves.
BEGIN TRY
BEGIN TRAN;
DELETE FROM [dbo].[StepUpGrant] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'learning.classes.read',N'learning.classes.administer',N'teaching.perform') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[Session] WHERE [userId] IN (SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra JOIN [dbo].[RolePermission] rp ON rp.[roleId]=ra.[roleId] WHERE rp.[permissionKey] IN (N'learning.classes.read',N'learning.classes.administer',N'teaching.perform') AND ra.[revokedAt] IS NULL);
DELETE FROM [dbo].[RolePermission] WHERE [permissionKey] IN (N'learning.classes.read',N'learning.classes.administer',N'teaching.perform');
DELETE FROM [dbo].[Permission] WHERE [key] IN (N'learning.classes.read',N'learning.classes.administer',N'teaching.perform');
DROP TABLE IF EXISTS [dbo].[ClassCommunicationIntent];
DROP TABLE IF EXISTS [dbo].[Attendance];
DROP TABLE IF EXISTS [dbo].[Booking];
DROP TABLE IF EXISTS [dbo].[ClassSession];
DROP TABLE IF EXISTS [dbo].[Availability];
DROP TABLE IF EXISTS [dbo].[CourseTeachingAssignment];
DROP TABLE IF EXISTS [dbo].[LiveLearningActivation];
DELETE FROM [dbo].[AuditLog] WHERE [action]=N'learning.classes.permissions.provisioned' AND [authorisingSource]=N'20261007000000_phase23_teacher_live_classes';
DELETE FROM [dbo].[_prisma_migrations] WHERE [migration_name]=N'20261007000000_phase23_teacher_live_classes';
COMMIT TRAN;
END TRY
BEGIN CATCH
IF @@TRANCOUNT > 0 ROLLBACK TRAN;
THROW;
END CATCH
