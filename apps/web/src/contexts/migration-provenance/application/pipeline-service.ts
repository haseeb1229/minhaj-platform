import 'server-only';

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  MIGRATION_LIMITS,
  authorisedScopeIsReal,
  canonicalSourceUrl,
  fixtureScopeIsSynthetic,
  migrationIdSchema,
  migrationVersionSchema,
  type AssetLicence,
  type DiscoveredItem,
  type DuplicateInput,
  type ErrorClassification,
  type ErrorInput,
  type ErrorStage,
  type FetchOutcome,
  type MigrationActor,
  type MigrationAssetStoragePort,
  type MigrationAuthorityPort,
  type MigrationFetchPort,
  type MigrationPipelinePort,
  type MigrationSourceAdapter,
  type MigrationSourcePort,
  type ParseResult,
  type PendingItem,
  type PublicImageCopy,
  type RetrievedEvidence,
  type RunCounts,
  type RunRecord,
  type SourceRecord,
  type TransformProvenance,
} from '@minhaj/contracts/migration';

import { normaliseRecord, recordHrefs, type Normalisation } from '../domain/kinds.ts';
import {
  detectPersonalData,
  NORMALIZER_VERSION,
  normalizeTitle,
} from '../domain/normalize.ts';
import {
  internalDigests,
  rewriteHref,
  stageLinks,
  type LinkScope,
  type MappingLookup,
} from '../domain/links.ts';
import {
  reconcile,
  reconciliationDetail,
  type Reconciliation,
} from '../domain/reconciliation.ts';
import { MigrationRefusal } from '../domain/refusal.ts';
import {
  classifyOutcome,
  classifyStatus,
  isRetryEligible,
  isSuccessStatus,
  retryDecision,
  type FailureClass,
} from '../domain/retry.ts';
import { crossLanguage } from '../domain/video.ts';
import {
  ADMINISTER,
  clip,
  createGate,
  guarded,
  safeDetail,
  sha256Hex,
} from './shared.ts';

/* ===========================================================================
 * Inputs
 * ========================================================================= */

/** How one invocation runs. Every clock, wait and random draw is injectable. */
export interface PipelineRunOptions {
  /** Items per checkpoint batch, at most `MIGRATION_LIMITS.batch` (default). */
  readonly batchSize?: number;
  /** Stop after this many items, leaving the run open to be resumed. */
  readonly maxItems?: number | null;
  /** How long one lease lasts; renewed every batch. Default 120 s. */
  readonly leaseMs?: number;
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly random?: () => number;
  /** The deployed commit (`MINHAJ_RELEASE_SHA`) or `local` (default). */
  readonly codeRevision?: string;
  /**
   * Phase 30-R. REPLAY the source's RETAINED evidence instead of the network:
   * discovery lists the records this source already holds, and each item is
   * parsed again from its body-intact raw snapshot by the current code — no
   * page is fetched. A record whose evidence was disposed of is fetched as
   * usual. Images a replayed record names are still acquired, once per URL.
   */
  readonly replay?: boolean;
}

export interface PipelineRunInput {
  readonly sourceId: string;
  /** The source's adapter — discovery, retrieval and parsing, nothing else. */
  readonly adapter: MigrationSourceAdapter;
  /** The safe fetch boundary bound to the source's PAGE hosts. */
  readonly fetcher: MigrationFetchPort;
  /**
   * Phase 30-R. The safe fetch boundary bound to the source's page AND asset
   * hosts, used only to acquire images. Defaults to `fetcher`.
   */
  readonly assetFetcher?: MigrationFetchPort;
  /** Storage, narrowed to acquisition. */
  readonly assets: MigrationAssetStoragePort;
  readonly options?: PipelineRunOptions;
}

export interface PipelineRunSummary {
  readonly runId: string;
  readonly resumed: boolean;
  /** `interrupted`: the run stays open (stopped early, deferred items, or a discovery failure). */
  readonly state: 'completed' | 'interrupted';
  /** Items this invocation processed. */
  readonly processed: number;
  readonly counts: RunCounts;
  /** The verdict, when the run completed. */
  readonly reconciliation: Reconciliation | null;
  /** Records this complete discovery did not see, now marked `missing`. */
  readonly missing: number;
}

const optionsSchema = z.looseObject({
  batchSize: z.number().int().min(1).max(MIGRATION_LIMITS.batch).optional(),
  maxItems: z.number().int().min(1).max(1_000_000).nullable().optional(),
  leaseMs: z.number().int().min(10_000).max(3_600_000).optional(),
  codeRevision: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/)
    .optional(),
  replay: z.boolean().optional(),
});

const adapterSchema = z.object({
  adapterKey: z.string().min(1).max(64),
  adapterVersion: z.string().min(1).max(32),
  parserKey: z.string().min(1).max(64),
  parserVersion: z.string().min(1).max(32),
});

