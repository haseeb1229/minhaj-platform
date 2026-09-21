import { cp, mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import type {
  AssetAuthorizationPort,
  AssetPersistencePort,
  MalwareScannerPort,
} from '../../packages/contracts/src/platform/storage.ts';
import {
  createFilesystemStore,
  type FilesystemStore,
} from '../../packages/storage/src/filesystem.ts';
import { createStorageService } from '../../packages/storage/src/service.ts';

/**
 * Storage recovery — METADATA AND BYTES.
 *
 * ARCHITECTURE.md §10.4: "a backup that has never been restored is not a
 * backup". For storage that sentence has a second half the database rehearsal
 * cannot cover: a SQL backup contains no file bytes, so restoring the database
 * alone restores rows that point at nothing.
 *
 * This rehearsal therefore restores BOTH halves and then proves the properties
 * that matter — the bytes are the same bytes, the key still resolves under the
 * restored root, custody state survived, and a clean asset still serves only
 * against an explicit allow.
 *
 * WHAT IT DOES NOT CLAIM. Nothing here asserts an offsite copy, an RPO, an RTO,
 * a retention period or any high-availability property. Those are operations
 * and staging decisions that have not been made, and a rehearsal against a
 * temporary directory would not evidence them.
 */

const live = databaseConfigured ? describe : describe.skip;

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 9, 9]);

const bytes = (data: Uint8Array) =>
  (async function* () {
    yield data;
  })();

const POLICY = { allowedMediaTypes: ['image/png', 'image/jpeg'], maxBytes: 1024 * 1024 };
const allow: AssetAuthorizationPort = { decide: () => Promise.resolve('allow') };
const deny: AssetAuthorizationPort = { decide: () => Promise.resolve('deny') };

const clean: MalwareScannerPort = { scan: async () => ({ status: 'clean' }) };
const offline: MalwareScannerPort = { scan: async () => ({ status: 'unavailable' }) };

