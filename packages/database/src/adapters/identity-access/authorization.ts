import 'server-only';

import type {
  AccountStatus,
  AccountSummary,
  AuditPage,
  AuditRecordView,
  AuthorizationPersistencePort,
  AuthorizationReaderPort,
  BootstrapStatus,
  PrivilegeInvalidation,
  PrivilegedActor,
  PrivilegedPosture,
  RoleAssignmentRecord,
  RoleSummary,
  StepUpGrantSummary,
} from '@minhaj/contracts/identity';
import { PLATFORM_ADMINISTRATOR_ROLE } from '@minhaj/contracts/identity';
import type { Prisma } from '@prisma/client';

import { auditRow } from '../../audit-row.ts';
import { getDatabaseClient } from '../../client.ts';
import {
  classifyProtectedMutationError,
  withProtectedInvariantMutation,
} from './final-administrator.ts';

/**
 * Identity's AUTHORISATION persistence — the roles, the assignments, the
 * step-up grants and the privileged posture.
 *
 * Semantic owner: `identity-access`. Physically here because it needs the
 * private Prisma client; owned by the context, which is the only place its
 * rules may change (ARCHITECTURE.md §4.1, §6.3 rule 14).
 *
 * WHAT IT DECIDES: nothing about WHO may act. Permission, posture and step-up
 * are settled before any of these operations is reachable, by the authorisation
 * service — which is why each mutation takes a `PrivilegedActor` rather than an
 * account id.
 *
 * WHAT IT DOES ENFORCE, and must: the invariants that are properties of the
 * DATA rather than of the caller. A protected system role cannot be renamed,
 * re-bundled or deactivated through any of these methods, a revoked assignment
 * is never deleted, and every privilege change performs its invalidation and
 * writes its audit record INSIDE the transaction that makes it. Those are
 * checked here as well as in the context because this module is the only
 * writer, and an invariant enforced only by its caller is an invariant one new
 * caller removes.
 */

/** How long a bounded listing may return in one page. */
const MAX_PAGE = 100;

function boundedLimit(limit: number): number {
  if (!Number.isFinite(limit) || limit < 1) return 1;
  return Math.min(Math.trunc(limit), MAX_PAGE);
}

function boundedOffset(offset: number): number {
  if (!Number.isFinite(offset) || offset < 0) return 0;
  return Math.trunc(offset);
}

/**
 * A role row as the queries below select it.
 *
 * Stated STRUCTURALLY rather than as `Prisma.RoleGetPayload<…>`. The helper
 * type is accurate and it names `Prisma`, which puts the client's own namespace
 * on a module the encapsulation boundary re-exports — and a boundary that names
 * raw capability cannot be shown to be narrow, however narrowly it is used
 * (ARCHITECTURE.md §6.3 rule 13).
 */
interface RoleRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly system: boolean;
  readonly deactivatedAt: Date | null;
  readonly permissions: readonly { readonly permissionKey: string }[];
}

function toRoleSummary(role: RoleRow, activeAssignments: number): RoleSummary {
  return {
    id: role.id,
    key: role.key,
    name: role.name,
    description: role.description,
    system: role.system,
    deactivatedAt: role.deactivatedAt,
    // Sorted, so a bundle reads the same way everywhere and an audited before
    // and after can be compared as text rather than as sets.
    permissions: role.permissions.map((entry) => entry.permissionKey).sort(),
    activeAssignments,
  };
}

/**
 * The one include every role query uses.
 *
 * `as const` rather than `satisfies Prisma.RoleInclude`: the `satisfies` form
 * is a VALUE reference to the Prisma namespace, and this module is re-exported
 * through the adapter's public entry. Prisma still type-checks the object at
 * every call site that uses it.
 */
const ROLE_INCLUDE = {
  permissions: { select: { permissionKey: true } },
} as const;

/**
 * Raised when an administrative operation is refused by a DATA invariant.
 *
 * Distinct from an authorisation denial, which never reaches this module: by
 * the time one of these is thrown the caller was permitted to try, and what
 * stopped them is what the data is allowed to be.
 */
export class AuthorizationDataError extends Error {
  readonly reason:
    | 'role-not-found'
    | 'role-protected'
    | 'role-deactivated'
    | 'account-not-found'
    | 'assignment-not-found'
    | 'final-administrator'
    | 'unknown-permission'
    | 'duplicate-role-key'
    | 'self-elevation';

  constructor(reason: AuthorizationDataError['reason'], message: string) {
    super(message);
    this.name = 'AuthorizationDataError';
    this.reason = reason;
  }
}

