import { getTranslations } from 'next-intl/server';

import { Pagination } from '@/components/media/parts';
import { pickLabel } from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import { participantNames } from '@/components/teacher/names';
import { NotActivated, OwnTime, TeacherFrame } from '@/components/teacher/parts';
import { pager, readCourseFilter, readOffset } from '@/components/teacher/presentation';
import { StudentList } from '@/components/teacher/student-list';
import { Alert, Button, EmptyState, Field, Select } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../guard';

/**
 * Students (ROUTE_MAP.md §6): the learners enrolled on the Courses the
 * teacher currently teaches — a bounded page, optionally narrowed to one of
 * those Courses — with each learner's progress on each.
 *
 * LEARNING FACTS ONLY. A name from Identity, an Enrolment and a count of
 * completed lessons from Learning; no address, no notes, no contact. Listing
 * a page is audited by the service as identifiers only (§13.4).
 */
export const metadata = { robots: { index: false, follow: false } };

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
  const path = `/${locale}/teacher/students`;
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const query = await searchParams;
  const offset = readOffset(query);
  const courseId = readCourseFilter(query);
  const { teaching } = learningRuntime();
  const [courses, read] = await Promise.all([
    learningRead('teaching-students-courses', () => teaching.courses(gate.actor)),
    learningRead('teaching-students', () =>
      teaching.students(gate.actor, courseId, offset),
    ),
  ]);
  // A filter naming a Course the teacher does not teach is simply not applied
  // as a choice; the service answers it with nobody, which is the truth.
  const names = read.ok
    ? await participantNames(read.value.items.map((entry) => entry.accountId))
    : new Map<string, string>();
  const extra = courseId === null ? '' : `course=${courseId}`;
  const page = read.ok ? pager(path, offset, read.value.hasMore, extra) : null;

  return (
    <TeacherFrame
      title={t('students.title')}
      description={<p>{t('students.description')}</p>}
    >
      {courses.ok && courses.value.length > 0 ? (
        <form method="get" action={path} className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 grow basis-64">
            <Field id="students-course" label={t('students.filter')}>
              {(props) => (
                <Select {...props} name="course" defaultValue={courseId ?? ''}>
                  <option value="">{t('students.allCourses')}</option>
                  {courses.value.map((entry) => (
                    <option key={entry.course.id} value={entry.course.id}>
                      {pickLabel(entry.course.labels, locale, entry.course.primaryLocale)
                        ?.title ?? entry.course.slug}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Button tone="secondary">{t('students.apply')}</Button>
        </form>
      ) : null}
      {courseId === null ? null : <p className="text-sm">{t('students.filtered')}</p>}

      {!read.ok ? (
        <Alert tone="error">{t('failure.load')}</Alert>
      ) : read.value.items.length === 0 ? (
        <EmptyState>{offset === 0 ? t('students.empty') : t('common.beyond')}</EmptyState>
      ) : (
        <StudentList
          label={t('students.list')}
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
          label={t('students.list')}
          previous={page.previous}
          next={page.next}
          previousLabel={t('common.previous')}
          nextLabel={t('common.next')}
        />
      )}
    </TeacherFrame>
  );
}
