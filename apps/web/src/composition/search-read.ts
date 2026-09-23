import 'server-only';

import {
  createEditorialPublicReader,
  createLibraryPublicReader,
  createPeopleReader,
  createSearchIndex,
  createTaxonomyReader,
} from '@minhaj/database';
import { createSearchService, type SearchService } from '@minhaj/search';

import { failureLabel, isTransientDatabaseFailure } from './failure-label';
import { searchWiring } from './search-wiring';

/**
 * The Search runtime the PUBLIC `/search` page uses — Layer 4.
 *
 * SESSION-FREE AND SECRET-FREE BY CONSTRUCTION. It is built from owners' PUBLIC
 * readers and the Layer-0 index, and nothing in its module graph reaches
 * Identity, a session, an authentication library, a request header or the
 * secret-bearing server configuration — the public content-route contract
 * (ARCHITECTURE.md §8.1, §8.3.1.1), proven by the Phase-4 boundary test.
 * Throttling happens before the page renders (`search-admission.ts`).
 *
 * HOW A PUBLIC FAILURE IS REPORTED. The structured application logger is
 * composed from the secret-bearing configuration, which this graph may not
 * reach, so a failure here is written to standard error — the channel Next.js
 * itself uses for an error thrown by any public route — and it carries
 * IDENTIFIERS ONLY: the operation and the database's own error class. Never the
 * query a visitor typed, never a message, never content (SECURITY_BASELINE.md
 * §19.2). The visitor sees the honest "unavailable" state, never a false empty
 * result.
 *
 * The operator and background paths use `search.ts`, which builds the same
 * service with the structured logger.
 */

export type SearchReport = (operation: string, error: unknown) => void;

export function buildSearchService(report: SearchReport): SearchService {
  const wiring = searchWiring({
    taxonomy: createTaxonomyReader(),
    people: createPeopleReader(),
    editorial: createEditorialPublicReader(),
    library: createLibraryPublicReader(),
  });

  return createSearchService({
    index: createSearchIndex(),
    sources: wiring.sources,
    targets: wiring.targets,
    resolveTopic: wiring.resolveTopic,
    report,
  });
}

function reportPublic(operation: string, error: unknown): void {
  console.error(
    JSON.stringify({
      level: 'error',
      operation,
      error: failureLabel(error),
      transient: isTransientDatabaseFailure(error),
      msg: 'Public search failed; the visitor was shown the unavailable state.',
    }),
  );
}

let runtime: SearchService | null = null;

export function searchReadRuntime(): SearchService {
  return (runtime ??= buildSearchService(reportPublic));
}
