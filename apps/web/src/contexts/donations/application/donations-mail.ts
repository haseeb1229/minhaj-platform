import 'server-only';

import type { Locale } from '@minhaj/contracts';
import {
  formatExactAmount,
  type DonationCommunicationPurpose,
  type ExactMoney,
  type PaymentEnvironment,
} from '@minhaj/contracts/donations';
import type { ResolvedDelivery } from '@minhaj/contracts/platform';

/**
 * What Donations' service mail SAYS (ARCHITECTURE.md §4.6.1): a donation
 * payment the provider confirmed, and a partial or full refund of one. Sent
 * only to a donor who gave while signed in; an anonymous donor reads status
 * on-site through their token and no address is ever collected.
 *
 * A PAYMENT ACKNOWLEDGEMENT, AND NOTHING MORE. A message states that the
 * payment provider reported a payment or a refund, names the campaign and the
 * exact amount, and links to the person's own private donations page —
 * `/my/donations`. It makes no tax, Gift Aid, zakat or other religious or
 * legal claim, and it is not a receipt of any official kind.
 *
 * A TEST PAYMENT SAYS SO. A donation made against a provider's fixture or
 * sandbox environment moved no real money, and its message says that plainly
 * in its subject and body.
 *
 * NOTHING ACTS FROM THE MAILBOX. The one link opens a page; it carries no
 * token, no donation id and no provider reference, and changes nothing.
 *
 * LOCALISED AT SEND TIME in the recipient's CURRENT interface locale; Urdu and
 * Arabic read right to left, and the amount — ASCII digits and an ISO code —
 * is kept left to right inside them.
 */

interface Copy {
  readonly subject: string;
  readonly greeting: string;
  readonly body: string;
  readonly campaign: string;
  readonly amount: string;
  readonly refunded: string;
  readonly action: string;
  readonly note: string;
  readonly signature: string;
}

interface LocaleWords {
  readonly testSubject: string;
  readonly testNote: string;
}

const WORDS: Readonly<Record<Locale, LocaleWords>> = {
  en: {
    testSubject: '[TEST]',
    testNote:
      'TEST PAYMENT: this was made in a test environment, and no real money was moved.',
  },
  ur: {
    testSubject: '[آزمائشی]',
    testNote:
      'آزمائشی ادائیگی: یہ آزمائشی ماحول میں کی گئی تھی، اور کوئی حقیقی رقم منتقل نہیں ہوئی۔',
  },
  ar: {
    testSubject: '[تجريبي]',
    testNote: 'دفعة تجريبية: أُجريت في بيئة اختبار، ولم تُنقل أي أموال حقيقية.',
  },
};

const COPY: Readonly<
  Record<DonationCommunicationPurpose, Readonly<Record<Locale, Copy>>>
