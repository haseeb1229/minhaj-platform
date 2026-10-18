'use server';

import { redirect } from 'next/navigation';

import { field, membershipRejected } from '@/components/membership/action-support';
import type { DoneNotice } from '@/components/membership/presentation';
import {
  UNCONFIRMED,
  personalGate,
  refreshMy,
  whole,
} from '@/components/personal/action-support';
import { membershipRuntime } from '@/composition/membership';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * A person's own Membership acts from `/my/membership` (DELIVERY_PLAN.md
 * Phase 26): apply for a published type, withdraw an application still in
 * progress, end a Membership they hold.
 *
 * CLASS-A BROWSER MUTATIONS (SECURITY_BASELINE.md §7.1) — Server Actions under
 * the framework's Origin checks, unreachable by GET. Each resolves the session
 * itself through `personalGate` and acts as that account only: an identifier a
 * form supplies reaches only the caller's own rows, because the adapter puts
 * the account in every predicate, so somebody else's application is exactly
 * as absent as one that does not exist. No field names an account.
 *
 * PARSED BY THE SERVICE, UNDER THE VERSION SHOWN. The fields travel as typed;
 * Membership's strict schemas decide what they mean, and a withdrawal or a
 * closure carries the version the person was looking at, so a stale page is a
 * visible conflict rather than a silent act. Ending something needs an
 * explicit confirmation first.
 *
 * SUCCESS NAVIGATES. Each act changes which form the page shows, so the
 * result is a fixed notice key on the page's own address — `redirect` sits
 * outside the `try`, because it signals by throwing and that is not a
 * failure. A refusal stays on the form, in words.
 */

function done(locale: string, notice: DoneNotice): never {
  redirect(`/${locale}/my/membership?done=${notice}`);
}

/** Applies for one published type. An application already in progress is answered, not duplicated. */
export async function applyAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  let created: boolean;
  try {
    ({ created } = await membershipRuntime().applicant.submit(gate.actor, {
      membershipTypeId: field(form, 'membershipTypeId'),
    }));
  } catch (error) {
    return membershipRejected(error, 'membership-apply');
  }
  refreshMy(gate.locale);
  done(gate.locale, created ? 'submitted' : 'existing');
}

/** Withdraws the person's own application while it is still in progress. */
export async function withdrawAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await membershipRuntime().applicant.withdraw(gate.actor, {
      id: field(form, 'id'),
      expectedVersion: whole(form, 'version'),
    });
  } catch (error) {
    return membershipRejected(error, 'membership-withdraw');
  }
  refreshMy(gate.locale);
  done(gate.locale, 'withdrawn');
}

/** Ends a Membership the person holds. It is not reopened; they may apply again. */
export async function closeOwnAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const gate = await personalGate(form);
  if ('refused' in gate) return gate.refused;
  try {
    await membershipRuntime().applicant.closeOwn(gate.actor, {
      id: field(form, 'id'),
      expectedVersion: whole(form, 'version'),
    });
  } catch (error) {
    return membershipRejected(error, 'membership-close-own');
  }
  refreshMy(gate.locale);
  done(gate.locale, 'closed');
}
