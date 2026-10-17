'use server';

import { revalidatePath } from 'next/cache';

import { localeSchema, type Locale } from '@minhaj/contracts';
import type { PermissionKey } from '@minhaj/contracts/identity';
import { MODERATION_ACTIONS } from '@minhaj/contracts/messaging';

import { field, fields, messagingRejected } from '@/components/messaging/action-support';
import { textarea, whole } from '@/components/personal/action-support';
import { requirePermittedAction } from '@/composition/authorization';
import { messagingRuntime } from '@/composition/messaging';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * The Messaging administrative mutations (ROUTE_MAP.md §7; DELIVERY_PLAN.md
 * Phase 24): claim, answer and resolve a support conversation under
 * `messaging.support`; decide a report under `messaging.moderate`.
 *
 * EVERY ONE RE-CHECKS ITS KEY HERE, against the principal's CURRENT
 * permission set, and the Messaging service checks it again live. The page
 * that rendered the form decided only whether to show it
 * (SECURITY_BASELINE.md §3.4 rule 2). These keys are gated by explicit
 * assignment; the acts change no account's privilege, credentials or status,
 * so they are not step-up operations (`requirePermittedAction`, not
 * `requirePrivilegedActor`).
 *
 * UNDER AN EXPECTED VERSION. A claim, a resolution and a decision each carry
 * the version the operator was shown, so two operators acting on one stale
 * page meet a visible conflict, never a silent double decision.
 *
 * NOTHING TYPED IS ECHOED OR LOGGED. A refusal is one of Messaging's
 * categories; an outage is logged as `{ operation }` alone.
 */

const DENIED: FormActionState = { status: 'error', failure: 'denied' };
const UNCONFIRMED: FormActionState = { status: 'error', failure: 'confirm-required' };
const INVALID: FormActionState = { status: 'error', failure: 'invalid' };
const DONE: FormActionState = { status: 'success' };

/** The locale, then the live permission: who acts, or `null` for a refusal. */
async function authorise(
  form: FormData,
  permission: PermissionKey,
): Promise<{ readonly locale: Locale; readonly accountId: string } | null> {
  const parsed = localeSchema.safeParse(form.get('locale'));
  const locale = parsed.success ? parsed.data : 'en';
  const permitted = await requirePermittedAction(locale, permission);
  if (permitted.state === 'denied') return null;
  return { locale, accountId: permitted.session.account.id };
}

function refreshed(locale: Locale): void {
  revalidatePath(`/${locale}/admin/messaging`, 'layout');
}

/** Takes an unclaimed support conversation, so its holder may answer it. */
export async function claimSupportAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await authorise(form, 'messaging.support');
  if (actor === null) return DENIED;
  try {
    await messagingRuntime().service.claimSupport(
      { accountId: actor.accountId },
      field(form, 'conversationId'),
      whole(form, 'version'),
    );
  } catch (error) {
    return messagingRejected(error, 'messaging-support-claim');
  }
  refreshed(actor.locale);
  return DONE;
}

/** Resolves a support conversation, after an explicit confirmation. */
export async function resolveSupportAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const actor = await authorise(form, 'messaging.support');
  if (actor === null) return DENIED;
  try {
    await messagingRuntime().service.resolveSupport(
      { accountId: actor.accountId },
      field(form, 'conversationId'),
      whole(form, 'version'),
    );
  } catch (error) {
    return messagingRejected(error, 'messaging-support-resolve');
  }
  refreshed(actor.locale);
  return DONE;
}

/**
 * Answers a support conversation the operator has claimed. The send is the
 * ordinary Messaging send — the operator is the conversation's active support
 * participant — under the operation identifier the page minted.
 */
export async function supportReplyAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await authorise(form, 'messaging.support');
  if (actor === null) return DENIED;
  try {
    await messagingRuntime().service.send(
      { accountId: actor.accountId },
      field(form, 'conversationId'),
      {
        operationId: field(form, 'operationId'),
        body: textarea(form, 'body') ?? '',
        attachmentIds: fields(form, 'attachmentIds'),
      },
    );
  } catch (error) {
    return messagingRejected(error, 'messaging-support-reply');
  }
  refreshed(actor.locale);
  return DONE;
}

/** Decides one report — dismiss, withhold the message, or close the conversation. */
export async function decideReportAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const choice = MODERATION_ACTIONS.find((action) => action === field(form, 'action'));
  if (choice === undefined) return INVALID;
  const actor = await authorise(form, 'messaging.moderate');
  if (actor === null) return DENIED;
  try {
    await messagingRuntime().service.decide(
      { accountId: actor.accountId },
      {
        reportId: field(form, 'reportId'),
        action: choice,
        expectedVersion: whole(form, 'version'),
      },
    );
  } catch (error) {
    return messagingRejected(error, 'messaging-moderation-decide');
  }
  refreshed(actor.locale);
  return DONE;
}
