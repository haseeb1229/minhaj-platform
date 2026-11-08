import 'server-only';

import {
  createAuthorizationReader,
  createQuranCanonical,
  createQuranPersistence,
} from '@minhaj/database';
import type { PrivilegedActor, ResolvedSession } from '@minhaj/contracts/identity';
import type { QuranAuthorityPort } from '@minhaj/contracts/quran';
import { createAuthorizationService } from '@minhaj/server-core/authorization';

import {
  createQuranCanonicalService,
  createQuranService,
  type QuranCanonicalService,
  type QuranService,
} from '../contexts/quran/index.ts';
import { composeMigrationRunner } from './migration-runner.ts';
import type { MigrationServices } from './migration-wiring.ts';

/**
 * The Quran REFERENCE-PREVIEW tooling's composition root — Layer 4
 * (Rebaseline R2; owner decision 2026-11-06).
 *
 * WHY A ROOT OF ITS OWN. The import runs under plain Node in the operations
 * image, outside the Next bundler, like the migration tooling
 * (`./migration-runner.ts`), and the tool (`scripts/quran/reference-runtime.ts`)
 * holds no database capability of its own. This wires Quran's ports to their
 * adapters exactly as the administrative root (`./quran.ts`) does — the SAME
 * services, the SAME live authority — without that root's Next-only imports.
 *
 * WHAT IT SUPPLIES:
 *
 *   - `requireCanonicalActor`: Identity's privileged-action gate for
 *     `quran.editCanonical` with a live `quran-canonical-edit` step-up — the
 *     only way to obtain the actor corpus acceptance demands. The canonical
 *     service re-verifies that exact actor through THIS authorisation service,
 *     and the database procedure re-checks the grant before it writes.
 *   - `canonical` and `quran`: Quran's canonical and administrative services
 *     (`quran.administer`, re-read live on every call).
 *   - `migration`: Migration & Provenance's read and source services, under
 *     `migration.read`, for the staged Irfan-ul-Quran revisions.
 *
 * THE DATABASE is whatever `DATABASE_URL` names — the RUNTIME principal's URL.
 * Registering sources and activating the corpus are the OWNER's acts and are
 * not reachable from here.
 *
 * NODE-RUNNABLE: packages and explicit `.ts` paths only — never the `@/` alias.
 */

export interface QuranReferenceRunner {
  requireCanonicalActor(session: ResolvedSession): Promise<PrivilegedActor | null>;
  readonly canonical: QuranCanonicalService;
  readonly quran: QuranService;
  readonly migration: Pick<MigrationServices, 'read' | 'sources'>;
}

export function composeQuranReferenceRunner(
  env: Record<string, string | undefined> = process.env,
): QuranReferenceRunner {
  const authorization = createAuthorizationService({
    reader: createAuthorizationReader(),
  });
  const authority: QuranAuthorityPort = {
    permits: (accountId, permission) =>
      authorization.hasPermission(accountId, permission),
    verifyCanonical: (actor) =>
      authorization.verifyPrivilegedActor({
        actor,
        permission: 'quran.editCanonical',
        stepUp: 'quran-canonical-edit',
      }),
  };
  const persistence = createQuranPersistence();
  const migration = composeMigrationRunner(env);

  return {
    async requireCanonicalActor(session) {
      const outcome = await authorization.requirePrivilegedAction({
        session,
        permission: 'quran.editCanonical',
        stepUp: 'quran-canonical-edit',
      });
      return outcome.state === 'allowed' ? outcome.actor : null;
    },
    canonical: createQuranCanonicalService({
      canonical: createQuranCanonical(),
      persistence,
      authority,
    }),
    quran: createQuranService({ persistence, authority }),
    migration: { read: migration.read, sources: migration.sources },
  };
}
