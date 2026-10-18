'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  displayNameSchema,
  emailSchema,
  localeSchema,
  passwordSchema,
  timezoneSchema,
} from '@minhaj/contracts/identity';
import { z } from 'zod';

import { dispatchAfterResponse } from '@/composition/dispatch';
import { fatwaRuntime } from '@/composition/fatwa';
import { identityRuntime } from '@/composition/identity';
import { learningRuntime } from '@/composition/learning';
import { donationsRuntime } from '@/composition/donations';
import { membershipRuntime } from '@/composition/membership';
import { messagingRuntime } from '@/composition/messaging';
import { peopleRuntime } from '@/composition/people';
import { personalisationRuntime } from '@/composition/personalisation';
import { applySetCookies, requestContext } from '@/composition/request';
import { safeReturnTo } from '@/composition/return-to';
import type { IdentityFailure } from '@/contexts/identity-access';

/**
 * THE Class-A mutation surface (SECURITY_BASELINE.md §7.1).
 *
 * Every state change a person triggers from this application's own UI goes
 * through a Server Action here. Next applies Origin validation and its own
 * CSRF protections to them, and none of them is reachable by GET — which is
 * what makes "no state-changing GET" true rather than intended.
 *
 * THERE IS NO `/api/auth/*` CATCH-ALL. Mounting one would expose Better Auth's
 * whole endpoint collection — delete-user, change-email, change-password,
 * session revocation — OUTSIDE these wrappers, so each would lose the rate
 * limiting, audit and status enforcement applied below. Phase 2 is credential
 * only and needs no provider callback, so the surface is simply absent; Phase
 * 2G adds exactly the OAuth paths it needs behind a fail-closed allowlist.
 *
 * VALIDATION IS SERVER-SIDE AND AUTHORITATIVE. Client validation is a
 * convenience with no security value (§9.1).
 */

/** What a form gets back. Never carries a provider message or a token. */
export interface ActionState {
  readonly status: 'idle' | 'success' | 'error';
  readonly failure?: IdentityFailure | 'invalid-input' | 'closure-pending';
  readonly retryAfter?: number;
}

function invalid(): ActionState {
  return { status: 'error', failure: 'invalid-input' };
}

function failed(failure: IdentityFailure, retryAfter?: number): ActionState {
  return retryAfter === undefined
    ? { status: 'error', failure }
    : { status: 'error', failure, retryAfter };
}

/**
 * Re-renders the account surfaces after a change they DISPLAY.
 *
 * Without this, an action that succeeds leaves the page showing what was true
 * before it ran. Revoking a session is the case that makes it obvious: the
 * session disappears from the database and stays on the screen, so the control
 * looks broken while working perfectly — the worst combination, because the
 * next thing a person does is press it again.
 *
 * Scoped to the account tree rather than the whole application: nothing
 * outside `/{locale}/my` displays any of this.
 */
function refreshAccountSurfaces(locale: string): void {
  revalidatePath(`/${locale}/my`, 'layout');
}

function localeFrom(form: FormData): string {
  const parsed = localeSchema.safeParse(form.get('locale'));
  return parsed.success ? parsed.data : 'en';
}

/**
 * Resolves the caller's session through THE chokepoint.
 *
 * Every authenticated action starts here, so account status is enforced on
 * every one of them rather than only at sign-in (DOMAIN_MODEL.md §4.6).
 */
async function activeSession(locale: string) {
  const { session } = identityRuntime();
  const context = await requestContext(locale);
  const outcome = await session.resolve(context.headers);

  if (outcome.state !== 'active') return null;
  return outcome.session;
}

/* ===========================================================================
 * Registration and verification
 * ========================================================================= */

const signUpSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: displayNameSchema,
});

export async function signUpAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeFrom(form);
  const parsed = signUpSchema.safeParse({
    email: form.get('email'),
    password: form.get('password'),
    name: form.get('name'),
  });

  if (!parsed.success) return invalid();

  const { identity } = identityRuntime();
  const result = await identity.signUp(await requestContext(locale), parsed.data);

  if (!result.ok) return failed(result.failure, result.retryAfter);

  // The verification link goes out after this response rather than at the next
  // scheduled sweep — the person is waiting for it.
  dispatchAfterResponse();

  // The SAME outcome whether or not the address was already registered, so the
  // response cannot be used to discover who has an account.
  return { status: 'success' };
}

export async function resendVerificationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeFrom(form);
  const parsed = emailSchema.safeParse(form.get('email'));
  if (!parsed.success) return invalid();

  const { identity } = identityRuntime();
  const result = await identity.resendVerification(await requestContext(locale), {
    email: parsed.data,
  });

  if (result.ok) dispatchAfterResponse();

  return result.ok ? { status: 'success' } : failed(result.failure, result.retryAfter);
}

