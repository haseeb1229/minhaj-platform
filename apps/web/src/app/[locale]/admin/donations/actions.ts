'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { localeSchema, type Locale } from '@minhaj/contracts';

import { donationsRejected, field } from '@/components/donations/action-support';
import { asciiAmount } from '@/components/donations/presentation';
import { textarea, whole } from '@/components/personal/action-support';
import {
  requirePermittedAction,
  requirePrivilegedActor,
} from '@/composition/authorization';
import { donationsRuntime } from '@/composition/donations';
import type { FormActionState } from '../../(identity)/form-state';

/**
 * The Donations administrative mutations (DELIVERY_PLAN.md Phase 27): the
 * campaigns — create, reorder, each locale's words, each currency's policy,
 * publish and archive — operator reconciliation of one donation, and a
 * refund.
 *
 * TWO GATES, CHOSEN BY CONSEQUENCE. A campaign change or a reconciliation
 * moves no money and changes no account, so it re-checks
 * `donations.administer` through `requirePermittedAction`. A refund MOVES
 * MONEY, so it goes through `requirePrivilegedActor` with
 * `donations.refund` — externally gated, bundled into no role — a complete
 * second-factor posture and a live step-up for exactly `donation-refund`. The
 * page that rendered a form decided only whether to show it
 * (SECURITY_BASELINE.md §3.4 rule 2); the service re-checks each key live, and
 * the database's trigger refuses a refund without the key and a live grant.
 *
 * UNDER AN EXPECTED VERSION. Every act on an existing record carries the
 * version the operator was shown, so two operators acting on one stale page
 * meet a visible conflict, never a silent double act. A refund and a removal
 * need an explicit confirmation; a refund carries a per-render operation id,
 * so a double submit reserves one refund, never two.
 *
 * NO MASS ASSIGNMENT. Each action reads the fields its form names, by name,
 * and hands them to the service, whose strict schemas decide what they mean;
 * amounts travel as the decimal TEXT typed and are parsed exactly by the
 * service. Nothing typed is echoed or logged; an outage is logged as
 * `{ operation }` alone.
 */

const UNCONFIRMED: FormActionState = { status: 'error', failure: 'confirm-required' };
const DONE: FormActionState = { status: 'success' };

/** The locale from the form; an unknown one is English, never an error. */
function localeOf(form: FormData): Locale {
  const parsed = localeSchema.safeParse(form.get('locale'));
  return parsed.success ? parsed.data : 'en';
}

/** The locale, then the live permission: who acts, or the refusal to return. */
async function administer(
  form: FormData,
): Promise<
  | { readonly locale: Locale; readonly accountId: string }
  | { readonly refused: FormActionState }
> {
  const locale = localeOf(form);
  const permitted = await requirePermittedAction(locale, 'donations.administer');
  if (permitted.state === 'denied')
    return { refused: { status: 'error', failure: permitted.reason } };
  return { locale, accountId: permitted.session.account.id };
}

function refreshed(locale: Locale): void {
  revalidatePath(`/${locale}/admin/donations`, 'layout');
}

/** The version-checked identity every act on an existing campaign carries. */
function versioned(form: FormData) {
  return { id: field(form, 'id'), expectedVersion: whole(form, 'version') };
}

/* ===========================================================================
 * Campaigns — `donations.administer`
 * ========================================================================= */

/** A new draft campaign; its editor opens on it. */
export async function createCampaignAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  let id: string;
  try {
    ({ id } = await donationsRuntime().admin.createCampaign(
      { accountId: actor.accountId },
      {
        primaryLocale: field(form, 'primaryLocale'),
        displayOrder: whole(form, 'displayOrder'),
      },
    ));
  } catch (error) {
    return donationsRejected(error, 'donations-campaign-create');
  }
  refreshed(actor.locale);
  // Outside the try: `redirect` signals by throwing, and that is not a failure.
  redirect(`/${actor.locale}/admin/donations/campaigns/${encodeURIComponent(id)}`);
}

