import 'server-only';

import type {
  AuthorizationReaderPort,
  ContributorCapabilities,
  PermissionKey,
  PrivilegedActor,
  PrivilegedPosture,
  ResolvedSession,
  StepUpPurpose,
} from '@minhaj/contracts/identity';
import { projectContributorCapabilities } from '@minhaj/contracts/identity';

/**
 * THE authorisation service — Identity & Access's, hosted here.
 *
 * OWNERSHIP. `packages/server-core` is a server-only HOST, not a layer and not
 * an owner. The rules below are Identity's and only Identity may change them;
 * placing the implementation here changes where it is exported from, nothing
 * else (ARCHITECTURE.md §3.1).
 *
 * WHY IT IS HERE. ARCHITECTURE.md §3.1 names `authorization/ ← owned by
 * Identity & Access · can(user, permission)` in this package by name, and §3.2
 * requires the realtime transport to make authorisation decisions "via the same
 * services — same code". §3.1.3 admits a service ahead of its second process
 * exactly for that case. Building it inside `apps/web` first would mean
 * extracting and rewriting a security-critical path later.
 *
 * WHAT IT HOLDS. A narrow injected READER and a policy. No Prisma, no
 * `packages/database`, no `apps/web` implementation, no provider SDK, and
 * nothing that can grant, revoke or elevate — the port it receives has three
 * read operations on it.
 *
 * WHAT IT DOES NOT DO. It never decides whether a role may be created, whether
 * an assignment is self-elevation, or what a bundle change invalidates. Those
 * are the context's invariants and they stay in the context.
 */

/* ===========================================================================
 * Results
 * ========================================================================= */

/**
 * Why a privileged request was refused.
 *
 * FOUR DISTINCT ANSWERS, because they call for four different things from the
 * person in front of the screen: sign in, ask for the permission, finish
 * enrolling a second factor, or re-prove yourself now. Collapsing them into
 * one "denied" would be safe and unusable — the commonest reason a real
 * operator gives up is being told no without being told what would work.
 *
 * None of them discloses anything about another account.
 */
export type AuthorizationDenial =
  'account-inactive' | 'no-permission' | 'second-factor-required' | 'step-up-required';

/**
 * One request's authority, resolved once.
 *
 * A VALUE, not a cache. It is created per request from a live read and is
 * discarded with the request, so there is no store anywhere that could keep
 * answering "yes" after a privilege was removed (SECURITY_BASELINE.md §3.4
 * rule 5, CLAUDE.md §13). Two calls in one render share one snapshot; two
 * requests never share anything.
 */
export interface PrincipalAuthorization {
  readonly accountId: string;
  readonly permissions: ReadonlySet<string>;
  can(permission: PermissionKey): boolean;
}

export type PermissionOutcome =
  | { readonly state: 'allowed'; readonly authorization: PrincipalAuthorization }
  | { readonly state: 'denied'; readonly reason: AuthorizationDenial };

export type PrivilegedOutcome =
  | {
      readonly state: 'allowed';
      readonly actor: PrivilegedActor;
      readonly authorization: PrincipalAuthorization;
    }
  | { readonly state: 'denied'; readonly reason: AuthorizationDenial };

export interface AuthorizationService {
  hasPermission(accountId: string, permission: PermissionKey): Promise<boolean>;
  /**
   * Resolves what this session may do, NOW.
   *
   * Every privileged surface starts here. Having exactly one of these is what
   * makes "default deny" enforceable: a second way to answer the question is a
   * second place it can be answered wrongly.
   */
  evaluate(session: ResolvedSession): Promise<PrincipalAuthorization>;

  /**
   * The READ gate. Permission and an active account, and nothing more.
   *
   * Deliberately NOT gated on the second factor. SECURITY_BASELINE.md §8.2
   * requires an enrolled factor before a high-consequence CAPABILITY may be
   * EXERCISED; reading a list is not that, and gating reads on it would make
   * bootstrap circular — the freshly bootstrapped administrator could not see
   * the security surface that tells them what is missing (§8.3).
   */
  requirePermission(
    session: ResolvedSession,
    permission: PermissionKey,
  ): Promise<PermissionOutcome>;

  /**
   * The WRITE gate, and the only producer of a `PrivilegedActor`.
   *
   * THREE INDEPENDENT CONDITIONS, checked in the order that discloses least:
   *
   *   1. the account is active — enforced upstream at the session chokepoint
   *      and again here, because this service is also the realtime process's
   *      gate and may be reached without that chokepoint;
   *   2. it holds the permission;
   *   3. its privileged posture is complete — a VERIFIED second factor, its
   *      recovery codes confirmed, and no outstanding re-enrolment demand;
   *   4. a live step-up grant exists for THIS session and THIS purpose.
   *
   * 3 and 4 are not alternatives and neither implies the other. Holding a TOTP
   * is not proof that anybody typed one just now, and typing a password just
   * now is not proof that a second factor exists to steal alongside it.
   */
  requirePrivilegedAction(input: {
    readonly session: ResolvedSession;
    readonly permission: PermissionKey;
    readonly stepUp: StepUpPurpose;
  }): Promise<PrivilegedOutcome>;

  /**
   * Re-verifies an actor at the sensitive service boundary.
   *
   * The object is accepted only when this service minted this exact frozen
   * instance, and its permission, posture and purpose-bound grant are still
   * live. TypeScript's shape is ergonomics; this runtime check is the security
   * property.
   */
  verifyPrivilegedActor(input: {
    readonly actor: PrivilegedActor;
    readonly permission: PermissionKey;
    readonly stepUp: StepUpPurpose;
  }): Promise<boolean>;

