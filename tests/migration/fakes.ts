import { createHash } from 'node:crypto';

import {
  isPublishableKind,
  type AssetAcquisitionInput,
  type AssetVisibility,
  type DiscoveredItem,
  type FetchOutcome,
  type ManifestEntryRecord,
  type ManifestRecord,
  type MigrationAssetStoragePort,
  type MigrationContentKind,
  type MigrationPublishableKind,
  type MigrationTargetRef,
  type ParsedRecord,
  type TargetStage,
} from '../../packages/contracts/src/migration/index.ts';
import type {
  MigrationAuthorityPort,
  MigrationDecisionPort,
  MigrationFetchPort,
  MigrationPipelinePort,
  MigrationPromotionDestinationPort,
  MigrationPromotionPort,
  MigrationPublicationPort,
  MigrationPublicationTargetPort,
  MigrationRawPort,
  MigrationReadPort,
  MigrationSourceAdapter,
  MigrationSourcePort,
  MigrationTopicPort,
  ParsedVideo,
  PendingItem,
  PromotionItem,
  PromotionRecord,
  RunCounts,
  RunRecord,
  SourcePolicy,
  SourceRecord,
  StageInput,
  StagedDetail,
} from '../../packages/contracts/src/migration/index.ts';

/**
 * IN-MEMORY FAKES of every Migration port, faithful to the contract's
 * documented semantics (versions, forward-only states, idempotency) so the
 * application services can be proved without a database. The database's own
 * enforcement is proved separately by the persistence integration suite.
 */

export const sha256 = (value: string | Uint8Array): string =>
  createHash('sha256').update(value).digest('hex');

/** Deterministic UUID-shaped ids. */
export function idFactory(prefix = 0): () => string {
  let next = 0;
  return () => {
    next += 1;
    return `00000000-0000-4000-8${prefix.toString(16).padStart(3, '0')}-${next.toString(16).padStart(12, '0')}`;
  };
}

export const ADMIN = { accountId: 'admin-account' } as const;
export const READER = { accountId: 'reader-account' } as const;
export const NOBODY = { accountId: 'nobody-account' } as const;
export const PUBLISHER_ID = 'publisher-account';
export const PRIVILEGED = Object.freeze({
  kind: 'privileged-actor',
  accountId: PUBLISHER_ID,
  live: true,
});

/** Identity: admin holds read + administer; reader holds read; publisher verifies only when live. */
export class FakeAuthority implements MigrationAuthorityPort {
  readonly grants = new Map<string, Set<string>>([
    [ADMIN.accountId, new Set(['migration.read', 'migration.administer'])],
    [READER.accountId, new Set(['migration.read'])],
  ]);
  async permits(accountId: string, permission: string): Promise<boolean> {
    return this.grants.get(accountId)?.has(permission) ?? false;
  }
  async verifyPublisher(actor: unknown): Promise<string | null> {
    const value = actor as { kind?: unknown; accountId?: unknown; live?: unknown } | null;
    return value?.kind === 'privileged-actor' &&
      value.live === true &&
      typeof value.accountId === 'string'
      ? value.accountId
      : null;
  }
}

export class FakeTopics implements MigrationTopicPort {
  constructor(readonly topics: Set<string> = new Set()) {}
  async existingTopics(ids: readonly string[]): Promise<ReadonlySet<string>> {
    return new Set(ids.filter((id) => this.topics.has(id)));
  }
}

const refusal = (reason: string) => Object.assign(new Error(reason), { reason });

export const POLICY: SourcePolicy = Object.freeze({
  minIntervalMs: 0,
  maxConcurrency: 1,
  maxAttempts: 3,
  timeoutMs: 5000,
  maxBodyBytes: 1024 * 1024,
  maxRedirects: 2,
});

/* ===========================================================================
 * The store
 * ========================================================================= */

interface RecordRow {
  id: string;
  sourceId: string;
  externalKey: string;
  originalUrl: string | null;
  legacyIdentifier: string | null;
  status: string;
  observed: 'present' | 'missing';
  disappearance: string | null;
  mergedInto: string | null;
  latestSnapshotId: string | null;
  currentStagedId: string | null;
  seq: number;
  lastObservedRunId: string;
  version: number;
}

interface ItemRow {
  id: string;
  runId: string;
  recordId: string;
  position: number;
  outcome: 'pending' | 'staged' | 'unchanged' | 'rejected' | 'errored' | 'excluded';
  fetched: boolean;
  parsed: boolean;
  attempts: number;
  nextAttemptAt: Date | null;
  snapshotId: string | null;
  stagedRecordId: string | null;
  errorId: string | null;
}

interface RunRow extends RunRecord {
  leaseToken: string | null;
  detail: string | null;
}

interface StagedRow extends StageInput {
  id: string;
  revision: number;
  review: 'pending' | 'approved' | 'rejected' | 'superseded';
  version: number;
  note: string | null;
}

interface ErrorRow {
  id: string;
  runId: string;
  recordId: string | null;
  itemId: string | null;
  classification: string;
  stage: string;
  retryEligible: boolean;
  httpStatus: number | null;
  attempt: number;
  detail: string | null;
  resolution: string;
  version: number;
}

interface DuplicateRow {
  id: string;
  recordId: string;
  otherRecordId: string;
  signal: string;
  crossLanguage: boolean;
  state: string;
  version: number;
}

interface LegacyMappingRow {
  id: string;
  sourceId: string;
  recordId: string;
  legacyUrl: string;
  digest: string;
  /** What the mapping names, by typed target (the adapter's one typed column). */
  target: MigrationTargetRef;
  canonicalPath: string;
  state: 'active' | 'disabled';
  version: number;
}

export class FakeStore {
  readonly ids = idFactory(1);
  readonly sources = new Map<string, SourceRecord>();
  readonly runs = new Map<string, RunRow>();
  readonly records = new Map<string, RecordRow>();
  readonly items = new Map<string, ItemRow>();
  readonly snapshots = new Map<
    string,
    {
      id: string;
      recordId: string;
      runId: string;
      checksum: string;
      body: Uint8Array | null;
      personalData: 'none' | 'flagged';
      contentType: string | null;
    }
  >();
  readonly staged = new Map<string, StagedRow>();
  readonly errors = new Map<string, ErrorRow>();
  readonly duplicates = new Map<string, DuplicateRow>();
  readonly legacyMappings = new Map<string, LegacyMappingRow>();
  /** Acquisitions; `visibility` is what a PERSON decided (restricted until then). */
  readonly acquisitions = new Map<
    string,
    AssetAcquisitionInput & { id: string; visibility: AssetVisibility }
  >();
  readonly topicMappings = new Map<
    string,
    { id: string; state: string; topicId: string | null; version: number }
  >();
  readonly manifests = new Map<string, ManifestRecord>();
  readonly entries = new Map<string, ManifestEntryRecord>();
  readonly promotions = new Map<string, PromotionRecord>();
  readonly promotionEntries = new Map<
    string,
    {
      id: string;
      promotionId: string;
      manifestEntryId: string;
      position: number;
      state: 'pending' | 'promoted';
      ref: string | null;
    }
  >();
  readonly audit: string[] = [];
  readonly calls = {
    stage: 0,
    storeSnapshot: 0,
    snapshotsCreated: 0,
    readSnapshot: 0,
    resolve: 0,
  };
  private seq = 0;

