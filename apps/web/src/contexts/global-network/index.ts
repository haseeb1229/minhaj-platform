/**
 * Global Network — THE public interface (bounded context #13, DOMAIN_MODEL.md
 * §17.1).
 *
 * The only path into the context: a cross-context or Layer-4 import that
 * reaches past this file fails the architecture gate (ARCHITECTURE.md §6.3
 * rule 4). No Prisma, no adapter, no transaction handle — the context depends on
 * the ports in `@minhaj/contracts/global` and is handed their implementations by
 * Layer 4.
 *
 * PHASE 16 DELIVERS Country, Region, City, Centre and CentreContact with
 * flexible parentage, Find a Centre, and the Centre reference interface that
 * Editorial's composition uses for centre-scoped News. Global depends on no
 * Editorial code: the edge runs one way only, Editorial → Global Network
 * (DOMAIN_MODEL.md §3.2).
 */
export { createGlobalService, type GlobalService } from './application/service.ts';
export { globalFailure } from './application/refusal.ts';
export {
  createCentreReferences,
  createGlobalReadService,
  type CentreReferences,
  type FinderResult,
  type GlobalReadService,
} from './application/read-service.ts';
