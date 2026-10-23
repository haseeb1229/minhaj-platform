import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { ResolvedSession } from '@minhaj/contracts/identity';
import type {
  MigrationActor,
  MigrationSourceAdapter,
  SourcePolicy,
} from '@minhaj/contracts/migration';

import {
  composeMigrationRunner,
  type MigrationRunner,
} from '../../apps/web/src/composition/migration-runner.ts';
import { createFixtureVideoAdapter } from './adapters/fixture-video.ts';
import { CommandError, required, runCommand } from './cli.ts';
import {
  FIXTURE_BASE_URL,
  FIXTURE_BASE_VIDEO_COUNT,
  FIXTURE_VIDEO_HOST,
  startFixtureServer,
} from './fixture-server.ts';
import { createBundleDestination } from './promotion-bundle.ts';
import { createFixtureFetcher } from './safe-fetch.ts';

/**
 * THE MIGRATION FIXTURE PROOF — Phase 29, end to end, against a real database,
 * as the RUNTIME principal, over synthetic fixtures only.
 *
 * ## How it is run
 *
 * Never directly. An owner-side command creates its synthetic operator with
 * the MIGRATION principal, starts this file in a child process whose only
 * database setting is the runtime principal's `DATABASE_URL`, and removes the
 * operator's authority afterwards (`packages/database/src/lifecycle/
 * migration-proof-operator.ts`):
 *
 *   - on the staging VM: `docker/staging/bin/migration-proof.sh`, which runs
 *     `staging-migration-proof` in the exact-SHA operations image against
 *     `MinhajStaging` after the full staging guard;
 *   - locally, against a disposable `MinhajPhase1Test_<32 hex>` database:
 *     `npx vitest run tests/migration/staging-fixture-proof.integration.test.ts`
 *     (Docker SQL Server and ClamAV up, `docker/.env` configured), which
 *     creates the database, provisions the runtime principal, and drives the
 *     same lifecycle helper.
 *
 * It refuses to start unless `DATABASE_URL` names `MinhajStaging` on the
 * internal staging SQL host, or a disposable database on the loopback host.
 *
 * ## What it proves
 *
 *   (a) the operator's privileged actor is minted by Identity's gate for
 *       `migration.publish` + `migration-publication`, and a plain actor is
 *       refused publication and promotion approval;
 *   (b) a unique fixture source is registered and its pipeline, run against
 *       the in-process LOOPBACK fixture server, is interrupted (`maxItems`) and
 *       resumed: one run, every record fetched exactly once, nothing staged
 *       twice, reconciliation balanced;
 *   (c) approved revisions are published through Media's public service as
 *       published Videos the PUBLIC read serves, each with an active legacy
 *       mapping; the rollback archives every Video, disables every mapping, and
 *       the public read serves none of them;
 *   (d) an approved promotion is carried into a temporary bundle directory,
 *       interrupted and resumed with exactly one file per entry, and a second
 *       promotion withdrawn mid-way stops and is refused further execution.
 *       Promotion happens BEFORE the rollback, because only published entries
 *       may be promoted;
 *   (e) nothing staged is public: no route serves a staged record, and the one
 *       public form migration creates — a published Video — is gone from the
 *       public read after the rollback.
 *
 * ## Repeatable on one database
 *
 * Each run is its own synthetic corpus: the source key, the legacy
 * identifiers, the titles and the provider identifiers carry a per-run salt
 * (`proofAdapter`), so a later run never collapses into an earlier run's
 * records or meets its archived Videos. The fixture pages themselves are the
 * fixture server's, unchanged.
 *
 * The final stdout line is one JSON object with the counts.
 */

const USAGE = 'staging-fixture-proof.ts --operator <accountId> --session <sessionId>';

const POLICY: SourcePolicy = Object.freeze({
  minIntervalMs: 0,
  maxConcurrency: 1,
  maxAttempts: 3,
  timeoutMs: 10_000,
  maxBodyBytes: 1024 * 1024,
  maxRedirects: 2,
});

