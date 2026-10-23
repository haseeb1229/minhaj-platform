import 'server-only';

import { identityRuntime } from './identity';
import { createMediaVideoTarget } from './migration-targets';
import {
  livePermits,
  migrationAssetStorage,
  migrationAuthority,
  migrationDependencies,
  migrationTopics,
  type MigrationServices,
} from './migration-wiring';
import { ownerReferences } from './owner-references';
import { storageRuntime } from './storage';
import { taxonomyRuntime } from './taxonomy';

/**
 * The WEB Migration & Provenance composition root — Layer 4 (Phase 29).
 *
 * The administrative surface behind `/admin/migration` reaches Migration only
 * through the seven services this returns, built by the one wiring the CLIs
 * share (`./migration-wiring.ts`). What only this process answers is supplied
 * here:
 *
 *   - AUTHORITY is Identity's, live: `hasPermission` for every ordinary key,
 *     and `verifyPrivilegedActor` for exactly `migration.publish` with a live
 *     `migration-publication` step-up — the actor a Server Action obtained
 *     from `requirePrivilegedAction`, re-verified at Migration's boundary and
 *     again by the database's own trigger.
 *   - TOPICS are Taxonomy's, through its public reference read.
 *   - THE TARGET is Media's public service (`./migration-targets.ts`), under
 *     Media's OWN live authority and the owner references Media's composition
 *     uses — so a migrated Video meets every rule a hand-made one does.
 *   - STORAGE is the foundation's service, narrowed to acquisition. No route
 *     serves a migrated asset.
 *
 * Lazy, like every runtime here: nothing connects until something is asked.
 */

let runtime: MigrationServices | null = null;

export function migrationRuntime(): MigrationServices {
  if (runtime !== null) return runtime;
  // The SAME authorisation service that minted the privileged actor, which is
  // what lets it re-verify that exact instance.
  const live = identityRuntime().authorization;

  runtime = migrationDependencies({
    authority: migrationAuthority(live),
    topics: migrationTopics((ids, locale) =>
      taxonomyRuntime().taxonomy.topicReferences(ids, locale),
    ),
    target: createMediaVideoTarget({
      authority: { permits: livePermits(live) },
      references: ownerReferences,
    }),
    storage: migrationAssetStorage(storageRuntime),
  });
  return runtime;
}
