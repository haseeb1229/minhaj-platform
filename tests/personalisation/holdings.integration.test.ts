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
import { account, articles, n, video, work } from './fixture-sql.ts';

/**
 * Phases 29–30 — Personalisation's holding answers over a REAL SQL Server, as
 * the provisioned RUNTIME principal.
 *
 * WHAT ONLY THE DATABASE CAN PROVE: that the runtime principal's existing
 * grants suffice for each bounded `EXISTS` read; that a SavedItem OR a
 * WatchHistory row makes a Video held, and a SavedItem OR a ReadingHistory row
 * makes a Work or an Article held, while none does not; that another target's
 * rows never count; and that releasing the references (a purge) makes the
 * answer `false` again.
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
  let releaseWork: (workId: string, limit: number) => Promise<number>;
  let releaseArticle: (articleId: string, limit: number) => Promise<number>;

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
    releaseWork = (workId, limit) => purge.releaseWork(workId, limit);
    releaseArticle = (articleId, limit) => purge.releaseArticle(articleId, limit);
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

  it('answers held for a saved or read Work and Article, and neither for a bare one', async () => {
    const saver = await account(db.admin);
    const reader = await account(db.admin);
    const [savedWork, readWork, bareWork] = [
      await work(db.admin),
      await work(db.admin),
      await work(db.admin),
    ];
    const [savedArticle, readArticle, bareArticle] = (await articles(
      db.admin,
      saver,
      3,
    )) as [string, string, string];

    await db.admin.query(`
      INSERT INTO [dbo].[SavedItem] ([id],[userId],[workId],[createdAt])
        VALUES (${n(randomUUID())}, ${n(saver)}, ${n(savedWork)}, SYSUTCDATETIME());
      INSERT INTO [dbo].[ReadingHistory] ([id],[userId],[workId],[firstReadAt],[lastReadAt])
        VALUES (${n(randomUUID())}, ${n(reader)}, ${n(readWork)}, SYSUTCDATETIME(), SYSUTCDATETIME());
      INSERT INTO [dbo].[SavedItem] ([id],[userId],[articleId],[createdAt])
        VALUES (${n(randomUUID())}, ${n(saver)}, ${n(savedArticle)}, SYSUTCDATETIME());
      INSERT INTO [dbo].[ReadingHistory] ([id],[userId],[articleId],[firstReadAt],[lastReadAt])
        VALUES (${n(randomUUID())}, ${n(reader)}, ${n(readArticle)}, SYSUTCDATETIME(), SYSUTCDATETIME());
    `);

    expect(await holdings.workHeld(savedWork)).toBe(true);
    expect(await holdings.workHeld(readWork)).toBe(true);
    expect(await holdings.workHeld(bareWork)).toBe(false);
    expect(await holdings.articleHeld(savedArticle)).toBe(true);
    expect(await holdings.articleHeld(readArticle)).toBe(true);
    expect(await holdings.articleHeld(bareArticle)).toBe(false);
    // Each question reads its own typed column and no other.
    expect(await holdings.videoHeld(savedWork)).toBe(false);
    expect(await holdings.articleHeld(savedWork)).toBe(false);
    expect(await holdings.workHeld(savedArticle)).toBe(false);

    expect(await releaseWork(savedWork, 100)).toBe(0);
    expect(await releaseWork(readWork, 100)).toBe(0);
    expect(await releaseArticle(savedArticle, 100)).toBe(0);
    expect(await releaseArticle(readArticle, 100)).toBe(0);
    expect(await holdings.workHeld(savedWork)).toBe(false);
    expect(await holdings.workHeld(readWork)).toBe(false);
    expect(await holdings.articleHeld(savedArticle)).toBe(false);
    expect(await holdings.articleHeld(readArticle)).toBe(false);
  });
});
