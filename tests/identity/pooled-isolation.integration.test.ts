import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  failureLabel,
  isTransientDatabaseFailure,
} from '../../apps/web/src/composition/failure-label.ts';
import type {
  EmailDeliveryStorePort,
  RateLimiterPort,
} from '../../packages/contracts/src/platform/index.ts';

import {
  createProofDatabase,
  databaseConfigured,
  PROOF_SECRETS,
  type DisposableDatabase,
} from './harness.ts';

/**
 * POOLED SESSION ISOLATION — the defect this suite exists for.
 *
 * `claimDue` leases due deliveries with `WITH (READPAST, UPDLOCK, ROWLOCK)`.
 * `READPAST` is legal ONLY under READ COMMITTED or REPEATABLE READ; under
 * anything else SQL Server raises error 650 and refuses the statement.
 *
 * The rate limiter runs a short strict-locking transaction against the SAME
 * connection pool, and it used to ask Prisma for a `SERIALIZABLE` isolation
 * level. T-SQL scopes `SET TRANSACTION ISOLATION LEVEL` to the SESSION rather
 * than to the transaction that set it, so the level SURVIVED the commit and
 * travelled back into the pool on that connection. Whatever picked the
 * connection up next inherited it — and when that was a claim, the claim died
 * of error 650, surfaced as an opaque `P2010`, in proportion to how busy the
 * limiter had been.
 *
 * Both halves are proved here because either alone would leave the platform
 * one careless transaction away from the same class of defect:
 *
 *   1. the limiter no longer leaves a stricter level behind on the pool;
 *   2. the claim states the level it needs, so it is correct even on a
 *      connection somebody else configured.
 *
 * These are properties of how SQL Server and the pool behave together. None of
 * them can be proved from the shape of the code, which is exactly why the
 * original defect survived review and reached a browser run.
 */

let database: DisposableDatabase;
let limiter: RateLimiterPort;
let deliveries: EmailDeliveryStorePort;

/** SQL Server's code for `transaction_isolation_level`. */
const READ_COMMITTED = 2;
const SERIALIZABLE = 4;

function enqueueOne(index: number) {
  return deliveries.enqueue({
    purpose: 'identity.email-verification',
    recipient: `claim-probe-${index}@proof.invalid`,
    sourceReference: `identity:token:email-verification:claim-probe-${index}@proof.invalid`,
    idempotencyKey: `claim-probe-${index}`,
  });
}

