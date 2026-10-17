'use server';

import { redirect } from 'next/navigation';

import {
  MY_MESSAGES,
  blockFrom,
  markReadFrom,
  messagingRejected,
  reportFrom,
  sendFrom,
  startTeachingFrom,
  unblockFrom,
} from '@/components/messaging/action-support';
import { conversationPath } from '@/components/messaging/presentation';
import { personalGate } from '@/components/personal/action-support';
import { messagingRuntime } from '@/composition/messaging';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * A person's own Messaging acts from `/my/messages` (ROUTE_MAP.md §5.1;
 * DELIVERY_PLAN.md Phase 24): send, mark read, block, unblock, report, open a
 * conversation with a current teacher, and open a support conversation.
 *
 * Class-A browser mutations (SECURITY_BASELINE.md §7.1) — Server Actions under
 * the framework's Origin checks, unreachable by GET. Each resolves the session
 * itself and acts as that account only; what each may reach is the Messaging
 * service's decision on this request (`@/components/messaging/action-support`).
 */

export async function sendMessageAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  return sendFrom(form, MY_MESSAGES);
}

export async function markReadAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  return markReadFrom(form, MY_MESSAGES);
}

export async function blockAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  return blockFrom(form, MY_MESSAGES);
}

export async function unblockAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  return unblockFrom(form, MY_MESSAGES);
}

export async function reportAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  return reportFrom(form, MY_MESSAGES);
}

/** Opens — or returns — the conversation with a teacher of a Course the person is on now. */
export async function startTeachingAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  return startTeachingFrom(form, MY_MESSAGES);
}

/**
 * Opens the person's support conversation — or returns the open one, since a
 * person holds at most one open support conversation — and goes to it.
 */
export async function openSupportAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  let destination: string;
  try {
    const opened = await messagingRuntime().service.openSupport(gate.actor);
    destination = conversationPath('my', gate.locale, opened.conversationId);
  } catch (error) {
    return messagingRejected(error, 'messaging-open-support');
  }
  MY_MESSAGES.refresh(gate.locale);
  // Outside the try: `redirect` signals by throwing, and that is not a failure.
  redirect(destination);
}
