import { getFormatter, getTranslations } from 'next-intl/server';

import type { DeliveryStatus } from '@minhaj/contracts/platform';

import { requireAdminPage } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import {
  Alert,
  Button,
  DataCell,
  DataRow,
  DataTable,
  DetailRow,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  StatusBadge,
} from '@/components/ui';
import { ActionForm } from '../../../(identity)/form-state';
import { retryDeliveryAction } from '../../actions';
import { PAGE_SIZE, adminCopy, pageOffset, queryValue } from '../../shared';

/**
 * Outbound mail operation — pending, failed and suppressed.
 *
 * NOTE WHAT IS NOT ON THIS PAGE: no recipient, no subject, no body, no token.
 * Layer 0 never learns any of them — a delivery row holds a keyed digest of the
 * recipient and an opaque handle back to the owner's state — so an operator
 * screen built on it CANNOT disclose who a stuck message was for
 * (ARCHITECTURE.md §4.6.1, SECURITY_BASELINE.md §19.2).
 *
 * THE FAILURE IS A CODE, not a provider message. Provider prose regularly
 * contains the recipient address and occasionally the content that was
 * rejected, which is why only a normalised class and code are stored.
 *
 * ONE ACTION, and it is narrow: put a failed delivery back on the schedule. It
 * cannot resurrect a SENT message and cannot overrule a SUPPRESSION — that is
 * the provider telling this platform not to write to an address again, and an
 * operator does not overrule it from a screen.
 *
 * SUPPRESSIONS ARE COUNTED, NOT LISTED. An operator needs to know that
 * complaints are rising and whether transactional mail is involved; a list of
 * the people who bounced or complained is personal data nobody asked this
 * surface to display.
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

const STATUSES: readonly DeliveryStatus[] = [
  'pending',
  'sending',
  'sent',
  'failed',
  'suppressed',
];

export default async function DeliveryPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const query = await searchParams;
  const t = await getTranslations({ locale, namespace: 'admin' });
  const format = await getFormatter({ locale });

  const page = await requireAdminPage(
    locale,
    'delivery.read',
    `/${locale}/admin/communications/delivery`,
  );
  const copy = await adminCopy(locale);

  const requested = queryValue(query, 'status');
  const status = STATUSES.find((entry) => entry === requested) ?? null;

  const { deliveries, suppression } = identityRuntime();
  const [summary, listed, suppressions] = await Promise.all([
    deliveries.summarise(),
    deliveries.listForOperator({
      status,
      limit: PAGE_SIZE,
      offset: pageOffset(query, PAGE_SIZE),
    }),
    suppression.summarise(),
  ]);

  const mayOperate = page.authorization.can('delivery.operate');

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('delivery.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('delivery.description')}
        </p>
      </header>

      <Panel>
        <dl className="flex flex-wrap gap-x-8">
          <DetailRow term={t('delivery.pending')}>{summary.pending}</DetailRow>
          <DetailRow term={t('delivery.failed')}>{summary.failed}</DetailRow>
          <DetailRow term={t('delivery.suppressed')}>{summary.suppressed}</DetailRow>
        </dl>
      </Panel>

      <Panel>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-40">
            <Field id="status" label={t('delivery.filterStatus')}>
              {(props) => (
                <Select {...props} name="status" defaultValue={status ?? ''}>
                  <option value="">{t('delivery.all')}</option>
                  {STATUSES.map((entry) => (
                    <option key={entry} value={entry}>
                      {entry}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>

          <Button tone="secondary">{t('common.apply')}</Button>
        </form>
      </Panel>

      {listed.items.length === 0 ? (
        <EmptyState>{t('common.none')}</EmptyState>
      ) : (
        <Panel>
          <DataTable
            caption={t('delivery.title')}
            columns={[
              t('delivery.purpose'),
              t('delivery.status'),
              t('delivery.attempts'),
              t('delivery.failure'),
              t('delivery.created'),
              ...(mayOperate ? [t('delivery.retrySubmit')] : []),
            ]}
          >
            {listed.items.map((delivery) => (
              <DataRow key={delivery.id}>
                <DataCell wrap>
                  <code className="text-xs">{delivery.purpose}</code>
                </DataCell>

                <DataCell>
                  <StatusBadge
                    tone={
                      delivery.status === 'sent'
                        ? 'positive'
                        : delivery.status === 'failed' || delivery.status === 'suppressed'
                          ? 'caution'
                          : 'neutral'
                    }
                  >
                    {delivery.status}
                  </StatusBadge>
                </DataCell>

                <DataCell>
                  <span className="block">{delivery.attemptCount}</span>
                  {delivery.nextAttemptAt === null ? null : (
                    <span className="block text-xs text-[color:var(--color-foreground-muted)]">
                      {t('delivery.next')}:{' '}
                      {format.dateTime(delivery.nextAttemptAt, {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                  )}
                </DataCell>

                <DataCell wrap>
                  {delivery.failureCode === null ? (
                    <span className="text-xs text-[color:var(--color-foreground-muted)]">
                      —
                    </span>
                  ) : (
                    <>
                      <code className="block text-xs">{delivery.failureCode}</code>
                      <span className="block text-xs text-[color:var(--color-foreground-muted)]">
                        {delivery.failureClass}
                      </span>
                    </>
                  )}
                </DataCell>

                <DataCell>
                  {format.dateTime(delivery.createdAt, {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                </DataCell>

                {mayOperate ? (
                  <DataCell>
                    {delivery.status === 'sent' || delivery.status === 'suppressed' ? (
                      <span className="text-xs text-[color:var(--color-foreground-muted)]">
                        —
                      </span>
                    ) : (
                      <ActionForm
                        action={retryDeliveryAction}
                        submitLabel={t('delivery.retrySubmit')}
                        pendingLabel={t('common.pending')}
                        tone="secondary"
                        messages={{ ...copy.messages, success: t('delivery.retried') }}
                      >
                        <input type="hidden" name="locale" value={locale} />
                        <input type="hidden" name="deliveryId" value={delivery.id} />
                      </ActionForm>
                    )}
                  </DataCell>
                ) : null}
              </DataRow>
            ))}
          </DataTable>
        </Panel>
      )}

      {listed.more ? <Alert tone="info">{t('common.more')}</Alert> : null}

      <Panel>
        <div className="flex flex-col gap-3">
          <SectionHeading>{t('delivery.suppressions')}</SectionHeading>

          {suppressions.length === 0 ? (
            <EmptyState>{t('common.none')}</EmptyState>
          ) : (
            <DataTable
              caption={t('delivery.suppressions')}
              columns={[t('delivery.reason'), t('delivery.scope'), t('delivery.count')]}
            >
              {suppressions.map((entry) => (
                <DataRow key={`${entry.reason}:${entry.scope}`}>
                  <DataCell>{entry.reason}</DataCell>
                  <DataCell>{entry.scope}</DataCell>
                  <DataCell>{entry.count}</DataCell>
                </DataRow>
              ))}
            </DataTable>
          )}
        </div>
      </Panel>
    </main>
  );
}
