import {
  EDITORIAL_BATCH_LIMIT,
  editorialKindSchema,
  type EditorialKind,
} from '@minhaj/contracts/editorial';
import { MIGRATION_LIMITS, type ManifestState } from '@minhaj/contracts/migration';

import {
  composeStagingReviewRunner,
  type StagingReviewRunner,
} from '../../apps/web/src/composition/staging-review-runner.ts';
import {
  approvedTarget,
  argument,
  CommandError,
  required,
  runCommand,
} from '../migration/cli.ts';
import {
  assertRightsPolicy,
  isFirstPartyMinhajHost,
  selectionConfirmation,
} from './policy.ts';

/**
 * THE RUNTIME HALF of the staging host review (Rebaseline R2;
 * OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP) — run ONLY as a child of the
 * owner-side command `staging-migration-review`
 * (`docker/staging/bin/migration-review.sh`), as the RUNTIME principal, whose
 * `DATABASE_URL` is the only database setting it holds. It performs, as the
 * named administrator, exactly the acts `/admin/migration` and
 * `/admin/editorial` offer for a completed run, through the SAME services:
 *
 *   status       --operator <id> (--run <runId> | --source <key>)
 *     What awaits each act, as counts and identifiers (`migration.read`;
 *     the Editorial queue under `content.read`, `denied` without it).
 *   approve-run  --run <runId> --operator <id> [--note <text>]
 *                [--confirm-count <n> --confirm-fingerprint <hex>]
 *     `migration.administer`. Without a confirmation: the run's counts and the
 *     size and fingerprint of its WHOLE approval set. With one: Migration's
 *     run-wide approval over exactly that set — its next slice, each revision
 *     through the single review's checks, the open-duplicate question asked
 *     again just before each, every one audited on its own.
 *   rights       --run <runId> --host <host> --operator <id>
 *                [--licence <l> --evidence <text> --rights-holder <text>
 *                 [--decide-non-first-party-host <host>]
 *                 --confirm-count <n> --confirm-fingerprint <hex>]
 *     `migration.administer`. Pictures by registered host, under the
 *     operator's explicit licence, evidence and holder and the standing rule
 *     in `./policy.ts` (first-party hosts, naming the R2 attestation).
 *   manifest     --run <runId> --operator <id> [--confirm-count <n> --confirm-fingerprint <hex>]
 *     `migration.administer`. A draft manifest over the next 100.
 *   publish      --manifest <id> --operator <id> [--session <id> --confirm-version <n>]
 *     Without a version: the manifest's state, version and entries. With one:
 *     Identity's gate mints the publisher for `migration.publish` with a live
 *     `migration-publication` step-up on that session, and Migration publishes
 *     the manifest through each target's own service.
 *   editorial    --kind <kind> --approver <id> [--confirm-count <n> --confirm-fingerprint <hex>]
 *     The first page of one kind's review queue (at most 25), confirmed by its
 *     size and fingerprint, approved and published by the SECOND
 *     administrator through Editorial's batch: both keys re-read live,
 *     self-approval refused, every transition audited on its own.
 *
 * Nothing here decides what a service decides; it reads arguments, applies
 * the host command's own rules (`./policy.ts`) before any service is asked,
 * and reports. The final stdout line is one JSON object of identifiers,
 * counts and reason codes — never a title, a payload, a token or a URL.
 */

const USAGE =
  'review-runtime status --operator <id> (--run <id> | --source <key>) | ' +
  'approve-run --run <id> --operator <id> [--note <text>] [--confirm-count <n> --confirm-fingerprint <hex>] | ' +
  'rights --run <id> --host <host> --operator <id> [--licence <l> --evidence <text> --rights-holder <text> [--decide-non-first-party-host <host>] --confirm-count <n> --confirm-fingerprint <hex>] | ' +
  'manifest --run <id> --operator <id> [--confirm-count <n> --confirm-fingerprint <hex>] | ' +
  'publish --manifest <id> --operator <id> [--session <id> --confirm-version <n>] | ' +
  'editorial --kind <kind> --approver <id> [--confirm-count <n> --confirm-fingerprint <hex>]';

/** An internal account or session identifier (the operator commands' shape). */
const ACCOUNT_ID = /^[A-Za-z0-9_-]{8,36}$/u;
/** A Migration identifier. */
const MIGRATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const SOURCE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const HOST = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/u;
const FINGERPRINT = /^[0-9a-f]{64}$/u;
const WHOLE = /^[1-9][0-9]{0,9}$/u;

function identifier(flag: string, shape: RegExp): string {
  const value = required(flag, USAGE);
  if (!shape.test(value))
    throw new CommandError(`${flag} is not a value of the expected shape`);
  return value;
}

