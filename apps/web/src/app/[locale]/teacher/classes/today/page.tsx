import { getTranslations } from 'next-intl/server';

import { learningRead } from '@/components/my-learning/read';
import { NotActivated, TeacherFrame } from '@/components/teacher/parts';
import { dayBounds, ownZone } from '@/components/teacher/presentation';
import { SessionCard } from '@/components/teacher/session-card';
import { Alert, EmptyState } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../../guard';

/**
 * Today's classes (ROUTE_MAP.md §6): every class of the teacher's current
 * scopes that starts within the calendar day holding "now" in THEIR OWN zone
 * — a 23-, 24- or 25-hour day as that zone has it — each with the time it was
 * scheduled in beside the teacher's own reading of it.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function TodayPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const gate = await requireTeacher(locale, `/${locale}/teacher/classes/today`);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const accountZone = gate.session.account.timezone;
  const day = dayBounds(new Date(), ownZone(accountZone));
  const read = await learningRead('teaching-today', () =>
    learningRuntime().teaching.today(gate.actor, day.from, day.to),
  );

  return (
    <TeacherFrame title={t('today.title')} description={<p>{t('today.description')}</p>}>
      {accountZone === null ? <Alert tone="info">{t('common.noTimeZone')}</Alert> : null}
      {!read.ok ? (
        <Alert tone="error">{t('failure.load')}</Alert>
      ) : read.value.items.length === 0 ? (
        <EmptyState>{t('today.empty')}</EmptyState>
      ) : (
        <ol className="flex flex-col gap-3" aria-label={t('today.list')}>
          {read.value.items.map((view) => (
            <SessionCard
              key={view.session.id}
              view={view}
              locale={locale}
              accountZone={accountZone}
              t={t}
            />
          ))}
        </ol>
      )}
    </TeacherFrame>
  );
}
