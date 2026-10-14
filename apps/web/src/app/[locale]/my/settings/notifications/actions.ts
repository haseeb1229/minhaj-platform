'use server';

import {
  DONE,
  INVALID,
  personalGate,
  refreshMy,
  rejected,
} from '@/components/personal/action-support';
import { personalisationRuntime } from '@/composition/personalisation';
import type { FormActionState } from '../../../(identity)/form-state';

/**
 * Notification preferences (ROUTE_MAP.md §5.1; Phase 21).
 *
 * ONE CATEGORY ON ONE CHANNEL PER SUBMISSION, named by the contract's own
 * vocabulary — and that vocabulary holds no security or account mail at all,
 * so nothing submitted here can reach Identity's verification, password-reset
 * or security-alert messages, which are always sent.
 */
export async function setNotificationPreferenceAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  const enabled = form.get('enabled');
  if (enabled !== 'true' && enabled !== 'false') return INVALID;
  try {
    await personalisationRuntime().notifications.setPreference(gate.actor, {
      category: form.get('category'),
      channel: form.get('channel'),
      enabled: enabled === 'true',
    });
  } catch (error) {
    return rejected(error, 'personal-notification-preference');
  }
  refreshMy(gate.locale);
  return DONE;
}
