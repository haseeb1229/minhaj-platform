import { getTranslations } from 'next-intl/server';

import { Pagination } from '@/components/media/parts';
import { learningRead } from '@/components/my-learning/read';
import {
  CourseFrame,
  CourseUnavailable,
  readTeacherCourse,
} from '@/components/teacher/course-frame';
import { participantNames } from '@/components/teacher/names';
import { NotActivated, OwnTime } from '@/components/teacher/parts';
import { pager, readOffset } from '@/components/teacher/presentation';
import { StudentList } from '@/components/teacher/student-list';
import { Alert, EmptyState } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../../../guard';

/**
 * The learners on one assigned Course (ROUTE_MAP.md §6), a bounded page at a
 * time, with their progress. Learning facts only; listing is audited by the
 * service as identifiers only.
 */
export const metadata = { robots: { index: false, follow: false } };

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
  const path = `/${locale}/teacher/courses/${encodeURIComponent(id)}/students`;
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const course = await readTeacherCourse(gate.actor, id);
  if (!course.ok) return <CourseUnavailable locale={locale} t={t} />;

  const offset = readOffset(await searchParams);
  const read = await learningRead('teaching-course-students', () =>
    learningRuntime().teaching.students(gate.actor, course.course.id, offset),
  );
  const names = read.ok
    ? await participantNames(read.value.items.map((entry) => entry.accountId))
    : new Map<string, string>();
  const page = read.ok ? pager(path, offset, read.value.hasMore) : null;

  return (
    <CourseFrame
      course={course.course}
      heading={t('course.studentsTitle')}
      description={<p>{t('students.description')}</p>}
      locale={locale}
      t={t}
    >
      {!read.ok ? (
        <Alert tone="error">{t('failure.load')}</Alert>
      ) : read.value.items.length === 0 ? (
        <EmptyState>{offset === 0 ? t('students.empty') : t('common.beyond')}</EmptyState>
      ) : (
        <StudentList
          label={t('course.studentsTitle')}
          students={read.value.items}
          names={names}
          locale={locale}
          t={t}
          enrolledAt={(at) => (
            <OwnTime
              value={at}
              locale={locale}
              accountZone={gate.session.account.timezone}
            />
          )}
        />
      )}
      {page === null ? null : (
        <Pagination
          label={t('course.studentsTitle')}
          previous={page.previous}
          next={page.next}
          previousLabel={t('common.previous')}
          nextLabel={t('common.next')}
        />
      )}
    </CourseFrame>
  );
}