> = {
  'donation.succeeded': {
    en: {
      subject: 'Your donation payment has been received',
      greeting: 'Assalamu alaikum,',
      body: 'Thank you. Our payment provider has confirmed your donation payment.',
      campaign: 'Campaign:',
      amount: 'Donation amount:',
      refunded: 'Amount refunded:',
      action: 'Open My donations in My Minhaj',
      note: 'This message acknowledges the payment our payment provider reported. You can see the full record of your donations in My Minhaj.',
      signature: 'Minhaj',
    },
    ur: {
      subject: 'آپ کے عطیے کی ادائیگی موصول ہو گئی ہے',
      greeting: 'السلام علیکم،',
      body: 'شکریہ۔ ہمارے ادائیگی فراہم کنندہ نے آپ کے عطیے کی ادائیگی کی تصدیق کر دی ہے۔',
      campaign: 'مہم:',
      amount: 'عطیے کی رقم:',
      refunded: 'واپس کی گئی رقم:',
      action: 'مائی منہاج میں میرے عطیات کھولیں',
      note: 'یہ پیغام اس ادائیگی کی اطلاع ہے جس کی ہمارے ادائیگی فراہم کنندہ نے تصدیق کی ہے۔ اپنے عطیات کا مکمل ریکارڈ آپ مائی منہاج میں دیکھ سکتے ہیں۔',
      signature: 'منہاج',
    },
    ar: {
      subject: 'تم استلام دفعة تبرعك',
      greeting: 'السلام عليكم،',
      body: 'شكرًا لك. أكّد مزوّد الدفع لدينا استلام دفعة تبرعك.',
      campaign: 'الحملة:',
      amount: 'مبلغ التبرع:',
      refunded: 'المبلغ المسترد:',
      action: 'افتح "تبرعاتي" في "منهاجي"',
      note: 'هذه الرسالة إشعار بالدفعة التي أبلغ عنها مزوّد الدفع لدينا. يمكنك الاطلاع على السجل الكامل لتبرعاتك في "منهاجي".',
      signature: 'منهاج',
    },
  },
  'donation.partially-refunded': {
    en: {
      subject: 'Part of your donation has been refunded',
      greeting: 'Assalamu alaikum,',
      body: 'Part of your donation payment has been refunded through our payment provider.',
      campaign: 'Campaign:',
      amount: 'Donation amount:',
      refunded: 'Amount refunded:',
      action: 'Open My donations in My Minhaj',
      note: 'This message acknowledges the refund our payment provider reported. You can see the full record of your donations in My Minhaj.',
      signature: 'Minhaj',
    },
    ur: {
      subject: 'آپ کے عطیے کا کچھ حصہ واپس کر دیا گیا ہے',
      greeting: 'السلام علیکم،',
      body: 'آپ کے عطیے کی ادائیگی کا کچھ حصہ ہمارے ادائیگی فراہم کنندہ کے ذریعے واپس کر دیا گیا ہے۔',
      campaign: 'مہم:',
      amount: 'عطیے کی رقم:',
      refunded: 'واپس کی گئی رقم:',
      action: 'مائی منہاج میں میرے عطیات کھولیں',
      note: 'یہ پیغام اس واپسی کی اطلاع ہے جس کی ہمارے ادائیگی فراہم کنندہ نے تصدیق کی ہے۔ اپنے عطیات کا مکمل ریکارڈ آپ مائی منہاج میں دیکھ سکتے ہیں۔',
      signature: 'منہاج',
    },
    ar: {
      subject: 'تم استرداد جزء من تبرعك',
      greeting: 'السلام عليكم،',
      body: 'تم استرداد جزء من دفعة تبرعك عبر مزوّد الدفع لدينا.',
      campaign: 'الحملة:',
      amount: 'مبلغ التبرع:',
      refunded: 'المبلغ المسترد:',
      action: 'افتح "تبرعاتي" في "منهاجي"',
      note: 'هذه الرسالة إشعار بالاسترداد الذي أبلغ عنه مزوّد الدفع لدينا. يمكنك الاطلاع على السجل الكامل لتبرعاتك في "منهاجي".',
      signature: 'منهاج',
    },
  },
  'donation.refunded': {
    en: {
      subject: 'Your donation has been refunded',
      greeting: 'Assalamu alaikum,',
      body: 'Your donation payment has been refunded in full through our payment provider.',
      campaign: 'Campaign:',
      amount: 'Donation amount:',
      refunded: 'Amount refunded:',
      action: 'Open My donations in My Minhaj',
      note: 'This message acknowledges the refund our payment provider reported. You can see the full record of your donations in My Minhaj.',
      signature: 'Minhaj',
    },
    ur: {
      subject: 'آپ کا عطیہ واپس کر دیا گیا ہے',
      greeting: 'السلام علیکم،',
      body: 'آپ کے عطیے کی پوری ادائیگی ہمارے ادائیگی فراہم کنندہ کے ذریعے واپس کر دی گئی ہے۔',
      campaign: 'مہم:',
      amount: 'عطیے کی رقم:',
      refunded: 'واپس کی گئی رقم:',
      action: 'مائی منہاج میں میرے عطیات کھولیں',
      note: 'یہ پیغام اس واپسی کی اطلاع ہے جس کی ہمارے ادائیگی فراہم کنندہ نے تصدیق کی ہے۔ اپنے عطیات کا مکمل ریکارڈ آپ مائی منہاج میں دیکھ سکتے ہیں۔',
      signature: 'منہاج',
    },
    ar: {
      subject: 'تم استرداد تبرعك',
      greeting: 'السلام عليكم،',
      body: 'تم استرداد دفعة تبرعك بالكامل عبر مزوّد الدفع لدينا.',
      campaign: 'الحملة:',
      amount: 'مبلغ التبرع:',
      refunded: 'المبلغ المسترد:',
      action: 'افتح "تبرعاتي" في "منهاجي"',
      note: 'هذه الرسالة إشعار بالاسترداد الذي أبلغ عنه مزوّد الدفع لدينا. يمكنك الاطلاع على السجل الكامل لتبرعاتك في "منهاجي".',
      signature: 'منهاج',
    },
  },
};

