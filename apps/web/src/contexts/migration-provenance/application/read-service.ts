import 'server-only';

import { z } from 'zod';

import {
  ASSET_VISIBILITIES,
  DUPLICATE_STATES,
  ERROR_RESOLUTIONS,
  ITEM_OUTCOMES,
  LEGACY_MAPPING_STATES,
  MANIFEST_STATES,
  MIGRATION_LIMITS,
  REVIEW_STATES,
  runRightsSchema,
  TOPIC_MAPPING_STATES,
  migrationIdSchema,
  migrationOffsetSchema,
  type AssetProvenanceRow,
  type CandidateKey,
  type ManifestEntryRecord,
  type ManifestRecord,
  type MigrationActor,
  type MigrationAuthorityPort,
  type MigrationPromotionPort,
  type MigrationPublicationPort,
  type MigrationReadPort,
  type MigrationSourcePort,
  type PromotionRecord,
  type RunRecord,
  type SnapshotMeta,
  type PersonalDataFindingRecord,
  type StagedDetail,
} from '@minhaj/contracts/migration';

import { MigrationRefusal } from '../domain/refusal.ts';
import { READ, candidateFingerprint, createGate, guarded } from './shared.ts';

const offset = migrationOffsetSchema.default(0);
const id = migrationIdSchema;

const filters = {
  runs: z.object({ sourceId: id.nullable().default(null), offset }).strict(),
  runItems: z
    .object({
      runId: id,
      outcome: z.enum(ITEM_OUTCOMES).nullable().default(null),
      offset,
    })
    .strict(),
  staged: z
    .object({
      review: z.enum(REVIEW_STATES).nullable().default(null),
      runId: id.nullable().default(null),
      unmanifested: z.boolean().default(false),
      offset,
    })
    .strict(),
  duplicates: z
    .object({ state: z.enum(DUPLICATE_STATES).nullable().default(null), offset })
    .strict(),
  topicMappings: z
    .object({ state: z.enum(TOPIC_MAPPING_STATES).nullable().default(null), offset })
    .strict(),
  legacyMappings: z
    .object({ state: z.enum(LEGACY_MAPPING_STATES).nullable().default(null), offset })
    .strict(),
  errors: z
    .object({
      resolution: z.enum(ERROR_RESOLUTIONS).nullable().default(null),
      runId: id.nullable().default(null),
      offset,
    })
    .strict(),
  manifests: z
    .object({ state: z.enum(MANIFEST_STATES).nullable().default(null), offset })
    .strict(),
  promotionEntries: z.object({ promotionId: id, offset }).strict(),
  assets: z
    .object({
      recordId: id.nullable().default(null),
      runId: id.nullable().default(null),
      visibility: z.enum(ASSET_VISIBILITIES).nullable().default(null),
      offset,
    })
    .strict(),
  page: z.object({ offset }).strict(),
  runApproval: z.object({ runId: id, offset }).strict(),
  runRights: z
    .object({
      runId: id,
      host: runRightsSchema.shape.host.nullable().default(null),
      offset,
    })
    .strict(),
  runManifest: z.object({ runId: id }).strict(),
};

/**
 * Every operator read, under `migration.read`: bounded pages of
 * `MIGRATION_LIMITS.page`, validated filters, deterministic order (the
 * adapter's), and never a raw body — raw evidence is read only through the
 * audited raw service.
 *
 * Dependencies (ports only):
 *  - `read`        — `MigrationReadPort`;
 *  - `publication` — `MigrationPublicationPort` (`manifest` only: one manifest with its entries);
 *  - `promotions`  — `MigrationPromotionPort` (`promotion` only);
 *  - `sources`     — `MigrationSourcePort` (`source` only: a run's registered hosts, R2);
 *  - `authority`   — `MigrationAuthorityPort`.
 */
