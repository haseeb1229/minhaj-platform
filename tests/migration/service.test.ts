import { describe, expect, it } from 'vitest';

import {
  MIGRATION_REFUSAL_REASONS,
  createMigrationDecisionService,
  createMigrationPipelineService,
  createMigrationPromotionService,
  createMigrationPublicationService,
  createMigrationRawService,
  createMigrationReadService,
  createMigrationSourceService,
  legacyUrlDigest,
  migrationFailure,
  type MigrationRefusalReason,
  type PipelineRunOptions,
} from '../../apps/web/src/contexts/migration-provenance/index.ts';
import type {
  ParsedVideo,
  SourceRecord,
} from '../../packages/contracts/src/migration/index.ts';
import {
  ADMIN,
  BASE,
  FakeAuthority,
  FakeDestination,
  FakeStorage,
  FakeStore,
  FakeTarget,
  FakeTopics,
  JsonAdapter,
  NOBODY,
  POLICY,
  PRIVILEGED,
  PUBLISHER_ID,
  READER,
  ScriptedFetcher,
  idFactory,
  indexPages,
  ok,
  pageUrl,
  status,
  videoBody,
} from './fakes.ts';

/** Resolves to the refusal reason a call failed with. */
async function refusedWith(work: Promise<unknown>): Promise<MigrationRefusalReason> {
  try {
    await work;
  } catch (error) {
    return migrationFailure(error);
  }
  throw new Error('expected a refusal');
}

/* ===========================================================================
 * A pipeline world
 * ========================================================================= */

function pipelineWorld(
  keys: number[] = [1, 2, 3],
  sourceOverrides: Partial<SourceRecord> = {},
) {
  const store = new FakeStore();
  const source = store.addSource(sourceOverrides);
  const authority = new FakeAuthority();
  const fetcher = new ScriptedFetcher();
  indexPages(fetcher, keys.length);
  for (const key of keys) fetcher.set(pageUrl(key), ok(pageUrl(key), videoBody(key)));
  const adapter = new JsonAdapter(keys);
  const storage = new FakeStorage();
  let time = Date.parse('2026-10-20T00:00:00Z');
  const sleeps: number[] = [];
  const now = () => new Date(time);
  const service = createMigrationPipelineService({
    pipeline: store.pipeline,
    sources: store.sourcePort,
    authority,
    ids: idFactory(2),
    clock: now,
  });
  const run = (options: PipelineRunOptions = {}, actor: { accountId: string } = ADMIN) =>
    service.run(actor, {
      sourceId: source.id,
      adapter,
      fetcher,
      assets: storage,
      options: {
        now,
        random: () => 0,
        sleep: async (ms) => {
          sleeps.push(ms);
          time += ms;
        },
        ...options,
      },
    });
  return {
    store,
    source,
    authority,
    fetcher,
    adapter,
    storage,
    sleeps,
    service,
    run,
    advance: (ms: number) => {
      time += ms;
    },
  };
}

const recordOf = (store: FakeStore, key: number) =>
  [...store.records.values()].find((record) => record.externalKey === pageUrl(key))!;

describe('pipeline: a complete run', () => {
  it('stages every item, reconciles balanced and completes', async () => {
    const world = pipelineWorld();
    const summary = await world.run();
    expect(summary).toMatchObject({
      state: 'completed',
      resumed: false,
      processed: 3,
      missing: 0,
    });
    expect(summary.reconciliation).toEqual({ balanced: true, discrepancies: [] });
    expect(summary.counts).toMatchObject({
      discovered: 3,
      staged: 3,
      fetched: 3,
      parsed: 3,
      pending: 0,
    });
    const run = world.store.runs.get(summary.runId)!;
    expect(run).toMatchObject({ state: 'completed', reconciliation: 'balanced' });
    expect(JSON.parse(run.detail!)).toMatchObject({ balanced: true });
    expect(world.store.audit).toEqual([
      'migration.run.started',
      'migration.run.completed',
    ]);
    const staged = [...world.store.staged.values()];
    expect(staged).toHaveLength(3);
    for (const row of staged) {
      expect(row.validation).toBe('valid');
      expect(row.provenance).toMatchObject({
        adapterKey: 'fixture-json',
        normalizerVersion: '30.1',
        codeRevision: 'local',
      });
      expect(row.categories).toEqual([{ key: 'lectures', label: 'Lectures' }]);
    }
  });

  it('records the code revision it was given', async () => {
    const world = pipelineWorld([1]);
    await world.run({ codeRevision: 'abc1234' });
    expect([...world.store.staged.values()][0]?.provenance.codeRevision).toBe('abc1234');
  });

  it('marks records a complete discovery no longer sees as missing — deleting nothing', async () => {
    const world = pipelineWorld([1, 2, 3]);
    await world.run();
    world.adapter.keys.splice(2, 1);
    const second = await world.run();
    expect(second.missing).toBe(1);
    expect(recordOf(world.store, 3).observed).toBe('missing');
    expect(world.store.stagedOf(recordOf(world.store, 3).id)).toHaveLength(1);
  });

  it('processes sequentially in bounded batches', async () => {
    const world = pipelineWorld(Array.from({ length: 12 }, (_, n) => n + 1));
    let inFlight = 0;
    let peak = 0;
    const inner = world.fetcher.fetch.bind(world.fetcher);
    world.fetcher.fetch = async (url) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      try {
        return await inner(url);
      } finally {
        inFlight -= 1;
      }
    };
    const summary = await world.run({ batchSize: 5 });
    expect(summary.state).toBe('completed');
    expect(peak).toBe(1);
  });

  it('waits the politeness interval between requests', async () => {
    const world = pipelineWorld([1, 2], { policy: { ...POLICY, minIntervalMs: 1500 } });
    await world.run();
    expect(world.sleeps.length).toBeGreaterThan(0);
    expect(world.sleeps.every((ms) => ms === 1500)).toBe(true);
  });
});

