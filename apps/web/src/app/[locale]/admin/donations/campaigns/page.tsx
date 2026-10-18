import { notFound } from 'next/navigation';

import { localeSchema, type Locale } from '@minhaj/contracts';
import { DONATION_LIMITS } from '@minhaj/contracts/donations';

import { CampaignTitle } from '@/components/donations/parts';
import { adminDonationsPath } from '@/components/donations/presentation';
import { donationsRead } from '@/components/donations/read';
import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  Select,
  StatusBadge,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { donationsRuntime } from '@/composition/donations';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { createCampaignAction } from '../actions';
import { adminDonationsCopy, type AdminDonationsCopy } from '../shared';

/**
 * `/{locale}/admin/donations/campaigns` — every campaign, any state
 * (DELIVERY_PLAN.md Phase 27) — under `donations.read`; creating one
 * re-checks `donations.administer`.
 *
 * Drafts, published and archived campaigns are listed in display order with
 * the currencies each offers; each opens its own editor — its words in every
 * interface locale, its currency policies in exact decimal text, its position
 * and its lifecycle. Only a published campaign is public and takes gifts, and
 * only with its primary locale's words and at least one currency; a campaign
 * that has been public never returns to draft.
 *
 * NO CAMPAIGN HAS A PUBLIC ADDRESS OF ITS OWN. Every published campaign is on
 * `/donate`; there is no per-campaign route, sitemap entry or search result.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

export default async function DonationCampaignsPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const base = `${adminDonationsPath(locale)}/campaigns`;
  const context = await requireAdminPage(locale, 'donations.read', base);
  const copy = await adminDonationsCopy(locale);
  const { t, d } = copy;
  const administer = context.authorization.can('donations.administer');

  const campaigns = await donationsRead('donations-admin-campaigns', () =>
    donationsRuntime().admin.campaigns({ accountId: context.session.account.id }),
  );
  if (!campaigns.ok && campaigns.failure === 'denied') notFound();

  return (
    <main className="flex min-w-0 flex-col gap-8">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('campaigns.title')}</PageHeading>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('campaigns.description')}
        </p>
      </header>

      <section className="flex flex-col gap-3" aria-labelledby="donation-campaigns">
        <SectionHeading>
          <span id="donation-campaigns">{t('campaigns.heading')}</span>
        </SectionHeading>
        {!campaigns.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : campaigns.value.length === 0 ? (
          <EmptyState>{t('campaigns.empty')}</EmptyState>
        ) : (
          <DataTable
            caption={t('campaigns.caption')}
            columns={[
              t('campaigns.column.title'),
              t('campaigns.column.state'),
              t('campaigns.column.order'),
              t('campaigns.column.currencies'),
            ]}
          >
            {campaigns.value.map((campaign) => (
              <DataRow key={campaign.id}>
                <DataCell wrap>
                  <TextLink href={`${base}/${encodeURIComponent(campaign.id)}`}>
                    <CampaignTitle campaign={campaign} locale={locale} t={d} />
                  </TextLink>
                </DataCell>
                <DataCell>
                  <StatusBadge
                    tone={campaign.state === 'published' ? 'positive' : 'neutral'}
                  >
                    {t(`campaignState.${campaign.state}`)}
                  </StatusBadge>
                </DataCell>
                <DataCell>{campaign.displayOrder}</DataCell>
                <DataCell wrap>
                  {campaign.currencies.length === 0
                    ? t('campaigns.noCurrencies')
                    : campaign.currencies.map((policy) => policy.currency).join(', ')}
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
      </section>

      {administer && campaigns.ok ? <CreateCampaign locale={locale} copy={copy} /> : null}
    </main>
  );
}

function CreateCampaign({
  locale,
  copy,
}: {
  readonly locale: Locale;
  readonly copy: AdminDonationsCopy;
}) {
  const { t } = copy;
  return (
    <section className="flex flex-col gap-3" aria-labelledby="donation-campaign-create">
      <SectionHeading>
        <span id="donation-campaign-create">{t('create.heading')}</span>
      </SectionHeading>
      <p className="text-sm text-[color:var(--color-foreground-muted)]">
        {t('create.help')}
      </p>
      <Panel>
        <ActionForm
          action={createCampaignAction}
          submitLabel={t('create.submit')}
          pendingLabel={t('pending')}
          messages={copy.messages}
          preserveInput
        >
          <input type="hidden" name="locale" value={locale} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              id="create-primary"
              label={t('fields.primaryLocale')}
              help={t('fields.primaryLocaleHelp')}
            >
              {(props) => (
                <Select {...props} name="primaryLocale" defaultValue={locale}>
                  {localeSchema.options.map((option) => (
                    <option key={option} value={option}>
                      {t(`localeName.${option}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field
              id="create-order"
              label={t('fields.displayOrder')}
              help={t('fields.displayOrderHelp')}
            >
              {(props) => (
                <TextInput
                  {...props}
                  name="displayOrder"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={DONATION_LIMITS.displayOrder}
                  required
                  defaultValue={0}
                />
              )}
            </Field>
          </div>
        </ActionForm>
      </Panel>
    </section>
  );
}
