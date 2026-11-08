import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { learningRead } from '@/components/my-learning/read';
import { teacherPageMetadata } from '@/components/teacher/metadata';
import { NotActivated, TeacherFrame } from '@/components/teacher/parts';
import { dayBounds, ownZone } from '@/components/teacher/presentation';
import { Agenda, SessionRow } from '@/components/teacher/schedule';
import { ActionLink, Alert, EmptyState } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../../guard';

/**
 * Today's classes (ROUTE_MAP.md §6): every class of the teacher's current
 * scopes that starts within the calendar day holding "now" in THEIR OWN zone
 * — a 23-, 24- or 25-hour day as that zone has it — as an agenda: the time,
 * the Course, where the class stands, whether learners can join yet, and,
 * once a class has begun, the way to take its attendance.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return teacherPageMetadata(params, 'today');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function TodayPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const gate = await requireTeacher(
    locale,
    localizedPath(locale, '/teacher/classes/today'),
  );
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const accountZone = gate.session.account.timezone;
  const zone = ownZone(accountZone);
  const now = new Date();
  const day = dayBounds(now, zone);
  const read = await learningRead('teaching-today', () =>
    learningRuntime().teaching.today(gate.actor, day.from, day.to),
  );
  const calendar = localizedPath(locale, '/teacher/calendar');

  return (
    <TeacherFrame
      title={t('today.title')}
      description={
        <p>
          {new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeZone: zone }).format(
            now,
          )}
          {' · '}
          {t('today.description')}
        </p>
      }
      action={
        <ActionLink href={calendar} tone="secondary">
          {t('home.openCalendar')}
        </ActionLink>
      }
    >
      {accountZone === null ? <Alert tone="info">{t('common.noTimeZone')}</Alert> : null}
      {!read.ok ? (
        <Alert tone="error">{t('failure.load')}</Alert>
      ) : read.value.items.length === 0 ? (
        <EmptyState
          icon="calendar"
          title={t('today.empty')}
          action={{ href: calendar, text: t('today.emptyAction') }}
        >
          {t('today.emptyBody')}
        </EmptyState>
      ) : (
        <Agenda label={t('today.list')}>
          {read.value.items.map((view) => (
            <SessionRow
              key={view.session.id}
              view={view}
              locale={locale}
              zone={zone}
              now={now}
              t={t}
            />
          ))}
        </Agenda>
      )}
    </TeacherFrame>
  );
}
