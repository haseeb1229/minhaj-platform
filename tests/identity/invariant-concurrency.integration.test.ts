import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { PLATFORM_ADMINISTRATOR_ROLE } from '../../packages/contracts/src/identity/index.ts';

import {
  createProofDatabase,
  databaseConfigured,
  type DisposableDatabase,
} from './harness.ts';
import { createIdentityHarness, type IdentityHarness } from './service.ts';
import {
  actorFor,
  createAccount,
  createAdministrator,
  enrolSecondFactor,
  signInWithFactor,
  type Administrator,
} from './privileged.ts';

/**
 * PHASE-2 MAINTENANCE — the protected-administrator invariant under real
 * concurrency (DELIVERY_PLAN.md §4, Phase-5 entry gate).
 *
 * ## What was wrong
 *
 * The invariant's four SQL triggers are `AFTER` triggers, so the row locks are
 * taken FIRST and the invariant's application lock SECOND. Two administrators
 * revoking each other therefore took them in opposite orders. Measured on this
 * stack — SQL Server 2022, Prisma 7.10, `@prisma/adapter-mssql` — that
 * deadlocked on EVERY attempt: the transaction holding the invariant lock
 * waited for an `S` lock on `RoleAssignment_pkey` that the other held `X`,
 * while that one waited for the invariant lock.
 *
 * `sp_getapplock` does not surface a deadlock as error 1205; it returns -3, and
 * the trigger converts that into `51021` — "the invariant lock could not be
 * acquired". The classifier accepted `51020` and `51021` alike, so the loser
 * was told THE FINAL ADMINISTRATOR COULD NOT BE REMOVED when the real cause
 * was a lock. The accepted single-race proof passed on that answer, which is
 * why it needed repeating rather than trusting.
 *
 * With a slower deadlock monitor the surviving transaction could also exhaust
 * its own client timeout, leaving NO revocation committed at all.
 *
 * ## Why this is a separate suite
 *
 * Its own disposable database and its own bootstrap administrator, so the
 * repeated race has the whole step-up budget to itself. Folded into the
 * accepted authorisation suite it would have competed for that budget with
 * every proof already there, and a rate limit is not what this is measuring.
 *
 * ## How the bootstrap holder is made unusable
 *
 * By clearing `emailVerified` directly, rather than by suspending it. The
 * invariant requires an administrator to be active AND verified AND unrevoked
 * under an active role, so either makes it unusable to exactly the same
 * predicate — but a status change revokes every session and step-up grant the
 * holder has, and re-earning those six times over is the rate limit above.
 * Nothing about the race being measured differs.
 */

