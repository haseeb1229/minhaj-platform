import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { LearningTitle } from '@/components/my-learning/parts';
import { learningRead } from '@/components/my-learning/read';
import { participantNames } from '@/components/teacher/names';
import {
  AttendanceWord,
  ClassTime,
  NotActivated,
  OwnTime,
  SessionStateBadge,
  TeacherFrame,
} from '@/components/teacher/parts';
import {
  Alert,
  DataCell,
  DataRow,
  DataTable,
  EmptyState,
  Panel,
  SectionHeading,
  TextLink,
} from '@/components/ui';
import { learningRuntime } from '@/composition/learning';
import { requireLocale } from '@/config/route-locale';
import { requireTeacher } from '../../guard';

/**
 * One learner as their teacher may know them (ROUTE_MAP.md §6): the Courses
 * of this teacher they are on with their progress, and their class history
 * with this teacher with each mark. LEARNING FACTS ONLY — no contact details,
 * no notes, nothing a teacher could write about a person (§13.4).
 *
 * A learner unrelated to this teacher is this page's 404 exactly like an
 * account that does not exist. Opening it is audited by the service as
 * identifiers only.
 */
export const metadata = { robots: { index: false, follow: false } };

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function StudentPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const path = `/${locale}/teacher/students/${encodeURIComponent(id)}`;
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const read = await learningRead('teaching-student', () =>
    learningRuntime().teaching.student(gate.actor, id),
  );
  if (!read.ok)
    return (
      <TeacherFrame title={t('student.fallbackTitle')}>
        <Alert tone="error">{t('failure.load')}</Alert>
      </TeacherFrame>
    );
  if (read.value === null) notFound();

  const student = read.value;
  const names = await participantNames([student.accountId]);
  const accountZone = gate.session.account.timezone;
  const back = (
    <p>
      <TextLink href={`/${locale}/teacher/students`}>{t('student.back')}</TextLink>
    </p>
  );

  return (
    <TeacherFrame
      title={
        <span dir="auto" className="wrap-anywhere">
          {names.get(student.accountId) ?? t('common.learner')}
        </span>
      }
      description={<p>{t('student.description')}</p>}
    >
      <section className="flex flex-col gap-3" aria-labelledby="student-courses">
        <span id="student-courses">
          <SectionHeading>{t('student.courses')}</SectionHeading>
        </span>
        {student.courses.length === 0 ? (
          <EmptyState>{t('student.coursesEmpty')}</EmptyState>
        ) : (
          <ul className="flex flex-col gap-3" aria-label={t('student.courses')}>
            {student.courses.map((entry) => (
              <Panel key={entry.course.id} as="li">
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                  <TextLink
                    href={`/${locale}/teacher/courses/${encodeURIComponent(entry.course.id)}`}
                  >
                    <LearningTitle
                      labels={entry.course.labels}
                      primaryLocale={entry.course.primaryLocale}
                      locale={locale}
                    />
                  </TextLink>
                  <span>
                    {t('students.progress', {
                      completed: String(
                        Math.min(entry.completedLessons, entry.course.lessons),
                      ),
                      total: String(entry.course.lessons),
                    })}
                  </span>
                  <span className="text-[color:var(--color-foreground-muted)]">
                    {t('students.enrolledAt')}{' '}
                    <OwnTime
                      value={entry.enrolledAt}
                      locale={locale}
                      accountZone={accountZone}
                    />
                  </span>
                </div>
              </Panel>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="student-classes">
        <span id="student-classes">
          <SectionHeading>{t('student.classes')}</SectionHeading>
        </span>
        {student.classes.length === 0 ? (
          <EmptyState>{t('student.classesEmpty')}</EmptyState>
        ) : (
          <DataTable
            caption={t('student.classes')}
            columns={[
              t('common.class'),
              t('common.when'),
              t('common.state'),
              t('session.participation'),
              t('student.attendance'),
            ]}
          >
            {student.classes.map((entry) => (
              <DataRow key={entry.session.id}>
                <DataCell wrap>
                  <TextLink
                    href={`/${locale}/teacher/classes/today/${encodeURIComponent(entry.session.id)}`}
                  >
                    <LearningTitle
                      labels={entry.course.labels}
                      primaryLocale={entry.course.primaryLocale}
                      locale={locale}
                    />
                  </TextLink>{' '}
                  <span className="text-[color:var(--color-foreground-muted)]">
                    {t(`kind.${entry.session.kind}`)}
                  </span>
                </DataCell>
                <DataCell wrap>
                  <ClassTime
                    session={entry.session}
                    locale={locale}
                    accountZone={accountZone}
                    t={t}
                  />
                </DataCell>
                <DataCell>
                  <SessionStateBadge state={entry.session.state} t={t} />
                </DataCell>
                <DataCell wrap>{t(`participation.${entry.participation}`)}</DataCell>
                <DataCell>
                  <AttendanceWord status={entry.attendance} t={t} />
                </DataCell>
              </DataRow>
            ))}
          </DataTable>
        )}
      </section>

      {back}
    </TeacherFrame>
  );
}
