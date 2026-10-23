/**
 * Migration & Provenance — THE public interface (bounded context,
 * DOMAIN_MODEL.md §16).
 *
 * The only path into the context: a cross-context or Layer-4 import that
 * reaches past this file fails the architecture gate (ARCHITECTURE.md §6.3
 * rule 4). No Prisma, no adapter, no HTTP client, no transaction handle — the
 * context depends on the ports in `@minhaj/contracts/migration` and is handed
 * their implementations by Layer 4 or by `scripts/migration/`.
 *
 * PHASE 29 DELIVERS THE FRAMEWORK OVER FIXTURES: synthetic sources only
 * (`*.fixture.invalid`); a resumable, checkpointed pipeline that preserves raw
 * evidence, sanitises before staging, rewrites links only to mapped targets,
 * detects duplicates and incidental personal data, and reconciles every run;
 * human review; reversible publication into a target's PUBLIC interface; and
 * a reviewed promotion set. It depends on no target content context.
 *
 * RELATIVE IMPORTS ONLY inside this context, so the same code runs in Next and
 * in plain Node (`node --conditions=react-server`) for the tooling.
 */
export {
  MIGRATION_REFUSAL_REASONS,
  MigrationRefusal,
  asMigrationRefusal,
  isMigrationRefusalReason,
  migrationFailure,
  type MigrationRefusalReason,
} from './domain/refusal.ts';
export { NORMALIZER_VERSION } from './domain/normalize.ts';
export { legacyUrlDigest } from './domain/links.ts';
export { reconcile, type Reconciliation } from './domain/reconciliation.ts';
export {
  createMigrationSourceService,
  type MigrationSourceService,
} from './application/source-service.ts';
export {
  createMigrationPipelineService,
  type MigrationPipelineService,
  type PipelineRunInput,
  type PipelineRunOptions,
  type PipelineRunSummary,
} from './application/pipeline-service.ts';
export {
  createMigrationDecisionService,
  type MigrationDecisionService,
} from './application/decision-service.ts';
export {
  createMigrationRawService,
  rawDownloadHeaders,
  type MigrationRawService,
  type RawDownload,
  type RawPreview,
} from './application/raw-service.ts';
export {
  createMigrationPublicationService,
  type MigrationPublicationService,
  type PublicationSummary,
} from './application/publication-service.ts';
export {
  createMigrationPromotionService,
  type MigrationPromotionService,
  type PromotionExecuteInput,
  type PromotionSummary,
} from './application/promotion-service.ts';
export {
  createMigrationReadService,
  type MigrationReadService,
} from './application/read-service.ts';
