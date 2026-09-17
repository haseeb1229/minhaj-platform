'use server';

import { revalidatePath } from 'next/cache';

import { localeSchema, passwordSchema } from '@minhaj/contracts/identity';
import { z } from 'zod';

import { requireOwnSession } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { applySetCookies } from '@/composition/request';
import { dispatchAfterResponse } from '@/composition/dispatch';
import type { PrivilegedSecurityFailure } from '@/contexts/identity-access';

/**
 * SELF-SERVICE second-factor administration — the account acting on itself.
 *
 * NOT PRIVILEGED ADMINISTRATION, and the difference matters. Enrolling your own
 * second factor needs a session and your password; it needs no permission, no
 * step-up grant and no complete posture. If it needed any of those, a freshly
 * bootstrapped administrator could never complete the very setup that their
 * privileged capabilities are waiting on, and the recovered administrator could
 * never recover (SECURITY_BASELINE.md §8.3).
 *
 * Every one of these is a Class-A mutation through a Server Action: a POST with
 * the framework's Origin and CSRF protections, never reachable by GET (§7.1).
 */

/**
 * What a second-factor form gets back.
 *
 * THE MATERIAL IS RETURNED, NOT STORED. `totpUri` and `recoveryCodes` exist in
 * this response and in the rendered page, and nowhere else: no cookie, no
 * session store, no durable row of this platform's. Reloading the page loses
 * them, which is correct — they are shown once and regenerating is the only way
 * to see a set again (§8.2).
 */
export type SecondFactorFailure =
  PrivilegedSecurityFailure | 'invalid-input' | 'no-session';

export interface SecondFactorState {
  readonly status: 'idle' | 'success' | 'error';
  readonly failure?: SecondFactorFailure;
  readonly retryAfter?: number;
  /** The enrolment payload, present only on the response that created it. */
  readonly totpUri?: string;
  readonly recoveryCodes?: readonly string[];
  /** Non-secret receipt binding acknowledgement to that exact displayed set. */
  readonly recoveryCodeReceipt?: string;
  /** Which success this was, so the surface can say something specific. */
  readonly outcome?:
    'enrolment-started' | 'verified' | 'codes-confirmed' | 'regenerated' | 'disabled';
}

function invalid(): SecondFactorState {
  return { status: 'error', failure: 'invalid-input' };
}

function failed(failure: SecondFactorFailure, retryAfter?: number): SecondFactorState {
  return retryAfter === undefined
    ? { status: 'error', failure }
    : { status: 'error', failure, retryAfter };
}

function localeFrom(form: FormData): string {
  const parsed = localeSchema.safeParse(form.get('locale'));
  return parsed.success ? parsed.data : 'en';
}

/** Re-renders the account tree, which displays the posture this changed. */
function refresh(locale: string): void {
  revalidatePath(`/${locale}/my`, 'layout');
}

/**
 * The code a person types from an authenticator, or writes down as recovery.
 *
 * Trimmed and bounded, not pattern-matched. The library owns what a valid code
 * looks like; a shape rule here would be a second opinion free to disagree with
 * it, and the failure would look like a rejected correct code.
 */
const codeSchema = z.string().trim().min(1).max(64);
const issuanceReceiptSchema = z.string().datetime();

export async function beginEnrolmentAction(
  _previous: SecondFactorState,
  form: FormData,
): Promise<SecondFactorState> {
  const locale = localeFrom(form);
  const parsed = passwordSchema.safeParse(form.get('password'));
  if (!parsed.success) return invalid();

  const active = await requireOwnSession(locale);
  if (active === null) return failed('no-session');

  const { privilegedSecurity } = identityRuntime();
  const result = await privilegedSecurity.beginEnrolment(active.context, active.session, {
    password: parsed.data,
  });

  if (!result.ok) return failed(result.failure, result.retryAfter);

  refresh(locale);

  return {
    status: 'success',
    outcome: 'enrolment-started',
    totpUri: result.totpUri,
    recoveryCodes: result.recoveryCodes,
    recoveryCodeReceipt: result.recoveryCodeReceipt,
  };
}

