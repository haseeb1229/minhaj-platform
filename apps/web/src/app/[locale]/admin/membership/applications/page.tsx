import { notFound } from 'next/navigation';

import {
  APPLICATION_STATUSES,
  MEMBERSHIP_PAGE,
  type ApplicationStatus,
} from '@minhaj/contracts/membership';

import {
  ApplicationStatusBadge,
  MembershipTime,
  TypeTitle,
} from '@/components/membership/parts';
import {
  adminMembershipPath,
  applicationStatusKey,
  readChoice,
  readTypeFilter,
  typeTitleText,
  withQuery,
} from '@/components/membership/presentation';
import { membershipRead } from '@/components/membership/read';
import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Field,
  PageHeading,
  Select,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { membershipRuntime } from '@/composition/membership';
import { requireLocale } from '@/config/route-locale';
import { pageOffset } from '../../shared';
import {
  Pager,
  PersonName,
  adminMembershipCopy,
  personNames,
  type Query,
} from '../shared';

/**
 * `/{locale}/admin/membership/applications` — the application queue
 * (DELIVERY_PLAN.md Phase 26) — under `membership.read`, re-checked live by
 * the service.
 *
 * OLDEST FIRST, BOUNDED. Applications in progress (submitted or under review)
 * are the default view, filtered by status and type through a plain GET form
 * and paged; the listing is an AUDITED access, recorded by the service with
 * the filter and the count, never anybody's name.
 *
 * A NAME, NEVER AN ADDRESS. Each applicant is shown by the display name
 * Identity returns, in one bounded call for the page. Opening an application
 * is a separate, audited act on its own page.
 *
 * A MALFORMED TYPE FILTER NEVER BROADENS: it is explained and nothing is
 * listed. An unknown status is the default view.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

const STATUS_FILTERS = ['open', ...APPLICATION_STATUSES, 'all'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

export default async function MembershipApplicationsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const base = `${adminMembershipPath(locale)}/applications`;
  const context = await requireAdminPage(locale, 'membership.read', base);
  const copy = await adminMembershipCopy(locale);
  const { t, s } = copy;
  const query = await searchParams;
  const status = readChoice<StatusFilter>(query, 'status', STATUS_FILTERS, 'open');
  const type = readTypeFilter(query);
  const offset = pageOffset(query, MEMBERSHIP_PAGE);
  const actor = { accountId: context.session.account.id };
  const timeZone = context.session.account.timezone;
  const { admin } = membershipRuntime();

  const types = await membershipRead('membership-admin-types', () => admin.types(actor));
  if (!types.ok && types.failure === 'denied') notFound();
  const byId = new Map((types.ok ? types.value : []).map((entry) => [entry.id, entry]));

  const listing =
    type.state === 'invalid'
      ? null
      : await membershipRead('membership-admin-applications', () =>
          admin.applications(actor, {
            status: status === 'all' ? null : status,
            membershipTypeId: type.state === 'value' ? type.value : null,
            offset,
          }),
        );
  if (listing !== null && !listing.ok && listing.failure === 'denied') notFound();
  const names =
    listing?.ok === true
      ? await personNames(listing.value.rows.map((row) => row.applicantAccountId))
      : new Map<string, string>();
  const filtered = {
    status: status === 'open' ? null : status,
    type: type.state === 'value' ? type.value : null,
  };
  const statusLabel = (value: StatusFilter) =>
    value === 'open'
      ? t('applications.filterOpen')
      : value === 'all'
        ? t('applications.filterAll')
        : s(`status.application.${applicationStatusKey(value as ApplicationStatus)}`);

  return (
    <main className="flex min-w-0 flex-col gap-4">
      <PageHeading>{t('applications.title')}</PageHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('applications.description')}
      </p>

      <form method="get" action={base} className="flex flex-wrap items-end gap-3">
        <Field id="applications-status" label={t('applications.status')}>
          {(props) => (
            <Select {...props} name="status" defaultValue={status}>
              {STATUS_FILTERS.map((option) => (
                <option key={option} value={option}>
                  {statusLabel(option)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="applications-type" label={t('applications.type')}>
          {(props) => (
            <Select
              {...props}
              name="type"
              defaultValue={type.state === 'value' ? type.value : ''}
            >
              <option value="">{t('applications.allTypes')}</option>
              {[...byId.values()].map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {typeTitleText(entry, locale)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-[color:var(--color-border-strong)] px-4 text-sm font-medium"
        >
          {t('applications.apply')}
        </button>
      </form>

      {listing === null ? (
        <>
          <Alert tone="error">{t('applications.invalidFilter')}</Alert>
          <p>
            <TextLink href={base}>{t('applications.reset')}</TextLink>
          </p>
        </>
      ) : !listing.ok ? (
        <>
          <Alert tone="error">
            {listing.failure === 'invalid' ? t('beyond') : t('failure.load')}
          </Alert>
          <p>
            <TextLink href={base}>{t('applications.reset')}</TextLink>
          </p>
        </>
      ) : listing.value.rows.length === 0 ? (
        <EmptyState>{offset === 0 ? t('applications.empty') : t('beyond')}</EmptyState>
      ) : (
        <DataTable
          caption={t('applications.caption', { status: statusLabel(status) })}
          columns={[
            t('applications.column.applicant'),
            t('applications.column.type'),
            t('applications.column.status'),
            t('applications.column.submitted'),
            t('applications.column.detail'),
          ]}
        >
          {listing.value.rows.map((row) => (
            <DataRow key={row.id}>
              <DataCell wrap>
                <PersonName
                  accountId={row.applicantAccountId}
                  names={names}
                  copy={copy}
                />
              </DataCell>
              <DataCell wrap>
                <TypeTitle type={byId.get(row.membershipTypeId)} locale={locale} t={s} />
              </DataCell>
              <DataCell>
                <ApplicationStatusBadge status={row.status} t={s} />
              </DataCell>
              <DataCell wrap>
                <MembershipTime
                  value={row.submittedAt}
                  locale={locale}
                  timeZone={timeZone}
                />
              </DataCell>
              <DataCell>
                <TextLink href={`${base}/${encodeURIComponent(row.id)}`}>
                  {t('applications.open')}
                </TextLink>
              </DataCell>
            </DataRow>
          ))}
        </DataTable>
      )}

      {listing?.ok === true ? (
        <Pager
          offset={offset}
          total={listing.value.total}
          hrefFor={(page) =>
            withQuery(base, { ...filtered, page: page > 1 ? String(page) : null })
          }
          label={t('applications.pages')}
          copy={copy}
        />
      ) : null}
    </main>
  );
}
