import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  getApplicationPrincipalCredentials,
  getDatabaseRuntimeUrl,
} from '../../packages/database/src/config.ts';
import { provisionApplicationPrincipal } from '../../packages/database/src/lifecycle/application-principal.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import {
  openSession,
  parseSqlServerUrl,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  NEWSLETTER_NOTICE_VERSION,
  NEWSLETTER_PURPOSE,
  PERSONAL_LIMITS,
  isInternalDestination,
  type NotificationProduction,
  type PersonalDispositionPort,
  type PersonalHistoryPort,
  type PersonalNotificationPort,
  type PersonalPurgePort,
  type PersonalSavedPort,
  type PersonalSettingsPort,
  type PersonalTarget,
} from '../../packages/contracts/src/personalisation/index.ts';
import type {
  DeliveryRecord,
  RateLimiterPort,
} from '../../packages/contracts/src/platform/index.ts';
import {
  createAccountService,
  createNewsletterLinkReader,
  createNewsletterService,
  personalFailure,
  type AccountService,
  type NewsletterLinkReader,
  type NewsletterService,
} from '../../apps/web/src/contexts/personalisation-notifications/index.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import {
  account,
  accountWithEmail,
  articles,
  closeAccount,
  count,
  emailOf,
  n,
  ownedRows,
  quranScaffold,
  sentinel,
  video,
  work,
} from './fixture-sql.ts';

/**
 * Phase 21 — Personalisation & Notifications' adapters over a REAL SQL Server,
 * running as the REAL least-privilege RUNTIME principal.
 *
 * WHAT ONLY THE DATABASE CAN PROVE: that every read and write names its owner
 * IN SQL, so somebody else's id answers exactly like a missing one; that a
 * saved target is a typed foreign key with exactly one kind and no type column;
 * that concurrent saves, reorders, productions and subscriptions serialise to
 * one outcome; that every bound and version holds under the database's own
 * locks; that closure and a content hard purge release every reference in
 * bounded, resumable batches; and that the newsletter stores hashes, never
 * tokens, and consumes a confirmation once.
 *
 * TWO CONNECTIONS, TWO ROLES. The owner/migration session writes what only
 * another context or an operator may write — accounts and their closure, the
 * content rows a target references, rows a bound proof seeds — and inspects.
 * EVERYTHING Personalisation does goes through its adapters, whose Prisma
 * client is bound to the provisioned RUNTIME principal.
 *
 * NOTHING HERE IS CONTENT OR A REAL ADDRESS (see `./fixture-sql.ts`).
 */

const live = databaseConfigured ? describe : describe.skip;

const reasonOf = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
  } catch (error) {
    const reason = (error as { reason?: unknown } | null)?.reason;
    return typeof reason === 'string' ? reason : 'unclassified';
  }
  return 'accepted';
};

/** Recovers an SQL Server error number from a driver error, or null. */
const sqlNumber = async (promise: Promise<unknown>): Promise<number | null> => {
  try {
    await promise;
  } catch (error) {
    const number = (error as { number?: unknown } | null)?.number;
    return typeof number === 'number' ? number : null;
  }
  return null;
};

const allow: RateLimiterPort = {
  consume: async () => ({ allowed: true, retryAfter: null }),
  purgeExpired: async () => 0,
};
const key = (purpose: string, subject: string) => `${purpose}:${subject}`;

const DIGEST_KEY = 'non-personal-fixture-digest-key-0123456789abcdef';
const TOKEN_KEY = 'non-personal-fixture-token-key-0123456789abcdef';
const BASE_URL = 'https://minhaj.invalid';

const article = (id: string): PersonalTarget => ({ kind: 'article', id });
const ayah = (number: number): PersonalTarget => ({
  kind: 'ayah',
  surah: 1,
  ayah: number,
});

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

