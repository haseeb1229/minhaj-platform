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
import {
  newPhase5Fixture,
  writePhase5Fixture,
} from '../../packages/database/src/lifecycle/phase5-fixture.ts';
import {
  capturePhase11Fixture,
  newPhase11Fixture,
  PHASE11_AUDIO,
  PHASE11_RECOVERY_WORDS,
  sha256,
  verifyRestoredPhase11,
  writePhase11Fixture,
  type Phase11Fixture,
} from '../../packages/database/src/lifecycle/phase11-fixture.ts';
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
import { buildSearchHarness, type SearchHarness } from '../search/harness.ts';

/**
 * Phase 11 — audio recovery is SQL AND STORAGE, and this rehearses both halves.
 *
 * A SQL backup holds the AudioTrack rows and the Asset metadata; it holds no
 * byte of any recording. Restoring the database alone would bring back tracks
 * that name files that are not there. So the storage root is restored beside
 * the database, and then the properties that matter are proved on the RESTORED
 * pair:
 *
 *   - the bytes exist at the recorded keys and hash to the recorded checksums;
 *   - the track-to-asset relations survived;
 *   - the published track's file serves through BOTH decisions — Media's policy
 *     and Storage's custody — while the draft's file is still refused;
 *   - the restored Media still answers a former slug with the current one;
 *   - Search REBUILDS its audio inventory from the restored owner — the
 *     projection is derived and is never restored as truth.
 *
 * THE ONLY DATABASE THE APPLICATION CLIENT OPENS IS THE RESTORE, positively
 * proved to be a disposable restore target first. Every resource created is
 * removed and its absence verified. The audio is generated silence.
 */

const live = databaseConfigured ? describe : describe.skip;

live('Phase 11 audio after a real SQL and storage restore', () => {
  let source: DisposableDatabase;
  let master: SqlSession;
  let sourceSession: SqlSession | undefined;
  let restored: SqlSession | undefined;
  let restoreDatabase: string;
  let target: BackupTarget;
  let fixture: Phase11Fixture;
  let snapshot: Readonly<Record<string, string>>;
  let base: string;
  let restoredRoot: string;
  let storage: StorageServicePort;
  let h: SearchHarness;

  beforeAll(async () => {
    source = await createProofDatabase();
    base = mkdtempSync(path.join(tmpdir(), 'minhaj-audio-recovery-'));
    const liveRoot = path.join(base, 'live');
    const backupRoot = path.join(base, 'backup');
    restoredRoot = path.join(base, 'restored');

    const people = newPhase5Fixture();
    await writePhase5Fixture(source.admin, people);
    const [topic] = await source.admin.query<{ id: string }>(
      "SELECT [id] FROM [Topic] WHERE [slug] = N'education';",
    );
    if (topic === undefined) throw new Error('The canonical education topic is missing.');

    fixture = newPhase11Fixture();
    await writePhase11Fixture(source.admin, fixture, {
      personId: people.linkedPersonId,
      topicId: topic.id,
    });
    snapshot = await capturePhase11Fixture(source.admin, fixture);

    // The bytes the Asset rows describe, at exactly their recorded keys.
    for (const key of [fixture.assetKey, fixture.draftAssetKey]) {
      const file = path.join(liveRoot, ...key.split('/'));
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, PHASE11_AUDIO);
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
    h = await buildSearchHarness(restored);
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

  it('restores every authoritative audio row and invariant', async () => {
    expect(
      await verifyRestoredPhase11(restored as SqlSession, fixture, snapshot),
    ).toContain('asset relations');
  });

  it('restores the bytes the rows describe, byte for byte', async () => {
    const files = await createFilesystemStore(restoredRoot);
    for (const key of [fixture.assetKey, fixture.draftAssetKey]) {
      expect(
        await files.verify(key, {
          byteSize: PHASE11_AUDIO.byteLength,
          checksum: sha256(PHASE11_AUDIO),
        }),
        key,
      ).toBe(true);
    }
  });

  it('serves the published file through both decisions, and still refuses the draft’s', async () => {
    const { createAudioAssetPolicy } =
      await import('../../apps/web/src/contexts/media/index.ts');
    const { serveAudio } = await import('../../apps/web/src/app/assets/media/serve.ts');
    const database = await import('../../packages/database/src/index.ts');
    const relations = database.createMediaAssetRelations();
    const serve = (trackId: string, assetId: string) =>
      serveAudio(
        storage,
        assetId,
        createAudioAssetPolicy({ relations, request: { trackId, assetId } }),
        { range: null, ifRange: null },
      );

    const published = await serve(fixture.trackId, fixture.assetId);
    expect(published.status).toBe(200);
    expect(
      Buffer.from(await published.arrayBuffer()).equals(Buffer.from(PHASE11_AUDIO)),
    ).toBe(true);

    expect((await serve(fixture.draftTrackId, fixture.draftAssetId)).status).toBe(404);
    expect((await serve(fixture.trackId, fixture.draftAssetId)).status).toBe(404);
  });

  it('answers the restored former slugs with the current ones', async () => {
    const { createMediaReadService } =
      await import('../../apps/web/src/contexts/media/index.ts');
    const reads = createMediaReadService(h.readers.media);
    expect(await reads.audioTrackCanonicalSlug(fixture.trackOriginalSlug)).toBe(
      fixture.trackSlug,
    );
    expect(await reads.audioSeriesCanonicalSlug(fixture.seriesOriginalSlug)).toBe(
      fixture.seriesSlug,
    );
  });

  it('rebuilds Search from the restored owner, answering only what is public', async () => {
    const [row] = await (restored as SqlSession).query<{ requests: number }>(
      `SELECT COUNT(*) AS requests FROM [dbo].[SearchIndexRequest] WHERE [scopeKind] = N'audio' AND [scopeId] = N'${fixture.trackId}';`,
    );
    expect(Number(row?.requests)).toBe(1);

    await h.search.rebuild();
    await h.indexNow();

    const hits = async (q: string) => {
      const outcome = await h.search.search({ q }, { locale: 'en' });
      if (outcome.state !== 'results')
        throw new Error(`Search answered ${outcome.state}.`);
      return outcome.results.hits.map((hit) => [hit.kind, hit.href]);
    };
    expect(await hits(PHASE11_RECOVERY_WORDS.audio)).toEqual([
      ['audio', `/listen/lectures/${fixture.trackSlug}`],
    ]);
    expect(await hits(PHASE11_RECOVERY_WORDS.archived)).toEqual([]);
  });
});
