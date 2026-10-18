import 'server-only';

import type { Locale } from '@minhaj/contracts';
import type { MembershipCommunicationPurpose } from '@minhaj/contracts/membership';
import type { ResolvedDelivery } from '@minhaj/contracts/platform';

/**
 * What Membership's service mail SAYS (ARCHITECTURE.md §4.6.1): an application
 * received, under review, approved, not approved or withdrawn, and a
 * Membership closed. Membership owns the words; the shared email concern sends
 * them.
 *
 * FACTUAL AND MINIMAL. A message states what happened, names the type the
 * person applied for, and links to the person's own private Membership page —
 * `/my/membership` — where everything else is read after signing in. It
 * carries no name, no address, no operator, no reason and no timetable: no
 * message promises when a decision will come or what it will be.
 *
 * NO PAYMENT WORDING, EVER. Joining is an organisational act; nothing here
 * asks for, mentions or implies money of any kind (DOMAIN_MODEL.md §17.2).
 *
 * NOTHING ACTS FROM THE MAILBOX. The one link opens a page; it carries no
 * token and changes nothing, so a forwarded or scanned message can do no more
 * than show the page to whoever is signed in.
 *
 * LOCALISED AT SEND TIME in the recipient's CURRENT interface locale, which
 * Identity resolves with the address; Urdu and Arabic read right to left. A
 * type title that exists only in another locale is marked with its own
 * language.
 */

interface Copy {
  readonly subject: string;
  readonly greeting: string;
  readonly body: string;
  readonly type: string;
  readonly action: string;
  readonly note: string;
  readonly signature: string;
}

const COPY: Readonly<
  Record<MembershipCommunicationPurpose, Readonly<Record<Locale, Copy>>>
