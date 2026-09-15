import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createProofDatabase,
  databaseConfigured,
  freshEmail,
  linkParameters,
  PROOF_NEW_PASSWORD,
  PROOF_PASSWORD,
  type DisposableDatabase,
} from './harness.ts';
import {
  anonymousContext,
  cookieHeader,
  createIdentityHarness,
  sessionContext,
  type IdentityHarness,
} from './service.ts';

/**
 * PHASE 2 CHUNK 1 — the credential and account lifecycle, end to end.
 *
 * Run against the real Better Auth instance, the real Prisma persistence, the
 * real SQL rate limiter and a live SQL Server. The only substitution is the
 * outbound provider, which captures instead of sending.
 *
 * WHAT THESE PROVE, and why each is here rather than assumed:
 *
 *   - enumeration resistance, which is a property of what the platform SAYS
 *     and can only be checked by comparing two responses;
 *   - single-use, attempt-bounded, non-consuming-on-GET tokens, which are
 *     properties of database state under concurrency;
 *   - account status enforced on EVERY authenticated request, which is a
 *     property of the chokepoint rather than of the sign-in path;
 *   - closure and clean re-registration, which is the one flow where getting
 *     it wrong leaves a person unable to sign in AND unable to start again.
 */

let database: DisposableDatabase;
let harness: IdentityHarness;

/** Signs a brand-new, verified, signed-in account into existence. */
async function newVerifiedAccount(
  prefix = 'lifecycle',
  email = freshEmail(prefix),
): Promise<{
  email: string;
  accountId: string;
  cookie: string;
}> {
  const signedUp = await harness.identity.signUp(anonymousContext(), {
    email,
    password: PROOF_PASSWORD,
    name: 'Lifecycle Proof',
  });
  expect(signedUp.ok).toBe(true);

  await harness.dispatch();

  const link = harness.provider.lastLinkTo(email);
  expect(link).not.toBeNull();

  const parameters = linkParameters(link as string);
  const confirmed = await harness.identity.confirmVerification(anonymousContext(), {
    email: parameters.email,
    token: parameters.token,
  });
  expect(confirmed.ok).toBe(true);

  const signedIn = await harness.identity.signIn(anonymousContext(), {
    email,
    password: PROOF_PASSWORD,
  });
  expect(signedIn.ok).toBe(true);
  if (!signedIn.ok) throw new Error('unreachable');

  return {
    email,
    accountId: signedIn.account.id,
    cookie: cookieHeader(signedIn.setCookies),
  };
}