const fetcherSchema = z.object({
  fetcherKey: z.string().min(1).max(64),
  fetcherVersion: z.string().min(1).max(32),
});

const cancelSchema = z
  .object({ runId: migrationIdSchema, expectedVersion: migrationVersionSchema })
  .strict();

/* ===========================================================================
 * Small helpers
 * ========================================================================= */

const DEFAULT_LEASE_MS = 120_000;

/** Records one replay discovery page lists (Phase 30-R). */
const REPLAY_PAGE = 100;

/** The still-image types an acquisition gets a public copy of (Phase 30-R). */
const STILL_IMAGE_TYPES: readonly string[] = Object.freeze(['image/jpeg', 'image/png']);

/** Digests per mapping lookup, and duplicate candidates considered per signal. */
const LOOKUP_CHUNK = 200;
const MATCH_LIMIT = 10;
const HEADERS_MAX = 4000;

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * The safe fetch boundaries, made polite: `minIntervalMs` between ANY two
 * requests of one run, whichever boundary — page or asset — makes them.
 */
function politeFetchers(
  fetchers: { readonly page: MigrationFetchPort; readonly asset: MigrationFetchPort },
  minIntervalMs: number,
  now: () => Date,
  sleep: (ms: number) => Promise<void>,
): { readonly page: MigrationFetchPort; readonly asset: MigrationFetchPort } {
  let last: number | null = null;
  const polite = (fetcher: MigrationFetchPort): MigrationFetchPort => ({
    fetcherKey: fetcher.fetcherKey,
    fetcherVersion: fetcher.fetcherVersion,
    async fetch(url) {
      if (last !== null) {
        const wait = last + minIntervalMs - now().getTime();
        if (wait > 0) await sleep(wait);
      }
      try {
        return await fetcher.fetch(url);
      } finally {
        last = now().getTime();
      }
    },
  });
  return { page: polite(fetchers.page), asset: polite(fetchers.asset) };
}

function headerValue(
  headers: Readonly<Record<string, string>>,
  name: string,
): string | null {
  for (const [key, value] of Object.entries(headers))
    if (key.toLowerCase() === name) return value;
  return null;
}

