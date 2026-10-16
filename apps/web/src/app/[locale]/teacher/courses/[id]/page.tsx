import { getTranslations } from 'next-intl/server';

import { LearningTitle } from '@/components/my-learning/parts';
import { pickLabel } from '@/components/my-learning/presentation';
import {
  CourseFrame,
  CourseUnavailable,
  readTeacherCourse,
} from '@/components/teacher/course-frame';
import { NotActivated } from '@/components/teacher/parts';
import { EmptyState, Panel, SectionHeading, TextLink } from '@/components/ui';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../../guard';

/**
 * One assigned Course's syllabus (ROUTE_MAP.md §6): its description, its
 * modules and lessons in order, each lesson opening its text on the
 * materials page. Read-only: the syllabus is the catalogue's, edited by the
 * Learning administration, never by a teacher.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function TeacherCoursePage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const gate = await requireTeacher(
    locale,
    `/${locale}/teacher/courses/${encodeURIComponent(id)}`,
  );
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const read = await readTeacherCourse(gate.actor, id);
  if (!read.ok) return <CourseUnavailable locale={locale} t={t} />;
  const { course } = read;
  const label = pickLabel(course.labels, locale, course.primaryLocale);
  const materials = `/${locale}/teacher/courses/${encodeURIComponent(course.id)}/materials`;

  return (
    <CourseFrame
      course={course}
      heading={t('course.syllabus')}
      description={
        <>
          {label === null || label.summary === '' ? null : (
            <p lang={label.locale} dir="auto" className="wrap-anywhere">
              {label.summary}
            </p>
          )}
          {label === null || label.description === '' ? null : (
            <p
              lang={label.locale}
              dir="auto"
              className="whitespace-pre-line wrap-anywhere"
            >
              {label.description}
            </p>
          )}
          <p className="text-sm">
            {t('courses.syllabusSize', {
              modules: String(course.modules),
              lessons: String(course.lessons),
            })}
          </p>
          {course.state === 'published' ? (
            <p>
              <TextLink
                href={`/${locale}/learn/courses/${encodeURIComponent(course.slug)}`}
              >
                {t('course.publicPage')}
              </TextLink>
            </p>
          ) : null}
        </>
      }
      locale={locale}
      t={t}
    >
      <section className="flex flex-col gap-3" aria-labelledby="course-syllabus">
        <span id="course-syllabus">
          <SectionHeading>{t('course.syllabus')}</SectionHeading>
        </span>
        {course.outline.length === 0 ? (
          <EmptyState>{t('materials.noLessons')}</EmptyState>
        ) : (
          course.outline.map((part, index) => (
            <Panel key={part.id}>
              <div className="flex flex-col gap-2">
                <h3 className="font-semibold">
                  {t('course.module', { number: String(index + 1) })}{' '}
                  <LearningTitle
                    labels={part.labels}
                    primaryLocale={course.primaryLocale}
                    locale={locale}
                  />
                </h3>
                <ol className="flex flex-col gap-1">
                  {part.lessons.map((lesson) => (
                    <li key={lesson.id} className="flex min-h-11 items-center">
                      <TextLink
                        href={`${materials}?lesson=${encodeURIComponent(lesson.id)}`}
                      >
                        <LearningTitle
                          labels={lesson.labels}
                          primaryLocale={course.primaryLocale}
                          locale={locale}
                        />
                      </TextLink>
                    </li>
                  ))}
                </ol>
              </div>
            </Panel>
          ))
        )}
      </section>
    </CourseFrame>
  );
}
