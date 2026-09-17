import 'server-only';

import { timingSafeEqual } from 'node:crypto';

import type {
  AccountIdentity,
  AuthMechanicsPort,
  AuthenticationOutcome,
  RequestHeaders,
  ResolvedSession,
  SessionRotation,
  SessionSummary,
  SignOutOutcome,
  TokenDeliveryMaterial,
} from '@minhaj/contracts/identity';

import {
  createAuthInstance,
  changeIdentitySubject,
  otpTypeFor,
  type AuthInstance,
  type AuthMechanicsConfiguration,
} from './auth.ts';
import {
  AuthMechanicsError,
  asDate,
  classifyAuthError,
  setCookiesFrom,
  toAccountIdentity,
  type AuthSessionRow,
  type AuthUserRow,
} from './projection.ts';
import { withSecurityMutation } from './reconciled-auth-client.ts';
import {
  withChallengeRecoveryLock,
  withRecoveryCodeIssuanceLock,
  withRecoveryLock,
} from './recovery-lock.ts';
import { getDatabaseClient } from '../../client.ts';

/**
 * THE public entry of the Identity & Access persistence and auth-mechanics
 * adapter.
 *
 * Semantic owner: `identity-access`, declared in this package's manifest under
 * `minhaj.persistenceAdapters`. Physical placement inside a platform package
 * transfers no ownership (ARCHITECTURE.md §4.1, §6.3 rule 14).
 *
 * WHAT CROSSES THIS BOUNDARY. Narrow named operations and domain values.
 *
 * WHAT DOES NOT, AND WHY EACH ONE MATTERS:
 *
 *   - the Prisma client, a delegate, a transaction handle, a raw-query
 *     facility — possession of any of them IS raw database capability (§3.1.2)
 *   - Better Auth's `auth`, `auth.api`, `auth.$context` or internal adapter —
 *     each is a generic endpoint or CRUD surface over the auth tables, and a
 *     generic surface is the repository this phase prohibits
 *   - the `DBAdapter` that `prismaAdapter` returns, for the same reason
 *
 * WHAT THIS MODULE DOES NOT DECIDE. Whether an account may sign in, whether a
 * message should be sent and what it says, whether a rate limit applies to a
 * person, whether an operation is authorised, what a role means. Those are
 * Identity's, and they stay in `apps/web/src/contexts/identity-access`. This
 * module performs mechanics and reports facts.
 */

export type { AuthMechanicsConfiguration };
export { AuthMechanicsError };
export type { AuthMechanicsFailure } from './projection.ts';
export { createIdentityPersistence, tombstoneEmail } from './persistence.ts';

/**
 * The AUTHORISATION side of the same context-owned adapter.
 *
 * Re-exported THROUGH this entry rather than published from the package root
 * directly: this file is the declared adapter entry, and therefore the
 * encapsulation boundary the analyser walks to. A sibling module exported past
 * it would put the Prisma client on the package's public surface — not because
 * the module hands one out, but because nothing between it and the front door
 * is a boundary (ARCHITECTURE.md §4.1, §6.3 rule 13).
 */
export {
  AuthorizationDataError,
  createAuthorizationPersistence,
  createAuthorizationReader,
} from './authorization.ts';

/**
 * Builds the adapter.
 *
 * One instance per process. Layer 4 constructs it and injects it into the
 * Identity context; nothing else may hold it.
 */
