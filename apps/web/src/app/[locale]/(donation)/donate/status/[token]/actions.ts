'use server';

import { redirect } from 'next/navigation';

import { localeSchema, type Locale } from '@minhaj/contracts';

import { donationsRejected } from '@/components/donations/action-support';
import {
  donationStatusPath,
  readStatusToken,
  withQuery,
  type StatusNotice,
} from '@/components/donations/presentation';
import { donationsRuntime } from '@/composition/donations';
import { publicClientAddress } from '@/composition/request-address';
import type { FormActionState } from '../../../../(identity)/form-state';

/**
 * The status token holder's two acts (DELIVERY_PLAN.md Phase 27): ask the
 * provider again about a pending checkout, and ask to abandon one that is
 * still open. Class-A browser mutations through Server Actions — POSTs under
 * the framework's Origin checks, never reachable by GET, which is why the
 * status page itself only reads.
 *
 * THE TOKEN IS THE ONLY AUTHORITY, AND A NARROW ONE. It reaches one donation,
 * and can only read it, re-read the provider for it, or ask to end its open
 * checkout; no session, cookie or account is consulted. A malformed or
 * unknown token is the same `not-found`. Each act spends its own per-address
 * budget in the service.
 *
 * NEITHER ACT DECIDES AN OUTCOME. Checking applies only what the provider
 * reports; cancelling records the request, asks the provider to end the
 * session and then applies what the provider reports — so a payment that
 * completed first wins, and the donation reads succeeded, never cancelled.
 *
 * SUCCESS NAVIGATES back to the status page with a fixed notice key, so the
 * page re-reads and shows the provider's answer; `redirect` sits outside the
 * `try`, because it signals by throwing.
 */

const NOT_FOUND: FormActionState = { status: 'error', failure: 'not-found' };
const UNCONFIRMED: FormActionState = { status: 'error', failure: 'confirm-required' };

function read(form: FormData): {
  readonly locale: Locale;
  readonly token: string | null;
} {
  const parsed = localeSchema.safeParse(form.get('locale'));
  return {
    locale: parsed.success ? parsed.data : 'en',
    token: readStatusToken(form.get('token')),
  };
}

function back(locale: Locale, token: string, done: StatusNotice): never {
  redirect(withQuery(donationStatusPath(locale, token), { done }));
}

/** Asks the provider again about a pending donation. Changes nothing on its own. */
export async function checkDonationAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const { locale, token } = read(form);
  if (token === null) return NOT_FOUND;
  try {
    const view = await donationsRuntime().donor.check(token, await publicClientAddress());
    if (view === null) return NOT_FOUND;
  } catch (error) {
    return donationsRejected(error, 'donation-check');
  }
  back(locale, token, 'checked');
}

/** Asks to abandon a still-open checkout, after an explicit confirmation. */
export async function cancelDonationAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const { locale, token } = read(form);
  if (token === null) return NOT_FOUND;
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  try {
    const view = await donationsRuntime().donor.cancel(
      token,
      await publicClientAddress(),
    );
    if (view === null) return NOT_FOUND;
  } catch (error) {
    return donationsRejected(error, 'donation-cancel');
  }
  back(locale, token, 'cancel-requested');
}
