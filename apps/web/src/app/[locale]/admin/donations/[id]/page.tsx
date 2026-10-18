import { randomUUID } from 'node:crypto';

import { notFound } from 'next/navigation';

import {
  donationIdSchema,
  formatExactAmount,
  isCapturedState,
  type StaffDonationDetail,
} from '@minhaj/contracts/donations';

import {
  CampaignTitle,
  DonationStateBadge,
  DonationTime,
  EnvironmentBadge,
  Money,
  RefundStateBadge,
} from '@/components/donations/parts';
import { adminDonationsPath, attentionKey } from '@/components/donations/presentation';
import { donationsRead } from '@/components/donations/read';
import { ConfirmField } from '@/components/personal/parts';
import {
  Alert,
  DetailRow,
  EmptyState,
  Field,
  PageHeading,
  Panel,
  SectionHeading,
  TextInput,
  TextLink,
} from '@/components/ui';
import { requireAdminPage } from '@/composition/authorization';
import { donationsRuntime } from '@/composition/donations';
import { requireLocale } from '@/config/route-locale';
import { redactReference } from '@/contexts/donations';
import { ActionForm } from '../../../(identity)/form-state';
import { reconcileDonationAction, refundDonationAction } from '../actions';
import {
  DonationRefundStepUp,
  RecordIdentity,
  adminDonationsCopy,
  donorName,
} from '../shared';

/**
 * One donation, as an operator reads it (DELIVERY_PLAN.md Phase 27) — under
 * `donations.read`; reconciling re-checks `donations.administer`, and a refund
 * needs `donations.refund` with a live `donation-refund` step-up.
 *
 * OPENING IT IS AUDITED. The service records the access — the operator and the
 * donation, identifiers only — before it returns the record, and the page says
 * so, so nobody opens a financial record believing it goes unrecorded.
 *
 * WHAT THERE IS TO READ: the exact expected, captured, refunded and reserved
 * amounts; the state in words; the environment and the non-secret account;
 * provider references reduced to their last six characters; dispute and
 * attention; the reconciliation schedule; and every refund. A linked donor is
 * named by the display name Identity reports, on this audited page only; an
 * anonymous donor is `anonymous`. Never an address or an account identifier.
 *
 * NOTHING HERE DECIDES AN OUTCOME. Reconciling asks the provider and applies
 * what it reports; a refund is reserved, then requested from the provider
 * under its own key, and its state is the provider's answer. The refund form
 * and its step-up appear only for a holder of `donations.refund`, and only
 * while something remains refundable.
 */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = 'force-dynamic';

/**
 * What remains refundable now, exactly: the captured amount less every refund
 * this platform has reserved, less anything refunded outside it. Display only
 * — the adapter recomputes it under the donation's lock, and the database
 * refuses any refund beyond the captured amount.
 */
function refundable(donation: StaffDonationDetail): bigint {
  if (donation.capturedMinor === null) return 0n;
  const ownSucceeded = donation.refunds
    .filter((refund) => refund.state === 'succeeded')
    .reduce((sum, refund) => sum + refund.amount.minor, 0n);
  const external =
    donation.refundedMinor > ownSucceeded ? donation.refundedMinor - ownSucceeded : 0n;
  const remaining = donation.capturedMinor - donation.refundReservedMinor - external;
  return remaining > 0n ? remaining : 0n;
}

