import { randomUUID } from 'node:crypto';
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
import { generateStorageKey } from '../../packages/storage/src/keys.ts';
import { createStorageService } from '../../packages/storage/src/service.ts';

/**
 * Storage against a REAL SQL Server and a REAL filesystem.
 *
 * The in-memory service tests prove the pipeline's decisions. This file proves
 * the half of the lifecycle that lives in the DATABASE — the CHECK constraints,
 * the key uniqueness, and the checksum-guarded clearance — because those hold
 * against any writer, including one that is not this application.
 */

const live = databaseConfigured ? describe : describe.skip;

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const bytes = (data: Uint8Array) =>
  (async function* () {
    yield data;
  })();

const IMAGES = { allowedMediaTypes: ['image/png'], maxBytes: 1024 * 1024 };

const cleanScanner: MalwareScannerPort = { scan: async () => ({ status: 'clean' }) };
const allow: AssetAuthorizationPort = { decide: () => Promise.resolve('allow') };

live('Phase 7 storage against real SQL Server', () => {
  let db: DisposableDatabase;
  let assets: AssetPersistencePort;
  let files: FilesystemStore;
  let root: string;

  beforeAll(async () => {
    db = await createProofDatabase();

    // Imported AFTER the harness has repointed DATABASE_URL at the disposable
    // database, so the client binds to the proof target and never to the
    // engineering one.
    const { createAssetPersistence } =
      await import('../../packages/database/src/index.ts');
    assets = createAssetPersistence();

    root = mkdtempSync(path.join(tmpdir(), 'minhaj-storage-sql-'));
    files = await createFilesystemStore(root);
  }, 600_000);

  afterAll(async () => {
    // Guarded: when setup itself failed, these were never assigned, and a
    // teardown crash would hide the real error.
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
    await db?.close();
  });

  const service = (scanner: MalwareScannerPort = cleanScanner) =>
    createStorageService({ files, assets, scanner, maxBytes: 4 * 1024 * 1024 });

  it('carries an asset through the real lifecycle and serves it only when allowed', async () => {
    const stored = await service().store(bytes(PNG), IMAGES);

    expect(stored.state).toBe('clean');

    const [row] = await db.admin.query<{
      state: string;
      mediaType: string;
      byteSize: string | number | bigint;
      checksum: string;
    }>(
      `SELECT [state],[mediaType],[byteSize],[checksum] FROM [dbo].[Asset] WHERE [id]=N'${stored.id}';`,
    );

    expect(row?.state).toBe('clean');
    expect(row?.mediaType).toBe('image/png');
    expect(Number(row?.byteSize)).toBe(PNG.length);
    expect(row?.checksum).toBe(stored.checksum);

    expect(await service().open(stored.id, allow)).not.toBeNull();
    expect(
      await service().open(stored.id, { decide: () => Promise.resolve('deny') }),
    ).toBeNull();
  });

  it('refuses an unmeasured row to ever be clean, whatever writes it', async () => {
    // Written with ADMINISTRATIVE authority, bypassing the service entirely.
    // The constraint is what makes "an unmeasured asset can never be served"
    // true against a writer the application does not control.
    const id = randomUUID();

    await db.admin.query(
      `INSERT INTO [dbo].[Asset] ([id],[storageKey],[state],[updatedAt]) VALUES (N'${id}',N'${generateStorageKey()}',N'uploading',SYSUTCDATETIME());`,
    );

    await expect(
      db.admin.query(`UPDATE [dbo].[Asset] SET [state]=N'clean' WHERE [id]=N'${id}';`),
    ).rejects.toThrow();

    const [row] = await db.admin.query<{ state: string }>(
      `SELECT [state] FROM [dbo].[Asset] WHERE [id]=N'${id}';`,
    );
    expect(row?.state).toBe('uploading');
  });

  it('refuses a state outside the lifecycle', async () => {
    const id = randomUUID();

    await expect(
      db.admin.query(
        `INSERT INTO [dbo].[Asset] ([id],[storageKey],[state],[updatedAt]) VALUES (N'${id}',N'${generateStorageKey()}',N'published',SYSUTCDATETIME());`,
      ),
    ).rejects.toThrow();
  });

  it('refuses two assets to claim one storage key', async () => {
    const key = generateStorageKey();

    await db.admin.query(
      `INSERT INTO [dbo].[Asset] ([id],[storageKey],[state],[updatedAt]) VALUES (N'${randomUUID()}',N'${key}',N'uploading',SYSUTCDATETIME());`,
    );

    // Without uniqueness a generated collision would silently overwrite an
    // existing object's bytes.
    await expect(
      db.admin.query(
        `INSERT INTO [dbo].[Asset] ([id],[storageKey],[state],[updatedAt]) VALUES (N'${randomUUID()}',N'${key}',N'uploading',SYSUTCDATETIME());`,
      ),
    ).rejects.toThrow();
  });

  it('will not clear bytes other than the ones that were scanned', async () => {
    const id = randomUUID();
    const key = generateStorageKey();

    await assets.begin({ id, storageKey: key, displayName: null });
    await assets.quarantine({
      id,
      mediaType: 'image/png',
      byteSize: 10,
      checksum: 'a'.repeat(64),
    });

    // A clearance naming a DIFFERENT checksum must match no row.
    expect(await assets.clear({ id, checksum: 'b'.repeat(64) })).toBe(false);

    const [afterWrong] = await db.admin.query<{ state: string }>(
      `SELECT [state] FROM [dbo].[Asset] WHERE [id]=N'${id}';`,
    );
    expect(afterWrong?.state).toBe('quarantined');

    // The right checksum clears it, so the guard is discriminating rather than
    // simply always refusing.
    expect(await assets.clear({ id, checksum: 'a'.repeat(64) })).toBe(true);

    const [afterRight] = await db.admin.query<{ state: string }>(
      `SELECT [state] FROM [dbo].[Asset] WHERE [id]=N'${id}';`,
    );
    expect(afterRight?.state).toBe('clean');
  });

  it('never revives a rejected asset', async () => {
    const id = randomUUID();

    await assets.begin({ id, storageKey: generateStorageKey(), displayName: null });
    await assets.reject({ id, rejection: 'infected' });

    // Terminal. A quarantine or a clearance arriving late must not undo it.
    await assets.quarantine({
      id,
      mediaType: 'image/png',
      byteSize: 10,
      checksum: 'c'.repeat(64),
    });
    expect(await assets.clear({ id, checksum: 'c'.repeat(64) })).toBe(false);

    const record = await assets.find(id);
    expect(record?.state).toBe('rejected');
    expect(record?.rejection).toBe('infected');
  });

  it('counts scan attempts atomically', async () => {
    const id = randomUUID();
    await assets.begin({ id, storageKey: generateStorageKey(), displayName: null });

    // Concurrent increments must not both read the same value: a lost update
    // here would let a retry ceiling be exceeded indefinitely.
    const results = await Promise.all(
      Array.from({ length: 10 }, () => assets.countScanAttempt(id)),
    );

    expect([...results].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await assets.find(id))?.scanAttempts).toBe(10);
  });

  it('sweeps stale rows in bounded batches', async () => {
    const stale = new Date(Date.now() - 86_400_000)
      .toISOString()
      .replace('T', ' ')
      .slice(0, 23);

    for (let index = 0; index < 8; index++) {
      const id = randomUUID();
      await db.admin.query(
        `INSERT INTO [dbo].[Asset] ([id],[storageKey],[state],[updatedAt]) VALUES (N'${id}',N'${generateStorageKey()}',N'uploading',N'${stale}');`,
      );
    }

    const batch = await assets.staleBefore(new Date(), 3);
    expect(batch).toHaveLength(3);

    // Only mid-lifecycle rows are candidates; a clean asset is not stale work.
    for (const record of batch) {
      expect(['uploading', 'quarantined']).toContain(record.state);
    }
  });

  it('stores no file bytes in the database', async () => {
    const columns = await db.admin.query<{ name: string; type: string }>(
      `SELECT c.[name] AS [name], t.[name] AS [type] FROM sys.columns c JOIN sys.types t ON t.user_type_id=c.user_type_id WHERE c.[object_id]=OBJECT_ID(N'[dbo].[Asset]');`,
    );

    expect(columns.length).toBeGreaterThan(0);
    for (const column of columns) {
      expect(['varbinary', 'binary', 'image']).not.toContain(column.type.toLowerCase());
    }
  });

  it('holds no foreign key to Identity or to any business context', async () => {
    const references = await db.admin.query<{ referenced: string }>(
      `SELECT OBJECT_NAME(referenced_object_id) AS [referenced] FROM sys.foreign_keys WHERE parent_object_id = OBJECT_ID(N'[dbo].[Asset]');`,
    );

    // Layer 0 depends on nothing above it. An FK here would be that dependency
    // written into the schema.
    expect(references.map((row) => row.referenced)).toEqual([]);
  });
});
