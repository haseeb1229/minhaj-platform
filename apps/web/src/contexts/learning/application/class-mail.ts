import 'server-only';

import type { Locale } from '@minhaj/contracts';
import type { ClassCommunicationPurpose } from '@minhaj/contracts/learning';
import type { ResolvedDelivery } from '@minhaj/contracts/platform';

/**
 * What Learning's class mail SAYS (ARCHITECTURE.md §4.6.1): a trial confirmed,
 * a class moved, a class cancelled, a class reminder — to a learner or to the
 * teacher. Learning owns the words; the shared email concern sends them.
 *
 * NO MEETING ADDRESS, EVER. Every message links to the person's own private
 * class page — `/my/classes/{id}` or `/teacher/classes/today/{id}` — where
 * the join link is read under the disclosure rule by a signed-in participant.
 * A raw Meet address in a mailbox would be a copy outside every control
 * (SECURITY_BASELINE.md §11). The message carries no Course title, no name
 * and no participant: a locale, a time in the class's own zone, and a link.
 *
 * LOCALISED AT SEND TIME in the recipient's CURRENT interface locale, which
 * Identity resolves with the address; the time is written in the zone the
 * class was scheduled in, named, so the reader in another zone is not misled.
 *
 * NO RELIGIOUS OR ORGANISATIONAL CLAIM appears here: these are service
 * messages about a class the person asked for or teaches.
 */

interface Copy {
  readonly subject: string;
  readonly greeting: string;
  readonly body: string;
  readonly when: string;
  readonly action: string;
  readonly note: string;
  readonly signature: string;
}

type Audience = 'learner' | 'teacher';

const COPY: Readonly<
  Record<
    ClassCommunicationPurpose,
    Readonly<Record<Audience, Readonly<Record<Locale, Copy>>>>
  >
