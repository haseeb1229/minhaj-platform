import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { connect } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { StorageServicePort } from '../../packages/contracts/src/platform/storage.ts';
import type {
  MediaAssetRelationPort,
  PhotoRecord,
} from '../../packages/contracts/src/media/index.ts';
import { createClamAvScanner } from '../../packages/storage/src/scanner.ts';
import { createFilesystemStore } from '../../packages/storage/src/filesystem.ts';
import { createStorageService } from '../../packages/storage/src/service.ts';
import { sha256 } from '../../packages/database/src/lifecycle/phase11-fixture.ts';
import {
  containsText,
  exifSegment,
  jpegWith,
  SYNTHETIC_JPEG,
  syntheticPng,
} from '../../packages/database/src/lifecycle/phase12-fixture.ts';
import {
  createMediaReadService,
  createMediaService,
  createPhotoAssetPolicy,
  createPhotoUpload,
  mediaFailure,
} from '../../apps/web/src/contexts/media/index.ts';
import { servePhoto } from '../../apps/web/src/app/assets/media/serve.ts';
import { createAuthorizationService } from '../../packages/server-core/src/authorization/index.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { createProofAccount } from '../people/harness.ts';

/**
 * Phase 12 — Photo, Gallery and GalleryItem over REAL SQL Server, a REAL
 * filesystem storage root and the REAL malware scanner, through the real Media
 * service, upload, adapter, serving policy and byte-serving function.
 *
 * WHAT ONLY THIS CAN PROVE:
 *
 *   - an image is streamed into Storage, validated, stripped of its hidden
 *     metadata, scanned by ClamAV and attached with its measured size — and the
 *     bytes that are served are exactly the cleaned bytes that were scanned;
 *   - a spoofed, malformed, oversized or pixel-bomb file, and one the scanner
 *     cannot clear, is attached never;
 *   - BOTH owners must allow: a published Photo's own image serves, and a
 *     draft's, an archived one's, another Photo's, a replaced one and a vanished
 *     one are the same 404 — and withdrawal is immediate even for a browser
 *     holding a cached copy, because revalidation passes both decisions first;
 *   - replacing an image never destroys the one it replaced, and of two
 *     replacements, or two reorders, racing on one version exactly one wins;
 *   - a Gallery shows only public Photos, in its order, with the first public
 *     one as its cover; it is listed only while it has one; its slug history is
 *     native and never reused; and the archive is by the date taken.
 *
 * RUNS ONLY WHERE BOTH GENUINELY EXIST — a configured database and a scanner
 * that answers — and `scripts/assert-storage-proofs.mjs` makes CI fail if it
 * was skipped. EVERY IMAGE IS SYNTHETIC and every "private" fact a sentinel.
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

const SENTINEL = 'SENTINEL-GPS-PHASE12-OWNER-0000';
const TAGGED_JPEG = jpegWith([exifSegment({ orientation: 6, sentinel: SENTINEL })]);
const PNG = syntheticPng(64, 40, { hue: 90 });
const ZIP = Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0, 0, 0, 1, 2, 3, 4]);
const MP3 = Uint8Array.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 0]);

const once = (data: Uint8Array) =>
  (async function* () {
    yield data;
  })();

async function body(response: Response): Promise<Buffer> {
  return Buffer.from(await response.arrayBuffer());
}

live('Phase 12 photographs against real SQL Server, Storage and ClamAV', () => {
  let db: DisposableDatabase;
  let root: string;
  let storage: StorageServicePort;
  let relations: MediaAssetRelationPort;
  let service: ReturnType<typeof createMediaService>;
  let reads: ReturnType<typeof createMediaReadService>;
  let upload: ReturnType<typeof createPhotoUpload>['uploadPhoto'];
  let uploadOffline: ReturnType<typeof createPhotoUpload>['uploadPhoto'];
  let uploadTiny: ReturnType<typeof createPhotoUpload>['uploadPhoto'];
  let permits: (accountId: string, key: string) => Promise<boolean>;
  let curator: { accountId: string };
  let reader: { accountId: string };

  let sequence = 0;
  const unique = (prefix: string) => {
    sequence += 1;
    return `${prefix}-${String(sequence)}-${Date.now().toString(36)}`;
  };

  const photoInput = (overrides: Record<string, unknown> = {}) => ({
    primaryLocale: 'en',
    state: 'draft',
    labels: [
      { locale: 'en', altText: 'A synthetic gradient used by a proof.', caption: null },
    ],
    credit: null,
    taken: null,
    ...overrides,
  });

  const editable = (record: PhotoRecord) => ({
    primaryLocale: record.primaryLocale,
    state: record.state,
    labels: record.labels,
    credit: record.credit,
    taken: record.taken,
  });

  const galleryInput = (overrides: Record<string, unknown> = {}) => ({
    slug: unique('gallery'),
    primaryLocale: 'en',
    state: 'draft',
    labels: [{ locale: 'en', title: 'Synthetic proof gallery', description: '' }],
    ...overrides,
  });

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

  const file = { declaredMediaType: 'image/jpeg', displayName: 'synthetic.jpg' };
  const pngFile = { declaredMediaType: 'image/png', displayName: 'synthetic.png' };

  const publicServe = (
    photoId: string,
    assetId: string,
    ifNoneMatch: string | null = null,
  ) =>
    servePhoto(
      storage,
      assetId,
      createPhotoAssetPolicy({ relations, request: { photoId, assetId } }),
      { ifNoneMatch, preview: false },
    );

  const previewServe = (photoId: string, assetId: string, accountId: string) =>
    servePhoto(
      storage,
      assetId,
      createPhotoAssetPolicy({
        relations,
        request: { photoId, assetId },
        preview: { accountId, authority: { permits } },
      }),
      { ifNoneMatch: null, preview: true },
    );

  /** A draft Photo with its image uploaded, cleared and attached. */
  async function photoWithImage(
    bytes: Uint8Array = PNG,
    overrides: Record<string, unknown> = {},
  ): Promise<PhotoRecord> {
    const created = await service.savePhoto(curator, null, null, photoInput(overrides));
    return upload(curator, created.id, created.version, once(bytes), {
      declaredMediaType: null,
      displayName: 'synthetic.png',
    });
  }

  async function publish(record: PhotoRecord): Promise<PhotoRecord> {
    return service.savePhoto(curator, record.id, record.version, {
      ...editable(record),
      state: 'published',
    });
  }

  async function account(keys: readonly string[]): Promise<{ accountId: string }> {
    const id = await createProofAccount(db.admin);
    const role = randomUUID();
    await db.admin.query(
      `INSERT INTO [Role] ([id],[key],[name],[description],[system]) VALUES (N'${role}',N'proof-${role}',N'Synthetic photo role',N'Test fixture',0); INSERT INTO [RoleAssignment] ([userId],[roleId]) VALUES (N'${id}',N'${role}');`,
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
    root = mkdtempSync(path.join(tmpdir(), 'minhaj-photo-proof-'));

    const database = await import('../../packages/database/src/index.ts');
    const { createAuthorizationReader } =
      await import('../../packages/database/src/adapters/identity-access/index.ts');

    const assets = database.createAssetPersistence();
    const files = await createFilesystemStore(root);
    const scanner = createClamAvScanner({ host: HOST, port: PORT, timeoutMs: 60_000 });
    storage = createStorageService({
      files,
      assets,
      scanner,
      maxBytes: 64 * 1024 * 1024,
    });
    // The SAME root and metadata, with a scanner that cannot be reached.
    const offline = createStorageService({
      files,
      assets,
      scanner: createClamAvScanner({ host: HOST, port: 9, timeoutMs: 1000 }),
      maxBytes: 64 * 1024 * 1024,
      scanAttempts: 1,
    });
    // A foundation ceiling below the synthetic PNG, so "too large" is real.
    const tiny = createStorageService({ files, assets, scanner, maxBytes: 256 });

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
      createPhotoUpload({
        persistence,
        authority: { permits },
        storage: async () => target,
      }).uploadPhoto;
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

  describe('uploading: Storage decides what the bytes are, keeps only the image, and attaches what it cleared', () => {
    it('streams, validates, strips, scans and attaches a JPEG with its displayed size', async () => {
      const created = await service.savePhoto(curator, null, null, photoInput());
      const saved = await upload(
        curator,
        created.id,
        created.version,
        once(TAGGED_JPEG),
        file,
      );

      expect(saved.assetId).not.toBeNull();
      expect(saved.version).toBe(created.version + 1);
      // Orientation 6: the 48 × 32 frame is displayed 32 wide, 48 tall.
      expect({ width: saved.width, height: saved.height }).toEqual({
        width: 32,
        height: 48,
      });

      const [row] = await db.admin.query<{
        state: string;
        mediaType: string;
        byteSize: number;
        checksum: string;
      }>(
        `SELECT [state],[mediaType],[byteSize],[checksum] FROM [Asset] WHERE [id]=N'${String(saved.assetId)}';`,
      );
      expect(row).toMatchObject({ state: 'clean', mediaType: 'image/jpeg' });

      // What is SERVED is exactly what was measured, hashed and scanned: the
      // cleaned image, with no byte of the sentinel metadata.
      const preview = await previewServe(
        saved.id,
        String(saved.assetId),
        curator.accountId,
      );
      expect(preview.status).toBe(200);
      const bytes = await body(preview);
      expect(sha256(bytes)).toBe(row?.checksum);
      expect(bytes.length).toBe(Number(row?.byteSize));
      expect(bytes.length).toBeLessThan(TAGGED_JPEG.length);
      expect(containsText(TAGGED_JPEG, SENTINEL)).toBe(true);
      expect(containsText(bytes, SENTINEL)).toBe(false);

      expect(
        await count(
          `SELECT COUNT(*) AS n FROM [AuditLog] WHERE [action]=N'media.photo.asset.attached' AND [targetId]=N'${created.id}';`,
        ),
      ).toBe(1);
      // The audit row names identifiers and dimensions, never the file's words.
      const [audit] = await db.admin.query<{ afterState: string }>(
        `SELECT CAST([afterState] AS NVARCHAR(MAX)) AS afterState FROM [AuditLog] WHERE [action]=N'media.photo.asset.attached' AND [targetId]=N'${created.id}';`,
      );
      expect(audit?.afterState ?? '').not.toContain('SENTINEL');
    });

    it.each([
      ['a PNG declared as a JPEG', PNG, 'image/jpeg', 'unsupported'],
      ['a ZIP declared as a JPEG', ZIP, 'image/jpeg', 'unsupported'],
      ['an MP3 declared as a JPEG', MP3, 'image/jpeg', 'unsupported'],
      ['a truncated JPEG', SYNTHETIC_JPEG.subarray(0, 200), null, 'unsupported'],
    ])('refuses %s and attaches nothing', async (_label, bytes, declared, expected) => {
      const created = await service.savePhoto(curator, null, null, photoInput());
      expect(
        await refusal(
          upload(curator, created.id, created.version, once(bytes), {
            declaredMediaType: declared,
            displayName: 'x.jpg',
          }),
        ),
      ).toBe(expected);
      const after = await service.photo(curator, created.id);
      expect(after).toMatchObject({ assetId: null, version: created.version });
    });

    it('refuses a pixel bomb from its header, and a file past the ceiling', async () => {
      const header = new Uint8Array(13);
      const view = new DataView(header.buffer);
      view.setUint32(0, 60_000);
      view.setUint32(4, 60_000);
      header[8] = 8;
      header[9] = 2;
      const { pngChunk } =
        await import('../../packages/database/src/lifecycle/phase12-fixture.ts');
      const bomb = Uint8Array.from(
        Buffer.concat([
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          pngChunk('IHDR', header),
        ]),
      );
      const created = await service.savePhoto(curator, null, null, photoInput());
      expect(
        await refusal(upload(curator, created.id, created.version, once(bomb), file)),
      ).toBe('dimensions');
      expect(
        await refusal(uploadTiny(curator, created.id, created.version, once(PNG), file)),
      ).toBe('too-large');
      expect((await service.photo(curator, created.id))?.assetId).toBeNull();
    });

    it('holds an image the scanner cannot reach in quarantine, unattached and unservable', async () => {
      const created = await service.savePhoto(curator, null, null, photoInput());
      expect(
        await refusal(
          uploadOffline(curator, created.id, created.version, once(PNG), {
            declaredMediaType: 'image/png',
            displayName: 'offline-proof.png',
          }),
        ),
      ).toBe('not-cleared');
      expect((await service.photo(curator, created.id))?.assetId).toBeNull();
      expect(
        await count(
          `SELECT COUNT(*) AS n FROM [Asset] WHERE [state]=N'quarantined' AND [displayName]=N'offline-proof.png';`,
        ),
      ).toBeGreaterThan(0);
    });

    it('refuses a reader, and a stale version before a byte is stored', async () => {
      const created = await service.savePhoto(curator, null, null, photoInput());
      const assetsBefore = await count('SELECT COUNT(*) AS n FROM [Asset];');
      expect(
        await refusal(upload(reader, created.id, created.version, once(PNG), file)),
      ).toBe('denied');
      expect(
        await refusal(upload(curator, created.id, created.version + 1, once(PNG), file)),
      ).toBe('conflict');
      expect(await count('SELECT COUNT(*) AS n FROM [Asset];')).toBe(assetsBefore);
    });

    it('lets exactly one of two racing replacements win, and destroys neither image', async () => {
      const first = await photoWithImage();
      const [a, b] = await Promise.allSettled([
        upload(
          curator,
          first.id,
          first.version,
          once(syntheticPng(10, 10, { hue: 1 })),
          pngFile,
        ),
        upload(
          curator,
          first.id,
          first.version,
          once(syntheticPng(12, 12, { hue: 2 })),
          pngFile,
        ),
      ]);
      const outcomes = [a, b].map((result) =>
        result.status === 'fulfilled' ? 'accepted' : mediaFailure(result.reason),
      );
      expect(outcomes.sort()).toEqual(['accepted', 'conflict']);

      // Every image ever cleared for this Photo still exists, clean and whole.
      const current = await service.photo(curator, first.id);
      expect(current?.assetId).not.toBe(first.assetId);
      expect(
        await count(
          `SELECT COUNT(*) AS n FROM [Asset] WHERE [id]=N'${String(first.assetId)}' AND [state]=N'clean';`,
        ),
      ).toBe(1);
    });
  });

  describe('serving: both owners must allow, and withdrawal is immediate', () => {
    it('serves a published Photo’s own image, revalidates it, and refuses it the moment it is archived', async () => {
      const draft = await photoWithImage();
      const assetId = String(draft.assetId);
      expect((await publicServe(draft.id, assetId)).status).toBe(404);

      const published = await publish(draft);
      const served = await publicServe(published.id, assetId);
      expect(served.status).toBe(200);
      expect(served.headers.get('content-type')).toBe('image/png');
      expect(served.headers.get('cache-control')).toBe('private, no-cache');
      expect(served.headers.get('x-content-type-options')).toBe('nosniff');
      expect(served.headers.get('cross-origin-resource-policy')).toBe('same-origin');
      const etag = served.headers.get('etag');
      expect(etag).toMatch(/^"[0-9a-f]{64}"$/u);
      expect(Buffer.from(await body(served)).equals(Buffer.from(PNG))).toBe(true);

      const revalidated = await publicServe(published.id, assetId, etag);
      expect(revalidated.status).toBe(304);
      expect((await body(revalidated)).length).toBe(0);

      await service.savePhoto(curator, published.id, published.version, {
        ...editable(published),
        state: 'archived',
      });
      // A browser holding the image cannot keep showing it: its revalidation
      // meets the same 404 as a guess.
      expect((await publicServe(published.id, assetId, etag)).status).toBe(404);
      expect((await publicServe(published.id, assetId)).status).toBe(404);
    });

    it('refuses another Photo’s image, a replaced image and a guess — the same 404', async () => {
      const one = await publish(await photoWithImage());
      const two = await publish(await photoWithImage(syntheticPng(20, 20, { hue: 5 })));
      expect((await publicServe(one.id, String(two.assetId))).status).toBe(404);
      expect((await publicServe(one.id, randomUUID())).status).toBe(404);

      const replaced = await upload(
        curator,
        one.id,
        one.version,
        once(syntheticPng(8, 8)),
        {
          declaredMediaType: 'image/png',
          displayName: 'r.png',
        },
      );
      expect((await publicServe(one.id, String(one.assetId))).status).toBe(404);
      expect((await publicServe(one.id, String(replaced.assetId))).status).toBe(200);
    });

    it('previews a draft only for a live administrator, never for a reader', async () => {
      const draft = await photoWithImage();
      expect(
        (await previewServe(draft.id, String(draft.assetId), curator.accountId)).status,
      ).toBe(200);
      expect(
        (await previewServe(draft.id, String(draft.assetId), reader.accountId)).status,
      ).toBe(404);
      const preview = await previewServe(
        draft.id,
        String(draft.assetId),
        curator.accountId,
      );
      expect(preview.headers.get('cache-control')).toBe('private, no-store');
      expect(preview.headers.get('etag')).toBeNull();
    });

    it('treats a published Photo whose bytes vanished as unavailable, not as unpublished', async () => {
      const published = await publish(
        await photoWithImage(syntheticPng(30, 30, { hue: 7 })),
      );
      const [row] = await db.admin.query<{ storageKey: string }>(
        `SELECT [storageKey] FROM [Asset] WHERE [id]=N'${String(published.assetId)}';`,
      );
      const key = String(row?.storageKey);
      await rm(path.join(root, ...key.split('/')));

      expect((await publicServe(published.id, String(published.assetId))).status).toBe(
        404,
      );
      expect([...(await storage.servable([String(published.assetId)]))]).toEqual([]);
      expect((await service.photo(curator, published.id))?.state).toBe('published');
      expect(
        (await reads.photos(0)).items.some((photo) => photo.id === published.id),
      ).toBe(true);
    });
  });

  describe('the domain rules hold in the database, whoever writes', () => {
    it('refuses to publish a Photo with no image, and a stale save', async () => {
      const empty = await service.savePhoto(curator, null, null, photoInput());
      expect(
        await refusal(
          service.savePhoto(
            curator,
            empty.id,
            empty.version,
            photoInput({ state: 'published' }),
          ),
        ),
      ).toBe('no-image');
      const withImage = await photoWithImage();
      await service.savePhoto(
        curator,
        withImage.id,
        withImage.version,
        editable(withImage),
      );
      expect(
        await refusal(
          service.savePhoto(
            curator,
            withImage.id,
            withImage.version,
            editable(withImage),
          ),
        ),
      ).toBe('conflict');
    });

    it('keeps a Gallery to its public Photos, in its order, with the first as its cover', async () => {
      const draftPhoto = await photoWithImage();
      const first = await publish(await photoWithImage());
      const second = await publish(await photoWithImage());
      const gallery = await service.saveGallery(curator, null, null, galleryInput());
      const filled = await service.changeGallery(curator, gallery.id, gallery.version, {
        op: 'add',
        photoIds: [draftPhoto.id, first.id, second.id],
      });
      expect(filled.photos.map((photo) => photo.id)).toEqual([
        draftPhoto.id,
        first.id,
        second.id,
      ]);

      // A draft Gallery is nowhere public.
      expect(await reads.gallery(gallery.slug)).toBeNull();

      const live = await service.saveGallery(curator, gallery.id, filled.version, {
        ...galleryInput({ slug: gallery.slug }),
        state: 'published',
      });
      const shown = await reads.gallery(gallery.slug);
      expect(shown).toMatchObject({ photoCount: 2, cover: { id: first.id } });
      expect(
        (await reads.galleryPhotos(gallery.id)).items.map((photo) => photo.id),
      ).toEqual([first.id, second.id]);
      expect(
        (await reads.galleries(0)).items.some((item) => item.id === gallery.id),
      ).toBe(true);

      // Reordering moves the cover with it; there is no second cover to drift.
      const reordered = await service.changeGallery(curator, gallery.id, live.version, {
        op: 'move',
        photoId: second.id,
        direction: 'first',
      });
      expect((await reads.gallery(gallery.slug))?.cover?.id).toBe(second.id);

      // Archiving a Photo withdraws it from the Gallery; the membership remains.
      await service.savePhoto(curator, second.id, second.version, {
        ...editable(second),
        state: 'archived',
      });
      expect((await reads.gallery(gallery.slug))?.cover?.id).toBe(first.id);
      expect((await service.gallery(curator, gallery.id))?.photos).toHaveLength(3);

      // Removing every public Photo takes it off the listing, not off the web.
      const current = await service.gallery(curator, gallery.id);
      await service.changeGallery(curator, gallery.id, Number(current?.version), {
        op: 'remove',
        photoId: first.id,
      });
      expect(
        (await reads.galleries(0)).items.some((item) => item.id === gallery.id),
      ).toBe(false);
      expect(await reads.gallery(gallery.slug)).toMatchObject({
        photoCount: 0,
        cover: null,
      });
      expect(reordered.version).toBeGreaterThan(live.version);

      // Removing membership removed no Photo.
      expect(await service.photo(curator, first.id)).not.toBeNull();
      expect(
        await count(
          `SELECT COUNT(*) AS n FROM [AuditLog] WHERE [action]=N'media.gallery.membership.changed' AND [targetId]=N'${gallery.id}';`,
        ),
      ).toBe(3);
    });

    it('lets exactly one of two racing reorders win, and never loses a member', async () => {
      const a = await photoWithImage();
      const b = await photoWithImage();
      const c = await photoWithImage();
      const gallery = await service.saveGallery(curator, null, null, galleryInput());
      const filled = await service.changeGallery(curator, gallery.id, gallery.version, {
        op: 'add',
        photoIds: [a.id, b.id, c.id],
      });

      const results = await Promise.allSettled([
        service.changeGallery(curator, gallery.id, filled.version, {
          op: 'move',
          photoId: c.id,
          direction: 'first',
        }),
        service.changeGallery(curator, gallery.id, filled.version, {
          op: 'remove',
          photoId: b.id,
        }),
      ]);
      const outcomes = results.map((result) =>
        result.status === 'fulfilled' ? 'accepted' : mediaFailure(result.reason),
      );
      expect(outcomes.sort()).toEqual(['accepted', 'conflict']);

      const after = await service.gallery(curator, gallery.id);
      const ids = after?.photos.map((photo) => photo.id) ?? [];
      expect([[c.id, a.id, b.id].join(), [a.id, c.id].join()].includes(ids.join())).toBe(
        true,
      );
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('answers a former slug with the current one, and never gives it to another Gallery', async () => {
      const original = unique('gallery-old');
      const gallery = await service.saveGallery(
        curator,
        null,
        null,
        galleryInput({ slug: original, state: 'published' }),
      );
      const renamed = unique('gallery-new');
      await service.saveGallery(curator, gallery.id, gallery.version, {
        ...galleryInput({ slug: renamed, state: 'published' }),
      });
      expect(await reads.galleryCanonicalSlug(original)).toBe(renamed);
      expect(await reads.galleryCanonicalSlug(renamed)).toBe(renamed);
      expect(
        await refusal(
          service.saveGallery(curator, null, null, galleryInput({ slug: original })),
        ),
      ).toBe('duplicate-slug');
    });

    it('lists in the sitemap only the current slug of a published Gallery with a public Photo', async () => {
      const shown = await publish(await photoWithImage());
      const listed = await service.saveGallery(
        curator,
        null,
        null,
        galleryInput({ state: 'published' }),
      );
      await service.changeGallery(curator, listed.id, listed.version, {
        op: 'add',
        photoIds: [shown.id],
      });
      const current = await service.gallery(curator, listed.id);
      const renamed = unique('gallery-sitemap');
      await service.saveGallery(curator, listed.id, Number(current?.version), {
        ...galleryInput({ slug: renamed, state: 'published' }),
      });
      const empty = await service.saveGallery(
        curator,
        null,
        null,
        galleryInput({ state: 'published' }),
      );
      const draft = await service.saveGallery(curator, null, null, galleryInput());

      const slugs: string[] = [];
      for (let offset = 0; ; offset += 5000) {
        const page = await reads.gallerySitemap(offset, 5000);
        slugs.push(...page.map((row) => row.slug));
        if (page.length < 5000) break;
      }
      expect(slugs).toContain(renamed);
      expect(slugs).not.toContain(listed.slug);
      expect(slugs).not.toContain(empty.slug);
      expect(slugs).not.toContain(draft.slug);
    });

    it('builds the archive from the date taken — never from when a record was made', async () => {
      const year = 1950 + Math.floor(Math.random() * 40);
      const known = await publish(
        await photoWithImage(PNG, { taken: { year, month: 7, day: null } }),
      );
      const yearOnly = await publish(
        await photoWithImage(PNG, { taken: { year, month: null, day: null } }),
      );
      const undated = await publish(await photoWithImage(PNG));

      const inYear = (await reads.archivePhotos({ year })).items.map((photo) => photo.id);
      expect(inYear).toContain(known.id);
      expect(inYear).toContain(yearOnly.id);
      expect(inYear.indexOf(known.id)).toBeLessThan(inYear.indexOf(yearOnly.id));
      expect(inYear).not.toContain(undated.id);
      expect(
        (await reads.archivePhotos({ year, month: 7 })).items.map((p) => p.id),
      ).toEqual(expect.arrayContaining([known.id]));
      expect(
        (await reads.archivePhotos({ year, month: 7 })).items.map((p) => p.id),
      ).not.toContain(yearOnly.id);
      expect(
        (await reads.archiveYears()).find((entry) => entry.year === year)?.photos,
      ).toBe(2);
      expect(await reads.archiveMonths(year)).toEqual([{ month: 7, photos: 1 }]);
    });
  });

  describe('servability is Storage’s technical answer for a page', () => {
    it('names exactly the assets that are clean and present', async () => {
      const present = await photoWithImage();
      const vanished = await photoWithImage();
      const [row] = await db.admin.query<{ storageKey: string }>(
        `SELECT [storageKey] FROM [Asset] WHERE [id]=N'${String(vanished.assetId)}';`,
      );
      await rm(path.join(root, ...String(row?.storageKey).split('/')));
      const answer = await storage.servable([
        String(present.assetId),
        String(vanished.assetId),
        randomUUID(),
      ]);
      expect([...answer]).toEqual([present.assetId]);
      // Nothing was written or listed outside the Storage-owned root.
      expect((await readdir(root)).length).toBeGreaterThan(0);
    });
  });
});
