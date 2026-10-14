import 'server-only';

import { revalidatePath } from 'next/cache';

import { localeSchema, type Locale } from '@minhaj/contracts';

import type { FormActionState } from '@/app/[locale]/(identity)/form-state';
import { requireOwnSession } from '@/composition/authorization';
import { appLogger } from '@/composition/logging';
import {
  personalFailure,
  type PersonalActor,
} from '@/contexts/personalisation-notifications';

/**
 * What every My Minhaj Personalisation Server Action does first and last.
 *
 * THE OWNER IS THE SESSION THE ACTION RESOLVES ITSELF. The page's guard is
 * navigation; this re-resolves the session through Identity's chokepoint, so a
 * session revoked between render and submit changes nothing, and the actor is
 * that session's account — no form field names an account
 * (SECURITY_BASELINE.md §3.4 rule 2).
 *
 * NOTHING PERSONAL LEAVES THROUGH A SIDE DOOR. A refusal is a category key; an
 * outage is logged by operation name only — never a note, a title, a target or
 * a notification (§19.2).
 */

export const INVALID: FormActionState = { status: 'error', failure: 'invalid' };
export const UNCONFIRMED: FormActionState = {
  status: 'error',
  failure: 'confirm-required',
};
export const DONE: FormActionState = { status: 'success' };

/** The locale, then the live session: who acts, or the state to return. */
export async function personalGate(
  form: FormData,
): Promise<
  | { readonly locale: Locale; readonly actor: PersonalActor }
  | { readonly locale: Locale; readonly refused: FormActionState }
> {
  const parsed = localeSchema.safeParse(form.get('locale'));
  const locale = parsed.success ? parsed.data : 'en';
  const active = await requireOwnSession(locale);
  if (active === null)
    return { locale, refused: { status: 'error', failure: 'no-session' } };
  return { locale, actor: { accountId: active.session.account.id } };
}

/** A failure as the form shows it; only an outage is logged, by name. */
export function rejected(error: unknown, operation: string): FormActionState {
  const failure = personalFailure(error);
  if (failure === 'unavailable')
    appLogger().error({ operation }, 'Personalisation mutation failed.');
  return { status: 'error', failure };
}

/** Re-renders every My Minhaj page after a change any of them may display. */
export function refreshMy(locale: Locale): void {
  revalidatePath(`/${locale}/my`, 'layout');
}

/** A whole decimal number, or `NaN` — never a zero for a missing field. */
export function whole(form: FormData, field: string): number {
  const raw = form.get(field);
  return typeof raw === 'string' && /^[0-9]{1,10}$/.test(raw) ? Number(raw) : Number.NaN;
}

/**
 * A textarea's text, transport-decoded and otherwise exactly as typed: the
 * form encoding's CRLF becomes the LF the textarea held. The contract trims.
 */
export function textarea(form: FormData, field: string): string | null {
  const raw = form.get(field);
  return typeof raw === 'string' ? raw.replace(/\r\n/g, '\n') : null;
}
