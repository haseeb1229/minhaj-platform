-- ===========================================================================
-- Phase 23 — Learning: teacher experience & live classes
-- ===========================================================================
--
-- THE LEARNING CONTEXT'S SECOND SLICE (DOMAIN_MODEL.md 13.1-13.3): the typed
-- Course teaching scope, a teacher's bookable Availability, the conflict-safe
-- confirmation of a Phase-22 trial request into a Booking and its single
-- participant ClassSession, regular Course sessions, Attendance, and the
-- durable service-mail intent for confirmations, changes and reminders.
--
-- FAIL CLOSED UNTIL ACTIVATED. `LiveLearningActivation` is written only by the
-- owner/operator — the runtime holds SELECT and nothing else — and until a row
-- exists no window, session or booking can be inserted and no scheduled
-- session can change (51281). A migrated database holds NO activation: live
-- learning is OFF by default, and an `approved` row needs evidence
-- (OPEN_DECISIONS.md 2.1, 5.3, 6.3 stay open).
--
-- TEACHING AUTHORITY IS IDENTITY'S, SCOPED HERE BY TYPE. A teacher is an
-- account holding a LIVE RoleAssignment of an active role carrying
-- `teaching.perform` — catalogued here, EXTERNALLY GATED, bundled into no role
-- and granted to nobody — AND a CURRENT `CourseTeachingAssignment` naming the
-- exact Course and that exact RoleAssignment. A profile, a Course's public
-- `CourseTeacher` attribution and the absence of a scope row all grant
-- nothing. The scope row outlives revocation as safe history: the runtime
-- re-reads Identity's live assignments on every request, so revocation wins
-- immediately without erasing what was taught.
--
-- TYPED REFERENCES, NEVER COPIES. A scope names Course, User and
-- RoleAssignment by real keys; a session names its Course AND its scope by a
-- composite key that carries the Course, so a session can never sit on a
-- scope of another Course; a trial Booking names its request, its learner, its
-- Course, its session and the window it claims. No `scopeType`, `targetType`
-- or `sourceType` column exists anywhere.
--
-- A MEETING ADDRESS IS PRIVATE. Only an HTTPS `meet.google.com` address with
-- no credential, port, query, fragment or escape can be stored, only while a
-- session is scheduled, and it is NULL by CHECK once the session is
-- completed or cancelled. Nothing here copies it anywhere else.
--
-- CONFLICT SAFETY IS IN THE KEYS AND THE TRIGGERS. One Booking per request
-- (unique), one per session (unique), one LIVE claim per window (filtered
-- unique): two confirmations of one request or one window cannot both commit.
-- Two scheduled sessions of one teacher cannot overlap (51287); two open
-- windows of one teacher cannot overlap (51283). The adapter serialises on
-- the teacher BEFORE its first protected write (DOMAIN_MODEL.md 19.8); these
-- are the floor beneath it.
--
-- NOTHING CASCADES. Every foreign key is NO ACTION. A scope and a session are
-- never deleted; a Booking, an Attendance row, a window and an intent are
-- removed only by the owner's own bounded disposition. A trial request that a
-- Booking names can no longer be withdrawn by deletion: the key refuses it,
-- and cancellation is now the Booking's own act.
--
-- NO POLICY IS INVENTED. No age, guardian, consent, vetting, retention or
-- adults-only column exists; no grade, note or recording column exists; no
-- Google API identifier or credential exists; no Messaging table exists.
--
-- REFUSALS 51280-51292 (within the 51280-51299 range reserved for this phase):
--   51280  activation is immutable
--   51281  live learning is not activated
--   51282  a scope on a Course that is not live, under an assignment that is
--          not the account's live `teaching.perform` assignment, or a scope
--          whose identity was rewritten
--   51283  overlapping open windows of one teacher
--   51284  a window offered by an account holding no live `teaching.perform`
--   51285  a session on a Course that is not a published live Course, or on a
--          scope that is not current
--   51286  a terminal session changed, or returned to scheduled
--   51287  overlapping scheduled sessions of one teacher
--   51288  a Booking that does not fit its request, session and window, or
--          whose identity or terminal state was rewritten
--   51289  Attendance on a cancelled session, for an ineligible participant,
--          or re-keyed
--   51292  a relayed or abandoned intent reopened, or re-keyed
--
-- POSTURES FOR THE APPLICATION PRINCIPAL (grant-application-principal.sql):
--
--   ACTIVATION   LiveLearningActivation: SELECT only.
--   SCOPE        CourseTeachingAssignment: SELECT, INSERT, UPDATE of its
--                ending and version alone; never DELETE.
--   SESSION      ClassSession: SELECT, INSERT, UPDATE; never DELETE, and never
--                its identity, Course, kind or creation instant.
--   WINDOW       Availability: SELECT, INSERT, UPDATE of state/version, DELETE
--                (an unbooked window of a closed account).
--   BOOKING      Booking: SELECT, INSERT, UPDATE of state/cancellation/version,
--                DELETE (a closed account's own).
--   ATTENDANCE   Attendance: SELECT, INSERT, UPDATE of the mark, DELETE.
--   INTENT       ClassCommunicationIntent: SELECT, INSERT, UPDATE of
--                state/claim/relay, DELETE.
--
-- THREE KEYS: `teaching.perform` is catalogued and externally gated (bundled
-- into no role); `learning.classes.read` and `learning.classes.administer`
-- are ordinary keys that join the protected Platform Administrator bundle by
-- the convention every earlier phase used, invalidating its holders' sessions
-- in the same transaction.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.
-- ===========================================================================

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[LiveLearningActivation] (
    [id] TINYINT NOT NULL,
    [authority] NVARCHAR(16) NOT NULL,
    [authorisedBy] NVARCHAR(200) NOT NULL,
    [reference] NVARCHAR(400),
    [activatedAt] DATETIME2 NOT NULL CONSTRAINT [LiveLearningActivation_activatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [LiveLearningActivation_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[CourseTeachingAssignment] (
    [id] NVARCHAR(36) NOT NULL,
    [courseId] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [roleAssignmentId] NVARCHAR(36) NOT NULL,
    [grantedAt] DATETIME2 NOT NULL,
    [grantedById] NVARCHAR(36),
    [endedAt] DATETIME2,
    [endedById] NVARCHAR(36),
    [version] INT NOT NULL CONSTRAINT [CourseTeachingAssignment_version_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [CourseTeachingAssignment_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [CourseTeachingAssignment_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [CourseTeachingAssignment_owner_key] UNIQUE NONCLUSTERED ([id],[courseId])
);

-- CreateTable
CREATE TABLE [dbo].[Availability] (
    [id] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [startsAt] DATETIME2 NOT NULL,
    [endsAt] DATETIME2 NOT NULL,
    [timeZone] NVARCHAR(64) NOT NULL,
    [startsLocal] NVARCHAR(16) NOT NULL,
    [endsLocal] NVARCHAR(16) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [version] INT NOT NULL CONSTRAINT [Availability_version_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Availability_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Availability_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Availability_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ClassSession] (
    [id] NVARCHAR(36) NOT NULL,
    [courseId] NVARCHAR(36) NOT NULL,
    [kind] NVARCHAR(16) NOT NULL,
    [scopeId] NVARCHAR(36) NOT NULL,
    [startsAt] DATETIME2 NOT NULL,
    [endsAt] DATETIME2 NOT NULL,
    [timeZone] NVARCHAR(64) NOT NULL,
    [startsLocal] NVARCHAR(16) NOT NULL,
    [endsLocal] NVARCHAR(16) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [meetingProvider] NVARCHAR(32),
    [meetingUrl] NVARCHAR(200),
    [reminderAt] DATETIME2,
    [version] INT NOT NULL CONSTRAINT [ClassSession_version_df] DEFAULT 1,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ClassSession_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [ClassSession_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    [closedAt] DATETIME2,
    CONSTRAINT [ClassSession_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[Booking] (
    [id] NVARCHAR(36) NOT NULL,
    [requestId] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [courseId] NVARCHAR(36) NOT NULL,
    [sessionId] NVARCHAR(36) NOT NULL,
    [availabilityId] NVARCHAR(36) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [confirmedAt] DATETIME2 NOT NULL,
    [confirmedById] NVARCHAR(36),
    [cancelledAt] DATETIME2,
    [cancelledById] NVARCHAR(36),
    [version] INT NOT NULL CONSTRAINT [Booking_version_df] DEFAULT 1,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [Booking_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Booking_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Booking_requestId_key] UNIQUE NONCLUSTERED ([requestId]),
    CONSTRAINT [Booking_sessionId_key] UNIQUE NONCLUSTERED ([sessionId])
);

-- CreateTable
CREATE TABLE [dbo].[Attendance] (
    [sessionId] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [status] NVARCHAR(16) NOT NULL,
    [markedAt] DATETIME2 NOT NULL,
    [markedById] NVARCHAR(36),
    CONSTRAINT [Attendance_pkey] PRIMARY KEY CLUSTERED ([sessionId],[userId])
);

-- CreateTable
CREATE TABLE [dbo].[ClassCommunicationIntent] (
    [id] NVARCHAR(36) NOT NULL,
    [purpose] NVARCHAR(64) NOT NULL,
    [sessionId] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [dueAt] DATETIME2 NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [idempotencyKey] NVARCHAR(200) NOT NULL,
    [claimedUntil] DATETIME2,
    [relayedAt] DATETIME2,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [ClassCommunicationIntent_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [ClassCommunicationIntent_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ClassCommunicationIntent_idempotencyKey_key] UNIQUE NONCLUSTERED ([idempotencyKey])
);

-- CreateIndex
-- ONE CURRENT SCOPE PER ACCOUNT AND COURSE: the filtered key is the claim, so
-- two operators scoping one teacher to one Course at once cannot both succeed.
CREATE UNIQUE NONCLUSTERED INDEX [CourseTeachingAssignment_current_key] ON [dbo].[CourseTeachingAssignment]([courseId], [userId]) WHERE [endedAt] IS NULL;
CREATE NONCLUSTERED INDEX [CourseTeachingAssignment_userId_endedAt_idx] ON [dbo].[CourseTeachingAssignment]([userId], [endedAt]);
CREATE NONCLUSTERED INDEX [CourseTeachingAssignment_roleAssignmentId_idx] ON [dbo].[CourseTeachingAssignment]([roleAssignmentId]);
CREATE NONCLUSTERED INDEX [Availability_userId_state_startsAt_idx] ON [dbo].[Availability]([userId], [state], [startsAt]);
CREATE NONCLUSTERED INDEX [Availability_state_startsAt_idx] ON [dbo].[Availability]([state], [startsAt]);
CREATE NONCLUSTERED INDEX [ClassSession_state_startsAt_idx] ON [dbo].[ClassSession]([state], [startsAt]);
CREATE NONCLUSTERED INDEX [ClassSession_courseId_state_startsAt_idx] ON [dbo].[ClassSession]([courseId], [state], [startsAt]);
CREATE NONCLUSTERED INDEX [ClassSession_scopeId_state_startsAt_idx] ON [dbo].[ClassSession]([scopeId], [state], [startsAt]);
CREATE NONCLUSTERED INDEX [ClassSession_state_reminderAt_idx] ON [dbo].[ClassSession]([state], [reminderAt]);
-- ONE LIVE CLAIM PER WINDOW: the slot claim two confirmations race for.
CREATE UNIQUE NONCLUSTERED INDEX [Booking_slot_key] ON [dbo].[Booking]([availabilityId]) WHERE [state] <> N'cancelled';
CREATE NONCLUSTERED INDEX [Booking_userId_state_idx] ON [dbo].[Booking]([userId], [state]);
CREATE NONCLUSTERED INDEX [Booking_courseId_state_idx] ON [dbo].[Booking]([courseId], [state]);
CREATE NONCLUSTERED INDEX [Attendance_userId_sessionId_idx] ON [dbo].[Attendance]([userId], [sessionId]);
CREATE NONCLUSTERED INDEX [ClassCommunicationIntent_state_dueAt_idx] ON [dbo].[ClassCommunicationIntent]([state], [dueAt]);
CREATE NONCLUSTERED INDEX [ClassCommunicationIntent_sessionId_state_idx] ON [dbo].[ClassCommunicationIntent]([sessionId], [state]);
CREATE NONCLUSTERED INDEX [ClassCommunicationIntent_userId_state_idx] ON [dbo].[ClassCommunicationIntent]([userId], [state]);

-- AddForeignKey
ALTER TABLE [dbo].[CourseTeachingAssignment] ADD CONSTRAINT [CourseTeachingAssignment_courseId_fkey] FOREIGN KEY ([courseId]) REFERENCES [dbo].[Course]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CourseTeachingAssignment] ADD CONSTRAINT [CourseTeachingAssignment_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[CourseTeachingAssignment] ADD CONSTRAINT [CourseTeachingAssignment_roleAssignmentId_fkey] FOREIGN KEY ([roleAssignmentId]) REFERENCES [dbo].[RoleAssignment]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Availability] ADD CONSTRAINT [Availability_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ClassSession] ADD CONSTRAINT [ClassSession_courseId_fkey] FOREIGN KEY ([courseId]) REFERENCES [dbo].[Course]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ClassSession] ADD CONSTRAINT [ClassSession_scope_fkey] FOREIGN KEY ([scopeId], [courseId]) REFERENCES [dbo].[CourseTeachingAssignment]([id],[courseId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Booking] ADD CONSTRAINT [Booking_requestId_fkey] FOREIGN KEY ([requestId]) REFERENCES [dbo].[TrialClassRequest]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Booking] ADD CONSTRAINT [Booking_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Booking] ADD CONSTRAINT [Booking_courseId_fkey] FOREIGN KEY ([courseId]) REFERENCES [dbo].[Course]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Booking] ADD CONSTRAINT [Booking_sessionId_fkey] FOREIGN KEY ([sessionId]) REFERENCES [dbo].[ClassSession]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Booking] ADD CONSTRAINT [Booking_availabilityId_fkey] FOREIGN KEY ([availabilityId]) REFERENCES [dbo].[Availability]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Attendance] ADD CONSTRAINT [Attendance_sessionId_fkey] FOREIGN KEY ([sessionId]) REFERENCES [dbo].[ClassSession]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Attendance] ADD CONSTRAINT [Attendance_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ClassCommunicationIntent] ADD CONSTRAINT [ClassCommunicationIntent_sessionId_fkey] FOREIGN KEY ([sessionId]) REFERENCES [dbo].[ClassSession]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ClassCommunicationIntent] ADD CONSTRAINT [ClassCommunicationIntent_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ===========================================================================
-- Value constraints
-- ===========================================================================

ALTER TABLE [dbo].[LiveLearningActivation] ADD CONSTRAINT [LiveLearningActivation_ck] CHECK ([id] = 1 AND [authority] IN (N'fixture',N'approved') AND LEN([authorisedBy]) > 0);
-- Production approval needs recorded evidence; a fixture never claims any.
ALTER TABLE [dbo].[LiveLearningActivation] ADD CONSTRAINT [LiveLearningActivation_evidence_ck] CHECK ([authority] <> N'approved' OR ([reference] IS NOT NULL AND LEN([reference]) > 0));

ALTER TABLE [dbo].[CourseTeachingAssignment] ADD CONSTRAINT [CourseTeachingAssignment_ck] CHECK (
    [version] > 0
    AND ([endedAt] IS NULL OR [endedAt] >= [grantedAt])
    AND ([endedAt] IS NOT NULL OR [endedById] IS NULL)
);

-- A window: a real local pair in a named zone, at least fifteen minutes and at
-- most eight hours, open or withdrawn.
ALTER TABLE [dbo].[Availability] ADD CONSTRAINT [Availability_ck] CHECK (
    [state] IN (N'open',N'withdrawn')
    AND [startsAt] < [endsAt]
    AND DATEDIFF(minute, [startsAt], [endsAt]) BETWEEN 15 AND 480
    AND LEN([timeZone]) > 0
    AND LEN([startsLocal]) = 16 AND LEN([endsLocal]) = 16
    AND [version] > 0
);

-- A session: a Course or trial class, scheduled, completed or cancelled; a
-- meeting address only with its provider, only on `meet.google.com` over
-- HTTPS, with no credential, escape, port, query or fragment, and NEVER once
-- the session is terminal; a reminder only before the start.
ALTER TABLE [dbo].[ClassSession] ADD CONSTRAINT [ClassSession_ck] CHECK (
    [kind] IN (N'course',N'trial')
    AND [state] IN (N'scheduled',N'completed',N'cancelled')
    AND [startsAt] < [endsAt]
    AND DATEDIFF(minute, [startsAt], [endsAt]) BETWEEN 15 AND 480
    AND LEN([timeZone]) > 0
    AND LEN([startsLocal]) = 16 AND LEN([endsLocal]) = 16
    AND [version] > 0
    AND ([reminderAt] IS NULL OR [reminderAt] < [startsAt])
    AND (([meetingProvider] IS NULL AND [meetingUrl] IS NULL)
         OR ([meetingProvider] IS NOT NULL AND [meetingProvider] = N'google-meet' AND [meetingUrl] IS NOT NULL))
    AND (([state] = N'scheduled' AND [closedAt] IS NULL)
         OR ([state] <> N'scheduled' AND [closedAt] IS NOT NULL AND [meetingUrl] IS NULL AND [meetingProvider] IS NULL))
);
ALTER TABLE [dbo].[ClassSession] ADD CONSTRAINT [ClassSession_meeting_ck] CHECK (
    [meetingUrl] IS NULL
    OR ([meetingUrl] LIKE N'https://meet.google.com/[a-z][a-z][a-z]-[a-z][a-z][a-z][a-z]-[a-z][a-z][a-z]'
        AND LEN([meetingUrl]) = 36
        AND [meetingUrl] NOT LIKE N'%[@\%?#]%'
        AND [meetingUrl] COLLATE Latin1_General_BIN2 NOT LIKE N'%[A-Z]%')
);

ALTER TABLE [dbo].[Booking] ADD CONSTRAINT [Booking_ck] CHECK (
    [state] IN (N'confirmed',N'cancelled',N'completed')
    AND [version] > 0
    AND (([state] = N'cancelled' AND [cancelledAt] IS NOT NULL) OR ([state] <> N'cancelled' AND [cancelledAt] IS NULL AND [cancelledById] IS NULL))
);

ALTER TABLE [dbo].[Attendance] ADD CONSTRAINT [Attendance_ck] CHECK ([status] IN (N'present',N'absent'));

ALTER TABLE [dbo].[ClassCommunicationIntent] ADD CONSTRAINT [ClassCommunicationIntent_ck] CHECK (
    [purpose] IN (N'learning.booking-confirmed',N'learning.session-rescheduled',N'learning.session-cancelled',N'learning.class-reminder')
    AND [state] IN (N'pending',N'relayed',N'abandoned')
    AND LEN([idempotencyKey]) > 0
    AND ([state] <> N'relayed' OR [relayedAt] IS NOT NULL)
);

-- ===========================================================================
-- Activation is immutable (51280). Deactivation, if ever decided, is a new
-- reviewed migration, not a runtime act.
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[LearningLiveActivationImmutable] ON [dbo].[LiveLearningActivation] AFTER UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 THROW 51280, ''Live-learning activation is immutable.'', 1;
END');

-- ===========================================================================
-- A scope is typed and live when made (51282): the Course is a live Course,
-- the RoleAssignment is the account''s own, unrevoked, of an active role that
-- carries teaching.perform, and the account is active. Its identity is never
-- rewritten; ending it is the only change. Revocation is NOT re-checked here —
-- the runtime re-reads Identity on every request — so a scope stays as safe
-- history after the grant is gone.
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[LearningScopeIntegrity] ON [dbo].[CourseTeachingAssignment] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[courseId] <> i.[courseId] OR d.[userId] <> i.[userId]
      OR d.[roleAssignmentId] <> i.[roleAssignmentId] OR d.[grantedAt] <> i.[grantedAt]
      OR (d.[endedAt] IS NOT NULL AND (i.[endedAt] IS NULL OR i.[endedAt] <> d.[endedAt]))
 )
   THROW 51282, ''A teaching scope''''s identity cannot change, and an ended scope stays ended.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id])
     AND (
       NOT EXISTS (SELECT 1 FROM [dbo].[Course] c WHERE c.[id] = i.[courseId] AND c.[format] = N''live'')
       OR NOT EXISTS (
         SELECT 1 FROM [dbo].[RoleAssignment] ra
         JOIN [dbo].[Role] r ON r.[id] = ra.[roleId] AND r.[deactivatedAt] IS NULL
         JOIN [dbo].[RolePermission] rp ON rp.[roleId] = r.[id] AND rp.[permissionKey] = N''teaching.perform''
         JOIN [dbo].[User] u ON u.[id] = ra.[userId] AND u.[status] = N''active''
         WHERE ra.[id] = i.[roleAssignmentId] AND ra.[userId] = i.[userId] AND ra.[revokedAt] IS NULL
       )
     )
 )
   THROW 51282, ''A teaching scope needs a live Course and the account''''s own live teaching.perform assignment.'', 1;
END');

-- ===========================================================================
-- A window is offered only while activated (51281), by an account holding a
-- live teaching.perform assignment (51284), and never overlaps another open
-- window of the same teacher (51283). Its times and owner never change.
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[LearningAvailabilityIntegrity] ON [dbo].[Availability] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[userId] <> i.[userId] OR d.[startsAt] <> i.[startsAt] OR d.[endsAt] <> i.[endsAt]
      OR d.[timeZone] <> i.[timeZone] OR d.[startsLocal] <> i.[startsLocal] OR d.[endsLocal] <> i.[endsLocal]
      OR (d.[state] = N''withdrawn'' AND i.[state] <> N''withdrawn'')
 )
   THROW 51283, ''A window''''s times and owner cannot change, and a withdrawn window stays withdrawn.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
    AND NOT EXISTS (SELECT 1 FROM [dbo].[LiveLearningActivation])
   THROW 51281, ''Live learning is not activated.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id])
     AND NOT EXISTS (
       SELECT 1 FROM [dbo].[RoleAssignment] ra
       JOIN [dbo].[Role] r ON r.[id] = ra.[roleId] AND r.[deactivatedAt] IS NULL
       JOIN [dbo].[RolePermission] rp ON rp.[roleId] = r.[id] AND rp.[permissionKey] = N''teaching.perform''
       JOIN [dbo].[User] u ON u.[id] = ra.[userId] AND u.[status] = N''active''
       WHERE ra.[userId] = i.[userId] AND ra.[revokedAt] IS NULL
     )
 )
   THROW 51284, ''Only an account holding live teaching.perform offers a window.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN [dbo].[Availability] o ON o.[userId] = i.[userId] AND o.[id] <> i.[id] AND o.[state] = N''open''
   WHERE i.[state] = N''open'' AND i.[startsAt] < o.[endsAt] AND i.[endsAt] > o.[startsAt]
 )
   THROW 51283, ''A teacher''''s open windows cannot overlap.'', 1;
END');

-- ===========================================================================
-- A session exists only while activated (51281), on a PUBLISHED LIVE Course
-- under a CURRENT scope of that Course (51285); a terminal session never
-- changes and never returns to scheduled (51286); and one teacher''s
-- scheduled sessions never overlap (51287). A scheduled session may be
-- cancelled or completed while not activated — closing is always allowed —
-- but may not be moved, re-addressed or re-assigned.
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[LearningSessionIntegrity] ON [dbo].[ClassSession] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[courseId] <> i.[courseId] OR d.[kind] <> i.[kind] OR d.[createdAt] <> i.[createdAt]
 )
   THROW 51286, ''A session''''s Course, kind and creation never change.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[state] <> N''scheduled''
     AND (i.[state] <> d.[state] OR i.[startsAt] <> d.[startsAt] OR i.[endsAt] <> d.[endsAt]
          OR i.[scopeId] <> d.[scopeId] OR i.[meetingUrl] IS NOT NULL OR i.[reminderAt] IS NOT NULL
          OR i.[closedAt] <> d.[closedAt])
 )
   THROW 51286, ''A completed or cancelled session cannot change or return to scheduled.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE i.[state] = N''scheduled'')
    AND NOT EXISTS (SELECT 1 FROM [dbo].[LiveLearningActivation])
   THROW 51281, ''Live learning is not activated.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   LEFT JOIN deleted d ON d.[id] = i.[id]
   WHERE (d.[id] IS NULL OR d.[scopeId] <> i.[scopeId])
     AND (
       NOT EXISTS (SELECT 1 FROM [dbo].[Course] c WHERE c.[id] = i.[courseId] AND c.[state] = N''published'' AND c.[format] = N''live'')
       OR NOT EXISTS (SELECT 1 FROM [dbo].[CourseTeachingAssignment] s WHERE s.[id] = i.[scopeId] AND s.[courseId] = i.[courseId] AND s.[endedAt] IS NULL)
     )
 )
   THROW 51285, ''A session needs a published live Course and a current teaching scope on it.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN [dbo].[CourseTeachingAssignment] s ON s.[id] = i.[scopeId]
   JOIN [dbo].[ClassSession] o ON o.[id] <> i.[id] AND o.[state] = N''scheduled''
   JOIN [dbo].[CourseTeachingAssignment] os ON os.[id] = o.[scopeId] AND os.[userId] = s.[userId]
   WHERE i.[state] = N''scheduled'' AND i.[startsAt] < o.[endsAt] AND i.[endsAt] > o.[startsAt]
 )
   THROW 51287, ''A teacher''''s scheduled sessions cannot overlap.'', 1;
END');

-- ===========================================================================
-- A Booking fits exactly (51288): it is the request''s own learner and Course,
-- its session is a TRIAL session of that Course, its window is the session''s
-- teacher''s open window at the session''s own times, and it is made only while
-- activated (51281). Its identity never changes; cancelled and completed are
-- terminal.
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[LearningBookingIntegrity] ON [dbo].[Booking] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[requestId] <> i.[requestId] OR d.[userId] <> i.[userId] OR d.[courseId] <> i.[courseId]
      OR d.[sessionId] <> i.[sessionId] OR d.[availabilityId] <> i.[availabilityId]
      OR d.[confirmedAt] <> i.[confirmedAt]
      OR (d.[state] <> N''confirmed'' AND i.[state] <> d.[state])
 )
   THROW 51288, ''A Booking''''s identity never changes, and a cancelled or completed Booking is final.'', 1;
 IF EXISTS (SELECT 1 FROM inserted i WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]))
    AND NOT EXISTS (SELECT 1 FROM [dbo].[LiveLearningActivation])
   THROW 51281, ''Live learning is not activated.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id])
     AND NOT EXISTS (
       SELECT 1 FROM [dbo].[TrialClassRequest] t
       JOIN [dbo].[ClassSession] cs ON cs.[id] = i.[sessionId] AND cs.[kind] = N''trial'' AND cs.[courseId] = t.[courseId]
       JOIN [dbo].[CourseTeachingAssignment] s ON s.[id] = cs.[scopeId]
       JOIN [dbo].[Availability] a ON a.[id] = i.[availabilityId] AND a.[userId] = s.[userId] AND a.[state] = N''open''
         AND a.[startsAt] = cs.[startsAt] AND a.[endsAt] = cs.[endsAt]
       WHERE t.[id] = i.[requestId] AND t.[userId] = i.[userId] AND t.[courseId] = i.[courseId]
     )
 )
   THROW 51288, ''A Booking must fit its request, a trial session of its Course and its teacher''''s open window.'', 1;
END');

-- ===========================================================================
-- Attendance (51289) is marked on a session that is not cancelled, for a
-- participant who is eligible NOW: the trial Booking''s learner, or a person
-- enrolled on the Course of a regular session. Its keys never change.
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[LearningAttendanceIntegrity] ON [dbo].[Attendance] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM deleted) AND (UPDATE([sessionId]) OR UPDATE([userId]))
   THROW 51289, ''An attendance mark is never re-keyed.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN [dbo].[ClassSession] cs ON cs.[id] = i.[sessionId]
   WHERE cs.[state] = N''cancelled''
      OR NOT (
        (cs.[kind] = N''trial'' AND EXISTS (SELECT 1 FROM [dbo].[Booking] b WHERE b.[sessionId] = cs.[id] AND b.[userId] = i.[userId] AND b.[state] <> N''cancelled''))
        OR (cs.[kind] = N''course'' AND EXISTS (SELECT 1 FROM [dbo].[Enrolment] e WHERE e.[userId] = i.[userId] AND e.[courseId] = cs.[courseId]))
      )
 )
   THROW 51289, ''Attendance is marked only on an open session for an eligible participant.'', 1;