export function createAuthorizationReader(): AuthorizationReaderPort {
  const prisma = getDatabaseClient();

  return {
    async effectivePermissions(accountId: string): Promise<readonly string[]> {
      // ONE query, evaluated live. Current assignments, active roles, current
      // bundle — no cache, no session copy, no projection that could be stale
      // (SECURITY_BASELINE.md §3.4 rule 5).
      //
      // A revoked assignment and a deactivated role are both excluded by the
      // predicate rather than filtered afterwards, so a bug in this method
      // cannot return a permission the database did not agree to.
      const rows = await prisma.rolePermission.findMany({
        where: {
          role: {
            deactivatedAt: null,
            assignments: {
              some: {
                userId: accountId,
                revokedAt: null,
                user: { status: 'active' },
              },
            },
          },
        },
        select: { permissionKey: true },
        distinct: ['permissionKey'],
      });

      return rows.map((row) => row.permissionKey);
    },

    async findStepUpGrant({ accountId, sessionId, purpose }) {
      const now = new Date();
      const grant = await prisma.stepUpGrant.findFirst({
        where: {
          userId: accountId,
          sessionId,
          purpose,
          expiresAt: { gt: now },
          session: { userId: accountId, expiresAt: { gt: now } },
        },
        orderBy: { expiresAt: 'desc' },
        select: { id: true, purpose: true, expiresAt: true },
      });

      if (grant === null) return null;

      return {
        id: grant.id,
        purpose: grant.purpose as StepUpGrantSummary['purpose'],
        expiresAt: grant.expiresAt,
      };
    },

    async privilegedPosture(accountId: string): Promise<PrivilegedPosture> {
      const account = await prisma.user.findUnique({
        where: { id: accountId },
        select: {
          twoFactorEnabled: true,
          twoFactor: { select: { verified: true } },
          privilegedPosture: {
            select: {
              recoveryCodesIssuedAt: true,
              recoveryCodesConfirmedAt: true,
              reenrolmentRequiredAt: true,
            },
          },
        },
      });

      // FAIL CLOSED. An account that cannot be read has no posture, which
      // denies every high-consequence capability rather than defaulting to a
      // permissive shape.
      if (account === null) {
        return {
          secondFactorEnrolled: false,
          recoveryCodesIssued: false,
          recoveryCodesConfirmed: false,
          reenrolmentRequired: true,
        };
      }

      // BOTH the library's flag AND a verified factor row. The flag alone is
      // set on the user; the row is where "somebody actually typed a code from
      // the authenticator" is recorded, and an enrolment abandoned halfway
      // leaves the second false while the first may already be true.
      const enrolled =
        account.twoFactorEnabled && account.twoFactor.some((factor) => factor.verified);

      return {
        secondFactorEnrolled: enrolled,
        recoveryCodesIssued: account.privilegedPosture?.recoveryCodesIssuedAt != null,
        recoveryCodesConfirmed:
          account.privilegedPosture?.recoveryCodesConfirmedAt != null,
        reenrolmentRequired: account.privilegedPosture?.reenrolmentRequiredAt != null,
      };
    },
  };
}