describe('pipeline: interruption and resumption', () => {
  it('resumes an interrupted run and a rerun creates no duplicate records or revisions', async () => {
    const world = pipelineWorld([1, 2, 3, 4, 5]);
    const first = await world.run({ maxItems: 2 });
    expect(first).toMatchObject({
      state: 'interrupted',
      processed: 2,
      reconciliation: null,
    });
    expect(world.store.runs.get(first.runId)?.state).toBe('open');

    const second = await world.run();
    expect(second).toMatchObject({
      runId: first.runId,
      resumed: true,
      state: 'completed',
      processed: 3,
    });
    expect(world.store.records.size).toBe(5);
    expect(world.store.staged.size).toBe(5);
    expect(world.store.calls.stage).toBe(5);

    // A later run over the same bytes: every item unchanged, nothing restaged.
    const third = await world.run();
    expect(third.state).toBe('completed');
    expect(third.runId).not.toBe(first.runId);
    expect(third.counts).toMatchObject({ unchanged: 5, staged: 0, discovered: 5 });
    expect(third.reconciliation?.balanced).toBe(true);
    expect(world.store.records.size).toBe(5);
    expect(world.store.staged.size).toBe(5);
    expect(world.store.calls.snapshotsCreated).toBe(5);
  });

  it('re-uses a snapshot stored before a crash instead of storing it twice', async () => {
    const world = pipelineWorld([1]);
    const stage = world.store.pipeline.stage;
    let crash = true;
    world.store.pipeline.stage = async (input) => {
      if (crash) {
        crash = false;
        throw new Error('process died');
      }
      return stage(input);
    };
    await expect(world.run()).rejects.toThrow('process died');
    world.advance(200_000); // the dead holder's lease lapses
    const resumed = await world.run();
    expect(resumed).toMatchObject({ resumed: true, state: 'completed' });
    expect(world.store.calls.snapshotsCreated).toBe(1);
    expect(world.store.staged.size).toBe(1);
  });

  it('refuses a run while another holder’s lease is live', async () => {
    const world = pipelineWorld([1]);
    await world.store.pipeline.openRun({
      sourceId: world.source.id,
      operatorUserId: ADMIN.accountId,
      provenance: {
        adapterKey: 'fixture-json',
        adapterVersion: '1',
        parserKey: 'fixture-json',
        parserVersion: '1',
        normalizerVersion: '30.1',
        codeRevision: 'local',
      },
      runId: '00000000-0000-4000-8fff-000000000001',
      leaseToken: 'someone-else',
      leaseUntil: new Date(Date.parse('2026-10-20T00:10:00Z')),
      now: new Date(Date.parse('2026-10-20T00:00:00Z')),
    });
    expect(await refusedWith(world.run())).toBe('run-busy');
  });

  it('refuses to resume an open run with other adapter code', async () => {
    const world = pipelineWorld([1, 2]);
    await world.run({ maxItems: 1 });
    world.adapter.adapterVersion = '2';
    expect(await refusedWith(world.run())).toBe('adapter-mismatch');
  });

  it('stops with the lease lost when another holder takes the run', async () => {
    const world = pipelineWorld([1, 2]);
    world.store.pipeline.renewLease = async () => false;
    expect(await refusedWith(world.run())).toBe('lease-lost');
  });
});

describe('pipeline: change detection', () => {
  it('skips an unchanged checksum and accounts for it', async () => {
    const world = pipelineWorld([1, 2]);
    await world.run();
    const summary = await world.run();
    expect(summary.counts).toMatchObject({ unchanged: 2, fetched: 2, parsed: 0 });
    expect(summary.reconciliation?.balanced).toBe(true);
  });

  it('turns a changed checksum into a new reviewable revision, superseding the old', async () => {
    const world = pipelineWorld([1, 2]);
    await world.run();
    world.fetcher.set(
      pageUrl(1),
      ok(pageUrl(1), videoBody(1, { title: 'Lecture 1 (revised)' })),
    );
    const summary = await world.run();
    expect(summary.counts).toMatchObject({ staged: 1, unchanged: 1, superseded: 0 });
    const revisions = world.store.stagedOf(recordOf(world.store, 1).id);
    expect(revisions.map((row) => [row.revision, row.review])).toEqual([
      [1, 'superseded'],
      [2, 'pending'],
    ]);
    expect(revisions[1]?.title).toBe('Lecture 1 (revised)');
  });
});

describe('pipeline: retries', () => {
  it('never retries a 404 or a 403', async () => {
    const world = pipelineWorld([1, 2]);
    world.fetcher.set(pageUrl(1), status(pageUrl(1), 404));
    world.fetcher.set(pageUrl(2), status(pageUrl(2), 403));
    const summary = await world.run();
    expect(world.fetcher.count(pageUrl(1))).toBe(1);
    expect(world.fetcher.count(pageUrl(2))).toBe(1);
    expect(world.sleeps).toEqual([]);
    const errors = [...world.store.errors.values()];
    expect(
      errors.map((error) => [
        error.classification,
        error.retryEligible,
        error.httpStatus,
      ]),
    ).toEqual([
      ['not-found', false, 404],
      ['access-denied', false, 403],
    ]);
    expect(summary.counts).toMatchObject({ errored: 2 });
    expect(summary.reconciliation?.balanced).toBe(true);
  });

  it('respects a valid Retry-After on 429', async () => {
    const world = pipelineWorld([1]);
    world.fetcher.set(
      pageUrl(1),
      status(pageUrl(1), 429, '7'),
      ok(pageUrl(1), videoBody(1)),
    );
    const summary = await world.run();
    expect(world.sleeps).toEqual([7000]);
    expect(summary.counts.staged).toBe(1);
  });

  it('falls back to backoff when Retry-After is malformed', async () => {
    const world = pipelineWorld([1]);
    world.fetcher.set(
      pageUrl(1),
      status(pageUrl(1), 503, 'soon'),
      status(pageUrl(1), 503, '-1'),
      ok(pageUrl(1), videoBody(1)),
    );
    await world.run();
    expect(world.sleeps).toEqual([500, 1000]);
  });

  it('caps attempts at the source policy and records a retry-eligible error', async () => {
    const world = pipelineWorld([1]);
    world.fetcher.set(pageUrl(1), status(pageUrl(1), 503));
    await world.run();
    expect(world.fetcher.count(pageUrl(1))).toBe(POLICY.maxAttempts);
    const [error] = [...world.store.errors.values()];
    expect(error).toMatchObject({
      classification: 'server-error',
      retryEligible: true,
      attempt: POLICY.maxAttempts,
      stage: 'fetch',
    });
  });

  it('defers an item instead of sleeping beyond 300 s', async () => {
    const world = pipelineWorld([1, 2]);
    world.fetcher.set(
      pageUrl(1),
      status(pageUrl(1), 429, '600'),
      ok(pageUrl(1), videoBody(1)),
    );
    const first = await world.run();
    expect(first.state).toBe('interrupted');
    expect(world.sleeps).toEqual([]);
    expect(first.counts).toMatchObject({ pending: 1, staged: 1 });
    world.advance(600_000);
    const second = await world.run();
    expect(second).toMatchObject({ state: 'completed', resumed: true });
    expect(second.counts.staged).toBe(2);
  });

  it('records a discovery failure and leaves the run open', async () => {
    const world = pipelineWorld([1]);
    world.fetcher.set(`${BASE}index?page=0`, status(`${BASE}index?page=0`, 403));
    const summary = await world.run();
    expect(summary.state).toBe('interrupted');
    expect([...world.store.errors.values()][0]).toMatchObject({
      stage: 'discover',
      classification: 'access-denied',
      retryEligible: false,
    });
  });
});

