import { localizedPath } from '@minhaj/contracts';
import 'server-only';

import type { Locale } from '@minhaj/contracts';
import type { TeacherStudentSummary } from '@minhaj/contracts/learning';

import { pickLabel } from '@/components/my-learning/presentation';
import type { TeacherTranslator } from './parts';
import { ownZone } from './presentation';
import { StudentDirectory, type DirectoryRow } from './student-directory';
import { progressStage } from './student-progress';

/**
 * A page of learners as their teacher may see them: a name, and for each of
 * the teacher's Courses they are on, when they enrolled and how far they are.
 * Progress is written as words — "Lessons complete: 3 of 10" — beside a bar
 * that only repeats them. Each name opens the learner's Learning facts, and
 * nothing else.
 *
 * The words are finished here, on the server, in the teacher's own zone and
 * language; the directory island only narrows what is already on the page.
 */
export function StudentList({
  label,
  students,
  names,
  locale,
  accountZone,
  t,
}: {
  readonly label: string;
  readonly students: readonly TeacherStudentSummary[];
  readonly names: ReadonlyMap<string, string>;
  readonly locale: Locale;
  readonly accountZone: string | null;
  readonly t: TeacherTranslator;
}) {
  const enrolled = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeZone: ownZone(accountZone),
  });
  const rows: DirectoryRow[] = students.map((student) => ({
    accountId: student.accountId,
    name: names.get(student.accountId) ?? t('common.learner'),
    href: localizedPath(
      locale,
      `/teacher/students/${encodeURIComponent(student.accountId)}`,
    ),
    courses: student.courses.map((entry) => {
      const title = pickLabel(entry.course.labels, locale, entry.course.primaryLocale);
      const completed = Math.min(entry.completedLessons, entry.course.lessons);
      return {
        id: entry.course.id,
        title: title?.title ?? entry.course.slug,
        lang: title?.locale,
        progress: t('students.progress', {
          completed: String(completed),
          total: String(entry.course.lessons),
        }),
        completed,
        total: entry.course.lessons,
        stage: progressStage(entry.completedLessons, entry.course.lessons),
        enrolled: t('directory.enrolledOn', { date: enrolled.format(entry.enrolledAt) }),
      };
    }),
  }));

  return (
    <StudentDirectory
      rows={rows}
      locale={locale}
      words={{
        label,
        search: t('directory.search'),
        stage: t('directory.stage'),
        allStages: t('directory.allStages'),
        stages: {
          'not-started': t('progress.notStarted'),
          'in-progress': t('progress.inProgress'),
          completed: t('progress.completed'),
        },
        // The island fills the two counts as the reader filters.
        shown: t('directory.shown', { shown: '{shown}', total: '{total}' }),
        noMatch: t('directory.noMatch'),
      }}
    />
  );
}
