import { localizedPath } from '@minhaj/contracts';
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
import { AdminPager } from '../../pager';
import { adminPageHref } from '../../paging';
import { PAGE_SIZE, pageOffset } from '../../shared';
import { adminPageMetadata } from '../../metadata';
import { readAuditFilters } from './filters';

/**
 * The audit record — READ-ONLY.
 *
 * NO EDIT AND NO DELETE, and not merely because none is rendered: the runtime
 * principal is DENIED UPDATE and DELETE on `AuditLog` at the database, so the
 * discipline survives a mistake in this file (SECURITY_BASELINE.md §13.1).
 *
 * ONLY INDEXED FILTERS. An action prefix, the actor and a date range (R2),
 * each served by an index, over a table that only grows. An unindexed predicate here would be a full scan on
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
export const generateMetadata = adminPageMetadata('admin', 'audit.title');
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

  await requireAdminPage(
    locale,
    'audit.read',
    localizedPath(locale, '/admin/system/audit'),
  );

  const filters = readAuditFilters(query);
  const offset = pageOffset(query, PAGE_SIZE);

  const { administration } = identityRuntime();
  const records = await administration.listAuditRecords({
    action: filters.action,
    actorId: filters.actorId,
    from: filters.from,
    to: filters.to,
    limit: PAGE_SIZE,
    offset,
  });

  return (
    <main className="flex flex-col gap-4">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('audit.title')}</PageHeading>
        <p className="text-sm text-foreground-muted">{t('audit.description')}</p>
      </header>

      <Panel>
        <form method="get" className="flex flex-wrap items-end gap-3">
          <div className="min-w-44 grow">
            <Field
              id="action"
              label={t('audit.filterAction')}
              help={t('audit.filterActionHelp')}
            >
              {(props) => (
                <TextInput
                  {...props}
                  name="action"
                  type="search"
                  defaultValue={filters.action ?? ''}
                  maxLength={128}
                  dir="ltr"
                />
              )}
            </Field>
          </div>
          <div className="min-w-44 grow">
            <Field id="actor" label={t('audit.filterActor')}>
              {(props) => (
                <TextInput
                  {...props}
                  name="actor"
                  type="search"
                  defaultValue={filters.actorId ?? ''}
                  maxLength={64}
                  dir="ltr"
                />
              )}
            </Field>
          </div>
          <div className="min-w-44 grow">
            <Field id="from" label={t('audit.filterFrom')}>
              {(props) => (
                <TextInput
                  {...props}
                  name="from"
                  type="date"
                  defaultValue={filters.fromDay ?? ''}
                  dir="ltr"
                />
              )}
            </Field>
          </div>
          <div className="min-w-44 grow">
            <Field id="to" label={t('audit.filterTo')}>
              {(props) => (
                <TextInput
                  {...props}
                  name="to"
                  type="date"
                  defaultValue={filters.toDay ?? ''}
                  dir="ltr"
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
                  <code className="block text-xs break-all text-foreground-muted">
                    {record.actorId ?? '—'}
                  </code>
                </DataCell>

                <DataCell wrap>
                  <span className="block text-xs">{record.targetType}</span>
                  <code className="block text-xs break-all text-foreground-muted">
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

      <AdminPager
        label={t('pager.label')}
        offset={offset}
        pageSize={PAGE_SIZE}
        more={records.more}
        href={adminPageHref(localizedPath(locale, '/admin/system/audit'), {
          action: filters.action,
          actor: filters.actorId,
          from: filters.fromDay,
          to: filters.toDay,
        })}
        previousLabel={t('pager.previous')}
        nextLabel={t('pager.next')}
      />
    </main>
  );
}
