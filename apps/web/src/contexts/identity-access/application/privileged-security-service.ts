import type {
  AuthMechanicsPort,
  AuthorizationPersistencePort,
  IdentityPersistencePort,
  PrivilegedPosture,
  ResolvedSession,
  SetCookieHeaders,
  StepUpGrantSummary,
  StepUpPurpose,
} from '@minhaj/contracts/identity';
import { STEP_UP_LIFETIME_SECONDS } from '@minhaj/contracts/identity';
import type { AuditPort, RateLimiterPort } from '@minhaj/contracts/platform';

import { notificationKey } from '../domain/account.ts';
import type { RequestContext } from './identity-service.ts';
import { createSpender } from './spend.ts';

/**
 * Identity & Access — PRIVILEGED SECURITY: step-up, the second factor and the
 * recovery codes.
 *
 * TWO CONTROLS, NOT ONE, and keeping them apart is most of what this file is
 * for (SECURITY_BASELINE.md §8):
 *
 *   - an ENROLLED SECOND FACTOR is required before a high-consequence
 *     capability may be exercised at all. It is a durable property of the
 *     account and it is not proof that anybody is present;
 *   - STEP-UP is required at the MOMENT a sensitive operation is performed. It
 *     is proof that somebody re-authenticated seconds ago and it says nothing
 *     about what factors the account has.
 *
 * Neither substitutes for the other, and nothing here lets one stand in for
 * the other: `beginStepUp` never marks a factor enrolled, and enrolling a
 * factor never issues a grant.
 *
 * THE LIMITER IS NOT OPTIONAL. Better Auth applies an attempt budget to
 * second-factor verification on the SIGN-IN path only — for a signed-in
 * caller its counter is a no-op and its account lockout does not run. Every
 * privileged proof below therefore spends the SQL limiter first, on a
 * purpose-scoped, key-versioned HMAC subject (CLAUDE.md §16, §38).
 */

export type PrivilegedSecurityFailure =
  | 'invalid-credentials'
  | 'rate-limited'
  /** A second factor is already enrolled; enrol again by disabling it first. */
  | 'already-enrolled'
  /** No factor is enrolled, so there is nothing to verify, regenerate or remove. */
  | 'not-enrolled'
  /** The submitted second factor or recovery code was refused. */
  | 'invalid-code'
  | 'unavailable';

export interface PrivilegedSecurityError {
  readonly ok: false;
  readonly failure: PrivilegedSecurityFailure;
  readonly retryAfter?: number;
}

export type PrivilegedSecurityResult<T> =
  ({ readonly ok: true } & T) | PrivilegedSecurityError;

function fail(
  failure: PrivilegedSecurityFailure,
  retryAfter?: number,
): PrivilegedSecurityError {
  return retryAfter === undefined
    ? { ok: false, failure }
    : { ok: false, failure, retryAfter };
}

/** Posture plus the one derived question every surface actually asks. */
export interface PrivilegedSecurityState extends PrivilegedPosture {
  /**
   * May this account exercise a high-consequence capability?
   *
   * The conjunction, stated once. A surface that recombined the three flags
   * itself would be a second definition of "complete", free to disagree with
   * the authorisation service that enforces it.
   */
  readonly complete: boolean;
}

export interface PrivilegedSecurityServiceDependencies {
  readonly auth: AuthMechanicsPort;
  readonly authorization: AuthorizationPersistencePort;
  readonly persistence: IdentityPersistencePort;
  readonly audit: AuditPort;
  readonly limiter: RateLimiterPort;
  readonly rateLimitKey: (input: {
    readonly purpose: string;
    readonly subject: string;
  }) => string;
}

