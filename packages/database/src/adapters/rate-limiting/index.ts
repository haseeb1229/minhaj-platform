import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  RateLimitDecision,
  RateLimitRule,
  RateLimiterPort,
} from '@minhaj/contracts/platform';
import { Prisma } from '@prisma/client';

import { getDatabaseClient } from '../../client.ts';

/**
 * THE platform rate limiter, backed by SQL Server.
 *
 * Semantic owner: the Layer-0 `rate-limiting` concern, declared in this
 * package's manifest. It is infrastructure, not a bounded context, and it
 * depends on none (DOMAIN_MODEL.md §1.1).
 *
 * ONE LIMITER, TWO CALLERS. Better Auth reaches this through its
 * `customStorage.consume(key, rule)` contract and the application's own
 * mutations reach it directly, so there is never a second limiter that could
 * disagree with this one (ARCHITECTURE.md §4.5).
 *
 * WHY SQL RATHER THAN MEMORY. Authentication is a security-critical flow, and
 * SECURITY_BASELINE.md §15.1 requires a shared strategy "where a security-
 * critical flow needs cross-instance consistency". An in-process counter is
 * per-instance, so a limit of five becomes five-per-instance the day a second
 * instance exists — and that is not a change anybody would notice. SQL Server
 * already exists; this adds no infrastructure. **Redis is not introduced.**
 */

/** How long a limiter key may be. Matches `RateLimitCounter.key`. */
const MAX_KEY_LENGTH = 200;

export interface RateLimiterConfiguration {
  /**
   * HMAC key for deriving subject identifiers.
   *
   * Subjects are email addresses and IP addresses. Storing either in clear
   * would put personal data in an infrastructure table that exists only to
   * count requests (SECURITY_BASELINE.md §19.2), and a limiter table is
   * exactly the sort of place nobody thinks to check.
   */
  readonly digestKey: string;
  /** Rotating the key changes every derived subject, so the version travels. */
  readonly digestKeyVersion: number;
}

/**
 * Derives the stored key for a subject.
 *
 * Purpose-scoped AND key-versioned. Purpose scoping means a sign-in budget
 * cannot be spent by a password-reset attempt; versioning means a rotated key
 * starts fresh windows rather than colliding with old ones.
 */
export function rateLimitKey(input: {
  readonly purpose: string;
  readonly subject: string;
  readonly configuration: RateLimiterConfiguration;
}): string {
  const digest = createHmac('sha256', input.configuration.digestKey)
    // LENGTH-PREFIXED, so the two parts cannot be confused for one another.
    // A plain separator would let `purpose="a:b", subject="c"` and
    // `purpose="a", subject="b:c"` hash identically, which would let one
    // flow spend another's budget.
    .update(`${input.purpose.length}:${input.purpose}:${input.subject}`)
    .digest('base64url');

  const key = `v${input.configuration.digestKeyVersion}:${input.purpose}:${digest}`;
  return key.length > MAX_KEY_LENGTH ? key.slice(0, MAX_KEY_LENGTH) : key;
}

