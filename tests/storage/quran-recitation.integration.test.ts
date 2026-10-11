import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { StorageServicePort } from '../../packages/contracts/src/platform/storage.ts';
import type {
  QuranAuthorityPort,
  QuranPersistencePort,
  QuranPublicReaderPort,
  RecitationDetail,
} from '../../packages/contracts/src/quran/index.ts';
import { createClamAvScanner } from '../../packages/storage/src/scanner.ts';
import { createFilesystemStore } from '../../packages/storage/src/filesystem.ts';
import { createStorageService } from '../../packages/storage/src/service.ts';
import {
  sha256,
  syntheticSilentMp3,
} from '../../packages/database/src/lifecycle/phase11-fixture.ts';
import {
  createQuranService,
  createRecitationAssetPolicy,
  createRecitationPreviewPolicy,
  createRecitationUpload,
  quranFailure,
} from '../../apps/web/src/contexts/quran/index.ts';
import { serveAudio } from '../../apps/web/src/app/assets/media/serve.ts';
import { createAuthorizationService } from '../../packages/server-core/src/authorization/index.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import {
  accountWith,
  fixtureAyat,
  grantFor,
  person,
  registerSource,
  sessionFor,
  type RegisteredSource,
} from '../quran/fixture-sql.ts';

/**
 * Phase 18 — a recitation segment's audio over REAL SQL Server, a REAL
 * filesystem storage root and the REAL malware scanner, through the real Quran
 * service, upload, adapter, serving policies and byte-serving function.
 *
 * WHAT ONLY THIS CAN PROVE:
 *
 *   - a segment's file is streamed into Storage, sniffed from its BYTES, scanned
 *     by ClamAV and recorded only once cleared — and only for a caller holding
 *     `quran.administer` NOW: a reader, a Media or Editorial administrator and a
 *     revoked administrator store no byte at all, and neither does a stale
 *     version or an unknown segment;
 *   - BOTH owners must allow before a byte leaves the disk: the public route
 *     serves the recorded asset of a segment only while the corpus is active
 *     and the Recitation published, and a draft, an archived Recitation, a
 *     deactivated corpus, another segment's file, a replaced file and a guessed
 *     identifier are the same 404 — whole or ranged;
 *   - an administrator's preview needs a LIVE `quran.read`;
 *   - replacing a segment's file never destroys the one it replaced;
 *   - A RECITATION IS NOT AN AUDIOTRACK: nothing here creates a Media row.
 *
 * RUNS ONLY WHERE BOTH GENUINELY EXIST — a configured database and a scanner
 * that answers — and `scripts/assert-storage-proofs.mjs` makes CI fail if it
 * was skipped.
 *
 * NOTHING HERE IS THE QURAN. The audio is generated silence, the corpus is the
 * sentinel scaffolding of `../quran/fixture-sql.ts`, and the reciter is
 * "Fixture Reciter One".
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

const AUDIO = syntheticSilentMp3(40);
const REPLACEMENT = syntheticSilentMp3(60);
const PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13,
]);
const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 1, 2, 3, 4]);

const once = (data: Uint8Array) =>
  (async function* () {
    yield data;
  })();

async function body(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

const file = { declaredMediaType: 'audio/mpeg', displayName: 'synthetic.mp3' };

/** An upload, its arguments in the order a proof reads: who, which work at which version, which segment. */
type Upload = (
  actor: { readonly accountId: string },
  recitationId: string,
  version: number,
  segmentId: string,
  bytes: AsyncIterable<Uint8Array>,
  description: {
    readonly declaredMediaType: string | null;
    readonly displayName: string | null;
  },
) => Promise<RecitationDetail>;

