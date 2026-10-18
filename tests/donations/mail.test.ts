import { describe, expect, it } from 'vitest';

import {
  DONATION_COMMUNICATION_PURPOSES,
  type DonationCommunicationPurpose,
  type PaymentEnvironment,
} from '../../packages/contracts/src/donations/index.ts';
import { suppressionScopeOf } from '../../packages/contracts/src/platform/index.ts';
import {
  DONATION_MAIL_LOCALES,
  donationMailLocale,
  renderDonationMail,
} from '../../apps/web/src/contexts/donations/index.ts';

/**
 * Phase 27 — Donations' service mail: every purpose authored in all three
 * locales, right-to-left where it must be, naming the campaign and the EXACT
 * amount and linking only the person's own private donations page — and
 * nothing more: a payment acknowledgement, never a tax receipt, Gift Aid,
 * zakat or religious claim; a test payment marked as one; no address echoed;
 * no link that acts.
 */

const URL_FIXTURE = 'https://donations-proof.invalid/en/my/donations';
const RECIPIENT = 'donor@donations-proof.invalid';
const TITLE = { text: 'NON_DONATION_FIXTURE_TITLE', locale: 'en' } as const;

const render = (
  purpose: DonationCommunicationPurpose,
  locale: string,
  overrides: Partial<Parameters<typeof renderDonationMail>[0]> = {},
) =>
  renderDonationMail({
    purpose,
    locale,
    recipient: RECIPIENT,
    campaignTitle: TITLE,
    amount: { currency: 'USD', minor: 2500n },
    refunded: purpose === 'donation.succeeded' ? null : { currency: 'USD', minor: 1000n },
    environment: 'production',
    donationsUrl: URL_FIXTURE,
    ...overrides,
  });

const every = (environment: PaymentEnvironment = 'production') =>
  DONATION_COMMUNICATION_PURPOSES.flatMap((purpose) =>
    DONATION_MAIL_LOCALES.map((locale) => ({
      purpose,
      locale,
      message: render(purpose, locale, {
        campaignTitle: { text: TITLE.text, locale },
        environment,
      }),
    })),
  );