describe.skipIf(!databaseConfigured)(
  'Phase-2 maintenance — protected-administrator concurrency (live SQL Server)',
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
      );
    }, 240_000);

    afterAll(async () => {
      await database?.close();
    }, 60_000);

    /**
     * The bootstrap holder, acting for one permission.
     *
     * `actorFor` REUSES the live step-up grant, so every call after the first
     * costs nothing: nothing in this suite invalidates the bootstrap holder's
     * sessions, which is the whole reason the unusable state below is reached
     * by clearing `emailVerified` rather than by suspending it. Asking for it
     * per use rather than holding one value also means a grant that has aged
     * past its lifetime is re-earned instead of failing verification.
     */
    async function bootstrapActorFor(
      permission: 'permissions.grant' | 'roles.administer',
    ) {
      return actorFor(harness, administrator, permission, 'privilege-administration');
    }

    /** Administrators the invariant counts as usable, right now. */
    async function usableAdministratorCount(): Promise<number> {
      const [row] = await database.admin.query<{ total: number }>(`
        SELECT COUNT_BIG(*) AS total
        FROM [dbo].[RoleAssignment] ra
        INNER JOIN [dbo].[Role] r ON r.[id] = ra.[roleId]
        INNER JOIN [dbo].[User] u ON u.[id] = ra.[userId]
        WHERE r.[key] = N'platform-administrator'
          AND r.[deactivatedAt] IS NULL
          AND ra.[revokedAt] IS NULL
          AND u.[status] = N'active'
          AND u.[emailVerified] = 1;
      `);
      return Number(row?.total ?? 0);
    }

    /**
     * Deadlocks this SQL Server instance has recorded, in total.
     *
     * SQL Server's own counter, read in about five milliseconds. The precise
     * alternative — shredding the `system_health` ring buffer and filtering it
     * to this database's name — measured over TEN SECONDS on an idle server
     * once the buffer held a few dozen reports, which is longer than the
     * driver's request budget and would make this proof fail on its own
     * instrumentation.
     *
     * It is instance-wide, so it is read TIGHTLY AROUND each race rather than
     * across the whole run: the window is the few milliseconds the two
     * revocations take. Cross-checked against the scoped ring-buffer count
     * while this maintenance was diagnosed, the two agreed exactly — every
     * deadlock this instance recorded came from this race and nothing else.
     * A deadlock from elsewhere landing inside one of these windows would fail
     * the proof rather than hide one, which is the safe direction.
     */
    async function deadlocksRecorded(): Promise<number> {
      const [row] = await database.admin.query<{ total: number }>(`
        SELECT cntr_value AS total FROM sys.dm_os_performance_counters
        WHERE counter_name LIKE N'Number of Deadlocks/sec%'
          AND instance_name = N'_Total';
      `);
      return Number(row?.total ?? 0);
    }

    /**
     * Runs one of this suite's own protected writes under the SAME ordering
     * contract the adapter follows.
     *
     * These statements touch rows the invariant triggers watch, so without the
     * lock they reach the trigger holding a row lock and wait out its 15s
     * acquisition — longer than the driver's own request budget, which is a
     * timeout in the proof rather than a finding about the product. Taking the
     * lock first makes the trigger's acquisition reentrant, exactly as it is
     * for the adapter.
     *
     * The wait is bounded and a refusal THROWS, so a lock this proof genuinely
     * could not obtain fails the run rather than skipping the work silently.
     */
    async function protectedProofWrite(statement: string): Promise<void> {
      await database.admin.query(`
        SET XACT_ABORT ON;
        BEGIN TRANSACTION;
        DECLARE @granted int;
        EXEC @granted = sys.sp_getapplock
          @Resource = N'minhaj:platform-administrator-invariant',
          @LockMode = 'Exclusive',
          @LockOwner = 'Transaction',
          @LockTimeout = 10000;
        IF @granted < 0
        BEGIN
          ROLLBACK TRANSACTION;
          THROW 51099, N'The proof could not take the invariant lock.', 1;
        END;
        ${statement}
        COMMIT TRANSACTION;
      `);
    }

    async function setVerified(accountIds: readonly string[], verified: boolean) {
      const list = accountIds.map((id) => `N'${id}'`).join(', ');
      await protectedProofWrite(
        `UPDATE [dbo].[User] SET [emailVerified] = ${verified ? 1 : 0} WHERE [id] IN (${list});`,
      );
    }

    /** A fresh account holding the protected role, with a live step-up actor. */
    async function newAdministrator(prefix: string): Promise<{
      readonly account: Administrator;
      readonly actor: Awaited<ReturnType<typeof actorFor>>;
      readonly assignmentId: string;
    }> {
      const created = await createAccount(harness, harness.provider, prefix);
      const enrolment = await enrolSecondFactor(harness, created);
      const role = await harness.administration.findRole(PLATFORM_ADMINISTRATOR_ROLE);
      if (role === null) throw new Error('The protected administrator role is missing.');

      const granted = await harness.administration.grantRole(
        await bootstrapActorFor('permissions.grant'),
        {
          accountId: created.accountId,
          roleId: role.id,
          reason: 'PROOF invariant concurrency participant',
        },
      );
      if (!granted.ok) throw new Error(`Administrator grant refused: ${granted.failure}`);

      const account: Administrator = {
        ...(await signInWithFactor(harness, { ...created, ...enrolment })),
        ...enrolment,
      };

      const assignments = await harness.administration.listAssignments({
        accountId: account.accountId,
        includeRevoked: false,
        limit: 10,
        offset: 0,
      });
      const assignment = assignments.items.find(
        (entry) => entry.roleKey === PLATFORM_ADMINISTRATOR_ROLE,
      );
      if (assignment === undefined) {
        throw new Error('The expected live administrator assignment is missing.');
      }

      const actor = await actorFor(
        harness,
        account,
        'permissions.grant',
        'privilege-administration',
      );

      return { account, actor, assignmentId: assignment.id };
    }

    /* =====================================================================
     * The recorded defect
     * =================================================================== */

    it('repeats the mutual revoke with no deadlock and no false refusal', async () => {
      const ITERATIONS = 4;

      for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
        const first = await newAdministrator(`mutual-a-${iteration}`);
        const second = await newAdministrator(`mutual-b-${iteration}`);

        // EXACTLY TWO usable administrators, which is the only state in which
        // one revocation is permitted and the other is not.
        await setVerified([administrator.accountId], false);
        expect(await usableAdministratorCount()).toBe(2);

        const deadlocksBefore = await deadlocksRecorded();
        const outcomes = await Promise.allSettled([
          harness.authorizationStore.revokeRoleAssignment({
            assignmentId: second.assignmentId,
            reason: `PROOF repeated mutual revoke ${iteration}`,
            actor: first.actor,
            auditAction: 'identity.assignment.revoked',
          }),
          harness.authorizationStore.revokeRoleAssignment({
            assignmentId: first.assignmentId,
            reason: `PROOF repeated mutual revoke ${iteration}`,
            actor: second.actor,
            auditAction: 'identity.assignment.revoked',
          }),
        ]);

        // THE LOCK ORDER is what removes the deadlock. Before the maintenance
        // this rose by exactly one on every iteration.
        expect(await deadlocksRecorded()).toBe(deadlocksBefore);

        const committed = outcomes.filter((outcome) => outcome.status === 'fulfilled');
        const refused = outcomes.filter((outcome) => outcome.status === 'rejected');

        // EXACTLY ONE of each, every time — never "zero or one". A run that
        // committed nothing would mean two administrators could revoke each
        // other into a state where neither revocation happened and both were
        // told something untrue about why.
        expect(committed).toHaveLength(1);
        expect(refused).toHaveLength(1);

        // And the refusal is the SEMANTIC one. A transient lock failure
        // reported here is precisely the defect this proof exists for.
        const refusal = refused[0];
        expect(
          refusal?.status === 'rejected'
            ? (refusal.reason as { reason?: unknown }).reason
            : '',
        ).toBe('final-administrator');

        expect(await usableAdministratorCount()).toBe(1);

        // EXACTLY-ONCE SIDE EFFECTS. The refused transaction rolled back, so
        // it left no audit record behind, and no retried attempt left a
        // second one.
        const [audits] = await database.admin.query<{ total: number }>(`
          SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog]
          WHERE [action] = N'identity.assignment.revoked'
            AND [targetId] IN (N'${first.account.accountId}', N'${second.account.accountId}');
        `);
        expect(Number(audits?.total ?? 0)).toBe(1);

        // Restore: the bootstrap holder becomes usable again FIRST, so
        // retiring this iteration's participants never trips the invariant.
        await setVerified([administrator.accountId], true);
        await protectedProofWrite(`
          UPDATE [dbo].[RoleAssignment]
          SET [revokedAt] = SYSUTCDATETIME(), [revokedReason] = N'proof-cleanup'
          WHERE [revokedAt] IS NULL
            AND [userId] IN (N'${first.account.accountId}', N'${second.account.accountId}');
        `);
        expect(await usableAdministratorCount()).toBe(1);
      }
    }, 900_000);

    /* =====================================================================
     * The bounded retry
     * =================================================================== */

    /**
     * Proved against a REAL transient refusal.
     *
     * With the lock now taken in a consistent order the product paths no
     * longer produce one, so it is raised by a proof trigger emitting the same
     * `51021` the invariant trigger emits when its lock is unavailable — which
     * a write outside this ordering, such as a concurrent address
     * verification, can still cause.
     *
     * The attempt counter is a SEQUENCE precisely because it has to survive
     * the rollback the refusal causes. A counter table would be rolled back
     * with the transaction and count nothing.
     */
    describe('transient serialisation', () => {
      const PROOF_REASON = 'PROOF transient retry';

      async function installTransientRefusal(failedAttempts: number): Promise<void> {
        await database.admin.runScript(`
          CREATE SEQUENCE [dbo].[ProofRevokeAttempt] AS int START WITH 1 INCREMENT BY 1;
          GO
          CREATE TRIGGER [dbo].[TRG_Proof_TransientRevokeRefusal]
          ON [dbo].[RoleAssignment]
          AFTER UPDATE
          AS
          BEGIN
            SET NOCOUNT ON;
            IF NOT EXISTS (
              SELECT 1 FROM inserted WHERE [revokedReason] = N'${PROOF_REASON}'
            )
              RETURN;
            IF (NEXT VALUE FOR [dbo].[ProofRevokeAttempt]) <= ${failedAttempts}
              THROW 51021, N'proof transient invariant lock refusal', 1;
          END;
          GO
        `);
      }

      async function attemptsMade(): Promise<number> {
        const [row] = await database.admin.query<{ used: number }>(`
          SELECT CAST([current_value] AS int) AS used
          FROM sys.sequences WHERE [name] = N'ProofRevokeAttempt';
        `);
        return Number(row?.used ?? 0);
      }

      async function removeTransientRefusal(): Promise<void> {
        await database.admin.runScript(`
          DROP TRIGGER IF EXISTS [dbo].[TRG_Proof_TransientRevokeRefusal];
          GO
          DROP SEQUENCE IF EXISTS [dbo].[ProofRevokeAttempt];
          GO
        `);
      }

      /** An ORDINARY role, so the invariant itself is not involved at all. */
      async function grantOrdinaryRole(prefix: string) {
        const created = await harness.administration.createCustomRole(
          await bootstrapActorFor('roles.administer'),
          {
            key: `proof-${prefix}-${Date.now()}`,
            name: `Proof ${prefix}`,
            description: 'A custom role created by the transient-refusal proofs.',
            permissions: ['audit.read'],
          },
        );
        if (!created.ok) throw new Error(`Role creation refused: ${created.failure}`);

        const account = await createAccount(harness, harness.provider, prefix);
        const granted = await harness.administration.grantRole(
          await bootstrapActorFor('permissions.grant'),
          {
            accountId: account.accountId,
            roleId: created.role.id,
            reason: 'PROOF transient retry participant',
          },
        );
        if (!granted.ok) throw new Error(`Grant refused: ${granted.failure}`);

        const assignments = await harness.administration.listAssignments({
          accountId: account.accountId,
          includeRevoked: false,
          limit: 10,
          offset: 0,
        });
        const assignment = assignments.items.find(
          (entry) => entry.roleId === created.role.id,
        );
        if (assignment === undefined) throw new Error('The proof grant is missing.');

        return { accountId: account.accountId, assignmentId: assignment.id };
      }

      async function revokedAuditCount(accountId: string): Promise<number> {
        const [row] = await database.admin.query<{ total: number }>(`
          SELECT COUNT_BIG(*) AS total FROM [dbo].[AuditLog]
          WHERE [action] = N'identity.assignment.revoked' AND [targetId] = N'${accountId}';
        `);
        return Number(row?.total ?? 0);
      }

      it('retries a transient refusal and still commits exactly once', async () => {
        const { accountId, assignmentId } = await grantOrdinaryRole('retry-transient');
        await installTransientRefusal(1);

        try {
          const revoked = await harness.administration.revokeRole(
            await bootstrapActorFor('permissions.grant'),
            { assignmentId, reason: PROOF_REASON },
          );
          expect(revoked.ok).toBe(true);

          // TWO attempts: the one that was refused and the one that
          // committed. Only the second left anything behind.
          expect(await attemptsMade()).toBe(2);
          expect(await revokedAuditCount(accountId)).toBe(1);
        } finally {
          await removeTransientRefusal();
        }
      }, 180_000);

      it('gives up after BOUNDED attempts and never calls a lock a final administrator', async () => {
        const { accountId, assignmentId } = await grantOrdinaryRole('retry-exhausted');
        await installTransientRefusal(99);

        try {
          const revoked = await harness.administration.revokeRole(
            await bootstrapActorFor('permissions.grant'),
            { assignmentId, reason: PROOF_REASON },
          );

          expect(revoked.ok).toBe(false);

          // THE WHOLE POINT. A lock that could not be taken is not a statement
          // about administrators and must never be reported as one.
          expect(revoked.ok ? '' : revoked.failure).not.toBe('final-administrator');
          expect(revoked.ok ? '' : revoked.failure).toBe('unavailable');

          // BOUNDED: three attempts, not an unbounded loop.
          expect(await attemptsMade()).toBe(3);

          // Nothing committed, and nothing recorded as though it had.
          expect(await revokedAuditCount(accountId)).toBe(0);
          const [live] = await database.admin.query<{ total: number }>(`
            SELECT COUNT_BIG(*) AS total FROM [dbo].[RoleAssignment]
            WHERE [id] = N'${assignmentId}' AND [revokedAt] IS NULL;
          `);
          expect(Number(live?.total ?? 0)).toBe(1);
        } finally {
          await removeTransientRefusal();
        }
      }, 180_000);
    });
  },
);
