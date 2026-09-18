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

-- Identity & Access -----------------------------------------------------------
--
-- Phase 2 Chunk 1. Grants are per object and per verb: the runtime gets what
-- authentication genuinely performs and nothing beyond it.
--
-- `User` is the one that needs explaining. The runtime may INSERT (sign-up) and
-- UPDATE (verification, profile, locale, status, closure) — but it may NOT
-- DELETE. Account closure RETAINS the row, pseudonymises the profile and
-- replaces the address with a non-routable tombstone, so a person's historical
-- attribution survives while the address becomes available again
-- (DOMAIN_MODEL.md §4.6). A runtime that could delete a user could also erase
-- the subject of an audit trail, which is the one thing audit exists to
-- prevent; DELETE is therefore denied explicitly rather than merely withheld.
IF OBJECT_ID(N'[dbo].[User]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[User] TO [$(app_login)];
  DENY DELETE, ALTER ON OBJECT::[dbo].[User] TO [$(app_login)];
END;

-- Sessions are created, refreshed and REVOKED, so DELETE is required here: a
-- session that cannot be deleted cannot be revoked.
IF OBJECT_ID(N'[dbo].[Session]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[Session] TO [$(app_login)];
  DENY ALTER ON OBJECT::[dbo].[Session] TO [$(app_login)];
END;

-- Credential and future provider accounts. DELETE is required for unlinking an
-- authentication method and for disposing credentials at closure.
IF OBJECT_ID(N'[dbo].[Account]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[Account] TO [$(app_login)];
  DENY ALTER ON OBJECT::[dbo].[Account] TO [$(app_login)];
END;

-- Tokens are created and CONSUMED. Consumption is a delete-returning, which is
-- what makes a token single-use under concurrency, so DELETE is the mechanism
-- rather than a convenience.
IF OBJECT_ID(N'[dbo].[Verification]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[Verification] TO [$(app_login)];
  DENY ALTER ON OBJECT::[dbo].[Verification] TO [$(app_login)];
END;

-- Identity's own durable notification intent. Committed, then marked relayed.
-- It is never deleted: an intent is evidence that a security event was
-- communicated, and a relayed row is the record of that.
IF OBJECT_ID(N'[dbo].[IdentityCommunicationIntent]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[IdentityCommunicationIntent] TO [$(app_login)];
  DENY DELETE, ALTER ON OBJECT::[dbo].[IdentityCommunicationIntent] TO [$(app_login)];
END;

-- Identity's narrow vendor-mutation reconciliation marker. Runtime prepares,
-- stamps and completes it, but cannot erase committed evidence.
IF OBJECT_ID(N'[dbo].[IdentitySecurityOperation]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[IdentitySecurityOperation] TO [$(app_login)];
  DENY DELETE, ALTER ON OBJECT::[dbo].[IdentitySecurityOperation] TO [$(app_login)];
END;

-- Identity & Access — authorisation (Phase 2 Chunk 2) -------------------------
--
-- The permission catalogue is IMMUTABLE AT RUNTIME. SELECT and nothing else,
-- with every write verb denied explicitly: "a permission cannot be created at
-- runtime" then holds because the database refuses it, not because application
-- code remembers to (SECURITY_BASELINE.md 3.1).
IF OBJECT_ID(N'[dbo].[Permission]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT ON OBJECT::[dbo].[Permission] TO [$(app_login)];
  DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[Permission] TO [$(app_login)];
END;

-- Roles are created and edited at runtime — CUSTOM ones. The protected system
-- role is defended by application invariants AND by the absence of DELETE:
-- a role with history is soft-deactivated, never destroyed, so the record of
-- who held what survives.
IF OBJECT_ID(N'[dbo].[Role]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Role] TO [$(app_login)];
  DENY DELETE, ALTER ON OBJECT::[dbo].[Role] TO [$(app_login)];
END;

-- A bundle is a SET: a membership exists or it does not, so INSERT and DELETE
-- are the operations and UPDATE is denied — there is no third state for a
-- composite key to be moved into.
IF OBJECT_ID(N'[dbo].[RolePermission]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[RolePermission] TO [$(app_login)];
  DENY UPDATE, ALTER ON OBJECT::[dbo].[RolePermission] TO [$(app_login)];
END;

-- Assignments are granted and REVOKED, and revoking marks the row rather than
-- removing it. DELETE is denied because "this person held the administrator
-- role between these dates" is exactly the fact an investigation needs and
-- exactly the fact a delete destroys (SECURITY_BASELINE.md 13.3).
IF OBJECT_ID(N'[dbo].[RoleAssignment]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[RoleAssignment] TO [$(app_login)];
  DENY DELETE, ALTER ON OBJECT::[dbo].[RoleAssignment] TO [$(app_login)];
END;

-- A step-up grant is issued and REVOKED, and revoking one is a delete — which
-- is the whole reason it is a row rather than a token. UPDATE is denied: the
-- lifetime is fixed when the grant is created, and a runtime that could extend
-- one could turn a five-minute elevation into a permanent one.
IF OBJECT_ID(N'[dbo].[StepUpGrant]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[StepUpGrant] TO [$(app_login)];
  DENY UPDATE, ALTER ON OBJECT::[dbo].[StepUpGrant] TO [$(app_login)];
END;

-- Better Auth's two-factor record. The library creates it at enrolment,
-- updates it when a code is verified or a recovery code is spent, and deletes
-- it when the factor is disabled — so all four verbs are genuinely required.
IF OBJECT_ID(N'[dbo].[TwoFactor]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[TwoFactor] TO [$(app_login)];
  DENY ALTER ON OBJECT::[dbo].[TwoFactor] TO [$(app_login)];
END;

-- The privileged posture. Written by enrolment and cleared by disable, but
-- never DELETED: the row is how the platform knows an account once held
-- privileged authority, and clearing it to nulls says that truthfully while
-- removing it would not.
IF OBJECT_ID(N'[dbo].[PrivilegedSecurityPosture]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[PrivilegedSecurityPosture] TO [$(app_login)];
  DENY DELETE, ALTER ON OBJECT::[dbo].[PrivilegedSecurityPosture] TO [$(app_login)];
END;

-- The one-time bootstrap record is READ by the admin security surface and
-- written by nothing the application can reach. The bootstrap itself is a
-- host-only procedure the runtime principal may not execute
-- (SECURITY_BASELINE.md 8.3).
IF OBJECT_ID(N'[dbo].[IdentityBootstrap]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT ON OBJECT::[dbo].[IdentityBootstrap] TO [$(app_login)];
  DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[IdentityBootstrap] TO [$(app_login)];
END;

-- THE OPERATOR PROCEDURES ARE NOT THE APPLICATION'S.
--
-- Ownership chaining would give the runtime principal nothing here — it holds
-- no EXECUTE — but the denial is written explicitly so the boundary is legible
-- in sys.database_permissions and survives any future role change. A web
-- request must never be able to provision an administrator or reset a second
-- factor, whatever the application code says.
IF OBJECT_ID(N'[dbo].[IdentityBootstrapPlatformAdministrator]', N'P') IS NOT NULL
  DENY EXECUTE ON OBJECT::[dbo].[IdentityBootstrapPlatformAdministrator] TO [$(app_login)];

IF OBJECT_ID(N'[dbo].[IdentityRecoverPrivilegedSecondFactor]', N'P') IS NOT NULL
  DENY EXECUTE ON OBJECT::[dbo].[IdentityRecoverPrivilegedSecondFactor] TO [$(app_login)];

-- Layer-0 platform concerns --------------------------------------------------
--
-- Delivery metadata is append-and-update: a delivery is claimed, attempted and
-- resolved. Deleting one would erase the record of a message the platform owed
-- someone, so DELETE is denied and retention is an operational decision made
-- deliberately, not a side effect of dispatch.
IF OBJECT_ID(N'[dbo].[EmailDelivery]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[EmailDelivery] TO [$(app_login)];
  DENY DELETE, ALTER ON OBJECT::[dbo].[EmailDelivery] TO [$(app_login)];
END;

-- Suppression protects a recipient from mail their provider has already
-- rejected. The runtime may add one; removing one is an operator decision,
-- because a runtime that could quietly un-suppress could resume sending to an
-- address that complained.
IF OBJECT_ID(N'[dbo].[EmailSuppression]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT ON OBJECT::[dbo].[EmailSuppression] TO [$(app_login)];
  DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[EmailSuppression] TO [$(app_login)];
END;

-- Provider-event de-duplication. Append and mark processed; never delete, or
-- replay resistance would last exactly as long as the row did.
IF OBJECT_ID(N'[dbo].[ProviderEvent]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[ProviderEvent] TO [$(app_login)];
  DENY DELETE, ALTER ON OBJECT::[dbo].[ProviderEvent] TO [$(app_login)];
END;

-- Rate-limit counters are the one genuinely disposable table here: windows
-- expire and bounded cleanup removes them, so DELETE is required.
IF OBJECT_ID(N'[dbo].[RateLimitCounter]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[RateLimitCounter] TO [$(app_login)];
  DENY ALTER ON OBJECT::[dbo].[RateLimitCounter] TO [$(app_login)];
END;

-- Taxonomy (Phase 3B) ---------------------------------------------------------
--
-- NO DELETE ON ANY OF THE THREE AGGREGATES, and that is the phase's central
-- integrity claim rather than a preference.
--
-- A later context's typed topic assignment will carry a real foreign key to
-- `Topic`. If the runtime could delete a Topic, it could either orphan that
-- assignment or be blocked by it at an arbitrary moment; denying DELETE means
-- neither is reachable, and "deleting a Topic cannot orphan an assignment" is
-- enforced by the grant rather than by an application check somebody wrote.
-- Archive and retire are the lifecycles, exactly as `Role` is soft-deactivated.
IF OBJECT_ID(N'[dbo].[Topic]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Topic] TO [$(app_login)];
  -- A Topic slug is chosen at creation and is then a stable public identity.
  -- There is no redirect or slug-history mechanism in Phase 3B, so even a
  -- caller holding the runtime principal cannot rewrite an existing slug.
  DENY UPDATE ON OBJECT::[dbo].[Topic] ([slug]) TO [$(app_login)];
  DENY DELETE, ALTER ON OBJECT::[dbo].[Topic] TO [$(app_login)];
END;

-- The ONE taxonomy table the runtime may delete from, and only because removing
-- a locale's translation is a real administrative act: an Urdu name entered in
-- error has to be removable, and blanking it to an empty string would be a
-- translation that exists and says nothing.
--
-- The fallback row is still not removable — `TaxonomyTopicFallback` refuses any
-- delete that would leave a Topic without it, so this grant cannot be used to
-- make a Topic render as nothing.
IF OBJECT_ID(N'[dbo].[TopicTranslation]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[TopicTranslation] TO [$(app_login)];
  DENY ALTER ON OBJECT::[dbo].[TopicTranslation] TO [$(app_login)];
END;

-- Content-language reference data. Retired, never deleted: a work recorded in a
-- language stays true after the organisation stops publishing in it, and a
-- delete would either destroy that record or be blocked by it.
IF OBJECT_ID(N'[dbo].[Language]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Language] TO [$(app_login)];
  DENY DELETE, ALTER ON OBJECT::[dbo].[Language] TO [$(app_login)];
END;

-- Tags are free-form, and still not destroyed. A tag an editor applied is part
-- of how content was described at the time; retiring it stops it being offered
-- without rewriting that history.
IF OBJECT_ID(N'[dbo].[Tag]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Tag] TO [$(app_login)];
  DENY DELETE, ALTER ON OBJECT::[dbo].[Tag] TO [$(app_login)];
END;

-- Migration history is administrative state, not application data.
IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
BEGIN
  DENY SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[_prisma_migrations] TO [$(app_login)];
END;
