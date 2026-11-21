import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { OWN_DONATION_HISTORY } from '@minhaj/contracts/donations';

import {
  CampaignTitle,
  CampaignWords,
  DonationStateBadge,
  DonationTime,
  EnvironmentBadge,
  Money,
  TestEnvironmentBanner,
} from '@/components/donations/parts';
import {
  DONATION_GROUPS,
  donatePath,
  donationGroup,
  type DonationGroup,
} from '@/components/donations/presentation';
import { readDonatePage } from '@/components/donations/public-read';
import { donationsRead } from '@/components/donations/read';
import { DonationStartForm } from '@/components/donations/start-form';
import { MyPage, MySection, OnwardLink } from '@/components/my/frame';
import {
  MyListBeyond,
  MyListFilters,
  MyListPager,
  MyListRefused,
  MyListStatus,
} from '@/components/my/list-parts';
import {
  MY_LIST_PAGE,
  myListHref,
  myListOffset,
  myListRange,
  readMyList,
  type MyListSpec,
} from '@/components/my/list-view';
import { myPageMetadata } from '@/components/my/metadata';
import { myTrail } from '@/components/my/sections';
import { MyFigures } from '@/components/my/summary-parts';
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
 *
 * MY MINHAJ PART 2: the trail; the donations counted — all, gone through,
 * still with the provider — from the one bounded read (said as "or more" when
 * the read reached its bound); the list filtered by what happened to each gift
 * (`?show=`, `donationGroup`) with counted tabs, "Showing n–m of N" and
 * numbered pages over that same read (`?page=`, one address per view, an
 * unknown view refused in place). Donations owns every word of state; no new
 * read and no new act.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return myPageMetadata(params, 'giving');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function MyDonationsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = localizedPath(locale, '/my/donations');
  const session = await requireActiveSession(locale, path);
  const t = await getTranslations({ locale, namespace: 'myDonations' });
  const d = await getTranslations({ locale, namespace: 'donations' });
  const my = await getTranslations({ locale, namespace: 'my' });
  const timeZone = session.account.timezone;
  const spec: MyListSpec<DonationGroup> = {
    path,
    param: 'show',
    filters: DONATION_GROUPS,
  };
  const asked = readMyList(spec, await searchParams);
  if (asked.outcome === 'redirect') redirect(asked.to);
  const frame = {
    title: t('title'),
    description: (
      <>
        <p>{t('description')}</p>
        <p className="text-sm">{t('providerNotice')}</p>
      </>
    ),
    action: <OnwardLink href={donatePath(locale)}>{t('nav.public')}</OnwardLink>,
    trail: {
      label: my('trail.label'),
      crumbs: myTrail(locale, my('trail.home'), [{ text: my('trail.giving') }]),
    },
  };
  if (asked.outcome === 'refused')
    return (
      <MyPage {...frame}>
        <MyListRefused
          title={my('list.refusedTitle')}
          text={my('list.refused')}
          all={path}
          allText={my('list.all')}
        />
      </MyPage>
    );
  const view = asked.view;

  const history = await donationsRead('donations-my-history', () =>
    donationsRuntime().owner.history({ accountId: session.account.id }),
  );
  const giving = await donationsRead('donations-my-giving', () => readDonatePage());

  const all = history.ok ? history.value : [];
  const bounded = all.length >= OWN_DONATION_HISTORY;
  const number = new Intl.NumberFormat(locale);
  const count = (value: number) =>
    bounded
      ? my('givingPage.orMore', { count: number.format(value) })
      : number.format(value);
  const inGroup = (group: DonationGroup) =>
    all.filter((entry) => donationGroup(entry.state) === group);
  const shown = view.filter === null ? all : inGroup(view.filter);
  const offset = myListOffset(view.page);
  const page = shown.slice(offset, offset + MY_LIST_PAGE);
  const range = myListRange(view.page, page.length);

  return (
    <MyPage {...frame}>
      {giving.ok && giving.value.availability.available ? (
        <TestEnvironmentBanner
          environment={giving.value.availability.environment}
          t={d}
        />
      ) : null}

      {/* ---- History ------------------------------------------------------ */}

      <MySection
        id="donations-history"
        heading={t('history.heading')}
        {...(history.ok && history.value.length > 0
          ? { link: { href: '/api/my/export/donations', text: my('giving.export') } }
          : {})}
      >
        {!history.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : all.length === 0 ? (
          <EmptyState icon="heart">{t('history.empty')}</EmptyState>
        ) : (
          <div className="flex flex-col gap-4">
            <MyFigures
              label={my('givingPage.figures')}
              figures={[
                { key: 'all', value: count(all.length), label: my('givingPage.all') },
                {
                  key: 'completed',
                  value: count(inGroup('completed').length),
                  label: my('givingPage.group.completed'),
                },
                {
                  key: 'pending',
                  value: count(inGroup('pending').length),
                  label: my('givingPage.group.pending'),
                },
              ]}
            />
            <MyListFilters
              label={my('givingPage.views')}
              spec={spec}
              current={view.filter}
              minimum={3}
              format={(value) => number.format(value)}
              items={[
                { value: null, text: my('list.allKinds'), count: all.length },
                ...DONATION_GROUPS.map((group) => ({
                  value: group,
                  text: my(`givingPage.group.${group}`),
                  count: inGroup(group).length,
                })),
              ]}
            />
            {range === null ? null : (
              <MyListStatus>
                {bounded
                  ? my('givingPage.shownBounded', {
                      ...range,
                      total: shown.length,
                      max: OWN_DONATION_HISTORY,
                    })
                  : my('count.donations', { ...range, total: shown.length })}
              </MyListStatus>
            )}
          </div>
        )}
        {!history.ok || all.length === 0 ? null : page.length === 0 ? (
          shown.length === 0 ? (
            <EmptyState icon="list" action={{ href: path, text: my('list.all') }}>
              {my('givingPage.noneOfGroup')}
            </EmptyState>
          ) : (
            <MyListBeyond
              text={my('list.beyond')}
              first={myListHref(spec, { page: 1, filter: view.filter })}
              firstText={my('list.first')}
            />
          )
        ) : (
          <ul
            aria-label={t('history.heading')}
            className="flex flex-col border-t border-border"
          >
            {page.map((entry) => (
              <li
                key={entry.id}
                className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-x-6 gap-y-2 border-b border-border py-4 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div className="flex min-w-0 flex-col gap-2">
                  <p className="font-semibold">
                    <CampaignTitle campaign={entry.campaign} locale={locale} t={d} />
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <DonationStateBadge state={entry.state} t={d} />
                    <EnvironmentBadge environment={entry.environment} t={d} />
                  </div>
                  <dl className="grid grid-cols-[minmax(0,1fr)] gap-x-6 sm:grid-cols-2">
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
                <p className="order-first font-serif text-heading font-semibold tabular-nums sm:order-none sm:text-end">
                  <span className="sr-only">{d('detail.amount')} </span>
                  <Money money={entry.expected} locale={locale} />
                </p>
              </li>
            ))}
          </ul>
        )}
        {!history.ok || shown.length === 0 ? null : (
          <MyListPager
            label={t('history.heading')}
            spec={spec}
            view={view}
            total={shown.length}
            locale={locale}
            words={{
              previous: my('givingPage.previous'),
              next: my('givingPage.next'),
              page: (value) => my('list.page', { page: value }),
            }}
          />
        )}
      </MySection>

      {/* ---- Give, linked ------------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="donations-give">
        <span id="donations-give">
          <SectionHeading>{t('give.heading')}</SectionHeading>
        </span>
        <p className="text-sm text-foreground-muted">{t('give.help')}</p>
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
    </MyPage>
  );
}
