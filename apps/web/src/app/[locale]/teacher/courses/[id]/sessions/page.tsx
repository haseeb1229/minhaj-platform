import { getTranslations } from 'next-intl/server';

import { learningRead } from '@/components/my-learning/read';
import {
  CourseFrame,
  CourseUnavailable,
  readTeacherCourse,
} from '@/components/teacher/course-frame';
import { NotActivated } from '@/components/teacher/parts';
import { collectPages } from '@/components/teacher/read';
import { ReportTable } from '@/components/teacher/report-table';
import { SessionCard } from '@/components/teacher/session-card';
import { Alert, EmptyState, SectionHeading, TextLink } from '@/components/ui';
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
export const metadata = { robots: { index: false, follow: false } };

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
    `/${locale}/teacher/courses/${encodeURIComponent(id)}/sessions`,
  );
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const read = await readTeacherCourse(gate.actor, id);
  if (!read.ok) return <CourseUnavailable locale={locale} t={t} />;
  const { course } = read;
  const accountZone = gate.session.account.timezone;

  if (course.format !== 'live')
    return (
      <CourseFrame
        course={course}
        heading={t('course.sessionsTitle')}
        locale={locale}
        t={t}
      >
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

  return (
    <CourseFrame
      course={course}
      heading={t('course.sessionsTitle')}
      locale={locale}
      t={t}
    >
      <section className="flex flex-col gap-3" aria-labelledby="course-upcoming">
        <span id="course-upcoming">
          <SectionHeading>{t('course.upcoming')}</SectionHeading>
        </span>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('course.upcomingHelp')}
        </p>
        {!upcoming.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : mine(upcoming.value.items).length === 0 ? (
          <EmptyState>{t('course.upcomingEmpty')}</EmptyState>
        ) : (
          <ol className="flex flex-col gap-3" aria-label={t('course.upcoming')}>
            {mine(upcoming.value.items).map((view) => (
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
        {upcoming.ok && upcoming.value.truncated ? (
          <p className="text-sm">
            {t('course.upcomingMore')}{' '}
            <TextLink href={`/${locale}/teacher/calendar`}>{t('nav.calendar')}</TextLink>
          </p>
        ) : null}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="course-past">
        <span id="course-past">
          <SectionHeading>{t('course.past')}</SectionHeading>
        </span>
        <p className="text-sm text-[color:var(--color-foreground-muted)]">
          {t('course.pastHelp')}
        </p>
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
      </section>
    </CourseFrame>
  );
}