describe('Donations mail', () => {
  it('is authored in exactly the three interface locales', () => {
    expect([...DONATION_MAIL_LOCALES]).toEqual(['en', 'ur', 'ar']);
    expect(donationMailLocale('ur')).toBe('ur');
    expect(donationMailLocale('ar')).toBe('ar');
    expect(donationMailLocale('fr')).toBe('en');
    expect(donationMailLocale('')).toBe('en');
  });

  it('renders every purpose in every locale, with direction, campaign, amount and link', () => {
    for (const { purpose, locale, message } of every()) {
      const name = `${purpose} ${locale}`;
      expect(message.subject.length, name).toBeGreaterThan(0);
      expect(message.recipient, name).toBe(RECIPIENT);
      expect(message.html, name).toContain(
        `<html lang="${locale}" dir="${locale === 'en' ? 'ltr' : 'rtl'}">`,
      );
      expect(message.html, name).toContain(`<span>${TITLE.text}</span>`);
      expect(message.html, name).toContain('<span dir="ltr">25.00 USD</span>');
      expect(message.text, name).toContain('25.00 USD');
      expect(message.html, name).toContain(`href="${URL_FIXTURE}"`);
      expect(message.text, name).toContain(URL_FIXTURE);
    }
  });

  it('shows the refunded amount exactly for refunds, and none for a payment', () => {
    for (const locale of DONATION_MAIL_LOCALES) {
      expect(render('donation.partially-refunded', locale).text).toContain('10.00 USD');
      expect(render('donation.refunded', locale).html).toContain(
        '<span dir="ltr">10.00 USD</span>',
      );
      expect(render('donation.succeeded', locale).text).not.toContain('10.00 USD');
    }
  });

  it('renders amounts exactly in every exponent, never rounded', () => {
    expect(
      render('donation.succeeded', 'en', { amount: { currency: 'JPY', minor: 1250n } })
        .text,
    ).toContain('1250 JPY');
    expect(
      render('donation.succeeded', 'en', { amount: { currency: 'KWD', minor: 1250n } })
        .text,
    ).toContain('1.250 KWD');
    expect(
      render('donation.succeeded', 'ar', {
        amount: { currency: 'USD', minor: 999_999_999_999n },
      }).text,
    ).toContain('9999999999.99 USD');
  });

  it('writes Urdu and Arabic in their own scripts, not English', () => {
    for (const { locale, message } of every()) {
      if (locale === 'en') continue;
      expect(message.subject).toMatch(/[؀-ۿ]/u);
      expect(message.subject).not.toMatch(/[A-Za-z]/u);
    }
  });

  it('says something different for each purpose', () => {
    for (const locale of DONATION_MAIL_LOCALES) {
      const subjects = DONATION_COMMUNICATION_PURPOSES.map(
        (purpose) => render(purpose, locale).subject,
      );
      expect(new Set(subjects).size, locale).toBe(subjects.length);
    }
  });

  it('is a payment acknowledgement only: no tax, Gift Aid, zakat, receipt or religious claim', () => {
    for (const environment of ['production', 'sandbox'] as const)
      for (const { purpose, locale, message } of every(environment)) {
        const all = `${message.subject}\n${message.html}\n${message.text}`;
        expect(all, `${purpose} ${locale}`).not.toMatch(
          /\btax|deductib|gift ?aid|zakat|zakah|sadaq|khums|fitr|receipt|invoice|reward|blessing|accepted by|allah|ثواب|زکو|زكا|ٹیکس|ضريب|صدق|رسید|إيصال|فاتورة|اللہ|الله|قبول/iu,
        );
        if (locale === 'en')
          expect(message.text, purpose).not.toMatch(
            /\b(?:within|days?|hours?|weeks?|guarantee\w*|promise\w*|soon|shortly)\b/iu,
          );
      }
  });

  it('marks a test payment as one, in the subject and the body, in every locale', () => {
    for (const { purpose, locale, message } of every('sandbox')) {
      const name = `${purpose} ${locale}`;
      expect(message.subject, name).toMatch(/^\[(?:TEST|آزمائشی|تجريبي)\] /u);
      expect(message.text.split('\n')[0], name).toMatch(
        /TEST PAYMENT|آزمائشی ادائیگی|دفعة تجريبية/u,
      );
      expect(message.html, name).toContain('border:2px dashed');
    }
    for (const { message } of every('fixture')) expect(message.subject).toMatch(/^\[/u);
    for (const { message } of every('production')) {
      expect(message.subject).not.toMatch(/^\[/u);
      expect(message.html).not.toContain('border:2px dashed');
    }
  });

  it('never echoes the address, and its only link opens the private donations page', () => {
    for (const { purpose, locale, message } of every('sandbox')) {
      const name = `${purpose} ${locale}`;
      expect(message.html, name).not.toContain(RECIPIENT);
      expect(message.text, name).not.toContain(RECIPIENT);
      expect(
        [...message.html.matchAll(/href="([^"]*)"/gu)].map((m) => m[1]),
        name,
      ).toEqual([URL_FIXTURE]);
      expect(message.html, name).not.toMatch(
        /token|confirm=|action=|\b(?:cs|pi|re)_[a-z]/u,
      );
    }
  });

  it('escapes the campaign title and the link in HTML', () => {
    const message = render('donation.succeeded', 'en', {
      campaignTitle: { text: '<script>alert("x")</script> & co', locale: 'en' },
      donationsUrl: 'https://donations-proof.invalid/en/my/donations?a=1&b=2',
    });
    expect(message.html).not.toContain('<script>');
    expect(message.html).toContain(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co',
    );
    expect(message.html).toContain('donations?a=1&amp;b=2');
  });

  it('marks a title written in another locale with its own language and direction', () => {
    const urdu = render('donation.refunded', 'ur', {
      campaignTitle: { text: 'NON_DONATION_EN_TITLE', locale: 'en' },
    });
    expect(urdu.html).toContain('<span lang="en" dir="ltr">NON_DONATION_EN_TITLE</span>');
    const english = render('donation.refunded', 'en', {
      campaignTitle: { text: 'NON_DONATION_AR_TITLE', locale: 'ar' },
    });
    expect(english.html).toContain(
      '<span lang="ar" dir="rtl">NON_DONATION_AR_TITLE</span>',
    );
  });

  it('falls back to English for an unknown locale', () => {
    expect(render('donation.succeeded', 'fr').html).toContain(
      '<html lang="en" dir="ltr">',
    );
  });
});

describe('Donations mail is transactional, never marketing', () => {
  it('is suppressed only in the transactional scope', () => {
    for (const purpose of DONATION_COMMUNICATION_PURPOSES) {
      expect(suppressionScopeOf('complaint', purpose), purpose).toBe('transactional');
      expect(suppressionScopeOf('bounce', purpose), purpose).toBe('transactional');
    }
  });
});
