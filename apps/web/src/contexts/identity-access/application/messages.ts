import type { DeliveryPurpose, ResolvedDelivery } from '@minhaj/contracts/platform';

/**
 * What Identity's mail SAYS.
 *
 * The originating context owns "why the communication exists, recipient
 * eligibility, the business event, its domain meaning, and the domain-specific
 * message content". The shared platform concern owns the provider, the
 * sending, and the delivery metadata — and nothing about the words
 * (ARCHITECTURE.md §4.6.1).
 *
 * LOCALISED AT THE EVENT, not at send time. The locale is captured when the
 * intent is committed, so a message about something that happened yesterday
 * arrives in the language the account was using yesterday rather than being
 * retranslated by a later settings change.
 *
 * NO RELIGIOUS OR ORGANISATIONAL CLAIM appears in ordinary authentication
 * copy. These are account-service messages; the platform's content is not.
 */

type Locale = 'en' | 'ur' | 'ar';

interface Copy {
  readonly subject: string;
  readonly greeting: string;
  readonly body: string;
  readonly action?: string;
  readonly ignore: string;
  readonly signature: string;
}

function localeOf(value: string): Locale {
  return value === 'ur' || value === 'ar' ? value : 'en';
}

const COPY: Readonly<Record<DeliveryPurpose, Readonly<Record<Locale, Copy>>>> = {
  'identity.email-verification': {
    en: {
      subject: 'Confirm your email address',
      greeting: 'Assalamu alaikum,',
      body: 'Use the link below to confirm this address for your Minhaj account. The link expires in one hour and can be used once.',
      action: 'Confirm this address',
      ignore:
        'If you did not create an account, you can ignore this message and nothing will happen.',
      signature: 'Minhaj',
    },
    ur: {
      subject: 'اپنا ای میل پتہ تصدیق کریں',
      greeting: 'السلام علیکم،',
      body: 'اپنے منہاج اکاؤنٹ کے لیے اس پتے کی تصدیق کرنے کے لیے نیچے دیا گیا لنک استعمال کریں۔ یہ لنک ایک گھنٹے میں ختم ہو جائے گا اور صرف ایک بار استعمال ہو سکتا ہے۔',
      action: 'اس پتے کی تصدیق کریں',
      ignore:
        'اگر آپ نے اکاؤنٹ نہیں بنایا تو اس پیغام کو نظر انداز کر دیں، کچھ نہیں ہوگا۔',
      signature: 'منہاج',
    },
    ar: {
      subject: 'أكّد عنوان بريدك الإلكتروني',
      greeting: 'السلام عليكم،',
      body: 'استخدم الرابط أدناه لتأكيد هذا العنوان لحسابك في منهاج. تنتهي صلاحية الرابط خلال ساعة واحدة ويمكن استخدامه مرة واحدة فقط.',
      action: 'تأكيد هذا العنوان',
      ignore: 'إذا لم تُنشئ حسابًا، فتجاهل هذه الرسالة ولن يحدث شيء.',
      signature: 'منهاج',
    },
  },

  'identity.password-reset': {
    en: {
      subject: 'Reset your password',
      greeting: 'Assalamu alaikum,',
      body: 'Use the link below to choose a new password. The link expires in one hour and can be used once.',
      action: 'Choose a new password',
      ignore:
        'If you did not ask to reset your password, you can ignore this message. Your password will not change.',
      signature: 'Minhaj',
    },
    ur: {
      subject: 'اپنا پاس ورڈ دوبارہ ترتیب دیں',
      greeting: 'السلام علیکم،',
      body: 'نیا پاس ورڈ منتخب کرنے کے لیے نیچے دیا گیا لنک استعمال کریں۔ یہ لنک ایک گھنٹے میں ختم ہو جائے گا اور صرف ایک بار استعمال ہو سکتا ہے۔',
      action: 'نیا پاس ورڈ منتخب کریں',
      ignore:
        'اگر آپ نے پاس ورڈ دوبارہ ترتیب دینے کی درخواست نہیں کی تو اس پیغام کو نظر انداز کر دیں۔ آپ کا پاس ورڈ تبدیل نہیں ہوگا۔',
      signature: 'منہاج',
    },
    ar: {
      subject: 'إعادة تعيين كلمة المرور',
      greeting: 'السلام عليكم،',
      body: 'استخدم الرابط أدناه لاختيار كلمة مرور جديدة. تنتهي صلاحية الرابط خلال ساعة واحدة ويمكن استخدامه مرة واحدة فقط.',
      action: 'اختيار كلمة مرور جديدة',
      ignore:
        'إذا لم تطلب إعادة تعيين كلمة المرور، فتجاهل هذه الرسالة ولن تتغير كلمة المرور.',
      signature: 'منهاج',
    },
  },

  'identity.email-change': {
    en: {
      subject: 'Confirm your new email address',
      greeting: 'Assalamu alaikum,',
      body: 'Use the link below to confirm this address as the new address for your Minhaj account. The link expires in one hour and can be used once.',
      action: 'Confirm this address',
      ignore:
        'If you did not ask to change your email address, you can ignore this message. Nothing will change.',
      signature: 'Minhaj',
    },
    ur: {
      subject: 'اپنے نئے ای میل پتے کی تصدیق کریں',
      greeting: 'السلام علیکم،',
      body: 'اپنے منہاج اکاؤنٹ کے نئے پتے کے طور پر اس کی تصدیق کے لیے نیچے دیا گیا لنک استعمال کریں۔ یہ لنک ایک گھنٹے میں ختم ہو جائے گا اور صرف ایک بار استعمال ہو سکتا ہے۔',
      action: 'اس پتے کی تصدیق کریں',
      ignore:
        'اگر آپ نے ای میل تبدیل کرنے کی درخواست نہیں کی تو اس پیغام کو نظر انداز کر دیں۔ کچھ تبدیل نہیں ہوگا۔',
      signature: 'منہاج',
    },
    ar: {
      subject: 'أكّد عنوان بريدك الإلكتروني الجديد',
      greeting: 'السلام عليكم،',
      body: 'استخدم الرابط أدناه لتأكيد هذا العنوان بوصفه العنوان الجديد لحسابك في منهاج. تنتهي صلاحية الرابط خلال ساعة واحدة ويمكن استخدامه مرة واحدة فقط.',
      action: 'تأكيد هذا العنوان',
      ignore: 'إذا لم تطلب تغيير عنوان بريدك، فتجاهل هذه الرسالة ولن يتغير شيء.',
      signature: 'منهاج',
    },
  },

  'identity.password-changed': {
    en: {
      subject: 'Your password was changed',
      greeting: 'Assalamu alaikum,',
      body: 'The password for your Minhaj account was changed. Every other signed-in device was signed out.',
      ignore:
        'If this was not you, reset your password immediately and review your active sessions.',
      signature: 'Minhaj',
    },
    ur: {
      subject: 'آپ کا پاس ورڈ تبدیل کر دیا گیا',
      greeting: 'السلام علیکم،',
      body: 'آپ کے منہاج اکاؤنٹ کا پاس ورڈ تبدیل کر دیا گیا ہے۔ باقی تمام آلات سے سائن آؤٹ کر دیا گیا ہے۔',
      ignore:
        'اگر یہ آپ نے نہیں کیا تو فوراً اپنا پاس ورڈ دوبارہ ترتیب دیں اور اپنے فعال سیشنز کا جائزہ لیں۔',
      signature: 'منہاج',
    },
    ar: {
      subject: 'تم تغيير كلمة المرور',
      greeting: 'السلام عليكم،',
      body: 'تم تغيير كلمة المرور لحسابك في منهاج، وتم تسجيل الخروج من جميع الأجهزة الأخرى.',
      ignore:
        'إذا لم تكن أنت من قام بذلك، فأعد تعيين كلمة المرور فورًا وراجع جلساتك النشطة.',
      signature: 'منهاج',
    },
  },

  'identity.email-changed': {
    en: {
      subject: 'Your email address was changed',
      greeting: 'Assalamu alaikum,',
      body: 'The email address for your Minhaj account was changed. Every signed-in device was signed out.',
      ignore: 'If this was not you, contact support immediately.',
      signature: 'Minhaj',
    },
    ur: {
      subject: 'آپ کا ای میل پتہ تبدیل کر دیا گیا',
      greeting: 'السلام علیکم،',
      body: 'آپ کے منہاج اکاؤنٹ کا ای میل پتہ تبدیل کر دیا گیا ہے۔ تمام آلات سے سائن آؤٹ کر دیا گیا ہے۔',
      ignore: 'اگر یہ آپ نے نہیں کیا تو فوراً معاونت سے رابطہ کریں۔',
      signature: 'منہاج',
    },
    ar: {
      subject: 'تم تغيير عنوان بريدك الإلكتروني',
      greeting: 'السلام عليكم،',
      body: 'تم تغيير عنوان البريد الإلكتروني لحسابك في منهاج، وتم تسجيل الخروج من جميع الأجهزة.',
      ignore: 'إذا لم تكن أنت من قام بذلك، فاتصل بالدعم فورًا.',
      signature: 'منهاج',
    },
  },

  'identity.account-closed': {
    en: {
      subject: 'Your account was closed',
      greeting: 'Assalamu alaikum,',
      body: 'Your Minhaj account was closed. You can create a new account with this address at any time; it will start fresh and will not carry anything over.',
      ignore: 'If you did not close your account, contact support immediately.',
      signature: 'Minhaj',
    },
    ur: {
      subject: 'آپ کا اکاؤنٹ بند کر دیا گیا',
      greeting: 'السلام علیکم،',
      body: 'آپ کا منہاج اکاؤنٹ بند کر دیا گیا ہے۔ آپ اس پتے کے ساتھ کسی بھی وقت نیا اکاؤنٹ بنا سکتے ہیں؛ وہ بالکل نیا ہوگا اور پرانا کچھ منتقل نہیں ہوگا۔',
      ignore: 'اگر آپ نے اکاؤنٹ بند نہیں کیا تو فوراً معاونت سے رابطہ کریں۔',
      signature: 'منہاج',
    },
    ar: {
      subject: 'تم إغلاق حسابك',
      greeting: 'السلام عليكم،',
      body: 'تم إغلاق حسابك في منهاج. يمكنك إنشاء حساب جديد بهذا العنوان في أي وقت، وسيبدأ من جديد دون نقل أي بيانات سابقة.',
      ignore: 'إذا لم تُغلق حسابك بنفسك، فاتصل بالدعم فورًا.',
      signature: 'منهاج',
    },
  },

  'identity.sessions-revoked': {
    en: {
      subject: 'You were signed out everywhere',
      greeting: 'Assalamu alaikum,',
      body: 'Every signed-in device was signed out of your Minhaj account.',
      ignore: 'If this was not you, reset your password immediately.',
      signature: 'Minhaj',
    },
    ur: {
      subject: 'آپ کو ہر جگہ سے سائن آؤٹ کر دیا گیا',
      greeting: 'السلام علیکم،',
      body: 'آپ کے منہاج اکاؤنٹ سے تمام آلات کو سائن آؤٹ کر دیا گیا ہے۔',
      ignore: 'اگر یہ آپ نے نہیں کیا تو فوراً اپنا پاس ورڈ دوبارہ ترتیب دیں۔',
      signature: 'منہاج',
    },
    ar: {
      subject: 'تم تسجيل خروجك من كل الأجهزة',
      greeting: 'السلام عليكم،',
      body: 'تم تسجيل الخروج من جميع الأجهزة المرتبطة بحسابك في منهاج.',
      ignore: 'إذا لم تكن أنت من قام بذلك، فأعد تعيين كلمة المرور فورًا.',
      signature: 'منهاج',
    },
  },
};

