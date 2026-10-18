import 'server-only';

import type { FormActionState } from '@/app/[locale]/(identity)/form-state';
import { appLogger } from '@/composition/logging';
import { membershipFailure } from '@/contexts/membership';

/**
 * Membership's half of what a Membership Server Action does last — on
 * `/my/membership` and in the administration alike.
 *
 * WHO ACTS is resolved by the caller: `personalGate` for a person's own acts,
 * `requirePermittedAction` for an operator's, each re-resolving the session
 * through Identity's chokepoint. Only the refusal vocabulary is Membership's
 * own: a refusal is one of its categories, and an outage is logged by
 * operation name alone — never an account, a type's words or an application
 * (SECURITY_BASELINE.md §19.2).
 */
export function membershipRejected(error: unknown, operation: string): FormActionState {
  const failure = membershipFailure(error);
  if (failure === 'unavailable')
    appLogger().error({ operation }, 'Membership mutation failed.');
  return { status: 'error', failure };
}

/** One text field, as typed; the service validates its shape. Absent is empty. */
export function field(form: FormData, name: string): string {
  const raw = form.get(name);
  return typeof raw === 'string' ? raw : '';
}
