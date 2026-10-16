import 'server-only';

import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import type { Locale } from '@minhaj/contracts';
import type { CourseDetail, LearningActor } from '@minhaj/contracts/learning';

import { LearningTitle } from '@/components/my-learning/parts';
import { learningRead } from '@/components/my-learning/read';
import { Alert, TextLink } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { TeacherFrame, TeacherLinks, type TeacherTranslator } from './parts';

/**
 * One assigned Course, as every page under `/teacher/courses/{id}` opens it.
 *
 * ONLY A COURSE THE TEACHER CURRENTLY TEACHES OPENS. The Course is read under
 * the live assignments and a current scope on exactly this Course, so one
 * they do not teach — or no longer teach — is a 404 exactly like one that
 * does not exist.
 */
export async function readTeacherCourse(
  actor: LearningActor,
  courseId: string,
): Promise<
  { readonly ok: true; readonly course: CourseDetail } | { readonly ok: false }
> {
  const read = await learningRead('teaching-course', () =>
    learningRuntime().teaching.course(actor, courseId),
  );
  if (!read.ok) return { ok: false };
  if (read.value === null) notFound();
  return { ok: true, course: read.value };
}

/** The links between one Course's pages. */
export function courseLinks(locale: Locale, courseId: string, t: TeacherTranslator) {
  const root = `/${locale}/teacher/courses/${encodeURIComponent(courseId)}`;
  return [
    { href: root, text: t('course.syllabus') },
    { href: `${root}/students`, text: t('courses.students') },
    { href: `${root}/sessions`, text: t('courses.sessions') },
    { href: `${root}/materials`, text: t('courses.materials') },
    { href: `/${locale}/teacher/courses`, text: t('course.back') },
  ];
}

/** The frame of one Course's page: its title, the page's own heading, and its links. */
export function CourseFrame({
  course,
  heading,
  description,
  locale,
  t,
  children,
}: {
  readonly course: CourseDetail;
  readonly heading: string;
  readonly description?: ReactNode;
  readonly locale: Locale;
  readonly t: TeacherTranslator;
  readonly children: ReactNode;
}) {
  return (
    <TeacherFrame
      title={
        <LearningTitle
          labels={course.labels}
          primaryLocale={course.primaryLocale}
          locale={locale}
        />
      }
      description={
        <>
          <p className="font-medium">{heading}</p>
          {description}
        </>
      }
    >
      <TeacherLinks
        label={t('course.sections')}
        links={courseLinks(locale, course.id, t)}
      />
      {children}
    </TeacherFrame>
  );
}

/** The page a failed Course read shows, inside the area's frame. */
export function CourseUnavailable({
  locale,
  t,
}: {
  readonly locale: Locale;
  readonly t: TeacherTranslator;
}) {
  return (
    <TeacherFrame title={t('course.fallbackTitle')}>
      <Alert tone="error">{t('failure.load')}</Alert>
      <p>
        <TextLink href={`/${locale}/teacher/courses`}>{t('course.back')}</TextLink>
      </p>
    </TeacherFrame>
  );
}