live('Phase 21 Personalisation against real SQL Server, as the runtime principal', () => {
  let db: DisposableDatabase;
  let app: SqlSession;

  let saved: PersonalSavedPort;
  let history: PersonalHistoryPort;
  let settings: PersonalSettingsPort;
  let notifications: PersonalNotificationPort;
  let disposition: PersonalDispositionPort;
  let purge: PersonalPurgePort;
  let accountService: AccountService;
  let newsletter: NewsletterService;
  let linkReader: NewsletterLinkReader;
  let digestOf: (email: string) => string;
  let tombstone: (accountId: string) => string;

  /** The content pool every proof draws distinct targets from. */
  let pool: string[];
  let poolAt = 0;
  const nextArticle = () => {
    const id = pool[poolAt];
    poolAt += 1;
    if (id === undefined) throw new Error('fixture pool exhausted');
    return id;
  };
  let workId: string;
  let videoId: string;
  const AYAT = 12;

  /* ---- newsletter test doubles ------------------------------------------ */

  const deliveries: {
    recipient: string;
    sourceReference: string;
    idempotencyKey: string;
  }[] = [];
  const providerSuppressed = new Set<string>();
  const grants = new Map<string, readonly string[]>();

  beforeAll(async () => {
    // The runtime URL is read BEFORE the harness repoints `DATABASE_URL` at the
    // migration principal, then repointed at the disposable database — and
    // POSITIVELY proved to be the runtime principal on a disposable target.
    const runtimeSource = getDatabaseRuntimeUrl();
    db = await createProofDatabase();
    const runtimeTarget = parseSqlServerUrl(runtimeSource);
    const runtimeUrl = runtimeSource.replace(
      `database=${runtimeTarget.database}`,
      `database=${db.name}`,
    );
    if (runtimeUrl === runtimeSource)
      throw new Error(
        'The runtime URL could not be repointed at the disposable database.',
      );
    const connection = assertApprovedLocalTarget(
      runtimeUrl,
      localTargetPolicy(process.env, 'disposable', 'runtime'),
    );

    const principal = getApplicationPrincipalCredentials();
    await provisionApplicationPrincipal(
      db.admin,
      principal.DATABASE_APP_LOGIN,
      principal.DATABASE_APP_PASSWORD,
    );
    app = await openSession(connection);
    process.env['DATABASE_URL'] = runtimeUrl;

    const database = await import('../../packages/database/src/index.ts');
    saved = database.createPersonalSaved();
    history = database.createPersonalHistory();
    settings = database.createPersonalSettings();
    notifications = database.createPersonalNotifications();
    disposition = database.createPersonalDisposition();
    purge = database.createPersonalPurge();
    tombstone = database.tombstoneEmail;
    digestOf = (email) =>
      database.recipientDigest(email, { key: DIGEST_KEY, keyVersion: 1 });
    const identity = database.createAuthorizationPersistence();

    accountService = createAccountService({
      exports: database.createPersonalExport(),
      disposition,
      purge,
      // Identity's own answer, read live by the runtime principal.
      accounts: { closedAccounts: (ids) => identity.closedAccountIds(ids) },
      limiter: allow,
      key,
    });
    const store = database.createNewsletter();
    newsletter = createNewsletterService({
      newsletter: store,
      limiter: allow,
      key,
      digest: (email) => ({ digest: digestOf(email), keyVersion: 1 }),
      tokenKey: { key: TOKEN_KEY, version: 1 },
      suppressed: async (email) => providerSuppressed.has(email),
      enqueue: async (delivery) => {
        deliveries.push(delivery);
      },
      baseUrl: BASE_URL,
      authority: {
        permits: async (actor, permission) =>
          (grants.get(actor.accountId) ?? []).includes(permission),
      },
    });
    linkReader = createNewsletterLinkReader(store);

    const creator = await account(db.admin);
    pool = await articles(db.admin, creator, 900);
    workId = await work(db.admin);
    videoId = await video(db.admin);
    await quranScaffold(db.admin, AYAT);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await db?.close();
  });

  /* ======================================================================
   * Ownership — somebody else's id is a missing id
   * ==================================================================== */

  describe('every record has one owner, named in SQL', () => {
    let alice: string;
    let bob: string;
    const a = { article: '', collection: randomUUID(), notification: randomUUID() };
    let noted: PersonalTarget;
    let aliceItem: string;

    beforeAll(async () => {
      alice = await account(db.admin);
      bob = await account(db.admin);
      a.article = nextArticle();
      noted = article(a.article);
      await saved.bookmark(alice, noted, randomUUID());
      await saved.writeNote(
        alice,
        { target: noted, body: sentinel('ALICE_NOTE', 1), expectedVersion: 0 },
        randomUUID(),
      );
      await saved.createCollection(alice, a.collection, {
        title: sentinel('ALICE_COLLECTION', 1),
        description: null,
      });
      await saved.addToCollection(
        alice,
        { collectionId: a.collection, target: noted, expectedVersion: 1 },
        randomUUID(),
      );
      aliceItem = (await saved.collection(alice, a.collection))!.members[0]!.savedItemId;
      await settings.saveOnboarding(
        alice,
        { interests: ['quran', 'hadith'], goals: ['study-hadith'], expectedVersion: 0 },
        'completed',
        new Date(),
      );
      await settings.setHistory(alice, { enabled: true, expectedVersion: 1 }, new Date());
      await history.recordRead(alice, noted, new Date());
      await history.recordWatch(alice, videoId, new Date());
      await history.setQuranProgress(
        alice,
        { surah: 1, ayah: 2, expectedVersion: 0 },
        new Date(),
      );
      await notifications.produce(
        {
          accountId: alice,
          kind: 'question-answered',
          destination: `/my/questions/${randomUUID()}`,
          idempotencyKey: `proof:${a.notification}`,
        },
        a.notification,
        new Date(),
      );
    });

    it('holds Alice’s records, so every refusal below is not vacuous', async () => {
      expect((await saved.bookmarks(alice, 0)).total).toBe(1);
      expect((await saved.notes(alice, 0)).items[0]?.body).toBe(
        sentinel('ALICE_NOTE', 1),
      );
      expect((await saved.collection(alice, a.collection))?.members).toHaveLength(1);
      expect((await history.reading(alice, 0)).total).toBe(1);
      expect((await history.watching(alice, 0)).total).toBe(1);
      expect(await history.quranProgress(alice)).toMatchObject({ surah: 1, ayah: 2 });
      expect(await notifications.unread(alice)).toBe(1);
    });

    it('lists none of Alice’s rows to Bob', async () => {
      expect(await saved.bookmarks(bob, 0)).toEqual({ items: [], total: 0, offset: 0 });
      expect(await saved.notes(bob, 0)).toEqual({ items: [], total: 0, offset: 0 });
      expect(await saved.collections(bob)).toEqual([]);
      expect(await saved.recent(bob, 20)).toEqual([]);
      expect(await saved.counts(bob)).toEqual({ bookmarks: 0, notes: 0, collections: 0 });
      expect(await history.reading(bob, 0)).toEqual({ items: [], total: 0, offset: 0 });
      expect(await history.watching(bob, 0)).toEqual({ items: [], total: 0, offset: 0 });
      expect(await history.quranProgress(bob)).toBeNull();
      expect(await notifications.notifications(bob, 0)).toEqual({
        items: [],
        total: 0,
        offset: 0,
      });
      expect(await notifications.unread(bob)).toBe(0);
      expect(await notifications.preferences(bob)).toEqual([]);
      const state = await saved.targetState(bob, noted);
      expect(state).toEqual({ bookmarked: false, note: null, collections: [] });
    });

    it('answers Alice’s collection id to Bob exactly as it answers a missing id', async () => {
      const missing = randomUUID();
      expect(await saved.collection(bob, a.collection)).toBeNull();
      expect(await saved.collection(bob, missing)).toBeNull();

      const attempts = (collectionId: string) => [
        saved.updateCollection(bob, {
          collectionId,
          title: sentinel('BOB_RENAME', 1),
          description: null,
          expectedVersion: 2,
        }),
        saved.addToCollection(
          bob,
          { collectionId, target: article(nextArticle()), expectedVersion: 2 },
          randomUUID(),
        ),
        saved.removeFromCollection(bob, {
          collectionId,
          target: noted,
          expectedVersion: 2,
        }),
        saved.reorderCollection(bob, {
          collectionId,
          savedItemIds: [aliceItem],
          expectedVersion: 2,
        }),
        saved.removeCollection(bob, { collectionId, expectedVersion: 2 }),
      ];
      const onAlice = await Promise.all(attempts(a.collection).map(reasonOf));
      const onMissing = await Promise.all(attempts(missing).map(reasonOf));
      expect(onAlice).toEqual([
        'not-found',
        'not-found',
        'not-found',
        'not-found',
        'not-found',
      ]);
      expect(onAlice).toEqual(onMissing);

      // Nothing of Alice's moved, and Bob was left holding nothing.
      const after = await saved.collection(alice, a.collection);
      expect(after).toMatchObject({ title: sentinel('ALICE_COLLECTION', 1), version: 2 });
      expect(after?.members.map((member) => member.savedItemId)).toEqual([aliceItem]);
      expect(await ownedRows(db.admin, bob)).toBe(0);
    });

    it('never lets Bob edit, remove or unbookmark Alice’s note or bookmark', async () => {
      const untouched = article(nextArticle());
      expect(
        await reasonOf(saved.removeNote(bob, { target: noted, expectedVersion: 1 })),
      ).toBe(
        await reasonOf(saved.removeNote(bob, { target: untouched, expectedVersion: 1 })),
      );
      expect(
        await reasonOf(
          saved.writeNote(
            bob,
            { target: noted, body: sentinel('BOB_NOTE', 1), expectedVersion: 1 },
            randomUUID(),
          ),
        ),
      ).toBe(
        await reasonOf(
          saved.writeNote(
            bob,
            { target: untouched, body: sentinel('BOB_NOTE', 2), expectedVersion: 1 },
            randomUUID(),
          ),
        ),
      );
      await saved.unbookmark(bob, noted);
      const state = await saved.targetState(alice, noted);
      expect(state.bookmarked).toBe(true);
      expect(state.note).toEqual({ body: sentinel('ALICE_NOTE', 1), version: 1 });
      expect(await ownedRows(db.admin, bob)).toBe(0);
    });

    it('never lets Bob remove Alice’s history, progress or settings', async () => {
      await history.removeRead(bob, { kind: 'article', id: a.article });
      await history.removeWatch(bob, videoId);
      await history.clear(bob);
      expect((await history.reading(alice, 0)).total).toBe(1);
      expect((await history.watching(alice, 0)).total).toBe(1);

      expect(await reasonOf(history.clearQuranProgress(bob, 1))).toBe('conflict');
      expect(await history.quranProgress(alice)).toMatchObject({ version: 1 });

      // Bob has no settings row: Alice's version is not his.
      expect(
        await reasonOf(
          settings.setHistory(bob, { enabled: false, expectedVersion: 2 }, new Date()),
        ),
      ).toBe('conflict');
      expect(await settings.settings(bob)).toEqual({
        onboarding: null,
        interests: [],
        goals: [],
        historyEnabled: false,
        version: 0,
      });
      expect(await settings.settings(alice)).toMatchObject({
        onboarding: 'completed',
        interests: ['quran', 'hadith'],
        historyEnabled: true,
        version: 2,
      });
    });

    it('never lets Bob read, mark or remove Alice’s notification', async () => {
      await notifications.markRead(bob, a.notification, new Date());
      expect(await notifications.markAllRead(bob, new Date())).toBe(0);
      await notifications.remove(bob, a.notification);
      expect(await notifications.clearRead(bob)).toBe(0);
      expect(await notifications.unread(alice)).toBe(1);
      expect((await notifications.notifications(alice, 0)).items[0]?.id).toBe(
        a.notification,
      );
    });

    it('exports none of Alice’s data in Bob’s export', async () => {
      const own = JSON.stringify(await accountService.export({ accountId: alice }));
      expect(own).toContain(sentinel('ALICE_NOTE', 1));
      expect(own).toContain(sentinel('ALICE_COLLECTION', 1));
      expect(own).toContain(a.article);

      const theirs = await accountService.export({ accountId: bob });
      const text = JSON.stringify(theirs);
      for (const value of [
        sentinel('ALICE_NOTE', 1),
        sentinel('ALICE_COLLECTION', 1),
        a.article,
      ])
        expect(text).not.toContain(value);
      expect(theirs).toMatchObject({
        bookmarks: [],
        notes: [],
        collections: [],
        readingHistory: [],
        watchHistory: [],
        quranProgress: null,
        notifications: [],
      });
      expect(theirs).not.toHaveProperty('newsletter');
    });
  });

  /* ======================================================================
   * Typed integrity
   * ==================================================================== */

  describe('a saved target is one typed foreign key', () => {
    let owner: string;

    beforeAll(async () => {
      owner = await account(db.admin);
    });

    it('has no type, kind or generic target column in any target-holding table', async () => {
      const columns = await db.admin.query<{ table: string; column: string }>(`
        SELECT TABLE_NAME AS [table], COLUMN_NAME AS [column] FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME IN (N'SavedItem', N'Bookmark', N'Note', N'PrivateCollectionItem',
                             N'ReadingHistory', N'WatchHistory', N'QuranReadingProgress');`);
      expect(columns.length).toBeGreaterThan(20);
      for (const { table, column } of columns)
        expect(`${table}.${column}`).not.toMatch(/type|kind|targetId|target_id/iu);
    });

    it('infers the kind from the one foreign key that holds a value', async () => {
      const rows = [
        [randomUUID(), `[workId]`, `N'${workId}'`],
        [randomUUID(), `[videoId]`, `N'${videoId}'`],
      ] as const;
      for (const [id, column, value] of rows)
        await db.admin.query(
          `INSERT INTO [dbo].[SavedItem] ([id],[userId],${column},[createdAt]) VALUES (${n(id)}, ${n(owner)}, ${value}, SYSUTCDATETIME());`,
        );
      await saved.bookmark(owner, ayah(3), randomUUID());
      const recent = await saved.recent(owner, 20);
      expect(recent.map((entry) => entry.target)).toEqual(
        expect.arrayContaining([
          { kind: 'work', id: workId },
          { kind: 'video', id: videoId },
          { kind: 'ayah', surah: 1, ayah: 3 },
        ]),
      );
    });

    it('refuses a row with two kinds, none, or half an Ayah', async () => {
      // A fresh account, so no per-account unique index can refuse first.
      const holder = await account(db.admin);
      const insert = (columns: string, values: string) =>
        db.admin.query(
          `INSERT INTO [dbo].[SavedItem] ([id],[userId]${columns},[createdAt]) VALUES (${n(randomUUID())}, ${n(holder)}${values}, SYSUTCDATETIME());`,
        );
      expect(
        await sqlNumber(
          insert(',[articleId],[workId]', `, ${n(nextArticle())}, ${n(workId)}`),
        ),
      ).toBe(547);
      expect(
        await sqlNumber(
          insert(',[videoId],[surahNumber],[ayahNumber]', `, ${n(videoId)}, 1, 1`),
        ),
      ).toBe(547);
      expect(await sqlNumber(insert(',[surahNumber]', ', 1'))).toBe(547);
      expect(await sqlNumber(insert(',[ayahNumber]', ', 1'))).toBe(547);
      expect(await sqlNumber(insert('', ''))).toBe(547);
      expect(await count(db.admin, 'SavedItem', `[userId] = ${n(holder)}`)).toBe(0);
    });

    it('refuses a target that does not exist, by its foreign key', async () => {
      for (const target of [
        article(randomUUID()),
        { kind: 'work', id: randomUUID() },
        { kind: 'video', id: randomUUID() },
        { kind: 'hadith', id: randomUUID() },
        { kind: 'ayah', surah: 1, ayah: AYAT + 1 },
        { kind: 'ayah', surah: 2, ayah: 1 },
      ] satisfies PersonalTarget[])
        expect(
          await reasonOf(saved.bookmark(owner, target, randomUUID())),
          JSON.stringify(target),
        ).toBe('invalid');
    });

    it('turns concurrent bookmarks of one target into ONE anchor and ONE bookmark', async () => {
      const target = article(nextArticle());
      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () => saved.bookmark(owner, target, randomUUID())),
      );
      expect(results.map((result) => result.status)).toEqual(Array(6).fill('fulfilled'));
      const where = `[userId] = ${n(owner)} AND [articleId] = ${n(target.kind === 'article' ? target.id : '')}`;
      expect(await count(db.admin, 'SavedItem', where)).toBe(1);
      expect(
        await count(
          db.admin,
          'Bookmark',
          `[savedItemId] IN (SELECT [id] FROM [dbo].[SavedItem] WHERE ${where})`,
        ),
      ).toBe(1);
    });

    it('lets two accounts save the same target, each holding their own anchor', async () => {
      const other = await account(db.admin);
      const id = nextArticle();
      await saved.bookmark(owner, article(id), randomUUID());
      await saved.bookmark(other, article(id), randomUUID());
      expect(await count(db.admin, 'SavedItem', `[articleId] = ${n(id)}`)).toBe(2);
      await saved.unbookmark(other, article(id));
      expect(await count(db.admin, 'SavedItem', `[articleId] = ${n(id)}`)).toBe(1);
      expect((await saved.targetState(owner, article(id))).bookmarked).toBe(true);
    });

    it('keeps an anchor while anything holds it and removes it with the last', async () => {
      const id = nextArticle();
      const target = article(id);
      const anchors = () =>
        count(db.admin, 'SavedItem', `[userId] = ${n(owner)} AND [articleId] = ${n(id)}`);

      await saved.bookmark(owner, target, randomUUID());
      await saved.writeNote(
        owner,
        { target, body: sentinel('ANCHOR_NOTE', 1), expectedVersion: 0 },
        randomUUID(),
      );
      expect(await anchors()).toBe(1);
      await saved.unbookmark(owner, target);
      expect(await anchors()).toBe(1);
      await saved.removeNote(owner, { target, expectedVersion: 1 });
      expect(await anchors()).toBe(0);

      const collectionId = randomUUID();
      await saved.createCollection(owner, collectionId, {
        title: sentinel('ANCHOR_COLLECTION', 1),
        description: null,
      });
      await saved.addToCollection(
        owner,
        { collectionId, target, expectedVersion: 1 },
        randomUUID(),
      );
      await saved.bookmark(owner, target, randomUUID());
      await saved.removeFromCollection(owner, {
        collectionId,
        target,
        expectedVersion: 2,
      });
      expect(await anchors()).toBe(1);
      await saved.unbookmark(owner, target);
      expect(await anchors()).toBe(0);

      await saved.addToCollection(
        owner,
        { collectionId, target, expectedVersion: 3 },
        randomUUID(),
      );
      expect(await anchors()).toBe(1);
      await saved.removeCollection(owner, { collectionId, expectedVersion: 4 });
      expect(await anchors()).toBe(0);
    });
  });

  /* ======================================================================
   * Private collections
   * ==================================================================== */

  describe('private collections are bounded, versioned and contiguous', () => {
    let owner: string;

    beforeAll(async () => {
      owner = await account(db.admin);
    });

    /** Seeds members directly — SavedItems and positions — as the owner. */
    async function seedMembers(collectionId: string, positions: readonly number[]) {
      for (const position of positions) {
        const item = randomUUID();
        await db.admin.query(`
          INSERT INTO [dbo].[SavedItem] ([id],[userId],[articleId],[createdAt])
          VALUES (${n(item)}, ${n(owner)}, ${n(nextArticle())}, SYSUTCDATETIME());
          INSERT INTO [dbo].[PrivateCollectionItem] ([collectionId],[savedItemId],[userId],[position],[addedAt])
          VALUES (${n(collectionId)}, ${n(item)}, ${n(owner)}, ${position}, SYSUTCDATETIME());`);
      }
    }

    async function positions(collectionId: string): Promise<number[]> {
      const rows = await db.admin.query<{ position: number }>(
        `SELECT [position] FROM [dbo].[PrivateCollectionItem] WHERE [collectionId] = ${n(collectionId)} ORDER BY [position];`,
      );
      return rows.map((row) => Number(row.position));
    }

    it(`refuses a collection beyond ${PERSONAL_LIMITS.collections}`, async () => {
      const bounded = await account(db.admin);
      for (let index = 0; index < PERSONAL_LIMITS.collections; index += 1)
        await saved.createCollection(bounded, randomUUID(), {
          title: sentinel('BOUND_COLLECTION', index),
          description: null,
        });
      expect(
        await reasonOf(
          saved.createCollection(bounded, randomUUID(), {
            title: sentinel('BOUND_COLLECTION', 'over'),
            description: null,
          }),
        ),
      ).toBe('limit');
      expect(await count(db.admin, 'PrivateCollection', `[userId] = ${n(bounded)}`)).toBe(
        PERSONAL_LIMITS.collections,
      );
    });

    it(`refuses a member beyond ${PERSONAL_LIMITS.collectionMembers}, leaving no anchor behind`, async () => {
      const collectionId = randomUUID();
      await saved.createCollection(owner, collectionId, {
        title: sentinel('FULL_COLLECTION', 1),
        description: null,
      });
      await seedMembers(
        collectionId,
        Array.from({ length: PERSONAL_LIMITS.collectionMembers }, (_, index) => index),
      );
      const before = await count(db.admin, 'SavedItem', `[userId] = ${n(owner)}`);
      expect(
        await reasonOf(
          saved.addToCollection(
            owner,
            { collectionId, target: article(nextArticle()), expectedVersion: 1 },
            randomUUID(),
          ),
        ),
      ).toBe('limit');
      expect(await count(db.admin, 'SavedItem', `[userId] = ${n(owner)}`)).toBe(before);
    });

    it('closes gaps before appending at the last position', async () => {
      const collectionId = randomUUID();
      await saved.createCollection(owner, collectionId, {
        title: sentinel('GAPPED_COLLECTION', 1),
        description: null,
      });
      await seedMembers(collectionId, [0, 100, PERSONAL_LIMITS.collectionMembers - 1]);
      await saved.addToCollection(
        owner,
        { collectionId, target: article(nextArticle()), expectedVersion: 1 },
        randomUUID(),
      );
      expect(await positions(collectionId)).toEqual([0, 1, 2, 3]);
    });

    it('adds idempotently, spending no version on a member already held', async () => {
      const collectionId = randomUUID();
      await saved.createCollection(owner, collectionId, {
        title: sentinel('IDEMPOTENT_COLLECTION', 1),
        description: null,
      });
      const target = article(nextArticle());
      const first = await saved.addToCollection(
        owner,
        { collectionId, target, expectedVersion: 1 },
        randomUUID(),
      );
      const second = await saved.addToCollection(
        owner,
        { collectionId, target, expectedVersion: first.version },
        randomUUID(),
      );
      expect(first.version).toBe(2);
      expect(second.version).toBe(2);
      expect(await positions(collectionId)).toEqual([0]);
    });

    it('reorders only under the version read, exactly the current members, one winner', async () => {
      const collectionId = randomUUID();
      await saved.createCollection(owner, collectionId, {
        title: sentinel('ORDERED_COLLECTION', 1),
        description: null,
      });
      let version = 1;
      for (let index = 0; index < 4; index += 1)
        version = (
          await saved.addToCollection(
            owner,
            { collectionId, target: article(nextArticle()), expectedVersion: version },
            randomUUID(),
          )
        ).version;
      const members = (await saved.collection(owner, collectionId))!.members.map(
        (member) => member.savedItemId,
      );
      const reversed = [...members].reverse();

      expect(
        await reasonOf(
          saved.reorderCollection(owner, {
            collectionId,
            savedItemIds: reversed,
            expectedVersion: version - 1,
          }),
        ),
      ).toBe('conflict');
      expect(
        await reasonOf(
          saved.reorderCollection(owner, {
            collectionId,
            savedItemIds: reversed.slice(1),
            expectedVersion: version,
          }),
        ),
      ).toBe('conflict');
      expect(
        await reasonOf(
          saved.reorderCollection(owner, {
            collectionId,
            savedItemIds: [...reversed.slice(1), randomUUID()],
            expectedVersion: version,
          }),
        ),
      ).toBe('conflict');

      const raced = await Promise.all([
        reasonOf(
          saved.reorderCollection(owner, {
            collectionId,
            savedItemIds: reversed,
            expectedVersion: version,
          }),
        ),
        reasonOf(
          saved.reorderCollection(owner, {
            collectionId,
            savedItemIds: [members[1]!, members[0]!, members[2]!, members[3]!],
            expectedVersion: version,
          }),
        ),
      ]);
      expect([...raced].sort()).toEqual(['accepted', 'conflict']);
      const after = await saved.collection(owner, collectionId);
      expect(after?.version).toBe(version + 1);
      expect(after?.members.map((member) => member.savedItemId)).toEqual(
        raced[0] === 'accepted'
          ? reversed
          : [members[1], members[0], members[2], members[3]],
      );
      expect(await positions(collectionId)).toEqual([0, 1, 2, 3]);
    });

    it('keeps positions contiguous after removals', async () => {
      const collectionId = randomUUID();
      await saved.createCollection(owner, collectionId, {
        title: sentinel('REMOVAL_COLLECTION', 1),
        description: null,
      });
      const targets = [nextArticle(), nextArticle(), nextArticle(), nextArticle()].map(
        article,
      );
      let version = 1;
      for (const target of targets)
        version = (
          await saved.addToCollection(
            owner,
            { collectionId, target, expectedVersion: version },
            randomUUID(),
          )
        ).version;
      version = (
        await saved.removeFromCollection(owner, {
          collectionId,
          target: targets[1]!,
          expectedVersion: version,
        })
      ).version;
      expect(await positions(collectionId)).toEqual([0, 1, 2]);
      await saved.removeFromCollection(owner, {
        collectionId,
        target: targets[0]!,
        expectedVersion: version,
      });
      expect(await positions(collectionId)).toEqual([0, 1]);
      expect(
        (await saved.collection(owner, collectionId))?.members.map(
          (member) => member.target,
        ),
      ).toEqual([targets[2], targets[3]]);
    });
  });

  /* ======================================================================
   * Notes
   * ==================================================================== */

  describe('a note changes only under the version that was read', () => {
    it('refuses stale writes, a first note claiming a version, and a stale removal', async () => {
      const owner = await account(db.admin);
      const target = article(nextArticle());
      const write = (body: string, expectedVersion: number) =>
        saved.writeNote(owner, { target, body, expectedVersion }, randomUUID());

      expect(await reasonOf(write(sentinel('NOTE', 0), 1))).toBe('conflict');
      expect(await ownedRows(db.admin, owner)).toBe(0);

      expect(await write(sentinel('NOTE', 1), 0)).toEqual({ version: 1 });
      expect(await reasonOf(write(sentinel('NOTE', 2), 0))).toBe('conflict');
      expect(await write(sentinel('NOTE', 2), 1)).toEqual({ version: 2 });
      expect(await reasonOf(write(sentinel('NOTE', 3), 1))).toBe('conflict');
      expect((await saved.targetState(owner, target)).note).toEqual({
        body: sentinel('NOTE', 2),
        version: 2,
      });

      expect(
        await reasonOf(saved.removeNote(owner, { target, expectedVersion: 1 })),
      ).toBe('conflict');
      await saved.removeNote(owner, { target, expectedVersion: 2 });
      expect(
        await reasonOf(saved.removeNote(owner, { target, expectedVersion: 2 })),
      ).toBe('not-found');
      expect(await ownedRows(db.admin, owner)).toBe(0);
    });
  });

  /* ======================================================================
   * History
   * ==================================================================== */

  describe('history is off until turned on, monotonic, one row per target, bounded', () => {
    it('records nothing while off, then once per target, and never moves backwards', async () => {
      const owner = await account(db.admin);
      const id = nextArticle();
      const target = { kind: 'article', id } as const;
      const t1 = new Date('2031-01-01T00:00:00.000Z');
      const t2 = new Date('2031-01-02T00:00:00.000Z');
      const t3 = new Date('2031-01-03T00:00:00.000Z');

      await history.recordRead(owner, target, t2);
      await history.recordWatch(owner, videoId, t2);
      expect(await count(db.admin, 'ReadingHistory', `[userId] = ${n(owner)}`)).toBe(0);
      expect(await count(db.admin, 'WatchHistory', `[userId] = ${n(owner)}`)).toBe(0);

      await settings.setHistory(owner, { enabled: true, expectedVersion: 0 }, new Date());
      await history.recordRead(owner, target, t2);
      await history.recordRead(owner, target, t1);
      await history.recordWatch(owner, videoId, t2);
      await history.recordWatch(owner, videoId, t1);
      expect((await history.reading(owner, 0)).items).toEqual([
        { target, firstReadAt: t2.toISOString(), lastReadAt: t2.toISOString() },
      ]);
      expect((await history.watching(owner, 0)).items).toEqual([
        { videoId, firstWatchedAt: t2.toISOString(), lastWatchedAt: t2.toISOString() },
      ]);

      await history.recordRead(owner, target, t3);
      await history.recordRead(owner, ayah(4), t1);
      const reading = await history.reading(owner, 0);
      expect(reading.total).toBe(2);
      expect(reading.items[0]).toEqual({
        target,
        firstReadAt: t2.toISOString(),
        lastReadAt: t3.toISOString(),
      });
      expect(
        await count(
          db.admin,
          'ReadingHistory',
          `[userId] = ${n(owner)} AND [articleId] = ${n(id)}`,
        ),
      ).toBe(1);

      await settings.setHistory(
        owner,
        { enabled: false, expectedVersion: 1 },
        new Date(),
      );
      await history.recordRead(owner, article(nextArticle()), t3);
      await history.recordRead(owner, target, new Date('2032-01-01T00:00:00.000Z'));
      expect((await history.reading(owner, 0)).items[0]?.lastReadAt).toBe(
        t3.toISOString(),
      );
      expect(await count(db.admin, 'ReadingHistory', `[userId] = ${n(owner)}`)).toBe(2);
    });

    it(`keeps only the newest ${PERSONAL_LIMITS.history} reads`, async () => {
      const owner = await account(db.admin);
      await settings.setHistory(owner, { enabled: true, expectedVersion: 0 }, new Date());
      const seeded = Array.from({ length: PERSONAL_LIMITS.history }, () => nextArticle());
      for (let start = 0; start < seeded.length; start += 100)
        await db.admin.query(`
          INSERT INTO [dbo].[ReadingHistory] ([id],[userId],[articleId],[firstReadAt],[lastReadAt])
          VALUES ${seeded
            .slice(start, start + 100)
            .map(
              (id, offset) =>
                `(${n(randomUUID())}, ${n(owner)}, ${n(id)}, DATEADD(minute, ${start + offset}, '2020-01-01'), DATEADD(minute, ${start + offset}, '2020-01-01'))`,
            )
            .join(',\n')};`);
      const latest = nextArticle();
      await history.recordRead(
        owner,
        article(latest),
        new Date('2031-06-01T00:00:00.000Z'),
      );
      expect(await count(db.admin, 'ReadingHistory', `[userId] = ${n(owner)}`)).toBe(
        PERSONAL_LIMITS.history,
      );
      expect(
        await count(
          db.admin,
          'ReadingHistory',
          `[userId] = ${n(owner)} AND [articleId] = ${n(seeded[0]!)}`,
        ),
      ).toBe(0);
      expect(
        await count(
          db.admin,
          'ReadingHistory',
          `[userId] = ${n(owner)} AND [articleId] = ${n(latest)}`,
        ),
      ).toBe(1);
      expect(
        await count(
          db.admin,
          'ReadingHistory',
          `[userId] = ${n(owner)} AND [articleId] = ${n(seeded[1]!)}`,
        ),
      ).toBe(1);
    });
  });

  /* ======================================================================
   * Quran progress
   * ==================================================================== */

  describe('the Quran position moves only under the version that was read', () => {
    it('needs version 0 to start, refuses stale writes and clears only at the current version', async () => {
      const owner = await account(db.admin);
      const set = (number: number, expectedVersion: number) =>
        history.setQuranProgress(
          owner,
          { surah: 1, ayah: number, expectedVersion },
          new Date(),
        );

      expect(await reasonOf(set(2, 1))).toBe('conflict');
      expect(await set(2, 0)).toEqual({ version: 1 });
      expect(await reasonOf(set(3, 0))).toBe('conflict');
      expect(await set(3, 1)).toEqual({ version: 2 });
      expect(await reasonOf(set(1, 1))).toBe('conflict');
      expect(await history.quranProgress(owner)).toMatchObject({
        surah: 1,
        ayah: 3,
        version: 2,
      });

      // The Ayah foreign key: a position no canonical Ayah has is refused.
      expect(await reasonOf(set(AYAT + 1, 2))).toBe('invalid');

      expect(await reasonOf(history.clearQuranProgress(owner, 1))).toBe('conflict');
      await history.clearQuranProgress(owner, 2);
      expect(await history.quranProgress(owner)).toBeNull();
      expect(await reasonOf(history.clearQuranProgress(owner, 2))).toBe('conflict');
    });
  });

  /* ======================================================================
   * Notifications
   * ==================================================================== */

  describe('a notification is produced once, never when muted, and only to a site path', () => {
    let owner: string;
    const production = (
      idempotencyKey: string,
      destination: string | null = null,
    ): NotificationProduction => ({
      accountId: owner,
      kind: 'question-answered',
      destination,
      idempotencyKey,
    });

    beforeAll(async () => {
      owner = await account(db.admin);
    });

    it('is idempotent on its key, also under concurrency', async () => {
      const keyed = `proof:${randomUUID()}`;
      expect(
        await notifications.produce(production(keyed), randomUUID(), new Date()),
      ).toBe('created');
      expect(
        await notifications.produce(production(keyed), randomUUID(), new Date()),
      ).toBe('duplicate');
      const raced = `proof:${randomUUID()}`;
      const outcomes = await Promise.all(
        Array.from({ length: 6 }, () =>
          notifications.produce(production(raced), randomUUID(), new Date()),
        ),
      );
      expect(outcomes.filter((outcome) => outcome === 'created')).toHaveLength(1);
      expect(outcomes.filter((outcome) => outcome === 'duplicate')).toHaveLength(5);
      expect(
        await count(
          db.admin,
          'Notification',
          `[userId] = ${n(owner)} AND [idempotencyKey] = ${n(raced)}`,
        ),
      ).toBe(1);
    });

    it('stores nothing for a category the account turned off', async () => {
      await notifications.setPreference(
        owner,
        { category: 'questions', channel: 'in-app', enabled: false },
        new Date(),
      );
      const before = await count(db.admin, 'Notification', `[userId] = ${n(owner)}`);
      expect(
        await notifications.produce(
          production(`proof:${randomUUID()}`),
          randomUUID(),
          new Date(),
        ),
      ).toBe('muted');
      expect(await count(db.admin, 'Notification', `[userId] = ${n(owner)}`)).toBe(
        before,
      );
      await notifications.setPreference(
        owner,
        { category: 'questions', channel: 'in-app', enabled: true },
        new Date(),
      );
      expect(
        await notifications.produce(
          production(`proof:${randomUUID()}`),
          randomUUID(),
          new Date(),
        ),
      ).toBe('created');
    });

    it('refuses every destination that is not a plain path on this site, twice over', async () => {
      const hostile = [
        'https://evil.example/x',
        'http:/evil.example',
        '//evil.example/x',
        '/\\evil.example',
        '/my\\questions',
        'javascript:alert(1)',
        'data:text/html,x',
        '/my/../admin',
        '/my/./questions',
        '/my/%2e%2e/admin',
        '/%2F%2Fevil.example',
        '/my//questions',
        '/my/.hidden',
        '/my/questions?next=//evil',
        '/my/questions#x',
        '/user@evil.example',
        'my/questions',
        '/',
        '',
        ` /my/questions`,
        '/my/questions\n',
        `/${'a'.repeat(300)}`,
      ];
      for (const destination of hostile) {
        expect(isInternalDestination(destination), JSON.stringify(destination)).toBe(
          false,
        );
        expect(
          await reasonOf(
            notifications.produce(
              production(`proof:${randomUUID()}`, destination),
              randomUUID(),
              new Date(),
            ),
          ),
          JSON.stringify(destination),
        ).toBe('invalid');
        // The database refuses it on its own, whatever any application layer
        // did: by the CHECK, or — past the column's length — by truncation.
        expect(
          await sqlNumber(
            db.admin.query(`
              INSERT INTO [dbo].[Notification] ([id],[userId],[kind],[category],[destination],[idempotencyKey],[createdAt])
              VALUES (${n(randomUUID())}, ${n(owner)}, N'question-answered', N'questions', ${n(destination)}, ${n(randomUUID())}, SYSUTCDATETIME());`),
          ),
          JSON.stringify(destination),
        ).toBe(destination.length > 300 ? 2628 : 547);
      }
      const own = `/my/questions/${randomUUID()}`;
      expect(isInternalDestination(own)).toBe(true);
      expect(
        await notifications.produce(
          production(`proof:${randomUUID()}`, own),
          randomUUID(),
          new Date(),
        ),
      ).toBe('created');
    });

    it(`keeps only the newest ${PERSONAL_LIMITS.notifications}`, async () => {
      const bounded = await account(db.admin);
      const seeded = Array.from({ length: PERSONAL_LIMITS.notifications }, () =>
        randomUUID(),
      );
      for (let start = 0; start < seeded.length; start += 100)
        await db.admin.query(`
          INSERT INTO [dbo].[Notification] ([id],[userId],[kind],[category],[destination],[idempotencyKey],[createdAt])
          VALUES ${seeded
            .slice(start, start + 100)
            .map(
              (id, offset) =>
                `(${n(id)}, ${n(bounded)}, N'question-declined', N'questions', NULL, ${n(`seed:${id}`)}, DATEADD(minute, ${start + offset}, '2020-01-01'))`,
            )
            .join(',\n')};`);
      expect(
        await notifications.produce(
          {
            accountId: bounded,
            kind: 'question-answered',
            destination: null,
            idempotencyKey: 'proof:newest',
          },
          randomUUID(),
          new Date(),
        ),
      ).toBe('created');
      expect(await count(db.admin, 'Notification', `[userId] = ${n(bounded)}`)).toBe(
        PERSONAL_LIMITS.notifications,
      );
      expect(await count(db.admin, 'Notification', `[id] = ${n(seeded[0]!)}`)).toBe(0);
      expect(await count(db.admin, 'Notification', `[id] = ${n(seeded[1]!)}`)).toBe(1);
    });
  });

  /* ======================================================================
   * Account closure
   * ==================================================================== */

  describe('closure removes every Personalisation row — of a closed account only', () => {
    /** Gives an account something in every owner table. */
    async function populate(owner: string, label: string): Promise<void> {
      const targets = [nextArticle(), nextArticle(), nextArticle()].map(article);
      const collectionId = randomUUID();
      await saved.createCollection(owner, collectionId, {
        title: sentinel(`${label}_COLLECTION`, 1),
        description: sentinel(`${label}_DESCRIPTION`, 1),
      });
      let version = 1;
      for (const target of targets) {
        await saved.bookmark(owner, target, randomUUID());
        await saved.writeNote(
          owner,
          {
            target,
            body: sentinel(`${label}_NOTE`, targets.indexOf(target)),
            expectedVersion: 0,
          },
          randomUUID(),
        );
        version = (
          await saved.addToCollection(
            owner,
            { collectionId, target, expectedVersion: version },
            randomUUID(),
          )
        ).version;
      }
      await saved.bookmark(owner, ayah(5), randomUUID());
      await settings.saveOnboarding(
        owner,
        {
          interests: ['library', 'watch'],
          goals: ['follow-lectures'],
          expectedVersion: 0,
        },
        'completed',
        new Date(),
      );
      await settings.setHistory(owner, { enabled: true, expectedVersion: 1 }, new Date());
      for (const target of targets) await history.recordRead(owner, target, new Date());
      await history.recordWatch(owner, videoId, new Date());
      await history.setQuranProgress(
        owner,
        { surah: 1, ayah: 6, expectedVersion: 0 },
        new Date(),
      );
      await notifications.setPreference(
        owner,
        { category: 'questions', channel: 'in-app', enabled: true },
        new Date(),
      );
      for (let index = 0; index < 3; index += 1)
        await notifications.produce(
          {
            accountId: owner,
            kind: 'question-declined',
            destination: null,
            idempotencyKey: `proof:${label}:${index}`,
          },
          randomUUID(),
          new Date(),
        );
    }

    it('refuses an ACTIVE account and touches nothing', async () => {
      const owner = await account(db.admin);
      await populate(owner, 'ACTIVE');
      const before = await ownedRows(db.admin, owner);
      expect(before).toBeGreaterThan(20);
      expect(await reasonOf(accountService.disposeAccount(owner))).toBe('denied');
      expect(
        personalFailure(
          await accountService.disposeAccount(owner).catch((e: unknown) => e),
        ),
      ).toBe('denied');
      expect(await ownedRows(db.admin, owner)).toBe(before);
    });

    it('removes everything of a CLOSED account, and again finds nothing', async () => {
      const owner = await account(db.admin);
      await populate(owner, 'CLOSED');
      await closeAccount(db.admin, owner, tombstone(owner));
      const progress = await accountService.disposeAccount(owner);
      expect(progress.complete).toBe(true);
      expect(progress.removed).toBeGreaterThan(0);
      expect(await ownedRows(db.admin, owner)).toBe(0);
      expect(await accountService.disposeAccount(owner)).toEqual({
        removed: 0,
        complete: true,
      });
    });

    it('converges batch by batch after any interruption, then stays done', async () => {
      const owner = await account(db.admin);
      await populate(owner, 'INTERRUPTED');
      await closeAccount(db.admin, owner, tombstone(owner));
      let remaining = await ownedRows(db.admin, owner);
      let rounds = 0;
      for (;;) {
        const removed = await disposition.disposeAccount(owner, 1);
        rounds += 1;
        const now = await ownedRows(db.admin, owner);
        if (removed === 0) break;
        expect(now).toBeLessThan(remaining);
        remaining = now;
        expect(rounds).toBeLessThan(200);
      }
      expect(rounds).toBeGreaterThan(2);
      expect(await ownedRows(db.admin, owner)).toBe(0);
      expect(await disposition.disposeAccount(owner, 1)).toBe(0);
      expect(await disposition.disposeAccount(owner, 1_000)).toBe(0);
    });

    it('finishes a closure an interruption left part-done, and no live account’s', async () => {
      const left = await account(db.admin);
      const living = await account(db.admin);
      await populate(left, 'LEFT');
      await populate(living, 'LIVING');
      await closeAccount(db.admin, left, tombstone(left));
      const livingBefore = await ownedRows(db.admin, living);

      expect((await disposition.accountsWithData(null, 1_000)).includes(left)).toBe(true);
      const sweep = await accountService.reconcileClosedAccounts();
      expect(sweep.complete).toBe(true);
      expect(sweep.removed).toBeGreaterThan(0);
      expect(await ownedRows(db.admin, left)).toBe(0);
      expect(await ownedRows(db.admin, living)).toBe(livingBefore);
      expect((await disposition.accountsWithData(null, 1_000)).includes(left)).toBe(
        false,
      );
    });

    it('leaves a newsletter subscription with the same address alone, and a new account sees nothing old', async () => {
      const owner = await account(db.admin);
      const address = await emailOf(db.admin, owner);
      await populate(owner, 'REREGISTERED');
      await newsletter.submit({ email: address, locale: 'en' }, 'client-closure');
      const links = await linksFor(address);
      expect(await newsletter.confirm(links.confirm, 'client-closure')).toBe('confirmed');

      await closeAccount(db.admin, owner, tombstone(owner));
      expect((await accountService.disposeAccount(owner)).complete).toBe(true);
      expect(await ownedRows(db.admin, owner)).toBe(0);
      expect(await subscriberOf(address)).toMatchObject({
        state: 'confirmed',
        email: address,
      });

      const successor = await accountWithEmail(db.admin, address);
      expect(await ownedRows(db.admin, successor)).toBe(0);
      expect(await saved.bookmarks(successor, 0)).toEqual({
        items: [],
        total: 0,
        offset: 0,
      });
      expect(await saved.collections(successor)).toEqual([]);
      expect(await history.quranProgress(successor)).toBeNull();
      expect(await notifications.unread(successor)).toBe(0);
      const exported = JSON.stringify(
        await accountService.export({ accountId: successor }),
      );
      expect(exported).not.toContain('REREGISTERED');
      expect(exported).not.toContain(address);
    });
  });

  /* ======================================================================
   * Content hard purge — DOMAIN_MODEL.md §14.3
   * ==================================================================== */

  describe('a content hard purge waits for the typed release, which is bounded and resumable', () => {
    it('refuses the physical delete until every reference is released, then permits it', async () => {
      const purged = nextArticle();
      const target = article(purged);
      const owners = [await account(db.admin), await account(db.admin)];
      const collections: string[] = [];
      for (const owner of owners) {
        const collectionId = randomUUID();
        collections.push(collectionId);
        await saved.createCollection(owner, collectionId, {
          title: sentinel('PURGE_COLLECTION', owners.indexOf(owner)),
          description: null,
        });
        // A neighbour that stays, so the collection outlives the purge.
        await saved.addToCollection(
          owner,
          { collectionId, target: article(nextArticle()), expectedVersion: 1 },
          randomUUID(),
        );
        await saved.bookmark(owner, target, randomUUID());
        await saved.writeNote(
          owner,
          {
            target,
            body: sentinel('PURGE_NOTE', owners.indexOf(owner)),
            expectedVersion: 0,
          },
          randomUUID(),
        );
        await saved.addToCollection(
          owner,
          { collectionId, target, expectedVersion: 2 },
          randomUUID(),
        );
        await settings.setHistory(
          owner,
          { enabled: true, expectedVersion: 0 },
          new Date(),
        );
        await history.recordRead(owner, target, new Date());
      }
      const versionsBefore = await Promise.all(
        owners.map(
          async (owner, index) =>
            (await saved.collection(owner, collections[index]!))!.version,
        ),
      );

      const references = async () =>
        (await count(db.admin, 'SavedItem', `[articleId] = ${n(purged)}`)) +
        (await count(db.admin, 'ReadingHistory', `[articleId] = ${n(purged)}`));
      expect(await references()).toBe(4);

      // The owner's physical delete is refused by the typed key.
      const remove = () =>
        db.admin.query(`DELETE FROM [dbo].[Article] WHERE [id] = ${n(purged)};`);
      expect(await sqlNumber(remove())).toBe(547);

      // Archival first: the key stays valid, nothing dangles.
      await db.admin.query(
        `UPDATE [dbo].[Article] SET [state] = N'archived' WHERE [id] = ${n(purged)};`,
      );
      expect((await saved.targetState(owners[0]!, target)).bookmarked).toBe(true);

      // A SMALL batch, as an interrupted run would leave it, then resumed.
      let remaining = await references();
      let rounds = 0;
      for (;;) {
        const left = await purge.releaseArticle(purged, 1);
        rounds += 1;
        expect(left).toBe(await references());
        expect(left).toBeLessThan(remaining);
        remaining = left;
        if (left === 0) break;
        expect(rounds).toBeLessThan(20);
      }
      expect(rounds).toBeGreaterThan(1);
      expect(await purge.releaseArticle(purged, 1)).toBe(0);

      await remove();
      expect(await count(db.admin, 'Article', `[id] = ${n(purged)}`)).toBe(0);
      expect(
        await count(
          db.admin,
          'Note',
          `[savedItemId] NOT IN (SELECT [id] FROM [dbo].[SavedItem])`,
        ),
      ).toBe(0);
      expect(
        await count(
          db.admin,
          'Bookmark',
          `[savedItemId] NOT IN (SELECT [id] FROM [dbo].[SavedItem])`,
        ),
      ).toBe(0);

      for (const [index, owner] of owners.entries()) {
        const detail = await saved.collection(owner, collections[index]!);
        expect(detail?.version).toBeGreaterThan(versionsBefore[index]!);
        expect(detail?.members).toHaveLength(1);
        expect((await saved.notes(owner, 0)).total).toBe(0);
        expect((await history.reading(owner, 0)).total).toBe(0);
      }
    });

    it('releases an Ayah from saves, history and the Quran position alike', async () => {
      const owner = await account(db.admin);
      const target = { kind: 'ayah', surah: 1, ayah: 7 } as const;
      await saved.bookmark(owner, target, randomUUID());
      await settings.setHistory(owner, { enabled: true, expectedVersion: 0 }, new Date());
      await history.recordRead(owner, target, new Date());
      await history.setQuranProgress(
        owner,
        { surah: 1, ayah: 7, expectedVersion: 0 },
        new Date(),
      );
      expect(await purge.releaseAyah(target, 1_000)).toBe(0);
      expect(await ownedRows(db.admin, owner)).toBe(1); // the settings row alone
      expect(await history.quranProgress(owner)).toBeNull();
    });
  });

  /* ======================================================================
   * Newsletter
   * ==================================================================== */

  const fresh = (tag: string) =>
    `non-personal-fixture-${tag}-${randomUUID().slice(0, 8)}@newsletter-proof.invalid`;

  function record(delivery: {
    sourceReference: string;
    idempotencyKey: string;
  }): DeliveryRecord {
    return {
      id: randomUUID(),
      purpose: 'newsletter.confirmation',
      sourceReference: delivery.sourceReference,
      idempotencyKey: delivery.idempotencyKey,
      status: 'pending',
      attemptCount: 0,
    };
  }

  /**
   * The links the LATEST issuance to an address carries — by generation, not
   * by enqueue order, which concurrent submissions do not preserve.
   */
  async function linksFor(email: string) {
    const generation = (entry: { sourceReference: string }) =>
      Number(/:(\d+)$/u.exec(entry.sourceReference)?.[1] ?? 0);
    const delivery = deliveries
      .filter((entry) => entry.recipient === email)
      .sort((left, right) => generation(right) - generation(left))[0];
    if (delivery === undefined) throw new Error('no confirmation was owed');
    const resolution = await newsletter.resolveDelivery(record(delivery));
    if (resolution.outcome !== 'send')
      throw new Error('the confirmation is no longer owed');
    const text = resolution.message.text;
    const confirm = /\/newsletter\/confirm\?token=([\w-]{43})(?:\s|$)/u.exec(text)?.[1];
    const unsubscribe = /\/newsletter\/unsubscribe\?token=([\w-]{43})(?:\s|$)/u.exec(
      text,
    )?.[1];
    if (confirm === undefined || unsubscribe === undefined)
      throw new Error('links missing');
    return { confirm, unsubscribe, delivery, message: resolution.message };
  }

  async function subscriberOf(email: string) {
    const [row] = await db.admin.query<Record<string, unknown>>(
      `SELECT * FROM [dbo].[NewsletterSubscriber] WHERE [emailDigest] = ${n(digestOf(email))};`,
    );
    return row;
  }

  async function events(subscriberId: string) {
    return db.admin.query<{
      event: string;
      purpose: string;
      noticeVersion: string;
      source: string;
      locale: string | null;
    }>(
      `SELECT [event],[purpose],[noticeVersion],[source],[locale] FROM [dbo].[NewsletterConsentEvent]
       WHERE [subscriberId] = ${n(subscriberId)} ORDER BY [occurredAt], [event];`,
    );
  }

  describe('the newsletter is double opt-in consent from an address', () => {
    it('submits without confirming anything, and confirms exactly once', async () => {
      const email = fresh('once');
      expect(
        await newsletter.submit({ email, locale: 'ur' }, 'client-a'),
      ).toBeUndefined();
      const pending = await subscriberOf(email);
      expect(pending).toMatchObject({
        state: 'pending',
        email,
        confirmedAt: null,
        locale: 'ur',
      });

      const links = await linksFor(email);
      expect(await linkReader.linkStatus('confirm', links.confirm)).toBe('valid');
      expect(await linkReader.linkStatus('unsubscribe', links.unsubscribe)).toBe('valid');
      // Purpose-bound: neither link answers for the other.
      expect(await linkReader.linkStatus('unsubscribe', links.confirm)).toBe('invalid');
      expect(await linkReader.linkStatus('confirm', links.unsubscribe)).toBe('invalid');
      expect(await newsletter.unsubscribe(links.confirm, 'client-a')).toBe('invalid');

      expect(await newsletter.confirm(links.confirm, 'client-a')).toBe('confirmed');
      expect(await newsletter.confirm(links.confirm, 'client-a')).toBe('invalid');
      expect(await linkReader.linkStatus('confirm', links.confirm)).toBe('invalid');
      expect(await subscriberOf(email)).toMatchObject({ state: 'confirmed', email });

      const id = String(pending!['id']);
      const recorded = await events(id);
      expect(recorded.map((row) => row.event)).toEqual(['submitted', 'confirmed']);
      for (const row of recorded)
        expect(row).toMatchObject({
          purpose: NEWSLETTER_PURPOSE,
          noticeVersion: NEWSLETTER_NOTICE_VERSION,
        });
      expect(recorded.map((row) => row.source)).toEqual([
        'newsletter-page',
        'email-link',
      ]);
      expect(recorded.map((row) => row.locale)).toEqual(['ur', 'ur']);
    });

    it('answers every submission the same, whatever the address’s state, one row per address', async () => {
      const operator = await account(db.admin);
      grants.set(operator, ['newsletter.read', 'newsletter.operate']);
      const states = {
        fresh: fresh('state-new'),
        pending: fresh('state-pending'),
        confirmed: fresh('state-confirmed'),
        unsubscribed: fresh('state-unsubscribed'),
        suppressed: fresh('state-suppressed'),
      };
      await newsletter.submit({ email: states.pending, locale: 'en' }, 'client-b');
      await newsletter.submit({ email: states.confirmed, locale: 'en' }, 'client-b');
      await newsletter.confirm((await linksFor(states.confirmed)).confirm, 'client-b');
      await newsletter.submit({ email: states.unsubscribed, locale: 'en' }, 'client-b');
      await newsletter.unsubscribe(
        (await linksFor(states.unsubscribed)).unsubscribe,
        'client-b',
      );
      await newsletter.submit({ email: states.suppressed, locale: 'en' }, 'client-b');
      const toSuppress = await subscriberOf(states.suppressed);
      await newsletter.suppress(
        { accountId: operator },
        {
          subscriberId: String(toSuppress!['id']),
          expectedVersion: Number(toSuppress!['version']),
        },
      );

      const answers = await Promise.all(
        Object.values(states).map((email) =>
          newsletter.submit({ email, locale: 'en' }, 'client-b').then(
            (value) => ({ settled: 'fulfilled', value }),
            (error: unknown) => ({ settled: 'rejected', value: personalFailure(error) }),
          ),
        ),
      );
      expect(answers).toEqual(Array(5).fill({ settled: 'fulfilled', value: undefined }));
      for (const email of Object.values(states))
        expect(
          await count(
            db.admin,
            'NewsletterSubscriber',
            `[emailDigest] = ${n(digestOf(email))}`,
          ),
        ).toBe(1);

      expect(await subscriberOf(states.confirmed)).toMatchObject({ state: 'confirmed' });
      expect(await subscriberOf(states.suppressed)).toMatchObject({
        state: 'suppressed',
        email: null,
      });
      // An unsubscribed address that comes back must confirm again.
      expect(await subscriberOf(states.unsubscribed)).toMatchObject({ state: 'pending' });
    });

    it('serialises concurrent first submissions of one address into ONE subscriber', async () => {
      const email = fresh('concurrent');
      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          newsletter.submit({ email, locale: 'ar' }, 'client-c'),
        ),
      );
      expect(results.map((result) => result.status)).toEqual(Array(5).fill('fulfilled'));
      expect(
        await count(
          db.admin,
          'NewsletterSubscriber',
          `[emailDigest] = ${n(digestOf(email))}`,
        ),
      ).toBe(1);
      const row = await subscriberOf(email);
      expect(row).toMatchObject({ state: 'pending' });
      // Only the latest issuance is owed; the latest link confirms.
      const links = await linksFor(email);
      expect(await newsletter.confirm(links.confirm, 'client-c')).toBe('confirmed');
    });

    it('refuses an expired link, and the expiry sweep drops the address', async () => {
      const email = fresh('expired');
      await newsletter.submit({ email, locale: 'en' }, 'client-d');
      const links = await linksFor(email);
      await db.admin.query(
        `UPDATE [dbo].[NewsletterSubscriber] SET [confirmExpiresAt] = DATEADD(minute, -1, SYSUTCDATETIME()) WHERE [emailDigest] = ${n(digestOf(email))};`,
      );
      expect(await linkReader.linkStatus('confirm', links.confirm)).toBe('invalid');
      expect(await newsletter.confirm(links.confirm, 'client-d')).toBe('invalid');
      expect(await newsletter.resolveDelivery(record(links.delivery))).toEqual({
        outcome: 'nothing-owed',
      });
      expect(await subscriberOf(email)).toMatchObject({ state: 'pending' });

      expect(await newsletter.expireLapsed()).toBeGreaterThanOrEqual(1);
      const row = await subscriberOf(email);
      expect(row).toMatchObject({
        state: 'expired',
        email: null,
        confirmTokenHash: null,
        unsubscribeTokenHash: null,
      });
      expect((await events(String(row!['id']))).map((event) => event.event)).toEqual([
        'submitted',
        'expired',
      ]);
    });

    it('kills every earlier link when the address is submitted again', async () => {
      const email = fresh('rotated');
      await newsletter.submit({ email, locale: 'en' }, 'client-e');
      const first = await linksFor(email);
      await newsletter.submit({ email, locale: 'en' }, 'client-e');
      const second = await linksFor(email);
      expect(second.confirm).not.toBe(first.confirm);
      expect(await newsletter.resolveDelivery(record(first.delivery))).toEqual({
        outcome: 'nothing-owed',
      });
      expect(await newsletter.confirm(first.confirm, 'client-e')).toBe('invalid');
      expect(await newsletter.unsubscribe(first.unsubscribe, 'client-e')).toBe('invalid');
      expect(await newsletter.confirm(second.confirm, 'client-e')).toBe('confirmed');
      expect(await newsletter.resolveDelivery(record(second.delivery))).toEqual({
        outcome: 'nothing-owed',
      });
    });

    it('re-derives the SAME link for a retried delivery', async () => {
      const email = fresh('retried');
      await newsletter.submit({ email, locale: 'ar' }, 'client-f');
      const delivery = deliveries.findLast((entry) => entry.recipient === email)!;
      const once = await newsletter.resolveDelivery(record(delivery));
      const again = await newsletter.resolveDelivery(record(delivery));
      expect(once.outcome).toBe('send');
      expect(again).toEqual(once);
      if (once.outcome === 'send') {
        expect(once.message.recipient).toBe(email);
        expect(once.message.html).toContain('dir="rtl"');
      }
      expect(
        await newsletter.resolveDelivery(
          record({
            ...delivery,
            sourceReference: delivery.sourceReference.replace(/:\d+$/u, ':99'),
          }),
        ),
      ).toEqual({ outcome: 'nothing-owed' });
      expect(
        await newsletter.resolveDelivery(
          record({ ...delivery, sourceReference: 'newsletter:x:1' }),
        ),
      ).toEqual({ outcome: 'nothing-owed' });
    });

    it('unsubscribes without an account, idempotently, and resubscribing needs a new confirmation', async () => {
      const email = fresh('unsubscribe');
      await newsletter.submit({ email, locale: 'en' }, 'client-g');
      const links = await linksFor(email);
      expect(await newsletter.confirm(links.confirm, 'client-g')).toBe('confirmed');
      expect(await newsletter.unsubscribe(links.unsubscribe, 'client-g')).toBe(
        'unsubscribed',
      );
      expect(await newsletter.unsubscribe(links.unsubscribe, 'client-g')).toBe(
        'unsubscribed',
      );
      const row = await subscriberOf(email);
      expect(row).toMatchObject({ state: 'unsubscribed', email: null });
      const id = String(row!['id']);
      expect(
        (await events(id)).filter((event) => event.event === 'unsubscribed'),
      ).toHaveLength(1);

      await newsletter.submit({ email, locale: 'en' }, 'client-g');
      expect(await subscriberOf(email)).toMatchObject({
        state: 'pending',
        confirmedAt: null,
      });
      expect(await newsletter.confirm(links.confirm, 'client-g')).toBe('invalid');
      expect(await newsletter.unsubscribe(links.unsubscribe, 'client-g')).toBe('invalid');
      expect(await newsletter.confirm((await linksFor(email)).confirm, 'client-g')).toBe(
        'confirmed',
      );
    });

    it('never revives an operator-suppressed address by resubmission or by its old link', async () => {
      const operator = await account(db.admin);
      grants.set(operator, ['newsletter.operate']);
      const email = fresh('suppressed');
      await newsletter.submit({ email, locale: 'en' }, 'client-h');
      const links = await linksFor(email);
      const row = await subscriberOf(email);
      await newsletter.suppress(
        { accountId: operator },
        { subscriberId: String(row!['id']), expectedVersion: Number(row!['version']) },
      );
      const sent = deliveries.length;
      await newsletter.submit({ email, locale: 'en' }, 'client-h');
      expect(deliveries.length).toBe(sent);
      expect(await newsletter.confirm(links.confirm, 'client-h')).toBe('invalid');
      expect(await subscriberOf(email)).toMatchObject({
        state: 'suppressed',
        email: null,
      });
    });

    it('writes nothing to, and confirms nothing for, a provider-suppressed address', async () => {
      const blocked = fresh('provider-blocked');
      providerSuppressed.add(blocked);
      const sent = deliveries.length;
      expect(
        await newsletter.submit({ email: blocked, locale: 'en' }, 'client-i'),
      ).toBeUndefined();
      expect(deliveries.length).toBe(sent);
      expect(await subscriberOf(blocked)).toBeUndefined();

      const later = fresh('provider-later');
      await newsletter.submit({ email: later, locale: 'en' }, 'client-i');
      const links = await linksFor(later);
      providerSuppressed.add(later);
      expect(await newsletter.confirm(links.confirm, 'client-i')).toBe('invalid');
      expect(await subscriberOf(later)).toMatchObject({ state: 'pending' });
    });

    it('resolves a confirm/unsubscribe race to a state consistent with both answers', async () => {
      for (let round = 0; round < 8; round += 1) {
        const email = fresh(`race-${round}`);
        await newsletter.submit({ email, locale: 'en' }, 'client-j');
        const links = await linksFor(email);
        const [confirmed, unsubscribed] = await Promise.all([
          newsletter.confirm(links.confirm, 'client-j'),
          newsletter.unsubscribe(links.unsubscribe, 'client-j'),
        ]);
        // Unsubscribing a pending or confirmed address always succeeds, and
        // nothing can confirm after it: the address ends unsubscribed.
        expect(unsubscribed).toBe('unsubscribed');
        expect(['confirmed', 'invalid']).toContain(confirmed);
        const row = await subscriberOf(email);
        expect(row).toMatchObject({ state: 'unsubscribed', email: null });
        const recorded = (await events(String(row!['id']))).map((event) => event.event);
        expect(recorded.filter((event) => event === 'confirmed')).toHaveLength(
          confirmed === 'confirmed' ? 1 : 0,
        );
        expect(recorded.filter((event) => event === 'unsubscribed')).toHaveLength(1);
      }
    });

    it('never stores a raw token, only 64-hex hashes', async () => {
      const email = fresh('hashes');
      await newsletter.submit({ email, locale: 'en' }, 'client-k');
      const links = await linksFor(email);
      const row = await subscriberOf(email);
      expect(row!['confirmTokenHash']).toBe(sha256(links.confirm));
      expect(row!['unsubscribeTokenHash']).toBe(sha256(links.unsubscribe));

      const everything = JSON.stringify([
        ...(await db.admin.query('SELECT * FROM [dbo].[NewsletterSubscriber];')),
        ...(await db.admin.query('SELECT * FROM [dbo].[NewsletterConsentEvent];')),
        ...(await db.admin.query('SELECT * FROM [dbo].[AuditLog];')),
      ]);
      expect(everything).not.toContain(links.confirm);
      expect(everything).not.toContain(links.unsubscribe);
      const hashes = await db.admin.query<{
        confirmTokenHash: string | null;
        unsubscribeTokenHash: string | null;
      }>(
        'SELECT [confirmTokenHash], [unsubscribeTokenHash] FROM [dbo].[NewsletterSubscriber];',
      );
      expect(hashes.length).toBeGreaterThan(5);
      for (const value of hashes.flatMap((h) => [
        h.confirmTokenHash,
        h.unsubscribeTokenHash,
      ]))
        if (value !== null) expect(value).toMatch(/^[0-9a-f]{64}$/u);
    });

    it('subscribes nobody when an account is created', async () => {
      const before = await count(db.admin, 'NewsletterSubscriber');
      const created = await account(db.admin);
      expect(await count(db.admin, 'NewsletterSubscriber')).toBe(before);
      expect(
        await count(
          db.admin,
          'NewsletterSubscriber',
          `[emailDigest] = ${n(digestOf(await emailOf(db.admin, created)))}`,
        ),
      ).toBe(0);
      const columns = await db.admin.query<{ column: string }>(
        `SELECT COLUMN_NAME AS [column] FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = N'NewsletterSubscriber';`,
      );
      expect(columns.map((row) => row.column)).not.toContain('userId');
    });
  });

  describe('newsletter administration is permissioned, masked and audited', () => {
    it('requires newsletter.read to count and list, and lists masked addresses only', async () => {
      const nobody = await account(db.admin);
      const reader = await account(db.admin);
      grants.set(reader, ['newsletter.read']);
      const email = fresh('masked');
      await newsletter.submit({ email, locale: 'en' }, 'client-l');

      expect(await reasonOf(newsletter.counts({ accountId: nobody }))).toBe('denied');
      expect(await reasonOf(newsletter.list({ accountId: nobody }, null, 0))).toBe(
        'denied',
      );

      const counts = await newsletter.counts({ accountId: reader });
      expect(counts.pending).toBeGreaterThan(0);
      const page = await newsletter.list({ accountId: reader }, 'pending', 0);
      expect(page.items.length).toBeGreaterThan(0);
      const text = JSON.stringify(page);
      expect(text).not.toContain(email);
      expect(text).not.toContain(email.split('@')[0]);
      for (const item of page.items) {
        expect(item.state).toBe('pending');
        expect(item.maskedEmail).toMatch(/^.•••@newsletter-proof\.invalid$/u);
      }
    });

    it('requires newsletter.operate to suppress or reinstate, refuses a stale version and audits without the address', async () => {
      const reader = await account(db.admin);
      const operator = await account(db.admin);
      grants.set(reader, ['newsletter.read']);
      grants.set(operator, ['newsletter.read', 'newsletter.operate']);
      const email = fresh('operated');
      await newsletter.submit({ email, locale: 'en' }, 'client-m');
      const row = await subscriberOf(email);
      const subscriberId = String(row!['id']);
      const version = Number(row!['version']);

      expect(
        await reasonOf(
          newsletter.suppress(
            { accountId: reader },
            { subscriberId, expectedVersion: version },
          ),
        ),
      ).toBe('denied');
      expect(
        await reasonOf(
          newsletter.suppress(
            { accountId: operator },
            { subscriberId, expectedVersion: version + 1 },
          ),
        ),
      ).toBe('conflict');
      expect(
        await reasonOf(
          newsletter.suppress(
            { accountId: operator },
            { subscriberId: randomUUID(), expectedVersion: 1 },
          ),
        ),
      ).toBe('not-found');
      await newsletter.suppress(
        { accountId: operator },
        { subscriberId, expectedVersion: version },
      );
      expect(
        await reasonOf(
          newsletter.suppress(
            { accountId: operator },
            { subscriberId, expectedVersion: version + 1 },
          ),
        ),
      ).toBe('invalid-state');
      expect(
        await reasonOf(
          newsletter.reinstate(
            { accountId: reader },
            { subscriberId, expectedVersion: version + 1 },
          ),
        ),
      ).toBe('denied');
      await newsletter.reinstate(
        { accountId: operator },
        { subscriberId, expectedVersion: version + 1 },
      );
      // Reinstating grants nothing: the address must opt in afresh.
      expect(await subscriberOf(email)).toMatchObject({
        state: 'unsubscribed',
        email: null,
      });

      const audit = await db.admin.query<Record<string, unknown>>(
        `SELECT * FROM [dbo].[AuditLog] WHERE [targetId] = ${n(subscriberId)} ORDER BY [occurredAt];`,
      );
      expect(audit.map((entry) => entry['action'])).toEqual([
        'newsletter.subscriber.suppressed',
        'newsletter.subscriber.reinstated',
      ]);
      expect(audit.map((entry) => entry['actorId'])).toEqual([operator, operator]);
      expect(JSON.stringify(audit)).not.toContain(email);
      expect(JSON.stringify(audit)).not.toContain(digestOf(email));
      expect((await events(subscriberId)).map((event) => event.source)).toEqual([
        'newsletter-page',
        'operator',
        'operator',
      ]);
    });
  });
});
