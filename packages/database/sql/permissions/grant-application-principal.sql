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

-- People & Contributors (Phase 5) ---------------------------------------------
--
-- NO DELETE ON `Person` OR ON ANY OF THE FOUR PROFILE TABLES, and that is this
-- phase's central integrity claim rather than a preference.
--
-- A later content context's contributor reference will carry a real foreign key
-- to `Person` or to one of the profiles. If the runtime could delete one, it
-- could either orphan that reference or be blocked by it at an arbitrary
-- moment; denying DELETE means neither is reachable, and "removing a
-- contributor cannot orphan an attribution" is enforced by the grant rather
-- than by an application check somebody wrote. Archive is the lifecycle,
-- exactly as it is for `Topic` and `Role`.
IF OBJECT_ID(N'[dbo].[Person]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, UPDATE ON OBJECT::[dbo].[Person] TO [$(app_login)];
  DENY INSERT ON OBJECT::[dbo].[Person] TO [$(app_login)];
  -- A Person slug is chosen at creation and is then a stable public identity.
  -- DOMAIN_MODEL.md §19.7 permits an editable canonical slug only alongside
  -- native slug history and automatic 301s, and Phase 5 ships neither — so even
  -- a caller holding the runtime principal cannot rewrite one. The same
  -- column-level denial `Topic.slug` carries, for the same reason.
  DENY UPDATE ON OBJECT::[dbo].[Person] ([slug]) TO [$(app_login)];
  DENY DELETE, ALTER ON OBJECT::[dbo].[Person] TO [$(app_login)];
END;

IF OBJECT_ID(N'[dbo].[PeopleCreatePerson]', N'P') IS NOT NULL
  GRANT EXECUTE ON OBJECT::[dbo].[PeopleCreatePerson] TO [$(app_login)];

IF OBJECT_ID(N'[dbo].[PeopleAddNameVariant]', N'P') IS NOT NULL
  GRANT EXECUTE ON OBJECT::[dbo].[PeopleAddNameVariant] TO [$(app_login)];

-- The child rows ARE deletable, and the asymmetry is deliberate. Removing an
-- Urdu name entered in error is a real administrative act, and blanking it to
-- an empty string would be a translation that exists and says nothing. The
-- primary-locale translation is still not removable — `PeoplePersonPrimaryName`
-- refuses any delete that would leave a Person without one — so this grant
-- cannot be used to make a Person render as nothing.
IF OBJECT_ID(N'[dbo].[PersonTranslation]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[PersonTranslation] TO [$(app_login)];
  DENY ALTER ON OBJECT::[dbo].[PersonTranslation] TO [$(app_login)];
END;

-- Name variants are added and removed, never edited: changing one in place
-- would silently rewrite what the unique index compared, so UPDATE is denied
-- and a correction is a remove followed by an add.
IF OBJECT_ID(N'[dbo].[PersonNameVariant]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, DELETE ON OBJECT::[dbo].[PersonNameVariant] TO [$(app_login)];
  DENY INSERT, UPDATE, ALTER ON OBJECT::[dbo].[PersonNameVariant] TO [$(app_login)];
END;

-- The four profile aggregates. Created and moved through their own lifecycles;
-- never destroyed, for the same reason `Person` is not.
IF OBJECT_ID(N'[dbo].[AuthorProfile]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[AuthorProfile] TO [$(app_login)];
  DENY DELETE, ALTER ON OBJECT::[dbo].[AuthorProfile] TO [$(app_login)];
END;

IF OBJECT_ID(N'[dbo].[SpeakerProfile]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[SpeakerProfile] TO [$(app_login)];
  DENY DELETE, ALTER ON OBJECT::[dbo].[SpeakerProfile] TO [$(app_login)];
END;

IF OBJECT_ID(N'[dbo].[ScholarProfile]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[ScholarProfile] TO [$(app_login)];
  DENY DELETE, ALTER ON OBJECT::[dbo].[ScholarProfile] TO [$(app_login)];
END;

IF OBJECT_ID(N'[dbo].[TeacherProfile]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[TeacherProfile] TO [$(app_login)];
  DENY DELETE, ALTER ON OBJECT::[dbo].[TeacherProfile] TO [$(app_login)];
END;

-- Profile prose, per locale. Removable for the same reason a Person
-- translation is: an entry made in error must be retractable.
IF OBJECT_ID(N'[dbo].[ScholarProfileTranslation]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[ScholarProfileTranslation] TO [$(app_login)];
  DENY ALTER ON OBJECT::[dbo].[ScholarProfileTranslation] TO [$(app_login)];
END;

IF OBJECT_ID(N'[dbo].[TeacherProfileTranslation]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[TeacherProfileTranslation] TO [$(app_login)];
  DENY ALTER ON OBJECT::[dbo].[TeacherProfileTranslation] TO [$(app_login)];
END;

-- A profile's language list is a SET: a language is listed or it is not, so
-- INSERT and DELETE are the operations and UPDATE is denied — there is no third
-- state for a composite-key membership row to be moved into. The same posture
-- `RolePermission` already has, for the same reason.
IF OBJECT_ID(N'[dbo].[ScholarProfileLanguage]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[ScholarProfileLanguage] TO [$(app_login)];
  DENY UPDATE, ALTER ON OBJECT::[dbo].[ScholarProfileLanguage] TO [$(app_login)];
END;

IF OBJECT_ID(N'[dbo].[TeacherProfileLanguage]', N'U') IS NOT NULL
BEGIN
  GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[TeacherProfileLanguage] TO [$(app_login)];
  DENY UPDATE, ALTER ON OBJECT::[dbo].[TeacherProfileLanguage] TO [$(app_login)];
END;

-- Migration history is administrative state, not application data.
IF OBJECT_ID(N'[dbo].[_prisma_migrations]', N'U') IS NOT NULL
BEGIN
  DENY SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[_prisma_migrations] TO [$(app_login)];
END;

-- Phase 6: immutable revisions/slugs, mutable workflow, and narrowly owned correspondence purge.
IF OBJECT_ID(N'[dbo].[Article]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Article] TO [$(app_login)]; DENY ALTER, DELETE ON OBJECT::[dbo].[Article] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[Page]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Page] TO [$(app_login)]; DENY ALTER, DELETE ON OBJECT::[dbo].[Page] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[ArticleRevision]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[ArticleRevision] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[ArticleRevision] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PageRevision]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[PageRevision] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[PageRevision] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[ArticleRevisionTranslation]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[ArticleRevisionTranslation] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[ArticleRevisionTranslation] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PageRevisionTranslation]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[PageRevisionTranslation] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[PageRevisionTranslation] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[ArticleTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[ArticleTopic] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[ArticleTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PageTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[PageTopic] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[PageTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[ArticleContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[ArticleContributor] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[ArticleContributor] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PageContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[PageContributor] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[PageContributor] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[ArticleSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[ArticleSlugHistory] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[ArticleSlugHistory] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PageSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[PageSlugHistory] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[PageSlugHistory] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[ContactInquiry]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[ContactInquiry] TO [$(app_login)]; DENY ALTER ON OBJECT::[dbo].[ContactInquiry] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[Feedback]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[Feedback] TO [$(app_login)]; DENY ALTER ON OBJECT::[dbo].[Feedback] TO [$(app_login)]; END;

-- Phase 13: the four News families, by the Phase-6 postures exactly — records
-- inserted and moved through the workflow but never deleted; revisions, their
-- translations and typed references appended and never changed; slug
-- reservations appended and never released.
IF OBJECT_ID(N'[dbo].[NewsArticle]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[NewsArticle] TO [$(app_login)]; DENY ALTER, DELETE ON OBJECT::[dbo].[NewsArticle] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[NewsArticleRevision]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[NewsArticleRevision] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[NewsArticleRevision] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[NewsArticleRevisionTranslation]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[NewsArticleRevisionTranslation] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[NewsArticleRevisionTranslation] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[NewsArticleTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[NewsArticleTopic] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[NewsArticleTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[NewsArticleContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[NewsArticleContributor] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[NewsArticleContributor] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[NewsArticleSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[NewsArticleSlugHistory] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[NewsArticleSlugHistory] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PressRelease]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[PressRelease] TO [$(app_login)]; DENY ALTER, DELETE ON OBJECT::[dbo].[PressRelease] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PressReleaseRevision]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[PressReleaseRevision] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[PressReleaseRevision] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PressReleaseRevisionTranslation]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[PressReleaseRevisionTranslation] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[PressReleaseRevisionTranslation] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PressReleaseTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[PressReleaseTopic] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[PressReleaseTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PressReleaseContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[PressReleaseContributor] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[PressReleaseContributor] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PressReleaseSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[PressReleaseSlugHistory] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[PressReleaseSlugHistory] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[Statement]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Statement] TO [$(app_login)]; DENY ALTER, DELETE ON OBJECT::[dbo].[Statement] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[StatementRevision]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[StatementRevision] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[StatementRevision] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[StatementRevisionTranslation]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[StatementRevisionTranslation] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[StatementRevisionTranslation] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[StatementTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[StatementTopic] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[StatementTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[StatementContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[StatementContributor] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[StatementContributor] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[StatementSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[StatementSlugHistory] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[StatementSlugHistory] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[MediaCoverage]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[MediaCoverage] TO [$(app_login)]; DENY ALTER, DELETE ON OBJECT::[dbo].[MediaCoverage] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[MediaCoverageRevision]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[MediaCoverageRevision] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[MediaCoverageRevision] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[MediaCoverageRevisionTranslation]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[MediaCoverageRevisionTranslation] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[MediaCoverageRevisionTranslation] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[MediaCoverageTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[MediaCoverageTopic] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[MediaCoverageTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[MediaCoverageContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[MediaCoverageContributor] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[MediaCoverageContributor] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[MediaCoverageSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[MediaCoverageSlugHistory] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[MediaCoverageSlugHistory] TO [$(app_login)]; END;

-- Phase 7: storage custody metadata. The runtime creates, measures, clears and
-- reconciles assets, so it needs DELETE here — reconciliation removes rows a
-- crash left mid-upload. It never needs ALTER, and the state CHECK constraints
-- are therefore beyond its reach: it cannot widen the lifecycle it is bound by.
IF OBJECT_ID(N'[dbo].[Asset]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[Asset] TO [$(app_login)]; DENY ALTER ON OBJECT::[dbo].[Asset] TO [$(app_login)]; END;

-- Phase 8: Library aggregates, replaceable relation sets, permanent slug reservations.
IF OBJECT_ID(N'[dbo].[Work]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Work] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[Work] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[Edition]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Edition] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[Edition] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[SalePoint]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[SalePoint] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[SalePoint] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[WorkLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[WorkLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[WorkLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[WorkContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[WorkContributor] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[WorkContributor] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[WorkTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[WorkTopic] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[WorkTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[WorkSalePoint]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[WorkSalePoint] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[WorkSalePoint] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[BookTranslator]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[BookTranslator] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[BookTranslator] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[BookTranslation]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[BookTranslation] TO [$(app_login)]; DENY ALTER ON OBJECT::[dbo].[BookTranslation] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[WorkSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[WorkSlugHistory] TO [$(app_login)]; DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[WorkSlugHistory] TO [$(app_login)]; END;

-- Phase 9: the scholarly and periodical Library aggregates, by the SAME three
-- postures as Phase 8. Aggregates are INSERT and UPDATE and never DELETE — a
-- record is withdrawn by archiving it, so the row its slug reservations, audit
-- entries and contributor credits point at always exists. Relation sets are
-- replaced wholesale on save, so INSERT and DELETE and never UPDATE. Slug
-- histories are APPEND ONLY. No Storage table is reached: Phase 9 has no files.
IF OBJECT_ID(N'[dbo].[Research]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Research] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[Research] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[ResearchPaper]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[ResearchPaper] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[ResearchPaper] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[Publication]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Publication] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[Publication] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[Magazine]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Magazine] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[Magazine] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[MagazineIssue]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[MagazineIssue] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[MagazineIssue] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[Encyclopedia]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Encyclopedia] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[Encyclopedia] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[ResearchLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[ResearchLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[ResearchLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[ResearchContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[ResearchContributor] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[ResearchContributor] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[ResearchTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[ResearchTopic] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[ResearchTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[ResearchPaperLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[ResearchPaperLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[ResearchPaperLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[ResearchPaperContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[ResearchPaperContributor] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[ResearchPaperContributor] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[ResearchPaperTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[ResearchPaperTopic] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[ResearchPaperTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PublicationLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[PublicationLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[PublicationLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PublicationContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[PublicationContributor] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[PublicationContributor] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PublicationTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[PublicationTopic] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[PublicationTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[MagazineLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[MagazineLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[MagazineLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[MagazineContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[MagazineContributor] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[MagazineContributor] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[MagazineTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[MagazineTopic] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[MagazineTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[MagazineIssueLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[MagazineIssueLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[MagazineIssueLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[MagazineIssueContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[MagazineIssueContributor] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[MagazineIssueContributor] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[MagazineIssueTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[MagazineIssueTopic] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[MagazineIssueTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[EncyclopediaLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[EncyclopediaLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[EncyclopediaLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[EncyclopediaContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[EncyclopediaContributor] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[EncyclopediaContributor] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[EncyclopediaTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[EncyclopediaTopic] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[EncyclopediaTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[ResearchCitation]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[ResearchCitation] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[ResearchCitation] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[ResearchPaperCitation]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[ResearchPaperCitation] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[ResearchPaperCitation] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[ResearchSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[ResearchSlugHistory] TO [$(app_login)]; DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[ResearchSlugHistory] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[ResearchPaperSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[ResearchPaperSlugHistory] TO [$(app_login)]; DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[ResearchPaperSlugHistory] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PublicationSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[PublicationSlugHistory] TO [$(app_login)]; DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[PublicationSlugHistory] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[MagazineSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[MagazineSlugHistory] TO [$(app_login)]; DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[MagazineSlugHistory] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[MagazineIssueSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[MagazineIssueSlugHistory] TO [$(app_login)]; DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[MagazineIssueSlugHistory] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[EncyclopediaSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[EncyclopediaSlugHistory] TO [$(app_login)]; DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[EncyclopediaSlugHistory] TO [$(app_login)]; END;

-- Phase 10: Media — Video, Series and Playlist, by the SAME three postures as
-- the Library. Aggregates are INSERT and UPDATE and never DELETE — a record is
-- withdrawn by archiving it, so the row its slug reservations, audit entries,
-- episodes and playlist places point at always exists. Relation sets (labels,
-- speakers, topics, playlist membership) are replaced wholesale on save, so
-- INSERT and DELETE and never UPDATE. Slug histories are APPEND ONLY. No
-- Storage table is reached: a Video is provider metadata and has no bytes.
IF OBJECT_ID(N'[dbo].[Video]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Video] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[Video] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[Series]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Series] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[Series] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[Playlist]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Playlist] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[Playlist] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[VideoLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[VideoLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[VideoLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[VideoSpeaker]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[VideoSpeaker] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[VideoSpeaker] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[VideoTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[VideoTopic] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[VideoTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[SeriesLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[SeriesLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[SeriesLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PlaylistLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[PlaylistLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[PlaylistLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PlaylistVideo]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[PlaylistVideo] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[PlaylistVideo] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[VideoSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[VideoSlugHistory] TO [$(app_login)]; DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[VideoSlugHistory] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[SeriesSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[SeriesSlugHistory] TO [$(app_login)]; DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[SeriesSlugHistory] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PlaylistSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[PlaylistSlugHistory] TO [$(app_login)]; DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[PlaylistSlugHistory] TO [$(app_login)]; END;

-- Phase 11: Media — AudioTrack and AudioSeries, by the SAME three postures.
-- Aggregates are INSERT and UPDATE and never DELETE; relation sets are replaced
-- wholesale (INSERT and DELETE, never UPDATE); slug histories are APPEND ONLY.
-- The audio FILE is reached only through Storage's own `Asset` grants above and
-- the StorageService: a track holds a foreign key to an Asset and nothing here
-- widens what the runtime may do to one.
IF OBJECT_ID(N'[dbo].[AudioTrack]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[AudioTrack] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[AudioTrack] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[AudioSeries]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[AudioSeries] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[AudioSeries] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[AudioTrackLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[AudioTrackLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[AudioTrackLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[AudioTrackSpeaker]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[AudioTrackSpeaker] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[AudioTrackSpeaker] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[AudioTrackTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[AudioTrackTopic] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[AudioTrackTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[AudioSeriesLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[AudioSeriesLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[AudioSeriesLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[AudioTrackSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[AudioTrackSlugHistory] TO [$(app_login)]; DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[AudioTrackSlugHistory] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[AudioSeriesSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[AudioSeriesSlugHistory] TO [$(app_login)]; DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[AudioSeriesSlugHistory] TO [$(app_login)]; END;

-- Phase 12: Media — Photo, Gallery and GalleryItem, by the SAME three postures.
-- Aggregates are INSERT and UPDATE and never DELETE — a Photo or a Gallery is
-- withdrawn by archiving it, so no removal can take a Gallery's Photos or a
-- Photo's image with it. Labels and Gallery membership are replaced wholesale
-- (INSERT and DELETE, never UPDATE); the Gallery slug history is APPEND ONLY.
-- The image is reached only through Storage's own `Asset` grants above and the
-- StorageService: a Photo holds a foreign key to an Asset and nothing here
-- widens what the runtime may do to one.
IF OBJECT_ID(N'[dbo].[Photo]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Photo] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[Photo] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[Gallery]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Gallery] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[Gallery] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[PhotoLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[PhotoLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[PhotoLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[GalleryLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[GalleryLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[GalleryLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[GalleryItem]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[GalleryItem] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[GalleryItem] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[GallerySlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[GallerySlugHistory] TO [$(app_login)]; DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[GallerySlugHistory] TO [$(app_login)]; END;

-- Phase 16: Global Network, by the SAME three postures. Country, Region, City
-- and Centre are INSERT and UPDATE and never DELETE — a directory record is
-- withdrawn by archiving it, so the row its slugs, children, contacts, served
-- Cities, audit entries and centre-scoped News point at always exists. Labels,
-- served Cities and contacts are replaced wholesale under the Centre's version
-- (INSERT and DELETE, never UPDATE). Slug histories are APPEND ONLY. The News
-- revision's Centre column needs no grant of its own: revisions stay INSERT-only.
IF OBJECT_ID(N'[dbo].[Country]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Country] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[Country] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[Region]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Region] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[Region] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[City]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[City] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[City] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[Centre]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Centre] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[Centre] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[CountryLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[CountryLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[CountryLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[RegionLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[RegionLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[RegionLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[CityLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[CityLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[CityLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[CentreLabel]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[CentreLabel] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[CentreLabel] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[CentreServiceCity]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[CentreServiceCity] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[CentreServiceCity] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[CentreContact]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[CentreContact] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[CentreContact] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[CountrySlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[CountrySlugHistory] TO [$(app_login)]; DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[CountrySlugHistory] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[RegionSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[RegionSlugHistory] TO [$(app_login)]; DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[RegionSlugHistory] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[CitySlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[CitySlugHistory] TO [$(app_login)]; DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[CitySlugHistory] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[CentreSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[CentreSlugHistory] TO [$(app_login)]; DENY UPDATE, DELETE, ALTER ON OBJECT::[dbo].[CentreSlugHistory] TO [$(app_login)]; END;

-- Phase 14: Event, by the Phase-6 postures exactly — the record inserted and
-- moved through the workflow but never deleted; revisions, their translations,
-- typed Topic and Person references, occurrences and Gallery associations
-- appended and never changed; slug reservations appended and never released.
-- Referencing a Centre or a Gallery grants NOTHING on Global's or Media's tables
-- beyond what those owners' own postures already give this principal.
IF OBJECT_ID(N'[dbo].[Event]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Event] TO [$(app_login)]; DENY ALTER, DELETE ON OBJECT::[dbo].[Event] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[EventRevision]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[EventRevision] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[EventRevision] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[EventRevisionTranslation]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[EventRevisionTranslation] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[EventRevisionTranslation] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[EventTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[EventTopic] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[EventTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[EventContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[EventContributor] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[EventContributor] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[EventSchedule]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[EventSchedule] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[EventSchedule] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[EventGallery]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[EventGallery] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[EventGallery] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[EventSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[EventSlugHistory] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[EventSlugHistory] TO [$(app_login)]; END;

-- Phase 15: Collection, by the Phase-6 postures exactly — the record inserted
-- and moved through the workflow but never deleted; revisions, their
-- translations, typed Topic and Person references and ordered members appended
-- and never changed; slug reservations appended and never released. Naming an
-- Article, a News record, a Work or a Video as a member grants NOTHING on its
-- owner's table beyond what that owner's own posture already gives this
-- principal.
IF OBJECT_ID(N'[dbo].[Collection]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[Collection] TO [$(app_login)]; DENY ALTER, DELETE ON OBJECT::[dbo].[Collection] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[CollectionRevision]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[CollectionRevision] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[CollectionRevision] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[CollectionRevisionTranslation]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[CollectionRevisionTranslation] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[CollectionRevisionTranslation] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[CollectionTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[CollectionTopic] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[CollectionTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[CollectionContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[CollectionContributor] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[CollectionContributor] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[CollectionItem]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[CollectionItem] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[CollectionItem] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[CollectionSlugHistory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT ON OBJECT::[dbo].[CollectionSlugHistory] TO [$(app_login)]; DENY ALTER, UPDATE, DELETE ON OBJECT::[dbo].[CollectionSlugHistory] TO [$(app_login)]; END;

-- Phase 17: the DERIVED search projection and its operational state.
--
-- `SearchIndexRequest` is append-only for the owners that write it inside their
-- own transactions; the indexer consumes (DELETEs) a request once it has been
-- folded into scope state, so UPDATE has no use and is denied.
-- `SearchIndexScope` is never deleted: a scope's row is its indexing history,
-- and a withdrawn resource keeps a row that says it holds no documents.
-- `SearchDocument` is rewritten and removed as owners publish and withdraw.
-- Full-text QUERYING needs SELECT and nothing more; the catalogue and index are
-- migration-owned, and ALTER is denied throughout.
IF OBJECT_ID(N'[dbo].[SearchIndexRequest]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[SearchIndexRequest] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[SearchIndexRequest] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[SearchIndexScope]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[SearchIndexScope] TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[SearchIndexScope] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[SearchDocument]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[SearchDocument] TO [$(app_login)]; DENY ALTER ON OBJECT::[dbo].[SearchDocument] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[SearchDocumentTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[SearchDocumentTopic] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[SearchDocumentTopic] TO [$(app_login)]; END;

-- Phase 18: Quran.
--
-- SOURCE AND ACTIVATION ARE READ-ONLY. A registered source, its text and the
-- corpus activation are the owner/operator's acts; the runtime can read them and
-- nothing else, so no permission held through this principal can create an
-- authority, turn a fixture into one, or switch a corpus on.
IF OBJECT_ID(N'[dbo].[QuranSource]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[QuranSource] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[QuranSource] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[QuranSourceSurah]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[QuranSourceSurah] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[QuranSourceSurah] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[QuranSourceAyah]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[QuranSourceAyah] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[QuranSourceAyah] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[QuranActivation]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[QuranActivation] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[QuranActivation] TO [$(app_login)]; END;
--
-- CANONICAL TABLES ARE READ-ONLY TOO. Juz, Surah, Ayah, their history and the
-- verification evidence are written ONLY by the procedures granted below, which
-- re-check the actor's live `quran.editCanonical` grant and purpose-bound
-- step-up grant, the source, the expected version and the exact text in SQL.
-- This principal holds no UPDATE on Ayah, so ordinary administration has no path
-- to canonical Arabic at all, and no DELETE on the history. A Surah's
-- DISPLAY-NAME version is the one column it may advance.
IF OBJECT_ID(N'[dbo].[Juz]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[Juz] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[Juz] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[Surah]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[Surah] TO [$(app_login)]; GRANT UPDATE ON OBJECT::[dbo].[Surah] ([namesVersion], [updatedAt]) TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[Surah] ([number], [ayahCount], [revelation], [nameArabic], [sourceId], [createdAt]) TO [$(app_login)]; DENY INSERT, DELETE, ALTER ON OBJECT::[dbo].[Surah] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[Ayah]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[Ayah] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[Ayah] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[QuranAyahRevision]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[QuranAyahRevision] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[QuranAyahRevision] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[QuranVerificationRun]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[QuranVerificationRun] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[QuranVerificationRun] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[QuranAcceptCorpus]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[QuranAcceptCorpus] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[QuranCorrectAyah]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[QuranCorrectAyah] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[QuranRecordVerificationFailure]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[QuranRecordVerificationFailure] TO [$(app_login)];
-- The authority check is reached only from inside the two writing procedures.
IF OBJECT_ID(N'[dbo].[QuranAssertCanonicalAuthority]',N'P') IS NOT NULL DENY EXECUTE ON OBJECT::[dbo].[QuranAssertCanonicalAuthority] TO [$(app_login)];
--
-- LAYERED WORKS, by the Library postures. Records are inserted and updated but
-- never deleted — archive is the lifecycle — and a slug is chosen once: the
-- column refuses UPDATE, so a public address never changes and no slug history
-- is owed. Texts, entries, contributors, segments, display names and topic
-- assignments are child rows and may be replaced. Naming a Person, a Topic, a
-- Language or an Asset grants NOTHING on those owners' tables beyond their own
-- postures.
IF OBJECT_ID(N'[dbo].[SurahName]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[SurahName] TO [$(app_login)]; DENY ALTER ON OBJECT::[dbo].[SurahName] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[QuranTranslation]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[QuranTranslation] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[QuranTranslation] ([slug]) TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[QuranTranslation] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[QuranTransliteration]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[QuranTransliteration] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[QuranTransliteration] ([slug]) TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[QuranTransliteration] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[QuranTafsir]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[QuranTafsir] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[QuranTafsir] ([slug]) TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[QuranTafsir] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[QuranRecitation]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[QuranRecitation] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[QuranRecitation] ([slug]) TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[QuranRecitation] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[QuranTajweedRule]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[QuranTajweedRule] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[QuranTajweedRule] ([slug]) TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[QuranTajweedRule] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[QuranTranslationContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[QuranTranslationContributor] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[QuranTranslationContributor] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[QuranTafsirContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[QuranTafsirContributor] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[QuranTafsirContributor] TO [$(app_login)]; END;
-- A text row belongs to its work and its place for ever: UPDATE reaches only
-- the words, so no published work can lose its last text by having it moved.
IF OBJECT_ID(N'[dbo].[QuranTranslationText]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[QuranTranslationText] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[QuranTranslationText] ([translationId], [surahNumber], [ayahNumber]) TO [$(app_login)]; DENY ALTER ON OBJECT::[dbo].[QuranTranslationText] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[QuranTransliterationText]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[QuranTransliterationText] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[QuranTransliterationText] ([transliterationId], [surahNumber], [ayahNumber]) TO [$(app_login)]; DENY ALTER ON OBJECT::[dbo].[QuranTransliterationText] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[QuranTafsirText]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[QuranTafsirText] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[QuranTafsirText] ([id], [tafsirId]) TO [$(app_login)]; DENY ALTER ON OBJECT::[dbo].[QuranTafsirText] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[QuranTajweedRuleText]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[QuranTajweedRuleText] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[QuranTajweedRuleText] ([ruleId], [languageCode]) TO [$(app_login)]; DENY ALTER ON OBJECT::[dbo].[QuranTajweedRuleText] TO [$(app_login)]; END;
-- A segment's range is fixed once created; only its audio relation is updated,
-- and replacing a file never deletes the one it replaced.
IF OBJECT_ID(N'[dbo].[QuranRecitationSegment]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[QuranRecitationSegment] TO [$(app_login)]; GRANT UPDATE ON OBJECT::[dbo].[QuranRecitationSegment] ([assetId]) TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[QuranRecitationSegment] ([id], [recitationId], [surahNumber], [startAyah], [endAyah], [createdAt]) TO [$(app_login)]; DENY ALTER ON OBJECT::[dbo].[QuranRecitationSegment] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[QuranTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[QuranTopic] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[QuranTopic] TO [$(app_login)]; END;

-- Phase 19: Hadith.
--
-- SOURCE AND ACTIVATION ARE READ-ONLY. A registered source system, its editions
-- and a collection's activation are the owner/operator's acts; the runtime can
-- read them and nothing else, so no permission held through this principal can
-- create an authority, turn a fixture into one, or make a collection public.
IF OBJECT_ID(N'[dbo].[HadithSourceSystem]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[HadithSourceSystem] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[HadithSourceSystem] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithEdition]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[HadithEdition] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[HadithEdition] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithActivation]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[HadithActivation] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[HadithActivation] TO [$(app_login)]; END;
--
-- CANONICAL TABLES ARE READ-ONLY TOO. Records, their history, gradings,
-- verifications, citations and conflict evidence are written ONLY by the
-- procedures granted below, which re-check the actor's live
-- `hadith.editCanonical` grant and purpose-bound step-up grant, the edition,
-- the expected version and the exact text in SQL. This principal holds no
-- UPDATE on a record, so ordinary administration has no path to canonical text,
-- chain or grading at all, and no DELETE on the history.
IF OBJECT_ID(N'[dbo].[Hadith]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[Hadith] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[Hadith] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithRevision]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[HadithRevision] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[HadithRevision] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithGrading]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[HadithGrading] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[HadithGrading] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithVerification]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[HadithVerification] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[HadithVerification] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithCitation]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[HadithCitation] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[HadithCitation] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithCitationRevision]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[HadithCitationRevision] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[HadithCitationRevision] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithConflict]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[HadithConflict] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[HadithConflict] TO [$(app_login)]; END;
-- Collection, Book and Chapter are canonical structure created by procedure; a
-- DISPLAY-NAME version is the one column each may advance.
IF OBJECT_ID(N'[dbo].[HadithCollection]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[HadithCollection] TO [$(app_login)]; GRANT UPDATE ON OBJECT::[dbo].[HadithCollection] ([namesVersion], [updatedAt]) TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[HadithCollection] ([id], [slug], [position], [createdAt]) TO [$(app_login)]; DENY INSERT, DELETE, ALTER ON OBJECT::[dbo].[HadithCollection] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithBook]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[HadithBook] TO [$(app_login)]; GRANT UPDATE ON OBJECT::[dbo].[HadithBook] ([namesVersion], [updatedAt]) TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[HadithBook] ([id], [collectionId], [editionId], [slug], [reference], [position], [title], [titleLanguage], [createdAt]) TO [$(app_login)]; DENY INSERT, DELETE, ALTER ON OBJECT::[dbo].[HadithBook] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithChapter]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[HadithChapter] TO [$(app_login)]; GRANT UPDATE ON OBJECT::[dbo].[HadithChapter] ([namesVersion], [updatedAt]) TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[HadithChapter] ([id], [bookId], [slug], [reference], [position], [title], [titleLanguage], [createdAt]) TO [$(app_login)]; DENY INSERT, DELETE, ALTER ON OBJECT::[dbo].[HadithChapter] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithCreateCollection]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[HadithCreateCollection] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[HadithCreateBook]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[HadithCreateBook] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[HadithCreateChapter]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[HadithCreateChapter] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[HadithWriteRecord]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[HadithWriteRecord] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[HadithVerifyRecord]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[HadithVerifyRecord] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[HadithSetCitation]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[HadithSetCitation] TO [$(app_login)];
-- The authority check and conflict detection are reached only from inside the
-- writing procedures: a caller can neither probe the one nor forge the other.
IF OBJECT_ID(N'[dbo].[HadithAssertCanonicalAuthority]',N'P') IS NOT NULL DENY EXECUTE ON OBJECT::[dbo].[HadithAssertCanonicalAuthority] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[HadithDetectConflicts]',N'P') IS NOT NULL DENY EXECUTE ON OBJECT::[dbo].[HadithDetectConflicts] TO [$(app_login)];
--
-- LAYERED WORKS, by the Quran postures. Translations, commentaries and sciences
-- are inserted and updated but never deleted — archive is the lifecycle — a
-- slug is chosen once, and a translation never moves to another record.
-- Entries, texts, contributors, display names and topic assignments are child
-- rows and may be replaced, but never re-parented. Naming a Person, a Topic, a
-- Language or a source system grants NOTHING on those owners' tables beyond
-- their own postures.
IF OBJECT_ID(N'[dbo].[HadithCollectionName]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[HadithCollectionName] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[HadithCollectionName] ([collectionId], [locale]) TO [$(app_login)]; DENY ALTER ON OBJECT::[dbo].[HadithCollectionName] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithBookName]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[HadithBookName] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[HadithBookName] ([bookId], [locale]) TO [$(app_login)]; DENY ALTER ON OBJECT::[dbo].[HadithBookName] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithChapterName]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[HadithChapterName] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[HadithChapterName] ([chapterId], [locale]) TO [$(app_login)]; DENY ALTER ON OBJECT::[dbo].[HadithChapterName] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithTranslation]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[HadithTranslation] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[HadithTranslation] ([hadithId]) TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[HadithTranslation] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithCommentary]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[HadithCommentary] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[HadithCommentary] ([slug]) TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[HadithCommentary] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithScience]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[HadithScience] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[HadithScience] ([slug]) TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[HadithScience] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithTranslationContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[HadithTranslationContributor] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[HadithTranslationContributor] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithCommentaryContributor]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[HadithCommentaryContributor] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[HadithCommentaryContributor] TO [$(app_login)]; END;
-- An entry or text belongs to its work and its place for ever: UPDATE reaches
-- only the words, so no published work can lose its last text by having it
-- moved.
IF OBJECT_ID(N'[dbo].[HadithCommentaryEntry]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[HadithCommentaryEntry] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[HadithCommentaryEntry] ([commentaryId], [hadithId]) TO [$(app_login)]; DENY ALTER ON OBJECT::[dbo].[HadithCommentaryEntry] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithScienceText]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[HadithScienceText] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[HadithScienceText] ([scienceId], [languageCode]) TO [$(app_login)]; DENY ALTER ON OBJECT::[dbo].[HadithScienceText] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[HadithTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, DELETE ON OBJECT::[dbo].[HadithTopic] TO [$(app_login)]; DENY UPDATE, ALTER ON OBJECT::[dbo].[HadithTopic] TO [$(app_login)]; END;

-- Phase 20: Fatwa.
--
-- ACTIVATION IS READ-ONLY. Whether the service accepts questions and publishes
-- at all is the owner/operator's act; no permission held through this
-- principal can open it.
IF OBJECT_ID(N'[dbo].[FatwaActivation]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[FatwaActivation] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[FatwaActivation] TO [$(app_login)]; END;
--
-- THE WORKFLOW TABLES ARE READ-ONLY TOO. Questions, rulings, revisions, their
-- topics, publications and review decisions are written ONLY by the procedures
-- granted below, which re-check the actor's live permission — and, to publish
-- or withdraw, a live `fatwa-publication` step-up grant — in SQL. No UPDATE on
-- a ruling means no path to "published" except `FatwaPublishRevision`; no
-- DELETE means no path to erasing history.
IF OBJECT_ID(N'[dbo].[FatwaQuestion]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[FatwaQuestion] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[FatwaQuestion] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[Fatwa]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[Fatwa] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[Fatwa] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[FatwaRevision]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[FatwaRevision] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[FatwaRevision] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[FatwaRevisionTopic]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[FatwaRevisionTopic] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[FatwaRevisionTopic] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[FatwaPublication]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[FatwaPublication] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[FatwaPublication] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[FatwaReviewDecision]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[FatwaReviewDecision] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[FatwaReviewDecision] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[FatwaReadTally]',N'U') IS NOT NULL BEGIN GRANT SELECT ON OBJECT::[dbo].[FatwaReadTally] TO [$(app_login)]; DENY INSERT, UPDATE, DELETE, ALTER ON OBJECT::[dbo].[FatwaReadTally] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[FatwaSubmitQuestion]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[FatwaSubmitQuestion] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[FatwaTriageQuestion]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[FatwaTriageQuestion] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[FatwaAssignQuestion]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[FatwaAssignQuestion] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[FatwaDeclineQuestion]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[FatwaDeclineQuestion] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[FatwaSaveDraft]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[FatwaSaveDraft] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[FatwaSubmitForReview]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[FatwaSubmitForReview] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[FatwaReturnForRevision]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[FatwaReturnForRevision] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[FatwaPublishRevision]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[FatwaPublishRevision] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[FatwaWithdraw]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[FatwaWithdraw] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[FatwaDisposeQuestions]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[FatwaDisposeQuestions] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[FatwaRecordRead]',N'P') IS NOT NULL GRANT EXECUTE ON OBJECT::[dbo].[FatwaRecordRead] TO [$(app_login)];
-- The authority checks are reached only from inside the writing procedures: a
-- caller cannot probe who holds a Fatwa permission through them.
IF OBJECT_ID(N'[dbo].[FatwaAssertPermission]',N'P') IS NOT NULL DENY EXECUTE ON OBJECT::[dbo].[FatwaAssertPermission] TO [$(app_login)];
IF OBJECT_ID(N'[dbo].[FatwaAssertPublicationAuthority]',N'P') IS NOT NULL DENY EXECUTE ON OBJECT::[dbo].[FatwaAssertPublicationAuthority] TO [$(app_login)];
--
-- CATEGORIES are administered through the Fatwa service under `fatwa.publish`.
-- A slug is chosen once and nothing is deleted; display names are child rows
-- that may be replaced but never re-parented.
IF OBJECT_ID(N'[dbo].[FatwaCategory]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE ON OBJECT::[dbo].[FatwaCategory] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[FatwaCategory] ([id], [slug], [createdAt]) TO [$(app_login)]; DENY DELETE, ALTER ON OBJECT::[dbo].[FatwaCategory] TO [$(app_login)]; END;
IF OBJECT_ID(N'[dbo].[FatwaCategoryName]',N'U') IS NOT NULL BEGIN GRANT SELECT, INSERT, UPDATE, DELETE ON OBJECT::[dbo].[FatwaCategoryName] TO [$(app_login)]; DENY UPDATE ON OBJECT::[dbo].[FatwaCategoryName] ([categoryId], [locale]) TO [$(app_login)]; DENY ALTER ON OBJECT::[dbo].[FatwaCategoryName] TO [$(app_login)]; END;
