import { notFound } from 'next/navigation';

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
  SectionHeading,
  Select,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { migrationRuntime } from '@/composition/migration';
import { requireLocale } from '@/config/route-locale';
import {
  Code,
  MigrationTime,
  Pager,
  actorOf,
  adminMigrationCopy,
  idOf,
  migrationPath,
  migrationRead,
  offsetOf,
  withQuery,
  type Query,
} from '../shared';
import { ReconciliationBadge, RunStateBadge } from '../status';

/**
 * `/{locale}/admin/migration/runs` — import runs, newest first, under
 * `migration.read`, filtered by source. A run is started and resumed by the
 * command line (`npm run migration:*`), never from this browser; this screen
 * says what each run did. A source filter the address names that does not
 * parse is a 404, never a quietly broadened list.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function MigrationRunsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const base = migrationPath(locale, '/runs');
  const context = await requireAdminPage(locale, 'migration.read', base);
  const query = await searchParams;
  const offset = offsetOf(query);
  const sourceId = idOf(query, 'source');
  if (offset === null || sourceId === undefined) notFound();
  const copy = await adminMigrationCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const timeZone = context.session.account.timezone;
  const runtime = migrationRuntime();

  const [sources, listing] = await Promise.all([
    migrationRead('migration-admin-run-sources', () => runtime.sources.sources(actor, 0)),
    migrationRead('migration-admin-runs', () =>
      runtime.read.runs(actor, { sourceId, offset }),
    ),
  ]);
  if (!listing.ok && listing.failure === 'denied') notFound();

  const options = sources.ok ? sources.value.rows : [];

  return (
    <main className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('runs.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('runs.description')}
        </p>
      </header>

      <Panel>
        <form method="get" action={base} className="flex flex-col gap-4">
          <SectionHeading>{t('filter.heading')}</SectionHeading>
          <Field id="runs-source" label={t('filter.source')}>
            {(props) => (
              <Select {...props} name="source" defaultValue={sourceId ?? ''}>
                <option value="">{t('filter.any')}</option>
                {options.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.key}
                  </option>
                ))}
                {sourceId !== null &&
                !options.some((source) => source.id === sourceId) ? (
                  <option value={sourceId}>{sourceId}</option>
                ) : null}
              </Select>
            )}
          </Field>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Button tone="secondary">{t('filter.apply')}</Button>
            <TextLink href={base}>{t('filter.clear')}</TextLink>
          </div>
        </form>
      </Panel>

      <section className="flex flex-col gap-3" aria-labelledby="migration-runs">
        <SectionHeading>
          <span id="migration-runs">{t('runs.heading')}</span>
        </SectionHeading>
        {!listing.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : listing.value.rows.length === 0 ? (
          <EmptyState>{offset === 0 ? t('runs.empty') : t('beyond')}</EmptyState>
        ) : (
          <DataTable
            caption={t('runs.caption', { total: listing.value.total })}
            columns={[
              t('runs.column.started'),
              t('runs.column.source'),
              t('runs.column.state'),
              t('runs.column.reconciliation'),
              t('runs.column.items'),
              t('runs.column.ended'),
            ]}
          >
            {listing.value.rows.map((run) => (
              <DataRow key={run.id}>
                <DataCell>
                  <TextLink href={`${base}/${encodeURIComponent(run.id)}`}>
                    <MigrationTime
                      value={run.startedAt}
                      locale={locale}
                      timeZone={timeZone}
                    />
                  </TextLink>
                </DataCell>
                <DataCell>
                  <Code>{run.sourceKey}</Code>
                </DataCell>
                <DataCell>
                  <RunStateBadge state={run.state} copy={copy} />
                </DataCell>
                <DataCell>
                  <ReconciliationBadge state={run.reconciliation} copy={copy} />
                </DataCell>
                <DataCell>{run.items}</DataCell>
                <DataCell>
                  {run.endedAt === null ? (
                    t('none')
                  ) : (
                    <MigrationTime
                      value={run.endedAt}
                      locale={locale}
                      timeZone={timeZone}
                    />
                  )}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
        {listing.ok ? (
          <Pager
            offset={offset}
            total={listing.value.total}
            hrefFor={(page) =>
              withQuery(base, { source: sourceId, page: page > 1 ? String(page) : null })
            }
            label={t('runs.pages')}
            copy={copy}
          />
        ) : null}
      </section>
    </main>
  );
}
