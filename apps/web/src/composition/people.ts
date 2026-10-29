import 'server-only';

import { createPeoplePersistence, createPeopleReader } from '@minhaj/database';
import type { ContributorAccountPort } from '@minhaj/contracts/people';

import { createPeopleService, type PeopleService } from '@/contexts/people-contributors';
import { identityRuntime } from '@/composition/identity';
import { storageRuntime } from '@/composition/storage';

/**
 * The People & Contributors composition root.
 *
 * Layer 4 is the only place that knows both a port and its adapter
 * (ARCHITECTURE.md §3.1.1). The People context is handed three interfaces and
 * can reach neither the Prisma client nor the SQL behind them.
 *
 * SERVER-ONLY. The marker travels with the file, so a Client Component that
 * imports this — directly or through any chain — fails the build rather than
 * pulling database code into the browser.
 *
 * THIS ROOT IS WHERE THE ONE PERMITTED EDGE IS WIRED, and it is worth being
 * precise about why it is wired HERE rather than inside the context.
 *
 * DOMAIN_MODEL.md §3.1 permits People to depend on Identity & Access, and §3.3
 * says cross-context composition is "an application-layer responsibility". If
 * the People context imported the Identity context directly it would acquire
 * Identity's whole public interface — sign-in, closure, privileged
 * administration — in order to use two read operations. Instead it declares
 * `ContributorAccountPort`, two methods wide, and this file implements it by
 * calling Identity's own services. The edge exists, it is the one the allowlist
 * grants, and it is exactly as wide as the thing it is for.
 *
 * WHY THE CAPABILITY PROJECTION IS IDENTITY'S CALL AND NOT A LOCAL COMPUTATION.
 * `contributorCapabilities` is implemented by the authorisation service in
 * `packages/server-core` — the same Identity-owned service every authorisation
 * decision goes through — so the four projections are computed from the same
 * live permission read that guards a mutation: current assignments, active
 * roles, current bundle, active account. Recomputing them here from a permission
 * list would be a second opinion about Identity's authority, and the two would
 * disagree the first time Identity's rules changed (DOMAIN_MODEL.md §4.5).
 */

export interface PeopleRuntime {
  readonly people: PeopleService;
}

let runtime: PeopleRuntime | null = null;

/**
 * Identity's answers to the two questions People is allowed to ask.
 *
 * Built per process alongside the service. It closes over `identityRuntime()`
 * rather than receiving a client, so what People holds is two async functions —
 * not an account reader, not a permission set, and nothing it could widen.
 */
function contributorAccounts(): ContributorAccountPort {
  return {
    async capabilities(accountId) {
      return identityRuntime().authorization.contributorCapabilities(accountId);
    },

    async closedAccounts(accountIds) {
      // Identity's OWN answer about its own lifecycle. People does not know
      // what statuses exist, cannot ask for accounts by any other property, and
      // receives back only identifiers it supplied.
      return identityRuntime().administration.closedAccounts(accountIds);
    },
  };
}

/**
 * Builds the People runtime once per process.
 *
 * Lazy, because constructing it opens no connection: the Prisma client behind
 * the adapters is itself lazily constructed, so importing this module costs
 * nothing until something actually reads a contributor.
 */
export function peopleRuntime(): PeopleRuntime {
  if (runtime !== null) return runtime;

  runtime = {
    people: createPeopleService({
      reader: createPeopleReader(),
      people: createPeoplePersistence(),
      accounts: contributorAccounts(),
      // Storage's one narrow answer, asked before a portrait is recorded.
      images: {
        servableImages: async (ids) => (await storageRuntime()).servableImages(ids),
      },
    }),
  };

  return runtime;
}
