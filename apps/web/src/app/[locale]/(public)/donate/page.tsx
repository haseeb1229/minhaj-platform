import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { CampaignWords, TestEnvironmentBanner } from '@/components/donations/parts';
import { isTestEnvironment, myDonationsPath } from '@/components/donations/presentation';
import { readDonatePage } from '@/components/donations/public-read';
import { DonationStartForm } from '@/components/donations/start-form';
import {
  Alert,
  Container,
  EmptyState,
  PageHeading,
  Panel,
  Prose,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { shellMetadata } from '@/seo/metadata';
import { requireRoute } from '@/shell/registry';
import { startDonation } from './actions';

/**
 * `/{locale}/donate` — giving to the organisation's published campaigns
 * (DELIVERY_PLAN.md Phase 27; DOMAIN_MODEL.md §17.3).
 *
 * WHAT HAPPENS IS SAID BEFORE IT HAPPENS. The page explains that payment is
 * taken on the payment provider's own secure page, that no card or bank
 * detail is ever entered here, that the status shown afterwards comes from
 * the provider, and that a gift can be kept in an account by starting it from
 * My donations. It makes no claim about how a gift is treated beyond being
 * received — none about tax, reliefs or religious obligations.
 *
 * HONEST AVAILABILITY. Online giving is open only while a provider is
 * configured AND its activation is recorded; otherwise the page says so in
 * words and offers no form — the campaigns are still described, never a
 * button that cannot work. While the provider is a test environment (the
 * fixture simulator or a sandbox) a banner says no real money moves, and the
 * page is `noindex`.
 *
 * SESSION-FREE. `readDonatePage()` reaches the public Donations root, which
 * reaches no Identity and no request; the page renders identically signed in
 * or out. `force-dynamic` because operators publish and archive campaigns and
 * activation is runtime state; there is no per-campaign address, no sitemap
 * segment beyond this page and no structured data.
 */
export const dynamic = 'force-dynamic';

interface DonateParams {
  readonly params: Promise<{ readonly locale: string }>;
}

export async function generateMetadata({ params }: DonateParams): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'donations' });
  const { availability } = await readDonatePage();
  // A test environment is never indexable, whatever the deployment allows —
  // and claims no canonical or alternates, because it has nothing to claim.
  if (availability.available && isTestEnvironment(availability.environment))
    return {
      title: t('title'),
      description: t('description'),
      robots: { index: false, follow: false },
    };
  return shellMetadata({
    locale,
    route: requireRoute('donate'),
    title: t('title'),
    description: t('description'),
  });
}

const HOW = ['provider', 'noDetails', 'status', 'account'] as const;

export default async function DonatePage({ params }: DonateParams) {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'donations' });
  const { availability, campaigns } = await readDonatePage();

  return (
    <Container>
      <div className="flex min-w-0 flex-col gap-10 py-12">
        {availability.available ? (
          <TestEnvironmentBanner environment={availability.environment} t={t} />
        ) : null}

        <Prose>
          <PageHeading>{t('title')}</PageHeading>
          <p>{t('intro')}</p>
        </Prose>

        <section
          className="flex max-w-[var(--measure-prose)] flex-col gap-3"
          aria-labelledby="donate-how"
        >
          <SectionHeading>
            <span id="donate-how">{t('how.heading')}</span>
          </SectionHeading>
          <ul className="flex list-disc flex-col gap-2 ps-5 text-sm">
            {HOW.map((item) => (
              <li key={item}>{t(`how.${item}`)}</li>
            ))}
          </ul>
        </section>

        {availability.available ? null : <Alert tone="info">{t('unavailable')}</Alert>}

        <section className="flex flex-col gap-4" aria-labelledby="donate-campaigns">
          <SectionHeading>
            <span id="donate-campaigns">{t('campaigns.heading')}</span>
          </SectionHeading>
          {campaigns.length === 0 ? (
            <EmptyState>{t('campaigns.empty')}</EmptyState>
          ) : (
            <ul className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {campaigns.map((campaign) => (
                <Panel key={campaign.id} as="li">
                  {/* A long unbroken operator title must break inside the
                      panel rather than widen a 320px screen. */}
                  <div className="flex min-w-0 flex-col gap-4 wrap-anywhere">
                    <CampaignWords campaign={campaign} locale={locale} t={t} />
                    {!availability.available ? (
                      <p className="text-sm font-medium">{t('campaigns.closed')}</p>
                    ) : campaign.currencies.length === 0 ? (
                      <p className="text-sm font-medium">{t('campaigns.noCurrency')}</p>
                    ) : (
                      <DonationStartForm
                        campaign={campaign}
                        locale={locale}
                        action={startDonation}
                        t={t}
                      />
                    )}
                  </div>
                </Panel>
              ))}
            </ul>
          )}
        </section>

        <section
          className="flex max-w-[var(--measure-prose)] flex-col gap-3"
          aria-labelledby="donate-account"
        >
          <SectionHeading>
            <span id="donate-account">{t('account.heading')}</span>
          </SectionHeading>
          <p className="text-sm">{t('account.body')}</p>
          <p>
            <TextLink href={myDonationsPath(locale)}>{t('account.link')}</TextLink>
          </p>
        </section>
      </div>
    </Container>
  );
}
