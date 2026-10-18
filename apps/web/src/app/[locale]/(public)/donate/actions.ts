'use server';

import { redirect } from 'next/navigation';

import { localeSchema } from '@minhaj/contracts';

import { donationsRejected, startInput } from '@/components/donations/action-support';
import { writeDonationStatusCookie } from '@/composition/donation-status-cookie';
import { donationsRuntime } from '@/composition/donations';
import { publicClientAddress } from '@/composition/request-address';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * Starting an ANONYMOUS donation from `/donate` (DELIVERY_PLAN.md Phase 27) —
 * a Class-A browser mutation through a Server Action, so a POST under the
 * framework's Origin checks and never reachable by GET (SECURITY_BASELINE.md
 * §7.1).
 *
 * NO SESSION, EVER. Giving here belongs to nobody: this action reads no
 * cookie, no session and no account, so being signed in changes nothing about
 * what it does — a gift linked to an account starts from `/my/donations`. The
 * network address is used solely as the subject of the keyed, expiring rate
 * limiter.
 *
 * THE ONE COOKIE IT WRITES. The moment the service has committed a NEW
 * donation — before the provider is called, so even an ambiguous first
 * checkout leaves the browser able to find it — it issues the status token
 * once through `issueStatusToken`, and `writeDonationStatusCookie` stores it so
 * the provider's return page can find this browser's donation. That writer can
 * only `.set` — it reads nothing — and a duplicate submission issues no token,
 * because the browser already holds it from the first.
 *
 * THE REDIRECT IS THE SERVICE'S. The browser is sent only to the checkout
 * address the service returned, which it has already validated against the
 * configured provider's exact checkout origin; this action never builds or
 * accepts a destination of its own. `redirect` sits outside the `try`,
 * because it signals by throwing and that is not a failure. A refusal stays
 * on the form, in words; nothing typed is echoed or logged.
 */
export async function startDonation(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const parsed = localeSchema.safeParse(form.get('locale'));
  const locale = parsed.success ? parsed.data : 'en';
  let checkoutUrl: string;
  try {
    const started = await donationsRuntime().donor.start({
      form: startInput(form),
      locale,
      clientAddress: await publicClientAddress(),
      account: null,
      issueStatusToken: (token) => writeDonationStatusCookie(locale, token),
    });
    checkoutUrl = started.checkoutUrl;
  } catch (error) {
    return donationsRejected(error, 'donation-start');
  }
  redirect(checkoutUrl);
}
