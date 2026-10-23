import { notFound } from 'next/navigation';

import { REVIEW_STATES } from '@minhaj/contracts/migration';

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
  TextInput,
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
  vocabularyOf,
  withQuery,
  type Query,
} from '../shared';
import { PersonalDataBadge, ReviewBadge, ValidationBadge } from '../status';

/**
 * `/{locale}/admin/migration/staging` — the review queue under
 * `migration.read`, newest first, filtered by review state and run.
 *
 * A ROW NEVER CARRIES A BODY. It names the revision by its title — as text —
 * with its language, validation, personal-data flag and review state; the
 * sanitised payload, its links and its raw evidence are on the record's own
 * page, one click away. A filter the address names that does not parse is a
 * 404, never a quietly broadened list.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function MigrationStagingPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const base = migrationPath(locale, '/staging');
  const context = await requireAdminPage(locale, 'migration.read', base);
  const query = await searchParams;
  const offset = offsetOf(query);
  const review = vocabularyOf(query, 'review', REVIEW_STATES);
  const runId = idOf(query, 'run');
  if (offset === null || review === undefined || runId === undefined) notFound();
  const copy = await adminMigrationCopy(locale);
  const { t } = copy;
  const timeZone = context.session.account.timezone;

  const listing = await migrationRead('migration-admin-staged', () =>
    migrationRuntime().read.staged(actorOf(context), { review, runId, offset }),
  );
  if (!listing.ok && listing.failure === 'denied') notFound();

  return (
    <main className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('staging.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('staging.description')}
        </p>
      </header>

      <Panel>
        <form method="get" action={base} className="flex flex-col gap-4">
          <SectionHeading>{t('filter.heading')}</SectionHeading>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="staging-review" label={t('filter.review')}>
              {(props) => (
                <Select {...props} name="review" defaultValue={review ?? ''}>
                  <option value="">{t('filter.any')}</option>
                  {REVIEW_STATES.map((state) => (
                    <option key={state} value={state}>
                      {t(`reviewState.${state}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field id="staging-run" label={t('filter.run')} help={t('filter.runHelp')}>
              {(props) => (
                <TextInput
                  {...props}
                  name="run"
                  dir="ltr"
                  maxLength={36}
                  autoComplete="off"
                  spellCheck={false}
                  defaultValue={runId ?? ''}
                />
              )}
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Button tone="secondary">{t('filter.apply')}</Button>
            <TextLink href={base}>{t('filter.clear')}</TextLink>
          </div>
        </form>
      </Panel>

      <section className="flex flex-col gap-3" aria-labelledby="migration-staged">
        <SectionHeading>
          <span id="migration-staged">{t('staging.heading')}</span>
        </SectionHeading>
        {!listing.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : listing.value.rows.length === 0 ? (
          <EmptyState>{offset === 0 ? t('staging.empty') : t('beyond')}</EmptyState>
        ) : (
          <DataTable
            caption={t('staging.caption', { total: listing.value.total })}
            columns={[
              t('staging.column.title'),
              t('staging.column.language'),
              t('staging.column.validation'),
              t('staging.column.personalData'),
              t('staging.column.review'),
              t('staging.column.produced'),
            ]}
          >
            {listing.value.rows.map((row) => (
              <DataRow key={row.id}>
                <DataCell wrap>
                  <TextLink href={`${base}/${encodeURIComponent(row.id)}`}>
                    <bdi>{row.title}</bdi>
                  </TextLink>
                  <span className="block text-xs text-[color:var(--color-foreground-muted)]">
                    {t('staging.revision', { revision: row.revision })}
                  </span>
                </DataCell>
                <DataCell>
                  {row.languageCode === null ? (
                    t('none')
                  ) : (
                    <Code>{row.languageCode}</Code>
                  )}
                </DataCell>
                <DataCell>
                  <ValidationBadge state={row.validation} copy={copy} />
                </DataCell>
                <DataCell>
                  <PersonalDataBadge state={row.personalData} copy={copy} />
                </DataCell>
                <DataCell>
                  <ReviewBadge state={row.review} copy={copy} />
                </DataCell>
                <DataCell>
                  <MigrationTime
                    value={row.producedAt}
                    locale={locale}
                    timeZone={timeZone}
                  />
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
              withQuery(base, {
                review,
                run: runId,
                page: page > 1 ? String(page) : null,
              })
            }
            label={t('staging.pages')}
            copy={copy}
          />
        ) : null}
      </section>
    </main>
  );
}