/** The locales every purpose is authored in. Asserted by test. */
export const DONATION_MAIL_LOCALES: readonly Locale[] = ['en', 'ur', 'ar'];

/** A recipient's interface locale as one this mail is written in; anything else is English. */
export function donationMailLocale(value: string): Locale {
  return value === 'ur' || value === 'ar' ? value : 'en';
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Exact decimal text and ISO code — `12.50 USD`, `1250 JPY`, `1.250 KWD`. Never rounded. */
function moneyText(money: ExactMoney): string {
  return `${formatExactAmount(money.minor, money.currency)} ${money.currency}`;
}

export function renderDonationMail(input: {
  readonly purpose: DonationCommunicationPurpose;
  readonly locale: string;
  readonly recipient: string;
  /** The campaign's title, and the locale those words are in. Plain text, escaped here. */
  readonly campaignTitle: { readonly text: string; readonly locale: Locale };
  /** The donation's expected — and, for these purposes, captured — money. */
  readonly amount: ExactMoney;
  /** The refund this message announces, for the refund purposes. */
  readonly refunded: ExactMoney | null;
  readonly environment: PaymentEnvironment;
  /** The person's OWN private donations page. */
  readonly donationsUrl: string;
}): ResolvedDelivery {
  const locale = donationMailLocale(input.locale);
  const copy = COPY[input.purpose][locale];
  const words = WORDS[locale];
  const test = input.environment !== 'production';
  const dir = locale === 'en' ? 'ltr' : 'rtl';
  const link = escapeHtml(input.donationsUrl);
  const titleLocale = input.campaignTitle.locale;
  // A title in another language carries its own language and direction, so a
  // screen reader pronounces it and the bidirectional text stays readable.
  const titleAttributes =
    titleLocale === locale
      ? ''
      : ` lang="${titleLocale}" dir="${titleLocale === 'en' ? 'ltr' : 'rtl'}"`;
  const amount = moneyText(input.amount);
  const refunded =
    input.purpose === 'donation.succeeded' || input.refunded === null
      ? null
      : moneyText(input.refunded);
  const subject = test ? `${words.testSubject} ${copy.subject}` : copy.subject;

  const testHtml = test
    ? `\n      <p style="margin:0 0 16px;padding:8px 12px;border:2px dashed #8a5a00;font-weight:700">${escapeHtml(words.testNote)}</p>`
    : '';
  const refundedHtml =
    refunded === null
      ? ''
      : `\n      <p style="margin:0 0 16px"><strong>${escapeHtml(copy.refunded)}</strong> <span dir="ltr">${escapeHtml(refunded)}</span></p>`;

  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
  <body style="margin:0;padding:24px;background:#f6f5f2;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1b1b1b;line-height:1.6">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e0d9;border-radius:10px;padding:32px">${testHtml}
      <p style="margin:0 0 16px">${escapeHtml(copy.greeting)}</p>
      <p style="margin:0 0 16px">${escapeHtml(copy.body)}</p>
      <p style="margin:0 0 16px"><strong>${escapeHtml(copy.campaign)}</strong> <span${titleAttributes}>${escapeHtml(input.campaignTitle.text)}</span></p>
      <p style="margin:0 0 16px"><strong>${escapeHtml(copy.amount)}</strong> <span dir="ltr">${escapeHtml(amount)}</span></p>${refundedHtml}
      <p style="margin:24px 0"><a href="${link}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:#1f3d2b;color:#ffffff;text-decoration:none">${escapeHtml(copy.action)}</a></p>
      <p style="margin:16px 0;color:#5b5b5b;font-size:13px;word-break:break-all">${link}</p>
      <p style="margin:24px 0 0;color:#5b5b5b;font-size:13px">${escapeHtml(copy.note)}</p>
      <p style="margin:24px 0 0;color:#5b5b5b;font-size:13px">${escapeHtml(copy.signature)}</p>
    </div>
  </body>
</html>`;

  const text = [
    ...(test ? [words.testNote, ''] : []),
    copy.greeting,
    '',
    copy.body,
    '',
    `${copy.campaign} ${input.campaignTitle.text}`,
    `${copy.amount} ${amount}`,
    ...(refunded === null ? [] : [`${copy.refunded} ${refunded}`]),
    '',
    `${copy.action}: ${input.donationsUrl}`,
    '',
    copy.note,
    '',
    copy.signature,
  ].join('\n');

  return { recipient: input.recipient, subject, html, text };
}
