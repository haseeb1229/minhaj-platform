import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createProofDatabase, databaseConfigured, PROOF_PASSWORD } from './harness.ts';
import type { DisposableDatabase } from './harness.ts';
import {
  createIdentityHarness,
  cookieHeader,
  sessionContext,
  type IdentityHarness,
} from './service.ts';
import {
  actorFor,
  codeFor,
  createAccount,
  createAdministrator,
  enrolSecondFactor,
  grantCount,
  sessionCount,
  sessionOf,
  signIn,
  signInWithFactor,
  type Administrator,
} from './privileged.ts';

/**
 * PHASE 2 CHUNK 2 — step-up and the privileged second factor, live.
 *
 * THE TWO CONTROLS ARE PROVEN SEPARATELY, because the whole of
 * SECURITY_BASELINE.md §8 rests on them not standing in for each other:
 *
 *   - a complete posture with NO recent step-up is refused;
 *   - a fresh step-up with NO enrolled factor is refused.
 *
 * A suite that only proved the happy path would pass identically on an
 * implementation where either one alone was enough.
 *
 * THE CODES ARE REAL. They come from the library's own TOTP implementation,
 * over the secret in the enrolment URI, so "a correct code is accepted" means
 * an authenticator app would work rather than that two of this repository's
 * opinions agree.
 */

