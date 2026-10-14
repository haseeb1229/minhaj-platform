-- ===========================================================================
-- Phase 21 — Personalisation & Notifications
-- ===========================================================================
--
-- THE PERSONALISATION & NOTIFICATIONS CONTEXT (DOMAIN_MODEL.md 14): a person's
-- OWN saved targets, bookmarks, notes and private collections; reading and watch
-- history; one Quran reading position; explicit onboarding answers; in-app
-- notifications and their preferences; and the newsletter subscription, which
-- is consent from an address and NOT an account.
--
-- NOTHING IS SEEDED. Not a saved item, a note, a notification or a subscriber.
-- A database migrated by this file holds no personal data of anybody.
--
-- TYPED REFERENCES, NEVER COPIES. A saved or read target is a real foreign key
-- to its owner's canonical row — Article, Work, Video, Ayah (by its canonical
-- (surah, ayah) identity) or HadithCitation (the public citation, never a
-- source-qualified record) — one nullable column per kind, a CHECK that EXACTLY
-- ONE is set, and FILTERED unique indexes so an account holds each target at
-- most once. There is no targetType + targetId. No title, status or text of
-- any target is stored here; Layer 4 asks each owner's public reader.
--
-- NOTHING CASCADES FROM CONTENT OR FROM AN ACCOUNT. Archiving content leaves
-- every key valid. A hard delete of a referenced row is REFUSED by these keys
-- until Personalisation's typed release has removed its own references
-- (DOMAIN_MODEL.md 14.3). Account closure removes these rows through
-- Personalisation's own disposition, in bounded batches, after Identity has
-- committed the closure. Only INSIDE the context does a parent take its own
-- children: a SavedItem its bookmark and note, a private collection its
-- members, a profile its interests and goals.
--
-- OWNERSHIP IS IN THE KEYS. A private collection member carries the owner on
-- both foreign keys, so it can only ever join that owner's collection to that
-- owner's SavedItem.
--
-- THE NEWSLETTER. A subscriber has no relation to User. Only the SHA-256
-- hashes of its two link tokens are stored, beside per-issuance salts; the
-- tokens themselves are HMACs under a key this database never holds. Which
-- columns a state may hold is a CHECK, so an unsubscribed, expired or
-- suppressed subscription can hold no address and no live confirmation link.
-- Consent evidence is append-only: a trigger refuses any change.
--
-- POSTURES FOR THE APPLICATION PRINCIPAL (grant-application-principal.sql):
--
--   OWNER DATA    profile, interests, goals, saved items, bookmarks, notes,
--                 private collections and members, history, Quran progress,
--                 notification preferences, notifications — SELECT, INSERT,
--                 UPDATE and DELETE, because the owner may remove every one of
--                 them, and disposition must. Never an identity column.
--   NEWSLETTER    the subscriber — SELECT, INSERT, UPDATE, never DELETE.
--   CONSENT       consent events — SELECT and INSERT only.
--
-- TWO ADMINISTRATIVE KEYS, newsletter.read and newsletter.operate, join the
-- protected Platform Administrator bundle by the convention every earlier
-- phase used. Neither reaches any account's saved items, notes, history or
-- notifications: no permission does.
--
-- REFUSALS 51260-51269, distinct from every earlier phase's.
--
-- APPEND-ONLY. Nothing below edits an accepted migration.
-- ===========================================================================

BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[PersonalisationProfile] (
    [userId] NVARCHAR(36) NOT NULL,
    [onboarding] NVARCHAR(16),
    [historyEnabled] BIT NOT NULL,
    [version] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PersonalisationProfile_pkey] PRIMARY KEY CLUSTERED ([userId])
);

-- CreateTable
CREATE TABLE [dbo].[PersonalisationInterest] (
    [userId] NVARCHAR(36) NOT NULL,
    [interest] NVARCHAR(32) NOT NULL,
    CONSTRAINT [PersonalisationInterest_pkey] PRIMARY KEY CLUSTERED ([userId],[interest])
);