describe('pipeline: refusals', () => {
  it('refuses an authorised source without its written authorisation reference and date', async () => {
    for (const missing of [
      { authorisationReference: null, authorisedOn: '2026-01-01' },
      { authorisationReference: 'Board letter 2026/07', authorisedOn: null },
      { authorisationReference: null, authorisedOn: null },
    ]) {
      // Even with a real https scope, the missing evidence is refused first.
      const world = pipelineWorld([1], {
        authorityKind: 'authorised',
        baseUrl: 'https://www.example.org/',
        hosts: ['www.example.org'],
        ...missing,
      });
      expect(await refusedWith(world.run())).toBe('real-source-not-authorised');
      expect(world.fetcher.requests).toEqual([]);
      expect(world.store.runs.size).toBe(0);
    }
  });

  it('refuses an authorised source whose recorded scope is a fixture one', async () => {
    // Evidence present, but the scope is synthetic: a fixture name never
    // becomes a real one, so nothing is fetched.
    const world = pipelineWorld([1], {
      authorityKind: 'authorised',
      authorisationReference: 'Board letter 2026/07',
      authorisedOn: '2026-01-01',
    });
    expect(await refusedWith(world.run())).toBe('unsafe-scope');
    expect(world.fetcher.requests).toEqual([]);
  });

  it('never runs a fixture source on a real host', async () => {
    for (const scope of [
      { hosts: ['www.example.org'], baseUrl: 'https://www.example.org/' },
      // A real host smuggled beside the synthetic one.
      { hosts: ['videos.fixture.invalid', 'www.example.org'] },
    ]) {
      const world = pipelineWorld([1], scope);
      expect(await refusedWith(world.run())).toBe('unsafe-scope');
      expect(world.fetcher.requests).toEqual([]);
    }
  });

  it('refuses a source whose scope is not synthetic', async () => {
    const world = pipelineWorld([1], {
      hosts: ['minhaj.example'],
      baseUrl: 'https://minhaj.example/',
    });
    expect(await refusedWith(world.run())).toBe('unsafe-scope');
    expect(world.fetcher.requests).toEqual([]);
  });

  it('refuses an inactive source and a mismatched adapter', async () => {
    expect(await refusedWith(pipelineWorld([1], { state: 'inactive' }).run())).toBe(
      'source-inactive',
    );
    const world = pipelineWorld([1]);
    world.adapter.accessMethod = 'export';
    expect(await refusedWith(world.run())).toBe('adapter-mismatch');
  });

  it('refuses without migration.administer', async () => {
    const world = pipelineWorld([1]);
    expect(await refusedWith(world.run({}, READER))).toBe('denied');
    expect(await refusedWith(world.run({}, NOBODY))).toBe('denied');
    expect(world.fetcher.requests).toEqual([]);
  });

  it('refuses invalid options', async () => {
    const world = pipelineWorld([1]);
    expect(await refusedWith(world.run({ batchSize: 26 }))).toBe('invalid');
    expect(await refusedWith(world.run({ codeRevision: 'bad revision' }))).toBe(
      'invalid',
    );
  });
});

describe('pipeline: normalisation outcomes', () => {
  it('excludes and errors per the parser, and rejects invalid records with their issues', async () => {
    const world = pipelineWorld([1, 2, 3]);
    world.fetcher.set(pageUrl(1), ok(pageUrl(1), 'EXCLUDE'));
    world.fetcher.set(pageUrl(2), ok(pageUrl(2), 'not json'));
    world.fetcher.set(
      pageUrl(3),
      ok(pageUrl(3), videoBody(3, { provider: 'dailymotion' })),
    );
    const summary = await world.run();
    expect(summary.counts).toMatchObject({
      excluded: 1,
      errored: 1,
      rejected: 1,
      staged: 0,
    });
    expect(summary.reconciliation?.balanced).toBe(true);
    const rejected = [...world.store.staged.values()][0]!;
    expect(rejected).toMatchObject({
      validation: 'invalid',
      outcome: 'rejected',
      issues: ['provider-invalid'],
    });
    expect(
      [...world.store.errors.values()].map((error) => error.classification).sort(),
    ).toEqual(['parse-failed', 'validation-failed']);
  });

  it('flags personal data on the snapshot and the staged revision', async () => {
    const world = pipelineWorld([1]);
    world.fetcher.set(
      pageUrl(1),
      ok(pageUrl(1), videoBody(1, { descriptionHtml: '<p>Call +92 300 1234567</p>' })),
    );
    await world.run();
    expect([...world.store.snapshots.values()][0]?.personalData).toBe('flagged');
    const staged = [...world.store.staged.values()][0]!;
    expect(staged.personalData).toBe('flagged');
    expect(staged.payload).not.toContain('1234567');
  });

  it('stores sanitised HTML with mapped links rewritten and unmapped ones kept as legacy URLs', async () => {
    const world = pipelineWorld([1]);
    world.store.legacyMappings.set('m', {
      id: 'mapping-id',
      sourceId: world.source.id,
      recordId: 'r',
      legacyUrl: pageUrl(9),
      digest: legacyUrlDigest(pageUrl(9)),
      target: { kind: 'media.video', id: '00000000-0000-4000-a000-000000000009' },
      canonicalPath: '/watch/videos/video-9',
      state: 'active',
      version: 1,
    });
    world.fetcher.set(
      pageUrl(1),
      ok(
        pageUrl(1),
        videoBody(1, {
          descriptionHtml:
            '<p><a href="/videos/9">nine</a> <a href="/videos/10">ten</a> <a href="javascript:alert(1)">x</a><script>alert(1)</script></p>',
          links: ['https://example.org/'],
        }),
      ),
    );
    await world.run();
    const staged = [...world.store.staged.values()][0]!;
    const payload = JSON.parse(staged.payload) as { descriptionHtml: string };
    expect(payload.descriptionHtml).toBe(
      '<p><a href="/watch/videos/video-9" rel="noopener noreferrer">nine</a> <a href="https://videos.fixture.invalid/videos/10" rel="noopener noreferrer">ten</a> <a rel="noopener noreferrer">x</a></p>',
    );
    expect(staged.links.map((link) => link.disposition)).toEqual([
      'external',
      'rewritten',
      'unresolved',
      'dropped',
    ]);
  });

  it('collapses a hard-identity duplicate into the earliest record, but never across languages', async () => {
    const world = pipelineWorld([1, 2, 3]);
    const same = 'https://youtu.be/sameVideo01';
    world.fetcher.set(
      pageUrl(1),
      ok(pageUrl(1), videoBody(1, { providerReference: same })),
    );
    world.fetcher.set(
      pageUrl(2),
      ok(pageUrl(2), videoBody(2, { providerReference: same })),
    );
    world.fetcher.set(
      pageUrl(3),
      ok(
        pageUrl(3),
        videoBody(3, {
          providerReference: same,
          languageCode: 'ur',
          primaryLocale: 'ur' as ParsedVideo['primaryLocale'],
        }),
      ),
    );
    const summary = await world.run();
    expect(summary.reconciliation?.balanced).toBe(true);
    const [first, second, third] = [1, 2, 3].map((key) => recordOf(world.store, key));
    expect(second!.mergedInto).toBe(first!.id);
    expect(third!.mergedInto).toBeNull();
    const candidates = [...world.store.duplicates.values()];
    expect(
      candidates.filter((candidate) => candidate.state === 'collapsed'),
    ).toHaveLength(1);
    expect(
      candidates
        .filter((candidate) => candidate.recordId === third!.id)
        .every((candidate) => candidate.crossLanguage && candidate.state === 'open'),
    ).toBe(true);
  });

  it('opens a title candidate for a person, never collapsing it', async () => {
    const world = pipelineWorld([1, 2]);
    world.fetcher.set(pageUrl(2), ok(pageUrl(2), videoBody(2, { title: 'LECTURE 1!' })));
    await world.run();
    const candidates = [...world.store.duplicates.values()];
    expect(candidates).toEqual([
      expect.objectContaining({
        signal: 'title-similarity',
        state: 'open',
        crossLanguage: false,
      }),
    ]);
  });

  it('acquires assets with provenance, and an asset failure never blocks staging', async () => {
    const world = pipelineWorld([1, 2]);
    const image = `${BASE}img/a.png`;
    world.fetcher.set(image, ok(image, 'PNGBYTES', 'image/png'));
    const asset = {
      url: '/img/a.png',
      licence: 'organisation-owned' as const,
      licenceEvidence: 'owned',
      rightsHolder: 'Minhaj',
    };
    world.fetcher.set(
      pageUrl(1),
      ok(
        pageUrl(1),
        videoBody(1, { assets: [asset, { ...asset, url: '/img/missing.png' }] }),
      ),
    );
    world.fetcher.set(pageUrl(2), ok(pageUrl(2), videoBody(2, { assets: [asset] })));
    const summary = await world.run();
    expect(summary.counts.staged).toBe(2);
    expect(world.storage.stored).toHaveLength(1);
    const acquisitions = [...world.store.acquisitions.values()];
    expect(acquisitions).toHaveLength(1);
    expect(acquisitions[0]).toMatchObject({
      originalUrl: image,
      licence: 'organisation-owned',
      mediaType: 'image/png',
    });
    const assetErrors = [...world.store.errors.values()].filter(
      (error) => error.stage === 'asset',
    );
    expect(assetErrors).toEqual([
      expect.objectContaining({ classification: 'not-found', itemId: null }),
    ]);
  });

  it('completes an unbalanced run as unbalanced, and refuses to manifest it', async () => {
    const world = pipelineWorld([1]);
    const counts = world.store.pipeline.reconciliationCounts;
    world.store.pipeline.reconciliationCounts = async (runId) => ({
      ...(await counts(runId)),
      inconsistent: 1,
    });
    const summary = await world.run();
    expect(summary).toMatchObject({
      state: 'completed',
      reconciliation: { balanced: false },
    });
    expect(world.store.runs.get(summary.runId)?.reconciliation).toBe('unbalanced');
    const publication = createMigrationPublicationService({
      publication: world.store.publicationPort,
      read: world.store.readPort,
      target: new FakeTarget(),
      authority: world.authority,
    });
    const stagedId = [...world.store.staged.keys()][0]!;
    expect(
      await refusedWith(
        publication.createManifest(ADMIN, {
          runId: summary.runId,
          stagedRecordIds: [stagedId],
        }),
      ),
    ).toBe('run-unreconciled');
  });
});

