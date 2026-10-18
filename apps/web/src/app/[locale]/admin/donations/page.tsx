import { notFound } from 'next/navigation';

import type { Locale } from '@minhaj/contracts';
import {
  DONATION_PAGE,
  DONATION_STATES,
  PAYMENT_ENVIRONMENTS,
  type DonationCampaignRecord,
  type DonationQuery,
} from '@minhaj/contracts/donations';

import {
  CampaignTitle,
  DonationStateBadge,
  DonationTime,
  EnvironmentBadge,
  Money,
} from '@/components/donations/parts';
import {
  adminDonationsPath,
  attentionKey,
  campaignWords,
  donationQueryParams,
  readDonationQuery,
  stateKey,
  withQuery,
} from '@/components/donations/presentation';
import { donationsRead } from '@/components/donations/read';
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
import { donationsRuntime } from '@/composition/donations';
import { requireLocale } from '@/config/route-locale';
import { pageOffset } from '../shared';
import { Pager, adminDonationsCopy, type AdminDonationsCopy, type Query } from './shared';

/**
 * `/{locale}/admin/donations` — the donation records (DELIVERY_PLAN.md
 * Phase 27) — under `donations.read`, re-checked live by the service.
 *
 * EVERY LISTING IS AN AUDITED ACCESS, bounded and paged, newest first, and
 * filtered by state, campaign, environment, linked or anonymous, and whether
 * a person's attention is needed. A filter a URL names that does not parse is
 * a 404, never a quietly broadened list. The filter form is a plain GET, so
 * it works without JavaScript and its address can be shared between
 * operators.
 *
 * WHAT A ROW SAYS: the campaign, the exact amount, the state in words, the
 * environment when it is not production, whether a person must look, and
 * when it began. A donor is `linked` or `anonymous` — never a name, an
 * address or an account. The full record, with its refunds, is one click away
 * and is itself an audited access.
 *
 * THE CSV EXPORT carries the same filters, from its own private route.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function DonationsAdminPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Query>;
}) {
  const locale = await requireLocale(params);
  const base = adminDonationsPath(locale);
  const context = await requireAdminPage(locale, 'donations.read', base);
  const copy = await adminDonationsCopy(locale);
  const { t, d } = copy;
  const offset = pageOffset(await searchParams, DONATION_PAGE);
  const query = readDonationQuery(await searchParams, offset);
  if (query === null) notFound();
  const actor = { accountId: context.session.account.id };
  const timeZone = context.session.account.timezone;
  const { admin } = donationsRuntime();

  const campaigns = await donationsRead('donations-admin-campaign-names', () =>
    admin.campaigns(actor),
  );
  if (!campaigns.ok && campaigns.failure === 'denied') notFound();
  const listing = await donationsRead('donations-admin-records', () =>
    admin.donations(actor, query),
  );
  if (!listing.ok && listing.failure === 'denied') notFound();

  const filters = donationQueryParams(query);
  const pageHref = (page: number) =>
    withQuery(base, { ...filters, page: page > 1 ? String(page) : null });
  const exportHref = withQuery('/api/admin/donations/export', filters);

  return (
    <main className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('records.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('records.description')}
        </p>
        <Alert tone="info">{t('records.audited')}</Alert>
      </header>

      <Filters
        query={query}
        campaigns={campaigns.ok ? campaigns.value : []}
        locale={locale}
        base={base}
        copy={copy}
      />

      <section className="flex flex-col gap-3" aria-labelledby="donations-records">
        <SectionHeading>
          <span id="donations-records">{t('records.heading')}</span>
        </SectionHeading>
        <p className="text-sm">
          <TextLink href={exportHref}>{t('records.export')}</TextLink>
        </p>
        <p className="text-xs text-[color:var(--color-foreground-muted)]">
          {t('records.exportHelp')}
        </p>
        {!listing.ok ? (
          <Alert tone="error">
            {listing.failure === 'invalid' ? t('beyond') : t('failure.load')}
          </Alert>
        ) : listing.value.rows.length === 0 ? (
          <EmptyState>{offset === 0 ? t('records.empty') : t('beyond')}</EmptyState>
        ) : (
          <DataTable
            caption={t('records.caption', { total: listing.value.total })}
            columns={[
              t('records.column.started'),
              t('records.column.campaign'),
              t('records.column.amount'),
              t('records.column.state'),
              t('records.column.donor'),
              t('records.column.attention'),
            ]}
          >
            {listing.value.rows.map((row) => (
              <DataRow key={row.id}>
                <DataCell>
                  <TextLink href={`${base}/${encodeURIComponent(row.id)}`}>
                    <DonationTime
                      value={row.createdAt}
                      locale={locale}
                      timeZone={timeZone}
                    />
                  </TextLink>
                </DataCell>
                <DataCell wrap>
                  <CampaignTitle campaign={row.campaign} locale={locale} t={d} />
                </DataCell>
                <DataCell>
                  <Money money={row.expected} locale={locale} />
                </DataCell>
                <DataCell>
                  <span className="flex flex-wrap gap-1">
                    <DonationStateBadge state={row.state} t={d} />
                    <EnvironmentBadge environment={row.scope.environment} t={d} />
                  </span>
                </DataCell>
                <DataCell>
                  {row.linked ? t('donor.linked') : t('donor.anonymous')}
                </DataCell>
                <DataCell wrap>
                  {row.attention === null
                    ? t('attention.none')
                    : t(`attention.${attentionKey(row.attention)}`)}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
        {listing.ok ? (
          <Pager
            offset={offset}
            total={listing.value.total}
            hrefFor={pageHref}
            label={t('records.pages')}
            copy={copy}
          />
        ) : null}
      </section>
    </main>
  );
}

/* ===========================================================================
 * Filters — a plain GET form
 * ========================================================================= */

