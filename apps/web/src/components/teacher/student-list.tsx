import 'server-only';

import type { ReactNode } from 'react';

import type { Locale } from '@minhaj/contracts';
import type { TeacherStudentSummary } from '@minhaj/contracts/learning';

import { LearningTitle } from '@/components/my-learning/parts';
import { Panel, TextLink } from '@/components/ui';
import type { TeacherTranslator } from './parts';

/**
 * A page of learners as their teacher may see them: a name, and for each of
 * the teacher's Courses they are on, when they enrolled and how far they are.
 * Progress is written as words — "Lessons complete: 3 of 10" — never as a bar
 * alone. Each name opens the learner's Learning facts, and nothing else.
 */
export function StudentList({
  label,
  students,
  names,
  locale,
  enrolledAt,
  t,
}: {
  readonly label: string;
  readonly students: readonly TeacherStudentSummary[];
  readonly names: ReadonlyMap<string, string>;
  readonly locale: Locale;
  readonly enrolledAt: (at: Date) => ReactNode;
  readonly t: TeacherTranslator;
}) {
  return (
    <ol className="flex flex-col gap-3" aria-label={label}>
      {students.map((student) => (
        <Panel key={student.accountId} as="li">
          <div className="flex min-w-0 flex-col gap-2">
            <TextLink
              href={`/${locale}/teacher/students/${encodeURIComponent(student.accountId)}`}
            >
              <span dir="auto" className="wrap-anywhere">
                {names.get(student.accountId) ?? t('common.learner')}
              </span>
            </TextLink>
            <ul
              className="flex flex-col gap-1 text-sm"
              aria-label={t('students.courses')}
            >
              {student.courses.map((entry) => (
                <li
                  key={entry.course.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1"
                >
                  <LearningTitle
                    labels={entry.course.labels}
                    primaryLocale={entry.course.primaryLocale}
                    locale={locale}
                  />
                  <span>
                    {t('students.progress', {
                      completed: String(
                        Math.min(entry.completedLessons, entry.course.lessons),
                      ),
                      total: String(entry.course.lessons),
                    })}
                  </span>
                  <span className="text-[color:var(--color-foreground-muted)]">
                    {t('students.enrolledAt')} {enrolledAt(entry.enrolledAt)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      ))}
    </ol>
  );
}
