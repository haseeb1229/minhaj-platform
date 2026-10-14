'use server';

import {
  DONE,
  personalGate,
  refreshMy,
  rejected,
} from '@/components/personal/action-support';
import { personalisationRuntime } from '@/composition/personalisation';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * In-app notifications, as the person reads and clears them (ROUTE_MAP.md
 * §5.1; Phase 21).
 *
 * Class-A browser mutations through Server Actions, each acting as the session
 * it resolves itself: a notification id from the form is looked up WITH that
 * account in the predicate, so somebody else's id changes nothing. The bulk
 * actions have their own, tighter rate limit, and hitting it is shown as such.
 */

/** Marks one notification read. */
export async function markNotificationReadAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await personalisationRuntime().notifications.markRead(gate.actor, form.get('id'));
  } catch (error) {
    return rejected(error, 'personal-notification-read');
  }
  refreshMy(gate.locale);
  return DONE;
}

/** Removes one notification. */
export async function removeNotificationAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await personalisationRuntime().notifications.remove(gate.actor, form.get('id'));
  } catch (error) {
    return rejected(error, 'personal-notification-remove');
  }
  refreshMy(gate.locale);
  return DONE;
}

/** Marks every notification read. */
export async function markAllNotificationsReadAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await personalisationRuntime().notifications.markAllRead(gate.actor);
  } catch (error) {
    return rejected(error, 'personal-notification-read-all');
  }
  refreshMy(gate.locale);
  return DONE;
}

/** Removes every notification already read; unread ones stay. */
export async function clearReadNotificationsAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await personalisationRuntime().notifications.clearRead(gate.actor);
  } catch (error) {
    return rejected(error, 'personal-notification-clear-read');
  }
  refreshMy(gate.locale);
  return DONE;
}