const DISPOSABLE = /^MinhajPhase1Test_[0-9a-f]{32}$/;
const ACCOUNT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/**
 * The database `DATABASE_URL` names, positively: `MinhajStaging` on the
 * internal staging SQL service, or a disposable database on loopback. The
 * owner-side command proved the same target with the real staging or local
 * guard before starting this process; this is an independent second check.
 */
function approvedTarget(url: string | undefined): 'staging' | 'disposable' {
  if (url === undefined || !url.startsWith('sqlserver://'))
    throw new CommandError('DATABASE_URL is not a SQL Server URL; refusing.');
  const [authority = '', ...tokens] = url.slice('sqlserver://'.length).split(';');
  const [host = '', port = '1433'] = authority.split(':');
  const databases = tokens
    .map((token) => /^\s*database\s*=(.*)$/i.exec(token)?.[1]?.trim())
    .filter((value): value is string => value !== undefined);
  if (databases.length !== 1)
    throw new CommandError('DATABASE_URL names no single database; refusing.');
  const database = databases[0] ?? '';
  if (database === 'MinhajStaging' && host === 'sqlserver' && port === '1433')
    return 'staging';
  if (DISPOSABLE.test(database) && (host === 'localhost' || host === '127.0.0.1'))
    return 'disposable';
  throw new CommandError(
    'DATABASE_URL is neither MinhajStaging on the staging SQL host nor a disposable ' +
      'database on loopback; refusing.',
  );
}

function check(condition: boolean, what: string): asserts condition {
  if (!condition) throw new CommandError(`proof failed: ${what}`);
}

/** A Migration refusal's code, `accepted`, or `unclassified`. */
async function refusalOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    const candidate = error as { name?: unknown; reason?: unknown } | null;
    return candidate?.name === 'MigrationRefusal' && typeof candidate.reason === 'string'
      ? candidate.reason
      : 'unclassified';
  }
  return 'accepted';
}

/** Every row of a bounded, paged operator read. */
async function every<T>(
  load: (
    offset: number,
  ) => Promise<{ readonly rows: readonly T[]; readonly total: number }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < 4_000; page += 1) {
    const next = await load(rows.length);
    rows.push(...next.rows);
    if (next.rows.length === 0 || rows.length >= next.total) return rows;
  }
  throw new CommandError('proof failed: a listing did not end');
}

/** A valid-shaped provider identifier, derived from the source's and the run's salt. */
function saltedProviderId(provider: string, reference: string, salt: string): string {
  const digest = createHash('sha256').update(`${salt}:${provider}:${reference}`).digest();
  if (provider === 'vimeo')
    return `1${(digest.readBigUInt64BE(0) % 100_000_000_000n).toString().padStart(11, '0')}`;
  return digest.toString('base64url').slice(0, 11);
}

/**
 * The fixture adapter, unchanged, with this run's salt on everything that
 * identifies a record across sources: discovery's legacy identifier, the
 * parsed identifier, titles and the provider identifier. Raw evidence is the
 * fixture server's bytes exactly; only the parse result differs, and the
 * parser key says so.
 */
function proofAdapter(
  inner: MigrationSourceAdapter,
  salt: string,
): MigrationSourceAdapter {
  const salted = (value: string) => `${value.slice(0, 180)}-${salt}`;
  const titled = (value: string) => `${value.slice(0, 220)} [${salt}]`;
  return {
    adapterKey: inner.adapterKey,
    adapterVersion: inner.adapterVersion,
    parserKey: `${inner.parserKey}+proof-salt`,
    parserVersion: inner.parserVersion,
    contentKind: inner.contentKind,
    accessMethod: inner.accessMethod,
    async discover(cursor, fetcher) {
      const page = await inner.discover(cursor, fetcher);
      if (page.kind !== 'page') return page;
      return {
        ...page,
        items: page.items.map((item) => ({
          ...item,
          legacyIdentifier:
            item.legacyIdentifier === null ? null : salted(item.legacyIdentifier),
        })),
      };
    },
    retrieve: (item, fetcher) => inner.retrieve(item, fetcher),
    parse(evidence) {
      const result = inner.parse(evidence);
      if (result.kind !== 'parsed') return result;
      const record = result.record;
      return {
        kind: 'parsed',
        record: {
          ...record,
          title: titled(record.title),
          labels: record.labels.map((label) => ({
            ...label,
            title: titled(label.title),
          })),
          providerReference:
            record.provider === null || record.providerReference === null
              ? record.providerReference
              : saltedProviderId(record.provider, record.providerReference, salt),
          legacyIdentifier:
            record.legacyIdentifier === null ? null : salted(record.legacyIdentifier),
        },
      };
    },
  };
}