> = {
  'membership.application.submitted': {
    en: {
      subject: 'We have received your membership application',
      greeting: 'Assalamu alaikum,',
      body: 'Your membership application has been received. You will be told by email when its status changes.',
      type: 'Membership type:',
      action: 'Open your Membership page in My Minhaj',
      note: 'On the same page you can follow the status of your application, or withdraw it.',
      signature: 'Minhaj',
    },
    ur: {
      subject: 'آپ کی رکنیت کی درخواست موصول ہو گئی ہے',
      greeting: 'السلام علیکم،',
      body: 'آپ کی رکنیت کی درخواست موصول ہو گئی ہے۔ اس کی حیثیت بدلنے پر آپ کو ای میل کے ذریعے مطلع کیا جائے گا۔',
      type: 'رکنیت کی قسم:',
      action: 'مائی منہاج میں اپنی رکنیت کا صفحہ کھولیں',
      note: 'اسی صفحے پر آپ اپنی درخواست کی حیثیت دیکھ سکتے ہیں یا اسے واپس لے سکتے ہیں۔',
      signature: 'منہاج',
    },
    ar: {
      subject: 'تم استلام طلب عضويتك',
      greeting: 'السلام عليكم،',
      body: 'تم استلام طلب العضوية الخاص بك، وسنُعلمك بالبريد الإلكتروني عند تغيّر حالته.',
      type: 'نوع العضوية:',
      action: 'افتح صفحة العضوية في "منهاجي"',
      note: 'يمكنك من الصفحة نفسها متابعة حالة طلبك أو سحبه.',
      signature: 'منهاج',
    },
  },
  'membership.application.under-review': {
    en: {
      subject: 'Your membership application is under review',
      greeting: 'Assalamu alaikum,',
      body: 'An administrator has begun reviewing your membership application.',
      type: 'Membership type:',
      action: 'Open your Membership page in My Minhaj',
      note: 'Nothing is needed from you now. You will receive another message when a decision has been made.',
      signature: 'Minhaj',
    },
    ur: {
      subject: 'آپ کی رکنیت کی درخواست زیرِ غور ہے',
      greeting: 'السلام علیکم،',
      body: 'ایک منتظم نے آپ کی رکنیت کی درخواست کا جائزہ لینا شروع کر دیا ہے۔',
      type: 'رکنیت کی قسم:',
      action: 'مائی منہاج میں اپنی رکنیت کا صفحہ کھولیں',
      note: 'فی الحال آپ کو کچھ کرنے کی ضرورت نہیں۔ فیصلہ ہونے پر آپ کو ایک اور پیغام بھیجا جائے گا۔',
      signature: 'منہاج',
    },
    ar: {
      subject: 'طلب عضويتك قيد المراجعة',
      greeting: 'السلام عليكم،',
      body: 'بدأ أحد المسؤولين مراجعة طلب العضوية الخاص بك.',
      type: 'نوع العضوية:',
      action: 'افتح صفحة العضوية في "منهاجي"',
      note: 'لا يلزمك أي إجراء الآن، وستصلك رسالة أخرى عند اتخاذ القرار.',
      signature: 'منهاج',
    },
  },
  'membership.application.approved': {
    en: {
      subject: 'Your membership application has been approved',
      greeting: 'Assalamu alaikum,',
      body: 'Your membership application has been approved, and your Membership is now active.',
      type: 'Membership type:',
      action: 'Open your Membership page in My Minhaj',
      note: 'You can see your Membership on your Membership page in My Minhaj.',
      signature: 'Minhaj',
    },
    ur: {
      subject: 'آپ کی رکنیت کی درخواست منظور ہو گئی ہے',
      greeting: 'السلام علیکم،',
      body: 'آپ کی رکنیت کی درخواست منظور کر لی گئی ہے اور آپ کی رکنیت اب فعال ہے۔',
      type: 'رکنیت کی قسم:',
      action: 'مائی منہاج میں اپنی رکنیت کا صفحہ کھولیں',
      note: 'آپ اپنی رکنیت مائی منہاج میں رکنیت کے صفحے پر دیکھ سکتے ہیں۔',
      signature: 'منہاج',
    },
    ar: {
      subject: 'تمت الموافقة على طلب عضويتك',
      greeting: 'السلام عليكم،',
      body: 'تمت الموافقة على طلب العضوية الخاص بك، وأصبحت عضويتك الآن سارية.',
      type: 'نوع العضوية:',
      action: 'افتح صفحة العضوية في "منهاجي"',
      note: 'يمكنك الاطلاع على عضويتك في صفحة العضوية في "منهاجي".',
      signature: 'منهاج',
    },
  },
  'membership.application.rejected': {
    en: {
      subject: 'An update on your membership application',
      greeting: 'Assalamu alaikum,',
      body: 'After review, your membership application has not been approved.',
      type: 'Membership type:',
      action: 'Open your Membership page in My Minhaj',
      note: 'You can see the status of your application on your Membership page, and you may submit a new application later if you wish.',
      signature: 'Minhaj',
    },
    ur: {
      subject: 'آپ کی رکنیت کی درخواست کے بارے میں اطلاع',
      greeting: 'السلام علیکم،',
      body: 'جائزے کے بعد آپ کی رکنیت کی درخواست منظور نہیں کی گئی۔',
      type: 'رکنیت کی قسم:',
      action: 'مائی منہاج میں اپنی رکنیت کا صفحہ کھولیں',
      note: 'آپ اپنی درخواست کی حیثیت رکنیت کے صفحے پر دیکھ سکتے ہیں، اور چاہیں تو بعد میں نئی درخواست دے سکتے ہیں۔',
      signature: 'منہاج',
    },
    ar: {
      subject: 'مستجدات بشأن طلب عضويتك',
      greeting: 'السلام عليكم،',
      body: 'بعد المراجعة، لم تتم الموافقة على طلب العضوية الخاص بك.',
      type: 'نوع العضوية:',
      action: 'افتح صفحة العضوية في "منهاجي"',
      note: 'يمكنك الاطلاع على حالة طلبك في صفحة العضوية، ويمكنك تقديم طلب جديد لاحقًا إن رغبت.',
      signature: 'منهاج',
    },
  },
  'membership.application.withdrawn': {
    en: {
      subject: 'Your membership application has been withdrawn',
      greeting: 'Assalamu alaikum,',
      body: 'Your membership application has been withdrawn, as you asked.',
      type: 'Membership type:',
      action: 'Open your Membership page in My Minhaj',
      note: 'If you did not do this, please sign in and check your account. You may apply again whenever you wish.',
      signature: 'Minhaj',
    },
    ur: {
      subject: 'آپ کی رکنیت کی درخواست واپس لے لی گئی ہے',
      greeting: 'السلام علیکم،',
      body: 'آپ کے کہنے پر آپ کی رکنیت کی درخواست واپس لے لی گئی ہے۔',
      type: 'رکنیت کی قسم:',
      action: 'مائی منہاج میں اپنی رکنیت کا صفحہ کھولیں',
      note: 'اگر یہ آپ نے نہیں کیا تو براہِ کرم سائن ان کر کے اپنا اکاؤنٹ دیکھ لیں۔ آپ جب چاہیں دوبارہ درخواست دے سکتے ہیں۔',
      signature: 'منہاج',
    },
    ar: {
      subject: 'تم سحب طلب عضويتك',
      greeting: 'السلام عليكم،',
      body: 'تم سحب طلب العضوية الخاص بك بناءً على طلبك.',
      type: 'نوع العضوية:',
      action: 'افتح صفحة العضوية في "منهاجي"',
      note: 'إن لم تكن أنت من قام بذلك، فيُرجى تسجيل الدخول ومراجعة حسابك. ويمكنك التقديم مجددًا متى شئت.',
      signature: 'منهاج',
    },
  },
  'membership.closed': {
    en: {
      subject: 'Your Membership has been closed',
      greeting: 'Assalamu alaikum,',
      body: 'Your Membership has been closed.',
      type: 'Membership type:',
      action: 'Open your Membership page in My Minhaj',
      note: 'You can see the record of your Membership on your Membership page in My Minhaj.',
      signature: 'Minhaj',
    },
    ur: {
      subject: 'آپ کی رکنیت ختم کر دی گئی ہے',
      greeting: 'السلام علیکم،',
      body: 'آپ کی رکنیت ختم کر دی گئی ہے۔',
      type: 'رکنیت کی قسم:',
      action: 'مائی منہاج میں اپنی رکنیت کا صفحہ کھولیں',
      note: 'آپ اپنی رکنیت کا ریکارڈ مائی منہاج میں رکنیت کے صفحے پر دیکھ سکتے ہیں۔',
      signature: 'منہاج',
    },
    ar: {
      subject: 'تم إنهاء عضويتك',
      greeting: 'السلام عليكم،',
      body: 'تم إنهاء عضويتك.',
      type: 'نوع العضوية:',
      action: 'افتح صفحة العضوية في "منهاجي"',
      note: 'يمكنك الاطلاع على سجل عضويتك في صفحة العضوية في "منهاجي".',
      signature: 'منهاج',
    },
  },
};

