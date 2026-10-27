import type { ReactNode } from 'react';

import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import {
  MIGRATION_LIMITS,
  migrationIdSchema,
  type MigrationActor,
} from '@minhaj/contracts/migration';

import { displayTimeZone } from '@/components/personal/presentation';
import { StatusBadge, TextLink } from '@/components/ui';
import { appLogger } from '@/composition/logging';
import {
  migrationFailure,
  type MigrationRefusalReason,
} from '@/contexts/migration-provenance';
import { adminCopy } from '../shared';
import { StepUpPrompt } from '../step-up';

/**
 * What every Migration administration screen shares (DELIVERY_PLAN.md
 * Phases 29–30): the copy with a message for every refusal the context can give,
 * the bounded query readers, the pager, the hidden fields that make an act an
 * act on one version of one row, and the step-up prompt for exactly
 * `migration-publication`.
 *
 * `migration.read` OPENS A SCREEN; `migration.administer` and
 * `migration.publish` ARE WHAT THE ACTIONS RE-CHECK, live, and the service
 * checks each again. Nothing here renders a raw body or a staged payload as
 * markup: every legacy word reaches the page as React-escaped text.
 */

export type Query = Record<string, string | string[] | undefined>;

/** One page of every Migration list — the context's own bound. */
export const MIGRATION_PAGE = MIGRATION_LIMITS.page;

export function migrationPath(locale: Locale, rest = ''): string {
  return `/${locale}/admin/migration${rest}`;
}

/** The operator a service call acts as: identified by account only. */
export function actorOf(context: {
  readonly session: { readonly account: { readonly id: string } };
}): MigrationActor {
  return { accountId: context.session.account.id };
}

/**
 * One bounded page offset from `key` (default `page`). A malformed or
 * out-of-range page is `null` — the caller answers 404 rather than quietly
 * showing the first page under an address that names another.
 */
export function offsetOf(query: Query, key = 'page'): number | null {
  const raw = query[key];
  if (raw === undefined) return 0;
  if (typeof raw !== 'string' || !/^[1-9][0-9]{0,5}$/.test(raw)) return null;
  const offset = (Number(raw) - 1) * MIGRATION_PAGE;
  return offset <= MIGRATION_LIMITS.maxOffset ? offset : null;
}

/**
 * One vocabulary filter: `null` when absent or empty, the value when it is in
 * the vocabulary, and `undefined` when the address names something else —
 * which the page answers with 404, never a quietly broadened list.
 */
export function vocabularyOf<T extends string>(
  query: Query,
  key: string,
  vocabulary: readonly T[],
): T | null | undefined {
  const raw = query[key];
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  return (vocabulary as readonly string[]).includes(raw) ? (raw as T) : undefined;
}

/** One identifier filter, with the same three answers as `vocabularyOf`. */
export function idOf(query: Query, key: string): string | null | undefined {
  const raw = query[key];
  if (raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') return undefined;
  return migrationIdSchema.safeParse(raw).success ? raw : undefined;
}

/** An address with the non-empty parameters appended, in a stable order. */
export function withQuery(
  base: string,
  params: Readonly<Record<string, string | null | undefined>>,
): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params))
    if (value !== null && value !== undefined && value !== '') search.set(name, value);
  const text = search.toString();
  return text === '' ? base : `${base}?${text}`;
}

/* ===========================================================================
 * Reads — a refusal is an answer, an outage is logged by name
 * ========================================================================= */

export type MigrationRead<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: MigrationRefusalReason };

/**
 * One service read with its failure kept visible rather than thrown. Only an
 * outage is logged, and only by operation name — never an identifier, a URL,
 * a title or a payload (SECURITY_BASELINE.md §19.2).
 */
export async function migrationRead<T>(
  operation: string,
  work: () => Promise<T>,
): Promise<MigrationRead<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    const failure = migrationFailure(error);
    if (failure === 'unavailable')
      appLogger().error({ operation }, 'Migration read failed.');
    return { ok: false, failure };
  }
}

/* ===========================================================================
 * Copy
 * ========================================================================= */

