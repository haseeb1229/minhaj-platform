import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  MANIFEST_STATES,
  isPublishableKind,
  type PromotionRecord,
} from '@minhaj/contracts/migration';

import { ConfirmField } from '@/components/personal/parts';
import {
  Alert,
  Button,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Field,
  FilterLink,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { migrationRuntime } from '@/composition/migration';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import {
  approvePromotionAction,
  createManifestAction,
  withdrawPromotionAction,
} from '../actions';
import {
  Code,
  MIGRATION_PAGE,
  MigrationPublicationStepUp,
  MigrationTime,
  Pager,
  RowIdentity,
  actorOf,
  adminMigrationCopy,
  idOf,
  migrationPath,
  migrationRead,
  offsetOf,
  vocabularyOf,
  withQuery,
  type AdminMigrationCopy,
  type Query,
} from '../shared';
import { ContentKindLabel, ManifestStateBadge, PromotionStateBadge } from '../status';

/**
 * `/{locale}/admin/migration/manifests` — publish manifests and promotions,
 * under `migration.read`.
 *
 * A MANIFEST IS PREPARED under `migration.administer`: a draft over APPROVED
 * revisions of one COMPLETED, BALANCED run — an unreconciled run offers
 * nothing to choose, and the service refuses one. A REVIEW-ONLY kind (Fatwa,
 * Quran translation) is never offered, however it was reviewed: migration
 * never publishes religious material, and the service and the database each
 * refuse it a manifest entry. Publishing and rolling back happen on the
 * manifest's own page under `migration.publish`.
 *
 * A PROMOTION is the reviewed corpus set carried from staging to production:
 * created from published entries and withdrawn under `migration.administer`,
 * APPROVED only under `migration.publish` with a live `migration-publication`
 * step-up — and CARRIED BY THE COMMAND LINE, never from this browser. This
 * screen shows where each one stands.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function MigrationManifestsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const base = migrationPath(locale, '/manifests');
  const context = await requireAdminPage(locale, 'migration.read', base);
  const query = await searchParams;
  const state = vocabularyOf(query, 'state', MANIFEST_STATES);
  const offset = offsetOf(query);
  const promotionOffset = offsetOf(query, 'ppage');
  const runId = idOf(query, 'run');
  if (
    state === undefined ||
    offset === null ||
    promotionOffset === null ||
    runId === undefined
  )
    notFound();
  const copy = await adminMigrationCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const timeZone = context.session.account.timezone;
  const administer = context.authorization.can('migration.administer');
  const publisher = context.authorization.can('migration.publish');
  const { read } = migrationRuntime();

  const [manifests, promotions, completed, approved] = await Promise.all([
    migrationRead('migration-admin-manifests', () =>
      read.manifests(actor, { state, offset }),
    ),
    migrationRead('migration-admin-promotions', () =>
      read.promotions(actor, { offset: promotionOffset }),
    ),
    administer
      ? migrationRead('migration-admin-manifest-runs', () =>
          read.reconciliations(actor, { offset: 0 }),
        )
      : Promise.resolve(null),
    administer && runId !== null
      ? migrationRead('migration-admin-manifest-candidates', () =>
          read.staged(actor, {
            review: 'approved',
            runId,
            unmanifested: true,
            offset: 0,
          }),
        )
      : Promise.resolve(null),
  ]);
  if (
    (!manifests.ok && manifests.failure === 'denied') ||
    (!promotions.ok && promotions.failure === 'denied')
  )
    notFound();

  const current = {
    state,
    page: offset > 0 ? String(offset / MIGRATION_PAGE + 1) : null,
    ppage: promotionOffset > 0 ? String(promotionOffset / MIGRATION_PAGE + 1) : null,
  };
  const href = (change: Readonly<Record<string, string | null>>) =>
    withQuery(base, { ...current, ...change });
  // Religious material is reviewed as evidence only — never offered to publish.
  const offered =
    approved !== null && approved.ok
      ? approved.value.rows.filter((row) => isPublishableKind(row.contentKind))
      : [];
  const withheld =
    approved !== null && approved.ok ? approved.value.rows.length - offered.length : 0;
  const balancedRuns =
    completed !== null && completed.ok
      ? completed.value.rows.filter((run) => run.reconciliation === 'balanced')
      : [];

  return (
    <main className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('manifests.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('manifests.description')}
        </p>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="migration-manifests">
        <SectionHeading>
          <span id="migration-manifests">{t('manifests.heading')}</span>
        </SectionHeading>
        <nav aria-label={t('filter.state')} className="flex flex-wrap gap-2">
          <FilterLink href={href({ state: null, page: null })} current={state === null}>
            {t('filter.any')}
          </FilterLink>
          {MANIFEST_STATES.map((value) => (
            <FilterLink
              key={value}
              href={href({ state: value, page: null })}
              current={state === value}
            >
              {t(`manifestState.${value}`)}
            </FilterLink>
          ))}
        </nav>
        {!manifests.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : manifests.value.rows.length === 0 ? (
          <EmptyState>{offset === 0 ? t('manifests.empty') : t('beyond')}</EmptyState>
        ) : (
          <DataTable
            caption={t('manifests.caption', { total: manifests.value.total })}
            columns={[
              t('manifests.column.created'),
              t('manifests.column.state'),
              t('manifests.column.run'),
              t('manifests.column.published'),
            ]}
          >
            {manifests.value.rows.map((manifest) => (
              <DataRow key={manifest.id}>
                <DataCell>
                  <TextLink href={`${base}/${encodeURIComponent(manifest.id)}`}>
                    <MigrationTime
                      value={manifest.createdAt}
                      locale={locale}
                      timeZone={timeZone}
                    />
                  </TextLink>
                </DataCell>
                <DataCell>
                  <ManifestStateBadge state={manifest.state} copy={copy} />
                </DataCell>
                <DataCell>
                  <TextLink
                    href={migrationPath(
                      locale,
                      `/runs/${encodeURIComponent(manifest.runId)}`,
                    )}
                  >
                    {t('manifests.openRun')}
                  </TextLink>
                </DataCell>
                <DataCell>
                  {manifest.publishedAt === null ? (
                    t('none')
                  ) : (
                    <MigrationTime
                      value={manifest.publishedAt}
                      locale={locale}
                      timeZone={timeZone}
                    />
                  )}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
        {manifests.ok ? (
          <Pager
            offset={offset}
            total={manifests.value.total}
            hrefFor={(page) => href({ page: page > 1 ? String(page) : null })}
            label={t('manifests.pages')}
            copy={copy}
          />
        ) : null}
      </section>

      {administer ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <SectionHeading>{t('manifests.create.heading')}</SectionHeading>
            <p className="text-sm text-[color:var(--color-foreground-muted)]">
              {t('manifests.create.help')}
            </p>
            <form method="get" action={base} className="flex flex-col gap-4">
              <Field id="manifest-run" label={t('manifests.create.run')}>
                {(props) => (
                  <Select {...props} name="run" defaultValue={runId ?? ''}>
                    <option value="">{t('manifests.create.chooseRun')}</option>
                    {balancedRuns.map((run) => (
                      <option key={run.id} value={run.id}>
                        {`${run.sourceKey} · ${new Intl.DateTimeFormat(locale, {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                          timeZone: 'UTC',
                        }).format(run.endedAt ?? run.startedAt)} UTC`}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <div>
                <Button tone="secondary">{t('manifests.create.showApproved')}</Button>
              </div>
            </form>
            {balancedRuns.length === 0 ? (
              <p className="text-sm">{t('manifests.create.noRuns')}</p>
            ) : null}
            {approved === null || runId === null ? null : !approved.ok ? (
              <Alert tone="error">{copy.refusals[approved.failure]}</Alert>
            ) : approved.value.rows.length === 0 ? (
              <EmptyState>{t('manifests.create.noApproved')}</EmptyState>
            ) : offered.length === 0 ? (
              <EmptyState>{t('manifests.create.noPublishable')}</EmptyState>
            ) : (
              <ActionForm
                action={createManifestAction}
                submitLabel={t('manifests.create.submit')}
                pendingLabel={t('pending')}
                messages={copy.messages}
              >
                <input type="hidden" name="locale" value={locale} />
                <input type="hidden" name="runId" value={runId} />
                <fieldset className="flex flex-col gap-2">
                  <legend className="text-sm font-medium">
                    {t('manifests.create.revisions', { total: approved.value.total })}
                  </legend>
                  {offered.map((row) => (
                    <div key={row.id} className="flex items-start gap-2 text-sm">
                      <input
                        id={`manifest-staged-${row.id}`}
                        type="checkbox"
                        name="stagedRecordId"
                        value={row.id}
                        defaultChecked
                        className="mt-1"
                      />
                      <label htmlFor={`manifest-staged-${row.id}`}>
                        <bdi>{row.title}</bdi>{' '}
                        <span className="text-[color:var(--color-foreground-muted)]">
                          <ContentKindLabel kind={row.contentKind} copy={copy} />
                        </span>
                      </label>
                    </div>
                  ))}
                </fieldset>
              </ActionForm>
            )}
            {withheld > 0 ? (
              <p className="text-sm">
                {t('manifests.create.reviewOnlyWithheld', { count: withheld })}
              </p>
            ) : null}
          </div>
        </Panel>
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby="migration-promotions">
        <SectionHeading>
          <span id="migration-promotions">{t('promotions.heading')}</span>
        </SectionHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('promotions.help')}
        </p>
        <Alert tone="info">{t('promotions.commandLine')}</Alert>
        {publisher ? <MigrationPublicationStepUp locale={locale} /> : null}
        {!promotions.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : promotions.value.rows.length === 0 ? (
          <EmptyState>
            {promotionOffset === 0 ? t('promotions.empty') : t('beyond')}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3" aria-label={t('promotions.heading')}>
            {promotions.value.rows.map((promotion) => (
              <Promotion
                key={promotion.id}
                promotion={promotion}
                locale={locale}
                timeZone={timeZone}
                administer={administer}
                publisher={publisher}
                copy={copy}
              />
            ))}
          </ul>
        )}
        {promotions.ok ? (
          <Pager
            offset={promotionOffset}
            total={promotions.value.total}
            hrefFor={(page) => href({ ppage: page > 1 ? String(page) : null })}
            label={t('promotions.pages')}
            copy={copy}
          />
        ) : null}
      </section>
    </main>
  );
}

function Promotion({
  promotion,
  locale,
  timeZone,
  administer,
  publisher,
  copy,
}: {
  readonly promotion: PromotionRecord;
  readonly locale: Locale;
  readonly timeZone: string | null;
  readonly administer: boolean;
  readonly publisher: boolean;
  readonly copy: AdminMigrationCopy;
}) {
  const { t } = copy;
  const withdrawable =
    promotion.state === 'draft' ||
    promotion.state === 'approved' ||
    promotion.state === 'promoting';
  return (
    <Panel as="li">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <PromotionStateBadge state={promotion.state} copy={copy} />
          <span className="text-sm">
            {t('promotions.progress', {
              promoted: promotion.promotedCount,
              total: promotion.entryCount,
            })}
          </span>
        </div>
        <p className="text-sm">
          {t('promotions.created')}{' '}
          <MigrationTime
            value={promotion.createdAt}
            locale={locale}
            timeZone={timeZone}
          />
          {' · '}
          <Code>{promotion.id}</Code>
        </p>
        <div className="flex flex-wrap gap-3">
          {publisher && promotion.state === 'draft' ? (
            <ActionForm
              action={approvePromotionAction}
              submitLabel={t('promotions.approve')}
              pendingLabel={t('pending')}
              messages={{ ...copy.messages, success: t('promotions.approved') }}
            >
              <RowIdentity locale={locale} row={promotion} />
              <ConfirmField
                id={`promotion-${promotion.id}-confirm`}
                label={t('promotions.confirmApprove')}
              />
            </ActionForm>
          ) : null}
          {administer && withdrawable ? (
            <ActionForm
              action={withdrawPromotionAction}
              submitLabel={t('promotions.withdraw')}
              pendingLabel={t('pending')}
              tone="secondary"
              messages={copy.messages}
            >
              <RowIdentity locale={locale} row={promotion} />
            </ActionForm>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