  addSource(overrides: Partial<SourceRecord> = {}): SourceRecord {
    const source: SourceRecord = {
      id: this.ids(),
      key: 'fixture-videos',
      name: 'Fixture videos',
      authorityKind: 'fixture',
      accessMethod: 'http',
      contentKind: 'media.video',
      baseUrl: 'https://videos.fixture.invalid/',
      hosts: ['videos.fixture.invalid'],
      authorisationReference: null,
      authorisedOn: null,
      licensingEvidence: null,
      policyNotes: null,
      defaultLanguageCode: 'en',
      policy: POLICY,
      state: 'active',
      version: 1,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      ...overrides,
    };
    this.sources.set(source.id, source);
    return source;
  }

  /**
   * An approved, valid revision staged directly — for publication tests. Its
   * kind is the payload's own `kind` (a video when the payload names none).
   */
  approvedRevision(
    sourceId: string,
    runId: string,
    payload: object,
    url: string,
  ): StagedRow {
    const contentKind =
      ((payload as { kind?: unknown }).kind as MigrationContentKind | undefined) ??
      'media.video';
    const record = this.upsertRecord(
      sourceId,
      { externalKey: url, originalUrl: url, legacyIdentifier: null },
      runId,
    );
    const row: StagedRow = {
      sourceId,
      runId,
      itemId: 'n/a',
      recordId: record.id,
      snapshotId: 'n/a',
      contentKind,
      title: 'T',
      titleKey: 't',
      dedupeKey: null,
      languageCode: 'en',
      payload: JSON.stringify(payload),
      payloadChecksum: sha256(JSON.stringify(payload)),
      provenance: {
        adapterKey: 'a',
        adapterVersion: '1',
        parserKey: 'p',
        parserVersion: '1',
        normalizerVersion: 'n',
        codeRevision: 'local',
      },
      inputChecksum: sha256('x'),
      producedAt: new Date(0),
      validation: 'valid',
      issues: [],
      personalData: 'none',
      categories: [],
      links: [],
      duplicates: [],
      outcome: 'staged',
      error: null,
      id: this.ids(),
      revision: 1,
      review: 'approved',
      version: 2,
      note: null,
    };
    this.staged.set(row.id, row);
    record.currentStagedId = row.id;
    record.status = 'approved';
    return row;
  }

  completedRun(
    sourceId: string,
    reconciliation: 'balanced' | 'unbalanced' = 'balanced',
  ): RunRow {
    const run: RunRow = {
      id: this.ids(),
      sourceId,
      sourceKey: 'fixture-videos',
      operatorUserId: ADMIN.accountId,
      state: 'completed',
      provenance: {
        adapterKey: 'a',
        adapterVersion: '1',
        parserKey: 'p',
        parserVersion: '1',
        normalizerVersion: 'n',
        codeRevision: 'local',
      },
      discoveryCursor: null,
      discoveryComplete: true,
      leaseExpiresAt: null,
      startedAt: new Date(0),
      endedAt: new Date(0),
      reconciliation,
      reconciledAt: new Date(0),
      version: 3,
      leaseToken: null,
      detail: null,
    };
    this.runs.set(run.id, run);
    return run;
  }

  upsertRecord(sourceId: string, item: DiscoveredItem, runId: string): RecordRow {
    for (const record of this.records.values())
      if (record.sourceId === sourceId && record.externalKey === item.externalKey) {
        record.observed = 'present';
        record.disappearance = null;
        record.lastObservedRunId = runId;
        return record;
      }
    const record: RecordRow = {
      id: this.ids(),
      sourceId,
      externalKey: item.externalKey,
      originalUrl: item.originalUrl,
      legacyIdentifier: item.legacyIdentifier,
      status: 'discovered',
      observed: 'present',
      disappearance: null,
      mergedInto: null,
      latestSnapshotId: null,
      currentStagedId: null,
      seq: (this.seq += 1),
      lastObservedRunId: runId,
      version: 1,
    };
    this.records.set(record.id, record);
    return record;
  }

  stagedOf(recordId: string): StagedRow[] {
    return [...this.staged.values()]
      .filter((row) => row.recordId === recordId)
      .sort((a, b) => a.revision - b.revision);
  }

  /* ---- Pipeline ---------------------------------------------------------- */