-- CreateTable
CREATE TABLE [dbo].[PersonalisationGoal] (
    [userId] NVARCHAR(36) NOT NULL,
    [goal] NVARCHAR(32) NOT NULL,
    CONSTRAINT [PersonalisationGoal_pkey] PRIMARY KEY CLUSTERED ([userId],[goal])
);

-- CreateTable
CREATE TABLE [dbo].[SavedItem] (
    [id] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [articleId] NVARCHAR(36),
    [workId] NVARCHAR(36),
    [videoId] NVARCHAR(36),
    [surahNumber] INT,
    [ayahNumber] INT,
    [hadithCitationId] NVARCHAR(36),
    [createdAt] DATETIME2 NOT NULL,
    CONSTRAINT [SavedItem_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [SavedItem_owner_key] UNIQUE NONCLUSTERED ([id],[userId])
);

-- CreateTable
CREATE TABLE [dbo].[Bookmark] (
    [savedItemId] NVARCHAR(36) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    CONSTRAINT [Bookmark_pkey] PRIMARY KEY CLUSTERED ([savedItemId])
);

-- CreateTable
CREATE TABLE [dbo].[Note] (
    [savedItemId] NVARCHAR(36) NOT NULL,
    [body] NVARCHAR(2000) NOT NULL,
    [version] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [Note_pkey] PRIMARY KEY CLUSTERED ([savedItemId])
);

-- CreateTable
CREATE TABLE [dbo].[PrivateCollection] (
    [id] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [title] NVARCHAR(120) NOT NULL,
    [description] NVARCHAR(500),
    [version] INT NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PrivateCollection_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [PrivateCollection_owner_key] UNIQUE NONCLUSTERED ([id],[userId])
);

-- CreateTable
CREATE TABLE [dbo].[PrivateCollectionItem] (
    [collectionId] NVARCHAR(36) NOT NULL,
    [savedItemId] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [position] INT NOT NULL,
    [addedAt] DATETIME2 NOT NULL,
    CONSTRAINT [PrivateCollectionItem_pkey] PRIMARY KEY CLUSTERED ([collectionId],[savedItemId]),
    CONSTRAINT [PrivateCollectionItem_position_key] UNIQUE NONCLUSTERED ([collectionId],[position])
);

-- CreateTable
CREATE TABLE [dbo].[ReadingHistory] (
    [id] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [articleId] NVARCHAR(36),
    [workId] NVARCHAR(36),
    [surahNumber] INT,
    [ayahNumber] INT,
    [hadithCitationId] NVARCHAR(36),
    [firstReadAt] DATETIME2 NOT NULL,
    [lastReadAt] DATETIME2 NOT NULL,
    CONSTRAINT [ReadingHistory_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[WatchHistory] (
    [userId] NVARCHAR(36) NOT NULL,
    [videoId] NVARCHAR(36) NOT NULL,
    [firstWatchedAt] DATETIME2 NOT NULL,
    [lastWatchedAt] DATETIME2 NOT NULL,
    CONSTRAINT [WatchHistory_pkey] PRIMARY KEY CLUSTERED ([userId],[videoId])
);

-- CreateTable
CREATE TABLE [dbo].[QuranReadingProgress] (
    [userId] NVARCHAR(36) NOT NULL,
    [surahNumber] INT NOT NULL,
    [ayahNumber] INT NOT NULL,
    [version] INT NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [QuranReadingProgress_pkey] PRIMARY KEY CLUSTERED ([userId])
);

-- CreateTable
CREATE TABLE [dbo].[NotificationPreference] (
    [userId] NVARCHAR(36) NOT NULL,
    [category] NVARCHAR(32) NOT NULL,
    [channel] NVARCHAR(16) NOT NULL,
    [enabled] BIT NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [NotificationPreference_pkey] PRIMARY KEY CLUSTERED ([userId],[category],[channel])
);

-- CreateTable
CREATE TABLE [dbo].[Notification] (
    [id] NVARCHAR(36) NOT NULL,
    [userId] NVARCHAR(36) NOT NULL,
    [kind] NVARCHAR(32) NOT NULL,
    [category] NVARCHAR(32) NOT NULL,
    [destination] NVARCHAR(300),
    [idempotencyKey] NVARCHAR(200) NOT NULL,
    [createdAt] DATETIME2 NOT NULL,
    [readAt] DATETIME2,
    CONSTRAINT [Notification_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [Notification_idempotency_key] UNIQUE NONCLUSTERED ([userId],[idempotencyKey])
);

-- CreateTable
CREATE TABLE [dbo].[NewsletterSubscriber] (
    [id] NVARCHAR(36) NOT NULL,
    [emailDigest] NVARCHAR(64) NOT NULL,
    [digestKeyVersion] INT NOT NULL,
    [email] NVARCHAR(320),
    [state] NVARCHAR(16) NOT NULL,
    [locale] NVARCHAR(8) NOT NULL,
    [generation] INT NOT NULL,
    [confirmTokenHash] NVARCHAR(64),
    [confirmSalt] NVARCHAR(64),
    [confirmExpiresAt] DATETIME2,
    [unsubscribeTokenHash] NVARCHAR(64),
    [unsubscribeSalt] NVARCHAR(64),
    [tokenKeyVersion] INT,
    [submittedAt] DATETIME2 NOT NULL,
    [confirmedAt] DATETIME2,
    [endedAt] DATETIME2,
    [version] INT NOT NULL,
    [updatedAt] DATETIME2 NOT NULL,
    CONSTRAINT [NewsletterSubscriber_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [NewsletterSubscriber_emailDigest_key] UNIQUE NONCLUSTERED ([emailDigest])
);

-- CreateTable
CREATE TABLE [dbo].[NewsletterConsentEvent] (
    [id] NVARCHAR(36) NOT NULL,
    [subscriberId] NVARCHAR(36) NOT NULL,
    [event] NVARCHAR(16) NOT NULL,
    [purpose] NVARCHAR(32) NOT NULL,
    [noticeVersion] NVARCHAR(64) NOT NULL,
    [source] NVARCHAR(16) NOT NULL,
    [locale] NVARCHAR(8),
    [occurredAt] DATETIME2 NOT NULL,
    CONSTRAINT [NewsletterConsentEvent_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [SavedItem_userId_idx] ON [dbo].[SavedItem]([userId], [createdAt] DESC, [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PrivateCollection_userId_idx] ON [dbo].[PrivateCollection]([userId], [updatedAt] DESC, [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [PrivateCollectionItem_savedItem_idx] ON [dbo].[PrivateCollectionItem]([savedItemId], [userId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ReadingHistory_userId_idx] ON [dbo].[ReadingHistory]([userId], [lastReadAt] DESC, [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WatchHistory_userId_idx] ON [dbo].[WatchHistory]([userId], [lastWatchedAt] DESC, [videoId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [WatchHistory_videoId_idx] ON [dbo].[WatchHistory]([videoId]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [QuranReadingProgress_ayah_idx] ON [dbo].[QuranReadingProgress]([surahNumber], [ayahNumber]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [Notification_userId_idx] ON [dbo].[Notification]([userId], [createdAt] DESC, [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NewsletterSubscriber_state_idx] ON [dbo].[NewsletterSubscriber]([state], [submittedAt] DESC, [id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NewsletterSubscriber_expiry_idx] ON [dbo].[NewsletterSubscriber]([state], [confirmExpiresAt]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [NewsletterConsentEvent_subscriberId_idx] ON [dbo].[NewsletterConsentEvent]([subscriberId], [occurredAt]);

-- AddForeignKey
ALTER TABLE [dbo].[PersonalisationProfile] ADD CONSTRAINT [PersonalisationProfile_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PersonalisationInterest] ADD CONSTRAINT [PersonalisationInterest_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[PersonalisationProfile]([userId]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PersonalisationGoal] ADD CONSTRAINT [PersonalisationGoal_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[PersonalisationProfile]([userId]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SavedItem] ADD CONSTRAINT [SavedItem_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SavedItem] ADD CONSTRAINT [SavedItem_articleId_fkey] FOREIGN KEY ([articleId]) REFERENCES [dbo].[Article]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SavedItem] ADD CONSTRAINT [SavedItem_workId_fkey] FOREIGN KEY ([workId]) REFERENCES [dbo].[Work]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SavedItem] ADD CONSTRAINT [SavedItem_videoId_fkey] FOREIGN KEY ([videoId]) REFERENCES [dbo].[Video]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SavedItem] ADD CONSTRAINT [SavedItem_surahNumber_ayahNumber_fkey] FOREIGN KEY ([surahNumber], [ayahNumber]) REFERENCES [dbo].[Ayah]([surahNumber],[ayahNumber]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[SavedItem] ADD CONSTRAINT [SavedItem_hadithCitationId_fkey] FOREIGN KEY ([hadithCitationId]) REFERENCES [dbo].[HadithCitation]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Bookmark] ADD CONSTRAINT [Bookmark_savedItemId_fkey] FOREIGN KEY ([savedItemId]) REFERENCES [dbo].[SavedItem]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Note] ADD CONSTRAINT [Note_savedItemId_fkey] FOREIGN KEY ([savedItemId]) REFERENCES [dbo].[SavedItem]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PrivateCollection] ADD CONSTRAINT [PrivateCollection_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PrivateCollectionItem] ADD CONSTRAINT [PrivateCollectionItem_collection_fkey] FOREIGN KEY ([collectionId], [userId]) REFERENCES [dbo].[PrivateCollection]([id],[userId]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[PrivateCollectionItem] ADD CONSTRAINT [PrivateCollectionItem_savedItem_fkey] FOREIGN KEY ([savedItemId], [userId]) REFERENCES [dbo].[SavedItem]([id],[userId]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ReadingHistory] ADD CONSTRAINT [ReadingHistory_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ReadingHistory] ADD CONSTRAINT [ReadingHistory_articleId_fkey] FOREIGN KEY ([articleId]) REFERENCES [dbo].[Article]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ReadingHistory] ADD CONSTRAINT [ReadingHistory_workId_fkey] FOREIGN KEY ([workId]) REFERENCES [dbo].[Work]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ReadingHistory] ADD CONSTRAINT [ReadingHistory_surahNumber_ayahNumber_fkey] FOREIGN KEY ([surahNumber], [ayahNumber]) REFERENCES [dbo].[Ayah]([surahNumber],[ayahNumber]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[ReadingHistory] ADD CONSTRAINT [ReadingHistory_hadithCitationId_fkey] FOREIGN KEY ([hadithCitationId]) REFERENCES [dbo].[HadithCitation]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[WatchHistory] ADD CONSTRAINT [WatchHistory_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[WatchHistory] ADD CONSTRAINT [WatchHistory_videoId_fkey] FOREIGN KEY ([videoId]) REFERENCES [dbo].[Video]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[QuranReadingProgress] ADD CONSTRAINT [QuranReadingProgress_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[QuranReadingProgress] ADD CONSTRAINT [QuranReadingProgress_surahNumber_ayahNumber_fkey] FOREIGN KEY ([surahNumber], [ayahNumber]) REFERENCES [dbo].[Ayah]([surahNumber],[ayahNumber]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NotificationPreference] ADD CONSTRAINT [NotificationPreference_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[Notification] ADD CONSTRAINT [Notification_userId_fkey] FOREIGN KEY ([userId]) REFERENCES [dbo].[User]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[NewsletterConsentEvent] ADD CONSTRAINT [NewsletterConsentEvent_subscriberId_fkey] FOREIGN KEY ([subscriberId]) REFERENCES [dbo].[NewsletterSubscriber]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- ===========================================================================
-- Exactly one typed target, at most once per account
-- ===========================================================================

ALTER TABLE [dbo].[SavedItem] ADD CONSTRAINT [SavedItem_one_target_ck] CHECK ((CASE WHEN [articleId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [workId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [videoId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [surahNumber] IS NULL THEN 0 ELSE 1 END + CASE WHEN [hadithCitationId] IS NULL THEN 0 ELSE 1 END)=1 AND (([surahNumber] IS NULL AND [ayahNumber] IS NULL) OR ([surahNumber] IS NOT NULL AND [ayahNumber] IS NOT NULL)));
CREATE UNIQUE NONCLUSTERED INDEX [SavedItem_article_key] ON [dbo].[SavedItem]([articleId], [userId]) WHERE [articleId] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [SavedItem_work_key] ON [dbo].[SavedItem]([workId], [userId]) WHERE [workId] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [SavedItem_video_key] ON [dbo].[SavedItem]([videoId], [userId]) WHERE [videoId] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [SavedItem_ayah_key] ON [dbo].[SavedItem]([surahNumber], [ayahNumber], [userId]) WHERE [surahNumber] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [SavedItem_hadith_key] ON [dbo].[SavedItem]([hadithCitationId], [userId]) WHERE [hadithCitationId] IS NOT NULL;

ALTER TABLE [dbo].[ReadingHistory] ADD CONSTRAINT [ReadingHistory_one_target_ck] CHECK ((CASE WHEN [articleId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [workId] IS NULL THEN 0 ELSE 1 END + CASE WHEN [surahNumber] IS NULL THEN 0 ELSE 1 END + CASE WHEN [hadithCitationId] IS NULL THEN 0 ELSE 1 END)=1 AND (([surahNumber] IS NULL AND [ayahNumber] IS NULL) OR ([surahNumber] IS NOT NULL AND [ayahNumber] IS NOT NULL)));
ALTER TABLE [dbo].[ReadingHistory] ADD CONSTRAINT [ReadingHistory_ck] CHECK ([firstReadAt] <= [lastReadAt]);
CREATE UNIQUE NONCLUSTERED INDEX [ReadingHistory_article_key] ON [dbo].[ReadingHistory]([articleId], [userId]) WHERE [articleId] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [ReadingHistory_work_key] ON [dbo].[ReadingHistory]([workId], [userId]) WHERE [workId] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [ReadingHistory_ayah_key] ON [dbo].[ReadingHistory]([surahNumber], [ayahNumber], [userId]) WHERE [surahNumber] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [ReadingHistory_hadith_key] ON [dbo].[ReadingHistory]([hadithCitationId], [userId]) WHERE [hadithCitationId] IS NOT NULL;

ALTER TABLE [dbo].[WatchHistory] ADD CONSTRAINT [WatchHistory_ck] CHECK ([firstWatchedAt] <= [lastWatchedAt]);

-- ===========================================================================
-- Vocabulary and bounds the application also enforces
-- ===========================================================================

ALTER TABLE [dbo].[PersonalisationProfile] ADD CONSTRAINT [PersonalisationProfile_ck] CHECK (([onboarding] IS NULL OR [onboarding] IN (N'completed',N'skipped')) AND [version]>0);
ALTER TABLE [dbo].[PersonalisationInterest] ADD CONSTRAINT [PersonalisationInterest_ck] CHECK ([interest] IN (N'quran',N'hadith',N'library',N'watch',N'listen',N'fatwa',N'news-events',N'global-network'));
ALTER TABLE [dbo].[PersonalisationGoal] ADD CONSTRAINT [PersonalisationGoal_ck] CHECK ([goal] IN (N'read-quran-regularly',N'study-hadith',N'read-books-and-research',N'follow-lectures',N'stay-informed'));
ALTER TABLE [dbo].[Note] ADD CONSTRAINT [Note_ck] CHECK (LEN([body])>0 AND [version]>0 AND [createdAt] <= [updatedAt]);
ALTER TABLE [dbo].[PrivateCollection] ADD CONSTRAINT [PrivateCollection_ck] CHECK (LEN([title])>0 AND ([description] IS NULL OR LEN([description])>0) AND [version]>0 AND [createdAt] <= [updatedAt]);
ALTER TABLE [dbo].[PrivateCollectionItem] ADD CONSTRAINT [PrivateCollectionItem_ck] CHECK ([position] BETWEEN 0 AND 199);
ALTER TABLE [dbo].[QuranReadingProgress] ADD CONSTRAINT [QuranReadingProgress_ck] CHECK ([version]>0);
ALTER TABLE [dbo].[NotificationPreference] ADD CONSTRAINT [NotificationPreference_ck] CHECK ([category] IN (N'questions') AND [channel] IN (N'in-app'));

-- A notification names a translatable kind, its category, and at most a path
-- on this site: one leading slash, unreserved characters only, no empty or
-- dot-led segment — so no scheme, host, protocol-relative URL, backslash,
-- percent-encoding, credential, query or fragment can ever be stored.
ALTER TABLE [dbo].[Notification] ADD CONSTRAINT [Notification_ck] CHECK ([kind] IN (N'question-answered',N'question-declined') AND [category]=N'questions' AND LEN([idempotencyKey])>0 AND ([readAt] IS NULL OR [readAt] >= [createdAt]) AND ([destination] IS NULL OR ([destination] LIKE N'/_%' AND [destination] NOT LIKE N'%[^A-Za-z0-9./_~-]%' AND CHARINDEX(N'//',[destination])=0 AND CHARINDEX(N'/.',[destination])=0)));

-- ===========================================================================
-- Newsletter: which columns each state may hold
-- ===========================================================================

ALTER TABLE [dbo].[NewsletterSubscriber] ADD CONSTRAINT [NewsletterSubscriber_ck] CHECK ([state] IN (N'pending',N'confirmed',N'unsubscribed',N'expired',N'suppressed') AND [locale] IN (N'en',N'ur',N'ar') AND [generation]>0 AND [version]>0 AND [digestKeyVersion]>0 AND LEN([emailDigest])>0);
ALTER TABLE [dbo].[NewsletterSubscriber] ADD CONSTRAINT [NewsletterSubscriber_facts_ck] CHECK (
    ([state]=N'pending' AND [email] IS NOT NULL AND [confirmTokenHash] IS NOT NULL AND [confirmSalt] IS NOT NULL AND [confirmExpiresAt] IS NOT NULL AND [unsubscribeTokenHash] IS NOT NULL AND [unsubscribeSalt] IS NOT NULL AND [tokenKeyVersion] IS NOT NULL AND [confirmedAt] IS NULL AND [endedAt] IS NULL)
 OR ([state]=N'confirmed' AND [email] IS NOT NULL AND [confirmTokenHash] IS NULL AND [confirmSalt] IS NULL AND [confirmExpiresAt] IS NULL AND [unsubscribeTokenHash] IS NOT NULL AND [unsubscribeSalt] IS NOT NULL AND [tokenKeyVersion] IS NOT NULL AND [confirmedAt] IS NOT NULL AND [endedAt] IS NULL)
 OR ([state]=N'unsubscribed' AND [email] IS NULL AND [confirmTokenHash] IS NULL AND [confirmSalt] IS NULL AND [confirmExpiresAt] IS NULL AND [unsubscribeSalt] IS NULL AND [endedAt] IS NOT NULL)
 OR ([state] IN (N'expired',N'suppressed') AND [email] IS NULL AND [confirmTokenHash] IS NULL AND [confirmSalt] IS NULL AND [confirmExpiresAt] IS NULL AND [unsubscribeTokenHash] IS NULL AND [unsubscribeSalt] IS NULL AND [tokenKeyVersion] IS NULL AND [endedAt] IS NOT NULL)
);
CREATE UNIQUE NONCLUSTERED INDEX [NewsletterSubscriber_confirm_key] ON [dbo].[NewsletterSubscriber]([confirmTokenHash]) WHERE [confirmTokenHash] IS NOT NULL;
CREATE UNIQUE NONCLUSTERED INDEX [NewsletterSubscriber_unsubscribe_key] ON [dbo].[NewsletterSubscriber]([unsubscribeTokenHash]) WHERE [unsubscribeTokenHash] IS NOT NULL;

ALTER TABLE [dbo].[NewsletterConsentEvent] ADD CONSTRAINT [NewsletterConsentEvent_ck] CHECK ([event] IN (N'submitted',N'confirmed',N'unsubscribed',N'expired',N'suppressed',N'reinstated') AND [purpose]=N'newsletter' AND LEN([noticeVersion])>0 AND [source] IN (N'newsletter-page',N'email-link',N'operator',N'system') AND ([locale] IS NULL OR [locale] IN (N'en',N'ur',N'ar')));
EXEC sp_executesql N'CREATE TRIGGER [dbo].[NewsletterConsentEventImmutable] ON [dbo].[NewsletterConsentEvent] AFTER UPDATE, DELETE AS BEGIN SET NOCOUNT ON; THROW 51260, ''Newsletter consent evidence is immutable.'', 1; END;';

-- ===========================================================================
-- Permissions
-- ===========================================================================

INSERT INTO [dbo].[Permission] ([key], [description])
SELECT v.[key], v.[description]
FROM (VALUES
    (N'newsletter.read', N'View newsletter subscription states, consent dates and masked addresses. Never the saved items, notes, history or notifications of any account.'),
    (N'newsletter.operate', N'Suppress a newsletter subscription, or reinstate a suppressed one so it must be confirmed again. No sending or campaign capability exists.')
) AS v([key], [description])
WHERE NOT EXISTS (SELECT 1 FROM [dbo].[Permission] p WHERE p.[key] = v.[key]);

-- ===========================================================================
-- EXTENDING THE PROTECTED PLATFORM ADMINISTRATOR BUNDLE
-- ===========================================================================
--
-- The protected bundle is the whole catalogue less the externally gated keys,
-- so appending permissions widens what a live administrator may do. The
-- holders' sessions and step-up grants are revoked in the SAME transaction
-- that changes the bundle (SECURITY_BASELINE.md 8.1), by the mechanism every
-- earlier phase used. On a fresh database every count below is zero and
-- nothing is revoked.

DECLARE @newsletterAdminRoleId NVARCHAR(36);
DECLARE @newsletterAddedKeys NVARCHAR(200);

SELECT @newsletterAdminRoleId = [id]
FROM [dbo].[Role]
WHERE [key] = N'platform-administrator';

IF @newsletterAdminRoleId IS NOT NULL
BEGIN
    SELECT @newsletterAddedKeys = STRING_AGG(p.[key], N' ') WITHIN GROUP (ORDER BY p.[key])
    FROM [dbo].[Permission] p
    WHERE p.[key] IN (N'newsletter.read', N'newsletter.operate')
      AND NOT EXISTS (
          SELECT 1 FROM [dbo].[RolePermission] rp
          WHERE rp.[roleId] = @newsletterAdminRoleId AND rp.[permissionKey] = p.[key]
      );

    IF @newsletterAddedKeys IS NOT NULL AND LEN(@newsletterAddedKeys) > 0
    BEGIN
        INSERT INTO [dbo].[RolePermission] ([roleId], [permissionKey])
        SELECT @newsletterAdminRoleId, p.[key]
        FROM [dbo].[Permission] p
        WHERE p.[key] IN (N'newsletter.read', N'newsletter.operate')
          AND NOT EXISTS (
              SELECT 1 FROM [dbo].[RolePermission] rp
              WHERE rp.[roleId] = @newsletterAdminRoleId AND rp.[permissionKey] = p.[key]
          );

        -- Grants before sessions, so the count each statement reports is the
        -- one it actually removed rather than whatever a cascade took first.
        DELETE FROM [dbo].[StepUpGrant]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @newsletterAdminRoleId AND ra.[revokedAt] IS NULL
        );

        DELETE FROM [dbo].[Session]
        WHERE [userId] IN (
            SELECT ra.[userId] FROM [dbo].[RoleAssignment] ra
            WHERE ra.[roleId] = @newsletterAdminRoleId AND ra.[revokedAt] IS NULL
        );

        -- WHICH KEYS WERE ADDED, and nothing else (SECURITY_BASELINE.md 13.4).
        INSERT INTO [dbo].[AuditLog]
            ([id], [actorType], [actorId], [action], [targetType], [targetId],
             [afterState], [authorisingSource])
        VALUES
            (NEWID(), N'migration', NULL, N'newsletter.permissions.provisioned', N'role',
             @newsletterAdminRoleId,
             N'{"added":"' + @newsletterAddedKeys + N'"}',
             N'20261005000000_phase21_personalisation_notifications');
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
