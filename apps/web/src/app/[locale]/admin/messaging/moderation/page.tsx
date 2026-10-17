import { notFound } from 'next/navigation';

import { MessagingTime } from '@/components/messaging/parts';
import { readCursor, shortId } from '@/components/messaging/presentation';
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
import { QueuePager, adminMessagingCopy, reportTarget, type Query } from '../shared';

/**
 * The moderation queue (ROUTE_MAP.md §7; DELIVERY_PLAN.md Phase 24): the
 * OPEN reports, each leading to its bounded evidence and the decision form —
 * under `messaging.moderate`, re-checked live by the service.
 *
 * WAITING LONGEST FIRST. Within each page the oldest report leads, so the
 * report that has waited longest is the first one a moderator meets. No
 * content is listed; the evidence is read, audited, on the report's page.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function ModerationQueuePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const base = `/${locale}/admin/messaging/moderation`;
  const context = await requireAdminPage(locale, 'messaging.moderate', base);
  const copy = await adminMessagingCopy(locale);
  const { t } = copy;
  const cursor = readCursor(await searchParams);

  const read = await messagingRead('messaging-moderation-queue', () =>
    messagingRuntime().service.reports(
      { accountId: context.session.account.id },
      { state: 'open', cursor },
    ),
  );
  if (!read.ok && read.failure === 'denied') notFound();

  const reports = read.ok
    ? [...read.value.reports].sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
      )
    : [];

  return (
    <main className="flex flex-col gap-4">
      <PageHeading>{t('moderation.title')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('moderation.description')}
      </p>

      {!read.ok ? (
        <>
          <Alert tone="error">
            {read.failure === 'invalid' ? t('stale') : t('failure.load')}
          </Alert>
          {read.failure === 'invalid' ? (
            <p>
              <TextLink href={base}>{t('first')}</TextLink>
            </p>
          ) : null}
        </>
      ) : reports.length === 0 ? (
        <EmptyState>{cursor === null ? t('moderation.empty') : t('beyond')}</EmptyState>
      ) : (
        <DataTable
          caption={t('moderation.caption')}
          columns={[
            t('reports.column.filed'),
            t('reports.column.reason'),
            t('reports.column.target'),
            t('reports.column.kind'),
            t('moderation.column.review'),
          ]}
        >
          {reports.map((report) => (
            <DataRow key={report.id}>
              <DataCell wrap>
                <MessagingTime
                  value={report.createdAt}
                  locale={locale}
                  timeZone={context.session.account.timezone}
                />
              </DataCell>
              <DataCell>{t(`reason.${report.reason}`)}</DataCell>
              <DataCell>{reportTarget(report, copy)}</DataCell>
              <DataCell>{t(`kind.${report.conversationKind}`)}</DataCell>
              <DataCell>
                <TextLink
                  href={`/${locale}/admin/messaging/reports/${encodeURIComponent(report.id)}`}
                >
                  <span dir="auto">
                    {t('moderation.review', { id: shortId(report.id) })}
                  </span>
                </TextLink>
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}

      {read.ok ? (
        <QueuePager
          base={base}
          filter="open"
          cursor={cursor}
          next={read.value.next}
          copy={copy}
        />
      ) : null}
    </main>
  );
}