> = {
  'learning.booking-confirmed': {
    learner: {
      en: {
        subject: 'Your trial class is confirmed',
        greeting: 'Assalamu alaikum,',
        body: 'Your trial class request has been confirmed and a class has been scheduled for you.',
        when: 'When:',
        action: 'Open your class in My Minhaj',
        note: 'The join link is shown on your class page shortly before the class, once you are signed in. You can cancel the trial from the same page.',
        signature: 'Minhaj',
      },
      ur: {
        subject: 'آپ کی آزمائشی کلاس کی تصدیق ہو گئی',
        greeting: 'السلام علیکم،',
        body: 'آپ کی آزمائشی کلاس کی درخواست کی تصدیق ہو گئی ہے اور آپ کے لیے ایک کلاس طے کر دی گئی ہے۔',
        when: 'وقت:',
        body2: '',
        action: 'اپنی کلاس مائی منہاج میں کھولیں',
        note: 'شمولیت کا لنک کلاس سے کچھ دیر پہلے، سائن ان کے بعد، آپ کے کلاس کے صفحے پر دکھایا جائے گا۔ اسی صفحے سے آپ آزمائشی کلاس منسوخ بھی کر سکتے ہیں۔',
        signature: 'منہاج',
      } as Copy,
      ar: {
        subject: 'تم تأكيد حصتك التجريبية',
        greeting: 'السلام عليكم،',
        body: 'تم تأكيد طلب الحصة التجريبية وتمت جدولة حصة لك.',
        when: 'الموعد:',
        action: 'افتح حصتك في "منهاجي"',
        note: 'يظهر رابط الانضمام على صفحة حصتك قبل موعدها بقليل بعد تسجيل الدخول. ويمكنك إلغاء الحصة التجريبية من الصفحة نفسها.',
        signature: 'منهاج',
      },
    },
    teacher: {
      en: {
        subject: 'A trial class has been booked with you',
        greeting: 'Assalamu alaikum,',
        body: 'A trial class has been confirmed on one of your windows.',
        when: 'When:',
        action: 'Open the class in your Teacher area',
        note: 'Add or check the meeting link on the class page before it starts.',
        signature: 'Minhaj',
      },
      ur: {
        subject: 'آپ کے ساتھ ایک آزمائشی کلاس طے ہوئی ہے',
        greeting: 'السلام علیکم،',
        body: 'آپ کے ایک دستیاب وقت پر ایک آزمائشی کلاس کی تصدیق ہو گئی ہے۔',
        when: 'وقت:',
        action: 'کلاس اپنے ٹیچر ایریا میں کھولیں',
        note: 'کلاس شروع ہونے سے پہلے کلاس کے صفحے پر میٹنگ لنک شامل کریں یا جانچ لیں۔',
        signature: 'منہاج',
      },
      ar: {
        subject: 'تم حجز حصة تجريبية معك',
        greeting: 'السلام عليكم،',
        body: 'تم تأكيد حصة تجريبية في أحد أوقاتك المتاحة.',
        when: 'الموعد:',
        action: 'افتح الحصة في منطقة المعلّم',
        note: 'أضف رابط الاجتماع أو تحقق منه على صفحة الحصة قبل بدئها.',
        signature: 'منهاج',
      },
    },
  },
  'learning.session-rescheduled': {
    learner: {
      en: {
        subject: 'Your class has moved to a new time',
        greeting: 'Assalamu alaikum,',
        body: 'One of your classes has been rescheduled. Its new time is below; any earlier reminder no longer applies.',
        when: 'New time:',
        action: 'Open your class in My Minhaj',
        note: 'The join link is shown on your class page shortly before the class, once you are signed in.',
        signature: 'Minhaj',
      },
      ur: {
        subject: 'آپ کی کلاس کا وقت بدل گیا ہے',
        greeting: 'السلام علیکم،',
        body: 'آپ کی ایک کلاس کا وقت تبدیل کر دیا گیا ہے۔ نیا وقت نیچے درج ہے؛ پہلے کی کوئی یاد دہانی اب لاگو نہیں ہوتی۔',
        when: 'نیا وقت:',
        action: 'اپنی کلاس مائی منہاج میں کھولیں',
        note: 'شمولیت کا لنک کلاس سے کچھ دیر پہلے، سائن ان کے بعد، آپ کے کلاس کے صفحے پر دکھایا جائے گا۔',
        signature: 'منہاج',
      },
      ar: {
        subject: 'تغيّر موعد حصتك',
        greeting: 'السلام عليكم،',
        body: 'أُعيدت جدولة إحدى حصصك. موعدها الجديد أدناه، ولم يعد أي تذكير سابق ساريًا.',
        when: 'الموعد الجديد:',
        action: 'افتح حصتك في "منهاجي"',
        note: 'يظهر رابط الانضمام على صفحة حصتك قبل موعدها بقليل بعد تسجيل الدخول.',
        signature: 'منهاج',
      },
    },
    teacher: {
      en: {
        subject: 'One of your classes has moved',
        greeting: 'Assalamu alaikum,',
        body: 'One of your classes has been rescheduled. Its new time is below.',
        when: 'New time:',
        action: 'Open the class in your Teacher area',
        note: 'Check the meeting link on the class page before it starts.',
        signature: 'Minhaj',
      },
      ur: {
        subject: 'آپ کی ایک کلاس کا وقت بدل گیا ہے',
        greeting: 'السلام علیکم،',
        body: 'آپ کی ایک کلاس کا وقت تبدیل کر دیا گیا ہے۔ نیا وقت نیچے درج ہے۔',
        when: 'نیا وقت:',
        action: 'کلاس اپنے ٹیچر ایریا میں کھولیں',
        note: 'کلاس شروع ہونے سے پہلے کلاس کے صفحے پر میٹنگ لنک جانچ لیں۔',
        signature: 'منہاج',
      },
      ar: {
        subject: 'تغيّر موعد إحدى حصصك',
        greeting: 'السلام عليكم،',
        body: 'أُعيدت جدولة إحدى حصصك. موعدها الجديد أدناه.',
        when: 'الموعد الجديد:',
        action: 'افتح الحصة في منطقة المعلّم',
        note: 'تحقق من رابط الاجتماع على صفحة الحصة قبل بدئها.',
        signature: 'منهاج',
      },
    },
  },
  'learning.session-cancelled': {
    learner: {
      en: {
        subject: 'Your class has been cancelled',
        greeting: 'Assalamu alaikum,',
        body: 'One of your classes has been cancelled. It will not take place at the time below.',
        when: 'Was scheduled for:',
        action: 'See your classes in My Minhaj',
        note: 'If this was a trial class, you can ask for another from the course page.',
        signature: 'Minhaj',
      },
      ur: {
        subject: 'آپ کی کلاس منسوخ ہو گئی ہے',
        greeting: 'السلام علیکم،',
        body: 'آپ کی ایک کلاس منسوخ کر دی گئی ہے۔ یہ نیچے دیے گئے وقت پر منعقد نہیں ہوگی۔',
        when: 'طے شدہ وقت تھا:',
        action: 'اپنی کلاسیں مائی منہاج میں دیکھیں',
        note: 'اگر یہ آزمائشی کلاس تھی تو آپ کورس کے صفحے سے دوبارہ درخواست کر سکتے ہیں۔',
        signature: 'منہاج',
      },
      ar: {
        subject: 'أُلغيت حصتك',
        greeting: 'السلام عليكم،',
        body: 'أُلغيت إحدى حصصك، ولن تُعقد في الموعد أدناه.',
        when: 'كان موعدها:',
        action: 'اطّلع على حصصك في "منهاجي"',
        note: 'إن كانت حصة تجريبية، يمكنك طلب حصة أخرى من صفحة المساق.',
        signature: 'منهاج',
      },
    },
    teacher: {
      en: {
        subject: 'One of your classes has been cancelled',
        greeting: 'Assalamu alaikum,',
        body: 'One of your classes has been cancelled and will not take place at the time below.',
        when: 'Was scheduled for:',
        action: 'See your classes in your Teacher area',
        note: 'Nothing further is needed from you for this class.',
        signature: 'Minhaj',
      },
      ur: {
        subject: 'آپ کی ایک کلاس منسوخ ہو گئی ہے',
        greeting: 'السلام علیکم،',
        body: 'آپ کی ایک کلاس منسوخ کر دی گئی ہے اور نیچے دیے گئے وقت پر منعقد نہیں ہوگی۔',
        when: 'طے شدہ وقت تھا:',
        action: 'اپنی کلاسیں اپنے ٹیچر ایریا میں دیکھیں',
        note: 'اس کلاس کے لیے آپ سے مزید کچھ درکار نہیں۔',
        signature: 'منہاج',
      },
      ar: {
        subject: 'أُلغيت إحدى حصصك',
        greeting: 'السلام عليكم،',
        body: 'أُلغيت إحدى حصصك ولن تُعقد في الموعد أدناه.',
        when: 'كان موعدها:',
        action: 'اطّلع على حصصك في منطقة المعلّم',
        note: 'لا يلزمك شيء آخر لهذه الحصة.',
        signature: 'منهاج',
      },
    },
  },
  'learning.class-reminder': {
    learner: {
      en: {
        subject: 'Reminder: your class is coming up',
        greeting: 'Assalamu alaikum,',
        body: 'This is a reminder that one of your classes is coming up.',
        when: 'When:',
        action: 'Open your class in My Minhaj',
        note: 'The join link is on your class page once you are signed in.',
        signature: 'Minhaj',
      },
      ur: {
        subject: 'یاد دہانی: آپ کی کلاس قریب ہے',
        greeting: 'السلام علیکم،',
        body: 'یہ یاد دہانی ہے کہ آپ کی ایک کلاس قریب ہے۔',
        when: 'وقت:',
        action: 'اپنی کلاس مائی منہاج میں کھولیں',
        note: 'سائن ان کے بعد شمولیت کا لنک آپ کے کلاس کے صفحے پر موجود ہے۔',
        signature: 'منہاج',
      },
      ar: {
        subject: 'تذكير: اقترب موعد حصتك',
        greeting: 'السلام عليكم،',
        body: 'هذا تذكير بأن إحدى حصصك قد اقترب موعدها.',
        when: 'الموعد:',
        action: 'افتح حصتك في "منهاجي"',
        note: 'رابط الانضمام موجود على صفحة حصتك بعد تسجيل الدخول.',
        signature: 'منهاج',
      },
    },
    teacher: {
      en: {
        subject: 'Reminder: you have a class coming up',
        greeting: 'Assalamu alaikum,',
        body: 'This is a reminder that one of your classes is coming up.',
        when: 'When:',
        action: 'Open the class in your Teacher area',
        note: 'Check the meeting link on the class page before it starts.',
        signature: 'Minhaj',
      },
      ur: {
        subject: 'یاد دہانی: آپ کی کلاس قریب ہے',
        greeting: 'السلام علیکم،',
        body: 'یہ یاد دہانی ہے کہ آپ کی ایک کلاس قریب ہے۔',
        when: 'وقت:',
        action: 'کلاس اپنے ٹیچر ایریا میں کھولیں',
        note: 'کلاس شروع ہونے سے پہلے کلاس کے صفحے پر میٹنگ لنک جانچ لیں۔',
        signature: 'منہاج',
      },
      ar: {
        subject: 'تذكير: لديك حصة قريبة',
        greeting: 'السلام عليكم،',
        body: 'هذا تذكير بأن إحدى حصصك قد اقترب موعدها.',
        when: 'الموعد:',
        action: 'افتح الحصة في منطقة المعلّم',
        note: 'تحقق من رابط الاجتماع على صفحة الحصة قبل بدئها.',
        signature: 'منهاج',
      },
    },
  },
};