  readonly pipeline: MigrationPipelinePort = {
    openRun: async (input) => {
      // As the adapter: a fixture, or an authorised source carrying its written
      // authorisation reference and date — and only an active one.
      const owner = this.sources.get(input.sourceId);
      if (owner === undefined) throw refusal('not-found');
      if (
        owner.authorityKind !== 'fixture' &&
        (owner.authorityKind !== 'authorised' ||
          owner.authorisationReference === null ||
          owner.authorisedOn === null)
      )
        throw refusal('real-source-not-authorised');
      if (owner.state !== 'active') throw refusal('invalid-state');
      const open = [...this.runs.values()].find(
        (run) => run.sourceId === input.sourceId && run.state === 'open',
      );
      if (open !== undefined) {
        const live =
          open.leaseToken !== null &&
          open.leaseToken !== input.leaseToken &&
          open.leaseExpiresAt !== null &&
          open.leaseExpiresAt.getTime() > input.now.getTime();
        if (live) throw refusal('run-busy');
        open.leaseToken = input.leaseToken;
        open.leaseExpiresAt = input.leaseUntil;
        this.audit.push('migration.run.resumed');
        return { run: { ...open }, resumed: true };
      }
      const source = this.sources.get(input.sourceId);
      const run: RunRow = {
        id: input.runId,
        sourceId: input.sourceId,
        sourceKey: source?.key ?? '',
        operatorUserId: input.operatorUserId,
        state: 'open',
        provenance: input.provenance,
        discoveryCursor: null,
        discoveryComplete: false,
        leaseExpiresAt: input.leaseUntil,
        startedAt: input.now,
        endedAt: null,
        reconciliation: 'pending',
        reconciledAt: null,
        version: 1,
        leaseToken: input.leaseToken,
        detail: null,
      };
      this.runs.set(run.id, run);
      this.audit.push('migration.run.started');
      return { run: { ...run }, resumed: false };
    },
    renewLease: async (runId, token, until) => {
      const run = this.runs.get(runId);
      if (run === undefined || run.leaseToken !== token || run.state !== 'open')
        return false;
      run.leaseExpiresAt = until;
      return true;
    },
    recordDiscovery: async (input) => {
      const run = this.runs.get(input.runId);
      if (run === undefined || run.leaseToken !== input.leaseToken)
        throw refusal('lease-lost');
      for (const discovered of input.items) {
        const record = this.upsertRecord(run.sourceId, discovered, run.id);
        const exists = [...this.items.values()].some(
          (item) => item.runId === run.id && item.recordId === record.id,
        );
        if (exists) continue;
        const position = [...this.items.values()].filter(
          (item) => item.runId === run.id,
        ).length;
        const id = this.ids();
        this.items.set(id, {
          id,
          runId: run.id,
          recordId: record.id,
          position,
          outcome: 'pending',
          fetched: false,
          parsed: false,
          attempts: 0,
          nextAttemptAt: null,
          snapshotId: null,
          stagedRecordId: null,
          errorId: null,
        });
      }
      run.discoveryCursor = input.nextCursor;
      run.discoveryComplete = input.complete;
    },
    pendingItems: async (runId, limit, now) =>
      [...this.items.values()]
        .filter(
          (item) =>
            item.runId === runId &&
            item.outcome === 'pending' &&
            (item.nextAttemptAt === null ||
              item.nextAttemptAt.getTime() <= now.getTime()),
        )
        .sort((a, b) => a.position - b.position)
        .slice(0, limit)
        .map((item): PendingItem => {
          const record = this.records.get(item.recordId)!;
          const snapshot =
            record.latestSnapshotId === null
              ? undefined
              : this.snapshots.get(record.latestSnapshotId);
          const current =
            record.currentStagedId === null
              ? undefined
              : this.staged.get(record.currentStagedId);
          return {
            itemId: item.id,
            recordId: record.id,
            externalKey: record.externalKey,
            originalUrl: record.originalUrl,
            legacyIdentifier: record.legacyIdentifier,
            attempts: item.attempts,
            latestSnapshot:
              snapshot === undefined
                ? null
                : { id: snapshot.id, checksum: snapshot.checksum },
            currentStaged:
              current === undefined
                ? null
                : {
                    id: current.id,
                    revision: current.revision,
                    inputChecksum: current.inputChecksum,
                  },
          };
        }),
    scheduleRetry: async (itemId, attempts, next) => {
      const item = this.items.get(itemId)!;
      item.attempts = attempts;
      item.nextAttemptAt = next;
    },
    storeSnapshot: async (input) => {
      this.calls.storeSnapshot += 1;
      if (sha256(input.body) !== input.checksum) throw refusal('invalid');
      const record = this.records.get(input.recordId)!;
      const item = this.items.get(input.itemId)!;
      const latest =
        record.latestSnapshotId === null
          ? undefined
          : this.snapshots.get(record.latestSnapshotId);
      let snapshotId: string;
      let reused = false;
      if (
        latest !== undefined &&
        latest.checksum === input.checksum &&
        latest.body !== null
      ) {
        snapshotId = latest.id;
        reused = true;
      } else {
        snapshotId = this.ids();
        this.calls.snapshotsCreated += 1;
        this.snapshots.set(snapshotId, {
          id: snapshotId,
          recordId: input.recordId,
          runId: input.runId,
          checksum: input.checksum,
          body: input.body,
          personalData: input.personalData,
          contentType: input.contentType,
        });
        record.latestSnapshotId = snapshotId;
      }
      item.fetched = true;
      item.snapshotId = snapshotId;
      if (record.status === 'discovered') record.status = 'fetched';
      return { snapshotId, reused };
    },
    markUnchanged: async (itemId) => {
      const item = this.items.get(itemId)!;
      item.outcome = 'unchanged';
      item.fetched = true;
    },
    markExcluded: async (itemId) => {
      const item = this.items.get(itemId)!;
      item.outcome = 'excluded';
      this.records.get(item.recordId)!.status = 'excluded';
    },
    stage: async (input) => {
      this.calls.stage += 1;
      const item = this.items.get(input.itemId)!;
      if (item.outcome !== 'pending') throw refusal('invalid-state');
      const record = this.records.get(input.recordId)!;
      for (const earlier of this.stagedOf(record.id))
        if (earlier.review === 'pending' || earlier.review === 'approved') {
          earlier.review = 'superseded';
          earlier.version += 1;
        }
      const revision = this.stagedOf(record.id).length + 1;
      const row: StagedRow = {
        ...input,
        id: this.ids(),
        revision,
        review: 'pending',
        version: 1,
        note: null,
      };
      this.staged.set(row.id, row);
      for (const category of input.categories) {
        const key = `${input.sourceId}:${category.key}`;
        if (!this.topicMappings.has(key))
          this.topicMappings.set(key, {
            id: this.ids(),
            state: 'unmapped',
            topicId: null,
            version: 1,
          });
      }
      for (const duplicate of input.duplicates) {
        const id = this.ids();
        this.duplicates.set(id, {
          id,
          recordId: record.id,
          otherRecordId: duplicate.otherRecordId,
          signal: duplicate.signal,
          crossLanguage: duplicate.crossLanguage,
          state: duplicate.collapse ? 'collapsed' : 'open',
          version: 1,
        });
        if (duplicate.collapse) record.mergedInto = duplicate.otherRecordId;
      }
      item.outcome = input.outcome;
      item.parsed = true;
      item.stagedRecordId = row.id;
      record.currentStagedId = row.id;
      record.status = record.mergedInto !== null ? 'merged' : input.outcome;
      if (input.error !== null) {
        const errorId = this.ids();
        this.errors.set(errorId, {
          ...input.error,
          id: errorId,
          itemId: item.id,
          resolution: 'open',
          version: 1,
        });
        item.errorId = errorId;
      }
      return { stagedRecordId: row.id, revision };
    },
    recordError: async (input) => {
      const id = this.ids();
      this.errors.set(id, { ...input, id, resolution: 'open', version: 1 });
      if (input.itemId !== null) {
        const item = this.items.get(input.itemId)!;
        item.outcome = 'errored';
        item.errorId = id;
        item.attempts = Math.max(item.attempts, input.attempt);
      }
      return { errorId: id };
    },
    activeMappings: async (sourceId, digests) => {
      const found = new Map<string, { id: string; canonicalPath: string }>();
      for (const mapping of this.legacyMappings.values())
        if (
          mapping.sourceId === sourceId &&
          mapping.state === 'active' &&
          digests.includes(mapping.digest)
        )
          found.set(mapping.digest, {
            id: mapping.id,
            canonicalPath: mapping.canonicalPath,
          });
      return found;
    },
    dedupeMatches: async (dedupeKey, excluding) =>
      [...this.records.values()]
        .filter((record) => record.id !== excluding && record.currentStagedId !== null)
        .filter(
          (record) => this.staged.get(record.currentStagedId!)!.dedupeKey === dedupeKey,
        )
        .sort((a, b) => a.seq - b.seq)
        .map((record) => ({
          recordId: record.id,
          languageCode: this.staged.get(record.currentStagedId!)!.languageCode,
        })),
    titleMatches: async (_kind, titleKey, excluding, limit) =>
      [...this.records.values()]
        .filter((record) => record.id !== excluding && record.currentStagedId !== null)
        .filter(
          (record) => this.staged.get(record.currentStagedId!)!.titleKey === titleKey,
        )
        .sort((a, b) => a.seq - b.seq)
        .slice(0, limit)
        .map((record) => ({
          recordId: record.id,
          languageCode: this.staged.get(record.currentStagedId!)!.languageCode,
        })),
    assetByChecksum: async (checksum) => {
      for (const acquisition of this.acquisitions.values())
        if (acquisition.checksum === checksum) return { assetId: acquisition.assetId };
      return null;
    },
    recordAcquisition: async (input) => {
      const key = `${input.sourceId}|${input.originalUrlDigest}|${input.checksum}`;
      const existing = this.acquisitions.get(key);
      if (existing !== undefined) return { provenanceId: existing.id, created: false };
      const id = this.ids();
      this.acquisitions.set(key, { ...input, id, visibility: 'restricted' });
      return { provenanceId: id, created: true };
    },
    reconciliationCounts: async (runId) => this.counts(runId),
    completeRun: async (input) => {
      const run = this.runs.get(input.runId)!;
      if (run.leaseToken !== input.leaseToken || run.state !== 'open')
        throw refusal('lease-lost');
      run.state = 'completed';
      run.reconciliation = input.reconciliation;
      run.detail = input.detail;
      run.endedAt = input.now;
      run.reconciledAt = input.now;
      run.version += 1;
      let missing = 0;
      const seen = new Set(
        [...this.items.values()]
          .filter((item) => item.runId === run.id)
          .map((item) => item.recordId),
      );
      for (const record of this.records.values())
        if (
          record.sourceId === run.sourceId &&
          !seen.has(record.id) &&
          record.observed === 'present'
        ) {
          record.observed = 'missing';
          missing += 1;
        }
      this.audit.push('migration.run.completed');
      return { missing };
    },
    cancelRun: async (input) => {
      const run = this.runs.get(input.runId);
      if (run === undefined) throw refusal('not-found');
      if (run.version !== input.expectedVersion) throw refusal('conflict');
      run.state = 'cancelled';
    },
  };

