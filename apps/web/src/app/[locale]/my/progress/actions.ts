'use server';

import {
  DONE,
  personalGate,
  refreshMy,
  rejected,
  whole,
} from '@/components/personal/action-support';
import { personalisationRuntime } from '@/composition/personalisation';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * The Quran reading position, as the person clears it (ROUTE_MAP.md §5.1;
 * Phase 21). It is SET only from an Ayah page, by the reader saying so; it is
 * never advanced by a page view.
 *
 * A Class-A browser mutation through a Server Action, acting as the session it
 * resolves itself, under the version the page read — so a stale page cannot
 * clear a position set since.
 */
export async function clearQuranProgressAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await personalisationRuntime().history.clearQuranProgress(gate.actor, {
      expectedVersion: whole(form, 'version'),
    });
  } catch (error) {
    return rejected(error, 'personal-quran-progress-clear');
  }
  refreshMy(gate.locale);
  return DONE;
}
