import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { requireLocale } from '@/config/route-locale';

/**
 * EVERY TEACHER-AREA PAGE NAMES ITSELF (R2). The layout's private-area title
 * template turns the page's own name into "Calendar · Teacher area · One
 * Minhaj", so a teacher with several tabs open — and a screen reader
 * announcing a new page — hears which page this is.
 *
 * The names are fixed words, never a record's title: a class's or a learner's
 * page is titled "Class" or "Student", so no learner's name reaches a browser
 * history or a tab strip. Never indexed, on the page as on the layout.
 */
export type TeacherTitleKey =
  | 'overview'
  | 'today'
  | 'calendar'
  | 'class'
  | 'students'
  | 'student'
  | 'courses'
  | 'course'
  | 'courseStudents'
  | 'courseSessions'
  | 'materials'
  | 'resources'
  | 'attendance'
  | 'markAttendance'
  | 'reports'
  | 'availability'
  | 'messages'
  | 'conversation'
  | 'profile';

export async function teacherPageMetadata(
  params: Promise<{ readonly locale: string }>,
  key: TeacherTitleKey,
): Promise<Metadata> {
  const locale = await requireLocale(params);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  return { title: t(`titles.${key}`), robots: { index: false, follow: false } };
}
