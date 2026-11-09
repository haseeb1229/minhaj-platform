import 'server-only';

import { createAuthorizationReader, createEditorialPersistence } from '@minhaj/database';
import type { EditorialReferencesPort } from '@minhaj/contracts/editorial';
import type { PrivilegedActor, ResolvedSession } from '@minhaj/contracts/identity';
import { createAuthorizationService } from '@minhaj/server-core/authorization';

import {
  createEditorialService,
  type EditorialService,
} from '../contexts/editorial/index.ts';
import { composeMigrationRunner } from './migration-runner.ts';
import { livePermits, type MigrationServices } from './migration-wiring.ts';

/**
 * The STAGING HOST REVIEW tooling's composition root — Layer 4 (Rebaseline R2;
 * OWNER-DECISION-2026-11-09-STAGING-HOST-STEP-UP, OPEN_DECISIONS.md §4.2).
 *
 * WHAT IT IS FOR. On the staging host the operator performs, as named
 * administrators, the review and publication acts a person otherwise clicks in
 * `/admin/migration` and `/admin/editorial` for a completed run: the run-wide
 * approval, pictures by registered host, run-wide manifests, publishing a
 * manifest, and the second administrator's approve-and-publish of an
 * Editorial queue page. The tool (`scripts/review/review-runtime.ts`) runs
 * under plain Node in the operations image as the RUNTIME principal and holds
 * no database capability of its own. The web process never imports this
 * module — an architecture test holds that.
 *
 * THE SAME SERVICES, NOTHING ELSE. Migration's services are the migration
 * tooling's own (`./migration-runner.ts`, built from the one wiring the web
 * root shares), and the publisher is minted by Identity's privileged-action
 * gate for `migration.publish` with a live `migration-publication` step-up,
 * bound to the session the grant names — exactly the actor a Server Action
 * obtains. Editorial is its own service over its own adapter, under the live
 * authority the web root uses; every rule of the batch (both keys re-read
 * live, at most one queue page, self-approval refused, the approver's live
 * `content.review` at publication, one audit row per transition) is the
 * service's, unchanged.
 *
 * WHAT IT DOES NOT OFFER. Only the reads and acts the review needs: no source
 * registration, no run, no rollback, no promotion, and no Editorial authoring.
 * Editorial's reference questions (topics, people, languages, Centres,
 * Galleries, members, lead images) are asked only when content is created or
 * revised, which this root never offers, so each is answered "no": a write
 * that needed one would be refused, never admitted.
 *
 * SEARCH. An Editorial transition records its search request in the same
 * transaction (as every owner's write does); the web service's own search
 * sweep projects it with the web's configuration. No second search processor
 * runs here: one built from this process's environment would project every
 * due scope — other domains' included — under a configuration the web does
 * not have.
 *
 * WHERE IT MAY RUN. Only where the process declares, exactly, the staging
 * deployment AND a non-indexable build. Anywhere else the root refuses to be
 * built, whatever is asked of it.
 *
 * THE DATABASE is whatever `DATABASE_URL` names — the RUNTIME principal's URL.
 *
 * NODE-RUNNABLE: packages and explicit `.ts` paths only — never the `@/` alias.
 */

export interface StagingReviewRunner {
  readonly migration: Pick<
    MigrationServices,
    'decisions' | 'publication' | 'read' | 'sources'
  >;
  /**
   * Identity's gate for `migration.publish` with a live `migration-publication`
   * step-up on exactly this session of this account, or `null`. Every fact is
   * re-read live; nothing here is trusted from the caller but the identifiers.
   */
  publisher(input: {
    readonly accountId: string;
    readonly sessionId: string;
  }): Promise<PrivilegedActor | null>;
  readonly editorial: Pick<EditorialService, 'directory' | 'approveAndPublishMany'>;
}

/** Thrown when the process is not a declared non-indexable staging deployment. */
export class StagingReviewPostureRefusal extends Error {
  constructor() {
    super(
      'The staging review tooling runs only where the process declares exactly the staging deployment and PUBLIC_INDEXING_ENABLED=false.',
    );
    this.name = 'StagingReviewPostureRefusal';
  }
}

/** Every reference question a create or revise would ask, answered "no". */
const NO_AUTHORING: EditorialReferencesPort = Object.freeze({
  validTopics: async () => false,
  validContributors: async () => false,
  validLanguages: async () => false,
  selectableCentre: async () => false,
  selectableGallery: async () => false,
  selectableMembers: async () => false,
  usableImage: async () => false,
});

/**
 * The session shell the gate is handed. The gate reads the account's id and
 * re-reads its status and every authority fact LIVE — the permission, the
 * second-factor posture and a grant bound to THIS session — so nothing else
 * here is trusted.
 */
function sessionOf(accountId: string, sessionId: string): ResolvedSession {
  const now = new Date();
  return {
    sessionId,
    sessionCreatedAt: now,
    sessionExpiresAt: now,
    account: {
      id: accountId,
      email: '',
      emailVerified: true,
      name: '',
      locale: 'en',
      timezone: null,
      status: 'active',
      accountSetupCompletedAt: null,
      createdAt: now,
    },
  };
}

export function composeStagingReviewRunner(
  env: Record<string, string | undefined> = process.env,
): StagingReviewRunner {
  if (
    env['MINHAJ_DEPLOYMENT_ENVIRONMENT'] !== 'staging' ||
    env['PUBLIC_INDEXING_ENABLED'] !== 'false'
  )
    throw new StagingReviewPostureRefusal();

  const migration = composeMigrationRunner(env);
  const authorization = createAuthorizationService({
    reader: createAuthorizationReader(),
  });
  const editorial = createEditorialService({
    persistence: createEditorialPersistence(),
    authority: { permits: livePermits(authorization) },
    references: NO_AUTHORING,
    // Only the scheduled-publication sweep reports through this, and this
    // root never runs it.
    reportFailure: () => undefined,
  });

  return {
    migration: {
      decisions: migration.decisions,
      publication: migration.publication,
      read: migration.read,
      sources: migration.sources,
    },
    publisher: ({ accountId, sessionId }) =>
      migration.requirePrivilegedAction(sessionOf(accountId, sessionId)),
    editorial: {
      directory: (actor, kind, offset, state) =>
        editorial.directory(actor, kind, offset, state),
      approveAndPublishMany: (actor, value) =>
        editorial.approveAndPublishMany(actor, value),
    },
  };
}
