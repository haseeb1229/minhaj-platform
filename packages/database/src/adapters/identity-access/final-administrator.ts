import 'server-only';

import type { Prisma } from '@prisma/client';

import { getDatabaseClient } from '../../client.ts';

/**
 * The protected Platform Administrator invariant, on the client side of it.
 *
 * The invariant itself lives in SQL — four `AFTER` triggers created by
 * `20260916000000_phase2_authorization_privileged_security`, each taking the
 * same transaction-owned application lock before evaluating whether a usable
 * Platform Administrator still remains. That is the authoritative safety net
 * and nothing here replaces it.
 *
 * This module owns the two things the SAFETY NET cannot own by itself: the
 * LOCK ORDER a protected mutation takes, and the meaning of the refusal it
 * gets back.
 *
 * ## The lock order
 *
 * An `AFTER` trigger runs after its statement, so the row locks come FIRST and
 * the invariant lock SECOND. Two administrators revoking each other therefore
 * took them in opposite orders, which is a textbook inversion, and the measured
 * result on this stack (SQL Server 2022, Prisma 7.10) was a deadlock on EVERY
 * attempt: the transaction holding the invariant lock waited for an `S` lock on
 * `RoleAssignment_pkey` that the other transaction held `X`, while that one
 * waited for the invariant lock.
 *
 * `sp_getapplock` does not surface a deadlock as error 1205. It returns -3 and
 * the trigger converts that into `51021`, so the loser was refused for a
 * TRANSIENT reason and — because the classifier below used to accept either
 * number — was told the final administrator could not be removed. It was a
 * lie on every iteration, and with a slower deadlock monitor the surviving
 * transaction could exhaust its own timeout as well and leave NO revocation
 * committed at all (DELIVERY_PLAN.md §4, Phase-2 maintenance gate).
 *
 * The fix is to take the invariant lock BEFORE the protected mutation, in the
 * same transaction, so competing transactions serialise at the lock rather than
 * meeting halfway through each other's row locks. The trigger then asks for a
 * lock its own transaction already owns and is granted it reentrantly, so the
 * authoritative check is unchanged and still runs.
 *
 * ## Why the refusal has to be classified structurally
 *
 * `51020` is the semantic refusal — the state genuinely may not be reached.
 * `51021` is "the invariant lock was not obtained", and `1205` is SQL Server's
 * own deadlock victim. The last two say nothing about administrators; they say
 * the transaction must be tried again. Telling an operator that the final
 * administrator cannot be removed when the real cause was a lock is both
 * useless and untrue.
 *
 * The numbers are read from the STRUCTURED fields the driver populates and
 * from nowhere else. A previous version matched on message text, which meant
 * any value that reached an error message — an audit reason, a role name, a
 * pasted string containing `51020` — could impersonate a semantic refusal.
 */

/** The state may genuinely not be reached. Authoritative, never retried. */
const FINAL_ADMINISTRATOR_REFUSAL = 51020;

/** The invariant lock was not obtained. Says nothing about administrators. */
const INVARIANT_LOCK_UNAVAILABLE = 51021;

/** SQL Server chose this transaction as the deadlock victim. */
const DEADLOCK_VICTIM = 1205;

/**
 * Where a SQL Server error number can appear once Prisma and the MSSQL driver
 * have wrapped it.
 *
 * Measured on this stack, a model write arrives as
 * `PrismaClientKnownRequestError.meta.driverAdapterError.cause.code`, a raw
 * write the same way under a different Prisma code, and a direct driver error
 * as `number` with a second copy under `info`.
 */
const NESTED_KEYS = [
  'cause',
  'meta',
  'driverAdapterError',
  'originalError',
  'info',
] as const;

/**
 * NUMERIC fields only.
 *
 * `code` holds `'P2039'` on the Prisma error and `51021` on the driver's, so
 * the type is what distinguishes them. A string is never read as an error
 * number, which is what makes message text unable to impersonate one.
 */
const NUMBER_KEYS = ['code', 'number'] as const;

/** Bounded, so a wrapped error cannot cost unbounded work to classify. */
const MAX_VISITED_NODES = 32;

/**
 * Reads one own DATA property without invoking an accessor or trusting a
 * prototype. Unknown errors are untrusted values: a getter must not execute
 * merely because the adapter is deciding how to classify a failed write.
 * Proxies can also throw while their descriptor is inspected, so an
 * uninspectable property is simply not evidence.
 */
function ownDataProperty(record: object, key: string): unknown {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(record, key);
    return descriptor !== undefined && 'value' in descriptor
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
}

function sqlErrorNumbers(error: unknown): ReadonlySet<number> {
  const numbers = new Set<number>();
  const seen = new Set<object>();
  const pending: unknown[] = [error];
  let visited = 0;

  while (pending.length > 0 && visited < MAX_VISITED_NODES) {
    const current = pending.shift();
    if (current === null || typeof current !== 'object') continue;
    // Cycle-safe: a driver error that references its own cause is common, and
    // walking it twice would be the start of an unbounded walk.
    if (seen.has(current)) continue;
    seen.add(current);
    visited += 1;

    for (const key of NUMBER_KEYS) {
      const value = ownDataProperty(current, key);
      if (typeof value === 'number' && Number.isInteger(value)) numbers.add(value);
    }
    for (const key of NESTED_KEYS) {
      const value = ownDataProperty(current, key);
      if (value !== undefined) pending.push(value);
    }
  }

  return numbers;
}

/**
 * What a refused protected mutation actually meant.
 *
 * `other` covers every failure that is neither — a missing row, a constraint,
 * a connection — and is returned unchanged to the caller that knows what to do
 * with it.
 */
export type ProtectedMutationRefusal = 'final-administrator' | 'transient' | 'other';