/** The locales every purpose is authored in. Asserted by test. */
export const MEMBERSHIP_MAIL_LOCALES: readonly Locale[] = ['en', 'ur', 'ar'];

/** A recipient's interface locale as one this mail is written in; anything else is English. */
export function membershipMailLocale(value: string): Locale {
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

export function renderMembershipMail(input: {
  readonly purpose: MembershipCommunicationPurpose;
  readonly locale: string;
  readonly recipient: string;
  /** The type's title, and the locale those words are in. Plain text, escaped here. */
  readonly typeTitle: { readonly text: string; readonly locale: Locale };
  /** The person's OWN private Membership page. */
  readonly membershipUrl: string;
}): ResolvedDelivery {
  const locale = membershipMailLocale(input.locale);
  const copy = COPY[input.purpose][locale];
  const dir = locale === 'en' ? 'ltr' : 'rtl';
  const link = escapeHtml(input.membershipUrl);
  const titleLocale = input.typeTitle.locale;
  // A title in another language carries its own language and direction, so a
  // screen reader pronounces it and the bidirectional text stays readable.
  const titleAttributes =
    titleLocale === locale
      ? ''
      : ` lang="${titleLocale}" dir="${titleLocale === 'en' ? 'ltr' : 'rtl'}"`;

  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
  <body style="margin:0;padding:24px;background:#f6f5f2;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1b1b1b;line-height:1.6">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e0d9;border-radius:10px;padding:32px">
      <p style="margin:0 0 16px">${escapeHtml(copy.greeting)}</p>
      <p style="margin:0 0 16px">${escapeHtml(copy.body)}</p>
      <p style="margin:0 0 16px"><strong>${escapeHtml(copy.type)}</strong> <span${titleAttributes}>${escapeHtml(input.typeTitle.text)}</span></p>
      <p style="margin:24px 0"><a href="${link}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:#1f3d2b;color:#ffffff;text-decoration:none">${escapeHtml(copy.action)}</a></p>
      <p style="margin:16px 0;color:#5b5b5b;font-size:13px;word-break:break-all">${link}</p>
      <p style="margin:24px 0 0;color:#5b5b5b;font-size:13px">${escapeHtml(copy.note)}</p>
      <p style="margin:24px 0 0;color:#5b5b5b;font-size:13px">${escapeHtml(copy.signature)}</p>
    </div>
  </body>
</html>`;

  const text = [
    copy.greeting,
    '',
    copy.body,
    '',
    `${copy.type} ${input.typeTitle.text}`,
    '',
    `${copy.action}: ${input.membershipUrl}`,
    '',
    copy.note,
    '',
    copy.signature,
  ].join('\n');

  return { recipient: input.recipient, subject: copy.subject, html, text };
}
