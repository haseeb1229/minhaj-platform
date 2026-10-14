import 'server-only';

import type { Locale } from '@minhaj/contracts';
import type { ResolvedDelivery } from '@minhaj/contracts/platform';

/**
 * The newsletter confirmation message — Personalisation's own words, rendered
 * at send time (ARCHITECTURE.md §4.6.1). It asks for confirmation and offers a
 * way out; it promises nothing about content, frequency or any law.
 */

interface Copy {
  readonly subject: string;
  readonly greeting: string;
  readonly body: string;
  readonly confirm: string;
  readonly ignore: string;
  readonly unsubscribe: string;
  readonly signature: string;
}

const COPY: Readonly<Record<Locale, Copy>> = {
  en: {
    subject: 'Confirm your newsletter subscription',
    greeting: 'Assalamu alaikum,',
    body: 'Someone asked to receive the Minhaj-ul-Quran newsletter at this address. Nothing is sent until the subscription is confirmed.',
    confirm: 'Confirm subscription',
    ignore:
      'If you did not ask for this, ignore this message and you will not be subscribed. This link stops working after 48 hours.',
    unsubscribe: 'If you change your mind later, you can unsubscribe here:',
    signature: 'Minhaj-ul-Quran International',
  },
  ur: {
    subject: 'اپنی نیوز لیٹر رکنیت کی تصدیق کریں',
    greeting: 'السلام علیکم،',
    body: 'کسی نے اس پتے پر منہاج القرآن کا نیوز لیٹر وصول کرنے کی درخواست کی ہے۔ رکنیت کی تصدیق تک کچھ نہیں بھیجا جائے گا۔',
    confirm: 'رکنیت کی تصدیق کریں',
    ignore:
      'اگر یہ درخواست آپ نے نہیں کی تو اس پیغام کو نظرانداز کر دیں، آپ کی رکنیت نہیں ہوگی۔ یہ لنک 48 گھنٹے بعد کام نہیں کرے گا۔',
    unsubscribe: 'اگر بعد میں آپ کا ارادہ بدل جائے تو یہاں سے رکنیت ختم کر سکتے ہیں:',
    signature: 'منہاج القرآن انٹرنیشنل',
  },
  ar: {
    subject: 'أكّد اشتراكك في النشرة البريدية',
    greeting: 'السلام عليكم،',
    body: 'طلب أحدهم استلام النشرة البريدية لمنهاج القرآن على هذا العنوان. لن يُرسل شيء حتى يتم تأكيد الاشتراك.',
    confirm: 'تأكيد الاشتراك',
    ignore:
      'إذا لم تطلب ذلك، فتجاهل هذه الرسالة ولن يتم اشتراكك. يتوقف هذا الرابط عن العمل بعد 48 ساعة.',
    unsubscribe: 'إذا غيّرت رأيك لاحقًا، يمكنك إلغاء الاشتراك من هنا:',
    signature: 'منهاج القرآن الدولية',
  },
};

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderNewsletterConfirmation(input: {
  readonly locale: Locale;
  readonly recipient: string;
  readonly confirmUrl: string;
  readonly unsubscribeUrl: string;
}): ResolvedDelivery {
  const copy = COPY[input.locale];
  const dir = input.locale === 'en' ? 'ltr' : 'rtl';
  const confirm = escapeHtml(input.confirmUrl);
  const unsubscribe = escapeHtml(input.unsubscribeUrl);

  const html = `<!doctype html>
<html lang="${input.locale}" dir="${dir}">
  <body style="margin:0;padding:24px;background:#f6f5f2;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1b1b1b;line-height:1.6">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e0d9;border-radius:10px;padding:32px">
      <p style="margin:0 0 16px">${escapeHtml(copy.greeting)}</p>
      <p style="margin:0 0 16px">${escapeHtml(copy.body)}</p>
      <p style="margin:24px 0"><a href="${confirm}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:#1f3d2b;color:#ffffff;text-decoration:none">${escapeHtml(copy.confirm)}</a></p>
      <p style="margin:16px 0;color:#5b5b5b;font-size:13px;word-break:break-all">${confirm}</p>
      <p style="margin:24px 0 0;color:#5b5b5b;font-size:13px">${escapeHtml(copy.ignore)}</p>
      <p style="margin:16px 0 0;color:#5b5b5b;font-size:13px">${escapeHtml(copy.unsubscribe)} <a href="${unsubscribe}" style="color:#1f3d2b;word-break:break-all">${unsubscribe}</a></p>
      <p style="margin:24px 0 0;color:#5b5b5b;font-size:13px">${escapeHtml(copy.signature)}</p>
    </div>
  </body>
</html>`;

  const text = [
    copy.greeting,
    '',
    copy.body,
    '',
    `${copy.confirm}: ${input.confirmUrl}`,
    '',
    copy.ignore,
    '',
    copy.unsubscribe,
    input.unsubscribeUrl,
    '',
    copy.signature,
  ].join('\n');

  return { recipient: input.recipient, subject: copy.subject, html, text };
}

/** The locales the message is authored in. Asserted by test. */
export const NEWSLETTER_MAIL_LOCALES = Object.keys(COPY) as readonly Locale[];