/** Escapes text for interpolation into the HTML body. */
function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Renders one message.
 *
 * `dir` is derived from the locale rather than guessed, so Urdu and Arabic mail
 * renders right-to-left in the client as well as in the application
 * (ARCHITECTURE.md §9).
 */
export function renderMessage(input: {
  readonly purpose: DeliveryPurpose;
  readonly locale: string;
  readonly recipient: string;
  readonly actionUrl?: string;
}): ResolvedDelivery {
  const locale = localeOf(input.locale);
  const copy = COPY[input.purpose][locale];
  const dir = locale === 'en' ? 'ltr' : 'rtl';

  const action =
    input.actionUrl !== undefined && copy.action !== undefined
      ? `<p style="margin:24px 0"><a href="${escapeHtml(input.actionUrl)}" style="display:inline-block;padding:12px 20px;border-radius:6px;background:#1f3d2b;color:#ffffff;text-decoration:none">${escapeHtml(copy.action)}</a></p>
         <p style="margin:16px 0;color:#5b5b5b;font-size:13px;word-break:break-all">${escapeHtml(input.actionUrl)}</p>`
      : '';

  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
  <body style="margin:0;padding:24px;background:#f6f5f2;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1b1b1b;line-height:1.6">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e0d9;border-radius:10px;padding:32px">
      <p style="margin:0 0 16px">${escapeHtml(copy.greeting)}</p>
      <p style="margin:0 0 16px">${escapeHtml(copy.body)}</p>
      ${action}
      <p style="margin:24px 0 0;color:#5b5b5b;font-size:13px">${escapeHtml(copy.ignore)}</p>
      <p style="margin:24px 0 0;color:#5b5b5b;font-size:13px">${escapeHtml(copy.signature)}</p>
    </div>
  </body>
</html>`;

  const text = [
    copy.greeting,
    '',
    copy.body,
    ...(input.actionUrl === undefined ? [] : ['', input.actionUrl]),
    '',
    copy.ignore,
    '',
    copy.signature,
  ].join('\n');

  return { recipient: input.recipient, subject: copy.subject, html, text };
}

/** The locales every message is authored in. Asserted by test. */
export const MESSAGE_LOCALES: readonly Locale[] = ['en', 'ur', 'ar'];

/** The purposes Identity sends. Asserted by test against the copy table. */
export const MESSAGE_PURPOSES = Object.keys(COPY) as readonly DeliveryPurpose[];
