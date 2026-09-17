import 'server-only';

import { notFound, redirect } from 'next/navigation';

import type {
  PermissionKey,
  PrivilegedActor,
  ResolvedSession,
  StepUpPurpose,
} from '@minhaj/contracts/identity';
import type {
  AuthorizationDenial,
  PrincipalAuthorization,
} from '@minhaj/server-core/authorization';

import type { RequestContext } from '@/contexts/identity-access';
import { identityRuntime } from '@/composition/identity';
import { requestContext } from '@/composition/request';

/**
 * THE Layer-4 authorisation gates.
 *
 * TWO OF THEM, because a privileged surface has two distinct boundaries and
 * conflating them is how one of them stops being enforced:
 *
 *   - `requireAdminPage` guards a RENDER. It is navigational: it decides
 *     whether somebody sees a screen.
 *   - `requirePrivilegedActor` guards a MUTATION. It is the security boundary,
 *     and it re-checks everything independently — because "route protection is
 *     navigational convenience, not a security boundary" and "every protected
 *     mutation involving an authenticated principal re-checks authorisation
 *     independently" (SECURITY_BASELINE.md §3.4 rule 2).
 *
 * Both resolve through the session chokepoint, so account status is enforced on
 * every one of them rather than only at sign-in, and both call the SAME
 * authorisation service the realtime transport will later call.
 */

export interface AdminPageContext {
  readonly locale: string;
  readonly session: ResolvedSession;
  /**
   * This request's authority, resolved ONCE.
   *
   * A value, not a cache: created per request from a live read and discarded
   * with the request, so a page that checks three permissions performs one
   * read and no store outlives the response (CLAUDE.md §13, §41).
   */
  readonly authorization: PrincipalAuthorization;
}

/**
 * Guards an administrative page.
 *
 * A SIGNED-OUT visitor is sent to sign in, with a return path — that is a
 * navigation problem and telling them so is helpful.
 *
 * A SIGNED-IN visitor without the permission gets 404, not 403. A 403 confirms
 * the route exists and that somebody, somewhere, may use it; for
 * administrative surfaces that is a map of the platform's privileged shape
 * handed to anyone with an account (SECURITY_BASELINE.md §1.5).
 *
 * DELIBERATELY NOT GATED ON THE SECOND FACTOR. §8.2 requires an enrolled factor
 * before a high-consequence CAPABILITY is exercised; reading a list is not
 * that, and gating reads on it would make the bootstrap circular — the freshly
 * provisioned administrator could not see the security surface that tells them
 * what is still missing (§8.3).
 */
export async function requireAdminPage(
  locale: string,
  permission: PermissionKey,
  returnPath: string,
): Promise<AdminPageContext> {
  const { session: sessions, authorization } = identityRuntime();
  const context = await requestContext(locale);
  const outcome = await sessions.resolve(context.headers);

  if (outcome.state !== 'active') {
    redirect(`/${locale}/signin?returnTo=${encodeURIComponent(returnPath)}`);
  }

  const permitted = await authorization.requirePermission(outcome.session, permission);
  if (permitted.state === 'denied') notFound();

  return {
    locale,
    session: outcome.session,
    authorization: permitted.authorization,
  };
}

export type PrivilegedActionOutcome =
  | {
      readonly state: 'allowed';
      readonly actor: PrivilegedActor;
      readonly session: ResolvedSession;
      readonly context: RequestContext;
    }
  | {
      readonly state: 'denied';
      readonly reason: AuthorizationDenial | 'no-session';
    };

/**
 * Guards a privileged MUTATION, and is the only producer of a `PrivilegedActor`
 * this application has.
 *
 * Every Server Action that changes privilege, account status or second-factor
 * state starts here. It re-resolves the session, re-reads the permission set
 * live, re-checks the privileged posture and re-checks the step-up grant —
 * none of it inherited from whatever the page decided when it rendered, which
 * may have been minutes and one revoked role ago.
 */
export async function requirePrivilegedActor(
  locale: string,
  permission: PermissionKey,
  stepUp: StepUpPurpose,
): Promise<PrivilegedActionOutcome> {
  const { session: sessions, authorization } = identityRuntime();
  const context = await requestContext(locale);
  const outcome = await sessions.resolve(context.headers);

  if (outcome.state !== 'active') return { state: 'denied', reason: 'no-session' };

  const decision = await authorization.requirePrivilegedAction({
    session: outcome.session,
    permission,
    stepUp,
  });

  if (decision.state === 'denied') {
    return { state: 'denied', reason: decision.reason };
  }

  return {
    state: 'allowed',
    actor: decision.actor,
    session: outcome.session,
    context,
  };
}

export type PermittedActionOutcome =
  | {
      readonly state: 'allowed';
      readonly session: ResolvedSession;
      readonly context: RequestContext;
      readonly authorization: PrincipalAuthorization;
    }
  | { readonly state: 'denied'; readonly reason: AuthorizationDenial | 'no-session' };

/**
 * Guards a mutation that needs a PERMISSION but is not high-consequence.
 *
 * The narrow case, and it is genuinely narrow: putting a stuck outbound message
 * back on the schedule changes when a message is next attempted and nothing
 * about privilege, credentials or content. Requiring a second factor and a
 * step-up grant for it would not make it safer — it would make the one routine
 * operational task on these surfaces cost two proofs, which is how people end
 * up holding a step-up grant open all day.
 *
 * Everything that changes what an account may DO uses `requirePrivilegedActor`
 * instead, and there is no way to reach one of those from here: this function
 * returns no `PrivilegedActor` (SECURITY_BASELINE.md §8.1).
 */
export async function requirePermittedAction(
  locale: string,
  permission: PermissionKey,
): Promise<PermittedActionOutcome> {
  const { session: sessions, authorization } = identityRuntime();
  const context = await requestContext(locale);
  const outcome = await sessions.resolve(context.headers);

  if (outcome.state !== 'active') return { state: 'denied', reason: 'no-session' };

  const permitted = await authorization.requirePermission(outcome.session, permission);
  if (permitted.state === 'denied') {
    return { state: 'denied', reason: permitted.reason };
  }

  return {
    state: 'allowed',
    session: outcome.session,
    context,
    authorization: permitted.authorization,
  };
}

/**
 * Resolves an ACTIVE session for a self-service security action.
 *
 * Used by the Account & Security surface, which is not privileged
 * administration: enrolling one's own second factor needs a session and a
 * password, not a permission. It stays reachable for an account whose posture
 * is incomplete, which is what stops bootstrap and operational recovery being
 * circular (SECURITY_BASELINE.md §8.3).
 */
export async function requireOwnSession(
  locale: string,
): Promise<{ session: ResolvedSession; context: RequestContext } | null> {
  const { session: sessions } = identityRuntime();
  const context = await requestContext(locale);
  const outcome = await sessions.resolve(context.headers);

  if (outcome.state !== 'active') return null;
  return { session: outcome.session, context };
}