live('Phase 18 recitation audio against real SQL Server, Storage and ClamAV', () => {
  let db: DisposableDatabase;
  let root: string;
  let source: RegisteredSource;
  let storage: StorageServicePort;
  let persistence: QuranPersistencePort;
  let reader: QuranPublicReaderPort;
  let authority: QuranAuthorityPort;
  let service: ReturnType<typeof createQuranService>;
  let upload: Upload;
  let uploadOffline: Upload;
  let administrator: { accountId: string };
  let quranReader: { accountId: string };
  let mediaAdministrator: { accountId: string };
  let reciterId: string;
  let audioTracks: number;

  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return quranFailure(error);
    }
    return 'accepted';
  };

  const count = async (sql: string): Promise<number> => {
    const [row] = await db.admin.query<{ n: number }>(sql);
    return Number(row?.n ?? -1);
  };

  /** Every file under the storage root — "no byte stored" is checked on disk too. */
  const filesOnDisk = () =>
    readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) =>
      entry.isFile(),
    ).length;

  const activate = () =>
    db.admin.query(
      `INSERT INTO [dbo].[QuranActivation] ([id],[sourceId],[authorisedBy]) VALUES (1, N'${source.id}', N'NON_QURAN_FIXTURE operator');`,
    );
  const deactivate = () => db.admin.query(`DELETE FROM [dbo].[QuranActivation];`);

  const publicServe = (
    recitationId: string,
    segmentId: string,
    assetId: string,
    headers: { range?: string | null } = {},
  ) =>
    serveAudio(
      storage,
      assetId,
      createRecitationAssetPolicy({
        reader,
        request: { recitationId, segmentId, assetId },
      }),
      { range: headers.range ?? null, ifRange: null },
    );

  const preview = (
    account: { accountId: string },
    recitationId: string,
    segmentId: string,
    assetId: string,
  ) =>
    serveAudio(
      storage,
      assetId,
      createRecitationPreviewPolicy({
        persistence,
        authority,
        accountId: account.accountId,
        request: { recitationId, segmentId, assetId },
      }),
      { range: null, ifRange: null },
    );

  /** A draft Recitation with two segments of Surah 1 and no audio yet. */
  async function recitation(): Promise<RecitationDetail> {
    const created = await service.createRecitation(administrator, {
      value: {
        slug: `non-quran-fixture-recitation-${randomUUID().slice(0, 8)}`,
        name: 'NON_QURAN_FIXTURE recitation by Fixture Reciter One',
        reciterId,
        style: null,
        attribution: null,
        sourceId: source.id,
      },
    });
    const first = await service.addRecitationSegment(administrator, {
      id: created.id,
      expectedVersion: created.version,
      value: { surah: 1, startAyah: 1, endAyah: 2 },
    });
    return service.addRecitationSegment(administrator, {
      id: first.id,
      expectedVersion: first.version,
      value: { surah: 1, startAyah: 3, endAyah: 3 },
    });
  }

  /** A Recitation with BOTH segments' audio uploaded, cleared and recorded. */
  async function withAudio(): Promise<RecitationDetail> {
    let current = await recitation();
    for (const segment of current.segments)
      current = await upload(
        administrator,
        current.id,
        current.version,
        segment.id,
        once(AUDIO),
        file,
      );
    return current;
  }

  const publish = (
    record: RecitationDetail,
    state: 'published' | 'archived' = 'published',
  ) =>
    service.setRecitationState(administrator, {
      id: record.id,
      expectedVersion: record.version,
      state,
    });

  const assetOf = (record: RecitationDetail, index: number) => {
    const segment = record.segments[index];
    if (segment?.assetId === null || segment === undefined)
      throw new Error('fixture segment has no audio');
    return { segmentId: segment.id, assetId: segment.assetId };
  };

  beforeAll(async () => {
    db = await createProofDatabase();
    root = mkdtempSync(path.join(tmpdir(), 'minhaj-quran-audio-proof-'));

    const database = await import('../../packages/database/src/index.ts');
    const { createAuthorizationReader } =
      await import('../../packages/database/src/adapters/identity-access/index.ts');

    const files = await createFilesystemStore(root);
    const assets = database.createAssetPersistence();
    storage = createStorageService({
      files,
      assets,
      scanner: createClamAvScanner({ host: HOST, port: PORT, timeoutMs: 60_000 }),
      maxBytes: 64 * 1024 * 1024,
    });
    // The SAME root and metadata, with a scanner that cannot be reached: the
    // real client, pointed at a closed port, so an outage is genuinely an outage.
    const offline = createStorageService({
      files,
      assets,
      scanner: createClamAvScanner({ host: HOST, port: 9, timeoutMs: 1000 }),
      maxBytes: 64 * 1024 * 1024,
      scanAttempts: 1,
    });

    const authorization = createAuthorizationService({
      reader: createAuthorizationReader(),
    });
    authority = {
      permits: (id, key) => authorization.hasPermission(id, key),
      verifyCanonical: async () => false,
    };
    persistence = database.createQuranPersistence();
    reader = database.createQuranPublicReader();
    service = createQuranService({ persistence, authority });
    const uploads = (target: StorageServicePort) => {
      const { uploadSegmentAudio } = createRecitationUpload({
        persistence,
        authority,
        storage: async () => target,
      });
      const reordered: Upload = (
        actor,
        recitationId,
        version,
        segmentId,
        bytes,
        description,
      ) =>
        uploadSegmentAudio(actor, recitationId, segmentId, version, bytes, description);
      return reordered;
    };
    upload = uploads(storage);
    uploadOffline = uploads(offline);

    // The canonical corpus, accepted through the database procedure with a
    // real assignment, session and purpose-bound step-up grant.
    source = await registerSource(db.admin, {
      code: 'non-quran-fixture-recitation-source',
      authority: 'fixture',
      ayat: fixtureAyat('CANONICAL'),
    });
    const holder = await accountWith(db.admin, ['quran.editCanonical']);
    const session = await sessionFor(db.admin, holder);
    await database.createQuranCanonical().acceptCorpus({
      authority: {
        actorId: holder,
        sessionId: session,
        stepUpGrantId: await grantFor(db.admin, holder, session, 'quran-canonical-edit'),
      },
      sourceId: source.id,
      candidate: source.ayat.map((entry) => ({ ...entry })),
    });
    await activate();

    administrator = {
      accountId: await accountWith(db.admin, ['quran.read', 'quran.administer']),
    };
    quranReader = { accountId: await accountWith(db.admin, ['quran.read']) };
    // Every key that administers OTHER content — none of them confers anything here.
    mediaAdministrator = {
      accountId: await accountWith(db.admin, [
        'media.read',
        'media.administer',
        'content.read',
        'content.publish',
        'library.administer',
      ]),
    };
    reciterId = await person(db.admin, `fixture-reciter-one-${randomUUID().slice(0, 8)}`);

    audioTracks = await count('SELECT COUNT(*) AS n FROM [dbo].[AudioTrack];');
  }, 600_000);

  afterAll(async () => {
    await db?.close();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  });

  describe('uploading: only a live administrator, only to a current segment, only what Storage cleared', () => {
    it('streams, sniffs, scans and records a genuine MP3 under the uploaded version', async () => {
      const created = await recitation();
      const segment = created.segments[0]!;
      const saved = await upload(
        administrator,
        created.id,
        created.version,
        segment.id,
        once(AUDIO),
        file,
      );
      expect(saved.version).toBe(created.version + 1);
      const assetId = saved.segments.find((entry) => entry.id === segment.id)?.assetId;
      expect(assetId).toEqual(expect.any(String));
      expect(saved.segments.find((entry) => entry.id !== segment.id)?.assetId).toBeNull();

      const [row] = await db.admin.query<{
        state: string;
        mediaType: string;
        byteSize: number;
        checksum: string;
      }>(
        `SELECT [state],[mediaType],[byteSize],[checksum] FROM [dbo].[Asset] WHERE [id]=N'${String(assetId)}';`,
      );
      expect(row).toMatchObject({
        state: 'clean',
        mediaType: 'audio/mpeg',
        checksum: sha256(AUDIO),
      });
      expect(Number(row?.byteSize)).toBe(AUDIO.byteLength);
      expect(
        await count(
          `SELECT COUNT(*) AS n FROM [dbo].[AuditLog] WHERE [action]=N'quran.recitation.asset-attached' AND [targetId]=N'${created.id}';`,
        ),
      ).toBe(1);
    });

    it('stores no byte for a reader, another context’s administrator or a revoked administrator', async () => {
      const created = await recitation();
      const segment = created.segments[0]!;
      const revoked = {
        accountId: await accountWith(db.admin, ['quran.read', 'quran.administer']),
      };
      await db.admin.query(
        `DELETE rp FROM [dbo].[RolePermission] rp
           JOIN [dbo].[RoleAssignment] ra ON ra.[roleId] = rp.[roleId]
          WHERE ra.[userId] = N'${revoked.accountId}' AND rp.[permissionKey] = N'quran.administer';`,
      );
      const assets = await count('SELECT COUNT(*) AS n FROM [dbo].[Asset];');
      const onDisk = filesOnDisk();

      for (const actor of [quranReader, mediaAdministrator, revoked, { accountId: '' }])
        expect(
          await refusal(
            upload(actor, created.id, created.version, segment.id, once(AUDIO), file),
          ),
          actor.accountId,
        ).toBe('denied');

      expect(await count('SELECT COUNT(*) AS n FROM [dbo].[Asset];')).toBe(assets);
      expect(filesOnDisk()).toBe(onDisk);
      expect(await persistence.segmentAssetForPreview(created.id, segment.id)).toBeNull();
    });

    it('stores no byte for a stale version, an unknown segment or an unknown Recitation', async () => {
      const created = await recitation();
      const segment = created.segments[0]!;
      const assets = await count('SELECT COUNT(*) AS n FROM [dbo].[Asset];');
      const onDisk = filesOnDisk();

      expect(
        await refusal(
          upload(
            administrator,
            created.id,
            created.version - 1,
            segment.id,
            once(AUDIO),
            file,
          ),
        ),
      ).toBe('conflict');
      expect(
        await refusal(
          upload(
            administrator,
            created.id,
            created.version,
            randomUUID(),
            once(AUDIO),
            file,
          ),
        ),
      ).toBe('not-found');
      expect(
        await refusal(
          upload(administrator, randomUUID(), 1, segment.id, once(AUDIO), file),
        ),
      ).toBe('not-found');

      expect(await count('SELECT COUNT(*) AS n FROM [dbo].[Asset];')).toBe(assets);
      expect(filesOnDisk()).toBe(onDisk);
    });

    it.each([
      ['a PNG declared as audio', PNG, 'audio/mpeg'],
      ['an MP3 declared as an image', AUDIO, 'image/png'],
      ['a ZIP declared as audio', ZIP, 'audio/mpeg'],
    ])('refuses %s and records nothing', async (_label, bytes, declared) => {
      const created = await recitation();
      const segment = created.segments[0]!;
      expect(
        await refusal(
          upload(administrator, created.id, created.version, segment.id, once(bytes), {
            declaredMediaType: declared,
            displayName: 'renamed.mp3',
          }),
        ),
      ).toBe('type-not-allowed');
      expect(await persistence.segmentAssetForPreview(created.id, segment.id)).toBeNull();
      expect((await persistence.recitation(created.id))?.version).toBe(created.version);
    });

    it('keeps an unscannable upload in quarantine and never records it', async () => {
      const created = await recitation();
      const segment = created.segments[0]!;
      const quarantined =
        "SELECT COUNT(*) AS n FROM [dbo].[Asset] WHERE [state]=N'quarantined';";
      const before = await count(quarantined);
      expect(
        await refusal(
          uploadOffline(
            administrator,
            created.id,
            created.version,
            segment.id,
            once(AUDIO),
            file,
          ),
        ),
      ).toBe('not-cleared');
      expect(await persistence.segmentAssetForPreview(created.id, segment.id)).toBeNull();
      expect(await count(quarantined)).toBe(before + 1);
    });
  });

  describe('public serving: both owners must allow, for the whole file and for a range', () => {
    it('serves a published Recitation’s recorded segment audio, streamed with safe headers', async () => {
      const published = await publish(await withAudio());
      const { segmentId, assetId } = assetOf(published, 0);
      const response = await publicServe(published.id, segmentId, assetId);

      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toBe('audio/mpeg');
      expect(response.headers.get('content-length')).toBe(String(AUDIO.byteLength));
      expect(response.headers.get('accept-ranges')).toBe('bytes');
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(response.headers.get('x-content-type-options')).toBe('nosniff');
      expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
      expect(response.headers.get('content-disposition')).toBe('inline');
      expect((await body(response)).equals(Buffer.from(AUDIO))).toBe(true);
    });

    it('answers a byte range 206 with exactly that slice, and past the end 416', async () => {
      const published = await publish(await withAudio());
      const { segmentId, assetId } = assetOf(published, 1);

      const first = await publicServe(published.id, segmentId, assetId, {
        range: 'bytes=100-299',
      });
      expect(first.status).toBe(206);
      expect(first.headers.get('content-range')).toBe(
        `bytes 100-299/${String(AUDIO.byteLength)}`,
      );
      expect(first.headers.get('content-length')).toBe('200');
      expect((await body(first)).equals(Buffer.from(AUDIO.subarray(100, 300)))).toBe(
        true,
      );

      const tail = await publicServe(published.id, segmentId, assetId, {
        range: 'bytes=-17',
      });
      expect(tail.status).toBe(206);
      expect((await body(tail)).equals(Buffer.from(AUDIO.subarray(-17)))).toBe(true);

      const beyond = await publicServe(published.id, segmentId, assetId, {
        range: `bytes=${String(AUDIO.byteLength)}-`,
      });
      expect(beyond.status).toBe(416);
    });

    it('refuses a draft’s and an archived Recitation’s audio, whole or ranged, with the same 404', async () => {
      const draft = await withAudio();
      const drafted = assetOf(draft, 0);
      const published = await publish(await withAudio());
      const archived = await publish(published, 'archived');
      const withdrawn = assetOf(archived, 0);

      for (const range of [null, 'bytes=0-9']) {
        for (const [record, target] of [
          [draft, drafted],
          [archived, withdrawn],
        ] as const) {
          const response = await publicServe(
            record.id,
            target.segmentId,
            target.assetId,
            { range },
          );
          expect(response.status, `${record.state} ${String(range)}`).toBe(404);
          expect(response.headers.get('cache-control')).toBe('private, no-store');
        }
      }
    });

    it('refuses even the right asset while the corpus is deactivated', async () => {
      const published = await publish(await withAudio());
      const { segmentId, assetId } = assetOf(published, 0);
      expect((await publicServe(published.id, segmentId, assetId)).status).toBe(200);

      await deactivate();
      try {
        for (const range of [null, 'bytes=0-9'])
          expect(
            (await publicServe(published.id, segmentId, assetId, { range })).status,
          ).toBe(404);
        expect(await reader.recitationSegments(published.id, null)).toEqual([]);
      } finally {
        await activate();
      }
      expect((await publicServe(published.id, segmentId, assetId)).status).toBe(200);
    });

    it('refuses another segment’s file, another Recitation’s file and a guessed or malformed identifier', async () => {
      const mine = await publish(await withAudio());
      const theirs = await publish(await withAudio());
      const own = assetOf(mine, 0);
      const sibling = assetOf(mine, 1);
      const foreign = assetOf(theirs, 0);

      for (const [recitationId, segmentId, assetId] of [
        [mine.id, own.segmentId, sibling.assetId],
        [mine.id, own.segmentId, foreign.assetId],
        [mine.id, foreign.segmentId, foreign.assetId],
        [theirs.id, own.segmentId, own.assetId],
        [mine.id, own.segmentId, randomUUID()],
        [mine.id, randomUUID(), own.assetId],
        [randomUUID(), own.segmentId, own.assetId],
        ['not-an-identifier', own.segmentId, own.assetId],
        [mine.id, `${own.segmentId}x`, own.assetId],
      ])
        expect(
          (await publicServe(recitationId!, segmentId!, assetId!)).status,
          `${recitationId}/${segmentId}/${assetId}`,
        ).toBe(404);

      expect((await publicServe(mine.id, own.segmentId, own.assetId)).status).toBe(200);
    });
  });

  describe('administrative preview: a live quran.read, and only the recorded file', () => {
    it('lets a live quran.read holder hear a draft’s own segment audio, and nobody else', async () => {
      const draft = await withAudio();
      const own = assetOf(draft, 0);
      const sibling = assetOf(draft, 1);
      const revoked = { accountId: await accountWith(db.admin, ['quran.read']) };

      expect(
        (await preview(quranReader, draft.id, own.segmentId, own.assetId)).status,
      ).toBe(200);
      expect(
        (await preview(administrator, draft.id, own.segmentId, own.assetId)).status,
      ).toBe(200);
      expect((await preview(revoked, draft.id, own.segmentId, own.assetId)).status).toBe(
        200,
      );

      await db.admin.query(
        `DELETE rp FROM [dbo].[RolePermission] rp
           JOIN [dbo].[RoleAssignment] ra ON ra.[roleId] = rp.[roleId]
          WHERE ra.[userId] = N'${revoked.accountId}';`,
      );
      expect((await preview(revoked, draft.id, own.segmentId, own.assetId)).status).toBe(
        404,
      );
      expect(
        (await preview(mediaAdministrator, draft.id, own.segmentId, own.assetId)).status,
      ).toBe(404);
      expect(
        (await preview({ accountId: '' }, draft.id, own.segmentId, own.assetId)).status,
      ).toBe(404);
      // Only the file RECORDED against that exact segment.
      expect(
        (await preview(quranReader, draft.id, own.segmentId, sibling.assetId)).status,
      ).toBe(404);
      expect(
        (await preview(quranReader, draft.id, own.segmentId, randomUUID())).status,
      ).toBe(404);
    });
  });

  describe('replacing a segment’s file never destroys the one it replaced', () => {
    it('serves the new file, withholds the old, and keeps the old asset and bytes intact', async () => {
      const published = await publish(await withAudio());
      const old = assetOf(published, 0);
      const replaced = await upload(
        administrator,
        published.id,
        published.version,
        old.segmentId,
        once(REPLACEMENT),
        file,
      );
      const fresh = assetOf(replaced, 0);
      expect(fresh.assetId).not.toBe(old.assetId);

      const served = await publicServe(published.id, fresh.segmentId, fresh.assetId);
      expect((await body(served)).equals(Buffer.from(REPLACEMENT))).toBe(true);
      expect((await publicServe(published.id, old.segmentId, old.assetId)).status).toBe(
        404,
      );

      const [row] = await db.admin.query<{ state: string; storageKey: string }>(
        `SELECT [state],[storageKey] FROM [dbo].[Asset] WHERE [id]=N'${old.assetId}';`,
      );
      expect(row?.state).toBe('clean');
      const files = await createFilesystemStore(root);
      expect(
        await files.verify(String(row?.storageKey), {
          byteSize: AUDIO.byteLength,
          checksum: sha256(AUDIO),
        }),
      ).toBe(true);
      expect(
        await count(
          `SELECT COUNT(*) AS n FROM [dbo].[AuditLog] WHERE [action]=N'quran.recitation.asset-replaced' AND [targetId]=N'${published.id}';`,
        ),
      ).toBe(1);
    });
  });

  it('creates no AudioTrack: a recitation is never a Media record', async () => {
    expect(await count('SELECT COUNT(*) AS n FROM [dbo].[AudioTrack];')).toBe(
      audioTracks,
    );
    expect(
      await count(
        `SELECT COUNT(*) AS n FROM [dbo].[AudioTrack] t JOIN [dbo].[QuranRecitationSegment] s ON s.[assetId] = t.[assetId];`,
      ),
    ).toBe(0);
  });
});