/** The copy every Migration screen needs, and a message for every refusal. */
export async function adminMigrationCopy(locale: Locale) {
  const t = await getTranslations({ locale, namespace: 'adminMigration' });
  // Every reason the context can give has its own words — a new reason
  // without one is a type error here, never a generic "unavailable".
  const refusals: Readonly<Record<MigrationRefusalReason, string>> = {
    denied: t('failure.denied'),
    invalid: t('failure.invalid'),
    'not-found': t('failure.notFound'),
    conflict: t('failure.conflict'),
    'invalid-state': t('failure.invalidState'),
    'real-source-not-authorised': t('failure.realSourceNotAuthorised'),
    'source-inactive': t('failure.sourceInactive'),
    'adapter-mismatch': t('failure.adapterMismatch'),
    'run-busy': t('failure.runBusy'),
    'run-unreconciled': t('failure.runUnreconciled'),
    'not-publishable': t('failure.notPublishable'),
    'approval-withdrawn': t('failure.approvalWithdrawn'),
    'target-unavailable': t('failure.targetUnavailable'),
    'cross-language': t('failure.crossLanguage'),
    'unsafe-scope': t('failure.unsafeScope'),
    'topic-unknown': t('failure.topicUnknown'),
    'not-retryable': t('failure.notRetryable'),
    duplicate: t('failure.duplicate'),
    'lease-lost': t('failure.leaseLost'),
    'host-refused': t('failure.hostRefused'),
    'review-only-kind': t('failure.reviewOnlyKind'),
    unavailable: t('failure.unavailable'),
  };
  return {
    t,
    refusals,
    messages: {
      success: t('saved'),
      ...refusals,
      // The gates' refusals.
      'no-session': t('failure.noSession'),
      'no-permission': t('failure.denied'),
      'second-factor-required': t('failure.secondFactorRequired'),
      'step-up-required': t('failure.stepUpRequired'),
      'account-inactive': t('failure.accountInactive'),
      'confirm-required': t('failure.confirmRequired'),
      unknown: t('failure.unavailable'),
    } as Readonly<Record<string, string>>,
  };
}

export type AdminMigrationCopy = Awaited<ReturnType<typeof adminMigrationCopy>>;

/* ===========================================================================
 * Presentation
 * ========================================================================= */

/** The hidden fields that make an act an act on one version of one row. */
export function RowIdentity({
  locale,
  row,
}: {
  readonly locale: Locale;
  readonly row: { readonly id: string; readonly version: number };
}) {
  return (
    <>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="id" value={row.id} />
      <input type="hidden" name="version" value={String(row.version)} />
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
  readonly copy: AdminMigrationCopy;
}) {
  const pages = Math.max(1, Math.ceil(total / MIGRATION_PAGE));
  const current = Math.floor(offset / MIGRATION_PAGE) + 1;
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

/** A moment, in the operator's own time zone. */
export function MigrationTime({
  value,
  locale,
  timeZone,
}: {
  readonly value: Date;
  readonly locale: Locale;
  readonly timeZone: string | null;
}) {
  return (
    <time dateTime={value.toISOString()}>
      {new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: displayTimeZone(timeZone),
        timeZoneName: 'short',
      }).format(value)}
    </time>
  );
}

/**
 * A technical value — a key, an address, a checksum, an identifier — shown
 * left to right in every locale and allowed to wrap anywhere, so a long one
 * never widens the page. Always text: React escapes it.
 */
export function Code({ children }: { readonly children: ReactNode }) {
  return (
    <code dir="ltr" className="wrap-anywhere">
      {children}
    </code>
  );
}

/** A state word, in text — never a colour alone. */
export function StateBadge({
  tone,
  children,
}: {
  readonly tone: 'neutral' | 'positive' | 'caution';
  readonly children: ReactNode;
}) {
  return <StatusBadge tone={tone}>{children}</StatusBadge>;
}

/**
 * The step-up prompt for exactly `migration-publication`. A grant earned for
 * any other purpose does not count; the action, the service and the database
 * trigger each re-check it.
 */
export async function MigrationPublicationStepUp({
  locale,
}: {
  readonly locale: Locale;
}) {
  const [admin, stepUp] = await Promise.all([
    adminCopy(locale),
    getTranslations({ locale, namespace: 'admin.stepUp' }),
  ]);
  return (
    <StepUpPrompt
      locale={locale}
      purpose="migration-publication"
      labels={{ ...admin.stepUp, description: stepUp('migrationPublication') }}
    />
  );
}