  /** The account's privileged posture, for the surfaces that report it. */
  posture(accountId: string): Promise<PrivilegedPosture>;

  /**
   * The four named capability projections for one account.
   *
   * IDENTITY'S ANSWER TO A QUESTION PEOPLE ASKS. DOMAIN_MODEL.md §4.5 makes
   * `canTeach`, `canReceiveQuestions`, `canReviewContent` and `canIssueFatwa`
   * projections of explicit grants — "never independently stored booleans, and
   * never an enforcement path" — so the only correct place to compute them is
   * beside the live permission read they are derived from. A projection
   * computed in People would be a second opinion about Identity's authority.
   *
   * IT REUSES `effectivePermissions` EXACTLY, which is what makes the four fail
   * closed without this method knowing why: that read already excludes revoked
   * assignments, deactivated roles and any account that is not `active`, so a
   * disabled, suspended or closed account projects false on every one of them.
   *
   * READ-ONLY, AND NOT A GATE. It authorises nothing and is never consulted to
   * decide whether an action may proceed; `requirePermission` and
   * `requirePrivilegedAction` above remain the only paths that do that.
   */
  contributorCapabilities(accountId: string): Promise<ContributorCapabilities>;
}

export interface AuthorizationServiceDependencies {
  readonly reader: AuthorizationReaderPort;
}

/** Is the posture complete enough to exercise high-consequence authority? */
export function postureSatisfied(posture: PrivilegedPosture): boolean {
  return (
    posture.secondFactorEnrolled &&
    posture.recoveryCodesConfirmed &&
    !posture.reenrolmentRequired
  );
}

export function createAuthorizationService({
  reader,
}: AuthorizationServiceDependencies): AuthorizationService {
  const issuedActors = new WeakSet<object>();

  async function evaluate(session: ResolvedSession): Promise<PrincipalAuthorization> {
    const held = await reader.effectivePermissions(session.account.id);
    const permissions: ReadonlySet<string> = new Set(held);

    return {
      accountId: session.account.id,
      permissions,
      // DEFAULT DENY. The absence of a grant is a denial, which is what this
      // `has` says and what makes every unlisted capability unreachable
      // rather than accidentally open (SECURITY_BASELINE.md §3.4 rule 3).
      can: (permission) => permissions.has(permission),
    };
  }

  async function requirePermission(
    session: ResolvedSession,
    permission: PermissionKey,
  ): Promise<PermissionOutcome> {
    if (session.account.status !== 'active') {
      return { state: 'denied', reason: 'account-inactive' };
    }

    const authorization = await evaluate(session);
    if (!authorization.can(permission)) {
      return { state: 'denied', reason: 'no-permission' };
    }

    return { state: 'allowed', authorization };
  }

  return {
    async hasPermission(accountId, permission) {
      return (await reader.effectivePermissions(accountId)).includes(permission);
    },
    evaluate,
    requirePermission,

    async requirePrivilegedAction({ session, permission, stepUp }) {
      const permitted = await requirePermission(session, permission);
      if (permitted.state === 'denied') return permitted;

      const posture = await reader.privilegedPosture(session.account.id);
      if (!postureSatisfied(posture)) {
        return { state: 'denied', reason: 'second-factor-required' };
      }

      const grant = await reader.findStepUpGrant({
        accountId: session.account.id,
        sessionId: session.sessionId,
        purpose: stepUp,
      });

      // Expiry is re-checked HERE as well as in the query. The row is read
      // with a `WHERE expiresAt > now` predicate, but the clock that matters
      // is the one making the decision, and a service that trusted the reader
      // to have filtered correctly would have no way to say so.
      if (grant === null || grant.expiresAt.getTime() <= Date.now()) {
        return { state: 'denied', reason: 'step-up-required' };
      }

      const actor: PrivilegedActor = Object.freeze({
        authorisation: 'verified',
        accountId: session.account.id,
        sessionId: session.sessionId,
        permission,
        stepUp,
        stepUpGrantId: grant.id,
      });
      issuedActors.add(actor);

      return {
        state: 'allowed',
        authorization: permitted.authorization,
        actor,
      };
    },

    async verifyPrivilegedActor({ actor, permission, stepUp }) {
      if (
        !issuedActors.has(actor) ||
        actor.authorisation !== 'verified' ||
        actor.permission !== permission ||
        actor.stepUp !== stepUp
      ) {
        return false;
      }

      const [permissions, posture, grant] = await Promise.all([
        reader.effectivePermissions(actor.accountId),
        reader.privilegedPosture(actor.accountId),
        reader.findStepUpGrant({
          accountId: actor.accountId,
          sessionId: actor.sessionId,
          purpose: stepUp,
        }),
      ]);

      return (
        permissions.includes(permission) &&
        postureSatisfied(posture) &&
        grant !== null &&
        grant.id === actor.stepUpGrantId &&
        grant.expiresAt.getTime() > Date.now()
      );
    },

    async posture(accountId) {
      return reader.privilegedPosture(accountId);
    },

    async contributorCapabilities(accountId) {
      // The SAME live read every authorisation decision uses. Nothing is
      // cached between the read and the projection, so there is no window in
      // which a revoked grant still projects.
      return projectContributorCapabilities(await reader.effectivePermissions(accountId));
    },
  };
}
