import 'server-only';

import { appLogger } from '@/composition/logging';
import { donationsFailure } from '@/contexts/donations';

/**
 * The reads a private Donations page makes — the status page, My donations,
 * the `/my` panel and the administration — each with its failure kept visible
 * rather than thrown (DELIVERY_PLAN.md Phase 27).
 *
 * A REFUSAL IS AN ANSWER, AN OUTAGE IS NOT. `donationsRead` returns the
 * service's own refusal category — `denied` and `not-found` become a 404 —
 * and only an outage is logged, by operation name alone: never an account, a
 * token, an amount or a provider reference (SECURITY_BASELINE.md §19.2). A
 * page whose read fails says so inside its own frame, never as an empty list
 * that reads as "you have given nothing".
 *
 * NOT FOR THE PUBLIC GIVING PAGE. `/donate` awaits its public reader directly
 * (`./public-read.ts`), like every other content route, and its outage is
 * the locale's error boundary.
 */

export type DonationsFailure = ReturnType<typeof donationsFailure>;

export type DonationsRead<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: DonationsFailure };

export async function donationsRead<T>(
  operation: string,
  work: () => Promise<T>,
): Promise<DonationsRead<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    const failure = donationsFailure(error);
    if (failure === 'unavailable')
      appLogger().error({ operation }, 'Donations read failed.');
    return { ok: false, failure };
  }
}
