import { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type { PermissionKey } from '@minhaj/contracts/identity';
import type { ReportSummary } from '@minhaj/contracts/messaging';

import { withQuery } from '@/components/messaging/presentation';
import { FilterLink, StatusBadge, TextLink } from '@/components/ui';

/**
 * What every Messaging administration screen shares (Phase 24): which key
 * opens which surface, the copy with a message for every refusal, the
 * open/resolved filter and the continuation pager.
 *
 * IDENTIFIERS, STATES AND TIMES. Nothing here renders a message body, a file
 * name or a person's name — the queues are metadata, and content is a
 * separate audited read on its own page.
 */

export type Query = Record<string, string | string[] | undefined>;

export const MESSAGING_KEYS: readonly PermissionKey[] = [
  'messaging.support',
  'messaging.moderate',
];

/** Each screen, in the order the area root prefers, and the key that opens it. */
export const MESSAGING_SURFACES: readonly {
  readonly key: 'support' | 'moderation' | 'reports';
  readonly permission: PermissionKey;
}[] = [
  { key: 'support', permission: 'messaging.support' },
  { key: 'moderation', permission: 'messaging.moderate' },
  { key: 'reports', permission: 'messaging.moderate' },
];

/** The filter the queues offer. `resolved` is a closed support conversation, or a decided report. */
export const QUEUE_FILTERS = ['open', 'resolved'] as const;
export type QueueFilter = (typeof QUEUE_FILTERS)[number];

/** The copy every Messaging administration screen needs, and a message for every refusal. */
export async function adminMessagingCopy(locale: Locale) {
  const t = await getTranslations({ locale, namespace: 'adminMessaging' });
  return {
    t,
    messages: {
      denied: t('failure.denied'),
      invalid: t('failure.invalid'),
      'not-found': t('failure.notFound'),
      conflict: t('failure.conflict'),
      closed: t('failure.closed'),
      'rate-limited': t('failure.rateLimited'),
      'confirm-required': t('failure.confirmRequired'),
      'no-session': t('failure.denied'),
      unavailable: t('unknown'),
      unknown: t('unknown'),
    } as Readonly<Record<string, string>>,
  };
}

export type AdminMessagingCopy = Awaited<ReturnType<typeof adminMessagingCopy>>;

/** Open or resolved, as two current-marked links. */
export function QueueFilterLinks({
  base,
  current,
  copy,
}: {
  readonly base: string;
  readonly current: QueueFilter;
  readonly copy: AdminMessagingCopy;
}) {
  return (
    <nav aria-label={copy.t('filter.label')} className="flex flex-wrap gap-2">
      {QUEUE_FILTERS.map((filter) => (
        <FilterLink
          key={filter}
          href={filter === 'open' ? base : withQuery(base, { state: filter })}
          current={filter === current}
        >
          {copy.t(`filter.${filter}`)}
        </FilterLink>
      ))}
    </nav>
  );
}

/** The first page and the next one — a keyset continuation only goes forward. */
export function QueuePager({
  base,
  filter,
  cursor,
  next,
  copy,
}: {
  readonly base: string;
  readonly filter: QueueFilter;
  readonly cursor: string | null;
  readonly next: string | null;
  readonly copy: AdminMessagingCopy;
}) {
  if (cursor === null && next === null) return null;
  const state = filter === 'open' ? null : filter;
  return (
    <nav aria-label={copy.t('pages')} className="flex flex-wrap gap-x-6 gap-y-2">
      {cursor === null ? null : (
        <TextLink href={withQuery(base, { state })}>{copy.t('first')}</TextLink>
      )}
      {next === null ? null : (
        <TextLink href={withQuery(base, { state, cursor: next })}>
          {copy.t('next')}
        </TextLink>
      )}
    </nav>
  );
}

/** A report's state, in words. */
export function ReportStateBadge({
  state,
  copy,
}: {
  readonly state: ReportSummary['state'];
  readonly copy: AdminMessagingCopy;
}) {
  return (
    <StatusBadge tone={state === 'open' ? 'caution' : 'neutral'}>
      {copy.t(`reportState.${state}`)}
    </StatusBadge>
  );
}

/** What a report is about: one message, or the conversation itself. */
export function reportTarget(report: ReportSummary, copy: AdminMessagingCopy): string {
  return report.messageId === null
    ? copy.t('target.conversation')
    : copy.t('target.message');
}
