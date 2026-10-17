'use server';

import {
  TEACHER_MESSAGES,
  blockFrom,
  markReadFrom,
  reportFrom,
  sendFrom,
  startTeachingFrom,
  unblockFrom,
} from '@/components/messaging/action-support';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * A teacher's Messaging acts from `/teacher/messages` and a student's page
 * (ROUTE_MAP.md §6; DELIVERY_PLAN.md Phase 24): send, mark read, block,
 * unblock, report, and open a conversation with a learner the teacher
 * currently teaches on a Course.
 *
 * Class-A browser mutations (SECURITY_BASELINE.md §7.1). The Teacher area's
 * guard is navigation; none of these trusts it. Each resolves the session
 * itself, and the Messaging service asks Learning — and through it Identity,
 * LIVE — whether the teaching relationship holds on this request. A revoked
 * assignment or an ended scope stops every act here on the next submission.
 */

export async function sendTeacherMessageAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  return sendFrom(form, TEACHER_MESSAGES);
}

export async function markTeacherReadAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  return markReadFrom(form, TEACHER_MESSAGES);
}

export async function blockTeacherAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  return blockFrom(form, TEACHER_MESSAGES);
}

export async function unblockTeacherAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  return unblockFrom(form, TEACHER_MESSAGES);
}

export async function reportTeacherAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  return reportFrom(form, TEACHER_MESSAGES);
}

/** Opens — or returns — the conversation with a learner on a Course the teacher teaches now. */
export async function startTeacherConversationAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  return startTeachingFrom(form, TEACHER_MESSAGES);
}