/** Moves a campaign in display order. */
export async function reorderCampaignAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  try {
    await donationsRuntime().admin.reorderCampaign(
      { accountId: actor.accountId },
      { ...versioned(form), displayOrder: whole(form, 'displayOrder') },
    );
  } catch (error) {
    return donationsRejected(error, 'donations-campaign-reorder');
  }
  refreshed(actor.locale);
  return DONE;
}

/** Adds or replaces one locale's words for a campaign. */
export async function saveTranslationAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  try {
    await donationsRuntime().admin.saveTranslation(
      { accountId: actor.accountId },
      {
        ...versioned(form),
        translation: {
          locale: field(form, 'translationLocale'),
          title: field(form, 'title'),
          summary: textarea(form, 'summary') ?? '',
          description: textarea(form, 'description') ?? '',
        },
      },
    );
  } catch (error) {
    return donationsRejected(error, 'donations-campaign-translation');
  }
  refreshed(actor.locale);
  return DONE;
}

/** Adds or replaces one currency's policy, from the exact decimal text typed. */
export async function saveCurrencyPolicyAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  try {
    await donationsRuntime().admin.saveCurrencyPolicy(
      { accountId: actor.accountId },
      {
        ...versioned(form),
        currency: field(form, 'currency'),
        minimum: asciiAmount(field(form, 'minimum')),
        maximum: asciiAmount(field(form, 'maximum')),
        suggested: ['suggested1', 'suggested2', 'suggested3'].map((name) =>
          asciiAmount(field(form, name)),
        ),
      },
    );
  } catch (error) {
    return donationsRejected(error, 'donations-campaign-currency');
  }
  refreshed(actor.locale);
  return DONE;
}

/** Removes one currency from a campaign, after an explicit confirmation. */
export async function removeCurrencyPolicyAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  try {
    await donationsRuntime().admin.removeCurrencyPolicy(
      { accountId: actor.accountId },
      { ...versioned(form), currency: field(form, 'currency') },
    );
  } catch (error) {
    return donationsRejected(error, 'donations-campaign-currency-remove');
  }
  refreshed(actor.locale);
  return DONE;
}

/** Publishes or archives a campaign. */
export async function transitionCampaignAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  try {
    await donationsRuntime().admin.transitionCampaign(
      { accountId: actor.accountId },
      { ...versioned(form), to: field(form, 'to') },
    );
  } catch (error) {
    return donationsRejected(error, 'donations-campaign-transition');
  }
  refreshed(actor.locale);
  return DONE;
}

/* ===========================================================================
 * Donations
 * ========================================================================= */

/** Makes one donation due and reads the provider's truth for it now. */
export async function reconcileDonationAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  const actor = await administer(form);
  if ('refused' in actor) return actor.refused;
  try {
    await donationsRuntime().admin.reconcile(
      { accountId: actor.accountId },
      versioned(form),
    );
  } catch (error) {
    return donationsRejected(error, 'donations-reconcile');
  }
  refreshed(actor.locale);
  return DONE;
}

/**
 * A full or partial refund, in the donation's own currency, after an explicit
 * confirmation — `donations.refund` with a live `donation-refund` step-up.
 */
export async function refundDonationAction(
  _state: FormActionState,
  form: FormData,
): Promise<FormActionState> {
  if (form.get('confirm') !== 'on') return UNCONFIRMED;
  const locale = localeOf(form);
  const gate = await requirePrivilegedActor(
    locale,
    'donations.refund',
    'donation-refund',
  );
  if (gate.state === 'denied') return { status: 'error', failure: gate.reason };
  let submission: string;
  try {
    ({ submission } = await donationsRuntime().admin.refund(gate.actor, {
      operationId: field(form, 'operationId'),
      donationId: field(form, 'id'),
      expectedVersion: whole(form, 'version'),
      amount: asciiAmount(field(form, 'amount')),
    }));
  } catch (error) {
    return donationsRejected(error, 'donations-refund');
  }
  refreshed(locale);
  // The provider's answer, in words: accepted, refused, or not yet known —
  // never a refund reported done that the provider has not confirmed.
  return submission === 'rejected'
    ? { status: 'error', failure: 'refund-rejected' }
    : submission === 'unknown'
      ? { status: 'error', failure: 'refund-unknown' }
      : DONE;
}
