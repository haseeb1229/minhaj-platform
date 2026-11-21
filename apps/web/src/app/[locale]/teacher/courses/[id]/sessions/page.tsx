import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

import {
  MyListBeyond,
  MyListPager,
  MyListRefused,
  MyListStatus,
} from '@/components/my/list-parts';
import {
  myListHref,
  myListOffset,
  myListRange,
  readMyList,
} from '@/components/my/list-view';
import { learningRead } from '@/components/my-learning/read';
import {
  CourseFrame,
  CourseUnavailable,
  readTeacherCourse,
} from '@/components/teacher/course-frame';
import { teacherList, TEACHER_PAGING } from '@/components/teacher/list-view';
import { teacherPageMetadata } from '@/components/teacher/metadata';
import { NotActivated, pagerWords, TeacherSection } from '@/components/teacher/parts';
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
 * the teacher's 62-day calendar, and every past one with its attendance
 * counts.
 *
 * UPCOMING: BOUNDED, AND SAYS SO. Upcoming classes are read for THIS Course
 * only, a bounded number of pages; when the bound is reached the page says
 * more may exist and links the calendar.
 *
 * PAST: COUNTED AND NUMBERED (Teacher area, R2). Learning narrows the
 * attendance report to this Course and counts it under the same predicate,
 * so the past classes say "Showing 1–24 of 40 past classes" and number their
 * pages by `?page=` — where Phase 23 read four pages of every Course's report
 * and kept this one's (historical). Untidy spellings are one redirect, after
 * the Course is known to be the teacher's.
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

export default async function CourseSessionsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const path = localizedPath(
    locale,
    `/teacher/courses/${encodeURIComponent(id)}/sessions`,
  );
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;
  const my = await getTranslations({ locale, namespace: 'my' });

  const read = await readTeacherCourse(gate.actor, id);
  if (!read.ok) return <CourseUnavailable locale={locale} t={t} />;
  const { course } = read;
  const accountZone = gate.session.account.timezone;

  if (course.format !== 'live')
    return (
      <CourseFrame course={course} view="sessions" locale={locale} t={t}>
        <EmptyState icon="book">{t('course.notLive')}</EmptyState>
      </CourseFrame>
    );

  const spec = teacherList<never>(path);
  const asked = readMyList(spec, await searchParams);
  if (asked.outcome === 'redirect') redirect(asked.to);
  if (asked.outcome === 'refused')
    return (
      <CourseFrame course={course} view="sessions" locale={locale} t={t}>
        <MyListRefused
          title={my('list.refusedTitle')}
          text={my('list.refused')}
          all={path}
          allText={my('list.all')}
        />
      </CourseFrame>
    );
  const { view } = asked;

  const { teaching } = learningRuntime();
  const [upcoming, past] = await Promise.all([
    learningRead('teaching-course-upcoming', () =>
      collectPages(
        (offset) => teaching.calendar(gate.actor, null, offset, course.id),
        CALENDAR_PAGES,
      ),
    ),
    learningRead('teaching-course-past', () =>
      teaching.attendanceReport(gate.actor, myListOffset(view.page, TEACHER_PAGING), {
        courseId: course.id,
      }),
    ),
  ]);
  const now = new Date();
  const zone = ownZone(accountZone);
  const number = new Intl.NumberFormat(locale);
  const range = past.ok
    ? myListRange(view.page, past.value.items.length, TEACHER_PAGING)
    : null;

  return (
    <CourseFrame course={course} view="sessions" locale={locale} t={t}>
      <TeacherSection
        id="course-upcoming"
        heading={t('course.upcoming')}
        intro={t('course.upcomingHelp')}
      >
        {!upcoming.ok ? (
          <Alert tone="error">{t('failure.load')}</Alert>
        ) : upcoming.value.items.length === 0 ? (
          <EmptyState icon="calendar">{t('course.upcomingEmpty')}</EmptyState>
        ) : (
          <Agenda label={t('course.upcoming')}>
            {upcoming.value.items.map((entry) => (
              <SessionRow
                key={entry.session.id}
                view={entry}
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
        ) : past.value.items.length === 0 ? (
          past.value.total > 0 ? (
            <MyListBeyond
              text={my('list.beyond')}
              first={myListHref(spec, { page: 1, filter: null })}
              firstText={my('list.first')}
            />
          ) : (
            <EmptyState icon="list">{t('course.pastEmpty')}</EmptyState>
          )
        ) : (
          <>
            {range === null ? null : (
              <MyListStatus>
                {t('count.reports', {
                  from: number.format(range.from),
                  to: number.format(range.to),
                  total: past.value.total,
                })}
              </MyListStatus>
            )}
            <ReportTable
              rows={past.value.items}
              locale={locale}
              accountZone={accountZone}
              t={t}
            />
            <MyListPager
              label={t('course.past')}
              spec={spec}
              view={view}
              total={past.value.total}
              locale={locale}
              words={pagerWords(t, my)}
            />
          </>
        )}
      </TeacherSection>
    </CourseFrame>
  );
}