export function createPrivilegedSecurityService(
  dependencies: PrivilegedSecurityServiceDependencies,
) {
  const { auth, authorization, persistence, audit } = dependencies;

  const spend = createSpender({
    limiter: dependencies.limiter,
    rateLimitKey: dependencies.rateLimitKey,
  });

  async function stateOf(accountId: string): Promise<PrivilegedSecurityState> {
    const posture = await authorization.readPosture(accountId);
    return {
      ...posture,
      complete:
        posture.secondFactorEnrolled &&
        posture.recoveryCodesConfirmed &&
        !posture.reenrolmentRequired,
    };
  }

  /**
   * Records a second-factor change and tells the person it happened.
   *
   * ONE transaction for the audit record and the notification intent, through
   * the Identity operation that exists for exactly this: a security change
   * that was recorded but never disclosed is indistinguishable from one
   * somebody deliberately kept quiet (ARCHITECTURE.md §4.6.1).
   *
   * The payload names the EVENT and nothing else — never the secret, never a
   * recovery code, never how many remain.
   */
  async function recordFactorChange(
    session: ResolvedSession,
    occasion: string,
    action: string,
  ): Promise<void> {
    await persistence.recordSecurityFollowUp({
      audit: {
        action,
        actorType: 'user',
        actorId: session.account.id,
        targetType: 'user',
        targetId: session.account.id,
        after: { secondFactor: occasion },
      },
      intent: {
        purpose: 'identity.second-factor-changed',
        accountId: session.account.id,
        locale: session.account.locale,
        idempotencyKey: notificationKey({
          purpose: 'identity.second-factor-changed',
          accountId: session.account.id,
          occasion: `${occasion}:${Date.now()}`,
        }),
      },
    });
  }

  return {
    /** The account's privileged posture, for the surfaces that report it. */
    async describe(accountId: string): Promise<PrivilegedSecurityState> {
      return stateOf(accountId);
    },

    /* ---- Step-up --------------------------------------------------------- */

    /**
     * Re-proves the person in front of the screen, and records it.
     *
     * WHAT COUNTS AS PROOF depends on what the account HAS, and it is always
     * the strongest thing available:
     *
     *   - the password, always. Re-proving the credential is the only
     *     confirmation that means something: a typed "CONFIRM" box proves
     *     somebody can type, which is not the question when a browser is left
     *     unlocked;
     *   - AND the current second factor, whenever one is enrolled. A step-up
     *     that accepted a password alone from an account with a factor would be
     *     the password-only privileged bypass §8.2 forbids — a stolen password
     *     would be enough again at the exact moment it matters most.
     *
     * The grant is bound to THIS session and THIS purpose, expires in minutes,
     * and is a row rather than a token: nothing the client sends creates one
     * and revoking it is a delete.
     */
    async beginStepUp(
      context: RequestContext,
      session: ResolvedSession,
      input: {
        readonly purpose: StepUpPurpose;
        readonly password: string;
        readonly code?: string;
      },
    ): Promise<PrivilegedSecurityResult<{ grant: StepUpGrantSummary }>> {
      const limited = await spend('step-up', context, session.account.email);
      if (limited !== null) return fail('rate-limited', limited.retryAfter);

      const verified = await auth.verifyPassword({
        headers: context.headers,
        password: input.password,
      });
      if (!verified) return fail('invalid-credentials');

      const posture = await authorization.readPosture(session.account.id);

      if (posture.secondFactorEnrolled) {
        if (input.code === undefined || input.code === '') return fail('invalid-code');

        const codeLimited = await spend(
          'second-factor-verify',
          context,
          session.account.email,
        );
        if (codeLimited !== null) return fail('rate-limited', codeLimited.retryAfter);

        const accepted = await auth.verifySecondFactorCode({
          headers: context.headers,
          code: input.code,
        });
        if (!accepted) return fail('invalid-code');
      }

      const grant = await authorization.createStepUpGrant({
        accountId: session.account.id,
        sessionId: session.sessionId,
        purpose: input.purpose,
        lifetimeSeconds: STEP_UP_LIFETIME_SECONDS,
      });

      await audit.record({
        action: 'identity.security.step-up-granted',
        actorType: 'user',
        actorId: session.account.id,
        targetType: 'user',
        targetId: session.account.id,
        after: { purpose: input.purpose },
      });

      return { ok: true, grant };
    },

    /* ---- Enrolment -------------------------------------------------------- */

    /**
     * Starts enrolment: creates the unverified factor and issues recovery codes.
     *
     * IT DOES NOT REQUIRE AN ALREADY-ENROLLED TOTP, and must not. Requiring one
     * would make the very first enrolment impossible, which would make the
     * bootstrap and the audited operational recovery impossible with it — the
     * newly provisioned administrator would hold a role they could never use
     * (SECURITY_BASELINE.md §8.3).
     *
     * What it does require is the account PASSWORD, which is the recent
     * primary-auth proof appropriate to an account that has no second factor
     * yet.
     *
     * THE CODES ARE RETURNED ONCE. They are not persisted in clear by this
     * platform, not logged, not audited, and there is no operation anywhere
     * that shows them again — regenerating is the only way to see a set, and
     * that invalidates the previous one.
     */
    async beginEnrolment(
      context: RequestContext,
      session: ResolvedSession,
      input: { readonly password: string },
    ): Promise<
      PrivilegedSecurityResult<{
        totpUri: string;
        recoveryCodes: readonly string[];
        recoveryCodeReceipt: string;
      }>
    > {
      const limited = await spend(
        'second-factor-enrolment',
        context,
        session.account.email,
      );
      if (limited !== null) return fail('rate-limited', limited.retryAfter);

      const posture = await authorization.readPosture(session.account.id);
      if (posture.secondFactorEnrolled) return fail('already-enrolled');

      let enrolment: {
        totpUri: string;
        recoveryCodes: readonly string[];
        recoveryCodeReceipt: string;
      };
      try {
        enrolment = await auth.beginSecondFactorEnrolment({
          headers: context.headers,
          password: input.password,
        });
      } catch {
        return fail('invalid-credentials');
      }

      // The codes exist NOW, and the posture says so — unconfirmed, because
      // nobody has yet said they stored them. Recording it before the person
      // sees them means an abandoned enrolment leaves a posture that is
      // visibly incomplete rather than one that looks finished.
      await audit.record({
        action: 'identity.security.enrolment-started',
        actorType: 'user',
        actorId: session.account.id,
        targetType: 'user',
        targetId: session.account.id,
        // No secret, no URI, no codes, no count. Only that it happened.
        after: { secondFactor: 'enrolment-started' },
      });

      return { ok: true, ...enrolment };
    },

    /**
     * Verifies the first code and completes enrolment.
     *
     * The session is REPLACED by the library when the factor state changes, so
     * the replacement cookies travel back for Layer 4 to write; dropping them
     * signs the person out one request after telling them it worked.
     */
    async confirmEnrolment(
      context: RequestContext,
      session: ResolvedSession,
      input: { readonly code: string },
    ): Promise<PrivilegedSecurityResult<{ setCookies: SetCookieHeaders }>> {
      const limited = await spend('second-factor-verify', context, session.account.email);
      if (limited !== null) return fail('rate-limited', limited.retryAfter);

      const outcome = await auth.verifySecondFactorEnrolment({
        headers: context.headers,
        code: input.code,
      });

      if (!outcome.verified) return fail('invalid-code');

      await authorization.recordSecondFactorVerified(session.account.id);

      // The elevation earned under the OLD security posture does not survive a
      // change to it (SECURITY_BASELINE.md §8.1).
      await authorization.revokeStepUpGrantsForAccount(session.account.id);

      await recordFactorChange(session, 'enrolled', 'identity.security.factor-enrolled');

      return { ok: true, setCookies: outcome.setCookies };
    },

    /**
     * Records that the person has stored their recovery codes.
     *
     * ONE OF THE TWO HALVES OF POSTURE, and a real one rather than a
     * formality: an enrolled factor with no usable recovery is a lockout
     * waiting to be resolved by exactly the silent administrative disable the
     * baseline forbids (§8.2). Until this is recorded, every high-consequence
     * capability stays denied.
     *
     * IT ASKS ONLY THAT A SET HAS BEEN ISSUED, and deliberately not that the
     * factor is already verified. The codes are displayed once — at the moment
     * they are issued, alongside the setup key and before any code from the
     * authenticator has been typed — so the acknowledgement has to be
     * answerable then. Demanding a verified factor first refused it at the one
     * moment the codes were on screen, and left an account enrolled, unable to
     * acknowledge a set it could no longer see, and permanently short of the
     * posture its privileged capability waits on.
     *
     * The posture is still BOTH halves. Nothing here enrols anything, and
     * `complete` continues to require a verified factor as well.
     */
    async confirmRecoveryCodes(
      session: ResolvedSession,
      input: { readonly issuanceReceipt: string },
    ): Promise<PrivilegedSecurityResult<{ state: PrivilegedSecurityState }>> {
      const posture = await authorization.readPosture(session.account.id);
      if (!posture.recoveryCodesIssued) return fail('not-enrolled');

      const confirmed = await authorization.recordRecoveryCodesConfirmed(
        session.account.id,
        input.issuanceReceipt,
      );
      if (!confirmed) return fail('unavailable');

      await audit.record({
        action: 'identity.security.recovery-codes-confirmed',
        actorType: 'user',
        actorId: session.account.id,
        targetType: 'user',
        targetId: session.account.id,
        after: { secondFactor: 'recovery-codes-confirmed' },
      });

      return { ok: true, state: await stateOf(session.account.id) };
    },

    /**
     * Issues a fresh set of recovery codes.
     *
     * Every prior unused code stops working — the stored set is replaced, not
     * appended to (§8.2). Requires the password AND the current factor, because
     * somebody who can silently mint a new set of single-use credentials for an
     * account has the account.
     *
     * The posture returns to "codes issued, not confirmed", so privileged
     * capability is denied until the new set is acknowledged.
     */
    async regenerateRecoveryCodes(
      context: RequestContext,
      session: ResolvedSession,
      input: { readonly password: string; readonly code: string },
    ): Promise<
      PrivilegedSecurityResult<{
        recoveryCodes: readonly string[];
        recoveryCodeReceipt: string;
      }>
    > {
      const limited = await spend(
        'second-factor-enrolment',
        context,
        session.account.email,
      );
      if (limited !== null) return fail('rate-limited', limited.retryAfter);

      const posture = await authorization.readPosture(session.account.id);
      if (!posture.secondFactorEnrolled) return fail('not-enrolled');

      const codeLimited = await spend(
        'second-factor-verify',
        context,
        session.account.email,
      );
      if (codeLimited !== null) return fail('rate-limited', codeLimited.retryAfter);

      const accepted = await auth.verifySecondFactorCode({
        headers: context.headers,
        code: input.code,
      });
      if (!accepted) return fail('invalid-code');

      let issued: {
        recoveryCodes: readonly string[];
        recoveryCodeReceipt: string;
      };
      try {
        issued = await auth.regenerateRecoveryCodes({
          headers: context.headers,
          password: input.password,
        });
      } catch {
        return fail('invalid-credentials');
      }

      await authorization.revokeStepUpGrantsForAccount(session.account.id);

      await audit.record({
        action: 'identity.security.recovery-codes-regenerated',
        actorType: 'user',
        actorId: session.account.id,
        targetType: 'user',
        targetId: session.account.id,
        after: { secondFactor: 'recovery-codes-regenerated' },
      });

      return { ok: true, ...issued };
    },

    /**
     * Removes the account's second factor, at the account's own request.
     *
     * WHAT IT REQUIRES, and why each part:
     *
     *   - the PASSWORD — recent strong primary-auth proof;
     *   - AND either the CURRENT factor or a single-use RECOVERY code.
     *
     * The second half is what stops a stolen password from removing the control
     * that exists because passwords get stolen. It deliberately does NOT
     * require "the lost TOTP itself" as the only route: a person who has lost
     * their authenticator uses a recovery code here, and a person who has lost
     * both goes to the host-only audited recovery procedure — which is a
     * separate mechanism precisely so that no helpdesk action can silently
     * disable a factor to restore access (SECURITY_BASELINE.md §8.2).
     */
    async disableSecondFactor(
      context: RequestContext,
      session: ResolvedSession,
      input: {
        readonly password: string;
        readonly code?: string;
        readonly recoveryCode?: string;
      },
    ): Promise<PrivilegedSecurityResult<{ setCookies: SetCookieHeaders }>> {
      const limited = await spend('step-up', context, session.account.email);
      if (limited !== null) return fail('rate-limited', limited.retryAfter);

      const posture = await authorization.readPosture(session.account.id);
      if (!posture.secondFactorEnrolled) return fail('not-enrolled');

      const usingCode = input.code !== undefined && input.code !== '';
      const usingRecovery = input.recoveryCode !== undefined && input.recoveryCode !== '';

      if (!usingCode && !usingRecovery) return fail('invalid-code');

      if (usingCode) {
        const codeLimited = await spend(
          'second-factor-verify',
          context,
          session.account.email,
        );
        if (codeLimited !== null) return fail('rate-limited', codeLimited.retryAfter);

        const accepted = await auth.verifySecondFactorCode({
          headers: context.headers,
          code: input.code as string,
        });
        if (!accepted) return fail('invalid-code');
      } else {
        const recoveryLimited = await spend(
          'recovery-code',
          context,
          session.account.email,
        );
        if (recoveryLimited !== null) {
          return fail('rate-limited', recoveryLimited.retryAfter);
        }

        const accepted = await auth.consumeRecoveryCode({
          headers: context.headers,
          code: input.recoveryCode as string,
        });
        if (!accepted) return fail('invalid-code');
      }

      let rotation: { setCookies: SetCookieHeaders };
      try {
        rotation = await auth.disableSecondFactor({
          headers: context.headers,
          password: input.password,
        });
      } catch {
        return fail('invalid-credentials');
      }

      await authorization.clearSecondFactorPosture(session.account.id);
      await authorization.revokeStepUpGrantsForAccount(session.account.id);

      await recordFactorChange(session, 'disabled', 'identity.security.factor-disabled');

      return { ok: true, setCookies: rotation.setCookies };
    },
  };
}

export type PrivilegedSecurityService = ReturnType<
  typeof createPrivilegedSecurityService
>;
