import 'server-only';

import type { getTranslations } from 'next-intl/server';

import type { Locale } from '@minhaj/contracts';
import type {
  CampaignLabel,
  DonationRefundState,
  DonationState,
  ExactMoney,
  PaymentEnvironment,
  PublicDonationCampaign,
} from '@minhaj/contracts/donations';

import { paragraphs } from '@/components/my-learning/presentation';
import { displayTimeZone } from '@/components/personal/presentation';
import { Alert, StatusBadge } from '@/components/ui';
import { directionOf, endonymOf } from '@/config/locale';
import {
  campaignWords,
  isTestEnvironment,
  moneyText,
  refundTone,
  stateKey,
  stateShape,
  stateTone,
} from './presentation';

/**
 * The parts every Donations surface shares (DELIVERY_PLAN.md Phase 27) — the
 * public giving page, the status page, My donations and the administration.
 *
 * SERVER COMPONENTS, SESSION-FREE BY CONSTRUCTION. Nothing here reads a
 * request, a cookie, a session or a composition root; each part renders what
 * its caller already read, so the anonymous pages use them as freely as the
 * private ones.
 *
 * STATE IS WORDS AND A SHAPE. "Pending", "Succeeded", "Refunded" are text in a
 * badge, beside a decorative shape; a tone only repeats what the word says,
 * never carries it alone (SECURITY_BASELINE.md §16.1).
 *
 * A TEST ENVIRONMENT SAYS SO FIRST. While payments run against the fixture
 * simulator or a provider sandbox, a banner says in words that no real money
 * moves — before anything else on the page.
 *
 * LOGICAL PROPERTIES ONLY (`check:rtl`). Operator text may hold a long
 * unbroken token, so it may break anywhere rather than widen a phone screen;
 * an amount is isolated so its digits keep their order inside Urdu or Arabic.
 */

export type DonationsTranslator = Awaited<
  ReturnType<typeof getTranslations<'donations'>>
>;

/** An exact amount, localised, isolated from the surrounding direction. */
export function Money({
  money,
  locale,
}: {
  readonly money: ExactMoney;
  readonly locale: Locale;
}) {
  return <bdi className="whitespace-nowrap">{moneyText(locale, money)}</bdi>;
}

/** A donation's state: a decorative shape and the word that carries the meaning. */
export function DonationStateBadge({
  state,
  t,
}: {
  readonly state: DonationState;
  readonly t: DonationsTranslator;
}) {
  return (
    <StatusBadge tone={stateTone(state)}>
      <span aria-hidden="true" className="me-1">
        {stateShape(state)}
      </span>
      {t(`state.${stateKey(state)}`)}
    </StatusBadge>
  );
}

/** A refund's state, in words. */
export function RefundStateBadge({
  state,
  t,
}: {
  readonly state: DonationRefundState;
  readonly t: DonationsTranslator;
}) {
  return <StatusBadge tone={refundTone(state)}>{t(`refundState.${state}`)}</StatusBadge>;
}

/** The environment marker beside a record, for anything that is not production. */
export function EnvironmentBadge({
  environment,
  t,
}: {
  readonly environment: PaymentEnvironment;
  readonly t: DonationsTranslator;
}) {
  if (!isTestEnvironment(environment)) return null;
  return <StatusBadge tone="caution">{t(`environment.${environment}`)}</StatusBadge>;
}

/**
 * The test banner, when and only when the payment environment moves no real
 * money: the fixture simulator or a provider's sandbox.
 */
export function TestEnvironmentBanner({
  environment,
  t,
}: {
  readonly environment: PaymentEnvironment;
  readonly t: DonationsTranslator;
}) {
  if (!isTestEnvironment(environment)) return null;
  return (
    <p
      role="note"
      className="rounded-[var(--radius-panel)] border-2 border-[color:var(--color-warning)] bg-[color:var(--color-warning-surface)] px-4 py-3 font-semibold text-[color:var(--color-warning)]"
    >
      {t(`banner.${environment === 'fixture' ? 'fixture' : 'sandbox'}`)}
    </p>
  );
}

/** An instant, in the interface locale and the reader's own time zone, zone named. */
export function DonationTime({
  value,
  locale,
  timeZone,
}: {
  readonly value: Date;
  readonly locale: Locale;
  readonly timeZone: string | null;
}) {
  return (
    <time dateTime={value.toISOString()}>
      {new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZone: displayTimeZone(timeZone),
        timeZoneName: 'short',
      }).format(value)}
    </time>
  );
}

/**
 * A campaign's title in the reader's locale where it has one, in its own
 * language. A campaign the reader cannot resolve reads as the honest fallback
 * words, never an identifier.
 */
export function CampaignTitle({
  campaign,
  locale,
  t,
}: {
  readonly campaign:
    | CampaignLabel
    | Pick<PublicDonationCampaign, 'translations' | 'primaryLocale'>
    | undefined;
  readonly locale: Locale;
  readonly t: DonationsTranslator;
}) {
  const words = campaign === undefined ? null : campaignWords(campaign, locale);
  if (words === null)
    return (
      <span className="text-[color:var(--color-foreground-muted)]">
        {t('campaign.unavailable')}
      </span>
    );
  return (
    <span lang={words.locale} dir={directionOf(words.locale)} className="wrap-anywhere">
      {words.title}
    </span>
  );
}

/**
 * A campaign's full words — the not-translated notice when they are not in
 * the reader's locale, then title, summary and description, all marked with
 * the language they are in. Operator-authored PLAIN TEXT, rendered as text.
 */
export function CampaignWords({
  campaign,
  locale,
  t,
  headingId,
}: {
  readonly campaign: Pick<PublicDonationCampaign, 'translations' | 'primaryLocale'>;
  readonly locale: Locale;
  readonly t: DonationsTranslator;
  readonly headingId?: string;
}) {
  const words = campaignWords(campaign, locale);
  if (words === null) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {words.locale === locale ? null : (
        <Alert tone="info">
          {t('campaign.fallback', { language: endonymOf(words.locale) })}
        </Alert>
      )}
      <div
        className="flex min-w-0 flex-col gap-3"
        lang={words.locale}
        dir={directionOf(words.locale)}
      >
        <h3 id={headingId} className="text-lg font-semibold wrap-anywhere">
          {words.title}
        </h3>
        <p className="wrap-anywhere text-[color:var(--color-foreground-muted)]">
          {words.summary}
        </p>
        {paragraphs(words.description).map((paragraph, index) => (
          <p key={index} className="text-sm wrap-anywhere whitespace-pre-line">
            {paragraph}
          </p>
        ))}
      </div>
    </div>
  );
}