export function createMigrationReadService(deps: {
  readonly read: MigrationReadPort;
  readonly publication: Pick<MigrationPublicationPort, 'manifest'>;
  readonly promotions: Pick<MigrationPromotionPort, 'promotion'>;
  readonly sources: Pick<MigrationSourcePort, 'source'>;
  readonly authority: MigrationAuthorityPort;
}) {
  const gate = createGate(deps.authority);
  const { read } = deps;
  const limit = MIGRATION_LIMITS.page;

  async function query<S extends z.ZodType>(
    actor: MigrationActor,
    schema: S,
    input: unknown,
  ): Promise<z.output<S>> {
    const { value } = await gate.authorised(actor, READ, schema, input ?? {});
    return value;
  }

  /** One row by id: `null` when the id is malformed or names nothing. */
  async function one<T>(
    actor: MigrationActor,
    value: unknown,
    load: (id: string) => Promise<T | null>,
  ): Promise<T | null> {
    await gate.holds(actor, READ);
    const parsed = id.safeParse(value);
    if (!parsed.success) return null;
    return guarded(load(parsed.data));
  }

  return {
    async runs(actor: MigrationActor, input?: unknown) {
      const value = await query(actor, filters.runs, input);
      return guarded(read.runs({ ...value, limit }));
    },
    async run(actor: MigrationActor, runId: unknown): Promise<RunRecord | null> {
      return one(actor, runId, (value) => read.run(value));
    },
    async runItems(actor: MigrationActor, input: unknown) {
      const value = await query(actor, filters.runItems, input);
      return guarded(read.runItems({ ...value, limit }));
    },
    async staged(actor: MigrationActor, input?: unknown) {
      const value = await query(actor, filters.staged, input);
      return guarded(read.staged({ ...value, limit }));
    },
    async stagedDetail(
      actor: MigrationActor,
      stagedId: unknown,
    ): Promise<StagedDetail | null> {
      return one(actor, stagedId, (value) => read.stagedDetail(value));
    },
    /**
     * Phase 30-RD. A revision's personal-data findings: each one's type, the
     * words around it with every match redacted, and its decision — never the
     * matched text, which only the audited raw-evidence preview shows.
     */
    async personalDataFindings(
      actor: MigrationActor,
      stagedId: unknown,
    ): Promise<readonly PersonalDataFindingRecord[]> {
      return (
        (await one(actor, stagedId, (value) => read.personalDataFindings(value))) ?? []
      );
    },
    /** A snapshot's metadata — never its body. */
    async snapshot(
      actor: MigrationActor,
      snapshotId: unknown,
    ): Promise<SnapshotMeta | null> {
      return one(actor, snapshotId, (value) => read.snapshot(value));
    },
    async duplicates(actor: MigrationActor, input?: unknown) {
      const value = await query(actor, filters.duplicates, input);
      return guarded(read.duplicates({ ...value, limit }));
    },
    async topicMappings(actor: MigrationActor, input?: unknown) {
      const value = await query(actor, filters.topicMappings, input);
      return guarded(read.topicMappings({ ...value, limit }));
    },
    async legacyMappings(actor: MigrationActor, input?: unknown) {
      const value = await query(actor, filters.legacyMappings, input);
      return guarded(read.legacyMappings({ ...value, limit }));
    },
    async unresolvedLinks(actor: MigrationActor, input?: unknown) {
      const value = await query(actor, filters.page, input);
      return guarded(read.unresolvedLinks({ ...value, limit }));
    },
    async errors(actor: MigrationActor, input?: unknown) {
      const value = await query(actor, filters.errors, input);
      return guarded(read.errors({ ...value, limit }));
    },
    async missingRecords(actor: MigrationActor, input?: unknown) {
      const value = await query(actor, filters.page, input);
      return guarded(read.missingRecords({ ...value, limit }));
    },
    async manifests(actor: MigrationActor, input?: unknown) {
      const value = await query(actor, filters.manifests, input);
      return guarded(read.manifests({ ...value, limit }));
    },
    async manifest(
      actor: MigrationActor,
      manifestId: unknown,
    ): Promise<{
      readonly manifest: ManifestRecord;
      readonly entries: readonly ManifestEntryRecord[];
    } | null> {
      return one(actor, manifestId, (value) => deps.publication.manifest(value));
    },
    async promotions(actor: MigrationActor, input?: unknown) {
      const value = await query(actor, filters.page, input);
      return guarded(read.promotions({ ...value, limit }));
    },
    async promotion(
      actor: MigrationActor,
      promotionId: unknown,
    ): Promise<PromotionRecord | null> {
      return one(actor, promotionId, (value) => deps.promotions.promotion(value));
    },
    async promotionEntries(actor: MigrationActor, input: unknown) {
      const value = await query(actor, filters.promotionEntries, input);
      return guarded(read.promotionEntries({ ...value, limit }));
    },
    async assets(actor: MigrationActor, input?: unknown) {
      const value = await query(actor, filters.assets, input);
      return guarded(read.assets({ ...value, limit }));
    },
    async reconciliations(actor: MigrationActor, input?: unknown) {
      const value = await query(actor, filters.page, input);
      return guarded(read.reconciliations({ ...value, limit }));
    },
    /** R2. One acquisition — for its administrative preview — or null. */
    async asset(
      actor: MigrationActor,
      provenanceId: unknown,
    ): Promise<AssetProvenanceRow | null> {
      return one(actor, provenanceId, (value) => read.asset(value));
    },

    /**
     * R2. A run's approval candidates as a person reviews them before a
     * run-wide approval: one page of them, the counts of what the act leaves
     * and why, and the size and fingerprint of the WHOLE candidate set the
     * confirmation names. Null when the run does not exist.
     */
    async runApproval(actor: MigrationActor, input: unknown) {
      const { runId, offset: at } = await query(actor, filters.runApproval, input);
      const run = await guarded(read.run(runId));
      if (run === null) return null;
      const [counts, page, keys] = await Promise.all([
        guarded(read.runApprovalCounts(runId)),
        guarded(read.approvalCandidates({ runId, offset: at, limit })),
        guarded(read.approvalCandidateKeys(runId, MIGRATION_LIMITS.runCandidates)),
      ]);
      return { run, counts, page, confirmation: confirmationOf(keys) };
    },

    /**
     * R2. A run's pictures by registered host: each of its source's page and
     * asset hosts with how many rights candidates it serves; for the host
     * asked, one page of them and the confirmation over all of them. A host
     * the source does not register is refused `invalid`, never queried.
     */
    async runRights(actor: MigrationActor, input: unknown) {
      const { runId, host, offset: at } = await query(actor, filters.runRights, input);
      const run = await guarded(read.run(runId));
      if (run === null) return null;
      const source = await guarded(deps.sources.source(run.sourceId));
      if (source === null) return null;
      const registered = [
        ...source.hosts.map((name) => ({ host: name, role: 'page' as const })),
        ...source.assetHosts.map((name) => ({ host: name, role: 'asset' as const })),
      ];
      if (host !== null && !registered.some((entry) => entry.host === host))
        throw new MigrationRefusal('invalid');
      const hosts = await Promise.all(
        registered.map(async (entry) => ({
          ...entry,
          candidates: (
            await guarded(
              read.rightsCandidates({ runId, host: entry.host, offset: 0, limit: 1 }),
            )
          ).total,
        })),
      );
      if (host === null) return { run, hosts, host, page: null, confirmation: null };
      const [page, keys] = await Promise.all([
        guarded(read.rightsCandidates({ runId, host, offset: at, limit })),
        guarded(read.rightsCandidateKeys(runId, host, MIGRATION_LIMITS.runCandidates)),
      ]);
      return { run, hosts, host, page, confirmation: confirmationOf(keys) };
    },

    /**
     * R2. The confirmation over a run's manifest candidates — approved, valid,
     * publishable and held by no live manifest — and how many the next
     * run-wide manifest takes.
     */
    async runManifest(actor: MigrationActor, input: unknown) {
      const { runId } = await query(actor, filters.runManifest, input);
      const keys = await guarded(
        read.manifestCandidateKeys(runId, MIGRATION_LIMITS.runCandidates),
      );
      return {
        confirmation: confirmationOf(keys),
        next: Math.min(keys.length, MIGRATION_LIMITS.runManifestEntries),
      };
    },
  };
}

/** R2. What a person confirms a run-wide act over: the set's size and fingerprint. */
function confirmationOf(keys: readonly CandidateKey[]): {
  readonly count: number;
  readonly fingerprint: string;
} {
  return { count: keys.length, fingerprint: candidateFingerprint(keys) };
}

export type MigrationReadService = ReturnType<typeof createMigrationReadService>;
