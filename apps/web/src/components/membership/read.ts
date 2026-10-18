import 'server-only';

import { appLogger } from '@/composition/logging';
import { membershipFailure, type MembershipRefusalReason } from '@/contexts/membership';

/**
 * The reads a private Membership page makes — My Membership, the `/my`
 * panel and the administration — each with its failure kept visible rather
 * than thrown (DELIVERY_PLAN.md Phase 26).
 *
 * A REFUSAL IS AN ANSWER, AN OUTAGE IS NOT. `membershipRead` returns the
 * service's own refusal category — `denied` and `not-found` become the
 * administrative 404 — and only an outage is logged, by operation name alone:
 * never an account, a type's words or an application (SECURITY_BASELINE.md
 * §19.2). A page whose read fails says so inside its own frame, never as a
 * count of zero that reads as "you have nothing".
 *
 * NOT FOR THE PUBLIC PAGE. The anonymous catalogue awaits its public reader
 * directly, like every other content route, and its outage is the locale's
 * error boundary.
 */

export type MembershipRead<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: MembershipRefusalReason };

export async function membershipRead<T>(
  operation: string,
  work: () => Promise<T>,
): Promise<MembershipRead<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    const failure = membershipFailure(error);
    if (failure === 'unavailable')
      appLogger().error({ operation }, 'Membership read failed.');
    return { ok: false, failure };
  }
}
