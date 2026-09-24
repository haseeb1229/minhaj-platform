import { mkdtempSync, rmSync } from 'node:fs';
import { cp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { StorageServicePort } from '../../packages/contracts/src/platform/storage.ts';
import { getDatabaseMigrationUrl } from '../../packages/database/src/config.ts';
import {
  backupDatabase,
  newBackupTarget,
  newRestoreDatabaseName,
  restoreDatabaseFromBackup,
  type BackupTarget,
} from '../../packages/database/src/lifecycle/backup.ts';
import { openMasterSession } from '../../packages/database/src/lifecycle/disposable-database.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import { sha256 } from '../../packages/database/src/lifecycle/phase11-fixture.ts';
import {
  capturePhase12Fixture,
  newPhase12Fixture,
  PHASE12_IMAGE,
  verifyRestoredPhase12,
  writePhase12Fixture,
  type Phase12Fixture,
} from '../../packages/database/src/lifecycle/phase12-fixture.ts';
import {
  cleanUpRecoveryResources,
  type CleanupOutcome,
} from '../../packages/database/src/lifecycle/recovery-cleanup.ts';
import {
  openSession,
  withDatabase,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import { createFilesystemStore } from '../../packages/storage/src/filesystem.ts';
import { createStorageService } from '../../packages/storage/src/service.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';

/**
 * Phase 12 — photograph recovery is SQL AND STORAGE, and this rehearses both.
 *
 * A SQL backup holds the Photo, Gallery and Asset rows; it holds no byte of any
 * image. So the storage root is restored beside the database, and the
 * properties that matter are proved on the RESTORED pair:
 *
 *   - the bytes exist at the recorded keys and hash to the recorded checksums;
 *   - the Photo-to-asset relations, recorded dimensions, partial dates, words
 *     and the Gallery's ORDER survived exactly;
 *   - the published Photo's image serves through BOTH decisions, the draft's is
 *     still refused, and Storage reports both as technically servable;
 *   - the restored Media still answers the Gallery's former slug with the
 *     current one, and its public read shows only the public Photo.
 *
 * No derived image exists to rebuild: Phase 12 serves the stored image itself.
 * THE ONLY DATABASE THE APPLICATION CLIENT OPENS IS THE RESTORE, positively
 * proved a disposable restore target first. Every resource created is removed
 * and its absence verified. The image is a generated gradient.
 */

const live = databaseConfigured ? describe : describe.skip;

live('Phase 12 photographs after a real SQL and storage restore', () => {
  let source: DisposableDatabase;
  let master: SqlSession;
  let sourceSession: SqlSession | undefined;
  let restored: SqlSession | undefined;
  let restoreDatabase: string;
  let target: BackupTarget;
  let fixture: Phase12Fixture;
  let snapshot: Readonly<Record<string, string>>;
  let base: string;
  let restoredRoot: string;
  let storage: StorageServicePort;

  beforeAll(async () => {
    source = await createProofDatabase();
    base = mkdtempSync(path.join(tmpdir(), 'minhaj-photo-recovery-'));
    const liveRoot = path.join(base, 'live');
    const backupRoot = path.join(base, 'backup');
    restoredRoot = path.join(base, 'restored');

    fixture = newPhase12Fixture();
    await writePhase12Fixture(source.admin, fixture);
    snapshot = await capturePhase12Fixture(source.admin, fixture);

    // The bytes the Asset rows describe, at exactly their recorded keys.
    for (const key of [fixture.assetKey, fixture.draftAssetKey]) {
      const file = path.join(liveRoot, ...key.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, PHASE12_IMAGE);
    }

    // BOTH halves are backed up, then the live copies are lost.
    const migrationUrl = getDatabaseMigrationUrl();
    const connection = assertApprovedLocalTarget(
      migrationUrl,
      localTargetPolicy(process.env, 'source', 'migration'),
    );
    master = await openMasterSession(connection);
    sourceSession = await openSession(withDatabase(connection, source.name));
    target = newBackupTarget();
    await backupDatabase(sourceSession, source.name, target);
    await cp(liveRoot, backupRoot, { recursive: true });
    rmSync(liveRoot, { recursive: true, force: true });

    // BOTH halves are restored.
    restoreDatabase = newRestoreDatabaseName();
    await restoreDatabaseFromBackup(master, target.path, restoreDatabase);
    restored = await openSession(withDatabase(connection, restoreDatabase));
    await cp(backupRoot, restoredRoot, { recursive: true });

    const restoredUrl = migrationUrl.replace(
      `database=${connection.database}`,
      `database=${restoreDatabase}`,
    );
    assertApprovedLocalTarget(
      restoredUrl,
      localTargetPolicy(process.env, 'restore', 'migration'),
    );
    process.env.DATABASE_URL = restoredUrl;

    const database = await import('../../packages/database/src/index.ts');
    storage = createStorageService({
      files: await createFilesystemStore(restoredRoot),
      assets: database.createAssetPersistence(),
      // Serving never scans; a restore rehearsal must not reach for a scanner.
      scanner: {
        scan: () => Promise.reject(new Error('A restore rehearsal must not scan.')),
      },
      maxBytes: 64 * 1024 * 1024,
    });
  }, 600_000);

  afterAll(async () => {
    let outcome: CleanupOutcome | undefined;
    if (master !== undefined && target !== undefined && restoreDatabase !== undefined) {
      outcome = await cleanUpRecoveryResources({
        master,
        source: sourceSession,
        restored,
        restoreDatabase,
        backupPath: target.path,
      });
    }
    await source?.close();
    if (base !== undefined) rmSync(base, { recursive: true, force: true });
    expect(outcome?.failures ?? []).toEqual([]);
  }, 120_000);

  it('restores every authoritative photograph row, order and invariant', async () => {
    expect(
      await verifyRestoredPhase12(restored as SqlSession, fixture, snapshot),
    ).toContain('gallery order');
  });

  it('restores the bytes the rows describe, byte for byte', async () => {
    const files = await createFilesystemStore(restoredRoot);
    for (const key of [fixture.assetKey, fixture.draftAssetKey]) {
      expect(
        await files.verify(key, {
          byteSize: PHASE12_IMAGE.byteLength,
          checksum: sha256(PHASE12_IMAGE),
        }),
        key,
      ).toBe(true);
    }
    expect(
      [...(await storage.servable([fixture.assetId, fixture.draftAssetId]))].sort(),
    ).toEqual([fixture.assetId, fixture.draftAssetId].sort());
  });

  it('serves the published image through both decisions, and still refuses the draft’s', async () => {
    const { createPhotoAssetPolicy } =
      await import('../../apps/web/src/contexts/media/index.ts');
    const { servePhoto } = await import('../../apps/web/src/app/assets/media/serve.ts');
    const database = await import('../../packages/database/src/index.ts');
    const relations = database.createMediaAssetRelations();
    const serve = (photoId: string, assetId: string) =>
      servePhoto(
        storage,
        assetId,
        createPhotoAssetPolicy({ relations, request: { photoId, assetId } }),
        { ifNoneMatch: null, preview: false },
      );

    const published = await serve(fixture.publishedPhotoId, fixture.assetId);
    expect(published.status).toBe(200);
    expect(
      Buffer.from(await published.arrayBuffer()).equals(Buffer.from(PHASE12_IMAGE)),
    ).toBe(true);

    expect((await serve(fixture.draftPhotoId, fixture.draftAssetId)).status).toBe(404);
    expect((await serve(fixture.publishedPhotoId, fixture.draftAssetId)).status).toBe(
      404,
    );
  });

  it('answers the former Gallery slug, and shows only its public photograph, in order', async () => {
    const { createMediaReadService } =
      await import('../../apps/web/src/contexts/media/index.ts');
    const database = await import('../../packages/database/src/index.ts');
    const reads = createMediaReadService(database.createMediaPublicReader());

    expect(await reads.galleryCanonicalSlug(fixture.galleryOriginalSlug)).toBe(
      fixture.gallerySlug,
    );
    const gallery = await reads.gallery(fixture.gallerySlug);
    expect(gallery).toMatchObject({
      photoCount: 1,
      cover: { id: fixture.publishedPhotoId },
    });
    const photos = await reads.galleryPhotos(fixture.galleryId);
    expect(photos.items.map((photo) => photo.id)).toEqual([fixture.publishedPhotoId]);
    expect(photos.items[0]).toMatchObject({
      width: 64,
      height: 40,
      taken: { year: 1995, month: 3, day: null },
      credit: 'Synthetic recovery credit',
    });
    expect(
      (await reads.archivePhotos({ year: 1995 })).items.map((photo) => photo.id),
    ).toContain(fixture.publishedPhotoId);
  });
});
