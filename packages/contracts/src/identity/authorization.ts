import type { AccountStatus } from './values.ts';
import type { PermissionKey, StepUpPurpose } from './permissions.ts';

/**
 * The ports between Identity's authorisation surface and its private adapters.
 *
 * Here for the same reason the authentication ports are (see `./ports.ts`): the
 * context lives under `apps/web/src/contexts/`, the adapter is physically
 * inside `packages/database`, and neither may import the other.
 *
 * READ AND WRITE ARE SEPARATE PORTS, and that split is the point.
 *
 * `AuthorizationReaderPort` is what the reusable authorisation service in
 * `packages/server-core` receives — three read operations, nothing else, so the
 * realtime transport can later verify authority without acquiring the ability
 * to change any of it (ARCHITECTURE.md §3.1.2, §3.1.3).
 *
 * `AuthorizationPersistencePort` is the administrative side, reached only by
 * the Identity context. Every operation on it is a NAMED administrative act
 * with its own invariants, never a generic repository: there is no `update`,
 * no `find(where)`, no transaction handle and no delegate.
 */

/* ===========================================================================
 * The read side — live authorisation
 * ========================================================================= */

/**
 * The privileged second-factor POSTURE of one account.
 *
 * DISTINCT FROM STEP-UP, and the distinction is the whole of §8:
 *
 *   - posture answers "is this account allowed to hold high-consequence
 *     authority at all", and is a durable property of the account;
 *   - a step-up grant answers "did this person prove themselves a moment ago",
 *     and is a short-lived property of one session.
 *
 * Neither substitutes for the other. A fresh step-up on an account with no
 * enrolled factor proves a password was typed, which is exactly what a stolen
 * password gives an attacker; an enrolled factor with no recent proof is a
 * long-lived session, which is what step-up exists because of.
 */
export interface PrivilegedPosture {
  /** A verified TOTP factor exists, according to the library's own state. */
  readonly secondFactorEnrolled: boolean;
  /**
   * A set of recovery codes has been issued and is the current one.
   *
   * SEPARATE FROM ENROLMENT, because the two halves of setting up a factor are
   * completed independently and in whichever order the person works through
   * the page. The codes are displayed once, at the moment they are issued —
   * before any code from the authenticator has been typed — so "I have saved
   * these" has to be answerable then. Requiring a verified factor first would
   * refuse the acknowledgement at the only moment the codes are on screen, and
   * leave the account permanently short of a complete posture.
   */
  readonly recoveryCodesIssued: boolean;
  /** The recovery codes were issued AND confirmed as stored. */
  readonly recoveryCodesConfirmed: boolean;
  /**
   * Operational recovery has reset this account's factor and requires it to be
   * enrolled again before privileged capability returns.
   */
  readonly reenrolmentRequired: boolean;
}

/** A live step-up grant, as the authorisation service sees it. */
export interface StepUpGrantSummary {
  readonly id: string;
  readonly purpose: StepUpPurpose;
  readonly expiresAt: Date;
}

/**
 * THE narrow reader.
 *
 * Three operations, all read-only, all scoped to one account. Holding it
 * confers no ability to grant, revoke, enrol or elevate.
 */
export interface AuthorizationReaderPort {
  /**
   * Every permission the account currently holds.
   *
   * COMPUTED LIVE on each call, from current assignments, active roles and the
   * current bundle — never from a cached projection and never from the session
   * (SECURITY_BASELINE.md §3.4 rule 5). A revoked assignment stops granting on
   * the next request, not on the next sign-in.
   */
  effectivePermissions(accountId: string): Promise<readonly string[]>;

  /** The account's live step-up grant for one purpose and session, if any. */
  findStepUpGrant(input: {
    readonly accountId: string;
    readonly sessionId: string;
    readonly purpose: StepUpPurpose;
  }): Promise<StepUpGrantSummary | null>;

  privilegedPosture(accountId: string): Promise<PrivilegedPosture>;
}

/* ===========================================================================
 * Administrative values
 * ========================================================================= */

export interface RoleSummary {
  readonly id: string;
  /** Stable code. Protected roles keep theirs for the platform's life. */
  readonly key: string;
  readonly name: string;
  readonly description: string;
  /** Protected system role: runtime-immutable foundation data. */
  readonly system: boolean;
  readonly deactivatedAt: Date | null;
  readonly permissions: readonly string[];
  /** Accounts currently holding it. Bounded aggregate, never a user list. */
  readonly activeAssignments: number;
}

export interface RoleAssignmentRecord {
  readonly id: string;
  readonly roleId: string;
  readonly roleKey: string;
  readonly roleName: string;
  readonly accountId: string;
  readonly accountEmail: string;
  readonly grantedAt: Date;
  readonly grantedById: string | null;
  readonly grantedReason: string | null;
  readonly revokedAt: Date | null;
  readonly revokedById: string | null;
  readonly revokedReason: string | null;
}

/** An account as the user-administration surface shows it. */
export interface AccountSummary {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly status: AccountStatus;
  readonly emailVerified: boolean;
  readonly createdAt: Date;
  readonly roleKeys: readonly string[];
}

