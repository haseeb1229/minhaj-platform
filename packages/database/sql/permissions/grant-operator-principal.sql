-- =============================================================================
-- Dedicated privileged-operations principal
-- =============================================================================
--
-- SECURITY_BASELINE.md 8.3 requires the initial administrator bootstrap and the
-- lockout recovery to be controlled, one-time, audited procedures rather than a
-- public endpoint, a hard-coded identity or a mode the system can be put into.
-- This principal is how a HOST operator runs them, and it is the whole of what
-- such an operator is given.
--
-- Run as the MIGRATION principal, against the target database, AFTER the
-- migration that creates the procedures and the `minhaj_operator` role.
--
-- Parameters are supplied by the caller as sqlcmd variables:
--   $(operator_login)     login name
--   $(operator_password)  password, passed via the environment; never written here
--
-- WHAT IT GETS: membership of `minhaj_operator`, which holds EXECUTE on exactly
-- two procedures and nothing else. The tables those procedures touch are
-- reached by ownership chaining, so the operator can perform the two audited
-- operations WITHOUT holding a single right on `User`, `Session`,
-- `RoleAssignment`, `TwoFactor` or anything else.
--
-- WHAT IT DOES NOT GET:
--   - DDL of any kind
--   - general table access, SELECT included
--   - db_owner, db_ddladmin, db_datareader, db_datawriter, ownership
--   - migration rights
--   - any ability to grant itself more
--
-- NO EXPLICIT TABLE DENIALS ARE WRITTEN HERE, deliberately. Absence of a grant
-- IS the denial, and a DENY on a named table would mask a broad grant arriving
-- from somewhere else — precisely the failure mode
-- `src/lifecycle/principal-authority.ts` exists to catch. The proof asks what
-- this login can actually do, against a table nothing granted it anything on.

SET NOCOUNT ON;

-- Server login ---------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = N'$(operator_login)')
BEGIN
  DECLARE @createLogin nvarchar(max) = N'CREATE LOGIN [$(operator_login)] WITH PASSWORD = ' +
    QUOTENAME(N'$(operator_password)', '''') + N', CHECK_POLICY = ON;';
  EXEC sp_executesql @createLogin;
END
ELSE
BEGIN
  -- Idempotent re-run: keep the password in step with local configuration
  -- without dropping a login that may hold existing membership.
  DECLARE @alterLogin nvarchar(max) = N'ALTER LOGIN [$(operator_login)] WITH PASSWORD = ' +
    QUOTENAME(N'$(operator_password)', '''') + N';';
  EXEC sp_executesql @alterLogin;
END;

-- Database user --------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = N'$(operator_login)')
BEGIN
  CREATE USER [$(operator_login)] FOR LOGIN [$(operator_login)];
END;

-- Baseline denials -----------------------------------------------------------
--
-- DENY outranks any GRANT, including one inherited from a role a later change
-- might add. An operator that could create an object could create a path around
-- the two procedures it is limited to.
DENY ALTER, CREATE TABLE, CREATE VIEW, CREATE PROCEDURE, CREATE FUNCTION,
     CREATE SCHEMA, REFERENCES TO [$(operator_login)];

-- Migration history is administrative state this principal has no business in.
IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
BEGIN
  DENY SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[_prisma_migrations] TO [$(operator_login)];
END;

-- The one membership -----------------------------------------------------------
--
-- The role, and its two EXECUTE grants, are created by the migration. This
-- script owns the PRINCIPAL; the migration owns the CAPABILITY. Keeping the
-- two apart means a change to what an operator may do is a reviewed migration
-- rather than an edit to a provisioning script.
IF DATABASE_PRINCIPAL_ID(N'minhaj_operator') IS NULL
BEGIN
  THROW 51100, N'The minhaj_operator role is missing; apply the authorisation migration first.', 1;
END;

IF NOT EXISTS (
  SELECT 1
  FROM sys.database_role_members m
  JOIN sys.database_principals r ON r.principal_id = m.role_principal_id
  JOIN sys.database_principals u ON u.principal_id = m.member_principal_id
  WHERE r.name = N'minhaj_operator' AND u.name = N'$(operator_login)'
)
BEGIN
  ALTER ROLE [minhaj_operator] ADD MEMBER [$(operator_login)];
END;