function whole(flag: string): number {
  const value = required(flag, USAGE);
  if (!WHOLE.test(value))
    throw new CommandError(`${flag} must be a positive whole number`);
  return Number(value);
}

/** Both confirmation flags, or neither: a half confirmation is a refusal. */
function confirmation(): {
  readonly expectedCount: number;
  readonly fingerprint: string;
} | null {
  const count = argument('--confirm-count');
  const fingerprint = argument('--confirm-fingerprint');
  if (count === undefined && fingerprint === undefined) return null;
  if (count === undefined || fingerprint === undefined)
    throw new CommandError('--confirm-count and --confirm-fingerprint go together');
  return {
    expectedCount: whole('--confirm-count'),
    fingerprint: identifier('--confirm-fingerprint', FINGERPRINT),
  };
}

/** An Editorial refusal as its reason code — a category, never content. */
async function editorial<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    const candidate = error as { name?: unknown; reason?: unknown } | null;
    if (
      error instanceof Error &&
      error.constructor.name === 'EditorialRefusal' &&
      typeof candidate?.reason === 'string'
    )
      throw new CommandError(`editorial refusal: ${candidate.reason}`);
    if (candidate?.name === 'ZodError')
      throw new CommandError('editorial refusal: invalid');
    throw error;
  }
}

/* ===========================================================================
 * status
 * ========================================================================= */

/** Every live manifest of one run in `state`, paged through Migration's read. */
async function runManifests(
  runner: StagingReviewRunner,
  actor: { readonly accountId: string },
  runId: string,
  state: ManifestState,
) {
  const found: { id: string; version: number; state: ManifestState; entries: number }[] =
    [];
  for (let offset = 0; offset <= MIGRATION_LIMITS.maxOffset;) {
    const page = await runner.migration.read.manifests(actor, { state, offset });
    for (const row of page.rows) {
      if (row.runId !== runId) continue;
      const detail = await runner.migration.read.manifest(actor, row.id);
      found.push({
        id: row.id,
        version: row.version,
        state: row.state,
        entries: detail?.entries.length ?? 0,
      });
    }
    offset += page.rows.length;
    if (page.rows.length === 0 || offset >= page.total) break;
  }
  return found;
}

/** What awaits each Migration act for one run: counts and identifiers. */
async function runStatus(
  runner: StagingReviewRunner,
  actor: { readonly accountId: string },
  runId: string,
) {
  const { read } = runner.migration;
  const approval = await read.runApproval(actor, { runId, offset: 0 });
  if (approval === null) throw new CommandError('no run has that identifier');
  const { run, counts } = approval;
  const rights = await read.runRights(actor, { runId, host: null, offset: 0 });
  const manifest = await read.runManifest(actor, { runId });
  const [drafts, publishing] = await Promise.all([
    runManifests(runner, actor, runId, 'draft'),
    runManifests(runner, actor, runId, 'publishing'),
  ]);
  return {
    run: {
      id: run.id,
      source: run.sourceKey,
      state: run.state,
      reconciliation: run.reconciliation,
      actsAdmitted: run.state === 'completed' && run.reconciliation === 'balanced',
    },
    approve: counts,
    rights: (rights?.hosts ?? []).map((entry) => ({
      host: entry.host,
      role: entry.role,
      firstParty: isFirstPartyMinhajHost(entry.host),
      candidates: entry.candidates,
    })),
    manifest: { candidates: manifest.confirmation.count, next: manifest.next },
    publish: [...drafts, ...publishing],
  };
}

/** Each kind's in-review queue: the first page's size, and whether more wait. */
async function editorialQueues(
  runner: StagingReviewRunner,
  actor: { readonly accountId: string },
) {
  const queues: Record<string, { readonly firstPage: number; readonly more: boolean }> =
    {};
  try {
    for (const kind of editorialKindSchema.options) {
      const page = await runner.editorial.directory(actor, kind, 0, 'in-review');
      queues[kind] = { firstPage: page.items.length, more: page.more };
    }
  } catch (error) {
    if ((error as { reason?: unknown } | null)?.reason === 'denied') return 'denied';
    throw error;
  }
  return queues;
}