describe.skipIf(!databaseConfigured)('Phase 2 — pooled session isolation', () => {
  beforeAll(async () => {
    database = await createProofDatabase();

    const rateLimiting =
      await import('../../packages/database/src/adapters/rate-limiting/index.ts');
    const email = await import('../../packages/database/src/adapters/email/delivery.ts');

    limiter = rateLimiting.createRateLimiter({
      digestKey: PROOF_SECRETS.digestKey,
      digestKeyVersion: PROOF_SECRETS.digestKeyVersion,
    });
    deliveries = email.createEmailDeliveryStore({
      digest: {
        key: PROOF_SECRETS.digestKey,
        keyVersion: PROOF_SECRETS.digestKeyVersion,
      },
    });
  }, 180_000);

  afterAll(async () => {
    await database?.close();
  }, 120_000);

  /**
   * Every session the application pool currently holds against this database,
   * with the isolation level it is sitting at.
   *
   * Read through the privileged inspection session, which is a DIFFERENT
   * connection — so it observes the pool from outside rather than reporting on
   * itself. `@@SPID` is excluded for the same reason.
   */
  async function pooledIsolationLevels(): Promise<number[]> {
    const rows = await database.admin.query<{ level: number }>(
      `SELECT transaction_isolation_level AS level
       FROM sys.dm_exec_sessions
       WHERE database_id = DB_ID() AND session_id <> @@SPID AND is_user_process = 1;`,
    );
    return rows.map((row) => Number(row.level));
  }

  /* =======================================================================
   * The leak itself
   * ===================================================================== */

  describe('the limiter', () => {
    it('leaves NO connection at a stricter level than it found it', async () => {
      // Spread across the pool: distinct keys, issued together, so more than
      // one connection serves the limiter rather than one being reused.
      await Promise.all(
        Array.from({ length: 16 }, async (_, index) =>
          limiter.consume(`isolation-leak-${index}`, { window: 60, max: 100 }),
        ),
      );

      const levels = await pooledIsolationLevels();

      // THE assertion. Not "the code passes no isolationLevel" — the live
      // sessions the pool is holding, after the limiter has finished with
      // them, are not sitting at SERIALIZABLE.
      expect(levels.length).toBeGreaterThan(0);
      expect(levels).not.toContain(SERIALIZABLE);
      for (const level of levels) expect(level).toBe(READ_COMMITTED);
    });

    it('still admits exactly the budget once it no longer sets the level', async () => {
      // The locking guarantee must survive the change, or the fix traded a
      // delivery defect for an authentication one. `UPDLOCK, HOLDLOCK` is
      // statement-scoped and `HOLDLOCK` IS the SERIALIZABLE hint, so the
      // window below is locked exactly as before.
      const outcomes = await Promise.all(
        Array.from({ length: 20 }, async () =>
          limiter.consume('isolation-burst', { window: 300, max: 5 }),
        ),
      );

      expect(outcomes.filter((outcome) => outcome.allowed).length).toBe(5);
    }, 120_000);
  });

  /* =======================================================================
   * The claim, on a pool the limiter has been using
   * ===================================================================== */

  describe('claiming', () => {
    it('succeeds on a connection left at SERIALIZABLE by someone else', async () => {
      // The ORIGINAL reproduction. Before the fix this threw
      // `PrismaClientKnownRequestError` / `P2010`, wrapping SQL Server 650:
      // "You can only specify the READPAST lock in the READ COMMITTED or
      // REPEATABLE READ isolation levels."
      //
      // Serialised deliberately — sequential calls reuse one pooled
      // connection, which is the arrangement that made the leak reachable.
      await enqueueOne(1);

      for (let index = 0; index < 24; index += 1) {
        await limiter.consume(`claim-after-limiter-${index}`, { window: 60, max: 100 });
      }

      const claimed = await deliveries.claimDue({ limit: 10, leaseSeconds: 60 });

      expect(claimed.map((record) => record.idempotencyKey)).toContain('claim-probe-1');
    }, 120_000);

    it('survives limiter traffic and claims interleaved under concurrency', async () => {
      for (let index = 10; index < 20; index += 1) await enqueueOne(index);

      // Limiter work and claims racing across the whole pool at once — the
      // shape a real sign-in burst produces alongside a dispatch tick.
      const work = [
        ...Array.from({ length: 12 }, async (_, index) =>
          limiter.consume(`interleaved-${index}`, { window: 60, max: 100 }),
        ),
        ...Array.from({ length: 6 }, async () =>
          deliveries.claimDue({ limit: 5, leaseSeconds: 60 }),
        ),
      ];

      // No rejection at all. A single error 650 anywhere in this fails here.
      const settled = await Promise.allSettled(work);
      const rejected = settled.filter((result) => result.status === 'rejected');

      expect(rejected.map((result) => failureLabel(result.reason))).toEqual([]);
    }, 120_000);

    it('never hands the same delivery to two concurrent claimants', async () => {
      for (let index = 100; index < 112; index += 1) await enqueueOne(index);

      const batches = await Promise.all(
        Array.from({ length: 4 }, async () =>
          deliveries.claimDue({ limit: 20, leaseSeconds: 120 }),
        ),
      );

      const claimed = batches.flatMap((batch) =>
        batch.map((record) => record.idempotencyKey),
      );

      // DISJOINT. The lease is the whole mechanism that lets two dispatchers
      // run without coordination, and a duplicate here is a duplicate message
      // to a real person.
      expect(new Set(claimed).size).toBe(claimed.length);
    }, 120_000);

    it('does not mark anything sent when the claim itself fails', async () => {
      await enqueueOne(200);

      // A claim that cannot run must leave the work exactly as it found it:
      // still owed, still claimable, and above all not recorded as delivered.
      // `limit` is bounded rather than rejected, so the failure is forced with
      // a lease the engine cannot represent.
      await expect(
        deliveries.claimDue({ limit: 5, leaseSeconds: Number.MAX_SAFE_INTEGER }),
      ).rejects.toThrow();

      const rows = await database.admin.query<{ status: string }>(
        `SELECT [status] FROM dbo.EmailDelivery WHERE idempotencyKey = 'claim-probe-200';`,
      );

      expect(rows[0]?.status).not.toBe('sent');

      // And it is still there to be picked up.
      const claimed = await deliveries.claimDue({ limit: 20, leaseSeconds: 60 });
      expect(claimed.map((record) => record.idempotencyKey)).toContain('claim-probe-200');
    }, 120_000);
  });

  /* =======================================================================
   * What an operator is told
   * ===================================================================== */

  describe('failure labelling', () => {
    /** A Prisma driver-adapter error, shaped exactly as the real one arrives. */
    function driverError(code: number): Error {
      const error = new Error('Raw query failed.');
      error.name = 'PrismaClientKnownRequestError';
      Object.assign(error, {
        code: 'P2010',
        meta: {
          driverAdapterError: {
            name: 'DriverAdapterError',
            cause: {
              kind: 'mssql',
              code,
              // Present in the real error, and deliberately NOT surfaced.
              message: 'You can only specify the READPAST lock in ...',
              originalMessage: 'recipient=someone@example.test',
            },
          },
        },
      });
      return error;
    }

    it('carries the database native code, not just P2010', () => {
      // The whole point. `P2010` alone described a permanent, invalid
      // statement in exactly the words it would use for a busy moment.
      expect(failureLabel(driverError(650))).toBe(
        'PrismaClientKnownRequestError:P2010/mssql:650',
      );
    });

    it('discloses no message, payload or parameter', () => {
      const label = failureLabel(driverError(650));

      expect(label).not.toContain('someone@example.test');
      expect(label).not.toContain('READPAST');
      expect(label).not.toContain('recipient');
    });

    it('does NOT treat an illegal statement as ordinary contention', () => {
      // 650 will recur identically on every retry for as long as the defect
      // exists. Reporting it as contention is how it went unnoticed.
      expect(isTransientDatabaseFailure(driverError(650))).toBe(false);
      expect(isTransientDatabaseFailure(driverError(208))).toBe(false);
      expect(isTransientDatabaseFailure(driverError(2627))).toBe(false);
    });

    it('does recognise genuine contention', () => {
      expect(isTransientDatabaseFailure(driverError(1205))).toBe(true);
      expect(isTransientDatabaseFailure(driverError(1222))).toBe(true);
    });

    it('never throws while labelling, whatever it is handed', () => {
      // It runs inside a catch block: a labeller that throws destroys the only
      // record of the original failure.
      expect(failureLabel(null)).toBe('unknown');
      expect(failureLabel(undefined)).toBe('unknown');
      expect(failureLabel('a string')).toBe('unknown');
      expect(failureLabel({ meta: null })).toBe('unknown');
      expect(failureLabel(new Error('plain'))).toBe('Error');
      expect(isTransientDatabaseFailure(null)).toBe(false);
      expect(isTransientDatabaseFailure({ meta: { driverAdapterError: 7 } })).toBe(false);
    });
  });
});
