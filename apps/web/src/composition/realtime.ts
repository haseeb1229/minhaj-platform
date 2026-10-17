import 'server-only';

import {
  createAuthMechanicsAdapter,
  createAuthorizationPersistence,
  createAuthorizationReader,
  createRateLimiter,
} from '@minhaj/database';
import { parseServerEnv, type ServerEnv } from '@minhaj/contracts/env/server';
import type { MessagingAttachmentStoragePort } from '@minhaj/contracts/messaging';
import { createAuthorizationService } from '@minhaj/server-core/authorization';
import {
  createRealtimeMessaging,
  type RealtimeMessaging,
} from '@minhaj/server-core/messaging';
import { createSessionService, type SessionService } from '@minhaj/server-core/session';

import {
  authMechanicsConfiguration,
  limiterConfigurationOf,
} from './identity-mechanics.ts';
import { messagingDependencies } from './messaging-wiring.ts';

/**
 * The REALTIME process's composition root — Layer 4 (Phase 25).
 *
 * WHY IT LIVES HERE AND NOT IN `apps/realtime`. The realtime transport may
 * never reach the database package, by any chain (ARCHITECTURE.md §3.1
 * rule 1, §3.1.2; the `realtime` role's transitive check). Something must
 * still wire Identity's and Messaging's ports to their context-owned adapters
 * for the second process, exactly as `identity.ts` and `messaging.ts` do for
 * the first — and wiring ports to adapters IS Layer 4's job. So the second
 * process has a Layer-4 root too, in the composition workspace, and the
 * transport receives only what it builds: two narrow services, injected.
 *
 * THE SAME IMPLEMENTATIONS, NOT COPIES:
 *
 *   - sessions are verified by the server-core `SessionService` over an
 *     authentication adapter built from `authMechanicsConfiguration` — the
 *     very object the web process builds its adapter from, so a cookie the
 *     web accepts is exactly a cookie this process accepts;
 *   - live keys come from the server-core `AuthorizationService` over the same
 *     narrow reader the web process uses;
 *   - Messaging is `createRealtimeMessaging` over `messagingDependencies` —
 *     the one wiring both processes share — so every answer is the Phase-24
 *     service's own decision.
 *
 * IDENTITY'S TWO ANSWERS. Learning's relationship reader and Messaging's
 * closure rule ask Identity which assignments carry `teaching.perform` NOW and
 * which accounts are closed. In the web process the Identity context's
 * administration service forwards those to Identity's narrow authorisation
 * persistence behind two guards; that context module is bundler-resolved and
 * cannot load in this process, so the same reads are made here, through the
 * same narrow persistence and the same guards, and nothing else is reached.
 *
 * NO STORAGE CAPABILITY. The realtime view exposes no upload, open or release
 * — attachment bytes stay on their streamed HTTP paths (Phase 24) — so this
 * process is handed a storage port that refuses everything rather than a
 * filesystem root and a scanner it must never use.
 *
 * NODE-RUNNABLE. Started by plain Node under the `react-server` condition, so
 * it names packages and explicit `.ts` paths only — never the `@/` alias.
 */

export interface RealtimeComposition {
  readonly environment: ServerEnv;
  readonly session: Pick<SessionService, 'resolve'>;
  readonly messaging: RealtimeMessaging;
}

/** The realtime process holds no attachment capability at all. */
const NO_STORAGE: MessagingAttachmentStoragePort = {
  store: () => Promise.reject(new Error('The realtime process stores no attachment.')),
  open: () => Promise.resolve(null),
  release: () =>
    Promise.reject(new Error('The realtime process releases no attachment.')),
};

export function composeRealtime(
  source: Record<string, string | undefined> = process.env,
): RealtimeComposition {
  const environment = parseServerEnv(source);
  const limiter = createRateLimiter(limiterConfigurationOf(environment));

  const auth = createAuthMechanicsAdapter(
    authMechanicsConfiguration(environment, limiter),
  );
  const session = createSessionService({
    sessions: {
      resolveSession: (headers) => auth.resolveSession(headers),
      revokeAllSessionsForAccount: (accountId) =>
        auth.revokeAllSessionsForAccount(accountId),
    },
  });

  const authorization = createAuthorizationService({
    reader: createAuthorizationReader(),
  });
  const authorizationPersistence = createAuthorizationPersistence();

  const messaging = createRealtimeMessaging(
    messagingDependencies({
      environment,
      identity: {
        // The same guards the Identity context's administration service applies.
        liveTeachingAssignments: (accountId) =>
          authorizationPersistence.liveAssignmentsCarrying(accountId, 'teaching.perform'),
        permits: (accountId, permission) =>
          authorization.hasPermission(accountId, permission),
        closedAccounts: async (accountIds) =>
          accountIds.length === 0
            ? []
            : authorizationPersistence.closedAccountIds(accountIds),
      },
      storage: NO_STORAGE,
    }),
  );

  return { environment, session, messaging };
}