/**
 * One audit row, as the read-only admin view shows it.
 *
 * NO STATE PAYLOAD. `beforeState`/`afterState` are recorded — §30 requires the
 * before and after permission SET for a bundle change — but they are not
 * rendered: a payload column on a screen is where a sensitive snapshot ends up
 * being displayed to everyone who may read the log (SECURITY_BASELINE.md
 * §13.4, §28).
 */
export interface AuditRecordView {
  readonly id: string;
  readonly occurredAt: Date;
  readonly action: string;
  readonly actorType: string;
  readonly actorId: string | null;
  readonly targetType: string;
  readonly targetId: string | null;
  readonly authorisingSource: string | null;
}

/**
 * One page of a bounded listing — stated CONCRETELY, once per listing.
 *
 * A generic `Page<T>` would be the same hole a generic `Result<T>` is on an
 * encapsulation boundary: `T` may be instantiated with anything, including a
 * client, a delegate or a transaction handle, so a surface built on it cannot
 * be SHOWN to be narrow (ARCHITECTURE.md §6.3 rule 13). Three small concrete
 * shapes prove what one generic one only asserts, and the analyser can read
 * them.
 */
export interface AccountPage {
  readonly items: readonly AccountSummary[];
  /** More rows exist beyond this page. */
  readonly more: boolean;
}

export interface AssignmentPage {
  readonly items: readonly RoleAssignmentRecord[];
  readonly more: boolean;
}

export interface AuditPage {
  readonly items: readonly AuditRecordView[];
  readonly more: boolean;
}

/** The one-time bootstrap's state, for the read-only security surface. */
export interface BootstrapStatus {
  readonly completed: boolean;
  readonly completedAt: Date | null;
  /** The DB login that performed it — never an application identity. */
  readonly operator: string | null;
  readonly ticket: string | null;
  /** Accounts currently holding the protected administrator role. */
  readonly administratorCount: number;
}

/**
 * Who performed a privileged administrative act.
 *
 * The `authorisation` marker is set by the authorisation service after
 * permission, posture and step-up have ALL been verified. An administrative
 * operation takes this value rather than a bare account id, so correct use is
 * the natural shape at call sites. Because a structural TypeScript value can
 * still be forged at runtime, the sensitive service re-verifies that the same
 * authorisation service minted this exact instance and that its authority is
 * still live (SECURITY_BASELINE.md §3.4 rule 2).
 */
export interface PrivilegedActor {
  readonly authorisation: 'verified';
  readonly accountId: string;
  readonly sessionId: string;
  readonly permission: PermissionKey;
  readonly stepUp: StepUpPurpose;
  readonly stepUpGrantId: string;
}

/* ===========================================================================
 * The write side — administration
 * ========================================================================= */

export interface CreateCustomRoleInput {
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly permissions: readonly string[];
  readonly actor: PrivilegedActor;
  /**
   * The audited action name, e.g. `identity.role.created`.
   *
   * THE NAME comes from the context, which owns the vocabulary; the PAYLOAD is
   * composed inside the transaction, which is the only place the before and
   * after state is known. Passing a finished audit record in would mean
   * composing it from values read before the write — and a bundle change's
   * "before" read outside the transaction is a value another writer can move.
   */
  readonly auditAction: string;
}

/**
 * What a privilege change invalidated.
 *
 * Returned so the caller can report it and so a test can assert it happened,
 * rather than trusting that a write somewhere else ran.
 */
export interface PrivilegeInvalidation {
  readonly accountsAffected: number;
  readonly sessionsRevoked: number;
  readonly stepUpGrantsRevoked: number;
}

/**
 * IDENTITY'S AUTHORISATION PERSISTENCE.
 *
 * Every mutation below performs its privilege invalidation and writes its audit
 * row INSIDE the transaction that makes the change. That is not tidiness: a
 * bundle change that committed while the session revocation did not would leave
 * live sessions whose holder has authority the record says was removed, and the
 * record would be the thing that is wrong.
 */
export interface AuthorizationPersistencePort {
  /* ---- Catalogue and roles -------------------------------------------- */

  /** The immutable catalogue, as the database holds it. */
  listPermissions(): Promise<readonly { key: string; description: string }[]>;

  listRoles(input: {
    readonly includeDeactivated: boolean;
  }): Promise<readonly RoleSummary[]>;

  findRoleByKey(key: string): Promise<RoleSummary | null>;

  createCustomRole(input: CreateCustomRoleInput): Promise<RoleSummary>;

  /**
   * Renames a custom role.
   *
   * NO INVALIDATION, deliberately. A display name carries no authority, so
   * revoking every holder's session over a spelling correction would be
   * security theatre with a real cost (CLAUDE.md §9).
   */
  updateCustomRoleDetails(input: {
    readonly roleId: string;
    readonly name: string;
    readonly description: string;
    readonly actor: PrivilegedActor;
    readonly auditAction: string;
  }): Promise<RoleSummary>;