export function createAuthMechanicsAdapter(
  configuration: AuthMechanicsConfiguration,
): AuthMechanicsPort {
  // PRIVATE. Never returned, never exported, never reachable from the object
  // below except through the named operations that close over it.
  const auth: AuthInstance = createAuthInstance(configuration);

  return {
    async createCredentialAccount({ email, password, name, locale }) {
      try {
        const created = await auth.api.signUpEmail({ body: { email, password, name } });

        // `locale` is declared `input: false`, so a sign-up body cannot carry
        // it. The account's interface language is set here, by the only path
        // permitted to set it.
        const context = await auth.$context;
        const updated = await context.internalAdapter.updateUser(created.user.id, {
          locale,
        });

        return toAccountIdentity(updated as AuthUserRow);
      } catch (error) {
        throw classifyAuthError(error as { body?: { code?: string } });
      }
    },

    async authenticateWithPassword({
      email,
      password,
      headers,
    }): Promise<AuthenticationOutcome> {
      try {
        const { headers: responseHeaders, response } = await auth.api.signInEmail({
          body: { email, password },
          headers,
          returnHeaders: true,
        });

        const setCookies = setCookiesFrom(responseHeaders);

        // AN ENROLLED SECOND FACTOR MEANS NO SESSION YET. The library deletes
        // the session the credential handler created, sets a short-lived
        // challenge cookie and reports `twoFactorRedirect`. Those cookies still
        // have to reach the browser — they ARE the challenge — but nothing
        // about the account is established to the caller until the factor is
        // answered (SECURITY_BASELINE.md §8.2).
        if (isTwoFactorChallenge(response)) {
          return { state: 'second-factor-required', setCookies };
        }

        return {
          state: 'authenticated',
          account: toAccountIdentity(response.user as AuthUserRow),
          setCookies,
        };
      } catch (error) {
        throw classifyAuthError(error as { body?: { code?: string } });
      }
    },

    async verifyPassword({ headers, password }): Promise<boolean> {
      try {
        const outcome = await auth.api.verifyPassword({ body: { password }, headers });
        return outcome?.status === true;
      } catch {
        // A wrong password is an ANSWER to this question, not an exception.
        return false;
      }
    },

    async resolveSession(headers: RequestHeaders): Promise<ResolvedSession | null> {
      const session = await auth.api.getSession({ headers });
      if (session === null) return null;

      const row = session.session as AuthSessionRow;

      return {
        sessionId: row.id,
        sessionCreatedAt: asDate(row.createdAt) ?? new Date(0),
        sessionExpiresAt: asDate(row.expiresAt) ?? new Date(0),
        account: toAccountIdentity(session.user as AuthUserRow),
      };
    },

    async listSessions(headers: RequestHeaders): Promise<readonly SessionSummary[]> {
      const current = await auth.api.getSession({ headers });
      const sessions = await auth.api.listSessions({ headers });

      return sessions.map((entry): SessionSummary => {
        const row = entry as AuthSessionRow;
        return {
          id: row.id,
          createdAt: asDate(row.createdAt) ?? new Date(0),
          expiresAt: asDate(row.expiresAt) ?? new Date(0),
          ipAddress: row.ipAddress ?? null,
          userAgent: row.userAgent ?? null,
          current: row.id === current?.session.id,
        };
      });
    },

    async revokeSessionById({ headers, sessionId }): Promise<boolean> {
      // The token is resolved HERE, from the caller's own session list, and
      // never leaves this method. `listSessions` is scoped to the requesting
      // account by the library, so an id belonging to somebody else simply is
      // not found — the ownership check is the lookup, not a comparison that
      // could be forgotten.
      const sessions = await auth.api.listSessions({ headers });
      const match = sessions.find((entry) => (entry as AuthSessionRow).id === sessionId);

      if (match === undefined) return false;

      await auth.api.revokeSession({ body: { token: match.token }, headers });
      return true;
    },

    async revokeOtherSessions(headers: RequestHeaders): Promise<void> {
      await auth.api.revokeOtherSessions({ headers });
    },

    async revokeAllSessionsForAccount(accountId: string): Promise<number> {
      // No caller's headers are involved: this is the CONSEQUENCE of a
      // security or privilege change, applied to an account, rather than
      // something a session asked for.
      const context = await auth.$context;
      const before = await context.internalAdapter.listSessions(accountId);
      await context.internalAdapter.deleteUserSessions(accountId);
      return before.length;
    },

    async signOut(headers: RequestHeaders): Promise<SignOutOutcome> {
      const { headers: responseHeaders } = await auth.api.signOut({
        headers,
        returnHeaders: true,
      });
      return { setCookies: setCookiesFrom(responseHeaders) };
    },

    async changePassword({
      headers,
      currentPassword,
      newPassword,
      securityOperation,
    }): Promise<SessionRotation> {
      try {
        // `revokeOtherSessions` does more than its name suggests: the library
        // deletes EVERY session for the account, this one included, and issues
        // a replacement. Returning the resulting cookies is therefore not a
        // nicety — without them the caller's cookie names a session that no
        // longer exists, and the person is signed out one request after being
        // told the change succeeded.
        const { headers: responseHeaders } = await withSecurityMutation(
          {
            operationId: securityOperation.id,
            accountId: securityOperation.accountId,
            kind: 'password-change',
          },
          () =>
            auth.api.changePassword({
              body: { currentPassword, newPassword, revokeOtherSessions: true },
              headers,
              returnHeaders: true,
            }),
        );

        return { setCookies: setCookiesFrom(responseHeaders) };
      } catch (error) {
        throw classifyAuthError(error as { body?: { code?: string } });
      }
    },

    // ---- Tokens ---------------------------------------------------------

    async issueToken({ purpose, email }): Promise<void> {
      try {
        await auth.api.sendVerificationOTP({
          body: { email, type: otpTypeFor(purpose) },
        });
      } catch (error) {
        throw classifyAuthError(error as { body?: { code?: string } });
      }
    },

    async materialiseOutstandingToken({
      purpose,
      email,
    }): Promise<TokenDeliveryMaterial | null> {
      // `getVerificationOTP` is the library's own SERVER-ONLY operation: never
      // routable, scoped to one `(email, type)` delivery identity, unable to
      // enumerate, and returning `null` once the record is absent or expired.
      //
      // That last property is what stops a dispatcher delivering a link that
      // has already died — so no separate expiry bookkeeping is needed here,
      // and none is kept. Nothing in this method writes anywhere.
      const outcome = await auth.api.getVerificationOTP({
        query: { email, type: otpTypeFor(purpose) },
      });

      const token = outcome?.otp;
      if (typeof token !== 'string' || token === '') return null;

      return { purpose, email, token };
    },

    async inspectToken({
      purpose,
      email,
      token,
    }): Promise<'valid' | 'invalid' | 'expired'> {
      try {
        // Reads state WITHOUT consuming it: on a CORRECT token nothing is
        // mutated, so rendering the confirmation page cannot burn the link the
        // person is about to click (SECURITY_BASELINE.md §7.4).
        await auth.api.checkVerificationOTP({
          body: { email, otp: token, type: otpTypeFor(purpose) },
        });
        return 'valid';
      } catch (error) {
        const failure = classifyAuthError(error as { body?: { code?: string } }).failure;
        return failure === 'expired-token' ? 'expired' : 'invalid';
      }
    },

    async confirmEmailVerification({ email, token }): Promise<void> {
      try {
        await auth.api.verifyEmailOTP({ body: { email, otp: token } });
      } catch (error) {
        throw classifyAuthError(error as { body?: { code?: string } });
      }
    },

    async consumePasswordReset({
      email,
      token,
      newPassword,
      securityOperation,
    }): Promise<void> {
      try {
        const reset = () =>
          auth.api.resetPasswordEmailOTP({
            body: { email, otp: token, password: newPassword },
          });

        if (securityOperation === undefined) {
          await reset();
        } else {
          await withSecurityMutation(
            {
              operationId: securityOperation.id,
              accountId: securityOperation.accountId,
              kind: 'password-reset',
            },
            reset,
          );
        }
      } catch (error) {
        throw classifyAuthError(error as { body?: { code?: string } });
      }
    },

    // ---- Email change ---------------------------------------------------

    async requestEmailChange({ headers, newEmail }): Promise<void> {
      try {
        // Session-guarded at the library (`sensitiveSessionMiddleware`), which
        // is why the headers are not optional here. The current address comes
        // from that session rather than from the caller — an account may only
        // move its OWN address.
        await auth.api.requestEmailChangeEmailOTP({ body: { newEmail }, headers });
      } catch (error) {
        throw classifyAuthError(error as { body?: { code?: string } });
      }
    },

    async materialiseEmailChangeToken({
      currentEmail,
      newEmail,
    }): Promise<TokenDeliveryMaterial | null> {
      // The same server-only, non-routable read the single-address purposes
      // use, addressed at the PAIR the change record is keyed on. Nothing here
      // writes, mints, rotates or extends.
      const outcome = await auth.api.getVerificationOTP({
        query: {
          email: changeIdentitySubject(currentEmail, newEmail),
          type: 'change-email',
        },
      });

      const token = outcome?.otp;
      if (typeof token !== 'string' || token === '') return null;

      return { purpose: 'email-change', email: newEmail, token };
    },

    async inspectEmailChangeToken({
      currentEmail,
      newEmail,
      token,
    }): Promise<'valid' | 'invalid'> {
      // `checkVerificationOTP` cannot serve here: it validates its `email`
      // argument as an address, and a change record's subject is a PAIR. The
      // equivalent non-consuming read is the materialisation above followed by
      // a comparison — which, unlike the check endpoint, also spends no part
      // of the attempt budget on merely RENDERING the page.
      const outcome = await auth.api.getVerificationOTP({
        query: {
          email: changeIdentitySubject(currentEmail, newEmail),
          type: 'change-email',
        },
      });

      const expected = outcome?.otp;
      if (typeof expected !== 'string' || expected === '') return 'invalid';

      // Constant time. A byte-by-byte comparison that returns early leaks the
      // length of the matching prefix, which is enough to reconstruct a token
      // given enough attempts.
      const a = Buffer.from(expected);
      const b = Buffer.from(token);

      return a.length === b.length && timingSafeEqual(a, b) ? 'valid' : 'invalid';
    },

    async confirmEmailChange({
      headers,
      newEmail,
      token,
      securityOperation,
    }): Promise<SessionRotation> {
      try {
        // The library refreshes the session cookie here too, so the same rule
        // applies: whatever it produced is returned for Layer 4 to write.
        const { headers: responseHeaders } = await withSecurityMutation(
          {
            operationId: securityOperation.id,
            accountId: securityOperation.accountId,
            kind: 'email-change',
          },
          () =>
            auth.api.changeEmailEmailOTP({
              body: { newEmail, otp: token },
              headers,
              returnHeaders: true,
            }),
        );

        return { setCookies: setCookiesFrom(responseHeaders) };
      } catch (error) {
        throw classifyAuthError(error as { body?: { code?: string } });
      }
    },

    // ---- Privileged second factor ---------------------------------------
    //
    // MECHANICS ONLY. Whether a factor is REQUIRED, what a failed attempt
    // costs and what a change to one invalidates are all Identity's, and none
    // of them appears below. Nothing here returns the stored TOTP secret or
    // reads existing recovery codes back: no operation the adapter calls could,
    // and none is added that would.

    async beginSecondFactorEnrolment({ headers, password }) {
      try {
        const session = await auth.api.getSession({ headers });
        if (session === null) throw new AuthMechanicsError('invalid-credentials');

        const issued = await withRecoveryCodeIssuanceLock(session.user.id, async () => {
          const outcome = await auth.api.enableTwoFactor({
            // `method: 'totp'` explicitly. The alternative is an emailed code,
            // and it is unreachable anyway because no `sendOTP` is configured.
            body: { password, method: 'totp' },
            headers,
          });

          if (outcome.method !== 'totp') throw new AuthMechanicsError('unknown');

          return {
            // The otpauth: URI contains the secret and is returned once only.
            totpUri: outcome.totpURI,
            recoveryCodes: outcome.backupCodes,
          };
        });

        if (issued === null || issued.totpUri === undefined) {
          throw new AuthMechanicsError('unknown');
        }
        return { ...issued, totpUri: issued.totpUri };
      } catch (error) {
        if (error instanceof AuthMechanicsError) throw error;
        throw classifyAuthError(error as { body?: { code?: string } });
      }
    },

    async verifySecondFactorEnrolment({ headers, code }) {
      try {
        const { headers: responseHeaders } = await auth.api.verifyTOTP({
          // `trustDevice` is never sent. A trusted device that skipped the
          // factor would be the bypass SECURITY_BASELINE.md §8.2 forbids for
          // high-consequence operations, and a convenience nobody asked for.
          body: { code },
          headers,
          returnHeaders: true,
        });

        // The library replaces the session when the account's factor state
        // changes, so the replacement cookies go back for Layer 4 to write.
        // Dropping them signs the person out one request after telling them
        // enrolment succeeded.
        return { verified: true, setCookies: setCookiesFrom(responseHeaders) };
      } catch {
        // A wrong code is an ANSWER to this question, not an exception.
        return { verified: false, setCookies: [] };
      }
    },

    async verifySecondFactorCode({ headers, code }) {
      try {
        await auth.api.verifyTOTP({ body: { code }, headers });
        return true;
      } catch {
        return false;
      }
    },

    async consumeRecoveryCode({ headers, code }) {
      // WHOSE code this is, before anything is spent. The lock needs a subject
      // and the library resolves the account internally, so it is resolved here
      // too — one extra read on a rare, high-consequence operation.
      const session = await auth.api.getSession({ headers });
      if (session === null) return false;

      // SERIALISED PER ACCOUNT. The library's compare-and-set is not atomic on
      // this adapter, and two racing verifications of the same code both report
      // success (see `./recovery-lock.ts`). A busy lock is reported as a failed
      // verification, which is the fail-closed answer.
      return withRecoveryLock(`user:${session.user.id}`, async () => {
        try {
          await auth.api.verifyBackupCode({
            // `disableSession: true` because this caller is ALREADY signed in
            // and wants no session change — only the code spent.
            body: { code, disableSession: true },
            headers,
          });
          return true;
        } catch {
          return false;
        }
      });
    },

    async regenerateRecoveryCodes({ headers, password }) {
      try {
        const session = await auth.api.getSession({ headers });
        if (session === null) throw new AuthMechanicsError('invalid-credentials');

        const issued = await withRecoveryCodeIssuanceLock(session.user.id, async () => {
          const outcome = await auth.api.generateBackupCodes({
            body: { password },
            headers,
          });
          // Every prior unused code stops working: the stored set is REPLACED.
          return { recoveryCodes: outcome.backupCodes };
        });
        if (issued === null) throw new AuthMechanicsError('unknown');
        return issued;
      } catch (error) {
        if (error instanceof AuthMechanicsError) throw error;
        throw classifyAuthError(error as { body?: { code?: string } });
      }
    },

    async disableSecondFactor({ headers, password }) {
      try {
        const { headers: responseHeaders } = await auth.api.disableTwoFactor({
          body: { password },
          headers,
          returnHeaders: true,
        });
        return { setCookies: setCookiesFrom(responseHeaders) };
      } catch (error) {
        throw classifyAuthError(error as { body?: { code?: string } });
      }
    },

    // ---- Completing a challenged sign-in ---------------------------------

    async completeSignInWithCode({ headers, code }) {
      try {
        const { headers: responseHeaders } = await auth.api.verifyTOTP({
          body: { code },
          headers,
          returnHeaders: true,
        });
        return await authenticatedFrom(setCookiesFrom(responseHeaders));
      } catch (error) {
        throw classifyAuthError(error as { body?: { code?: string } });
      }
    },

    async completeSignInWithRecoveryCode({ headers, code }) {
      // NO SESSION YET, but the challenge's server-side Verification row names
      // the account. Lock the ACCOUNT, not the random challenge identifier:
      // one account can have two simultaneous sign-in challenges, and a lock
      // per challenge would still let the same recovery code win once in each.
      const accountId = await challengedAccountOf(headers);
      if (accountId === null) throw new AuthMechanicsError('invalid-credentials');

      const outcome = await withChallengeRecoveryLock('user:' + accountId, async () => {
        const { headers: responseHeaders } = await auth.api.verifyBackupCode({
          body: { code },
          headers,
          returnHeaders: true,
        });
        return authenticatedFrom(setCookiesFrom(responseHeaders));
      }).catch((error: unknown) => {
        throw classifyAuthError(error as { body?: { code?: string } });
      });

      if (outcome === null) throw new AuthMechanicsError('invalid-credentials');
      return outcome;
    },
  } satisfies AuthMechanicsPort;

  /**
   * Resolves the account AUTHORITATIVELY from the session the library just
   * issued.
   *
   * The challenge endpoints return a user PROJECTION shaped by the library's
   * own `returned` rules, and this platform's account status is the one field
   * that must never be read from a projection: a missing `status` is
   * interpreted as `disabled` by design, which would sign somebody out
   * immediately after a correct second factor. Reading the session back asks
   * the database instead.
   */
  async function authenticatedFrom(
    setCookies: readonly string[],
  ): Promise<AuthenticationOutcome> {
    const session = await auth.api.getSession({ headers: cookieHeaders(setCookies) });
    if (session === null) throw new AuthMechanicsError('invalid-credentials');

    return {
      state: 'authenticated',
      account: toAccountIdentity(session.user as AuthUserRow),
      setCookies,
    };
  }
}

