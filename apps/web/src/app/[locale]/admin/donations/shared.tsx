import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { DONATION_PAGE } from '@minhaj/contracts/donations';

import { TextLink } from '@/components/ui';
import { identityRuntime } from '@/composition/identity';
import { appLogger } from '@/composition/logging';
import { adminCopy } from '../shared';
import { StepUpPrompt } from '../step-up';

/**
 * What every Donations administration screen shares (DELIVERY_PLAN.md
 * Phase 27): the copy with a message for every refusal, the pager, the
 * hidden fields that make an act an act on one version of one record, and the
 * step-up prompt for exactly `donation-refund`.
 *
 * `donations.read` OPENS A SCREEN; `donations.administer` and
 * `donations.refund` ARE WHAT THE ACTIONS RE-CHECK, live, and the service
 * checks each again. Every listing, every opened record and every export is
 * an AUDITED access, recorded by the service with identifiers only.
 *
 * A DONOR IS `linked` OR `anonymous` on every listing and in the export. Only
 * the audited single-record page names a LINKED donor, by the display name
 * Identity reports for that one account (`donorName`) — never an address or
 * an account identifier. Giving is personal; nothing needs more.
 */

export type Query = Record<string, string | string[] | undefined>;

/**
 * The display name Identity reports for ONE linked donor, read on the audited
 * record page only. `null` for a closed or unknown account, or when Identity
 * cannot answer — the page then says so rather than guessing.
 */
export async function donorName(accountId: string): Promise<string | null> {
  try {
    const names = await identityRuntime().administration.participantNames([accountId]);
    return names.find((entry) => entry.accountId === accountId)?.name ?? null;
  } catch {
    appLogger().error({ operation: 'donations-donor-name' }, 'Donor name unavailable.');
    return null;
  }
}

/** The copy every Donations screen needs, and a message for every refusal. */
export async function adminDonationsCopy(locale: Locale) {
  const t = await getTranslations({ locale, namespace: 'adminDonations' });
  const d = await getTranslations({ locale, namespace: 'donations' });
  return {
    t,
    d,
    messages: {
      success: t('saved'),
      denied: t('failure.denied'),
      // The gates' refusals.
      'no-session': t('failure.noSession'),
      'no-permission': t('failure.denied'),
      'second-factor-required': t('failure.secondFactorRequired'),
      'step-up-required': t('failure.stepUpRequired'),
      'account-inactive': t('failure.accountInactive'),
      'confirm-required': t('failure.confirmRequired'),
      // The service's refusals.
      'not-found': t('failure.notFound'),
      conflict: t('failure.conflict'),
      invalid: t('failure.invalid'),
      'invalid-state': t('failure.invalidState'),
      incomplete: t('failure.incomplete'),
      limit: t('failure.limit'),
      'rate-limited': t('failure.rateLimited'),
      'over-refund': t('failure.overRefund'),
      'provider-unavailable': t('failure.providerUnavailable'),
      'not-activated': t('failure.providerUnavailable'),
      'operation-conflict': t('failure.operationConflict'),
      // A campaign or donation act cannot meet these; each still has words.
      'campaign-unavailable': t('failure.invalidState'),
      'amount-refused': t('failure.invalid'),
      'account-closed': t('failure.invalidState'),
      'already-submitted': t('failure.invalidState'),
      unavailable: t('unknown'),
      unknown: t('unknown'),
    } as Readonly<Record<string, string>>,
  };
}

export type AdminDonationsCopy = Awaited<ReturnType<typeof adminDonationsCopy>>;

/** The hidden fields that make an act an act on one version of one record. */
export function RecordIdentity({
  locale,
  record,
}: {
  readonly locale: Locale;
  readonly record: { readonly id: string; readonly version: number };
}) {
  return (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={record.id} />
      <input type="hidden" name="version" value={String(record.version)} />
    </>
  );
}

/** Previous and next pages of a bounded listing, with where the reader is. */
export function Pager({
  offset,
  total,
  hrefFor,
  label,
  copy,
}: {
  readonly offset: number;
  readonly total: number;
  readonly hrefFor: (page: number) => string;
  readonly label: string;
  readonly copy: AdminDonationsCopy;
}) {
  const pages = Math.max(1, Math.ceil(total / DONATION_PAGE));
  const current = Math.floor(offset / DONATION_PAGE) + 1;
  if (pages <= 1 && current === 1) return null;
  return (
    <nav className="flex flex-wrap items-center gap-x-6 gap-y-2" aria-label={label}>
      {current > 1 ? (
        <TextLink href={hrefFor(current - 1)}>{copy.t('previous')}</TextLink>
      ) : null}
      <span className="text-sm">
        {copy.t('pageOf', { page: current, pages: Math.max(pages, current) })}
      </span>
      {current < pages ? (
        <TextLink href={hrefFor(current + 1)}>{copy.t('next')}</TextLink>
      ) : null}
    </nav>
  );
}

/**
 * The step-up prompt for exactly `donation-refund`. A grant earned for any
 * other purpose does not count; the action, the service and the database
 * trigger each re-check it.
 */
export async function DonationRefundStepUp({ locale }: { readonly locale: Locale }) {
  const [admin, stepUp] = await Promise.all([
    adminCopy(locale),
    getTranslations({ locale, namespace: 'admin.stepUp' }),
  ]);
  return (
    <StepUpPrompt
      locale={locale}
      purpose="donation-refund"
      labels={{ ...admin.stepUp, description: stepUp('donationRefund') }}
    />
  );
}
