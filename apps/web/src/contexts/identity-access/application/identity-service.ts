import type {
  AccountIdentity,
  AccountStatus,
  AddressTokenPurpose,
  AuthMechanicsPort,
  IdentityNotificationPurpose,
  IdentityPersistencePort,
  RequestHeaders,
  ResolvedSession,
  SessionSummary,
  SetCookieHeaders,
  TokenPurpose,
} from '@minhaj/contracts/identity';
import { canonicaliseEmail } from '@minhaj/contracts/identity';
import type {
  AuditEvent,
  AuditPort,
  DeliveryPurpose,
  DeliveryRecord,
  DeliveryResolution,
  EmailDeliveryStorePort,
  EmailSuppressionPort,
  RateLimiterPort,
} from '@minhaj/contracts/platform';

import {
  accountSetupComplete,
  canTransition,
  notificationKey,
  wouldRemoveFinalAuthenticationMethod,
} from '../domain/account.ts';
import { IDENTITY_RATE_LIMITS, type IdentityFlow } from '../domain/rate-limits.ts';
import { renderMessage } from './messages.ts';

/**
 * Identity & Access — the application service.
 *
 * THIS is where policy lives. The adapter beneath performs mechanics; every
 * decision about whether an account may act, what a failure may disclose, what
 * communication an event warrants and what a security change costs is made
 * here (ARCHITECTURE.md §3.1.1, §6.2).
 *
 * Layer 1: it depends on Layer 0 interfaces only, never on a later context and
 * never on infrastructure directly (DOMAIN_MODEL.md §3.1).
 */

/* ===========================================================================
 * Results
 * ========================================================================= */

/**
 * Why an operation did not succeed.
 *
 * DELIBERATELY COARSE AT THE EDGES. Sign-in, sign-up, reset and resend all
 * report outcomes that cannot be used to learn whether an address has an
 * account: the same `submitted` result is returned whether or not it does
 * (SECURITY_BASELINE.md §15.2, DOMAIN_MODEL.md §4.6).
 */
export type IdentityFailure =
  | 'invalid-credentials'
  | 'account-unavailable'
  | 'rate-limited'
  | 'invalid-token'
  | 'expired-token'
  | 'too-many-attempts'
  | 'email-unavailable'
  | 'final-authentication-method'
  | 'invalid-transition'
  | 'unavailable';

export interface IdentityError {
  readonly ok: false;
  readonly failure: IdentityFailure;
  /** Seconds to wait, when the failure is a rate limit. */
  readonly retryAfter?: number;
}

export type IdentityResult<T> = ({ readonly ok: true } & T) | IdentityError;

function fail(failure: IdentityFailure, retryAfter?: number): IdentityError {
  return retryAfter === undefined
    ? { ok: false, failure }
    : { ok: false, failure, retryAfter };
}

/** The caller's context, as Layer 4 knows it. */
export interface RequestContext {
  readonly headers: RequestHeaders;
  /** For per-client rate limiting. Never persisted by Identity. */
  readonly clientAddress: string;
  /** Interface locale of the surface making the request. */
  readonly locale: string;
}

export interface IdentityServiceDependencies {
  readonly auth: AuthMechanicsPort;
  readonly persistence: IdentityPersistencePort;
  readonly limiter: RateLimiterPort;
  readonly audit: AuditPort;
  readonly deliveries: EmailDeliveryStorePort;
  readonly suppression: EmailSuppressionPort;
  /** Derives a storage key for a limiter subject. Injected: Layer 0 owns it. */
  readonly rateLimitKey: (input: {
    readonly purpose: string;
    readonly subject: string;
  }) => string;
  /** Canonical application origin, for building emailed links. */
  readonly baseUrl: string;
}

/* ===========================================================================
 * The service
 * ========================================================================= */

