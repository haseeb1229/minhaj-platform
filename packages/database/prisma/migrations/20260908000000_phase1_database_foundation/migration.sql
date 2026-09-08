BEGIN TRY

BEGIN TRAN;

-- CreateSchema
IF NOT EXISTS (SELECT * FROM sys.schemas WHERE name = N'dbo') EXEC sp_executesql N'CREATE SCHEMA [dbo];';

-- CreateTable
CREATE TABLE [dbo].[AuditLog] (
    [id] UNIQUEIDENTIFIER NOT NULL,
    [actorId] NVARCHAR(64),
    [actorType] NVARCHAR(64) NOT NULL,
    [action] NVARCHAR(128) NOT NULL,
    [targetType] NVARCHAR(128) NOT NULL,
    [targetId] NVARCHAR(128),
    [beforeState] NVARCHAR(max),
    [afterState] NVARCHAR(max),
    [authorisingSource] NVARCHAR(128),
    [ipAddress] NVARCHAR(64),
    [occurredAt] DATETIME2 NOT NULL CONSTRAINT [AuditLog_occurredAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [AuditLog_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_occurredAt_idx] ON [dbo].[AuditLog]([occurredAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_actorId_idx] ON [dbo].[AuditLog]([actorId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [AuditLog_targetType_targetId_idx] ON [dbo].[AuditLog]([targetType], [targetId]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
