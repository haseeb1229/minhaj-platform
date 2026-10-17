import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { readdir, rm, writeFile } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

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
import { sha256 } from '../../packages/database/src/lifecycle/phase11-fixture.ts';
import {
  containsText,
  exifSegment,
  jpegWith,
  syntheticPng,
} from '../../packages/database/src/lifecycle/phase12-fixture.ts';
import {
  courseInputSchema,
  type ClassAdminPort,
  type LearnerPort,
  type LearningPersistencePort,
} from '../../packages/contracts/src/learning/index.ts';
import type { MessagingPersistencePort } from '../../packages/contracts/src/messaging/index.ts';
import type {
  AssetStream,
  RateLimiterPort,
  StorageServicePort,
} from '../../packages/contracts/src/platform/index.ts';
import { createClamAvScanner } from '../../packages/storage/src/scanner.ts';
import {
  createFilesystemStore,
  type FilesystemStore,
} from '../../packages/storage/src/filesystem.ts';
import { createStorageService } from '../../packages/storage/src/service.ts';
import { createAuthorizationService } from '../../packages/server-core/src/authorization/index.ts';
import {
  MessagingRefusal,
  createMessagingService,
  denyAllPeers,
  type MessagingService,
} from '../../packages/server-core/src/messaging/index.ts';
import { createLearningRelationshipService } from '../../packages/server-core/src/relationships/index.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import {
  account,
  activateLive,
  freshSlug,
  n,
  person,
  revokeAssignment,
  teacherAccount,
  topic,
  type TeacherFixture,
} from '../learning/fixture-sql.ts';

/**
 * Phase 24 — Messaging attachments through the REAL Storage service: a real
 * filesystem root, the real ClamAV daemon, and SQL Server as the REAL
 * least-privilege runtime principal, wired into the real Messaging service with
 * Learning's real relationship seam and Identity's real authorisation reader.
 *
 * WHAT ONLY THIS CAN PROVE:
 *
 *   - a clean JPEG, PNG or PDF becomes `ready`, then `attached` on send; the
 *     bytes served are exactly the cleaned, scanned bytes, a JPEG's hidden
 *     metadata gone;
 *   - every refused upload — a format Messaging does not carry, a disguised
 *     one, a declared-type mismatch, an oversized one, one carrying the EICAR
 *     signature, one a scanner could not clear — leaves NO Asset row, NO
 *     MessageAttachment row and NO file: Storage's own refusal record is
 *     released under the token Messaging holds, then forgotten;
 *   - an attachment is reached only through the ONE access decision, every
 *     time: a stranger, a former teacher, a learner who left, another person's
 *     support conversation, a withheld message and an asset Storage would not
 *     serve all answer the same `null`; a moderator reaches one only inside the
 *     report's evidence window and only with the live key;
 *   - Messaging can attach, serve or release only what it uploaded: an Asset
 *     another context stored (a Media photograph, say) carries no release
 *     digest and is unreachable by any Messaging call;
 *   - a crash between Storage's write and Messaging's record, a discard, and a
 *     conversation's disposal each leave no orphan — counted in Asset rows and
 *     in files on disk — while a reported conversation keeps its evidence.
 *
 * RUNS ONLY WHERE BOTH GENUINELY EXIST — a configured database and a scanner
 * that answers — and `scripts/assert-storage-proofs.mjs` makes CI fail if it
 * was skipped. Nothing here is content: every account, Course and body is a
 * `NON_MESSAGING_FIXTURE` / `NON_LEARNING_FIXTURE` sentinel, and every image a
 * synthetic gradient.
 */

const HOST = process.env['CLAMAV_HOST'] ?? '127.0.0.1';
const PORT = Number(process.env['CLAMAV_PORT'] ?? 3310);

async function scannerReady(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: HOST, port: PORT });
    let reply = '';
    const settle = (ready: boolean) => {
      socket.destroy();
      resolve(ready);
    };
    socket.setTimeout(10_000);
    socket.on('timeout', () => settle(false));
    socket.on('error', () => settle(false));
    socket.on('connect', () => socket.write('zPING\0'));
    socket.on('data', (chunk) => {
      reply += chunk.toString('utf8');
      if (reply.includes('PONG')) settle(true);
    });
    socket.on('close', () => settle(reply.includes('PONG')));
  });
}

const live = databaseConfigured && (await scannerReady()) ? describe : describe.skip;

/* ===========================================================================
 * Synthetic bytes
 * ========================================================================= */

const SENTINEL = 'SENTINEL-GPS-PHASE24-ATTACHMENT-0000';
const TAGGED_JPEG = jpegWith([exifSegment({ orientation: 6, sentinel: SENTINEL })]);
const PNG = syntheticPng(64, 40, { hue: 200 });
const ascii = (text: string) => Uint8Array.from(Buffer.from(text, 'latin1'));
const PDF = ascii('%PDF-1.4\n% NON_MESSAGING_FIXTURE synthetic proof document\n%%EOF\n');

/**
 * EICAR — the inert, standard antivirus test string, ASSEMBLED AT RUNTIME (as
 * `clamav.integration.test.ts` does) so this repository never holds a file
 * every scanner quarantines. Carried inside a PDF stream object it passes the
 * sniff as a PDF and REACHES the scanner, whose PDF parser extracts the stream
 * and detects it. Where a workstation's own antivirus removes the file first,
 * Storage keeps the upload quarantined as unscannable instead — either way the
 * upload is not cleared, which is the property under test.
 */
