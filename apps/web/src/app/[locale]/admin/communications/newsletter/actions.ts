'use server';

import { revalidatePath } from 'next/cache';

import { localeSchema } from '@minhaj/contracts';
import { NEWSLETTER_PERMISSIONS } from '@minhaj/contracts/personalisation';

import { requirePermittedAction } from '@/composition/authorization';
import { appLogger } from '@/composition/logging';
import { personalisationRuntime } from '@/composition/personalisation';
import {
  personalFailure,
  type PersonalActor,
} from '@/contexts/personalisation-notifications';
import type { FormActionState } from '../../../(identity)/form-state';

/**
 * The newsletter operator's two mutations (ROUTE_MAP.md §7:
 * `/admin/communications/newsletter`), Phase 21.
 *
 * CLASS-A BROWSER MUTATIONS (SECURITY_BASELINE.md §7.1), each RE-CHECKING
 * `newsletter.operate` against the principal's CURRENT permission set before
 * it reads a field; the page showing the form is navigation, not a boundary
 * (§3.4 rule 2). The Personalisation service asks Identity again, live.
 *
 * TWO NARROW ACTS, BOTH CONFIRMED. Suppressing removes the address and stops
 * the newsletter to it; reinstating lifts a suppression back to
 * `unsubscribed`, never to `confirmed` — the address must opt in afresh. Each
 * names the subscriber and an EXPECTED version, compared and never trusted, so
 * a record that changed since the page loaded is refused, not overwritten.
 * Neither sends anything: no campaign or sending capability exists.
 *
 * A failure is mapped onto the refusal vocabulary, and an unrecognised one is
 * logged by operation name only (§19.2).
 */

const UNCONFIRMED: FormActionState = { status: 'error', failure: 'confirm-required' };

/** A whole decimal number, or `NaN` — never a zero for a missing field. */
function whole(form: FormData, field: string): number {
  const raw = form.get(field);
  return typeof raw === 'string' && /^[0-9]{1,10}$/.test(raw) ? Number(raw) : Number.NaN;
}

async function operate(
  form: FormData,
  operation: 'suppress' | 'reinstate',
): Promise<FormActionState> {
  try {
    if (form.get('confirm') !== 'on') return UNCONFIRMED;
    const locale = localeSchema.parse(form.get('locale'));
    const gate = await requirePermittedAction(locale, NEWSLETTER_PERMISSIONS.operate);
    if (gate.state !== 'allowed') return { status: 'error', failure: gate.reason };

    const actor: PersonalActor = { accountId: gate.session.account.id };
    await personalisationRuntime().newsletter[operation](actor, {
      subscriberId: form.get('subscriberId'),
      expectedVersion: whole(form, 'expectedVersion'),
    });

    revalidatePath(`/${locale}/admin/communications/newsletter`);
    return { status: 'success' };
  } catch (error) {
    const failure = personalFailure(error);
    if (failure === 'unavailable')
      appLogger().error(
        { operation: `newsletter-${operation}` },
        'Newsletter operation failed.',
      );
    return { status: 'error', failure };
  }
}

/** Suppresses a subscription: the address goes, and nothing is sent to it. */
export async function suppressNewsletterSubscriber(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  return operate(form, 'suppress');
}

/** Lifts a suppression back to `unsubscribed`. It resubscribes nobody. */
export async function reinstateNewsletterSubscriber(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  return operate(form, 'reinstate');
}
