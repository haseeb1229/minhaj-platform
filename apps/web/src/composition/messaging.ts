import 'server-only';

import {
  createAuditWriter,
  createLearningRelationshipReader,
  createMessagingPersistence,
  createRateLimiter,
  rateLimitKey,
} from '@minhaj/database';
import type { MessagingAttachmentStoragePort } from '@minhaj/contracts/messaging';
import {
  createMessagingService,
  denyAllPeers,
  type MessagingService,
} from '@minhaj/server-core/messaging';
import { createLearningRelationshipService } from '@minhaj/server-core/relationships';

import { serverEnv } from '@/config/server-env';
import { identityRuntime } from './identity';
import { storageRuntime } from './storage';

/**
 * The Messaging composition root — Layer 4 (Phase 24).
 *
 * The only place that knows Messaging's ports and their adapters together
 * (ARCHITECTURE.md §3.1.1). Messaging's service is HOSTED in
 * `@minhaj/server-core/messaging` because the Phase-25 realtime transport must
 * reach the same decisions through the same code; this file wires it once for
 * the web process and adds no rule of its own.
 *
 * EVERY ANSWER MESSAGING ASKS FOR IS ITS OWNER'S, LIVE:
 *
 *   - Learning's current teaching relationship, through Learning's own
 *     relationship service and reader — Messaging never reads a Course, an
 *     Enrolment or a teaching scope. Its teacher half rests on Identity's
 *     live `teaching.perform` assignments, re-asked on every question.
 *   - Identity's live `messaging.support` / `messaging.moderate` answer and
 *     Identity's own word on which accounts are closed.
 *   - The student-to-student policy is `denyAllPeers` and nothing else: while
 *     OPEN_DECISIONS.md §2.5 is open there is no switch, setting or key here
 *     that turns it on.
 *   - Storage, narrowed to store / open / release. It is resolved lazily on
 *     first use, so importing this module (a build collecting page data) never
 *     needs a storage root.
 *
 * NAMES ARE PRESENTATION, NEVER AUTHORITY. `names` turns the participant ids of
 * a conversation the caller has ALREADY been allowed to read into display
 * names — Identity's name-only answer, active accounts only. A missing name is
 * simply absent; it decides nothing.
 */

export interface MessagingRuntime {
  readonly service: MessagingService;
  /**
   * Display names for accounts the caller is ALREADY authorised to show — the
   * participants of a conversation it has just read. Identity's
   * `participantNames` (name only, active accounts only). Missing ids are absent
   * from the map. At most one hundred ids are asked about.
   */
  names(accountIds: readonly string[]): Promise<ReadonlyMap<string, string>>;
}

/** Identity's name read is bounded; asking for more would be silently cut. */
const NAMES_MAX = 100;

let runtime: MessagingRuntime | null = null;

export function messagingRuntime(): MessagingRuntime {
  if (runtime) return runtime;
  const environment = serverEnv();
  const configuration = {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };

  // Storage, narrowed and lazy: each call awaits the one shared service.
  const storage: MessagingAttachmentStoragePort = {
    store: async (bytes, policy) => (await storageRuntime()).store(bytes, policy),
    open: async (assetId, authorization) =>
      (await storageRuntime()).open(assetId, authorization),
    release: async (releaseToken) => (await storageRuntime()).release(releaseToken),
  };

  return (runtime = {
    service: createMessagingService({
      persistence: createMessagingPersistence(),
      teaching: createLearningRelationshipService({
        reader: createLearningRelationshipReader(),
        identity: {
          liveTeachingAssignments: (accountId) =>
            identityRuntime().administration.liveAssignmentsCarrying(
              accountId,
              'teaching.perform',
            ),
        },
      }),
      authority: {
        permits: (accountId, permission) =>
          identityRuntime().authorization.hasPermission(accountId, permission),
      },
      // Identity's OWN answer about its own lifecycle, and nothing more.
      accounts: {
        closedAccounts: (ids) => identityRuntime().administration.closedAccounts(ids),
      },
      peers: denyAllPeers,
      storage,
      audit: createAuditWriter(),
      limiter: createRateLimiter(configuration),
      limitKey: (purpose, subject) => rateLimitKey({ purpose, subject, configuration }),
    }),

    async names(accountIds) {
      const unique = [...new Set(accountIds)].slice(0, NAMES_MAX);
      if (unique.length === 0) return new Map();
      const entries = await identityRuntime().administration.participantNames(unique);
      return new Map(entries.map((entry) => [entry.accountId, entry.name]));
    },
  });
}