const EICAR = [
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR',
  'STANDARD',
  'ANTIVIRUS',
  'TEST',
  'FILE!$H+H*',
].join('-');
const EICAR_PDF = ascii(
  `%PDF-1.4\n1 0 obj\n<< /Length ${String(EICAR.length)} >>\nstream\n${EICAR}\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
);

/** Formats Storage recognises and Messaging never carries. */
const FOREIGN: readonly (readonly [string, string, Uint8Array])[] = [
  ['image/svg+xml', 'an SVG', ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>')],
  ['image/gif', 'a GIF', ascii('GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;')],
  ['image/webp', 'a WebP', ascii('RIFF\u0010\u0000\u0000\u0000WEBPVP8 \u0000\u0000')],
  ['audio/mpeg', 'an MP3', Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0])],
  [
    'video/mp4',
    'an MP4',
    ascii('\u0000\u0000\u0000\u0018ftypisom\u0000\u0000\u0002\u0000'),
  ],
  ['application/zip', 'a ZIP', Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0])],
  ['application/x-msdownload', 'an EXE', ascii('MZ\u0090\u0000\u0003\u0000\u0000\u0000')],
];

const MiB = 1024 * 1024;
const HOUR = 3_600_000;

const once = (data: Uint8Array) =>
  (async function* () {
    yield data;
  })();

async function bytesOf(stream: AssetStream | null): Promise<Buffer | null> {
  if (stream === null) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of stream.body) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

const reasonOf = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof MessagingRefusal) return error.reason;
    throw error;
  }
  return 'accepted';
};

const me = (accountId: string) => ({ accountId });

/** Every limiter answer is `allowed`: budgets are proved over fakes; this file is about custody. */
const unlimited: RateLimiterPort = {
  consume: async () => ({ allowed: true, retryAfter: null }),
  purgeExpired: async () => 0,
};

live('Phase 24 messaging attachments against real SQL Server, Storage and ClamAV', () => {
  let db: DisposableDatabase;
  let app: SqlSession;
  let root: string;
  let files: FilesystemStore;
  let storage: StorageServicePort;
  let offline: StorageServicePort;
  let persistence: MessagingPersistencePort;
  let messaging: (options?: {
    readonly storage?: StorageServicePort;
    readonly clock?: () => Date;
  }) => MessagingService;
  let service: MessagingService;

  let catalogue: LearningPersistencePort;
  let learner: LearnerPort;
  let classAdmin: ClassAdminPort;
  let operator: string;
  let topicId: string;
  let personId: string;
  let moderator: TeacherFixture;
  let staff: TeacherFixture;

  beforeAll(async () => {
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
    // Every adapter below binds to the RUNTIME principal of the disposable
    // database — never the migration principal, never the engineering one.
    process.env['DATABASE_URL'] = runtimeUrl;

    const database = await import('../../packages/database/src/index.ts');
    const { createAuthorizationPersistence, createAuthorizationReader } =
      await import('../../packages/database/src/adapters/identity-access/index.ts');

    // The REAL path (a temporary directory can be reached through a short
    // 8.3 alias on Windows), so files found on disk compare with the paths
    // Storage resolves for its keys.
    root = realpathSync.native(
      mkdtempSync(path.join(tmpdir(), 'minhaj-messaging-attachment-proof-')),
    );
    files = await createFilesystemStore(root);
    const assets = database.createAssetPersistence();
    storage = createStorageService({
      files,
      assets,
      scanner: createClamAvScanner({ host: HOST, port: PORT, timeoutMs: 60_000 }),
      maxBytes: 64 * MiB,
    });
    // The SAME root and metadata, with the real client pointed at a closed
    // port: an outage is genuinely an outage.
    offline = createStorageService({
      files,
      assets,
      scanner: createClamAvScanner({ host: HOST, port: 9, timeoutMs: 1_000 }),
      maxBytes: 64 * MiB,
      scanAttempts: 1,
    });

    // Identity's own answers: live keys through its authorisation service,
    // and its live teaching assignments and closed accounts — the reads the
    // composition root wires, here without the web process around them.
    const authorization = createAuthorizationService({
      reader: createAuthorizationReader(),
    });
    const identity = createAuthorizationPersistence();
    const teaching = createLearningRelationshipService({
      reader: database.createLearningRelationshipReader(),
      identity: {
        liveTeachingAssignments: (accountId) =>
          identity.liveAssignmentsCarrying(accountId, 'teaching.perform'),
      },
    });
    persistence = database.createMessagingPersistence();
    const audit = database.createAuditWriter();
    messaging = (options = {}) =>
      createMessagingService({
        persistence,
        teaching,
        authority: {
          permits: (accountId, permission) =>
            authorization.hasPermission(accountId, permission),
        },
        accounts: {
          closedAccounts: async (ids) =>
            ids.length === 0 ? [] : identity.closedAccountIds(ids),
        },
        peers: denyAllPeers,
        storage: options.storage ?? storage,
        audit,
        limiter: unlimited,
        limitKey: (purpose, subject) => `${purpose}:${subject}`,
        ...(options.clock === undefined ? {} : { clock: options.clock }),
      });
    service = messaging();

    catalogue = database.createLearningPersistence();
    learner = database.createLearner();
    classAdmin = database.createClassAdmin();

    operator = await account(db.admin);
    topicId = await topic(db.admin);
    personId = await person(db.admin);
    moderator = await teacherAccount(db.admin, ['messaging.moderate']);
    staff = await teacherAccount(db.admin, ['messaging.support']);

    // The owner's activations: live learning (Learning's), and the two
    // Messaging kinds this file exercises. Student-to-student stays off.
    await activateLive(db.admin, 'fixture');
    await db.admin.query(`
      INSERT INTO [dbo].[MessagingActivation] ([capability],[authority],[authorisedBy],[reference])
      VALUES (N'teacher-student', N'fixture', N'NON_MESSAGING_FIXTURE operator', NULL),
             (N'support', N'fixture', N'NON_MESSAGING_FIXTURE operator', NULL);
    `);
  }, 600_000);

  afterAll(async () => {
    await app?.close();
    await db?.close();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }, 120_000);

  /* ---- observations -------------------------------------------------------- */

  const count = async (sql: string): Promise<number> => {
    const [row] = await db.admin.query<{ n: number }>(sql);
    return Number(row?.n ?? -1);
  };

  const assetCount = () => count(`SELECT COUNT_BIG(*) AS n FROM [dbo].[Asset];`);
  const attachmentCount = () =>
    count(`SELECT COUNT_BIG(*) AS n FROM [dbo].[MessageAttachment];`);

  /** Every file under the storage root, however deep. */
  async function filesOnDisk(): Promise<string[]> {
    const entries = await readdir(root, { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) => path.resolve(entry.parentPath, entry.name));
  }

  /** The whole custody picture: rows and files. */
  async function custody() {
    return {
      assets: await assetCount(),
      attachments: await attachmentCount(),
      files: (await filesOnDisk()).length,
    };
  }

  /**
   * Two orphan questions, asked of the whole database and root:
   *   - an Asset stored under a release digest that NO MessageAttachment row
   *     holds the token for is one nobody can ever release;
   *   - a file no Asset row names is bytes nobody owns.
   */
  async function orphans(): Promise<{ assets: number; files: string[] }> {
    const unowned = await count(`
      SELECT COUNT_BIG(*) AS n FROM [dbo].[Asset] a
      WHERE a.[releaseDigest] IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM [dbo].[MessageAttachment] m
          WHERE LOWER(CONVERT(NVARCHAR(64), HASHBYTES('SHA2_256', CAST(m.[releaseToken] AS VARCHAR(64))), 2)) = a.[releaseDigest]);`);
    const keys = await db.admin.query<{ storageKey: string }>(
      `SELECT [storageKey] FROM [dbo].[Asset];`,
    );
    const named = new Set(keys.map((row) => path.resolve(files.pathOf(row.storageKey))));
    const stray = (await filesOnDisk()).filter((file) => !named.has(file));
    return { assets: unowned, files: stray };
  }

  async function attachmentRow(attachmentId: string) {
    const [row] = await db.admin.query<{
      state: string;
      assetId: string | null;
      messageId: string | null;
    }>(
      `SELECT [state],[assetId],[messageId] FROM [dbo].[MessageAttachment] WHERE [id] = ${n(attachmentId)};`,
    );
    return row ?? null;
  }

  async function assetRow(assetId: string) {
    const [row] = await db.admin.query<{
      state: string;
      storageKey: string;
      checksum: string | null;
      byteSize: number | string | null;
    }>(
      `SELECT [state],[storageKey],[checksum],[byteSize] FROM [dbo].[Asset] WHERE [id] = ${n(assetId)};`,
    );
    return row ?? null;
  }

  /** Whether an Asset's bytes are still on disk. */
  async function onDisk(storageKey: string): Promise<boolean> {
    return files.exists(storageKey);
  }

  /* ---- Learning fixtures, through Learning's own adapters ----------------- */

  async function course(): Promise<string> {
    const slug = freshSlug('messaging');
    let detail = await catalogue.saveCourse({
      actorId: operator,
      id: null,
      expectedVersion: null,
      value: courseInputSchema.parse({
        slug,
        primaryLocale: 'en',
        level: 'beginner',
        format: 'live',
        languageCode: 'en',
        labels: [
          {
            locale: 'en',
            title: `NON_MESSAGING_FIXTURE_COURSE_${slug}`,
            summary: 'NON_MESSAGING_FIXTURE summary',
            description: 'NON_MESSAGING_FIXTURE description',
          },
        ],
        topicIds: [topicId],
        teacherIds: [personId],
      }),
    });
    detail = await catalogue.changeModule({
      actorId: operator,
      courseId: detail.id,
      expectedVersion: detail.version,
      change: {
        op: 'add',
        labels: [{ locale: 'en', title: 'NON_MESSAGING_FIXTURE module', summary: '' }],
      },
    });
    detail = await catalogue.changeLesson({
      actorId: operator,
      courseId: detail.id,
      expectedVersion: detail.version,
      change: {
        op: 'add',
        moduleId: detail.outline[0]?.id ?? '',
        labels: [
          {
            locale: 'en',
            title: 'NON_MESSAGING_FIXTURE lesson',
            summary: '',
            body: 'NON_MESSAGING_FIXTURE lesson body',
          },
        ],
      },
    });
    const published = await catalogue.transitionCourse({
      actorId: operator,
      id: detail.id,
      expectedVersion: detail.version,
      state: 'published',
    });
    return published.id;
  }

  /**
   * A CURRENT teaching relationship — a live `teaching.perform` assignment
   * scoped to a published live Course, and an Enrolment on it — and the
   * conversation the learner opened in it.
   */
  async function relationship(
    existing: { readonly teacher?: TeacherFixture; readonly learnerId?: string } = {},
  ) {
    const courseId = await course();
    const teacher = existing.teacher ?? (await teacherAccount(db.admin));
    await classAdmin.grantScope({
      actorId: operator,
      courseId,
      accountId: teacher.accountId,
      roleAssignmentId: teacher.roleAssignmentId,
    });
    const learnerId = existing.learnerId ?? (await account(db.admin));
    expect(await learner.enrol(learnerId, courseId)).toBe(true);
    const { conversationId } = await service.startTeaching(me(learnerId), {
      counterpartAccountId: teacher.accountId,
      courseId,
    });
    return { teacher, learnerId, courseId, conversationId };
  }

  const upload = (
    who: string,
    conversationId: string,
    data: Uint8Array,
    mediaType: string | null,
    displayName: string | null = 'NON_MESSAGING_FIXTURE.bin',
    via: MessagingService = service,
  ) =>
    via.uploadAttachment(me(who), conversationId, once(data), {
      mediaType,
      displayName,
    });

  const sendWith = (who: string, conversationId: string, attachmentIds: string[]) =>
    service.send(me(who), conversationId, {
      operationId: randomUUID(),
      body: 'NON_MESSAGING_FIXTURE body',
      attachmentIds,
    });

  const sendText = (who: string, conversationId: string) =>
    sendWith(who, conversationId, []);

  /** A conversation with one attachment of `data`, uploaded and sent by the learner. */
  async function sentAttachment(data: Uint8Array = PNG, mediaType = 'image/png') {
    const context = await relationship();
    const view = await upload(context.learnerId, context.conversationId, data, mediaType);
    const sent = await sendWith(context.learnerId, context.conversationId, [view.id]);
    const row = await attachmentRow(view.id);
    return {
      ...context,
      attachmentId: view.id,
      message: sent.message,
      assetId: row!.assetId!,
    };
  }

  async function closeAccount(accountId: string): Promise<void> {
    await db.admin.query(
      `UPDATE [dbo].[User] SET [status] = N'closed', [email] = ${n(`closed-${accountId}@closed.invalid`)} WHERE [id] = ${n(accountId)};`,
    );
  }

  /* ======================================================================
   * Clean uploads
   * ==================================================================== */

  describe('a clean upload is stored, scanned, recorded and attached on send', () => {
    it('strips a JPEG’s hidden metadata and serves exactly the scanned bytes', async () => {
      const { teacher, learnerId, conversationId } = await relationship();
      const view = await upload(
        learnerId,
        conversationId,
        TAGGED_JPEG,
        'image/jpeg',
        'NON_MESSAGING_FIXTURE photo.jpg',
      );
      expect(view).toMatchObject({
        mediaType: 'image/jpeg',
        displayName: 'NON_MESSAGING_FIXTURE photo.jpg',
      });
      expect(await attachmentRow(view.id)).toMatchObject({
        state: 'ready',
        messageId: null,
      });

      const sent = await sendWith(learnerId, conversationId, [view.id]);
      expect(sent.message.attachments.map((a) => a.id)).toEqual([view.id]);
      const row = await attachmentRow(view.id);
      expect(row).toMatchObject({ state: 'attached', messageId: sent.message.id });

      const asset = await assetRow(row!.assetId!);
      expect(asset?.state).toBe('clean');
      const served = await bytesOf(
        await service.openAttachment(me(teacher.accountId), view.id),
      );
      expect(served).not.toBeNull();
      expect(sha256(served!)).toBe(asset?.checksum);
      expect(served!.length).toBe(Number(asset?.byteSize));
      expect(served!.length).toBe(view.byteSize);
      expect(containsText(TAGGED_JPEG, SENTINEL)).toBe(true);
      expect(containsText(served!, SENTINEL)).toBe(false);
    });

    it.each([
      ['a PNG', PNG, 'image/png'],
      ['a PDF', PDF, 'application/pdf'],
    ] as const)(
      'attaches %s and serves it to both participants',
      async (_l, data, type) => {
        const { teacher, learnerId, conversationId } = await relationship();
        const view = await upload(learnerId, conversationId, data, type);
        expect(view.mediaType).toBe(type);
        expect(view.byteSize).toBe(data.length);
        expect(await attachmentRow(view.id)).toMatchObject({ state: 'ready' });
        // Before it is sent, only its uploader previews it.
        expect(
          await bytesOf(await service.openAttachment(me(learnerId), view.id)),
        ).toEqual(Buffer.from(data));
        expect(await service.openAttachment(me(teacher.accountId), view.id)).toBeNull();

        await sendWith(learnerId, conversationId, [view.id]);
        expect(await attachmentRow(view.id)).toMatchObject({ state: 'attached' });
        for (const who of [learnerId, teacher.accountId])
          expect(await bytesOf(await service.openAttachment(me(who), view.id))).toEqual(
            Buffer.from(data),
          );
      },
    );

    it('does not duplicate an attachment when the same send is retried', async () => {
      const { learnerId, conversationId } = await relationship();
      const view = await upload(learnerId, conversationId, PNG, 'image/png');
      const input = {
        operationId: randomUUID(),
        body: 'NON_MESSAGING_FIXTURE retried',
        attachmentIds: [view.id],
      };
      const first = await service.send(me(learnerId), conversationId, input);
      const again = await service.send(me(learnerId), conversationId, input);
      expect(again.replayed).toBe(true);
      expect(again.message.id).toBe(first.message.id);
      expect(
        await count(
          `SELECT COUNT_BIG(*) AS n FROM [dbo].[MessageAttachment] WHERE [messageId] = ${n(first.message.id)};`,
        ),
      ).toBe(1);
      expect(
        await count(
          `SELECT COUNT_BIG(*) AS n FROM [dbo].[Message] WHERE [conversationId] = ${n(conversationId)};`,
        ),
      ).toBe(1);
    });
  });

  /* ======================================================================
   * Refused uploads leave nothing behind
   * ==================================================================== */

  describe('a refused upload leaves no Asset row, no attachment row and no file', () => {
    let conversation: { learnerId: string; conversationId: string };

    beforeAll(async () => {
      conversation = await relationship();
    }, 300_000);

    async function refusedLeavingNothing(
      work: () => Promise<unknown>,
      expected: string,
    ): Promise<void> {
      const before = await custody();
      expect(await reasonOf(work())).toBe(expected);
      expect(await custody()).toEqual(before);
      expect(await orphans()).toEqual({ assets: 0, files: [] });
    }

    it.each(FOREIGN)(
      'refuses a declared %s before a byte is read',
      async (type, _l, data) => {
        await refusedLeavingNothing(
          () => upload(conversation.learnerId, conversation.conversationId, data, type),
          'unsupported',
        );
      },
    );

    it.each(FOREIGN)(
      'refuses %s disguised as a PDF and as a PNG, releasing Storage’s record',
      async (_type, _label, data) => {
        for (const declared of ['application/pdf', 'image/png'])
          await refusedLeavingNothing(
            () =>
              upload(conversation.learnerId, conversation.conversationId, data, declared),
            'unsupported',
          );
      },
    );

    it.each([
      ['a JPEG declared as a PNG', TAGGED_JPEG, 'image/png'],
      ['a PNG declared as a JPEG', PNG, 'image/jpeg'],
      ['a PNG declared as a PDF', PNG, 'application/pdf'],
      ['a PDF declared as a JPEG', PDF, 'image/jpeg'],
    ] as const)('refuses %s', async (_label, data, declared) => {
      await refusedLeavingNothing(
        () => upload(conversation.learnerId, conversation.conversationId, data, declared),
        'unsupported',
      );
    });

    it('refuses a file over 5 MiB as too large', async () => {
      const big = new Uint8Array(5 * MiB + 1).fill(0x25);
      big.set(PDF.subarray(0, 9));
      await refusedLeavingNothing(
        () =>
          upload(
            conversation.learnerId,
            conversation.conversationId,
            big,
            'application/pdf',
          ),
        'too-large',
      );
    });

    it('refuses a PDF carrying the EICAR test signature as not cleared', async () => {
      await refusedLeavingNothing(
        () =>
          upload(
            conversation.learnerId,
            conversation.conversationId,
            EICAR_PDF,
            'application/pdf',
          ),
        'not-cleared',
      );
    });

    it('refuses what an unreachable scanner could not clear, releasing the quarantined bytes', async () => {
      await refusedLeavingNothing(
        () =>
          upload(
            conversation.learnerId,
            conversation.conversationId,
            PDF,
            'application/pdf',
            null,
            messaging({ storage: offline }),
          ),
        'not-cleared',
      );
    });

    it('refuses an upload past the pending bound, and a discard releases each one', async () => {
      const before = await custody();
      const pending: string[] = [];
      for (let index = 0; index < 8; index += 1)
        pending.push(
          (
            await upload(
              conversation.learnerId,
              conversation.conversationId,
              syntheticPng(8 + index, 8, { hue: index * 20 }),
              'image/png',
            )
          ).id,
        );
      const held = await custody();
      expect(held.assets).toBe(before.assets + 8);
      expect(held.attachments).toBe(before.attachments + 8);
      expect(held.files).toBe(before.files + 8);

      await refusedLeavingNothing(
        () =>
          upload(conversation.learnerId, conversation.conversationId, PNG, 'image/png'),
        'too-many',
      );

      const assetIds = await Promise.all(
        pending.map(async (id) => (await attachmentRow(id))!.assetId!),
      );
      for (const id of pending)
        await service.discardAttachment(me(conversation.learnerId), id);
      expect(await custody()).toEqual(before);
      for (const assetId of assetIds) expect(await assetRow(assetId)).toBeNull();
      expect(await orphans()).toEqual({ assets: 0, files: [] });
    });
  });

  /* ======================================================================
   * Sending only one's own uploads
   * ==================================================================== */

  describe('a send attaches only the sender’s own upload in that conversation', () => {
    it('refuses another person’s attachment and one from another conversation, attaching nothing', async () => {
      const first = await relationship();
      const second = await relationship({
        teacher: first.teacher,
        learnerId: first.learnerId,
      });
      const teachers = await upload(
        first.teacher.accountId,
        first.conversationId,
        PNG,
        'image/png',
      );
      const elsewhere = await upload(
        first.learnerId,
        second.conversationId,
        PDF,
        'application/pdf',
      );

      expect(
        await reasonOf(sendWith(first.learnerId, first.conversationId, [teachers.id])),
      ).toBe('invalid');
      expect(
        await reasonOf(sendWith(first.learnerId, first.conversationId, [elsewhere.id])),
      ).toBe('invalid');
      expect(
        await count(
          `SELECT COUNT_BIG(*) AS n FROM [dbo].[Message] WHERE [conversationId] = ${n(first.conversationId)};`,
        ),
      ).toBe(0);
      expect(await attachmentRow(teachers.id)).toMatchObject({
        state: 'ready',
        messageId: null,
      });
      expect(await attachmentRow(elsewhere.id)).toMatchObject({
        state: 'ready',
        messageId: null,
      });

      await service.discardAttachment(me(first.teacher.accountId), teachers.id);
      // A discard is the uploader's alone.
      expect(
        await reasonOf(
          service.discardAttachment(me(first.teacher.accountId), elsewhere.id),
        ),
      ).toBe('not-found');
      await service.discardAttachment(me(first.learnerId), elsewhere.id);
    });

    it('can never attach, serve, discard or release an Asset another context stored', async () => {
      const { teacher, learnerId, conversationId } = await relationship();
      // Stored as Media stores a photograph: through Storage, WITHOUT a release
      // token, so its row carries no release digest.
      const foreign = await storage.store(once(PNG), {
        allowedMediaTypes: ['image/png'],
        maxBytes: MiB,
      });
      expect(foreign.state).toBe('clean');
      const asset = await assetRow(foreign.id);

      expect(await reasonOf(sendWith(learnerId, conversationId, [foreign.id]))).toBe(
        'invalid',
      );
      expect(await service.openAttachment(me(learnerId), foreign.id)).toBeNull();
      expect(await service.openAttachment(me(teacher.accountId), foreign.id)).toBeNull();
      expect(await reasonOf(service.discardAttachment(me(learnerId), foreign.id))).toBe(
        'not-found',
      );
      // No token Messaging could hold releases it.
      expect(await storage.release(randomBytes(32).toString('hex'))).toBe('absent');
      await messaging({
        clock: () => new Date(Date.now() + 48 * HOUR),
      }).sweepAttachments();

      expect(await assetRow(foreign.id)).toMatchObject({ state: 'clean' });
      expect(await onDisk(asset!.storageKey)).toBe(true);
    });
  });

  /* ======================================================================
   * Reading an attachment — the one decision, every time
   * ==================================================================== */

  describe('an attachment opens only through the access decision, failing closed', () => {
    it('refuses an unknown actor and an unrelated person', async () => {
      const { attachmentId, learnerId } = await sentAttachment();
      const stranger = await account(db.admin);
      expect(
        await bytesOf(await service.openAttachment(me(learnerId), attachmentId)),
      ).not.toBeNull();
      for (const actor of ['', 'proof-account-never-registered', stranger])
        expect(await service.openAttachment(me(actor), attachmentId)).toBeNull();
      expect(await service.openAttachment(me(learnerId), randomUUID())).toBeNull();
      expect(await service.openAttachment(me(learnerId), 'not-an-id')).toBeNull();
    });

    it('refuses a former teacher and a learner who left the Course', async () => {
      const revoked = await sentAttachment();
      expect(
        await bytesOf(
          await service.openAttachment(
            me(revoked.teacher.accountId),
            revoked.attachmentId,
          ),
        ),
      ).not.toBeNull();
      await revokeAssignment(db.admin, revoked.teacher.roleAssignmentId);
      expect(
        await service.openAttachment(me(revoked.teacher.accountId), revoked.attachmentId),
      ).toBeNull();
      expect(
        await service.openAttachment(me(revoked.learnerId), revoked.attachmentId),
      ).toBeNull();

      const left = await sentAttachment(PDF, 'application/pdf');
      await learner.leave(left.learnerId, left.courseId);
      expect(
        await service.openAttachment(me(left.learnerId), left.attachmentId),
      ).toBeNull();
      expect(
        await service.openAttachment(me(left.teacher.accountId), left.attachmentId),
      ).toBeNull();
    });

    it('refuses another person guessing a support attachment', async () => {
      const asker = await account(db.admin);
      const guesser = await account(db.admin);
      const { conversationId } = await service.openSupport(me(asker));
      const view = await upload(asker, conversationId, PDF, 'application/pdf');
      await sendWith(asker, conversationId, [view.id]);
      expect(
        await bytesOf(await service.openAttachment(me(asker), view.id)),
      ).not.toBeNull();
      expect(await service.openAttachment(me(guesser), view.id)).toBeNull();
      expect(await service.openSupportAttachment(me(guesser), view.id)).toBeNull();
      // Support staff reach it only through their own audited surface.
      expect(await service.openAttachment(me(staff.accountId), view.id)).toBeNull();
      expect(
        await bytesOf(await service.openSupportAttachment(me(staff.accountId), view.id)),
      ).not.toBeNull();
    });

    it('withholds a moderated message’s attachment from participants but not from evidence', async () => {
      const { attachmentId, learnerId, teacher, conversationId, message } =
        await sentAttachment();
      const { reportId } = await service.report(me(teacher.accountId), {
        conversationId,
        messageId: message.id,
        reason: 'inappropriate',
      });
      await service.decide(me(moderator.accountId), {
        reportId,
        action: 'withhold-message',
        expectedVersion: 1,
      });
      expect(await service.openAttachment(me(learnerId), attachmentId)).toBeNull();
      expect(
        await service.openAttachment(me(teacher.accountId), attachmentId),
      ).toBeNull();
      expect(
        await bytesOf(
          await service.openEvidenceAttachment(
            me(moderator.accountId),
            reportId,
            attachmentId,
          ),
        ),
      ).not.toBeNull();
    });

    it('refuses an asset Storage would not serve: missing bytes, quarantined or rejected custody', async () => {
      const missing = await sentAttachment();
      await rm(files.pathOf((await assetRow(missing.assetId))!.storageKey));
      expect(
        await service.openAttachment(me(missing.teacher.accountId), missing.attachmentId),
      ).toBeNull();

      for (const [state, rejection] of [
        ['quarantined', 'NULL'],
        ['rejected', `N'infected'`],
      ] as const) {
        const held = await sentAttachment();
        await db.admin.query(
          `UPDATE [dbo].[Asset] SET [state] = N'${state}', [rejection] = ${rejection} WHERE [id] = ${n(held.assetId)};`,
        );
        expect(
          await service.openAttachment(me(held.learnerId), held.attachmentId),
        ).toBeNull();
        expect(
          await service.openAttachment(me(held.teacher.accountId), held.attachmentId),
        ).toBeNull();
      }
    });

    it('serves a moderator only inside the report’s evidence window, only with the live key', async () => {
      const { attachmentId, learnerId, teacher, conversationId, message } =
        await sentAttachment();
      // Message 1 carries the attachment; twelve more follow it.
      let last = message;
      for (let index = 0; index < 12; index += 1)
        last = (
          await sendText(index % 2 === 0 ? teacher.accountId : learnerId, conversationId)
        ).message;
      expect(last.sequence).toBe(13);

      const far = await service.report(me(learnerId), {
        conversationId,
        messageId: last.id,
        reason: 'harassment',
      });
      const near = await service.report(me(learnerId), {
        conversationId,
        messageId: message.id,
        reason: 'harassment',
      });
      // Window of message 13: [3, 13] — message 1 is outside it.
      expect(
        await service.openEvidenceAttachment(
          me(moderator.accountId),
          far.reportId,
          attachmentId,
        ),
      ).toBeNull();
      expect(
        await bytesOf(
          await service.openEvidenceAttachment(
            me(moderator.accountId),
            near.reportId,
            attachmentId,
          ),
        ),
      ).not.toBeNull();
      // The key, not the participation, is the authority — and the reporter
      // holds none.
      for (const actor of [learnerId, teacher.accountId, staff.accountId])
        expect(
          await service.openEvidenceAttachment(me(actor), near.reportId, attachmentId),
        ).toBeNull();
      // Another report's evidence is not reachable by naming its attachment.
      const other = await sentAttachment();
      const otherReport = await service.report(me(other.learnerId), {
        conversationId: other.conversationId,
        messageId: other.message.id,
        reason: 'spam',
      });
      expect(
        await service.openEvidenceAttachment(
          me(moderator.accountId),
          otherReport.reportId,
          attachmentId,
        ),
      ).toBeNull();
    });

    it('keeps terminal history for the remaining person after the other account closes', async () => {
      const { attachmentId, learnerId, teacher } = await sentAttachment();
      await closeAccount(teacher.accountId);
      await service.disposeAccount(teacher.accountId);
      expect(
        await bytesOf(await service.openAttachment(me(learnerId), attachmentId)),
      ).not.toBeNull();
      expect(
        await service.openAttachment(me(teacher.accountId), attachmentId),
      ).toBeNull();
    });
  });

  /* ======================================================================
   * Release: discard, crash recovery and disposal
   * ==================================================================== */

  describe('every release path leaves no orphan', () => {
    it('releases a discarded upload — row, Asset and bytes', async () => {
      const { learnerId, conversationId } = await relationship();
      const before = await custody();
      const view = await upload(learnerId, conversationId, PDF, 'application/pdf');
      const asset = await assetRow((await attachmentRow(view.id))!.assetId!);
      await service.discardAttachment(me(learnerId), view.id);
      expect(await attachmentRow(view.id)).toBeNull();
      expect(await onDisk(asset!.storageKey)).toBe(false);
      expect(await custody()).toEqual(before);
      // Discarding again, or a sent attachment, is refused.
      expect(await reasonOf(service.discardAttachment(me(learnerId), view.id))).toBe(
        'not-found',
      );
      const sent = await sentAttachment();
      expect(
        await reasonOf(service.discardAttachment(me(sent.learnerId), sent.attachmentId)),
      ).toBe('not-found');
      expect(await attachmentRow(sent.attachmentId)).toMatchObject({ state: 'attached' });
    });

    it('sweeps an upload whose record never landed, only after the cutoff', async () => {
      const { learnerId, conversationId } = await relationship();
      // A crash between Storage's write and Messaging's record: the row is
      // prepared and the bytes stored under its token, and nothing more.
      const releaseToken = randomBytes(32).toString('hex');
      const prepared = await persistence.prepareAttachment({
        conversationId,
        uploaderAccountId: learnerId,
        releaseToken,
        limit: 8,
      });
      expect(prepared.state).toBe('prepared');
      const stored = await storage.store(once(PDF), {
        allowedMediaTypes: ['application/pdf'],
        maxBytes: 5 * MiB,
        declaredMediaType: 'application/pdf',
        displayName: null,
        releaseToken,
      });
      expect(stored.state).toBe('clean');
      const asset = await assetRow(stored.id);
      const attachmentId = prepared.state === 'prepared' ? prepared.attachmentId : '';

      await messaging({
        clock: () => new Date(Date.now() + 23 * HOUR),
      }).sweepAttachments();
      expect(await attachmentRow(attachmentId)).toMatchObject({ state: 'pending' });
      expect(await assetRow(stored.id)).not.toBeNull();

      expect(
        await messaging({
          clock: () => new Date(Date.now() + 25 * HOUR),
        }).sweepAttachments(),
      ).toBeGreaterThanOrEqual(1);
      expect(await attachmentRow(attachmentId)).toBeNull();
      expect(await assetRow(stored.id)).toBeNull();
      expect(await onDisk(asset!.storageKey)).toBe(false);
      expect(await orphans()).toEqual({ assets: 0, files: [] });
    });

    it('would see an orphan if one existed — the custody questions discriminate', async () => {
      // The positive control for every `orphans()` answer above: bytes stored
      // under a token no Messaging row holds, and a file no Asset row names,
      // are each reported — and each goes when released or removed.
      const releaseToken = randomBytes(32).toString('hex');
      const stored = await storage.store(once(PDF), {
        allowedMediaTypes: ['application/pdf'],
        maxBytes: MiB,
        releaseToken,
      });
      expect(stored.state).toBe('clean');
      const stray = path.join(root, 'NON_MESSAGING_FIXTURE-stray.bin');
      await writeFile(stray, PDF);
      expect(await orphans()).toEqual({ assets: 1, files: [path.resolve(stray)] });

      expect(await storage.release(releaseToken)).toBe('released');
      await rm(stray);
      expect(await orphans()).toEqual({ assets: 0, files: [] });
    });

    it('disposes a conversation nobody living holds, releasing every attachment', async () => {
      const { teacher, learnerId, conversationId, attachmentId, assetId } =
        await sentAttachment();
      const second = await upload(
        teacher.accountId,
        conversationId,
        PDF,
        'application/pdf',
      );
      await sendWith(teacher.accountId, conversationId, [second.id]);
      const unsent = await upload(learnerId, conversationId, PNG, 'image/png');
      const assetIds = [
        assetId,
        (await attachmentRow(second.id))!.assetId!,
        (await attachmentRow(unsent.id))!.assetId!,
      ];
      const keys = await Promise.all(
        assetIds.map(async (id) => (await assetRow(id))!.storageKey),
      );

      await closeAccount(teacher.accountId);
      await closeAccount(learnerId);
      await service.disposeAccount(teacher.accountId);
      const progress = await service.disposeAccount(learnerId);
      expect(progress.complete).toBe(true);

      expect(
        await count(
          `SELECT COUNT_BIG(*) AS n FROM [dbo].[Conversation] WHERE [id] = ${n(conversationId)};`,
        ),
      ).toBe(0);
      expect(
        await count(
          `SELECT COUNT_BIG(*) AS n FROM [dbo].[MessageAttachment] WHERE [conversationId] = ${n(conversationId)};`,
        ),
      ).toBe(0);
      for (const id of [attachmentId, second.id, unsent.id])
        expect(await attachmentRow(id)).toBeNull();
      for (const id of assetIds) expect(await assetRow(id)).toBeNull();
      for (const key of keys) expect(await onDisk(key)).toBe(false);
      expect(await orphans()).toEqual({ assets: 0, files: [] });
    });

    it('keeps a reported conversation’s attachments as evidence through disposal', async () => {
      const { teacher, learnerId, conversationId, attachmentId, assetId } =
        await sentAttachment();
      await service.report(me(learnerId), {
        conversationId,
        messageId: null,
        reason: 'safety',
      });
      const key = (await assetRow(assetId))!.storageKey;

      await closeAccount(teacher.accountId);
      await closeAccount(learnerId);
      await service.disposeAccount(teacher.accountId);
      await service.disposeAccount(learnerId);
      await service.reconcileClosedAccounts();

      expect(
        await count(
          `SELECT COUNT_BIG(*) AS n FROM [dbo].[Conversation] WHERE [id] = ${n(conversationId)};`,
        ),
      ).toBe(1);
      expect(await attachmentRow(attachmentId)).toMatchObject({
        state: 'attached',
        assetId,
      });
      expect(await assetRow(assetId)).toMatchObject({ state: 'clean' });
      expect(await onDisk(key)).toBe(true);
      expect(await orphans()).toEqual({ assets: 0, files: [] });
    });
  });
});
