import 'server-only';

import { createGlobalPersistence, createGlobalReferences } from '@minhaj/database';

import {
  createCentreReferences,
  createGlobalService,
  type CentreReferences,
  type GlobalService,
} from '@/contexts/global-network';
import { identityRuntime } from './identity';

/**
 * The ADMINISTRATIVE Global Network composition root — Layer 4.
 *
 * The only place that knows both Global's ports and their adapters
 * (ARCHITECTURE.md §3.1.1). Global receives two interfaces — persistence and
 * authority — and can reach neither the Prisma client nor the SQL behind them.
 *
 * THE AUTHORITY PORT IS A LIVE READ, the same `hasPermission` every other
 * administrative runtime uses, so a revoked Global role denies the next action.
 * No profile and no role name is on this path (DOMAIN_MODEL.md §4.5).
 *
 * IT DOES NOT SERVE PUBLIC PAGES. `./global-read.ts` is the root for those, and
 * it reaches no Identity at all.
 */
const authority = {
  permits: (accountId: string, permission: string) =>
    identityRuntime().authorization.hasPermission(accountId, permission),
};

let runtime: GlobalService | null = null;

export function globalRuntime(): GlobalService {
  return (runtime ??= createGlobalService({
    persistence: createGlobalPersistence(),
    authority,
  }));
}

let references: CentreReferences | null = null;

/**
 * Global's REFERENCE interface for other contexts' compositions — Editorial
 * asking which Centres an editor may choose for a NewsArticle. Identity, names
 * and lifecycle state only; the caller has already checked its own permission.
 */
export function centreReferences(): CentreReferences {
  return (references ??= createCentreReferences(createGlobalReferences()));
}