  counts(runId: string): RunCounts {
    const items = [...this.items.values()].filter((item) => item.runId === runId);
    const by = (outcome: ItemRow['outcome']) =>
      items.filter((item) => item.outcome === outcome).length;
    const revisions = [...this.staged.values()].filter((row) => row.runId === runId);
    const review = (state: StagedRow['review']) =>
      revisions.filter((row) => row.review === state).length;
    const published = [...this.entries.values()].filter(
      (entry) =>
        entry.state === 'published' &&
        this.staged.get(entry.stagedRecordId)?.runId === runId,
    );
    return {
      discovered: items.length,
      pending: by('pending'),
      fetched: items.filter((item) => item.fetched).length,
      parsed: items.filter((item) => item.parsed).length,
      staged: by('staged'),
      unchanged: by('unchanged'),
      rejected: by('rejected'),
      errored: by('errored'),
      excluded: by('excluded'),
      inconsistent: 0,
      reviewPending: review('pending'),
      approved: review('approved'),
      reviewRejected: review('rejected'),
      superseded: review('superseded'),
      published: published.length,
      mapped: published.filter((entry) =>
        [...this.legacyMappings.values()].some((m) => m.recordId === entry.recordId),
      ).length,
      merged: items.filter((item) => this.records.get(item.recordId)?.mergedInto !== null)
        .length,
    };
  }

  /* ---- Sources ----------------------------------------------------------- */

  readonly sourcePort: MigrationSourcePort = {
    createFixtureSource: async (input) => {
      if ([...this.sources.values()].some((source) => source.key === input.key))
        throw refusal('duplicate');
      const source: SourceRecord = {
        id: input.id,
        key: input.key,
        name: input.name,
        authorityKind: 'fixture',
        accessMethod: input.accessMethod,
        contentKind: input.contentKind,
        baseUrl: input.baseUrl,
        hosts: input.hosts,
        authorisationReference: null,
        authorisedOn: null,
        licensingEvidence: input.licensingEvidence,
        policyNotes: input.policyNotes,
        defaultLanguageCode: input.defaultLanguageCode,
        policy: input.policy,
        state: 'active',
        version: 1,
        createdAt: input.now,
        updatedAt: input.now,
      };
      this.sources.set(source.id, source);
      return source;
    },
    createAuthorisedSource: async (input) => {
      // As the adapter and its CHECKs: authorised, INACTIVE, http, its
      // evidence recorded, real hosts only (never `*.invalid`, never one label).
      if ([...this.sources.values()].some((source) => source.key === input.key))
        throw refusal('duplicate');
      const hosts = [...new Set(input.hosts)];
      if (hosts.length < 1) throw refusal('invalid');
      if (hosts.some((host) => host.endsWith('.invalid') || !/.\../.test(host)))
        throw refusal('host-refused');
      const source: SourceRecord = {
        id: input.id,
        key: input.key,
        name: input.name,
        authorityKind: 'authorised',
        accessMethod: 'http',
        contentKind: input.contentKind,
        baseUrl: input.baseUrl,
        hosts,
        authorisationReference: input.authorisationReference,
        authorisedOn: input.authorisedOn,
        licensingEvidence: input.licensingEvidence,
        policyNotes: input.policyNotes,
        defaultLanguageCode: input.defaultLanguageCode,
        policy: input.policy,
        state: 'inactive',
        version: 1,
        createdAt: input.now,
        updatedAt: input.now,
      };
      this.sources.set(source.id, source);
      this.audit.push('migration.source.registered');
      return source;
    },
    updateSource: async (input) => {
      const source = this.sources.get(input.id);
      if (source === undefined) throw refusal('not-found');
      if (source.version !== input.expectedVersion) throw refusal('conflict');
      this.audit.push(
        source.state !== 'active' && input.state === 'active'
          ? 'migration.source.activated'
          : 'migration.source.updated',
      );
      const next: SourceRecord = {
        ...source,
        name: input.name,
        state: input.state,
        defaultLanguageCode: input.defaultLanguageCode,
        policy: input.policy,
        licensingEvidence: input.licensingEvidence,
        policyNotes: input.policyNotes,
        version: source.version + 1,
        updatedAt: input.now,
      };
      this.sources.set(next.id, next);
      return next;
    },
    source: async (id) => this.sources.get(id) ?? null,
    sourceByKey: async (key) =>
      [...this.sources.values()].find((source) => source.key === key) ?? null,
  };

  /* ---- Decisions --------------------------------------------------------- */

