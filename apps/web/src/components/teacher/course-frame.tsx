import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import type { Locale } from '@minhaj/contracts';
import type { CourseDetail, LearningActor } from '@minhaj/contracts/learning';

import { LearningTitle } from '@/components/my-learning/parts';
import { learningRead } from '@/components/my-learning/read';
import { Alert, Icon, LinkTabs, TextLink } from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { TeacherFrame, type TeacherTranslator } from './parts';

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
 * The frame of one Course's page: the Course's title as the page's heading,
 * the way back to the Course list beside it, and the four views of the Course
 * as route tabs with the current one marked.
 */
export function CourseFrame({
  course,
  view,
  description,
  locale,
  t,
  children,
}: {
  readonly course: CourseDetail;
  readonly view: CourseView;
  readonly description?: ReactNode;
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
    { key: 'sessions', href: `${root}/sessions`, text: t('courses.sessions') },
    { key: 'materials', href: `${root}/materials`, text: t('courses.materials') },
  ];
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
      action={
        <a
          href={localizedPath(locale, '/teacher/courses')}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-action underline-offset-4 hover:underline"
        >
          <Icon name="arrow-start" size={16} />
          {t('course.back')}
        </a>
      }
    >
      <LinkTabs
        label={t('course.sections')}
        tabs={tabs.map((tab) => ({
          href: tab.href,
          text: tab.text,
          current: tab.key === view,
        }))}
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
        <TextLink href={localizedPath(locale, '/teacher/courses')}>
          {t('course.back')}
        </TextLink>
      </p>
    </TeacherFrame>
  );
}
