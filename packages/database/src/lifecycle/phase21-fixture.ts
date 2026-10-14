import 'server-only';

import { deepStrictEqual } from 'node:assert';
import { createHash, randomUUID } from 'node:crypto';

import type { SqlSession } from './sql-connection.ts';

/**
 * POPULATED PHASE-21 STATE for the recovery rehearsals.
 *
 * WHAT THE RECOVERY FIXTURE PROVES THAT A SCHEMA CHECK DOES NOT. That
 * Personalisation came back with every row still OWNED by its account, every
 * saved and read target still a TYPED key that resolves to its owner's row, a
 * private collection still in its owner's order, and the newsletter's consent
 * still exactly what each address agreed to — with only hashes of its links:
 *
 *   - two synthetic accounts: an owner with explicit onboarding answers, and a
 *     second account that skipped onboarding;
 *   - one saved item of each supported kind — an Article, a Work, a Video, an
 *     Ayah and a public Hadith citation — the Ayah bookmarked and the citation
 *     annotated with a private note, and the second account's own saved
 *     Article;
 *   - a private collection holding three of the owner's saved items in a
 *     deliberate order, and the second account's empty collection;
 *   - reading history of an Article, a Work, an Ayah and a citation; watch
 *     history of the Video; one Quran reading position;
 *   - a notification preference, and one read and one unread notification;
 *   - five newsletter subscriptions, one in each state — pending, confirmed,
 *     unsubscribed, expired and suppressed — holding only the columns that
 *     state may hold, each with its append-only consent evidence.
 *
 * NOTHING HERE IS ANYBODY'S DATA. Every note, title, description, name and
 * notice is a `NON_PERSONALISATION_FIXTURE_…` sentinel, every address is
 * `@personalisation-proof.invalid`, every digest and token hash is a SHA-256 of
 * a sentinel, and the targets are the earlier fixtures' synthetic rows. Rows
 * are written directly by the owner: the recovery databases are disposable and
 * created by the run that writes them, and the adapters' own write paths are
 * proved by `db:test:permissions` and the integration suites.
 */

const TEXT = {
  owner: 'NON_PERSONALISATION_FIXTURE_ACCOUNT owner',
  other: 'NON_PERSONALISATION_FIXTURE_ACCOUNT second',
  note: 'NON_PERSONALISATION_FIXTURE_NOTE synthetic private note',
  collection: 'NON_PERSONALISATION_FIXTURE_COLLECTION synthetic list',
  description: 'NON_PERSONALISATION_FIXTURE_DESCRIPTION synthetic description',
  otherCollection: 'NON_PERSONALISATION_FIXTURE_COLLECTION second list',
  notice: 'NON_PERSONALISATION_FIXTURE_NOTICE_V1',
} as const;

/** The five newsletter states, each the subject of one subscription. */
const STATES = ['pending', 'confirmed', 'unsubscribed', 'expired', 'suppressed'] as const;
type SubscriberState = (typeof STATES)[number];

export interface Phase21Fixture {
  readonly runId: string;
  readonly ownerId: string;
  readonly otherId: string;
  readonly savedArticleId: string;
  readonly savedWorkId: string;
  readonly savedVideoId: string;
  readonly savedAyahId: string;
  readonly savedHadithId: string;
  readonly otherSavedId: string;
  readonly collectionId: string;
  readonly otherCollectionId: string;
  readonly readArticleId: string;
  readonly readWorkId: string;
  readonly readAyahId: string;
  readonly readHadithId: string;
  readonly readNotificationId: string;
  readonly unreadNotificationId: string;
  readonly pendingId: string;
  readonly confirmedId: string;
  readonly unsubscribedId: string;
  readonly expiredId: string;
  readonly suppressedId: string;
}

export interface Phase21References {
  /** The Phase-6 Article, Phase-8 Work and Phase-10 Video a person saved. */
  readonly articleId: string;
  readonly workId: string;
  readonly videoId: string;
  /** An Ayah of the Phase-18 fictional corpus, by its canonical citation. */
  readonly surahNumber: number;
  readonly ayahNumber: number;
  /** The Phase-19 public citation, never a source-qualified record. */
  readonly hadithCitationId: string;
}

