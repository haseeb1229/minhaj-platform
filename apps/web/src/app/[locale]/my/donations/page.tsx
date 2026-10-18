import { getTranslations } from 'next-intl/server';

import {
  CampaignTitle,
  CampaignWords,
  DonationStateBadge,
  DonationTime,
  EnvironmentBadge,
  Money,
  TestEnvironmentBanner,
} from '@/components/donations/parts';
import { donatePath } from '@/components/donations/presentation';
import { readDonatePage } from '@/components/donations/public-read';
import { donationsRead } from '@/components/donations/read';
import { DonationStartForm } from '@/components/donations/start-form';
import { PersonalFrame, PersonalLinks } from '@/components/personal/parts';
import { Alert, DetailRow, EmptyState, Panel, SectionHeading } from '@/components/ui';
import { donationsRuntime } from '@/composition/donations';
import { requireLocale } from '@/config/route-locale';
import { requireActiveSession } from '../guard';
import { startOwnDonation } from './actions';

/**
 * My donations — the signed-in account's own donations, and giving linked to
 * it (DELIVERY_PLAN.md Phase 27; DOMAIN_MODEL.md §17.3).
 *
 * THE ACCOUNT IS THE SESSION'S. Every row is a donation this account started
 * while signed in; the adapter keys the read by the account, so nothing an
 * address names widens it. A gift given anonymously is not here and never
 * becomes linked afterwards — its status lives behind its own token.
 *
 * WHAT IS SHOWN IS THE PROVIDER'S TRUTH. Each donation's state, its exact
 * amount and any refund are what the payment provider reported
 * server-to-server; a test-environment donation is marked so in words.
 *
 * GIVING FROM HERE LINKS THE GIFT to this account, so it appears in this
 * history and its payment acknowledgement is mailed to the account's
 * address. The form is the same as on `/donate` — no payment details are
 * ever entered on this site.
 *
 * BOUNDED (newest first, at most `OWN_DONATION_HISTORY`), `noindex`, and
 * rendered per request.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function MyDonationsPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const path = `/${locale}/my/donations`;
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'myDonations' });
  const d = await getTranslations({ locale, namespace: 'donations' });
  const timeZone = session.account.timezone;

  const history = await donationsRead('donations-my-history', () =>
    donationsRuntime().owner.history({ accountId: session.account.id }),
  );
  const giving = await donationsRead('donations-my-giving', () => readDonatePage());

  const back = (
    <PersonalLinks
      label={t('nav.label')}
      links={[
        { href: donatePath(locale), text: t('nav.public') },
        { href: `/${locale}/my`, text: t('nav.account') },
      ]}
    />
  );
  const description = (
    <>
      <p>{t('description')}</p>
      <p className="text-sm">{t('providerNotice')}</p>
    </>
  );

  return (
    <PersonalFrame title={t('title')} description={description} back={back}>
      {giving.ok && giving.value.availability.available ? (
        <TestEnvironmentBanner
          environment={giving.value.availability.environment}
          t={d}
        />
      ) : null}

      {/* ---- History ------------------------------------------------------ */}

      <section className="flex flex-col gap-3" aria-labelledby="donations-history">
        <span id="donations-history">
          <SectionHeading>{t('history.heading')}</SectionHeading>
        </span>
        {!history.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : history.value.length === 0 ? (
          <EmptyState>{t('history.empty')}</EmptyState>
        ) : (
          <ul aria-label={t('history.heading')} className="flex flex-col gap-3">
            {history.value.map((entry) => (
              <Panel key={entry.id} as="li">
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <DonationStateBadge state={entry.state} t={d} />
                    <EnvironmentBadge environment={entry.environment} t={d} />
                  </div>
                  <p className="font-semibold">
                    <CampaignTitle campaign={entry.campaign} locale={locale} t={d} />
                  </p>
                  <dl className="divide-y divide-[color:var(--color-border)]">
                    <DetailRow term={d('detail.amount')}>
                      <Money money={entry.expected} locale={locale} />
                    </DetailRow>
                    {entry.refundedMinor > 0n ? (
                      <DetailRow term={d('detail.refunded')}>
                        <Money
                          money={{
                            currency: entry.expected.currency,
                            minor: entry.refundedMinor,
                          }}
                          locale={locale}
                        />
                      </DetailRow>
                    ) : null}
                    <DetailRow term={d('detail.started')}>
                      <DonationTime
                        value={entry.createdAt}
                        locale={locale}
                        timeZone={timeZone}
                      />
                    </DetailRow>
                    {entry.succeededAt === null ? null : (
                      <DetailRow term={d('detail.succeeded')}>
                        <DonationTime
                          value={entry.succeededAt}
                          locale={locale}
                          timeZone={timeZone}
                        />
                      </DetailRow>
                    )}
                    <DetailRow term={d('detail.updated')}>
                      <DonationTime
                        value={entry.updatedAt}
                        locale={locale}
                        timeZone={timeZone}
                      />
                    </DetailRow>
                  </dl>
                </div>
              </Panel>
            ))}
          </ul>
        )}
      </section>

      {/* ---- Give, linked ------------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="donations-give">
        <span id="donations-give">
          <SectionHeading>{t('give.heading')}</SectionHeading>
        </span>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('give.help')}
        </p>
        {!giving.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : !giving.value.availability.available ? (
          <Alert tone="info">{d('unavailable')}</Alert>
        ) : giving.value.campaigns.length === 0 ? (
          <EmptyState>{d('campaigns.empty')}</EmptyState>
        ) : (
          <ul aria-label={t('give.heading')} className="flex flex-col gap-3">
            {giving.value.campaigns.map((campaign) => (
              <Panel key={campaign.id} as="li">
                <div className="flex min-w-0 flex-col gap-4 wrap-anywhere">
                  <CampaignWords campaign={campaign} locale={locale} t={d} />
                  {campaign.currencies.length === 0 ? (
                    <p className="text-sm font-medium">{d('campaigns.noCurrency')}</p>
                  ) : (
                    <DonationStartForm
                      campaign={campaign}
                      locale={locale}
                      action={startOwnDonation}
                      t={d}
                    />
                  )}
                </div>
              </Panel>
            ))}
          </ul>
        )}
      </section>
    </PersonalFrame>
  );
}