/* ===========================================================================
 * Publication
 * ========================================================================= */

const payload = (slug: string) => ({
  kind: 'media.video',
  slug,
  primaryLocale: 'en',
  languageCode: 'en',
  provider: 'youtube',
  providerVideoId: 'dQw4w9WgXcQ',
  labels: [{ locale: 'en', title: `Title ${slug}`, description: '' }],
  descriptionHtml: '',
  publishedOn: null,
  durationSeconds: null,
  legacyIdentifier: null,
});

async function publicationWorld(slugs: string[] = ['video-a', 'video-b']) {
  const store = new FakeStore();
  const source = store.addSource();
  const run = store.completedRun(source.id);
  const revisions = slugs.map((slug) =>
    store.approvedRevision(source.id, run.id, payload(slug), `${BASE}videos/${slug}`),
  );
  const authority = new FakeAuthority();
  const target = new FakeTarget();
  const service = createMigrationPublicationService({
    publication: store.publicationPort,
    read: store.readPort,
    target,
    authority,
    ids: idFactory(3),
    clock: () => new Date(0),
  });
  const manifest = await service.createManifest(ADMIN, {
    runId: run.id,
    stagedRecordIds: revisions.map((row) => row.id),
  });
  const version = () => store.manifests.get(manifest.id)!.version;
  return { store, source, run, revisions, authority, target, service, manifest, version };
}