export function newPhase21Fixture(): Phase21Fixture {
  return {
    runId: randomUUID().replaceAll('-', ''),
    ownerId: randomUUID(),
    otherId: randomUUID(),
    savedArticleId: randomUUID(),
    savedWorkId: randomUUID(),
    savedVideoId: randomUUID(),
    savedAyahId: randomUUID(),
    savedHadithId: randomUUID(),
    otherSavedId: randomUUID(),
    collectionId: randomUUID(),
    otherCollectionId: randomUUID(),
    readArticleId: randomUUID(),
    readWorkId: randomUUID(),
    readAyahId: randomUUID(),
    readHadithId: randomUUID(),
    readNotificationId: randomUUID(),
    unreadNotificationId: randomUUID(),
    pendingId: randomUUID(),
    confirmedId: randomUUID(),
    unsubscribedId: randomUUID(),
    expiredId: randomUUID(),
    suppressedId: randomUUID(),
  };
}

/** Rejects anything that is not this module's own generated shape. */
function assertSafe(fixture: Phase21Fixture): void {
  if (!/^[0-9a-f]{32}$/.test(fixture.runId))
    throw new Error('Phase-21 fixture runId does not match the expected pattern.');
  for (const [name, value] of Object.entries(fixture)) {
    if (name === 'runId') continue;
    if (!/^[0-9a-f-]{36}$/.test(value))
      throw new Error(`Phase-21 fixture field '${name}' is not a generated identifier.`);
  }
}

function assertReferences(references: Phase21References): void {
  for (const id of [
    references.articleId,
    references.workId,
    references.videoId,
    references.hadithCitationId,
  ])
    if (!/^[a-z0-9-]{1,36}$/i.test(id))
      throw new Error('Invalid synthetic Phase-21 fixture reference.');
  for (const number of [references.surahNumber, references.ayahNumber])
    if (!Number.isInteger(number) || number < 1 || number > 9999)
      throw new Error('Invalid synthetic Phase-21 Ayah reference.');
}

/** A SHA-256 hex digest of a sentinel: never a real address or token. */
function digest(fixture: Phase21Fixture, label: string): string {
  return createHash('sha256')
    .update(`NON_PERSONALISATION_FIXTURE ${fixture.runId} ${label}`)
    .digest('hex');
}

function subscriberIds(
  fixture: Phase21Fixture,
): Readonly<Record<SubscriberState, string>> {
  return {
    pending: fixture.pendingId,
    confirmed: fixture.confirmedId,
    unsubscribed: fixture.unsubscribedId,
    expired: fixture.expiredId,
    suppressed: fixture.suppressedId,
  };
}

/** Each state's consent evidence, in order: [event, source]. */
const CONSENT: Readonly<Record<SubscriberState, readonly (readonly [string, string])[]>> =
  {
    pending: [['submitted', 'newsletter-page']],
    confirmed: [
      ['submitted', 'newsletter-page'],
      ['confirmed', 'email-link'],
    ],
    unsubscribed: [
      ['submitted', 'newsletter-page'],
      ['confirmed', 'email-link'],
      ['unsubscribed', 'email-link'],
    ],
    expired: [
      ['submitted', 'newsletter-page'],
      ['expired', 'system'],
    ],
    suppressed: [
      ['submitted', 'newsletter-page'],
      ['suppressed', 'operator'],
    ],
  };

/**
 * Writes the populated Phase-21 state into the SOURCE database, before backup,
 * with the MIGRATION principal, so the real keys, CHECKs, filtered indexes and
 * the consent trigger are exercised: every target exactly one typed key, every
 * collection member its owner's on both keys, every destination an internal
 * path, and every subscription holding exactly what its state may hold.
 */