  readonly decisionPort: MigrationDecisionPort = {
    review: async (input) => {
      const row = this.staged.get(input.stagedRecordId);
      if (row === undefined) throw refusal('not-found');
      if (row.version !== input.expectedVersion) throw refusal('conflict');
      const ok =
        (row.review === 'pending' &&
          (input.review === 'approved' || input.review === 'rejected')) ||
        (row.review === 'approved' && input.review === 'pending');
      if (!ok) throw refusal('invalid-state');
      if (
        input.review === 'approved' &&
        (row.validation !== 'valid' || row.personalData !== 'none')
      )
        throw refusal('not-publishable');
      row.review = input.review;
      row.note = input.note;
      row.version += 1;
      this.audit.push(`migration.staged.${input.review}`);
    },
    decideDuplicate: async (input) => {
      const row = this.duplicates.get(input.candidateId);
      if (row === undefined) throw refusal('not-found');
      if (row.version !== input.expectedVersion) throw refusal('conflict');
      if (input.state === 'merged' && row.crossLanguage) throw refusal('cross-language');
      row.state = input.state;
      row.version += 1;
    },
    decideTopicMapping: async (input) => {
      const row = [...this.topicMappings.values()].find(
        (mapping) => mapping.id === input.mappingId,
      );
      if (row === undefined) throw refusal('not-found');
      if (row.version !== input.expectedVersion) throw refusal('conflict');
      row.state = input.state;
      row.topicId = input.topicId;
      row.version += 1;
    },
    decideError: async (input) => {
      const row = this.errors.get(input.errorId);
      if (row === undefined) throw refusal('not-found');
      if (row.version !== input.expectedVersion) throw refusal('conflict');
      if (input.resolution === 'retry-requested' && !row.retryEligible)
        throw refusal('not-retryable');
      row.resolution = input.resolution;
      row.version += 1;
      const run = this.runs.get(row.runId);
      if (
        input.resolution === 'retry-requested' &&
        row.itemId !== null &&
        run?.state === 'open'
      ) {
        const item = this.items.get(row.itemId)!;
        item.outcome = 'pending';
        item.errorId = null;
        item.nextAttemptAt = null;
      }
    },
    classifyDisappearance: async (input) => {
      const row = this.records.get(input.recordId);
      if (row === undefined) throw refusal('not-found');
      if (row.version !== input.expectedVersion) throw refusal('conflict');
      if (row.observed !== 'missing') throw refusal('invalid-state');
      row.disappearance = input.classification;
      row.version += 1;
    },
    decideRights: async (input) => {
      const row = [...this.acquisitions.values()].find(
        (acquisition) => acquisition.id === input.provenanceId,
      );
      if (row === undefined) throw refusal('not-found');
      row.visibility = input.visibility;
    },
    decideLegacyMapping: async (input) => {
      const row = this.legacyMappings.get(input.mappingId);
      if (row === undefined) throw refusal('not-found');
      if (row.version !== input.expectedVersion) throw refusal('conflict');
      row.state = input.state;
      row.version += 1;
    },
  };

  /* ---- Raw --------------------------------------------------------------- */

  readonly rawPort: MigrationRawPort = {
    readSnapshot: async (input) => {
      this.calls.readSnapshot += 1;
      this.audit.push(`migration.snapshot.read:${input.purpose}`);
      const row = this.snapshots.get(input.snapshotId);
      if (row === undefined) return null;
      return {
        id: row.id,
        contentType: row.contentType,
        byteSize: row.body?.byteLength ?? 0,
        checksum: row.checksum,
        personalData: row.personalData,
        body: row.body === null ? null : row.body.subarray(0, input.maxBytes),
      };
    },
    disposeSnapshot: async (input) => {
      const row = this.snapshots.get(input.snapshotId);
      if (row === undefined) throw refusal('not-found');
      row.body = null;
    },
  };

  /* ---- Publication ------------------------------------------------------- */

  readonly publicationPort: MigrationPublicationPort = {
    createManifest: async (input) => {
      const run = this.runs.get(input.runId);
      if (run === undefined) throw refusal('not-found');
      // As the adapter, every revision is checked before anything is written:
      // religious material is evidence only, never a manifest entry.
      for (const stagedId of input.stagedRecordIds) {
        const staged = this.staged.get(stagedId);
        if (staged === undefined) throw refusal('not-found');
        if (!isPublishableKind(staged.contentKind)) throw refusal('review-only-kind');
        if (staged.review !== 'approved' || staged.validation !== 'valid')
          throw refusal('invalid-state');
      }
      const manifest: ManifestRecord = {
        id: input.id,
        sourceId: run.sourceId,
        runId: run.id,
        state: 'draft',
        createdByUserId: input.actorId,
        createdAt: input.now,
        publishedByUserId: null,
        publishedAt: null,
        rollbackByUserId: null,
        rollbackReason: null,
        rolledBackAt: null,
        version: 1,
      };
      this.manifests.set(manifest.id, manifest);
      input.stagedRecordIds.forEach((stagedId, position) => {
        const staged = this.staged.get(stagedId)!;
        const entry: ManifestEntryRecord = {
          id: this.ids(),
          manifestId: manifest.id,
          position,
          stagedRecordId: stagedId,
          recordId: staged.recordId,
          state: 'pending',
          target: null,
          targetStage: null,
          targetVersion: null,
          canonicalPath: null,
          refusal: null,
          publishedAt: null,
          rolledBackAt: null,
          version: 1,
        };
        this.entries.set(entry.id, entry);
      });
      return manifest;
    },
    manifest: async (id) => {
      const manifest = this.manifests.get(id);
      if (manifest === undefined) return null;
      return { manifest, entries: this.entriesOf(id) };
    },
    discardManifest: async (input) => {
      const manifest = this.manifests.get(input.manifestId)!;
      if (manifest.version !== input.expectedVersion) throw refusal('conflict');
      this.manifests.set(manifest.id, {
        ...manifest,
        state: 'discarded',
        version: manifest.version + 1,
      });
    },
    beginPublication: async (input) => {
      const manifest = this.manifests.get(input.manifestId)!;
      if (manifest.version !== input.expectedVersion) throw refusal('conflict');
      if (manifest.state !== 'draft') throw refusal('invalid-state');
      const next: ManifestRecord = {
        ...manifest,
        state: 'publishing',
        publishedByUserId: input.actorId,
        version: manifest.version + 1,
      };
      this.manifests.set(next.id, next);
      return next;
    },
    publishable: async (manifestId, limit) =>
      this.entriesOf(manifestId)
        .filter((entry) => entry.state === 'pending' || entry.state === 'publishing')
        .slice(0, limit)
        .map((entry) => {
          const staged = this.staged.get(entry.stagedRecordId)!;
          const record = this.records.get(entry.recordId)!;
          return {
            entry,
            contentKind: staged.contentKind,
            review: staged.review,
            validation: staged.validation,
            payload: staged.payload,
            topicIds: [],
            legacyUrls: [
              { recordId: record.id, url: record.originalUrl ?? record.externalKey },
            ],
            // As the adapter: only acquisitions a person decided public-eligible.
            assets: [...this.acquisitions.values()]
              .filter(
                (acquisition) =>
                  acquisition.recordId === record.id &&
                  acquisition.visibility === 'public-eligible',
              )
              .map((acquisition) => ({
                originalUrl: acquisition.originalUrl,
                assetId: acquisition.assetId,
                mediaType: acquisition.mediaType,
                checksum: acquisition.checksum,
              })),
          };
        }),
    claimEntry: async (entryId, expectedVersion) => {
      const entry = this.entries.get(entryId)!;
      if (entry.version !== expectedVersion || entry.state !== 'pending')
        throw refusal('conflict');
      const next: ManifestEntryRecord = {
        ...entry,
        state: 'publishing',
        version: entry.version + 1,
      };
      this.entries.set(entryId, next);
      return next;
    },
    recordPublished: async (input) => {
      const entry = this.entries.get(input.entryId)!;
      if (entry.version !== input.expectedVersion) throw refusal('conflict');
      this.entries.set(entry.id, {
        ...entry,
        state: 'published',
        target: input.target,
        targetStage: input.targetStage,
        targetVersion: input.targetVersion,
        canonicalPath: input.canonicalPath,
        publishedAt: input.now,
        version: entry.version + 1,
      });
      const manifest = this.manifests.get(entry.manifestId)!;
      for (const legacy of input.legacyUrls) {
        const id = this.ids();
        this.legacyMappings.set(id, {
          id,
          sourceId: manifest.sourceId,
          recordId: legacy.recordId,
          legacyUrl: legacy.url,
          digest: legacy.digest,
          target: input.target,
          canonicalPath: input.canonicalPath,
          state: 'active',
          version: 1,
        });
      }
      this.records.get(entry.recordId)!.status = 'published';
    },
    resolveLegacyTarget: async (digest) => {
      this.calls.resolve += 1;
      // As the adapter: any source's ACTIVE mapping; two that disagree are no answer.
      const targets = [...this.legacyMappings.values()]
        .filter((mapping) => mapping.digest === digest && mapping.state === 'active')
        .map((mapping) => mapping.target);
      const [first, ...rest] = targets;
      if (first === undefined) return null;
      if (rest.some((other) => other.kind !== first.kind || other.id !== first.id))
        return null;
      return first;
    },
    recordRefused: async (input) => {
      const entry = this.entries.get(input.entryId)!;
      if (entry.version !== input.expectedVersion) throw refusal('conflict');
      this.entries.set(entry.id, {
        ...entry,
        state: 'refused',
        refusal: input.refusal,
        version: entry.version + 1,
      });
    },
    completePublication: async (input) => {
      const manifest = this.manifests.get(input.manifestId)!;
      if (
        this.entriesOf(manifest.id).some(
          (entry) => entry.state === 'pending' || entry.state === 'publishing',
        )
      )
        throw refusal('invalid-state');
      const next: ManifestRecord = {
        ...manifest,
        state: 'published',
        publishedAt: input.now,
        version: manifest.version + 1,
      };
      this.manifests.set(next.id, next);
      return next;
    },
    beginRollback: async (input) => {
      const manifest = this.manifests.get(input.manifestId)!;
      if (manifest.version !== input.expectedVersion) throw refusal('conflict');
      if (manifest.state !== 'published') throw refusal('invalid-state');
      const next: ManifestRecord = {
        ...manifest,
        state: 'rolling-back',
        rollbackByUserId: input.actorId,
        rollbackReason: input.reason,
        version: manifest.version + 1,
      };
      this.manifests.set(next.id, next);
      return next;
    },
    reversible: async (manifestId, limit) =>
      this.entriesOf(manifestId)
        .filter((entry) => entry.state === 'published')
        .slice(0, limit),
    recordRolledBack: async (input) => {
      const entry = this.entries.get(input.entryId)!;
      if (entry.version !== input.expectedVersion) throw refusal('conflict');
      this.entries.set(entry.id, {
        ...entry,
        state: 'rolled-back',
        rolledBackAt: input.now,
        version: entry.version + 1,
      });
      for (const mapping of this.legacyMappings.values())
        if (mapping.recordId === entry.recordId) mapping.state = 'disabled';
      this.records.get(entry.recordId)!.status = 'approved';
    },
    recordRollbackRefused: async (input) => {
      const entry = this.entries.get(input.entryId)!;
      if (entry.version !== input.expectedVersion) throw refusal('conflict');
      this.entries.set(entry.id, {
        ...entry,
        state: 'rollback-refused',
        version: entry.version + 1,
      });
    },
    completeRollback: async (input) => {
      const manifest = this.manifests.get(input.manifestId)!;
      const next: ManifestRecord = {
        ...manifest,
        state: 'rolled-back',
        rolledBackAt: input.now,
        version: manifest.version + 1,
      };
      this.manifests.set(next.id, next);
      return next;
    },
  };

