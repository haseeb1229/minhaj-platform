'use server';

import {
  DONE,
  UNCONFIRMED,
  personalGate,
  refreshMy,
  whole,
} from '@/components/personal/action-support';
import { learningRejected } from '@/components/my-learning/action-support';
import { learningRuntime } from '@/composition/learning';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * A person's own class acts from `/my/classes` (ROUTE_MAP.md §5.1;
 * DELIVERY_PLAN.md Phase 23).
 *
 * ONE ACT, AND IT IS THE PERSON'S OWN: cancelling their own confirmed future
 * trial Booking. A Class-A browser mutation (SECURITY_BASELINE.md §7.1) — a
 * Server Action under the framework's Origin checks, unreachable by GET. It
 * resolves the session itself and acts as that account only: the Booking
 * identifier a form supplies reaches only the caller's own rows, because the
 * adapter puts the account in every predicate.
 *
 * NO REGULAR CLASS IS TOUCHED HERE. A Course session is everybody's class;
 * only its teacher or an operator moves or cancels it.
 */

/** One identifier field, as typed; the service validates its shape. */
function field(form: FormData, name: string): string {
  const raw = form.get(name);
  return typeof raw === 'string' ? raw : '';
}

/**
 * Cancels the person's own trial Booking — and with it the single-participant
 * session — after an explicit confirmation, under the version they were shown.
 */
export async function cancelBookingAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await learningRuntime().myClasses.cancelBooking(
      gate.actor,
      field(form, 'bookingId'),
      whole(form, 'version'),
    );
  } catch (error) {
    return learningRejected(error, 'learning-cancel-booking');
  }
  refreshMy(gate.locale);
  return DONE;
}