async function status(runner: StagingReviewRunner): Promise<Record<string, unknown>> {
  const operator = identifier('--operator', ACCOUNT_ID);
  const actor = { accountId: operator };
  const runId = argument('--run');
  const sourceKey = argument('--source');
  if ((runId === undefined) === (sourceKey === undefined))
    throw new CommandError('status takes exactly one of --run and --source');

  if (runId !== undefined) {
    identifier('--run', MIGRATION_ID);
    return {
      act: 'status',
      ...(await runStatus(runner, actor, runId)),
      editorial: await editorialQueues(runner, actor),
    };
  }

  const key = identifier('--source', SOURCE_KEY);
  const source = await runner.migration.sources.sourceByKey(actor, key);
  if (source === null) throw new CommandError('no source is registered under that key');
  // The newest page of the source's runs; a completed, balanced run's
  // awaiting counts beside it.
  const page = await runner.migration.read.runs(actor, { sourceId: source.id });
  const runs = [];
  for (const row of page.rows) {
    const admitted = row.state === 'completed' && row.reconciliation === 'balanced';
    if (!admitted) {
      runs.push({ id: row.id, state: row.state, reconciliation: row.reconciliation });
      continue;
    }
    const detail = await runStatus(runner, actor, row.id);
    runs.push({
      id: row.id,
      state: row.state,
      reconciliation: row.reconciliation,
      approve: detail.approve.candidates,
      rights: detail.rights.reduce((sum, entry) => sum + entry.candidates, 0),
      manifest: detail.manifest.candidates,
      publish: detail.publish.length,
    });
  }
  return {
    act: 'status',
    source: source.key,
    runs: { total: page.total, shown: runs.length, rows: runs },
    editorial: await editorialQueues(runner, actor),
  };
}

/* ===========================================================================
 * Migration's run-wide acts — `migration.administer`
 * ========================================================================= */

async function approveRun(runner: StagingReviewRunner): Promise<Record<string, unknown>> {
  const runId = identifier('--run', MIGRATION_ID);
  const actor = { accountId: identifier('--operator', ACCOUNT_ID) };
  const confirmed = confirmation();
  if (confirmed === null) {
    const view = await runner.migration.read.runApproval(actor, { runId, offset: 0 });
    if (view === null) throw new CommandError('no run has that identifier');
    return {
      act: 'approve-run',
      runId,
      counts: view.counts,
      confirmation: view.confirmation,
      slice: Math.min(view.confirmation.count, MIGRATION_LIMITS.runChunk),
    };
  }
  const outcome = await runner.migration.decisions.approveRun(actor, {
    runId,
    ...confirmed,
    note: argument('--note') ?? '',
  });
  return {
    act: 'approve-run',
    runId,
    decided: outcome.decided,
    refused: outcome.refused.map((item) => ({
      id: item.stagedRecordId,
      reason: item.reason,
    })),
    remaining: outcome.remaining,
  };
}

async function rights(runner: StagingReviewRunner): Promise<Record<string, unknown>> {
  const runId = identifier('--run', MIGRATION_ID);
  const host = identifier('--host', HOST);
  const actor = { accountId: identifier('--operator', ACCOUNT_ID) };
  const licence = argument('--licence');
  const licenceEvidence = argument('--evidence');
  const rightsHolder = argument('--rights-holder');
  const repeated = argument('--decide-non-first-party-host');
  const stated = [licence, licenceEvidence, rightsHolder].filter(
    (value) => value !== undefined,
  ).length;
  const confirmed = confirmation();
  if (confirmed !== null && stated !== 3)
    throw new CommandError(
      'a picture decision states --licence, --evidence and --rights-holder explicitly; nothing was decided',
    );
  if (stated !== 0 && stated !== 3)
    throw new CommandError('--licence, --evidence and --rights-holder go together');
  if (repeated !== undefined && stated === 0)
    throw new CommandError('--decide-non-first-party-host goes with a decision');

  // The standing rule first, before any service is asked.
  const policy =
    stated === 3
      ? assertRightsPolicy({
          host,
          licence: licence ?? '',
          licenceEvidence: licenceEvidence ?? '',
          rightsHolder: rightsHolder ?? '',
          nonFirstPartyHost: repeated ?? null,
        })
      : { firstParty: isFirstPartyMinhajHost(host) };

  if (confirmed === null) {
    const view = await runner.migration.read.runRights(actor, { runId, host, offset: 0 });
    if (view === null || view.confirmation === null)
      throw new CommandError('no run has that identifier');
    return {
      act: 'rights',
      runId,
      host,
      firstParty: policy.firstParty,
      confirmation: view.confirmation,
      slice: Math.min(view.confirmation.count, MIGRATION_LIMITS.runChunk),
    };
  }
  const outcome = await runner.migration.decisions.rightsRun(actor, {
    runId,
    ...confirmed,
    host,
    licence,
    licenceEvidence,
    rightsHolder,
  });
  return {
    act: 'rights',
    runId,
    host,
    firstParty: policy.firstParty,
    decided: outcome.decided,
    refused: outcome.refused.map((item) => ({
      id: item.provenanceId,
      reason: item.reason,
    })),
    remaining: outcome.remaining,
  };
}

