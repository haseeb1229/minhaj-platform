import { getFormatter, getTranslations } from 'next-intl/server';

import { requireAdminPage } from '@/composition/authorization';
import { searchRuntime } from '@/composition/search';
import { requireLocale } from '@/config/route-locale';
import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  DetailRow,
  PageHeading,
  Panel,
  SectionHeading,
  StatusBadge,
} from '@/components/ui';
import { ActionForm } from '../../../(identity)/form-state';
import { adminCopy } from '../../shared';
import {
  rebuildSearchIndexAction,
  reconcileSearchIndexAction,
  retrySearchIndexingAction,
} from './actions';

/**
 * `/admin/system/search` — indexing lag and failures (ROUTE_MAP.md §5.1, §7;
 * DELIVERY_PLAN.md Phase 17 — "an operator-visible view of indexing lag and
 * failures").
 *
 * WHAT IS NOT ON THIS PAGE: no document text, no query anybody typed, no SQL,
 * no stack trace and no engine message. The index holds only what owners
 * publish, failures are stored as categories, and the lag is counts and times
 * (SECURITY_BASELINE.md §19.2).
 *
 * NOT A JOB DASHBOARD. It shows one thing — whether the derived index is keeping
 * up with its owners — and offers the three operations that repair it.
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function SearchOperationsPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'admin' });
  const format = await getFormatter({ locale });

  const page = await requireAdminPage(
    locale,
    'search.read',
    `/${locale}/admin/system/search`,
  );
  const copy = await adminCopy(locale);
  const status = await searchRuntime().status();
  const mayOperate = page.authorization.can('search.operate');

  const when = (value: Date | null, empty: string) =>
    value === null
      ? empty
      : format.dateTime(value, { dateStyle: 'medium', timeStyle: 'short' });
  const healthy = status.pending === 0 && status.failed === 0 && status.retrying === 0;

  return (
    <main className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('search.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('search.description')}
        </p>
      </header>

      <Alert tone={healthy ? 'success' : 'warning'}>
        {healthy ? t('search.healthy') : t('search.attention')}
      </Alert>

      <Panel>
        <dl className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
          <DetailRow term={t('search.pending')}>
            {format.number(status.pending)}
          </DetailRow>
          <DetailRow term={t('search.retrying')}>
            {format.number(status.retrying)}
          </DetailRow>
          <DetailRow term={t('search.failed')}>{format.number(status.failed)}</DetailRow>
          <DetailRow term={t('search.oldest')}>
            {when(status.oldestPendingAt, t('search.nothingWaiting'))}
          </DetailRow>
          <DetailRow term={t('search.lastIndexed')}>
            {when(status.lastIndexedAt, t('search.never'))}
          </DetailRow>
          <DetailRow term={t('search.documents')}>
            {format.number(status.documents)}
          </DetailRow>
          <DetailRow term={t('search.engine')}>
            {format.number(status.enginePending)}
          </DetailRow>
        </dl>
      </Panel>

      <Panel>
        <div className="flex flex-col gap-3">
          <SectionHeading>{t('search.failures')}</SectionHeading>
          {status.failures.length === 0 ? (
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('common.none')}
            </p>
          ) : (
            <DataTable
              caption={t('search.failures')}
              columns={[
                t('search.kind'),
                t('search.record'),
                t('search.failure'),
                t('search.attempts'),
                t('search.state'),
                t('search.when'),
              ]}
            >
              {status.failures.map((failure) => (
                <DataRow key={`${failure.kind}:${failure.id}`}>
                  <DataCell>
                    {/* Every scope kind is labelled in every locale; the Phase-17
                        boundary test proves the catalogue matches the vocabulary. */}
                    {t(`search.kinds.${failure.kind}` as 'search.kinds.topic')}
                  </DataCell>
                  <DataCell wrap>
                    <code className="text-xs">{failure.id}</code>
                  </DataCell>
                  <DataCell wrap>{t(`search.categories.${failure.category}`)}</DataCell>
                  <DataCell>{format.number(failure.attempts)}</DataCell>
                  <DataCell>
                    <StatusBadge tone={failure.exhausted ? 'caution' : 'neutral'}>
                      {failure.exhausted
                        ? t('search.exhausted')
                        : t('search.retryingState')}
                    </StatusBadge>
                  </DataCell>
                  <DataCell>{when(failure.failedAt, '—')}</DataCell>
                </DataRow>
              ))}
            </DataTable>
          )}
        </div>
      </Panel>

      {mayOperate ? (
        <Panel>
          <div className="flex flex-col gap-6">
            <SectionHeading>{t('search.operations')}</SectionHeading>

            <div className="flex flex-col gap-2">
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                {t('search.retryHelp')}
              </p>
              <ActionForm
                action={retrySearchIndexingAction}
                submitLabel={t('search.retry')}
                pendingLabel={t('common.pending')}
                tone="secondary"
                messages={{ ...copy.messages, success: t('search.retried') }}
              >
                <input type="hidden" name="locale" value={locale} />
              </ActionForm>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                {t('search.reconcileHelp')}
              </p>
              <ActionForm
                action={reconcileSearchIndexAction}
                submitLabel={t('search.reconcile')}
                pendingLabel={t('common.pending')}
                tone="secondary"
                messages={{ ...copy.messages, success: t('search.reconciled') }}
              >
                <input type="hidden" name="locale" value={locale} />
              </ActionForm>
            </div>

            <div className="flex flex-col gap-2">
              <p className="text-sm text-[color:var(--color-foreground-muted)]">
                {t('search.rebuildHelp')}
              </p>
              <ActionForm
                action={rebuildSearchIndexAction}
                submitLabel={t('search.rebuild')}
                pendingLabel={t('common.pending')}
                tone="secondary"
                messages={{ ...copy.messages, success: t('search.rebuilt') }}
              >
                <input type="hidden" name="locale" value={locale} />
              </ActionForm>
            </div>
          </div>
        </Panel>
      ) : null}
    </main>
  );
}
