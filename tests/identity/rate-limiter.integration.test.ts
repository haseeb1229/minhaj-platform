import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type {
  RateLimiterPort,
  RateLimitRule,
} from '../../packages/contracts/src/platform/index.ts';

import {
  createProofDatabase,
  databaseConfigured,
  PROOF_SECRETS,
  type DisposableDatabase,
} from './harness.ts';

/**
 * THE rate limiter, proved against real SQL Server.
 *
 * SECURITY_BASELINE.md §15.1 requires a SHARED strategy where a
 * security-critical flow needs cross-instance consistency, and §15.2 names the
 * flows. Two properties carry the whole control and neither can be proved from
 * types:
 *
 *   1. **Check and increment are ONE step.** N simultaneous requests must not
 *      all read a stale count before any increment lands — the failure mode is
 *      a limit of five becoming a limit of "however many arrive together",
 *      which is exactly the shape of a credential-stuffing burst.
 *   2. **No raw subject is stored.** The subjects are email addresses and
 *      client IPs, and a limiter table is precisely the sort of place nobody
 *      thinks to look for personal data (§19.2).
 *
 * Both are asserted against the real engine, because both are properties of
 * how SQL Server behaves under concurrency rather than of the code's shape.
 */

let database: DisposableDatabase;
let limiter: RateLimiterPort;
let rateLimitKey: (input: {
  purpose: string;
  subject: string;
  configuration: { digestKey: string; digestKeyVersion: number };
}) => string;
let sameKey: (left: string, right: string) => boolean;

const CONFIGURATION = {
  digestKey: PROOF_SECRETS.digestKey,
  digestKeyVersion: PROOF_SECRETS.digestKeyVersion,
};

