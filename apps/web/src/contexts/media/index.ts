/**
 * Media — THE public interface (bounded context #8, DOMAIN_MODEL.md §11).
 *
 * The only path into the context: a cross-context or Layer-4 import that
 * reaches past this file fails the architecture gate (ARCHITECTURE.md §6.3
 * rule 4). No Prisma, no adapter, no transaction handle — the context depends on
 * the ports in `@minhaj/contracts/media` and is handed their implementations by
 * Layer 4.
 *
 * PHASE 10 DELIVERS VIDEO, SERIES AND PLAYLIST. Audio and galleries are Media's
 * too and arrive with Phases 11 and 12; nothing here anticipates them.
 */
export { createMediaService, mediaFailure } from './application/service.ts';
export { createMediaReadService } from './application/read-service.ts';
export { createVideoSearchSource } from './application/search-projection.ts';