const confirmSchema = z.object({ email: emailSchema, token: z.string().min(1).max(256) });

/**
 * THE confirming mutation for an emailed verification link.
 *
 * The GET that renders the page performs no mutation; this consumes the token
 * (SECURITY_BASELINE.md §7.4). A mail scanner following the link cannot reach
 * this, because reaching it requires a POST from the rendered form.
 */
export async function confirmVerificationAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeFrom(form);
  const parsed = confirmSchema.safeParse({
    email: form.get('email'),
    token: form.get('token'),
  });
  if (!parsed.success) return invalid();

  const { identity } = identityRuntime();
  const result = await identity.confirmVerification(
    await requestContext(locale),
    parsed.data,
  );

  return result.ok ? { status: 'success' } : failed(result.failure, result.retryAfter);
}

/* ===========================================================================
 * Sessions
 * ========================================================================= */

const signInSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(512),
});

export async function signInAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeFrom(form);
  const parsed = signInSchema.safeParse({
    email: form.get('email'),
    password: form.get('password'),
  });
  if (!parsed.success) return invalid();

  const { identity } = identityRuntime();
  const result = await identity.signIn(await requestContext(locale), parsed.data);

  if (!result.ok) return failed(result.failure, result.retryAfter);

  // Cookies are DATA until Layer 4 writes them. Dropping this call would leave
  // someone looking signed out immediately after signing in.
  //
  // THIS APPLIES TO THE CHALLENGE TOO. An account with a second factor gets a
  // short-lived challenge cookie instead of a session, and it is just as
  // essential: dropping it abandons a sign-in halfway through.
  await applySetCookies(result.setCookies);

  const destination = safeReturnTo(form.get('returnTo') as string | null, locale);

  if (result.state === 'second-factor-required') {
    // NOT SIGNED IN YET, and the redirect says so. The destination travels
    // through the challenge so the person still lands where they were going.
    redirect(`/${locale}/signin/two-factor?returnTo=${encodeURIComponent(destination)}`);
  }

  // Only a validated same-origin destination. An unvalidated one is an open
  // redirect under a trusted domain (SECURITY_BASELINE.md §9.3).
  redirect(destination);
}

/**
 * Answers the second-factor challenge.
 *
 * A Class-A mutation like every other action here: a POST through a Server
 * Action, never a GET. The code is short-lived and the challenge is
 * single-use, and neither is a reason to relax that — a GET carrying a
 * second factor would sit in history, in logs and in referrers
 * (SECURITY_BASELINE.md §7.1).
 *
 * TWO WAYS IN, ONE PATH OUT. A TOTP code and a recovery code are different
 * proofs with different budgets, and they are the same flow afterwards.
 */
const secondFactorSchema = z.object({
  // Trimmed and bounded, not pattern-matched: the library owns what a valid
  // code looks like, and a client-side shape rule here would be a second
  // opinion that could disagree with it.
  code: z.string().trim().min(1).max(64),
  kind: z.union([z.literal('totp'), z.literal('recovery-code')]),
});

export async function verifySecondFactorAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeFrom(form);
  const parsed = secondFactorSchema.safeParse({
    code: form.get('code'),
    kind: form.get('kind'),
  });
  if (!parsed.success) return invalid();

  const { identity } = identityRuntime();
  const result = await identity.completeSecondFactor(
    await requestContext(locale),
    parsed.data,
  );

  if (!result.ok) return failed(result.failure, result.retryAfter);

  await applySetCookies(result.setCookies);
  refreshAccountSurfaces(locale);

  redirect(safeReturnTo(form.get('returnTo') as string | null, locale));
}

/**
 * Sign-out.
 *
 * A Server Action, never a GET route. `/signout` does not exist: a GET that
 * mutates session state can be triggered by any image tag or link prefetch
 * (ROUTE_MAP.md §2.4).
 */
export async function signOutAction(form: FormData): Promise<void> {
  const locale = localeFrom(form);
  const { identity } = identityRuntime();

  const result = await identity.signOut(await requestContext(locale));
  if (result.ok) await applySetCookies(result.setCookies);

  redirect(`/${locale}`);
}

/**
 * Revokes one of the caller's own sessions.
 *
 * The form carries the session's ID, never its token. A token is a live bearer
 * credential, and putting one per device into the page would mean a single
 * stored copy of the rendered HTML handed over every one of them.
 */
