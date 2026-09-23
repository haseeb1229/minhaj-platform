import 'server-only';

/**
 * `@minhaj/search` — the Layer-0 search foundation.
 *
 * NOT A BOUNDED CONTEXT (ARCHITECTURE.md §6.1). It owns a derived projection and
 * the operational state of keeping it current; every searchable resource, and
 * every rule about whether it is public, belongs to its owning context.
 *
 * WHAT THIS SURFACE DELIBERATELY DOES NOT EXPORT: an engine, a query grammar, a
 * catalogue name, a Prisma client, a delegate, a transaction handle or a raw
 * query facility. The index is reached through `SearchIndexPort`, whose SQL
 * Server adapter lives in `packages/database` as the declared Layer-0 `search`
 * concern.
 */

export { createSearchService, SEARCH_RATE_RULE } from './service.ts';
export type { SearchOutcome, SearchService, SearchTopic } from './service.ts';

export type { SearchFormState } from './request.ts';
