import 'server-only';

import {
  CURRENCY_EXPONENTS,
  isDonationCurrency,
  MONEY_MINOR_MAX,
  type DonationCurrency,
  type ExactMoney,
} from '@minhaj/contracts/donations';

/**
 * ISO minor units ⇄ Stripe's `amount` convention.
 *
 * Stripe expects every `amount` in the currency's smallest unit as an integer
 * (docs.stripe.com/currencies, "Specify amounts in API requests"), which for
 * every currency in the domain allowlist IS the ISO minor unit: zero-decimal
 * JPY/KRW are whole units, two-decimal currencies are hundredths, and the
 * three-decimal BHD/JOD/KWD/OMR/TND are thousandths.
 *
 * THE ONE PROVIDER RULE. For the three-decimal currencies Stripe has required
 * the least-significant digit to be zero (5.124 KWD had to be sent as `5120`),
 * for card-network compatibility. The current currencies page still advertises
 * three-decimal support but no longer restates that rule, so it is kept here
 * as the CONSERVATIVE direction: an amount such as `5124` is REFUSED rather
 * than rounded. Refusing never charges a donor anything they did not ask for;
 * rounding always would.
 *
 * Stripe's own special cases (ISK, UGX as two-decimal representations; HUF and
 * TWD payout divisibility) concern currencies outside the domain allowlist; a
 * test pins that they stay outside it, so this module never has to pretend to
 * handle them.
 *
 * NO FLOATING POINT. Amounts leave as decimal text of a `bigint`, and arrive as
 * JSON integers that are checked to be safe, non-negative and within twelve
 * digits before they become a `bigint`.
 */

const THREE_DECIMAL: ReadonlySet<DonationCurrency> = new Set(
  (Object.keys(CURRENCY_EXPONENTS) as DonationCurrency[]).filter(
    (currency) => CURRENCY_EXPONENTS[currency] === 3,
  ),
);

/** The `amount` to send for an exact domain amount, or `null` when Stripe cannot represent it. */
export function stripeAmountText(money: ExactMoney): string | null {
  if (!isDonationCurrency(money.currency)) return null;
  if (typeof money.minor !== 'bigint') return null;
  if (money.minor <= 0n || money.minor > MONEY_MINOR_MAX) return null;
  if (THREE_DECIMAL.has(money.currency) && money.minor % 10n !== 0n) return null;
  return money.minor.toString();
}

/** Stripe's lowercase ISO code for a domain currency. */
export function stripeCurrency(currency: DonationCurrency): string {
  return currency.toLowerCase();
}

/** The domain currency for Stripe's lowercase code, or `null` outside the allowlist. */
export function domainCurrency(value: string | null): DonationCurrency | null {
  if (value === null || !/^[a-z]{3}$/u.test(value)) return null;
  const upper = value.toUpperCase();
  return isDonationCurrency(upper) ? upper : null;
}

/**
 * A Stripe JSON integer amount as an exact `bigint`, or `null`.
 *
 * Stripe amounts are at most twelve digits, which is inside the range a JSON
 * number represents exactly; anything fractional, negative, unsafe or wider is
 * refused rather than coerced.
 */
export function minorFromStripe(value: unknown): bigint | null {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
  const minor = BigInt(value);
  return minor <= MONEY_MINOR_MAX ? minor : null;
}