/** The canonical path's slug: `/watch/videos/{slug}`. */
function slugOf(canonicalPath: string | null): string {
  const prefix = '/watch/videos/';
  check(
    canonicalPath !== null && canonicalPath.startsWith(prefix),
    'a canonical path is a Watch Video path',
  );
  return canonicalPath.slice(prefix.length);
}

async function entryFiles(
  directory: string,
): Promise<{ files: number; temporary: number }> {
  const names = await readdir(path.join(directory, 'entries'));
  return {
    files: names.filter((name) => !name.startsWith('.') && name.endsWith('.json')).length,
    temporary: names.filter((name) => name.startsWith('.')).length,
  };
}

async function prove(
  runner: MigrationRunner,
  operator: string,
  sessionId: string,
  work: string,
): Promise<Record<string, unknown>> {
  const actor: MigrationActor = { accountId: operator };
  const plain: unknown = { accountId: operator };

  /* ---- (a) the privileged actor ------------------------------------------ */
  const now = new Date();
  const session: ResolvedSession = {
    sessionId,
    sessionCreatedAt: now,
    sessionExpiresAt: new Date(now.getTime() + 60 * 60 * 1000),
    // The gate reads the account's id and status and re-reads every authority
    // fact live; the rest describes the synthetic operator.
    account: {
      id: operator,
      email: `migration-proof-${operator}@migration-proof.invalid`,
      emailVerified: true,
      name: 'NON_MIGRATION_FIXTURE operator',
      locale: 'en',
      timezone: null,
      status: 'active',
      accountSetupCompletedAt: null,
      createdAt: now,
    },
  };
  const publisher = await runner.requirePrivilegedAction(session);
  check(
    publisher !== null,
    'the operator obtains a migration-publication privileged actor',
  );

  /* ---- (b) a fixture source, run, interrupted and resumed ---------------- */
  const salt = randomBytes(4).toString('hex');
  const server = await startFixtureServer();
  try {
    const source = await runner.sources.createFixture(actor, {
      key: `fixture-proof-${salt}`,
      name: `FIXTURE staging proof ${salt}`,
      contentKind: 'media.video',
      accessMethod: 'http',
      baseUrl: FIXTURE_BASE_URL,
      hosts: [FIXTURE_VIDEO_HOST],
      defaultLanguageCode: null,
      policy: POLICY,
      licensingEvidence: null,
      policyNotes: 'Synthetic proof source: loopback fixture pages only. Not content.',
    });
    const adapter = proofAdapter(
      createFixtureVideoAdapter({ baseUrl: FIXTURE_BASE_URL }),
      salt,
    );
    const fetcher = createFixtureFetcher(source, server.endpoint);
    const run = (maxItems: number | null) =>
      runner.pipeline.run(actor, {
        sourceId: source.id,
        adapter,
        fetcher,
        options: { maxItems, codeRevision: runner.codeRevision },
      });

    const first = await run(5);
    check(
      first.state === 'interrupted' && !first.resumed,
      'the first invocation stops early',
    );
    check(first.processed === 5, 'the first invocation processes exactly five items');
    const second = await run(null);
    check(
      second.resumed && second.runId === first.runId,
      'the second invocation resumes the same run',
    );
    check(second.state === 'completed', 'the resumed run completes');
    check(second.reconciliation?.balanced === true, 'the run reconciles balanced');
    const counts = second.counts;
    check(
      counts.discovered === FIXTURE_BASE_VIDEO_COUNT,
      'every fixture video is discovered once',
    );
    check(
      first.processed + second.processed === counts.discovered,
      'each item is processed exactly once across both invocations',
    );
    const items = await every((offset) =>
      runner.read.runItems(actor, { runId: first.runId, offset }),
    );
    check(items.length === counts.discovered, 'one run item per discovered record');
    check(
      new Set(items.map((item) => item.recordId)).size === items.length,
      'no record twice',
    );
    for (const record of server.control.listed())
      check(
        server.control.requestCount(`/videos/${record.id}.html`) === 1,
        'each fixture page is fetched exactly once',
      );
    const staged = await every((offset) =>
      runner.read.staged(actor, { runId: first.runId, offset }),
    );
    check(staged.length === counts.staged, 'one staged revision per staged record');
    check(
      staged.every((row) => row.revision === 1),
      'no record is staged twice',
    );

    /* ---- (c) approve, publish, verify ------------------------------------ */
    const publishable = staged.filter(
      (row) =>
        row.review === 'pending' &&
        row.validation === 'valid' &&
        row.personalData === 'none',
    );
    check(publishable.length >= 2, 'at least two revisions are publishable');
    for (const row of publishable)
      await runner.decisions.review(actor, {
        stagedRecordId: row.id,
        expectedVersion: row.version,
        decision: 'approve',
        note: 'Synthetic staging proof approval.',
      });
    const manifest = await runner.publication.createManifest(actor, {
      runId: first.runId,
      stagedRecordIds: publishable.map((row) => row.id),
    });
    const command = { manifestId: manifest.id, expectedVersion: manifest.version };
    check(
      (await refusalOf(runner.publication.publish(plain, command))) === 'denied',
      'publication without a privileged actor is denied',
    );
    const published = await runner.publication.publish(publisher, command);
    check(
      published.state === 'published' &&
        published.done === publishable.length &&
        published.refused === 0,
      'every approved revision is published through Media',
    );
    const live = await runner.read.manifest(actor, manifest.id);
    check(live !== null, 'the manifest reads back');
    const entries = live.entries;
    for (const entry of entries) {
      check(
        entry.state === 'published' && entry.videoId !== null,
        'each entry is published',
      );
      const shown = await runner.publicVideo(slugOf(entry.canonicalPath));
      check(
        shown !== null && shown.id === entry.videoId,
        'each Video is served by the public read',
      );
    }
    const mappingsOf = async (state: 'active' | 'disabled') =>
      (
        await every((offset) => runner.read.legacyMappings(actor, { state, offset }))
      ).filter((mapping) => mapping.manifestId === manifest.id);
    const active = await mappingsOf('active');
    check(
      active.length === entries.length,
      'one active legacy mapping per published record',
    );

    /* ---- (d) promotion: interrupted, resumed, and a withdrawn one -------- */
    const entryIds = entries.map((entry) => entry.id);
    const firstBundle = path.join(work, 'promotion-1');
    const promotion = await runner.promotion.create(actor, {
      manifestEntryIds: entryIds,
    });
    check(
      (await refusalOf(
        runner.promotion.approve(plain, {
          promotionId: promotion.id,
          expectedVersion: promotion.version,
        }),
      )) === 'denied',
      'promotion approval without a privileged actor is denied',
    );
    await runner.promotion.approve(publisher, {
      promotionId: promotion.id,
      expectedVersion: promotion.version,
    });
    const bundle = createBundleDestination(firstBundle);
    const interrupted = await runner.promotion.execute(actor, {
      promotionId: promotion.id,
      destination: bundle,
      maxItems: 2,
    });
    check(
      interrupted.state === 'promoting' &&
        interrupted.promoted === 2 &&
        interrupted.stopped === 'max-items',
      'the promotion stops after two entries',
    );
    const resumed = await runner.promotion.execute(actor, {
      promotionId: promotion.id,
      destination: bundle,
    });
    check(
      resumed.state === 'promoted' && resumed.promoted === entries.length - 2,
      'the resumed promotion carries exactly the remaining entries',
    );
    const again = await runner.promotion.execute(actor, {
      promotionId: promotion.id,
      destination: bundle,
    });
    check(again.promoted === 0, 'a finished promotion carries nothing again');
    const written = await entryFiles(firstBundle);
    check(
      written.files === entries.length && written.temporary === 0,
      'exactly one bundle file per entry, and no partial file',
    );
    const bundleManifest = await bundle.writeManifest({ promotionId: promotion.id });
    check(
      bundleManifest.entries.length === entries.length,
      'the bundle manifest lists every entry',
    );

    const secondBundle = path.join(work, 'promotion-2');
    const withdrawn = await runner.promotion.create(actor, {
      manifestEntryIds: entryIds,
    });
    await runner.promotion.approve(publisher, {
      promotionId: withdrawn.id,
      expectedVersion: withdrawn.version,
    });
    const partial = createBundleDestination(secondBundle);
    const started = await runner.promotion.execute(actor, {
      promotionId: withdrawn.id,
      destination: partial,
      maxItems: 1,
    });
    check(started.promoted === 1, 'the second promotion carries one entry');
    const current = await runner.read.promotion(actor, withdrawn.id);
    check(current !== null, 'the second promotion reads back');
    await runner.promotion.withdraw(actor, {
      promotionId: withdrawn.id,
      expectedVersion: current.version,
    });
    const afterWithdrawal = await refusalOf(
      runner.promotion.execute(actor, {
        promotionId: withdrawn.id,
        destination: partial,
      }),
    );
    check(
      afterWithdrawal === 'approval-withdrawn',
      'a withdrawn promotion is not executed',
    );
    check(
      (await entryFiles(secondBundle)).files === 1,
      'nothing more reaches the bundle',
    );

    /* ---- (c, e) rollback: archived, unmapped, not public ----------------- */
    const before = await runner.read.manifest(actor, manifest.id);
    check(before !== null, 'the manifest reads back before rollback');
    const rollback = {
      manifestId: manifest.id,
      expectedVersion: before.manifest.version,
      reason: 'Synthetic staging proof: reversing the fixture publication.',
    };
    check(
      (await refusalOf(runner.publication.rollback(plain, rollback))) === 'denied',
      'rollback without a privileged actor is denied',
    );
    const reversed = await runner.publication.rollback(publisher, rollback);
    check(
      reversed.state === 'rolled-back' &&
        reversed.done === entries.length &&
        reversed.refused === 0,
      'every published entry is rolled back',
    );
    let stillPublic = 0;
    for (const entry of entries)
      if ((await runner.publicVideo(slugOf(entry.canonicalPath))) !== null)
        stillPublic += 1;
    check(stillPublic === 0, 'no rolled-back Video is served by the public read');
    check((await mappingsOf('active')).length === 0, 'no legacy mapping stays active');
    const disabled = await mappingsOf('disabled');
    check(
      disabled.length === entries.length,
      'every legacy mapping is disabled, none deleted',
    );

    return {
      source: source.key,
      runId: first.runId,
      discovered: counts.discovered,
      processed: [first.processed, second.processed],
      staged: counts.staged,
      approved: publishable.length,
      published: entries.length,
      legacyMappingsActivated: active.length,
      promotion: {
        entries: entries.length,
        interruptedAfter: interrupted.promoted,
        files: written.files,
        manifestSha256: bundleManifest.sha256,
      },
      withdrawnPromotion: { promotedBeforeWithdrawal: 1, afterWithdrawal },
      rolledBack: reversed.done,
      legacyMappingsDisabled: disabled.length,
      publicAfterRollback: stillPublic,
      deniedWithoutPrivilegedActor: 3,
    };
  } finally {
    await server.close();
  }
}

await runCommand('migration:staging-fixture-proof', async () => {
  const operator = required('--operator', USAGE);
  const sessionId = required('--session', USAGE);
  if (!ACCOUNT.test(operator) || !ACCOUNT.test(sessionId))
    throw new CommandError('the operator and session must be generated identifiers');
  const target = approvedTarget(process.env['DATABASE_URL']);

  const work = await mkdtemp(path.join(os.tmpdir(), 'minhaj-migration-proof-'));
  try {
    return {
      target,
      ...(await prove(composeMigrationRunner(), operator, sessionId, work)),
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
});
