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
import { requireTeacher } from '../guard';

/**
 * Attendance still to mark (ROUTE_MAP.md §6): the teacher's past classes with
 * at least one participant not yet marked, most recent first, each opening its
 * marking page. Only classes that have STARTED are listed — the report reads
 * nothing later — so there is never a future class to mark.
 *
 * THE WHOLE LIST, COUNTED (Teacher area, R2). Learning narrows the report to
 * the classes with an unmarked participant and counts them under the same
 * predicate, so the page says "Showing 1–24 of 30 classes to mark" and numbers
 * its pages — where Phase 23 read four pages of every class and kept the
 * unmarked ones, saying older ones might exist (historical). `?page=` is the
 * one address; untidy spellings are one redirect after the session and role.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return teacherPageMetadata(params, 'attendance');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function AttendancePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = localizedPath(locale, '/teacher/attendance');
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;
  const my = await getTranslations({ locale, namespace: 'my' });

  const spec = teacherList<never>(path);
  const asked = readMyList(spec, await searchParams);
  if (asked.outcome === 'redirect') redirect(asked.to);
  const frame = {
    title: t('attendancePage.title'),
    description: <p>{t('attendancePage.description')}</p>,
    trail: teacherTrail(locale, t, [{ text: t('nav.attendance') }]),
    tabs: attendanceTabs('pending', locale, t),
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
  const read = await learningRead('teaching-attendance-pending', () =>
    learningRuntime().teaching.attendanceReport(
      gate.actor,
      myListOffset(view.page, TEACHER_PAGING),
      { unmarked: true },
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
          <EmptyState
            icon="check"
            title={t('attendancePage.empty')}
            action={{
              href: localizedPath(locale, '/teacher/attendance/reports'),
              text: t('attendancePage.reports'),
            }}
          >
            {t('attendancePage.emptyBody')}
          </EmptyState>
        )
      ) : (
        <>
          {range === null ? null : (
            <MyListStatus>
              {t('count.toMark', {
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
            label={t('attendancePage.pendingTab')}
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
