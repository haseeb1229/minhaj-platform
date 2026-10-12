/**
 * Hadith — THE public interface (bounded context #6, DOMAIN_MODEL.md §9).
 *
 * The only path into the context: a cross-context or Layer-4 import that
 * reaches past this file fails the architecture gate (ARCHITECTURE.md §6.3
 * rule 4). No Prisma, no adapter, no transaction handle — the context depends on
 * the ports in `@minhaj/contracts/hadith` and is handed their implementations by
 * Layer 4.
 *
 * PHASE 19 DELIVERS source-qualified records — collection, source system,
 * edition and the source's own reference — with their exact text, chain and
 * sourced gradings, human verification, conflict evidence and the reviewed
 * public citation mapping, all changed only through the step-up-bound
 * canonical service; and the LAYERED records over them: Translation,
 * Commentary and Sciences guidance, each with its own lifecycle and source.
 *
 * HADITH READS NO OTHER CONTENT CONTEXT, and none reads Hadith. Quran, Media,
 * Library, Editorial, Fatwa and Learning are never imported here; Hadith and
 * the Quran are parallel religious contexts that share only Layer-0 exact-text
 * schemas, never each other.
 */
export {
  HADITH_REFUSAL_REASONS,
  HadithRefusal,
  hadithFailure,
  isHadithRefusalReason,
  type HadithRefusalReason,
} from './domain/refusal.ts';
export { createHadithService, type HadithService } from './application/service.ts';
export {
  createHadithCanonicalService,
  type HadithCanonicalLog,
  type HadithCanonicalLogDetail,
  type HadithCanonicalService,
} from './application/canonical-service.ts';
export { createHadithReadService } from './application/read-service.ts';
export {
  createHadithSearchProjection,
  hadithCitationPath,
} from './application/search-projection.ts';
