/**
 * Exact money for Donations (DOMAIN_MODEL.md §19.6).
 *
 * INTEGER MINOR UNITS PLUS AN EXPLICIT EXPONENT. An amount is a `bigint` count
 * of the currency's ISO 4217 minor unit, always carried with its currency, and
 * every stored amount also records the exponent it was written under — so a
 * future change to a currency's minor unit can never silently reinterpret a
 * historical amount. Binary floating point never touches money: amounts are
 * parsed from decimal TEXT straight into a `bigint`, compared as `bigint`, and
 * formatted back from a `bigint`.
 *
 * NOT EVERY CURRENCY HAS TWO DECIMAL PLACES. The table below names each
 * supported currency's exponent — zero (JPY, KRW), two, or three (BHD, JOD,
 * KWD, OMR, TND) — and nothing anywhere assumes two.
 *
 * ISO UNITS, NOT PROVIDER UNITS. A payment provider's own unit convention (a
 * currency a provider represents with extra zeros, a provider that refuses a
 * final digit) is converted INSIDE that provider's adapter, never here.
 *
 * THE TABLE IS A SERVER-OWNED ALLOWLIST, not a statement of what any provider
 * accepts. Which of these a campaign actually offers is an operator's choice
 * per campaign, intersected with the configured provider's capability; real
 * supported currencies and regions remain OPEN (OPEN_DECISIONS.md §5.4).
 */

export const CURRENCY_EXPONENTS = Object.freeze({
  AED: 2,
  AUD: 2,
  BHD: 3,
  CAD: 2,
  CHF: 2,
  DKK: 2,
  EUR: 2,
  GBP: 2,
  JOD: 3,
  JPY: 0,
  KRW: 0,
  KWD: 3,
  MYR: 2,
  NOK: 2,
  OMR: 3,
  PKR: 2,
  QAR: 2,
  SAR: 2,
  SEK: 2,
  TND: 3,
  USD: 2,
  ZAR: 2,
} as const);

export type DonationCurrency = keyof typeof CURRENCY_EXPONENTS;
export type CurrencyExponent = (typeof CURRENCY_EXPONENTS)[DonationCurrency];

export const DONATION_CURRENCIES: readonly DonationCurrency[] = Object.freeze(
  (Object.keys(CURRENCY_EXPONENTS) as DonationCurrency[]).sort(),
);

export function isDonationCurrency(value: unknown): value is DonationCurrency {
  return typeof value === 'string' && Object.hasOwn(CURRENCY_EXPONENTS, value);
}

export function currencyExponent(currency: DonationCurrency): CurrencyExponent {
  return CURRENCY_EXPONENTS[currency];
}

/** An exact amount: a count of the currency's ISO minor unit. */
export interface ExactMoney {
  readonly currency: DonationCurrency;
  readonly minor: bigint;
}

/**
 * The largest amount any donation may carry, in minor units: twelve digits.
 * An engineering bound that keeps every amount inside a SQL `BIGINT` and a
 * provider's documented field width — not a giving policy.
 */
export const MONEY_MINOR_MAX = 999_999_999_999n;

const AMOUNT_TEXT = /^(0|[1-9][0-9]{0,11})(?:\.([0-9]{1,3}))?$/u;

/**
 * Parses donor- or operator-typed decimal text into exact minor units.
 *
 * `null` for anything that is not a plain positive decimal, that carries MORE
 * fractional digits than the currency has (no rounding — `1.005 USD` is
 * refused, never coerced), that is zero, or that exceeds `MONEY_MINOR_MAX`.
 * No grouping separators, signs, exponents or locale digits are accepted.
 */
export function parseExactAmount(
  text: string,
  currency: DonationCurrency,
): bigint | null {
  const match = AMOUNT_TEXT.exec(text);
  if (match === null) return null;

  const exponent = CURRENCY_EXPONENTS[currency];
  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';
  if (fraction.length > exponent) return null;

  const minor =
    BigInt(whole) * 10n ** BigInt(exponent) +
    (exponent === 0 ? 0n : BigInt(fraction.padEnd(exponent, '0')));

  return minor > 0n && minor <= MONEY_MINOR_MAX ? minor : null;
}

/**
 * The canonical decimal text of an exact amount — `1250 USD` → `12.50`,
 * `1250 JPY` → `1250`, `1250 KWD` → `1.250`. ASCII digits, no grouping: the
 * presentation layer localises it.
 */
export function formatExactAmount(minor: bigint, currency: DonationCurrency): string {
  if (minor < 0n) throw new RangeError('Money is never negative here.');

  const exponent = CURRENCY_EXPONENTS[currency];
  if (exponent === 0) return minor.toString();

  const scale = 10n ** BigInt(exponent);
  return `${(minor / scale).toString()}.${(minor % scale).toString().padStart(exponent, '0')}`;
}