/** Constant-time comparison, for tests that assert derivation is stable. */
export function sameKey(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function secondsUntil(expiry: Date, now: Date): number {
  return Math.max(1, Math.ceil((expiry.getTime() - now.getTime()) / 1000));
}

/**
 * Builds the limiter.
 *
 * CONCURRENCY. `consume` must check and increment in ONE step: N simultaneous
 * requests must not all read a stale count before any increment lands. The
 * shape below is a short transaction holding an update lock on the row for its
 * duration —
 *
 *   1. `SELECT ... WITH (UPDLOCK, HOLDLOCK)` takes the lock, and because
 *      `HOLDLOCK` IS the `SERIALIZABLE` hint it also takes a RANGE lock on the
 *      absent key, so a second transaction cannot insert the same key
 *      underneath this one;
 *   2. an expired or absent window is (re)started by INSERT or UPDATE;
 *   3. a live window is incremented conditionally.
 *
 * `MERGE` is deliberately not used. It has a long history of concurrency and
 * correctness defects under exactly this pattern, and the conditional
 * update-then-insert above is both explicit and auditable.
 *
 * A unique-key violation is still handled: two transactions can race to INSERT
 * before either takes a range lock in some isolation configurations, and the
 * loser retries rather than failing a request that was within its budget.
 *
 * THE HINT, NOT A SESSION SETTING — and the difference is not cosmetic.
 *
 * This transaction previously asked Prisma for a `SERIALIZABLE` isolation
 * level. That issues `SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`, which
 * T-SQL scopes to the SESSION and not to the transaction: the level SURVIVES
 * the commit and travels with the connection back into the pool. Every
 * unrelated statement that connection served afterwards — anywhere on the
 * platform — then ran at SERIALIZABLE too, taking range locks nobody asked
 * for, and any statement whose own correctness required a different level
 * simply failed. The delivery claim's `READPAST` is exactly such a statement,
 * and it failed with SQL Server error 650 for no reason it could observe.
 *
 * `UPDLOCK, HOLDLOCK` on the statement gives this transaction the identical
 * locking — `HOLDLOCK` is documented as equivalent to `SERIALIZABLE`, applied
 * to the table reference it annotates — and its scope ENDS with the statement.
 * The limiter's guarantee is unchanged and bounded to the limiter, which is
 * what it should have been: a control that needs strict locking takes strict
 * locks, rather than reconfiguring a shared connection on its way past.
 */
export function createRateLimiter(
  configuration: RateLimiterConfiguration,
): RateLimiterPort {
  const prisma = getDatabaseClient();

  async function consumeOnce(
    key: string,
    rule: RateLimitRule,
    now: Date,
  ): Promise<RateLimitDecision> {
    const windowExpiresAt = new Date(now.getTime() + rule.window * 1000);

    return prisma.$transaction(
      async (tx) => {
        const existing = await tx.$queryRaw<{ count: number; windowExpiresAt: Date }[]>`
          SELECT [count], [windowExpiresAt]
          FROM [dbo].[RateLimitCounter] WITH (UPDLOCK, HOLDLOCK)
          WHERE [key] = ${key};
        `;

        const current = existing[0];

        // No window, or the previous one has expired: start a fresh one. The
        // first request of a window is itself consumed, so `count` starts at 1.
        if (current === undefined) {
          await tx.$executeRaw`
            INSERT INTO [dbo].[RateLimitCounter]
              ([key], [keyVersion], [count], [windowStartedAt], [windowExpiresAt])
            VALUES (${key}, ${configuration.digestKeyVersion}, 1, ${now}, ${windowExpiresAt});
          `;
          return { allowed: true, retryAfter: null };
        }

        if (current.windowExpiresAt <= now) {
          await tx.$executeRaw`
            UPDATE [dbo].[RateLimitCounter]
            SET [count] = 1,
                [keyVersion] = ${configuration.digestKeyVersion},
                [windowStartedAt] = ${now},
                [windowExpiresAt] = ${windowExpiresAt}
            WHERE [key] = ${key};
          `;
          return { allowed: true, retryAfter: null };
        }

        // A live window. Refusing does NOT extend it: extending on refusal
        // would let a caller keep itself locked out indefinitely by retrying.
        if (current.count >= rule.max) {
          return {
            allowed: false,
            retryAfter: secondsUntil(current.windowExpiresAt, now),
          };
        }

        await tx.$executeRaw`
          UPDATE [dbo].[RateLimitCounter]
          SET [count] = [count] + 1
          WHERE [key] = ${key};
        `;

        return { allowed: true, retryAfter: null };
      },
      // NO `isolationLevel`. See the note above the factory: the strict
      // locking this control needs comes from the statement's own
      // `UPDLOCK, HOLDLOCK`, whose scope ends with the statement. An isolation
      // level asked for here would outlive the transaction on the pooled
      // connection and change the behaviour of unrelated operations.
    );
  }

  return {
    async consume(key: string, rule: RateLimitRule): Promise<RateLimitDecision> {
      const now = new Date();

      // A bounded retry, for the narrow race where two transactions both find
      // the key absent. Losing that race means the request was within budget
      // and must not be refused for a reason that has nothing to do with the
      // limit — but the retry is bounded, so a genuinely broken store fails
      // rather than spinning.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          return await consumeOnce(key, rule, now);
        } catch (error) {
          const retryable =
            error instanceof Prisma.PrismaClientKnownRequestError &&
            (error.code === 'P2002' || error.code === 'P2034');
          if (!retryable || attempt === 2) throw error;
        }
      }

      // Unreachable: the loop either returns or throws.
      throw new Error('Rate limiter exhausted its retry budget.');
    },

    async purgeExpired(limit: number): Promise<number> {
      // BOUNDED. An unbounded delete over a table every authentication request
      // touches is a lock-contention incident waiting for its first busy day
      // (ARCHITECTURE.md §13.9).
      const bounded = Math.max(1, Math.min(limit, 5_000));

      return prisma.$executeRaw`
        DELETE TOP (${bounded}) FROM [dbo].[RateLimitCounter]
        WHERE [windowExpiresAt] <= ${new Date()};
      `;
    },
  };
}