  entriesOf(manifestId: string): ManifestEntryRecord[] {
    return [...this.entries.values()]
      .filter((entry) => entry.manifestId === manifestId)
      .sort((a, b) => a.position - b.position);
  }

  /* ---- Promotion --------------------------------------------------------- */

  readonly promotionPort: MigrationPromotionPort = {
    createPromotion: async (input) => {
      const promotion: PromotionRecord = {
        id: input.id,
        state: 'draft',
        destination: 'bundle',
        createdByUserId: input.actorId,
        createdAt: input.now,
        approvedByUserId: null,
        approvedAt: null,
        withdrawnAt: null,
        completedAt: null,
        entryCount: input.manifestEntryIds.length,
        promotedCount: 0,
        version: 1,
      };
      this.promotions.set(promotion.id, promotion);
      input.manifestEntryIds.forEach((manifestEntryId, position) => {
        const entry = this.entries.get(manifestEntryId);
        if (entry === undefined || entry.state !== 'published') throw refusal('invalid');
        const id = this.ids();
        this.promotionEntries.set(id, {
          id,
          promotionId: promotion.id,
          manifestEntryId,
          position,
          state: 'pending',
          ref: null,
        });
      });
      return promotion;
    },
    promotion: async (id) => this.promotions.get(id) ?? null,
    approve: async (input) =>
      this.movePromotion(input.promotionId, input.expectedVersion, 'draft', 'approved'),
    withdraw: async (input) => {
      const promotion = this.promotions.get(input.promotionId)!;
      if (promotion.version !== input.expectedVersion) throw refusal('conflict');
      if (promotion.state === 'promoted' || promotion.state === 'withdrawn')
        throw refusal('invalid-state');
      const next: PromotionRecord = {
        ...promotion,
        state: 'withdrawn',
        withdrawnAt: input.now,
        version: promotion.version + 1,
      };
      this.promotions.set(next.id, next);
      return next;
    },
    beginPromoting: async (input) => {
      const promotion = this.promotions.get(input.promotionId)!;
      if (promotion.state === 'promoting') return promotion;
      if (promotion.state !== 'approved') throw refusal('invalid-state');
      const next: PromotionRecord = {
        ...promotion,
        state: 'promoting',
        version: promotion.version + 1,
      };
      this.promotions.set(next.id, next);
      return next;
    },
    pendingItems: async (promotionId, limit) =>
      [...this.promotionEntries.values()]
        .filter((entry) => entry.promotionId === promotionId && entry.state === 'pending')
        .sort((a, b) => a.position - b.position)
        .slice(0, limit)
        .map((entry): PromotionItem => {
          const manifestEntry = this.entries.get(entry.manifestEntryId)!;
          const staged = this.staged.get(manifestEntry.stagedRecordId)!;
          const record = this.records.get(manifestEntry.recordId)!;
          return {
            promotionEntryId: entry.id,
            manifestEntryId: manifestEntry.id,
            contentKind: staged.contentKind,
            payload: staged.payload,
            payloadChecksum: staged.payloadChecksum,
            inputChecksum: staged.inputChecksum,
            provenance: staged.provenance,
            sourceKey: 'fixture-videos',
            externalKey: record.externalKey,
            canonicalPath: manifestEntry.canonicalPath ?? '/',
            legacyUrls: [record.externalKey],
            reviewedAt: new Date(0).toISOString(),
            publishedAt: new Date(0).toISOString(),
          };
        }),
    recordPromoted: async (input) => {
      const entry = this.promotionEntries.get(input.promotionEntryId)!;
      if (entry.state === 'promoted') throw refusal('invalid-state');
      entry.state = 'promoted';
      entry.ref = input.destinationRef;
    },
    complete: async (input) => {
      const promotion = this.promotions.get(input.promotionId)!;
      if (
        [...this.promotionEntries.values()].some(
          (entry) => entry.promotionId === promotion.id && entry.state === 'pending',
        )
      )
        throw refusal('invalid-state');
      const next: PromotionRecord = {
        ...promotion,
        state: 'promoted',
        completedAt: input.now,
        version: promotion.version + 1,
      };
      this.promotions.set(next.id, next);
      return next;
    },
  };