export function classifyProtectedMutationError(error: unknown): ProtectedMutationRefusal {
  const numbers = sqlErrorNumbers(error);

  // The semantic refusal is checked first and wins: if the authoritative
  // invariant spoke, no amount of retrying changes its answer.
  if (numbers.has(FINAL_ADMINISTRATOR_REFUSAL)) return 'final-administrator';
  if (numbers.has(INVARIANT_LOCK_UNAVAILABLE) || numbers.has(DEADLOCK_VICTIM)) {
    return 'transient';
  }
  return 'other';
}

/**
 * The transaction could not be serialised, and the attempts are spent.
 *
 * It carries NO SQL number, driver text, query or lock resource — only a safe
 * category and how many attempts were made. Its `reason` is deliberately a
 * safe application category: the service maps it to generic unavailability
 * rather than reporting an invariant
 * refusal that never happened (SECURITY_BASELINE.md §15.2).
 */
export class ProtectedMutationUnavailableError extends Error {
  readonly reason = 'invariant-serialisation' as const;
  readonly attempts: number;

  constructor(attempts: number) {
    super(
      `The protected administrator invariant could not be serialised after ${attempts} attempts.`,
    );
    this.name = 'ProtectedMutationUnavailableError';
    this.attempts = attempts;
  }
}

/** The resource the migration's four triggers already name. */
const INVARIANT_LOCK_RESOURCE = 'minhaj:platform-administrator-invariant';

/**
 * How long a protected mutation waits for the invariant lock.
 *
 * Shorter than the 15s the triggers use, because a transaction that takes the
 * lock up front is holding it for its own whole body: waiting longer here only
 * lengthens the queue behind it. Exhausting it is transient and retried.
 */
const LOCK_TIMEOUT_MS = 5_000;

/**
 * How long one protected transaction may live.
 *
 * EXPLICIT, and that is the point. Prisma's default interactive-transaction
 * timeout is 5s, which is shorter than the triggers' own 15s lock wait — so a
 * transaction could be aborted by its client while still legitimately waiting
 * for the invariant, which is one of the ways the mutual revoke could end with
 * nothing committed.
 */
const TRANSACTION_TIMEOUT_MS = 20_000;

/**
 * Attempts for ONE protected mutation, including the first.
 *
 * Small and explicit. With the lock taken in a consistent order the retries
 * are not normally reached at all; they exist for a genuine transient refusal
 * raised by a path outside this ordering — a concurrent address verification,
 * which changes `User.emailVerified` and so fires the same trigger.
 */
const MAX_ATTEMPTS = 3;

const PROTECTED_TRANSACTION = {
  timeout: TRANSACTION_TIMEOUT_MS,
  maxWait: LOCK_TIMEOUT_MS,
} as const;

function isTransientRefusal(error: unknown): boolean {
  if (error instanceof ProtectedMutationUnavailableError) return true;
  return classifyProtectedMutationError(error) === 'transient';
}

async function acquireInvariantLock(tx: Prisma.TransactionClient): Promise<boolean> {
  const rows = await tx.$queryRaw<{ granted: number }[]>`
    DECLARE @granted int;
    EXEC @granted = sys.sp_getapplock
      @Resource = ${INVARIANT_LOCK_RESOURCE},
      @LockMode = 'Exclusive',
      @LockOwner = 'Transaction',
      @LockTimeout = ${LOCK_TIMEOUT_MS};
    SELECT @granted AS granted;
  `;

  // >= 0 is granted, every negative value is a refusal: -1 timeout,
  // -2 cancelled, -3 deadlock victim, -999 parameter error.
  const granted = rows[0];
  return granted !== undefined && Number(granted.granted) >= 0;
}

/**
 * Runs ONE protected Identity mutation as a single authoritative transaction
 * that has already taken the invariant lock.
 *
 * The whole transaction is retried on a transient refusal, and only on a
 * transient refusal — never on the semantic one, never on a not-found, a
 * validation or an authorisation failure, and never on an unrecognised error.
 * Retrying the whole transaction is what keeps the side effects exactly once:
 * a failed attempt rolled its audit record, its notification intent and its
 * session invalidation back with it, so the attempt that commits is the only
 * one that ever happened.
 *
 * There is no sleep between attempts. The next attempt's first statement is
 * the lock acquisition, so a contended retry waits on the lock rather than
 * spinning — the backpressure is the lock itself, not a timer.
 *
 * IT RETURNS NOTHING, deliberately.
 *
 * The callback runs inside the adapter, where the Prisma client already lives,
 * so handing it the transaction is not a boundary crossing. Handing that
 * transaction BACK would be: an adapter operation whose result is produced by
 * this function would have a transaction handle in what it returns, and
 * §6.3 rule 13 does not accept a wrapper as a substitute for a narrow surface.
 * A `void` result makes that structurally impossible rather than merely
 * intended — an operation that needs an outcome captures its own, typed by the
 * context-owned port it implements (ARCHITECTURE.md §4.1).
 */
export async function withProtectedInvariantMutation(
  mutation: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  const prisma = getDatabaseClient();

  for (let attempt = 1; ; attempt += 1) {
    try {
      await prisma.$transaction(async (tx) => {
        // FIRST, before any protected row is touched. This is the entire
        // ordering contract: the trigger's own acquisition later in the same
        // transaction is reentrant and immediate.
        if (!(await acquireInvariantLock(tx))) {
          throw new ProtectedMutationUnavailableError(attempt);
        }
        await mutation(tx);
      }, PROTECTED_TRANSACTION);
      return;
    } catch (error) {
      if (!isTransientRefusal(error)) throw error;
      if (attempt >= MAX_ATTEMPTS) throw new ProtectedMutationUnavailableError(attempt);
    }
  }
}