export function createIdentityService(dependencies: IdentityServiceDependencies) {
  const { auth, persistence, limiter, audit, deliveries, suppression } = dependencies;

  /**
   * Spends both budgets for a flow.
   *
   * The per-account budget is charged first so an attacker cannot exhaust a
   * victim's budget cheaply from many addresses without also spending their
   * own per-client budget.
   */
  async function spend(
    flow: IdentityFlow,
    context: RequestContext,
    subject: string,
  ): Promise<IdentityError | null> {
    const limits = IDENTITY_RATE_LIMITS[flow];

    const account = await limiter.consume(
      dependencies.rateLimitKey({ purpose: `${flow}:account`, subject }),
      limits.perAccount,
    );
    if (!account.allowed) return fail('rate-limited', account.retryAfter ?? undefined);

    const client = await limiter.consume(
      dependencies.rateLimitKey({
        purpose: `${flow}:client`,
        subject: context.clientAddress,
      }),
      limits.perClient,
    );
    if (!client.allowed) return fail('rate-limited', client.retryAfter ?? undefined);

    return null;
  }

  /**
   * The delivery identity for a token message.
   *
   * Opaque to Layer 0 and resolvable only by this context. It carries the
   * purpose and the address, which is exactly what the auth-mechanics port
   * needs to re-materialise the SAME token for a retry — and nothing that
   * could be exchanged for a token by anything else.
   */
  function tokenSource(purpose: AddressTokenPurpose, email: string): string {
    return `identity:token:${purpose}:${email}`;
  }

  function parseTokenSource(
    reference: string,
  ): { purpose: AddressTokenPurpose; email: string } | null {
    const match = /^identity:token:([a-z-]+):(.+)$/.exec(reference);
    if (match === null) return null;

    const purpose = match[1];
    const email = match[2];

    if (
      email === undefined ||
      (purpose !== 'email-verification' && purpose !== 'password-reset')
    ) {
      return null;
    }

    return { purpose, email };
  }

  /**
   * The delivery identity for an email-CHANGE message.
   *
   * Distinct from `tokenSource` because a change is keyed on a PAIR: the token
   * lives under "this account's address moving to that one", so a retry that
   * knew only the destination could not find it.
   */
  function changeSource(currentEmail: string, newEmail: string): string {
    return `identity:emailchange:${currentEmail}:${newEmail}`;
  }

  function parseChangeSource(
    reference: string,
  ): { currentEmail: string; newEmail: string } | null {
    const match = /^identity:emailchange:([^:]+):(.+)$/.exec(reference);
    if (match === null) return null;

    const currentEmail = match[1];
    const newEmail = match[2];
    if (currentEmail === undefined || newEmail === undefined) return null;

    return { currentEmail, newEmail };
  }

  const DELIVERY_PURPOSE: Record<TokenPurpose, DeliveryPurpose> = {
    'email-verification': 'identity.email-verification',
    'password-reset': 'identity.password-reset',
    'email-change': 'identity.email-change',
  };

  /**
   * Records that a message is owed, then issues the token it will carry.
   *
   * THE ORDER IS THE CORRECTNESS ARGUMENT, and it is the reverse of the
   * obvious one.
   *
   * Issuing first and enqueuing second leaves a window in which a valid token
   * exists and nothing durable knows a message was owed for it. A process that
   * died there produced an account that could not be verified and a platform
   * with no record that anything was outstanding — no retry, no sweep, no
   * operator view would ever find it, because the only evidence was in the
   * memory of a process that no longer exists.
   *
   * Committing the delivery FIRST inverts that into an invariant: at every
   * instant, a token that exists has a durable delivery to carry it. The
   * window that remains is the harmless one — a delivery recorded for a token
   * that was never minted — and it resolves itself, because the dispatcher
   * asks this context what to send and is told `not-yet` and then, once the
   * issuance has plainly failed, `nothing-owed`.
   *
   * The token itself is NEVER handed to the delivery store — the store gets a
   * source reference, and the dispatcher asks this context to materialise the
   * token when it actually sends. That is what keeps Better Auth's
   * `Verification` record the only durable home for bearer material
   * (ARCHITECTURE.md §4.6.1).
   *
   * A user-requested resend goes through here, so it MINTS a new token and the
   * previous one stops working. A delivery retry does not come through here at
   * all — it re-materialises the existing token (see `resolveDelivery`).
   */
  async function issueAndEnqueue(input: {
    readonly purpose: AddressTokenPurpose;
    readonly email: string;
    readonly occasion: string;
  }): Promise<void> {
    await deliveries.enqueue({
      purpose: DELIVERY_PURPOSE[input.purpose],
      recipient: input.email,
      sourceReference: tokenSource(input.purpose, input.email),
      // A NEW token is a new message. Keying on the occasion is what
      // distinguishes a genuine resend from a relay retry of the same one.
      idempotencyKey: `${DELIVERY_PURPOSE[input.purpose]}:${input.email}:${input.occasion}`,
    });

    await auth.issueToken({ purpose: input.purpose, email: input.email });
  }

  /**
   * Records a token-free security notification, and enqueues its delivery.
   *
   * The purpose is typed as an `IdentityNotificationPurpose`, NOT as any
   * delivery purpose. That is the whole point: the durable intent mechanism is
   * for messages that carry no bearer material, and the three token purposes
   * must never reach it (ARCHITECTURE.md §4.6.1). Narrowing the parameter is
   * what makes that a compile error rather than a rule in a comment — the
   * previous `as never` cast on the call below silently permitted exactly the
   * mistake the type exists to prevent.
   */
  async function notify(input: {
    readonly purpose: IdentityNotificationPurpose;
    readonly account: AccountIdentity;
    readonly occasion: string;
    /** Recorded in the SAME transaction as the intent. */
    readonly audit: AuditEvent;
  }): Promise<void> {
    const key = notificationKey({
      purpose: input.purpose,
      accountId: input.account.id,
      occasion: input.occasion,
    });

    // ONE COMMIT for the whole follow-up a security change owes: the audit
    // record an investigation reads, and the notification that tells the
    // person. Written separately, a crash between them leaves a change that
    // was recorded but never disclosed — which is indistinguishable, later,
    // from one nobody was meant to hear about.
    await persistence.recordSecurityFollowUp({
      audit: input.audit,
      intent: {
        purpose: input.purpose,
        accountId: input.account.id,
        locale: input.account.locale,
        idempotencyKey: key,
      },
    });

    // AFTER the owner's commit, never inside it. The relay is a Layer-4 hand-off
    // to a different owner, and the sweep would recover it anyway if this line
    // never ran — which is the point of committing the intent first.
    await deliveries.enqueue({
      purpose: input.purpose,
      recipient: input.account.email,
      sourceReference: `identity:account:${input.account.id}:${input.purpose}`,
      idempotencyKey: key,
    });
  }

  return {
    /* ---- Registration and verification -------------------------------- */

    /**
     * Creates an account.
     *
     * NON-ENUMERATING. The result is the same whether or not the address is
     * already registered: the underlying library returns a generic success for
     * an existing address, and this method does not look behind that. An
     * attacker learns nothing about who has an account
     * (SECURITY_BASELINE.md §15.2).
     */
    async signUp(
      context: RequestContext,
      input: { readonly email: string; readonly password: string; readonly name: string },
    ): Promise<IdentityResult<{ submitted: true }>> {
      const email = canonicaliseEmail(input.email);

      const limited = await spend('sign-up', context, email);
      if (limited !== null) return limited;

      try {
        const account = await auth.createCredentialAccount({
          email,
          password: input.password,
          name: input.name,
          locale: context.locale,
        });

        await issueAndEnqueue({
          purpose: 'email-verification',
          email,
          occasion: `signup:${account.id}`,
        });

        await audit.record({
          action: 'identity.account.created',
          actorType: 'user',
          actorId: account.id,
          targetType: 'user',
          targetId: account.id,
          after: { status: account.status },
        });
      } catch {
        // A failure here must not distinguish "already registered" from
        // anything else. The uniform result is the whole point.
      }

      return { ok: true, submitted: true };
    },

    /** Re-sends verification. Mints a NEW token; the previous one dies. */
    async resendVerification(
      context: RequestContext,
      input: { readonly email: string },
    ): Promise<IdentityResult<{ submitted: true }>> {
      const email = canonicaliseEmail(input.email);

      const limited = await spend('verification-resend', context, email);
      if (limited !== null) return limited;

      const account = await persistence.findAccountByEmail(email);

      // Only act for an unverified, live account — but report the same result
      // regardless, so this cannot be used to probe for addresses.
      if (account !== null && !account.emailVerified && account.status === 'active') {
        await issueAndEnqueue({
          purpose: 'email-verification',
          email,
          occasion: `resend:${Date.now()}`,
        });
      }

      return { ok: true, submitted: true };
    },

    /**
     * Reads a verification link's state WITHOUT consuming it.
     *
     * This is what a GET may do. A mail scanner or link prefetch reaching the
     * page must not burn the link the person is about to click
     * (SECURITY_BASELINE.md §7.4).
     */
    async inspectVerification(input: {
      readonly email: string;
      readonly token: string;
    }): Promise<'valid' | 'invalid' | 'expired'> {
      return auth.inspectToken({
        purpose: 'email-verification',
        email: canonicaliseEmail(input.email),
        token: input.token,
      });
    },

    /** THE confirming mutation. Consumes the token. */
    async confirmVerification(
      context: RequestContext,
      input: { readonly email: string; readonly token: string },
    ): Promise<IdentityResult<{ verified: true }>> {
      const email = canonicaliseEmail(input.email);

      const limited = await spend('verification-confirm', context, email);
      if (limited !== null) return limited;

      try {
        await auth.confirmEmailVerification({ email, token: input.token });
      } catch (error) {
        return fail(mapMechanicsFailure(error));
      }

      const account = await persistence.findAccountByEmail(email);
      if (account !== null) {
        await audit.record({
          action: 'identity.email.verified',
          actorType: 'user',
          actorId: account.id,
          targetType: 'user',
          targetId: account.id,
          after: { emailVerified: 'true' },
        });
      }

      return { ok: true, verified: true };
    },

    /* ---- Sessions ------------------------------------------------------ */

    /**
     * Signs in.
     *
     * A wrong password and an unknown address fail identically — the response
     * never distinguishes "no such user" from "wrong password"
     * (SECURITY_BASELINE.md §2.2).
     */
    async signIn(
      context: RequestContext,
      input: { readonly email: string; readonly password: string },
    ): Promise<
      IdentityResult<{ account: AccountIdentity; setCookies: SetCookieHeaders }>
    > {
      const email = canonicaliseEmail(input.email);

      const limited = await spend('sign-in', context, email);
      if (limited !== null) return limited;

      // Status is checked BEFORE the credential, and the failure is the same
      // either way, so a suspended account does not announce itself to someone
      // guessing passwords.
      const existing = await persistence.findAccountByEmail(email);
      if (existing !== null && existing.status !== 'active') {
        await audit.record({
          action: 'identity.signin.refused',
          actorType: 'user',
          actorId: existing.id,
          targetType: 'user',
          targetId: existing.id,
          after: { status: existing.status },
        });
        return fail('invalid-credentials');
      }

      try {
        const outcome = await auth.authenticateWithPassword({
          email,
          password: input.password,
          headers: context.headers,
        });

        await audit.record({
          action: 'identity.signin.succeeded',
          actorType: 'user',
          actorId: outcome.account.id,
          targetType: 'user',
          targetId: outcome.account.id,
        });

        return { ok: true, account: outcome.account, setCookies: outcome.setCookies };
      } catch {
        await audit.record({
          action: 'identity.signin.failed',
          actorType: 'anonymous',
          actorId: null,
          targetType: 'user',
          targetId: existing?.id ?? null,
        });
        return fail('invalid-credentials');
      }
    },

    async signOut(
      context: RequestContext,
    ): Promise<IdentityResult<{ setCookies: SetCookieHeaders }>> {
      const outcome = await auth.signOut(context.headers);
      return { ok: true, setCookies: outcome.setCookies };
    },

    async listSessions(context: RequestContext): Promise<readonly SessionSummary[]> {
      return auth.listSessions(context.headers);
    },

    /**
     * Revokes one of the caller's own sessions.
     *
     * Named by ID. The session TOKEN is a bearer credential and never reaches
     * the browser, so a revoke form carries an opaque handle rather than a
     * live credential for one of the person's other devices.
     */
    async revokeSession(
      context: RequestContext,
      session: ResolvedSession,
      input: { readonly sessionId: string },
    ): Promise<IdentityResult<{ revoked: true }>> {
      const revoked = await auth.revokeSessionById({
        headers: context.headers,
        sessionId: input.sessionId,
      });

      // An id that is not in the caller's own list is simply not found. It is
      // reported as an ordinary failure rather than as "no such session",
      // which would confirm to a caller which ids exist.
      if (!revoked) return fail('unavailable');

      await audit.record({
        action: 'identity.session.revoked',
        actorType: 'user',
        actorId: session.account.id,
        targetType: 'user',
        targetId: session.account.id,
      });

      return { ok: true, revoked: true };
    },

    async revokeOtherSessions(
      context: RequestContext,
      session: ResolvedSession,
    ): Promise<IdentityResult<{ revoked: true }>> {
      await auth.revokeOtherSessions(context.headers);

      await notify({
        purpose: 'identity.sessions-revoked',
        account: session.account,
        occasion: `revoke-others:${Date.now()}`,
        audit: {
          action: 'identity.sessions.revoked-others',
          actorType: 'user',
          actorId: session.account.id,
          targetType: 'user',
          targetId: session.account.id,
        },
      });

      return { ok: true, revoked: true };
    },

    /* ---- Passwords ----------------------------------------------------- */

    async requestPasswordReset(
      context: RequestContext,
      input: { readonly email: string },
    ): Promise<IdentityResult<{ submitted: true }>> {
      const email = canonicaliseEmail(input.email);

      const limited = await spend('password-reset-request', context, email);
      if (limited !== null) return limited;

      const account = await persistence.findAccountByEmail(email);
      if (account !== null && account.status === 'active') {
        await issueAndEnqueue({
          purpose: 'password-reset',
          email,
          occasion: `reset:${Date.now()}`,
        });
      }

      // Uniform, always. This is the single most probed endpoint for account
      // enumeration on any platform.
      return { ok: true, submitted: true };
    },

    async inspectPasswordReset(input: {
      readonly email: string;
      readonly token: string;
    }): Promise<'valid' | 'invalid' | 'expired'> {
      return auth.inspectToken({
        purpose: 'password-reset',
        email: canonicaliseEmail(input.email),
        token: input.token,
      });
    },

    async resetPassword(
      context: RequestContext,
      input: {
        readonly email: string;
        readonly token: string;
        readonly newPassword: string;
      },
    ): Promise<IdentityResult<{ reset: true }>> {
      const email = canonicaliseEmail(input.email);

      const limited = await spend('password-reset-confirm', context, email);
      if (limited !== null) return limited;

      const account = await persistence.findAccountByEmail(email);
      const operation =
        account === null
          ? undefined
          : await persistence.prepareSecurityOperation({
              kind: 'password-reset',
              accountId: account.id,
            });

      try {
        await auth.consumePasswordReset({
          email,
          token: input.token,
          newPassword: input.newPassword,
          ...(operation === undefined ? {} : { securityOperation: operation }),
        });
      } catch (error) {
        if (operation !== undefined) {
          await persistence.cancelSecurityOperation(operation.id);
          await persistence.reconcileSecurityOperation(operation.id);
        }
        return fail(mapMechanicsFailure(error));
      }

      if (
        operation === undefined ||
        !(await persistence.reconcileSecurityOperation(operation.id))
      ) {
        return fail('unavailable');
      }

      return { ok: true, reset: true };
    },

    /**
     * Proves the caller knows the account password, WITHOUT changing anything.
     *
     * Used to confirm a consequential self-service action. Re-proving the
     * credential is the only confirmation that means something: a typed
     * "DELETE" box proves that someone can type, not that they are the account
     * holder — which is the whole question when a browser is left unlocked.
     */
    async confirmPassword(
      context: RequestContext,
      session: ResolvedSession,
      input: { readonly password: string },
    ): Promise<boolean> {
      const limited = await spend('password-change', context, session.account.email);
      if (limited !== null) return false;

      return auth.verifyPassword({
        headers: context.headers,
        password: input.password,
      });
    },

    async changePassword(
      context: RequestContext,
      session: ResolvedSession,
      input: {
        readonly currentPassword: string;
        readonly newPassword: string;
      },
    ): Promise<IdentityResult<{ changed: true; setCookies: SetCookieHeaders }>> {
      const limited = await spend('password-change', context, session.account.email);
      if (limited !== null) return limited;

      let rotated: SetCookieHeaders;
      const operation = await persistence.prepareSecurityOperation({
        kind: 'password-change',
        accountId: session.account.id,
        initiatingSessionId: session.sessionId,
      });

      try {
        // Every session for the account is replaced, this one included. The
        // replacement cookie is carried back so Layer 4 can write it —
        // otherwise the person is signed out immediately after being told the
        // change worked.
        ({ setCookies: rotated } = await auth.changePassword({
          headers: context.headers,
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          securityOperation: operation,
        }));
      } catch {
        await persistence.cancelSecurityOperation(operation.id);
        await persistence.reconcileSecurityOperation(operation.id);
        return fail('invalid-credentials');
      }

      if (!(await persistence.reconcileSecurityOperation(operation.id))) {
        return fail('unavailable');
      }

      return { ok: true, changed: true, setCookies: rotated };
    },

    /* ---- Email change -------------------------------------------------- */

    /**
     * Starts a verified email change.
     *
     * The NEW address must prove itself before it becomes the account's, and
     * the current address is asked to approve first. A collision is refused
     * without revealing whether the target address already has an account
     * (DOMAIN_MODEL.md §4.6).
     */
    async requestEmailChange(
      context: RequestContext,
      session: ResolvedSession,
      input: { readonly newEmail: string; readonly currentPassword: string },
    ): Promise<IdentityResult<{ submitted: true }>> {
      const newEmail = canonicaliseEmail(input.newEmail);

      const limited = await spend('email-change-request', context, session.account.email);
      if (limited !== null) return limited;

      // STEP-UP FIRST, and it is not a formality. The account's address is how
      // every recovery path reaches this person; someone who can change it on
      // an unlocked browser owns the account permanently. Re-proving the
      // password is what an attacker with the session alone cannot do
      // (SECURITY_BASELINE.md §8.1).
      //
      // It is charged before the collision check, so the check cannot be
      // reached — and therefore cannot be probed — without the credential.
      const proved = await auth.verifyPassword({
        headers: context.headers,
        password: input.currentPassword,
      });
      if (!proved) return fail('invalid-credentials');

      if (newEmail === session.account.email) {
        return { ok: true, submitted: true };
      }

      const taken = await persistence.findAccountByEmail(newEmail);
      if (taken !== null) {
        // Uniform with success. Reporting "that address is taken" here would
        // turn an authenticated form into an enumeration oracle.
        return { ok: true, submitted: true };
      }

      // DURABLE FIRST, then the token — the same ordering, and for the same
      // reason, as `issueAndEnqueue`. A change token that exists with no record
      // that a message is owed for it is unreachable by any retry or sweep; a
      // delivery whose token has not been minted yet resolves to `not-yet` and
      // then abandons itself. Only one of those two residues is recoverable.
      await deliveries.enqueue({
        purpose: 'identity.email-change',
        recipient: newEmail,
        sourceReference: changeSource(session.account.email, newEmail),
        idempotencyKey: `identity.email-change:${session.account.id}:${newEmail}:${Date.now()}`,
      });

      await auth.requestEmailChange({
        headers: context.headers,
        newEmail,
      });

      return { ok: true, submitted: true };
    },

    /** Reads a change link's state WITHOUT consuming it. */
    async inspectEmailChange(
      session: ResolvedSession,
      input: { readonly newEmail: string },
      token: string,
    ): Promise<'valid' | 'invalid'> {
      return auth.inspectEmailChangeToken({
        currentEmail: session.account.email,
        newEmail: canonicaliseEmail(input.newEmail),
        token,
      });
    },

    /**
     * Completes a verified email change.
     *
     * Requires the SESSION as well as the token: the token proves the new
     * address is readable, the session proves the account is the one asking.
     * A link alone moves nobody's address.
     */
    async confirmEmailChange(
      context: RequestContext,
      session: ResolvedSession,
      input: { readonly newEmail: string; readonly token: string },
    ): Promise<IdentityResult<{ changed: true; setCookies: SetCookieHeaders }>> {
      const newEmail = canonicaliseEmail(input.newEmail);
      const previousEmail = session.account.email;

      const limited = await spend('email-change-confirm', context, previousEmail);
      if (limited !== null) return limited;

      let rotated: SetCookieHeaders;
      const operation = await persistence.prepareSecurityOperation({
        kind: 'email-change',
        accountId: session.account.id,
        initiatingSessionId: session.sessionId,
      });

      try {
        ({ setCookies: rotated } = await auth.confirmEmailChange({
          headers: context.headers,
          newEmail,
          token: input.token,
          securityOperation: operation,
        }));
      } catch (error) {
        await persistence.cancelSecurityOperation(operation.id);
        await persistence.reconcileSecurityOperation(operation.id);
        return fail(mapMechanicsFailure(error));
      }

      // Reconciliation also applies the required session consequence: it
      // preserves this acting session and revokes every other session that
      // existed when the vendor email write committed.
      if (!(await persistence.reconcileSecurityOperation(operation.id))) {
        return fail('unavailable');
      }

      return { ok: true, changed: true, setCookies: rotated };
    },

    /* ---- Account state ------------------------------------------------- */

    async updateProfile(
      session: ResolvedSession,
      input: { readonly name?: string },
    ): Promise<IdentityResult<{ account: AccountIdentity }>> {
      const account = await persistence.updateAccountProfile({
        accountId: session.account.id,
        ...(input.name === undefined ? {} : { name: input.name }),
      });

      return { ok: true, account };
    },

    async updateLanguage(
      session: ResolvedSession,
      input: { readonly locale?: string; readonly timezone?: string },
    ): Promise<IdentityResult<{ account: AccountIdentity }>> {
      const account = await persistence.updateAccountProfile({
        accountId: session.account.id,
        ...(input.locale === undefined ? {} : { locale: input.locale }),
        ...(input.timezone === undefined ? {} : { timezone: input.timezone }),
      });

      return { ok: true, account };
    },

    async completeAccountSetup(
      session: ResolvedSession,
      input: { readonly locale: string; readonly timezone: string },
    ): Promise<IdentityResult<{ account: AccountIdentity }>> {
      await persistence.updateAccountProfile({
        accountId: session.account.id,
        locale: input.locale,
        timezone: input.timezone,
      });

      const account = await persistence.completeAccountSetup(session.account.id);
      return { ok: true, account };
    },

    /** Whether setup still needs finishing. Used to route a new account. */
    setupComplete(account: AccountIdentity): boolean {
      return accountSetupComplete(account);
    },

    /**
     * Describes the account's authentication methods.
     *
     * Phase 2 has one. The count is what the final-method rule uses, so
     * Phase 2G adds Google without changing the rule.
     */
    async describeAuthenticationMethods(
      session: ResolvedSession,
    ): Promise<{ readonly count: number; readonly canRemoveOne: boolean }> {
      const count = await persistence.countAuthenticationMethods(session.account.id);
      return { count, canRemoveOne: !wouldRemoveFinalAuthenticationMethod(count) };
    },

    /**
     * Changes an account's status.
     *
     * Not reachable from a self-service surface in Chunk 1 — the privileged
     * administration that calls it arrives with Chunk 2's authorisation. It
     * exists now because the session chokepoint must have something real to
     * enforce against, and because disabled/suspended behaviour is a Chunk-1
     * requirement that has to be testable.
     */
    async setAccountStatus(input: {
      readonly accountId: string;
      readonly status: AccountStatus;
      readonly actorId: string | null;
      readonly actorType: string;
    }): Promise<IdentityResult<{ status: AccountStatus }>> {
      const account = await persistence.findAccountById(input.accountId);
      if (account === null) return fail('unavailable');

      if (!canTransition(account.status, input.status)) {
        return fail('invalid-transition');
      }

      await persistence.setAccountStatus({
        accountId: input.accountId,
        status: input.status,
      });

      // A status that removes the ability to act takes effect NOW, not at the
      // next sign-in. The session chokepoint would refuse the next request
      // anyway; revoking here means there is nothing left to refuse.
      if (input.status !== 'active') {
        await auth.revokeAllSessionsForAccount(input.accountId);
      }

      await audit.record({
        action: 'identity.account.status-changed',
        actorType: input.actorType,
        actorId: input.actorId,
        targetType: 'user',
        targetId: input.accountId,
        before: { status: account.status },
        after: { status: input.status },
      });

      return { ok: true, status: input.status };
    },

    /**
     * Closes an account.
     *
     * The row is retained and pseudonymised, the address released to a
     * non-routable tombstone, and credentials, sessions and outstanding tokens
     * disposed — all in ONE transaction owned by Identity. A later signup with
     * the original address is a genuinely new account that inherits nothing
     * (DOMAIN_MODEL.md §4.6).
     */
    async closeAccount(
      context: RequestContext,
      session: ResolvedSession,
    ): Promise<IdentityResult<{ closed: true }>> {
      const limited = await spend('account-closure', context, session.account.email);
      if (limited !== null) return limited;

      const account = session.account;

      // NOTHING IS ENQUEUED BEFORE THE TRANSACTION.
      //
      // It used to be, and the reason was real: closure replaces the address
      // with a tombstone, so after it commits there is no longer anywhere to
      // read the destination from. Enqueuing first solved that and created a
      // worse problem — a closure that then FAILED left a fully sendable
      // "your account has been closed" message for an account that is still
      // open. A person who hit an error and then received that notice has been
      // told something untrue about their own account.
      //
      // The destination travels with the intent instead, committed inside the
      // transaction and discarded when it is relayed. The message becomes
      // sendable only if the closure actually happened.
      await persistence.closeAccount({
        accountId: account.id,
        intent: {
          purpose: 'identity.account-closed',
          accountId: account.id,
          locale: account.locale,
          idempotencyKey: notificationKey({
            purpose: 'identity.account-closed',
            accountId: account.id,
            occasion: 'closure',
          }),
          recipientOverride: account.email,
        },
        audit: {
          action: 'identity.account.closed',
          actorType: 'user',
          actorId: account.id,
          targetType: 'user',
          targetId: account.id,
          before: { status: account.status },
          after: { status: 'closed' },
        },
      });

      return { ok: true, closed: true };
    },

    /* ---- Delivery source ----------------------------------------------- */

    /**
     * Resolves one of Identity's deliveries at send time.
     *
     * THIS is where a delivery RETRY gets its token: the same outstanding one,
     * re-materialised from Better Auth's own record. Nothing is minted, no
     * expiry is extended, and no bearer material was ever written anywhere
     * else to be read back (ARCHITECTURE.md §4.6.1).
     *
     * THREE ANSWERS, because a missing token means two different things.
     *
     * `nothing-owed` is the settled case: the token was used or expired, the
     * account closed, the address changed. The delivery is abandoned.
     *
     * `not-yet` is the transient one, and it exists because a token delivery
     * is made durable BEFORE the token is minted — deliberately, so that a
     * crash can never strand a live token with no record that a message was
     * owed. For the moment between those two commits the delivery is real and
     * its token is not, and abandoning it there would throw away the very
     * message the ordering exists to protect. It is distinguished by
     * `attemptCount`: on the FIRST attempt a missing token is far more likely
     * to be an issuance still in flight than one already spent, so the
     * delivery waits for its next scheduled attempt. By the second attempt the
     * issuance has plainly not happened, and it is abandoned like any other.
     */
    async resolveDelivery(delivery: DeliveryRecord): Promise<DeliveryResolution> {
      /** A token that is not there yet, versus one that never will be. */
      const missingToken = (): DeliveryResolution =>
        delivery.attemptCount === 0
          ? { outcome: 'not-yet' }
          : { outcome: 'nothing-owed' };

      const change = parseChangeSource(delivery.sourceReference);

      if (change !== null) {
        const material = await auth.materialiseEmailChangeToken(change);
        if (material === null) return missingToken();

        const account = await persistence.findAccountByEmail(change.currentEmail);
        const locale = account?.locale ?? 'en';

        const url = new URL(`/${locale}/confirm-email-change`, dependencies.baseUrl);
        url.searchParams.set('email', change.newEmail);
        url.searchParams.set('token', material.token);

        return {
          outcome: 'send',
          message: renderMessage({
            purpose: 'identity.email-change',
            locale,
            recipient: change.newEmail,
            actionUrl: url.toString(),
          }),
        };
      }

      const token = parseTokenSource(delivery.sourceReference);

      if (token !== null) {
        const material = await auth.materialiseOutstandingToken({
          purpose: token.purpose,
          email: token.email,
        });
        if (material === null) return missingToken();

        const account = await persistence.findAccountByEmail(token.email);
        const locale = account?.locale ?? 'en';

        // The link is LOCALE-PREFIXED, like every other route on the platform
        // (ROUTE_MAP.md §1.1). A link that dropped the prefix would redirect
        // through locale negotiation and could land someone in a language they
        // did not choose, on a page about their own account security.
        const url = new URL(
          `/${locale}${verificationPath(token.purpose)}`,
          dependencies.baseUrl,
        );
        url.searchParams.set('email', token.email);
        url.searchParams.set('token', material.token);

        return {
          outcome: 'send',
          message: renderMessage({
            purpose: delivery.purpose,
            locale,
            recipient: token.email,
            actionUrl: url.toString(),
          }),
        };
      }

      // A token-free notification. The recipient is whatever the account's
      // address is NOW, which is why it is resolved here rather than captured
      // when the intent was committed.
      const accountMatch = /^identity:(?:account|closed):([^:]+):(.+)$/.exec(
        delivery.sourceReference,
      );
      const accountId = accountMatch?.[1];
      const capturedRecipient = accountMatch?.[2];
      if (accountId === undefined || capturedRecipient === undefined) {
        return { outcome: 'nothing-owed' };
      }

      const account = await persistence.findAccountById(accountId);
      if (account === null) return { outcome: 'nothing-owed' };

      // A closure message goes to the address the account HAD, captured in the
      // reference, because by the time it sends the account's own address is a
      // tombstone.
      const recipient =
        delivery.purpose === 'identity.account-closed'
          ? capturedRecipient
          : account.email;

      return {
        outcome: 'send',
        message: renderMessage({
          purpose: delivery.purpose,
          locale: account.locale,
          recipient,
        }),
      };
    },

    /** Relays committed notification intents. Called by the Layer-4 dispatcher. */
    async relayPendingIntents(limit: number): Promise<number> {
      // A fresh process needs no request-local memory: the vendor transaction's
      // durable stamp is enough to reconstruct every missing security follow-up.
      await persistence.reconcileSecurityOperations(limit);
      const pending = await persistence.claimPendingIntents(limit);

      for (const intent of pending) {
        // A CLOSURE notice carries its destination, because the account's own
        // address is a tombstone by the time this runs. Every other purpose
        // resolves the recipient from the account at send time, so a
        // notification follows an address change rather than chasing a copy
        // taken when the intent was committed.
        const sourceReference =
          intent.recipientOverride === undefined
            ? `identity:account:${intent.accountId}:${intent.purpose}`
            : `identity:closed:${intent.accountId}:${intent.recipientOverride}`;

        await deliveries.enqueue({
          purpose: intent.purpose as DeliveryPurpose,
          recipient: intent.email,
          sourceReference,
          idempotencyKey: intent.idempotencyKey,
        });

        // AFTER the delivery exists, so a crash here replays the enqueue —
        // which is idempotent on the key — rather than losing the message.
        // The same call discards the captured address.
        await persistence.markIntentRelayed(intent.id);
      }

      return pending.length;
    },

    /** Whether an address may be written to at all. */
    async mayDeliverTo(recipient: string): Promise<boolean> {
      return !(await suppression.isSuppressed({ recipient, scope: 'transactional' }));
    },
  };
}

export type IdentityService = ReturnType<typeof createIdentityService>;

/**
 * Where each emailed link points, WITHOUT the locale prefix.
 *
 * An email-change confirmation lands on the same surface as a first
 * verification: from the recipient's side both are "prove this address is
 * yours", and giving them separate pages would duplicate every token state for
 * no difference the person can perceive.
 */
function verificationPath(purpose: AddressTokenPurpose): string {
  return purpose === 'password-reset' ? '/reset-password' : '/verify-email';
}

/** Maps an adapter failure class onto an application failure. */
function mapMechanicsFailure(error: unknown): IdentityFailure {
  const failure = (error as { failure?: unknown } | null)?.failure;

  if (failure === 'expired-token') return 'expired-token';
  if (failure === 'too-many-attempts') return 'too-many-attempts';
  if (failure === 'invalid-token') return 'invalid-token';
  if (failure === 'invalid-credentials') return 'invalid-credentials';
  return 'invalid-token';
}