  private movePromotion(
    id: string,
    expectedVersion: number,
    from: PromotionRecord['state'],
    to: PromotionRecord['state'],
  ): PromotionRecord {
    const promotion = this.promotions.get(id);
    if (promotion === undefined) throw refusal('not-found');
    if (promotion.version !== expectedVersion) throw refusal('conflict');
    if (promotion.state !== from) throw refusal('invalid-state');
    const next: PromotionRecord = {
      ...promotion,
      state: to,
      version: promotion.version + 1,
    };
    this.promotions.set(id, next);
    return next;
  }

  /* ---- Reads ------------------------------------------------------------- */

  readonly readPort: MigrationReadPort = {
    sources: async (offset, limit) => page([...this.sources.values()], offset, limit),
    runs: async (query) => page([], query.offset, query.limit),
    run: async (id) => {
      const run = this.runs.get(id);
      return run === undefined ? null : { ...run };
    },
    runItems: async (query) => page([], query.offset, query.limit),
    staged: async (query) => page([], query.offset, query.limit),
    stagedDetail: async (id) => {
      const row = this.staged.get(id);
      if (row === undefined) return null;
      const record = this.records.get(row.recordId)!;
      const detail: StagedDetail = {
        id: row.id,
        recordId: row.recordId,
        runId: row.runId,
        revision: row.revision,
        contentKind: row.contentKind,
        title: row.title,
        languageCode: row.languageCode,
        validation: row.validation,
        personalData: row.personalData,
        review: row.review,
        producedAt: row.producedAt,
        version: row.version,
        sourceId: row.sourceId,
        externalKey: record.externalKey,
        originalUrl: record.originalUrl,
        recordStatus: record.status as StagedDetail['recordStatus'],
        payload: row.payload,
        payloadChecksum: row.payloadChecksum,
        provenance: row.provenance,
        inputChecksum: row.inputChecksum,
        snapshotId: row.snapshotId,
        issues: row.issues,
        reviewNote: row.note,
        reviewedAt: null,
        categories: [],
        links: row.links,
      };
      return detail;
    },
    snapshot: async () => null,
    duplicates: async (query) => page([], query.offset, query.limit),
    topicMappings: async (query) => page([], query.offset, query.limit),
    legacyMappings: async (query) => page([], query.offset, query.limit),
    unresolvedLinks: async (query) => page([], query.offset, query.limit),
    errors: async (query) => page([], query.offset, query.limit),
    missingRecords: async (query) => page([], query.offset, query.limit),
    manifests: async (query) =>
      page([...this.manifests.values()], query.offset, query.limit),
    promotions: async (query) =>
      page([...this.promotions.values()], query.offset, query.limit),
    promotionEntries: async (query) => page([], query.offset, query.limit),
    assets: async (query) => page([], query.offset, query.limit),
    reconciliations: async (query) => page([], query.offset, query.limit),
  };
}

function page<T>(rows: readonly T[], offset: number, limit: number) {
  return { rows: rows.slice(offset, offset + limit), total: rows.length, offset };
}

/* ===========================================================================
 * Source access: a scripted fetcher and a synthetic JSON adapter
 * ========================================================================= */

export type Scripted = FetchOutcome | ((url: string) => FetchOutcome);

export function ok(
  url: string,
  body: string,
  contentType = 'application/json',
): FetchOutcome {
  return {
    kind: 'response',
    status: 200,
    requestedUrl: url,
    finalUrl: url,
    contentType,
    headers: { 'content-type': contentType },
    body: new TextEncoder().encode(body),
    retryAfter: null,
  };
}

export function status(
  url: string,
  code: number,
  retryAfter: string | null = null,
): FetchOutcome {
  return {
    kind: 'response',
    status: code,
    requestedUrl: url,
    finalUrl: url,
    contentType: 'text/plain',
    headers: {},
    body: new Uint8Array(),
    retryAfter,
  };
}

/** Answers each URL from a queue (the last answer repeats), counting every request. */
export class ScriptedFetcher implements MigrationFetchPort {
  readonly fetcherKey = 'fixture-fetch';
  readonly fetcherVersion = '1';
  readonly requests: string[] = [];
  readonly script = new Map<string, Scripted[]>();

  set(url: string, ...answers: Scripted[]): this {
    this.script.set(url, answers);
    return this;
  }

  async fetch(url: string): Promise<FetchOutcome> {
    this.requests.push(url);
    const queue = this.script.get(url);
    if (queue === undefined || queue.length === 0) return status(url, 404);
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    return typeof next === 'function' ? next(url) : next;
  }

  count(url: string): number {
    return this.requests.filter((request) => request === url).length;
  }
}

export const BASE = 'https://videos.fixture.invalid/';
export const pageUrl = (n: number, base = BASE) => `${base}videos/${n}`;

/** A synthetic video record, as the fixture adapter's JSON body carries it. */
export function videoBody(n: number, overrides: Partial<ParsedVideo> = {}): string {
  const record: ParsedVideo = {
    kind: 'media.video',
    title: `Lecture ${n}`,
    primaryLocale: 'en',
    languageCode: 'en',
    provider: 'youtube',
    providerReference: `https://www.youtube.com/watch?v=abcdefghi${String(n).padStart(2, '0')}`,
    labels: [],
    descriptionHtml: `<p>Description ${n}</p>`,
    publishedOn: '2020-01-01',
    durationSeconds: 600,
    legacyIdentifier: `video-${n}`,
    categories: [{ key: 'lectures', label: 'Lectures' }],
    links: [],
    assets: [],
    ...overrides,
  };
  return JSON.stringify(record);
}

/** Any synthetic parsed record, as the JSON adapter's body carries it. */
export function recordBody(record: ParsedRecord): string {
  return JSON.stringify(record);
}

/**
 * A synthetic adapter: discovery pages list `/videos/<n>` URLs under `base`,
 * retrieval fetches them, parsing reads the JSON body as a parsed record of
 * any kind. `pageSize` keys per page; `contentKind` is the kind it declares.
 */
export class JsonAdapter implements MigrationSourceAdapter {
  readonly adapterKey = 'fixture-json';
  adapterVersion = '1';
  readonly parserKey = 'fixture-json';
  readonly parserVersion = '1';
  contentKind: MigrationContentKind = 'media.video';
  accessMethod: 'http' | 'export' = 'http';

  constructor(
    readonly keys: number[],
    readonly pageSize = 10,
    readonly base = BASE,
  ) {}