describe('publication', () => {
  it('requires a verified publisher', async () => {
    const world = await publicationWorld();
    const command = { manifestId: world.manifest.id, expectedVersion: 1 };
    expect(await refusedWith(world.service.publish(ADMIN, command))).toBe('denied');
    expect(
      await refusedWith(world.service.publish({ ...PRIVILEGED, live: false }, command)),
    ).toBe('denied');
    expect(await refusedWith(world.service.publish(null, command))).toBe('denied');
    expect(world.target.publishCalls).toBe(0);
  });

  it('publishes through the target as the publisher and records legacy mappings', async () => {
    const world = await publicationWorld();
    const summary = await world.service.publish(PRIVILEGED, {
      manifestId: world.manifest.id,
      expectedVersion: 1,
    });
    expect(summary).toEqual({
      manifestId: world.manifest.id,
      state: 'published',
      done: 2,
      refused: 0,
      stopped: null,
    });
    expect(world.target.publishCalls).toBe(2);
    expect(new Set(world.target.actors)).toEqual(new Set([PUBLISHER_ID]));
    const mappings = [...world.store.legacyMappings.values()];
    expect(mappings.map((mapping) => mapping.canonicalPath).sort()).toEqual([
      '/watch/videos/video-a',
      '/watch/videos/video-b',
    ]);
    for (const mapping of mappings)
      expect(mapping.digest).toBe(legacyUrlDigest(mapping.legacyUrl));
  });

  it('refuses an entry whose approval was withdrawn before publication', async () => {
    const world = await publicationWorld();
    world.revisions[0]!.review = 'pending';
    const summary = await world.service.publish(PRIVILEGED, {
      manifestId: world.manifest.id,
      expectedVersion: 1,
    });
    expect(summary).toMatchObject({ done: 1, refused: 1, state: 'published' });
    expect(world.target.publishCalls).toBe(1);
    expect(world.store.entriesOf(world.manifest.id)[0]).toMatchObject({
      state: 'refused',
      refusal: 'approval-withdrawn',
    });
  });

  it('records a target refusal as final', async () => {
    const world = await publicationWorld();
    world.target.refuseSlugs.set('video-b', 'slug-taken');
    world.target.refuseSlugs.set('video-a', 'Some Free Text <script>');
    const summary = await world.service.publish(PRIVILEGED, {
      manifestId: world.manifest.id,
      expectedVersion: 1,
    });
    expect(summary).toMatchObject({ done: 0, refused: 2 });
    expect(
      world.store.entriesOf(world.manifest.id).map((entry) => entry.refusal),
    ).toEqual(['target-refused', 'slug-taken']);
  });

  it('stops when the target is unavailable, and a resumed publication completes without a second publish', async () => {
    const world = await publicationWorld();
    world.target.unavailableFor.add('video-b');
    const first = await world.service.publish(PRIVILEGED, {
      manifestId: world.manifest.id,
      expectedVersion: 1,
    });
    expect(first).toMatchObject({
      state: 'publishing',
      done: 1,
      stopped: 'target-unavailable',
    });
    expect(world.store.manifests.get(world.manifest.id)?.state).toBe('publishing');
    world.target.unavailableFor.clear();
    const second = await world.service.publish(PRIVILEGED, {
      manifestId: world.manifest.id,
      expectedVersion: world.version(),
    });
    expect(second).toMatchObject({ state: 'published', done: 1, stopped: null });
    expect(world.target.publishCalls).toBe(2);
    expect(world.target.made.size).toBe(2);
  });

  it('adopts what an interrupted publication already made', async () => {
    const world = await publicationWorld(['video-a']);
    const record = world.store.publicationPort.recordPublished;
    let crash = true;
    world.store.publicationPort.recordPublished = async (input) => {
      if (crash) {
        crash = false;
        throw new Error('process died');
      }
      return record(input);
    };
    await expect(
      world.service.publish(PRIVILEGED, {
        manifestId: world.manifest.id,
        expectedVersion: 1,
      }),
    ).rejects.toThrow();
    const summary = await world.service.publish(PRIVILEGED, {
      manifestId: world.manifest.id,
      expectedVersion: world.version(),
    });
    expect(summary).toMatchObject({ state: 'published', done: 1 });
    expect(world.target.made.size).toBe(1);
    // Fresh on the first attempt; the in-flight entry is RESUMED on the second.
    expect(world.target.resumedFlags).toEqual([false, true]);
  });

  it('refuses a fresh entry whose Video already exists, never claiming it as published', async () => {
    const world = await publicationWorld(['video-a']);
    world.target.made.set('00000000-0000-4000-a000-0000000000ff', {
      id: '00000000-0000-4000-a000-0000000000ff',
      kind: 'media.video',
      slug: 'video-a',
      version: 4,
      state: 'published',
      referenced: false,
    });
    const summary = await world.service.publish(PRIVILEGED, {
      manifestId: world.manifest.id,
      expectedVersion: 1,
    });
    expect(summary).toMatchObject({ done: 0, refused: 1 });
    expect(world.target.resumedFlags).toEqual([false]);
    expect(world.target.made.get('00000000-0000-4000-a000-0000000000ff')?.version).toBe(
      4,
    );
  });

  it('refuses a stale version and a manifest in the wrong state', async () => {
    const world = await publicationWorld();
    expect(
      await refusedWith(
        world.service.publish(PRIVILEGED, {
          manifestId: world.manifest.id,
          expectedVersion: 7,
        }),
      ),
    ).toBe('conflict');
    await world.service.discard(ADMIN, {
      manifestId: world.manifest.id,
      expectedVersion: 1,
    });
    expect(
      await refusedWith(
        world.service.publish(PRIVILEGED, {
          manifestId: world.manifest.id,
          expectedVersion: world.version(),
        }),
      ),
    ).toBe('invalid-state');
  });

  it('rolls back through the target, disabling mappings and keeping evidence', async () => {
    const world = await publicationWorld();
    await world.service.publish(PRIVILEGED, {
      manifestId: world.manifest.id,
      expectedVersion: 1,
    });
    const stagedBefore = JSON.stringify([...world.store.staged.values()]);
    expect(
      await refusedWith(
        world.service.rollback(ADMIN, {
          manifestId: world.manifest.id,
          expectedVersion: world.version(),
          reason: 'x',
        }),
      ),
    ).toBe('denied');
    const summary = await world.service.rollback(PRIVILEGED, {
      manifestId: world.manifest.id,
      expectedVersion: world.version(),
      reason: 'faulty parser',
    });
    expect(summary).toEqual({
      manifestId: world.manifest.id,
      state: 'rolled-back',
      done: 2,
      refused: 0,
      stopped: null,
    });
    expect(
      [...world.target.made.values()].every((video) => video.state === 'archived'),
    ).toBe(true);
    expect(
      [...world.store.legacyMappings.values()].every(
        (mapping) => mapping.state === 'disabled',
      ),
    ).toBe(true);
    expect(JSON.stringify([...world.store.staged.values()])).toBe(stagedBefore);
  });

  it('refuses to roll back an entry edited since publication or held by a person', async () => {
    const world = await publicationWorld();
    await world.service.publish(PRIVILEGED, {
      manifestId: world.manifest.id,
      expectedVersion: 1,
    });
    const [first, second] = [...world.target.made.values()];
    first!.version += 1;
    second!.referenced = true;
    const summary = await world.service.rollback(PRIVILEGED, {
      manifestId: world.manifest.id,
      expectedVersion: world.version(),
      reason: 'r',
    });
    expect(summary).toMatchObject({ done: 0, refused: 2 });
    expect(world.target.withdrawCalls).toBe(0);
    expect(world.store.entriesOf(world.manifest.id).map((entry) => entry.state)).toEqual([
      'rollback-refused',
      'rollback-refused',
    ]);
  });
});

/* ===========================================================================
 * Promotion
 * ========================================================================= */

async function promotionWorld(entries = 3) {
  const world = await publicationWorld(
    Array.from({ length: entries }, (_, n) => `p${n}`),
  );
  await world.service.publish(PRIVILEGED, {
    manifestId: world.manifest.id,
    expectedVersion: 1,
  });
  const promotions = createMigrationPromotionService({
    promotions: world.store.promotionPort,
    authority: world.authority,
    ids: idFactory(4),
    clock: () => new Date(0),
  });
  const promotion = await promotions.create(ADMIN, {
    manifestEntryIds: world.store.entriesOf(world.manifest.id).map((entry) => entry.id),
  });
  const destination = new FakeDestination();
  const version = () => world.store.promotions.get(promotion.id)!.version;
  return { ...world, promotions, promotion, destination, version };
}

