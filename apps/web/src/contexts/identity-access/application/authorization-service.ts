import type {
  AccountPage,
  AccountStatus,
  AccountSummary,
  AssignmentPage,
  AuditPage,
  AuthorizationPersistencePort,
  BootstrapStatus,
  PermissionKey,
  PrivilegeInvalidation,
  PrivilegedActor,
  RoleSummary,
} from '@minhaj/contracts/identity';
import {
  PERMISSION_CATALOGUE,
  PLATFORM_ADMINISTRATOR_ROLE,
} from '@minhaj/contracts/identity';

import {
  isProtectedRoleKey,
  isSelfElevation,
  wouldRemoveFinalAdministrator,
} from '../domain/authorization.ts';

/**
 * Identity & Access — the ADMINISTRATION application service.
 *
 * WHAT IT IS. The policy for changing privilege: what a role may be, who may
 * hold one, what a change costs and what it invalidates. The persistence port
 * beneath performs the writes those decisions imply and enforces the
 * invariants that are properties of the data; this decides everything else.
 *
 * WHAT IT IS NOT. It is not the authorisation CHECK. Whether the caller may
 * perform any of these is settled before they are reachable, by the
 * authorisation service in `packages/server-core` — which is why every mutating
 * method takes a `PrivilegedActor` rather than an account id. This service then
 * asks that runtime to authenticate the exact minted object and re-read its
 * permission, privileged posture and purpose-bound step-up grant immediately
 * before each write (SECURITY_BASELINE.md §3.4 rule 2).
 *
 * Layer 1: Layer-0 interfaces only, never infrastructure and never a later
 * context (DOMAIN_MODEL.md §3.1).
 */

export type AuthorizationFailure =
  /** The role, account or assignment named does not exist. */
  | 'not-found'
  /** A protected system role cannot be changed through ordinary administration. */
  | 'protected-role'
  /** A deactivated role grants nothing and cannot be edited or assigned. */
  | 'role-deactivated'
  | 'duplicate-key'
  | 'unknown-permission'
  /** The actor tried to change their own privilege. */
  | 'self-elevation'
  /** The last live Platform Administrator assignment may not be revoked. */
  | 'final-administrator'
  /** The target account is not eligible to hold a protected role. */
  | 'ineligible-target'
  | 'unavailable';

export interface AuthorizationError {
  readonly ok: false;
  readonly failure: AuthorizationFailure;
}

export type AuthorizationResult<T> = ({ readonly ok: true } & T) | AuthorizationError;

function fail(failure: AuthorizationFailure): AuthorizationError {
  return { ok: false, failure };
}

/** Maps a data-invariant refusal from the adapter onto a failure class. */
function classify(error: unknown): AuthorizationFailure {
  const reason = (error as { reason?: unknown } | null)?.reason;

  switch (reason) {
    case 'role-not-found':
    case 'account-not-found':
    case 'assignment-not-found':
      return 'not-found';
    case 'role-protected':
      return 'protected-role';
    case 'role-deactivated':
      return 'role-deactivated';
    case 'duplicate-role-key':
      return 'duplicate-key';
    case 'unknown-permission':
      return 'unknown-permission';
    case 'final-administrator':
      return 'final-administrator';
    default:
      return 'unavailable';
  }
}

/** The audited action names this context owns. */
const AUDIT = {
  roleCreated: 'identity.role.created',
  roleUpdated: 'identity.role.updated',
  rolePermissionsChanged: 'identity.role.permissions-changed',
  roleDeactivated: 'identity.role.deactivated',
  assignmentGranted: 'identity.assignment.granted',
  assignmentRevoked: 'identity.assignment.revoked',
} as const;

export interface AuthorizationServiceDependencies {
  readonly authorization: AuthorizationPersistencePort;
  readonly verifyActor: (input: {
    readonly actor: PrivilegedActor;
    readonly permission: PermissionKey;
    readonly stepUp: 'privilege-administration';
  }) => Promise<boolean>;
}