describe.skipIf(!databaseConfigured)('Phase 2 Chunk 1 — credential lifecycle', () => {
  beforeAll(async () => {
    database = await createProofDatabase();
    harness = await createIdentityHarness();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  }, 120_000);

  /* =======================================================================
   * Registration
   * ===================================================================== */

  describe('sign-up', () => {
    it('creates an account and enqueues exactly one verification message', async () => {
      const email = freshEmail('signup');

      const result = await harness.identity.signUp(anonymousContext(), {
        email,
        password: PROOF_PASSWORD,
        name: 'Signup Proof',
      });

      expect(result.ok).toBe(true);

      const before = harness.provider.sent.length;
      await harness.dispatch();

      const delivered = harness.provider.sent.slice(before);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.to).toBe(email);
    });

    it('answers IDENTICALLY for an address that already exists', async () => {
      const email = freshEmail('duplicate');

      const first = await harness.identity.signUp(anonymousContext('198.51.100.21'), {
        email,
        password: PROOF_PASSWORD,
        name: 'First',
      });
      const second = await harness.identity.signUp(anonymousContext('198.51.100.22'), {
        email,
        password: 'a-completely-different-passphrase',
        name: 'Second',
      });

      // Byte-for-byte the same result. An attacker with a list of addresses
      // learns nothing about which of them have accounts here
      // (SECURITY_BASELINE.md §15.2).
      expect(second).toEqual(first);

      const rows = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.[User] WHERE email = '${email}';`,
      );
      expect(rows[0]?.total).toBe(1);
    });

    it('resolves a CONCURRENT duplicate signup to exactly one account', async () => {
      const email = freshEmail('race');

      // Uniqueness is a SCHEMA property, not an application check — two
      // simultaneous signups cannot both pass a check-then-insert, and this is
      // the shape that proves the database is what stops them.
      await Promise.all(
        Array.from({ length: 6 }, async (_unused, index) =>
          harness.identity.signUp(anonymousContext(`198.51.100.${30 + index}`), {
            email,
            password: PROOF_PASSWORD,
            name: `Racer ${index}`,
          }),
        ),
      );

      const rows = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.[User] WHERE email = '${email}';`,
      );
      expect(rows[0]?.total).toBe(1);
    }, 60_000);

    it('treats canonically equivalent spellings as ONE address', async () => {
      const base = freshEmail('canonical');
      const shouted = `  ${base.toUpperCase()}  `;

      await harness.identity.signUp(anonymousContext('198.51.100.41'), {
        email: base,
        password: PROOF_PASSWORD,
        name: 'Canonical',
      });
      await harness.identity.signUp(anonymousContext('198.51.100.42'), {
        email: shouted,
        password: PROOF_PASSWORD,
        name: 'Shouted',
      });

      const rows = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.[User] WHERE email = '${base}';`,
      );
      expect(rows[0]?.total).toBe(1);
    });

    it('does NOT apply provider-specific rewriting', async () => {
      // Gmail-style dot-stripping and plus-tag removal are ONE provider's
      // behaviour. Applying either as a global rule merges distinct people's
      // accounts (DOMAIN_MODEL.md §4.6).
      const stamp = Date.now();
      const plain = `dots.and.tags-${stamp}@proof.invalid`;
      const dotted = `dotsandtags-${stamp}@proof.invalid`;
      const tagged = `dots.and.tags-${stamp}+library@proof.invalid`;

      for (const [index, email] of [plain, dotted, tagged].entries()) {
        await harness.identity.signUp(anonymousContext(`198.51.100.${50 + index}`), {
          email,
          password: PROOF_PASSWORD,
          name: 'Distinct',
        });
      }

      const rows = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.[User] WHERE email LIKE '%${stamp}%';`,
      );
      expect(rows[0]?.total).toBe(3);
    });
  });

  /* =======================================================================
   * Verification
   * ===================================================================== */

  describe('email verification', () => {
    it('sends a LINK, not a six-digit code', async () => {
      const email = freshEmail('link');
      await harness.identity.signUp(anonymousContext(), {
        email,
        password: PROOF_PASSWORD,
        name: 'Link Proof',
      });
      await harness.dispatch();

      const link = harness.provider.lastLinkTo(email);
      expect(link).not.toBeNull();

      const parameters = linkParameters(link as string);

      expect(parameters.pathname).toBe('/en/verify-email');
      expect(parameters.email).toBe(email);

      // 32 random bytes as base64url. A six-digit code in a URL would be
      // brute-forceable in the time an email sits in an inbox.
      expect(parameters.token).toHaveLength(43);
      expect(parameters.token).toMatch(/^[A-Za-z0-9_-]+$/);
    });

    it('renders a link WITHOUT consuming it', async () => {
      const email = freshEmail('inspect');
      await harness.identity.signUp(anonymousContext(), {
        email,
        password: PROOF_PASSWORD,
        name: 'Inspect Proof',
      });
      await harness.dispatch();

      const { token } = linkParameters(harness.provider.lastLinkTo(email) as string);

      // THE class-D property. A mail scanner, a link prefetcher or an
      // over-eager security appliance following the link must not burn it
      // (SECURITY_BASELINE.md §7.4).
      expect(await harness.identity.inspectVerification({ email, token })).toBe('valid');
      expect(await harness.identity.inspectVerification({ email, token })).toBe('valid');
      expect(await harness.identity.inspectVerification({ email, token })).toBe('valid');

      const confirmed = await harness.identity.confirmVerification(anonymousContext(), {
        email,
        token,
      });
      expect(confirmed.ok).toBe(true);
    });

    it('is single use', async () => {
      const email = freshEmail('single-use');
      await harness.identity.signUp(anonymousContext(), {
        email,
        password: PROOF_PASSWORD,
        name: 'Single Use',
      });
      await harness.dispatch();

      const { token } = linkParameters(harness.provider.lastLinkTo(email) as string);

      expect(
        (await harness.identity.confirmVerification(anonymousContext(), { email, token }))
          .ok,
      ).toBe(true);

      const replay = await harness.identity.confirmVerification(anonymousContext(), {
        email,
        token,
      });
      expect(replay.ok).toBe(false);
    });

    it('accepts exactly ONE of several concurrent confirmations', async () => {
      const email = freshEmail('concurrent');
      await harness.identity.signUp(anonymousContext(), {
        email,
        password: PROOF_PASSWORD,
        name: 'Concurrent',
      });
      await harness.dispatch();

      const { token } = linkParameters(harness.provider.lastLinkTo(email) as string);

      const outcomes = await Promise.all(
        Array.from({ length: 5 }, async () =>
          harness.identity.confirmVerification(anonymousContext(), { email, token }),
        ),
      );

      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    }, 60_000);

    it('refuses a token that was never issued, without saying so', async () => {
      const email = freshEmail('unknown-token');
      await harness.identity.signUp(anonymousContext(), {
        email,
        password: PROOF_PASSWORD,
        name: 'Unknown Token',
      });
      await harness.dispatch();

      const forged = 'x'.repeat(43);
      expect(await harness.identity.inspectVerification({ email, token: forged })).toBe(
        'invalid',
      );
    });

    /** Signs up and ages the resulting token past its expiry, in the database. */
    async function expiredLinkFor(prefix: string) {
      const email = freshEmail(prefix);
      await harness.identity.signUp(anonymousContext(), {
        email,
        password: PROOF_PASSWORD,
        name: 'Expired',
      });
      await harness.dispatch();

      const { token } = linkParameters(harness.provider.lastLinkTo(email) as string);

      // Aged in the DATABASE rather than by waiting an hour. The property under
      // test is "an expired token is refused", not "time passes".
      await database.admin.query(
        `UPDATE dbo.Verification
         SET expiresAt = DATEADD(hour, -2, SYSUTCDATETIME())
         WHERE identifier LIKE '%${email}%';`,
      );

      return { email, token };
    }

    it('renders an EXPIRED link as expired rather than as wrong', async () => {
      const { email, token } = await expiredLinkFor('expired-render');

      expect(await harness.identity.inspectVerification({ email, token })).toBe(
        'expired',
      );
    });

    it('refuses to CONFIRM an expired link, and says which it was', async () => {
      // A separate account from the render proof above, deliberately. Reading
      // an expired record also CLEANS IT UP — the library deletes it on the way
      // to reporting the expiry — so a confirm that followed an inspect would
      // find nothing and report `invalid-token`, which is true but is not the
      // property being tested here.
      const { email, token } = await expiredLinkFor('expired-confirm');

      const confirmed = await harness.identity.confirmVerification(anonymousContext(), {
        email,
        token,
      });

      expect(confirmed.ok).toBe(false);
      if (!confirmed.ok) expect(confirmed.failure).toBe('expired-token');
    });

    it('reports an expired link as invalid once it has been swept away', async () => {
      const { email, token } = await expiredLinkFor('expired-swept');

      expect(await harness.identity.inspectVerification({ email, token })).toBe(
        'expired',
      );

      // Second look: the record is gone, so there is nothing left to call
      // expired. The response stays uniform and reveals nothing either way.
      expect(await harness.identity.inspectVerification({ email, token })).toBe(
        'invalid',
      );
    });

    it('rotates on an explicit resend and kills the previous link', async () => {
      const email = freshEmail('resend');
      await harness.identity.signUp(anonymousContext(), {
        email,
        password: PROOF_PASSWORD,
        name: 'Resend',
      });
      await harness.dispatch();

      const first = linkParameters(harness.provider.lastLinkTo(email) as string).token;

      const resent = await harness.identity.resendVerification(anonymousContext(), {
        email,
      });
      expect(resent.ok).toBe(true);
      await harness.dispatch();

      const second = linkParameters(harness.provider.lastLinkTo(email) as string).token;

      expect(second).not.toBe(first);

      // A USER RESEND mints; the superseded link stops working. This is the
      // distinction from a delivery RETRY, which reuses the same token.
      expect(await harness.identity.inspectVerification({ email, token: first })).toBe(
        'invalid',
      );
      expect(await harness.identity.inspectVerification({ email, token: second })).toBe(
        'valid',
      );
    });

    it('answers a resend for an unknown address identically', async () => {
      const known = await newVerifiedAccount('resend-known');

      const unknown = await harness.identity.resendVerification(
        anonymousContext('198.51.100.61'),
        { email: freshEmail('never-registered') },
      );
      const verified = await harness.identity.resendVerification(
        anonymousContext('198.51.100.62'),
        { email: known.email },
      );

      expect(unknown).toEqual(verified);
    });
  });

  /* =======================================================================
   * Sign-in
   * ===================================================================== */

  describe('sign-in', () => {
    it('signs in a verified account and issues a session cookie', async () => {
      const account = await newVerifiedAccount('signin');

      expect(account.cookie).not.toBe('');

      const resolved = await harness.session.resolve(
        sessionContext(account.cookie).headers,
      );
      expect(resolved.state).toBe('active');
    });

    it('fails IDENTICALLY for a wrong password and an unknown address', async () => {
      const account = await newVerifiedAccount('signin-parity');

      const wrongPassword = await harness.identity.signIn(
        anonymousContext('198.51.100.71'),
        {
          email: account.email,
          password: 'not-the-right-passphrase-at-all',
        },
      );
      const unknownAddress = await harness.identity.signIn(
        anonymousContext('198.51.100.72'),
        {
          email: freshEmail('nobody'),
          password: 'not-the-right-passphrase-at-all',
        },
      );

      // The response never distinguishes "no such user" from "wrong password"
      // (SECURITY_BASELINE.md §2.2).
      expect(wrongPassword).toEqual(unknownAddress);
      expect(wrongPassword.ok).toBe(false);
    });

    it('refuses an UNVERIFIED account', async () => {
      const email = freshEmail('unverified');
      await harness.identity.signUp(anonymousContext(), {
        email,
        password: PROOF_PASSWORD,
        name: 'Unverified',
      });

      const attempt = await harness.identity.signIn(anonymousContext(), {
        email,
        password: PROOF_PASSWORD,
      });

      expect(attempt.ok).toBe(false);
    });
  });

  /* =======================================================================
   * Sessions
   * ===================================================================== */

  describe('sessions', () => {
    it('lists sessions and marks the current one', async () => {
      const account = await newVerifiedAccount('sessions');

      const second = await harness.identity.signIn(anonymousContext('198.51.100.81'), {
        email: account.email,
        password: PROOF_PASSWORD,
      });
      expect(second.ok).toBe(true);

      const listed = await harness.identity.listSessions(sessionContext(account.cookie));

      expect(listed.length).toBe(2);
      expect(listed.filter((entry) => entry.current)).toHaveLength(1);
    });

    it('revokes ONE named session and leaves the caller signed in', async () => {
      const account = await newVerifiedAccount('revoke-one');

      const other = await harness.identity.signIn(anonymousContext('198.51.100.82'), {
        email: account.email,
        password: PROOF_PASSWORD,
      });
      if (!other.ok) throw new Error('unreachable');
      const otherCookie = cookieHeader(other.setCookies);

      const context = sessionContext(account.cookie);
      const listed = await harness.identity.listSessions(context);
      const target = listed.find((entry) => !entry.current);
      expect(target).toBeDefined();

      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      const revoked = await harness.identity.revokeSession(context, session.session, {
        sessionId: target?.id as string,
      });
      expect(revoked.ok).toBe(true);

      // The revoked one is gone; the caller's own is untouched.
      expect(
        (await harness.session.resolve(sessionContext(otherCookie).headers)).state,
      ).toBe('denied');
      expect((await harness.session.resolve(context.headers)).state).toBe('active');
    });

    it('refuses to revoke a session id belonging to somebody else', async () => {
      const mine = await newVerifiedAccount('revoke-mine');
      const theirs = await newVerifiedAccount('revoke-theirs');

      const theirContext = sessionContext(theirs.cookie);
      const theirSessions = await harness.identity.listSessions(theirContext);
      const theirId = theirSessions[0]?.id;
      expect(theirId).toBeDefined();

      const myContext = sessionContext(mine.cookie);
      const mySession = await harness.session.resolve(myContext.headers);
      if (mySession.state !== 'active') throw new Error('unreachable');

      const attempt = await harness.identity.revokeSession(myContext, mySession.session, {
        sessionId: theirId as string,
      });

      // The ownership check IS the lookup: the id is searched for in the
      // CALLER's own session list, so somebody else's simply is not there.
      expect(attempt.ok).toBe(false);
      expect((await harness.session.resolve(theirContext.headers)).state).toBe('active');
    });

    it('revokes every OTHER session and keeps the caller signed in', async () => {
      const account = await newVerifiedAccount('revoke-others');

      const extras = await Promise.all([
        harness.identity.signIn(anonymousContext('198.51.100.91'), {
          email: account.email,
          password: PROOF_PASSWORD,
        }),
        harness.identity.signIn(anonymousContext('198.51.100.92'), {
          email: account.email,
          password: PROOF_PASSWORD,
        }),
      ]);

      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      const result = await harness.identity.revokeOtherSessions(context, session.session);
      expect(result.ok).toBe(true);

      for (const extra of extras) {
        if (!extra.ok) throw new Error('unreachable');
        const cookie = sessionContext(cookieHeader(extra.setCookies));
        expect((await harness.session.resolve(cookie.headers)).state).toBe('denied');
      }

      expect((await harness.session.resolve(context.headers)).state).toBe('active');
    });

    it('signs out, and the cookie stops working', async () => {
      const account = await newVerifiedAccount('signout');
      const context = sessionContext(account.cookie);

      const result = await harness.identity.signOut(context);
      expect(result.ok).toBe(true);

      expect((await harness.session.resolve(context.headers)).state).toBe('denied');
    });
  });

  /* =======================================================================
   * Account status — enforced on EVERY authenticated request
   * ===================================================================== */

  describe('account status', () => {
    for (const status of ['disabled', 'suspended'] as const) {
      it(`denies a LIVE session the moment the account becomes ${status}`, async () => {
        const account = await newVerifiedAccount(`status-${status}`);
        const context = sessionContext(account.cookie);

        expect((await harness.session.resolve(context.headers)).state).toBe('active');

        const changed = await harness.identity.setAccountStatus({
          accountId: account.accountId,
          status,
          actorId: null,
          actorType: 'system',
        });
        expect(changed.ok).toBe(true);

        // THE property. Not "cannot sign in again" — the session that already
        // exists stops working on its very next request. Checking only at
        // sign-in would leave a suspended account usable for days
        // (DOMAIN_MODEL.md §4.6).
        expect((await harness.session.resolve(context.headers)).state).toBe('denied');
      });

      it(`denies a session the CHOKEPOINT alone finds ${status}`, async () => {
        const account = await newVerifiedAccount(`chokepoint-${status}`);
        const context = sessionContext(account.cookie);

        // The status is changed BENEATH the service, leaving the session row
        // alive. That is the case the chokepoint exists for: the service path
        // also revokes, so a proof that went through it would pass even if the
        // chokepoint checked nothing at all — it would simply find no session.
        //
        // Here there IS a session, it is valid, and it belongs to an account
        // that may no longer act. Only the per-request status check can refuse
        // it, and only that check can name the reason.
        await database.admin.query(
          `UPDATE dbo.[User] SET status = '${status}' WHERE id = '${account.accountId}';`,
        );

        const outcome = await harness.session.resolve(context.headers);

        expect(outcome.state).toBe('denied');
        if (outcome.state === 'denied') {
          expect(outcome.reason).toBe(`account-${status}`);
        }

        // And it DESTROYS the session rather than merely refusing it: a live
        // row left behind is a credential that starts working again the moment
        // somebody restores the status by accident.
        const rows = await database.admin.query<{ total: number }>(
          `SELECT COUNT(*) AS total FROM dbo.[Session] WHERE userId = '${account.accountId}';`,
        );
        expect(rows[0]?.total).toBe(0);
      });
    }

    it('denies a session belonging to a CLOSED account, naming the reason', async () => {
      const account = await newVerifiedAccount('chokepoint-closed');
      const context = sessionContext(account.cookie);

      await database.admin.query(
        `UPDATE dbo.[User] SET status = 'closed' WHERE id = '${account.accountId}';`,
      );

      const outcome = await harness.session.resolve(context.headers);

      expect(outcome.state).toBe('denied');
      if (outcome.state === 'denied') expect(outcome.reason).toBe('account-closed');
    });

    it('reads an UNRECOGNISED status as unusable rather than as active', async () => {
      const account = await newVerifiedAccount('chokepoint-unknown');
      const context = sessionContext(account.cookie);

      // Fail closed. A status column this code cannot interpret — a value from
      // a future migration, a bad manual edit — must never be read as
      // permission to act.
      await database.admin.query(
        `UPDATE dbo.[User] SET status = 'something-nobody-defined'
         WHERE id = '${account.accountId}';`,
      );

      expect((await harness.session.resolve(context.headers)).state).toBe('denied');
    });

    it('destroys the session rows rather than merely refusing them', async () => {
      const account = await newVerifiedAccount('status-destroy');

      await harness.identity.setAccountStatus({
        accountId: account.accountId,
        status: 'disabled',
        actorId: null,
        actorType: 'system',
      });

      const rows = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.[Session] WHERE userId = '${account.accountId}';`,
      );

      // A refused-but-surviving session is a credential that starts working
      // again the moment somebody restores the status by accident.
      expect(rows[0]?.total).toBe(0);
    });

    it('refuses sign-in for a non-active account, without saying why', async () => {
      const account = await newVerifiedAccount('status-signin');

      await harness.identity.setAccountStatus({
        accountId: account.accountId,
        status: 'suspended',
        actorId: null,
        actorType: 'system',
      });

      const attempt = await harness.identity.signIn(anonymousContext('198.51.100.101'), {
        email: account.email,
        password: PROOF_PASSWORD,
      });

      expect(attempt.ok).toBe(false);
      if (!attempt.ok) expect(attempt.failure).toBe('invalid-credentials');
    });

    it('treats closure as terminal — no transition leaves it', async () => {
      const account = await newVerifiedAccount('status-terminal');

      await harness.identity.setAccountStatus({
        accountId: account.accountId,
        status: 'closed',
        actorId: null,
        actorType: 'system',
      });

      const reactivated = await harness.identity.setAccountStatus({
        accountId: account.accountId,
        status: 'active',
        actorId: null,
        actorType: 'system',
      });

      expect(reactivated.ok).toBe(false);
      if (!reactivated.ok) expect(reactivated.failure).toBe('invalid-transition');
    });
  });

  /* =======================================================================
   * Passwords
   * ===================================================================== */

  describe('password reset', () => {
    it('answers a forgotten-password request identically for a stranger', async () => {
      const account = await newVerifiedAccount('forgot-known');

      const known = await harness.identity.requestPasswordReset(
        anonymousContext('198.51.100.111'),
        { email: account.email },
      );
      const stranger = await harness.identity.requestPasswordReset(
        anonymousContext('198.51.100.112'),
        { email: freshEmail('stranger') },
      );

      // The most probed endpoint on any platform. A response that differed for
      // a known address would answer the question being asked.
      expect(stranger).toEqual(known);
    });

    it('resets the password, and the OLD one stops working', async () => {
      const account = await newVerifiedAccount('reset');

      await harness.identity.requestPasswordReset(anonymousContext(), {
        email: account.email,
      });
      await harness.dispatch();

      const link = harness.provider.lastLinkTo(account.email);
      expect(link).not.toBeNull();

      const parameters = linkParameters(link as string);
      expect(parameters.pathname).toBe('/en/reset-password');

      const reset = await harness.identity.resetPassword(anonymousContext(), {
        email: account.email,
        token: parameters.token,
        newPassword: PROOF_NEW_PASSWORD,
      });
      expect(reset.ok).toBe(true);

      const oldPassword = await harness.identity.signIn(
        anonymousContext('198.51.100.121'),
        {
          email: account.email,
          password: PROOF_PASSWORD,
        },
      );
      expect(oldPassword.ok).toBe(false);

      const newPassword = await harness.identity.signIn(
        anonymousContext('198.51.100.122'),
        {
          email: account.email,
          password: PROOF_NEW_PASSWORD,
        },
      );
      expect(newPassword.ok).toBe(true);
    });

    it('REVOKES every live session on a completed reset', async () => {
      const account = await newVerifiedAccount('reset-revokes');
      const context = sessionContext(account.cookie);

      expect((await harness.session.resolve(context.headers)).state).toBe('active');

      await harness.identity.requestPasswordReset(anonymousContext(), {
        email: account.email,
      });
      await harness.dispatch();

      const { token } = linkParameters(
        harness.provider.lastLinkTo(account.email) as string,
      );

      await harness.identity.resetPassword(anonymousContext(), {
        email: account.email,
        token,
        newPassword: PROOF_NEW_PASSWORD,
      });

      // The credential that authorised every live session has changed
      // (SECURITY_BASELINE.md §2.3).
      expect((await harness.session.resolve(context.headers)).state).toBe('denied');
    });

    it('does not consume a reset link on inspection, and refuses a replay', async () => {
      const account = await newVerifiedAccount('reset-replay');

      await harness.identity.requestPasswordReset(anonymousContext(), {
        email: account.email,
      });
      await harness.dispatch();

      const { token } = linkParameters(
        harness.provider.lastLinkTo(account.email) as string,
      );

      expect(
        await harness.identity.inspectPasswordReset({ email: account.email, token }),
      ).toBe('valid');
      expect(
        await harness.identity.inspectPasswordReset({ email: account.email, token }),
      ).toBe('valid');

      const first = await harness.identity.resetPassword(anonymousContext(), {
        email: account.email,
        token,
        newPassword: PROOF_NEW_PASSWORD,
      });
      expect(first.ok).toBe(true);

      const replay = await harness.identity.resetPassword(anonymousContext(), {
        email: account.email,
        token,
        newPassword: 'yet-another-passphrase-9911',
      });
      expect(replay.ok).toBe(false);
    });
  });

  describe('password change', () => {
    it('changes the password and revokes the OTHER sessions', async () => {
      const account = await newVerifiedAccount('change-password');

      const other = await harness.identity.signIn(anonymousContext('198.51.100.131'), {
        email: account.email,
        password: PROOF_PASSWORD,
      });
      if (!other.ok) throw new Error('unreachable');
      const otherContext = sessionContext(cookieHeader(other.setCookies));

      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      const changed = await harness.identity.changePassword(context, session.session, {
        currentPassword: PROOF_PASSWORD,
        newPassword: PROOF_NEW_PASSWORD,
      });
      expect(changed.ok).toBe(true);
      if (!changed.ok) throw new Error('unreachable');

      expect((await harness.session.resolve(otherContext.headers)).state).toBe('denied');

      // THE SESSION IS ROTATED, not merely retained. The library replaces every
      // session for the account — this one included — and issues a fresh
      // token, so the OLD cookie is dead and the NEW one must be applied. An
      // implementation that dropped the replacement would sign the person out
      // one request after telling them the change succeeded.
      expect(changed.setCookies.length).toBeGreaterThan(0);
      expect((await harness.session.resolve(context.headers)).state).toBe('denied');

      const rotated = sessionContext(cookieHeader(changed.setCookies));
      expect((await harness.session.resolve(rotated.headers)).state).toBe('active');
    });

    it('refuses a wrong current password', async () => {
      const account = await newVerifiedAccount('change-wrong');
      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      const attempt = await harness.identity.changePassword(context, session.session, {
        currentPassword: 'definitely-not-the-current-one',
        newPassword: PROOF_NEW_PASSWORD,
      });

      expect(attempt.ok).toBe(false);

      const stillWorks = await harness.identity.signIn(
        anonymousContext('198.51.100.141'),
        {
          email: account.email,
          password: PROOF_PASSWORD,
        },
      );
      expect(stillWorks.ok).toBe(true);
    });

    it('owes a notification the person can see', async () => {
      const account = await newVerifiedAccount('change-notifies');
      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      await harness.identity.changePassword(context, session.session, {
        currentPassword: PROOF_PASSWORD,
        newPassword: PROOF_NEW_PASSWORD,
      });

      const before = harness.provider.sent.length;
      await harness.dispatch();

      const delivered = harness.provider.sent.slice(before);
      expect(delivered.some((message) => message.to === account.email)).toBe(true);

      // A security notice carries NO bearer material — there is nothing for a
      // recipient to act on beyond knowing it happened.
      for (const message of delivered) {
        expect(message.text).not.toMatch(/token=/);
      }
    });
  });

  /* =======================================================================
   * Email change
   * ===================================================================== */

  describe('verified email change', () => {
    it('requires the current password, not merely a session', async () => {
      const account = await newVerifiedAccount('change-email-stepup');
      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      const attempt = await harness.identity.requestEmailChange(
        context,
        session.session,
        {
          newEmail: freshEmail('destination'),
          currentPassword: 'not-the-password',
        },
      );

      // The address is the root of every recovery path. Someone who finds an
      // unlocked browser must not be able to take it (SECURITY_BASELINE.md
      // §8.1).
      expect(attempt.ok).toBe(false);
      if (!attempt.ok) expect(attempt.failure).toBe('invalid-credentials');
    });

    it('moves the address once the NEW one proves itself', async () => {
      const account = await newVerifiedAccount('change-email');
      const destination = freshEmail('destination');

      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      const requested = await harness.identity.requestEmailChange(
        context,
        session.session,
        { newEmail: destination, currentPassword: PROOF_PASSWORD },
      );
      expect(requested.ok).toBe(true);

      await harness.dispatch();

      const link = harness.provider.lastLinkTo(destination);
      expect(link).not.toBeNull();

      const parameters = linkParameters(link as string);
      expect(parameters.pathname).toBe('/en/confirm-email-change');
      expect(parameters.email).toBe(destination);

      const confirmed = await harness.identity.confirmEmailChange(
        context,
        session.session,
        { newEmail: destination, token: parameters.token },
      );
      expect(confirmed.ok).toBe(true);

      const rows = await database.admin.query<{ email: string; emailVerified: boolean }>(
        `SELECT email, emailVerified FROM dbo.[User] WHERE id = '${account.accountId}';`,
      );
      expect(rows[0]?.email).toBe(destination);

      // The verified state follows the ADDRESS rather than persisting from the
      // previous one (DOMAIN_MODEL.md §4.6).
      expect(rows[0]?.emailVerified).toBe(true);

      const signedIn = await harness.identity.signIn(anonymousContext('198.51.100.151'), {
        email: destination,
        password: PROOF_PASSWORD,
      });
      expect(signedIn.ok).toBe(true);
    });

    it('does not consume the change link on inspection', async () => {
      const account = await newVerifiedAccount('change-email-inspect');
      const destination = freshEmail('destination');

      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      await harness.identity.requestEmailChange(context, session.session, {
        newEmail: destination,
        currentPassword: PROOF_PASSWORD,
      });
      await harness.dispatch();

      const { token } = linkParameters(
        harness.provider.lastLinkTo(destination) as string,
      );

      for (let i = 0; i < 3; i += 1) {
        expect(
          await harness.identity.inspectEmailChange(
            session.session,
            { newEmail: destination },
            token,
          ),
        ).toBe('valid');
      }

      const confirmed = await harness.identity.confirmEmailChange(
        context,
        session.session,
        { newEmail: destination, token },
      );
      expect(confirmed.ok).toBe(true);
    });

    it('refuses a COLLIDING address without revealing the collision', async () => {
      const account = await newVerifiedAccount('change-collide');
      const occupied = await newVerifiedAccount('change-occupant');

      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      const colliding = await harness.identity.requestEmailChange(
        context,
        session.session,
        { newEmail: occupied.email, currentPassword: PROOF_PASSWORD },
      );
      const free = await harness.identity.requestEmailChange(context, session.session, {
        newEmail: freshEmail('free'),
        currentPassword: PROOF_PASSWORD,
      });

      // Uniform with success. Reporting "that address is taken" here would turn
      // an authenticated form into an enumeration oracle.
      expect(colliding).toEqual(free);

      const rows = await database.admin.query<{ email: string }>(
        `SELECT email FROM dbo.[User] WHERE id = '${account.accountId}';`,
      );
      expect(rows[0]?.email).toBe(account.email);
    });

    it('revokes the OTHER sessions once the address moves', async () => {
      const account = await newVerifiedAccount('change-email-revokes');
      const destination = freshEmail('destination');

      const other = await harness.identity.signIn(anonymousContext('198.51.100.161'), {
        email: account.email,
        password: PROOF_PASSWORD,
      });
      if (!other.ok) throw new Error('unreachable');
      const otherContext = sessionContext(cookieHeader(other.setCookies));

      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      await harness.identity.requestEmailChange(context, session.session, {
        newEmail: destination,
        currentPassword: PROOF_PASSWORD,
      });
      await harness.dispatch();

      const { token } = linkParameters(
        harness.provider.lastLinkTo(destination) as string,
      );

      await harness.identity.confirmEmailChange(context, session.session, {
        newEmail: destination,
        token,
      });

      expect((await harness.session.resolve(otherContext.headers)).state).toBe('denied');
    });
  });

  /* =======================================================================
   * Profile, locale and setup
   * ===================================================================== */

  describe('account state', () => {
    it('records a display name, an interface locale and a timezone', async () => {
      const account = await newVerifiedAccount('profile');
      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      const named = await harness.identity.updateProfile(session.session, {
        name: 'Renamed Account',
      });
      expect(named.ok).toBe(true);

      const localised = await harness.identity.updateLanguage(session.session, {
        locale: 'ur',
        timezone: 'Asia/Karachi',
      });
      expect(localised.ok).toBe(true);
      if (!localised.ok) throw new Error('unreachable');

      expect(localised.account.locale).toBe('ur');
      expect(localised.account.timezone).toBe('Asia/Karachi');
    });

    it('completes account setup, which is NOT personalisation onboarding', async () => {
      const account = await newVerifiedAccount('setup');
      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      expect(harness.identity.setupComplete(session.session.account)).toBe(false);

      const completed = await harness.identity.completeAccountSetup(session.session, {
        locale: 'ar',
        timezone: 'Asia/Riyadh',
      });
      expect(completed.ok).toBe(true);
      if (!completed.ok) throw new Error('unreachable');

      expect(harness.identity.setupComplete(completed.account)).toBe(true);
      expect(completed.account.accountSetupCompletedAt).not.toBeNull();
    });

    it('reports the final authentication method as unremovable', async () => {
      const account = await newVerifiedAccount('methods');
      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      const methods = await harness.identity.describeAuthenticationMethods(
        session.session,
      );

      // Phase 2 has exactly one. The rule COUNTS rather than naming providers,
      // so Phase 2G's Google adds a second without changing it.
      expect(methods.count).toBe(1);
      expect(methods.canRemoveOne).toBe(false);
    });
  });

  /* =======================================================================
   * Closure and clean re-registration
   * ===================================================================== */

  describe('closure', () => {
    it('retains the row, pseudonymises it, and releases the address', async () => {
      const account = await newVerifiedAccount('closure');
      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      const closed = await harness.identity.closeAccount(context, session.session);
      expect(closed.ok).toBe(true);

      const rows = await database.admin.query<{
        id: string;
        email: string;
        name: string;
        status: string;
        closedAt: Date | null;
        pseudonymisedAt: Date | null;
      }>(`SELECT id, email, name, status, closedAt, pseudonymisedAt
          FROM dbo.[User] WHERE id = '${account.accountId}';`);

      const row = rows[0];
      expect(row).toBeDefined();

      // RETAINED, for historical attribution.
      expect(row?.id).toBe(account.accountId);
      expect(row?.status).toBe('closed');
      expect(row?.closedAt).not.toBeNull();
      expect(row?.pseudonymisedAt).not.toBeNull();

      // The original address is GONE from the row, replaced by a tombstone in
      // the reserved `.invalid` domain that can never route.
      expect(row?.email).not.toBe(account.email);
      expect(row?.email).not.toContain('closure');
      expect(row?.email).toMatch(/^closed-.+@closed\.invalid$/);
      expect(row?.name).not.toBe('Lifecycle Proof');
    });

    it('disposes credentials, sessions and outstanding tokens', async () => {
      const account = await newVerifiedAccount('closure-disposal');

      // An outstanding reset, so closure has something to invalidate.
      await harness.identity.requestPasswordReset(anonymousContext(), {
        email: account.email,
      });
      await harness.dispatch();
      const outstanding = linkParameters(
        harness.provider.lastLinkTo(account.email) as string,
      ).token;

      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      await harness.identity.closeAccount(context, session.session);

      for (const [table, column] of [
        ['Account', 'userId'],
        ['Session', 'userId'],
      ] as const) {
        const rows = await database.admin.query<{ total: number }>(
          `SELECT COUNT(*) AS total FROM dbo.[${table}] WHERE ${column} = '${account.accountId}';`,
        );
        expect(rows[0]?.total, `${table} must be empty after closure`).toBe(0);
      }

      // A token minted before closure must not verify or reset an address that
      // is about to become available to somebody else.
      expect(
        await harness.identity.inspectPasswordReset({
          email: account.email,
          token: outstanding,
        }),
      ).toBe('invalid');
    });

    it('preserves another account token when its email contains the closed email', async () => {
      const targetEmail = freshEmail('closure-token-owner');
      const account = await newVerifiedAccount('closure-token-owner', targetEmail);
      const otherEmail = `alice${targetEmail}`;

      await harness.identity.signUp(anonymousContext(), {
        email: otherEmail,
        password: PROOF_PASSWORD,
        name: 'Token Isolation Proof',
      });
      await harness.dispatch();
      const link = harness.provider.lastLinkTo(otherEmail);
      expect(link).not.toBeNull();
      const token = linkParameters(link as string).token;

      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');
      await harness.identity.closeAccount(context, session.session);

      expect(
        await harness.identity.inspectVerification({ email: otherEmail, token }),
      ).toBe('valid');
    });

    it('lets the SAME address register again, as a genuinely new account', async () => {
      const account = await newVerifiedAccount('reregistration');
      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      await harness.identity.closeAccount(context, session.session);

      const again = await harness.identity.signUp(anonymousContext('198.51.100.171'), {
        email: account.email,
        password: 'a-brand-new-passphrase-5521',
        name: 'Second Life',
      });
      expect(again.ok).toBe(true);

      const rows = await database.admin.query<{ id: string; name: string }>(
        `SELECT id, name FROM dbo.[User] WHERE email = '${account.email}';`,
      );

      expect(rows).toHaveLength(1);

      // A NEW `User.id`. Nothing is reconnected by address — not the old
      // sessions, not the old credential, not the old profile.
      expect(rows[0]?.id).not.toBe(account.accountId);
      expect(rows[0]?.name).toBe('Second Life');

      const inherited = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.[Session] WHERE userId = '${rows[0]?.id}';`,
      );
      expect(inherited[0]?.total).toBe(0);
    });

    it('leaves the closed account unable to sign in with the old password', async () => {
      const account = await newVerifiedAccount('closure-signin');
      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      await harness.identity.closeAccount(context, session.session);

      const attempt = await harness.identity.signIn(anonymousContext('198.51.100.181'), {
        email: account.email,
        password: PROOF_PASSWORD,
      });
      expect(attempt.ok).toBe(false);
    });
  });

  /* =======================================================================
   * Rate limiting, through the real flows
   * ===================================================================== */

  describe('rate limiting', () => {
    it('bounds forgotten-password requests for one address', async () => {
      const account = await newVerifiedAccount('limit-forgot');
      const client = '198.51.100.191';

      const outcomes = [];
      for (let attempt = 0; attempt < 6; attempt += 1) {
        outcomes.push(
          await harness.identity.requestPasswordReset(anonymousContext(client), {
            email: account.email,
          }),
        );
      }

      // Mail-bombing somebody else's inbox is the abuse here, which is why the
      // budget is per-ACCOUNT and tight (SECURITY_BASELINE.md §1.2).
      const refused = outcomes.filter((outcome) => !outcome.ok);
      expect(refused.length).toBeGreaterThan(0);
      expect(refused.every((outcome) => outcome.failure === 'rate-limited')).toBe(true);
    }, 60_000);

    it('bounds sign-in attempts against one account', async () => {
      const account = await newVerifiedAccount('limit-signin');

      const outcomes = [];
      for (let attempt = 0; attempt < 8; attempt += 1) {
        outcomes.push(
          await harness.identity.signIn(anonymousContext('198.51.100.201'), {
            email: account.email,
            password: `wrong-guess-${attempt}`,
          }),
        );
      }

      const limited = outcomes.filter(
        (outcome) => !outcome.ok && outcome.failure === 'rate-limited',
      );
      expect(limited.length).toBeGreaterThan(0);
    }, 60_000);

    it('reports a retry delay a caller can act on', async () => {
      const account = await newVerifiedAccount('limit-retry-after');

      let refused: { retryAfter?: number } | null = null;
      for (let attempt = 0; attempt < 8 && refused === null; attempt += 1) {
        const outcome = await harness.identity.requestPasswordReset(
          anonymousContext('198.51.100.211'),
          { email: account.email },
        );
        if (!outcome.ok && outcome.failure === 'rate-limited') refused = outcome;
      }

      expect(refused).not.toBeNull();
      expect(refused?.retryAfter).toBeGreaterThan(0);
    }, 60_000);
  });

  /* =======================================================================
   * Audit
   * ===================================================================== */

  describe('audit', () => {
    it('records the security events, with no credential in the payload', async () => {
      const account = await newVerifiedAccount('audit');

      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      await harness.identity.changePassword(context, session.session, {
        currentPassword: PROOF_PASSWORD,
        newPassword: PROOF_NEW_PASSWORD,
      });

      // READ FROM THE TABLE, not from what the service was observed calling.
      //
      // Some of these rows are written by the Layer-0 audit writer and some by
      // Identity's own follow-up transaction, which commits the audit record
      // alongside the change it describes. WHICH writer produced a row is an
      // implementation detail; that the row is durably there is the property
      // an investigation depends on, and only the table can attest to it.
      const rows = await database.admin.query<{
        action: string;
        beforeState: string | null;
        afterState: string | null;
      }>(
        `SELECT action, beforeState, afterState FROM dbo.AuditLog
         WHERE targetId = '${account.accountId}';`,
      );

      const actions = rows.map((row) => row.action);

      expect(actions).toContain('identity.account.created');
      expect(actions).toContain('identity.email.verified');
      expect(actions).toContain('identity.signin.succeeded');
      expect(actions).toContain('identity.password.changed');

      // NEVER a credential, a token or a whole record. The payload says which
      // fields changed and enough to hold the actor accountable, and no more
      // (SECURITY_BASELINE.md §13.4).
      const serialised = JSON.stringify(rows);
      expect(serialised).not.toContain(PROOF_PASSWORD);
      expect(serialised).not.toContain(PROOF_NEW_PASSWORD);
      expect(serialised).not.toMatch(/passwordHash|"password"/);
    });

    it('writes rows the runtime principal can never alter', async () => {
      // The DENY is proved by `npm run db:test:permissions` against the real
      // principal. What is proved HERE is that the rows exist to be protected:
      // an immutability guarantee over an empty table is not a guarantee.
      const rows = await database.admin.query<{ total: number }>(
        "SELECT COUNT(*) AS total FROM dbo.AuditLog WHERE action LIKE 'identity.%';",
      );

      expect(rows[0]?.total).toBeGreaterThan(0);
    });

    it('carries NO foreign key to the accounts it describes', async () => {
      // AuditLog stays structurally FK-FREE. A foreign key would either block a
      // lawful purge or destroy the evidence the record exists to preserve
      // (SECURITY_BASELINE.md §13.3, DOMAIN_MODEL.md §6.2.1).
      const rows = await database.admin.query<{ name: string }>(
        `SELECT fk.name AS name
         FROM sys.foreign_keys AS fk
         WHERE fk.parent_object_id = OBJECT_ID('dbo.AuditLog');`,
      );

      expect(rows).toEqual([]);
    });
  });
});
