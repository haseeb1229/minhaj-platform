import { createHash, randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  MigrationDecisionPort,
  MigrationPipelinePort,
  MigrationPromotionPort,
  MigrationPublicationPort,
  MigrationRawPort,
  MigrationReadPort,
  MigrationSourcePort,
  PendingItem,
  RunRecord,
  SourcePolicy,
  SourceRecord,
  TransformProvenance,
} from '../../packages/contracts/src/migration/index.ts';
import {
  getApplicationPrincipalCredentials,
  getDatabaseRuntimeUrl,
} from '../../packages/database/src/config.ts';
import { provisionApplicationPrincipal } from '../../packages/database/src/lifecycle/application-principal.ts';
import {
  assertApprovedLocalTarget,
  localTargetPolicy,
} from '../../packages/database/src/lifecycle/local-target.ts';
import {
  openSession,
  parseSqlServerUrl,
  type SqlSession,
} from '../../packages/database/src/lifecycle/sql-connection.ts';
import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from '../identity/harness.ts';
import { count, n, topic } from '../learning/fixture-sql.ts';
import { createProofAccount } from '../people/harness.ts';

/**
 * Phase 29 — Migration & Provenance's persistence adapter over a REAL SQL
 * Server, as the provisioned RUNTIME principal, under the migration's real
 * grants, keys and triggers.
 *
 * WHAT ONLY THE DATABASE CAN PROVE HERE: that a fixture source names only
 * `*.fixture.invalid` hosts; that a source has one open run, resumed by lease
 * and never forked; that discovery, evidence and staging are idempotent
 * checkpoints; that raw evidence is never rewritten or deleted; that absence
 * is an observation, never a deletion; that every decision is made at an
 * expected version; that publication and promotion approval demand
 * `migration.publish` with a live `migration-publication` step-up NOW; that a
 * rollback disables, never deletes, legacy mappings; and that a raw read is
 * bounded and audited.
 *
 * NOTHING HERE IS CONTENT. Every title is a `NON_MIGRATION_FIXTURE_…`
 * sentinel, every host sits under the reserved `.fixture.invalid` name, and
 * no request to any network host is made — bodies are synthetic bytes.
 */

const live = databaseConfigured ? describe : describe.skip;

const PROVENANCE: TransformProvenance = Object.freeze({
  adapterKey: 'fixture-video',
  adapterVersion: '1.0.0',
  parserKey: 'fixture-video-html',
  parserVersion: '1.0.0',
  normalizerVersion: '1.0.0',
  codeRevision: 'local',
});

const POLICY: SourcePolicy = Object.freeze({
  minIntervalMs: 0,
  maxConcurrency: 1,
  maxAttempts: 3,
  timeoutMs: 5000,
  maxBodyBytes: 1024 * 1024,
  maxRedirects: 2,
});

const sha = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
const sentinel = (kind: string, index: number | string) =>
  `NON_MIGRATION_FIXTURE_${kind}_${index}`;

interface World {
  readonly db: DisposableDatabase;
  readonly admin: SqlSession;
  /** A session as the provisioned RUNTIME principal, for grant-floor proofs. */
  readonly app: SqlSession;
  readonly sources: MigrationSourcePort;
  readonly pipeline: MigrationPipelinePort;
  readonly decisions: MigrationDecisionPort;
  readonly raw: MigrationRawPort;
  readonly publication: MigrationPublicationPort;
  readonly promotion: MigrationPromotionPort;
  readonly reader: MigrationReadPort;
  close(): Promise<void>;
}

/**
 * The disposable database, the provisioned runtime principal, and Migration's
 * own adapter factories from the package entry the web composition imports —
 * so every adapter write below runs as the least-privilege principal.
 */
async function migrationWorld(): Promise<World> {
  const runtimeSource = getDatabaseRuntimeUrl();
  const db = await createProofDatabase();
  try {
    const runtimeTarget = parseSqlServerUrl(runtimeSource);
    const runtimeUrl = runtimeSource.replace(
      `database=${runtimeTarget.database}`,
      `database=${db.name}`,
    );
    if (runtimeUrl === runtimeSource)
      throw new Error(
        'The runtime URL could not be repointed at the disposable database.',
      );
    const connection = assertApprovedLocalTarget(
      runtimeUrl,
      localTargetPolicy(process.env, 'disposable', 'runtime'),
    );
    const principal = getApplicationPrincipalCredentials();
    await provisionApplicationPrincipal(
      db.admin,
      principal.DATABASE_APP_LOGIN,
      principal.DATABASE_APP_PASSWORD,
    );
    const app = await openSession(connection);
    process.env['DATABASE_URL'] = runtimeUrl;
    const database = await import('../../packages/database/src/index.ts');
    return {
      db,
      admin: db.admin,
      app,
      sources: database.createMigrationSources(),
      pipeline: database.createMigrationPipeline(),
      decisions: database.createMigrationDecisions(),
      raw: database.createMigrationRaw(),
      publication: database.createMigrationPublication(),
      promotion: database.createMigrationPromotion(),
      reader: database.createMigrationReader(),
      async close() {
        await app.close();
        await db.close();
      },
    };
  } catch (error) {
    await db.close();
    throw error;
  }
}

/** A refusal's reason (`MigrationDataError`), `accepted`, or `unclassified`. */
async function reasonOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const named = error as { name?: unknown; reason?: unknown } | null;
    return named?.name === 'MigrationDataError' && typeof named.reason === 'string'
      ? named.reason
      : 'unclassified';
  }
  return 'accepted';
}

/** The SQL error number a raw statement met, or `null` when it succeeded. */
async function sqlNumber(promise: Promise<unknown>): Promise<number | null> {
  try {
    await promise;
  } catch (error) {
    const number = (error as { number?: unknown } | null)?.number;
    return typeof number === 'number' ? number : -1;
  }
  return null;
}

/**
 * An account holding `migration.publish` through a live assignment of a live
 * role, with a live session and a live `migration-publication` step-up —
 * exactly what the publication and promotion triggers demand, written as
 * Identity would.
 */
