BEGIN TRY

BEGIN TRAN;

-- AlterTable
--
-- Better Auth's own two-factor flag. NOT NULL WITH A DEFAULT, because the
-- library omits it on insert and a non-nullable column it does not write would
-- fail its own schema check.
ALTER TABLE [dbo].[User] ADD [twoFactorEnabled] BIT NOT NULL CONSTRAINT [User_twoFactorEnabled_df] DEFAULT 0;

-- CreateIndex
--
-- The read-only admin audit view filters by action and orders by time, and
-- SECURITY_BASELINE.md 28 permits indexed filters only. Additive to a Chunk-1
-- table: no column changes, no data movement, no behaviour change for any
-- existing writer.
CREATE NONCLUSTERED INDEX [AuditLog_action_occurredAt_idx] ON [dbo].[AuditLog]([action], [occurredAt]);

-- CreateTable
CREATE TABLE [dbo].[Permission] (
    [key] NVARCHAR(64) NOT NULL,
    [description] NVARCHAR(200) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Permission_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Permission_pkey] PRIMARY KEY CLUSTERED ([key])
);

-- CreateTable
CREATE TABLE [dbo].[Role] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [Role_id_df] DEFAULT CONVERT(nvarchar(36), NEWID()),
    [key] NVARCHAR(64) NOT NULL,
    [name] NVARCHAR(120) NOT NULL,
    [description] NVARCHAR(400) NOT NULL,
    [system] BIT NOT NULL,
    [deactivatedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Role_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Role_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Role_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Role_key_key] UNIQUE NONCLUSTERED ([key])
);

-- CreateTable
CREATE TABLE [dbo].[RolePermission] (
    [roleId] NVARCHAR(36) NOT NULL,
    [permissionKey] NVARCHAR(64) NOT NULL,
    CONSTRAINT [RolePermission_pkey] PRIMARY KEY CLUSTERED ([roleId],[permissionKey])
);

