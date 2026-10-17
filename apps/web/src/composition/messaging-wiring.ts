import 'server-only';

import {
  createAuditWriter,
  createLearningRelationshipReader,
  createMessagingPersistence,
  createRateLimiter,
  rateLimitKey,
} from '@minhaj/database';
import type { ServerEnv } from '@minhaj/contracts/env/server';
import type {
  MessagingAccountPort,
  MessagingAttachmentStoragePort,
  MessagingAuthorityPort,
} from '@minhaj/contracts/messaging';
import type { LearningLiveTeachingPort } from '@minhaj/contracts/learning';
import {
  denyAllPeers,
  type MessagingServiceDependencies,
} from '@minhaj/server-core/messaging';
import { createLearningRelationshipService } from '@minhaj/server-core/relationships';

import { limiterConfigurationOf } from './identity-mechanics.ts';

/**
 * Messaging's dependencies — ONE wiring for both processes (Phase 25).
 *
 * The web process builds its `MessagingService` from this, and the realtime
 * process builds its narrowed realtime view of the SAME service from this
 * (ARCHITECTURE.md §3.1, §3.3). Every port Messaging asks is its owner's, live:
 * Learning's current-relationship answer through Learning's own service and
 * reader, Identity's live keys and closed accounts as each process's Identity
 * runtime answers them, and the student-to-student policy as `denyAllPeers`
 * and nothing else — there is no setting here that turns it on.
 *
 * NODE-RUNNABLE. Imported by the realtime process outside the Next bundler, so
 * it names packages and explicit `.ts` paths only — never the `@/` alias.
 */

/** What Identity answers Messaging, wired by each process's own Identity runtime. */
export interface MessagingIdentityAnswers {
  readonly liveTeachingAssignments: LearningLiveTeachingPort['liveTeachingAssignments'];
  readonly permits: MessagingAuthorityPort['permits'];
  readonly closedAccounts: MessagingAccountPort['closedAccounts'];
}

export function messagingDependencies(input: {
  readonly environment: ServerEnv;
  readonly identity: MessagingIdentityAnswers;
  readonly storage: MessagingAttachmentStoragePort;
}): MessagingServiceDependencies {
  const configuration = limiterConfigurationOf(input.environment);
  return {
    persistence: createMessagingPersistence(),
    teaching: createLearningRelationshipService({
      reader: createLearningRelationshipReader(),
      identity: { liveTeachingAssignments: input.identity.liveTeachingAssignments },
    }),
    authority: { permits: input.identity.permits },
    // Identity's OWN answer about its own lifecycle, and nothing more.
    accounts: { closedAccounts: input.identity.closedAccounts },
    peers: denyAllPeers,
    storage: input.storage,
    audit: createAuditWriter(),
    limiter: createRateLimiter(configuration),
    limitKey: (purpose, subject) => rateLimitKey({ purpose, subject, configuration }),
  };
}
