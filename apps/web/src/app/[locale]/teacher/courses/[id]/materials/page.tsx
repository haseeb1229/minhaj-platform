import { getTranslations } from 'next-intl/server';

import { LearningTitle } from '@/components/my-learning/parts';
import {
  lessonsInOrder,
  paragraphs,
  pickLabel,
  selectedLesson,
} from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import {
  CourseFrame,
  CourseUnavailable,
  readTeacherCourse,
} from '@/components/teacher/course-frame';
import { NotActivated } from '@/components/teacher/parts';
import { readLesson } from '@/components/teacher/presentation';
import { Alert, EmptyState, Panel, SectionHeading, TextLink } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../../../guard';

/**
 * One assigned Course's materials (ROUTE_MAP.md §6): its syllabus and one
 * lesson's text at a time, exactly as an enrolled learner reads it.
 *
 * `?lesson=` CHOOSES, IT DOES NOT TRUST. A lesson the address names is opened
 * only when it is genuinely in this syllabus; otherwise the first lesson is.
 * The body is plain text, rendered as paragraphs of text nodes — there is no
 * markup in a lesson body to interpret. Nothing here records anything.
 *
 * NO UPLOAD. Materials are written into the Course by the Learning
 * administration; a teacher reads them here.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function CourseMaterialsPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const path = `/${locale}/teacher/courses/${encodeURIComponent(id)}/materials`;
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const read = await readTeacherCourse(gate.actor, id);
  if (!read.ok) return <CourseUnavailable locale={locale} t={t} />;
  const { course } = read;
  const lessons = lessonsInOrder(course.outline);
  const chosen = selectedLesson(
    course.outline,
    new Set(),
    readLesson(await searchParams),
  );
  const lessonRead =
    chosen === null
      ? null
      : await learningRead('teaching-lesson', () =>
          learningRuntime().teaching.lesson(gate.actor, course.id, chosen),
        );
  const lesson = lessonRead?.ok ? lessonRead.value : null;
  const lessonLabel =
    lesson === null ? null : pickLabel(lesson.labels, locale, course.primaryLocale);
  const position =
    chosen === null ? -1 : lessons.findIndex((entry) => entry.id === chosen);
  const next = position === -1 ? undefined : lessons[position + 1];

  return (
    <CourseFrame
      course={course}
      heading={t('materials.title')}
      description={<p>{t('materials.description')}</p>}
      locale={locale}
      t={t}
    >
      {lessons.length === 0 ? (
        <EmptyState>{t('materials.noLessons')}</EmptyState>
      ) : (
        <nav aria-label={t('materials.lessons')} className="flex flex-col gap-3">
          {course.outline.map((part, index) => (
            <Panel key={part.id}>
              <div className="flex flex-col gap-2">
                <h2 className="font-semibold">
                  {t('course.module', { number: String(index + 1) })}{' '}
                  <LearningTitle
                    labels={part.labels}
                    primaryLocale={course.primaryLocale}
                    locale={locale}
                  />
                </h2>
                <ol className="flex flex-col gap-1">
                  {part.lessons.map((entry) => (
                    <li key={entry.id} className="flex min-h-11 items-center">
                      <a
                        href={`${path}?lesson=${encodeURIComponent(entry.id)}`}
                        aria-current={entry.id === chosen ? 'page' : undefined}
                        className="min-w-0 font-medium text-[color:var(--color-action)] underline underline-offset-2 aria-[current=page]:no-underline"
                      >
                        <LearningTitle
                          labels={entry.labels}
                          primaryLocale={course.primaryLocale}
                          locale={locale}
                        />
                      </a>
                    </li>
                  ))}
                </ol>
              </div>
            </Panel>
          ))}
        </nav>
      )}

      {chosen === null ? null : lesson === null || lessonLabel === null ? (
        <Alert tone="error">{t('materials.unavailable')}</Alert>
      ) : (
        <section className="flex flex-col gap-4" aria-labelledby="materials-lesson">
          <span id="materials-lesson">
            <SectionHeading>
              <span lang={lessonLabel.locale} dir="auto" className="wrap-anywhere">
                {lessonLabel.title}
              </span>
            </SectionHeading>
          </span>
          <p className="text-sm text-[color:var(--color-foreground-muted)]">
            {t('materials.position', {
              number: String(position + 1),
              total: String(lessons.length),
            })}
          </p>
          {lessonLabel.summary === '' ? null : (
            <p lang={lessonLabel.locale} dir="auto" className="font-medium wrap-anywhere">
              {lessonLabel.summary}
            </p>
          )}
          <div lang={lessonLabel.locale} dir="auto" className="flex flex-col gap-3">
            {paragraphs(lessonLabel.body).map((paragraph, index) => (
              <p key={index} className="whitespace-pre-line wrap-anywhere">
                {paragraph}
              </p>
            ))}
          </div>
          {next === undefined ? null : (
            <p>
              <TextLink href={`${path}?lesson=${encodeURIComponent(next.id)}`}>
                {t('materials.next')}
              </TextLink>
            </p>
          )}
        </section>
      )}
    </CourseFrame>
  );
}