async function publisher(admin: SqlSession): Promise<string> {
  const id = await createProofAccount(admin);
  const role = randomUUID();
  const session = randomUUID();
  await admin.query(`
    INSERT INTO [dbo].[Role] ([id],[key],[name],[description],[system])
      VALUES (${n(role)}, ${n(`proof-migration-publish-${role.slice(0, 8)}`)}, N'NON_MIGRATION_FIXTURE publish role', N'Holds migration.publish for the integration proof only.', 0);
    INSERT INTO [dbo].[RolePermission] ([roleId],[permissionKey]) VALUES (${n(role)}, N'migration.publish');
    INSERT INTO [dbo].[RoleAssignment] ([userId],[roleId]) VALUES (${n(id)}, ${n(role)});
    INSERT INTO [dbo].[Session] ([id],[token],[userId],[expiresAt],[createdAt],[updatedAt])
      VALUES (${n(session)}, ${n(`proof-migration-${session}`)}, ${n(id)}, DATEADD(hour,2,SYSUTCDATETIME()), SYSUTCDATETIME(), SYSUTCDATETIME());
    INSERT INTO [dbo].[StepUpGrant] ([userId],[sessionId],[purpose],[expiresAt])
      VALUES (${n(id)}, ${n(session)}, N'migration-publication', DATEADD(hour,1,SYSUTCDATETIME()));
  `);
  return id;
}

/** A draft Video, written as Media's owner would — the target a mapping names. */
async function video(admin: SqlSession): Promise<string> {
  const id = randomUUID();
  const provider = randomUUID().replaceAll('-', '').slice(0, 11);
  await admin.query(`
    INSERT INTO [dbo].[Video] ([id],[slug],[primaryLocale],[state],[isFeatured],[provider],[providerVideoId],[availability],[languageCode],[version],[updatedAt])
    VALUES (${n(id)}, ${n(`non-migration-fixture-${id}`)}, N'en', N'draft', 0, N'youtube', '${provider}', N'available', N'en', 1, SYSUTCDATETIME());
  `);
  return id;
}

interface AuditRow {
  readonly action: string;
  readonly actorId: string | null;
  readonly authorisingSource: string | null;
  readonly beforeState: string | null;
  readonly afterState: string | null;
}

function auditFor(admin: SqlSession, targetId: string): Promise<AuditRow[]> {
  return admin.query<AuditRow>(`
    SELECT [action],[actorId],[authorisingSource],[beforeState],[afterState]
    FROM [dbo].[AuditLog] WHERE [targetId] = ${n(targetId)} ORDER BY [occurredAt], [id];
  `);
}

