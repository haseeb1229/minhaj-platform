import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';

import type { StepUpLabels } from './step-up';

/**
 * Copy every administrative surface needs, resolved once per page.
 *
 * ONE PLACE, because every one of these surfaces renders the same step-up
 * prompt and answers the same set of refusals. Repeating the tables per page
 * would mean a new failure class gets a message on some screens and
 * "unavailable" on others — and the one that gets "unavailable" is always the
 * screen nobody tested.
 */

export interface AdminCopy {
  readonly stepUp: StepUpLabels;
  /**
   * Message per failure key, for `ActionForm`.
   *
   * It covers every `AdminFailure` the actions can return, so a refusal always
   * says something a person can act on: ask for the permission, finish setting
   * up two-step verification, or confirm it is you.
   */
  readonly messages: Readonly<Record<string, string>>;
}

export async function adminCopy(locale: Locale): Promise<AdminCopy> {
  const t = await getTranslations({ locale, namespace: 'admin' });

  return {
    stepUp: {
      title: t('stepUp.title'),
      description: t('stepUp.description'),
      password: t('stepUp.password'),
      code: t('stepUp.code'),
      codeHelp: t('stepUp.codeHelp'),
      submit: t('stepUp.submit'),
      pending: t('stepUp.pending'),
      granted: t('stepUp.granted'),
      invalidCredentials: t('stepUp.invalidCredentials'),
      invalidCode: t('stepUp.invalidCode'),
      rateLimited: t('stepUp.rateLimited'),
      unavailable: t('denied.unavailable'),
      checkFields: t('denied.invalidInput'),
    },
    messages: {
      'no-session': t('denied.noSession'),
      'no-permission': t('denied.noPermission'),
      'second-factor-required': t('denied.secondFactorRequired'),
      'step-up-required': t('denied.stepUpRequired'),
      'account-inactive': t('denied.accountInactive'),
      'self-elevation': t('denied.selfElevation'),
      'final-administrator': t('denied.finalAdministrator'),
      'protected-role': t('denied.protectedRole'),
      'role-deactivated': t('denied.roleDeactivated'),
      'duplicate-key': t('denied.duplicateKey'),
      'unknown-permission': t('denied.unknownPermission'),
      'ineligible-target': t('denied.ineligibleTarget'),
      'not-found': t('denied.notFound'),
      'invalid-input': t('denied.invalidInput'),
      'invalid-transition': t('users.invalidTransition'),
      'not-retryable': t('delivery.notRetryable'),
      unavailable: t('denied.unavailable'),
      unknown: t('denied.unavailable'),
    },
  };
}

/**
 * Reads one bounded page number from the query.
 *
 * Bounded at both ends: a negative offset is nonsense and an unbounded one is
 * an invitation to walk a table a page at a time. The listing itself is capped
 * separately, in the adapter (CLAUDE.md §41).
 */
export function pageOffset(
  query: Record<string, string | string[] | undefined>,
  pageSize: number,
): number {
  const raw = typeof query['page'] === 'string' ? Number.parseInt(query['page'], 10) : 1;
  const page = Number.isInteger(raw) && raw > 0 && raw <= 1_000 ? raw : 1;
  return (page - 1) * pageSize;
}

/** One string value from the query, trimmed and bounded. */
export function queryValue(
  query: Record<string, string | string[] | undefined>,
  key: string,
): string | null {
  const raw = query[key];
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' || trimmed.length > 200 ? null : trimmed;
}

/** How many rows every administrative listing shows at once. */
export const PAGE_SIZE = 25;
