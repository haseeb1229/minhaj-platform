BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- Phase 4 - the navigation status permission
-- ===========================================================================
--
-- ONE ROW, AND NO SCHEMA.
--
-- Phase 4 delivers the public shell, and the public shell has no business
-- schema: no Page, no Navigation, no Menu, no Footer, no SiteSettings, no
-- OrganisationProfile, no LegalDocument, no SEOPage, no Sitemap and no design
-- token table. The route registry that drives the header, the menus, the
-- footer and the sitemap is CODE, reviewed like code, and putting it in the
-- database would be a navigation CMS nobody asked for (DELIVERY_PLAN.md,
-- Phase 4).
--
-- What the phase does add is one administrative surface that
-- ROUTE_MAP.md 7 promises at Phase 4 - `/{locale}/admin/system/navigation` -
-- and every admin route is permission-checked server-side by a key, never by a
-- role name (SECURITY_BASELINE.md 3.1). No existing key carries that meaning:
-- `taxonomy.read` is the canonical subject taxonomy, and stretching it to cover
-- the shell's navigation status would make one grant mean two unrelated things.
--
-- READ ONLY, AND NO `navigation.administer` BESIDE IT. The surface has no
-- mutation: the registry is code-managed, there is no Save button, and no
-- action exists to authorise. A write key added now would be grantable
-- authority over nothing, which is precisely the "permission nobody reviewed"
-- this catalogue's discipline exists to prevent. It arrives with a mutation
-- contract, if one is ever accepted.

INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'navigation.read', N'View the effective public shell navigation and its availability.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

-- ===========================================================================
-- EXTENDING THE PROTECTED PLATFORM ADMINISTRATOR BUNDLE
-- ===========================================================================
--
-- The protected bundle is the WHOLE catalogue, so appending a permission widens
-- what a live administrator may do. That is a privilege change, and Phase 2
-- fixed what a privilege change costs: the holders' sessions and step-up grants
-- are revoked in the SAME transaction that changes the bundle
-- (SECURITY_BASELINE.md 8.1). Phase 3B paid it for two keys; this pays it for
-- one, by the same mechanism rather than a variation on it.
--
-- The protected role is runtime-immutable, so a migration is the only place
-- this can happen, and it happens under review rather than through a screen.
--
-- On a fresh database every count below is zero and nothing is revoked.

DECLARE @navigationAdminRoleId NVARCHAR(36);
DECLARE @navigationAddedKeys NVARCHAR(200);

SELECT @navigationAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @navigationAdminRoleId IS NOT NULL
BEGIN
    SELECT @navigationAddedKeys = STRING_AGG(p.[key], N' ') WITHIN GROUP (ORDER BY p.[key])
    FROM [dbo].[Permission] p
    WHERE p.[key] IN (N'navigation.read')
      AND NOT EXISTS (
          SELECT 1 FROM [dbo].[RolePermission] rp
          WHERE rp.[roleId] = @navigationAdminRoleId AND rp.[permissionKey] = p.[key]
      );

    IF @navigationAddedKeys IS NOT NULL AND LEN(@navigationAddedKeys) > 0
    BEGIN
        INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
        SELECT @navigationAdminRoleId, p.[key]
        FROM [dbo].[Permission] p
        WHERE p.[key] IN (N'navigation.read')
          AND NOT EXISTS (
              SELECT 1 FROM [dbo].[RolePermission] rp
              WHERE rp.[roleId] = @navigationAdminRoleId AND rp.[permissionKey] = p.[key]
          );

        -- Grants before sessions, so the count each statement reports is the
        -- one it actually removed rather than whatever a cascade took first.
        DELETE FROM [dbo].[StepUpGrant]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @navigationAdminRoleId AND ra.[revokedAt] IS NULL
        );

        DELETE FROM [dbo].[Session]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @navigationAdminRoleId AND ra.[revokedAt] IS NULL
        );

        -- WHICH KEYS WERE ADDED, and nothing else. Not a snapshot of the whole
        -- bundle: an audit payload that carried every permission a role holds
        -- would be a second copy of the privilege model in a table with
        -- different retention (SECURITY_BASELINE.md 13.4).
        INSERT INTO [dbo].[AuditLog]
            ([id], [actorType], [actorId], [action], [targetType], [targetId],
             [afterState], [authorisingSource])
        VALUES
            (NEWID(), N'migration', NULL, N'navigation.permissions.provisioned', N'role',
             @navigationAdminRoleId,
             N'{"added":"' + @navigationAddedKeys + N'"}',
             N'20260918000000_phase4_navigation_permission');
    END;
END;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;

THROW

END CATCH
