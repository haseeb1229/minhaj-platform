import 'server-only';

import {
  createAuthorizationService,
  createIdentityService,
  createPrivilegedSecurityService,
  type AuthorizationAdminService,
  type IdentityService,
  type PrivilegedSecurityService,
} from '@/contexts/identity-access';
import {
  createAuditWriter,
  createAuthMechanicsAdapter,
  createAuthorizationPersistence,
  createAuthorizationReader,
  createEmailDeliveryStore,
  createEmailSuppression,
  createIdentityPersistence,
  createProviderEventStore,
  createRateLimiter,
  createResendProvider,
  rateLimitKey,
} from '@minhaj/database';
import {
  createAuthorizationService as createAuthorizationRuntime,
  type AuthorizationService,
} from '@minhaj/server-core/authorization';
import { createSessionService, type SessionService } from '@minhaj/server-core/session';
import type {
  EmailDeliveryStorePort,
  EmailProviderPort,
  EmailSuppressionPort,
  ProviderEventPort,
} from '@minhaj/contracts/platform';

import { serverEnv } from '@/config/server-env';
import {
  authMechanicsConfiguration,
  limiterConfigurationOf,
} from './identity-mechanics.ts';

/**
 * THE composition root.
 *
 * Layer 4 is the only place that knows both a port and its adapter
 * (ARCHITECTURE.md §3.1.1). Nothing below this file names an adapter: the
 * Identity context is handed interfaces, the session service is handed a
 * narrow reader, and neither can reach the Prisma client or the provider SDK
 * that sits behind them.
 *
 * SERVER-ONLY. The marker travels with the file, so a Client Component that
 * imports this — directly or through any chain — fails the build rather than
 * pulling database and provider code into the browser.
 */

export interface IdentityRuntime {
  readonly identity: IdentityService;
  readonly session: SessionService;
  /** THE authorisation check. One implementation, hosted for two processes. */
  readonly authorization: AuthorizationService;
  /** Privilege ADMINISTRATION, owned by the Identity context. */
  readonly administration: AuthorizationAdminService;
  /** Step-up, the second factor and the recovery codes. */
  readonly privilegedSecurity: PrivilegedSecurityService;
  readonly deliveries: EmailDeliveryStorePort;
  readonly suppression: EmailSuppressionPort;
  readonly providerEvents: ProviderEventPort;
  readonly provider: EmailProviderPort;
}

let runtime: IdentityRuntime | null = null;

/**
 * Builds the Identity runtime once per process.
 *
 * Lazy, because constructing it opens no connection but does read
 * configuration — and a module that read configuration at import time would
 * fail a build rather than a request.
 */
export function identityRuntime(): IdentityRuntime {
  if (runtime !== null) return runtime;

  const environment = serverEnv();

  const digest = {
    key: environment.EMAIL_DIGEST_KEY,
    keyVersion: environment.EMAIL_DIGEST_KEY_VERSION,
  };

  const limiterConfiguration = limiterConfigurationOf(environment);

  const limiter = createRateLimiter(limiterConfiguration);
  const persistence = createIdentityPersistence();
  const authorizationPersistence = createAuthorizationPersistence();
  const authorizationReader = createAuthorizationReader();
  const audit = createAuditWriter();
  const deliveries = createEmailDeliveryStore({ digest });
  const suppression = createEmailSuppression({ digest });
  const providerEvents = createProviderEventStore({ digest });

  const provider = createResendProvider({
    apiKey: environment.RESEND_API_KEY ?? null,
    senderAddress: environment.EMAIL_FROM_ADDRESS,
    senderName: environment.EMAIL_FROM_NAME,
    timeoutMs: 10_000,
  });

  // ONE configuration for both processes: the realtime transport verifies a
  // session cookie with exactly this object (`./identity-mechanics.ts`).
  const auth = createAuthMechanicsAdapter(
    authMechanicsConfiguration(environment, limiter),
  );

  const identity = createIdentityService({
    auth,
    persistence,
    limiter,
    audit,
    deliveries,
    suppression,
    rateLimitKey: (input) =>
      rateLimitKey({ ...input, configuration: limiterConfiguration }),
    baseUrl: environment.AUTH_BASE_URL,

    // ONE named capability, not the authorisation port. A status change has to
    // invalidate step-up grants as well as sessions; Identity is handed exactly
    // that operation and nothing that could grant, revoke or read a privilege.
    privilege: {
      revokeStepUpGrants: (accountId) =>
        authorizationPersistence.revokeStepUpGrantsForAccount(accountId),
    },
  });

  const privilegedSecurity = createPrivilegedSecurityService({
    auth,
    authorization: authorizationPersistence,
    persistence,
    audit,
    limiter,
    rateLimitKey: (input) =>
      rateLimitKey({ ...input, configuration: limiterConfiguration }),
  });

  // THE authorisation check, given the NARROW reader: three read operations,
  // and nothing that can change what it reads. The realtime transport will be
  // given the same one (ARCHITECTURE.md §3.1.2, §3.1.3, §3.2).
  const authorization = createAuthorizationRuntime({ reader: authorizationReader });

  const administration = createAuthorizationService({
    authorization: authorizationPersistence,
    verifyActor: (input) => authorization.verifyPrivilegedActor(input),
  });

  // The session service is given a NARROW reader, not the auth port. The
  // future realtime transport will be given the same two operations and
  // nothing more (ARCHITECTURE.md §3.1.2, §3.1.3).
  const session = createSessionService({
    sessions: {
      resolveSession: (headers) => auth.resolveSession(headers),
      revokeAllSessionsForAccount: (accountId) =>
        auth.revokeAllSessionsForAccount(accountId),
    },
  });

  runtime = {
    identity,
    session,
    authorization,
    administration,
    privilegedSecurity,
    deliveries,
    suppression,
    providerEvents,
    provider,
  };
  return runtime;
}