  async discover(cursor: string | null, fetcher: MigrationFetchPort) {
    const start = cursor === null ? 0 : Number(cursor);
    const index = await fetcher.fetch(`${this.base}index?page=${start}`);
    if (index.kind !== 'response' || index.status !== 200)
      return { kind: 'outcome' as const, outcome: index };
    const slice = this.keys.slice(start, start + this.pageSize);
    const next =
      start + this.pageSize < this.keys.length ? String(start + this.pageSize) : null;
    return {
      kind: 'page' as const,
      items: slice.map((n) => ({
        externalKey: pageUrl(n, this.base),
        originalUrl: pageUrl(n, this.base),
        legacyIdentifier: null,
      })),
      next,
    };
  }

  async retrieve(item: PendingItem, fetcher: MigrationFetchPort) {
    const outcome = await fetcher.fetch(item.externalKey);
    if (outcome.kind === 'response' && outcome.status === 200)
      return {
        kind: 'evidence' as const,
        requestedUrl: outcome.requestedUrl,
        finalUrl: outcome.finalUrl,
        httpStatus: outcome.status,
        contentType: outcome.contentType,
        headers: outcome.headers,
        body: outcome.body,
      };
    return { kind: 'outcome' as const, outcome };
  }

  parse(evidence: { readonly body: Uint8Array }) {
    const text = new TextDecoder().decode(evidence.body);
    if (text === 'EXCLUDE') return { kind: 'excluded' as const, reason: 'not a video' };
    try {
      return { kind: 'parsed' as const, record: JSON.parse(text) as ParsedRecord };
    } catch {
      return { kind: 'failed' as const, detail: 'not JSON' };
    }
  }
}

/** Every index page answers 200. */
export function indexPages(
  fetcher: ScriptedFetcher,
  keys: number,
  pageSize = 10,
  base = BASE,
): void {
  for (let start = 0; start < Math.max(keys, 1); start += pageSize)
    fetcher.set(`${base}index?page=${start}`, ok(`${base}index?page=${start}`, '[]'));
}

export class FakeStorage implements MigrationAssetStoragePort {
  readonly stored: string[] = [];
  async store(input: {
    readonly bytes: Uint8Array;
    readonly declaredMediaType: string | null;
  }) {
    const assetId = `00000000-0000-4000-9000-${String(this.stored.length + 1).padStart(12, '0')}`;
    this.stored.push(assetId);
    return {
      status: 'stored' as const,
      assetId,
      mediaType: input.declaredMediaType ?? 'application/octet-stream',
      byteSize: input.bytes.byteLength,
      checksum: sha256(input.bytes),
      clean: true,
    };
  }
}

/* ===========================================================================
 * Publication target and promotion destination
 * ========================================================================= */

/** Where each publishable kind's record lives, as its domain's public path. */
const TARGET_PATHS: Readonly<Record<MigrationPublishableKind, string>> = Object.freeze({
  'media.video': '/watch/videos',
  'library.work': '/library/books',
  'library.magazine': '/library/magazines',
  'library.magazine-issue': '/library/magazines/issues',
  'editorial.news': '/news',
  'editorial.article': '/articles',
});

type PublishInput = Parameters<MigrationPublicationTargetPort['publish']>[0];

/**
 * A Layer-4 target for the publishable kinds it is told it supports (a video
 * by default). As a real publisher: a RESUMED entry adopts what an
 * interrupted publication made; a fresh entry meeting an existing record of
 * the same kind and slug is refused.
 */
export class FakeTarget implements MigrationPublicationTargetPort {
  readonly made = new Map<
    string,
    {
      id: string;
      kind: MigrationPublishableKind;
      slug: string;
      version: number;
      state: string;
      referenced: boolean;
    }
  >();
  publishCalls = 0;
  withdrawCalls = 0;
  unavailableFor = new Set<string>();
  refuseSlugs = new Map<string, string>();
  readonly actors: string[] = [];
  /** The `resumed` flag of every publish call, in order. */
  readonly resumedFlags: boolean[] = [];
  /** Every publish input, in order — what the target was handed. */
  readonly inputs: PublishInput[] = [];
  /** The stage every publication reports (`in-review` for a two-person domain). */
  stage: TargetStage = 'public';
  /** A misbehaving target: reports a target of this kind instead of the entry's. */
  answerKind: MigrationPublishableKind | null = null;
  /** Called before a publication is made — e.g. to resolve a reference. */
  beforePublish: ((input: PublishInput) => Promise<void>) | null = null;
  private next = 0;

  constructor(
    readonly kinds: ReadonlySet<MigrationContentKind> = new Set(['media.video']),
  ) {}

  supports(kind: MigrationContentKind): boolean {
    return this.kinds.has(kind);
  }

  async publish(input: PublishInput) {
    this.actors.push(input.actor.accountId);
    this.resumedFlags.push(input.resumed);
    this.inputs.push(input);
    if (!('slug' in input.payload)) throw new Error('a publishable payload has a slug');
    const slug = input.payload.slug;
    if (this.unavailableFor.has(slug)) return { status: 'unavailable' as const };
    this.publishCalls += 1;
    const refusalReason = this.refuseSlugs.get(slug);
    if (refusalReason !== undefined)
      return { status: 'refused' as const, reason: refusalReason };
    if (this.beforePublish !== null) await this.beforePublish(input);
    let made = [...this.made.values()].find(
      (candidate) => candidate.kind === input.kind && candidate.slug === slug,
    );
    if (made !== undefined && !input.resumed)
      return { status: 'refused' as const, reason: 'target-exists' };
    if (made === undefined) {
      this.next += 1;
      made = {
        id: `00000000-0000-4000-a000-${String(this.next).padStart(12, '0')}`,
        kind: input.kind,
        slug,
        version: 1,
        state: 'published',
        referenced: false,
      };
      this.made.set(made.id, made);
    }
    return {
      status: 'published' as const,
      target: { kind: this.answerKind ?? made.kind, id: made.id },
      stage: this.stage,
      version: made.version,
      canonicalPath: `${TARGET_PATHS[made.kind]}/${made.slug}`,
    };
  }

  /** The record a typed reference names — only when the kind agrees too. */
  private find(target: MigrationTargetRef) {
    const made = this.made.get(target.id);
    return made !== undefined && made.kind === target.kind ? made : undefined;
  }

  async inspect(input: Parameters<MigrationPublicationTargetPort['inspect']>[0]) {
    this.actors.push(input.actor.accountId);
    const made = this.find(input.target);
    return made === undefined
      ? null
      : { exists: true, version: made.version, referencedByPeople: made.referenced };
  }

  async withdraw(input: Parameters<MigrationPublicationTargetPort['withdraw']>[0]) {
    this.withdrawCalls += 1;
    const made = this.find(input.target);
    if (made === undefined) return { status: 'refused' as const, reason: 'not-found' };
    if (made.version !== input.expectedVersion)
      return { status: 'refused' as const, reason: 'conflict' };
    made.state = 'archived';
    made.version += 1;
    return { status: 'withdrawn' as const, version: made.version };
  }
}

export class FakeDestination implements MigrationPromotionDestinationPort {
  readonly destination = 'bundle' as const;
  readonly puts = new Map<string, number>();
  async put(item: PromotionItem) {
    this.puts.set(item.promotionEntryId, (this.puts.get(item.promotionEntryId) ?? 0) + 1);
    return { destinationRef: `bundle/${item.promotionEntryId}.json` };
  }
}
