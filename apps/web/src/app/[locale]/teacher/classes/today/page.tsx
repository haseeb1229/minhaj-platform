import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { MyListStatus } from '@/components/my/list-parts';
import { learningRead } from '@/components/my-learning/read';
import { classStage } from '@/components/teacher/class-stage';
import { teacherPageMetadata } from '@/components/teacher/metadata';
import { NotActivated, TeacherFrame, teacherTrail } from '@/components/teacher/parts';
import { dayBounds, ownZone } from '@/components/teacher/presentation';
import { todaysJoinLinks } from '@/components/teacher/read';
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
 *
 * TODAY'S JOIN LINKS (Teacher area, R2). Each scheduled class of today that
 * holds a meeting link offers "Join on Google Meet" — the address read by the
 * one disclosure operation for that class (`todaysJoinLinks`), as a described
 * external link, never text — and a class in progress offers it first. The
 * page says how many classes the day holds, and how many are under way or
 * still to come (only when the day's one read holds them all); and, on a
 * free day, where the next class is.
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
  const { teaching } = learningRuntime();
  const read = await learningRead('teaching-today', async () => {
    const page = await teaching.today(gate.actor, day.from, day.to);
    return { page, joins: await todaysJoinLinks(gate.actor, page.items) };
  });
  const calendar = localizedPath(locale, '/teacher/calendar');
  const next =
    read.ok && read.value.page.items.length === 0
      ? await learningRead('teaching-today-next', () =>
          teaching.calendar(gate.actor, day.to, 0),
        )
      : null;
  const after =
    next?.ok === true
      ? next.value.items.find((view) => view.session.state === 'scheduled')
      : undefined;

  return (
    <TeacherFrame
      title={t('today.title')}
      trail={teacherTrail(locale, t, [{ text: t('nav.today') }])}
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
      ) : read.value.page.items.length === 0 ? (
        <EmptyState
          icon="calendar"
          title={t('today.empty')}
          action={
            after === undefined
              ? { href: calendar, text: t('today.emptyAction') }
              : {
                  href: localizedPath(
                    locale,
                    `/teacher/classes/today/${encodeURIComponent(after.session.id)}`,
                  ),
                  text: t('today.nextClass', {
                    when: new Intl.DateTimeFormat(locale, {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'long',
                      hour: 'numeric',
                      minute: '2-digit',
                      timeZone: zone,
                    }).format(after.session.startsAt),
                  }),
                }
          }
        >
          {t('today.emptyBody')}
        </EmptyState>
      ) : (
        <>
          {read.value.page.hasMore ? null : (
            <MyListStatus>
              {t('count.today', {
                count: read.value.page.items.length,
                ahead: read.value.page.items.filter((view) => {
                  const stage = classStage(view.session, now);
                  return stage === 'upcoming' || stage === 'live';
                }).length,
              })}
            </MyListStatus>
          )}
          <Agenda label={t('today.list')}>
            {read.value.page.items.map((view) => (
              <SessionRow
                key={view.session.id}
                view={view}
                locale={locale}
                zone={zone}
                now={now}
                joinUrl={read.value.joins.get(view.session.id) ?? null}
                t={t}
              />
            ))}
          </Agenda>
        </>
      )}
    </TeacherFrame>
  );
}
