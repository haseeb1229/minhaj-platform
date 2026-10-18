import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import { MEMBERSHIP_PAGE } from '@minhaj/contracts/membership';

import { TextLink } from '@/components/ui';
import { identityRuntime } from '@/composition/identity';
import { appLogger } from '@/composition/logging';

/**
 * What every Membership administration screen shares (DELIVERY_PLAN.md
 * Phase 26): the copy with a message for every refusal, the applicants' and
 * members' names, the pager and the hidden fields that make an act an act on
 * one version of one record.
 *
 * `membership.read` OPENS A SCREEN, `membership.administer` IS WHAT EVERY
 * ACTION RE-CHECKS, live, and the service checks both again. Every listing
 * and every opened application is an AUDITED access, recorded by the service
 * with identifiers only.
 *
 * A PERSON IS A NAME, NEVER AN ADDRESS. Applicants and members are shown by
 * the display name Identity returns for the account, in one bounded call per
 * page, and by honest words when it returns none — never an email, a postal
 * address or an identifier as the primary text.
 */

export type Query = Record<string, string | string[] | undefined>;

/** The copy every Membership screen needs, and a message for every refusal. */
export async function adminMembershipCopy(locale: Locale) {
  const t = await getTranslations({ locale, namespace: 'adminMembership' });
  const s = await getTranslations({ locale, namespace: 'membership' });
  return {
    t,
    s,
    messages: {
      success: t('saved'),
      denied: t('failure.denied'),
      // The gates' refusals.
      'no-session': t('failure.noSession'),
      'no-permission': t('failure.denied'),
      'second-factor-required': t('failure.secondFactorRequired'),
      'account-inactive': t('failure.accountInactive'),
      'not-found': t('failure.notFound'),
      conflict: t('failure.conflict'),
      invalid: t('failure.invalid'),
      'invalid-state': t('failure.invalidState'),
      'type-unavailable': t('failure.typeUnavailable'),
      'already-member': t('failure.alreadyMember'),
      'applicant-closed': t('failure.applicantClosed'),
      incomplete: t('failure.incomplete'),
      limit: t('failure.limit'),
      'rate-limited': t('failure.rateLimited'),
      'confirm-required': t('failure.confirmRequired'),
      unavailable: t('unknown'),
      unknown: t('unknown'),
    } as Readonly<Record<string, string>>,
  };
}

export type AdminMembershipCopy = Awaited<ReturnType<typeof adminMembershipCopy>>;

/**
 * The display name of each account, from Identity — identifiers cross, a
 * name comes back. Names are decoration: when Identity cannot answer just
 * now the rows still render, with the fallback words.
 */
export async function personNames(
  accountIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const unique = [...new Set(accountIds)];
  if (unique.length === 0) return new Map();
  try {
    const names = await identityRuntime().administration.participantNames(unique);
    return new Map(names.map((entry) => [entry.accountId, entry.name]));
  } catch {
    appLogger().error({ operation: 'membership-names' }, 'Membership names unavailable.');
    return new Map();
  }
}

/** A person's name as Identity reports it, or the honest words for an unnamed one. */
export function PersonName({
  accountId,
  names,
  copy,
}: {
  readonly accountId: string;
  readonly names: ReadonlyMap<string, string>;
  readonly copy: AdminMembershipCopy;
}) {
  const name = names.get(accountId);
  return name === undefined ? (
    <span className="text-[color:var(--color-foreground-muted)]">
      {copy.t('person.fallback')}
    </span>
  ) : (
    <span dir="auto" className="wrap-anywhere">
      {name}
    </span>
  );
}

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
  readonly copy: AdminMembershipCopy;
}) {
  const pages = Math.max(1, Math.ceil(total / MEMBERSHIP_PAGE));
  const current = Math.floor(offset / MEMBERSHIP_PAGE) + 1;
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
