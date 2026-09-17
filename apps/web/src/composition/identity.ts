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

/** Parses `<version>:<value>,<version>:<value>`, newest first. */
function parseSecrets(raw: string): { version: number; value: string }[] {
  const secrets = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
    .map((entry) => {
      const separator = entry.indexOf(':');
      if (separator === -1) return null;

      const version = Number.parseInt(entry.slice(0, separator), 10);
      const value = entry.slice(separator + 1);
      if (!Number.isInteger(version) || version < 1 || value === '') return null;

      return { version, value };
    })
    .filter((entry): entry is { version: number; value: string } => entry !== null);

  if (secrets.length === 0) {
    // Fail closed, and name the variable without printing it. An auth instance
    // with no secret would sign and encrypt with nothing.
    throw new Error('AUTH_SECRETS contains no usable `<version>:<value>` entry.');
  }

  return secrets;
}

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
  const secrets = parseSecrets(environment.AUTH_SECRETS);

  const digest = {
    key: environment.EMAIL_DIGEST_KEY,
    keyVersion: environment.EMAIL_DIGEST_KEY_VERSION,
  };

  const limiterConfiguration = {
    digestKey: environment.RATE_LIMIT_DIGEST_KEY,
    digestKeyVersion: environment.RATE_LIMIT_DIGEST_KEY_VERSION,
  };

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

  const auth = createAuthMechanicsAdapter({
    baseUrl: environment.AUTH_BASE_URL,
    trustedOrigins: [environment.AUTH_BASE_URL],
    secrets,

    // DERIVED FROM THE ORIGIN, not from `NODE_ENV`.
    //
    // `Secure` is a statement about the SCHEME a cookie may travel over, so
    // the scheme is what should decide it. Keying it on `NODE_ENV` was wrong
    // in both directions:
    //
    //   - a staging or preview deployment served over HTTPS with
    //     `NODE_ENV` unset would issue session cookies WITHOUT `Secure`, and a
    //     single plain-HTTP request to that host would carry the session in
    //     clear — a real weakness, and an invisible one;
    //   - a `NODE_ENV=production` process behind a plain-HTTP origin would
    //     issue `Secure` cookies the browser stores and then never sends back,
    //     so signing in appears to work and the next page load is signed out.
    //
    // The second is not hypothetical: it is exactly what the browser suite hit.
    // `AUTH_BASE_URL` is the canonical origin the deployment declares, and
    // reading the scheme off it makes the cookie's guarantee match the
    // transport that actually carries it (SECURITY_BASELINE.md §2.3).
    useSecureCookies: new URL(environment.AUTH_BASE_URL).protocol === 'https:',

    passwordLength: { min: 12, max: 128 },
    session: { expiresInSeconds: 604_800, updateAgeSeconds: 86_400 },
    tokenExpiresInSeconds: 3_600,
    tokenAllowedAttempts: 5,
    rateLimiter: limiter,

    // PRIVILEGED SECOND-FACTOR policy. Ten single-use recovery codes, the
    // standard six-digit thirty-second TOTP every authenticator app supports,
    // and a sign-in lockout after ten consecutive failures across challenges
    // and factors. The signed-in path has no library budget at all, which is
    // why Identity spends the SQL limiter on every privileged proof.
    secondFactor: {
      recoveryCodeCount: 10,
      totpDigits: 6,
      totpPeriodSeconds: 30,
      signInLockout: { maxFailedAttempts: 10, durationSeconds: 900 },
    },

    // The adapter reports that a token exists; it does not decide what to do
    // about it. Identity enqueues its own delivery when it issues the token,
    // so this hook stays empty rather than becoming a second path that could
    // enqueue a duplicate.
    onTokenIssued: async () => undefined,
  });

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