export async function writePhase21Fixture(
  sql: SqlSession,
  fixture: Phase21Fixture,
  references: Phase21References,
): Promise<void> {
  assertSafe(fixture);
  assertReferences(references);
  const f = fixture;
  const r = references;
  const stem = f.runId.slice(0, 16);
  const ayah = `${String(r.surahNumber)},${String(r.ayahNumber)}`;
  const saved =
    '[id],[userId],[articleId],[workId],[videoId],[surahNumber],[ayahNumber],[hadithCitationId],[createdAt]';
  const read =
    '[id],[userId],[articleId],[workId],[surahNumber],[ayahNumber],[hadithCitationId],[firstReadAt],[lastReadAt]';

  // ---- two accounts and their own data -------------------------------------------
  await sql.query(`
    INSERT INTO [dbo].[User] ([id],[name],[email],[emailVerified],[createdAt],[updatedAt],[locale],[status],[twoFactorEnabled]) VALUES
      (N'${f.ownerId}', N'${TEXT.owner}', N'owner-${stem}@personalisation-proof.invalid', 0, '2026-10-05T07:00:00', '2026-10-05T07:00:00', N'ur', N'active', 0),
      (N'${f.otherId}', N'${TEXT.other}', N'second-${stem}@personalisation-proof.invalid', 0, '2026-10-05T07:00:00', '2026-10-05T07:00:00', N'ar', N'active', 0);
    INSERT INTO [dbo].[PersonalisationProfile] ([userId],[onboarding],[historyEnabled],[version],[createdAt],[updatedAt]) VALUES
      (N'${f.ownerId}', N'completed', 1, 2, '2026-10-05T07:01:00', '2026-10-05T07:02:00'),
      (N'${f.otherId}', N'skipped', 0, 1, '2026-10-05T07:01:00', '2026-10-05T07:01:00');
    INSERT INTO [dbo].[PersonalisationInterest] ([userId],[interest]) VALUES
      (N'${f.ownerId}', N'quran'), (N'${f.ownerId}', N'hadith');
    INSERT INTO [dbo].[PersonalisationGoal] ([userId],[goal]) VALUES
      (N'${f.ownerId}', N'read-quran-regularly');
    INSERT INTO [dbo].[SavedItem] (${saved}) VALUES
      (N'${f.savedArticleId}', N'${f.ownerId}', N'${r.articleId}', NULL, NULL, NULL, NULL, NULL, '2026-10-05T07:10:00'),
      (N'${f.savedWorkId}', N'${f.ownerId}', NULL, N'${r.workId}', NULL, NULL, NULL, NULL, '2026-10-05T07:11:00'),
      (N'${f.savedVideoId}', N'${f.ownerId}', NULL, NULL, N'${r.videoId}', NULL, NULL, NULL, '2026-10-05T07:12:00'),
      (N'${f.savedAyahId}', N'${f.ownerId}', NULL, NULL, NULL, ${ayah}, NULL, '2026-10-05T07:13:00'),
      (N'${f.savedHadithId}', N'${f.ownerId}', NULL, NULL, NULL, NULL, NULL, N'${r.hadithCitationId}', '2026-10-05T07:14:00'),
      (N'${f.otherSavedId}', N'${f.otherId}', N'${r.articleId}', NULL, NULL, NULL, NULL, NULL, '2026-10-05T07:15:00');
    INSERT INTO [dbo].[Bookmark] ([savedItemId],[createdAt]) VALUES (N'${f.savedAyahId}', '2026-10-05T07:13:00');
    INSERT INTO [dbo].[Note] ([savedItemId],[body],[version],[createdAt],[updatedAt]) VALUES
      (N'${f.savedHadithId}', N'${TEXT.note}', 2, '2026-10-05T07:14:00', '2026-10-05T07:20:00');
    INSERT INTO [dbo].[PrivateCollection] ([id],[userId],[title],[description],[version],[createdAt],[updatedAt]) VALUES
      (N'${f.collectionId}', N'${f.ownerId}', N'${TEXT.collection}', N'${TEXT.description}', 3, '2026-10-05T07:30:00', '2026-10-05T07:33:00'),
      (N'${f.otherCollectionId}', N'${f.otherId}', N'${TEXT.otherCollection}', NULL, 1, '2026-10-05T07:30:00', '2026-10-05T07:30:00');
    INSERT INTO [dbo].[PrivateCollectionItem] ([collectionId],[savedItemId],[userId],[position],[addedAt]) VALUES
      (N'${f.collectionId}', N'${f.savedHadithId}', N'${f.ownerId}', 0, '2026-10-05T07:31:00'),
      (N'${f.collectionId}', N'${f.savedArticleId}', N'${f.ownerId}', 1, '2026-10-05T07:32:00'),
      (N'${f.collectionId}', N'${f.savedAyahId}', N'${f.ownerId}', 2, '2026-10-05T07:33:00');
    INSERT INTO [dbo].[ReadingHistory] (${read}) VALUES
      (N'${f.readArticleId}', N'${f.ownerId}', N'${r.articleId}', NULL, NULL, NULL, NULL, '2026-10-05T08:00:00', '2026-10-05T08:30:00'),
      (N'${f.readWorkId}', N'${f.ownerId}', NULL, N'${r.workId}', NULL, NULL, NULL, '2026-10-05T08:01:00', '2026-10-05T08:01:00'),
      (N'${f.readAyahId}', N'${f.ownerId}', NULL, NULL, ${ayah}, NULL, '2026-10-05T08:02:00', '2026-10-05T08:40:00'),
      (N'${f.readHadithId}', N'${f.ownerId}', NULL, NULL, NULL, NULL, N'${r.hadithCitationId}', '2026-10-05T08:03:00', '2026-10-05T08:03:00');
    INSERT INTO [dbo].[WatchHistory] ([userId],[videoId],[firstWatchedAt],[lastWatchedAt]) VALUES
      (N'${f.ownerId}', N'${r.videoId}', '2026-10-05T08:10:00', '2026-10-05T08:50:00');
    INSERT INTO [dbo].[QuranReadingProgress] ([userId],[surahNumber],[ayahNumber],[version],[updatedAt]) VALUES
      (N'${f.ownerId}', ${ayah}, 4, '2026-10-05T08:40:00');
    INSERT INTO [dbo].[NotificationPreference] ([userId],[category],[channel],[enabled],[updatedAt]) VALUES
      (N'${f.ownerId}', N'questions', N'in-app', 1, '2026-10-05T07:05:00');
    INSERT INTO [dbo].[Notification] ([id],[userId],[kind],[category],[destination],[idempotencyKey],[createdAt],[readAt]) VALUES
      (N'${f.readNotificationId}', N'${f.ownerId}', N'question-answered', N'questions', N'/ur/my/questions/${f.readNotificationId}', N'fixture-${stem}-answered', '2026-10-05T09:00:00', '2026-10-05T09:05:00'),
      (N'${f.unreadNotificationId}', N'${f.ownerId}', N'question-declined', N'questions', NULL, N'fixture-${stem}-declined', '2026-10-05T09:10:00', NULL);
  `);

  // ---- the newsletter: one subscription per state, hashes only ---------------------
  const ids = subscriberIds(f);
  const rows = STATES.map((state, index) => {
    const id = ids[state];
    const at = `'2026-10-05T10:0${String(index)}:00'`;
    const email = `N'newsletter-${state}-${stem}@personalisation-proof.invalid'`;
    const live = state === 'pending' || state === 'confirmed';
    const hash = (label: string): string => `N'${digest(f, `${state} ${label}`)}'`;
    const values = [
      `N'${id}'`,
      hash('address'),
      '1',
      live ? email : 'NULL',
      `N'${state}'`,
      `N'${['en', 'ur', 'ar'][index % 3] ?? 'en'}'`,
      '1',
      state === 'pending' ? hash('confirm') : 'NULL',
      state === 'pending' ? hash('confirm salt') : 'NULL',
      state === 'pending' ? "'2026-10-07T10:00:00'" : 'NULL',
      live ? hash('unsubscribe') : 'NULL',
      live ? hash('unsubscribe salt') : 'NULL',
      live ? '1' : 'NULL',
      at,
      state === 'pending' || state === 'expired' || state === 'suppressed'
        ? 'NULL'
        : "'2026-10-05T11:00:00'",
      live ? 'NULL' : "'2026-10-05T12:00:00'",
      String(CONSENT[state].length),
      live ? at : "'2026-10-05T12:00:00'",
    ];
    return `(${values.join(', ')})`;
  });
  const events = STATES.flatMap((state, index) =>
    CONSENT[state].map(
      ([event, source], step) =>
        `(N'${randomUUID()}', N'${ids[state]}', N'${event}', N'newsletter', N'${TEXT.notice}', N'${source}', ${source === 'operator' || source === 'system' ? 'NULL' : `N'${['en', 'ur', 'ar'][index % 3] ?? 'en'}'`}, '2026-10-05T1${String(step)}:0${String(index)}:00')`,
    ),
  );
  await sql.query(`
    INSERT INTO [dbo].[NewsletterSubscriber] ([id],[emailDigest],[digestKeyVersion],[email],[state],[locale],[generation],[confirmTokenHash],[confirmSalt],[confirmExpiresAt],[unsubscribeTokenHash],[unsubscribeSalt],[tokenKeyVersion],[submittedAt],[confirmedAt],[endedAt],[version],[updatedAt]) VALUES
      ${rows.join(',\n      ')};
    INSERT INTO [dbo].[NewsletterConsentEvent] ([id],[subscriberId],[event],[purpose],[noticeVersion],[source],[locale],[occurredAt]) VALUES
      ${events.join(',\n      ')};
  `);
}