describe.skipIf(!databaseConfigured)('Phase 2 — the SQL rate limiter', () => {
  beforeAll(async () => {
    database = await createProofDatabase();

    const module =
      await import('../../packages/database/src/adapters/rate-limiting/index.ts');

    limiter = module.createRateLimiter(CONFIGURATION);
    rateLimitKey = module.rateLimitKey;
    sameKey = module.sameKey;
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  }, 120_000);

  function key(purpose: string, subject: string): string {
    return rateLimitKey({ purpose, subject, configuration: CONFIGURATION });
  }

  /* =======================================================================
   * Subject privacy
   * ===================================================================== */

  describe('subject derivation', () => {
    it('is stable for the same purpose and subject', () => {
      const first = key('sign-in', 'someone@proof.invalid');
      const second = key('sign-in', 'someone@proof.invalid');

      // Compared in constant time. The equality of two derived subjects is
      // itself information an attacker probing for a known account would use.
      expect(sameKey(first, second)).toBe(true);
    });

    it('is PURPOSE-SCOPED, so one flow cannot spend another budget', () => {
      const signIn = key('sign-in', 'someone@proof.invalid');
      const reset = key('password-reset-request', 'someone@proof.invalid');

      expect(signIn).not.toBe(reset);
    });

    it('cannot be confused by a separator in the purpose', () => {
      // Length-prefixed, so `purpose="a:b", subject="c"` and
      // `purpose="a", subject="b:c"` cannot hash to the same value — which
      // would let one flow spend another flow's budget.
      expect(key('a:b', 'c')).not.toBe(key('a', 'b:c'));
    });

    it('changes entirely when the key version changes', () => {
      const rotated = rateLimitKey({
        purpose: 'sign-in',
        subject: 'someone@proof.invalid',
        configuration: {
          digestKey: 'a-different-key-entirely-0000',
          digestKeyVersion: 2,
        },
      });

      expect(rotated).not.toBe(key('sign-in', 'someone@proof.invalid'));
    });

    it('stores NO raw subject anywhere in the table', async () => {
      const subject = 'raw-subject-probe@proof.invalid';
      const clientIp = '203.0.113.77';

      await limiter.consume(key('sign-in', subject), { window: 60, max: 5 });
      await limiter.consume(key('sign-in:client', clientIp), { window: 60, max: 5 });

      const rows = await database.admin.query<{ key: string }>(
        'SELECT [key] FROM dbo.RateLimitCounter;',
      );

      expect(rows.length).toBeGreaterThanOrEqual(2);

      // THE assertion that matters. Not "the code does not write it" — the
      // TABLE does not contain it, in any row, under any column.
      const stored = rows.map((row) => row.key).join('\n');

      expect(stored).not.toContain(subject);
      expect(stored).not.toContain('raw-subject-probe');
      expect(stored).not.toContain(clientIp);
      expect(stored).not.toContain('@proof.invalid');
    });

    it('records the key version alongside every counter', async () => {
      await limiter.consume(key('versioned', 'v@proof.invalid'), { window: 60, max: 5 });

      const rows = await database.admin.query<{ keyVersion: number }>(
        `SELECT keyVersion FROM dbo.RateLimitCounter WHERE [key] = '${key('versioned', 'v@proof.invalid')}';`,
      );

      expect(rows[0]?.keyVersion).toBe(CONFIGURATION.digestKeyVersion);
    });
  });

  /* =======================================================================
   * Counting
   * ===================================================================== */

  describe('windows', () => {
    const rule: RateLimitRule = { window: 300, max: 3 };

    it('permits exactly the budget and then refuses', async () => {
      const subject = key('budget', 'budget@proof.invalid');

      expect((await limiter.consume(subject, rule)).allowed).toBe(true);
      expect((await limiter.consume(subject, rule)).allowed).toBe(true);
      expect((await limiter.consume(subject, rule)).allowed).toBe(true);

      const refused = await limiter.consume(subject, rule);
      expect(refused.allowed).toBe(false);
      expect(refused.retryAfter).toBeGreaterThan(0);
      expect(refused.retryAfter).toBeLessThanOrEqual(rule.window);
    });

    it('does NOT extend the window on refusal', async () => {
      const subject = key('no-extend', 'extend@proof.invalid');

      for (let i = 0; i < rule.max; i += 1) await limiter.consume(subject, rule);

      const before = await database.admin.query<{ windowExpiresAt: Date }>(
        `SELECT windowExpiresAt FROM dbo.RateLimitCounter WHERE [key] = '${subject}';`,
      );

      await limiter.consume(subject, rule);
      await limiter.consume(subject, rule);

      const after = await database.admin.query<{ windowExpiresAt: Date }>(
        `SELECT windowExpiresAt FROM dbo.RateLimitCounter WHERE [key] = '${subject}';`,
      );

      // Extending on refusal would let a caller keep ITSELF locked out
      // indefinitely by retrying — a self-inflicted denial of service that
      // looks exactly like the limiter working.
      expect(after[0]?.windowExpiresAt.getTime()).toBe(
        before[0]?.windowExpiresAt.getTime(),
      );
    });

    it('does not increment the stored count once refusing', async () => {
      const subject = key('no-inflate', 'inflate@proof.invalid');

      for (let i = 0; i < rule.max + 5; i += 1) await limiter.consume(subject, rule);

      const rows = await database.admin.query<{ count: number }>(
        `SELECT [count] FROM dbo.RateLimitCounter WHERE [key] = '${subject}';`,
      );

      expect(rows[0]?.count).toBe(rule.max);
    });

    it('starts a fresh window once the previous one has expired', async () => {
      const subject = key('expiry', 'expiry@proof.invalid');
      const short: RateLimitRule = { window: 1, max: 1 };

      expect((await limiter.consume(subject, short)).allowed).toBe(true);
      expect((await limiter.consume(subject, short)).allowed).toBe(false);

      // The window is aged out in the DATABASE rather than by sleeping. A test
      // that waited on a wall clock would be slow and, worse, flaky on a busy
      // machine — and the property under test is "an expired window restarts",
      // not "time passes".
      await database.admin.query(
        `UPDATE dbo.RateLimitCounter
         SET windowExpiresAt = DATEADD(second, -10, SYSUTCDATETIME())
         WHERE [key] = '${subject}';`,
      );

      const renewed = await limiter.consume(subject, short);
      expect(renewed.allowed).toBe(true);

      const rows = await database.admin.query<{ count: number }>(
        `SELECT [count] FROM dbo.RateLimitCounter WHERE [key] = '${subject}';`,
      );
      expect(rows[0]?.count).toBe(1);
    });

    it('keeps separate subjects independent', async () => {
      const one = key('independent', 'one@proof.invalid');
      const two = key('independent', 'two@proof.invalid');
      const strict: RateLimitRule = { window: 300, max: 1 };

      expect((await limiter.consume(one, strict)).allowed).toBe(true);
      expect((await limiter.consume(one, strict)).allowed).toBe(false);

      // One person exhausting their budget must not lock out anyone else.
      expect((await limiter.consume(two, strict)).allowed).toBe(true);
    });
  });

  /* =======================================================================
   * Concurrency — the property the whole control rests on
   * ===================================================================== */

  describe('concurrency', () => {
    it('admits exactly the budget when the whole burst arrives at once', async () => {
      const subject = key('burst', 'burst@proof.invalid');
      const rule: RateLimitRule = { window: 300, max: 5 };

      // THE test. Twenty simultaneous consumptions against a budget of five.
      //
      // A read-then-write limiter passes every sequential test above and fails
      // this one, because all twenty read a count of zero before any write
      // lands. That is not a hypothetical: it is what a sign-in flood looks
      // like, and it is the reason the implementation holds an update lock for
      // the duration of a short SERIALIZABLE transaction rather than doing the
      // obvious thing.
      const outcomes = await Promise.all(
        Array.from({ length: 20 }, async () => limiter.consume(subject, rule)),
      );

      const allowed = outcomes.filter((outcome) => outcome.allowed).length;

      expect(allowed).toBe(rule.max);
      expect(outcomes.length - allowed).toBe(20 - rule.max);

      const rows = await database.admin.query<{ count: number }>(
        `SELECT [count] FROM dbo.RateLimitCounter WHERE [key] = '${subject}';`,
      );
      expect(rows[0]?.count).toBe(rule.max);
    }, 120_000);

    it('creates exactly ONE row when a burst races to create it', async () => {
      const subject = key('insert-race', 'race@proof.invalid');
      const rule: RateLimitRule = { window: 300, max: 50 };

      await Promise.all(
        Array.from({ length: 12 }, async () => limiter.consume(subject, rule)),
      );

      const rows = await database.admin.query<{ total: number }>(
        `SELECT COUNT(*) AS total FROM dbo.RateLimitCounter WHERE [key] = '${subject}';`,
      );

      // The primary key makes a duplicate impossible; what is proved here is
      // that the LOSER of the insert race retries rather than failing a
      // request that was within its budget.
      expect(rows[0]?.total).toBe(1);
    }, 120_000);
  });

  /* =======================================================================
   * Cleanup
   * ===================================================================== */

  describe('cleanup', () => {
    it('removes expired windows and leaves live ones alone', async () => {
      const dead = key('purge-dead', 'dead@proof.invalid');
      const live = key('purge-live', 'live@proof.invalid');

      await limiter.consume(dead, { window: 300, max: 5 });
      await limiter.consume(live, { window: 300, max: 5 });

      await database.admin.query(
        `UPDATE dbo.RateLimitCounter
         SET windowExpiresAt = DATEADD(second, -10, SYSUTCDATETIME())
         WHERE [key] = '${dead}';`,
      );

      const removed = await limiter.purgeExpired(1_000);
      expect(removed).toBeGreaterThanOrEqual(1);

      const survivors = await database.admin.query<{ key: string }>(
        `SELECT [key] FROM dbo.RateLimitCounter WHERE [key] IN ('${dead}', '${live}');`,
      );

      expect(survivors.map((row) => row.key)).toEqual([live]);
    });

    it('is BOUNDED, so cleanup cannot lock the table it sweeps', async () => {
      // An unbounded DELETE over a table every authentication request touches
      // is a lock-contention incident waiting for its first busy day
      // (ARCHITECTURE.md §13.9). The bound is asserted by asking for one.
      for (let i = 0; i < 4; i += 1) {
        await limiter.consume(key('bounded', `b${i}@proof.invalid`), {
          window: 300,
          max: 5,
        });
      }

      await database.admin.query(
        `UPDATE dbo.RateLimitCounter
         SET windowExpiresAt = DATEADD(second, -10, SYSUTCDATETIME())
         WHERE [key] LIKE '%bounded%';`,
      );

      expect(await limiter.purgeExpired(1)).toBe(1);
    });
  });
});
