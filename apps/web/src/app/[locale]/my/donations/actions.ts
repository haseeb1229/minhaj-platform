'use server';

import { redirect } from 'next/navigation';

import { donationsRejected, startInput } from '@/components/donations/action-support';
import { personalGate } from '@/components/personal/action-support';
import { writeDonationStatusCookie } from '@/composition/donation-status-cookie';
import { donationsRuntime } from '@/composition/donations';
import { publicClientAddress } from '@/composition/request-address';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * Starting a donation LINKED TO THE SIGNED-IN ACCOUNT, from `/my/donations`
 * (DELIVERY_PLAN.md Phase 27) — a Class-A browser mutation through a Server
 * Action, never reachable by GET.
 *
 * THE ACCOUNT IS THE SESSION THE ACTION RESOLVES ITSELF. `personalGate`
 * re-resolves the session through Identity's chokepoint, so a session revoked
 * between render and submit links nothing, and no form field names an
 * account (SECURITY_BASELINE.md §3.4 rule 2). The service spends both the
 * per-address and the per-account budget, and refuses a closed account.
 *
 * THE SAME FLOW AS AN ANONYMOUS GIFT otherwise: the form is a request the
 * service parses exactly, the status cookie is written as soon as a new
 * donation is committed, and the browser is sent only to the checkout address the
 * service returned — already validated against the configured provider's
 * exact checkout origin. `redirect` sits outside the `try`.
 */
export async function startOwnDonation(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  let checkoutUrl: string;
  try {
    const started = await donationsRuntime().donor.start({
      form: startInput(form),
      locale: gate.locale,
      clientAddress: await publicClientAddress(),
      account: gate.actor,
      issueStatusToken: (token) => writeDonationStatusCookie(gate.locale, token),
    });
    checkoutUrl = started.checkoutUrl;
  } catch (error) {
    return donationsRejected(error, 'donation-start-linked');
  }
  redirect(checkoutUrl);
}