export async function revokeSessionAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeFrom(form);
  const sessionId = form.get('sessionId');
  if (typeof sessionId !== 'string' || sessionId === '') return invalid();

  const session = await activeSession(locale);
  if (session === null) return failed('account-unavailable');

  const { identity } = identityRuntime();
  const result = await identity.revokeSession(await requestContext(locale), session, {
    sessionId,
  });

  if (result.ok) refreshAccountSurfaces(locale);

  return result.ok ? { status: 'success' } : failed(result.failure);
}

export async function revokeOtherSessionsAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeFrom(form);
  const session = await activeSession(locale);
  if (session === null) return failed('account-unavailable');

  const { identity } = identityRuntime();
  const result = await identity.revokeOtherSessions(
    await requestContext(locale),
    session,
  );

  if (result.ok) {
    refreshAccountSurfaces(locale);
    dispatchAfterResponse();
  }

  return result.ok ? { status: 'success' } : failed(result.failure);
}

/* ===========================================================================
 * Passwords
 * ========================================================================= */

export async function requestPasswordResetAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeFrom(form);
  const parsed = emailSchema.safeParse(form.get('email'));
  if (!parsed.success) return invalid();

  const { identity } = identityRuntime();
  const result = await identity.requestPasswordReset(await requestContext(locale), {
    email: parsed.data,
  });

  if (result.ok) dispatchAfterResponse();

  return result.ok ? { status: 'success' } : failed(result.failure, result.retryAfter);
}

const resetSchema = z.object({
  email: emailSchema,
  token: z.string().min(1).max(256),
  newPassword: passwordSchema,
});

export async function resetPasswordAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeFrom(form);
  const parsed = resetSchema.safeParse({
    email: form.get('email'),
    token: form.get('token'),
    newPassword: form.get('newPassword'),
  });
  if (!parsed.success) return invalid();

  const { identity } = identityRuntime();
  const result = await identity.resetPassword(await requestContext(locale), parsed.data);

  if (result.ok) dispatchAfterResponse();

  return result.ok ? { status: 'success' } : failed(result.failure, result.retryAfter);
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(512),
  newPassword: passwordSchema,
});

export async function changePasswordAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeFrom(form);
  const parsed = changePasswordSchema.safeParse({
    currentPassword: form.get('currentPassword'),
    newPassword: form.get('newPassword'),
  });
  if (!parsed.success) return invalid();

  const session = await activeSession(locale);
  if (session === null) return failed('account-unavailable');

  const { identity } = identityRuntime();
  const result = await identity.changePassword(
    await requestContext(locale),
    session,
    parsed.data,
  );

  if (result.ok) {
    // The change ROTATED this session. Writing the replacement cookie is what
    // keeps the person signed in on the device they just used; dropping it
    // would sign them out one request after telling them it worked.
    await applySetCookies(result.setCookies);

    // DELIBERATELY NOT REVALIDATED. A rotating action must not ask for a
    // re-render of the account tree in its own response.
    //
    // `revalidatePath` re-renders within THIS request, and the session is
    // resolved from `headers()` — immutable request state that still carries
    // the token this change has just revoked. The new cookie is on the
    // RESPONSE and cannot be seen by that render, so the account tree renders
    // as a signed-out visitor and the guard sends the person to `/signin`
    // immediately after telling them the password change worked.
    //
    // Nothing is lost by omitting it: every account surface is
    // `force-dynamic`, so the next navigation — the first request carrying the
    // replacement cookie — renders the new session list from live state.

    // The "your password was changed" notice is committed as an intent inside
    // the change's own transaction; this relays it now rather than in a minute.
    dispatchAfterResponse();
  }

  return result.ok ? { status: 'success' } : failed(result.failure, result.retryAfter);
}

/* ===========================================================================
 * Email change
 * ========================================================================= */

const emailChangeSchema = z.object({
  newEmail: emailSchema,
  currentPassword: z.string().min(1).max(512),
});

/**
 * Starts a verified email change.
 *
 * The current password is required here rather than at confirmation: the
 * address is the root of every recovery path, so the decision to move it is
 * what needs the credential, and the emailed token then proves the
 * destination is genuinely reachable.
 */
export async function requestEmailChangeAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeFrom(form);
  const parsed = emailChangeSchema.safeParse({
    newEmail: form.get('newEmail'),
    currentPassword: form.get('currentPassword'),
  });
  if (!parsed.success) return invalid();

  const session = await activeSession(locale);
  if (session === null) return failed('account-unavailable');

  const { identity } = identityRuntime();
  const result = await identity.requestEmailChange(
    await requestContext(locale),
    session,
    parsed.data,
  );

  if (result.ok) dispatchAfterResponse();

  return result.ok ? { status: 'success' } : failed(result.failure, result.retryAfter);
}