export function createAuthorizationService({
  authorization,
  verifyActor,
}: AuthorizationServiceDependencies) {
  async function actorIsCurrent(
    actor: PrivilegedActor,
    permission: PermissionKey,
  ): Promise<boolean> {
    return verifyActor({ actor, permission, stepUp: 'privilege-administration' });
  }

  /**
   * The catalogue as this build knows it, joined to what the database holds.
   *
   * BOTH, deliberately. The database is authoritative for what a grant can
   * reference; the compiled catalogue is what the interface can describe. A
   * key present in one and not the other is a deployment that has drifted, and
   * showing it as "unknown" is more honest than hiding it.
   */
  async function catalogue(): Promise<
    readonly { key: string; description: string; known: boolean }[]
  > {
    const stored = await authorization.listPermissions();
    const described = new Map(
      PERMISSION_CATALOGUE.map((entry) => [entry.key, entry.description]),
    );

    return stored.map((entry) => ({
      key: entry.key,
      description: described.get(entry.key) ?? entry.description,
      known: described.has(entry.key),
    }));
  }

  return {
    catalogue,

    async listRoles(input: { readonly includeDeactivated: boolean }) {
      return authorization.listRoles(input);
    },

    async findRole(key: string): Promise<RoleSummary | null> {
      return authorization.findRoleByKey(key);
    },

    /* ---- Custom role lifecycle ------------------------------------------ */

    async createCustomRole(
      actor: PrivilegedActor,
      input: {
        readonly key: string;
        readonly name: string;
        readonly description: string;
        readonly permissions: readonly string[];
      },
    ): Promise<AuthorizationResult<{ role: RoleSummary }>> {
      if (!(await actorIsCurrent(actor, 'roles.administer'))) return fail('unavailable');

      // The key schema already refuses a protected one; this is the second
      // net, because the schema lives at the edge and this rule is the domain's.
      if (isProtectedRoleKey(input.key)) return fail('protected-role');

      try {
        const role = await authorization.createCustomRole({
          ...input,
          actor,
          auditAction: AUDIT.roleCreated,
        });
        return { ok: true, role };
      } catch (error) {
        return fail(classify(error));
      }
    },

    async renameCustomRole(
      actor: PrivilegedActor,
      input: {
        readonly roleId: string;
        readonly name: string;
        readonly description: string;
      },
    ): Promise<AuthorizationResult<{ role: RoleSummary }>> {
      if (!(await actorIsCurrent(actor, 'roles.administer'))) return fail('unavailable');

      try {
        const role = await authorization.updateCustomRoleDetails({
          ...input,
          actor,
          auditAction: AUDIT.roleUpdated,
        });
        return { ok: true, role };
      } catch (error) {
        return fail(classify(error));
      }
    },

    /**
     * Replaces a custom role's permission bundle.
     *
     * An EFFECTIVE change revokes the sessions and step-up grants of everyone
     * holding the role, because what they are permitted to do has changed and
     * a live session is authority they were given under the old bundle
     * (DOMAIN_MODEL.md §4.6, SECURITY_BASELINE.md §8.1). Live authorisation
     * would already refuse them; revoking means there is nothing left to
     * refuse.
     */
    async setRolePermissions(
      actor: PrivilegedActor,
      input: { readonly roleId: string; readonly permissions: readonly string[] },
    ): Promise<
      AuthorizationResult<{
        role: RoleSummary;
        before: readonly string[];
        after: readonly string[];
        invalidation: PrivilegeInvalidation;
      }>
    > {
      if (!(await actorIsCurrent(actor, 'permissions.grant'))) {
        return fail('unavailable');
      }

      try {
        const outcome = await authorization.setCustomRolePermissions({
          ...input,
          actor,
          auditAction: AUDIT.rolePermissionsChanged,
        });
        return { ok: true, ...outcome };
      } catch (error) {
        return fail(classify(error));
      }
    },

    async deactivateCustomRole(
      actor: PrivilegedActor,
      input: { readonly roleId: string },
    ): Promise<
      AuthorizationResult<{ role: RoleSummary; invalidation: PrivilegeInvalidation }>
    > {
      if (!(await actorIsCurrent(actor, 'roles.administer'))) return fail('unavailable');

      try {
        const outcome = await authorization.deactivateCustomRole({
          ...input,
          actor,
          auditAction: AUDIT.roleDeactivated,
        });
        return { ok: true, ...outcome };
      } catch (error) {
        return fail(classify(error));
      }
    },

    /* ---- Assignments ----------------------------------------------------- */

    async listAssignments(input: {
      readonly roleId?: string;
      readonly accountId?: string;
      readonly includeRevoked: boolean;
      readonly limit: number;
      readonly offset: number;
    }): Promise<AssignmentPage> {
      return authorization.listAssignments(input);
    },

    /**
     * Grants a role to an account.
     *
     * THREE REFUSALS BEFORE THE WRITE, and each is a different rule:
     *
     *   - SELF-ELEVATION. An administrator may not add to their own authority,
     *     whatever the role (SECURITY_BASELINE.md §3.4 rule 6). A second
     *     administrator does it instead, and the very first one comes from the
     *     host-only bootstrap.
     *   - PROTECTED-ROLE ELIGIBILITY. The protected role may only reach an
     *     account that is active and has proved its address — the same
     *     condition the bootstrap procedure enforces, because an administrator
     *     provisioned onto an unverified address is an administrator whose
     *     mailbox nobody has shown is theirs.
     *   - A DEACTIVATED role grants nothing, refused by the adapter.
     */
    async grantRole(
      actor: PrivilegedActor,
      input: {
        readonly accountId: string;
        readonly roleId: string;
        readonly reason: string | null;
      },
    ): Promise<
      AuthorizationResult<{
        outcome: 'granted' | 'already-held';
        invalidation: PrivilegeInvalidation;
      }>
    > {
      if (!(await actorIsCurrent(actor, 'permissions.grant'))) {
        return fail('unavailable');
      }

      if (
        isSelfElevation({ actorId: actor.accountId, targetAccountId: input.accountId })
      ) {
        return fail('self-elevation');
      }

      const role = await authorization.listRoles({ includeDeactivated: true });
      const target = role.find((entry) => entry.id === input.roleId);
      if (target === undefined) return fail('not-found');

      if (isProtectedRoleKey(target.key)) {
        const account = await authorization.findAccountSummary(input.accountId);
        if (account === null) return fail('not-found');
        if (account.status !== 'active' || !account.emailVerified) {
          return fail('ineligible-target');
        }
      }

      try {
        const outcome = await authorization.grantRoleAssignment({
          ...input,
          actor,
          auditAction: AUDIT.assignmentGranted,
        });
        return { ok: true, ...outcome };
      } catch (error) {
        return fail(classify(error));
      }
    },

    /**
     * Revokes a live assignment.
     *
     * Retains the row. Refuses to remove the LAST live Platform Administrator,
     * because the bootstrap self-closes after its first success and there is no
     * supported path back from a platform with no administrator.
     */
    async revokeRole(
      actor: PrivilegedActor,
      input: { readonly assignmentId: string; readonly reason: string | null },
    ): Promise<
      AuthorizationResult<{
        outcome: 'revoked' | 'not-held';
        invalidation: PrivilegeInvalidation;
      }>
    > {
      if (!(await actorIsCurrent(actor, 'permissions.grant'))) {
        return fail('unavailable');
      }

      const assignment = await authorization.findAssignment(input.assignmentId);
      if (assignment === null) return fail('not-found');

      const administrators = await authorization.findRoleByKey(
        PLATFORM_ADMINISTRATOR_ROLE,
      );

      if (
        administrators !== null &&
        assignment.roleId === administrators.id &&
        assignment.revokedAt === null &&
        wouldRemoveFinalAdministrator({
          roleKey: administrators.key,
          liveAssignments: administrators.activeAssignments,
        })
      ) {
        return fail('final-administrator');
      }

      try {
        const outcome = await authorization.revokeRoleAssignment({
          ...input,
          actor,
          auditAction: AUDIT.assignmentRevoked,
        });
        return { ok: true, ...outcome };
      } catch (error) {
        return fail(classify(error));
      }
    },

    /* ---- Accounts, audit and bootstrap status ---------------------------- */

    async searchAccounts(input: {
      readonly query: string | null;
      readonly status: AccountStatus | null;
      readonly limit: number;
      readonly offset: number;
    }): Promise<AccountPage> {
      return authorization.searchAccounts(input);
    },

    async findAccount(accountId: string): Promise<AccountSummary | null> {
      return authorization.findAccountSummary(accountId);
    },

    /**
     * Of the accounts named, those this context has CLOSED.
     *
     * EXPOSED FOR THE CROSS-OWNER DISPOSITION, and shaped so that it can be
     * used for nothing else. Identity owns account closure (DOMAIN_MODEL.md
     * §4.6); the other semantic owners dispose of their own data afterwards
     * (SECURITY_BASELINE.md §19.1), and an owner whose disposal was interrupted
     * has to be able to find out. It answers with identifiers the caller
     * already supplied and discloses nothing about the accounts themselves, so
     * it is not a route to the directory `users.read` guards.
     *
     * NO PERMISSION IS CHECKED HERE, and none is appropriate: the caller is the
     * Layer-4 closure coordinator acting on behalf of the person who closed
     * their own account, not an operator reading a list.
     */
    async closedAccounts(accountIds: readonly string[]): Promise<readonly string[]> {
      if (accountIds.length === 0) return [];
      return authorization.closedAccountIds(accountIds);
    },

    async listAuditRecords(input: {
      readonly action: string | null;
      readonly actorId: string | null;
      readonly limit: number;
      readonly offset: number;
    }): Promise<AuditPage> {
      return authorization.listAuditRecords(input);
    },

    async bootstrapStatus(): Promise<BootstrapStatus> {
      return authorization.readBootstrapStatus();
    },
  };
}

export type AuthorizationAdminService = ReturnType<typeof createAuthorizationService>;
