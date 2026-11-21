import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';

import {
  MyListBeyond,
  MyListFilters,
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
import { pickLabel } from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import { teacherList, TEACHER_PAGING } from '@/components/teacher/list-view';
import { teacherPageMetadata } from '@/components/teacher/metadata';
import { participantNames } from '@/components/teacher/names';
import {
  NoScope,
  NotActivated,
  pagerWords,
  TeacherFrame,
  teacherTrail,
} from '@/components/teacher/parts';
import { StudentList } from '@/components/teacher/student-list';
import { Alert, EmptyState } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../guard';

/**
 * Students (ROUTE_MAP.md §6; R2): the learners enrolled on the Courses the
 * teacher currently teaches, with each learner's progress on each, a page at
 * a time, and a search by name and by progress over the page shown.
 *
 * ONE ADDRESS PER VIEW (Teacher area, R2). `?course=` narrows to one Course
 * the teacher teaches NOW and `?page=` numbers the pages; the Courses are
 * counted tabs ("All your courses 12", one per Course), the list says
 * "Showing 1–24 of 30 learners", and the pages are numbered. Phase 23's
 * `?offset=` and every untidy spelling are one redirect, after the session
 * and the teacher's role; a Course the teacher does not teach — or one that
 * does not exist, or a malformed one — is refused in place, the same answer
 * for each, and never widened to everyone.
 *
 * LEARNING FACTS ONLY. A name from Identity, an Enrolment and a count of
 * completed lessons from Learning; no address, no notes, no contact. Listing
 * a page is audited by the service as identifiers only (§13.4); the counts
 * name nobody. The search narrows what is already on the page and reads
 * nothing more.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return teacherPageMetadata(params, 'students');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function StudentsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const path = localizedPath(locale, '/teacher/students');
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;
  const my = await getTranslations({ locale, namespace: 'my' });

  const { teaching } = learningRuntime();
  const [courses, counts] = await Promise.all([
    learningRead('teaching-students-courses', () => teaching.courses(gate.actor)),
    learningRead('teaching-students-counts', () => teaching.studentCounts(gate.actor)),
  ]);
  const frame = {
    title: t('students.title'),
    description: <p>{t('students.description')}</p>,
    trail: teacherTrail(locale, t, [{ text: t('nav.students') }]),
  };

  if (!courses.ok)
    return (
      <TeacherFrame {...frame}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </TeacherFrame>
    );
  if (courses.value.length === 0)
    return (
      <TeacherFrame {...frame}>
        <NoScope locale={locale} t={t} />
      </TeacherFrame>
    );

  const spec = teacherList(path, {
    param: 'course',
    values: courses.value.map((entry) => entry.course.id),
  });
  const asked = readMyList(spec, await searchParams);
  if (asked.outcome === 'redirect') redirect(asked.to);
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
  const read = await learningRead('teaching-students', () =>
    teaching.students(gate.actor, view.filter, myListOffset(view.page, TEACHER_PAGING)),
  );
  const names = read.ok
    ? await participantNames(read.value.items.map((entry) => entry.accountId))
    : new Map<string, string>();
  const perCourse = new Map(
    counts.ok
      ? counts.value.courses.map((entry) => [entry.courseId, entry.learners])
      : [],
  );
  const number = new Intl.NumberFormat(locale);
  const range = read.ok
    ? myListRange(view.page, read.value.items.length, TEACHER_PAGING)
    : null;

  return (
    <TeacherFrame {...frame}>
      {counts.ok ? (
        <MyListFilters
          label={t('students.byCourse')}
          spec={spec}
          current={view.filter}
          minimum={3}
          format={(count) => number.format(count)}
          items={[
            {
              value: null,
              text: t('students.allCourses'),
              count: counts.value.total,
            },
            ...courses.value.map(({ course }) => ({
              value: course.id,
              text:
                pickLabel(course.labels, locale, course.primaryLocale)?.title ??
                course.slug,
              count: perCourse.get(course.id) ?? 0,
            })),
          ]}
        />
      ) : null}

      {!read.ok ? (
        <Alert tone="error">{t('failure.load')}</Alert>
      ) : read.value.items.length === 0 ? (
        read.value.total > 0 ? (
          <MyListBeyond
            text={my('list.beyond')}
            first={myListHref(spec, { page: 1, filter: view.filter })}
            firstText={my('list.first')}
          />
        ) : view.filter === null ? (
          <EmptyState icon="user" title={t('students.emptyTitle')}>
            {t('students.empty')}
          </EmptyState>
        ) : (
          <EmptyState icon="user" action={{ href: path, text: t('students.allCourses') }}>
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
            label={t('students.list')}
            students={read.value.items}
            names={names}
            locale={locale}
            accountZone={gate.session.account.timezone}
            t={t}
          />
          <MyListPager
            label={t('students.list')}
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