const confirmChangeSchema = z.object({
  newEmail: emailSchema,
  token: z.string().min(1).max(256),
});

export async function confirmEmailChangeAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeFrom(form);
  const parsed = confirmChangeSchema.safeParse({
    newEmail: form.get('newEmail'),
    token: form.get('token'),
  });
  if (!parsed.success) return invalid();

  // Both halves are required: the token proves the destination, the session
  // proves the account. A link on its own moves nobody's address.
  const session = await activeSession(locale);
  if (session === null) return failed('account-unavailable');

  const { identity } = identityRuntime();
  const result = await identity.confirmEmailChange(
    await requestContext(locale),
    session,
    parsed.data,
  );

  if (result.ok) {
    await applySetCookies(result.setCookies);

    // Not revalidated, for the same reason as `changePasswordAction`: this
    // confirmation rotates the session, and a re-render inside this response
    // would resolve the superseded token and render a signed-out tree. The
    // new address is displayed by the next navigation, which is the first
    // request that carries the replacement cookie.
    dispatchAfterResponse();
  }

  return result.ok ? { status: 'success' } : failed(result.failure, result.retryAfter);
}

/* ===========================================================================
 * Account state
 * ========================================================================= */

export async function updateProfileAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeFrom(form);
  const parsed = displayNameSchema.safeParse(form.get('name'));
  if (!parsed.success) return invalid();

  const session = await activeSession(locale);
  if (session === null) return failed('account-unavailable');

  const { identity } = identityRuntime();
  const result = await identity.updateProfile(session, { name: parsed.data });

  if (result.ok) refreshAccountSurfaces(locale);

  return result.ok ? { status: 'success' } : failed(result.failure);
}

const languageSchema = z.object({ locale: localeSchema, timezone: timezoneSchema });

export async function updateLanguageAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeFrom(form);
  const parsed = languageSchema.safeParse({
    locale: form.get('accountLocale'),
    timezone: form.get('timezone'),
  });
  if (!parsed.success) return invalid();

  const session = await activeSession(locale);
  if (session === null) return failed('account-unavailable');

  const { identity } = identityRuntime();
  const result = await identity.updateLanguage(session, parsed.data);

  if (result.ok) refreshAccountSurfaces(locale);

  return result.ok ? { status: 'success' } : failed(result.failure);
}

export async function completeAccountSetupAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeFrom(form);
  const parsed = languageSchema.safeParse({
    locale: form.get('accountLocale'),
    timezone: form.get('timezone'),
  });
  if (!parsed.success) return invalid();

  const session = await activeSession(locale);
  if (session === null) return failed('account-unavailable');

  const { identity } = identityRuntime();
  const result = await identity.completeAccountSetup(session, parsed.data);

  if (!result.ok) return failed(result.failure);

  redirect(`/${locale}/my`);
}

/**
 * Closes the account.
 *
 * Requires the current password. Closure is irreversible for the account's
 * data even though the address becomes available again, so it is not something
 * a borrowed, unlocked browser should be able to do.
 */
