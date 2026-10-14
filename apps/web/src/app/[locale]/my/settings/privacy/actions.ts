'use server';

import {
  DONE,
  INVALID,
  personalGate,
  refreshMy,
  rejected,
  whole,
} from '@/components/personal/action-support';
import { personalisationRuntime } from '@/composition/personalisation';
import type { FormActionState } from '../../../(identity)/form-state';

/**
 * The history switch (ROUTE_MAP.md §5.1; Phase 21).
 *
 * HISTORY IS OFF UNTIL THE PERSON TURNS IT ON, and only this action turns it
 * on — a Class-A browser mutation acting as the session it resolves itself,
 * under the version the page read. Turning it off stops recording at once;
 * what was already recorded stays until the person clears it.
 */
export async function setHistoryAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  const enabled = form.get('enabled');
  if (enabled !== 'true' && enabled !== 'false') return INVALID;
  try {
    await personalisationRuntime().settings.setHistory(gate.actor, {
      enabled: enabled === 'true',
      expectedVersion: whole(form, 'version'),
    });
  } catch (error) {
    return rejected(error, 'personal-history-setting');
  }
  refreshMy(gate.locale);
  return DONE;
}
