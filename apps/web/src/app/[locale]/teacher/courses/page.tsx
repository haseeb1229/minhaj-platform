import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';

import { LearningTitle } from '@/components/my-learning/parts';
import { pickLabel } from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import { teacherPageMetadata } from '@/components/teacher/metadata';
import { NoScope, NotActivated, OwnTime, TeacherFrame } from '@/components/teacher/parts';
import { Alert, Badge } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../guard';

/**
 * Courses (ROUTE_MAP.md §6): the Courses the teacher CURRENTLY teaches — a
 * current typed scope under a live `teaching.perform` assignment, never a
 * Course's public attribution — each opening its syllabus, students, classes
 * and materials.
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

  const read = await learningRead('teaching-courses', () =>
    learningRuntime().teaching.courses(gate.actor),
  );

  return (
    <TeacherFrame
      title={t('courses.title')}
      description={<p>{t('courses.description')}</p>}
    >
      {!read.ok ? (
        <Alert tone="error">{t('failure.load')}</Alert>
      ) : read.value.length === 0 ? (
        <NoScope locale={locale} t={t} />
      ) : (
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
      )}
    </TeacherFrame>
  );
}
