import 'server-only';

import { identityRuntime } from './identity';
import { createMigrationTargets, routeMigrationTargets } from './migration-targets';
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
 *   - THE TARGETS are the owning domains' public services — Media, Library
 *     and Editorial (`./migration-targets.ts`) — one per publishable kind,
 *     routed fail-closed (`./migration-target-router.ts`), under each
 *     domain's OWN live authority and the owner references their compositions
 *     use, so a migrated record meets every rule a hand-made one does.
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
    target: routeMigrationTargets(
      createMigrationTargets({
        authority: { permits: livePermits(live) },
        references: ownerReferences,
      }),
    ),
    storage: migrationAssetStorage(storageRuntime),
  });
  return runtime;
}
