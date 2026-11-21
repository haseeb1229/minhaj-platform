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
import { participantNames } from '@/components/teacher/names';
import { NotActivated, pagerWords } from '@/components/teacher/parts';
import { StudentList } from '@/components/teacher/student-list';
import { Alert, EmptyState } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../../../guard';

/**
 * The learners on one assigned Course (ROUTE_MAP.md §6), a page at a time,
 * with their progress. Learning facts only; listing is audited by the service
 * as identifiers only.
 *
 * ONE ADDRESS PER PAGE (Teacher area, R2): "Showing 1–24 of 30 learners",
 * numbered pages, `?page=`; Phase 23's `?offset=` and every untidy spelling
 * are one redirect — decided after the Course is known to be the teacher's,
 * so a Course they do not teach is still the 404 first.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return teacherPageMetadata(params, 'courseStudents');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function CourseStudentsPage({
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
    `/teacher/courses/${encodeURIComponent(id)}/students`,
  );
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;
  const my = await getTranslations({ locale, namespace: 'my' });

  const course = await readTeacherCourse(gate.actor, id);
  if (!course.ok) return <CourseUnavailable locale={locale} t={t} />;

  const spec = teacherList<never>(path);
  const asked = readMyList(spec, await searchParams);
  if (asked.outcome === 'redirect') redirect(asked.to);
  const frame = {
    course: course.course,
    view: 'students' as const,
    description: <p>{t('students.description')}</p>,
    locale,
    t,
  };
  if (asked.outcome === 'refused')
    return (
      <CourseFrame {...frame}>
        <MyListRefused
          title={my('list.refusedTitle')}
          text={my('list.refused')}
          all={path}
          allText={my('list.all')}
        />
      </CourseFrame>
    );

  const { view } = asked;
  const read = await learningRead('teaching-course-students', () =>
    learningRuntime().teaching.students(
      gate.actor,
      course.course.id,
      myListOffset(view.page, TEACHER_PAGING),
    ),
  );
  const names = read.ok
    ? await participantNames(read.value.items.map((entry) => entry.accountId))
    : new Map<string, string>();
  const number = new Intl.NumberFormat(locale);
  const range = read.ok
    ? myListRange(view.page, read.value.items.length, TEACHER_PAGING)
    : null;

  return (
    <CourseFrame {...frame}>
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
          <EmptyState icon="user" title={t('students.emptyTitle')}>
            {t('students.emptyCourse')}
          </EmptyState>
        )
      ) : (
        <>
          {range === null ? null : (
            <MyListStatus>
              {t('count.students', {
                from: number.format(range.from),
                to: number.format(range.to),
                total: read.value.total,
              })}
            </MyListStatus>
          )}
          <StudentList
            label={t('course.studentsTitle')}
            students={read.value.items}
            names={names}
            locale={locale}
            t={t}
            accountZone={gate.session.account.timezone}
          />
          <MyListPager
            label={t('course.studentsTitle')}
            spec={spec}
            view={view}
            total={read.value.total}
            locale={locale}
            words={pagerWords(t, my)}
          />
        </>
      )}
    </CourseFrame>
  );
}
