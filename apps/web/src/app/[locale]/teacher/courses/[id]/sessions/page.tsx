import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { learningRead } from '@/components/my-learning/read';
import {
  CourseFrame,
  CourseUnavailable,
  readTeacherCourse,
} from '@/components/teacher/course-frame';
import { teacherPageMetadata } from '@/components/teacher/metadata';
import { NotActivated, TeacherSection } from '@/components/teacher/parts';
import { ownZone } from '@/components/teacher/presentation';
import { collectPages } from '@/components/teacher/read';
import { ReportTable } from '@/components/teacher/report-table';
import { Agenda, SessionRow } from '@/components/teacher/schedule';
import { Alert, EmptyState, TextLink } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../../../guard';

/**
 * The classes of one assigned Course (ROUTE_MAP.md §6): the upcoming ones in
 * the teacher's 62-day calendar, and the recent past ones with their
 * attendance counts.
 *
 * BOUNDED, AND SAYS SO. Upcoming classes are read for THIS Course only, a
 * bounded number of pages; past ones come from the attendance report across
 * the teacher's Courses and are kept for this one. When a bound is reached
 * the page says more may exist — it never presents a cut list as complete.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return teacherPageMetadata(params, 'courseSessions');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

const CALENDAR_PAGES = 10;
const REPORT_PAGES = 4;

export default async function CourseSessionsPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const gate = await requireTeacher(
    locale,
    localizedPath(locale, `/teacher/courses/${encodeURIComponent(id)}/sessions`),
  );
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const read = await readTeacherCourse(gate.actor, id);
  if (!read.ok) return <CourseUnavailable locale={locale} t={t} />;
  const { course } = read;
  const accountZone = gate.session.account.timezone;

  if (course.format !== 'live')
    return (
      <CourseFrame course={course} view="sessions" locale={locale} t={t}>
        <EmptyState>{t('course.notLive')}</EmptyState>
      </CourseFrame>
    );

  const { teaching } = learningRuntime();
  const [upcoming, past] = await Promise.all([
    learningRead('teaching-course-upcoming', () =>
      collectPages(
        (offset) => teaching.calendar(gate.actor, null, offset, course.id),
        CALENDAR_PAGES,
      ),
    ),
    learningRead('teaching-course-past', () =>
      collectPages(
        (offset) => teaching.attendanceReport(gate.actor, offset),
        REPORT_PAGES,
      ),
    ),
  ]);
  const mine = <T extends { readonly course: { readonly id: string } }>(
    items: readonly T[],
  ) => items.filter((item) => item.course.id === course.id);
  const now = new Date();
  const zone = ownZone(accountZone);

  return (
    <CourseFrame course={course} view="sessions" locale={locale} t={t}>
      <TeacherSection
        id="course-upcoming"
        heading={t('course.upcoming')}
        intro={t('course.upcomingHelp')}
      >
        {!upcoming.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : mine(upcoming.value.items).length === 0 ? (
          <EmptyState>{t('course.upcomingEmpty')}</EmptyState>
        ) : (
          <Agenda label={t('course.upcoming')}>
            {mine(upcoming.value.items).map((view) => (
              <SessionRow
                key={view.session.id}
                view={view}
                locale={locale}
                zone={zone}
                now={now}
                showDate
                t={t}
              />
            ))}
          </Agenda>
        )}
        {upcoming.ok && upcoming.value.truncated ? (
          <p className="text-sm">
            {t('course.upcomingMore')}{' '}
            <TextLink href={localizedPath(locale, '/teacher/calendar')}>
              {t('nav.calendar')}
            </TextLink>
          </p>
        ) : null}
      </TeacherSection>

      <TeacherSection
        id="course-past"
        heading={t('course.past')}
        intro={t('course.pastHelp')}
      >
        {!past.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : mine(past.value.items).length === 0 ? (
          <EmptyState>{t('course.pastEmpty')}</EmptyState>
        ) : (
          <ReportTable
            rows={mine(past.value.items)}
            locale={locale}
            accountZone={accountZone}
            t={t}
          />
        )}
      </TeacherSection>
    </CourseFrame>
  );
}
