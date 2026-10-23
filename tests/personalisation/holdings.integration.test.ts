import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, describe, it } from 'vitest';

import {
  getApplicationPrincipalCredentials,
  getDatabaseRuntimeUrl,
} from '../../packages/database/src/config.ts';
import { provisionApplicationPrincipal } from '../../packages/database/src/lifecycle/application-principal.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import { parseSqlServerUrl } from '../../packages/database/src/lifecycle/sql-connection.ts';
import type { PersonalHoldingPort } from '../../packages/contracts/src/personalisation/index.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { account, n, video } from './fixture-sql.ts';

/**
 * Phase 29 — Personalisation's holding answer over a REAL SQL Server, as the
 * provisioned RUNTIME principal.
 *
 * WHAT ONLY THE DATABASE CAN PROVE: that the runtime principal's existing
 * grants suffice for the one bounded `EXISTS` read; that a SavedItem OR a
 * WatchHistory row makes a Video held and neither does not; that another
 * Video's rows never count; and that releasing the references (a purge)
 * makes the answer `false` again.
 *
 * The owner session writes the rows only another context or the person's own
 * flows would write; Personalisation's adapter, bound to the runtime
 * principal, only reads.
 */

const live = databaseConfigured ? describe : describe.skip;

live('Phase 29 Personalisation holding answer against real SQL Server', () => {
  let db: DisposableDatabase;
  let holdings: PersonalHoldingPort;
  let releaseVideo: (videoId: string, limit: number) => Promise<number>;

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
    assertApprovedLocalTarget(
      runtimeUrl,
      localTargetPolicy(process.env, 'disposable', 'runtime'),
    );
    const principal = getApplicationPrincipalCredentials();
    await provisionApplicationPrincipal(
      db.admin,
      principal.DATABASE_APP_LOGIN,
      principal.DATABASE_APP_PASSWORD,
    );
    process.env['DATABASE_URL'] = runtimeUrl;

    const database = await import('../../packages/database/src/index.ts');
    holdings = database.createPersonalHoldings();
    const purge = database.createPersonalPurge();
    releaseVideo = (videoId, limit) => purge.releaseVideo(videoId, limit);
  }, 300_000);

  afterAll(async () => {
    await db?.close();
  }, 120_000);

  it('answers held for a saved Video, a watched Video, and neither for a bare one', async () => {
    const saver = await account(db.admin);
    const watcher = await account(db.admin);
    const [saved, watched, bare] = [
      await video(db.admin),
      await video(db.admin),
      await video(db.admin),
    ];

    await db.admin.query(`
      INSERT INTO [dbo].[SavedItem] ([id],[userId],[videoId],[createdAt])
        VALUES (${n(randomUUID())}, ${n(saver)}, ${n(saved)}, SYSUTCDATETIME());
      INSERT INTO [dbo].[WatchHistory] ([userId],[videoId],[firstWatchedAt],[lastWatchedAt])
        VALUES (${n(watcher)}, ${n(watched)}, SYSUTCDATETIME(), SYSUTCDATETIME());
    `);

    expect(await holdings.videoHeld(saved)).toBe(true);
    expect(await holdings.videoHeld(watched)).toBe(true);
    expect(await holdings.videoHeld(bare)).toBe(false);
    // An id that names no Video at all is simply not held.
    expect(await holdings.videoHeld(randomUUID())).toBe(false);

    // Once every reference is released the Video is no longer held.
    expect(await releaseVideo(saved, 100)).toBe(0);
    expect(await releaseVideo(watched, 100)).toBe(0);
    expect(await holdings.videoHeld(saved)).toBe(false);
    expect(await holdings.videoHeld(watched)).toBe(false);
  });
});
