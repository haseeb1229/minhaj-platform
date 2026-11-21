import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import type { Locale } from '@minhaj/contracts';
import type { CourseDetail, LearningActor } from '@minhaj/contracts/learning';

import { LearningTitle } from '@/components/my-learning/parts';
import { learningRead } from '@/components/my-learning/read';
import { pickLabel } from '@/components/my-learning/presentation';
import { Alert } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { TeacherFrame, teacherTrail, type TeacherTranslator } from './parts';

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

/** The views of one Course, each its own page. */
export type CourseView = 'syllabus' | 'students' | 'sessions' | 'materials';

/**
 * The frame of one Course's page: its trail (Teacher area / Courses / the
 * Course, then the view), the Course's title as the page's heading, and the
 * four views of the Course as route tabs with the current one marked. A
 * self-paced Course has no classes, so its Classes view is not offered.
 */
export function CourseFrame({
  course,
  view,
  description,
  action,
  announce,
  locale,
  t,
  children,
}: {
  readonly course: CourseDetail;
  readonly view: CourseView;
  readonly description?: ReactNode;
  readonly action?: ReactNode;
  readonly announce?: { readonly value: string; readonly message: string };
  readonly locale: Locale;
  readonly t: TeacherTranslator;
  readonly children: ReactNode;
}) {
  const root = localizedPath(locale, `/teacher/courses/${encodeURIComponent(course.id)}`);
  const tabs: readonly {
    readonly key: CourseView;
    readonly href: string;
    readonly text: string;
  }[] = [
    { key: 'syllabus', href: root, text: t('course.syllabus') },
    { key: 'students', href: `${root}/students`, text: t('courses.students') },
    ...(course.format === 'live' || view === 'sessions'
      ? [
          {
            key: 'sessions' as const,
            href: `${root}/sessions`,
            text: t('courses.sessions'),
          },
        ]
      : []),
    { key: 'materials', href: `${root}/materials`, text: t('courses.materials') },
  ];
  const title =
    pickLabel(course.labels, locale, course.primaryLocale)?.title ?? course.slug;
  const current = tabs.find((tab) => tab.key === view);
  return (
    <TeacherFrame
      title={
        <LearningTitle
          labels={course.labels}
          primaryLocale={course.primaryLocale}
          locale={locale}
        />
      }
      {...(description === undefined ? {} : { description })}
      {...(action === undefined ? {} : { action })}
      {...(announce === undefined ? {} : { announce })}
      trail={teacherTrail(locale, t, [
        { href: localizedPath(locale, '/teacher/courses'), text: t('nav.courses') },
        ...(view === 'syllabus' || current === undefined
          ? [{ text: title }]
          : [{ href: root, text: title }, { text: current.text }]),
      ])}
      tabs={{
        label: t('course.sections'),
        items: tabs.map((tab) => ({
          href: tab.href,
          text: tab.text,
          current: tab.key === view,
        })),
      }}
    >
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
    <TeacherFrame
      title={t('course.fallbackTitle')}
      trail={teacherTrail(locale, t, [
        { href: localizedPath(locale, '/teacher/courses'), text: t('nav.courses') },
        { text: t('course.fallbackTitle') },
      ])}
    >
      <Alert tone="error">{t('failure.load')}</Alert>
    </TeacherFrame>
  );
}