/**
 * The value of the two-factor challenge cookie, if the request carries one.
 *
 * Read by NAME rather than parsed loosely: the library names the cookie
 * `two_factor` under its own prefix, and a `__Secure-` variant is issued when
 * the deployment serves over HTTPS. Both spellings are the same challenge.
 *
 * It is used ONLY as a lock subject, never as authority: the library still
 * verifies the signed cookie itself, so a forged value serialises against
 * nothing and then fails verification.
 */
function twoFactorChallengeOf(headers: RequestHeaders): string | null {
  const cookie = headers.get('cookie');
  if (cookie === null) return null;

  for (const pair of cookie.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;

    const name = pair.slice(0, separator).trim();
    if (!/(^|\.)two_factor$/.test(name.replace(/^__Secure-/, ''))) continue;

    const value = pair.slice(separator + 1).trim();
    if (value !== '') return value;
  }

  return null;
}

/**
 * Resolves Better Auth 1.7.4's signed challenge identifier to its server-side
 * account subject without exposing the Verification store outside this private
 * mechanics adapter. Better Auth still authenticates the cookie and verifies
 * the recovery code; this read decides only which cross-process lock to take.
 */
async function challengedAccountOf(headers: RequestHeaders): Promise<string | null> {
  const cookie = twoFactorChallengeOf(headers);
  if (cookie === null) return null;

  const signature = cookie.lastIndexOf('.');
  if (signature < 1) return null;
  const identifier = cookie.slice(0, signature);
  if (!/^2fa-[A-Za-z0-9_-]{20}$/.test(identifier)) return null;

  const challenge = await getDatabaseClient().verification.findFirst({
    where: { identifier },
    select: { value: true, expiresAt: true },
  });

  if (challenge === null || challenge.expiresAt.getTime() <= Date.now()) return null;
  return challenge.value;
}

/** Is this sign-in response the library's "the factor is still owed" answer? */
function isTwoFactorChallenge(response: unknown): boolean {
  return (
    typeof response === 'object' &&
    response !== null &&
    (response as { twoFactorRedirect?: unknown }).twoFactorRedirect === true
  );
}

/**
 * Turns `Set-Cookie` values into the `Cookie` header a follow-up read needs.
 *
 * Name and value only, which is all a browser would send back. It exists so a
 * session the library issued inside one call can be read back inside that same
 * call, before Layer 4 has written anything.
 */
function cookieHeaders(setCookies: readonly string[]): Headers {
  const cookie = setCookies
    .map((value) => value.split(';')[0])
    .filter((pair): pair is string => pair !== undefined && pair.includes('='))
    .join('; ');

  return new Headers(cookie === '' ? {} : { cookie });
}

/** Re-exported for callers that need to describe an account. */
export type { AccountIdentity };
