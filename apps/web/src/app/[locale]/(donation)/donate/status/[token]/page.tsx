import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import {
  CampaignTitle,
  DonationStateBadge,
  DonationTime,
  Money,
  TestEnvironmentBanner,
} from '@/components/donations/parts';
import {
  donatePath,
  myDonationsPath,
  readStatusNotice,
  readStatusToken,
  stateKey,
  type Query,
} from '@/components/donations/presentation';
import { donationsRead } from '@/components/donations/read';
import { ConfirmField } from '@/components/personal/parts';
import {
  Alert,
  Container,
  DetailRow,
  PageHeading,
  Panel,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { donationsRuntime } from '@/composition/donations';
import { publicClientAddress } from '@/composition/request-address';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../../(identity)/form-state';
import { cancelDonationAction, checkDonationAction } from './actions';

/**
 * `/{locale}/donate/status/{token}` — one donation's status, for whoever holds
 * its token (DELIVERY_PLAN.md Phase 27).
 *
 * A NARROW BEARER, NOTHING PERSONAL. The token reads ONE donation: its
 * campaign, its exact amount, its state and when it changed — no name, no
 * address, no provider reference, no account. A malformed token and one that
 * names nothing are the same 404. Reading spends a generous per-address
 * budget, so the address space cannot be walked.
 *
 * THE PAGE DOES NOT PROVE PAYMENT, AND SAYS SO. What it shows is what the
 * payment provider reported server-to-server, and it says that in words; a
 * pending donation may be checked again, and a still-open checkout may be
 * abandoned — each a POST, never this GET, which only reads.
 *
 * STATE IS WORDS. Each state is a badge with its word and a shape, and a
 * sentence explaining what it means; never a colour alone.
 *
 * `noindex`, `no-referrer` (the address is the bearer, so it must never leave
 * in a `Referer`), and `private, no-store` from the response headers.
 */
export const metadata: Metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export const dynamic = 'force-dynamic';

interface StatusParams {
  readonly params: Promise<{ readonly locale: string; readonly token: string }>;
  readonly searchParams: Promise<Query>;
}

export default async function DonationStatusPage({ params, searchParams }: StatusParams) {
  const locale = await requireLocale(params);
  const token = readStatusToken((await params).token);
  if (token === null) notFound();
  const t = await getTranslations({ locale, namespace: 'donations' });
  const notice = readStatusNotice(await searchParams);

  const read = await donationsRead('donation-status', async () =>
    donationsRuntime().donor.status(token, await publicClientAddress()),
  );
  if (read.ok && read.value === null) notFound();

  if (!read.ok)
    return (
      <Container>
        <div className="flex min-w-0 flex-col gap-6 py-12">
          <PageHeading>{t('status.title')}</PageHeading>
          <Alert tone="error">
            {read.failure === 'rate-limited'
              ? t('failure.rateLimited')
              : t('failure.load')}
          </Alert>
        </div>
      </Container>
    );

  const view = read.value;
  if (view === null) notFound();
  const messages = {
    'not-found': t('failure.notFound'),
    'confirm-required': t('failure.confirmRequired'),
    'rate-limited': t('failure.rateLimited'),
    'provider-unavailable': t('failure.providerUnavailable'),
    invalid: t('failure.notFound'),
    unavailable: t('failure.unavailable'),
    unknown: t('failure.unavailable'),
  };

  return (
    <Container>
      <div className="flex min-w-0 max-w-[var(--measure-prose)] flex-col gap-6 py-12">
        <TestEnvironmentBanner environment={view.environment} t={t} />

        <header className="flex flex-col gap-2">
          <PageHeading>{t('status.title')}</PageHeading>
          <p className="text-[color:var(--color-foreground-muted)]">
            {t('status.intro')}
          </p>
        </header>

        {notice === null ? null : (
          <Alert tone="info">
            {notice === 'checked' ? t('status.done.checked') : t('status.done.cancel')}
          </Alert>
        )}

        <Panel>
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <DonationStateBadge state={view.state} t={t} />
            </div>
            <p className="text-sm">{t(`stateHelp.${stateKey(view.state)}`)}</p>
            <dl className="divide-y divide-[color:var(--color-border)]">
              <DetailRow term={t('detail.campaign')}>
                <CampaignTitle campaign={view.campaign} locale={locale} t={t} />
              </DetailRow>
              <DetailRow term={t('detail.amount')}>
                <Money money={view.expected} locale={locale} />
              </DetailRow>
              {view.refundedMinor > 0n ? (
                <DetailRow term={t('detail.refunded')}>
                  <Money
                    money={{
                      currency: view.expected.currency,
                      minor: view.refundedMinor,
                    }}
                    locale={locale}
                  />
                </DetailRow>
              ) : null}
              <DetailRow term={t('detail.started')}>
                <DonationTime value={view.createdAt} locale={locale} timeZone={null} />
              </DetailRow>
              <DetailRow term={t('detail.updated')}>
                <DonationTime value={view.updatedAt} locale={locale} timeZone={null} />
              </DetailRow>
            </dl>
          </div>
        </Panel>

        <Alert tone="info">{t('status.notProof')}</Alert>

        {view.state === 'pending' ? (
          <section className="flex flex-col gap-3" aria-labelledby="donation-check">
            <SectionHeading>
              <span id="donation-check">{t('status.check.heading')}</span>
            </SectionHeading>
            <p className="text-sm">{t('status.check.help')}</p>
            <ActionForm
              action={checkDonationAction}
              submitLabel={t('status.check.submit')}
              pendingLabel={t('working')}
              tone="secondary"
              messages={messages}
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="token" value={token} />
            </ActionForm>
          </section>
        ) : null}

        {view.cancellable ? (
          <section className="flex flex-col gap-3" aria-labelledby="donation-cancel">
            <SectionHeading>
              <span id="donation-cancel">{t('status.cancel.heading')}</span>
            </SectionHeading>
            <p className="text-sm">{t('status.cancel.help')}</p>
            <ActionForm
              action={cancelDonationAction}
              submitLabel={t('status.cancel.submit')}
              pendingLabel={t('working')}
              tone="destructive"
              messages={messages}
            >
              <input type="hidden" name="locale" value={locale} />
              <input type="hidden" name="token" value={token} />
              <ConfirmField
                id="donation-cancel-confirm"
                label={t('status.cancel.confirm')}
              />
            </ActionForm>
          </section>
        ) : null}

        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('status.private')}
        </p>

        <nav aria-label={t('status.title')} className="flex flex-wrap gap-x-6 gap-y-2">
          <TextLink href={donatePath(locale)}>{t('status.donate')}</TextLink>
          <TextLink href={myDonationsPath(locale)}>{t('status.mine')}</TextLink>
        </nav>
      </div>
    </Container>
  );
}
