import 'server-only';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import { REPORT_REASONS, type MessagingSurface } from '@minhaj/contracts/messaging';
import { messagingFailure } from '@minhaj/server-core/messaging';

import type { FormActionState } from '@/app/[locale]/(identity)/form-state';
import {
  DONE,
  INVALID,
  UNCONFIRMED,
  personalGate,
  textarea,
  whole,
} from '@/components/personal/action-support';
import { appLogger } from '@/composition/logging';
import { messagingRuntime } from '@/composition/messaging';
import { conversationPath } from './presentation';

/**
 * What every person-facing Messaging Server Action does — from `/my/messages`
 * and from `/teacher/messages` alike (DELIVERY_PLAN.md Phase 24).
 *
 * Each is a Class-A browser mutation (SECURITY_BASELINE.md §7.1): a Server
 * Action under the framework's Origin checks, unreachable by GET. Each
 * resolves the session ITSELF through `personalGate` — the page's guard is
 * navigation — and acts as that account only: a conversation, message or
 * counterpart identifier a form supplies reaches only what the service, on
 * THIS request, decides the account may reach. Membership in a conversation is
 * never enough; the current relationship, the block state and the
 * conversation's own state are re-read every time.
 *
 * NOTHING TYPED LEAVES THROUGH A SIDE DOOR. A refusal is one of Messaging's
 * categories and is returned as that key; an outage is logged as
 * `{ operation }` and nothing else — never a body, a file name, an account or
 * a conversation (SECURITY_BASELINE.md §19.2).
 *
 * The two surfaces differ only in what they re-render afterwards and where a
 * newly opened conversation lives, so each passes its own.
 */

export interface SurfaceRefresh {
  readonly surface: MessagingSurface;
  readonly refresh: (locale: Locale) => void;
}

export const MY_MESSAGES: SurfaceRefresh = {
  surface: 'my',
  refresh: (locale) => revalidatePath(`/${locale}/my`, 'layout'),
};

export const TEACHER_MESSAGES: SurfaceRefresh = {
  surface: 'teacher',
  refresh: (locale) => revalidatePath(`/${locale}/teacher`, 'layout'),
};

/** A failure as the form shows it; only an outage is logged, by name. */
export function messagingRejected(error: unknown, operation: string): FormActionState {
  const failure = messagingFailure(error);
  if (failure === 'unavailable')
    appLogger().error({ operation }, 'Messaging mutation failed.');
  return { status: 'error', failure };
}

/** One text field, as typed; the service validates its shape. */
export function field(form: FormData, name: string): string {
  const raw = form.get(name);
  return typeof raw === 'string' ? raw : '';
}

/** Every value of a repeated field that is text. */
export function fields(form: FormData, name: string): string[] {
  return form.getAll(name).filter((value): value is string => typeof value === 'string');
}

/**
 * Sends one message under the operation identifier the page minted. A retry
 * of the same form is the same operation, and the service answers it with the
 * message it already stored.
 */
export async function sendFrom(
  form: FormData,
  on: SurfaceRefresh,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await messagingRuntime().service.send(gate.actor, field(form, 'conversationId'), {
      operationId: field(form, 'operationId'),
      body: textarea(form, 'body') ?? '',
      attachmentIds: fields(form, 'attachmentIds'),
    });
  } catch (error) {
    return messagingRejected(error, 'messaging-send');
  }
  on.refresh(gate.locale);
  return DONE;
}

/** Raises the reader's high-water mark to a sequence the page showed. */
export async function markReadFrom(
  form: FormData,
  on: SurfaceRefresh,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await messagingRuntime().service.markRead(
      gate.actor,
      field(form, 'conversationId'),
      whole(form, 'sequence'),
    );
  } catch (error) {
    return messagingRejected(error, 'messaging-mark-read');
  }
  on.refresh(gate.locale);
  return DONE;
}

/** Blocks the other person of a direct conversation, after an explicit confirmation. */
export async function blockFrom(
  form: FormData,
  on: SurfaceRefresh,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await messagingRuntime().service.block(gate.actor, field(form, 'conversationId'));
  } catch (error) {
    return messagingRejected(error, 'messaging-block');
  }
  on.refresh(gate.locale);
  return DONE;
}

/** Removes one of the reader's OWN blocks; the account is the session's. */
export async function unblockFrom(
  form: FormData,
  on: SurfaceRefresh,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await messagingRuntime().service.unblock(
      gate.actor,
      field(form, 'counterpartAccountId'),
    );
  } catch (error) {
    return messagingRejected(error, 'messaging-unblock');
  }
  on.refresh(gate.locale);
  return DONE;
}

/**
 * Reports a conversation, or one message in it, for a controlled reason —
 * after an explicit confirmation. There is no free-text narrative: the
 * reported content is the evidence.
 */
export async function reportFrom(
  form: FormData,
  on: SurfaceRefresh,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  const messageId = field(form, 'messageId');
  const reason = REPORT_REASONS.find((choice) => choice === field(form, 'reason'));
  if (reason === undefined) return INVALID;
  try {
    await messagingRuntime().service.report(gate.actor, {
      conversationId: field(form, 'conversationId'),
      messageId: messageId === '' ? null : messageId,
      reason,
    });
  } catch (error) {
    return messagingRejected(error, 'messaging-report');
  }
  on.refresh(gate.locale);
  return DONE;
}

/**
 * Opens — or returns — the conversation of a CURRENT teaching relationship,
 * from either side, and goes to it. The counterpart a form names grants
 * nothing: the service asks Learning, now, whether this account and that one
 * teach and learn on that Course.
 */
export async function startTeachingFrom(
  form: FormData,
  on: SurfaceRefresh,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  let destination: string;
  try {
    const opened = await messagingRuntime().service.startTeaching(gate.actor, {
      counterpartAccountId: field(form, 'counterpartAccountId'),
      courseId: field(form, 'courseId'),
    });
    destination = conversationPath(on.surface, gate.locale, opened.conversationId);
  } catch (error) {
    return messagingRejected(error, 'messaging-start-teaching');
  }
  on.refresh(gate.locale);
  // Outside the try: `redirect` signals by throwing, and that is not a failure.
  redirect(destination);
}
