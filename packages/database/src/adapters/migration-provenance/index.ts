/**
 * Migration & Provenance's persistence adapter — semantically owned by that
 * context (ARCHITECTURE.md §3.1.1) and physically here. It reads and writes
 * only Migration's own tables; User, Topic, Asset and Video are reached only
 * as the typed foreign keys its rows hold (and by the migration's own
 * triggers), and no other context's table is written. No Prisma capability
 * leaves it: the surface is the ports' factories and the one refusal type.
 */
export { MigrationDataError } from './errors.ts';
export { createMigrationDecisions } from './decisions.ts';
export { createMigrationPipeline } from './pipeline.ts';
export { createMigrationPromotion } from './promotion.ts';
export { createMigrationPublication } from './publication.ts';
export { createMigrationRaw } from './raw.ts';
export { createMigrationReader } from './reader.ts';
export { createMigrationSources } from './sources.ts';