/** Every authoritative Phase-21 row this fixture wrote, in a stable order. */
export async function capturePhase21Fixture(
  sql: SqlSession,
  fixture: Phase21Fixture,
): Promise<Readonly<Record<string, string>>> {
  assertSafe(fixture);
  const f = fixture;
  const users = `N'${f.ownerId}',N'${f.otherId}'`;
  const subscribers = Object.values(subscriberIds(f))
    .map((id) => `N'${id}'`)
    .join(',');
  const rows: Record<string, string> = {};

  for (const [name, statement, expected] of [
    [
      'PersonalisationProfile',
      `SELECT * FROM [dbo].[PersonalisationProfile] WHERE [userId] IN (${users}) ORDER BY [onboarding]`,
      2,
    ],
    [
      'PersonalisationInterest',
      `SELECT * FROM [dbo].[PersonalisationInterest] WHERE [userId] IN (${users}) ORDER BY [interest]`,
      2,
    ],
    [
      'PersonalisationGoal',
      `SELECT * FROM [dbo].[PersonalisationGoal] WHERE [userId] IN (${users})`,
      1,
    ],
    [
      'SavedItem',
      `SELECT * FROM [dbo].[SavedItem] WHERE [userId] IN (${users}) ORDER BY [createdAt]`,
      6,
    ],
    [
      'Bookmark',
      `SELECT b.* FROM [dbo].[Bookmark] b JOIN [dbo].[SavedItem] s ON s.[id]=b.[savedItemId] WHERE s.[userId] IN (${users})`,
      1,
    ],
    [
      'Note',
      `SELECT n.* FROM [dbo].[Note] n JOIN [dbo].[SavedItem] s ON s.[id]=n.[savedItemId] WHERE s.[userId] IN (${users})`,
      1,
    ],
    [
      'PrivateCollection',
      `SELECT * FROM [dbo].[PrivateCollection] WHERE [userId] IN (${users}) ORDER BY [version] DESC`,
      2,
    ],
    [
      'PrivateCollectionItem',
      `SELECT * FROM [dbo].[PrivateCollectionItem] WHERE [userId] IN (${users}) ORDER BY [collectionId], [position]`,
      3,
    ],
    [
      'ReadingHistory',
      `SELECT * FROM [dbo].[ReadingHistory] WHERE [userId] IN (${users}) ORDER BY [firstReadAt]`,
      4,
    ],
    [
      'WatchHistory',
      `SELECT * FROM [dbo].[WatchHistory] WHERE [userId] IN (${users})`,
      1,
    ],
    [
      'QuranReadingProgress',
      `SELECT * FROM [dbo].[QuranReadingProgress] WHERE [userId] IN (${users})`,
      1,
    ],
    [
      'NotificationPreference',
      `SELECT * FROM [dbo].[NotificationPreference] WHERE [userId] IN (${users})`,
      1,
    ],
    [
      'Notification',
      `SELECT * FROM [dbo].[Notification] WHERE [userId] IN (${users}) ORDER BY [createdAt]`,
      2,
    ],
    [
      'NewsletterSubscriber',
      `SELECT * FROM [dbo].[NewsletterSubscriber] WHERE [id] IN (${subscribers}) ORDER BY [submittedAt]`,
      5,
    ],
    [
      'NewsletterConsentEvent',
      `SELECT * FROM [dbo].[NewsletterConsentEvent] WHERE [subscriberId] IN (${subscribers}) ORDER BY [occurredAt], [subscriberId]`,
      10,
    ],
  ] as const) {
    const data = await sql.query(`${statement};`);
    if (data.length !== expected) {
      throw new Error(
        `Phase-21 recovery expected ${String(expected)} ${name} row(s), found ${String(data.length)}.`,
      );
    }
    rows[name] = JSON.stringify(data);
  }

  return rows;
}

