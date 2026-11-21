import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { LearningTitle } from '@/components/my-learning/parts';
import { pickLabel } from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import { teacherPageMetadata } from '@/components/teacher/metadata';
import { MyFigures } from '@/components/my/summary-parts';
import {
  NoScope,
  NotActivated,
  OwnTime,
  TeacherFrame,
  teacherTrail,
} from '@/components/teacher/parts';
import { Alert, Badge } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../guard';

/**
 * Courses (ROUTE_MAP.md §6): the Courses the teacher CURRENTLY teaches — a
 * current typed scope under a live `teaching.perform` assignment, never a
 * Course's public attribution — each opening its syllabus, students, classes
 * and materials.
 *
 * AT A GLANCE (Teacher area, R2): the trail, the Courses and the learners on
 * them as true figures (Learning's own counts, never a page of a list), and
 * each Course's learners counted on its card. A teacher with no Course meets
 * what happens next, in three steps.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return teacherPageMetadata(params, 'courses');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

const SECTION_LINK =
  'inline-flex min-h-11 items-center rounded-control px-2 text-sm font-medium text-action underline-offset-4 hover:bg-surface-sunken hover:underline';

export default async function TeacherCoursesPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const gate = await requireTeacher(locale, localizedPath(locale, '/teacher/courses'));
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const { teaching } = learningRuntime();
  const [read, counts] = await Promise.all([
    learningRead('teaching-courses', () => teaching.courses(gate.actor)),
    learningRead('teaching-courses-counts', () => teaching.studentCounts(gate.actor)),
  ]);
  const perCourse = new Map(
    counts.ok
      ? counts.value.courses.map((entry) => [entry.courseId, entry.learners])
      : [],
  );
  const number = new Intl.NumberFormat(locale);

  return (
    <TeacherFrame
      title={t('courses.title')}
      description={<p>{t('courses.description')}</p>}
      trail={teacherTrail(locale, t, [{ text: t('nav.courses') }])}
    >
      {!read.ok ? (
        <Alert tone="error">{t('failure.load')}</Alert>
      ) : read.value.length === 0 ? (
        <NoScope locale={locale} t={t} />
      ) : (
        <>
          <MyFigures
            label={t('courses.figures.label')}
            figures={[
              {
                key: 'courses',
                value: number.format(read.value.length),
                label: t('courses.figures.courses'),
              },
              ...(counts.ok
                ? [
                    {
                      key: 'learners',
                      value: number.format(counts.value.total),
                      label: t('courses.figures.learners'),
                      href: localizedPath(locale, '/teacher/students'),
                    },
                  ]
                : []),
            ]}
          />
          <ul
            className="rounded-panel border border-border bg-surface-raised px-4 shadow-panel sm:px-5"
            aria-label={t('courses.list')}
          >
            {read.value.map(({ course, scope }) => {
              const root = localizedPath(
                locale,
                `/teacher/courses/${encodeURIComponent(course.id)}`,
              );
              return (
                <li
                  key={scope.id}
                  className="flex flex-col gap-3 border-b border-border py-5 last:border-b-0 md:flex-row md:items-center md:justify-between md:gap-6"
                >
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <h2 className="text-subheading font-semibold">
                      <a
                        href={root}
                        className="text-foreground underline decoration-border-strong underline-offset-4 hover:decoration-action"
                      >
                        <LearningTitle
                          labels={course.labels}
                          primaryLocale={course.primaryLocale}
                          locale={locale}
                        />
                      </a>
                    </h2>
                    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-foreground-muted">
                      <Badge kind="type">{t(`courseList.format.${course.format}`)}</Badge>
                      <span>
                        {t('courses.syllabusSize', {
                          modules: String(course.modules),
                          lessons: String(course.lessons),
                        })}
                      </span>
                      {counts.ok ? (
                        <span>
                          {t('courses.learners', {
                            count: perCourse.get(course.id) ?? 0,
                          })}
                        </span>
                      ) : null}
                      <span>
                        {t('courses.since')}{' '}
                        <OwnTime
                          value={scope.grantedAt}
                          locale={locale}
                          accountZone={gate.session.account.timezone}
                        />
                      </span>
                    </p>
                  </div>
                  <nav
                    aria-label={t('courseList.sectionsOf', {
                      title:
                        pickLabel(course.labels, locale, course.primaryLocale)?.title ??
                        course.slug,
                    })}
                  >
                    <ul className="flex flex-wrap gap-1">
                      <li>
                        <a href={`${root}/students`} className={SECTION_LINK}>
                          {t('courses.students')}
                        </a>
                      </li>
                      {course.format === 'live' ? (
                        <li>
                          <a href={`${root}/sessions`} className={SECTION_LINK}>
                            {t('courses.sessions')}
                          </a>
                        </li>
                      ) : null}
                      <li>
                        <a href={`${root}/materials`} className={SECTION_LINK}>
                          {t('courses.materials')}
                        </a>
                      </li>
                    </ul>
                  </nav>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </TeacherFrame>
  );
}
