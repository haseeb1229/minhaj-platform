import { createHmac } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// TYPE-only. The VALUES are imported dynamically inside the suite, after the
// harness has repointed `DATABASE_URL`: a static value import would bind the
// Prisma client to whatever was configured when this module graph loaded.
import type { SuppressionScope } from '../../packages/contracts/src/platform/index.ts';
import type * as DigestModule from '../../packages/database/src/adapters/email/digest.ts';
import type * as WebhookModule from '../../packages/database/src/adapters/email/webhook.ts';

import {
  createProofDatabase,
  databaseConfigured,
  freshEmail,
  linkParameters,
  PROOF_PASSWORD,
  PROOF_SECRETS,
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
 * PHASE 2 CHUNK 1 — outbound communication and the provider callback.
 *
 * THE ARCHITECTURAL CLAIM UNDER TEST (ARCHITECTURE.md §4.6.1):
 *
 *   Better Auth's `Verification` record is the SOLE durable home for auth
 *   bearer material, and a failed DELIVERY is retried with the SAME token —
 *   no mint, no rotation, no expiry extension, no second durable copy.
 *
 * That claim is only worth as much as the evidence for it, and the evidence
 * has to be the actual bytes in the actual tables. Several of the tests below
 * therefore read every row of every other table and assert the token is not
 * in any of them.
 *
 * The webhook half proves the complementary property for protocol class B: a
 * machine callback has no browser session and no Origin worth checking, so
 * signature verification is the WHOLE of its authentication
 * (SECURITY_BASELINE.md §7.2).
 */

let database: DisposableDatabase;
let harness: IdentityHarness;

/** A signed-up, unverified account with one outstanding verification message. */
async function pendingVerification(prefix: string): Promise<string> {
  const email = freshEmail(prefix);

  await harness.identity.signUp(anonymousContext(), {
    email,
    password: PROOF_PASSWORD,
    name: 'Communication Proof',
  });

  return email;
}

describe.skipIf(!databaseConfigured)('Phase 2 Chunk 1 — communication', () => {
  beforeAll(async () => {
    database = await createProofDatabase();
    harness = await createIdentityHarness();
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  }, 120_000);

  /* =======================================================================
   * Token authority
   * ===================================================================== */

  describe('auth-token authority', () => {
    it('writes NO bearer token into any table but Verification', async () => {
      const email = await pendingVerification('authority');
      await harness.dispatch();

      const { token } = linkParameters(harness.provider.lastLinkTo(email) as string);
      expect(token).toHaveLength(43);

      // Every user table in the disposable database, every column, searched
      // for the literal token. This is the assertion the whole architecture
      // rests on, and it is worth making expensively.
      const tables = await database.admin.query<{ name: string }>(
        `SELECT t.name AS name FROM sys.tables AS t WHERE t.name <> 'Verification';`,
      );

      for (const { name } of tables) {
        const columns = await database.admin.query<{ column: string }>(
          `SELECT c.name AS [column]
           FROM sys.columns AS c
           JOIN sys.types AS ty ON ty.user_type_id = c.user_type_id
           WHERE c.object_id = OBJECT_ID('dbo.[${name}]')
             AND ty.name IN ('nvarchar', 'varchar', 'nchar', 'char', 'text', 'ntext');`,
        );

        for (const { column } of columns) {
          const hits = await database.admin.query<{ total: number }>(
            `SELECT COUNT(*) AS total FROM dbo.[${name}]
             WHERE CAST([${column}] AS NVARCHAR(MAX)) LIKE '%${token}%';`,
          );

          expect(
            hits[0]?.total,
            `${name}.${column} must not contain a bearer token`,
          ).toBe(0);
        }
      }
    }, 120_000);

    it('stores the token ENCRYPTED even in Verification', async () => {
      const email = await pendingVerification('encrypted');
      await harness.dispatch();

      const { token } = linkParameters(harness.provider.lastLinkTo(email) as string);

      const rows = await database.admin.query<{ value: string }>(
        `SELECT value FROM dbo.Verification WHERE identifier LIKE '%${email}%';`,
      );

      expect(rows.length).toBeGreaterThan(0);

      // Recoverable, but not in clear. Recoverable is what makes a delivery
      // retry possible with the same token; not-in-clear is what keeps a
      // database read from being a mailbox takeover.
      for (const row of rows) {
        expect(row.value).not.toContain(token);
      }
    });

    it('records the delivery WITHOUT the recipient address', async () => {
      const email = await pendingVerification('digest');
      await harness.dispatch();

      const rows = await database.admin.query<{
        recipientDigest: string;
        sourceReference: string;
        digestKeyVersion: number;
      }>(
        `SELECT recipientDigest, sourceReference, digestKeyVersion
         FROM dbo.EmailDelivery WHERE sourceReference LIKE '%${email}%';`,
      );

      // The SOURCE REFERENCE is the owner's own opaque handle and legitimately
      // names the address — it is how Identity re-resolves the delivery. The
      // DIGEST is what Layer 0 keeps, and it is keyed.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.recipientDigest).not.toContain(email);
      expect(rows[0]?.recipientDigest).not.toContain('@');
      expect(rows[0]?.digestKeyVersion).toBe(PROOF_SECRETS.digestKeyVersion);
    });
  });

  /* =======================================================================
   * Delivery retry — the P-4 property, through the real dispatcher
   * ===================================================================== */

  describe('delivery retry', () => {
    it('retries with the SAME token after a transient provider failure', async () => {
      const email = await pendingVerification('retry-same');

      // The provider refuses the first attempt the way a real one would during
      // a brief outage.
      harness.provider.failNextTo(email, 1, { class: 'transient', code: 'http_503' });

      const first = await harness.dispatch();
      expect(first.failed).toBeGreaterThanOrEqual(1);

      const attempted = harness.provider.messagesTo(email).at(-1);
      expect(attempted).toBeDefined();
      const firstToken = linkParameters(
        /https?:\/\/\S+/.exec(attempted?.text ?? '')?.[0] ?? '',
      ).token;

      const row = await database.admin.query<{
        attemptCount: number;
        status: string;
        nextAttemptAt: Date | null;
        failureClass: string | null;
        failureCode: string | null;
      }>(
        `SELECT attemptCount, status, nextAttemptAt, failureClass, failureCode
         FROM dbo.EmailDelivery WHERE sourceReference LIKE '%${email}%';`,
      );

      expect(row[0]?.status).toBe('pending');
      expect(row[0]?.attemptCount).toBe(1);
      expect(row[0]?.failureClass).toBe('transient');
      expect(row[0]?.failureCode).toBe('http_503');
      expect(row[0]?.nextAttemptAt).not.toBeNull();

      // Backoff is real: the retry is not due yet, so a tick now does not send
      // to this address again. Bring it forward rather than waiting a minute.
      const beforeBackoff = harness.provider.messagesTo(email).length;
      await harness.dispatch();
      expect(harness.provider.messagesTo(email).length).toBe(beforeBackoff);

      await database.admin.query(
        `UPDATE dbo.EmailDelivery SET nextAttemptAt = SYSUTCDATETIME()
         WHERE sourceReference LIKE '%${email}%';`,
      );

      const second = await harness.dispatch();
      expect(second.sent).toBeGreaterThanOrEqual(1);

      const delivered = harness.provider.messagesTo(email).at(-1);
      const secondToken = linkParameters(
        /https?:\/\/\S+/.exec(delivered?.text ?? '')?.[0] ?? '',
      ).token;

      // THE PROPERTY. The retry carries the token the first attempt carried —
      // it was never stored anywhere to be read back, it was re-materialised
      // from Better Auth's own record.
      expect(secondToken).toBe(firstToken);

      // And the link still works, which is the point of not rotating it.
      expect(
        await harness.identity.inspectVerification({ email, token: secondToken }),
      ).toBe('valid');
    }, 120_000);

    it('does not extend the token expiry on a retry', async () => {
      const email = await pendingVerification('retry-expiry');

      harness.provider.failNextTo(email, 1, { class: 'transient', code: 'http_500' });
      await harness.dispatch();

      const before = await database.admin.query<{ expiresAt: Date }>(
        `SELECT expiresAt FROM dbo.Verification WHERE identifier LIKE '%${email}%';`,
      );

      await database.admin.query(
        `UPDATE dbo.EmailDelivery SET nextAttemptAt = SYSUTCDATETIME()
         WHERE sourceReference LIKE '%${email}%';`,
      );
      await harness.dispatch();

      const after = await database.admin.query<{ expiresAt: Date }>(
        `SELECT expiresAt FROM dbo.Verification WHERE identifier LIKE '%${email}%';`,
      );

      // `resendStrategy: "reuse"` would have extended it. Repeated provider
      // retries would then keep a token alive indefinitely — which is why the
      // configuration is `"rotate"` and retries go through materialisation
      // instead.
      expect(after[0]?.expiresAt.getTime()).toBe(before[0]?.expiresAt.getTime());
    }, 120_000);

    it('mints NO second token however often a delivery is retried', async () => {
      const email = await pendingVerification('retry-count');

      const countTokens = async (): Promise<number> => {
        const rows = await database.admin.query<{ total: number }>(
          `SELECT COUNT(*) AS total FROM dbo.Verification
           WHERE identifier LIKE '%${email}%';`,
        );
        return rows[0]?.total ?? 0;
      };

      // The BASELINE is measured rather than assumed. The library's own
      // rotation may append or supersede rows, and freezing an absolute count
      // here would turn an incidental implementation detail into a product
      // contract that later breaks for no security reason. What matters is
      // that a RETRY adds nothing.
      const before = await countTokens();
      expect(before).toBeGreaterThan(0);

      harness.provider.failNextTo(email, 2, { class: 'transient', code: 'http_503' });

      for (let attempt = 0; attempt < 3; attempt += 1) {
        await database.admin.query(
          `UPDATE dbo.EmailDelivery SET nextAttemptAt = SYSUTCDATETIME()
           WHERE sourceReference LIKE '%${email}%';`,
        );
        await harness.dispatch();
      }

      expect(await countTokens()).toBe(before);

      // And exactly one token is REACHABLE: the one that was delivered.
      const link = harness.provider.lastLinkTo(email);
      const { token } = linkParameters(link as string);
      expect(await harness.identity.inspectVerification({ email, token })).toBe('valid');
    }, 120_000);

    it('gives up immediately on a PERMANENT rejection', async () => {
      const email = await pendingVerification('permanent');

      harness.provider.failNextTo(email, 1, { class: 'permanent', code: 'http_422' });

      const outcome = await harness.dispatch();
      expect(outcome.failed).toBeGreaterThanOrEqual(1);

      const rows = await database.admin.query<{
        status: string;
        nextAttemptAt: Date | null;
      }>(
        `SELECT status, nextAttemptAt FROM dbo.EmailDelivery
         WHERE sourceReference LIKE '%${email}%';`,
      );

      // Retrying a rejected address just spends the budget and keeps writing
      // to a mailbox that already said no.
      expect(rows[0]?.status).toBe('failed');
      expect(rows[0]?.nextAttemptAt).toBeNull();
    });

    it('exhausts a BOUNDED retry budget rather than trying forever', async () => {
      const email = await pendingVerification('budget');

      harness.provider.failNextTo(email, 20, { class: 'transient', code: 'http_503' });

      let status = 'pending';
      for (let attempt = 0; attempt < 12 && status !== 'failed'; attempt += 1) {
        await database.admin.query(
          `UPDATE dbo.EmailDelivery SET nextAttemptAt = SYSUTCDATETIME()
           WHERE sourceReference LIKE '%${email}%';`,
        );
        await harness.dispatch();

        const rows = await database.admin.query<{ status: string }>(
          `SELECT status FROM dbo.EmailDelivery WHERE sourceReference LIKE '%${email}%';`,
        );
        status = rows[0]?.status ?? 'pending';
      }

      expect(status).toBe('failed');
    }, 180_000);

    it('ABANDONS a delivery whose token no longer exists', async () => {
      const email = await pendingVerification('abandon');
      await harness.dispatch();

      const { token } = linkParameters(harness.provider.lastLinkTo(email) as string);
      await harness.identity.confirmVerification(anonymousContext(), { email, token });

      // Force the delivery due again, as a crashed dispatcher's lease expiring
      // would.
      await database.admin.query(
        `UPDATE dbo.EmailDelivery
         SET status = 'pending', nextAttemptAt = SYSUTCDATETIME(), claimedUntil = NULL
         WHERE sourceReference LIKE '%${email}%';`,
      );

      const before = harness.provider.messagesTo(email).length;

      // FIRST ATTEMPT: deferred, not abandoned.
      //
      // A token delivery is committed BEFORE its token is minted, so that a
      // crash can never strand a live token with no record that a message was
      // owed. The price of that ordering is that "no token" is ambiguous on a
      // delivery's first attempt — issuance in flight looks exactly like
      // issuance that already happened and was consumed — so the first attempt
      // waits rather than throwing the message away.
      const first = await harness.dispatch();
      expect(first.deferred).toBeGreaterThanOrEqual(1);
      expect(first.abandoned).toBe(0);

      // Nothing was sent, which is the part that must hold at every step: a
      // dead link must never reach somebody's inbox.
      expect(harness.provider.messagesTo(email).length).toBe(before);

      const deferredRow = await database.admin.query<{
        status: string;
        failureCode: string | null;
      }>(
        `SELECT status, failureCode FROM dbo.EmailDelivery
         WHERE sourceReference LIKE '%${email}%';`,
      );
      expect(deferredRow[0]?.status).toBe('pending');
      expect(deferredRow[0]?.failureCode).toBe('awaiting_source');

      // SECOND ATTEMPT: the ambiguity is gone, and it is abandoned.
      await database.admin.query(
        `UPDATE dbo.EmailDelivery
         SET nextAttemptAt = SYSUTCDATETIME(), claimedUntil = NULL
         WHERE sourceReference LIKE '%${email}%';`,
      );

      const second = await harness.dispatch();

      // Nothing is owed any more. That is a NORMAL outcome, not a failure.
      expect(second.abandoned).toBeGreaterThanOrEqual(1);
      expect(harness.provider.messagesTo(email).length).toBe(before);

      const rows = await database.admin.query<{ failureCode: string | null }>(
        `SELECT failureCode FROM dbo.EmailDelivery WHERE sourceReference LIKE '%${email}%';`,
      );
      expect(rows[0]?.failureCode).toBe('nothing_to_send');
    }, 120_000);
  });

  /* =======================================================================
   * Idempotency and crash safety
   * ===================================================================== */

  describe('idempotency', () => {
    it('enqueues ONE row for a message enqueued twice', async () => {
      const email = await pendingVerification('idempotent');

      const key = `identity.email-verification:${email}:fixed-occasion`;

      const first = await harness.deliveries.enqueue({
        purpose: 'identity.email-verification',
        recipient: email,
        sourceReference: `identity:token:email-verification:${email}`,
        idempotencyKey: key,
      });
      const second = await harness.deliveries.enqueue({
        purpose: 'identity.email-verification',
        recipient: email,
        sourceReference: `identity:token:email-verification:${email}`,
        idempotencyKey: key,
      });

      expect(second.id).toBe(first.id);
    });

    it('enqueues ONE row when a burst races on the same key', async () => {
      const email = freshEmail('race-enqueue');
      const key = `identity.email-verification:${email}:burst`;

      const results = await Promise.all(
        Array.from({ length: 8 }, async () =>
          harness.deliveries.enqueue({
            purpose: 'identity.email-verification',
            recipient: email,
            sourceReference: `identity:token:email-verification:${email}`,
            idempotencyKey: key,
          }),
        ),
      );

      // The unique constraint decides, and the losers read the winner's row
      // rather than failing. A check-then-insert would produce several.
      expect(new Set(results.map((row) => row.id)).size).toBe(1);
    }, 60_000);

    it('carries the SAME idempotency key to the provider on every attempt', async () => {
      const email = await pendingVerification('provider-idempotency');

      harness.provider.failNextTo(email, 1, { class: 'transient', code: 'http_503' });
      await harness.dispatch();

      // Forced due rather than waited for; the backoff itself is proved above.
      await database.admin.query(
        `UPDATE dbo.EmailDelivery SET nextAttemptAt = SYSUTCDATETIME()
         WHERE sourceReference LIKE '%${email}%';`,
      );
      await harness.dispatch();

      const attempts = harness.provider.messagesTo(email);
      expect(attempts.length).toBeGreaterThanOrEqual(2);

      const row = await database.admin.query<{ idempotencyKey: string }>(
        `SELECT idempotencyKey FROM dbo.EmailDelivery
         WHERE sourceReference LIKE '%${email}%';`,
      );
      const stored = row[0]?.idempotencyKey;
      expect(stored).toBeDefined();

      // Every attempt carries the key the ROW carries. An ambiguous outcome —
      // the request arrived, the response did not — therefore cannot produce a
      // second message, because the provider dedupes on exactly this value.
      for (const attempt of attempts) {
        expect(attempt.idempotencyKey).toBe(stored);
      }
    }, 120_000);

    it('makes a claimed-but-uncompleted delivery claimable again', async () => {
      const email = await pendingVerification('lease');

      // The row is claimed and the process dies before it reports anything.
      const claimed = await harness.deliveries.claimDue({ limit: 50, leaseSeconds: 60 });
      expect(claimed.some((row) => row.sourceReference.includes(email))).toBe(true);

      // While the lease is live, nobody else may take it — that is what stops
      // two dispatchers sending the same message.
      const contended = await harness.deliveries.claimDue({
        limit: 50,
        leaseSeconds: 60,
      });
      expect(contended.some((row) => row.sourceReference.includes(email))).toBe(false);

      // Once it expires, the row is due again and a restart picks it up.
      await database.admin.query(
        `UPDATE dbo.EmailDelivery
         SET claimedUntil = DATEADD(minute, -5, SYSUTCDATETIME())
         WHERE sourceReference LIKE '%${email}%';`,
      );

      const recovered = await harness.deliveries.claimDue({
        limit: 50,
        leaseSeconds: 60,
      });
      expect(recovered.some((row) => row.sourceReference.includes(email))).toBe(true);
    });

    it('lets two concurrent dispatchers claim DISJOINT work', async () => {
      for (let i = 0; i < 6; i += 1) await pendingVerification(`disjoint-${i}`);

      const [left, right] = await Promise.all([
        harness.deliveries.claimDue({ limit: 50, leaseSeconds: 60 }),
        harness.deliveries.claimDue({ limit: 50, leaseSeconds: 60 }),
      ]);

      const overlap = left.filter((row) => right.some((other) => other.id === row.id));

      // `READPAST` means the second claimer SKIPS locked rows rather than
      // blocking on them, so the two sets never intersect.
      expect(overlap).toEqual([]);
    }, 60_000);
  });

  /* =======================================================================
   * Token-free notification intents
   * ===================================================================== */

  describe('durable notification intents', () => {
    it('commits the intent with the change and relays it afterwards', async () => {
      const email = freshEmail('intent');
      await harness.identity.signUp(anonymousContext(), {
        email,
        password: PROOF_PASSWORD,
        name: 'Intent Proof',
      });
      await harness.dispatch();

      const { token } = linkParameters(harness.provider.lastLinkTo(email) as string);
      await harness.identity.confirmVerification(anonymousContext(), { email, token });

      const signedIn = await harness.identity.signIn(anonymousContext(), {
        email,
        password: PROOF_PASSWORD,
      });
      if (!signedIn.ok) throw new Error('unreachable');

      const context = sessionContext(cookieHeader(signedIn.setCookies));
      const session = await harness.session.resolve(context.headers);
      if (session.state !== 'active') throw new Error('unreachable');

      await harness.identity.changePassword(context, session.session, {
        currentPassword: PROOF_PASSWORD,
        newPassword: 'another-valid-passphrase-3312',
      });

      // The intent row exists BEFORE anything is dispatched: it was committed
      // inside the transaction that made the change it describes, so a crash
      // here loses the send but never the record that one is owed
      // (ARCHITECTURE.md §3.1.2.1).
      const pending = await database.admin.query<{ status: string; purpose: string }>(
        `SELECT status, purpose FROM dbo.IdentityCommunicationIntent
         WHERE userId = '${signedIn.account.id}';`,
      );
      expect(pending[0]?.status).toBe('pending');
      expect(pending[0]?.purpose).toBe('identity.password-changed');

      await harness.dispatch();

      const relayed = await database.admin.query<{
        status: string;
        relayedAt: Date | null;
      }>(
        `SELECT status, relayedAt FROM dbo.IdentityCommunicationIntent
         WHERE userId = '${signedIn.account.id}';`,
      );
      expect(relayed[0]?.status).toBe('relayed');
      expect(relayed[0]?.relayedAt).not.toBeNull();
    }, 120_000);

    it('carries NO bearer token on a security notice', async () => {
      const rows = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total
         FROM sys.columns
         WHERE object_id = OBJECT_ID('dbo.IdentityCommunicationIntent')
           AND name IN ('token', 'otp', 'secret', 'value');`,
      );

      // The table has no column to misuse. That is a stronger guarantee than a
      // rule saying nobody will write one (ARCHITECTURE.md §4.6.1).
      expect(rows[0]?.total).toBe(0);
    });

    it('relays an intent only ONCE, however often the sweep runs', async () => {
      const before = await database.admin.query<{ total: number }>(
        "SELECT COUNT(*) AS total FROM dbo.EmailDelivery WHERE purpose = 'identity.password-changed';",
      );

      await harness.identity.relayPendingIntents(50);
      await harness.identity.relayPendingIntents(50);
      await harness.identity.relayPendingIntents(50);

      const after = await database.admin.query<{ total: number }>(
        "SELECT COUNT(*) AS total FROM dbo.EmailDelivery WHERE purpose = 'identity.password-changed';",
      );

      expect(after[0]?.total).toBe(before[0]?.total);
    });
  });

  /* =======================================================================
   * Suppression
   * ===================================================================== */

  describe('provider safety suppression', () => {
    /**
     * Suppresses an address the way the PLATFORM does — by completing a
     * provider event.
     *
     * There is no other way, deliberately. The suppression write lives inside
     * the Layer-0 operation that also marks the event processed, so the two
     * cannot separate across a crash; a separate "just suppress this" entry
     * point would be a second write path into security-relevant state with no
     * caller and no such guarantee. These proofs are about the READ semantics
     * — digesting, canonicalisation, scope — so they reach that state through
     * the same door production uses.
     */
    let suppressionEvents = 0;

    async function suppressAddress(input: {
      recipient: string;
      reason: 'bounce' | 'complaint';
      scope: 'transactional' | 'marketing';
    }): Promise<void> {
      suppressionEvents += 1;
      const eventId = `evt_suppression_${suppressionEvents}`;
      const type = input.reason === 'bounce' ? 'email.bounced' : 'email.complained';

      await harness.providerEvents.admit({ provider: 'resend', eventId, type });
      await harness.providerEvents.complete({
        provider: 'resend',
        eventId,
        effect: input,
      });
    }

    it('stops writing to an address the provider rejected', async () => {
      const email = await pendingVerification('suppressed');

      await suppressAddress({
        recipient: email,
        reason: 'bounce',
        scope: 'transactional',
      });

      const before = harness.provider.messagesTo(email).length;
      const outcome = await harness.dispatch();

      expect(outcome.suppressed).toBeGreaterThanOrEqual(1);

      // Nothing further was written to the suppressed address specifically.
      expect(harness.provider.messagesTo(email).length).toBe(before);
    });

    it('records the suppression WITHOUT the address', async () => {
      const email = freshEmail('suppression-digest');

      await suppressAddress({
        recipient: email,
        reason: 'complaint',
        scope: 'transactional',
      });

      const rows = await database.admin.query<{ recipientDigest: string }>(
        'SELECT recipientDigest FROM dbo.EmailSuppression;',
      );

      for (const row of rows) {
        expect(row.recipientDigest).not.toContain(email);
        expect(row.recipientDigest).not.toContain('@');
      }
    });

    it('matches an address however it is spelled', async () => {
      const email = freshEmail('suppression-case');

      await suppressAddress({
        recipient: email,
        reason: 'bounce',
        scope: 'transactional',
      });

      // Canonicalised before digesting, so a suppressed address cannot be
      // written to again under a different capitalisation.
      expect(
        await harness.suppression.isSuppressed({
          recipient: `  ${email.toUpperCase()} `,
          scope: 'transactional',
        }),
      ).toBe(true);
    });

    it('never lets a MARKETING suppression silence account mail', async () => {
      const email = freshEmail('suppression-scope');

      await suppressAddress({
        recipient: email,
        reason: 'complaint',
        scope: 'marketing',
      });

      // The distinction is STRUCTURAL, from the first row. A future marketing
      // unsubscribe must never stop a verification or a password reset
      // (ARCHITECTURE.md §4.6.1).
      expect(
        await harness.suppression.isSuppressed({
          recipient: email,
          scope: 'transactional',
        }),
      ).toBe(false);
      expect(
        await harness.suppression.isSuppressed({ recipient: email, scope: 'marketing' }),
      ).toBe(true);
    });
  });

  /* =======================================================================
   * The provider callback — protocol class B
   * ===================================================================== */

  describe('the Resend webhook', () => {
    const SECRET = 'whsec_c3ludGhldGljLXdlYmhvb2stc2VjcmV0LTAwMDE=';

    let verifyResendWebhook: typeof WebhookModule.verifyResendWebhook;
    let recipientFromEvent: typeof WebhookModule.recipientFromEvent;
    let recipientDigest: typeof DigestModule.recipientDigest;

    beforeAll(async () => {
      const module =
        await import('../../packages/database/src/adapters/email/webhook.ts');
      verifyResendWebhook = module.verifyResendWebhook;
      recipientFromEvent = module.recipientFromEvent;

      recipientDigest = (
        await import('../../packages/database/src/adapters/email/digest.ts')
      ).recipientDigest;
    });

    /**
     * Signs a payload the way the provider does — Standard Webhooks.
     *
     * Written out rather than produced by the SDK on purpose: a test that
     * signed with the same code that verifies would agree with any scheme at
     * all, including one that checked nothing. This constructs the signed
     * material independently, from the specification.
     */
    function sign(id: string, timestamp: number, payload: string, secret = SECRET) {
      const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
      const signature = createHmac('sha256', key)
        .update(`${id}.${timestamp}.${payload}`)
        .digest('base64');

      return {
        id,
        timestamp: String(timestamp),
        signature: `v1,${signature}`,
      };
    }

    function event(type: string, to: string): string {
      return JSON.stringify({ type, data: { to: [to], email_id: 'msg_0001' } });
    }

    it('accepts a correctly signed event', () => {
      const payload = event('email.delivered', 'someone@proof.invalid');
      const headers = sign('msg_accept', Math.floor(Date.now() / 1000), payload);

      const outcome = verifyResendWebhook({ signingSecret: SECRET }, payload, headers);

      expect(outcome.verified).toBe(true);
      if (outcome.verified) {
        expect(outcome.type).toBe('email.delivered');
        expect(outcome.eventId).toBe('msg_accept');
      }
    });

    it('REFUSES when no signing secret is configured', () => {
      const payload = event('email.delivered', 'someone@proof.invalid');
      const headers = sign('msg_unconfigured', Math.floor(Date.now() / 1000), payload);

      const outcome = verifyResendWebhook({ signingSecret: null }, payload, headers);

      // FAIL CLOSED. An endpoint that accepted events because it had nothing to
      // check them with would be an open write path into delivery state — and
      // the absence of a secret is exactly the state a misconfigured deployment
      // is in (SECURITY_BASELINE.md §7.2).
      expect(outcome.verified).toBe(false);
      if (!outcome.verified) expect(outcome.reason).toBe('not-configured');
    });

    it('rejects an event signed with the WRONG secret', () => {
      const payload = event('email.delivered', 'someone@proof.invalid');
      const headers = sign(
        'msg_wrong_secret',
        Math.floor(Date.now() / 1000),
        payload,
        'whsec_YW5vdGhlci1zZWNyZXQtZW50aXJlbHktMDAwMQ==',
      );

      const outcome = verifyResendWebhook({ signingSecret: SECRET }, payload, headers);

      expect(outcome.verified).toBe(false);
      if (!outcome.verified) expect(outcome.reason).toBe('invalid-signature');
    });

    it('rejects a TAMPERED body', () => {
      const payload = event('email.bounced', 'victim@proof.invalid');
      const headers = sign('msg_tamper', Math.floor(Date.now() / 1000), payload);

      // The attacker's goal: suppress somebody else's mail by rewriting the
      // recipient on an event they intercepted. The signature covers the bytes.
      const tampered = event('email.bounced', 'someone-else@proof.invalid');

      const outcome = verifyResendWebhook({ signingSecret: SECRET }, tampered, headers);

      expect(outcome.verified).toBe(false);
      if (!outcome.verified) expect(outcome.reason).toBe('invalid-signature');
    });

    it('rejects a STALE timestamp', () => {
      const payload = event('email.delivered', 'someone@proof.invalid');
      const stale = Math.floor(Date.now() / 1000) - 60 * 60 * 24;
      const headers = sign('msg_stale', stale, payload);

      // A captured event replayed days later is refused by the timestamp
      // window, before the de-duplication table is ever consulted.
      const outcome = verifyResendWebhook({ signingSecret: SECRET }, payload, headers);

      expect(outcome.verified).toBe(false);
      if (!outcome.verified) expect(outcome.reason).toBe('invalid-signature');
    });

    it('rejects a request with the signature headers missing', () => {
      const payload = event('email.delivered', 'someone@proof.invalid');

      const outcome = verifyResendWebhook({ signingSecret: SECRET }, payload, {
        id: null,
        timestamp: null,
        signature: null,
      });

      expect(outcome.verified).toBe(false);
      if (!outcome.verified) expect(outcome.reason).toBe('missing-headers');
    });

    it('rejects a payload with no event type', () => {
      const payload = JSON.stringify({ data: { to: ['someone@proof.invalid'] } });
      const headers = sign('msg_typeless', Math.floor(Date.now() / 1000), payload);

      const outcome = verifyResendWebhook({ signingSecret: SECRET }, payload, headers);

      expect(outcome.verified).toBe(false);
      if (!outcome.verified) expect(outcome.reason).toBe('malformed-event');
    });

    it('processes an event exactly ONCE, so a replay has no second effect', async () => {
      const first = await harness.providerEvents.admit({
        provider: 'resend',
        eventId: 'msg_replay_0001',
        type: 'email.bounced',
      });
      await harness.providerEvents.complete({
        provider: 'resend',
        eventId: 'msg_replay_0001',
        effect: null,
      });

      const replay = await harness.providerEvents.admit({
        provider: 'resend',
        eventId: 'msg_replay_0001',
        type: 'email.bounced',
      });

      expect(first).toBe('process');
      expect(replay).toBe('already-processed');
    });

    it('re-admits an event recorded by an attempt that never FINISHED', async () => {
      // THE defect this state machine exists for. Recording the event and
      // completing it are separate moments, and a process can die between
      // them. Treating "seen" as "done" answered the provider's retry with
      // success and dropped the effect permanently.
      const first = await harness.providerEvents.admit({
        provider: 'resend',
        eventId: 'msg_incomplete_0001',
        type: 'email.bounced',
      });

      // No `complete` — exactly as if the process had died here.
      const retry = await harness.providerEvents.admit({
        provider: 'resend',
        eventId: 'msg_incomplete_0001',
        type: 'email.bounced',
      });

      expect(first).toBe('process');
      expect(retry).toBe('process');
    });

    it('produces ONE logical effect for a CONCURRENT double delivery', async () => {
      const recipient = 'concurrent-bounce@proof.invalid';

      // Six deliveries of one event, handled in full and all at once — the
      // shape a provider produces when it retries before its first attempt has
      // been answered.
      await Promise.all(
        Array.from({ length: 6 }, async () => {
          const admission = await harness.providerEvents.admit({
            provider: 'resend',
            eventId: 'msg_concurrent_0001',
            type: 'email.complained',
          });

          if (admission === 'already-processed') return;

          await harness.providerEvents.complete({
            provider: 'resend',
            eventId: 'msg_concurrent_0001',
            effect: { recipient, reason: 'complaint', scope: 'transactional' },
          });
        }),
      );

      const digest = recipientDigest(recipient, {
        key: PROOF_SECRETS.digestKey,
        keyVersion: PROOF_SECRETS.digestKeyVersion,
      });

      // ONE suppression row, and one event row. Not "one admission won" —
      // the effect is idempotent, so the guarantee holds however the six
      // interleaved.
      const suppressions = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.EmailSuppression
         WHERE recipientDigest = '${digest}';`,
      );
      const events = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.ProviderEvent
         WHERE eventId = 'msg_concurrent_0001';`,
      );

      expect(Number(suppressions[0]?.total)).toBe(1);
      expect(Number(events[0]?.total)).toBe(1);
    }, 60_000);

    it('keeps events from different providers apart', async () => {
      expect(
        await harness.providerEvents.admit({
          provider: 'resend',
          eventId: 'shared_id_0001',
          type: 'email.delivered',
        }),
      ).toBe('process');

      expect(
        await harness.providerEvents.admit({
          provider: 'another-provider',
          eventId: 'shared_id_0001',
          type: 'email.delivered',
        }),
      ).toBe('process');
    });

    it('applies the suppression and the completion ATOMICALLY', async () => {
      const recipient = 'atomic-bounce@proof.invalid';

      await harness.providerEvents.admit({
        provider: 'resend',
        eventId: 'msg_atomic_0001',
        type: 'email.bounced',
      });
      await harness.providerEvents.complete({
        provider: 'resend',
        eventId: 'msg_atomic_0001',
        effect: { recipient, reason: 'bounce', scope: 'transactional' },
      });

      // Both halves, or neither. A completion recorded without its effect is
      // the state that makes a replay skip work that never happened.
      expect(
        await harness.suppression.isSuppressed({ recipient, scope: 'transactional' }),
      ).toBe(true);

      const rows = await database.admin.query<{ processedAt: Date | null }>(
        `SELECT processedAt FROM dbo.ProviderEvent WHERE eventId = 'msg_atomic_0001';`,
      );
      expect(rows[0]?.processedAt).not.toBeNull();
    });

    it('rolls the completion BACK when the effect cannot be applied', async () => {
      await harness.providerEvents.admit({
        provider: 'resend',
        eventId: 'msg_rollback_0001',
        type: 'email.bounced',
      });

      // A scope longer than the column accepts makes the suppression INSERT
      // fail INSIDE the transaction. Cast through `unknown` deliberately: the
      // type exists precisely to stop this value reaching the database, which
      // is what makes it a reliable way to fail the one statement under test.
      // What matters is what the rollback leaves behind.
      const oversizedScope = 'x'.repeat(64) as unknown as SuppressionScope;

      await expect(
        harness.providerEvents.complete({
          provider: 'resend',
          eventId: 'msg_rollback_0001',
          effect: {
            recipient: 'x@proof.invalid',
            reason: 'bounce',
            scope: oversizedScope,
          },
        }),
      ).rejects.toThrow();

      const rows = await database.admin.query<{ processedAt: Date | null }>(
        `SELECT processedAt FROM dbo.ProviderEvent WHERE eventId = 'msg_rollback_0001';`,
      );

      // NOT processed. The event stays admissible, so the provider's retry —
      // or the next delivery of it — still does the work.
      expect(rows[0]?.processedAt).toBeNull();

      expect(
        await harness.providerEvents.admit({
          provider: 'resend',
          eventId: 'msg_rollback_0001',
          type: 'email.bounced',
        }),
      ).toBe('process');
    });

    it('is idempotent when the same suppression completes twice', async () => {
      const recipient = 'twice-bounce@proof.invalid';

      for (const eventId of ['msg_twice_0001', 'msg_twice_0002']) {
        await harness.providerEvents.admit({
          provider: 'resend',
          eventId,
          type: 'email.bounced',
        });
        await harness.providerEvents.complete({
          provider: 'resend',
          eventId,
          effect: { recipient, reason: 'bounce', scope: 'transactional' },
        });
      }

      const digest = recipientDigest(recipient, {
        key: PROOF_SECRETS.digestKey,
        keyVersion: PROOF_SECRETS.digestKeyVersion,
      });

      // Two distinct events naming one address suppress it once. The runtime
      // holds no UPDATE on this table, so a second row is the only way this
      // could go wrong — and there is not one.
      const rows = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.EmailSuppression
         WHERE recipientDigest = '${digest}';`,
      );
      expect(Number(rows[0]?.total)).toBe(1);
    });

    it('stores no arbitrary provider payload', async () => {
      const columns = await database.admin.query<{ name: string }>(
        `SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('dbo.ProviderEvent');`,
      );

      // Only identifiers and timing. A raw-payload column would be an
      // unbounded, unreviewed write path from an external service into this
      // platform's storage (SECURITY_BASELINE.md §7.2).
      expect([...columns.map((row) => row.name)].sort()).toEqual([
        'eventId',
        'id',
        'processedAt',
        'provider',
        'receivedAt',
        'type',
      ]);
    });

    it('reads only the recipient out of a delivery event', () => {
      expect(recipientFromEvent(event('email.bounced', 'bounced@proof.invalid'))).toBe(
        'bounced@proof.invalid',
      );
      expect(recipientFromEvent('not json at all')).toBeNull();
      expect(recipientFromEvent(JSON.stringify({ type: 'email.bounced' }))).toBeNull();
    });
  });

  /* =======================================================================
   * Message content
   * ===================================================================== */

  describe('message content', () => {
    it('renders in the ACCOUNT locale, right-to-left where that applies', async () => {
      const { renderMessage } =
        await import('../../apps/web/src/contexts/identity-access/application/messages.ts');

      for (const [locale, direction] of [
        ['en', 'ltr'],
        ['ur', 'rtl'],
        ['ar', 'rtl'],
      ] as const) {
        const message = renderMessage({
          purpose: 'identity.email-verification',
          locale,
          recipient: 'someone@proof.invalid',
          actionUrl: 'https://example.invalid/en/verify-email?token=abc',
        });

        expect(message.html).toContain(`lang="${locale}"`);
        expect(message.html).toContain(`dir="${direction}"`);
        expect(message.subject.length).toBeGreaterThan(0);
        expect(message.text.length).toBeGreaterThan(0);
      }
    });

    it('escapes the action URL rather than interpolating it raw', async () => {
      const { renderMessage } =
        await import('../../apps/web/src/contexts/identity-access/application/messages.ts');

      const message = renderMessage({
        purpose: 'identity.password-reset',
        locale: 'en',
        recipient: 'someone@proof.invalid',
        actionUrl: 'https://example.invalid/x?a="><script>alert(1)</script>',
      });

      expect(message.html).not.toContain('<script>');
      expect(message.html).toContain('&lt;script&gt;');
    });

    it('authors every purpose in every interface locale', async () => {
      const { MESSAGE_LOCALES, MESSAGE_PURPOSES, renderMessage } =
        await import('../../apps/web/src/contexts/identity-access/application/messages.ts');

      expect([...MESSAGE_LOCALES]).toEqual(['en', 'ur', 'ar']);
      expect(MESSAGE_PURPOSES.length).toBeGreaterThan(0);

      // A purpose with a missing translation would throw at send time — in the
      // dispatcher, on somebody's password reset, in production.
      for (const purpose of MESSAGE_PURPOSES) {
        for (const locale of MESSAGE_LOCALES) {
          const message = renderMessage({
            purpose,
            locale,
            recipient: 'someone@proof.invalid',
          });

          expect(message.subject.trim().length, `${purpose}/${locale}`).toBeGreaterThan(
            0,
          );
        }
      }
    });
  });
});