live('Phase 29 Migration & Provenance persistence against real SQL Server', () => {
  let world: World;
  let admin: SqlSession;
  let operator: string;
  let authority: string;
  let sequence = 0;

  beforeAll(async () => {
    world = await migrationWorld();
    admin = world.admin;
    operator = await createProofAccount(admin);
    authority = await publisher(admin);
  }, 300_000);

  afterAll(async () => {
    await world?.close();
  });

  /* ===========================================================================
   * Steps
   * ========================================================================= */

  async function fixtureSource(): Promise<SourceRecord> {
    sequence += 1;
    const host = `s${sequence}.fixture.invalid`;
    return world.sources.createFixtureSource({
      id: randomUUID(),
      key: `fixture-source-${sequence}-${Date.now().toString(36)}`,
      name: sentinel('SOURCE', sequence),
      accessMethod: 'http',
      contentKind: 'media.video',
      baseUrl: `https://${host}/`,
      hosts: [host],
      defaultLanguageCode: 'en',
      policy: POLICY,
      licensingEvidence: null,
      policyNotes: null,
      actorId: operator,
      now: new Date(),
    });
  }

  const urlOf = (source: SourceRecord, key: string) =>
    `https://${source.hosts[0]}/videos/${key}`;

  async function openRun(
    source: SourceRecord,
    leaseToken: string = randomUUID(),
  ): Promise<{ readonly run: RunRecord; readonly token: string }> {
    const now = new Date();
    const { run } = await world.pipeline.openRun({
      sourceId: source.id,
      operatorUserId: operator,
      provenance: PROVENANCE,
      runId: randomUUID(),
      leaseToken,
      leaseUntil: new Date(now.getTime() + 600_000),
      now,
    });
    return { run, token: leaseToken };
  }

  function discover(
    source: SourceRecord,
    run: { readonly run: RunRecord; readonly token: string },
    keys: readonly string[],
    complete = true,
  ): Promise<void> {
    return world.pipeline.recordDiscovery({
      runId: run.run.id,
      leaseToken: run.token,
      items: keys.map((key) => ({
        externalKey: urlOf(source, key),
        originalUrl: urlOf(source, key),
        legacyIdentifier: null,
      })),
      nextCursor: complete ? null : 'page-2',
      complete,
      now: new Date(),
    });
  }

  async function pending(runId: string): Promise<PendingItem[]> {
    return [...(await world.pipeline.pendingItems(runId, 25, new Date()))];
  }

  async function fetchItem(
    source: SourceRecord,
    runId: string,
    item: PendingItem,
    text = `<html>${sentinel('BODY', item.externalKey)}</html>`,
  ): Promise<{
    readonly snapshotId: string;
    readonly checksum: string;
    readonly reused: boolean;
  }> {
    const body = new TextEncoder().encode(text);
    const checksum = sha(body);
    const stored = await world.pipeline.storeSnapshot({
      sourceId: source.id,
      runId,
      itemId: item.itemId,
      recordId: item.recordId,
      requestedUrl: item.externalKey,
      finalUrl: item.externalKey,
      httpStatus: 200,
      contentType: 'text/html',
      headers: JSON.stringify({ 'content-type': 'text/html' }),
      body,
      checksum,
      fetchedAt: new Date(),
      fetcherKey: 'fixture-fetch',
      fetcherVersion: '1',
      personalData: 'none',
    });
    return { ...stored, checksum };
  }

  async function stage(
    source: SourceRecord,
    runId: string,
    item: PendingItem,
    options: {
      readonly title?: string;
      readonly dedupeKey?: string | null;
      readonly categories?: readonly { readonly key: string; readonly label: string }[];
      readonly duplicates?: Parameters<MigrationPipelinePort['stage']>[0]['duplicates'];
      readonly body?: string;
    } = {},
  ): Promise<{ readonly stagedRecordId: string; readonly revision: number }> {
    const fetched = await fetchItem(source, runId, item, options.body);
    const title = options.title ?? sentinel('TITLE', item.recordId);
    const payload = JSON.stringify({ kind: 'media.video', title });
    return world.pipeline.stage({
      sourceId: source.id,
      runId,
      itemId: item.itemId,
      recordId: item.recordId,
      snapshotId: fetched.snapshotId,
      contentKind: 'media.video',
      title,
      titleKey: title.toLowerCase(),
      dedupeKey: options.dedupeKey ?? null,
      languageCode: 'en',
      payload,
      payloadChecksum: sha(payload),
      provenance: PROVENANCE,
      inputChecksum: fetched.checksum,
      producedAt: new Date(),
      validation: 'valid',
      issues: [],
      personalData: 'none',
      categories: options.categories ?? [],
      links: [],
      duplicates: options.duplicates ?? [],
      outcome: 'staged',
      error: null,
    });
  }

  async function completeRun(
    run: { readonly run: RunRecord; readonly token: string },
    reconciliation: 'balanced' | 'unbalanced' = 'balanced',
  ): Promise<number> {
    const { missing } = await world.pipeline.completeRun({
      runId: run.run.id,
      leaseToken: run.token,
      reconciliation,
      detail: 'fixture reconciliation',
      now: new Date(),
    });
    return missing;
  }

  async function approve(stagedRecordId: string): Promise<void> {
    const detail = await world.reader.stagedDetail(stagedRecordId);
    await world.decisions.review({
      stagedRecordId,
      expectedVersion: detail?.version ?? 0,
      review: 'approved',
      note: null,
      actorId: operator,
      now: new Date(),
    });
  }

  /* ===========================================================================
   * Sources
   * ========================================================================= */

  it('registers a fixture source with its hosts, audited, and refuses every non-fixture host', async () => {
    const source = await fixtureSource();
    expect(source).toMatchObject({
      authorityKind: 'fixture',
      state: 'active',
      version: 1,
    });
    expect(source.hosts).toEqual([`s${sequence}.fixture.invalid`]);
    expect((await auditFor(admin, source.id)).map((row) => row.action)).toEqual([
      'migration.source.created',
    ]);

    // The same key again is a duplicate, not a second source.
    expect(
      await reasonOf(
        world.sources.createFixtureSource({
          ...source,
          id: randomUUID(),
          hosts: [...source.hosts],
          actorId: operator,
          now: new Date(),
        }),
      ),
    ).toBe('duplicate');

    // A fixture naming a real-looking host is refused by the host trigger.
    sequence += 1;
    expect(
      await reasonOf(
        world.sources.createFixtureSource({
          id: randomUUID(),
          key: `fixture-source-${sequence}-real`,
          name: sentinel('SOURCE', sequence),
          accessMethod: 'export',
          contentKind: 'media.video',
          baseUrl: null,
          hosts: ['www.example.org'],
          defaultLanguageCode: null,
          policy: POLICY,
          licensingEvidence: null,
          policyNotes: null,
          actorId: operator,
          now: new Date(),
        }),
      ),
    ).toBe('host-refused');
    // And a fixture base URL outside `.fixture.invalid` by the CHECK.
    expect(
      await reasonOf(
        world.sources.createFixtureSource({
          id: randomUUID(),
          key: `fixture-source-${sequence}-base`,
          name: sentinel('SOURCE', sequence),
          accessMethod: 'http',
          contentKind: 'media.video',
          baseUrl: 'https://www.example.org/',
          hosts: [],
          defaultLanguageCode: null,
          policy: POLICY,
          licensingEvidence: null,
          policyNotes: null,
          actorId: operator,
          now: new Date(),
        }),
      ),
    ).toBe('invalid');

    // As the RUNTIME principal, raw SQL meets the same floor.
    expect(
      await sqlNumber(
        world.app.query(
          `INSERT INTO [dbo].[MigrationSourceHost] ([sourceId],[host]) VALUES (${n(source.id)}, N'www.example.org');`,
        ),
      ),
    ).toBe(51371);
    expect(
      await sqlNumber(
        world.app.query(
          `DELETE FROM [dbo].[MigrationSourceHost] WHERE [sourceId] = ${n(source.id)};`,
        ),
      ),
    ).toBe(229);
    expect(
      await sqlNumber(
        world.app.query(
          `UPDATE [dbo].[MigrationSource] SET [authorityKind] = N'authorised' WHERE [id] = ${n(source.id)};`,
        ),
      ),
    ).toBe(230);

    const updated = await world.sources.updateSource({
      id: source.id,
      expectedVersion: 1,
      name: sentinel('SOURCE', 'renamed'),
      state: 'inactive',
      defaultLanguageCode: 'ur',
      policy: POLICY,
      licensingEvidence: null,
      policyNotes: null,
      actorId: operator,
      now: new Date(),
    });
    expect(updated).toMatchObject({
      state: 'inactive',
      version: 2,
      defaultLanguageCode: 'ur',
    });
    expect(
      await reasonOf(
        world.sources.updateSource({
          id: source.id,
          expectedVersion: 1,
          name: sentinel('SOURCE', 'stale'),
          state: 'active',
          defaultLanguageCode: null,
          policy: POLICY,
          licensingEvidence: null,
          policyNotes: null,
          actorId: operator,
          now: new Date(),
        }),
      ),
    ).toBe('conflict');
    // An inactive source runs nothing.
    expect(await reasonOf(openRun(updated))).toBe('invalid-state');
  });

  /* ===========================================================================
   * Runs
   * ========================================================================= */

  it('opens one run per source, resumes it by lease, and refuses a second live holder', async () => {
    const source = await fixtureSource();
    const first = await openRun(source, 'lease-holder-a');
    expect(first.run).toMatchObject({ state: 'open', version: 1, sourceKey: source.key });

    // Another holder while the lease is live: refused, nothing forked.
    expect(await reasonOf(openRun(source, 'lease-holder-b'))).toBe('run-busy');
    expect(await count(admin, 'MigrationRun', `[sourceId] = ${n(source.id)}`)).toBe(1);

    // The same holder resumes its own run.
    const again = await world.pipeline.openRun({
      sourceId: source.id,
      operatorUserId: operator,
      provenance: PROVENANCE,
      runId: randomUUID(),
      leaseToken: 'lease-holder-a',
      leaseUntil: new Date(Date.now() + 600_000),
      now: new Date(),
    });
    expect(again).toMatchObject({ resumed: true, run: { id: first.run.id, version: 2 } });

    // Once the lease lapses, a new holder resumes the SAME run.
    const later = new Date(Date.now() + 700_000);
    const taken = await world.pipeline.openRun({
      sourceId: source.id,
      operatorUserId: operator,
      provenance: PROVENANCE,
      runId: randomUUID(),
      leaseToken: 'lease-holder-b',
      leaseUntil: new Date(later.getTime() + 600_000),
      now: later,
    });
    expect(taken).toMatchObject({ resumed: true, run: { id: first.run.id, version: 3 } });

    // The superseded holder can no longer write a checkpoint or renew.
    expect(await reasonOf(discover(source, first, ['a']))).toBe('lease-lost');
    expect(
      await world.pipeline.renewLease(
        first.run.id,
        'lease-holder-a',
        new Date(Date.now() + 1),
      ),
    ).toBe(false);
    expect(
      await world.pipeline.renewLease(
        first.run.id,
        'lease-holder-b',
        new Date(Date.now() + 900_000),
      ),
    ).toBe(true);

    expect((await auditFor(admin, first.run.id)).map((row) => row.action)).toEqual([
      'migration.run.started',
      'migration.run.resumed',
      'migration.run.resumed',
    ]);

    // An operator cancels at the expected version; a stale cancel is a conflict.
    expect(
      await reasonOf(
        world.pipeline.cancelRun({
          runId: first.run.id,
          expectedVersion: 1,
          actorId: operator,
          now: new Date(),
        }),
      ),
    ).toBe('conflict');
    await world.pipeline.cancelRun({
      runId: first.run.id,
      expectedVersion: 3,
      actorId: operator,
      now: new Date(),
    });
    expect((await world.reader.run(first.run.id))?.state).toBe('cancelled');
    // A cancelled run frees the source for a new one.
    const next = await openRun(source);
    expect(next.run.id).not.toBe(first.run.id);
  });

  it('records discovery idempotently: a checkpoint run twice adds nothing', async () => {
    const source = await fixtureSource();
    const run = await openRun(source);
    await discover(source, run, ['one', 'two', 'three', 'two'], false);
    expect(await count(admin, 'MigrationRecord', `[sourceId] = ${n(source.id)}`)).toBe(3);
    const firstItems = await admin.query<{ position: number }>(
      `SELECT [position] FROM [dbo].[MigrationRunItem] WHERE [runId] = ${n(run.run.id)} ORDER BY [position];`,
    );
    expect(firstItems.map((row) => row.position)).toEqual([0, 1, 2]);

    // The same checkpoint again: nothing new, nothing moved.
    const before = await admin.query<{ version: number }>(
      `SELECT [version] FROM [dbo].[MigrationRecord] WHERE [sourceId] = ${n(source.id)} ORDER BY [id];`,
    );
    await discover(source, run, ['one', 'two', 'three'], false);
    expect(await count(admin, 'MigrationRecord', `[sourceId] = ${n(source.id)}`)).toBe(3);
    expect(await count(admin, 'MigrationRunItem', `[runId] = ${n(run.run.id)}`)).toBe(3);
    expect(
      await admin.query<{ version: number }>(
        `SELECT [version] FROM [dbo].[MigrationRecord] WHERE [sourceId] = ${n(source.id)} ORDER BY [id];`,
      ),
    ).toEqual(before);

    // The next checkpoint adds only what is new, at the next position.
    await discover(source, run, ['three', 'four'], true);
    const items = await admin.query<{ position: number; externalKey: string }>(`
      SELECT i.[position], r.[externalKey] FROM [dbo].[MigrationRunItem] i
      JOIN [dbo].[MigrationRecord] r ON r.[id] = i.[recordId]
      WHERE i.[runId] = ${n(run.run.id)} ORDER BY i.[position];`);
    expect(items.map((row) => row.position)).toEqual([0, 1, 2, 3]);
    expect(items[3]?.externalKey).toBe(urlOf(source, 'four'));
    const stored = await world.reader.run(run.run.id);
    expect(stored).toMatchObject({ discoveryComplete: true, discoveryCursor: null });

    // A batch beyond the checkpoint unit is refused before it is read.
    expect(
      await reasonOf(
        discover(
          source,
          run,
          Array.from({ length: 26 }, (_, index) => `bulk-${index}`),
        ),
      ),
    ).toBe('invalid');

    const queue = await pending(run.run.id);
    expect(queue.map((item) => item.externalKey)).toEqual(
      ['one', 'two', 'three', 'four'].map((key) => urlOf(source, key)),
    );
  });

  /* ===========================================================================
   * Evidence
   * ========================================================================= */

  it('keeps raw evidence once: the same bytes reuse the snapshot, and nothing rewrites or deletes it', async () => {
    const source = await fixtureSource();
    const run = await openRun(source);
    await discover(source, run, ['evidence']);
    const [item] = await pending(run.run.id);
    if (item === undefined) throw new Error('no pending item');

    const first = await fetchItem(source, run.run.id, item);
    expect(first.reused).toBe(false);
    const second = await fetchItem(source, run.run.id, item);
    expect(second).toMatchObject({ reused: true, snapshotId: first.snapshotId });
    expect(
      await count(admin, 'MigrationRawSnapshot', `[recordId] = ${n(item.recordId)}`),
    ).toBe(1);
    const [record] = await admin.query<{ status: string; latestSnapshotId: string }>(
      `SELECT [status],[latestSnapshotId] FROM [dbo].[MigrationRecord] WHERE [id] = ${n(item.recordId)};`,
    );
    expect(record).toEqual({ status: 'fetched', latestSnapshotId: first.snapshotId });

    // A checksum that is not the body's is refused by the CHECK.
    expect(
      await reasonOf(
        world.pipeline.storeSnapshot({
          sourceId: source.id,
          runId: run.run.id,
          itemId: item.itemId,
          recordId: item.recordId,
          requestedUrl: item.externalKey,
          finalUrl: item.externalKey,
          httpStatus: 200,
          contentType: 'text/html',
          headers: null,
          body: new TextEncoder().encode('different bytes'),
          checksum: sha('not these bytes'),
          fetchedAt: new Date(),
          fetcherKey: 'fixture-fetch',
          fetcherVersion: '1',
          personalData: 'none',
        }),
      ),
    ).toBe('invalid');

    // The runtime cannot rewrite or delete evidence; the owner cannot either.
    expect(
      await sqlNumber(
        world.app.query(
          `UPDATE [dbo].[MigrationRawSnapshot] SET [requestedUrl] = N'https://x.fixture.invalid/' WHERE [id] = ${n(first.snapshotId)};`,
        ),
      ),
    ).toBe(230);
    expect(
      await sqlNumber(
        world.app.query(
          `DELETE FROM [dbo].[MigrationRawSnapshot] WHERE [id] = ${n(first.snapshotId)};`,
        ),
      ),
    ).toBe(229);
    expect(
      await sqlNumber(
        admin.query(
          `UPDATE [dbo].[MigrationRawSnapshot] SET [fetcherVersion] = N'2' WHERE [id] = ${n(first.snapshotId)};`,
        ),
      ),
    ).toBe(51372);
    // Even the owner's DELETE is refused: nothing cascades, so the record and
    // item naming the snapshot hold it (547) before the trigger (51372) is reached.
    expect(
      await sqlNumber(
        admin.query(
          `DELETE FROM [dbo].[MigrationRawSnapshot] WHERE [id] = ${n(first.snapshotId)};`,
        ),
      ),
    ).toBe(547);
    expect(
      await count(admin, 'MigrationRawSnapshot', `[id] = ${n(first.snapshotId)}`),
    ).toBe(1);
  });

  it('reads a raw body only up to its bound, audits every read, and disposes of the body alone', async () => {
    const source = await fixtureSource();
    const run = await openRun(source);
    await discover(source, run, ['raw']);
    const [item] = await pending(run.run.id);
    if (item === undefined) throw new Error('no pending item');
    const text = 'x'.repeat(1000);
    const { snapshotId } = await fetchItem(source, run.run.id, item, text);

    const read = await world.raw.readSnapshot({
      snapshotId,
      maxBytes: 16,
      purpose: 'preview',
      actorId: operator,
      now: new Date(),
    });
    expect(read).toMatchObject({ id: snapshotId, byteSize: 1000, checksum: sha(text) });
    expect(read?.body?.byteLength).toBe(16);
    expect(new TextDecoder().decode(read?.body ?? new Uint8Array())).toBe('x'.repeat(16));
    const audits = await auditFor(admin, snapshotId);
    expect(audits.map((row) => row.action)).toEqual(['migration.snapshot.read']);
    expect(JSON.parse(audits[0]?.afterState ?? '{}')).toEqual({
      purpose: 'preview',
      byteSize: '1000',
      bytesRead: '16',
      disposed: 'false',
    });
    // The audit row never carries the bytes.
    expect(audits[0]?.afterState).not.toContain('xxxx');

    // A missing snapshot is answered, and nothing is recorded.
    expect(
      await world.raw.readSnapshot({
        snapshotId: randomUUID(),
        maxBytes: 16,
        purpose: 'download',
        actorId: operator,
        now: new Date(),
      }),
    ).toBeNull();

    await world.raw.disposeSnapshot({
      snapshotId,
      reason: 'fixture disposal',
      actorId: operator,
      now: new Date(),
    });
    const meta = await world.reader.snapshot(snapshotId);
    expect(meta).toMatchObject({ byteSize: 1000, checksum: sha(text) });
    expect(meta?.disposedAt).toBeInstanceOf(Date);
    const after = await world.raw.readSnapshot({
      snapshotId,
      maxBytes: 16,
      purpose: 'download',
      actorId: operator,
      now: new Date(),
    });
    expect(after?.body).toBeNull();
    expect(
      await reasonOf(
        world.raw.disposeSnapshot({
          snapshotId,
          reason: 'again',
          actorId: operator,
          now: new Date(),
        }),
      ),
    ).toBe('invalid-state');
    expect((await auditFor(admin, snapshotId)).map((row) => row.action)).toEqual([
      'migration.snapshot.read',
      'migration.snapshot.disposed',
      'migration.snapshot.read',
    ]);
  });

  /* ===========================================================================
   * Staging, review and duplicates
   * ========================================================================= */

  it('supersedes the earlier revision when a record is staged again, and refuses a stale review', async () => {
    const source = await fixtureSource();
    const firstRun = await openRun(source);
    await discover(source, firstRun, ['revisions']);
    const [item] = await pending(firstRun.run.id);
    if (item === undefined) throw new Error('no pending item');
    const first = await stage(source, firstRun.run.id, item, {
      categories: [{ key: 'lectures', label: sentinel('CATEGORY', 'lectures') }],
    });
    expect(first.revision).toBe(1);

    // A stale review is a conflict; the right version approves.
    expect(
      await reasonOf(
        world.decisions.review({
          stagedRecordId: first.stagedRecordId,
          expectedVersion: 7,
          review: 'approved',
          note: null,
          actorId: operator,
          now: new Date(),
        }),
      ),
    ).toBe('conflict');
    await approve(first.stagedRecordId);
    const [approvedRecord] = await admin.query<{ status: string }>(
      `SELECT [status] FROM [dbo].[MigrationRecord] WHERE [id] = ${n(item.recordId)};`,
    );
    expect(approvedRecord?.status).toBe('approved');
    expect(await completeRun(firstRun)).toBe(0);

    const secondRun = await openRun(source);
    await discover(source, secondRun, ['revisions']);
    const [again] = await pending(secondRun.run.id);
    if (again === undefined) throw new Error('no pending item');
    expect(again.currentStaged).toMatchObject({ id: first.stagedRecordId, revision: 1 });
    const second = await stage(source, secondRun.run.id, again, {
      body: '<html>changed</html>',
      categories: [{ key: 'lectures', label: sentinel('CATEGORY', 'lectures') }],
    });
    expect(second.revision).toBe(2);

    const revisions = await admin.query<{
      id: string;
      review: string;
      version: number;
      reviewedByUserId: string | null;
    }>(`
      SELECT [id],[review],[version],[reviewedByUserId] FROM [dbo].[MigrationStagedRecord]
      WHERE [recordId] = ${n(item.recordId)} ORDER BY [revision];`);
    expect(revisions).toEqual([
      {
        id: first.stagedRecordId,
        review: 'superseded',
        version: 3,
        reviewedByUserId: operator,
      },
      {
        id: second.stagedRecordId,
        review: 'pending',
        version: 1,
        reviewedByUserId: null,
      },
    ]);
    const [record] = await admin.query<{ status: string; currentStagedRecordId: string }>(
      `SELECT [status],[currentStagedRecordId] FROM [dbo].[MigrationRecord] WHERE [id] = ${n(item.recordId)};`,
    );
    expect(record).toEqual({
      status: 'staged',
      currentStagedRecordId: second.stagedRecordId,
    });
    // One category, one mapping, reused by both revisions.
    expect(
      await count(admin, 'MigrationTopicMapping', `[sourceId] = ${n(source.id)}`),
    ).toBe(1);
    const detail = await world.reader.stagedDetail(second.stagedRecordId);
    expect(detail?.categories).toMatchObject([
      { categoryKey: 'lectures', state: 'unmapped' },
    ]);

    // A revision's payload is never rewritten (grant and trigger).
    expect(
      await sqlNumber(
        world.app.query(
          `UPDATE [dbo].[MigrationStagedRecord] SET [payload] = N'{}' WHERE [id] = ${n(second.stagedRecordId)};`,
        ),
      ),
    ).toBe(230);
    expect(
      (await auditFor(admin, first.stagedRecordId)).map((row) => row.action),
    ).toEqual(['migration.staged.reviewed']);
  });

  it('collapses a hard-identity duplicate into the earlier record, and a person can undo it', async () => {
    const source = await fixtureSource();
    const run = await openRun(source);
    await discover(source, run, ['original', 'copy']);
    const [original, copy] = await pending(run.run.id);
    if (original === undefined || copy === undefined) throw new Error('no pending items');
    await stage(source, run.run.id, original, { dedupeKey: 'youtube:fixture00001' });

    const matches = await world.pipeline.dedupeMatches(
      'youtube:fixture00001',
      copy.recordId,
    );
    expect(matches).toEqual([{ recordId: original.recordId, languageCode: 'en' }]);
    await stage(source, run.run.id, copy, {
      dedupeKey: 'youtube:fixture00001',
      duplicates: [
        {
          otherRecordId: original.recordId,
          signal: 'provider-id',
          score: 100,
          crossLanguage: false,
          collapse: true,
        },
      ],
    });
    const [collapsed] = await admin.query<{
      status: string;
      mergedIntoRecordId: string | null;
    }>(
      `SELECT [status],[mergedIntoRecordId] FROM [dbo].[MigrationRecord] WHERE [id] = ${n(copy.recordId)};`,
    );
    expect(collapsed).toEqual({
      status: 'merged',
      mergedIntoRecordId: original.recordId,
    });
    const candidates = await world.reader.duplicates({
      state: 'collapsed',
      offset: 0,
      limit: 100,
    });
    const candidate = candidates.rows.find((row) => row.recordId === copy.recordId);
    expect(candidate).toMatchObject({ otherRecordId: original.recordId, version: 1 });
    expect((await world.pipeline.reconciliationCounts(run.run.id)).merged).toBe(1);

    // A person decides they are distinct: the record returns to its revision's state.
    await world.decisions.decideDuplicate({
      candidateId: candidate?.id ?? '',
      expectedVersion: 1,
      state: 'distinct',
      note: null,
      actorId: operator,
      now: new Date(),
    });
    const [restored] = await admin.query<{
      status: string;
      mergedIntoRecordId: string | null;
    }>(
      `SELECT [status],[mergedIntoRecordId] FROM [dbo].[MigrationRecord] WHERE [id] = ${n(copy.recordId)};`,
    );
    expect(restored).toEqual({ status: 'staged', mergedIntoRecordId: null });
    expect(
      await reasonOf(
        world.decisions.decideDuplicate({
          candidateId: candidate?.id ?? '',
          expectedVersion: 1,
          state: 'merged',
          note: null,
          actorId: operator,
          now: new Date(),
        }),
      ),
    ).toBe('conflict');
  });

  /* ===========================================================================
   * Reconciliation and absence
   * ========================================================================= */

  it('counts every outcome of a run in one aggregate', async () => {
    const source = await fixtureSource();
    const run = await openRun(source);
    await discover(source, run, [
      'staged',
      'unchanged',
      'excluded',
      'errored',
      'waiting',
    ]);
    const [staged, unchanged, excluded, errored] = await pending(run.run.id);
    if (!staged || !unchanged || !excluded || !errored)
      throw new Error('no pending items');
    await stage(source, run.run.id, staged);
    await world.pipeline.markUnchanged(unchanged.itemId, new Date());
    await world.pipeline.markExcluded(excluded.itemId, new Date());
    await world.pipeline.recordError({
      sourceId: source.id,
      runId: run.run.id,
      recordId: errored.recordId,
      itemId: errored.itemId,
      stage: 'fetch',
      classification: 'server-error',
      retryEligible: true,
      httpStatus: 503,
      attempt: 3,
      detail: 'fixture server error',
      occurredAt: new Date(),
    });

    expect(await world.pipeline.reconciliationCounts(run.run.id)).toEqual({
      discovered: 5,
      pending: 1,
      fetched: 2,
      parsed: 1,
      staged: 1,
      unchanged: 1,
      rejected: 0,
      errored: 1,
      excluded: 1,
      inconsistent: 0,
      reviewPending: 1,
      approved: 0,
      reviewRejected: 0,
      superseded: 0,
      published: 0,
      mapped: 0,
      merged: 0,
    });
    expect(await reasonOf(world.pipeline.reconciliationCounts(randomUUID()))).toBe(
      'not-found',
    );

    // A retry of the error returns its item to the queue while the run is open.
    const errors = await world.reader.errors({
      resolution: 'open',
      runId: run.run.id,
      offset: 0,
      limit: 25,
    });
    expect(errors.total).toBe(1);
    await world.decisions.decideError({
      errorId: errors.rows[0]?.id ?? '',
      expectedVersion: 1,
      resolution: 'retry-requested',
      actorId: operator,
      now: new Date(),
    });
    expect((await world.pipeline.reconciliationCounts(run.run.id)).pending).toBe(2);
  });

  it('marks records a complete discovery did not see missing — never deleting them — for a person to classify', async () => {
    const source = await fixtureSource();
    const first = await openRun(source);
    await discover(source, first, ['kept', 'gone']);
    expect(await completeRun(first)).toBe(0);

    const second = await openRun(source);
    // Absence means nothing until discovery is complete.
    await discover(source, second, ['kept'], false);
    expect(await reasonOf(completeRun(second))).toBe('invalid-state');
    await discover(source, second, [], true);
    expect(await completeRun(second)).toBe(1);

    const [gone] = await admin.query<{
      id: string;
      observed: string;
      status: string;
      version: number;
    }>(
      `SELECT [id],[observed],[status],[version] FROM [dbo].[MigrationRecord] WHERE [externalKey] = ${n(urlOf(source, 'gone'))};`,
    );
    expect(gone).toMatchObject({ observed: 'missing', status: 'discovered' });
    expect(await count(admin, 'MigrationRecord', `[sourceId] = ${n(source.id)}`)).toBe(2);
    const missing = await world.reader.missingRecords({ offset: 0, limit: 100 });
    expect(missing.rows.some((row) => row.id === gone?.id)).toBe(true);

    const [kept] = await admin.query<{ id: string; version: number }>(
      `SELECT [id],[version] FROM [dbo].[MigrationRecord] WHERE [externalKey] = ${n(urlOf(source, 'kept'))};`,
    );
    expect(
      await reasonOf(
        world.decisions.classifyDisappearance({
          recordId: kept?.id ?? '',
          expectedVersion: kept?.version ?? 0,
          classification: 'withdrawn',
          note: null,
          actorId: operator,
          now: new Date(),
        }),
      ),
    ).toBe('invalid-state');
    expect(
      await reasonOf(
        world.decisions.classifyDisappearance({
          recordId: gone?.id ?? '',
          expectedVersion: (gone?.version ?? 0) - 1,
          classification: 'withdrawn',
          note: null,
          actorId: operator,
          now: new Date(),
        }),
      ),
    ).toBe('conflict');
    await world.decisions.classifyDisappearance({
      recordId: gone?.id ?? '',
      expectedVersion: gone?.version ?? 0,
      classification: 'withdrawn',
      note: sentinel('NOTE', 'withdrawn'),
      actorId: operator,
      now: new Date(),
    });
    const audits = await auditFor(admin, gone?.id ?? '');
    expect(audits.map((row) => row.action)).toEqual(['migration.record.classified']);
    expect(audits[0]?.afterState).not.toContain('NON_MIGRATION_FIXTURE_NOTE');

    // Seen again, the record is present and its classification cleared.
    const third = await openRun(source);
    await discover(source, third, ['kept', 'gone']);
    const [back] = await admin.query<{ observed: string; disappearance: string | null }>(
      `SELECT [observed],[disappearance] FROM [dbo].[MigrationRecord] WHERE [id] = ${n(gone?.id ?? '')};`,
    );
    expect(back).toEqual({ observed: 'present', disappearance: null });
  });

  /* ===========================================================================
   * Publication, rollback and promotion
   * ========================================================================= */

  it('refuses a manifest over a run that did not complete balanced', async () => {
    const source = await fixtureSource();
    const run = await openRun(source);
    await discover(source, run, ['unreconciled']);
    const [item] = await pending(run.run.id);
    if (item === undefined) throw new Error('no pending item');
    const { stagedRecordId } = await stage(source, run.run.id, item);
    await approve(stagedRecordId);
    const create = () =>
      world.publication.createManifest({
        id: randomUUID(),
        runId: run.run.id,
        stagedRecordIds: [stagedRecordId],
        actorId: operator,
        now: new Date(),
      });
    expect(await reasonOf(create())).toBe('run-unreconciled');
    await completeRun(run, 'unbalanced');
    expect(await reasonOf(create())).toBe('run-unreconciled');
    expect(
      await count(admin, 'MigrationPublishManifest', `[runId] = ${n(run.run.id)}`),
    ).toBe(0);
  });

  it('publishes only with live publication authority, maps legacy URLs, rolls back by disabling them, and promotes only published entries', async () => {
    const source = await fixtureSource();
    const run = await openRun(source);
    await discover(source, run, ['published', 'merged-copy', 'unpublished']);
    const [main, copy, other] = await pending(run.run.id);
    if (!main || !copy || !other) throw new Error('no pending items');
    const staged = await stage(source, run.run.id, main, {
      dedupeKey: 'youtube:fixture00002',
      categories: [{ key: 'talks', label: sentinel('CATEGORY', 'talks') }],
    });
    await stage(source, run.run.id, copy, {
      dedupeKey: 'youtube:fixture00002',
      duplicates: [
        {
          otherRecordId: main.recordId,
          signal: 'provider-id',
          score: 100,
          crossLanguage: false,
          collapse: true,
        },
      ],
    });
    const otherStaged = await stage(source, run.run.id, other);
    await approve(staged.stagedRecordId);
    await approve(otherStaged.stagedRecordId);
    await completeRun(run, 'balanced');

    // The topic mapping a person confirms is what publication proposes.
    const topicId = await topic(admin);
    const mappings = await world.reader.topicMappings({
      state: 'unmapped',
      offset: 0,
      limit: 100,
    });
    const mapping = mappings.rows.find((row) => row.sourceKey === source.key);
    await world.decisions.decideTopicMapping({
      mappingId: mapping?.id ?? '',
      expectedVersion: mapping?.version ?? 0,
      state: 'confirmed',
      topicId,
      actorId: operator,
      now: new Date(),
    });

    const manifestId = randomUUID();
    const manifest = await world.publication.createManifest({
      id: manifestId,
      runId: run.run.id,
      stagedRecordIds: [staged.stagedRecordId, otherStaged.stagedRecordId],
      actorId: operator,
      now: new Date(),
    });
    expect(manifest).toMatchObject({ state: 'draft', version: 1 });
    // A revision live in one manifest joins no second one.
    expect(
      await reasonOf(
        world.publication.createManifest({
          id: randomUUID(),
          runId: run.run.id,
          stagedRecordIds: [staged.stagedRecordId],
          actorId: operator,
          now: new Date(),
        }),
      ),
    ).toBe('conflict');
    // So a new manifest is offered only what no live entry holds (Phase 30-R):
    // the approved revisions stay listed, the unmanifested offer is empty.
    const approvedOf = (unmanifested: boolean) =>
      world.reader.staged({
        review: 'approved',
        runId: run.run.id,
        unmanifested,
        offset: 0,
        limit: 100,
      });
    expect((await approvedOf(false)).rows.map((row) => row.id).sort()).toEqual(
      [staged.stagedRecordId, otherStaged.stagedRecordId].sort(),
    );
    expect(await approvedOf(true)).toMatchObject({ rows: [], total: 0 });

    // Without migration.publish and a live step-up the database refuses.
    expect(
      await reasonOf(
        world.publication.beginPublication({
          manifestId,
          expectedVersion: 1,
          actorId: operator,
          now: new Date(),
        }),
      ),
    ).toBe('denied');
    expect(
      await sqlNumber(
        world.app.query(`
          UPDATE [dbo].[MigrationPublishManifest]
          SET [state] = N'publishing', [publishedByUserId] = ${n(operator)},
              [publishStartedAt] = SYSUTCDATETIME(), [version] = [version] + 1
          WHERE [id] = ${n(manifestId)};`),
      ),
    ).toBe(51378);
    expect((await world.publication.manifest(manifestId))?.manifest.state).toBe('draft');

    const publishing = await world.publication.beginPublication({
      manifestId,
      expectedVersion: 1,
      actorId: authority,
      now: new Date(),
    });
    expect(publishing).toMatchObject({ state: 'publishing', version: 2 });

    const entries = await world.publication.publishable(manifestId, 25);
    expect(entries).toHaveLength(2);
    const [entry, otherEntry] = entries;
    if (entry === undefined || otherEntry === undefined) throw new Error('no entries');
    expect(entry).toMatchObject({
      review: 'approved',
      validation: 'valid',
      topicIds: [topicId],
    });
    expect(entry.legacyUrls).toEqual([
      { recordId: main.recordId, url: urlOf(source, 'published') },
      { recordId: copy.recordId, url: urlOf(source, 'merged-copy') },
    ]);

    const claimed = await world.publication.claimEntry(
      entry.entry.id,
      entry.entry.version,
    );
    expect(claimed.state).toBe('publishing');
    const videoId = await video(admin);
    await world.publication.recordPublished({
      entryId: entry.entry.id,
      expectedVersion: claimed.version,
      target: { kind: 'media.video', id: videoId },
      targetStage: 'public',
      targetVersion: 1,
      canonicalPath: `/watch/videos/non-migration-fixture-${videoId}`,
      legacyUrls: entry.legacyUrls.map((url) => ({ ...url, digest: sha(url.url) })),
      actorId: authority,
      now: new Date(),
    });
    await world.publication.recordRefused({
      entryId: otherEntry.entry.id,
      expectedVersion: otherEntry.entry.version,
      refusal: 'target-refused',
      now: new Date(),
    });
    const active = await world.pipeline.activeMappings(source.id, [
      sha(urlOf(source, 'published')),
      sha(urlOf(source, 'merged-copy')),
    ]);
    expect(active.size).toBe(2);
    const [publishedRecord] = await admin.query<{ status: string }>(
      `SELECT [status] FROM [dbo].[MigrationRecord] WHERE [id] = ${n(main.recordId)};`,
    );
    expect(publishedRecord?.status).toBe('published');
    expect(await world.pipeline.reconciliationCounts(run.run.id)).toMatchObject({
      published: 1,
      mapped: 1,
      merged: 1,
    });

    const published = await world.publication.completePublication({
      manifestId,
      now: new Date(),
    });
    expect(published).toMatchObject({ state: 'published', publishedByUserId: authority });

    // Promotion: only published entries; approval needs live authority.
    expect(
      await reasonOf(
        world.promotion.createPromotion({
          id: randomUUID(),
          manifestEntryIds: [otherEntry.entry.id],
          actorId: operator,
          now: new Date(),
        }),
      ),
    ).toBe('invalid-state');
    const promotionId = randomUUID();
    const promotion = await world.promotion.createPromotion({
      id: promotionId,
      manifestEntryIds: [entry.entry.id],
      actorId: operator,
      now: new Date(),
    });
    expect(promotion).toMatchObject({ state: 'draft', entryCount: 1, promotedCount: 0 });
    expect(
      await reasonOf(
        world.promotion.approve({
          promotionId,
          expectedVersion: 1,
          actorId: operator,
          now: new Date(),
        }),
      ),
    ).toBe('denied');
    await world.promotion.approve({
      promotionId,
      expectedVersion: 1,
      actorId: authority,
      now: new Date(),
    });
    await world.promotion.beginPromoting({ promotionId, now: new Date() });
    const items = await world.promotion.pendingItems(promotionId, 25);
    expect(items).toHaveLength(1);
    const [promoted] = items;
    expect(Object.keys(promoted ?? {}).sort()).toEqual(
      [
        'canonicalPath',
        'contentKind',
        'externalKey',
        'inputChecksum',
        'legacyUrls',
        'manifestEntryId',
        'payload',
        'payloadChecksum',
        'promotionEntryId',
        'provenance',
        'publishedAt',
        'reviewedAt',
        'sourceKey',
      ].sort(),
    );
    expect(JSON.stringify(items)).not.toContain(operator);
    expect(JSON.stringify(items)).not.toContain(authority);
    expect(promoted?.legacyUrls).toEqual(
      [urlOf(source, 'merged-copy'), urlOf(source, 'published')].sort(),
    );
    await world.promotion.recordPromoted({
      promotionEntryId: promoted?.promotionEntryId ?? '',
      destinationRef: `bundle/${promoted?.promotionEntryId ?? ''}.json`,
      now: new Date(),
    });
    const done = await world.promotion.complete({
      promotionId,
      actorId: operator,
      now: new Date(),
    });
    expect(done).toMatchObject({ state: 'promoted', promotedCount: 1 });
    expect((await auditFor(admin, promotionId)).map((row) => row.action)).toEqual([
      'migration.promotion.created',
      'migration.promotion.approved',
      'migration.promotion.completed',
    ]);

    // Rollback: authority again, mappings disabled — never deleted.
    expect(
      await reasonOf(
        world.publication.beginRollback({
          manifestId,
          expectedVersion: published.version,
          reason: 'fixture rollback',
          actorId: operator,
          now: new Date(),
        }),
      ),
    ).toBe('denied');
    const rolling = await world.publication.beginRollback({
      manifestId,
      expectedVersion: published.version,
      reason: 'fixture rollback',
      actorId: authority,
      now: new Date(),
    });
    expect(rolling.state).toBe('rolling-back');
    const reversible = await world.publication.reversible(manifestId, 25);
    expect(reversible.map((row) => row.id)).toEqual([entry.entry.id]);
    await world.publication.recordRolledBack({
      entryId: entry.entry.id,
      expectedVersion: reversible[0]?.version ?? 0,
      actorId: authority,
      now: new Date(),
    });
    expect(
      (await world.pipeline.activeMappings(source.id, [sha(urlOf(source, 'published'))]))
        .size,
    ).toBe(0);
    expect(
      await count(
        admin,
        'MigrationLegacyMapping',
        `[manifestEntryId] = ${n(entry.entry.id)} AND [state] = N'disabled'`,
      ),
    ).toBe(2);
    const [rolledRecord] = await admin.query<{ status: string }>(
      `SELECT [status] FROM [dbo].[MigrationRecord] WHERE [id] = ${n(main.recordId)};`,
    );
    expect(rolledRecord?.status).toBe('approved');
    const rolledBack = await world.publication.completeRollback({
      manifestId,
      now: new Date(),
    });
    expect(rolledBack.state).toBe('rolled-back');

    expect((await auditFor(admin, manifestId)).map((row) => row.action)).toEqual([
      'migration.manifest.created',
      'migration.manifest.publication-started',
      'migration.manifest.published',
      'migration.manifest.rollback-started',
      'migration.manifest.rolled-back',
    ]);
    // The runtime can delete none of it.
    expect(
      await sqlNumber(
        world.app.query(
          `DELETE FROM [dbo].[MigrationLegacyMapping] WHERE [manifestEntryId] = ${n(entry.entry.id)};`,
        ),
      ),
    ).toBe(229);
  });
});