/** The allowlisted provenance headers as a bounded JSON object. */
function headersJson(headers: Readonly<Record<string, string>>): string | null {
  const entries = Object.entries(headers)
    .map(([key, value]) => [key.toLowerCase().slice(0, 64), clip(value, 500)] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  let kept: Record<string, string> = {};
  for (const [key, value] of entries) {
    const next = { ...kept, [key]: value };
    if (JSON.stringify(next).length > HEADERS_MAX) break;
    kept = next;
  }
  return Object.keys(kept).length === 0 ? null : JSON.stringify(kept);
}

function outcomeDetail(outcome: FetchOutcome): string | null {
  return outcome.kind === 'response'
    ? `HTTP ${outcome.status}`
    : safeDetail(outcome.detail);
}

function validDiscovered(item: DiscoveredItem): boolean {
  return (
    typeof item.externalKey === 'string' &&
    item.externalKey.length >= 1 &&
    item.externalKey.length <= MIGRATION_LIMITS.externalKey &&
    (item.originalUrl === null ||
      (typeof item.originalUrl === 'string' &&
        item.originalUrl.length <= MIGRATION_LIMITS.url)) &&
    (item.legacyIdentifier === null ||
      (typeof item.legacyIdentifier === 'string' && item.legacyIdentifier.length <= 200))
  );
}

function sameCode(run: RunRecord, provenance: TransformProvenance): boolean {
  return (
    run.provenance.adapterKey === provenance.adapterKey &&
    run.provenance.adapterVersion === provenance.adapterVersion &&
    run.provenance.parserKey === provenance.parserKey &&
    run.provenance.parserVersion === provenance.parserVersion &&
    run.provenance.normalizerVersion === provenance.normalizerVersion
  );
}

/* ===========================================================================
 * The service
 * ========================================================================= */

/**
 * The PIPELINE (MIGRATION_STRATEGY.md §4): discover → fetch → preserve raw →
 * parse → extract links → normalise → validate → map topics → acquire assets
 * → stage → reconcile, for ONE source, in bounded, checkpointed, resumable
 * batches. A FIXTURE source runs only inside `*.fixture.invalid`; an
 * AUTHORISED source (Phase 30) only inside its recorded real `https` scope —
 * and the fetcher the caller hands in is bound to that scope as well.
 *
 * SEQUENTIAL BY DESIGN. One item at a time, one checkpoint per batch, never a
 * `Promise.all` over a source: memory stays bounded and an interruption costs
 * at most one item, which the next invocation resumes from the database.
 *
 * Dependencies (ports only):
 *  - `pipeline`  — `MigrationPipelinePort`, Migration's own persistence;
 *  - `sources`   — `MigrationSourcePort` (`source` only);
 *  - `authority` — `MigrationAuthorityPort`, Identity's live answer;
 *  - `ids`, `clock` — injectable for tests.
 * The adapter, the fetch boundary and asset storage are handed to each `run`.
 */
export function createMigrationPipelineService(deps: {
  readonly pipeline: MigrationPipelinePort;
  readonly sources: Pick<MigrationSourcePort, 'source'>;
  readonly authority: MigrationAuthorityPort;
  readonly ids?: () => string;
  readonly clock?: () => Date;
}) {
  const ids = deps.ids ?? randomUUID;
  const gate = createGate(deps.authority);
  const pipeline = deps.pipeline;

  return {
    /**
     * Runs — or resumes — the source's one open run under `migration.administer`.
     * Refuses a fixture source whose scope leaves `*.fixture.invalid`, or an
     * authorised source whose scope is not a real `https` one (`unsafe-scope`);
     * an authorised source without its written authorisation reference and
     * date (`real-source-not-authorised`); an inactive source; an
     * adapter of another kind or access method — or of other code than the
     * open run it would resume (`adapter-mismatch`) — and a live lease held
     * by someone else (`run-busy`).
     */
    async run(
      actor: MigrationActor,
      input: PipelineRunInput,
    ): Promise<PipelineRunSummary> {
      const actorId = await gate.holds(actor, ADMINISTER);
      const parsedOptions = optionsSchema.safeParse(input?.options ?? {});
      if (!parsedOptions.success || !migrationIdSchema.safeParse(input?.sourceId).success)
        throw new MigrationRefusal('invalid');
      const options = input.options ?? {};
      const batchSize = parsedOptions.data.batchSize ?? MIGRATION_LIMITS.batch;
      const maxItems = parsedOptions.data.maxItems ?? null;
      const leaseMs = parsedOptions.data.leaseMs ?? DEFAULT_LEASE_MS;
      const now = options.now ?? deps.clock ?? (() => new Date());
      const sleep = options.sleep ?? defaultSleep;
      const random = options.random ?? Math.random;
      const { adapter } = input;
      if (
        !adapterSchema.safeParse(adapter).success ||
        !fetcherSchema.safeParse(input.fetcher).success ||
        (input.assetFetcher !== undefined &&
          !fetcherSchema.safeParse(input.assetFetcher).success)
      )
        throw new MigrationRefusal('invalid');

      const source = await guarded(deps.sources.source(input.sourceId));
      if (source === null) throw new MigrationRefusal('not-found');
      if (source.authorityKind === 'fixture') {
        if (!fixtureScopeIsSynthetic(source.baseUrl, source.hosts))
          throw new MigrationRefusal('unsafe-scope');
      } else {
        // The database CHECK already binds an authorised source to its written
        // reference and date; this answers helpfully before any request.
        if (source.authorisationReference === null || source.authorisedOn === null)
          throw new MigrationRefusal('real-source-not-authorised');
        if (
          source.accessMethod === 'http'
            ? !authorisedScopeIsReal(source.baseUrl, source.hosts)
            : source.baseUrl !== null || source.hosts.length > 0
        )
          throw new MigrationRefusal('unsafe-scope');
      }
      if (source.state !== 'active') throw new MigrationRefusal('source-inactive');
      if (
        adapter.contentKind !== source.contentKind ||
        adapter.accessMethod !== source.accessMethod
      )
        throw new MigrationRefusal('adapter-mismatch');

      const provenance: TransformProvenance = {
        adapterKey: adapter.adapterKey,
        adapterVersion: adapter.adapterVersion,
        parserKey: adapter.parserKey,
        parserVersion: adapter.parserVersion,
        normalizerVersion: NORMALIZER_VERSION,
        codeRevision: parsedOptions.data.codeRevision ?? 'local',
      };
      const leaseToken = ids();
      const leaseUntil = () => new Date(now().getTime() + leaseMs);
      const opened = await guarded(
        pipeline.openRun({
          sourceId: source.id,
          operatorUserId: actorId,
          provenance,
          runId: ids(),
          leaseToken,
          leaseUntil: leaseUntil(),
          now: now(),
        }),
      );
      const run = opened.run;
      // A resumed run keeps the code it started with: one run, one provenance.
      if (!sameCode(run, provenance)) throw new MigrationRefusal('adapter-mismatch');

      const fetchers = politeFetchers(
        { page: input.fetcher, asset: input.assetFetcher ?? input.fetcher },
        source.policy.minIntervalMs,
        now,
        sleep,
      );
      const worker = new RunWorker({
        pipeline,
        source,
        run,
        adapter,
        fetcher: fetchers.page,
        assetFetcher: fetchers.asset,
        replay: parsedOptions.data.replay === true,
        assets: input.assets,
        provenance,
        leaseToken,
        leaseUntil,
        now,
        sleep,
        random,
      });

      const summary = (
        state: PipelineRunSummary['state'],
        processed: number,
        counts: RunCounts,
        reconciliation: Reconciliation | null,
        missing: number,
      ): PipelineRunSummary => ({
        runId: run.id,
        resumed: opened.resumed,
        state,
        processed,
        counts,
        reconciliation,
        missing,
      });

      const discovered = await worker.discover(batchSize);
      const processed = discovered ? await worker.process(batchSize, maxItems) : 0;
      const counts = await guarded(pipeline.reconciliationCounts(run.id));
      if (!discovered || counts.pending > 0) {
        // A deliberate stop releases the lease (it ends now), so the next
        // invocation resumes at once instead of waiting for it to lapse.
        await guarded(pipeline.renewLease(run.id, leaseToken, now()));
        return summary('interrupted', processed, counts, null, 0);
      }

      const verdict = reconcile(counts);
      const completed = await guarded(
        pipeline.completeRun({
          runId: run.id,
          leaseToken,
          reconciliation: verdict.balanced ? 'balanced' : 'unbalanced',
          detail: reconciliationDetail(counts),
          now: now(),
        }),
      );
      return summary('completed', processed, counts, verdict, completed.missing);
    },

    /** An operator cancels an open run, at the version they saw. */
    async cancel(actor: MigrationActor, input: unknown): Promise<void> {
      const { actorId, value } = await gate.authorised(
        actor,
        ADMINISTER,
        cancelSchema,
        input,
      );
      await guarded(
        pipeline.cancelRun({
          runId: value.runId,
          expectedVersion: value.expectedVersion,
          actorId,
          now: (deps.clock ?? (() => new Date()))(),
        }),
      );
    },
  };
}

export type MigrationPipelineService = ReturnType<typeof createMigrationPipelineService>;

/* ===========================================================================
 * One invocation's work
 * ========================================================================= */

type Evidence = Extract<RetrievedEvidence, { kind: 'evidence' }>;

interface RunWorkerContext {
  readonly pipeline: MigrationPipelinePort;
  readonly source: SourceRecord;
  readonly run: RunRecord;
  readonly adapter: MigrationSourceAdapter;
  readonly fetcher: MigrationFetchPort;
  readonly assetFetcher: MigrationFetchPort;
  /** Phase 30-R: parse retained evidence again instead of fetching. */
  readonly replay: boolean;
  readonly assets: MigrationAssetStoragePort;
  readonly provenance: TransformProvenance;
  readonly leaseToken: string;
  readonly leaseUntil: () => Date;
  readonly now: () => Date;
  readonly sleep: (ms: number) => Promise<void>;
  readonly random: () => number;
}

class RunWorker {
  private readonly c: RunWorkerContext;

  constructor(c: RunWorkerContext) {
    this.c = c;
  }

  private async renew(): Promise<void> {
    const held = await guarded(
      this.c.pipeline.renewLease(this.c.run.id, this.c.leaseToken, this.c.leaseUntil()),
    );
    if (!held) throw new MigrationRefusal('lease-lost');
  }

  private async error(
    itemId: string | null,
    recordId: string | null,
    stage: ErrorStage,
    failure: {
      readonly classification: ErrorClassification;
      readonly httpStatus: number | null;
    },
    attempt: number,
    detail: string | null,
  ): Promise<void> {
    const input: ErrorInput & { readonly itemId: string | null } = {
      itemId,
      sourceId: this.c.source.id,
      runId: this.c.run.id,
      recordId,
      stage,
      classification: failure.classification,
      retryEligible: isRetryEligible(failure.classification),
      httpStatus: failure.httpStatus,
      attempt: Math.max(1, Math.min(attempt, 100)),
      detail: safeDetail(detail),
      occurredAt: this.c.now(),
    };
    await guarded(this.c.pipeline.recordError(input));
  }

  /**
   * DISCOVERY, page by page from the run's stored cursor. Each page is
   * recorded in checkpoints of at most `batchSize` items; the cursor advances
   * only with a page's last checkpoint, so a crash re-records (a no-op) rather
   * than skips. False when discovery stopped short (a recorded failure).
   */
  async discover(batchSize: number): Promise<boolean> {
    let cursor = this.c.run.discoveryCursor;
    let complete = this.c.run.discoveryComplete;
    let attempt = 0;
    while (!complete) {
      await this.renew();
      attempt += 1;
      let page: Awaited<ReturnType<MigrationSourceAdapter['discover']>>;
      try {
        page = this.c.replay
          ? await guarded(
              this.c.pipeline.replayItems(this.c.source.id, cursor, REPLAY_PAGE),
            )
          : await this.c.adapter.discover(cursor, this.c.fetcher);
      } catch {
        page = {
          kind: 'outcome',
          outcome: {
            kind: 'failure',
            classification: 'network',
            requestedUrl: '',
            detail: 'discovery failed',
          },
        };
      }
      if (page.kind === 'outcome') {
        const failure = classifyOutcome(page.outcome);
        const decision = retryDecision({
          failure,
          attempt,
          maxAttempts: this.c.source.policy.maxAttempts,
          retryAfter: page.outcome.kind === 'response' ? page.outcome.retryAfter : null,
          now: this.c.now(),
          random: this.c.random,
        });
        if (decision.kind === 'wait') {
          await this.c.sleep(decision.ms);
          continue;
        }
        await this.error(
          null,
          null,
          'discover',
          failure,
          attempt,
          outcomeDetail(page.outcome),
        );
        return false;
      }
      attempt = 0;
      if (page.next !== null && page.next === cursor) {
        // A page that does not advance would loop forever: an adapter defect.
        await this.error(
          null,
          null,
          'discover',
          { classification: 'parse-failed', httpStatus: null },
          1,
          'discovery cursor did not advance',
        );
        return false;
      }
      const items = page.items.filter(validDiscovered);
      if (items.length !== page.items.length)
        await this.error(
          null,
          null,
          'discover',
          { classification: 'validation-failed', httpStatus: null },
          1,
          `${page.items.length - items.length} discovered item(s) out of bounds`,
        );
      const chunks: DiscoveredItem[][] = [];
      for (let index = 0; index < items.length; index += batchSize)
        chunks.push(items.slice(index, index + batchSize));
      if (chunks.length === 0) chunks.push([]);
      for (const [index, chunk] of chunks.entries()) {
        const last = index === chunks.length - 1;
        if (index > 0) await this.renew();
        await guarded(
          this.c.pipeline.recordDiscovery({
            runId: this.c.run.id,
            leaseToken: this.c.leaseToken,
            items: chunk,
            nextCursor: last ? page.next : cursor,
            complete: last && page.next === null,
            now: this.c.now(),
          }),
        );
      }
      cursor = page.next;
      complete = page.next === null;
    }
    return true;
  }

  /** PROCESSING: due pending items in bounded batches. Returns how many were processed. */
  async process(batchSize: number, maxItems: number | null): Promise<number> {
    let processed = 0;
    const seen = new Set<string>();
    while (maxItems === null || processed < maxItems) {
      await this.renew();
      const limit =
        maxItems === null ? batchSize : Math.min(batchSize, maxItems - processed);
      const batch = await guarded(
        this.c.pipeline.pendingItems(this.c.run.id, limit, this.c.now()),
      );
      const fresh = batch.filter((item) => !seen.has(item.itemId));
      if (fresh.length === 0) break;
      for (const item of fresh) {
        seen.add(item.itemId);
        await this.item(item);
        processed += 1;
      }
    }
    return processed;
  }

  /** Retrieval with the retry policy. `null` when the item was errored or deferred. */
  private async retrieve(
    item: PendingItem,
  ): Promise<{ readonly evidence: Evidence; readonly attempt: number } | null> {
    let attempt = item.attempts;
    for (;;) {
      attempt += 1;
      let got: RetrievedEvidence;
      try {
        got = await this.c.adapter.retrieve(item, this.c.fetcher);
      } catch {
        got = {
          kind: 'outcome',
          outcome: {
            kind: 'failure',
            classification: 'network',
            requestedUrl: item.externalKey,
            detail: 'retrieval failed',
          },
        };
      }
      if (
        got.kind === 'evidence' &&
        (got.httpStatus === null || isSuccessStatus(got.httpStatus))
      )
        return { evidence: got, attempt };

      let failure: FailureClass;
      let retryAfter: string | null;
      let detail: string | null;
      if (got.kind === 'evidence') {
        failure = classifyStatus(got.httpStatus ?? 0);
        retryAfter = headerValue(got.headers, 'retry-after');
        detail = `HTTP ${got.httpStatus}`;
      } else {
        failure = classifyOutcome(got.outcome);
        retryAfter = got.outcome.kind === 'response' ? got.outcome.retryAfter : null;
        detail = outcomeDetail(got.outcome);
      }
      const decision = retryDecision({
        failure,
        attempt,
        maxAttempts: this.c.source.policy.maxAttempts,
        retryAfter,
        now: this.c.now(),
        random: this.c.random,
      });
      if (decision.kind === 'wait') {
        // The attempt is counted durably BEFORE waiting, so a crash mid-wait
        // cannot reset the item's budget.
        await guarded(
          this.c.pipeline.scheduleRetry(
            item.itemId,
            attempt,
            new Date(this.c.now().getTime() + decision.ms),
          ),
        );
        await this.c.sleep(decision.ms);
        continue;
      }
      if (decision.kind === 'defer') {
        await guarded(
          this.c.pipeline.scheduleRetry(item.itemId, attempt, decision.until),
        );
        return null;
      }
      await this.error(item.itemId, item.recordId, 'fetch', failure, attempt, detail);
      return null;
    }
  }

  private async item(item: PendingItem): Promise<void> {
    const { pipeline, source } = this.c;
    // REPLAY reads the record's retained evidence; a disposed body is fetched.
    const retained =
      this.c.replay && item.latestSnapshot !== null
        ? await guarded(pipeline.retainedSnapshot(item.latestSnapshot.id))
        : null;
    const retrieved =
      retained === null
        ? await this.retrieve(item)
        : {
            evidence: { kind: 'evidence' as const, ...retained },
            attempt: item.attempts + 1,
          };
    if (retrieved === null) return;
    const { evidence, attempt } = retrieved;
    const body = evidence.body;
    if (body.byteLength > source.policy.maxBodyBytes) {
      await this.error(
        item.itemId,
        item.recordId,
        'fetch',
        { classification: 'too-large', httpStatus: evidence.httpStatus },
        attempt,
        'body exceeds the source policy',
      );
      return;
    }

    // UNCHANGED: exactly the bytes the current revision was made from, read by
    // exactly the code that made it. Newer parsing or normalisation of the same
    // bytes is a new revision (Phase 30-R) — how retained evidence is re-read.
    const checksum = sha256Hex(body);
    if (
      item.currentStaged !== null &&
      item.currentStaged.inputChecksum === checksum &&
      item.currentStaged.parserVersion === this.c.provenance.parserVersion &&
      item.currentStaged.normalizerVersion === this.c.provenance.normalizerVersion
    ) {
      await guarded(pipeline.markUnchanged(item.itemId, this.c.now()));
      return;
    }

    // PRESERVE RAW before anything interprets it (§4.3).
    const decoded = new TextDecoder('utf-8', { fatal: false }).decode(body);
    const snapshot = await guarded(
      pipeline.storeSnapshot({
        sourceId: source.id,
        runId: this.c.run.id,
        itemId: item.itemId,
        recordId: item.recordId,
        requestedUrl: clip(evidence.requestedUrl, MIGRATION_LIMITS.url),
        finalUrl: clip(evidence.finalUrl, MIGRATION_LIMITS.url),
        httpStatus: evidence.httpStatus,
        contentType:
          evidence.contentType === null ? null : clip(evidence.contentType, 200),
        headers: headersJson(evidence.headers),
        body,
        checksum,
        fetchedAt: this.c.now(),
        fetcherKey: this.c.fetcher.fetcherKey,
        fetcherVersion: this.c.fetcher.fetcherVersion,
        personalData: detectPersonalData(decoded).flagged ? 'flagged' : 'none',
      }),
    );

    let parsed: ParseResult;
    try {
      parsed = this.c.adapter.parse({
        body,
        contentType: evidence.contentType,
        finalUrl: evidence.finalUrl,
      });
    } catch {
      parsed = { kind: 'failed', detail: 'the parser raised' };
    }
    if (parsed.kind === 'excluded') {
      await guarded(pipeline.markExcluded(item.itemId, this.c.now()));
      return;
    }
    if (parsed.kind === 'failed' || parsed.record.kind !== source.contentKind) {
      await this.error(
        item.itemId,
        item.recordId,
        'parse',
        { classification: 'parse-failed', httpStatus: evidence.httpStatus },
        attempt,
        parsed.kind === 'failed' ? parsed.detail : 'parsed another content kind',
      );
      return;
    }
    const record = parsed.record;

    // LINKS: every href the record carries, judged against the source's hosts.
    const scope: LinkScope = { baseUrl: evidence.finalUrl, hosts: source.hosts };
    let hrefs: string[];
    try {
      hrefs = recordHrefs(record);
    } catch {
      await this.error(
        item.itemId,
        item.recordId,
        'normalize',
        { classification: 'parse-failed', httpStatus: null },
        attempt,
        'links could not be extracted',
      );
      return;
    }
    const digests = internalDigests(hrefs, scope);
    const mappings = new Map<
      string,
      { readonly id: string; readonly canonicalPath: string }
    >();
    for (let index = 0; index < digests.length; index += LOOKUP_CHUNK) {
      const found = await guarded(
        pipeline.activeMappings(source.id, digests.slice(index, index + LOOKUP_CHUNK)),
      );
      for (const [digest, mapping] of found) mappings.set(digest, mapping);
    }
    const lookup: MappingLookup = mappings;

    // NORMALISE AND VALIDATE — sanitised before anything is staged.
    let normal: Normalisation;
    try {
      normal = normaliseRecord({
        parsed: record,
        defaultLanguageCode: source.defaultLanguageCode,
        legacyIdentifier: item.legacyIdentifier,
        externalKey: item.externalKey,
        rewrite: (href) => rewriteHref(href, scope, lookup),
        now: this.c.now(),
      });
    } catch {
      await this.error(
        item.itemId,
        item.recordId,
        'normalize',
        { classification: 'parse-failed', httpStatus: null },
        attempt,
        'normalisation failed',
      );
      return;
    }
    const links = stageLinks(hrefs, scope, lookup);
    const issues = [...normal.issues];
    let payload = JSON.stringify(normal.payload);
    if (payload.length > MIGRATION_LIMITS.payload) {
      // An oversize payload is stored as a stub naming its kind — the revision
      // is rejected anyway, and the snapshot keeps every byte.
      if (!issues.includes('body-too-long')) issues.push('body-too-long');
      payload = JSON.stringify({ kind: normal.kind, oversize: true });
    }
    const valid = issues.length === 0;

    // TOPICS: the record's categories, each mapped (or surfaced) per source.
    const categories: { key: string; label: string }[] = [];
    for (const category of record.categories) {
      if (categories.length >= MIGRATION_LIMITS.categories) break;
      const key = clip(normalizeTitle(category.key), 200);
      if (key.length === 0 || categories.some((known) => known.key === key)) continue;
      const label = clip(normalizeTitle(category.label), 200);
      categories.push({ key, label: label.length > 0 ? label : key });
    }

    // DUPLICATES: a hard identity collapses; a folded title only asks a person.
    const duplicates: DuplicateInput[] = [];
    const identity = normal.identity;
    if (identity !== null) {
      const matches = await guarded(pipeline.dedupeMatches(identity.key, item.recordId));
      let collapsed = false;
      for (const match of matches.slice(0, MATCH_LIMIT)) {
        const cross = crossLanguage(normal.languageCode, match.languageCode);
        // The FIRST staging of a record collapses it into the earliest record
        // already carrying the identity (the port answers in creation order);
        // a record that already has revisions is never collapsed by a re-stage,
        // and a cross-language or invalid pair is only ever a candidate.
        const collapse =
          identity.hard && !collapsed && !cross && valid && item.currentStaged === null;
        if (collapse) collapsed = true;
        duplicates.push({
          otherRecordId: match.recordId,
          signal: identity.signal,
          score: 100,
          crossLanguage: cross,
          collapse,
        });
      }
    }
    if (normal.titleKey.length > 0) {
      const matches = await guarded(
        pipeline.titleMatches(
          source.contentKind,
          normal.titleKey,
          item.recordId,
          MATCH_LIMIT,
        ),
      );
      for (const match of matches) {
        if (duplicates.some((known) => known.otherRecordId === match.recordId)) continue;
        duplicates.push({
          otherRecordId: match.recordId,
          signal: 'title-similarity',
          score: 100,
          crossLanguage: crossLanguage(normal.languageCode, match.languageCode),
          collapse: false,
        });
      }
    }

    // ASSETS: a failure is recorded against the record but never blocks staging.
    for (const asset of record.assets.slice(0, MIGRATION_LIMITS.assets))
      await this.acquire(item, evidence.finalUrl, asset);

    const producedAt = this.c.now();
    await guarded(
      pipeline.stage({
        sourceId: source.id,
        runId: this.c.run.id,
        itemId: item.itemId,
        recordId: item.recordId,
        snapshotId: snapshot.snapshotId,
        contentKind: source.contentKind,
        title: normal.title,
        titleKey: normal.titleKey,
        dedupeKey: identity?.key ?? null,
        languageCode: normal.languageCode,
        payload,
        payloadChecksum: sha256Hex(payload),
        provenance: this.c.provenance,
        inputChecksum: checksum,
        producedAt,
        validation: valid ? 'valid' : 'invalid',
        issues,
        personalData: normal.personalData ? 'flagged' : 'none',
        categories,
        links,
        duplicates,
        outcome: valid ? 'staged' : 'rejected',
        error: valid
          ? null
          : {
              sourceId: source.id,
              runId: this.c.run.id,
              recordId: item.recordId,
              stage: 'validate',
              classification: 'validation-failed',
              retryEligible: false,
              httpStatus: null,
              attempt,
              detail: issues.join(','),
              occurredAt: producedAt,
            },
      }),
    );
  }

  /** One authorised asset: fetched within scope, stored once per byte content, provenance per acquisition. */
  private async acquire(
    item: PendingItem,
    baseUrl: string,
    asset: {
      readonly url: string;
      readonly licence: AssetLicence;
      readonly licenceEvidence: string | null;
      readonly rightsHolder: string | null;
    },
  ): Promise<void> {
    const failed = (
      classification: ErrorClassification,
      detail: string,
      httpStatus: number | null = null,
      attempt = 1,
    ) =>
      this.error(
        null,
        item.recordId,
        'asset',
        { classification, httpStatus },
        attempt,
        detail,
      );

    let url: URL;
    try {
      url = new URL(asset.url, baseUrl);
    } catch {
      await failed('asset-rejected', 'asset URL malformed');
      return;
    }
    if (
      (url.protocol !== 'http:' && url.protocol !== 'https:') ||
      url.username !== '' ||
      url.password !== ''
    ) {
      await failed('asset-rejected', 'asset URL refused');
      return;
    }
    const canonical = canonicalSourceUrl(url);
    if (canonical.length > MIGRATION_LIMITS.url) {
      await failed('asset-rejected', 'asset URL too long');
      return;
    }
    // Already acquired by this source: never fetched twice (Phase 30-R).
    if (
      await guarded(this.c.pipeline.acquiredUrl(this.c.source.id, sha256Hex(canonical)))
    )
      return;

    let response: Extract<FetchOutcome, { kind: 'response' }>;
    for (let attempt = 1; ; attempt += 1) {
      let outcome: FetchOutcome;
      try {
        outcome = await this.c.assetFetcher.fetch(canonical);
      } catch {
        outcome = {
          kind: 'failure',
          classification: 'network',
          requestedUrl: canonical,
          detail: 'asset fetch failed',
        };
      }
      if (outcome.kind === 'response' && isSuccessStatus(outcome.status)) {
        response = outcome;
        break;
      }
      const failure = classifyOutcome(outcome);
      const decision = retryDecision({
        failure,
        attempt,
        maxAttempts: this.c.source.policy.maxAttempts,
        retryAfter: outcome.kind === 'response' ? outcome.retryAfter : null,
        now: this.c.now(),
        random: this.c.random,
      });
      if (decision.kind === 'wait') {
        await this.c.sleep(decision.ms);
        continue;
      }
      await failed(
        failure.retryable ? 'asset-unavailable' : failure.classification,
        outcomeDetail(outcome) ?? 'asset unavailable',
        failure.httpStatus,
        attempt,
      );
      return;
    }

    const bytes = response.body;
    const checksum = sha256Hex(bytes);
    const declared =
      response.contentType === null
        ? null
        : clip(response.contentType.split(';')[0]?.trim() ?? '', 120);
    let stored: {
      readonly assetId: string;
      readonly mediaType: string;
      readonly byteSize: number;
    };
    let publicCopy: PublicImageCopy | null = null;
    const existing = await guarded(this.c.pipeline.assetByChecksum(checksum));
    if (existing !== null) {
      // Same bytes: the blob is shared, the rights are NOT (§5.2) — this
      // acquisition still gets its own provenance below.
      stored = {
        assetId: existing.assetId,
        mediaType: declared || 'application/octet-stream',
        byteSize: bytes.byteLength,
      };
      publicCopy = existing.publicCopy;
    } else {
      let result: Awaited<ReturnType<MigrationAssetStoragePort['store']>>;
      try {
        result = await this.c.assets.store({
          bytes,
          declaredMediaType: declared,
          displayName: null,
        });
      } catch {
        await failed('asset-unavailable', 'storage did not answer');
        return;
      }
      if (result.status === 'rejected') {
        await failed('asset-rejected', result.reason);
        return;
      }
      if (result.checksum !== checksum || result.byteSize !== bytes.byteLength) {
        await failed('asset-rejected', 'stored bytes differ from the fetched bytes');
        return;
      }
      stored = {
        assetId: result.assetId,
        mediaType: clip(result.mediaType, 120),
        byteSize: result.byteSize,
      };
    }

    // A still image also gets its PUBLIC copy — every hidden metadata segment
    // removed by Storage's image pipeline — the only bytes a domain may ever
    // show (Phase 30-R). A refusal is recorded; the evidence is kept either way.
    if (publicCopy === null && STILL_IMAGE_TYPES.includes(stored.mediaType)) {
      let copy: Awaited<ReturnType<MigrationAssetStoragePort['storePublicImage']>>;
      try {
        copy = await this.c.assets.storePublicImage({ bytes, displayName: null });
      } catch {
        copy = { status: 'rejected', reason: 'storage did not answer' };
      }
      if (copy.status === 'stored')
        publicCopy = {
          assetId: copy.assetId,
          checksum: copy.checksum,
          width: copy.width,
          height: copy.height,
        };
      else await failed('asset-rejected', `public copy refused: ${copy.reason}`);
    }

    await guarded(
      this.c.pipeline.recordAcquisition({
        sourceId: this.c.source.id,
        recordId: item.recordId,
        runId: this.c.run.id,
        originalUrl: canonical,
        originalUrlDigest: sha256Hex(canonical),
        assetId: stored.assetId,
        checksum,
        byteSize: stored.byteSize,
        mediaType: stored.mediaType,
        licence: asset.licence,
        licenceEvidence:
          asset.licenceEvidence === null ? null : clip(asset.licenceEvidence, 1000),
        rightsHolder: asset.rightsHolder === null ? null : clip(asset.rightsHolder, 200),
        acquiredAt: this.c.now(),
        publicCopy,
      }),
    );
  }
}
