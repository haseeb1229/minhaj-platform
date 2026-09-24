import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  AssetPersistencePort,
  StorageServicePort,
} from '../../packages/contracts/src/platform/storage.ts';
import type { MediaAssetRelationPort } from '../../packages/contracts/src/media/index.ts';
import { createClamAvScanner } from '../../packages/storage/src/scanner.ts';
import { createFilesystemStore } from '../../packages/storage/src/filesystem.ts';
import { createStorageService } from '../../packages/storage/src/service.ts';
import {
  sha256,
  syntheticSilentMp3,
} from '../../packages/database/src/lifecycle/phase11-fixture.ts';
import {
  newPhase5Fixture,
  writePhase5Fixture,
  type Phase5Fixture,
} from '../../packages/database/src/lifecycle/phase5-fixture.ts';
import {
  createAudioAssetPolicy,
  createAudioUpload,
  createMediaReadService,
  createMediaService,
  mediaFailure,
} from '../../apps/web/src/contexts/media/index.ts';
import { serveAudio } from '../../apps/web/src/app/assets/media/serve.ts';
import { createAuthorizationService } from '../../packages/server-core/src/authorization/index.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { createProofAccount } from '../people/harness.ts';

/**
 * Phase 11 — AudioTrack and AudioSeries over REAL SQL Server, a REAL filesystem
 * storage root and the REAL malware scanner, through the real Media service,
 * upload, adapter, serving policy and byte-serving function.
 *
 * WHAT ONLY THIS CAN PROVE:
 *
 *   - an audio file is streamed into Storage, sniffed from its BYTES, scanned
 *     by ClamAV, and attached only once cleared — and a spoofed, oversized or
 *     unscannable file is attached never;
 *   - BOTH owners must allow before a byte leaves the disk: a published track's
 *     own file serves, and a draft's file, another track's file, a replaced file,
 *     a guessed identifier and a file whose bytes vanished are the same 404;
 *   - a RANGE is authorised exactly as the whole file, and answered 206, 416 or
 *     200 by the rules a player relies on;
 *   - replacing a file never destroys the one it replaced;
 *   - slug history, series order, the published-has-audio rule, audit and the
 *     durable search intent hold in the database, whoever writes.
 *
 * RUNS ONLY WHERE BOTH GENUINELY EXIST — a configured database and a scanner
 * that answers — and `scripts/assert-storage-proofs.mjs` makes CI fail if it
 * was skipped. EVERYTHING IS SYNTHETIC: the audio is generated silence.
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

live('Phase 11 audio against real SQL Server, Storage and ClamAV', () => {
  let db: DisposableDatabase;
  let root: string;
  let people: Phase5Fixture;
  let topicId: string;
  let assets: AssetPersistencePort;
  let storage: StorageServicePort;
  let relations: MediaAssetRelationPort;
  let service: ReturnType<typeof createMediaService>;
  let reads: ReturnType<typeof createMediaReadService>;
  let upload: ReturnType<typeof createAudioUpload>['uploadAudio'];
  let uploadOffline: ReturnType<typeof createAudioUpload>['uploadAudio'];
  let uploadTiny: ReturnType<typeof createAudioUpload>['uploadAudio'];
  let permits: (accountId: string, key: string) => Promise<boolean>;
  let curator: { accountId: string };
  let reader: { accountId: string };

  let sequence = 0;
  const unique = (prefix: string) => {
    sequence += 1;
    return `${prefix}-${String(sequence)}-${Date.now().toString(36)}`;
  };

  const trackInput = (overrides: Record<string, unknown> = {}) => ({
    slug: unique('track'),
    primaryLocale: 'en',
    state: 'draft',
    languageCode: 'en',
    labels: [
      { locale: 'en', title: 'Synthetic non-authoritative recording', description: '' },
    ],
    durationSeconds: 1,
    recordedOn: '2020-01-02',
    transcript: null,
    seriesId: null,
    seriesPosition: null,
    speakerIds: [people.linkedPersonId],
    topicIds: [topicId],
    ...overrides,
  });

  const editable = (record: Record<string, unknown>) => {
    const {
      id: _id,
      version: _version,
      updatedAt: _updatedAt,
      assetId: _assetId,
      series,
      ...rest
    } = record;
    const ref = series as { id: string; position: number } | null;
    return { ...rest, seriesId: ref?.id ?? null, seriesPosition: ref?.position ?? null };
  };

  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return mediaFailure(error);
    }
    return 'accepted';
  };

  const count = async (sql: string): Promise<number> => {
    const [row] = await db.admin.query<{ n: number }>(sql);
    return Number(row?.n ?? -1);
  };

  const file = { declaredMediaType: 'audio/mpeg', displayName: 'synthetic.mp3' };

  const publicServe = (
    trackId: string,
    assetId: string,
    headers: { range?: string | null; ifRange?: string | null } = {},
  ) =>
    serveAudio(
      storage,
      assetId,
      createAudioAssetPolicy({ relations, request: { trackId, assetId } }),
      { range: headers.range ?? null, ifRange: headers.ifRange ?? null },
    );

  /** A draft track with its file uploaded, cleared and attached. */
  async function trackWithAudio(bytes = AUDIO) {
    const created = await service.saveAudioTrack(curator, null, null, trackInput());
    const saved = await upload(curator, created.id, created.version, once(bytes), file);
    if (saved.assetId === null) throw new Error('upload attached nothing');
    return saved;
  }

  async function publish(record: Awaited<ReturnType<typeof trackWithAudio>>) {
    return service.saveAudioTrack(
      curator,
      record.id,
      record.version,
      editable({ ...record, state: 'published' }),
    );
  }

  async function account(keys: readonly string[]): Promise<{ accountId: string }> {
    const id = await createProofAccount(db.admin);
    const role = randomUUID();
    await db.admin.query(
      `INSERT INTO [Role] ([id],[key],[name],[description],[system]) VALUES (N'${role}',N'proof-${role}',N'Synthetic audio role',N'Test fixture',0); INSERT INTO [RoleAssignment] ([userId],[roleId]) VALUES (N'${id}',N'${role}');`,
    );
    for (const key of keys) {
      await db.admin.query(
        `INSERT INTO [RolePermission] ([roleId],[permissionKey]) VALUES (N'${role}',N'${key}');`,
      );
    }
    return { accountId: id };
  }

  beforeAll(async () => {
    db = await createProofDatabase();
    root = mkdtempSync(path.join(tmpdir(), 'minhaj-audio-proof-'));

    const database = await import('../../packages/database/src/index.ts');
    const { createAuthorizationReader } =
      await import('../../packages/database/src/adapters/identity-access/index.ts');

    people = newPhase5Fixture();
    await writePhase5Fixture(db.admin, people);
    const [topic] = await db.admin.query<{ id: string }>(
      "SELECT TOP 1 [id] FROM [Topic] WHERE [status]=N'active' ORDER BY [id];",
    );
    if (topic === undefined) throw new Error('No seeded Topic is available.');
    topicId = topic.id;

    assets = database.createAssetPersistence();
    const files = await createFilesystemStore(root);
    const scanner = createClamAvScanner({ host: HOST, port: PORT, timeoutMs: 60_000 });
    storage = createStorageService({
      files,
      assets,
      scanner,
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
    // A foundation ceiling below the synthetic file, so "too large" is real.
    const tiny = createStorageService({ files, assets, scanner, maxBytes: 4096 });

    const authorization = createAuthorizationService({
      reader: createAuthorizationReader(),
    });
    permits = (id, key) => authorization.hasPermission(id, key);
    const persistence = database.createMediaPersistence();
    service = createMediaService({
      persistence,
      authority: { permits },
      references: {
        validPeople: async () => true,
        validTopics: async () => true,
        validLanguage: async () => true,
      },
    });
    const uploads = (target: StorageServicePort) =>
      createAudioUpload({
        persistence,
        authority: { permits },
        storage: async () => target,
      }).uploadAudio;
    upload = uploads(storage);
    uploadOffline = uploads(offline);
    uploadTiny = uploads(tiny);
    reads = createMediaReadService(database.createMediaPublicReader());
    relations = database.createMediaAssetRelations();

    curator = await account(['media.read', 'media.administer']);
    reader = await account(['media.read']);
  }, 600_000);

  afterAll(async () => {
    await db?.close();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  });

  describe('uploading: Storage decides what the bytes are, and attaches only what it cleared', () => {
    it('streams, sniffs, scans and attaches a genuine MP3 under the uploaded version', async () => {
      const created = await service.saveAudioTrack(curator, null, null, trackInput());
      const saved = await upload(curator, created.id, created.version, once(AUDIO), file);

      expect(saved.assetId).not.toBeNull();
      expect(saved.version).toBe(created.version + 1);

      const [row] = await db.admin.query<{
        state: string;
        mediaType: string;
        byteSize: number;
        checksum: string;
      }>(
        `SELECT [state],[mediaType],[byteSize],[checksum] FROM [Asset] WHERE [id]=N'${String(saved.assetId)}';`,
      );
      expect(row).toMatchObject({
        state: 'clean',
        mediaType: 'audio/mpeg',
        checksum: sha256(AUDIO),
      });
      expect(Number(row?.byteSize)).toBe(AUDIO.byteLength);

      expect(
        await count(
          `SELECT COUNT(*) AS n FROM [AuditLog] WHERE [action]=N'media.audio.asset.attached' AND [targetId]=N'${created.id}';`,
        ),
      ).toBe(1);
    });

    it.each([
      ['a PNG declared as audio', PNG, 'audio/mpeg'],
      ['an MP3 declared as an image', AUDIO, 'image/png'],
      ['a ZIP declared as audio', ZIP, 'audio/mpeg'],
    ])('refuses %s and attaches nothing', async (_label, bytes, declared) => {
      const created = await service.saveAudioTrack(curator, null, null, trackInput());
      expect(
        await refusal(
          upload(curator, created.id, created.version, once(bytes), {
            declaredMediaType: declared,
            displayName: 'renamed.mp3',
          }),
        ),
      ).toBe('unsupported');
      expect((await service.audioTrack(curator, created.id))?.assetId).toBeNull();
    });

    it('refuses a file past the ceiling during the stream', async () => {
      const created = await service.saveAudioTrack(curator, null, null, trackInput());
      expect(
        await refusal(
          uploadTiny(curator, created.id, created.version, once(AUDIO), file),
        ),
      ).toBe('too-large');
      expect((await service.audioTrack(curator, created.id))?.assetId).toBeNull();
    });

    it('keeps an unscannable upload in quarantine and never attaches it', async () => {
      const created = await service.saveAudioTrack(curator, null, null, trackInput());
      const before = await count(
        "SELECT COUNT(*) AS n FROM [Asset] WHERE [state]=N'quarantined';",
      );
      expect(
        await refusal(
          uploadOffline(curator, created.id, created.version, once(AUDIO), file),
        ),
      ).toBe('not-cleared');
      expect((await service.audioTrack(curator, created.id))?.assetId).toBeNull();
      expect(
        await count("SELECT COUNT(*) AS n FROM [Asset] WHERE [state]=N'quarantined';"),
      ).toBe(before + 1);
    });

    it('stores nothing for a stale version, a reader, or a missing track', async () => {
      const created = await service.saveAudioTrack(curator, null, null, trackInput());
      const assetsBefore = await count('SELECT COUNT(*) AS n FROM [Asset];');

      expect(
        await refusal(
          upload(curator, created.id, created.version + 1, once(AUDIO), file),
        ),
      ).toBe('conflict');
      expect(
        await refusal(upload(reader, created.id, created.version, once(AUDIO), file)),
      ).toBe('denied');
      expect(await refusal(upload(curator, randomUUID(), 1, once(AUDIO), file))).toBe(
        'not-found',
      );
      expect(await count('SELECT COUNT(*) AS n FROM [Asset];')).toBe(assetsBefore);
    });
  });

  describe('publishing needs audio, and the database agrees', () => {
    it('refuses to publish a track without a file, through the service and in SQL', async () => {
      const created = await service.saveAudioTrack(curator, null, null, trackInput());
      expect(
        await refusal(
          service.saveAudioTrack(
            curator,
            created.id,
            created.version,
            editable({ ...created, state: 'published' }),
          ),
        ),
      ).toBe('no-audio');
      expect(
        await refusal(
          service.saveAudioTrack(curator, null, null, trackInput({ state: 'published' })),
        ),
      ).toBe('no-audio');
      await expect(
        db.admin.query(
          `UPDATE [AudioTrack] SET [state]=N'published' WHERE [id]=N'${created.id}';`,
        ),
      ).rejects.toThrow();
    });

    it('publishes once the file is attached, with durable search intent and audit', async () => {
      const published = await publish(await trackWithAudio());
      expect(published.state).toBe('published');
      expect(
        await count(
          `SELECT COUNT(*) AS n FROM [SearchIndexRequest] WHERE [scopeKind]=N'audio' AND [scopeId]=N'${published.id}';`,
        ),
      ).toBeGreaterThan(0);
      expect(
        await count(
          `SELECT COUNT(*) AS n FROM [AuditLog] WHERE [action]=N'media.audio.track.updated' AND [targetId]=N'${published.id}';`,
        ),
      ).toBeGreaterThan(0);
      expect((await reads.audioTrack(published.slug))?.id).toBe(published.id);
    });
  });

  describe('serving: both owners must allow, for the whole file and for a range', () => {
    it('serves a published track’s own file, streamed with safe headers', async () => {
      const track = await publish(await trackWithAudio());
      const response = await publicServe(track.id, String(track.assetId));

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

    it('answers a range 206, a suffix 206, past the end 416, and anything malformed whole', async () => {
      const track = await publish(await trackWithAudio());
      const asset = String(track.assetId);

      const first = await publicServe(track.id, asset, { range: 'bytes=0-99' });
      expect(first.status).toBe(206);
      expect(first.headers.get('content-range')).toBe(
        `bytes 0-99/${String(AUDIO.byteLength)}`,
      );
      expect(first.headers.get('content-length')).toBe('100');
      expect((await body(first)).equals(Buffer.from(AUDIO.subarray(0, 100)))).toBe(true);

      const tail = await publicServe(track.id, asset, { range: 'bytes=-17' });
      expect(tail.status).toBe(206);
      expect((await body(tail)).equals(Buffer.from(AUDIO.subarray(-17)))).toBe(true);

      const beyond = await publicServe(track.id, asset, {
        range: `bytes=${String(AUDIO.byteLength)}-`,
      });
      expect(beyond.status).toBe(416);
      expect(beyond.headers.get('content-range')).toBe(
        `bytes */${String(AUDIO.byteLength)}`,
      );

      for (const headers of [
        { range: 'bytes=0-1,5-9' },
        { range: 'items=0-5' },
        { range: 'bytes=9-1' },
        { range: 'bytes=0-99', ifRange: '"anything"' },
      ]) {
        const whole = await publicServe(track.id, asset, headers);
        expect(whole.status, JSON.stringify(headers)).toBe(200);
        expect((await body(whole)).byteLength).toBe(AUDIO.byteLength);
      }
    });

    it('refuses a draft’s file, whole or ranged, with the same 404', async () => {
      const draft = await trackWithAudio();
      for (const range of [null, 'bytes=0-9']) {
        const response = await publicServe(draft.id, String(draft.assetId), { range });
        expect(response.status).toBe(404);
        expect(response.headers.get('cache-control')).toBe('private, no-store');
      }
    });

    it('refuses another track’s file, a guessed identifier and an archived track', async () => {
      const mine = await publish(await trackWithAudio());
      const theirs = await publish(await trackWithAudio());

      expect((await publicServe(mine.id, String(theirs.assetId))).status).toBe(404);
      expect((await publicServe(mine.id, randomUUID())).status).toBe(404);
      expect((await publicServe(randomUUID(), String(mine.assetId))).status).toBe(404);

      const archived = await service.saveAudioTrack(
        curator,
        mine.id,
        mine.version,
        editable({ ...mine, state: 'archived' }),
      );
      expect((await publicServe(archived.id, String(archived.assetId))).status).toBe(404);
      expect(await reads.audioTrack(archived.slug)).toBeNull();
    });

    it('lets only a live administrator preview a draft, and only its own file', async () => {
      const draft = await trackWithAudio();
      const other = await trackWithAudio();
      const preview = (account: { accountId: string }, assetId: string) =>
        serveAudio(
          storage,
          assetId,
          createAudioAssetPolicy({
            relations,
            request: { trackId: draft.id, assetId },
            preview: { accountId: account.accountId, authority: { permits } },
          }),
          { range: null, ifRange: null },
        );

      expect((await preview(curator, String(draft.assetId))).status).toBe(200);
      expect((await preview(reader, String(draft.assetId))).status).toBe(404);
      expect((await preview(curator, String(other.assetId))).status).toBe(404);
    });

    it('refuses a file whose bytes have gone, rather than serving an empty body', async () => {
      const track = await publish(await trackWithAudio());
      const [row] = await db.admin.query<{ storageKey: string }>(
        `SELECT [storageKey] FROM [Asset] WHERE [id]=N'${String(track.assetId)}';`,
      );
      rmSync(path.join(root, ...String(row?.storageKey).split('/')), { force: true });

      expect((await publicServe(track.id, String(track.assetId))).status).toBe(404);
      expect(
        await storage.open(
          String(track.assetId),
          createAudioAssetPolicy({
            relations,
            request: { trackId: track.id, assetId: String(track.assetId) },
          }),
        ),
      ).toBeNull();
      // The track itself is still published: unavailable is not unpublished.
      expect((await reads.audioTrack(track.slug))?.id).toBe(track.id);
    });
  });

  describe('replacing a file never destroys the one it replaced', () => {
    it('serves the new file, withholds the old, and keeps the old bytes intact', async () => {
      const first = await publish(await trackWithAudio());
      const oldAsset = String(first.assetId);
      const replaced = await upload(
        curator,
        first.id,
        first.version,
        once(REPLACEMENT),
        file,
      );
      const newAsset = String(replaced.assetId);

      expect(newAsset).not.toBe(oldAsset);
      expect(
        (await body(await publicServe(first.id, newAsset))).equals(
          Buffer.from(REPLACEMENT),
        ),
      ).toBe(true);
      expect((await publicServe(first.id, oldAsset)).status).toBe(404);

      const [old] = await db.admin.query<{ state: string; storageKey: string }>(
        `SELECT [state],[storageKey] FROM [Asset] WHERE [id]=N'${oldAsset}';`,
      );
      expect(old?.state).toBe('clean');
      const files = await createFilesystemStore(root);
      expect(
        await files.verify(String(old?.storageKey), {
          byteSize: AUDIO.byteLength,
          checksum: sha256(AUDIO),
        }),
      ).toBe(true);
      expect(
        await count(
          `SELECT COUNT(*) AS n FROM [AuditLog] WHERE [action]=N'media.audio.asset.replaced' AND [targetId]=N'${first.id}';`,
        ),
      ).toBe(1);
    });

    it('rejects a replacement uploaded against a stale version', async () => {
      const track = await trackWithAudio();
      expect(
        await refusal(
          upload(curator, track.id, track.version - 1, once(REPLACEMENT), file),
        ),
      ).toBe('conflict');
      expect((await service.audioTrack(curator, track.id))?.assetId).toBe(track.assetId);
    });
  });

  describe('slugs, series and concurrency in the database', () => {
    it('reserves a former slug for ever and resolves it to the current one', async () => {
      const track = await publish(await trackWithAudio());
      const renamed = await service.saveAudioTrack(
        curator,
        track.id,
        track.version,
        editable({ ...track, slug: unique('renamed') }),
      );

      expect(await reads.audioTrackCanonicalSlug(track.slug)).toBe(renamed.slug);
      expect(
        await refusal(
          service.saveAudioTrack(curator, null, null, trackInput({ slug: track.slug })),
        ),
      ).toBe('duplicate-slug');
    });

    it('holds one track per place in an AudioSeries, and resolves a renamed series', async () => {
      const series = await service.saveAudioSeries(curator, null, null, {
        slug: unique('audio-series'),
        primaryLocale: 'en',
        state: 'published',
        labels: [{ locale: 'en', title: 'Synthetic audio series', description: '' }],
      });
      await service.saveAudioTrack(
        curator,
        null,
        null,
        trackInput({ seriesId: series.id, seriesPosition: 1 }),
      );
      expect(
        await refusal(
          service.saveAudioTrack(
            curator,
            null,
            null,
            trackInput({ seriesId: series.id, seriesPosition: 1 }),
          ),
        ),
      ).toBe('duplicate-position');

      const renamed = await service.saveAudioSeries(curator, series.id, series.version, {
        slug: unique('audio-series-renamed'),
        primaryLocale: 'en',
        state: 'published',
        labels: [{ locale: 'en', title: 'Synthetic audio series', description: '' }],
      });
      expect(await reads.audioSeriesCanonicalSlug(series.slug)).toBe(renamed.slug);
    });

    it('lists only current, published canonical addresses in the sitemap read', async () => {
      const current = await publish(await trackWithAudio());
      const renamed = await service.saveAudioTrack(
        curator,
        current.id,
        current.version,
        editable({ ...current, slug: unique('sitemap-renamed') }),
      );
      const draft = await trackWithAudio();

      const slugs: string[] = [];
      for (let offset = 0; ; offset += 5000) {
        const page = await reads.audioSitemap('track', offset, 5000);
        slugs.push(...page.map((row) => row.slug));
        if (page.length < 5000) break;
      }
      expect(slugs).toContain(renamed.slug);
      expect(slugs).not.toContain(current.slug);
      expect(slugs).not.toContain(draft.slug);
    });

    it('rejects a stale save instead of overwriting', async () => {
      const created = await service.saveAudioTrack(curator, null, null, trackInput());
      await service.saveAudioTrack(
        curator,
        created.id,
        created.version,
        editable(created),
      );
      expect(
        await refusal(
          service.saveAudioTrack(curator, created.id, created.version, editable(created)),
        ),
      ).toBe('conflict');
    });

    it('withholds an unpublished series from a public track and its listing', async () => {
      const series = await service.saveAudioSeries(curator, null, null, {
        slug: unique('audio-series-draft'),
        primaryLocale: 'en',
        state: 'draft',
        labels: [{ locale: 'en', title: 'Synthetic draft series', description: '' }],
      });
      const created = await service.saveAudioTrack(
        curator,
        null,
        null,
        trackInput({ seriesId: series.id, seriesPosition: 1 }),
      );
      const withAudio = await upload(
        curator,
        created.id,
        created.version,
        once(AUDIO),
        file,
      );
      const track = await publish(withAudio);

      expect((await reads.audioTrack(track.slug))?.series).toBeNull();
      expect(await reads.audioSeries(series.slug)).toBeNull();
      expect((await reads.audioSeriesTracks(series.id)).items).toEqual([]);
    });
  });
});
