import { notFound } from 'next/navigation';

import { MessagingTime } from '@/components/messaging/parts';
import {
  readChoice,
  readCursor,
  shortId,
  withQuery,
} from '@/components/messaging/presentation';
import { messagingRead } from '@/components/messaging/read';
import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  PageHeading,
  StatusBadge,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { messagingRuntime } from '@/composition/messaging';
import { requireLocale } from '@/config/route-locale';
import {
  QUEUE_FILTERS,
  QueueFilterLinks,
  QueuePager,
  adminMessagingCopy,
  type Query,
} from '../shared';

/**
 * The support queue (ROUTE_MAP.md §7; DELIVERY_PLAN.md Phase 24) — under
 * `messaging.support`, re-checked live by the service.
 *
 * METADATA ONLY. A row says which conversation, its state, when it last moved,
 * whether somebody has claimed it and whether a reply is owed. Nobody's name
 * and no message text appear here; opening a conversation is a separate,
 * AUDITED act on its own page.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function SupportQueuePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const base = `/${locale}/admin/messaging/support`;
  const context = await requireAdminPage(locale, 'messaging.support', base);
  const copy = await adminMessagingCopy(locale);
  const { t } = copy;
  const query = await searchParams;
  const filter = readChoice(query, 'state', QUEUE_FILTERS);
  const cursor = readCursor(query);
  const timeZone = context.session.account.timezone;

  const read = await messagingRead('messaging-support-queue', () =>
    messagingRuntime().service.supportQueue(
      { accountId: context.session.account.id },
      { state: filter === 'open' ? 'open' : 'closed', cursor },
    ),
  );
  if (!read.ok && read.failure === 'denied') notFound();

  return (
    <main className="flex flex-col gap-4">
      <PageHeading>{t('support.title')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('support.description')}
      </p>
      <QueueFilterLinks base={base} current={filter} copy={copy} />

      {!read.ok ? (
        <>
          <Alert tone="error">
            {read.failure === 'invalid' ? t('stale') : t('failure.load')}
          </Alert>
          {read.failure === 'invalid' ? (
            <p>
              <TextLink
                href={withQuery(base, { state: filter === 'open' ? null : filter })}
              >
                {t('first')}
              </TextLink>
            </p>
          ) : null}
        </>
      ) : read.value.items.length === 0 ? (
        <EmptyState>
          {cursor !== null
            ? t('beyond')
            : filter === 'open'
              ? t('support.empty')
              : t('support.emptyResolved')}
        </EmptyState>
      ) : (
        <DataTable
          caption={t(
            filter === 'open' ? 'support.captionOpen' : 'support.captionResolved',
          )}
          columns={[
            t('support.column.conversation'),
            t('support.column.state'),
            t('support.column.lastActivity'),
            t('support.column.claim'),
            t('support.column.reply'),
          ]}
        >
          {read.value.items.map((item) => (
            <DataRow key={item.id}>
              <DataCell>
                <TextLink href={`${base}/${encodeURIComponent(item.id)}`}>
                  <span className="font-mono" dir="ltr">
                    {t('support.open', { id: shortId(item.id) })}
                  </span>
                </TextLink>
              </DataCell>
              <DataCell>
                <StatusBadge tone={item.state === 'open' ? 'positive' : 'neutral'}>
                  {item.state === 'open'
                    ? t('conversationState.open')
                    : item.closedReason === 'resolved'
                      ? t('conversationState.resolved')
                      : t('conversationState.closed')}
                </StatusBadge>
              </DataCell>
              <DataCell wrap>
                <MessagingTime
                  value={item.lastMessageAt ?? item.createdAt}
                  locale={locale}
                  timeZone={timeZone}
                />
              </DataCell>
              <DataCell>
                {item.claimedByMe
                  ? t('support.claimedByMe')
                  : item.claimed
                    ? t('support.claimed')
                    : t('support.unclaimed')}
              </DataCell>
              <DataCell>
                {item.awaitingReply ? (
                  <StatusBadge tone="caution">{t('support.awaiting')}</StatusBadge>
                ) : (
                  t('support.notAwaiting')
                )}
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}

      {read.ok ? (
        <QueuePager
          base={base}
          filter={filter}
          cursor={cursor}
          next={read.value.next}
          copy={copy}
        />
      ) : null}
    </main>
  );
}
