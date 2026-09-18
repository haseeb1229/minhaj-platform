import 'server-only';

import { createTaxonomyPersistence, createTaxonomyReader } from '@minhaj/database';

import { createTaxonomyService, type TaxonomyService } from '@/contexts/taxonomy';

/**
 * The Taxonomy composition root.
 *
 * Layer 4 is the only place that knows both a port and its adapter
 * (ARCHITECTURE.md §3.1.1). The Taxonomy context is handed two interfaces and
 * can reach neither the Prisma client nor the SQL behind them.
 *
 * SERVER-ONLY. The marker travels with the file, so a Client Component that
 * imports this — directly or through any chain — fails the build rather than
 * pulling database code into the browser.
 *
 * A SEPARATE ROOT FROM `identity.ts`, deliberately. Taxonomy depends on Layer 0
 * and nothing else (DOMAIN_MODEL.md §3.1); wiring it inside the Identity
 * runtime would put the two contexts' dependencies in one object and make the
 * first accidental `identityRuntime().taxonomy` look reasonable. They are
 * composed side by side because they are peers, not neighbours.
 *
 * NO CONFIGURATION IS READ HERE. Taxonomy has no secrets, no provider and no
 * environment of its own — which is itself worth noticing, because a context
 * that needed one would be a context doing more than classifying things.
 */

export interface TaxonomyRuntime {
  readonly taxonomy: TaxonomyService;
}

let runtime: TaxonomyRuntime | null = null;

/**
 * Builds the Taxonomy runtime once per process.
 *
 * Lazy, because constructing it opens no connection: the Prisma client behind
 * the adapters is itself lazily constructed, so importing this module costs
 * nothing until something actually reads a topic.
 */
export function taxonomyRuntime(): TaxonomyRuntime {
  if (runtime !== null) return runtime;

  runtime = {
    taxonomy: createTaxonomyService({
      reader: createTaxonomyReader(),
      taxonomy: createTaxonomyPersistence(),
    }),
  };

  return runtime;
}
