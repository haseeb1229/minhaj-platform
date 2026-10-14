'use server';

import { dispatchAfterResponse } from '@/composition/dispatch';
import { appLogger } from '@/composition/logging';
import { personalisationRuntime } from '@/composition/personalisation';
import { publicClientAddress } from '@/composition/request-address';
import { personalFailure } from '@/contexts/personalisation-notifications';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * The newsletter's three public mutations (DOMAIN_MODEL.md §14.5) — each a
 * Class-A browser mutation through a Server Action, so a POST under the
 * framework's Origin checks and never reachable by GET (SECURITY_BASELINE.md
 * §7.1). The emailed links only RENDER; these consume.
 *
 * NO SESSION, EVER. Subscribing, confirming and unsubscribing belong to an
 * address, not an account: none of these reads a cookie, a session or an
 * account, so being signed in changes nothing about what they do. The network
 * address is used solely as the subject of the keyed, expiring rate limiter.
 *
 * ANTI-ENUMERATING. A submission answers the same for every address in every
 * state; only malformed input and a spent rate budget are told apart, and any
 * other failure reads as a generic outage. A link that is expired, used or
 * unknown is simply `invalid-link`.
 *
 * NOTHING PERSONAL IS LOGGED: an unexpected failure is logged by operation
 * name only — never the address, never the token.
 */

const DISTINGUISHED: ReadonlySet<string> = new Set(['invalid', 'rate-limited']);

function rejected(error: unknown, operation: string): FormActionState {
  const failure = personalFailure(error);
  if (DISTINGUISHED.has(failure)) return { status: 'error', failure };
  appLogger().error({ operation }, 'Newsletter request failed.');
  return { status: 'error', failure: 'unavailable' };
}

/**
 * Accepts a subscription request. Activates nothing: an owed confirmation is
 * dispatched promptly, after the response, and the same answer comes back
 * whether or not anything was owed.
 */
export async function subscribeNewsletter(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    await personalisationRuntime().newsletter.submit(
      { email: form.get('email'), locale: form.get('locale') },
      await publicClientAddress(),
    );
  } catch (error) {
    return rejected(error, 'newsletter-submit');
  }

  dispatchAfterResponse();
  return { status: 'success' };
}

/** Consumes a confirmation link — once. */
export async function confirmNewsletter(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const outcome = await personalisationRuntime().newsletter.confirm(
      form.get('token'),
      await publicClientAddress(),
    );
    return outcome === 'confirmed'
      ? { status: 'success' }
      : { status: 'error', failure: 'invalid-link' };
  } catch (error) {
    return rejected(error, 'newsletter-confirm');
  }
}

/** Unsubscribes. Idempotent: the same link a second time answers the same. */
export async function unsubscribeNewsletter(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  try {
    const outcome = await personalisationRuntime().newsletter.unsubscribe(
      form.get('token'),
      await publicClientAddress(),
    );
    return outcome === 'unsubscribed'
      ? { status: 'success' }
      : { status: 'error', failure: 'invalid-link' };
  } catch (error) {
    return rejected(error, 'newsletter-unsubscribe');
  }
}