describe.skipIf(!databaseConfigured)(
  'Phase 2 Chunk 2 — step-up and privileged MFA (live SQL Server)',
  () => {
    let database: DisposableDatabase;
    let harness: IdentityHarness;
    let administrator: Administrator;

    beforeAll(async () => {
      database = await createProofDatabase();
      harness = await createIdentityHarness();
      administrator = await createAdministrator(
        harness,
        harness.provider,
        database.admin,
        'stepup-admin',
      );
    }, 240_000);

    afterAll(async () => {
      await database?.close();
    }, 60_000);

    /* ---- The two controls are not alternatives -------------------------- */

    describe('the second factor and step-up are distinct controls', () => {
      it('refuses a privileged action when the posture is complete but no step-up is live', async () => {
        const session = await sessionOf(harness, administrator);

        // Clear whatever grant a previous test left behind, so this asserts the
        // ABSENCE of a step-up rather than the state of the suite.
        await harness.authorizationStore.revokeStepUpGrantsForAccount(
          administrator.accountId,
        );

        const posture = await harness.privilegedSecurity.describe(
          administrator.accountId,
        );
        expect(posture.complete).toBe(true);

        const decision = await harness.authorization.requirePrivilegedAction({
          session,
          permission: 'permissions.grant',
          stepUp: 'privilege-administration',
        });

        expect(decision.state).toBe('denied');
        expect(decision.state === 'denied' ? decision.reason : '').toBe(
          'step-up-required',
        );
      });

      it('refuses a privileged action when a step-up is live but no factor is enrolled', async () => {
        // A second administrator cannot be bootstrapped — the bootstrap
        // self-closes — so this account is GRANTED the protected role by the
        // first one, which is the supported way to add an administrator.
        const candidate = await createAccount(harness, harness.provider, 'unenrolled');

        const actor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );
        const role = await harness.administration.findRole('platform-administrator');
        const granted = await harness.administration.grantRole(actor, {
          accountId: candidate.accountId,
          roleId: role?.id ?? '',
          reason: 'PROOF second administrator',
        });
        expect(granted.ok).toBe(true);

        // The grant revoked the account's session; sign in again.
        const signedIn = await signIn(harness, candidate.email);
        const session = await sessionOf(harness, signedIn);

        // It genuinely holds the permission.
        expect(
          (await harness.authorization.evaluate(session)).can('permissions.grant'),
        ).toBe(true);

        // A step-up grant, earned with the password alone — which is all this
        // account has, because it has no second factor yet.
        const stepUp = await harness.privilegedSecurity.beginStepUp(
          sessionContext(signedIn.cookie),
          session,
          { purpose: 'privilege-administration', password: PROOF_PASSWORD },
        );
        expect(stepUp.ok).toBe(true);

        // And the privileged action is STILL refused, for the other reason.
        const decision = await harness.authorization.requirePrivilegedAction({
          session,
          permission: 'permissions.grant',
          stepUp: 'privilege-administration',
        });
        expect(decision.state).toBe('denied');
        expect(decision.state === 'denied' ? decision.reason : '').toBe(
          'second-factor-required',
        );
      });

      it('refuses while the recovery codes are issued but not confirmed', async () => {
        // The HALF-FINISHED posture, which is the one a naive implementation
        // treats as complete: the factor works, and nobody has said they can
        // get back in without it (SECURITY_BASELINE.md §8.2).
        const candidate = await createAccount(harness, harness.provider, 'halfway');
        const session = await sessionOf(harness, candidate);

        const started = await harness.privilegedSecurity.beginEnrolment(
          sessionContext(candidate.cookie),
          session,
          { password: PROOF_PASSWORD },
        );
        expect(started.ok).toBe(true);

        const verified = await harness.privilegedSecurity.confirmEnrolment(
          sessionContext(candidate.cookie),
          session,
          { code: await codeFor(started.ok ? started.totpUri : '') },
        );
        expect(verified.ok).toBe(true);

        const posture = await harness.privilegedSecurity.describe(candidate.accountId);
        expect(posture.secondFactorEnrolled).toBe(true);
        expect(posture.recoveryCodesConfirmed).toBe(false);
        expect(posture.complete).toBe(false);
      });

      it('accepts the recovery-code acknowledgement in the order the page offers it', async () => {
        // THE ORDER A PERSON ACTUALLY WORKS IN. The setup key and the recovery
        // codes appear together, in one response, and the codes are shown ONCE
        // — before any code from the authenticator has been typed. So "I have
        // saved these" is answered first, and it has to be accepted then.
        //
        // Requiring a verified factor first refused the acknowledgement at the
        // only moment the codes were on screen. What followed was an account
        // that was enrolled, could no longer see the set it had been issued,
        // and was permanently short of the posture its privileged capability
        // waits on. Both halves are still required; only their ORDER is free.
        const candidate = await createAccount(harness, harness.provider, 'codes-first');
        const session = await sessionOf(harness, candidate);

        const started = await harness.privilegedSecurity.beginEnrolment(
          sessionContext(candidate.cookie),
          session,
          { password: PROOF_PASSWORD },
        );
        expect(started.ok).toBe(true);

        // Acknowledged BEFORE the factor is verified.
        const acknowledged = await harness.privilegedSecurity.confirmRecoveryCodes(
          await sessionOf(harness, candidate),
          { issuanceReceipt: started.ok ? started.recoveryCodeReceipt : '' },
        );
        expect(acknowledged.ok).toBe(true);

        // Half done, and honest about which half: the codes are accounted for,
        // the factor is not, and nothing privileged is available yet.
        const half = await harness.privilegedSecurity.describe(candidate.accountId);
        expect(half.recoveryCodesConfirmed).toBe(true);
        expect(half.secondFactorEnrolled).toBe(false);
        expect(half.complete).toBe(false);

        const verified = await harness.privilegedSecurity.confirmEnrolment(
          sessionContext(candidate.cookie),
          await sessionOf(harness, candidate),
          { code: await codeFor(started.ok ? started.totpUri : '') },
        );
        expect(verified.ok).toBe(true);

        const posture = await harness.privilegedSecurity.describe(candidate.accountId);
        expect(posture.complete).toBe(true);
      });

      it('has nothing to acknowledge before any codes have been issued', async () => {
        // FAIL CLOSED the other way. The acknowledgement records a fact about a
        // set of codes; with no set, there is no fact, and saying otherwise
        // would mark a posture half-complete on an account that had never seen
        // a code.
        const candidate = await createAccount(harness, harness.provider, 'no-codes');

        const refused = await harness.privilegedSecurity.confirmRecoveryCodes(
          await sessionOf(harness, candidate),
          { issuanceReceipt: new Date(0).toISOString() },
        );
        expect(refused.ok).toBe(false);
        expect(refused.ok ? null : refused.failure).toBe('not-enrolled');

        const posture = await harness.privilegedSecurity.describe(candidate.accountId);
        expect(posture.recoveryCodesConfirmed).toBe(false);
        expect(posture.complete).toBe(false);
      });

      it('lets a bootstrapped administrator reach the narrow setup surface and nothing else', async () => {
        // THE NON-CIRCULARITY PROOF. A freshly bootstrapped administrator holds
        // the protected role and can exercise NOTHING — except the self-service
        // Account & Security operations that complete the posture those
        // capabilities are waiting on (SECURITY_BASELINE.md §8.3).
        const candidate = await createAccount(harness, harness.provider, 'fresh-admin');

        const actor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );
        const role = await harness.administration.findRole('platform-administrator');
        await harness.administration.grantRole(actor, {
          accountId: candidate.accountId,
          roleId: role?.id ?? '',
          reason: 'PROOF non-circularity',
        });

        const signedIn = await signIn(harness, candidate.email);
        const session = await sessionOf(harness, signedIn);

        // READING an administrative surface is permitted — that is how they
        // discover what is missing.
        const read = await harness.authorization.requirePermission(
          session,
          'security.read',
        );
        expect(read.state).toBe('allowed');

        // Every high-consequence capability is refused.
        for (const permission of ['permissions.grant', 'users.administer'] as const) {
          const decision = await harness.authorization.requirePrivilegedAction({
            session,
            permission,
            stepUp: 'privilege-administration',
          });
          expect(decision.state).toBe('denied');
          expect(decision.state === 'denied' ? decision.reason : '').toBe(
            'second-factor-required',
          );
        }

        // And the setup surface works, WITHOUT already possessing a TOTP.
        const enrolment = await enrolSecondFactor(harness, signedIn);
        expect(enrolment.recoveryCodes.length).toBeGreaterThan(0);

        const posture = await harness.privilegedSecurity.describe(candidate.accountId);
        expect(posture.complete).toBe(true);
      });
    });

    /* ---- Step-up grants -------------------------------------------------- */

    describe('step-up grants', () => {
      it('is bound to the account, the session and the purpose', async () => {
        const session = await sessionOf(harness, administrator);

        await harness.authorizationStore.revokeStepUpGrantsForAccount(
          administrator.accountId,
        );
        const granted = await harness.privilegedSecurity.beginStepUp(
          sessionContext(administrator.cookie),
          session,
          {
            purpose: 'privilege-administration',
            password: PROOF_PASSWORD,
            code: await codeFor(administrator.totpUri),
          },
        );
        expect(granted.ok).toBe(true);

        const reader = harness.authorizationStore;

        // The right session and purpose: found.
        expect(await reader.readPosture(administrator.accountId).then(() => true)).toBe(
          true,
        );

        const [row] = await database.admin.query<{
          userId: string;
          sessionId: string;
          purpose: string;
        }>(
          `SELECT TOP 1 [userId], [sessionId], [purpose] FROM [dbo].[StepUpGrant]
           WHERE [userId] = N'${administrator.accountId}' ORDER BY [createdAt] DESC;`,
        );
        expect(row?.userId).toBe(administrator.accountId);
        expect(row?.sessionId).toBe(session.sessionId);
        expect(row?.purpose).toBe('privilege-administration');

        // A DIFFERENT purpose is not satisfied by it: re-proving yourself to
        // edit a role must not authorise changing an account's status.
        const other = await harness.authorization.requirePrivilegedAction({
          session,
          permission: 'users.administer',
          stepUp: 'account-administration',
        });
        expect(other.state).toBe('denied');
        expect(other.state === 'denied' ? other.reason : '').toBe('step-up-required');
      });

      it('is not satisfied by another session of the same account', async () => {
        const first = await sessionOf(harness, administrator);

        await harness.authorizationStore.revokeStepUpGrantsForAccount(
          administrator.accountId,
        );
        await harness.privilegedSecurity.beginStepUp(
          sessionContext(administrator.cookie),
          first,
          {
            purpose: 'privilege-administration',
            password: PROOF_PASSWORD,
            code: await codeFor(administrator.totpUri),
          },
        );

        // A second device for the same person. Its session id differs, so the
        // grant the first device earned does not travel to it.
        //
        // Signing in ANSWERS THE CHALLENGE, because this account has a factor —
        // which is itself the behaviour the enrolled-account sign-in proof
        // asserts, exercised here as a precondition.
        const second = await signInWithFactor(harness, administrator);
        const secondSession = await sessionOf(harness, second);
        expect(secondSession.sessionId).not.toBe(first.sessionId);

        const decision = await harness.authorization.requirePrivilegedAction({
          session: secondSession,
          permission: 'permissions.grant',
          stepUp: 'privilege-administration',
        });
        expect(decision.state).toBe('denied');
        expect(decision.state === 'denied' ? decision.reason : '').toBe(
          'step-up-required',
        );

        // Restore the administrator's working cookie for the rest of the suite.
        Object.assign(administrator, { cookie: second.cookie });
      });

      it('expires', async () => {
        const session = await sessionOf(harness, administrator);

        const grant = await harness.authorizationStore.createStepUpGrant({
          accountId: administrator.accountId,
          sessionId: session.sessionId,
          purpose: 'account-administration',
          // Already expired when it is written: the lifetime is what the
          // authorisation service reads, not how long the test waits.
          lifetimeSeconds: -1,
        });
        expect(grant.expiresAt.getTime()).toBeLessThan(Date.now());

        const decision = await harness.authorization.requirePrivilegedAction({
          session,
          permission: 'users.administer',
          stepUp: 'account-administration',
        });
        expect(decision.state).toBe('denied');
        expect(decision.state === 'denied' ? decision.reason : '').toBe(
          'step-up-required',
        );
      });

      it('dies with the session that earned it', async () => {
        const target = await createAccount(harness, harness.provider, 'revoked-session');
        const session = await sessionOf(harness, target);

        await harness.authorizationStore.createStepUpGrant({
          accountId: target.accountId,
          sessionId: session.sessionId,
          purpose: 'second-factor',
          lifetimeSeconds: 300,
        });
        expect(await grantCount(database.admin, target.accountId)).toBe(1);

        // Revoking the SESSION takes the grant with it — a schema property, not
        // a second delete somebody has to remember. Signing out deletes exactly
        // the session that earned the grant, which is the narrowest way to
        // observe the cascade.
        await harness.identity.signOut(sessionContext(target.cookie));

        expect(await sessionCount(database.admin, target.accountId)).toBe(0);
        expect(await grantCount(database.admin, target.accountId)).toBe(0);
      });

      it('is revoked by a change to the account’s own second factor', async () => {
        const account = await createAccount(harness, harness.provider, 'refactored');
        const enrolment = await enrolSecondFactor(harness, account);

        const session = await sessionOf(harness, account);
        await harness.authorizationStore.createStepUpGrant({
          accountId: account.accountId,
          sessionId: session.sessionId,
          purpose: 'privilege-administration',
          lifetimeSeconds: 300,
        });
        expect(await grantCount(database.admin, account.accountId)).toBe(1);

        const regenerated = await harness.privilegedSecurity.regenerateRecoveryCodes(
          sessionContext(account.cookie),
          session,
          { password: PROOF_PASSWORD, code: await codeFor(enrolment.totpUri) },
        );
        expect(regenerated.ok).toBe(true);

        expect(await grantCount(database.admin, account.accountId)).toBe(0);
      });
    });

    /* ---- The signed-in attempt budget ----------------------------------- */

    describe('the signed-in attempt budget', () => {
      it('refuses a wrong code and spends the budget doing it', async () => {
        const account = await createAccount(harness, harness.provider, 'budget');
        const enrolment = await enrolSecondFactor(harness, account);
        const session = await sessionOf(harness, account);

        // The library applies NO attempt budget to a signed-in verification —
        // its counter and its lockout are scoped to the sign-in flow. Without
        // the application limiter, this loop would run as fast as the network
        // allows over a six-digit space (CLAUDE.md §16, §38).
        const outcomes: string[] = [];
        for (let attempt = 0; attempt < 6; attempt += 1) {
          const result = await harness.privilegedSecurity.beginStepUp(
            sessionContext(account.cookie),
            session,
            {
              purpose: 'privilege-administration',
              password: PROOF_PASSWORD,
              code: '000000',
            },
          );
          outcomes.push(result.ok ? 'ok' : result.failure);
        }

        // Wrong codes first, then the limiter closes the door.
        expect(outcomes).toContain('invalid-code');
        expect(outcomes).toContain('rate-limited');

        // And a CORRECT code is refused too while the budget is spent: the
        // limiter is not bypassed by knowing the answer.
        const correct = await harness.privilegedSecurity.beginStepUp(
          sessionContext(account.cookie),
          session,
          {
            purpose: 'privilege-administration',
            password: PROOF_PASSWORD,
            code: await codeFor(enrolment.totpUri),
          },
        );
        expect(correct.ok).toBe(false);
        expect(correct.ok ? '' : correct.failure).toBe('rate-limited');
      });

      it('cannot be outrun by concurrency', async () => {
        const account = await createAccount(harness, harness.provider, 'concurrent');
        await enrolSecondFactor(harness, account);
        const session = await sessionOf(harness, account);

        // Twelve at once against a budget of five. The limiter's consume is a
        // single atomic step, so a race cannot produce more successes than the
        // budget allows.
        const attempts = await Promise.all(
          Array.from({ length: 12 }, () =>
            harness.privilegedSecurity.beginStepUp(
              sessionContext(account.cookie),
              session,
              {
                purpose: 'privilege-administration',
                password: PROOF_PASSWORD,
                code: '111111',
              },
            ),
          ),
        );

        const limited = attempts.filter(
          (attempt) => !attempt.ok && attempt.failure === 'rate-limited',
        );
        expect(limited.length).toBeGreaterThan(0);

        // Nothing was granted: every code was wrong.
        expect(attempts.some((attempt) => attempt.ok)).toBe(false);
        expect(await grantCount(database.admin, account.accountId)).toBe(0);
      });
    });

    /* ---- Recovery codes --------------------------------------------------- */

    describe('recovery codes', () => {
      it('are single-use, and regeneration invalidates every prior code', async () => {
        const account = await createAccount(harness, harness.provider, 'codes');
        const enrolment = await enrolSecondFactor(harness, account);
        const session = await sessionOf(harness, account);

        const [first, second] = enrolment.recoveryCodes;
        expect(first).toBeDefined();
        expect(second).toBeDefined();

        // Spending one: accepted once.
        const spent = await harness.auth.consumeRecoveryCode({
          headers: sessionContext(account.cookie).headers,
          code: first as string,
        });
        expect(spent).toBe(true);

        // The SAME code again: refused.
        const reused = await harness.auth.consumeRecoveryCode({
          headers: sessionContext(account.cookie).headers,
          code: first as string,
        });
        expect(reused).toBe(false);

        // Regeneration replaces the whole set.
        const fresh = await harness.privilegedSecurity.regenerateRecoveryCodes(
          sessionContext(account.cookie),
          session,
          { password: PROOF_PASSWORD, code: await codeFor(enrolment.totpUri) },
        );
        expect(fresh.ok).toBe(true);
        const replacements = fresh.ok ? fresh.recoveryCodes : [];
        expect(replacements).toHaveLength(enrolment.recoveryCodes.length);
        expect(replacements).not.toContain(first);

        // An unused code from the OLD set no longer works.
        const stale = await harness.auth.consumeRecoveryCode({
          headers: sessionContext(account.cookie).headers,
          code: second as string,
        });
        expect(stale).toBe(false);

        // A code from the new set does.
        const live = await harness.auth.consumeRecoveryCode({
          headers: sessionContext(account.cookie).headers,
          code: replacements[0] as string,
        });
        expect(live).toBe(true);
      });

      it('cannot be spent twice concurrently', async () => {
        const account = await createAccount(harness, harness.provider, 'race-codes');
        const enrolment = await enrolSecondFactor(harness, account);

        const code = enrolment.recoveryCodes[0] as string;
        const headers = sessionContext(account.cookie).headers;

        const outcomes = await Promise.all([
          harness.auth.consumeRecoveryCode({ headers, code }),
          harness.auth.consumeRecoveryCode({ headers, code }),
        ]);

        // Consumption is a compare-and-set over the stored set, so exactly one
        // of two racing attempts can win. Reporting success twice for one spent
        // code would be the defect, whatever the stored set then held.
        expect(outcomes.filter(Boolean)).toHaveLength(1);

        // And EXACTLY ONE code left the set. Two successes against one removal
        // would mean a single-use secret was accepted twice — which is what the
        // per-account serialisation in `recovery-lock.ts` exists to prevent.
        let stillUsable = 0;
        for (const candidate of enrolment.recoveryCodes.slice(1)) {
          if (await harness.auth.consumeRecoveryCode({ headers, code: candidate })) {
            stillUsable += 1;
          }
        }
        expect(stillUsable).toBe(enrolment.recoveryCodes.length - 1);

        // And the code is genuinely gone: a third attempt finds nothing to
        // spend, whichever of the two won.
        const afterwards = await harness.auth.consumeRecoveryCode({ headers, code });
        expect(afterwards).toBe(false);
      });

      it('cannot be spent twice across two concurrent sign-in challenges', async () => {
        const account = await createAccount(harness, harness.provider, 'challenge-race');
        const enrolment = await enrolSecondFactor(harness, account);
        const code = enrolment.recoveryCodes[0] as string;

        const challenges = await Promise.all([
          harness.identity.signIn(sessionContext(''), {
            email: account.email,
            password: PROOF_PASSWORD,
          }),
          harness.identity.signIn(sessionContext(''), {
            email: account.email,
            password: PROOF_PASSWORD,
          }),
        ]);

        const cookies = challenges.map((challenge) => {
          expect(challenge.ok && challenge.state).toBe('second-factor-required');
          return cookieHeader(challenge.ok ? challenge.setCookies : []);
        });
        expect(cookies[0]).not.toBe(cookies[1]);

        const outcomes = await Promise.all(
          cookies.map((cookie) =>
            harness.identity.completeSecondFactor(sessionContext(cookie), {
              code,
              kind: 'recovery-code',
            }),
          ),
        );

        expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
      });

      it('resets the posture to unconfirmed when a new set is issued', async () => {
        const account = await createAccount(harness, harness.provider, 'reconfirm');
        const enrolment = await enrolSecondFactor(harness, account);
        const session = await sessionOf(harness, account);

        expect(
          (await harness.privilegedSecurity.describe(account.accountId)).complete,
        ).toBe(true);

        const regenerated = await harness.privilegedSecurity.regenerateRecoveryCodes(
          sessionContext(account.cookie),
          session,
          { password: PROOF_PASSWORD, code: await codeFor(enrolment.totpUri) },
        );
        expect(regenerated.ok).toBe(true);

        const stale = await harness.privilegedSecurity.confirmRecoveryCodes(session, {
          issuanceReceipt: enrolment.recoveryCodeReceipt,
        });
        expect(stale.ok).toBe(false);
        expect(stale.ok ? '' : stale.failure).toBe('unavailable');

        // The codes the person stored no longer work, so the posture is
        // incomplete until they say they have the new ones.
        const after = await harness.privilegedSecurity.describe(account.accountId);
        expect(after.recoveryCodesConfirmed).toBe(false);
        expect(after.complete).toBe(false);

        const acknowledged = await harness.privilegedSecurity.confirmRecoveryCodes(
          session,
          {
            issuanceReceipt: regenerated.ok ? regenerated.recoveryCodeReceipt : '',
          },
        );
        expect(acknowledged.ok).toBe(true);
        expect(
          (await harness.privilegedSecurity.describe(account.accountId)).complete,
        ).toBe(true);
      });
    });

    /* ---- Disabling the factor -------------------------------------------- */

    describe('disabling the second factor', () => {
      it('refuses a password alone — there is no hidden bypass', async () => {
        const account = await createAccount(harness, harness.provider, 'nobypass');
        await enrolSecondFactor(harness, account);
        const session = await sessionOf(harness, account);

        const outcome = await harness.privilegedSecurity.disableSecondFactor(
          sessionContext(account.cookie),
          session,
          { password: PROOF_PASSWORD },
        );

        expect(outcome.ok).toBe(false);
        expect(outcome.ok ? '' : outcome.failure).toBe('invalid-code');

        // Still enrolled.
        expect(
          (await harness.privilegedSecurity.describe(account.accountId))
            .secondFactorEnrolled,
        ).toBe(true);
      });

      it('accepts the password plus the current factor', async () => {
        const account = await createAccount(harness, harness.provider, 'disable-totp');
        const enrolment = await enrolSecondFactor(harness, account);
        const session = await sessionOf(harness, account);

        const outcome = await harness.privilegedSecurity.disableSecondFactor(
          sessionContext(account.cookie),
          session,
          { password: PROOF_PASSWORD, code: await codeFor(enrolment.totpUri) },
        );
        expect(outcome.ok).toBe(true);

        const posture = await harness.privilegedSecurity.describe(account.accountId);
        expect(posture.secondFactorEnrolled).toBe(false);
        expect(posture.recoveryCodesConfirmed).toBe(false);
      });

      it('accepts the password plus a RECOVERY code, for a lost authenticator', async () => {
        // The route for somebody who has lost the device. Requiring "the lost
        // TOTP itself" would make loss unrecoverable through any supported
        // path (SECURITY_BASELINE.md §8.2).
        const account = await createAccount(harness, harness.provider, 'disable-code');
        const enrolment = await enrolSecondFactor(harness, account);
        const session = await sessionOf(harness, account);

        const outcome = await harness.privilegedSecurity.disableSecondFactor(
          sessionContext(account.cookie),
          session,
          {
            password: PROOF_PASSWORD,
            recoveryCode: enrolment.recoveryCodes[0] as string,
          },
        );
        expect(outcome.ok).toBe(true);

        expect(
          (await harness.privilegedSecurity.describe(account.accountId))
            .secondFactorEnrolled,
        ).toBe(false);
      });

      it('refuses a wrong password even with a correct factor', async () => {
        const account = await createAccount(harness, harness.provider, 'wrongpass');
        const enrolment = await enrolSecondFactor(harness, account);
        const session = await sessionOf(harness, account);

        const outcome = await harness.privilegedSecurity.disableSecondFactor(
          sessionContext(account.cookie),
          session,
          {
            password: 'not-the-password-at-all-1234',
            code: await codeFor(enrolment.totpUri),
          },
        );

        expect(outcome.ok).toBe(false);
        expect(
          (await harness.privilegedSecurity.describe(account.accountId))
            .secondFactorEnrolled,
        ).toBe(true);
      });
    });

    /* ---- General users --------------------------------------------------- */

    describe('general users', () => {
      it('are never forced into a second factor', async () => {
        // MFA is a PRIVILEGED requirement, not a universal one. A visitor who
        // bookmarks an ayah is not an administrator (SECURITY_BASELINE.md §8.2).
        const person = await createAccount(harness, harness.provider, 'ordinary');

        const posture = await harness.privilegedSecurity.describe(person.accountId);
        expect(posture.secondFactorEnrolled).toBe(false);
        expect(posture.complete).toBe(false);

        // And they can still use the product: a session resolves, the account
        // acts on itself, nothing demands enrolment.
        const session = await sessionOf(harness, person);
        expect(session.account.status).toBe('active');

        const sessions = await harness.identity.listSessions(
          sessionContext(person.cookie),
        );
        expect(sessions.length).toBeGreaterThanOrEqual(1);

        // Signing in is not challenged, because no factor is enrolled.
        const again = await harness.identity.signIn(sessionContext(person.cookie), {
          email: person.email,
          password: PROOF_PASSWORD,
        });
        expect(again.ok && again.state).toBe('authenticated');
      });

      it('is CHALLENGED at sign-in once a factor is enrolled', async () => {
        const account = await createAccount(harness, harness.provider, 'challenged');
        const enrolment = await enrolSecondFactor(harness, account);

        const attempt = await harness.identity.signIn(sessionContext(''), {
          email: account.email,
          password: PROOF_PASSWORD,
        });

        expect(attempt.ok).toBe(true);
        expect(attempt.ok ? attempt.state : '').toBe('second-factor-required');

        // The challenge cookie carries the pending identity; nothing about the
        // account reaches the caller until the factor is answered.
        const challenge = (attempt.ok ? attempt.setCookies : []) as readonly string[];
        expect(challenge.length).toBeGreaterThan(0);

        const cookie = challenge
          .map((value) => value.split(';')[0])
          .filter((pair): pair is string => pair !== undefined && pair.includes('='))
          .join('; ');

        const completed = await harness.identity.completeSecondFactor(
          sessionContext(cookie),
          { code: await codeFor(enrolment.totpUri), kind: 'totp' },
        );

        expect(completed.ok).toBe(true);
        expect(completed.ok ? completed.account.email : '').toBe(account.email);
      });
    });

    /* ---- Nothing sensitive is recorded ----------------------------------- */

    describe('what is never recorded', () => {
      it('writes no secret and no recovery code into the audit trail', async () => {
        const account = await createAccount(harness, harness.provider, 'nosecrets');
        const enrolment = await enrolSecondFactor(harness, account);

        const secret = new URL(enrolment.totpUri).searchParams.get('secret') ?? '';
        expect(secret).not.toBe('');

        const codes = enrolment.recoveryCodes;

        const [row] = await database.admin.query<{ total: number }>(`
          SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog]
          WHERE ISNULL([beforeState], N'') LIKE N'%${secret}%'
             OR ISNULL([afterState], N'')  LIKE N'%${secret}%'
             OR ISNULL([beforeState], N'') LIKE N'%${codes[0]}%'
             OR ISNULL([afterState], N'')  LIKE N'%${codes[0]}%'
             OR ISNULL([authorisingSource], N'') LIKE N'%${secret}%';
        `);
        expect(Number(row?.total ?? 0)).toBe(0);

        // The enrolment IS audited — the event, never the material.
        const [enrolled] = await database.admin.query<{ total: number }>(
          `SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog]
           WHERE [action] = N'identity.security.factor-enrolled'
             AND [targetId] = N'${account.accountId}';`,
        );
        expect(Number(enrolled?.total ?? 0)).toBe(1);
      });

      it('tells the person their second factor changed, without describing it', async () => {
        const account = await createAccount(harness, harness.provider, 'notified');
        await enrolSecondFactor(harness, account);
        await harness.dispatch();

        const messages = harness.provider.messagesTo(account.email);
        const notice = messages.find((message) =>
          message.idempotencyKey.startsWith('identity.second-factor-changed'),
        );

        expect(notice).toBeDefined();
        expect(notice?.text ?? '').not.toContain('secret');
        // No code, no key, no count — the message says an event happened.
        expect(notice?.text ?? '').not.toMatch(/[A-Z0-9]{5}-[A-Z0-9]{5}/);
      });
    });

    /* ---- Operational recovery -------------------------------------------- */

    describe('host-only operational recovery', () => {
      it('resets the factor, keeps the role, and demands re-enrolment', async () => {
        // The full behaviour is proven against the operator PRINCIPAL by
        // `npm run db:test:operator`; this proves what the platform then
        // believes about the account — the half only the services can see.
        const candidate = await createAccount(harness, harness.provider, 'recovered');

        const actor = await actorFor(
          harness,
          administrator,
          'permissions.grant',
          'privilege-administration',
        );
        const role = await harness.administration.findRole('platform-administrator');
        await harness.administration.grantRole(actor, {
          accountId: candidate.accountId,
          roleId: role?.id ?? '',
          reason: 'PROOF recovery target',
        });

        const signedIn = await signIn(harness, candidate.email);
        await enrolSecondFactor(harness, signedIn);
        expect(
          (await harness.privilegedSecurity.describe(candidate.accountId)).complete,
        ).toBe(true);

        await database.admin.execute('IdentityRecoverPrivilegedSecondFactor', {
          targetUserId: candidate.accountId,
          ticket: 'PROOF lost authenticator',
        });

        // No factor, no confirmed codes, and a durable re-enrolment demand.
        const posture = await harness.privilegedSecurity.describe(candidate.accountId);
        expect(posture.secondFactorEnrolled).toBe(false);
        expect(posture.recoveryCodesConfirmed).toBe(false);
        expect(posture.reenrolmentRequired).toBe(true);
        expect(posture.complete).toBe(false);

        // Sessions and grants are gone.
        expect(await sessionCount(database.admin, candidate.accountId)).toBe(0);
        expect(await grantCount(database.admin, candidate.accountId)).toBe(0);

        // THE ROLE IS UNTOUCHED — recovery never grants and never regrants.
        const held = await harness.administration.listAssignments({
          accountId: candidate.accountId,
          includeRevoked: true,
          limit: 10,
          offset: 0,
        });
        expect(held.items).toHaveLength(1);
        expect(held.items[0]?.revokedAt).toBeNull();

        // The account signs in with its password — no challenge, because there
        // is no factor any more — and reaches the setup surface.
        const back = await signIn(harness, candidate.email);
        const session = await sessionOf(harness, back);

        // Privileged capability stays denied until re-enrolment completes.
        const decision = await harness.authorization.requirePrivilegedAction({
          session,
          permission: 'permissions.grant',
          stepUp: 'privilege-administration',
        });
        expect(decision.state).toBe('denied');
        expect(decision.state === 'denied' ? decision.reason : '').toBe(
          'second-factor-required',
        );

        // And enrolling again clears the demand.
        await enrolSecondFactor(harness, back);
        const restored = await harness.privilegedSecurity.describe(candidate.accountId);
        expect(restored.reenrolmentRequired).toBe(false);
        expect(restored.complete).toBe(true);
      }, 120_000);
    });
  },
);
