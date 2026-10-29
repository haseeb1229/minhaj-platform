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
  TOPIC_MAPPING_STATES,
  migrationIdSchema,
  migrationOffsetSchema,
  type ManifestEntryRecord,
  type ManifestRecord,
  type MigrationActor,
  type MigrationAuthorityPort,
  type MigrationPromotionPort,
  type MigrationPublicationPort,
  type MigrationReadPort,
  type PromotionRecord,
  type RunRecord,
  type SnapshotMeta,
  type StagedDetail,
} from '@minhaj/contracts/migration';

import { READ, createGate, guarded } from './shared.ts';

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
 *  - `authority`   — `MigrationAuthorityPort`.
 */
export function createMigrationReadService(deps: {
  readonly read: MigrationReadPort;
  readonly publication: Pick<MigrationPublicationPort, 'manifest'>;
  readonly promotions: Pick<MigrationPromotionPort, 'promotion'>;
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
  };
}

export type MigrationReadService = ReturnType<typeof createMigrationReadService>;
