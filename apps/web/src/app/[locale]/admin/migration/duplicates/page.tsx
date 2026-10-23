import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import { DUPLICATE_STATES, type DuplicateRow } from '@minhaj/contracts/migration';

import {
  Alert,
  DetailRow,
  EmptyState,
  Field,
  FilterLink,
  PageHeading,
  Panel,
  SectionHeading,
  TextArea,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { migrationRuntime } from '@/composition/migration';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { duplicateAction } from '../actions';
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
  type AdminMigrationCopy,
  type Query,
} from '../shared';
import { DuplicateStateBadge } from '../status';

/**
 * `/{locale}/admin/migration/duplicates` — duplicate candidates under
 * `migration.read`, filtered by state; deciding one re-checks
 * `migration.administer`, at the version shown.
 *
 * ONLY THE SAME PROVIDER VIDEO COLLAPSES AUTOMATICALLY; every other signal is
 * a candidate for a person. A merge is reversible (reopen) and keeps every
 * legacy address. A pair in two languages is RELATED, never a duplicate: it is
 * marked as such, no merge is offered, and the service and the database both
 * refuse one.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function MigrationDuplicatesPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const base = migrationPath(locale, '/duplicates');
  const context = await requireAdminPage(locale, 'migration.read', base);
  const query = await searchParams;
  const offset = offsetOf(query);
  const state = vocabularyOf(query, 'state', DUPLICATE_STATES);
  if (offset === null || state === undefined) notFound();
  const copy = await adminMigrationCopy(locale);
  const { t } = copy;
  const timeZone = context.session.account.timezone;
  const administer = context.authorization.can('migration.administer');

  const listing = await migrationRead('migration-admin-duplicates', () =>
    migrationRuntime().read.duplicates(actorOf(context), { state, offset }),
  );
  if (!listing.ok && listing.failure === 'denied') notFound();

  return (
    <main className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('duplicates.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('duplicates.description')}
        </p>
      </header>

      <nav aria-label={t('filter.state')} className="flex flex-wrap gap-2">
        <FilterLink href={base} current={state === null}>
          {t('filter.any')}
        </FilterLink>
        {DUPLICATE_STATES.map((value) => (
          <FilterLink
            key={value}
            href={withQuery(base, { state: value })}
            current={state === value}
          >
            {t(`duplicateState.${value}`)}
          </FilterLink>
        ))}
      </nav>

      <section className="flex flex-col gap-3" aria-labelledby="migration-duplicates">
        <SectionHeading>
          <span id="migration-duplicates">{t('duplicates.heading')}</span>
        </SectionHeading>
        {!listing.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : listing.value.rows.length === 0 ? (
          <EmptyState>{offset === 0 ? t('duplicates.empty') : t('beyond')}</EmptyState>
        ) : (
          <>
            <p className="text-sm">
              {t('duplicates.caption', { total: listing.value.total })}
            </p>
            <ul className="flex flex-col gap-3" aria-label={t('duplicates.heading')}>
              {listing.value.rows.map((row) => (
                <Candidate
                  key={row.id}
                  row={row}
                  locale={locale}
                  timeZone={timeZone}
                  administer={administer}
                  copy={copy}
                />
              ))}
            </ul>
          </>
        )}
        {listing.ok ? (
          <Pager
            offset={offset}
            total={listing.value.total}
            hrefFor={(page) =>
              withQuery(base, { state, page: page > 1 ? String(page) : null })
            }
            label={t('duplicates.pages')}
            copy={copy}
          />
        ) : null}
      </section>
    </main>
  );
}

function Candidate({
  row,
  locale,
  timeZone,
  administer,
  copy,
}: {
  readonly row: DuplicateRow;
  readonly locale: Locale;
  readonly timeZone: string | null;
  readonly administer: boolean;
  readonly copy: AdminMigrationCopy;
}) {
  const { t } = copy;
  // What may be decided from here: a merge never for a cross-language pair.
  const decisions: readonly ('merge' | 'distinct' | 'reopen')[] =
    row.state === 'open'
      ? row.crossLanguage
        ? ['distinct']
        : ['merge', 'distinct']
      : row.state === 'merged' || row.state === 'distinct'
        ? ['reopen']
        : [];
  return (
    <Panel as="li">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <DuplicateStateBadge state={row.state} copy={copy} />
          <span className="text-sm">{t(`duplicateSignal.${row.signal}`)}</span>
          {row.score === null ? null : (
            <span className="text-sm">{t('duplicates.score', { score: row.score })}</span>
          )}
        </div>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('duplicates.record')}>
            {row.recordTitle === null ? (
              <Code>{row.recordId}</Code>
            ) : (
              <bdi>{row.recordTitle}</bdi>
            )}
          </DetailRow>
          <DetailRow term={t('duplicates.other')}>
            {row.otherTitle === null ? (
              <Code>{row.otherRecordId}</Code>
            ) : (
              <bdi>{row.otherTitle}</bdi>
            )}
          </DetailRow>
          <DetailRow term={t('duplicates.found')}>
            <MigrationTime value={row.createdAt} locale={locale} timeZone={timeZone} />
          </DetailRow>
        </dl>
        {row.crossLanguage ? (
          <Alert tone="warning">{t('duplicates.crossLanguage')}</Alert>
        ) : null}
        {row.state === 'collapsed' ? (
          <p className="text-sm">{t('duplicates.collapsedHelp')}</p>
        ) : null}
        {administer && decisions.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {decisions.map((decision) => (
              <ActionForm
                key={decision}
                action={duplicateAction}
                submitLabel={t(`duplicates.${decision}`)}
                pendingLabel={t('pending')}
                tone={decision === 'merge' ? 'primary' : 'secondary'}
                messages={copy.messages}
              >
                <RowIdentity locale={locale} row={row} />
                <input type="hidden" name="decision" value={decision} />
                <Field
                  id={`duplicate-${row.id}-${decision}-note`}
                  label={t('duplicates.note')}
                >
                  {(props) => (
                    <TextArea {...props} name="note" rows={2} maxLength={500} />
                  )}
                </Field>
              </ActionForm>
            ))}
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
