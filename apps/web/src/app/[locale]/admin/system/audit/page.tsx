import { getFormatter, getTranslations } from 'next-intl/server';

import { requireAdminPage } from '@/composition/authorization';
import { identityRuntime } from '@/composition/identity';
import { requireLocale } from '@/config/route-locale';
import {
  Alert,
  Button,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  TextInput,
} from '@/components/ui';
import { PAGE_SIZE, pageOffset, queryValue } from '../../shared';

/**
 * The audit record — READ-ONLY.
 *
 * NO EDIT AND NO DELETE, and not merely because none is rendered: the runtime
 * principal is DENIED UPDATE and DELETE on `AuditLog` at the database, so the
 * discipline survives a mistake in this file (SECURITY_BASELINE.md §13.1).
 *
 * ONLY INDEXED FILTERS. Action and actor, each covered by its own index, over a
 * table that only grows. An unindexed predicate here would be a full scan on
 * every page view of an operator surface (§28, §41).
 *
 * ORDERED DETERMINISTICALLY — newest first, then by id. Time alone is not
 * deterministic: two records written in one transaction share a timestamp, and
 * a page boundary between them would show one row twice and another never.
 *
 * NO CHANGE PAYLOADS. Before and after state IS recorded — §30 requires the
 * before and after permission set for a bundle change — and it is not rendered.
 * A payload column on an operator screen is where a sensitive snapshot ends up
 * in front of everyone who may read the log (§13.4).
 */
export const metadata = { robots: { index: false, follow: false } };
export const dynamic = 'force-dynamic';

export default async function AuditPage({
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

  await requireAdminPage(locale, 'audit.read', `/${locale}/admin/system/audit`);

  const action = queryValue(query, 'action');
  const actorId = queryValue(query, 'actor');

  const { administration } = identityRuntime();
  const records = await administration.listAuditRecords({
    action,
    actorId,
    limit: PAGE_SIZE,
    offset: pageOffset(query, PAGE_SIZE),
  });

  return (
    <main className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('audit.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('audit.description')}
        </p>
      </header>

      <Panel>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-48 grow">
            <Field id="action" label={t('audit.filterAction')}>
              {(props) => (
                <TextInput
                  {...props}
                  name="action"
                  type="search"
                  defaultValue={action ?? ''}
                  maxLength={128}
                />
              )}
            </Field>
          </div>

          <div className="min-w-48 grow">
            <Field id="actor" label={t('audit.filterActor')}>
              {(props) => (
                <TextInput
                  {...props}
                  name="actor"
                  type="search"
                  defaultValue={actorId ?? ''}
                  maxLength={64}
                />
              )}
            </Field>
          </div>

          <Button tone="secondary">{t('common.apply')}</Button>
        </form>
      </Panel>

      <Alert tone="info">{t('audit.noPayload')}</Alert>

      {records.items.length === 0 ? (
        <EmptyState>{t('common.none')}</EmptyState>
      ) : (
        <Panel>
          <DataTable
            caption={t('audit.title')}
            columns={[
              t('audit.occurred'),
              t('audit.action'),
              t('audit.actor'),
              t('audit.target'),
              t('audit.source'),
            ]}
          >
            {records.items.map((record) => (
              <DataRow key={record.id}>
                <DataCell>
                  {format.dateTime(record.occurredAt, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                  })}
                </DataCell>

                <DataCell wrap>
                  <code className="text-xs">{record.action}</code>
                </DataCell>

                <DataCell wrap>
                  <span className="block text-xs">{record.actorType}</span>
                  <code className="block text-xs break-all text-[color:var(--color-foreground-muted)]">
                    {record.actorId ?? '—'}
                  </code>
                </DataCell>

                <DataCell wrap>
                  <span className="block text-xs">{record.targetType}</span>
                  <code className="block text-xs break-all text-[color:var(--color-foreground-muted)]">
                    {record.targetId ?? '—'}
                  </code>
                </DataCell>

                <DataCell wrap>
                  <code className="text-xs">{record.authorisingSource ?? '—'}</code>
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        </Panel>
      )}

      {records.more ? <Alert tone="info">{t('common.more')}</Alert> : null}
    </main>
  );
}
