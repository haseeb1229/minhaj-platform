import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { learningRead } from '@/components/my-learning/read';
import { teacherPageMetadata } from '@/components/teacher/metadata';
import { NotActivated, TeacherFrame, TeacherSection } from '@/components/teacher/parts';
import { ownZone, single, zoneName } from '@/components/teacher/presentation';
import { collectPages } from '@/components/teacher/read';
import { WeekGrid, WeekLegend, WeekNav, weekTitle } from '@/components/teacher/schedule';
import {
  adjacentWeeks,
  buildWeek,
  dateIn,
  readWeek,
  weekHref,
  weekSpan,
  weekStartOf,
} from '@/components/teacher/week';
import { Alert, EmptyState } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../guard';

/**
 * The calendar (ROUTE_MAP.md §6; R2): ONE WEEK of the teacher's classes and
 * open availability windows, Monday to Sunday in their own zone — seven
 * columns on a wide screen, a list of days on a narrow one — with the way to
 * the weeks either side. `?week=` names any date of the week to show.
 *
 * NOTHING NEW IS READ. The week is the existing calendar read started at the
 * week's first instant and the existing availability read, each walked a
 * bounded number of pages and stopped as soon as it passes the week. A class
 * is a solid block, an open window a dashed one; a booked window is not drawn,
 * because its class already is.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return teacherPageMetadata(params, 'calendar');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

const WEEK_PAGES = 4;
const WINDOW_PAGES = 4;

export default async function CalendarPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = localizedPath(locale, '/teacher/calendar');
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const accountZone = gate.session.account.timezone;
  const zone = ownZone(accountZone);
  const now = new Date();
  const today = dateIn(now, zone);
  const weekStart = readWeek(single(await searchParams, 'week'), today);
  const span = weekSpan(weekStart, zone);
  const { teaching } = learningRuntime();
  const [sessions, windows] = await Promise.all([
    learningRead('teaching-calendar', () =>
      collectPages(
        (offset) => teaching.calendar(gate.actor, span.from, offset),
        WEEK_PAGES,
        (view) => view.session.startsAt.getTime() >= span.to.getTime(),
      ),
    ),
    learningRead('teaching-calendar-availability', () =>
      collectPages(
        (offset) => teaching.availability(gate.actor, offset),
        WINDOW_PAGES,
        // Open windows come first, soonest first; then withdrawn ones.
        (window) =>
          window.state !== 'open' || window.startsAt.getTime() >= span.to.getTime(),
      ),
    ),
  ]);

  const title = weekTitle(span.days, locale);
  const adjacent = adjacentWeeks(weekStart, today);
  const nav = (
    <WeekNav
      label={t('week.navLabel')}
      previous={
        adjacent.previous === null ? null : weekHref(path, adjacent.previous, today)
      }
      current={weekStart === weekStartOf(today) ? null : path}
      next={adjacent.next === null ? null : weekHref(path, adjacent.next, today)}
      t={t}
    />
  );
  const description = (
    <p>{t('calendar.description', { zone: zoneName(zone, span.from, locale) })}</p>
  );

  if (!sessions.ok)
    return (
      <TeacherFrame title={t('calendar.title')} description={description} action={nav}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </TeacherFrame>
    );

  const open = windows.ok
    ? windows.value.items.filter((window) => window.state === 'open' && !window.booked)
    : [];
  const days = buildWeek({
    span,
    zone,
    today,
    sessions: sessions.value.items,
    windows: open,
  });
  const empty = days.every((day) => day.sessions.length + day.windows.length === 0);
  const later = sessions.value.items.find(
    (view) =>
      view.session.state === 'scheduled' &&
      view.session.startsAt.getTime() >= span.to.getTime(),
  );

  return (
    <TeacherFrame title={t('calendar.title')} description={description} action={nav}>
      {accountZone === null ? <Alert tone="info">{t('common.noTimeZone')}</Alert> : null}
      {windows.ok ? null : <Alert tone="error">{t('calendar.windowsUnavailable')}</Alert>}

      <TeacherSection id="calendar-week" heading={title}>
        {empty ? (
          <EmptyState
            icon="calendar"
            title={t('calendar.empty')}
            {...(later === undefined
              ? {}
              : {
                  action: {
                    href: weekHref(
                      path,
                      weekStartOf(dateIn(later.session.startsAt, zone)),
                      today,
                    ),
                    text: t('calendar.nextWeekWith'),
                  },
                })}
          >
            {t('calendar.emptyBody')}
          </EmptyState>
        ) : (
          <>
            <WeekLegend windows={open.length > 0} t={t} />
            <WeekGrid days={days} locale={locale} zone={zone} now={now} t={t} />
          </>
        )}
        {sessions.value.truncated &&
        sessions.value.items.every(
          (view) => view.session.startsAt.getTime() < span.to.getTime(),
        ) ? (
          <p className="text-sm">{t('calendar.bounded')}</p>
        ) : null}
      </TeacherSection>
    </TeacherFrame>
  );
}