/** The Phase-21 tables whose constraints and trigger must return intact. */
const PHASE21_TABLES = [
  'PersonalisationProfile',
  'PersonalisationInterest',
  'PersonalisationGoal',
  'SavedItem',
  'Bookmark',
  'Note',
  'PrivateCollection',
  'PrivateCollectionItem',
  'ReadingHistory',
  'WatchHistory',
  'QuranReadingProgress',
  'NotificationPreference',
  'Notification',
  'NewsletterSubscriber',
  'NewsletterConsentEvent',
] as const;

/** The only cascades, every one of them inside the context. */
const INTERNAL_CASCADES = [
  'Bookmark_savedItemId_fkey',
  'Note_savedItemId_fkey',
  'PersonalisationGoal_userId_fkey',
  'PersonalisationInterest_userId_fkey',
  'PrivateCollectionItem_collection_fkey',
].join(',');

/**
 * Verifies the restored Personalisation state and returns one line of what was
 * proved.
 *
 * BEYOND ROW EQUALITY: every note, title, description, name and notice is still
 * an unmistakable sentinel; each account's rows are still its own and the
 * second account's untouched; every saved and read target still resolves
 * through a real join to the Article, Work, Video, Ayah and Hadith citation it
 * names; the private collection reads back in its owner's order and every
 * member is its owner's on both keys; each subscription holds exactly what its
 * state may hold, with only the two link HASH columns and no raw token column
 * anywhere; the consent evidence is complete and in order; both newsletter keys
 * are still bundled; the consent trigger is enabled; and every Phase-21 CHECK
 * and foreign key is enabled and trusted, cascading only inside the context.
 */