  /**
   * Replaces a custom role's permission bundle. SET semantics.
   *
   * Race-safe and duplicate-free by the composite primary key, and audited with
   * the before and after SET (SECURITY_BASELINE.md §30).
   */
  setCustomRolePermissions(input: {
    readonly roleId: string;
    readonly permissions: readonly string[];
    readonly actor: PrivilegedActor;
    readonly auditAction: string;
  }): Promise<{
    readonly role: RoleSummary;
    readonly before: readonly string[];
    readonly after: readonly string[];
    readonly invalidation: PrivilegeInvalidation;
  }>;

  /** Soft-deactivates a custom role. History is retained; authority stops. */
  deactivateCustomRole(input: {
    readonly roleId: string;
    readonly actor: PrivilegedActor;
    readonly auditAction: string;
  }): Promise<{
    readonly role: RoleSummary;
    readonly invalidation: PrivilegeInvalidation;
  }>;

  /* ---- Assignments ----------------------------------------------------- */

  listAssignments(input: {
    readonly roleId?: string;
    readonly accountId?: string;
    readonly includeRevoked: boolean;
    readonly limit: number;
    readonly offset: number;
  }): Promise<AssignmentPage>;

  /** One assignment by id, revoked or not. */
  findAssignment(assignmentId: string): Promise<RoleAssignmentRecord | null>;

  /**
   * Grants a role to an account.
   *
   * IDEMPOTENT AND RACE-SAFE: a filtered unique index permits at most one live
   * assignment per (account, role), so two concurrent grants produce one row
   * and one audit record rather than two of each.
   */
  grantRoleAssignment(input: {
    readonly accountId: string;
    readonly roleId: string;
    readonly reason: string | null;
    readonly actor: PrivilegedActor;
    readonly auditAction: string;
  }): Promise<{
    readonly outcome: 'granted' | 'already-held';
    readonly invalidation: PrivilegeInvalidation;
  }>;

  /** Revokes a live assignment. The row is RETAINED, marked revoked. */
  revokeRoleAssignment(input: {
    readonly assignmentId: string;
    readonly reason: string | null;
    readonly actor: PrivilegedActor;
    readonly auditAction: string;
  }): Promise<{
    readonly outcome: 'revoked' | 'not-held';
    readonly invalidation: PrivilegeInvalidation;
  }>;

  /* ---- Accounts, for the administration surfaces ---------------------- */

  /** Bounded search. Never an unbounded table load (CLAUDE.md §41). */
  searchAccounts(input: {
    readonly query: string | null;
    readonly status: AccountStatus | null;
    readonly limit: number;
    readonly offset: number;
  }): Promise<AccountPage>;

  findAccountSummary(accountId: string): Promise<AccountSummary | null>;

  /**
   * Of the accounts named, those whose status is `closed`.
   *
   * ADDED FOR THE CROSS-OWNER CLOSURE DISPOSITION (SECURITY_BASELINE.md §19.1).
   * Account closure is Identity's and commits in Identity's own transaction;
   * the other semantic owners then dispose of THEIR data through their own
   * services. That second step can be interrupted, so each owner needs to be
   * able to ask which of the accounts it still holds data for have since been
   * closed — and to ask it once for a set rather than once per row.
   *
   * IT RETURNS IDENTIFIERS THE CALLER ALREADY SUPPLIED, and nothing else: no
   * address, no name, no timestamp. A caller learns only that something it
   * already knew about is closed, so this cannot become a back door to the
   * account directory `users.read` guards.
   *
   * Bounded by the caller's own input set, which the adapter caps again.
   */
  closedAccountIds(accountIds: readonly string[]): Promise<readonly string[]>;

  /* ---- Audit ------------------------------------------------------------ */

  listAuditRecords(input: {
    readonly action: string | null;
    readonly actorId: string | null;
    readonly limit: number;
    readonly offset: number;
  }): Promise<AuditPage>;

  /* ---- Step-up --------------------------------------------------------- */

  /**
   * Records that a person re-proved themselves, for one purpose and one
   * session.
   *
   * SERVER-CREATED ONLY. Nothing a client sends creates one of these, and the
   * grant is not a token: it is a row, and revoking it is a delete.
   */
  createStepUpGrant(input: {
    readonly accountId: string;
    readonly sessionId: string;
    readonly purpose: StepUpPurpose;
    readonly lifetimeSeconds: number;
  }): Promise<StepUpGrantSummary>;

  /** Every grant for one account. The consequence of a security change. */
  revokeStepUpGrantsForAccount(accountId: string): Promise<number>;

  /* ---- Privileged second-factor posture -------------------------------- */

  readPosture(accountId: string): Promise<PrivilegedPosture>;

  /** Records that enrolment was verified, clearing any re-enrolment demand. */
  recordSecondFactorVerified(accountId: string): Promise<void>;

  /** Confirms only the exact set named by its issuance receipt. */
  recordRecoveryCodesConfirmed(
    accountId: string,
    issuanceReceipt: string,
  ): Promise<boolean>;

  /** Clears posture entirely — the factor is gone (disable, or closure). */
  clearSecondFactorPosture(accountId: string): Promise<void>;

  /* ---- Bootstrap ------------------------------------------------------- */

  readBootstrapStatus(): Promise<BootstrapStatus>;
}
