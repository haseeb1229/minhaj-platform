import type { Locale } from '@minhaj/contracts';
import {
  DONATION_STATES,
  PAYMENT_ENVIRONMENTS,
  currencyExponent,
  donationCampaignIdSchema,
  donationStatusTokenSchema,
  formatExactAmount,
  type CampaignTranslation,
  type DonationAttention,
  type DonationQuery,
  type DonationRefundState,
  type DonationState,
  type ExactMoney,
  type PaymentEnvironment,
} from '@minhaj/contracts/donations';

import { pickLabel } from '@/components/my-learning/presentation';

/**
 * Presentation decisions for every Donations surface — PURE and free of React
 * (DELIVERY_PLAN.md Phase 27).
 *
 * Which words a campaign renders in, how an exact amount is written, which
 * word and shape a state takes, which addresses the surfaces link between,
 * and what a query string or a post-action notice may say. Each has ONE
 * implementation, so `/donate`, the status page, My donations and the
 * administration read them the same way.
 *
 * MONEY IS NEVER A FLOAT. An amount is a `bigint` of ISO minor units; it is
 * written by `formatExactAmount` into exact decimal TEXT, and that text — not a
 * number — is what `Intl.NumberFormat` localises (a string operand is formatted
 * exactly, digit for digit). Nothing here calls `Number()` or `parseFloat` on
 * money.
 *
 * AN UNKNOWN FILTER NEVER BROADENS. A value a URL names that does not parse is
 * reported as INVALID rather than dropped, so an operator sees a 404 instead
 * of every donation.
 */

export type Query = Record<string, string | string[] | undefined>;

/** One parameter as one string; a repeated parameter is its first value. */
function single(query: Query, name: string): string | null {
  const value = query[name];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : null;
}

/* ===========================================================================
 * Addresses
 * ========================================================================= */

/** The public giving page. */
export function donatePath(locale: Locale): string {
  return `/${locale}/donate`;
}

/** The bearer status page of one anonymous donation. */
export function donationStatusPath(locale: Locale, token: string): string {
  return `/${locale}/donate/status/${token}`;
}

/** The signed-in person's own donations. */
export function myDonationsPath(locale: Locale): string {
  return `/${locale}/my/donations`;
}

/** The administration's donation records. */
export function adminDonationsPath(locale: Locale): string {
  return `/${locale}/admin/donations`;
}

/** An address with its query, in a fixed order, omitting what is unset. */
export function withQuery(
  base: string,
  params: Readonly<Record<string, string | null | undefined>>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    if (value !== null && value !== undefined && value !== '') search.set(key, value);
  const encoded = search.toString();
  return encoded === '' ? base : `${base}?${encoded}`;
}

/* ===========================================================================
 * The anonymous status cookie
 * ========================================================================= */

/**
 * The cookie that lets the provider's return page find the donation this
 * browser began. It holds the opaque status token — a bearer that reads ONE
 * donation's status and nothing else — and is scoped to the giving pages of
 * one locale, HttpOnly, for a day.
 */
export const DONATION_STATUS_COOKIE = 'minhaj-donation-status';
export const DONATION_STATUS_COOKIE_SECONDS = 86_400;

/** The path the cookie is sent on: the giving pages of the donor's locale. */
export function donationStatusCookiePath(locale: Locale): string {
  return donatePath(locale);
}

