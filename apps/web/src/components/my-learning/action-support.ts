import 'server-only';

import type { FormActionState } from '@/app/[locale]/(identity)/form-state';
import { appLogger } from '@/composition/logging';
import { learningFailure } from '@/contexts/learning';

/**
 * Learning's half of what a My Minhaj Server Action does last.
 *
 * WHO ACTS is resolved exactly as every My Minhaj action resolves it — by
 * `personalGate`, which re-resolves the session through Identity's chokepoint
 * and yields that session's account and nothing a form supplies. Only the
 * refusal vocabulary is Learning's own: a refusal is one of Learning's
 * categories, and an outage is logged by operation name alone — never a
 * Course, a lesson or an account (SECURITY_BASELINE.md §19.2).
 */
export function learningRejected(error: unknown, operation: string): FormActionState {
  const failure = learningFailure(error);
  if (failure === 'unavailable')
    appLogger().error({ operation }, 'Learning mutation failed.');
  return { status: 'error', failure };
}