describe('promotion', () => {
  it('requires a verified publisher to approve', async () => {
    const world = await promotionWorld();
    expect(
      await refusedWith(
        world.promotions.approve(ADMIN, {
          promotionId: world.promotion.id,
          expectedVersion: 1,
        }),
      ),
    ).toBe('denied');
    expect(
      await refusedWith(
        world.promotions.execute(ADMIN, {
          promotionId: world.promotion.id,
          destination: world.destination,
        }),
      ),
    ).toBe('invalid-state');
  });

  it('a resumed promotion promotes each entry exactly once', async () => {
    const world = await promotionWorld(3);
    await world.promotions.approve(PRIVILEGED, {
      promotionId: world.promotion.id,
      expectedVersion: 1,
    });
    const first = await world.promotions.execute(ADMIN, {
      promotionId: world.promotion.id,
      destination: world.destination,
      maxItems: 2,
    });
    expect(first).toMatchObject({
      state: 'promoting',
      promoted: 2,
      stopped: 'max-items',
    });
    const second = await world.promotions.execute(ADMIN, {
      promotionId: world.promotion.id,
      destination: world.destination,
    });
    expect(second).toMatchObject({ state: 'promoted', promoted: 1, stopped: null });
    expect([...world.destination.puts.values()]).toEqual([1, 1, 1]);
    const third = await world.promotions.execute(ADMIN, {
      promotionId: world.promotion.id,
      destination: world.destination,
    });
    expect(third).toMatchObject({ state: 'promoted', promoted: 0 });
  });

  it('stops when the approval is withdrawn mid-promotion', async () => {
    const world = await promotionWorld(3);
    await world.promotions.approve(PRIVILEGED, {
      promotionId: world.promotion.id,
      expectedVersion: 1,
    });
    const put = world.destination.put.bind(world.destination);
    world.destination.put = async (item) => {
      const result = await put(item);
      if (world.destination.puts.size === 1)
        await world.promotions.withdraw(ADMIN, {
          promotionId: world.promotion.id,
          expectedVersion: world.version(),
        });
      return result;
    };
    const summary = await world.promotions.execute(ADMIN, {
      promotionId: world.promotion.id,
      destination: world.destination,
      batchSize: 1,
    });
    expect(summary).toMatchObject({
      state: 'withdrawn',
      promoted: 1,
      stopped: 'approval-withdrawn',
    });
    expect(world.destination.puts.size).toBe(1);
    expect(
      await refusedWith(
        world.promotions.execute(ADMIN, {
          promotionId: world.promotion.id,
          destination: world.destination,
        }),
      ),
    ).toBe('approval-withdrawn');
  });

  it('refuses a stale version', async () => {
    const world = await promotionWorld(1);
    expect(
      await refusedWith(
        world.promotions.approve(PRIVILEGED, {
          promotionId: world.promotion.id,
          expectedVersion: 9,
        }),
      ),
    ).toBe('conflict');
  });
});

/* ===========================================================================
 * Decisions, raw evidence, sources
 * ========================================================================= */

async function stagedWorld() {
  const world = pipelineWorld([1, 2]);
  const same = 'https://youtu.be/sameVideo01';
  world.fetcher.set(
    pageUrl(1),
    ok(pageUrl(1), videoBody(1, { providerReference: same })),
  );
  world.fetcher.set(
    pageUrl(2),
    ok(
      pageUrl(2),
      videoBody(2, {
        providerReference: same,
        languageCode: 'ur',
        primaryLocale: 'ur' as ParsedVideo['primaryLocale'],
      }),
    ),
  );
  const summary = await world.run();
  const topics = new FakeTopics(new Set(['11111111-1111-4111-8111-111111111111']));
  const decisions = createMigrationDecisionService({
    decisions: world.store.decisionPort,
    read: world.store.readPort,
    topics,
    authority: world.authority,
  });
  return { ...world, summary, decisions };
}

describe('decisions', () => {
  it('approves, refuses a stale version, withdraws, and keeps review forward-only', async () => {
    const world = await stagedWorld();
    const row = [...world.store.staged.values()][0]!;
    expect(
      await refusedWith(
        world.decisions.review(ADMIN, {
          stagedRecordId: row.id,
          expectedVersion: 2,
          decision: 'approve',
          note: '',
        }),
      ),
    ).toBe('conflict');
    await world.decisions.review(ADMIN, {
      stagedRecordId: row.id,
      expectedVersion: 1,
      decision: 'approve',
      note: 'checked',
    });
    expect(row.review).toBe('approved');
    expect(
      await refusedWith(
        world.decisions.review(ADMIN, {
          stagedRecordId: row.id,
          expectedVersion: 2,
          decision: 'reject',
          note: '',
        }),
      ),
    ).toBe('invalid-state');
    await world.decisions.review(ADMIN, {
      stagedRecordId: row.id,
      expectedVersion: 2,
      decision: 'withdraw-approval',
      note: '',
    });
    expect(row.review).toBe('pending');
  });

  it('refuses to approve an invalid or personal-data revision', async () => {
    const world = await stagedWorld();
    const row = [...world.store.staged.values()][0]!;
    row.personalData = 'flagged';
    expect(
      await refusedWith(
        world.decisions.review(ADMIN, {
          stagedRecordId: row.id,
          expectedVersion: 1,
          decision: 'approve',
          note: '',
        }),
      ),
    ).toBe('not-publishable');
  });

  it('never merges a cross-language pair', async () => {
    const world = await stagedWorld();
    const candidate = [...world.store.duplicates.values()].find(
      (row) => row.crossLanguage,
    )!;
    expect(candidate).toBeDefined();
    expect(
      await refusedWith(
        world.decisions.duplicate(ADMIN, {
          candidateId: candidate.id,
          expectedVersion: 1,
          decision: 'merge',
          note: '',
        }),
      ),
    ).toBe('cross-language');
    await world.decisions.duplicate(ADMIN, {
      candidateId: candidate.id,
      expectedVersion: 1,
      decision: 'distinct',
      note: 'translation',
    });
    expect(candidate.state).toBe('distinct');
  });

  it('confirms a topic mapping only to a Topic that exists', async () => {
    const world = await stagedWorld();
    const mapping = [...world.store.topicMappings.values()][0]!;
    expect(
      await refusedWith(
        world.decisions.topicMapping(ADMIN, {
          mappingId: mapping.id,
          expectedVersion: 1,
          decision: 'confirm',
          topicId: '22222222-2222-4222-8222-222222222222',
        }),
      ),
    ).toBe('topic-unknown');
    expect(
      await refusedWith(
        world.decisions.topicMapping(ADMIN, {
          mappingId: mapping.id,
          expectedVersion: 1,
          decision: 'confirm',
          topicId: null,
        }),
      ),
    ).toBe('invalid');
    expect(
      await refusedWith(
        world.decisions.topicMapping(ADMIN, {
          mappingId: mapping.id,
          expectedVersion: 1,
          decision: 'exclude',
          topicId: '11111111-1111-4111-8111-111111111111',
        }),
      ),
    ).toBe('invalid');
    await world.decisions.topicMapping(ADMIN, {
      mappingId: mapping.id,
      expectedVersion: 1,
      decision: 'confirm',
      topicId: '11111111-1111-4111-8111-111111111111',
    });
    expect(mapping).toMatchObject({
      state: 'confirmed',
      topicId: '11111111-1111-4111-8111-111111111111',
    });
  });

  it('retries only a retry-eligible error', async () => {
    const world = pipelineWorld([1]);
    world.fetcher.set(pageUrl(1), status(pageUrl(1), 403));
    await world.run();
    const decisions = createMigrationDecisionService({
      decisions: world.store.decisionPort,
      read: world.store.readPort,
      topics: new FakeTopics(),
      authority: world.authority,
    });
    const error = [...world.store.errors.values()][0]!;
    expect(
      await refusedWith(
        decisions.error(ADMIN, {
          errorId: error.id,
          expectedVersion: 1,
          decision: 'retry',
        }),
      ),
    ).toBe('not-retryable');
    await decisions.error(ADMIN, {
      errorId: error.id,
      expectedVersion: 1,
      decision: 'dismiss',
    });
    expect(error.resolution).toBe('dismissed');
  });

  it('classifies only a missing record, and refuses public eligibility without ownership or licence', async () => {
    const world = await stagedWorld();
    const record = recordOf(world.store, 1);
    expect(
      await refusedWith(
        world.decisions.disappearance(ADMIN, {
          recordId: record.id,
          expectedVersion: 1,
          classification: 'withdrawn',
          note: '',
        }),
      ),
    ).toBe('invalid-state');
    record.observed = 'missing';
    await world.decisions.disappearance(ADMIN, {
      recordId: record.id,
      expectedVersion: 1,
      classification: 'moved',
      note: '',
    });
    expect(record.disappearance).toBe('moved');
    expect(
      await refusedWith(
        world.decisions.rights(ADMIN, {
          provenanceId: '33333333-3333-4333-8333-333333333333',
          expectedVersion: 1,
          licence: 'unknown',
          visibility: 'public-eligible',
          licenceEvidence: null,
          rightsHolder: null,
        }),
      ),
    ).toBe('invalid');
  });
});