export async function verifyRestoredPhase21(
  sql: SqlSession,
  fixture: Phase21Fixture,
  expected: Readonly<Record<string, string>>,
  references: Phase21References,
): Promise<string> {
  deepStrictEqual(
    await capturePhase21Fixture(sql, fixture),
    expected,
    'Phase-21 Personalisation authoritative values changed during recovery.',
  );
  assertReferences(references);
  const f = fixture;
  const r = references;
  const users = `N'${f.ownerId}',N'${f.otherId}'`;
  const subscribers = Object.values(subscriberIds(f))
    .map((id) => `N'${id}'`)
    .join(',');

  const [labelled] = await sql.query<Record<string, number>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[Note] n JOIN [dbo].[SavedItem] s ON s.[id]=n.[savedItemId]
        WHERE s.[userId] IN (${users}) AND n.[body] NOT LIKE N'NON[_]PERSONALISATION[_]FIXTURE[_]NOTE%') AS [notes],
      (SELECT COUNT(*) FROM [dbo].[PrivateCollection] WHERE [userId] IN (${users})
         AND ([title] NOT LIKE N'NON[_]PERSONALISATION[_]FIXTURE[_]COLLECTION%'
              OR ISNULL([description], N'NON_PERSONALISATION_FIXTURE_') NOT LIKE N'NON[_]PERSONALISATION[_]FIXTURE[_]%')) AS [collections],
      (SELECT COUNT(*) FROM [dbo].[User] WHERE [id] IN (${users})
         AND ([name] NOT LIKE N'NON[_]PERSONALISATION[_]FIXTURE[_]%' OR [email] NOT LIKE N'%@personalisation-proof.invalid')) AS [accounts],
      (SELECT COUNT(*) FROM [dbo].[NewsletterSubscriber] WHERE [id] IN (${subscribers})
         AND [email] IS NOT NULL AND [email] NOT LIKE N'%@personalisation-proof.invalid') AS [addresses],
      (SELECT COUNT(*) FROM [dbo].[NewsletterConsentEvent] WHERE [subscriberId] IN (${subscribers})
         AND [noticeVersion] NOT LIKE N'NON[_]PERSONALISATION[_]FIXTURE[_]NOTICE%') AS [notices];
  `);
  if (
    JSON.stringify(labelled) !==
    '{"notes":0,"collections":0,"accounts":0,"addresses":0,"notices":0}'
  ) {
    throw new Error(
      `Restored Phase-21 fixture is no longer unmistakably labelled: ${JSON.stringify(labelled)}.`,
    );
  }

  // Ownership, typed integrity, order and the newsletter's facts, through the
  // same joins and predicates the adapters read by.
  const [state] = await sql.query<Record<string, number | string | null>>(`
    SELECT
      (SELECT COUNT(*) FROM [dbo].[SavedItem] WHERE [userId]=N'${f.ownerId}') AS [ownSaved],
      (SELECT STRING_AGG([id], N',') FROM [dbo].[SavedItem] WHERE [userId]=N'${f.otherId}') AS [otherSaved],
      (SELECT COUNT(*) FROM [dbo].[SavedItem] s JOIN [dbo].[Article] a ON a.[id]=s.[articleId]
         WHERE s.[userId] IN (${users}) AND a.[id]=N'${r.articleId}')
        + (SELECT COUNT(*) FROM [dbo].[SavedItem] s JOIN [dbo].[Work] w ON w.[id]=s.[workId]
         WHERE s.[id]=N'${f.savedWorkId}' AND w.[id]=N'${r.workId}')
        + (SELECT COUNT(*) FROM [dbo].[SavedItem] s JOIN [dbo].[Video] v ON v.[id]=s.[videoId]
         WHERE s.[id]=N'${f.savedVideoId}' AND v.[id]=N'${r.videoId}')
        + (SELECT COUNT(*) FROM [dbo].[SavedItem] s
             JOIN [dbo].[Ayah] y ON y.[surahNumber]=s.[surahNumber] AND y.[ayahNumber]=s.[ayahNumber]
         WHERE s.[id]=N'${f.savedAyahId}' AND y.[surahNumber]=${String(r.surahNumber)} AND y.[ayahNumber]=${String(r.ayahNumber)})
        + (SELECT COUNT(*) FROM [dbo].[SavedItem] s JOIN [dbo].[HadithCitation] h ON h.[id]=s.[hadithCitationId]
         WHERE s.[id]=N'${f.savedHadithId}' AND h.[id]=N'${r.hadithCitationId}') AS [savedTargets],
      (SELECT COUNT(*) FROM [dbo].[ReadingHistory] x
         LEFT JOIN [dbo].[Article] a ON a.[id]=x.[articleId]
         LEFT JOIN [dbo].[Work] w ON w.[id]=x.[workId]
         LEFT JOIN [dbo].[Ayah] y ON y.[surahNumber]=x.[surahNumber] AND y.[ayahNumber]=x.[ayahNumber]
         LEFT JOIN [dbo].[HadithCitation] h ON h.[id]=x.[hadithCitationId]
        WHERE x.[userId]=N'${f.ownerId}'
          AND (a.[id] IS NOT NULL OR w.[id] IS NOT NULL OR y.[surahNumber] IS NOT NULL OR h.[id] IS NOT NULL)) AS [readTargets],
      (SELECT COUNT(*) FROM [dbo].[WatchHistory] x JOIN [dbo].[Video] v ON v.[id]=x.[videoId]
        WHERE x.[userId]=N'${f.ownerId}') AS [watched],
      (SELECT COUNT(*) FROM [dbo].[QuranReadingProgress] p
         JOIN [dbo].[Ayah] y ON y.[surahNumber]=p.[surahNumber] AND y.[ayahNumber]=p.[ayahNumber]
        WHERE p.[userId]=N'${f.ownerId}') AS [position],
      (SELECT STRING_AGG(i.[savedItemId], N',') WITHIN GROUP (ORDER BY i.[position])
         FROM [dbo].[PrivateCollectionItem] i
         JOIN [dbo].[PrivateCollection] c ON c.[id]=i.[collectionId] AND c.[userId]=i.[userId]
         JOIN [dbo].[SavedItem] s ON s.[id]=i.[savedItemId] AND s.[userId]=i.[userId]
        WHERE c.[id]=N'${f.collectionId}' AND c.[userId]=N'${f.ownerId}') AS [order],
      (SELECT COUNT(*) FROM [dbo].[PrivateCollectionItem] WHERE [collectionId]=N'${f.otherCollectionId}') AS [otherMembers],
      (SELECT COUNT(*) FROM [dbo].[Bookmark] b JOIN [dbo].[SavedItem] s ON s.[id]=b.[savedItemId]
        WHERE s.[id]=N'${f.savedAyahId}' AND s.[userId]=N'${f.ownerId}')
        + (SELECT COUNT(*) FROM [dbo].[Note] n JOIN [dbo].[SavedItem] s ON s.[id]=n.[savedItemId]
        WHERE s.[id]=N'${f.savedHadithId}' AND s.[userId]=N'${f.ownerId}') AS [annotations],
      (SELECT STRING_AGG([interest], N',') WITHIN GROUP (ORDER BY [interest])
         FROM [dbo].[PersonalisationInterest] i JOIN [dbo].[PersonalisationProfile] p ON p.[userId]=i.[userId]
        WHERE p.[userId]=N'${f.ownerId}' AND p.[onboarding]=N'completed') AS [interests],
      (SELECT COUNT(*) FROM [dbo].[Notification] WHERE [userId]=N'${f.ownerId}' AND [readAt] IS NULL) AS [unread],
      (SELECT STRING_AGG([state], N',') WITHIN GROUP (ORDER BY [state])
         FROM [dbo].[NewsletterSubscriber] WHERE [id] IN (${subscribers})) AS [states],
      (SELECT COUNT(*) FROM [dbo].[NewsletterSubscriber] WHERE [id] IN (${subscribers}) AND [email] IS NOT NULL) AS [addressesHeld],
      (SELECT COUNT(*) FROM [dbo].[NewsletterSubscriber] WHERE [id] IN (${subscribers}) AND [confirmTokenHash] IS NOT NULL) AS [liveConfirm],
      (SELECT COUNT(*) FROM [dbo].[NewsletterSubscriber] WHERE [id] IN (${subscribers}) AND [unsubscribeTokenHash] IS NOT NULL) AS [liveUnsubscribe],
      (SELECT STRING_AGG(c.[name], N',') WITHIN GROUP (ORDER BY c.[name]) FROM sys.columns c
        WHERE c.[object_id] = OBJECT_ID(N'[dbo].[NewsletterSubscriber]')
          AND (c.[name] LIKE N'%token%' OR c.[name] LIKE N'%secret%')) AS [tokenColumns],
      (SELECT STRING_AGG([event], N',') WITHIN GROUP (ORDER BY [occurredAt])
         FROM [dbo].[NewsletterConsentEvent] WHERE [subscriberId]=N'${f.unsubscribedId}') AS [consentTrail],
      (SELECT COUNT(*) FROM [dbo].[RolePermission] rp JOIN [dbo].[Role] o ON o.[id]=rp.[roleId]
        WHERE o.[key]=N'platform-administrator'
          AND rp.[permissionKey] IN (N'newsletter.read', N'newsletter.operate')) AS [newsletterBundled];
  `);
  const expectedState = {
    ownSaved: 5,
    otherSaved: f.otherSavedId,
    savedTargets: 6,
    readTargets: 4,
    watched: 1,
    position: 1,
    order: `${f.savedHadithId},${f.savedArticleId},${f.savedAyahId}`,
    otherMembers: 0,
    annotations: 2,
    interests: 'hadith,quran',
    unread: 1,
    states: 'confirmed,expired,pending,suppressed,unsubscribed',
    addressesHeld: 2,
    liveConfirm: 1,
    liveUnsubscribe: 2,
    // The two link HASHES and the key version they were derived under: no column
    // that could hold a token itself.
    tokenColumns: 'confirmTokenHash,tokenKeyVersion,unsubscribeTokenHash',
    consentTrail: 'submitted,confirmed,unsubscribed',
    newsletterBundled: 2,
  };
  if (JSON.stringify(state) !== JSON.stringify(expectedState)) {
    throw new Error(
      `Restored Phase-21 Personalisation state is broken: ${JSON.stringify(state)}.`,
    );
  }

  const tables = PHASE21_TABLES.map((table) => `OBJECT_ID(N'${table}')`).join(',');
  const broken = await sql.query<{ name: string }>(
    `SELECT [name] FROM sys.check_constraints
     WHERE parent_object_id IN (${tables}) AND (is_disabled=1 OR is_not_trusted=1)
     UNION ALL
     SELECT [name] FROM sys.foreign_keys
     WHERE parent_object_id IN (${tables})
       AND (is_disabled=1 OR is_not_trusted=1 OR update_referential_action<>0)
     UNION ALL
     SELECT [name] FROM sys.triggers WHERE parent_id IN (${tables}) AND is_disabled=1;`,
  );
  if (broken.length > 0) {
    throw new Error(
      `Restored Phase-21 constraints or trigger are not intact: ${broken.map((row) => row.name).join(', ')}`,
    );
  }

  const [counts] = await sql.query<{
    checks: number;
    keys: number;
    cascades: string | null;
    triggers: string | null;
    filtered: number;
  }>(
    `SELECT
       (SELECT COUNT_BIG(*) FROM sys.check_constraints WHERE parent_object_id IN (${tables})) AS [checks],
       (SELECT COUNT_BIG(*) FROM sys.foreign_keys WHERE parent_object_id IN (${tables})) AS [keys],
       (SELECT STRING_AGG([name], N',') WITHIN GROUP (ORDER BY [name]) FROM sys.foreign_keys
         WHERE parent_object_id IN (${tables}) AND delete_referential_action<>0) AS [cascades],
       (SELECT STRING_AGG([name], N',') FROM sys.triggers WHERE parent_id IN (${tables})) AS [triggers],
       (SELECT COUNT_BIG(*) FROM sys.indexes
         WHERE [object_id] IN (${tables}) AND is_unique=1 AND has_filter=1) AS [filtered];`,
  );
  // 16 CHECKs, 26 foreign keys of which exactly the internal ones cascade, the
  // consent trigger and 11 filtered unique keys, exactly as the migration
  // creates them: a restore that silently lost one would otherwise read as
  // "none untrusted".
  if (
    Number(counts?.checks ?? 0) !== 16 ||
    Number(counts?.keys ?? 0) !== 26 ||
    counts?.cascades !== INTERNAL_CASCADES ||
    counts.triggers !== 'NewsletterConsentEventImmutable' ||
    Number(counts.filtered) !== 11
  ) {
    throw new Error(
      `Restored Phase-21 objects are incomplete: ${JSON.stringify(counts ?? null)}.`,
    );
  }

  return 'owner-scoped saved items of five typed kinds with a bookmark and a note, an ordered owner-bound private collection, reading, watch and Quran progress resolving to their targets, onboarding answers, a read and an unread notification, five newsletter states holding only link hashes, complete consent trails, trusted keys cascading only inside the context and the consent trigger enabled';
}
