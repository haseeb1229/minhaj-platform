import type {
  AuthMechanicsPort,
  IdentityPersistencePort,
} from '../../packages/contracts/src/identity/index.ts';
import type { RequestContext } from '../../apps/web/src/contexts/identity-access/index.ts';

import { capturingProvider, PROOF_SECRETS, type CapturingProvider } from './harness.ts';

/**
 * The Identity service, wired to REAL adapters over a disposable database.
 *
 * The only substitution is the outbound provider, which is a capturing stub —
 * everything else is the code a deployment runs: the real Better Auth
 * instance, the real Prisma-backed persistence, the real SQL rate limiter, the
 * real delivery store, the real audit writer. A suite that stubbed the
 * persistence would be testing its own stubs.
 *
 * Composition happens here rather than in `apps/web/src/composition/identity.ts`
 * because that module reads validated process configuration and holds a
 * per-process singleton — neither of which a suite that needs a fresh
 * disposable database per file can use.
 */

export interface IdentityHarness {
  readonly identity: Awaited<ReturnType<typeof buildIdentity>>['identity'];
  readonly session: Awaited<ReturnType<typeof buildIdentity>>['session'];
  readonly deliveries: Awaited<ReturnType<typeof buildIdentity>>['deliveries'];
  readonly suppression: Awaited<ReturnType<typeof buildIdentity>>['suppression'];
  readonly providerEvents: Awaited<ReturnType<typeof buildIdentity>>['providerEvents'];
  readonly auth: Awaited<ReturnType<typeof buildIdentity>>['auth'];
  readonly provider: CapturingProvider;
  dispatch(): Promise<{
    sent: number;
    failed: number;
    suppressed: number;
    abandoned: number;
    deferred: number;
  }>;
}

export const BASE_URL = 'http://localhost:3000';

/**
 * Builds the runtime.
 *
 * Every adapter is imported DYNAMICALLY, because `getDatabaseClient()` binds
 * to `DATABASE_URL` at first use and the harness repoints that variable when
 * it creates the disposable database. A static import would bind the client to
 * whatever was configured when the module graph loaded.
 */
export interface HarnessOptions {
  /**
   * Wraps the REAL auth-mechanics adapter before the service is built.
   *
   * For crash-ordering proofs: the guarantees under test are about what is
   * durable when a step does not complete, and the only honest way to test
   * that is to stop a real step from completing. Everything else stays real —
   * the wrapper decorates the actual adapter rather than replacing it.
   */
  readonly wrapAuth?: (auth: AuthMechanicsPort) => AuthMechanicsPort;
  /** Exact-boundary fault injection around the real durable Identity adapter. */
  readonly wrapPersistence?: (
    persistence: IdentityPersistencePort,
  ) => IdentityPersistencePort;
}

async function buildIdentity(provider: CapturingProvider, options: HarnessOptions = {}) {
  const { createAuthMechanicsAdapter, createIdentityPersistence } =
    await import('../../packages/database/src/adapters/identity-access/index.ts');
  const { createRateLimiter, rateLimitKey } =
    await import('../../packages/database/src/adapters/rate-limiting/index.ts');
  const { createEmailDeliveryStore, createEmailSuppression, createProviderEventStore } =
    await import('../../packages/database/src/adapters/email/delivery.ts');
  const { createSessionService } =
    await import('../../packages/server-core/src/session/index.ts');
  const { createIdentityService } =
    await import('../../apps/web/src/contexts/identity-access/index.ts');

  const limiterConfiguration = {
    digestKey: PROOF_SECRETS.digestKey,
    digestKeyVersion: PROOF_SECRETS.digestKeyVersion,
  };

  const digest = {
    key: PROOF_SECRETS.digestKey,
    keyVersion: PROOF_SECRETS.digestKeyVersion,
  };

  const limiter = createRateLimiter(limiterConfiguration);
  const realPersistence = createIdentityPersistence();
  const persistence =
    options.wrapPersistence === undefined
      ? realPersistence
      : options.wrapPersistence(realPersistence);
  const deliveries = createEmailDeliveryStore({ digest });
  const suppression = createEmailSuppression({ digest });
  const providerEvents = createProviderEventStore({ digest });

  // The REAL audit writer, unwrapped.
  //
  // It used to be decorated with an in-memory capture so a suite could assert
  // what a flow audited. That capture is gone because the assertions moved to
  // the TABLE, which is both stronger and indifferent to which writer produced
  // a row — and some rows now come from Identity's own follow-up transaction
  // rather than from this port at all, so a capture here would have quietly
  // stopped seeing them.
  const audit = (
    await import('../../packages/database/src/adapters/auditing/index.ts')
  ).createAuditWriter();

  const realAuth = createAuthMechanicsAdapter({
    baseUrl: BASE_URL,
    trustedOrigins: [BASE_URL],
    secrets: [...PROOF_SECRETS.authSecrets],
    useSecureCookies: false,
    passwordLength: { min: 12, max: 128 },
    session: { expiresInSeconds: 604_800, updateAgeSeconds: 86_400 },
    tokenExpiresInSeconds: 3_600,
    tokenAllowedAttempts: 5,
    rateLimiter: limiter,
    onTokenIssued: async () => undefined,
  });

  const auth = options.wrapAuth === undefined ? realAuth : options.wrapAuth(realAuth);

  const identity = createIdentityService({
    auth,
    persistence,
    limiter,
    audit,
    deliveries,
    suppression,
    rateLimitKey: (input) =>
      rateLimitKey({ ...input, configuration: limiterConfiguration }),
    baseUrl: BASE_URL,
  });

  const session = createSessionService({
    sessions: {
      resolveSession: (headers) => auth.resolveSession(headers),
      revokeAllSessionsForAccount: (accountId) =>
        auth.revokeAllSessionsForAccount(accountId),
    },
  });

  return { identity, session, deliveries, suppression, providerEvents, auth, provider };
}