END');

-- ===========================================================================
-- An intent (51292) is relayed or abandoned once and never reopened, and
-- names its session, recipient and purpose for good.
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[LearningIntentIntegrity] ON [dbo].[ClassCommunicationIntent] AFTER UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[purpose] <> i.[purpose] OR d.[sessionId] <> i.[sessionId] OR d.[userId] <> i.[userId]
      OR d.[idempotencyKey] <> i.[idempotencyKey] OR d.[dueAt] <> i.[dueAt]
      OR (d.[state] <> N''pending'' AND i.[state] <> d.[state])
 )
   THROW 51292, ''A communication intent is relayed or abandoned once and never re-keyed.'', 1;
END');

-- ===========================================================================
-- Permissions
-- ===========================================================================

-- `teaching.perform`: catalogued, EXTERNALLY GATED, bundled into NO role,
-- granted to nobody (OPEN_DECISIONS.md 6.3). A holder is exactly an account
-- with a live assignment of a role carrying it, made through the ordinary
-- audited `permissions.grant` lifecycle once the organisation names one.
INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'teaching.perform', N'Teach live classes on Courses scoped to you: their enrolled learners, your sessions, windows and attendance, and your own scheduled class meeting address. Nothing on other Courses.'),
    (N'learning.classes.read', N'View teaching scopes, trial requests with who asked, bookings, sessions, participants, attendance and a scheduled class meeting address. Identity access is audited. Changes nothing.'),
    (N'learning.classes.administer', N'Scope a current teaching.perform holder to a Course, confirm trial requests, schedule, move, cancel and complete sessions, replace a teacher and correct attendance. Grants no Identity key.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

-- ===========================================================================
-- EXTENDING THE PROTECTED PLATFORM ADMINISTRATOR BUNDLE — by the two
-- ordinary class keys ONLY. `teaching.perform` is deliberately absent.
-- ===========================================================================

DECLARE @classesAdminRoleId NVARCHAR(36);
DECLARE @classesAddedKeys NVARCHAR(200);

SELECT @classesAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @classesAdminRoleId IS NOT NULL
BEGIN
    SELECT @classesAddedKeys = STRING_AGG(p.[key], N' ') WITHIN GROUP (ORDER BY p.[key])
    FROM [dbo].[Permission] p
    WHERE p.[key] IN (N'learning.classes.read', N'learning.classes.administer')
      AND NOT EXISTS (
          SELECT 1 FROM [dbo].[RolePermission] rp
          WHERE rp.[roleId] = @classesAdminRoleId AND rp.[permissionKey] = p.[key]
      );

    IF @classesAddedKeys IS NOT NULL AND LEN(@classesAddedKeys) > 0
    BEGIN
        INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
        SELECT @classesAdminRoleId, p.[key]
        FROM [dbo].[Permission] p
        WHERE p.[key] IN (N'learning.classes.read', N'learning.classes.administer')
          AND NOT EXISTS (
              SELECT 1 FROM [dbo].[RolePermission] rp
              WHERE rp.[roleId] = @classesAdminRoleId AND rp.[permissionKey] = p.[key]
          );

        -- Grants before sessions, so the count each statement reports is the
        -- one it actually removed rather than whatever a cascade took first.
        DELETE FROM [dbo].[StepUpGrant]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @classesAdminRoleId AND ra.[revokedAt] IS NULL
        );

        DELETE FROM [dbo].[Session]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @classesAdminRoleId AND ra.[revokedAt] IS NULL
        );

        -- WHICH KEYS WERE ADDED, and nothing else (SECURITY_BASELINE.md 13.4).
        INSERT INTO [dbo].[AuditLog]
            ([id], [actorType], [actorId], [action], [targetType], [targetId],
             [afterState], [authorisingSource])
        VALUES
            (NEWID(), N'migration', NULL, N'learning.classes.permissions.provisioned', N'role',
             @classesAdminRoleId,
             N'{"added":"' + @classesAddedKeys + N'"}',
             N'20261007000000_phase23_teacher_live_classes');
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
