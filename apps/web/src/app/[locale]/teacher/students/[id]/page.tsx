import type { Metadata } from 'next';
import { localizedPath } from '@minhaj/contracts';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { TEACHER_STUDENT_CLASSES } from '@minhaj/contracts/learning';

import { messagingMessages } from '@/components/messaging/parts';
import { messagingRead } from '@/components/messaging/read';
import { LearningTitle } from '@/components/my-learning/parts';
import { pickLabel } from '@/components/my-learning/presentation';
import { learningRead } from '@/components/my-learning/read';
import { ProgressMeter } from '@/components/my/frame';
import { MyFigures } from '@/components/my/summary-parts';
import { participantNames } from '@/components/teacher/names';
import {
  AttendanceWord,
  ClassTime,
  NotActivated,
  OwnTime,
  SessionStateBadge,
  TeacherFrame,
  teacherTrail,
} from '@/components/teacher/parts';
import { meterPercent } from '@/components/ui/meter';
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
import { teacherPageMetadata } from '@/components/teacher/metadata';
import { learningRuntime } from '@/composition/learning';
import { messagingRuntime } from '@/composition/messaging';
import { requireLocale } from '@/config/route-locale';
import { ActionForm } from '../../../(identity)/form-state';
import { requireTeacher } from '../../guard';
import { startTeacherConversationAction } from '../../messages/actions';

/**
 * One learner as their teacher may know them (ROUTE_MAP.md §6): the Courses
 * of this teacher they are on with their progress, and their class history
 * with this teacher with each mark. LEARNING FACTS ONLY — no contact details,
 * no notes, nothing a teacher could write about a person (§13.4).
 *
 * A learner unrelated to this teacher is this page's 404 exactly like an
 * account that does not exist. Opening it is audited by the service as
 * identifiers only.
 *
 * MESSAGING, PER COURSE (Phase 24). Each Course listed is one this teacher
 * teaches NOW and the learner is enrolled on, so each may open — or return to
 * — that relationship's conversation. The button appears only while
 * teacher–student messaging is activated; the Messaging service re-decides
 * the relationship when it is pressed.
 *
 * AT A GLANCE (Teacher area, R2): the trail (Teacher area / Students / the
 * learner), and figures that are true of what the page holds — the Courses
 * with this teacher, the classes, and how many were attended and missed;
 * when the history reached its bound the figures say "or more" rather than a
 * number they are not. Each Course's progress is a meter beside its words.
 */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}): Promise<Metadata> {
  return teacherPageMetadata(params, 'student');
}

/** PER REQUEST, always: this surface reads a session. */
export const dynamic = 'force-dynamic';

export default async function StudentPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string; readonly id: string }>;
}) {
  const locale = await requireLocale(params);
  const { id } = await params;
  const path = localizedPath(locale, `/teacher/students/${encodeURIComponent(id)}`);
  const gate = await requireTeacher(locale, path);
  const t = await getTranslations({ locale, namespace: 'teacher' });
  if (!gate.activated) return <NotActivated t={t} />;

  const read = await learningRead('teaching-student', () =>
    learningRuntime().teaching.student(gate.actor, id),
  );
  const studentsCrumb = {
    href: localizedPath(locale, '/teacher/students'),
    text: t('nav.students'),
  };
  if (!read.ok)
    return (
      <TeacherFrame
        title={t('student.fallbackTitle')}
        trail={teacherTrail(locale, t, [
          studentsCrumb,
          { text: t('student.fallbackTitle') },
        ])}
      >
        <Alert tone="error">{t('failure.load')}</Alert>
      </TeacherFrame>
    );
  if (read.value === null) notFound();

  const student = read.value;
  const names = await participantNames([student.accountId]);
  const capabilities = await messagingRead('messaging-capabilities', () =>
    messagingRuntime().service.capabilities(),
  );
  const canMessage = capabilities.ok && capabilities.value.teacherStudent;
  const m = await getTranslations({ locale, namespace: 'messages' });
  const learnerName = names.get(student.accountId) ?? t('common.learner');
  const accountZone = gate.session.account.timezone;
  const number = new Intl.NumberFormat(locale);
  const bounded = student.classes.length >= TEACHER_STUDENT_CLASSES;
  const counted = (value: number) =>
    bounded ? t('student.orMore', { count: number.format(value) }) : number.format(value);
  const marked = (status: 'present' | 'absent') =>
    student.classes.filter((entry) => entry.attendance === status).length;

  return (
    <TeacherFrame
      title={
        <span dir="auto" className="wrap-anywhere">
          {learnerName}
        </span>
      }
      description={<p>{t('student.description')}</p>}
      trail={teacherTrail(locale, t, [studentsCrumb, { text: learnerName }])}
    >
      <MyFigures
        label={t('student.figures.label')}
        figures={[
          {
            key: 'courses',
            value: number.format(student.courses.length),
            label: t('student.figures.courses'),
          },
          {
            key: 'classes',
            value: counted(student.classes.length),
            label: t('student.figures.classes'),
          },
          {
            key: 'present',
            value: counted(marked('present')),
            label: t('student.figures.present'),
          },
          {
            key: 'absent',
            value: counted(marked('absent')),
            label: t('student.figures.absent'),
          },
        ]}
      />
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
                <div className="flex min-w-0 flex-col gap-1 text-sm wrap-anywhere">
                  <TextLink
                    href={localizedPath(
                      locale,
                      `/teacher/courses/${encodeURIComponent(entry.course.id)}`,
                    )}
                  >
                    <LearningTitle
                      labels={entry.course.labels}
                      primaryLocale={entry.course.primaryLocale}
                      locale={locale}
                    />
                  </TextLink>
                  <ProgressMeter
                    percent={meterPercent(entry.completedLessons, entry.course.lessons)}
                  >
                    {t('students.progress', {
                      completed: String(
                        Math.min(entry.completedLessons, entry.course.lessons),
                      ),
                      total: String(entry.course.lessons),
                    })}
                  </ProgressMeter>
                  <span className="text-foreground-muted">
                    {t('students.enrolledAt')}{' '}
                    <OwnTime
                      value={entry.enrolledAt}
                      locale={locale}
                      accountZone={accountZone}
                    />
                  </span>
                  {canMessage && entry.course.state === 'published' ? (
                    <ActionForm
                      action={startTeacherConversationAction}
                      submitLabel={m('teacher.message', {
                        name: learnerName,
                        course:
                          pickLabel(
                            entry.course.labels,
                            locale,
                            entry.course.primaryLocale,
                          )?.title ?? m('start.someCourse'),
                      })}
                      pendingLabel={m('common.working')}
                      tone="secondary"
                      messages={messagingMessages(m)}
                    >
                      <input type="hidden" name="locale" value={locale} />
                      <input
                        type="hidden"
                        name="counterpartAccountId"
                        value={student.accountId}
                      />
                      <input type="hidden" name="courseId" value={entry.course.id} />
                    </ActionForm>
                  ) : null}
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
                    href={localizedPath(
                      locale,
                      `/teacher/classes/today/${encodeURIComponent(entry.session.id)}`,
                    )}
                  >
                    <LearningTitle
                      labels={entry.course.labels}
                      primaryLocale={entry.course.primaryLocale}
                      locale={locale}
                    />
                  </TextLink>{' '}
                  <span className="text-foreground-muted">
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
    </TeacherFrame>
  );
}
