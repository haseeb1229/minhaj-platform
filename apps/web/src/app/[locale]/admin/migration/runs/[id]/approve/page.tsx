import { notFound } from 'next/navigation';

import { MIGRATION_LIMITS, migrationIdSchema } from '@minhaj/contracts/migration';

import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  DetailRow,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  TextArea,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { migrationRuntime } from '@/composition/migration';
import { requireLocale } from '@/config/route-locale';
import { approveRunAction } from '../../../actions';
import { RunBatchForm } from '../../../run-batch-form';
import {
  Code,
  Pager,
  actorOf,
  adminMigrationCopy,
  migrationPath,
  migrationRead,
  offsetOf,
  withQuery,
  type Query,
} from '../../../shared';
import { ContentKindLabel } from '../../../status';
import { adminPageMetadata } from '../../../../metadata';

/**
 * `/{locale}/admin/migration/runs/{id}/approve` — R2. A run's APPROVAL
 * CANDIDATES under `migration.read`: every pending revision that is valid,
 * free of personal data and of a kind migration may publish, one page at a
 * time in the order the run produced them, each linked to its own record page;
 * and what the run-wide approval leaves, counted by why (invalid, flagged,
 * cleared — a single decision by someone who cleared nothing — and
 * review-only religious material, never offered).
 *
 * A PERSON DECIDES. For a holder of `migration.administer` on a completed,
 * balanced run, one form confirms the WHOLE set this page lists — its size and
 * the fingerprint of every candidate's version — and approves its next slice.
 * The service re-reads the set and refuses one that moved since; every
 * revision is approved through the single review's own checks and audited on
 * its own, in that person's name. The page then lists what remains.
 */
export const generateMetadata = adminPageMetadata(
  'adminMigration',
  'runBatch.approve.title',
);

export const dynamic = 'force-dynamic';

