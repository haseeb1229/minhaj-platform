import { notFound } from 'next/navigation';

import type { RunCounts } from '@minhaj/contracts/migration';

import {
  Alert,
  DetailRow,
  EmptyState,
  PageHeading,
  Panel,
  SectionHeading,
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
  migrationPath,
  migrationRead,
  offsetOf,
  withQuery,
  type Query,
} from '../shared';
import { ReconciliationBadge } from '../status';

/**
 * `/{locale}/admin/migration/reconciliation` — every completed run with the
 * verdict it was given and the counts it was given it on, newest first, under
 * `migration.read`.
 *
 * The verdict is the context's arithmetic over the run's counts
 * (MIGRATION_STRATEGY.md §6.1), stored when the run completed. A run that
 * does not balance blocks every manifest of it; this screen says which runs
 * those are and by how much they disagree.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

/** The counts shown, in the order the equations read them. */
const COUNTS = [
  'discovered',
  'pending',
  'fetched',
  'parsed',
  'staged',
  'unchanged',
  'rejected',
  'errored',
  'excluded',
  'inconsistent',
  'reviewPending',
  'approved',
  'reviewRejected',
  'superseded',
  'published',
  'mapped',
  'merged',
] as const satisfies readonly (keyof RunCounts)[];

interface StoredDetail {
  readonly counts: Partial<Record<(typeof COUNTS)[number], number>> | null;
  readonly discrepancies: number;
}

/** The stored reconciliation detail, read defensively: it is shown, never trusted. */
function storedDetail(detail: string | null): StoredDetail {
  if (detail === null) return { counts: null, discrepancies: 0 };
  try {
    const value = JSON.parse(detail) as {
      readonly counts?: unknown;
      readonly discrepancies?: unknown;
      readonly omitted?: unknown;
    };
    const counts: Partial<Record<(typeof COUNTS)[number], number>> = {};
    if (typeof value.counts === 'object' && value.counts !== null)
      for (const name of COUNTS) {
        const count = (value.counts as Record<string, unknown>)[name];
        if (typeof count === 'number' && Number.isSafeInteger(count))
          counts[name] = count;
      }
    const listed = Array.isArray(value.discrepancies) ? value.discrepancies.length : 0;
    const omitted =
      typeof value.omitted === 'number' && Number.isSafeInteger(value.omitted)
        ? value.omitted
        : 0;
    return {
      counts: Object.keys(counts).length === 0 ? null : counts,
      discrepancies: listed + omitted,
    };
  } catch {
    return { counts: null, discrepancies: 0 };
  }
}

export default async function MigrationReconciliationPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const base = migrationPath(locale, '/reconciliation');
  const context = await requireAdminPage(locale, 'migration.read', base);
  const offset = offsetOf(await searchParams);
  if (offset === null) notFound();
  const copy = await adminMigrationCopy(locale);
  const { t } = copy;
  const timeZone = context.session.account.timezone;

  const listing = await migrationRead('migration-admin-reconciliations', () =>
    migrationRuntime().read.reconciliations(actorOf(context), { offset }),
  );
  if (!listing.ok && listing.failure === 'denied') notFound();

  return (
    <main className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('reconciliation.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('reconciliation.description')}
        </p>
      </header>

      <section
        className="flex flex-col gap-3"
        aria-labelledby="migration-reconciliations"
      >
        <SectionHeading>
          <span id="migration-reconciliations">{t('reconciliation.heading')}</span>
        </SectionHeading>
        {!listing.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : listing.value.rows.length === 0 ? (
          <EmptyState>
            {offset === 0 ? t('reconciliation.empty') : t('beyond')}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3" aria-label={t('reconciliation.heading')}>
            {listing.value.rows.map((run) => {
              const detail = storedDetail(run.detail);
              return (
                <Panel key={run.id} as="li">
                  <div className="flex min-w-0 flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <ReconciliationBadge state={run.reconciliation} copy={copy} />
                      <TextLink
                        href={migrationPath(
                          locale,
                          `/runs/${encodeURIComponent(run.id)}`,
                        )}
                      >
                        <Code>{run.sourceKey}</Code>
                      </TextLink>
                      {run.endedAt === null ? null : (
                        <span className="text-sm">
                          <MigrationTime
                            value={run.endedAt}
                            locale={locale}
                            timeZone={timeZone}
                          />
                        </span>
                      )}
                    </div>
                    {run.reconciliation === 'unbalanced' ? (
                      <Alert tone="warning">
                        {t('reconciliation.unbalanced', { count: detail.discrepancies })}
                      </Alert>
                    ) : null}
                    {detail.counts === null ? (
                      <p className="text-sm">{t('reconciliation.noCounts')}</p>
                    ) : (
                      <dl className="grid grid-cols-2 gap-x-6 sm:grid-cols-3 lg:grid-cols-4">
                        {COUNTS.map((name) =>
                          detail.counts?.[name] === undefined ? null : (
                            <DetailRow key={name} term={t(`count.${name}`)}>
                              {detail.counts[name]}
                            </DetailRow>
                          ),
                        )}
                      </dl>
                    )}
                  </div>
                </Panel>
              );
            })}
          </ul>
        )}
        {listing.ok ? (
          <Pager
            offset={offset}
            total={listing.value.total}
            hrefFor={(page) => withQuery(base, { page: page > 1 ? String(page) : null })}
            label={t('reconciliation.pages')}
            copy={copy}
          />
        ) : null}
      </section>
    </main>
  );
}
