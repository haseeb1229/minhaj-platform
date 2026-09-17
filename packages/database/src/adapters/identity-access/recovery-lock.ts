import 'server-only';

import { createHash } from 'node:crypto';

import type { AuthenticationOutcome } from '@minhaj/contracts/identity';
import type { Prisma } from '@prisma/client';

import { getDatabaseClient } from '../../client.ts';

/**
 * SERIALISED recovery-code consumption.
 *
 * ## The defect this exists for
 *
 * Better Auth's `verifyBackupCode` spends a code with a compare-and-set: it
 * reads the encrypted set, removes the code, and writes the remainder guarded
 * on the value it read. On an adapter that implements `incrementOne` natively
 * that is atomic. The Prisma adapter does NOT implement it, so the core's
 * ATOMIC FALLBACK runs instead — a read, a guarded `updateMany`, and a bounded
 * retry.
 *
 * Measured on this stack (SQL Server 2022, Prisma 7.10, better-auth 1.7.4),
 * two verifications of the SAME code racing on two pooled connections both
 * return SUCCESS, while the stored set loses exactly one code. The data is not
 * corrupted — one code is spent — but a single-use authentication secret was
 * ACCEPTED TWICE, and each caller was told its verification passed.
 *
 * That is precisely what a single-use credential may not do. An attacker
 * holding a captured code needs only to submit it alongside its legitimate use
 * (SECURITY_BASELINE.md §8.2 — "backup codes are single-use"; CLAUDE.md §19 —
 * "consumption race-safe").
 *
 * ## Why the control lives here
 *
 * The same reasoning the signed-in attempt budget already follows: where the
 * library's control is insufficient on this stack, this platform adds its own
 * rather than weakening the requirement (CLAUDE.md §16). Nothing here
 * re-implements the vendor's mechanics — the verification, the decryption and
 * the write are all still the library's. This only ensures no two of them run
 * for the same subject at the same moment.
 *
 * ## Why an application lock and not a row lock
 *
 * The library performs its write on its OWN pooled connection, so a row lock
 * taken on this module's connection would not be held by the writer — it would
 * deadlock against itself. `sp_getapplock` is a named lock scoped to the
 * database rather than to a row, so it serialises the whole operation across
 * connections AND across processes, which an in-process mutex would stop doing
 * the day a second instance is deployed (ARCHITECTURE.md §4.5).
 *
 * It is owned by the TRANSACTION, so it is released on commit and on rollback
 * alike: a thrown verification cannot leave the lock held.
 *
 * ## Three concrete entry points, not one generic one
 *
 * A generic `withLock<T>` would be a hole the architecture analyser cannot see
 * through — `T` may be instantiated with anything, including a client, a
 * delegate or a transaction handle, so a surface built on it cannot be SHOWN
 * to be narrow (ARCHITECTURE.md §6.3 rule 13). The two shapes the adapter
 * actually needs are written out instead.
 *
 * ## Fail closed
 *
 * A lock that cannot be acquired refuses the attempt. A recovery-code
 * verification that proceeded without serialisation would be the exact
 * behaviour this module exists to prevent, so "the lock was busy" is reported
 * as a failed verification — which is what the caller already handles, and what
 * a person sees as "that code was not accepted".
 */

/** How long an attempt waits for the lock before giving up, milliseconds. */
const LOCK_TIMEOUT_MS = 5_000;

/**
 * How long the surrounding transaction may live.
 *
 * Comfortably longer than the lock timeout plus one verification, and bounded:
 * this pins one pooled connection for its duration, and an unbounded hold
 * would turn a slow verification into a pool outage.
 */
const TRANSACTION_TIMEOUT_MS = 15_000;

/**
 * A stable, non-identifying lock name for one subject.
 *
 * DIGESTED, because `sp_getapplock` resource names are visible in
 * `sys.dm_tran_locks` to anyone who can read that view. A raw account id or a
 * challenge cookie there is a disclosure with no upside; a digest serialises
 * exactly as well (SECURITY_BASELINE.md §19.2).
 */