async function manifest(runner: StagingReviewRunner): Promise<Record<string, unknown>> {
  const runId = identifier('--run', MIGRATION_ID);
  const actor = { accountId: identifier('--operator', ACCOUNT_ID) };
  const confirmed = confirmation();
  if (confirmed === null) {
    const view = await runner.migration.read.runManifest(actor, { runId });
    return { act: 'manifest', runId, confirmation: view.confirmation, next: view.next };
  }
  const created = await runner.migration.publication.createRunManifest(actor, {
    runId,
    ...confirmed,
  });
  const detail = await runner.migration.read.manifest(actor, created.id);
  return {
    act: 'manifest',
    runId,
    manifestId: created.id,
    state: created.state,
    version: created.version,
    entries: detail?.entries.length ?? 0,
  };
}

/* ===========================================================================
 * publish — `migration.publish` + a live `migration-publication` step-up
 * ========================================================================= */

async function publish(runner: StagingReviewRunner): Promise<Record<string, unknown>> {
  const manifestId = identifier('--manifest', MIGRATION_ID);
  const operator = identifier('--operator', ACCOUNT_ID);
  const version = argument('--confirm-version');
  if (version === undefined) {
    const found = await runner.migration.read.manifest(
      { accountId: operator },
      manifestId,
    );
    if (found === null) throw new CommandError('no manifest has that identifier');
    const entries: Record<string, number> = {};
    for (const entry of found.entries)
      entries[entry.state] = (entries[entry.state] ?? 0) + 1;
    return {
      act: 'publish',
      manifestId,
      runId: found.manifest.runId,
      state: found.manifest.state,
      version: found.manifest.version,
      entries,
    };
  }
  const expectedVersion = whole('--confirm-version');
  const sessionId = identifier('--session', ACCOUNT_ID);
  const actor = await runner.publisher({ accountId: operator, sessionId });
  if (actor === null)
    throw new CommandError(
      'the operator does not hold migration.publish with a live migration-publication step-up on that session',
    );
  const summary = await runner.migration.publication.publish(actor, {
    manifestId,
    expectedVersion,
  });
  return {
    act: 'publish',
    manifestId,
    state: summary.state,
    published: summary.done,
    refused: summary.refused,
    stopped: summary.stopped,
  };
}

/* ===========================================================================
 * editorial — the second administrator, `content.review` + `content.publish`
 * ========================================================================= */

async function editorialBatch(
  runner: StagingReviewRunner,
): Promise<Record<string, unknown>> {
  const parsed = editorialKindSchema.safeParse(required('--kind', USAGE));
  if (!parsed.success) throw new CommandError('--kind is not an Editorial kind');
  const kind: EditorialKind = parsed.data;
  const approver = { accountId: identifier('--approver', ACCOUNT_ID) };
  const confirmed = confirmation();

  // The first page of the queue — at most one batch, exactly what the queue
  // page shows a second administrator.
  const page = await editorial(
    runner.editorial.directory(approver, kind, 0, 'in-review'),
  );
  const selection = page.items
    .slice(0, EDITORIAL_BATCH_LIMIT)
    .map((item) => ({ id: item.id, version: item.version }));
  const shown = selectionConfirmation(selection);
  if (confirmed === null)
    return { act: 'editorial', kind, confirmation: shown, more: page.more };
  if (
    confirmed.expectedCount !== shown.count ||
    confirmed.fingerprint !== shown.fingerprint
  )
    throw new CommandError(
      'editorial refusal: conflict (the queue page moved since it was shown); nothing was decided',
    );
  const outcome = await editorial(
    runner.editorial.approveAndPublishMany(approver, {
      kind,
      items: selection.map((item) => ({ id: item.id, expectedVersion: item.version })),
    }),
  );
  return {
    act: 'editorial',
    kind,
    decided: outcome.decided,
    refused: outcome.refused,
  };
}

await runCommand('review:runtime', async () => {
  const [act] = process.argv.slice(2);
  approvedTarget(process.env['DATABASE_URL']);
  let runner: StagingReviewRunner;
  try {
    runner = composeStagingReviewRunner();
  } catch (error) {
    if ((error as { name?: unknown } | null)?.name === 'StagingReviewPostureRefusal')
      throw new CommandError((error as Error).message);
    throw error;
  }
  if (act === 'status') return status(runner);
  if (act === 'approve-run') return approveRun(runner);
  if (act === 'rights') return rights(runner);
  if (act === 'manifest') return manifest(runner);
  if (act === 'publish') return publish(runner);
  if (act === 'editorial') return editorialBatch(runner);
  throw new CommandError(`usage: ${USAGE}`);
});