function Filters({
  query,
  campaigns,
  locale,
  base,
  copy,
}: {
  readonly query: DonationQuery;
  readonly campaigns: readonly DonationCampaignRecord[];
  readonly locale: Locale;
  readonly base: string;
  readonly copy: AdminDonationsCopy;
}) {
  const { t, d } = copy;
  return (
    <Panel>
      <form method="get" action={base} className="flex flex-col gap-4">
        <SectionHeading>{t('filter.heading')}</SectionHeading>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field id="filter-state" label={t('filter.state')}>
            {(props) => (
              <Select {...props} name="state" defaultValue={query.state ?? ''}>
                <option value="">{t('filter.any')}</option>
                {DONATION_STATES.map((state) => (
                  <option key={state} value={state}>
                    {d(`state.${stateKey(state)}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="filter-campaign" label={t('filter.campaign')}>
            {(props) => (
              <Select {...props} name="campaign" defaultValue={query.campaignId ?? ''}>
                <option value="">{t('filter.any')}</option>
                {campaigns.map((campaign) => (
                  <option key={campaign.id} value={campaign.id}>
                    {campaignWords(campaign, locale)?.title ?? t('campaign.untitled')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="filter-environment" label={t('filter.environment')}>
            {(props) => (
              <Select
                {...props}
                name="environment"
                defaultValue={query.environment ?? ''}
              >
                <option value="">{t('filter.any')}</option>
                {PAYMENT_ENVIRONMENTS.map((environment) => (
                  <option key={environment} value={environment}>
                    {d(`environment.${environment}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="filter-donor" label={t('filter.donor')}>
            {(props) => (
              <Select {...props} name="donor" defaultValue={query.donor ?? ''}>
                <option value="">{t('filter.any')}</option>
                <option value="linked">{t('donor.linked')}</option>
                <option value="anonymous">{t('donor.anonymous')}</option>
              </Select>
            )}
          </Field>
          <Field id="filter-attention" label={t('filter.attention')}>
            {(props) => (
              <Select
                {...props}
                name="attention"
                defaultValue={query.attention ? '1' : ''}
              >
                <option value="">{t('filter.any')}</option>
                <option value="1">{t('filter.attentionOnly')}</option>
              </Select>
            )}
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <Button tone="secondary">{t('filter.apply')}</Button>
          <TextLink href={base}>{t('filter.clear')}</TextLink>
        </div>
      </form>
    </Panel>
  );
}