export default async function DonationRecordPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const base = adminDonationsPath(locale);
  const path = `${base}/${encodeURIComponent(id)}`;
  const context = await requireAdminPage(locale, 'donations.read', path);
  if (!donationIdSchema.safeParse(id).success) notFound();
  const copy = await adminDonationsCopy(locale);
  const { t, d } = copy;
  const actor = { accountId: context.session.account.id };
  const administer = context.authorization.can('donations.administer');
  const refunder = context.authorization.can('donations.refund');
  const timeZone = context.session.account.timezone;

  const read = await donationsRead('donations-admin-record', () =>
    donationsRuntime().admin.donation(actor, id),
  );
  const back = (
    <p>
      <TextLink href={base}>{t('record.back')}</TextLink>
    </p>
  );

  if (!read.ok) {
    if (['denied', 'not-found', 'invalid'].includes(read.failure)) notFound();
    return (
      <main className="flex flex-col gap-4">
        <PageHeading>{t('record.title')}</PageHeading>
        <Alert tone="error">{t('failure.load')}</Alert>
        {back}
      </main>
    );
  }
  if (read.value === null) notFound();

  const donation = read.value;
  const donor =
    donation.donorAccountId === null ? null : await donorName(donation.donorAccountId);
  const currency = donation.expected.currency;
  const remaining = refundable(donation);
  const captured =
    donation.capturedMinor !== null &&
    isCapturedState(donation.state) &&
    donation.state !== 'charged_back';

  return (
    <main className="flex min-w-0 flex-col gap-6">
      <header className="flex flex-col gap-2">
        <PageHeading>{t('record.title')}</PageHeading>
        <Alert tone="info">{t('record.audited')}</Alert>
      </header>

      <Panel>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <DonationStateBadge state={donation.state} t={d} />
            <EnvironmentBadge environment={donation.scope.environment} t={d} />
          </div>
          <dl className="divide-y divide-[color:var(--color-border)]">
            <DetailRow term={d('detail.campaign')}>
              <CampaignTitle campaign={donation.campaign} locale={locale} t={d} />
            </DetailRow>
            <DetailRow term={d('detail.amount')}>
              <Money money={donation.expected} locale={locale} />
            </DetailRow>
            <DetailRow term={t('record.captured')}>
              {donation.capturedMinor === null ? (
                t('record.notCaptured')
              ) : (
                <Money
                  money={{ currency, minor: donation.capturedMinor }}
                  locale={locale}
                />
              )}
            </DetailRow>
            <DetailRow term={d('detail.refunded')}>
              <Money
                money={{ currency, minor: donation.refundedMinor }}
                locale={locale}
              />
            </DetailRow>
            <DetailRow term={t('record.reserved')}>
              <Money
                money={{ currency, minor: donation.refundReservedMinor }}
                locale={locale}
              />
            </DetailRow>
            <DetailRow term={t('record.dispute')}>
              {t(`dispute.${donation.dispute}`)}
            </DetailRow>
            <DetailRow term={t('record.attention')}>
              {donation.attention === null
                ? t('attention.none')
                : t(`attention.${attentionKey(donation.attention)}`)}
            </DetailRow>
            <DetailRow term={t('record.donor')}>
              {!donation.linked ? (
                t('donor.anonymous')
              ) : donor === null ? (
                t('donor.linkedUnnamed')
              ) : (
                <bdi>{t('donor.linkedNamed', { name: donor })}</bdi>
              )}
            </DetailRow>
            <DetailRow term={t('record.environment')}>
              {d(`environment.${donation.scope.environment}`)}
            </DetailRow>
            <DetailRow term={t('record.account')}>
              <bdi>{`${donation.scope.provider} · ${donation.scope.accountKey}`}</bdi>
            </DetailRow>
            <DetailRow term={t('record.createState')}>
              {t(`createState.${donation.createState}`)}
            </DetailRow>
            <DetailRow term={t('record.checkoutReference')}>
              <bdi>
                {donation.checkoutReference === null
                  ? t('record.none')
                  : redactReference(donation.checkoutReference)}
              </bdi>
            </DetailRow>
            <DetailRow term={t('record.paymentReference')}>
              <bdi>
                {donation.paymentReference === null
                  ? t('record.none')
                  : redactReference(donation.paymentReference)}
              </bdi>
            </DetailRow>
            {donation.checkoutExpiresAt === null ? null : (
              <DetailRow term={t('record.checkoutExpires')}>
                <DonationTime
                  value={donation.checkoutExpiresAt}
                  locale={locale}
                  timeZone={timeZone}
                />
              </DetailRow>
            )}
            <DetailRow term={d('detail.started')}>
              <DonationTime
                value={donation.createdAt}
                locale={locale}
                timeZone={timeZone}
              />
            </DetailRow>
            {donation.succeededAt === null ? null : (
              <DetailRow term={d('detail.succeeded')}>
                <DonationTime
                  value={donation.succeededAt}
                  locale={locale}
                  timeZone={timeZone}
                />
              </DetailRow>
            )}
            <DetailRow term={d('detail.updated')}>
              <DonationTime
                value={donation.updatedAt}
                locale={locale}
                timeZone={timeZone}
              />
            </DetailRow>
            <DetailRow term={t('record.version')}>{donation.version}</DetailRow>
          </dl>
        </div>
      </Panel>

      {/* ---- Reconciliation ---------------------------------------------- */}

      <section className="flex flex-col gap-3" aria-labelledby="donation-reconcile">
        <SectionHeading>
          <span id="donation-reconcile">{t('reconcile.heading')}</span>
        </SectionHeading>
        <dl className="divide-y divide-[color:var(--color-border)]">
          <DetailRow term={t('reconcile.due')}>
            {donation.reconcileDueAt === null ? (
              t('reconcile.notScheduled')
            ) : (
              <DonationTime
                value={donation.reconcileDueAt}
                locale={locale}
                timeZone={timeZone}
              />
            )}
          </DetailRow>
          <DetailRow term={t('reconcile.attempts')}>
            {t('reconcile.attemptCount', { count: donation.reconcileAttempts })}
          </DetailRow>
        </dl>
        {administer ? (
          <>
            <p className="text-sm">{t('reconcile.help')}</p>
            <ActionForm
              action={reconcileDonationAction}
              submitLabel={t('reconcile.submit')}
              pendingLabel={t('pending')}
              tone="secondary"
              messages={{ ...copy.messages, success: t('reconcile.done') }}
            >
              <RecordIdentity locale={locale} record={donation} />
            </ActionForm>
          </>
        ) : null}
      </section>

      {/* ---- Refunds ------------------------------------------------------ */}

      <section className="flex flex-col gap-3" aria-labelledby="donation-refunds">
        <SectionHeading>
          <span id="donation-refunds">{t('refunds.heading')}</span>
        </SectionHeading>
        {donation.refunds.length === 0 ? (
          <EmptyState>{t('refunds.empty')}</EmptyState>
        ) : (
          <ul aria-label={t('refunds.heading')} className="flex flex-col gap-3">
            {donation.refunds.map((refund) => (
              <Panel key={refund.id} as="li">
                <div className="flex min-w-0 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <RefundStateBadge state={refund.state} t={d} />
                  </div>
                  <dl className="divide-y divide-[color:var(--color-border)]">
                    <DetailRow term={d('detail.amount')}>
                      <Money money={refund.amount} locale={locale} />
                    </DetailRow>
                    <DetailRow term={t('refunds.reference')}>
                      <bdi>
                        {refund.refundReference === null
                          ? t('record.none')
                          : redactReference(refund.refundReference)}
                      </bdi>
                    </DetailRow>
                    <DetailRow term={t('refunds.requested')}>
                      <DonationTime
                        value={refund.requestedAt}
                        locale={locale}
                        timeZone={timeZone}
                      />
                    </DetailRow>
                    {refund.completedAt === null ? null : (
                      <DetailRow term={t('refunds.completed')}>
                        <DonationTime
                          value={refund.completedAt}
                          locale={locale}
                          timeZone={timeZone}
                        />
                      </DetailRow>
                    )}
                  </dl>
                </div>
              </Panel>
            ))}
          </ul>
        )}

        {!refunder ? null : !captured || remaining === 0n ? (
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {captured ? t('refund.nothingLeft') : t('refund.notCaptured')}
          </p>
        ) : (
          <>
            <DonationRefundStepUp locale={locale} />
            <Panel>
              <div className="flex flex-col gap-3">
                <h3 className="font-semibold">{t('refund.heading')}</h3>
                <p className="text-sm">
                  {t.rich('refund.remaining', {
                    amount: () => (
                      <Money money={{ currency, minor: remaining }} locale={locale} />
                    ),
                  })}
                </p>
                <p className="text-sm text-[color:var(--color-foreground-muted)]">
                  {t('refund.help')}
                </p>
                <ActionForm
                  action={refundDonationAction}
                  submitLabel={t('refund.submit')}
                  pendingLabel={t('pending')}
                  tone="destructive"
                  messages={{
                    ...copy.messages,
                    success: t('refund.accepted'),
                    'refund-rejected': t('refund.rejected'),
                    'refund-unknown': t('refund.unknown'),
                  }}
                >
                  <RecordIdentity locale={locale} record={donation} />
                  <input type="hidden" name="operationId" value={randomUUID()} />
                  <Field
                    id="refund-amount"
                    label={t('refund.amount', { currency })}
                    help={t('refund.amountHelp')}
                  >
                    {(props) => (
                      <TextInput
                        {...props}
                        name="amount"
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        spellCheck={false}
                        dir="ltr"
                        maxLength={20}
                        required
                        defaultValue={formatExactAmount(remaining, currency)}
                      />
                    )}
                  </Field>
                  <ConfirmField id="refund-confirm" label={t('refund.confirm')} />
                </ActionForm>
              </div>
            </Panel>
          </>
        )}
      </section>

      {back}
    </main>
  );
}