describe('raw evidence', () => {
  async function rawWorld(body: string) {
    const world = pipelineWorld([1]);
    world.fetcher.set(pageUrl(1), ok(pageUrl(1), body, 'text/html'));
    await world.run();
    const raw = createMigrationRawService({
      raw: world.store.rawPort,
      authority: world.authority,
    });
    const snapshot = [...world.store.snapshots.values()][0]!;
    return { ...world, raw, snapshot };
  }

  it('previews a bounded escaped-text view of the exact bytes, audited', async () => {
    const hostile = videoBody(1, { descriptionHtml: '<script>alert(1)</script>' });
    const world = await rawWorld(hostile);
    const preview = await world.raw.preview(ADMIN, world.snapshot.id);
    expect(preview).toMatchObject({ text: hostile, truncated: false, disposed: false });
    expect(world.store.audit).toContain('migration.snapshot.read:preview');
  });

  it('truncates a large body to 64 KiB and decodes invalid UTF-8 with replacement characters', async () => {
    const world = await rawWorld(`${'x'.repeat(70_000)}`);
    const preview = await world.raw.preview(ADMIN, world.snapshot.id);
    expect(preview.truncated).toBe(true);
    expect(preview.text.length).toBe(64 * 1024);
    world.snapshot.body = new Uint8Array([0x61, 0xff, 0x62]);
    expect((await world.raw.preview(ADMIN, world.snapshot.id)).text).toBe('a�b');
  });

  it('downloads as an inert attachment', async () => {
    const world = await rawWorld(videoBody(1));
    const download = await world.raw.download(ADMIN, world.snapshot.id);
    expect(download.headers).toEqual({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="snapshot-${world.snapshot.id}.bin"`,
      'Content-Length': String(download.bytes.byteLength),
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cache-Control': 'private, no-store',
    });
    expect(new TextDecoder().decode(download.bytes)).toBe(videoBody(1));
  });

  it('disposes the body only, after which it previews as disposed and cannot be downloaded', async () => {
    const world = await rawWorld(videoBody(1));
    expect(
      await refusedWith(
        world.raw.dispose(ADMIN, { snapshotId: world.snapshot.id, reason: '' }),
      ),
    ).toBe('invalid');
    await world.raw.dispose(ADMIN, {
      snapshotId: world.snapshot.id,
      reason: 'retention',
    });
    expect(await world.raw.preview(ADMIN, world.snapshot.id)).toMatchObject({
      disposed: true,
      text: '',
    });
    expect(await refusedWith(world.raw.download(ADMIN, world.snapshot.id))).toBe(
      'invalid-state',
    );
  });

  it('requires migration.administer, even to preview', async () => {
    const world = await rawWorld(videoBody(1));
    expect(await refusedWith(world.raw.preview(READER, world.snapshot.id))).toBe(
      'denied',
    );
    expect(await refusedWith(world.raw.download(READER, world.snapshot.id))).toBe(
      'denied',
    );
    expect(world.store.calls.readSnapshot).toBe(0);
  });
});

describe('sources', () => {
  const valid = {
    key: 'fixture-two',
    name: 'Fixture two',
    contentKind: 'media.video',
    accessMethod: 'http',
    baseUrl: 'https://two.fixture.invalid/',
    hosts: ['two.fixture.invalid'],
    defaultLanguageCode: 'ur',
    policy: POLICY,
    licensingEvidence: null,
    policyNotes: null,
  };

  function sourceWorld() {
    const store = new FakeStore();
    const service = createMigrationSourceService({
      sources: store.sourcePort,
      read: store.readPort,
      authority: new FakeAuthority(),
      ids: idFactory(5),
    });
    return { store, service };
  }

  it('creates a fixture source', async () => {
    const { service } = sourceWorld();
    expect(await service.createFixture(ADMIN, valid)).toMatchObject({
      key: 'fixture-two',
      authorityKind: 'fixture',
      state: 'active',
    });
    expect(await refusedWith(service.createFixture(ADMIN, valid))).toBe('duplicate');
  });

  it('refuses any authorisation field as a real source', async () => {
    const { service } = sourceWorld();
    for (const extra of [
      { authorityKind: 'authorised' },
      { authorisationReference: 'letter' },
      { authorisedOn: '2026-01-01' },
    ])
      expect(
        await refusedWith(service.createFixture(ADMIN, { ...valid, ...extra })),
      ).toBe('real-source-not-authorised');
    expect(
      await refusedWith(service.createFixture(ADMIN, { ...valid, unexpected: true })),
    ).toBe('invalid');
  });

  it('refuses a scope outside *.fixture.invalid', async () => {
    const { service } = sourceWorld();
    expect(
      await refusedWith(
        service.createFixture(ADMIN, {
          ...valid,
          hosts: ['minhaj.example'],
          baseUrl: 'https://minhaj.example/',
        }),
      ),
    ).toBe('unsafe-scope');
    expect(
      await refusedWith(
        service.createFixture(ADMIN, {
          ...valid,
          baseUrl: 'https://other.fixture.invalid/',
        }),
      ),
    ).toBe('unsafe-scope');
    expect(
      await refusedWith(
        service.createFixture(ADMIN, {
          ...valid,
          baseUrl: 'http://127.0.0.1/',
          hosts: ['127.0.0.1'],
        }),
      ),
    ).toBe('unsafe-scope');
  });

  it('requires a base URL for http and none for an export', async () => {
    const { service } = sourceWorld();
    expect(
      await refusedWith(service.createFixture(ADMIN, { ...valid, baseUrl: null })),
    ).toBe('invalid');
    expect(
      await refusedWith(
        service.createFixture(ADMIN, { ...valid, accessMethod: 'export' }),
      ),
    ).toBe('invalid');
    expect(
      await service.createFixture(ADMIN, {
        ...valid,
        accessMethod: 'export',
        baseUrl: null,
        hosts: [],
      }),
    ).toMatchObject({ accessMethod: 'export' });
  });

  it('updates at the expected version and never activates a real source without its written authorisation', async () => {
    const { store, service } = sourceWorld();
    const source = await service.createFixture(ADMIN, valid);
    const update = {
      id: source.id,
      expectedVersion: 1,
      name: 'Renamed',
      state: 'inactive',
      defaultLanguageCode: null,
      policy: POLICY,
      licensingEvidence: null,
      policyNotes: null,
    };
    expect(await service.update(ADMIN, update)).toMatchObject({
      name: 'Renamed',
      version: 2,
    });
    expect(await refusedWith(service.update(ADMIN, update))).toBe('conflict');
    const real = store.addSource({
      key: 'real',
      authorityKind: 'authorised',
      state: 'inactive',
    });
    expect(
      await refusedWith(
        service.update(ADMIN, { ...update, id: real.id, state: 'active' }),
      ),
    ).toBe('real-source-not-authorised');
  });
});

/* ===========================================================================
 * Every service denies without the permission
 * ========================================================================= */

describe('authority', () => {
  it('denies every operation to an actor without the permission', async () => {
    const store = new FakeStore();
    const authority = new FakeAuthority();
    const id = '00000000-0000-4000-8000-000000000001';
    const sources = createMigrationSourceService({
      sources: store.sourcePort,
      read: store.readPort,
      authority,
    });
    const decisions = createMigrationDecisionService({
      decisions: store.decisionPort,
      read: store.readPort,
      topics: new FakeTopics(),
      authority,
    });
    const raw = createMigrationRawService({ raw: store.rawPort, authority });
    const publication = createMigrationPublicationService({
      publication: store.publicationPort,
      read: store.readPort,
      target: new FakeTarget(),
      authority,
    });
    const promotions = createMigrationPromotionService({
      promotions: store.promotionPort,
      authority,
    });
    const read = createMigrationReadService({
      read: store.readPort,
      publication: store.publicationPort,
      promotions: store.promotionPort,
      authority,
    });
    const pipeline = createMigrationPipelineService({
      pipeline: store.pipeline,
      sources: store.sourcePort,
      authority,
    });

    const administer = (actor: { accountId: string }) => [
      () => sources.createFixture(actor, {}),
      () => sources.update(actor, {}),
      () =>
        pipeline.run(actor, {
          sourceId: id,
          adapter: new JsonAdapter([]),
          fetcher: new ScriptedFetcher(),
          assets: new FakeStorage(),
        }),
      () => pipeline.cancel(actor, { runId: id, expectedVersion: 1 }),
      () => decisions.review(actor, {}),
      () => decisions.duplicate(actor, {}),
      () => decisions.topicMapping(actor, {}),
      () => decisions.error(actor, {}),
      () => decisions.disappearance(actor, {}),
      () => decisions.rights(actor, {}),
      () => decisions.legacyMapping(actor, {}),
      () => raw.preview(actor, id),
      () => raw.download(actor, id),
      () => raw.dispose(actor, {}),
      () => publication.createManifest(actor, {}),
      () => publication.discard(actor, {}),
      () => publication.publish(actor, {}),
      () => publication.rollback(actor, {}),
      () => promotions.create(actor, {}),
      () => promotions.approve(actor, {}),
      () => promotions.withdraw(actor, {}),
      () =>
        promotions.execute(actor, {
          promotionId: id,
          destination: new FakeDestination(),
        }),
    ];
    const reads = (actor: { accountId: string }) => [
      () => sources.source(actor, id),
      () => sources.sourceByKey(actor, 'fixture-videos'),
      () => sources.sources(actor),
      () => read.runs(actor),
      () => read.run(actor, id),
      () => read.runItems(actor, { runId: id }),
      () => read.staged(actor),
      () => read.stagedDetail(actor, id),
      () => read.snapshot(actor, id),
      () => read.duplicates(actor),
      () => read.topicMappings(actor),
      () => read.legacyMappings(actor),
      () => read.unresolvedLinks(actor),
      () => read.errors(actor),
      () => read.missingRecords(actor),
      () => read.manifests(actor),
      () => read.manifest(actor, id),
      () => read.promotions(actor),
      () => read.promotion(actor, id),
      () => read.promotionEntries(actor, { promotionId: id }),
      () => read.assets(actor),
      () => read.reconciliations(actor),
    ];

    for (const work of [...administer(NOBODY), ...reads(NOBODY)])
      expect(await refusedWith(work())).toBe('denied');
    // A reader reads, and administers nothing.
    for (const work of administer(READER))
      expect(await refusedWith(work())).toBe('denied');
    for (const work of reads(READER)) await work();
    expect(await refusedWith(read.runs(READER, { offset: -1 }))).toBe('invalid');
    expect(await refusedWith(read.staged(READER, { review: 'bogus' }))).toBe('invalid');
  });

  it('maps every refusal onto the closed vocabulary', () => {
    expect(migrationFailure({ reason: 'host-refused' })).toBe('host-refused');
    expect(migrationFailure({ reason: 'made-up' })).toBe('unavailable');
    expect(migrationFailure(new Error('boom'))).toBe('unavailable');
    for (const reason of MIGRATION_REFUSAL_REASONS)
      expect(migrationFailure({ reason })).toBe(reason);
  });
});
