'use server';

import { learningRejected } from '@/components/my-learning/action-support';
import {
  DONE,
  UNCONFIRMED,
  personalGate,
  whole,
} from '@/components/personal/action-support';
import { field, fold, refreshTeacher } from '@/components/teacher/action-support';
import { learningRuntime } from '@/composition/learning';
import type { FormActionState } from '../(identity)/form-state';

/**
 * A teacher's own acts from `/teacher` (ROUTE_MAP.md §6; DELIVERY_PLAN.md
 * Phase 23).
 *
 * EVERY ONE IS A CLASS-A BROWSER MUTATION (SECURITY_BASELINE.md §7.1) — a
 * Server Action, under the framework's Origin checks and unreachable by GET.
 * Each resolves the session itself and acts as that account only; no form
 * field names an account, and the teaching service re-asks Identity for the
 * live `teaching.perform` assignments on every call, so an identifier from
 * somebody else's page reaches only the caller's own scoped rows.
 *
 * THE MEETING ADDRESS GOES IN AND NEVER COMES BACK OUT. `setMeetingAction`
 * hands the typed address to the service, which validates and canonicalises
 * it; the result here is a category — saved, or why not — never the address,
 * which is read by exactly one operation on exactly one page (§11).
 *
 * NO MASS ASSIGNMENT. Each action reads the fields it names and nothing else,
 * and the service parses each against the contract. A version that does not
 * parse is `invalid`; one that is stale is `conflict`.
 */

/** Sets or replaces the meeting link of one scheduled class. */
export async function setMeetingAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await learningRuntime().teaching.setMeeting(
      gate.actor,
      field(form, 'id'),
      whole(form, 'version'),
      { provider: field(form, 'provider'), url: field(form, 'url') },
    );
  } catch (error) {
    return learningRejected(error, 'teaching-set-meeting');
  }
  refreshTeacher(gate.locale);
  return DONE;
}

/** Removes the meeting link of one scheduled class. */
export async function clearMeetingAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await learningRuntime().teaching.setMeeting(
      gate.actor,
      field(form, 'id'),
      whole(form, 'version'),
      null,
    );
  } catch (error) {
    return learningRejected(error, 'teaching-clear-meeting');
  }
  refreshTeacher(gate.locale);
  return DONE;
}

/**
 * The reminder lead a reschedule form names: absent keeps the class's current
 * lead, `none` drops it, a number is a lead the contract accepts or refuses.
 */
function reminderChoice(form: FormData): {
  readonly reminderLeadMinutes?: number | null;
} {
  const raw = form.get('reminder');
  if (raw === 'none') return { reminderLeadMinutes: null };
  if (typeof raw === 'string' && /^\d{1,4}$/.test(raw))
    return { reminderLeadMinutes: Number(raw) };
  return {};
}

/** Moves one scheduled class; the service resolves and bounds the window. */
export async function rescheduleAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await learningRuntime().teaching.reschedule(
      gate.actor,
      field(form, 'id'),
      whole(form, 'version'),
      {
        timeZone: field(form, 'timeZone'),
        startsLocal: field(form, 'startsLocal'),
        endsLocal: field(form, 'endsLocal'),
        startFold: fold(form, 'startFold'),
        endFold: fold(form, 'endFold'),
        ...reminderChoice(form),
      },
    );
  } catch (error) {
    return learningRejected(error, 'teaching-reschedule');
  }
  refreshTeacher(gate.locale);
  return DONE;
}

/** Cancels one scheduled class, after an explicit confirmation. */
export async function cancelSessionAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await learningRuntime().teaching.cancel(
      gate.actor,
      field(form, 'id'),
      whole(form, 'version'),
    );
  } catch (error) {
    return learningRejected(error, 'teaching-cancel');
  }
  refreshTeacher(gate.locale);
  return DONE;
}

/** Marks one scheduled class as held. */
export async function completeSessionAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await learningRuntime().teaching.complete(
      gate.actor,
      field(form, 'id'),
      whole(form, 'version'),
    );
  } catch (error) {
    return learningRejected(error, 'teaching-complete');
  }
  refreshTeacher(gate.locale);
  return DONE;
}

/** Marks one participant present or absent. Idempotent; a re-mark replaces. */
export async function markAttendanceAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await learningRuntime().teaching.markAttendance(
      gate.actor,
      field(form, 'id'),
      field(form, 'accountId'),
      field(form, 'status'),
    );
  } catch (error) {
    return learningRejected(error, 'teaching-mark-attendance');
  }
  refreshTeacher(gate.locale);
  return DONE;
}

/** Offers one availability window. */
export async function openAvailabilityAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await learningRuntime().teaching.openAvailability(gate.actor, {
      timeZone: field(form, 'timeZone'),
      startsLocal: field(form, 'startsLocal'),
      endsLocal: field(form, 'endsLocal'),
      startFold: fold(form, 'startFold'),
      endFold: fold(form, 'endFold'),
    });
  } catch (error) {
    return learningRejected(error, 'teaching-open-availability');
  }
  refreshTeacher(gate.locale);
  return DONE;
}

/** Withdraws one unbooked window. */
export async function withdrawAvailabilityAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await learningRuntime().teaching.withdrawAvailability(
      gate.actor,
      field(form, 'id'),
      whole(form, 'version'),
    );
  } catch (error) {
    return learningRejected(error, 'teaching-withdraw-availability');
  }
  refreshTeacher(gate.locale);
  return DONE;
}
