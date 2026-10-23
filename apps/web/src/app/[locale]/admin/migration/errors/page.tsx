import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  DISAPPEARANCE_CLASSES,
  ERROR_RESOLUTIONS,
  type ErrorRow,
  type MissingRecordRow,
} from '@minhaj/contracts/migration';

import {
  Alert,
  DetailRow,
  EmptyState,
  Field,
  FilterLink,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  TextArea,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { migrationRuntime } from '@/composition/migration';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { disappearanceAction, errorAction } from '../actions';
import {
  Code,
  MIGRATION_PAGE,
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
import { ErrorResolutionBadge } from '../status';

/**
 * `/{locale}/admin/migration/errors` — import errors and missing records,
 * under `migration.read`; deciding either re-checks `migration.administer`,
 * at the version shown.
 *
 * AN ERROR SAYS WHAT HAPPENED, never a body or a header value. Only a
 * retry-eligible error (a network failure, a timeout, a rate limit, a server
 * error) is offered a retry; an access failure is never retried — it is not
 * something to work around — and the service and the database refuse one.
 *
 * ABSENCE IS NEVER DELETION. A record a complete discovery did not see is
 * marked missing — an observation. Classifying it records why, and deletes,
 * unpublishes and redirects nothing.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function MigrationErrorsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const base = migrationPath(locale, '/errors');
  const context = await requireAdminPage(locale, 'migration.read', base);
  const query = await searchParams;
  // Open errors first: the address with no filter names the work to do.
  const named = vocabularyOf(query, 'resolution', [...ERROR_RESOLUTIONS, 'all'] as const);
  const runId = idOf(query, 'run');
  const errorOffset = offsetOf(query);
  const missingOffset = offsetOf(query, 'mpage');
  if (
    named === undefined ||
    runId === undefined ||
    errorOffset === null ||
    missingOffset === null
  )
    notFound();
  const resolution = named === null ? 'open' : named === 'all' ? null : named;
  const copy = await adminMigrationCopy(locale);
  const { t } = copy;
  const actor = actorOf(context);
  const timeZone = context.session.account.timezone;
  const administer = context.authorization.can('migration.administer');
  const { read } = migrationRuntime();

  const [errors, missing] = await Promise.all([
    migrationRead('migration-admin-errors', () =>
      read.errors(actor, { resolution, runId, offset: errorOffset }),
    ),
    migrationRead('migration-admin-missing', () =>
      read.missingRecords(actor, { offset: missingOffset }),
    ),
  ]);
  if (
    (!errors.ok && errors.failure === 'denied') ||
    (!missing.ok && missing.failure === 'denied')
  )
    notFound();

  const current = {
    resolution: named,
    run: runId,
    page: errorOffset > 0 ? String(errorOffset / MIGRATION_PAGE + 1) : null,
    mpage: missingOffset > 0 ? String(missingOffset / MIGRATION_PAGE + 1) : null,
  };
  const href = (change: Readonly<Record<string, string | null>>) =>
    withQuery(base, { ...current, ...change });

  return (
    <main className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('errors.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('errors.description')}
        </p>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="migration-errors">
        <SectionHeading>
          <span id="migration-errors">{t('errors.heading')}</span>
        </SectionHeading>
        <nav aria-label={t('filter.resolution')} className="flex flex-wrap gap-2">
          {ERROR_RESOLUTIONS.map((value) => (
            <FilterLink
              key={value}
              href={href({ resolution: value === 'open' ? null : value, page: null })}
              current={resolution === value}
            >
              {t(`errorResolution.${value}`)}
            </FilterLink>
          ))}
          <FilterLink
            href={href({ resolution: 'all', page: null })}
            current={resolution === null}
          >
            {t('filter.any')}
          </FilterLink>
        </nav>
        {runId === null ? null : (
          <p className="text-sm">
            {t('errors.forRun')} <Code>{runId}</Code> ·{' '}
            <TextLink href={href({ run: null, page: null })}>
              {t('filter.clear')}
            </TextLink>
          </p>
        )}
        {!errors.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : errors.value.rows.length === 0 ? (
          <EmptyState>{errorOffset === 0 ? t('errors.empty') : t('beyond')}</EmptyState>
        ) : (
          <>
            <p className="text-sm">
              {t('errors.caption', { total: errors.value.total })}
            </p>
            <ul className="flex flex-col gap-3" aria-label={t('errors.heading')}>
              {errors.value.rows.map((row) => (
                <ErrorItem
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
        {errors.ok ? (
          <Pager
            offset={errorOffset}
            total={errors.value.total}
            hrefFor={(page) => href({ page: page > 1 ? String(page) : null })}
            label={t('errors.pages')}
            copy={copy}
          />
        ) : null}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="migration-missing">
        <SectionHeading>
          <span id="migration-missing">{t('missing.heading')}</span>
        </SectionHeading>
        <Alert tone="info">{t('missing.absenceIsNotDeletion')}</Alert>
        {!missing.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : missing.value.rows.length === 0 ? (
          <EmptyState>
            {missingOffset === 0 ? t('missing.empty') : t('beyond')}
          </EmptyState>
        ) : (
          <ul className="flex flex-col gap-3" aria-label={t('missing.heading')}>
            {missing.value.rows.map((row) => (
              <MissingItem
                key={row.id}
                row={row}
                locale={locale}
                administer={administer}
                copy={copy}
              />
            ))}
          </ul>
        )}
        {missing.ok ? (
          <Pager
            offset={missingOffset}
            total={missing.value.total}
            hrefFor={(page) => href({ mpage: page > 1 ? String(page) : null })}
            label={t('missing.pages')}
            copy={copy}
          />
        ) : null}
      </section>
    </main>
  );
}

function ErrorItem({
  row,
  locale,
  timeZone,
  administer,
  copy,
}: {
  readonly row: ErrorRow;
  readonly locale: Locale;
  readonly timeZone: string | null;
  readonly administer: boolean;
  readonly copy: AdminMigrationCopy;
}) {
  const { t } = copy;
  const open = row.resolution === 'open';
  return (
    <Panel as="li">
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ErrorResolutionBadge state={row.resolution} copy={copy} />
          <span className="font-medium">
            {t(`errorClassification.${row.classification}`)}
          </span>
          <span className="text-sm">{t(`errorStage.${row.stage}`)}</span>
        </div>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('errors.occurred')}>
            <MigrationTime value={row.occurredAt} locale={locale} timeZone={timeZone} />
          </DetailRow>
          <DetailRow term={t('errors.run')}>
            <TextLink
              href={migrationPath(locale, `/runs/${encodeURIComponent(row.runId)}`)}
            >
              <Code>{row.runId}</Code>
            </TextLink>
          </DetailRow>
          <DetailRow term={t('errors.attempt')}>{row.attempt}</DetailRow>
          {row.httpStatus === null ? null : (
            <DetailRow term={t('errors.httpStatus')}>{row.httpStatus}</DetailRow>
          )}
          {row.detail === null ? null : (
            <DetailRow term={t('errors.detail')}>
              <bdi>{row.detail}</bdi>
            </DetailRow>
          )}
          <DetailRow term={t('errors.retryEligible')}>
            {row.retryEligible ? t('errors.eligible') : t('errors.notEligible')}
          </DetailRow>
        </dl>
        {administer && open ? (
          <div className="flex flex-wrap gap-3">
            {row.retryEligible ? (
              <ActionForm
                action={errorAction}
                submitLabel={t('errors.retry')}
                pendingLabel={t('pending')}
                messages={{ ...copy.messages, success: t('errors.retried') }}
              >
                <RowIdentity locale={locale} row={row} />
                <input type="hidden" name="decision" value="retry" />
              </ActionForm>
            ) : null}
            <ActionForm
              action={errorAction}
              submitLabel={t('errors.dismiss')}
              pendingLabel={t('pending')}
              tone="secondary"
              messages={copy.messages}
            >
              <RowIdentity locale={locale} row={row} />
              <input type="hidden" name="decision" value="dismiss" />
            </ActionForm>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

function MissingItem({
  row,
  locale,
  administer,
  copy,
}: {
  readonly row: MissingRecordRow;
  readonly locale: Locale;
  readonly administer: boolean;
  readonly copy: AdminMigrationCopy;
}) {
  const { t } = copy;
  return (
    <Panel as="li">
      <div className="flex min-w-0 flex-col gap-3">
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('missing.externalKey')}>
            <Code>{row.externalKey}</Code>
          </DetailRow>
          <DetailRow term={t('missing.source')}>
            <Code>{row.sourceKey}</Code>
          </DetailRow>
          <DetailRow term={t('missing.status')}>
            {t(`recordStatus.${row.status}`)}
          </DetailRow>
          <DetailRow term={t('missing.classification')}>
            {row.disappearance === null
              ? t('missing.unclassified')
              : t(`disappearance.${row.disappearance}`)}
          </DetailRow>
        </dl>
        {administer ? (
          <ActionForm
            action={disappearanceAction}
            submitLabel={t('missing.classify')}
            pendingLabel={t('pending')}
            tone="secondary"
            messages={copy.messages}
          >
            <RowIdentity locale={locale} row={row} />
            <Field id={`missing-${row.id}-class`} label={t('missing.classification')}>
              {(props) => (
                <Select
                  {...props}
                  name="classification"
                  required
                  defaultValue={row.disappearance ?? 'unresolved'}
                >
                  {DISAPPEARANCE_CLASSES.map((value) => (
                    <option key={value} value={value}>
                      {t(`disappearance.${value}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id={`missing-${row.id}-note`} label={t('missing.note')}>
              {(props) => <TextArea {...props} name="note" rows={2} maxLength={500} />}
            </Field>
          </ActionForm>
        ) : null}
      </div>
    </Panel>
  );
}
