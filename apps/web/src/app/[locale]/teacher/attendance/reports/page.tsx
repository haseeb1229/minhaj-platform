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
import { teacherList, TEACHER_PAGING } from '@/components/teacher/list-view';
import { teacherPageMetadata } from '@/components/teacher/metadata';
import {
  NotActivated,
  pagerWords,
  TeacherFrame,
  teacherTrail,
} from '@/components/teacher/parts';
import { attendanceTabs, ReportTable } from '@/components/teacher/report-table';
import { Alert, EmptyState } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../../guard';

/**
 * Attendance reports (ROUTE_MAP.md §6): every past class of the teacher's
 * current scopes, a page at a time, with how many participants were marked
 * present, absent, or not yet — counted by the database, shown as numbers
 * under worded headings, never as colours.
 *
 * COUNTED AND NUMBERED (Teacher area, R2): "Showing 1–24 of 60 past
 * classes", numbered pages and `?page=`; Phase 23's `?offset=` and every
 * untidy spelling are one redirect after the session and the teacher's role.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return teacherPageMetadata(params, 'reports');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function AttendanceReportsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = localizedPath(locale, '/teacher/attendance/reports');
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;
  const my = await getTranslations({ locale, namespace: 'my' });

  const spec = teacherList<never>(path);
  const asked = readMyList(spec, await searchParams);
  if (asked.outcome === 'redirect') redirect(asked.to);
  const frame = {
    title: t('reports.title'),
    description: <p>{t('reports.description')}</p>,
    trail: teacherTrail(locale, t, [
      { href: localizedPath(locale, '/teacher/attendance'), text: t('nav.attendance') },
      { text: t('attendancePage.reports') },
    ]),
    tabs: attendanceTabs('reports', locale, t),
  };
  if (asked.outcome === 'refused')
    return (
      <TeacherFrame {...frame}>
        <MyListRefused
          title={my('list.refusedTitle')}
          text={my('list.refused')}
          all={path}
          allText={my('list.all')}
        />
      </TeacherFrame>
    );

  const { view } = asked;
  const read = await learningRead('teaching-attendance-report', () =>
    learningRuntime().teaching.attendanceReport(
      gate.actor,
      myListOffset(view.page, TEACHER_PAGING),
      {},
    ),
  );
  const number = new Intl.NumberFormat(locale);
  const range = read.ok
    ? myListRange(view.page, read.value.items.length, TEACHER_PAGING)
    : null;

  return (
    <TeacherFrame {...frame}>
      {!read.ok ? (
        <Alert tone="error">{t('failure.load')}</Alert>
      ) : read.value.items.length === 0 ? (
        read.value.total > 0 ? (
          <MyListBeyond
            text={my('list.beyond')}
            first={myListHref(spec, { page: 1, filter: null })}
            firstText={my('list.first')}
          />
        ) : (
          <EmptyState icon="calendar" title={t('reports.empty')}>
            {t('reports.emptyBody')}
          </EmptyState>
        )
      ) : (
        <>
          {range === null ? null : (
            <MyListStatus>
              {t('count.reports', {
                from: number.format(range.from),
                to: number.format(range.to),
                total: read.value.total,
              })}
            </MyListStatus>
          )}
          <ReportTable
            rows={read.value.items}
            locale={locale}
            accountZone={gate.session.account.timezone}
            t={t}
          />
          <MyListPager
            label={t('reports.title')}
            spec={spec}
            view={view}
            total={read.value.total}
            locale={locale}
            words={pagerWords(t, my)}
          />
        </>
      )}
    </TeacherFrame>
  );
}