export default async function MigrationRunApprovalPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const runPath = migrationPath(locale, `/runs/${encodeURIComponent(id)}`);
  const base = `${runPath}/approve`;
  const context = await requireAdminPage(locale, 'migration.read', base);
  if (!migrationIdSchema.safeParse(id).success) notFound();
  const offset = offsetOf(await searchParams);
  if (offset === null) notFound();
  const copy = await adminMigrationCopy(locale);
  const { t } = copy;
  const administer = context.authorization.can('migration.administer');

  const found = await migrationRead('migration-admin-run-approval', () =>
    migrationRuntime().read.runApproval(actorOf(context), { runId: id, offset }),
  );
  if (!found.ok && ['denied', 'invalid', 'not-found'].includes(found.failure)) notFound();
  if (found.ok && found.value === null) notFound();

  const back = (
    <p>
      <TextLink href={runPath}>{t('runBatch.back')}</TextLink>
    </p>
  );
  if (!found.ok || found.value === null)
    return (
      <main className="flex flex-col gap-4">
        <PageHeading>{t('runBatch.approve.title')}</PageHeading>
        <Alert tone="error">{t('failure.load')}</Alert>
        {back}
      </main>
    );
  const { run, counts, page, confirmation } = found.value;
  const reconciled = run.state === 'completed' && run.reconciliation === 'balanced';
  const slice = Math.min(confirmation.count, MIGRATION_LIMITS.runChunk);

  return (
    <main className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('runBatch.approve.title')}</PageHeading>
        <p className="text-sm text-foreground-muted">{t('runBatch.approve.intro')}</p>
        <p className="text-sm">
          <Code>{run.sourceKey}</Code>
        </p>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="run-approval-counts">
        <SectionHeading>
          <span id="run-approval-counts">{t('runBatch.approve.countsHeading')}</span>
        </SectionHeading>
        <dl className="divide-y divide-border">
          <DetailRow term={t('runBatch.approve.count.pending')}>
            {counts.pending}
          </DetailRow>
          <DetailRow term={t('runBatch.approve.count.candidates')}>
            {counts.candidates}
          </DetailRow>
          <DetailRow term={t('runBatch.approve.count.invalid')}>
            {counts.invalid}
          </DetailRow>
          <DetailRow term={t('runBatch.approve.count.flagged')}>
            {counts.flagged}
          </DetailRow>
          <DetailRow term={t('runBatch.approve.count.cleared')}>
            {counts.cleared}
          </DetailRow>
          <DetailRow term={t('runBatch.approve.count.reviewOnly')}>
            {counts.reviewOnly}
          </DetailRow>
          <DetailRow term={t('runBatch.approve.count.awaitingDuplicate')}>
            {counts.awaitingDuplicate}
          </DetailRow>
        </dl>
        <p className="text-sm">
          <TextLink
            href={withQuery(migrationPath(locale, '/staging'), {
              run: run.id,
              review: 'pending',
            })}
          >
            {t('runBatch.approve.allPending')}
          </TextLink>
        </p>
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="run-approval-list">
        <SectionHeading>
          <span id="run-approval-list">{t('runBatch.approve.heading')}</span>
        </SectionHeading>
        {page.rows.length === 0 ? (
          <EmptyState>
            {offset === 0 ? t('runBatch.approve.none') : t('beyond')}
          </EmptyState>
        ) : (
          <DataTable
            caption={t('runBatch.approve.caption', { total: page.total })}
            columns={[
              t('staging.column.title'),
              t('staging.column.contentKind'),
              t('staging.column.language'),
            ]}
          >
            {page.rows.map((row) => (
              <DataRow key={row.id}>
                <DataCell wrap>
                  <TextLink
                    href={migrationPath(locale, `/staging/${encodeURIComponent(row.id)}`)}
                  >
                    <bdi>{row.title}</bdi>
                  </TextLink>
                </DataCell>
                <DataCell>
                  <ContentKindLabel kind={row.contentKind} copy={copy} />
                </DataCell>
                <DataCell>
                  {row.languageCode === null ? (
                    t('none')
                  ) : (
                    <Code>{row.languageCode}</Code>
                  )}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
        <Pager
          offset={offset}
          total={page.total}
          hrefFor={(number) =>
            withQuery(base, { page: number > 1 ? String(number) : null })
          }
          label={t('runBatch.approve.pages')}
          copy={copy}
        />
      </section>

      {administer && confirmation.count > 0 ? (
        <Panel>
          <div className="flex flex-col gap-3">
            <SectionHeading>{t('runBatch.approve.actHeading')}</SectionHeading>
            {!reconciled ? (
              <Alert tone="info">{t('runBatch.approve.unreconciled')}</Alert>
            ) : (
              <>
                <p className="text-sm">
                  {t('runBatch.approve.actHelp', {
                    count: confirmation.count,
                    slice,
                  })}
                </p>
                <RunBatchForm
                  action={approveRunAction}
                  locale={locale}
                  runId={run.id}
                  confirmation={confirmation}
                  names={Object.fromEntries(page.rows.map((row) => [row.id, row.title]))}
                  labels={{
                    confirm: t('runBatch.approve.confirm', { count: confirmation.count }),
                    submit: t('runBatch.approve.submit', { count: slice }),
                    pending: t('pending'),
                    decided: t('runBatch.approve.decided'),
                    refused: t('runBatch.refused'),
                    remaining: t('runBatch.remaining'),
                    unknownItem: t('runBatch.approve.unknownItem'),
                  }}
                  messages={{
                    ...copy.messages,
                    success: t('runBatch.approve.done'),
                    conflict: t('runBatch.conflict'),
                    'items-refused': t('runBatch.approve.partial'),
                    'batch-interrupted': t('runBatch.interrupted'),
                  }}
                >
                  <Field id="run-approval-note" label={t('runBatch.approve.note')}>
                    {(props) => (
                      <TextArea {...props} name="note" rows={2} maxLength={500} />
                    )}
                  </Field>
                </RunBatchForm>
              </>
            )}
          </div>
        </Panel>
      ) : null}

      {back}
    </main>
  );
}
