BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[User] (
    [id] NVARCHAR(36) NOT NULL,
    [name] NVARCHAR(200) NOT NULL,
    [email] NVARCHAR(320) NOT NULL,
    [emailVerified] BIT NOT NULL,
    [image] NVARCHAR(2048),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [timezone] NVARCHAR(64),
    [status] NVARCHAR(32) NOT NULL,
    [accountSetupCompletedAt] DATETIME2,
    [closedAt] DATETIME2,
    [pseudonymisedAt] DATETIME2,
    CONSTRAINT [User_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [User_email_key] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[Session] (
    [id] NVARCHAR(36) NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [token] NVARCHAR(255) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    [ipAddress] NVARCHAR(64),
    [userAgent] NVARCHAR(512),
    [userId] NVARCHAR(36) NOT NULL,
    CONSTRAINT [Session_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Session_token_key] UNIQUE NONCLUSTERED ([token])
);

-- CreateTable
CREATE TABLE [dbo].[Account] (
    [id] NVARCHAR(36) NOT NULL,
    [accountId] NVARCHAR(255) NOT NULL,
    [providerId] NVARCHAR(64) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [accessToken] NVARCHAR(max),
    [refreshToken] NVARCHAR(max),
    [idToken] NVARCHAR(max),
    [accessTokenExpiresAt] DATETIME2,
    [refreshTokenExpiresAt] DATETIME2,
    [scope] NVARCHAR(1000),
    [password] NVARCHAR(255),
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Account_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Account_providerId_accountId_key] UNIQUE NONCLUSTERED ([providerId],[accountId])
);

-- CreateTable
CREATE TABLE [dbo].[Verification] (
    [id] NVARCHAR(36) NOT NULL,
    [identifier] NVARCHAR(400) NOT NULL,
    [value] NVARCHAR(2000) NOT NULL,
    [expiresAt] DATETIME2 NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Verification_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[IdentityCommunicationIntent] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [IdentityCommunicationIntent_id_df] DEFAULT CONVERT(nvarchar(36), NEWID()),
    [purpose] NVARCHAR(64) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [idempotencyKey] NVARCHAR(200) NOT NULL,
    [recipientOverride] NVARCHAR(320),
    [status] NVARCHAR(16) NOT NULL,
    [relayedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [IdentityCommunicationIntent_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [IdentityCommunicationIntent_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [IdentityCommunicationIntent_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- Identity-only crash reconciliation. No password, hash, bearer or address.
CREATE TABLE [dbo].[IdentitySecurityOperation] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [IdentitySecurityOperation_id_df] DEFAULT CONVERT(nvarchar(36), NEWID()),
    [kind] NVARCHAR(32) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [initiatingSessionId] NVARCHAR(36),
    [replacementSessionId] NVARCHAR(36),
    [committedAt] DATETIME2,
    [cancelledAt] DATETIME2,
    [completedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [IdentitySecurityOperation_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [IdentitySecurityOperation_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[EmailDelivery] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [EmailDelivery_id_df] DEFAULT CONVERT(nvarchar(36), NEWID()),
    [purpose] NVARCHAR(64) NOT NULL,
    [recipientDigest] NVARCHAR(64) NOT NULL,
    [digestKeyVersion] INT NOT NULL,
    [sourceReference] NVARCHAR(200) NOT NULL,
    [idempotencyKey] NVARCHAR(200) NOT NULL,
    [status] NVARCHAR(16) NOT NULL,
    [attemptCount] INT NOT NULL,
    [nextAttemptAt] DATETIME2,
    [claimedUntil] DATETIME2,
    [failureClass] NVARCHAR(16),
    [failureCode] NVARCHAR(64),
    [providerMessageId] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [EmailDelivery_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [sentAt] DATETIME2,
    CONSTRAINT [EmailDelivery_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [EmailDelivery_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[EmailSuppression] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [EmailSuppression_id_df] DEFAULT CONVERT(nvarchar(36), NEWID()),
    [recipientDigest] NVARCHAR(64) NOT NULL,
    [digestKeyVersion] INT NOT NULL,
    [reason] NVARCHAR(16) NOT NULL,
    [scope] NVARCHAR(16) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [EmailSuppression_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [EmailSuppression_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [EmailSuppression_recipientDigest_key] UNIQUE NONCLUSTERED ([recipientDigest])
);

-- CreateTable
CREATE TABLE [dbo].[ProviderEvent] (
    [id] NVARCHAR(36) NOT NULL CONSTRAINT [ProviderEvent_id_df] DEFAULT CONVERT(nvarchar(36), NEWID()),
    [provider] NVARCHAR(32) NOT NULL,
    [eventId] NVARCHAR(200) NOT NULL,
    [type] NVARCHAR(64) NOT NULL,
    [receivedAt] DATETIME2 NOT NULL CONSTRAINT [ProviderEvent_receivedAt_df] DEFAULT SYSUTCDATETIME(),
    [processedAt] DATETIME2,
    CONSTRAINT [ProviderEvent_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ProviderEvent_provider_eventId_key] UNIQUE NONCLUSTERED ([provider],[eventId])
);

-- CreateTable
CREATE TABLE [dbo].[RateLimitCounter] (
    [key] NVARCHAR(200) NOT NULL,
    [keyVersion] INT NOT NULL,
    [count] INT NOT NULL,
    [windowStartedAt] DATETIME2 NOT NULL,
    [windowExpiresAt] DATETIME2 NOT NULL,
    CONSTRAINT [RateLimitCounter_pkey] PRIMARY KEY CLUSTERED ([key])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [User_status_idx] ON [dbo].[User]([status]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [User_createdAt_idx] ON [dbo].[User]([createdAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Session_userId_idx] ON [dbo].[Session]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Session_expiresAt_idx] ON [dbo].[Session]([expiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Account_userId_idx] ON [dbo].[Account]([userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Verification_identifier_idx] ON [dbo].[Verification]([identifier]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Verification_expiresAt_idx] ON [dbo].[Verification]([expiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [IdentityCommunicationIntent_status_createdAt_idx] ON [dbo].[IdentityCommunicationIntent]([status], [createdAt]);

CREATE NONCLUSTERED INDEX [IdentitySecurityOperation_completedAt_committedAt_createdAt_idx] ON [dbo].[IdentitySecurityOperation]([completedAt], [committedAt], [createdAt]);

CREATE NONCLUSTERED INDEX [IdentitySecurityOperation_userId_completedAt_idx] ON [dbo].[IdentitySecurityOperation]([userId], [completedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EmailDelivery_status_nextAttemptAt_idx] ON [dbo].[EmailDelivery]([status], [nextAttemptAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EmailDelivery_recipientDigest_idx] ON [dbo].[EmailDelivery]([recipientDigest]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [EmailSuppression_reason_idx] ON [dbo].[EmailSuppression]([reason]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ProviderEvent_receivedAt_idx] ON [dbo].[ProviderEvent]([receivedAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [RateLimitCounter_windowExpiresAt_idx] ON [dbo].[RateLimitCounter]([windowExpiresAt]);

-- AddForeignKey
ALTER TABLE [dbo].[Session] ADD CONSTRAINT [Session_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[Account] ADD CONSTRAINT [Account_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[IdentityCommunicationIntent] ADD CONSTRAINT [IdentityCommunicationIntent_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE [dbo].[IdentitySecurityOperation] ADD CONSTRAINT [IdentitySecurityOperation_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
