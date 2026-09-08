-- =============================================================================
-- Least-privilege application runtime principal
-- =============================================================================
--
-- SECURITY_BASELINE.md 18.2 requires an application account that is NOT `sa`,
-- holds no runtime schema-modification rights, and has no UPDATE or DELETE on
-- audit tables (13.1). This script provisions exactly that principal and
-- nothing more.
--
-- Run as the MIGRATION principal, against the target database.
--
-- Parameters are supplied by the caller as sqlcmd variables:
--   $(app_login)     login name
--   $(app_password)  password, passed via the environment; never written here
--
-- What is deliberately NOT granted:
--   - sysadmin, db_owner, db_ddladmin, ownership of the database
--   - CREATE/ALTER/DROP on any object (no DDL at runtime)
--   - UPDATE or DELETE on AuditLog (13.1 append-oriented discipline)
--   - anything on tables that do not exist yet; product-domain privileges
--     arrive with the phase that creates the domain.
--
-- Grants are made per object, never per schema. A schema-level grant would
-- silently extend to every table a later phase adds, which is how a
-- least-privilege account stops being one.

SET NOCOUNT ON;

-- Server login ---------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(app_login)')
BEGIN
  DECLARE @createLogin nvarchar(max) = N'CREATE LOGIN [$(app_login)] WITH PASSWORD = ' +
    QUOTENAME(N'$(app_password)', '''') + N', CHECK_POLICY = ON;';
  EXEC sp_executesql @createLogin;
END
ELSE
BEGIN
  -- Idempotent re-run: keep the password in step with local configuration
  -- without dropping a login that may hold existing grants.
  DECLARE @alterLogin nvarchar(max) = N'ALTER LOGIN [$(app_login)] WITH PASSWORD = ' +
    QUOTENAME(N'$(app_password)', '''') + N';';
  EXEC sp_executesql @alterLogin;
END;

-- Database user --------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(app_login)')
BEGIN
  CREATE USER [$(app_login)] FOR LOGIN [$(app_login)];
END;

-- Baseline denials -----------------------------------------------------------
--
-- DENY outranks any GRANT, including one inherited from a role a later change
-- might add. These make the audit restriction hold even if someone later adds
-- this user to a broader role by mistake.
DENY ALTER, CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE FUNCTION,
     CREATE SCHEMA, REFERENCES TO [$(app_login)];

-- Audit table ----------------------------------------------------------------
--
-- INSERT and SELECT only. The absence of UPDATE/DELETE would already deny
-- them by default; they are DENIED explicitly so the intent is legible in
-- sys.database_permissions and survives future role changes.
IF OBJECT_ID(N'[dbo].[AuditLog]', N'U') IS NOT NULL
BEGIN
  GRANT INSERT, SELECT ON OBJECT::[dbo].[AuditLog] TO [$(app_login)];
  DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[AuditLog] TO [$(app_login)];
END;

-- Migration history is administrative state, not application data.
IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
BEGIN
  DENY SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[_prisma_migrations] TO [$(app_login)];
END;