export async function createIdentityHarness(
  options: HarnessOptions = {},
): Promise<IdentityHarness> {
  const provider = capturingProvider();
  const built = await buildIdentity(provider, options);

  /**
   * One dispatch tick, in the same shape Layer 4 runs it.
   *
   * Deliberately a copy of `composition/dispatch.ts`'s loop rather than a call
   * into it: that module reaches the per-process composition singleton, which
   * is bound to real configuration. The ORDER it proves — resolve, then check
   * suppression, then send — is the order asserted here.
   */
  async function dispatch() {
    let sent = 0;
    let failed = 0;
    let suppressed = 0;
    let abandoned = 0;
    let deferred = 0;

    await built.identity.relayPendingIntents(50);

    const claimed = await built.deliveries.claimDue({ limit: 50, leaseSeconds: 60 });

    for (const delivery of claimed) {
      const resolution = await built.identity.resolveDelivery(delivery);

      if (resolution.outcome === 'nothing-owed') {
        await built.deliveries.markAbandoned({
          id: delivery.id,
          reason: 'nothing_to_send',
        });
        abandoned += 1;
        continue;
      }

      if (resolution.outcome === 'not-yet') {
        // Owed, but its source is not resolvable yet. Back on the schedule
        // rather than abandoned — the same decision Layer 4 makes.
        await built.deliveries.markAttemptFailed({
          id: delivery.id,
          failureClass: 'transient',
          failureCode: 'awaiting_source',
          retryAfterSeconds: null,
        });
        deferred += 1;
        continue;
      }

      const resolved = resolution.message;

      if (
        await built.suppression.isSuppressed({
          recipient: resolved.recipient,
          scope: 'transactional',
        })
      ) {
        await built.deliveries.markSuppressed(delivery.id);
        suppressed += 1;
        continue;
      }

      const outcome = await provider.send({
        to: resolved.recipient,
        subject: resolved.subject,
        html: resolved.html,
        text: resolved.text,
        idempotencyKey: delivery.idempotencyKey,
      });

      if (outcome.outcome === 'accepted') {
        await built.deliveries.markSent({
          id: delivery.id,
          providerMessageId: outcome.providerMessageId,
        });
        sent += 1;
        continue;
      }

      await built.deliveries.markAttemptFailed({
        id: delivery.id,
        failureClass: outcome.failureClass,
        failureCode: outcome.failureCode,
        retryAfterSeconds: null,
      });
      failed += 1;
    }

    return { sent, failed, suppressed, abandoned, deferred };
  }

  return { ...built, provider, dispatch };
}

let client = 0;

/**
 * A client address no other call has used.
 *
 * The limiter has a real PER-CLIENT budget, so a suite that reused one address
 * everywhere would exhaust it and then report "rate limited" as the outcome of
 * every unrelated proof — a suite failing for a reason that has nothing to do
 * with what it tests. A test that means to exercise the limiter passes an
 * address explicitly and reuses it deliberately.
 *
 * Drawn from 100.64.0.0/10, the shared address space reserved by RFC 6598: it
 * is routable nowhere and belongs to nobody.
 */
function freshClientAddress(): string {
  client += 1;
  return `100.64.${Math.floor(client / 250) % 250}.${client % 250}`;
}

/** A request context with no session and a distinct client address. */
export function anonymousContext(clientAddress = freshClientAddress()): RequestContext {
  return { headers: new Headers(), clientAddress, locale: 'en' };
}

/** A request context carrying a session cookie. */
export function sessionContext(
  cookie: string,
  clientAddress = freshClientAddress(),
): RequestContext {
  return {
    headers: new Headers({ cookie }),
    clientAddress,
    locale: 'en',
  };
}

/**
 * Turns the `Set-Cookie` values an operation produced into a `Cookie` header.
 *
 * The application applies these through Next's cookie store; a suite has no
 * browser, so it does the same job by hand — name and value only, which is all
 * a subsequent request would send back.
 */
export function cookieHeader(setCookies: readonly string[]): string {
  return setCookies
    .map((value) => value.split(';')[0])
    .filter((pair): pair is string => pair !== undefined && pair.includes('='))
    .join('; ');
}