export async function confirmEnrolmentAction(
  _previous: SecondFactorState,
  form: FormData,
): Promise<SecondFactorState> {
  const locale = localeFrom(form);
  const parsed = codeSchema.safeParse(form.get('code'));
  if (!parsed.success) return invalid();

  const active = await requireOwnSession(locale);
  if (active === null) return failed('no-session');

  const { privilegedSecurity } = identityRuntime();
  const result = await privilegedSecurity.confirmEnrolment(
    active.context,
    active.session,
    { code: parsed.data },
  );

  if (!result.ok) return failed(result.failure, result.retryAfter);

  // The library REPLACES the session when the factor state changes. Dropping
  // the replacement would sign the person out one request after telling them
  // enrolment succeeded.
  await applySetCookies(result.setCookies);

  // The change owes a notification, committed with its audit record inside
  // Identity's own transaction. Relaying it is derived work.
  dispatchAfterResponse();
  refresh(locale);

  return { status: 'success', outcome: 'verified' };
}

export async function confirmRecoveryCodesAction(
  _previous: SecondFactorState,
  form: FormData,
): Promise<SecondFactorState> {
  const locale = localeFrom(form);
  const receipt = issuanceReceiptSchema.safeParse(form.get('issuanceReceipt'));
  if (!receipt.success) return invalid();

  const active = await requireOwnSession(locale);
  if (active === null) return failed('no-session');

  const { privilegedSecurity } = identityRuntime();
  const result = await privilegedSecurity.confirmRecoveryCodes(active.session, {
    issuanceReceipt: receipt.data,
  });

  if (!result.ok) return failed(result.failure);

  refresh(locale);
  return { status: 'success', outcome: 'codes-confirmed' };
}

export async function regenerateRecoveryCodesAction(
  _previous: SecondFactorState,
  form: FormData,
): Promise<SecondFactorState> {
  const locale = localeFrom(form);
  const password = passwordSchema.safeParse(form.get('password'));
  const code = codeSchema.safeParse(form.get('code'));
  if (!password.success || !code.success) return invalid();

  const active = await requireOwnSession(locale);
  if (active === null) return failed('no-session');

  const { privilegedSecurity } = identityRuntime();
  const result = await privilegedSecurity.regenerateRecoveryCodes(
    active.context,
    active.session,
    { password: password.data, code: code.data },
  );

  if (!result.ok) return failed(result.failure, result.retryAfter);

  refresh(locale);

  return {
    status: 'success',
    outcome: 'regenerated',
    recoveryCodes: result.recoveryCodes,
    recoveryCodeReceipt: result.recoveryCodeReceipt,
  };
}

export async function disableSecondFactorAction(
  _previous: SecondFactorState,
  form: FormData,
): Promise<SecondFactorState> {
  const locale = localeFrom(form);
  const password = passwordSchema.safeParse(form.get('password'));
  if (!password.success) return invalid();

  const rawCode = codeSchema.safeParse(form.get('code'));
  const rawRecovery = codeSchema.safeParse(form.get('recoveryCode'));

  const active = await requireOwnSession(locale);
  if (active === null) return failed('no-session');

  const { privilegedSecurity } = identityRuntime();
  const result = await privilegedSecurity.disableSecondFactor(
    active.context,
    active.session,
    {
      password: password.data,
      // EITHER a current factor OR one single-use recovery code. The service
      // refuses when neither is present; a password alone is exactly the
      // hidden privileged bypass §8.2 forbids.
      ...(rawCode.success ? { code: rawCode.data } : {}),
      ...(rawRecovery.success ? { recoveryCode: rawRecovery.data } : {}),
    },
  );

  if (!result.ok) return failed(result.failure, result.retryAfter);

  await applySetCookies(result.setCookies);
  dispatchAfterResponse();
  refresh(locale);

  return { status: 'success', outcome: 'disabled' };
}