-- CreateTable
CREATE TABLE [dbo].[RoleAssignment] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [RoleAssignment_id_df] DEFAULT CONVERT(nvarchar(36), NEWID()),
    [userId] NVARCHAR(36) NOT NULL,
    [roleId] NVARCHAR(36) NOT NULL,
    [grantedAt] DATETIME2 NOT NULL CONSTRAINT [RoleAssignment_grantedAt_df] DEFAULT SYSUTCDATETIME(),
    [grantedById] NVARCHAR(36),
    [grantedReason] NVARCHAR(200),
    [revokedAt] DATETIME2,
    [revokedById] NVARCHAR(36),
    [revokedReason] NVARCHAR(200),
    CONSTRAINT [RoleAssignment_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[StepUpGrant] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [StepUpGrant_id_df] DEFAULT CONVERT(nvarchar(36), NEWID()),
    [userId] NVARCHAR(36) NOT NULL,
    [sessionId] NVARCHAR(36) NOT NULL,
    [purpose] NVARCHAR(32) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [StepUpGrant_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [expiresAt] DATETIME2 NOT NULL,
    CONSTRAINT [StepUpGrant_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[TwoFactor] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [TwoFactor_id_df] DEFAULT CONVERT(nvarchar(36), NEWID()),
    [secret] NVARCHAR(max) NOT NULL,
    [backupCodes] NVARCHAR(max) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [verified] BIT NOT NULL CONSTRAINT [TwoFactor_verified_df] DEFAULT 0,
    [failedVerificationCount] INT NOT NULL CONSTRAINT [TwoFactor_failedVerificationCount_df] DEFAULT 0,
    [lockedUntil] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [TwoFactor_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [TwoFactor_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[PrivilegedSecurityPosture] (
    [userId] NVARCHAR(36) NOT NULL,
    [secondFactorVerifiedAt] DATETIME2,
    [recoveryCodesIssuedAt] DATETIME2,
    [recoveryCodesConfirmedAt] DATETIME2,
    [reenrolmentRequiredAt] DATETIME2,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [PrivilegedSecurityPosture_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [PrivilegedSecurityPosture_pkey] PRIMARY KEY CLUSTERED ([userId])
);

-- CreateTable
CREATE TABLE [dbo].[IdentityBootstrap] (
    [id] NVARCHAR(64) NOT NULL,
    [targetUserId] NVARCHAR(36) NOT NULL,
    [operatorLogin] NVARCHAR(128) NOT NULL,
    [ticket] NVARCHAR(200) NOT NULL,
    [completedAt] DATETIME2 NOT NULL CONSTRAINT [IdentityBootstrap_completedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [IdentityBootstrap_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- The bootstrap table is a SINGLETON by constraint, not by convention. One
-- legal key plus the primary key means a second successful bootstrap is a
-- constraint violation rather than a rule somebody has to remember to check
-- (SECURITY_BASELINE.md 8.3).
ALTER TABLE [dbo].[IdentityBootstrap] ADD CONSTRAINT [IdentityBootstrap_singleton_ck]
    CHECK ([id] = N'platform-administrator');

-- CreateIndex
CREATE NONCLUSTERED INDEX [Role_system_idx] ON [dbo].[Role]([system]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RolePermission_permissionKey_idx] ON [dbo].[RolePermission]([permissionKey]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RoleAssignment_userId_revokedAt_idx] ON [dbo].[RoleAssignment]([userId], [revokedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RoleAssignment_roleId_revokedAt_idx] ON [dbo].[RoleAssignment]([roleId], [revokedAt]);

-- AT MOST ONE LIVE ASSIGNMENT per (account, role).
--
-- A FILTERED unique index, which Prisma's schema language cannot express, so
-- it lives here and `db:migrate:test` asserts it exists. It is what makes a
-- duplicate grant impossible under concurrency: two racing grants become one
-- row and one audit record, and neither had to read first to find out.
-- A revoked row is excluded, so the same role can be granted again later and
-- the history of both periods survives.
CREATE UNIQUE NONCLUSTERED INDEX [RoleAssignment_userId_roleId_live_key]
    ON [dbo].[RoleAssignment]([userId], [roleId]) WHERE [revokedAt] IS NULL;

-- CreateIndex
CREATE NONCLUSTERED INDEX [StepUpGrant_userId_idx] ON [dbo].[StepUpGrant]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StepUpGrant_sessionId_purpose_expiresAt_idx] ON [dbo].[StepUpGrant]([sessionId], [purpose], [expiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [StepUpGrant_expiresAt_idx] ON [dbo].[StepUpGrant]([expiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [TwoFactor_userId_idx] ON [dbo].[TwoFactor]([userId]);

-- AddForeignKey
ALTER TABLE [dbo].[RolePermission] ADD CONSTRAINT [RolePermission_roleId_fkey] FOREIGN KEY ([roleId]) REFERENCES [dbo].[Role]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[RolePermission] ADD CONSTRAINT [RolePermission_permissionKey_fkey] FOREIGN KEY ([permissionKey]) REFERENCES [dbo].[Permission]([key]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RoleAssignment] ADD CONSTRAINT [RoleAssignment_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[RoleAssignment] ADD CONSTRAINT [RoleAssignment_roleId_fkey] FOREIGN KEY ([roleId]) REFERENCES [dbo].[Role]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[StepUpGrant] ADD CONSTRAINT [StepUpGrant_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ONE cascade path, and it is the one that carries security meaning: a revoked
-- session takes its step-up grants with it. SQL Server permits several NO
-- ACTION paths beside a single cascading one, which is why the User edge above
-- is NO ACTION.
ALTER TABLE [dbo].[StepUpGrant] ADD CONSTRAINT [StepUpGrant_sessionId_fkey] FOREIGN KEY ([sessionId]) REFERENCES [dbo].[Session]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[TwoFactor] ADD CONSTRAINT [TwoFactor_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[PrivilegedSecurityPosture] ADD CONSTRAINT [PrivilegedSecurityPosture_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- ===========================================================================
-- FOUNDATION DATA — the permission catalogue and the protected system role
-- ===========================================================================
--
-- Seeded HERE rather than by application code, because both are the things the
-- application is not allowed to change. The runtime principal holds SELECT and
-- nothing else on `Permission`, and holds no verb at all that can re-bundle or
-- deactivate a protected role.
--
-- These keys are Phase 2's own vocabulary. `quran.*`, `hadith.*`, `fatwa.*`,
-- `learning.*`, `membership.*` and the rest belong to contexts that have not
-- shipped; seeding one now would fix another owner's vocabulary before that
-- owner exists to have an opinion about it, and would create grantable
-- authority over nothing.
--
-- INSERT ... WHERE NOT EXISTS rather than MERGE: MERGE is not used anywhere in
-- this repository, and a re-run of a migration is not a concurrency scenario.

INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'users.read',        N'View Identity accounts and their status.'),
    (N'users.administer',  N'Change an account status: disable, suspend or reactivate.'),
    (N'roles.read',        N'View roles and the permissions bundled into them.'),
    (N'roles.administer',  N'Create, rename and deactivate custom roles.'),
    (N'permissions.read',  N'View the permission catalogue.'),
    (N'permissions.grant', N'Change what a role permits and which accounts hold it. Never self-applicable.'),
    (N'assignments.read',  N'View role assignments and their grant history.'),
    (N'security.read',     N'View privileged second-factor posture and bootstrap status.'),
    (N'audit.read',        N'Read the audit record.'),
    (N'integrations.read', N'View outbound email provider configuration and status.'),
    (N'delivery.read',     N'View pending, failed and suppressed outbound mail.'),
    (N'delivery.operate',  N'Reschedule or abandon a stuck outbound delivery.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

-- THE protected system role, and the only one. SECURITY_BASELINE.md 8.3 names
-- the initial privileged operator; nothing in the accepted documents names a
-- second protected role, and a hierarchy invented to look complete would be
-- privileged rows nobody asked for. Narrower operator roles are CUSTOM roles.
INSERT INTO [dbo].[Role] ([id], [key], [name], [description], [system])
SELECT CONVERT(nvarchar(36), NEWID()), N'platform-administrator', N'Platform Administrator',
       N'The protected system role. It exists before the one-time bootstrap so the bootstrap has something to assign, and no runtime path renames, re-bundles or deactivates it.',
       1
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Role] r WHERE r.[key] = N'platform-administrator');

INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
SELECT r.[id], p.[key]
FROM [dbo].[Role] r
CROSS JOIN [dbo].[Permission] p
WHERE r.[key] = N'platform-administrator'
  AND NOT EXISTS (
      SELECT 1 FROM [dbo].[RolePermission] rp
      WHERE rp.[roleId] = r.[id] AND rp.[permissionKey] = p.[key]
  );

-- ===========================================================================
-- FINAL USABLE PLATFORM ADMINISTRATOR INVARIANT
-- ===========================================================================
--
-- The bootstrap is permanently closed after its first success, while operator
-- recovery never grants a role. From that point onward an ordinary assignment,
-- account-status or closure race must therefore be unable to remove the final
-- active, verified holder of the protected role.
--
-- All four triggers take the SAME transaction-owned application lock before
-- checking. That is the cross-table serialisation point: two administrators
-- revoking, suspending or closing each other cannot both observe the old count
-- and commit. The first transaction holds the lock through commit; the second
-- then evaluates the state the first actually left behind and is refused.
--
-- 51020 is the stable data-invariant refusal. 51021 means the invariant lock
-- itself could not be obtained and therefore fails closed. 51022 protects the
-- one-time bootstrap record from deletion outside the explicit rollback.

EXEC sp_executesql N'
CREATE TRIGGER [dbo].[IdentityFinalAdministrator_RoleAssignment]
ON [dbo].[RoleAssignment]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (
        SELECT 1 FROM inserted i
        INNER JOIN [dbo].[Role] r ON r.[id] = i.[roleId]
        WHERE r.[key] = N''platform-administrator''
        UNION ALL
        SELECT 1 FROM deleted d
        INNER JOIN [dbo].[Role] r ON r.[id] = d.[roleId]
        WHERE r.[key] = N''platform-administrator''
    )
        RETURN;

    DECLARE @lockResult int;
    EXEC @lockResult = sys.sp_getapplock
        @Resource = N''minhaj:platform-administrator-invariant'',
        @LockMode = ''Exclusive'',
        @LockOwner = ''Transaction'',
        @LockTimeout = 15000;

    IF @lockResult < 0
        THROW 51021, N''The Platform Administrator invariant lock could not be acquired.'', 1;

    IF EXISTS (SELECT 1 FROM [dbo].[IdentityBootstrap] WHERE [id] = N''platform-administrator'')
       AND NOT EXISTS (
           SELECT 1
           FROM [dbo].[RoleAssignment] ra
           INNER JOIN [dbo].[Role] r ON r.[id] = ra.[roleId]
           INNER JOIN [dbo].[User] u ON u.[id] = ra.[userId]
           WHERE r.[key] = N''platform-administrator''
             AND r.[deactivatedAt] IS NULL
             AND ra.[revokedAt] IS NULL
             AND u.[status] = N''active''
             AND u.[emailVerified] = 1
       )
        THROW 51020, N''The final usable Platform Administrator cannot be removed.'', 1;
END;
';

EXEC sp_executesql N'
CREATE TRIGGER [dbo].[IdentityFinalAdministrator_User]
ON [dbo].[User]
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT UPDATE([status])
    BEGIN
        IF NOT UPDATE([emailVerified])
            RETURN;
    END;

    IF NOT EXISTS (
        SELECT 1
        FROM inserted i
        INNER JOIN deleted d ON d.[id] = i.[id]
        WHERE i.[status] <> d.[status]
           OR i.[emailVerified] <> d.[emailVerified]
    )
        RETURN;

    DECLARE @lockResult int;
    EXEC @lockResult = sys.sp_getapplock
        @Resource = N''minhaj:platform-administrator-invariant'',
        @LockMode = ''Exclusive'',
        @LockOwner = ''Transaction'',
        @LockTimeout = 15000;

    IF @lockResult < 0
        THROW 51021, N''The Platform Administrator invariant lock could not be acquired.'', 1;

    IF EXISTS (SELECT 1 FROM [dbo].[IdentityBootstrap] WHERE [id] = N''platform-administrator'')
       AND NOT EXISTS (
           SELECT 1
           FROM [dbo].[RoleAssignment] ra
           INNER JOIN [dbo].[Role] r ON r.[id] = ra.[roleId]
           INNER JOIN [dbo].[User] u ON u.[id] = ra.[userId]
           WHERE r.[key] = N''platform-administrator''
             AND r.[deactivatedAt] IS NULL
             AND ra.[revokedAt] IS NULL
             AND u.[status] = N''active''
             AND u.[emailVerified] = 1
       )
        THROW 51020, N''The final usable Platform Administrator cannot be removed.'', 1;
END;
';

EXEC sp_executesql N'
CREATE TRIGGER [dbo].[IdentityFinalAdministrator_Role]
ON [dbo].[Role]
AFTER UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF NOT EXISTS (
        SELECT 1 FROM inserted WHERE [key] = N''platform-administrator''
        UNION ALL
        SELECT 1 FROM deleted WHERE [key] = N''platform-administrator''
    )
        RETURN;

    DECLARE @lockResult int;
    EXEC @lockResult = sys.sp_getapplock
        @Resource = N''minhaj:platform-administrator-invariant'',
        @LockMode = ''Exclusive'',
        @LockOwner = ''Transaction'',
        @LockTimeout = 15000;

    IF @lockResult < 0
        THROW 51021, N''The Platform Administrator invariant lock could not be acquired.'', 1;

    IF EXISTS (SELECT 1 FROM [dbo].[IdentityBootstrap] WHERE [id] = N''platform-administrator'')
       AND NOT EXISTS (
           SELECT 1
           FROM [dbo].[RoleAssignment] ra
           INNER JOIN [dbo].[Role] r ON r.[id] = ra.[roleId]
           INNER JOIN [dbo].[User] u ON u.[id] = ra.[userId]
           WHERE r.[key] = N''platform-administrator''
             AND r.[deactivatedAt] IS NULL
             AND ra.[revokedAt] IS NULL
             AND u.[status] = N''active''
             AND u.[emailVerified] = 1
       )
        THROW 51020, N''The final usable Platform Administrator cannot be removed.'', 1;
END;
';

EXEC sp_executesql N'
CREATE TRIGGER [dbo].[IdentityFinalAdministrator_Bootstrap]
ON [dbo].[IdentityBootstrap]
AFTER INSERT, UPDATE, DELETE
AS
BEGIN
    SET NOCOUNT ON;

    IF EXISTS (SELECT 1 FROM deleted) AND NOT EXISTS (SELECT 1 FROM inserted)
        THROW 51022, N''The completed Identity bootstrap record is immutable.'', 1;

    DECLARE @lockResult int;
    EXEC @lockResult = sys.sp_getapplock
        @Resource = N''minhaj:platform-administrator-invariant'',
        @LockMode = ''Exclusive'',
        @LockOwner = ''Transaction'',
        @LockTimeout = 15000;

    IF @lockResult < 0
        THROW 51021, N''The Platform Administrator invariant lock could not be acquired.'', 1;

    IF EXISTS (SELECT 1 FROM [dbo].[IdentityBootstrap] WHERE [id] = N''platform-administrator'')
       AND NOT EXISTS (
           SELECT 1
           FROM [dbo].[RoleAssignment] ra
           INNER JOIN [dbo].[Role] r ON r.[id] = ra.[roleId]
           INNER JOIN [dbo].[User] u ON u.[id] = ra.[userId]
           WHERE r.[key] = N''platform-administrator''
             AND r.[deactivatedAt] IS NULL
             AND ra.[revokedAt] IS NULL
             AND u.[status] = N''active''
             AND u.[emailVerified] = 1
       )
        THROW 51020, N''A completed bootstrap requires a usable Platform Administrator.'', 1;
END;
';

-- ===========================================================================
-- HOST-ONLY OPERATOR PROCEDURES
-- ===========================================================================
--
-- The bootstrap and the lockout recovery are NOT HTTP endpoints and never
-- become one (SECURITY_BASELINE.md 8.3). They are stored procedures a
-- dedicated operator principal may EXECUTE and nothing else: no DDL, no table
-- rights, no db_owner, no schema-wide grant.
--
-- The table access inside each one is reached by OWNERSHIP CHAINING — the
-- procedure and the tables share the `dbo` owner, so a caller with EXECUTE on
-- the procedure needs no permission on the tables it touches, and gains none
-- outside it. Nothing here uses dynamic SQL in a body, which would break that
-- chain and require the rights to be granted directly.
--
-- Created through `sp_executesql` because CREATE PROCEDURE must be the first
-- statement in its batch, and a Prisma migration file is one batch.
--
-- THE OPERATOR IDENTITY IS NOT A PARAMETER. It is `ORIGINAL_LOGIN()`, read
-- inside the procedure: an identity the caller supplies is an identity the
-- caller can choose, and the whole value of this record is that it says who
-- really did it.

EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[IdentityBootstrapPlatformAdministrator]
    @targetUserId NVARCHAR(36),
    @ticket       NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @operator NVARCHAR(128) = ORIGINAL_LOGIN();
    DECLARE @roleId NVARCHAR(36);

    IF @ticket IS NULL OR LEN(LTRIM(RTRIM(@ticket))) = 0
        THROW 51000, N''A bootstrap requires a ticket or reason.'', 1;

    BEGIN TRAN;

    -- The range lock on the single legal key is what serialises concurrent
    -- attempts: the loser waits, then sees the winner''s row. The primary key
    -- is the second net, so even an unlocked race produces one success.
    IF EXISTS (
        SELECT 1 FROM [dbo].[IdentityBootstrap] WITH (UPDLOCK, HOLDLOCK)
        WHERE [id] = N''platform-administrator''
    )
    BEGIN
        ROLLBACK TRAN;
        THROW 51001, N''The initial administrator bootstrap has already been completed.'', 1;
    END;

    SELECT @roleId = [id] FROM [dbo].[Role] WHERE [key] = N''platform-administrator'';
    IF @roleId IS NULL
    BEGIN
        ROLLBACK TRAN;
        THROW 51002, N''The protected Platform Administrator role is missing.'', 1;
    END;

    IF NOT EXISTS (
        SELECT 1 FROM [dbo].[User]
        WHERE [id] = @targetUserId AND [status] = N''active'' AND [emailVerified] = 1
    )
    BEGIN
        ROLLBACK TRAN;
        THROW 51003, N''The bootstrap target must be an existing, verified, active account.'', 1;
    END;

    IF EXISTS (
        SELECT 1 FROM [dbo].[RoleAssignment] WITH (UPDLOCK, HOLDLOCK)
        WHERE [roleId] = @roleId AND [revokedAt] IS NULL
    )
    BEGIN
        ROLLBACK TRAN;
        THROW 51004, N''A Platform Administrator assignment already exists.'', 1;
    END;

    -- No grantor: this assignment was not granted by an account, which is the
    -- entire reason the bootstrap exists. The ticket carries the authority.
    INSERT INTO [dbo].[RoleAssignment] ([userId], [roleId], [grantedById], [grantedReason])
    VALUES (@targetUserId, @roleId, NULL, @ticket);

    INSERT INTO [dbo].[IdentityBootstrap] ([id], [targetUserId], [operatorLogin], [ticket])
    VALUES (N''platform-administrator'', @targetUserId, @operator, @ticket);

    INSERT INTO [dbo].[AuditLog]
        ([id], [actorType], [actorId], [action], [targetType], [targetId], [authorisingSource])
    VALUES
        (NEWID(), N''operator'', @operator, N''identity.bootstrap.completed'', N''user'',
         @targetUserId, @ticket);

    COMMIT TRAN;
END;
';

EXEC sp_executesql N'
CREATE PROCEDURE [dbo].[IdentityRecoverPrivilegedSecondFactor]
    @targetUserId NVARCHAR(36),
    @ticket       NVARCHAR(200)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;

    DECLARE @operator NVARCHAR(128) = ORIGINAL_LOGIN();
    DECLARE @roleId NVARCHAR(36);

    IF @ticket IS NULL OR LEN(LTRIM(RTRIM(@ticket))) = 0
        THROW 51010, N''A recovery requires a ticket or reason.'', 1;

    BEGIN TRAN;

    SELECT @roleId = [id] FROM [dbo].[Role] WHERE [key] = N''platform-administrator'';
    IF @roleId IS NULL
    BEGIN
        ROLLBACK TRAN;
        THROW 51011, N''The protected Platform Administrator role is missing.'', 1;
    END;

    -- RECOVERY NEVER GRANTS. It targets an account that ALREADY holds the
    -- live assignment, and it does not revoke and regrant that assignment
    -- either: the existing grant remains the authoritative history of when
    -- this person became an administrator.
    IF NOT EXISTS (
        SELECT 1 FROM [dbo].[RoleAssignment]
        WHERE [userId] = @targetUserId AND [roleId] = @roleId AND [revokedAt] IS NULL
    )
    BEGIN
        ROLLBACK TRAN;
        THROW 51012, N''Recovery targets an existing privileged administrator; this account holds no live assignment.'', 1;
    END;

    DELETE FROM [dbo].[StepUpGrant] WHERE [userId] = @targetUserId;
    DELETE FROM [dbo].[Session]     WHERE [userId] = @targetUserId;
    DELETE FROM [dbo].[TwoFactor]   WHERE [userId] = @targetUserId;

    UPDATE [dbo].[User] SET [twoFactorEnabled] = 0 WHERE [id] = @targetUserId;

    UPDATE [dbo].[PrivilegedSecurityPosture]
       SET [secondFactorVerifiedAt]   = NULL,
           [recoveryCodesIssuedAt]    = NULL,
           [recoveryCodesConfirmedAt] = NULL,
           [reenrolmentRequiredAt]    = SYSUTCDATETIME(),
           [updatedAt]                = SYSUTCDATETIME()
     WHERE [userId] = @targetUserId;

    IF @@ROWCOUNT = 0
        INSERT INTO [dbo].[PrivilegedSecurityPosture] ([userId], [reenrolmentRequiredAt])
        VALUES (@targetUserId, SYSUTCDATETIME());

    INSERT INTO [dbo].[AuditLog]
        ([id], [actorType], [actorId], [action], [targetType], [targetId], [authorisingSource])
    VALUES
        (NEWID(), N''operator'', @operator, N''identity.security.factor-recovered'', N''user'',
         @targetUserId, @ticket);

    COMMIT TRAN;
END;
';

-- ===========================================================================
-- THE OPERATOR DATABASE ROLE
-- ===========================================================================
--
-- EXECUTE on exactly two procedures, and nothing else: no DDL, no general
-- table access, no ownership, no migration rights. The LOGIN that joins this
-- role is provisioned separately by `sql/permissions/grant-operator-principal.sql`,
-- so the migration owns the procedures and their grants while provisioning owns
-- the principal — one artifact per decision.

IF DATABASE_PRINCIPAL_ID(N'minhaj_operator') IS NULL
    EXEC sp_executesql N'CREATE ROLE [minhaj_operator];';

GRANT EXECUTE ON OBJECT::[dbo].[IdentityBootstrapPlatformAdministrator] TO [minhaj_operator];
GRANT EXECUTE ON OBJECT::[dbo].[IdentityRecoverPrivilegedSecondFactor] TO [minhaj_operator];

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
