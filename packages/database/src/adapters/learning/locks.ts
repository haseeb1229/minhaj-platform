import 'server-only';

import { LearningDataError, type Client } from './shared.ts';

/**
 * The application locks the class adapters serialise on (DOMAIN_MODEL.md
 * §19.8), taken INSIDE the writing transaction BEFORE its first protected
 * write.
 *
 * WHY A LOCK AS WELL AS THE TRIGGERS. The migration refuses two overlapping
 * windows or sessions of one teacher (51283, 51287) and two live claims of one
 * window (the filtered key), so nothing inconsistent can commit. But an
 * `AFTER` trigger's check runs after the row is written, so two writers
 * racing past the adapter's own overlap question would both reach the trigger
 * and one would be refused with the floor's answer rather than told what to
 * do. Serialising the teacher's writes first lets the adapter ask its question
 * under the lock, answer precisely, and leave the trigger as the floor it is.
 *
 * TRANSACTION-OWNED, so the lock is released on commit and on rollback alike;
 * a thrown refusal cannot leave it held. `sp_getapplock` returns >= 0 when
 * granted and < 0 when not (-1 timeout, -2 cancelled, -3 deadlock victim,
 * -999 parameter error); every negative value is a refusal, reported as
 * `unavailable` — a transient condition, never a rule that said no.
 */

/** How long one writer waits for a teacher's lock before giving up. */
export const LOCK_TIMEOUT_MS = 5_000;

/**
 * How long a transaction that takes a lock may live. Explicit, because the
 * interactive-transaction default (5s) is shorter than the lock wait itself.
 */
export const LOCKED_TRANSACTION = {
  timeout: 20_000,
  maxWait: LOCK_TIMEOUT_MS,
} as const;

async function acquire(tx: Client, resource: string): Promise<void> {
  const rows = await tx.$queryRaw<{ granted: number }[]>`
    DECLARE @granted int;
    EXEC @granted = sys.sp_getapplock
      @Resource = ${resource},
      @LockMode = 'Exclusive',
      @LockOwner = 'Transaction',
      @LockTimeout = ${LOCK_TIMEOUT_MS};
    SELECT @granted AS granted;`;
  const granted = rows[0];
  if (granted === undefined || Number(granted.granted) < 0)
    throw new LearningDataError('unavailable');
}

/** Serialises every window and session write of one teacher. */
export function lockTeacher(tx: Client, accountId: string): Promise<void> {
  return acquire(tx, `learning-teacher:${accountId}`);
}

/**
 * Serialises on several teachers at once — ALWAYS in identifier order, so two
 * transactions naming the same pair cannot each hold one and wait for the
 * other.
 */
export async function lockTeachers(
  tx: Client,
  accountIds: readonly string[],
): Promise<void> {
  for (const accountId of [...new Set(accountIds)].sort())
    await lockTeacher(tx, accountId);
}

/** Serialises the grant of a scope to one account on one Course. */
export function lockScope(
  tx: Client,
  courseId: string,
  accountId: string,
): Promise<void> {
  return acquire(tx, `learning-scope:${courseId}:${accountId}`);
}