function localeOf(value: string): Locale {
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

/** The class time in the zone it was scheduled in, named, in the reader's locale. */
export function describeClassTime(
  startsAt: Date,
  endsAt: Date,
  zone: string,
  locale: Locale,
): string {
  const day = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(startsAt);
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
  return `${day}, ${time.format(startsAt)} – ${time.format(endsAt)} (${zone})`;
}

export function renderClassMail(input: {
  readonly purpose: ClassCommunicationPurpose;
  readonly audience: Audience;
  readonly locale: string;
  readonly recipient: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly timeZone: string;
  /** The person's OWN private class page. Never a meeting address. */
  readonly classUrl: string;
}): ResolvedDelivery {
  const locale = localeOf(input.locale);
  const copy = COPY[input.purpose][input.audience][locale];
  const dir = locale === 'en' ? 'ltr' : 'rtl';
  const when = describeClassTime(input.startsAt, input.endsAt, input.timeZone, locale);
  const link = escapeHtml(input.classUrl);

  const html = `<!doctype html>
<html lang="${locale}" dir="${dir}">
  <body style="margin:0;padding:24px;background:#f6f5f2;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1b1b1b;line-height:1.6">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e3e0d9;border-radius:10px;padding:32px">
      <p style="margin:0 0 16px">${escapeHtml(copy.greeting)}</p>
      <p style="margin:0 0 16px">${escapeHtml(copy.body)}</p>
      <p style="margin:0 0 16px"><strong>${escapeHtml(copy.when)}</strong> ${escapeHtml(when)}</p>
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
    `${copy.when} ${when}`,
    '',
    `${copy.action}: ${input.classUrl}`,
    '',
    copy.note,
    '',
    copy.signature,
  ].join('\n');

  return { recipient: input.recipient, subject: copy.subject, html, text };
}

/** The locales every purpose and audience is authored in. Asserted by test. */
export const CLASS_MAIL_LOCALES: readonly Locale[] = ['en', 'ur', 'ar'];
export const CLASS_MAIL_AUDIENCES: readonly Audience[] = ['learner', 'teacher'];
