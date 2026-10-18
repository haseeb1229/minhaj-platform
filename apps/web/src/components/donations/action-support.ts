import 'server-only';

import type { FormActionState } from '@/app/[locale]/(identity)/form-state';
import { appLogger } from '@/composition/logging';
import { donationsFailure } from '@/contexts/donations';
import { requestedAmount } from './presentation';

/**
 * Donations' half of what a Donations Server Action does last — on `/donate`,
 * on the status page, on `/my/donations` and in the administration alike.
 *
 * WHO ACTS is resolved by the caller: nobody for an anonymous gift, the
 * status token's holder for a check or a cancellation, `personalGate` for a
 * linked gift, `requirePermittedAction` or `requirePrivilegedActor` for an
 * operator. Only the refusal vocabulary is Donations' own: a refusal is one
 * of its categories, and an outage is logged by operation name alone — never
 * an account, a token, an amount or a provider reference
 * (SECURITY_BASELINE.md §19.2).
 */
export function donationsRejected(error: unknown, operation: string): FormActionState {
  const failure = donationsFailure(error);
  if (failure === 'unavailable')
    appLogger().error({ operation }, 'Donations action failed.');
  return { status: 'error', failure };
}

/** One text field, as typed; the service validates its shape. Absent is empty. */
export function field(form: FormData, name: string): string {
  const raw = form.get(name);
  return typeof raw === 'string' ? raw : '';
}

/**
 * The giving form as the service's `DonationStart` input — exactly the four
 * fields the strict schema names, read by name, never a spread of the form.
 */
export function startInput(form: FormData): {
  readonly operationId: string;
  readonly campaignId: string;
  readonly currency: string;
  readonly amount: string;
} {
  const money = requestedAmount({
    suggested: field(form, 'suggested'),
    currency: field(form, 'currency'),
    amount: field(form, 'amount'),
  });
  return {
    operationId: field(form, 'operationId'),
    campaignId: field(form, 'campaignId'),
    currency: money.currency,
    amount: money.amount,
  };
}