export function createAuthorizationPersistence(): AuthorizationPersistencePort {
  const prisma = getDatabaseClient();

  /**
   * Takes an update lock on one role for the rest of the transaction.
   *
   * WITHOUT IT, two concurrent bundle edits both read the same "before" set and
   * the loser's audit record describes a change that never happened. The lock
   * serialises them, so the second one's before-state is the first one's
   * after-state — which is what makes the audit trail reconstructable.
   */
  async function lockRole(
    tx: Prisma.TransactionClient,
    roleId: string,
  ): Promise<{ id: string; system: boolean; deactivatedAt: Date | null } | null> {
    const rows = await tx.$queryRaw<
      { id: string; system: boolean; deactivatedAt: Date | null }[]
    >`
      SELECT [id], [system], [deactivatedAt]
      FROM [dbo].[Role] WITH (UPDLOCK, HOLDLOCK)
      WHERE [id] = ${roleId}
    `;
    return rows[0] ?? null;
  }

  /**
   * Revokes the sessions and step-up grants of every account a privilege change
   * affected, in the SAME transaction as the change.
   *
   * Grants are deleted before sessions even though the session cascade would
   * take them anyway: the cascade gives no count, and this function's return
   * value is what a test asserts against and what an operator is shown. A
   * number nobody can check is a number nobody should believe.
   */
  async function invalidate(
    tx: Prisma.TransactionClient,
    accountIds: readonly string[],
  ): Promise<PrivilegeInvalidation> {
    if (accountIds.length === 0) {
      return { accountsAffected: 0, sessionsRevoked: 0, stepUpGrantsRevoked: 0 };
    }

    const grants = await tx.stepUpGrant.deleteMany({
      where: { userId: { in: [...accountIds] } },
    });
    const sessions = await tx.session.deleteMany({
      where: { userId: { in: [...accountIds] } },
    });

    return {
      accountsAffected: accountIds.length,
      sessionsRevoked: sessions.count,
      stepUpGrantsRevoked: grants.count,
    };
  }

  /** Every account currently holding one role. */
  async function holdersOf(
    tx: Prisma.TransactionClient,
    roleId: string,
  ): Promise<string[]> {
    const rows = await tx.roleAssignment.findMany({
      where: { roleId, revokedAt: null },
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.map((row) => row.userId);
  }

  /**
   * Writes the audit row for a privileged administrative act.
   *
   * `authorisingSource` carries the PERMISSION the actor used, which is the
   * honest answer to "what authorised this" — and the one thing an
   * investigation needs that the action name does not already say.
   */
  async function recordAudit(
    tx: Prisma.TransactionClient,
    actor: PrivilegedActor,
    input: {
      readonly action: string;
      readonly targetType: string;
      readonly targetId: string | null;
      readonly before?: Readonly<Record<string, string>>;
      readonly after?: Readonly<Record<string, string>>;
    },
  ): Promise<void> {
    await tx.auditLog.create({
      data: auditRow({
        action: input.action,
        actorType: 'user',
        actorId: actor.accountId,
        targetType: input.targetType,
        targetId: input.targetId,
        before: input.before,
        after: input.after,
        authorisingSource: actor.permission,
      }),
    });
  }

  async function roleSummary(
    tx: Prisma.TransactionClient,
    roleId: string,
  ): Promise<RoleSummary> {
    const role = await tx.role.findUnique({
      where: { id: roleId },
      include: ROLE_INCLUDE,
    });
    if (role === null) {
      throw new AuthorizationDataError('role-not-found', 'The role no longer exists.');
    }
    const activeAssignments = await tx.roleAssignment.count({
      where: { roleId, revokedAt: null },
    });
    return toRoleSummary(role, activeAssignments);
  }

  /** Refuses a bundle naming anything outside the immutable catalogue. */
  async function assertKnownPermissions(
    tx: Prisma.TransactionClient,
    permissions: readonly string[],
  ): Promise<string[]> {
    const unique = [...new Set(permissions)].sort();
    if (unique.length === 0) return unique;

    const known = await tx.permission.findMany({
      where: { key: { in: unique } },
      select: { key: true },
    });

    if (known.length !== unique.length) {
      const found = new Set(known.map((entry) => entry.key));
      const missing = unique.filter((key) => !found.has(key));
      throw new AuthorizationDataError(
        'unknown-permission',
        `Not in the permission catalogue: ${missing.join(', ')}.`,
      );
    }

    return unique;
  }

  return {
    /* ---- Catalogue and roles ------------------------------------------- */

    async listPermissions() {
      return prisma.permission.findMany({
        select: { key: true, description: true },
        orderBy: { key: 'asc' },
      });
    },

    async listRoles({ includeDeactivated }) {
      const roles = await prisma.role.findMany({
        where: includeDeactivated ? {} : { deactivatedAt: null },
        include: ROLE_INCLUDE,
        // Protected roles first, then alphabetically: the one role an operator
        // must not mistake for an ordinary one is never buried in the middle.
        orderBy: [{ system: 'desc' }, { name: 'asc' }],
      });

      const counts = await prisma.roleAssignment.groupBy({
        by: ['roleId'],
        where: { revokedAt: null },
        _count: { _all: true },
      });
      const byRole = new Map(counts.map((entry) => [entry.roleId, entry._count._all]));

      return roles.map((role) => toRoleSummary(role, byRole.get(role.id) ?? 0));
    },

    async findRoleByKey(key) {
      const role = await prisma.role.findUnique({
        where: { key },
        include: ROLE_INCLUDE,
      });
      if (role === null) return null;

      const activeAssignments = await prisma.roleAssignment.count({
        where: { roleId: role.id, revokedAt: null },
      });
      return toRoleSummary(role, activeAssignments);
    },

    async createCustomRole({ key, name, description, permissions, actor, auditAction }) {
      return prisma.$transaction(async (tx) => {
        const bundle = await assertKnownPermissions(tx, permissions);

        let created;
        try {
          created = await tx.role.create({
            // `system: false` is passed EXPLICITLY. There is no runtime path to
            // a protected role: the one that exists arrives with the migration,
            // and this is the only place a role is created.
            data: { key, name, description, system: false },
          });
        } catch (error) {
          if ((error as { code?: string }).code === 'P2002') {
            throw new AuthorizationDataError(
              'duplicate-role-key',
              `A role with the key '${key}' already exists.`,
            );
          }
          throw error;
        }

        if (bundle.length > 0) {
          await tx.rolePermission.createMany({
            data: bundle.map((permissionKey) => ({ roleId: created.id, permissionKey })),
          });
        }

        await recordAudit(tx, actor, {
          action: auditAction,
          targetType: 'role',
          targetId: created.id,
          after: { key, name, permissions: bundle.join(' ') },
        });

        // No invalidation: a role nobody holds yet changes nobody's authority.
        return roleSummary(tx, created.id);
      });
    },

    async updateCustomRoleDetails({ roleId, name, description, actor, auditAction }) {
      return prisma.$transaction(async (tx) => {
        const locked = await lockRole(tx, roleId);
        if (locked === null) {
          throw new AuthorizationDataError('role-not-found', 'No such role.');
        }
        if (locked.system) {
          throw new AuthorizationDataError(
            'role-protected',
            'A protected system role cannot be renamed.',
          );
        }

        const before = await tx.role.findUniqueOrThrow({
          where: { id: roleId },
          select: { name: true, description: true },
        });

        await tx.role.update({
          where: { id: roleId },
          data: { name, description, updatedAt: new Date() },
        });

        await recordAudit(tx, actor, {
          action: auditAction,
          targetType: 'role',
          targetId: roleId,
          before: { name: before.name },
          after: { name },
        });

        // DELIBERATELY NO INVALIDATION. A display name carries no authority, so
        // revoking every holder's session over a spelling correction would be
        // security theatre with a real cost to real people.
        return roleSummary(tx, roleId);
      });
    },

    async setCustomRolePermissions({ roleId, permissions, actor, auditAction }) {
      return prisma.$transaction(async (tx) => {
        const locked = await lockRole(tx, roleId);
        if (locked === null) {
          throw new AuthorizationDataError('role-not-found', 'No such role.');
        }
        if (locked.system) {
          throw new AuthorizationDataError(
            'role-protected',
            'A protected system role’s permission bundle is migration-controlled.',
          );
        }
        if (locked.deactivatedAt !== null) {
          throw new AuthorizationDataError(
            'role-deactivated',
            'A deactivated role grants nothing; reactivation is not a Phase-2 capability.',
          );
        }

        const after = await assertKnownPermissions(tx, permissions);

        const existing = await tx.rolePermission.findMany({
          where: { roleId },
          select: { permissionKey: true },
        });
        const before = existing.map((entry) => entry.permissionKey).sort();

        // SET SEMANTICS, expressed as a set difference rather than a
        // delete-all-and-reinsert. Rewriting unchanged rows would make every
        // edit look like a change to every permission in the concurrency
        // window, and would churn the composite primary key for nothing.
        const wanted = new Set(after);
        const held = new Set(before);

        const removed = before.filter((key) => !wanted.has(key));
        const added = after.filter((key) => !held.has(key));

        // NEVER SELF-APPLICABLE, BY THE BUNDLE ROUTE EITHER (SECURITY_BASELINE.md
        // §3.4 rule 6). Granting oneself a role is refused before this module is
        // reached; widening a role one already holds would be the same
        // self-elevation by another door — an administrator adding `fatwa.publish`
        // to their own custom role would hold it from their next sign-in. Narrowing
        // one's own role is not elevation and stays allowed. Checked inside the
        // transaction, against the live assignment, so it cannot be raced.
        if (added.length > 0) {
          const ownHolding = await tx.roleAssignment.count({
            where: { roleId, userId: actor.accountId, revokedAt: null },
          });
          if (ownHolding > 0) {
            throw new AuthorizationDataError(
              'self-elevation',
              'A role the actor holds cannot be widened by that actor.',
            );
          }
        }

        if (removed.length > 0) {
          await tx.rolePermission.deleteMany({
            where: { roleId, permissionKey: { in: removed } },
          });
        }
        if (added.length > 0) {
          await tx.rolePermission.createMany({
            data: added.map((permissionKey) => ({ roleId, permissionKey })),
          });
        }

        const changed = removed.length > 0 || added.length > 0;

        // Only an EFFECTIVE change invalidates. Re-saving the same bundle is
        // not a privilege event, and treating it as one would let an operator
        // sign every holder out by pressing save twice.
        const invalidation = changed
          ? await invalidate(tx, await holdersOf(tx, roleId))
          : { accountsAffected: 0, sessionsRevoked: 0, stepUpGrantsRevoked: 0 };

        if (changed) {
          await recordAudit(tx, actor, {
            action: auditAction,
            targetType: 'role',
            targetId: roleId,
            // THE BEFORE AND AFTER SET, in full, exactly as §30 requires —
            // not a diff. A diff is only interpretable beside a copy of the
            // state it applied to, which an investigation may not have.
            before: { permissions: before.join(' ') },
            after: { permissions: after.join(' ') },
          });
        }

        return { role: await roleSummary(tx, roleId), before, after, invalidation };
      });
    },

    async deactivateCustomRole({ roleId, actor, auditAction }) {
      return prisma.$transaction(async (tx) => {
        const locked = await lockRole(tx, roleId);
        if (locked === null) {
          throw new AuthorizationDataError('role-not-found', 'No such role.');
        }
        if (locked.system) {
          throw new AuthorizationDataError(
            'role-protected',
            'A protected system role cannot be deactivated.',
          );
        }
        if (locked.deactivatedAt !== null) {
          return {
            role: await roleSummary(tx, roleId),
            invalidation: {
              accountsAffected: 0,
              sessionsRevoked: 0,
              stepUpGrantsRevoked: 0,
            },
          };
        }

        const holders = await holdersOf(tx, roleId);

        // SOFT. The row and every assignment to it are retained: "who held
        // this between these dates" survives, and only the authority stops.
        await tx.role.update({
          where: { id: roleId },
          data: { deactivatedAt: new Date(), updatedAt: new Date() },
        });

        const invalidation = await invalidate(tx, holders);

        await recordAudit(tx, actor, {
          action: auditAction,
          targetType: 'role',
          targetId: roleId,
          before: { deactivated: 'false' },
          after: { deactivated: 'true', holders: String(holders.length) },
        });

        return { role: await roleSummary(tx, roleId), invalidation };
      });
    },

    /* ---- Assignments ----------------------------------------------------- */

    async listAssignments({ roleId, accountId, includeRevoked, limit, offset }) {
      const take = boundedLimit(limit);

      const rows = await prisma.roleAssignment.findMany({
        where: {
          ...(roleId === undefined ? {} : { roleId }),
          ...(accountId === undefined ? {} : { userId: accountId }),
          ...(includeRevoked ? {} : { revokedAt: null }),
        },
        include: {
          role: { select: { key: true, name: true } },
          user: { select: { email: true } },
        },
        // DETERMINISTIC. `grantedAt` alone is not: two grants in the same
        // transaction share a timestamp, and a page boundary between them would
        // show one row twice and another never.
        orderBy: [{ grantedAt: 'desc' }, { id: 'desc' }],
        skip: boundedOffset(offset),
        take: take + 1,
      });

      const page = rows.slice(0, take).map((row): RoleAssignmentRecord => ({
        id: row.id,
        roleId: row.roleId,
        roleKey: row.role.key,
        roleName: row.role.name,
        accountId: row.userId,
        accountEmail: row.user.email,
        grantedAt: row.grantedAt,
        grantedById: row.grantedById,
        grantedReason: row.grantedReason,
        revokedAt: row.revokedAt,
        revokedById: row.revokedById,
        revokedReason: row.revokedReason,
      }));

      return { items: page, more: rows.length > take };
    },

    async findAssignment(assignmentId) {
      const row = await prisma.roleAssignment.findUnique({
        where: { id: assignmentId },
        include: {
          role: { select: { key: true, name: true } },
          user: { select: { email: true } },
        },
      });

      if (row === null) return null;

      return {
        id: row.id,
        roleId: row.roleId,
        roleKey: row.role.key,
        roleName: row.role.name,
        accountId: row.userId,
        accountEmail: row.user.email,
        grantedAt: row.grantedAt,
        grantedById: row.grantedById,
        grantedReason: row.grantedReason,
        revokedAt: row.revokedAt,
        revokedById: row.revokedById,
        revokedReason: row.revokedReason,
      };
    },

    async grantRoleAssignment({ accountId, roleId, reason, actor, auditAction }) {
      // The same ordering as the revoke below, and for the same reason:
      // inserting a PROTECTED assignment fires the same trigger, so a grant
      // racing a revoke would otherwise meet it holding the opposite locks.
      //
      // Like the revoke, the lock is taken for every role rather than only the
      // protected one. For a protected assignment it adds no contention that
      // was not already there — the trigger takes the same lock a moment
      // later regardless — and for an ordinary role it serialises an operator
      // action against other operator actions, which is not a cost worth a
      // conditional that has to be right about which writes the trigger
      // watches.
      //
      // The outcome is CAPTURED rather than returned through the helper: what
      // this operation hands back is typed by the port it implements, and the
      // transaction that produced it never appears in that type
      // (ARCHITECTURE.md §4.1).
      //
      // It is captured on a HOLDER rather than in a bare local because the
      // compiler does not follow an assignment made inside a callback: a plain
      // `let` narrows to `never` after the null check below, which would make
      // the returned shape unchecked. A property keeps its declared type, so
      // the port's contract is still enforced here.
      const captured: {
        value: {
          readonly outcome: 'granted' | 'already-held';
          readonly invalidation: PrivilegeInvalidation;
        } | null;
      } = { value: null };

      await withProtectedInvariantMutation(async (tx) => {
        const role = await tx.role.findUnique({
          where: { id: roleId },
          select: { id: true, key: true, deactivatedAt: true },
        });
        if (role === null) {
          throw new AuthorizationDataError('role-not-found', 'No such role.');
        }
        if (role.deactivatedAt !== null) {
          throw new AuthorizationDataError(
            'role-deactivated',
            'A deactivated role grants nothing and cannot be assigned.',
          );
        }

        const account = await tx.user.findUnique({
          where: { id: accountId },
          select: { id: true, status: true },
        });
        if (account === null || account.status === 'closed') {
          throw new AuthorizationDataError(
            'account-not-found',
            'No such account, or the account is closed.',
          );
        }

        try {
          await tx.roleAssignment.create({
            data: {
              userId: accountId,
              roleId,
              grantedById: actor.accountId,
              grantedReason: reason,
            },
          });
        } catch (error) {
          // THE FILTERED UNIQUE INDEX, doing its job. Two concurrent grants
          // produce one row and one audit record; the loser reports what is
          // true — the account already holds the role — rather than failing.
          if ((error as { code?: string }).code === 'P2002') {
            captured.value = {
              outcome: 'already-held',
              invalidation: {
                accountsAffected: 0,
                sessionsRevoked: 0,
                stepUpGrantsRevoked: 0,
              },
            };
            return;
          }
          throw error;
        }

        const invalidation = await invalidate(tx, [accountId]);

        await recordAudit(tx, actor, {
          action: auditAction,
          targetType: 'user',
          targetId: accountId,
          after: { role: role.key, granted: 'true' },
        });

        captured.value = { outcome: 'granted', invalidation };
      });

      if (captured.value === null) throw new Error('The grant produced no outcome.');
      return captured.value;
    },

    async revokeRoleAssignment({ assignmentId, reason, actor, auditAction }) {
      // CAPTURED on a holder, for both reasons the grant above gives: a
      // transaction handle never appears in what this boundary hands back, and
      // a property keeps the declared type the port checks against.
      const captured: {
        value: {
          readonly outcome: 'revoked' | 'not-held';
          readonly invalidation: PrivilegeInvalidation;
        } | null;
      } = { value: null };

      try {
        // THE INVARIANT LOCK IS TAKEN FIRST, before the row below is touched.
        //
        // Revoking an assignment is the mutation the protected trigger exists
        // for, and taking its lock only once the row lock is already held is
        // what made two administrators revoking each other deadlock on every
        // attempt (`final-administrator.ts`).
        //
        // It is taken for EVERY role rather than only the protected one. The
        // assignment's role is not known until it is read, and deciding the
        // lock from a read taken outside the transaction that writes is the
        // shape this is trying to remove. Role revocation is an operator
        // action at operator volumes, so serialising all of them costs nothing
        // that determinism here is not worth.
        //
        // The protected paths gain no new contention from this: the trigger
        // takes the very same lock, and took it before. Only the ORDER moved.
        await withProtectedInvariantMutation(async (tx) => {
          // Conditional on `revokedAt IS NULL`, so two concurrent revokes produce
          // one state change and one audit record — the same shape the grant path
          // gets from its unique index.
          const revoked = await tx.roleAssignment.updateMany({
            where: { id: assignmentId, revokedAt: null },
            data: {
              revokedAt: new Date(),
              revokedById: actor.accountId,
              revokedReason: reason,
            },
          });

          if (revoked.count === 0) {
            const exists = await tx.roleAssignment.findUnique({
              where: { id: assignmentId },
              select: { id: true },
            });
            if (exists === null) {
              throw new AuthorizationDataError(
                'assignment-not-found',
                'No such role assignment.',
              );
            }
            captured.value = {
              outcome: 'not-held',
              invalidation: {
                accountsAffected: 0,
                sessionsRevoked: 0,
                stepUpGrantsRevoked: 0,
              },
            };
            return;
          }

          const assignment = await tx.roleAssignment.findUniqueOrThrow({
            where: { id: assignmentId },
            include: { role: { select: { key: true } } },
          });

          const invalidation = await invalidate(tx, [assignment.userId]);

          await recordAudit(tx, actor, {
            action: auditAction,
            targetType: 'user',
            targetId: assignment.userId,
            before: { role: assignment.role.key, held: 'true' },
            after: { role: assignment.role.key, held: 'false' },
          });

          captured.value = { outcome: 'revoked', invalidation };
        });

        if (captured.value === null) {
          throw new Error('The revocation produced no outcome.');
        }
        return captured.value;
      } catch (error) {
        // ONLY the semantic refusal becomes `final-administrator`. A transient
        // serialisation failure that survived the bounded retry arrives here
        // as a safe `ProtectedMutationUnavailableError`, whose reason the
        // application layer maps to generic unavailability instead of
        // claiming an invariant refusal that the database never made.
        if (classifyProtectedMutationError(error) === 'final-administrator') {
          throw new AuthorizationDataError(
            'final-administrator',
            'The final usable Platform Administrator cannot be removed.',
          );
        }
        throw error;
      }
    },

    /* ---- Accounts --------------------------------------------------------- */

    async searchAccounts({ query, status, limit, offset }) {
      const take = boundedLimit(limit);

      const rows = await prisma.user.findMany({
        where: {
          ...(status === null ? {} : { status }),
          ...(query === null || query.trim() === ''
            ? {}
            : {
                // Prefix-anchored on both columns. A leading wildcard cannot
                // use an index, so `%term%` over a table that grows forever is
                // a scan on every keystroke (SECURITY_BASELINE.md §28, §41).
                OR: [
                  { email: { startsWith: query.trim() } },
                  { name: { startsWith: query.trim() } },
                ],
              }),
        },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          emailVerified: true,
          createdAt: true,
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: boundedOffset(offset),
        take: take + 1,
      });

      const page = rows.slice(0, take);

      // ONE grouped query for the whole page, not one per row. A per-row lookup
      // here is the N+1 the performance rule names (CLAUDE.md §41).
      const assignments =
        page.length === 0
          ? []
          : await prisma.roleAssignment.findMany({
              where: {
                userId: { in: page.map((row) => row.id) },
                revokedAt: null,
                role: { deactivatedAt: null },
              },
              select: { userId: true, role: { select: { key: true } } },
            });

      const byAccount = new Map<string, string[]>();
      for (const assignment of assignments) {
        const keys = byAccount.get(assignment.userId) ?? [];
        keys.push(assignment.role.key);
        byAccount.set(assignment.userId, keys);
      }

      return {
        items: page.map((row): AccountSummary => ({
          id: row.id,
          email: row.email,
          name: row.name,
          status: row.status as AccountStatus,
          emailVerified: row.emailVerified,
          createdAt: row.createdAt,
          roleKeys: (byAccount.get(row.id) ?? []).sort(),
        })),
        more: rows.length > take,
      };
    },

    async findAccountSummary(accountId) {
      const row = await prisma.user.findUnique({
        where: { id: accountId },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          emailVerified: true,
          createdAt: true,
          roleAssignments: {
            where: { revokedAt: null, role: { deactivatedAt: null } },
            select: { role: { select: { key: true } } },
          },
        },
      });

      if (row === null) return null;

      return {
        id: row.id,
        email: row.email,
        name: row.name,
        status: row.status as AccountStatus,
        emailVerified: row.emailVerified,
        createdAt: row.createdAt,
        roleKeys: row.roleAssignments.map((entry) => entry.role.key).sort(),
      };
    },

    async closedAccountIds(accountIds) {
      // BOUNDED BEFORE THE QUERY IS BUILT. The caller supplies the set, and a
      // caller is not a place to enforce a bound: an `IN` list of arbitrary
      // length is a query whose plan changes with its input.
      const wanted = accountIds.slice(0, MAX_PAGE);
      if (wanted.length === 0) return [];

      const rows = await prisma.user.findMany({
        where: { id: { in: [...wanted] }, status: 'closed' },
        // THE IDENTIFIER AND NOTHING ELSE. Selecting the address here would put
        // it one refactor away from a caller that has no business holding one
        // (SECURITY_BASELINE.md §19.1).
        select: { id: true },
      });

      return rows.map((row) => row.id);
    },

    /* ---- Audit ------------------------------------------------------------ */

    async listAuditRecords({ action, actorId, limit, offset }) {
      const take = boundedLimit(limit);

      const rows = await prisma.auditLog.findMany({
        // INDEXED FILTERS ONLY (§28). `action` is covered by
        // `AuditLog_action_occurredAt_idx` and `actorId` by its own index;
        // nothing else is offered, because an unindexed predicate over a table
        // that only grows is a scan on every page.
        where: {
          ...(action === null ? {} : { action }),
          ...(actorId === null ? {} : { actorId }),
        },
        select: {
          id: true,
          occurredAt: true,
          action: true,
          actorType: true,
          actorId: true,
          targetType: true,
          targetId: true,
          authorisingSource: true,
          // `beforeState`/`afterState` are NOT selected. They are recorded and
          // they are not rendered: a payload column on a screen is where a
          // sensitive snapshot ends up in front of everyone who may read the
          // log (§13.4).
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: boundedOffset(offset),
        take: take + 1,
      });

      const page: AuditPage = {
        items: rows.slice(0, take) as AuditRecordView[],
        more: rows.length > take,
      };
      return page;
    },

    /* ---- Step-up ----------------------------------------------------------- */

    async createStepUpGrant({ accountId, sessionId, purpose, lifetimeSeconds }) {
      const grant = await prisma.stepUpGrant.create({
        data: {
          userId: accountId,
          sessionId,
          purpose,
          expiresAt: new Date(Date.now() + lifetimeSeconds * 1000),
        },
        select: { id: true, purpose: true, expiresAt: true },
      });

      return {
        id: grant.id,
        purpose: grant.purpose as StepUpGrantSummary['purpose'],
        expiresAt: grant.expiresAt,
      };
    },

    async revokeStepUpGrantsForAccount(accountId) {
      const removed = await prisma.stepUpGrant.deleteMany({
        where: { userId: accountId },
      });
      return removed.count;
    },

    /* ---- Privileged posture ------------------------------------------------ */

    async readPosture(accountId) {
      return createAuthorizationReader().privilegedPosture(accountId);
    },

    async recordSecondFactorVerified(accountId) {
      const now = new Date();
      await prisma.privilegedSecurityPosture.upsert({
        where: { userId: accountId },
        create: { userId: accountId, secondFactorVerifiedAt: now, updatedAt: now },
        // The re-enrolment demand is CLEARED here and nowhere else: enrolling
        // again is exactly what it was waiting for.
        update: {
          secondFactorVerifiedAt: now,
          reenrolmentRequiredAt: null,
          updatedAt: now,
        },
      });
    },

    async recordRecoveryCodesConfirmed(accountId, issuanceReceipt) {
      const issuedAt = new Date(issuanceReceipt);
      if (Number.isNaN(issuedAt.getTime())) return false;

      const now = new Date();
      const confirmed = await prisma.privilegedSecurityPosture.updateMany({
        where: {
          userId: accountId,
          recoveryCodesIssuedAt: issuedAt,
          recoveryCodesConfirmedAt: null,
        },
        data: { recoveryCodesConfirmedAt: now, updatedAt: now },
      });
      return confirmed.count === 1;
    },

    async clearSecondFactorPosture(accountId) {
      const now = new Date();
      await prisma.privilegedSecurityPosture.updateMany({
        where: { userId: accountId },
        // Cleared to nulls, never deleted. The row is how the platform knows
        // this account once held privileged authority.
        data: {
          secondFactorVerifiedAt: null,
          recoveryCodesIssuedAt: null,
          recoveryCodesConfirmedAt: null,
          updatedAt: now,
        },
      });
    },

    /* ---- Bootstrap ---------------------------------------------------------- */

    async readBootstrapStatus(): Promise<BootstrapStatus> {
      const [record, administratorCount] = await Promise.all([
        prisma.identityBootstrap.findFirst({
          select: { completedAt: true, operatorLogin: true, ticket: true },
        }),
        prisma.roleAssignment.count({
          where: { revokedAt: null, role: { key: PLATFORM_ADMINISTRATOR_ROLE } },
        }),
      ]);

      return {
        completed: record !== null,
        completedAt: record?.completedAt ?? null,
        operator: record?.operatorLogin ?? null,
        ticket: record?.ticket ?? null,
        administratorCount,
      };
    },
  };
}
