import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import sharp from 'sharp';
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
  StorageServicePort,
} from '../../packages/contracts/src/platform/storage.ts';
import type { backfillDerivatives as BackfillDerivatives } from '../../apps/web/src/composition/storage-derivatives-backfill.ts';
import { createFilesystemStore } from '../../packages/storage/src/filesystem.ts';
import { createStorageService } from '../../packages/storage/src/service.ts';

/**
 * Rebaseline R2 — Storage's derivatives against a REAL SQL Server, a real
 * filesystem and the real decoder: the link table's constraints, the adapter's
 * race and release behaviour, and the operator's backfill, which must derive
 * exactly what a published record shows — never a draft's picture — and create
 * nothing on a second run.
 */

const live = databaseConfigured ? describe : describe.skip;

const cleanScanner: MalwareScannerPort = { scan: async () => ({ status: 'clean' }) };
const allow: AssetAuthorizationPort = { decide: () => Promise.resolve('allow') };

const PHOTO = {
  allowedMediaTypes: ['image/jpeg', 'image/png'],
  maxBytes: 4 * 1024 * 1024,
  image: { maxPixels: 40_000_000, maxEdge: 16_384 },
};

async function jpeg(width: number, height: number) {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: '#4a7a5c' } })
      .jpeg()
      .toBuffer(),
  );
}

const one = (data: Uint8Array) =>
  (async function* () {
    yield data;
  })();

live('R2 storage derivatives against real SQL Server', () => {
  let db: DisposableDatabase;
  let assets: AssetPersistencePort;
  let storage: StorageServicePort;
  let backfill: typeof BackfillDerivatives;
  let root: string;

  beforeAll(async () => {
    db = await createProofDatabase();
    const database = await import('../../packages/database/src/index.ts');
    assets = database.createAssetPersistence();
    root = mkdtempSync(path.join(tmpdir(), 'minhaj-derivatives-sql-'));
    storage = createStorageService({
      files: await createFilesystemStore(root),
      assets,
      scanner: cleanScanner,
      maxBytes: 8 * 1024 * 1024,
    });
    ({ backfillDerivatives: backfill } =
      await import('../../apps/web/src/composition/storage-derivatives-backfill.ts'));
  }, 900_000);

  afterAll(async () => {
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    await db?.close();
  });

  async function storedPhoto(width: number, height: number) {
    const stored = await storage.store(one(await jpeg(width, height)), PHOTO);
    expect(stored.state).toBe('clean');
    return stored.id;
  }

  it('derives, links and serves through the real adapter, once', async () => {
    const source = await storedPhoto(1000, 500);
    expect(await storage.derive(source, allow)).toEqual({
      status: 'derived',
      created: 3,
      existing: 0,
      withheld: 0,
    });
    expect((await assets.derivatives(source)).map((row) => row.width).sort()).toEqual([
      320, 640, 960,
    ]);
    expect(await storage.derive(source, allow)).toMatchObject({
      created: 0,
      existing: 3,
    });
    const served = await storage.openDerivative(source, 640, allow);
    expect(served).not.toBeNull();
    expect(served).not.toBe('not-derived');
    expect((served as { mediaType: string }).mediaType).toBe('image/webp');
  });

  it('holds the link rules against any writer', async () => {
    const source = await storedPhoto(400, 400);
    const [link] = await (async () => {
      await storage.derive(source, allow);
      return assets.derivatives(source);
    })();
    expect(link?.width).toBe(320);
    // The same width twice is an answer, not a failure.
    expect(
      await assets.recordDerivative({
        sourceAssetId: source,
        width: 320,
        assetId: source,
      }),
    ).toBe(false);
    for (const statement of [
      // A width Storage does not render.
      `INSERT INTO [dbo].[AssetDerivative] ([sourceAssetId],[width],[assetId]) VALUES (N'${source}',500,N'${source}');`,
      // An asset as its own derivative.
      `INSERT INTO [dbo].[AssetDerivative] ([sourceAssetId],[width],[assetId]) VALUES (N'${source}',640,N'${source}');`,
      // One derivative asset linked twice.
      `INSERT INTO [dbo].[AssetDerivative] ([sourceAssetId],[width],[assetId]) VALUES (N'${source}',640,N'${link?.assetId ?? ''}');`,
      // A source that does not exist.
      `INSERT INTO [dbo].[AssetDerivative] ([sourceAssetId],[width],[assetId]) VALUES (N'${randomUUID()}',640,N'${source}');`,
    ])
      await expect(db.admin.query(statement)).rejects.toThrow();
  });

  it('releasing a source removes its derivatives, links, records and bytes', async () => {
    const token = 'd'.repeat(64);
    const stored = await storage.store(one(await jpeg(700, 300)), {
      ...PHOTO,
      releaseToken: token,
    });
    await storage.derive(stored.id, allow);
    const derived = await assets.derivatives(stored.id);
    expect(derived).toHaveLength(2);
    expect(await storage.release(token)).toBe('released');
    expect(await assets.derivatives(stored.id)).toEqual([]);
    for (const row of derived) expect(await assets.find(row.assetId)).toBeNull();
    expect(await assets.find(stored.id)).toBeNull();
  });

  it('the backfill derives exactly what a published record shows, and is idempotent', async () => {
    const published = await storedPhoto(800, 800);
    const draft = await storedPhoto(800, 800);
    const unnamed = await storedPhoto(800, 800);
    const person = (id: string, status: string, asset: string) =>
      db.admin.query(
        `INSERT INTO [dbo].[Person] ([id],[slug],[primaryLocale],[status],[portraitAssetId],[portraitWidth],[portraitHeight])
         VALUES (N'${id}',N'r2-${id}',N'en',N'${status}',N'${asset}',800,800);`,
      );
    await person(randomUUID(), 'published', published);
    await person(randomUUID(), 'draft', draft);

    const first = await backfill(1_000, storage);
    expect(first.complete).toBe(true);
    expect(first.families['people:portrait']).toMatchObject({
      examined: 1,
      created: 2,
      refused: 0,
      failed: 0,
    });
    expect((await assets.derivatives(published)).map((row) => row.width).sort()).toEqual([
      320, 640,
    ]);
    // Never decoded: the draft's portrait and a picture no record names.
    expect(await assets.derivatives(draft)).toEqual([]);
    expect(await assets.derivatives(unnamed)).toEqual([]);

    const second = await backfill(1_000, storage);
    expect(second.totals).toMatchObject({ created: 0, existing: 2, failed: 0 });

    // Withdrawn: the record stops showing it, and the route stops serving it.
    await db.admin.query(
      `UPDATE [dbo].[Person] SET [status]=N'draft' WHERE [portraitAssetId]=N'${published}';`,
    );
    const third = await backfill(1_000, storage);
    expect(third.families['people:portrait']?.examined).toBe(0);
  });
});
