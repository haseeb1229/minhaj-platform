'use server';

import {
  DONE,
  personalGate,
  refreshMy,
  rejected,
  whole,
} from '@/components/personal/action-support';
import { personalisationRuntime } from '@/composition/personalisation';
import type { FormActionState } from '../../../(identity)/form-state';

/**
 * Interests & Goals — the optional personalisation onboarding (ROUTE_MAP.md
 * §5.1; Phase 21).
 *
 * NEVER A GATE. Saving and skipping are both complete answers, both editable
 * later, and nothing anywhere waits on either. The choices are taken only from
 * the contract's fixed vocabulary of public areas and goals; anything else the
 * form carries is refused, never stored.
 *
 * Class-A browser mutations through Server Actions, acting as the session each
 * resolves itself, under the version the page read.
 */

/** Saves the person's chosen interests and goals. */
export async function saveInterestsAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await personalisationRuntime().settings.completeOnboarding(gate.actor, {
      interests: form.getAll('interest'),
      goals: form.getAll('goal'),
      expectedVersion: whole(form, 'version'),
    });
  } catch (error) {
    return rejected(error, 'personal-onboarding-save');
  }
  refreshMy(gate.locale);
  return DONE;
}

/** Declines the questions. Nothing is chosen, and they stay open to answer later. */
export async function skipInterestsAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await personalisationRuntime().settings.skipOnboarding(
      gate.actor,
      whole(form, 'version'),
    );
  } catch (error) {
    return rejected(error, 'personal-onboarding-skip');
  }
  refreshMy(gate.locale);
  return DONE;
}
