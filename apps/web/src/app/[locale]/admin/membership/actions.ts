'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { localeSchema, type Locale } from '@minhaj/contracts';

import { field, membershipRejected } from '@/components/membership/action-support';
import { textarea, whole } from '@/components/personal/action-support';
import { requirePermittedAction } from '@/composition/authorization';
import { membershipRuntime } from '@/composition/membership';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * The Membership administrative mutations (DELIVERY_PLAN.md Phase 26): the
 * type catalogue — create, reorder, each locale's words, publish and archive —
 * and the application workflow — start review, approve or reject — and the
 * operator's closure of a Membership.
 *
 * EVERY ONE RE-CHECKS `membership.administer` HERE, against the principal's
 * CURRENT permission set, and the Membership service checks it again live. The
 * page that rendered the form decided only whether to show it
 * (SECURITY_BASELINE.md §3.4 rule 2). The key is ordinary and the acts change
 * no account's privilege, credentials or status, so they are not step-up
 * operations (`requirePermittedAction`, not `requirePrivilegedActor`).
 *
 * UNDER AN EXPECTED VERSION. Every act on an existing record carries the
 * version the operator was shown, so two operators acting on one stale page
 * meet a visible conflict, never a silent double decision. A decision and a
 * closure need an explicit confirmation first.
 *
 * NO MASS ASSIGNMENT. Each action reads the fields its form names, by name,
 * and hands them to the service, whose strict schemas decide what they mean;
 * nothing typed is echoed or logged. A refusal is one of Membership's
 * categories; an outage is logged as `{ operation }` alone. The audit row is
 * the service's, committed with the change it describes.
 */

const UNCONFIRMED: FormActionState = { status: 'error', failure: 'confirm-required' };
const DONE: FormActionState = { status: 'success' };

/** The locale, then the live permission: who acts, or `null` for a refusal. */
async function authorise(
  form: FormData,
): Promise<
  | { readonly locale: Locale; readonly accountId: string }
  | { readonly refused: FormActionState }
> {
  const parsed = localeSchema.safeParse(form.get('locale'));
  const locale = parsed.success ? parsed.data : 'en';
  const permitted = await requirePermittedAction(locale, 'membership.administer');
  if (permitted.state === 'denied')
    return { refused: { status: 'error', failure: permitted.reason } };
  return { locale, accountId: permitted.session.account.id };
}

function refreshed(locale: Locale): void {
  revalidatePath(`/${locale}/admin/membership`, 'layout');
}

/** One locale's words as the form names them; the contract trims and bounds them. */
function label(form: FormData, locale: string) {
  return {
    locale,
    title: field(form, 'title'),
    summary: textarea(form, 'summary') ?? '',
    description: textarea(form, 'description') ?? '',
    guidance: textarea(form, 'guidance') ?? '',
  };
}

/* ===========================================================================
 * Types
 * ========================================================================= */

/** A new draft type in its primary locale; the editor opens on it. */
export async function createTypeAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await authorise(form);
  if ('refused' in actor) return actor.refused;
  const primaryLocale = field(form, 'primaryLocale');
  let id: string;
  try {
    ({ id } = await membershipRuntime().admin.createType(
      { accountId: actor.accountId },
      {
        primaryLocale,
        displayOrder: whole(form, 'displayOrder'),
        label: label(form, primaryLocale),
      },
    ));
  } catch (error) {
    return membershipRejected(error, 'membership-type-create');
  }
  refreshed(actor.locale);
  // Outside the try: `redirect` signals by throwing, and that is not a failure.
  redirect(`/${actor.locale}/admin/membership?type=${encodeURIComponent(id)}`);
}

/** Moves a type in display order. */
export async function reorderTypeAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await authorise(form);
  if ('refused' in actor) return actor.refused;
  try {
    await membershipRuntime().admin.reorderType(
      { accountId: actor.accountId },
      {
        id: field(form, 'id'),
        expectedVersion: whole(form, 'version'),
        displayOrder: whole(form, 'displayOrder'),
      },
    );
  } catch (error) {
    return membershipRejected(error, 'membership-type-reorder');
  }
  refreshed(actor.locale);
  return DONE;
}

/** Adds or replaces one locale's words for a type. */
export async function saveLabelAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await authorise(form);
  if ('refused' in actor) return actor.refused;
  try {
    await membershipRuntime().admin.saveLabel(
      { accountId: actor.accountId },
      {
        id: field(form, 'id'),
        expectedVersion: whole(form, 'version'),
        label: label(form, field(form, 'labelLocale')),
      },
    );
  } catch (error) {
    return membershipRejected(error, 'membership-type-label');
  }
  refreshed(actor.locale);
  return DONE;
}

/** Publishes or archives a type. */
export async function transitionTypeAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await authorise(form);
  if ('refused' in actor) return actor.refused;
  try {
    await membershipRuntime().admin.transitionType(
      { accountId: actor.accountId },
      {
        id: field(form, 'id'),
        expectedVersion: whole(form, 'version'),
        to: field(form, 'to'),
      },
    );
  } catch (error) {
    return membershipRejected(error, 'membership-type-transition');
  }
  refreshed(actor.locale);
  return DONE;
}

/* ===========================================================================
 * Applications
 * ========================================================================= */

/** `submitted` → `under_review`, after an explicit confirmation. */
export async function startReviewAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const actor = await authorise(form);
  if ('refused' in actor) return actor.refused;
  try {
    await membershipRuntime().admin.startReview(
      { accountId: actor.accountId },
      { id: field(form, 'id'), expectedVersion: whole(form, 'version') },
    );
  } catch (error) {
    return membershipRejected(error, 'membership-application-review');
  }
  refreshed(actor.locale);
  return DONE;
}

/** Approves or rejects an application under review, after an explicit confirmation. */
export async function decideAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const actor = await authorise(form);
  if ('refused' in actor) return actor.refused;
  try {
    await membershipRuntime().admin.decide(
      { accountId: actor.accountId },
      {
        id: field(form, 'id'),
        expectedVersion: whole(form, 'version'),
        decision: field(form, 'decision'),
      },
    );
  } catch (error) {
    return membershipRejected(error, 'membership-application-decide');
  }
  refreshed(actor.locale);
  return DONE;
}

/* ===========================================================================
 * Memberships
 * ========================================================================= */

/** Ends an active Membership as an operator, after an explicit confirmation. */
export async function closeMembershipAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const actor = await authorise(form);
  if ('refused' in actor) return actor.refused;
  try {
    await membershipRuntime().admin.closeMembership(
      { accountId: actor.accountId },
      { id: field(form, 'id'), expectedVersion: whole(form, 'version') },
    );
  } catch (error) {
    return membershipRejected(error, 'membership-close');
  }
  refreshed(actor.locale);
  return DONE;
}
