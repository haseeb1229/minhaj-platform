import { notFound } from 'next/navigation';

import { ITEM_OUTCOMES, migrationIdSchema } from '@minhaj/contracts/migration';

import { ConfirmField } from '@/components/personal/parts';
import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  DetailRow,
  EmptyState,
  FilterLink,
  PageHeading,
  Panel,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { migrationRuntime } from '@/composition/migration';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../../(identity)/form-state';
import { cancelRunAction } from '../../actions';
import {
  Code,
  MigrationTime,
  Pager,
  RowIdentity,
  actorOf,
  adminMigrationCopy,
  migrationPath,
  migrationRead,
  offsetOf,
  vocabularyOf,
  withQuery,
  type Query,
} from '../../shared';
import { ItemOutcomeBadge, ReconciliationBadge, RunStateBadge } from '../../status';

/**
 * `/{locale}/admin/migration/runs/{id}` — one import run under
 * `migration.read`: its provenance (which adapter, parser, normaliser and
 * commit produced it), its reconciliation verdict and its item counts by
 * outcome, and its items, bounded and filterable by outcome. An OPEN run may
 * be cancelled under `migration.administer`, at the version shown; nothing
 * else about a run is decided here — the command line runs and resumes it.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function MigrationRunPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const base = migrationPath(locale, `/runs/${encodeURIComponent(id)}`);
  const context = await requireAdminPage(locale, 'migration.read', base);
  if (!migrationIdSchema.safeParse(id).success) notFound();
  const query = await searchParams;
  const offset = offsetOf(query);
  const outcome = vocabularyOf(query, 'outcome', ITEM_OUTCOMES);
  if (offset === null || outcome === undefined) notFound();
  const copy = await adminMigrationCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const timeZone = context.session.account.timezone;
  const administer = context.authorization.can('migration.administer');
  const { read } = migrationRuntime();

  const found = await migrationRead('migration-admin-run', () => read.run(actor, id));
  if (!found.ok && ['denied', 'not-found', 'invalid'].includes(found.failure)) notFound();
  if (found.ok && found.value === null) notFound();

  const back = (
    <p>
      <TextLink href={migrationPath(locale, '/runs')}>{t('runs.back')}</TextLink>
    </p>
  );
  if (!found.ok || found.value === null)
    return (
      <main className="flex flex-col gap-4">
        <PageHeading>{t('run.title')}</PageHeading>
        <Alert tone="error">{t('failure.load')}</Alert>
        {back}
      </main>
    );
  const run = found.value;

  // One bounded count per outcome, then the page of items asked for.
  const [counts, items] = await Promise.all([
    migrationRead('migration-admin-run-counts', () =>
      Promise.all(
        ITEM_OUTCOMES.map(async (value) => ({
          outcome: value,
          total: (
            await read.runItems(actor, { runId: run.id, outcome: value, offset: 0 })
          ).total,
        })),
      ),
    ),
    migrationRead('migration-admin-run-items', () =>
      read.runItems(actor, { runId: run.id, outcome, offset }),
    ),
  ]);

  return (
    <main className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('run.title')}</PageHeading>
        <div className="flex flex-wrap items-center gap-2">
          <RunStateBadge state={run.state} copy={copy} />
          <ReconciliationBadge state={run.reconciliation} copy={copy} />
        </div>
      </header>

      <Panel>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('run.source')}>
            <Code>{run.sourceKey}</Code>
          </DetailRow>
          <DetailRow term={t('run.started')}>
            <MigrationTime value={run.startedAt} locale={locale} timeZone={timeZone} />
          </DetailRow>
          <DetailRow term={t('run.ended')}>
            {run.endedAt === null ? (
              t('none')
            ) : (
              <MigrationTime value={run.endedAt} locale={locale} timeZone={timeZone} />
            )}
          </DetailRow>
          <DetailRow term={t('run.discovery')}>
            {run.discoveryComplete ? t('run.discoveryComplete') : t('run.discoveryOpen')}
          </DetailRow>
          <DetailRow term={t('run.reconciledAt')}>
            {run.reconciledAt === null ? (
              t('none')
            ) : (
              <MigrationTime
                value={run.reconciledAt}
                locale={locale}
                timeZone={timeZone}
              />
            )}
          </DetailRow>
          <DetailRow term={t('provenance.adapter')}>
            <Code>{`${run.provenance.adapterKey}@${run.provenance.adapterVersion}`}</Code>
          </DetailRow>
          <DetailRow term={t('provenance.parser')}>
            <Code>{`${run.provenance.parserKey}@${run.provenance.parserVersion}`}</Code>
          </DetailRow>
          <DetailRow term={t('provenance.normalizer')}>
            <Code>{run.provenance.normalizerVersion}</Code>
          </DetailRow>
          <DetailRow term={t('provenance.codeRevision')}>
            <Code>{run.provenance.codeRevision}</Code>
          </DetailRow>
          <DetailRow term={t('run.version')}>{run.version}</DetailRow>
        </dl>
        <p className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <TextLink href={withQuery(migrationPath(locale, '/staging'), { run: run.id })}>
            {t('run.stagedLink')}
          </TextLink>
          <TextLink href={withQuery(migrationPath(locale, '/errors'), { run: run.id })}>
            {t('run.errorsLink')}
          </TextLink>
        </p>
      </Panel>

      <section className="flex flex-col gap-3" aria-labelledby="run-counts">
        <SectionHeading>
          <span id="run-counts">{t('run.counts')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t(`run.verdict.${run.reconciliation}`)}
        </p>
        {!counts.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
            {counts.value.map((entry) => (
              <DetailRow key={entry.outcome} term={t(`itemOutcome.${entry.outcome}`)}>
                {entry.total}
              </DetailRow>
            ))}
          </dl>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="run-items">
        <SectionHeading>
          <span id="run-items">{t('run.items')}</span>
        </SectionHeading>
        <nav aria-label={t('filter.outcome')} className="flex flex-wrap gap-2">
          <FilterLink href={base} current={outcome === null}>
            {t('filter.any')}
          </FilterLink>
          {ITEM_OUTCOMES.map((value) => (
            <FilterLink
              key={value}
              href={withQuery(base, { outcome: value })}
              current={outcome === value}
            >
              {t(`itemOutcome.${value}`)}
            </FilterLink>
          ))}
        </nav>
        {!items.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : items.value.rows.length === 0 ? (
          <EmptyState>{offset === 0 ? t('run.noItems') : t('beyond')}</EmptyState>
        ) : (
          <DataTable
            caption={t('run.itemsCaption', { total: items.value.total })}
            columns={[
              t('run.column.position'),
              t('run.column.externalKey'),
              t('run.column.outcome'),
              t('run.column.attempts'),
              t('run.column.staged'),
            ]}
          >
            {items.value.rows.map((item) => (
              <DataRow key={item.itemId}>
                <DataCell>{item.position}</DataCell>
                <DataCell wrap>
                  <Code>{item.externalKey}</Code>
                </DataCell>
                <DataCell>
                  <ItemOutcomeBadge outcome={item.outcome} copy={copy} />
                </DataCell>
                <DataCell>{item.attempts}</DataCell>
                <DataCell>
                  {item.stagedRecordId === null ? (
                    t('none')
                  ) : (
                    <TextLink
                      href={migrationPath(
                        locale,
                        `/staging/${encodeURIComponent(item.stagedRecordId)}`,
                      )}
                    >
                      {t('run.openStaged')}
                    </TextLink>
                  )}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
        {items.ok ? (
          <Pager
            offset={offset}
            total={items.value.total}
            hrefFor={(page) =>
              withQuery(base, { outcome, page: page > 1 ? String(page) : null })
            }
            label={t('run.itemPages')}
            copy={copy}
          />
        ) : null}
      </section>

      {administer && run.state === 'open' ? (
        <section className="flex flex-col gap-3" aria-labelledby="run-cancel">
          <SectionHeading>
            <span id="run-cancel">{t('run.cancel.heading')}</span>
          </SectionHeading>
          <p className="text-sm">{t('run.cancel.help')}</p>
          <ActionForm
            action={cancelRunAction}
            submitLabel={t('run.cancel.submit')}
            pendingLabel={t('pending')}
            tone="destructive"
            messages={{ ...copy.messages, success: t('run.cancel.done') }}
          >
            <RowIdentity locale={locale} row={run} />
            <ConfirmField id="run-cancel-confirm" label={t('run.cancel.confirm')} />
          </ActionForm>
        </section>
      ) : null}

      {back}
    </main>
  );
}