export function recoveryLockName(subject: string): string {
  return `minhaj:recovery:${createHash('sha256').update(subject).digest('hex').slice(0, 40)}`;
}

/**
 * Takes the exclusive lock inside an open transaction.
 *
 * `sp_getapplock` returns >= 0 when the lock was granted and < 0 when it was
 * not: -1 timeout, -2 cancelled, -3 deadlock victim, -999 parameter error.
 * Every negative value is a refusal, and each is treated as one.
 */
async function acquire(tx: Prisma.TransactionClient, subject: string): Promise<boolean> {
  const resource = recoveryLockName(subject);

  const rows = await tx.$queryRaw<{ granted: number }[]>`
    DECLARE @granted int;
    EXEC @granted = sp_getapplock
      @Resource = ${resource},
      @LockMode = 'Exclusive',
      @LockOwner = 'Transaction',
      @LockTimeout = ${LOCK_TIMEOUT_MS};
    SELECT @granted AS granted;
  `;

  const granted = rows[0];
  return granted !== undefined && Number(granted.granted) >= 0;
}

/**
 * Spends a recovery code for a SIGNED-IN account, one attempt at a time.
 *
 * Returns `false` when the code was refused AND when the lock was busy, which
 * is the same answer a caller must act on either way.
 */
export async function withRecoveryLock(
  subject: string,
  verify: () => Promise<boolean>,
): Promise<boolean> {
  const prisma = getDatabaseClient();

  return prisma.$transaction(
    async (tx) => {
      if (!(await acquire(tx, subject))) return false;

      // The lock is held until this transaction ends, which is after `verify`
      // has finished — including the library's write, which happens on another
      // connection and is what needed serialising.
      return verify();
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: LOCK_TIMEOUT_MS },
  );
}

/**
 * Serialises creation or replacement of one account's recovery-code set and
 * records the matching non-secret issuance receipt before releasing the lock.
 * Every delivered issuance path uses this shape, so two replacements cannot
 * leave the posture naming a different set from the one Better Auth retained.
 */
export async function withRecoveryCodeIssuanceLock(
  accountId: string,
  issue: () => Promise<{
    readonly recoveryCodes: readonly string[];
    readonly totpUri?: string;
  }>,
): Promise<{
  readonly recoveryCodes: readonly string[];
  readonly recoveryCodeReceipt: string;
  readonly totpUri?: string;
} | null> {
  const prisma = getDatabaseClient();

  return prisma.$transaction(
    async (tx) => {
      if (!(await acquire(tx, `user:${accountId}`))) return null;

      const issued = await issue();
      const now = new Date();
      await prisma.privilegedSecurityPosture.upsert({
        where: { userId: accountId },
        create: { userId: accountId, recoveryCodesIssuedAt: now, updatedAt: now },
        // A replacement invalidates acknowledgement of the preceding set.
        update: {
          recoveryCodesIssuedAt: now,
          recoveryCodesConfirmedAt: null,
          updatedAt: now,
        },
      });

      return { ...issued, recoveryCodeReceipt: now.toISOString() };
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: LOCK_TIMEOUT_MS },
  );
}

/**
 * The same account-scoped serialisation for a recovery code answering a
 * SIGN-IN CHALLENGE. The caller resolves the challenge's server-side account
 * subject first, so separate concurrent challenges for one account contend on
 * the same resource.
 *
 * `null` means the lock was busy, which the caller reports as a refused
 * verification rather than as a session.
 */
export async function withChallengeRecoveryLock(
  subject: string,
  verify: () => Promise<AuthenticationOutcome>,
): Promise<AuthenticationOutcome | null> {
  const prisma = getDatabaseClient();

  return prisma.$transaction(
    async (tx) => {
      if (!(await acquire(tx, subject))) return null;
      return verify();
    },
    { timeout: TRANSACTION_TIMEOUT_MS, maxWait: LOCK_TIMEOUT_MS },
  );
}