export async function closeAccountAction(
  _previous: ActionState,
  form: FormData,
): Promise<ActionState> {
  const locale = localeFrom(form);
  const password = form.get('password');
  if (typeof password !== 'string' || password === '') return invalid();

  const session = await activeSession(locale);
  if (session === null) return failed('account-unavailable');

  const context = await requestContext(locale);
  const { identity } = identityRuntime();

  // Re-proving the credential here is the one confirmation that matters. It
  // VERIFIES and changes nothing — confirming by "changing" the password to
  // itself would rotate the credential, revoke other sessions and send a
  // password-changed notice for an action that is not a password change.
  const confirmed = await identity.confirmPassword(context, session, { password });
  if (!confirmed) return failed('invalid-credentials');

  const result = await identity.closeAccount(context, session);
  if (!result.ok) return failed(result.failure, result.retryAfter);

  // TWO OWNERS, TWO TRANSACTIONS, ONE HONEST COMPLETION. Identity has committed
  // its closure; People now releases its optional live account link through
  // People's own service. A failure is not reported as success, and the
  // idempotent reconciliation sweep makes a crash between the two resumable.
  const disposition = await peopleRuntime().people.releaseAccountLink({
    accountId: session.account.id,
  });

  let reconciliationFailed = false;
  if (disposition.ok) {
    try {
      await peopleRuntime().people.reconcileClosedAccountLinks();
    } catch {
      reconciliationFailed = true;
    }
  }

  // THE THIRD OWNER. Fatwa erases the private text of this account's
  // questions and closes those not yet answered, in Fatwa's own transaction;
  // a published ruling never held the question and stays as it is. Idempotent,
  // and its bounded sweep finishes any closure interrupted here.
  let questionsPending = false;
  try {
    await fatwaRuntime().disposition.disposeAccount(session.account.id);
    await fatwaRuntime().disposition.reconcileClosedAccounts();
  } catch {
    questionsPending = true;
  }

  // THE FOURTH OWNER. Personalisation removes this account's saved items,
  // notes, private collections, history, Quran position, onboarding answers,
  // notification preferences and notifications, in its own bounded batches.
  // A newsletter subscription is NOT the account's and is left alone, whatever
  // its address. Idempotent; the closure sweep finishes what this leaves.
  let personalPending: boolean;
  try {
    const personal = await personalisationRuntime().account.disposeAccount(
      session.account.id,
    );
    const sweep = await personalisationRuntime().account.reconcileClosedAccounts();
    personalPending = !personal.complete || !sweep.complete;
  } catch {
    personalPending = true;
  }

  // THE FIFTH OWNER. Learning removes this account's Enrolments, lesson
  // Progress and trial-class requests, in its own bounded batches. The catalogue
  // is the organisation's: no Course or LearningPath is touched, whoever edited
  // it. Idempotent; the closure sweep finishes what this leaves.
  let learningPending: boolean;
  try {
    const learning = await learningRuntime().account.disposeAccount(session.account.id);
    const sweep = await learningRuntime().account.reconcileClosedAccounts();
    learningPending = !learning.complete || !sweep.complete;
  } catch {
    learningPending = true;
  }

  // THE SIXTH OWNER. Messaging closes this account's direct and support
  // conversations, takes it out of any support claim, removes its read
  // positions, its blocks either way and its unsent uploads, and disposes of
  // every conversation whose every participant is now closed — keeping only
  // a conversation a report holds as evidence. Messaging refuses unless
  // Identity reports the account closed, which it now does. Idempotent; the
  // closure sweep finishes what this leaves.
  let messagingPending: boolean;
  try {
    const messaging = await messagingRuntime().service.disposeAccount(session.account.id);
    const sweep = await messagingRuntime().service.reconcileClosedAccounts();
    messagingPending = !messaging.complete || !sweep.complete;
  } catch {
    messagingPending = true;
  }

  // THE SEVENTH OWNER. Membership withdraws this account's open applications
  // (owing no message) and removes its owed Membership mail, in its own
  // bounded batches. An active Membership is NOT closed: closing the login
  // account is not resigning the organisational relationship. Membership
  // refuses unless Identity reports the account closed, which it now does.
  // Idempotent; the closure sweep finishes what this leaves.
  let membershipPending: boolean;
  try {
    const membership = await membershipRuntime().account.disposeAccount(
      session.account.id,
    );
    const sweep = await membershipRuntime().account.reconcileClosedAccounts();
    membershipPending = !membership.complete || !sweep.complete;
  } catch {
    membershipPending = true;
  }

  // THE EIGHTH OWNER. Donations abandons this account's owed donation mail and
  // releases the account link of its donations, which become anonymous. The
  // financial record — amounts, states, refunds and provider events — is the
  // organisation's and is kept untouched. Donations refuses unless Identity
  // reports the account closed, which it now does. Idempotent; the closure
  // sweep finishes what this leaves.
  let donationsPending: boolean;
  try {
    const donations = await donationsRuntime().account.disposeAccount(session.account.id);
    const sweep = await donationsRuntime().account.reconcileClosedAccounts();
    donationsPending = !donations.complete || !sweep.complete;
  } catch {
    donationsPending = true;
  }

  // The closure notice is enqueued against the address the account HAD, before
  // the tombstone replaces it. It goes out after this response.
  dispatchAfterResponse();

  const signedOut = await identity.signOut(context);
  if (signedOut.ok) await applySetCookies(signedOut.setCookies);

  // The Identity transaction has already closed the account, so its notice and
  // local sign-out still happen. What is withheld is a false successful
  // completion while any owner's required work is pending — and says so,
  // rather than calling a closed account's pending cleanup a failure.
  if (
    !disposition.ok ||
    reconciliationFailed ||
    questionsPending ||
    personalPending ||
    learningPending ||
    messagingPending ||
    membershipPending ||
    donationsPending
  )
    return { status: 'error', failure: 'closure-pending' };

  redirect(`/${locale}`);
}