/** A well-formed status token, or `null` — never anything else. */
export function readStatusToken(value: unknown): string | null {
  const parsed = donationStatusTokenSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/* ===========================================================================
 * Money
 * ========================================================================= */

/**
 * An exact amount in the reader's locale: the currency code, the locale's
 * grouping and digits, and EXACTLY the currency's own number of decimals —
 * zero for JPY, three for KWD. The operand is the exact decimal text, so no
 * binary rounding can occur on the way.
 */
export function moneyText(locale: Locale, money: ExactMoney): string {
  const digits = currencyExponent(money.currency);
  const exact = formatExactAmount(money.minor, money.currency) as `${number}`;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: money.currency,
    currencyDisplay: 'code',
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(exact);
}

/**
 * What a donor typed, as the ASCII decimal text the server parses: surrounding
 * space removed, Arabic-Indic and Extended Arabic-Indic digits mapped to 0–9
 * and the Arabic decimal separator to a full stop. Nothing else is changed —
 * grouping, signs and anything else stay, so the server refuses them.
 */
export function asciiAmount(text: string): string {
  return text
    .trim()
    .replace(/[٠-٩]/gu, (digit) => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/gu, (digit) => String(digit.charCodeAt(0) - 0x06f0))
    .replace(/٫/gu, '.');
}

/** The value a suggested-amount choice submits: the currency and its exact text. */
export function suggestionValue(money: ExactMoney): string {
  return `${money.currency}:${formatExactAmount(money.minor, money.currency)}`;
}

/**
 * The money a giving form REQUESTS. A typed amount wins, in the selected
 * currency; otherwise the chosen suggestion; otherwise nothing, which the
 * server refuses as invalid. The server parses, bounds and checks all of it
 * against the campaign's policy — this only reads the form.
 */
export function requestedAmount(fields: {
  readonly suggested: string;
  readonly currency: string;
  readonly amount: string;
}): { readonly currency: string; readonly amount: string } {
  const typed = asciiAmount(fields.amount);
  if (typed !== '') return { currency: fields.currency, amount: typed };
  const chosen = /^([A-Z]{3}):([0-9.]{1,20})$/u.exec(fields.suggested);
  return chosen?.[1] !== undefined && chosen[2] !== undefined
    ? { currency: chosen[1], amount: chosen[2] }
    : { currency: fields.currency, amount: '' };
}

/* ===========================================================================
 * Words
 * ========================================================================= */

/** A campaign's words: the interface locale, else its primary locale, else any. */
export function campaignWords<T extends Pick<CampaignTranslation, 'locale'>>(
  campaign: { readonly translations: readonly T[]; readonly primaryLocale: Locale },
  locale: Locale,
): T | null {
  return pickLabel(campaign.translations, locale, campaign.primaryLocale);
}

/** The message key of a donation state — `partially_refunded` is not a key spelling. */
export function stateKey(
  state: DonationState,
):
  | 'pending'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'
  | 'partiallyRefunded'
  | 'refunded'
  | 'disputed'
  | 'chargedBack' {
  if (state === 'partially_refunded') return 'partiallyRefunded';
  if (state === 'charged_back') return 'chargedBack';
  return state;
}

/** The message key of an attention flag. */
export function attentionKey(
  attention: DonationAttention,
): 'amountMismatch' | 'providerMismatch' | 'unresolved' | 'externalRefund' {
  if (attention === 'amount-mismatch') return 'amountMismatch';
  if (attention === 'provider-mismatch') return 'providerMismatch';
  if (attention === 'external-refund') return 'externalRefund';
  return 'unresolved';
}

/* ===========================================================================
 * State tones and shapes — the badge's words carry the meaning
 * ========================================================================= */

export type Tone = 'neutral' | 'positive' | 'caution';

export function stateTone(state: DonationState): Tone {
  if (state === 'succeeded') return 'positive';
  if (state === 'pending' || state === 'disputed' || state === 'charged_back')
    return 'caution';
  return 'neutral';
}

/**
 * A decorative shape beside each state word, so two states never differ by
 * colour alone even before the word is read. Hidden from assistive technology:
 * the word is the meaning.
 */
export function stateShape(state: DonationState): string {
  switch (state) {
    case 'pending':
      return '◷';
    case 'succeeded':
      return '✓';
    case 'failed':
      return '✕';
    case 'cancelled':
      return '⊘';
    case 'expired':
      return '◌';
    case 'partially_refunded':
    case 'refunded':
      return '↺';
    case 'disputed':
    case 'charged_back':
      return '!';
  }
}

export function refundTone(state: DonationRefundState): Tone {
  if (state === 'succeeded') return 'positive';
  if (state === 'requested' || state === 'pending') return 'caution';
  return 'neutral';
}

/* ===========================================================================
 * Query strings
 * ========================================================================= */

/** One of a fixed set of choices, or `null` for absent, or `undefined` for malformed. */
function choice<T extends string>(
  query: Query,
  name: string,
  choices: readonly T[],
): T | null | undefined {
  const raw = single(query, name);
  if (raw === null || raw === '') return null;
  return choices.find((entry) => entry === raw);
}

/**
 * The administration's filters as the service's query, or `null` when any
 * named value does not parse — a malformed filter is refused, never dropped.
 */
export function readDonationQuery(query: Query, offset: number): DonationQuery | null {
  const state = choice(query, 'state', DONATION_STATES);
  const environment = choice(query, 'environment', PAYMENT_ENVIRONMENTS);
  const donor = choice(query, 'donor', ['anonymous', 'linked'] as const);
  const attention = choice(query, 'attention', ['1'] as const);
  const rawCampaign = single(query, 'campaign');
  const campaign =
    rawCampaign === null || rawCampaign === ''
      ? null
      : donationCampaignIdSchema.safeParse(rawCampaign).success
        ? rawCampaign
        : undefined;
  if (
    state === undefined ||
    environment === undefined ||
    donor === undefined ||
    attention === undefined ||
    campaign === undefined
  )
    return null;
  return {
    state,
    campaignId: campaign,
    environment,
    donor,
    attention: attention === '1',
    offset,
  };
}

/** The filters back as query parameters, in a fixed order, for links that keep them. */
export function donationQueryParams(
  query: Omit<DonationQuery, 'offset'>,
): Readonly<Record<string, string | null>> {
  return {
    state: query.state,
    campaign: query.campaignId,
    environment: query.environment,
    donor: query.donor,
    attention: query.attention ? '1' : null,
  };
}

/** Is a campaign id well-formed? A malformed one is the administrative 404. */
export function isCampaignId(value: string): boolean {
  return donationCampaignIdSchema.safeParse(value).success;
}

/**
 * What the status page may say after a donor's act redirects back to it. A
 * fixed set of words chosen by key, never a message carried in the address.
 */
export const STATUS_NOTICES = ['checked', 'cancel-requested'] as const;
export type StatusNotice = (typeof STATUS_NOTICES)[number];

export function readStatusNotice(query: Query): StatusNotice | null {
  const raw = single(query, 'done');
  return STATUS_NOTICES.find((notice) => notice === raw) ?? null;
}

/** Is this environment one where no real money moves? */
export function isTestEnvironment(environment: PaymentEnvironment): boolean {
  return environment !== 'production';
}
