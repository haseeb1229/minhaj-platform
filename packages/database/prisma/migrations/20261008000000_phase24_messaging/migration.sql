-- ===========================================================================
-- Phase 24 — Messaging: domain & shared server services
-- ===========================================================================
--
-- THE MESSAGING CONTEXT (DOMAIN_MODEL.md 15): Conversation, its participants,
-- Message, MessageAttachment, MessageReadState, MessagingBlock,
-- MessagingReport and MessagingModerationDecision, plus the fail-closed
-- MessagingActivation and Storage's release digest. NON-REALTIME: nothing
-- here is a socket, a presence or a typing state (Phase 25 is a transport
-- over the same services and adds no table).
--
-- FAIL CLOSED UNTIL ACTIVATED. `MessagingActivation` holds at most one row
-- per kind — `support`, `teacher-student`, `student-student` — written by the
-- owner/operator alone (the runtime holds SELECT), immutable once written
-- (51300). Without its kind's row no conversation can be created (51302) and
-- no message can be written (51303). A migrated database holds NO activation,
-- and an `approved` row needs its evidence reference (OPEN_DECISIONS.md 2.1,
-- 2.5 and 6.6 stay open).
--
-- MEMBERSHIP IS NOT AUTHORITY. A participant row is historical membership.
-- Whether a person may read or send NOW is decided by the Messaging service on
-- every request from Learning's CURRENT relationship, Identity's LIVE keys and
-- the activation — the database adds the floor beneath that decision: a
-- message only from a current participant of an open conversation, at the
-- next allocated sequence.
--
-- TYPED REFERENCES, NEVER COPIES. A direct conversation names its Course and
-- its two accounts (in binary order) by real keys; a support conversation names
-- the person asking. An attachment names its Message AND its Conversation by a
-- composite key that carries the conversation; a report names its Conversation
-- and, when a message is the target, that Message by the same composite key.
-- No `targetType`, `relationshipType` or `scopeType` column exists, and no
-- email, name, phone, age, guardian, address or Course title is copied here.
--
-- PLAIN TEXT, IMMUTABLE. A body is plain text of at most 4,000 code points
-- (bounded here at 8,000 UTF-16 units). Once written a message's identity,
-- order, sender, operation, body and digest never change (51304), and it
-- leaves only through an owner disposition (51305). Moderation withholds; it
-- never rewrites.
--
-- ORDER AND IDEMPOTENCY ARE IN THE KEYS. One sequence per position in a
-- conversation (unique), allocated by bumping the conversation's own
-- `lastSequence` under its lock; one message per sender and operation
-- identifier (unique), so a retried send is the same message.
--
-- STORAGE GAINS ONE COLUMN AND NO OWNER. `Asset.releaseDigest` is the SHA-256 of
-- a release token the CONSUMER generated before storing; only its holder can
-- release the asset (StorageServicePort.release). Assets stored before this
-- phase have none and stay unreleasable. No owner, user or target column is
-- added to Asset.
--
-- NOTHING CASCADES. Every foreign key is NO ACTION. A report and a moderation
-- decision are never deleted; a conversation a report names is evidence and is
-- never disposed.
--
-- NO POLICY IS INVENTED. No age, guardian, vetting, retention, strike, ban or
-- escalation column exists.
--
-- REFUSALS 51300-51309 (within the 51300-51319 range reserved for this phase):
--   51300  activation is immutable
--   51301  a participant that does not fit its conversation, rejoins after
--          leaving, is re-keyed, or is deleted outside disposal
--   51302  a conversation created while its kind is not activated, whose
--          identity was rewritten, that reopened, whose order went backwards,
--          whose disposal mark was cleared, or deleted outside disposal
--   51303  a message to a conversation that is not open or not activated,
--          from a sender who is not a current participant, or at a sequence
--          that was not allocated
--   51304  a message rewritten, or returned to view after being withheld
--   51305  a message deleted outside its conversation's disposal
--   51306  an attachment whose shape, transition or uploader does not fit
--   51307  a read state that moves backwards or past the last message
--   51308  a report by a non-participant, beyond the conversation, rewritten
--          or reopened
--   51309  a moderation decision rewritten or deleted, on a report that is not
--          open, or withholding on a report that names no message
--
-- POSTURES FOR THE APPLICATION PRINCIPAL (grant-application-principal.sql):
--
--   ACTIVATION    MessagingActivation: SELECT only.
--   CONVERSATION  SELECT, INSERT, UPDATE, DELETE; never its identity.
--   PARTICIPANT   SELECT, INSERT, UPDATE, DELETE; never its identity.
--   MESSAGE       SELECT, INSERT, UPDATE (moderation only), DELETE (disposal).
--   ATTACHMENT    SELECT, INSERT, UPDATE, DELETE; never its identity or token.
--   READ STATE    SELECT, INSERT, UPDATE, DELETE.
--   BLOCK         SELECT, INSERT, DELETE.
--   REPORT        SELECT, INSERT, UPDATE of its lifecycle; never DELETE.
--   DECISION      SELECT, INSERT; never UPDATE or DELETE.
--
-- TWO KEYS, BOTH EXTERNALLY GATED: `messaging.support` and
-- `messaging.moderate` are catalogued and bundled into NO role, so no bundle
-- changes and no session is invalidated (the Phase-20 precedent).
--
-- APPEND-ONLY. Nothing below edits an accepted migration.
-- ===========================================================================

