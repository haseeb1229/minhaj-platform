-- ===========================================================================
-- Phase 26 — Membership
-- ===========================================================================
--
-- THE MEMBERSHIP CONTEXT (DOMAIN_MODEL.md 17.2): MembershipType with its
-- localized words, MembershipApplication, Membership, and the durable
-- applicant service-mail intent for every lifecycle point.
--
-- AN ORGANISATIONAL RELATIONSHIP, NOT AN ACCOUNT. A Membership exists only
-- because an operator approved an application, and it has its own lifecycle:
-- active, then closed — by the member or by an operator — and never reopened
-- in place. Closing the login account is NOT resigning the Membership; that
-- disposition withdraws only the account's OPEN applications.
--
-- NO PAYMENT CONCEPT. No amount, currency, fee, dues, price, invoice,
-- receipt, checkout, provider, transaction or payment state column exists in
-- any table below, and no Donations table is named.
--
-- DATA-MINIMISED. An application holds the applicant's account, the type,
-- its status and instants — no name, address, phone, age, guardian, identity
-- document, free text, note or upload. Nothing of the account is copied.
--
-- TYPED REFERENCES, NEVER A TARGET PAIR. A Membership names its OWN approved
-- application by a composite key that carries the applicant and the type, so
-- it can never belong to another account or type; an intent names exactly one
-- application or one Membership, again by a composite key that carries its
-- recipient. No `targetType` / `targetId` column exists anywhere.
--
-- THE INVARIANTS ARE IN THE KEYS AND THE TRIGGERS. At most one OPEN
-- (submitted or under review) application and at most one ACTIVE Membership
-- per account and type (filtered unique keys); exactly one Membership per
-- approved application (unique key). The adapter serialises on the account
-- and type BEFORE its first protected write (DOMAIN_MODEL.md 19.8); these are
-- the floor beneath it.
--
-- NOTHING CASCADES, AND NOTHING IS DELETED BUT OWED MAIL. Every foreign key
-- is NO ACTION. A type, an application and a Membership are never deleted by
-- the runtime; only an intent may be removed, by the owner's own bounded
-- disposition of a closed account.
--
-- REFUSALS 51320-51326 (within the 51320-51339 range reserved for this phase):
--   51320  a type created other than as a draft, re-keyed, returned to draft,
--          or a translation re-keyed
--   51321  a type published without its primary locale's words
--   51322  an application re-keyed, moved other than along its lifecycle, or
--          a decided or withdrawn application changed
--   51323  an application on a type that is not published, or while the
--          account holds an active Membership of that type
--   51324  a Membership re-keyed, reopened, created other than active from an
--          approved application on a published type
--   51325  a relayed or abandoned intent reopened, or an intent re-keyed
--
-- POSTURES FOR THE APPLICATION PRINCIPAL (grant-application-principal.sql):
--
--   TYPE         MembershipType: SELECT, INSERT, UPDATE; never DELETE, and
--                never its identity, primary locale or creation instant.
--   WORDS        MembershipTypeTranslation: SELECT, INSERT, UPDATE; never
--                DELETE, and never its type or locale.
--   APPLICATION  MembershipApplication: SELECT, INSERT, UPDATE; never DELETE,
--                and never its applicant, type or submission instant.
--   MEMBERSHIP   Membership: SELECT, INSERT, UPDATE; never DELETE, and never
--                its member, type, source application or activation instant.
--   INTENT       MembershipCommunicationIntent: SELECT, INSERT, UPDATE of
--                state/claim/relay, DELETE (a closed account's owed mail).
--
-- TWO ORDINARY KEYS: `membership.read` and `membership.administer` join the
-- protected Platform Administrator bundle by the convention every earlier
-- phase used, invalidating its holders' sessions and step-up grants in the
-- same transaction. No externally gated key and no step-up purpose is added.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.
-- ===========================================================================

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[MembershipType] (
    [id] NVARCHAR(36) NOT NULL,
    [state] NVARCHAR(16) NOT NULL CONSTRAINT [MembershipType_state_df] DEFAULT N'draft',
    [primaryLocale] NVARCHAR(8) NOT NULL,
    [displayOrder] INT NOT NULL,
    [version] INT NOT NULL CONSTRAINT [MembershipType_version_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MembershipType_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [MembershipType_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    [publishedAt] DATETIME2,
    [archivedAt] DATETIME2,
    CONSTRAINT [MembershipType_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MembershipTypeTranslation] (
    [membershipTypeId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [title] NVARCHAR(160) NOT NULL,
    [summary] NVARCHAR(600) NOT NULL,
    [description] NVARCHAR(4000) NOT NULL,
    [guidance] NVARCHAR(2000),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [MembershipTypeTranslation_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [MembershipTypeTranslation_pkey] PRIMARY KEY CLUSTERED ([membershipTypeId],[locale])
);

-- CreateTable
CREATE TABLE [dbo].[MembershipApplication] (
    [id] NVARCHAR(36) NOT NULL,
    [applicantUserId] NVARCHAR(36) NOT NULL,
    [membershipTypeId] NVARCHAR(36) NOT NULL,
    [status] NVARCHAR(16) NOT NULL CONSTRAINT [MembershipApplication_status_df] DEFAULT N'submitted',
    [withdrawalSource] NVARCHAR(16),
    [version] INT NOT NULL CONSTRAINT [MembershipApplication_version_df] DEFAULT 1,
    [submittedAt] DATETIME2 NOT NULL,
    [reviewStartedAt] DATETIME2,
    [decidedAt] DATETIME2,
    [withdrawnAt] DATETIME2,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [MembershipApplication_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [MembershipApplication_pkey] PRIMARY KEY CLUSTERED ([id]),
    -- The keys the composite references below need: an application's id
    -- together with its applicant (and type) — the facts a Membership and an
    -- intent must agree with.
    CONSTRAINT [MembershipApplication_applicant_key] UNIQUE NONCLUSTERED ([id],[applicantUserId]),
    CONSTRAINT [MembershipApplication_applicant_type_key] UNIQUE NONCLUSTERED ([id],[applicantUserId],[membershipTypeId])
);

-- CreateTable
CREATE TABLE [dbo].[Membership] (
    [id] NVARCHAR(36) NOT NULL,
    [memberUserId] NVARCHAR(36) NOT NULL,
    [membershipTypeId] NVARCHAR(36) NOT NULL,
    [sourceApplicationId] NVARCHAR(36) NOT NULL,
    [status] NVARCHAR(16) NOT NULL CONSTRAINT [Membership_status_df] DEFAULT N'active',
    [closureSource] NVARCHAR(16),
    [version] INT NOT NULL CONSTRAINT [Membership_version_df] DEFAULT 1,
    [activatedAt] DATETIME2 NOT NULL,
    [closedAt] DATETIME2,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Membership_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Membership_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Membership_sourceApplicationId_key] UNIQUE NONCLUSTERED ([sourceApplicationId]),
    CONSTRAINT [Membership_member_key] UNIQUE NONCLUSTERED ([id],[memberUserId])
);

-- CreateTable
CREATE TABLE [dbo].[MembershipCommunicationIntent] (
    [id] NVARCHAR(36) NOT NULL,
    [purpose] NVARCHAR(64) NOT NULL,
    [recipientUserId] NVARCHAR(36) NOT NULL,
    [applicationId] NVARCHAR(36),
    [membershipId] NVARCHAR(36),
    [dueAt] DATETIME2 NOT NULL,
    [state] NVARCHAR(16) NOT NULL CONSTRAINT [MembershipCommunicationIntent_state_df] DEFAULT N'pending',
    [idempotencyKey] NVARCHAR(200) NOT NULL,
    [claimedUntil] DATETIME2,
    [relayedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MembershipCommunicationIntent_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [MembershipCommunicationIntent_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MembershipCommunicationIntent_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [MembershipType_state_displayOrder_id_idx] ON [dbo].[MembershipType]([state], [displayOrder], [id]);
-- ONE OPEN APPLICATION PER ACCOUNT AND TYPE: the filtered key is the claim, so
-- two submissions racing for one account and type cannot both commit.
CREATE UNIQUE NONCLUSTERED INDEX [MembershipApplication_open_key] ON [dbo].[MembershipApplication]([applicantUserId], [membershipTypeId]) WHERE [status] IN (N'submitted', N'under_review');
CREATE NONCLUSTERED INDEX [MembershipApplication_applicantUserId_submittedAt_idx] ON [dbo].[MembershipApplication]([applicantUserId], [submittedAt]);
CREATE NONCLUSTERED INDEX [MembershipApplication_status_submittedAt_id_idx] ON [dbo].[MembershipApplication]([status], [submittedAt], [id]);
CREATE NONCLUSTERED INDEX [MembershipApplication_membershipTypeId_status_idx] ON [dbo].[MembershipApplication]([membershipTypeId], [status]);
-- ONE ACTIVE MEMBERSHIP PER ACCOUNT AND TYPE: two approvals racing for one
-- account and type cannot both commit.
CREATE UNIQUE NONCLUSTERED INDEX [Membership_active_key] ON [dbo].[Membership]([memberUserId], [membershipTypeId]) WHERE [status] = N'active';
CREATE NONCLUSTERED INDEX [Membership_memberUserId_activatedAt_idx] ON [dbo].[Membership]([memberUserId], [activatedAt]);
CREATE NONCLUSTERED INDEX [Membership_status_activatedAt_id_idx] ON [dbo].[Membership]([status], [activatedAt], [id]);
CREATE NONCLUSTERED INDEX [Membership_membershipTypeId_status_idx] ON [dbo].[Membership]([membershipTypeId], [status]);
CREATE NONCLUSTERED INDEX [MembershipCommunicationIntent_state_dueAt_idx] ON [dbo].[MembershipCommunicationIntent]([state], [dueAt]);
CREATE NONCLUSTERED INDEX [MembershipCommunicationIntent_recipientUserId_state_idx] ON [dbo].[MembershipCommunicationIntent]([recipientUserId], [state]);
CREATE NONCLUSTERED INDEX [MembershipCommunicationIntent_applicationId_idx] ON [dbo].[MembershipCommunicationIntent]([applicationId]);
CREATE NONCLUSTERED INDEX [MembershipCommunicationIntent_membershipId_idx] ON [dbo].[MembershipCommunicationIntent]([membershipId]);

-- AddForeignKey
ALTER TABLE [dbo].[MembershipTypeTranslation] ADD CONSTRAINT [MembershipTypeTranslation_membershipTypeId_fkey] FOREIGN KEY ([membershipTypeId]) REFERENCES [dbo].[MembershipType]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MembershipApplication] ADD CONSTRAINT [MembershipApplication_applicantUserId_fkey] FOREIGN KEY ([applicantUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MembershipApplication] ADD CONSTRAINT [MembershipApplication_membershipTypeId_fkey] FOREIGN KEY ([membershipTypeId]) REFERENCES [dbo].[MembershipType]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Membership] ADD CONSTRAINT [Membership_memberUserId_fkey] FOREIGN KEY ([memberUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Membership] ADD CONSTRAINT [Membership_membershipTypeId_fkey] FOREIGN KEY ([membershipTypeId]) REFERENCES [dbo].[MembershipType]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Membership] ADD CONSTRAINT [Membership_sourceApplicationId_fkey] FOREIGN KEY ([sourceApplicationId]) REFERENCES [dbo].[MembershipApplication]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
-- A Membership's own application: the SAME applicant and the SAME type.
ALTER TABLE [dbo].[Membership] ADD CONSTRAINT [Membership_sourceApplication_fkey] FOREIGN KEY ([sourceApplicationId], [memberUserId], [membershipTypeId]) REFERENCES [dbo].[MembershipApplication]([id],[applicantUserId],[membershipTypeId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MembershipCommunicationIntent] ADD CONSTRAINT [MembershipCommunicationIntent_recipientUserId_fkey] FOREIGN KEY ([recipientUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MembershipCommunicationIntent] ADD CONSTRAINT [MembershipCommunicationIntent_applicationId_fkey] FOREIGN KEY ([applicationId]) REFERENCES [dbo].[MembershipApplication]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MembershipCommunicationIntent] ADD CONSTRAINT [MembershipCommunicationIntent_membershipId_fkey] FOREIGN KEY ([membershipId]) REFERENCES [dbo].[Membership]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
-- An intent is owed to the applicant or member of the record it describes,
-- and to nobody else.
ALTER TABLE [dbo].[MembershipCommunicationIntent] ADD CONSTRAINT [MembershipCommunicationIntent_application_fkey] FOREIGN KEY ([applicationId], [recipientUserId]) REFERENCES [dbo].[MembershipApplication]([id],[applicantUserId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MembershipCommunicationIntent] ADD CONSTRAINT [MembershipCommunicationIntent_membership_fkey] FOREIGN KEY ([membershipId], [recipientUserId]) REFERENCES [dbo].[Membership]([id],[memberUserId]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ===========================================================================
-- Value constraints
-- ===========================================================================

-- A type: draft, published or archived, each with exactly the instants its
-- state implies; a primary locale of the three; a bounded display position.
ALTER TABLE [dbo].[MembershipType] ADD CONSTRAINT [MembershipType_ck] CHECK (
    [state] IN (N'draft',N'published',N'archived')
    AND [primaryLocale] IN (N'en',N'ur',N'ar')
    AND [displayOrder] BETWEEN 0 AND 9999
    AND [version] > 0
    AND (([state] = N'draft' AND [publishedAt] IS NULL AND [archivedAt] IS NULL)
         OR ([state] = N'published' AND [publishedAt] IS NOT NULL AND [archivedAt] IS NULL)
         OR ([state] = N'archived' AND [publishedAt] IS NOT NULL AND [archivedAt] IS NOT NULL))
);

-- Words: one of the three locales, never blank, guidance absent or written.
ALTER TABLE [dbo].[MembershipTypeTranslation] ADD CONSTRAINT [MembershipTypeTranslation_ck] CHECK (
    [locale] IN (N'en',N'ur',N'ar')
    AND LEN([title]) > 0
    AND LEN([summary]) > 0
    AND LEN([description]) > 0
    AND ([guidance] IS NULL OR LEN([guidance]) > 0)
);

-- An application: each status with exactly the instants it implies, in order;
-- a withdrawal source exactly when withdrawn. NO payment status exists.
ALTER TABLE [dbo].[MembershipApplication] ADD CONSTRAINT [MembershipApplication_ck] CHECK (
    [status] IN (N'submitted',N'under_review',N'approved',N'rejected',N'withdrawn')
    AND ([withdrawalSource] IS NULL OR [withdrawalSource] IN (N'applicant',N'account-closure'))
    AND [version] > 0
    AND (([status] = N'submitted' AND [reviewStartedAt] IS NULL AND [decidedAt] IS NULL AND [withdrawnAt] IS NULL AND [withdrawalSource] IS NULL)
         OR ([status] = N'under_review' AND [reviewStartedAt] IS NOT NULL AND [decidedAt] IS NULL AND [withdrawnAt] IS NULL AND [withdrawalSource] IS NULL)
         OR ([status] IN (N'approved',N'rejected') AND [reviewStartedAt] IS NOT NULL AND [decidedAt] IS NOT NULL AND [withdrawnAt] IS NULL AND [withdrawalSource] IS NULL)
         OR ([status] = N'withdrawn' AND [decidedAt] IS NULL AND [withdrawnAt] IS NOT NULL AND [withdrawalSource] IS NOT NULL))
    AND ([reviewStartedAt] IS NULL OR [reviewStartedAt] >= [submittedAt])
    AND ([decidedAt] IS NULL OR [decidedAt] >= [reviewStartedAt])
    AND ([withdrawnAt] IS NULL OR [withdrawnAt] >= [submittedAt])
);

-- A Membership: active, or closed with its instant and who closed it.
ALTER TABLE [dbo].[Membership] ADD CONSTRAINT [Membership_ck] CHECK (
    [status] IN (N'active',N'closed')
    AND ([closureSource] IS NULL OR [closureSource] IN (N'member',N'operator'))
    AND [version] > 0
    AND (([status] = N'active' AND [closedAt] IS NULL AND [closureSource] IS NULL)
         OR ([status] = N'closed' AND [closedAt] IS NOT NULL AND [closureSource] IS NOT NULL AND [closedAt] >= [activatedAt]))
);

-- An intent: one of the six purposes, naming EXACTLY the one record its
-- purpose describes — an application, or (for a closure) a Membership.
ALTER TABLE [dbo].[MembershipCommunicationIntent] ADD CONSTRAINT [MembershipCommunicationIntent_ck] CHECK (
    [purpose] IN (N'membership.application.submitted',N'membership.application.under-review',N'membership.application.approved',N'membership.application.rejected',N'membership.application.withdrawn',N'membership.closed')
    AND [state] IN (N'pending',N'relayed',N'abandoned')
    AND LEN([idempotencyKey]) > 0
    AND ([state] <> N'relayed' OR [relayedAt] IS NOT NULL)
    AND (([purpose] = N'membership.closed' AND [membershipId] IS NOT NULL AND [applicationId] IS NULL)
         OR ([purpose] <> N'membership.closed' AND [applicationId] IS NOT NULL AND [membershipId] IS NULL))
);

-- ===========================================================================
-- A type begins as a draft, keeps its identity, primary locale and creation
-- instant, and never returns to draft once public (51320); it is published
-- only with its primary locale's words (51321). Words never change type or
-- locale (51320).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MembershipTypeIntegrity] ON [dbo].[MembershipType] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id])
     AND (i.[state] <> N''draft'' OR i.[version] <> 1)
 )
   THROW 51320, ''A membership type begins as a draft.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[primaryLocale] <> i.[primaryLocale] OR d.[createdAt] <> i.[createdAt]
      OR (d.[state] <> N''draft'' AND i.[state] = N''draft'')
      OR (d.[state] = N''draft'' AND i.[state] = N''archived'')
      OR i.[version] <> d.[version] + 1
 )
   THROW 51320, ''A membership type keeps its identity and never returns to draft.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE i.[state] = N''published''
     AND NOT EXISTS (
       SELECT 1 FROM [dbo].[MembershipTypeTranslation] t
       WHERE t.[membershipTypeId] = i.[id] AND t.[locale] = i.[primaryLocale]
     )
 )
   THROW 51321, ''A membership type is published only with its primary locale''''s words.'', 1;
END');

EXEC(N'CREATE TRIGGER [dbo].[MembershipTypeTranslationIntegrity] ON [dbo].[MembershipTypeTranslation] AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[membershipTypeId] = i.[membershipTypeId] AND d.[locale] = i.[locale])
 )
   THROW 51320, ''A translation never changes its type or locale.'', 1;
END');

-- ===========================================================================
-- An application is made only on a PUBLISHED type, as `submitted`, while the
-- account holds no active Membership of that type (51323). It keeps its
-- applicant, type and submission instant, and moves only along its lifecycle
-- — submitted -> under review | withdrawn; under review -> approved |
-- rejected | withdrawn — one version at a time; a decided or withdrawn
-- application never changes again (51322).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MembershipApplicationIntegrity] ON [dbo].[MembershipApplication] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[applicantUserId] <> i.[applicantUserId] OR d.[membershipTypeId] <> i.[membershipTypeId]
      OR d.[submittedAt] <> i.[submittedAt]
      OR (d.[reviewStartedAt] IS NOT NULL AND (i.[reviewStartedAt] IS NULL OR i.[reviewStartedAt] <> d.[reviewStartedAt]))
      OR i.[version] <> d.[version] + 1
      OR NOT (
           (d.[status] = N''submitted'' AND i.[status] IN (N''under_review'',N''withdrawn''))
        OR (d.[status] = N''under_review'' AND i.[status] IN (N''approved'',N''rejected'',N''withdrawn''))
      )
 )
   THROW 51322, ''An application moves only along its lifecycle, and a decided or withdrawn application is final.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id])
     AND (i.[status] <> N''submitted'' OR i.[version] <> 1)
 )
   THROW 51322, ''An application begins as submitted.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id])
     AND (
       NOT EXISTS (SELECT 1 FROM [dbo].[MembershipType] t WHERE t.[id] = i.[membershipTypeId] AND t.[state] = N''published'')
       OR EXISTS (
         SELECT 1 FROM [dbo].[Membership] m
         WHERE m.[memberUserId] = i.[applicantUserId] AND m.[membershipTypeId] = i.[membershipTypeId] AND m.[status] = N''active''
       )
     )
 )
   THROW 51323, ''An application needs a published type and no active Membership of it.'', 1;
END');

-- ===========================================================================
-- A Membership is created only ACTIVE, from its own APPROVED application, on
-- a PUBLISHED type (51324); it keeps its member, type, source and activation
-- instant, and moves only from active to closed, one version at a time — a
-- closed Membership is history and never reopens (51324).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MembershipIntegrity] ON [dbo].[Membership] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id])
     AND (
       i.[status] <> N''active'' OR i.[version] <> 1
       OR NOT EXISTS (SELECT 1 FROM [dbo].[MembershipApplication] a WHERE a.[id] = i.[sourceApplicationId] AND a.[status] = N''approved'')
       OR NOT EXISTS (SELECT 1 FROM [dbo].[MembershipType] t WHERE t.[id] = i.[membershipTypeId] AND t.[state] = N''published'')
     )
 )
   THROW 51324, ''A Membership begins active, from its own approved application on a published type.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[memberUserId] <> i.[memberUserId] OR d.[membershipTypeId] <> i.[membershipTypeId]
      OR d.[sourceApplicationId] <> i.[sourceApplicationId] OR d.[activatedAt] <> i.[activatedAt]
      OR i.[version] <> d.[version] + 1
      OR NOT (d.[status] = N''active'' AND i.[status] = N''closed'')
 )
   THROW 51324, ''A Membership keeps its identity, and a closed Membership never reopens.'', 1;
END');

-- ===========================================================================
-- An intent is relayed or abandoned once and never re-keyed (51325).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MembershipIntentIntegrity] ON [dbo].[MembershipCommunicationIntent] AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[purpose] <> i.[purpose] OR d.[recipientUserId] <> i.[recipientUserId]
      OR ISNULL(d.[applicationId], N'''') <> ISNULL(i.[applicationId], N'''')
      OR ISNULL(d.[membershipId], N'''') <> ISNULL(i.[membershipId], N'''')
      OR d.[idempotencyKey] <> i.[idempotencyKey] OR d.[dueAt] <> i.[dueAt]
      OR (d.[state] <> N''pending'' AND i.[state] <> d.[state])
 )
   THROW 51325, ''A membership communication intent is relayed or abandoned once and never re-keyed.'', 1;
END');

-- ===========================================================================
-- Permissions
-- ===========================================================================
INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'membership.read', N'View membership types in every state, the application queue and members, with who applied. Every read that names an applicant or member is audited. Changes nothing.'),
    (N'membership.administer', N'Create, edit, publish and archive membership types, begin review of an application, approve or reject it, and close a Membership. Grants no Identity key.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

-- EXTENDING THE PROTECTED PLATFORM ADMINISTRATOR BUNDLE by the two ordinary
-- Membership keys — a privilege change, so the holders' sessions and step-up
-- grants are revoked in this same transaction (SECURITY_BASELINE.md 8.1).
DECLARE @membershipAdminRoleId NVARCHAR(36);
DECLARE @membershipAddedKeys NVARCHAR(200);

SELECT @membershipAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @membershipAdminRoleId IS NOT NULL
BEGIN
    SELECT @membershipAddedKeys = STRING_AGG(p.[key], N' ') WITHIN GROUP (ORDER BY p.[key])
    FROM [dbo].[Permission] p
    WHERE p.[key] IN (N'membership.read', N'membership.administer')
      AND NOT EXISTS (
          SELECT 1 FROM [dbo].[RolePermission] rp
          WHERE rp.[roleId] = @membershipAdminRoleId AND rp.[permissionKey] = p.[key]
      );

    IF @membershipAddedKeys IS NOT NULL AND LEN(@membershipAddedKeys) > 0
    BEGIN
        INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
        SELECT @membershipAdminRoleId, p.[key]
        FROM [dbo].[Permission] p
        WHERE p.[key] IN (N'membership.read', N'membership.administer')
          AND NOT EXISTS (
              SELECT 1 FROM [dbo].[RolePermission] rp
              WHERE rp.[roleId] = @membershipAdminRoleId AND rp.[permissionKey] = p.[key]
          );

        -- Grants before sessions, so the count each statement reports is the
        -- one it actually removed rather than whatever a cascade took first.
        DELETE FROM [dbo].[StepUpGrant]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @membershipAdminRoleId AND ra.[revokedAt] IS NULL
        );

        DELETE FROM [dbo].[Session]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @membershipAdminRoleId AND ra.[revokedAt] IS NULL
        );

        -- WHICH KEYS WERE ADDED, and nothing else (SECURITY_BASELINE.md 13.4).
        INSERT INTO [dbo].[AuditLog]
            ([id], [actorType], [actorId], [action], [targetType], [targetId],
             [afterState], [authorisingSource])
        VALUES
            (NEWID(), N'migration', NULL, N'membership.permissions.provisioned', N'role',
             @membershipAdminRoleId,
             N'{"added":"' + @membershipAddedKeys + N'"}',
             N'20261009000000_phase26_membership');
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
