'use server';

import { redirect } from 'next/navigation';

import { localeSchema } from '@minhaj/contracts';

import { requireOwnSession } from '@/composition/authorization';
import { fatwaRuntime } from '@/composition/fatwa';
import { appLogger } from '@/composition/logging';
import { fatwaFailure } from '@/contexts/fatwa';
import type { FormActionState } from '../../../(identity)/form-state';

/**
 * Asking a question — a Class-A browser mutation through a Server Action: a
 * POST under the framework's Origin checks, never reachable by GET
 * (SECURITY_BASELINE.md §7.1).
 *
 * THE ASKER IS THE SESSION THIS ACTION RESOLVES ITSELF. The page's guard is
 * navigation; this re-resolves the session through Identity's chokepoint, so a
 * session revoked between render and submit asks nothing. No form field names
 * an account.
 *
 * THE QUESTION IS NEVER ECHOED, LOGGED OR PUT IN A URL. A refusal returns a
 * category key only; the text stays in the visitor's own form. Success
 * redirects to the question's opaque id. An outage is logged by operation name
 * only.
 */

/** The refusals the ask form has words for; anything else is `unavailable`. */
const SHOWN = new Set(['inactive', 'invalid', 'rate-limited', 'unavailable']);

export async function submitFatwaQuestion(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const parsedLocale = localeSchema.safeParse(form.get('locale'));
  const locale = parsedLocale.success ? parsedLocale.data : 'en';
  const active = await requireOwnSession(locale);
  if (active === null) return { status: 'error', failure: 'no-session' };

  let id: string;
  try {
    ({ id } = await fatwaRuntime().ask.submit(
      { accountId: active.session.account.id },
      { body: form.get('body') },
    ));
  } catch (error) {
    const reason = fatwaFailure(error);
    const failure = SHOWN.has(reason) ? reason : 'unavailable';
    if (failure === 'unavailable')
      appLogger().error(
        { operation: 'fatwa-question-submission' },
        'Fatwa question submission failed.',
      );
    return { status: 'error', failure };
  }
  // Outside the try: `redirect` signals by throwing, and that is not a failure.
  redirect(`/${locale}/my/questions/${encodeURIComponent(id)}`);
}
