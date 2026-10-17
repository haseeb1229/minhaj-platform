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
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { messagingRuntime } from '@/composition/messaging';
import { requireLocale } from '@/config/route-locale';
import {
  QUEUE_FILTERS,
  QueueFilterLinks,
  QueuePager,
  ReportStateBadge,
  adminMessagingCopy,
  reportTarget,
  type Query,
} from '../shared';

/**
 * Every report, open or decided (ROUTE_MAP.md §7; DELIVERY_PLAN.md Phase 24)
 * — under `messaging.moderate`, re-checked live by the service.
 *
 * IDENTIFIERS, REASONS, STATES AND TIMES — NEVER CONTENT. The reported text,
 * its neighbours and its attachments are a report's bounded EVIDENCE, read on
 * the report's own page as an audited act. The moderation queue shows the open
 * reports oldest first; this is the full record, including decided ones.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function ReportsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const base = `/${locale}/admin/messaging/reports`;
  const context = await requireAdminPage(locale, 'messaging.moderate', base);
  const copy = await adminMessagingCopy(locale);
  const { t } = copy;
  const query = await searchParams;
  const filter = readChoice(query, 'state', QUEUE_FILTERS);
  const cursor = readCursor(query);

  const read = await messagingRead('messaging-reports', () =>
    messagingRuntime().service.reports(
      { accountId: context.session.account.id },
      { state: filter, cursor },
    ),
  );
  if (!read.ok && read.failure === 'denied') notFound();

  return (
    <main className="flex flex-col gap-4">
      <PageHeading>{t('reports.title')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('reports.description')}
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
      ) : read.value.reports.length === 0 ? (
        <EmptyState>
          {cursor !== null
            ? t('beyond')
            : filter === 'open'
              ? t('reports.empty')
              : t('reports.emptyResolved')}
        </EmptyState>
      ) : (
        <DataTable
          caption={t(
            filter === 'open' ? 'reports.captionOpen' : 'reports.captionResolved',
          )}
          columns={[
            t('reports.column.report'),
            t('reports.column.reason'),
            t('reports.column.target'),
            t('reports.column.kind'),
            t('reports.column.state'),
            t('reports.column.filed'),
          ]}
        >
          {read.value.reports.map((report) => (
            <DataRow key={report.id}>
              <DataCell>
                <TextLink
                  href={`/${locale}/admin/messaging/reports/${encodeURIComponent(report.id)}`}
                >
                  <span className="font-mono" dir="ltr">
                    {t('reports.open', { id: shortId(report.id) })}
                  </span>
                </TextLink>
              </DataCell>
              <DataCell>{t(`reason.${report.reason}`)}</DataCell>
              <DataCell>{reportTarget(report, copy)}</DataCell>
              <DataCell>{t(`kind.${report.conversationKind}`)}</DataCell>
              <DataCell>
                <ReportStateBadge state={report.state} copy={copy} />
              </DataCell>
              <DataCell wrap>
                <MessagingTime
                  value={report.createdAt}
                  locale={locale}
                  timeZone={context.session.account.timezone}
                />
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