BEGIN TRY

BEGIN TRAN;

-- ===========================================================================
-- Storage: the release digest
-- ===========================================================================
ALTER TABLE [dbo].[Asset] ADD [releaseDigest] NVARCHAR(64) NULL;

EXEC(N'ALTER TABLE [dbo].[Asset] ADD CONSTRAINT [Asset_releaseDigest_ck] CHECK (
    [releaseDigest] IS NULL
    OR (LEN([releaseDigest]) = 64 AND [releaseDigest] COLLATE Latin1_General_BIN2 NOT LIKE N''%[^0-9a-f]%'')
)');

EXEC(N'CREATE UNIQUE NONCLUSTERED INDEX [Asset_releaseDigest_key] ON [dbo].[Asset]([releaseDigest]) WHERE [releaseDigest] IS NOT NULL');

-- ===========================================================================
-- Tables
-- ===========================================================================

-- CreateTable
CREATE TABLE [dbo].[MessagingActivation] (
    [capability] NVARCHAR(24) NOT NULL,
    [authority] NVARCHAR(16) NOT NULL,
    [authorisedBy] NVARCHAR(200) NOT NULL,
    [reference] NVARCHAR(400),
    [activatedAt] DATETIME2 NOT NULL CONSTRAINT [MessagingActivation_activatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [MessagingActivation_pkey] PRIMARY KEY CLUSTERED ([capability])
);

-- CreateTable
CREATE TABLE [dbo].[Conversation] (
    [id] NVARCHAR(36) NOT NULL,
    [kind] NVARCHAR(24) NOT NULL,
    [courseId] NVARCHAR(36),
    [lowUserId] NVARCHAR(36),
    [highUserId] NVARCHAR(36),
    [requesterUserId] NVARCHAR(36),
    [state] NVARCHAR(16) NOT NULL CONSTRAINT [Conversation_state_df] DEFAULT N'open',
    [closedReason] NVARCHAR(24),
    [closedAt] DATETIME2,
    [disposingAt] DATETIME2,
    [lastSequence] INT NOT NULL CONSTRAINT [Conversation_lastSequence_df] DEFAULT 0,
    [activityAt] DATETIME2 NOT NULL CONSTRAINT [Conversation_activityAt_df] DEFAULT SYSUTCDATETIME(),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [Conversation_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [version] INT NOT NULL CONSTRAINT [Conversation_version_df] DEFAULT 1,
    CONSTRAINT [Conversation_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[ConversationParticipant] (
    [id] NVARCHAR(36) NOT NULL,
    [conversationId] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [role] NVARCHAR(16) NOT NULL,
    [joinedAt] DATETIME2 NOT NULL CONSTRAINT [ConversationParticipant_joinedAt_df] DEFAULT SYSUTCDATETIME(),
    [leftAt] DATETIME2,
    CONSTRAINT [ConversationParticipant_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ConversationParticipant_member_key] UNIQUE NONCLUSTERED ([conversationId],[userId])
);

-- CreateTable
CREATE TABLE [dbo].[Message] (
    [id] NVARCHAR(36) NOT NULL,
    [conversationId] NVARCHAR(36) NOT NULL,
    [sequence] INT NOT NULL,
    [senderUserId] NVARCHAR(36) NOT NULL,
    [operationId] NVARCHAR(36) NOT NULL,
    [body] NVARCHAR(MAX) NOT NULL,
    [payloadDigest] NVARCHAR(64) NOT NULL,
    [moderation] NVARCHAR(16) NOT NULL CONSTRAINT [Message_moderation_df] DEFAULT N'visible',
    [withheldAt] DATETIME2,
    [sentAt] DATETIME2 NOT NULL CONSTRAINT [Message_sentAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [Message_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Message_order_key] UNIQUE NONCLUSTERED ([conversationId],[sequence]),
    CONSTRAINT [Message_operation_key] UNIQUE NONCLUSTERED ([conversationId],[senderUserId],[operationId]),
    CONSTRAINT [Message_conversation_key] UNIQUE NONCLUSTERED ([id],[conversationId])
);

-- CreateTable
CREATE TABLE [dbo].[MessageAttachment] (
    [id] NVARCHAR(36) NOT NULL,
    [conversationId] NVARCHAR(36) NOT NULL,
    [uploaderUserId] NVARCHAR(36) NOT NULL,
    [releaseToken] NVARCHAR(64) NOT NULL,
    [state] NVARCHAR(16) NOT NULL,
    [assetId] NVARCHAR(36),
    [messageId] NVARCHAR(36),
    [position] TINYINT,
    [mediaType] NVARCHAR(32),
    [byteSize] BIGINT,
    [displayName] NVARCHAR(200),
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MessageAttachment_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [attachedAt] DATETIME2,
    CONSTRAINT [MessageAttachment_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MessageAttachment_releaseToken_key] UNIQUE NONCLUSTERED ([releaseToken])
);

-- CreateTable
CREATE TABLE [dbo].[MessageReadState] (
    [conversationId] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [lastReadSequence] INT NOT NULL CONSTRAINT [MessageReadState_lastReadSequence_df] DEFAULT 0,
    [updatedAt] DATETIME2 NOT NULL CONSTRAINT [MessageReadState_updatedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [MessageReadState_pkey] PRIMARY KEY CLUSTERED ([conversationId],[userId])
);

-- CreateTable
CREATE TABLE [dbo].[MessagingBlock] (
    [blockerUserId] NVARCHAR(36) NOT NULL,
    [blockedUserId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MessagingBlock_createdAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [MessagingBlock_pkey] PRIMARY KEY CLUSTERED ([blockerUserId],[blockedUserId])
);

-- CreateTable
CREATE TABLE [dbo].[MessagingReport] (
    [id] NVARCHAR(36) NOT NULL,
    [conversationId] NVARCHAR(36) NOT NULL,
    [messageId] NVARCHAR(36),
    [reporterUserId] NVARCHAR(36) NOT NULL,
    [reason] NVARCHAR(24) NOT NULL,
    [atSequence] INT NOT NULL,
    [state] NVARCHAR(16) NOT NULL CONSTRAINT [MessagingReport_state_df] DEFAULT N'open',
    [createdAt] DATETIME2 NOT NULL CONSTRAINT [MessagingReport_createdAt_df] DEFAULT SYSUTCDATETIME(),
    [resolvedAt] DATETIME2,
    [version] INT NOT NULL CONSTRAINT [MessagingReport_version_df] DEFAULT 1,
    CONSTRAINT [MessagingReport_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[MessagingModerationDecision] (
    [id] NVARCHAR(36) NOT NULL,
    [reportId] NVARCHAR(36) NOT NULL,
    [moderatorUserId] NVARCHAR(36) NOT NULL,
    [action] NVARCHAR(24) NOT NULL,
    [decidedAt] DATETIME2 NOT NULL CONSTRAINT [MessagingModerationDecision_decidedAt_df] DEFAULT SYSUTCDATETIME(),
    CONSTRAINT [MessagingModerationDecision_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [MessagingModerationDecision_reportId_key] UNIQUE NONCLUSTERED ([reportId])
);

-- ===========================================================================
-- Indexes — every list is a bounded keyset read
-- ===========================================================================

-- A person's own conversations, newest activity first.
CREATE NONCLUSTERED INDEX [ConversationParticipant_userId_leftAt_idx] ON [dbo].[ConversationParticipant]([userId], [leftAt]);
-- The support queue and disposal sweeps.
CREATE NONCLUSTERED INDEX [Conversation_kind_state_activityAt_idx] ON [dbo].[Conversation]([kind], [state], [activityAt], [id]);
CREATE NONCLUSTERED INDEX [Conversation_courseId_idx] ON [dbo].[Conversation]([courseId]);
CREATE NONCLUSTERED INDEX [Conversation_lowUserId_idx] ON [dbo].[Conversation]([lowUserId]);
CREATE NONCLUSTERED INDEX [Conversation_highUserId_idx] ON [dbo].[Conversation]([highUserId]);
CREATE NONCLUSTERED INDEX [Conversation_requesterUserId_idx] ON [dbo].[Conversation]([requesterUserId]);
CREATE NONCLUSTERED INDEX [Message_senderUserId_idx] ON [dbo].[Message]([senderUserId]);
CREATE NONCLUSTERED INDEX [MessageAttachment_conversationId_state_idx] ON [dbo].[MessageAttachment]([conversationId], [state], [createdAt]);
CREATE NONCLUSTERED INDEX [MessageAttachment_uploaderUserId_state_idx] ON [dbo].[MessageAttachment]([uploaderUserId], [state]);
CREATE NONCLUSTERED INDEX [MessageReadState_userId_idx] ON [dbo].[MessageReadState]([userId]);
CREATE NONCLUSTERED INDEX [MessagingBlock_blockedUserId_idx] ON [dbo].[MessagingBlock]([blockedUserId]);
CREATE NONCLUSTERED INDEX [MessagingReport_state_createdAt_idx] ON [dbo].[MessagingReport]([state], [createdAt], [id]);
CREATE NONCLUSTERED INDEX [MessagingReport_conversationId_idx] ON [dbo].[MessagingReport]([conversationId]);
CREATE NONCLUSTERED INDEX [MessagingReport_reporterUserId_idx] ON [dbo].[MessagingReport]([reporterUserId]);
CREATE NONCLUSTERED INDEX [MessagingModerationDecision_moderatorUserId_idx] ON [dbo].[MessagingModerationDecision]([moderatorUserId]);

-- ONE direct conversation of a kind between two people on one Course: two
-- concurrent openings converge on one row.
CREATE UNIQUE NONCLUSTERED INDEX [Conversation_direct_key] ON [dbo].[Conversation]([kind], [courseId], [lowUserId], [highUserId]) WHERE [kind] <> N'support';
-- ONE open support conversation per person.
CREATE UNIQUE NONCLUSTERED INDEX [Conversation_support_key] ON [dbo].[Conversation]([requesterUserId]) WHERE [kind] = N'support' AND [state] = N'open';
-- ONE active support claim per conversation.
CREATE UNIQUE NONCLUSTERED INDEX [ConversationParticipant_claim_key] ON [dbo].[ConversationParticipant]([conversationId]) WHERE [role] = N'support' AND [leftAt] IS NULL;
-- ONE teacher, ONE learner and ONE requester per conversation.
CREATE UNIQUE NONCLUSTERED INDEX [ConversationParticipant_role_key] ON [dbo].[ConversationParticipant]([conversationId], [role]) WHERE [role] IN (N'teacher', N'learner', N'requester');
-- An asset belongs to at most one attachment.
CREATE UNIQUE NONCLUSTERED INDEX [MessageAttachment_assetId_key] ON [dbo].[MessageAttachment]([assetId]) WHERE [assetId] IS NOT NULL;
-- One attachment per position of a message: at most four (0-3).
CREATE UNIQUE NONCLUSTERED INDEX [MessageAttachment_position_key] ON [dbo].[MessageAttachment]([messageId], [position]) WHERE [messageId] IS NOT NULL;
-- ONE open report per reporter and target. A NULL message is the
-- conversation-level target, and SQL Server treats two NULLs here as equal.
CREATE UNIQUE NONCLUSTERED INDEX [MessagingReport_open_key] ON [dbo].[MessagingReport]([reporterUserId], [conversationId], [messageId]) WHERE [state] = N'open';

-- ===========================================================================
-- Foreign keys — all NO ACTION
-- ===========================================================================
ALTER TABLE [dbo].[Conversation] ADD CONSTRAINT [Conversation_courseId_fkey] FOREIGN KEY ([courseId]) REFERENCES [dbo].[Course]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Conversation] ADD CONSTRAINT [Conversation_lowUserId_fkey] FOREIGN KEY ([lowUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Conversation] ADD CONSTRAINT [Conversation_highUserId_fkey] FOREIGN KEY ([highUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Conversation] ADD CONSTRAINT [Conversation_requesterUserId_fkey] FOREIGN KEY ([requesterUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ConversationParticipant] ADD CONSTRAINT [ConversationParticipant_conversationId_fkey] FOREIGN KEY ([conversationId]) REFERENCES [dbo].[Conversation]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[ConversationParticipant] ADD CONSTRAINT [ConversationParticipant_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Message] ADD CONSTRAINT [Message_conversationId_fkey] FOREIGN KEY ([conversationId]) REFERENCES [dbo].[Conversation]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[Message] ADD CONSTRAINT [Message_senderUserId_fkey] FOREIGN KEY ([senderUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MessageAttachment] ADD CONSTRAINT [MessageAttachment_conversationId_fkey] FOREIGN KEY ([conversationId]) REFERENCES [dbo].[Conversation]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MessageAttachment] ADD CONSTRAINT [MessageAttachment_uploaderUserId_fkey] FOREIGN KEY ([uploaderUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MessageAttachment] ADD CONSTRAINT [MessageAttachment_assetId_fkey] FOREIGN KEY ([assetId]) REFERENCES [dbo].[Asset]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MessageAttachment] ADD CONSTRAINT [MessageAttachment_message_fkey] FOREIGN KEY ([messageId], [conversationId]) REFERENCES [dbo].[Message]([id], [conversationId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MessageReadState] ADD CONSTRAINT [MessageReadState_participant_fkey] FOREIGN KEY ([conversationId], [userId]) REFERENCES [dbo].[ConversationParticipant]([conversationId], [userId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MessagingBlock] ADD CONSTRAINT [MessagingBlock_blockerUserId_fkey] FOREIGN KEY ([blockerUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MessagingBlock] ADD CONSTRAINT [MessagingBlock_blockedUserId_fkey] FOREIGN KEY ([blockedUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MessagingReport] ADD CONSTRAINT [MessagingReport_conversationId_fkey] FOREIGN KEY ([conversationId]) REFERENCES [dbo].[Conversation]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MessagingReport] ADD CONSTRAINT [MessagingReport_message_fkey] FOREIGN KEY ([messageId], [conversationId]) REFERENCES [dbo].[Message]([id], [conversationId]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MessagingReport] ADD CONSTRAINT [MessagingReport_reporterUserId_fkey] FOREIGN KEY ([reporterUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MessagingModerationDecision] ADD CONSTRAINT [MessagingModerationDecision_reportId_fkey] FOREIGN KEY ([reportId]) REFERENCES [dbo].[MessagingReport]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE [dbo].[MessagingModerationDecision] ADD CONSTRAINT [MessagingModerationDecision_moderatorUserId_fkey] FOREIGN KEY ([moderatorUserId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ===========================================================================
-- CHECK constraints
-- ===========================================================================
ALTER TABLE [dbo].[MessagingActivation] ADD CONSTRAINT [MessagingActivation_ck] CHECK (
    [capability] IN (N'support', N'teacher-student', N'student-student')
    AND [authority] IN (N'fixture', N'approved')
    AND LEN([authorisedBy]) > 0
);
ALTER TABLE [dbo].[MessagingActivation] ADD CONSTRAINT [MessagingActivation_evidence_ck] CHECK ([authority] <> N'approved' OR ([reference] IS NOT NULL AND LEN([reference]) > 0));

-- The kind decides the shape: a direct conversation names a Course and its two
-- accounts in binary order; a support conversation names only its person.
ALTER TABLE [dbo].[Conversation] ADD CONSTRAINT [Conversation_shape_ck] CHECK (
    ([kind] = N'support'
        AND [courseId] IS NULL AND [lowUserId] IS NULL AND [highUserId] IS NULL
        AND [requesterUserId] IS NOT NULL)
    OR ([kind] IN (N'teacher-student', N'student-student')
        AND [courseId] IS NOT NULL AND [lowUserId] IS NOT NULL AND [highUserId] IS NOT NULL
        AND [requesterUserId] IS NULL
        AND [lowUserId] COLLATE Latin1_General_BIN2 < [highUserId] COLLATE Latin1_General_BIN2)
);
ALTER TABLE [dbo].[Conversation] ADD CONSTRAINT [Conversation_ck] CHECK (
    [lastSequence] >= 0 AND [version] >= 1
    AND (
        ([state] = N'open' AND [closedReason] IS NULL AND [closedAt] IS NULL AND [disposingAt] IS NULL)
        OR ([state] = N'closed' AND [closedAt] IS NOT NULL
            AND [closedReason] IN (N'account-closed', N'moderation', N'resolved')
            AND ([closedReason] <> N'resolved' OR [kind] = N'support'))
    )
);

ALTER TABLE [dbo].[ConversationParticipant] ADD CONSTRAINT [ConversationParticipant_ck] CHECK (
    [role] IN (N'teacher', N'learner', N'peer', N'requester', N'support')
    AND ([leftAt] IS NULL OR [leftAt] >= [joinedAt])
);

ALTER TABLE [dbo].[Message] ADD CONSTRAINT [Message_ck] CHECK (
    [sequence] >= 1
    AND DATALENGTH([body]) <= 16000
    AND LEN([payloadDigest]) = 64
    AND [payloadDigest] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^0-9a-f]%'
    AND (([moderation] = N'visible' AND [withheldAt] IS NULL)
        OR ([moderation] = N'withheld' AND [withheldAt] IS NOT NULL))
);

ALTER TABLE [dbo].[MessageAttachment] ADD CONSTRAINT [MessageAttachment_ck] CHECK (
    LEN([releaseToken]) = 64
    AND [releaseToken] COLLATE Latin1_General_BIN2 NOT LIKE N'%[^0-9a-f]%'
    AND ([mediaType] IS NULL OR [mediaType] IN (N'image/jpeg', N'image/png', N'application/pdf'))
    AND ([byteSize] IS NULL OR ([byteSize] >= 1 AND [byteSize] <= 5242880))
    AND ([position] IS NULL OR [position] <= 3)
    AND (
        ([state] = N'pending' AND [assetId] IS NULL AND [messageId] IS NULL AND [position] IS NULL
            AND [mediaType] IS NULL AND [byteSize] IS NULL AND [attachedAt] IS NULL)
        OR ([state] = N'ready' AND [assetId] IS NOT NULL AND [mediaType] IS NOT NULL AND [byteSize] IS NOT NULL
            AND [messageId] IS NULL AND [position] IS NULL AND [attachedAt] IS NULL)
        OR ([state] = N'attached' AND [assetId] IS NOT NULL AND [mediaType] IS NOT NULL AND [byteSize] IS NOT NULL
            AND [messageId] IS NOT NULL AND [position] IS NOT NULL AND [attachedAt] IS NOT NULL)
        OR ([state] = N'releasing' AND [assetId] IS NULL AND [messageId] IS NULL AND [position] IS NULL)
    )
);

ALTER TABLE [dbo].[MessageReadState] ADD CONSTRAINT [MessageReadState_ck] CHECK ([lastReadSequence] >= 0);

ALTER TABLE [dbo].[MessagingBlock] ADD CONSTRAINT [MessagingBlock_ck] CHECK ([blockerUserId] <> [blockedUserId]);

ALTER TABLE [dbo].[MessagingReport] ADD CONSTRAINT [MessagingReport_ck] CHECK (
    [reason] IN (N'harassment', N'spam', N'inappropriate', N'safety', N'other')
    AND [atSequence] >= 0 AND [version] >= 1
    AND (([state] = N'open' AND [resolvedAt] IS NULL) OR ([state] = N'resolved' AND [resolvedAt] IS NOT NULL))
);

ALTER TABLE [dbo].[MessagingModerationDecision] ADD CONSTRAINT [MessagingModerationDecision_ck] CHECK (
    [action] IN (N'dismiss', N'withhold-message', N'close-conversation')
);

-- ===========================================================================
-- Activation is immutable (51300). Written by the owner/operator only.
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MessagingActivationImmutable] ON [dbo].[MessagingActivation] AFTER UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 THROW 51300, ''Messaging activation is immutable.'', 1;
END');

-- ===========================================================================
-- A conversation is created only while its kind is activated; its identity
-- never changes, its order never goes backwards, a closed conversation never
-- reopens, a disposal mark is never cleared, and it is deleted only once
-- marked for disposal (51302).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MessagingConversationIntegrity] ON [dbo].[Conversation] AFTER INSERT, UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id])
     AND NOT EXISTS (SELECT 1 FROM [dbo].[MessagingActivation] a WHERE a.[capability] = i.[kind])
 )
   THROW 51302, ''That kind of conversation is not activated.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id])
     AND (i.[state] <> N''open'' OR i.[lastSequence] <> 0 OR i.[disposingAt] IS NOT NULL)
 )
   THROW 51302, ''A conversation starts open, empty and unmarked.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[kind] <> i.[kind]
      OR ISNULL(d.[courseId], N'''') <> ISNULL(i.[courseId], N'''')
      OR ISNULL(d.[lowUserId], N'''') <> ISNULL(i.[lowUserId], N'''')
      OR ISNULL(d.[highUserId], N'''') <> ISNULL(i.[highUserId], N'''')
      OR ISNULL(d.[requesterUserId], N'''') <> ISNULL(i.[requesterUserId], N'''')
      OR d.[createdAt] <> i.[createdAt]
      OR i.[lastSequence] < d.[lastSequence]
      OR (d.[state] = N''closed'' AND i.[state] <> N''closed'')
      OR (d.[disposingAt] IS NOT NULL AND (i.[disposingAt] IS NULL OR i.[disposingAt] <> d.[disposingAt]))
 )
   THROW 51302, ''A conversation''''s identity cannot change, its order cannot go backwards, and a closed conversation stays closed.'', 1;
 IF EXISTS (
   SELECT 1 FROM deleted d
   WHERE NOT EXISTS (SELECT 1 FROM inserted i WHERE i.[id] = d.[id])
     AND d.[disposingAt] IS NULL
 )
   THROW 51302, ''A conversation is removed only through its disposal.'', 1;
END');

-- ===========================================================================
-- A participant fits its conversation's kind and the people it names, never
-- changes identity, and — except a support claim — never rejoins (51301).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MessagingParticipantIntegrity] ON [dbo].[ConversationParticipant] AFTER INSERT, UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM deleted d
   WHERE NOT EXISTS (SELECT 1 FROM inserted i WHERE i.[id] = d.[id])
     AND NOT EXISTS (
       SELECT 1 FROM [dbo].[Conversation] c
       WHERE c.[id] = d.[conversationId] AND c.[disposingAt] IS NOT NULL
     )
 )
   THROW 51301, ''A participant is removed only through its conversation''''s disposal.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[conversationId] <> i.[conversationId] OR d.[userId] <> i.[userId] OR d.[role] <> i.[role]
      OR (d.[leftAt] IS NOT NULL AND i.[leftAt] IS NULL AND i.[role] <> N''support'')
 )
   THROW 51301, ''A participant cannot be re-keyed, and only a support claim may return.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN [dbo].[Conversation] c ON c.[id] = i.[conversationId]
   WHERE NOT (
       (c.[kind] = N''teacher-student'' AND i.[role] IN (N''teacher'', N''learner'')
         AND i.[userId] IN (c.[lowUserId], c.[highUserId]))
    OR (c.[kind] = N''student-student'' AND i.[role] = N''peer''
         AND i.[userId] IN (c.[lowUserId], c.[highUserId]))
    OR (c.[kind] = N''support'' AND i.[role] = N''requester'' AND i.[userId] = c.[requesterUserId])
    OR (c.[kind] = N''support'' AND i.[role] = N''support'' AND i.[userId] <> c.[requesterUserId])
   )
 )
   THROW 51301, ''That participant does not fit its conversation.'', 1;
END');

-- ===========================================================================
-- A message is written only to an open, activated, unmarked conversation, by a
-- current participant, at the sequence just allocated (51303); it is never
-- rewritten and never returns to view once withheld (51304); it leaves only
-- through its conversation's disposal (51305).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MessagingMessageIntegrity] ON [dbo].[Message] AFTER INSERT, UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM inserted) AND NOT EXISTS (SELECT 1 FROM deleted)
 BEGIN
   IF (SELECT COUNT(*) FROM inserted) > 1
     THROW 51303, ''Messages are written one at a time.'', 1;
   IF EXISTS (
     SELECT 1 FROM inserted i
     WHERE i.[moderation] <> N''visible''
        OR NOT EXISTS (
          SELECT 1 FROM [dbo].[Conversation] c
          JOIN [dbo].[MessagingActivation] a ON a.[capability] = c.[kind]
          WHERE c.[id] = i.[conversationId] AND c.[state] = N''open''
            AND c.[disposingAt] IS NULL AND c.[lastSequence] = i.[sequence]
        )
        OR NOT EXISTS (
          SELECT 1 FROM [dbo].[ConversationParticipant] p
          WHERE p.[conversationId] = i.[conversationId] AND p.[userId] = i.[senderUserId]
            AND p.[leftAt] IS NULL
        )
   )
     THROW 51303, ''A message needs an open, activated conversation, a current participant and its allocated sequence.'', 1;
 END;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[conversationId] <> i.[conversationId] OR d.[sequence] <> i.[sequence]
      OR d.[senderUserId] <> i.[senderUserId] OR d.[operationId] <> i.[operationId]
      OR d.[payloadDigest] <> i.[payloadDigest] OR d.[sentAt] <> i.[sentAt]
      OR CAST(d.[body] AS VARBINARY(MAX)) <> CAST(i.[body] AS VARBINARY(MAX))
      OR (d.[moderation] = N''withheld'' AND i.[moderation] <> N''withheld'')
 )
   THROW 51304, ''A message never changes once sent, and a withheld message stays withheld.'', 1;
 IF EXISTS (
   SELECT 1 FROM deleted d
   WHERE NOT EXISTS (SELECT 1 FROM inserted i WHERE i.[id] = d.[id])
     AND NOT EXISTS (
       SELECT 1 FROM [dbo].[Conversation] c
       WHERE c.[id] = d.[conversationId] AND c.[disposingAt] IS NOT NULL
     )
 )
   THROW 51305, ''A message is removed only through its conversation''''s disposal.'', 1;
END');

-- ===========================================================================
-- An attachment is created pending, becomes ready with Storage's facts, is
-- attached once to one of its uploader's messages, and otherwise only moves to
-- releasing — from which it is only deleted. Its identity and release token
-- never change (51306).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MessagingAttachmentIntegrity] ON [dbo].[MessageAttachment] AFTER INSERT, UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id]) AND i.[state] <> N''pending''
 )
   THROW 51306, ''An attachment starts pending.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[conversationId] <> i.[conversationId] OR d.[uploaderUserId] <> i.[uploaderUserId]
      OR d.[releaseToken] <> i.[releaseToken] OR d.[createdAt] <> i.[createdAt]
      OR NOT (
           d.[state] = i.[state]
        OR (d.[state] = N''pending'' AND i.[state] IN (N''ready'', N''releasing''))
        OR (d.[state] = N''ready'' AND i.[state] IN (N''attached'', N''releasing''))
        OR (d.[state] = N''attached'' AND i.[state] = N''releasing'')
      )
      OR (d.[state] = i.[state] AND d.[state] <> N''pending''
          AND (ISNULL(d.[assetId], N'''') <> ISNULL(i.[assetId], N'''')
            OR ISNULL(d.[messageId], N'''') <> ISNULL(i.[messageId], N'''')))
 )
   THROW 51306, ''That attachment change does not fit its lifecycle.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN [dbo].[Message] m ON m.[id] = i.[messageId]
   WHERE i.[state] = N''attached'' AND m.[senderUserId] <> i.[uploaderUserId]
 )
   THROW 51306, ''An attachment belongs to a message of the person who uploaded it.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN deleted d ON d.[id] = i.[id]
   JOIN [dbo].[Conversation] c ON c.[id] = i.[conversationId]
   WHERE d.[state] = N''attached'' AND i.[state] = N''releasing'' AND c.[disposingAt] IS NULL
 )
   THROW 51306, ''A sent attachment is released only through its conversation''''s disposal.'', 1;
 IF EXISTS (
   SELECT 1 FROM deleted d
   WHERE NOT EXISTS (SELECT 1 FROM inserted i WHERE i.[id] = d.[id]) AND d.[state] <> N''releasing''
 )
   THROW 51306, ''An attachment is removed only once released.'', 1;
END');

-- ===========================================================================
-- A read state only moves forward, and never past the last message (51307).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MessagingReadStateIntegrity] ON [dbo].[MessageReadState] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN deleted d ON d.[conversationId] = i.[conversationId] AND d.[userId] = i.[userId]
   WHERE i.[lastReadSequence] < d.[lastReadSequence]
 )
   THROW 51307, ''A read position never moves backwards.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN [dbo].[Conversation] c ON c.[id] = i.[conversationId]
   WHERE i.[lastReadSequence] > c.[lastSequence]
 )
   THROW 51307, ''A read position cannot pass the last message.'', 1;
END');

-- ===========================================================================
-- A report is filed by a current participant within what the conversation
-- held; its target and reporter never change; a resolved report stays
-- resolved (51308).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MessagingReportIntegrity] ON [dbo].[MessagingReport] AFTER INSERT, UPDATE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (
   SELECT 1 FROM inserted i
   WHERE NOT EXISTS (SELECT 1 FROM deleted d WHERE d.[id] = i.[id])
     AND (
       i.[state] <> N''open''
       OR NOT EXISTS (
         SELECT 1 FROM [dbo].[ConversationParticipant] p
         WHERE p.[conversationId] = i.[conversationId] AND p.[userId] = i.[reporterUserId]
           AND p.[leftAt] IS NULL
       )
       OR NOT EXISTS (
         SELECT 1 FROM [dbo].[Conversation] c
         WHERE c.[id] = i.[conversationId] AND i.[atSequence] <= c.[lastSequence]
       )
     )
 )
   THROW 51308, ''A report is filed open, by a current participant, within its conversation.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN deleted d ON d.[id] = i.[id]
   WHERE d.[conversationId] <> i.[conversationId]
      OR ISNULL(d.[messageId], N'''') <> ISNULL(i.[messageId], N'''')
      OR d.[reporterUserId] <> i.[reporterUserId] OR d.[reason] <> i.[reason]
      OR d.[atSequence] <> i.[atSequence] OR d.[createdAt] <> i.[createdAt]
      OR (d.[state] = N''resolved'' AND i.[state] <> N''resolved'')
 )
   THROW 51308, ''A report''''s target cannot change, and a resolved report stays resolved.'', 1;
END');

-- ===========================================================================
-- A moderation decision is made once, on an open report, and never changes or
-- leaves; withholding needs a reported message (51309).
-- ===========================================================================
EXEC(N'CREATE TRIGGER [dbo].[MessagingDecisionIntegrity] ON [dbo].[MessagingModerationDecision] AFTER INSERT, UPDATE, DELETE AS
BEGIN
 SET NOCOUNT ON;
 IF EXISTS (SELECT 1 FROM deleted)
   THROW 51309, ''A moderation decision is permanent.'', 1;
 IF EXISTS (
   SELECT 1 FROM inserted i
   JOIN [dbo].[MessagingReport] r ON r.[id] = i.[reportId]
   WHERE r.[state] <> N''open'' OR (i.[action] = N''withhold-message'' AND r.[messageId] IS NULL)
 )
   THROW 51309, ''A decision needs an open report, and withholding needs a reported message.'', 1;
END');

-- ===========================================================================
-- PERMISSIONS — catalogued, EXTERNALLY GATED, bundled into no role
-- ===========================================================================
--
-- Who staffs support and who moderates reported messages is the
-- organisation's decision (OPEN_DECISIONS.md 6.6). This migration inserts no
-- RolePermission and no RoleAssignment, so no authority changes for anyone and
-- no session is invalidated.
INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'messaging.support', N'Take part in authenticated support conversations: see the support queue, claim, reply to and resolve a conversation. Every opening of support content is audited.'),
    (N'messaging.moderate', N'Review reported messages and conversations: read the bounded evidence one report authorises, then withhold a message, close a conversation or dismiss. Every evidence read is audited.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