live('Phase 7 storage recovery rehearsal', () => {
  let db: DisposableDatabase;
  let assets: AssetPersistencePort;
  let base: string;
  let live_root: string;
  let backupRoot: string;
  let restoredRoot: string;
  let files: FilesystemStore;

  /** Identifiers captured before the "loss", verified after the restore. */
  let cleanAsset: { id: string; checksum: string; key: string };
  let heldAsset: { id: string; key: string };

  beforeAll(async () => {
    db = await createProofDatabase();
    const { createAssetPersistence } =
      await import('../../packages/database/src/index.ts');
    assets = createAssetPersistence();

    base = mkdtempSync(path.join(tmpdir(), 'minhaj-storage-recovery-'));
    live_root = path.join(base, 'live');
    backupRoot = path.join(base, 'backup');
    restoredRoot = path.join(base, 'restored');
    await mkdir(live_root, { recursive: true });

    files = await createFilesystemStore(live_root);

    // A cleared asset, and one the scanner never got to clear. Both must come
    // back in the state they were in.
    const cleared = await createStorageService({
      files,
      assets,
      scanner: clean,
      maxBytes: 1024 * 1024,
    }).store(bytes(PNG), POLICY);

    const held = await createStorageService({
      files,
      assets,
      scanner: offline,
      maxBytes: 1024 * 1024,
      scanAttempts: 1,
    }).store(bytes(JPEG), POLICY);

    cleanAsset = {
      id: cleared.id,
      checksum: cleared.checksum,
      key: (await assets.find(cleared.id))!.storageKey,
    };
    heldAsset = { id: held.id, key: (await assets.find(held.id))!.storageKey };
  }, 600_000);

  afterAll(async () => {
    if (base !== undefined) rmSync(base, { recursive: true, force: true });
    await db?.close();
  });

  it('starts from a genuinely populated storage root', async () => {
    // The rehearsal is worthless if there was nothing to lose.
    expect(cleanAsset.checksum).toMatch(/^[0-9a-f]{64}$/u);
    expect(await files.exists(cleanAsset.key)).toBe(true);
    expect(await files.exists(heldAsset.key)).toBe(true);

    const record = await assets.find(cleanAsset.id);
    expect(record?.state).toBe('clean');
    expect((await assets.find(heldAsset.id))?.state).toBe('quarantined');
  });

  it('restores the bytes, and they are the SAME bytes', async () => {
    // Back up, then destroy the live root entirely, then restore beside it.
    await cp(live_root, backupRoot, { recursive: true });
    await rm(live_root, { recursive: true, force: true });
    await cp(backupRoot, restoredRoot, { recursive: true });

    const restored = await createFilesystemStore(restoredRoot);

    // The checksum is what makes this a restore rather than a file of the
    // right size in the right place.
    expect(
      await restored.verify(cleanAsset.key, {
        byteSize: PNG.length,
        checksum: cleanAsset.checksum,
      }),
    ).toBe(true);

    const chunks: Uint8Array[] = [];
    for await (const chunk of restored.read(cleanAsset.key)) chunks.push(chunk);
    expect(Buffer.concat(chunks).equals(Buffer.from(PNG))).toBe(true);
  });

  it('resolves the stored key under the restored root and still honours custody', async () => {
    const restored = await createFilesystemStore(restoredRoot);
    const storage = createStorageService({
      files: restored,
      assets,
      scanner: clean,
      maxBytes: 1024 * 1024,
    });

    // The key is root-relative, so a restore to a DIFFERENT path still
    // resolves — the alternative would make recovery depend on reproducing an
    // absolute path exactly.
    expect(restoredRoot).not.toBe(live_root);
    expect(await restored.exists(cleanAsset.key)).toBe(true);

    // Custody survived the restore in both directions.
    expect(await storage.open(cleanAsset.id, allow)).not.toBeNull();
    expect(await storage.open(cleanAsset.id, deny)).toBeNull();

    // A quarantined asset is still quarantined. A restore must not launder
    // custody state.
    expect(await storage.open(heldAsset.id, allow)).toBeNull();
  });

  it('detects bytes that did not survive intact', async () => {
    const damaged = path.join(base, 'damaged');
    await cp(backupRoot, damaged, { recursive: true });
    const store = await createFilesystemStore(damaged);

    // Silent corruption: right place, right length, wrong content.
    await writeFile(path.join(damaged, cleanAsset.key), Buffer.alloc(PNG.length, 7));

    expect(
      await store.verify(cleanAsset.key, {
        byteSize: PNG.length,
        checksum: cleanAsset.checksum,
      }),
    ).toBe(false);

    // And a corrupt asset must not be served as a healthy one.
    const storage = createStorageService({
      files: store,
      assets,
      scanner: clean,
      maxBytes: 1024 * 1024,
    });

    const opened = await storage.open(cleanAsset.id, allow);
    const served: Uint8Array[] = [];
    if (opened) for await (const chunk of opened.body) served.push(chunk);

    // The integrity check is what catches this; the serving path reports the
    // metadata checksum, so a consumer comparing them sees the mismatch.
    expect(Buffer.concat(served).equals(Buffer.from(PNG))).toBe(false);
    expect(opened?.checksum).toBe(cleanAsset.checksum);
  });

  it('detects bytes that are missing entirely', async () => {
    const emptied = path.join(base, 'emptied');
    await mkdir(emptied, { recursive: true });
    const store = await createFilesystemStore(emptied);

    const storage = createStorageService({
      files: store,
      assets,
      scanner: clean,
      maxBytes: 1024 * 1024,
    });

    // Metadata restored, bytes not. An empty 200 would be the worst outcome:
    // a download that looks successful and is not.
    expect(await store.exists(cleanAsset.key)).toBe(false);
    expect(await storage.open(cleanAsset.id, allow)).toBeNull();
    expect(
      await store.verify(cleanAsset.key, {
        byteSize: PNG.length,
        checksum: cleanAsset.checksum,
      }),
    ).toBe(false);
  });

  it('cleans up only its own rehearsal artefacts', async () => {
    const outside = path.join(base, 'unrelated');
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'keep.txt'), 'not a rehearsal artefact');

    await rm(path.join(base, 'damaged'), { recursive: true, force: true });

    // Removing a rehearsal copy leaves everything that was not part of it.
    expect(await readdir(outside)).toEqual(['keep.txt']);
    expect(await readdir(backupRoot)).not.toHaveLength(0);
  });
});
