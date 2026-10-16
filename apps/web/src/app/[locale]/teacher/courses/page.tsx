import { getTranslations } from 'next-intl/server';

import { LearningTitle } from '@/components/my-learning/parts';
import { learningRead } from '@/components/my-learning/read';
import {
  NotActivated,
  OwnTime,
  TeacherFrame,
  TeacherLinks,
} from '@/components/teacher/parts';
import { Alert, EmptyState, Panel } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../guard';

/**
 * Courses (ROUTE_MAP.md §6): the Courses the teacher CURRENTLY teaches — a
 * current typed scope under a live `teaching.perform` assignment, never a
 * Course's public attribution — each opening its syllabus, students, classes
 * and materials.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function TeacherCoursesPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const locale = await requireLocale(params);
  const gate = await requireTeacher(locale, `/${locale}/teacher/courses`);
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
        <EmptyState>{t('courses.empty')}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3" aria-label={t('courses.list')}>
          {read.value.map(({ course, scope }) => {
            const root = `/${locale}/teacher/courses/${encodeURIComponent(course.id)}`;
            return (
              <Panel key={scope.id} as="li">
                <div className="flex min-w-0 flex-col gap-2">
                  <h2 className="font-semibold">
                    <a
                      href={root}
                      className="text-[color:var(--color-action)] underline underline-offset-2"
                    >
                      <LearningTitle
                        labels={course.labels}
                        primaryLocale={course.primaryLocale}
                        locale={locale}
                      />
                    </a>
                  </h2>
                  <p className="text-sm">
                    {t('courses.syllabusSize', {
                      modules: String(course.modules),
                      lessons: String(course.lessons),
                    })}
                  </p>
                  <p className="text-sm text-[color:var(--color-foreground-muted)]">
                    {t('courses.since')}{' '}
                    <OwnTime
                      value={scope.grantedAt}
                      locale={locale}
                      accountZone={gate.session.account.timezone}
                    />
                  </p>
                  <TeacherLinks
                    label={t('course.sections')}
                    links={[
                      { href: `${root}/students`, text: t('courses.students') },
                      { href: `${root}/sessions`, text: t('courses.sessions') },
                      { href: `${root}/materials`, text: t('courses.materials') },
                    ]}
                  />
                </div>
              </Panel>
            );
          })}
        </ul>
      )}
    </TeacherFrame>
  );
}
