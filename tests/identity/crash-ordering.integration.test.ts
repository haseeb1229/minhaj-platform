import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { AuthMechanicsPort } from '../../packages/contracts/src/identity/index.ts';

import {
  createProofDatabase,
  databaseConfigured,
  freshEmail,
  linkParameters,
  PROOF_PASSWORD,
  PROOF_NEW_PASSWORD,
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
 * WHAT SURVIVES A CRASH — the orderings the platform's correctness rests on.
 *
 * Every guarantee here is about a moment BETWEEN two commits. A process that
 * dies in one of those moments leaves the database in a state no code path
 * ever deliberately produces, and the question is whether that state is one
 * the platform can recover from or one that has quietly lost something.
 *
 * Three orderings are proved, and each was wrong in a different direction:
 *
 *   1. A TOKEN must never exist without a durable record that a message is
 *      owed for it. The fix is the order — the delivery commits first — and
 *      what makes that safe is that the reverse residue is harmless.
 *
 *   2. A SECURITY CHANGE's audit record and its notification must not be able
 *      to separate. They are now one transaction.
 *
 *   3. A CLOSURE notice must not be sendable unless the closure happened. It
 *      used to be enqueued first, so a closure that failed still told the
 *      person their account was gone.
 *
 * THE FAULTS ARE INJECTED DETERMINISTICALLY. Nothing here waits on timing or
 * hopes to interleave: a step is made to fail, and what is left behind is read
 * out of the real tables.
 */

let database: DisposableDatabase;
let harness: IdentityHarness;

/** The notification key Identity derives. Mirrors `notificationKey`. */
function closureKey(accountId: string): string {
  return `identity.account-closed:${accountId}:closure`;
}

async function signedUp(prefix: string): Promise<string> {
  const email = freshEmail(prefix);
  await harness.identity.signUp(anonymousContext(), {
    email,
    password: PROOF_PASSWORD,
    name: 'Crash Ordering Proof',
  });
  return email;
}

async function verifiedSession(
  prefix: string,
): Promise<{ email: string; accountId: string; cookie: string }> {
  const email = await signedUp(prefix);
  await harness.dispatch();

  const { token } = linkParameters(harness.provider.lastLinkTo(email) as string);
  await harness.identity.confirmVerification(anonymousContext(), { email, token });

  const signIn = await harness.identity.signIn(anonymousContext(), {
    email,
    password: PROOF_PASSWORD,
  });
  if (!signIn.ok) {
    throw new Error(`sign-in failed in fixture: ${signIn.failure}`);
  }

  const rows = await database.admin.query<{ id: string }>(
    `SELECT id FROM dbo.[User] WHERE email = '${email}';`,
  );
  const accountId = rows[0]?.id;
  if (accountId === undefined) throw new Error('account missing in fixture');

  return { email, accountId, cookie: cookieHeader(signIn.setCookies) };
}

async function crashAfterVendorCommit(): Promise<IdentityHarness> {
  let injected = false;
  return createIdentityHarness({
    wrapPersistence: (persistence) => ({
      ...persistence,
      async reconcileSecurityOperation(operationId) {
        if (!injected) {
          const rows = await database.admin.query<{
            committedAt: Date | null;
            completedAt: Date | null;
          }>(
            `SELECT committedAt, completedAt
             FROM dbo.IdentitySecurityOperation WHERE id = '${operationId}';`,
          );
          expect(rows[0]?.committedAt).not.toBeNull();
          expect(rows[0]?.completedAt).toBeNull();
          injected = true;
          throw new Error('synthetic crash after vendor commit');
        }
        return persistence.reconcileSecurityOperation(operationId);
      },
    }),
  });
}

async function followUpCounts(accountId: string, action: string, purpose: string) {
  const audits = await database.admin.query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM dbo.AuditLog
     WHERE targetId = '${accountId}' AND action = '${action}';`,
  );
  const intents = await database.admin.query<{ total: number }>(
    `SELECT COUNT(*) AS total FROM dbo.IdentityCommunicationIntent
     WHERE userId = '${accountId}' AND purpose = '${purpose}';`,
  );
  return {
    audits: Number(audits[0]?.total ?? 0),
    intents: Number(intents[0]?.total ?? 0),
  };
}

describe.skipIf(!databaseConfigured)('Phase 2 Chunk 1 — crash ordering', () => {
  beforeAll(async () => {
    database = await createProofDatabase();
    harness = await createIdentityHarness();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  }, 120_000);

  /* =======================================================================
   * 1. Token issuance and durable discoverability
   * ===================================================================== */

  describe('auth-token issuance', () => {
    it('commits the durable delivery BEFORE the token exists', async () => {
      const observed: { deliveries: number }[] = [];
      const email = freshEmail('ordering-observed');

      // The observation happens at the ONE instant that matters: inside the
      // token issuance itself, before it returns. If the delivery is already
      // there then, no crash can produce a token without one.
      const observing = await createIdentityHarness({
        wrapAuth: (auth: AuthMechanicsPort): AuthMechanicsPort => ({
          ...auth,
          async issueToken(input) {
            const rows = await database.admin.query<{ total: number }>(
              `SELECT COUNT(*) AS total FROM dbo.EmailDelivery
               WHERE sourceReference LIKE '%${input.email}%';`,
            );
            observed.push({ deliveries: Number(rows[0]?.total ?? 0) });
            return auth.issueToken(input);
          },
        }),
      });

      await observing.identity.signUp(anonymousContext(), {
        email,
        password: PROOF_PASSWORD,
        name: 'Ordering Proof',
      });

      // THE INVARIANT. At the moment the token is minted, the message it will
      // carry is already durable.
      expect(observed).toHaveLength(1);
      expect(observed[0]?.deliveries).toBe(1);
    }, 120_000);

    it('leaves a recoverable delivery and NO token when issuance fails', async () => {
      const email = freshEmail('ordering-failed');

      const failing = await createIdentityHarness({
        wrapAuth: (auth: AuthMechanicsPort): AuthMechanicsPort => ({
          ...auth,
          async issueToken() {
            throw new Error('synthetic crash during issuance');
          },
        }),
      });

      // `signUp` is deliberately non-enumerating and reports the same result
      // whatever happened underneath, so the CALLER learns nothing here. What
      // was left in the database is the whole question.
      await failing.identity.signUp(anonymousContext(), {
        email,
        password: PROOF_PASSWORD,
        name: 'Ordering Proof',
      });

      // The residue is the HARMLESS direction: a delivery with no token.
      const deliveries = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.EmailDelivery
         WHERE sourceReference LIKE '%${email}%';`,
      );
      expect(Number(deliveries[0]?.total)).toBe(1);

      // NO TOKEN. The library is configured not to mint one during sign-up
      // precisely so that Identity's explicit, correctly-ordered issuance is
      // the only mint in this path — see `emailVerification.sendOnSignUp`.
      const tokens = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.Verification
         WHERE identifier LIKE '%${email}%';`,
      );
      expect(Number(tokens[0]?.total)).toBe(0);

      // And it resolves itself rather than sitting there: deferred once, then
      // abandoned — never sent, because there is nothing to send.
      const first = await harness.dispatch();
      expect(first.deferred).toBeGreaterThanOrEqual(1);
      expect(harness.provider.messagesTo(email)).toHaveLength(0);

      await database.admin.query(
        `UPDATE dbo.EmailDelivery SET nextAttemptAt = SYSUTCDATETIME(), claimedUntil = NULL
         WHERE sourceReference LIKE '%${email}%';`,
      );

      await harness.dispatch();
      expect(harness.provider.messagesTo(email)).toHaveLength(0);

      const final = await database.admin.query<{ status: string; failureCode: string }>(
        `SELECT status, failureCode FROM dbo.EmailDelivery
         WHERE sourceReference LIKE '%${email}%';`,
      );
      expect(final[0]?.status).toBe('failed');
      expect(final[0]?.failureCode).toBe('nothing_to_send');
    }, 120_000);

    it('commits the EMAIL-CHANGE delivery before its token too', async () => {
      const account = await verifiedSession('ordering-changereq');
      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      const newEmail = freshEmail('ordering-changed');
      const observed: number[] = [];

      const observing = await createIdentityHarness({
        wrapAuth: (auth: AuthMechanicsPort): AuthMechanicsPort => ({
          ...auth,
          async requestEmailChange(input) {
            const rows = await database.admin.query<{ total: number }>(
              `SELECT COUNT(*) AS total FROM dbo.EmailDelivery
               WHERE sourceReference LIKE '%${newEmail}%';`,
            );
            observed.push(Number(rows[0]?.total ?? 0));
            return auth.requestEmailChange(input);
          },
        }),
      });

      const observingSession = await observing.session.resolve(context.headers);
      if (observingSession.state !== 'active') throw new Error('unreachable');

      await observing.identity.requestEmailChange(context, observingSession.session, {
        newEmail,
        currentPassword: PROOF_PASSWORD,
      });

      // Same invariant as sign-up: when the change token is minted, the
      // message it will carry is already durable.
      expect(observed).toEqual([1]);
    }, 120_000);

    it('recovers the owed message after a RESTART, with the same token', async () => {
      const email = await signedUp('ordering-restart');

      await harness.dispatch();
      const original = linkParameters(harness.provider.lastLinkTo(email) as string).token;
      expect(original).toHaveLength(43);

      // A dispatcher that claimed the row and died before recording the
      // outcome. Its lease expires and the work is due again — and the process
      // that picks it up shares NO memory with the one that dropped it.
      await database.admin.query(
        `UPDATE dbo.EmailDelivery
         SET status = 'pending', sentAt = NULL, nextAttemptAt = SYSUTCDATETIME(),
             claimedUntil = NULL
         WHERE sourceReference LIKE '%${email}%';`,
      );

      const restarted = await createIdentityHarness();
      const outcome = await restarted.dispatch();
      expect(outcome.sent).toBeGreaterThanOrEqual(1);

      const recovered = linkParameters(
        restarted.provider.lastLinkTo(email) as string,
      ).token;

      // THE SAME TOKEN, re-materialised from Better Auth's own record. Not a
      // new one minted because the first process forgot about it — that is the
      // P-4 property, and it has to hold across a restart or it holds nowhere.
      expect(recovered).toBe(original);
    }, 120_000);

    it('writes NO bearer token into the durable delivery record', async () => {
      const email = await signedUp('ordering-tokenfree');
      await harness.dispatch();

      const { token } = linkParameters(harness.provider.lastLinkTo(email) as string);

      const rows = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.EmailDelivery
         WHERE CAST(sourceReference AS NVARCHAR(MAX)) LIKE '%${token}%'
            OR CAST(idempotencyKey AS NVARCHAR(MAX)) LIKE '%${token}%';`,
      );

      // The durable work is TOKEN-FREE by construction. It names the delivery
      // identity; the bearer stays in Better Auth's own record.
      expect(Number(rows[0]?.total)).toBe(0);
    }, 120_000);
  });

  /* =======================================================================
   * 2. Security mutation and its follow-up
   * ===================================================================== */

  describe('security mutations', () => {
    it('commits the audit record and the notification TOGETHER', async () => {
      const account = await verifiedSession('ordering-password');
      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      await harness.identity.changePassword(context, session.session, {
        currentPassword: PROOF_PASSWORD,
        newPassword: PROOF_NEW_PASSWORD,
      });

      const audited = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.AuditLog
         WHERE targetId = '${account.accountId}' AND action = 'identity.password.changed';`,
      );
      const intents = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.IdentityCommunicationIntent
         WHERE userId = '${account.accountId}' AND purpose = 'identity.password-changed';`,
      );

      // Neither exists without the other. A change recorded but never
      // disclosed is indistinguishable, later, from one nobody was told about
      // on purpose.
      expect(Number(audited[0]?.total)).toBe(1);
      expect(Number(intents[0]?.total)).toBe(1);
    }, 120_000);

    it('recovers a committed intent after a RESTART', async () => {
      const account = await verifiedSession('ordering-recover');
      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      await harness.identity.changePassword(context, session.session, {
        currentPassword: PROOF_PASSWORD,
        newPassword: PROOF_NEW_PASSWORD,
      });

      // Put the intent back to where a crash before the relay would leave it,
      // and drop the delivery the same request created.
      await database.admin.query(
        `DELETE FROM dbo.EmailDelivery
         WHERE idempotencyKey LIKE 'identity.password-changed:${account.accountId}:%';`,
      );
      await database.admin.query(
        `UPDATE dbo.IdentityCommunicationIntent
         SET status = 'pending', relayedAt = NULL
         WHERE userId = '${account.accountId}';`,
      );

      const restarted = await createIdentityHarness();
      await restarted.dispatch();

      // The committed intent is what carries the message across the crash.
      expect(restarted.provider.messagesTo(account.email).length).toBeGreaterThanOrEqual(
        1,
      );
    }, 120_000);

    it('relays a committed intent exactly ONCE across repeated sweeps', async () => {
      const account = await verifiedSession('ordering-once');
      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      await harness.identity.changePassword(context, session.session, {
        currentPassword: PROOF_PASSWORD,
        newPassword: PROOF_NEW_PASSWORD,
      });

      await harness.dispatch();
      await harness.dispatch();
      await harness.dispatch();

      const rows = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.EmailDelivery
         WHERE idempotencyKey LIKE 'identity.password-changed:${account.accountId}:%';`,
      );

      // Idempotent on the key, so a sweep that runs while an earlier one is
      // still finishing cannot produce a second message.
      expect(Number(rows[0]?.total)).toBe(1);
    }, 120_000);

    it('reconciles a password RESET from a fresh process after the vendor commit', async () => {
      const account = await verifiedSession('ordering-reset-crash');
      await harness.identity.requestPasswordReset(anonymousContext(), {
        email: account.email,
      });
      await harness.dispatch();
      const { token } = linkParameters(
        harness.provider.lastLinkTo(account.email) as string,
      );

      const crashing = await crashAfterVendorCommit();
      await expect(
        crashing.identity.resetPassword(anonymousContext(), {
          email: account.email,
          token,
          newPassword: PROOF_NEW_PASSWORD,
        }),
      ).rejects.toThrow('synthetic crash after vendor commit');

      expect(
        await followUpCounts(
          account.accountId,
          'identity.password.reset',
          'identity.password-changed',
        ),
      ).toEqual({ audits: 0, intents: 0 });

      const restarted = await createIdentityHarness();
      await restarted.dispatch();
      expect(
        await followUpCounts(
          account.accountId,
          'identity.password.reset',
          'identity.password-changed',
        ),
      ).toEqual({ audits: 1, intents: 1 });
      expect(restarted.provider.messagesTo(account.email)).toHaveLength(1);

      const signIn = await restarted.identity.signIn(anonymousContext(), {
        email: account.email,
        password: PROOF_NEW_PASSWORD,
      });
      expect(signIn.ok).toBe(true);

      const reused = await restarted.identity.resetPassword(anonymousContext(), {
        email: account.email,
        token,
        newPassword: PROOF_PASSWORD,
      });
      expect(reused).toMatchObject({ ok: false, failure: 'invalid-token' });
    }, 120_000);

    it('reconciles a password CHANGE once under concurrent restart sweeps', async () => {
      const account = await verifiedSession('ordering-change-crash');
      const context = sessionContext(account.cookie);
      const crashing = await crashAfterVendorCommit();
      const session = await crashing.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      await expect(
        crashing.identity.changePassword(context, session.session, {
          currentPassword: PROOF_PASSWORD,
          newPassword: PROOF_NEW_PASSWORD,
        }),
      ).rejects.toThrow('synthetic crash after vendor commit');

      expect(
        await followUpCounts(
          account.accountId,
          'identity.password.changed',
          'identity.password-changed',
        ),
      ).toEqual({ audits: 0, intents: 0 });

      const restarted = await createIdentityHarness();
      await Promise.all(
        Array.from({ length: 6 }, () => restarted.identity.relayPendingIntents(50)),
      );

      expect(
        await followUpCounts(
          account.accountId,
          'identity.password.changed',
          'identity.password-changed',
        ),
      ).toEqual({ audits: 1, intents: 1 });
      const deliveries = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.EmailDelivery
         WHERE idempotencyKey LIKE 'identity.password-changed:${account.accountId}:%';`,
      );
      expect(Number(deliveries[0]?.total)).toBe(1);

      const signIn = await restarted.identity.signIn(anonymousContext(), {
        email: account.email,
        password: PROOF_NEW_PASSWORD,
      });
      expect(signIn.ok).toBe(true);
    }, 120_000);

    it('reconciles an EMAIL CHANGE to the new address and revokes old sessions', async () => {
      const account = await verifiedSession('ordering-email-crash');
      const secondSignIn = await harness.identity.signIn(anonymousContext(), {
        email: account.email,
        password: PROOF_PASSWORD,
      });
      if (!secondSignIn.ok) throw new Error('second sign-in failed');
      const secondCookie = cookieHeader(secondSignIn.setCookies);

      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');
      const newEmail = freshEmail('ordering-email-new');
      await harness.identity.requestEmailChange(context, session.session, {
        newEmail,
        currentPassword: PROOF_PASSWORD,
      });
      await harness.dispatch();
      const { token } = linkParameters(harness.provider.lastLinkTo(newEmail) as string);

      const crashing = await crashAfterVendorCommit();
      const crashingSession = await crashing.session.resolve(context.headers);
      if (crashingSession.state !== 'active') throw new Error('unreachable');
      await expect(
        crashing.identity.confirmEmailChange(context, crashingSession.session, {
          newEmail,
          token,
        }),
      ).rejects.toThrow('synthetic crash after vendor commit');

      const changed = await database.admin.query<{ email: string }>(
        `SELECT email FROM dbo.[User] WHERE id = '${account.accountId}';`,
      );
      expect(changed[0]?.email).toBe(newEmail);
      expect(
        await followUpCounts(
          account.accountId,
          'identity.email.changed',
          'identity.email-changed',
        ),
      ).toEqual({ audits: 0, intents: 0 });

      const restarted = await createIdentityHarness();
      await restarted.dispatch();
      expect(
        await followUpCounts(
          account.accountId,
          'identity.email.changed',
          'identity.email-changed',
        ),
      ).toEqual({ audits: 1, intents: 1 });
      expect(restarted.provider.messagesTo(newEmail)).toHaveLength(1);
      expect(restarted.provider.messagesTo(account.email)).toHaveLength(0);

      const oldOtherSession = await restarted.session.resolve(
        sessionContext(secondCookie).headers,
      );
      expect(oldOtherSession).toMatchObject({ state: 'denied', reason: 'no-session' });

      const operationRows = await database.admin.query<Record<string, unknown>>(
        `SELECT * FROM dbo.IdentitySecurityOperation
         WHERE userId = '${account.accountId}' AND kind = 'email-change';`,
      );
      expect(JSON.stringify(operationRows)).not.toContain(token);
      expect(JSON.stringify(operationRows)).not.toContain(account.email);
      expect(JSON.stringify(operationRows)).not.toContain(newEmail);
    }, 120_000);

    it('fences a pre-mutation crash without a false follow-up or late write', async () => {
      const account = await verifiedSession('ordering-before-change');
      const context = sessionContext(account.cookie);
      let captured:
        | Parameters<AuthMechanicsPort['changePassword']>[0]['securityOperation']
        | undefined;
      const crashing = await createIdentityHarness({
        wrapAuth: (auth) => ({
          ...auth,
          async changePassword(input) {
            captured = input.securityOperation;
            throw new Error('synthetic crash before vendor mutation');
          },
        }),
      });
      const session = await crashing.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      const result = await crashing.identity.changePassword(context, session.session, {
        currentPassword: PROOF_PASSWORD,
        newPassword: PROOF_NEW_PASSWORD,
      });
      expect(result).toMatchObject({ ok: false, failure: 'invalid-credentials' });
      expect(captured).toBeDefined();

      const marker = await database.admin.query<{
        committedAt: Date | null;
        cancelledAt: Date | null;
      }>(
        `SELECT committedAt, cancelledAt FROM dbo.IdentitySecurityOperation
         WHERE id = '${captured!.id}';`,
      );
      expect(marker[0]?.committedAt).toBeNull();
      expect(marker[0]?.cancelledAt).not.toBeNull();
      expect(
        await followUpCounts(
          account.accountId,
          'identity.password.changed',
          'identity.password-changed',
        ),
      ).toEqual({ audits: 0, intents: 0 });

      // Simulate the old process resuming after its durable marker was fenced.
      await expect(
        harness.auth.changePassword({
          headers: context.headers,
          currentPassword: PROOF_PASSWORD,
          newPassword: PROOF_NEW_PASSWORD,
          securityOperation: captured!,
        }),
      ).rejects.toThrow();

      const oldPassword = await harness.identity.signIn(anonymousContext(), {
        email: account.email,
        password: PROOF_PASSWORD,
      });
      expect(oldPassword.ok).toBe(true);
      await harness.dispatch();
      expect(
        await followUpCounts(
          account.accountId,
          'identity.password.changed',
          'identity.password-changed',
        ),
      ).toEqual({ audits: 0, intents: 0 });
    }, 120_000);

    it('fences an abandoned prepared marker from a fresh-process sweep', async () => {
      const account = await verifiedSession('ordering-prepared-crash');
      const context = sessionContext(account.cookie);
      let prepared:
        | Parameters<AuthMechanicsPort['changePassword']>[0]['securityOperation']
        | undefined;
      const crashing = await createIdentityHarness({
        wrapPersistence: (persistence) => ({
          ...persistence,
          async prepareSecurityOperation(input) {
            prepared = await persistence.prepareSecurityOperation(input);
            throw new Error('synthetic crash after marker preparation');
          },
        }),
      });
      const session = await crashing.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      await expect(
        crashing.identity.changePassword(context, session.session, {
          currentPassword: PROOF_PASSWORD,
          newPassword: PROOF_NEW_PASSWORD,
        }),
      ).rejects.toThrow('synthetic crash after marker preparation');
      expect(prepared).toBeDefined();

      await database.admin.query(
        `UPDATE dbo.IdentitySecurityOperation
         SET createdAt = DATEADD(minute, -16, SYSUTCDATETIME())
         WHERE id = '${prepared!.id}';`,
      );
      const restarted = await createIdentityHarness();
      await restarted.identity.relayPendingIntents(50);

      const [marker] = await database.admin.query<{
        committedAt: Date | null;
        cancelledAt: Date | null;
      }>(
        `SELECT committedAt, cancelledAt FROM dbo.IdentitySecurityOperation
         WHERE id = '${prepared!.id}';`,
      );
      expect(marker?.committedAt).toBeNull();
      expect(marker?.cancelledAt).not.toBeNull();

      await expect(
        restarted.auth.changePassword({
          headers: context.headers,
          currentPassword: PROOF_PASSWORD,
          newPassword: PROOF_NEW_PASSWORD,
          securityOperation: prepared!,
        }),
      ).rejects.toThrow();
      expect(
        await followUpCounts(
          account.accountId,
          'identity.password.changed',
          'identity.password-changed',
        ),
      ).toEqual({ audits: 0, intents: 0 });
    }, 120_000);

    it('rolls back partial finalization and retries it once after restart', async () => {
      const account = await verifiedSession('ordering-finalize-crash');
      const context = sessionContext(account.cookie);
      const crashing = await crashAfterVendorCommit();
      const session = await crashing.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');
      await expect(
        crashing.identity.changePassword(context, session.session, {
          currentPassword: PROOF_PASSWORD,
          newPassword: PROOF_NEW_PASSWORD,
        }),
      ).rejects.toThrow('synthetic crash after vendor commit');

      await database.admin.query(`
        CREATE TRIGGER [dbo].[TRG_Proof_BlockSecurityOperationCompletion]
        ON [dbo].[IdentitySecurityOperation]
        AFTER UPDATE
        AS
        BEGIN
          IF EXISTS (
            SELECT 1 FROM inserted i JOIN deleted d ON d.id = i.id
            WHERE d.completedAt IS NULL AND i.completedAt IS NOT NULL
          )
            THROW 51000, 'synthetic crash before completion marker', 1;
        END;
      `);

      const restarted = await createIdentityHarness();
      try {
        await expect(restarted.identity.relayPendingIntents(50)).rejects.toThrow();
        expect(
          await followUpCounts(
            account.accountId,
            'identity.password.changed',
            'identity.password-changed',
          ),
        ).toEqual({ audits: 0, intents: 0 });
      } finally {
        await database.admin.query(
          'DROP TRIGGER IF EXISTS [dbo].[TRG_Proof_BlockSecurityOperationCompletion];',
        );
      }

      await restarted.dispatch();
      await restarted.dispatch();
      expect(
        await followUpCounts(
          account.accountId,
          'identity.password.changed',
          'identity.password-changed',
        ),
      ).toEqual({ audits: 1, intents: 1 });
    }, 120_000);
  });

  /* =======================================================================
   * 3. Account closure
   * ===================================================================== */

  describe('account closure', () => {
    it('leaves NO sendable notice when the closure transaction fails', async () => {
      const account = await verifiedSession('ordering-closefail');
      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      // Force the closure transaction to fail on a real constraint: the intent
      // it will commit collides with a row that already holds its key. Nothing
      // is stubbed — the actual transaction runs and the actual database
      // refuses it.
      await database.admin.query(
        `INSERT INTO dbo.IdentityCommunicationIntent
           (purpose, userId, locale, idempotencyKey, status)
         VALUES ('identity.account-closed', '${account.accountId}', 'en',
                 '${closureKey(account.accountId)}', 'relayed');`,
      );

      await expect(
        harness.identity.closeAccount(context, session.session),
      ).rejects.toThrow();

      // THE ASSERTION. No "your account has been closed" message exists for an
      // account that is still open.
      const deliveries = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.EmailDelivery
         WHERE purpose = 'identity.account-closed'
           AND sourceReference LIKE '%${account.accountId}%';`,
      );
      expect(Number(deliveries[0]?.total)).toBe(0);

      // And the account really is still open, with its address intact — the
      // transaction rolled back whole.
      const user = await database.admin.query<{ status: string; email: string }>(
        `SELECT status, email FROM dbo.[User] WHERE id = '${account.accountId}';`,
      );
      expect(user[0]?.status).toBe('active');
      expect(user[0]?.email).toBe(account.email);
      expect(
        await followUpCounts(
          account.accountId,
          'identity.account.closed',
          'identity.account-closed',
        ),
      ).toEqual({ audits: 0, intents: 1 });

      // A dispatch must not invent one either.
      await harness.dispatch();
      expect(
        harness.provider
          .messagesTo(account.email)
          .filter((message) => message.subject.toLowerCase().includes('clos')),
      ).toHaveLength(0);
    }, 120_000);

    it('delivers the closure notice to the PRE-CLOSURE address', async () => {
      const account = await verifiedSession('ordering-closed');
      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      const closed = await harness.identity.closeAccount(context, session.session);
      expect(closed.ok).toBe(true);

      // Committed INSIDE the closure transaction, carrying the address the
      // account is about to stop holding.
      const intent = await database.admin.query<{
        status: string;
        recipientOverride: string | null;
      }>(
        `SELECT status, recipientOverride FROM dbo.IdentityCommunicationIntent
         WHERE userId = '${account.accountId}';`,
      );
      expect(intent[0]?.status).toBe('pending');
      expect(intent[0]?.recipientOverride).toBe(account.email);
      expect(
        await followUpCounts(
          account.accountId,
          'identity.account.closed',
          'identity.account-closed',
        ),
      ).toEqual({ audits: 1, intents: 1 });

      // The user row no longer holds the address at all.
      const user = await database.admin.query<{ status: string; email: string }>(
        `SELECT status, email FROM dbo.[User] WHERE id = '${account.accountId}';`,
      );
      expect(user[0]?.status).toBe('closed');
      expect(user[0]?.email).not.toBe(account.email);
      expect(user[0]?.email).toContain('closed.invalid');

      await harness.dispatch();

      // It reached the address the person actually uses, not the tombstone.
      expect(harness.provider.messagesTo(account.email).length).toBeGreaterThanOrEqual(1);
      expect(harness.provider.messagesTo(user[0]?.email as string)).toHaveLength(0);
    }, 120_000);

    it('DISCARDS the captured address once the notice is relayed', async () => {
      const account = await verifiedSession('ordering-discard');
      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      await harness.identity.closeAccount(context, session.session);
      await harness.dispatch();

      const intent = await database.admin.query<{
        status: string;
        recipientOverride: string | null;
      }>(
        `SELECT status, recipientOverride FROM dbo.IdentityCommunicationIntent
         WHERE userId = '${account.accountId}';`,
      );

      // THE RETENTION BOUND, enforced in the same operation that marks the
      // intent relayed rather than by a policy somebody has to remember.
      expect(intent[0]?.status).toBe('relayed');
      expect(intent[0]?.recipientOverride).toBeNull();

      // And the address survives nowhere else on the closed account.
      const user = await database.admin.query<{ email: string; name: string | null }>(
        `SELECT email, name FROM dbo.[User] WHERE id = '${account.accountId}';`,
      );
      expect(user[0]?.email).not.toContain(account.email.split('@')[0]);
      expect(user[0]?.name).not.toContain(account.email);
    }, 120_000);

    it('lets the address register again as a genuinely NEW account', async () => {
      const account = await verifiedSession('ordering-rereg');
      const context = sessionContext(account.cookie);
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      await harness.identity.closeAccount(context, session.session);
      await harness.dispatch();

      await harness.identity.signUp(anonymousContext(), {
        email: account.email,
        password: PROOF_NEW_PASSWORD,
        name: 'Second Life',
      });

      const rows = await database.admin.query<{ id: string; status: string }>(
        `SELECT id, status FROM dbo.[User] WHERE email = '${account.email}';`,
      );

      expect(rows).toHaveLength(1);
      // A NEW id. Nothing about the closed account reconnects to it.
      expect(rows[0]?.id).not.toBe(account.accountId);
      expect(rows[0]?.status).toBe('active');

      const newId = rows[0]?.id as string;

      // No credential, session or outstanding token from before follows it.
      for (const table of ['Session', 'Account']) {
        const carried = await database.admin.query<{ total: number }>(
          `SELECT COUNT(*) AS total FROM dbo.[${table}] WHERE userId = '${account.accountId}';`,
        );
        expect(Number(carried[0]?.total), `${table} must not survive closure`).toBe(0);
      }

      const intents = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.IdentityCommunicationIntent
         WHERE userId = '${newId}';`,
      );
      expect(Number(intents[0]?.total)).toBe(0);
    }, 120_000);
  });
});
