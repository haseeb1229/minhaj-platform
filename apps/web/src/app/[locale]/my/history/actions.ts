'use server';

import {
  DONE,
  INVALID,
  UNCONFIRMED,
  personalGate,
  refreshMy,
  rejected,
} from '@/components/personal/action-support';
import { decodeTarget } from '@/components/personal/presentation';
import { personalisationRuntime } from '@/composition/personalisation';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * Reading and watch history, as the person clears it (ROUTE_MAP.md §5.1;
 * Phase 21). Recording is not here: it happens only while the person has
 * history turned on, from the content pages' own private island.
 *
 * Class-A browser mutations through Server Actions, each acting as the session
 * it resolves itself and nobody else (SECURITY_BASELINE.md §7.1). Removing is
 * never gated on the content still being public, so a record of something
 * since withdrawn can always be cleared away.
 */

/** Removes one reading-history entry. */
export async function removeReadAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  const target = decodeTarget(form.get('target'));
  if (target === null) return INVALID;
  try {
    await personalisationRuntime().history.removeRead(gate.actor, target);
  } catch (error) {
    return rejected(error, 'personal-history-remove-read');
  }
  refreshMy(gate.locale);
  return DONE;
}

/** Removes one watch-history entry. */
export async function removeWatchAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await personalisationRuntime().history.removeWatch(gate.actor, form.get('videoId'));
  } catch (error) {
    return rejected(error, 'personal-history-remove-watch');
  }
  refreshMy(gate.locale);
  return DONE;
}

/**
 * Clears ALL reading and watch history, after an explicit confirmation. The
 * Quran reading position is a separate thing the person set, and stays.
 */
export async function clearHistoryAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await personalisationRuntime().history.clear(gate.actor);
  } catch (error) {
    return rejected(error, 'personal-history-clear');
  }
  refreshMy(gate.locale);
  return DONE;
}
